#!/usr/bin/env python3
"""Importa o estoque do BNDV da PP GARAGE 37 (idCompany 12297) para pa_veiculos. Desde 23/11/2026 é esta a fonte da Bia:
a planilha do Drive ficou para trás e a Bia chegou a oferecer carro já vendido (pedido do Pedro, via Kauan).

Entrada: o CSV do leitor do BNDV (next-cerebro/clientes/pp-automoveis/bndv/estoque-fotos.mjs), com as colunas
  id,marca,modelo,versao,ano,km,cor,cambio,combustivel,preco,situacao,em_circulacao,placa,fotos[,fotos_urls]

Uso:
  python3 scripts/importar-estoque-bndv.py estoque.csv --conferir                       # só mostra, não grava
  SR=$(scripts/chave-servico.sh) python3 scripts/importar-estoque-bndv.py estoque.csv   # troca o estoque da loja
  ... --laudos laudos.json   # {"PLACA": "APROVADO" | "REPROVADO" | ...}, lido da planilha da loja
  ... --forcar               # troca mesmo se o BNDV trouxer menos de 60% dos carros que a Bia tem hoje

Fotos (24/11/2026): a Bia manda as fotos como imagem na conversa, nunca link. Quase todas vêm do BNDV em .webp, que o
WhatsApp não aceita como imagem: cada foto nova é convertida para JPEG aqui (sips, do próprio macOS) e guardada no
armazenamento privado fotos-veiculos do Supabase, em <código do carro no BNDV>/<foto>.jpg. pa_veiculos.fotos guarda esses
caminhos. Foto que já está lá não é baixada de novo; a pasta do carro que saiu do estoque é apagada depois da troca.

O BNDV não guarda o laudo cautelar. O laudo vem do --laudos e, para a placa que já estava cadastrada, do cadastro
anterior. Carro REPROVADO continua fora da oferta da Bia (só o consultor apresenta).
Preço abaixo de R$ 10 mil e km 0 ou 1 são marcadores do cadastro, não dado: vão vazios, e a Bia diz que o consultor confirma.
"""
import csv, json, os, subprocess, sys, tempfile, unicodedata, urllib.request
from concurrent.futures import ThreadPoolExecutor

PROJETO = "https://qdzuwnqejtjbtcysteip.supabase.co"
LOJA = "pp-automoveis"
PRECO_MINIMO = 10_000
# placas digitadas errado na planilha antiga: o laudo guardado no cadastro está na grafia errada
APELIDOS = {"FJS3H37": "FJS3737", "HNN9513": "HHN9513"}
BALDE = "fotos-veiculos"
MAX_FOTOS = 30
COMBUSTIVEL = {"flex": "flex", "gasolina": "gasolina", "diesel": "diesel", "etanol": "etanol", "híbrido": "híbrido", "elétrico": "elétrico"}


def api(metodo, caminho, chave, corpo=None):
    req = urllib.request.Request(f"{PROJETO}/rest/v1/{caminho}", method=metodo,
                                 data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"apikey": chave, "Authorization": f"Bearer {chave}",
                                          "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or "null")


def armazenamento(metodo, caminho, chave, corpo=None, tipo="application/json", extra=None):
    dados = corpo if isinstance(corpo, bytes) else (json.dumps(corpo).encode() if corpo is not None else None)
    req = urllib.request.Request(f"{PROJETO}/storage/v1/{caminho}", method=metodo, data=dados,
                                 headers={"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": tipo, **(extra or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or "null")


def nome_da_foto(url):
    return url.split("?")[0].rsplit("/", 1)[-1].rsplit(".", 1)[0] + ".jpg"


def converter_e_subir(url, caminho, chave):
    """baixa a foto do BNDV, converte para JPEG (sem ampliar; reduz só acima de 1600 px) e sobe para o armazenamento"""
    with tempfile.TemporaryDirectory() as tmp:
        origem, destino = os.path.join(tmp, "origem"), os.path.join(tmp, "foto.jpg")
        with urllib.request.urlopen(url, timeout=60) as r, open(origem, "wb") as f:
            f.write(r.read())
        medidas = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", origem], capture_output=True, text=True).stdout
        maior = max([int(x) for x in medidas.split() if x.isdigit()] or [0])
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85"] + (["-Z", "1600"] if maior > 1600 else []) + [origem, "--out", destino]
        subprocess.run(cmd, capture_output=True, check=True)
        with open(destino, "rb") as f:
            armazenamento("POST", f"object/{BALDE}/{caminho}", chave, f.read(), "image/jpeg", {"x-upsert": "true"})


def sincronizar_fotos(carros, chave):
    """deixa no armazenamento as fotos de cada carro e troca c["fotos"] pelos caminhos de lá, na ordem do BNDV"""
    faltam, prontas = [], {}
    for c in carros:
        codigo, urls = c["anuncios"].get("bndv"), c.pop("_fotos_bndv")
        if not codigo or not urls:
            continue
        ja = {o["name"] for o in armazenamento("POST", f"object/list/{BALDE}", chave, {"prefix": f"{codigo}/", "limit": 1000}) or []}
        for u in urls:
            caminho = f"{codigo}/{nome_da_foto(u)}"
            if nome_da_foto(u) in ja:
                prontas[caminho] = True
            else:
                faltam.append((u, caminho))
    falhas = 0

    def uma(item):
        try:
            converter_e_subir(item[0], item[1], chave)
            return item[1]
        except Exception as e:  # uma foto que falha não segura o estoque: o carro vai com as outras
            print(f"   foto não convertida ({item[1]}): {e}", file=sys.stderr)
            return None

    with ThreadPoolExecutor(6) as ex:
        for feito in ex.map(uma, faltam):
            if feito:
                prontas[feito] = True
            else:
                falhas += 1
    for c in carros:
        c["fotos"] = [p for p in c.get("_caminhos", []) if p in prontas]
        c.pop("_caminhos", None)
    com = sum(1 for c in carros if c["fotos"])
    print(f"Fotos: {com} carros com fotos, {len(faltam) - falhas} novas convertidas para JPEG, {falhas} falharam.")


def limpar_fotos_vendidos(carros, chave):
    """apaga do armazenamento a pasta de fotos de carro que saiu do estoque"""
    atuais = {c["anuncios"].get("bndv") for c in carros}
    pastas = [o["name"] for o in armazenamento("POST", f"object/list/{BALDE}", chave, {"prefix": "", "limit": 1000}) or []]
    for pasta in [p for p in pastas if p not in atuais]:
        nomes = [o["name"] for o in armazenamento("POST", f"object/list/{BALDE}", chave, {"prefix": f"{pasta}/", "limit": 1000}) or []]
        if nomes:
            armazenamento("DELETE", f"object/{BALDE}", chave, {"prefixes": [f"{pasta}/{n}" for n in nomes]})
            print(f"Fotos apagadas de carro que saiu do estoque: {pasta} ({len(nomes)}).")


def inteiro(txt):
    try:
        return int(float(str(txt).replace(",", ".")))
    except ValueError:
        return None


def titulo(c):
    """Marca, modelo e versão sem repetir o modelo quando a versão já começa por ele ("Celta Celta Spirit")"""
    marca, modelo, versao = c["marca"].strip(), c["modelo"].strip(), " ".join(c["versao"].split())
    sem_acento = lambda t: unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().lower()
    primeira = sem_acento(modelo.split()[0]) if modelo else ""
    nome = versao if primeira and sem_acento(versao).startswith(primeira) else f"{modelo} {versao}".strip()
    comb = COMBUSTIVEL.get(c["combustivel"].strip().lower(), c["combustivel"].strip().lower())
    return " ".join(p for p in [marca, nome, c["ano"].strip(), comb] if p)


def ler(caminho, laudos):
    carros = []
    with open(os.path.expanduser(caminho), encoding="utf-8-sig") as f:
        for c in csv.DictReader(f):
            placa = c["placa"].strip().upper().replace("-", "")
            preco = inteiro(c["preco"])
            km = inteiro(c["km"])
            ano_modelo = inteiro(c["ano"].split("/")[-1]) or 0
            if km is not None and (km <= 1 or (km < 1000 and ano_modelo < 2025)):
                km = None
            obs = [f"cor {c['cor'].strip().lower()}" if c["cor"].strip() else "", f"câmbio {c['cambio'].strip().lower()}" if c["cambio"].strip() else ""]
            carros.append({
                "titulo": titulo(c), "disponivel": True,
                "preco": preco if preco and preco >= PRECO_MINIMO else None, "km": km,
                "laudo_cautelar": laudos.get(placa) or None,  # guardado para o consultor, fora do prompt
                "observacoes": "; ".join(o for o in obs if o) or None,
                "anuncios": {"placa": placa, **({"bndv": c["id"].strip()} if c.get("id", "").strip() else {})},
                # fotos do BNDV: viram JPEG no armazenamento privado (sincronizar_fotos) e a Bia manda como imagem
                "fotos": [],
                "_fotos_bndv": (urls := [u for u in (c.get("fotos_urls") or "").split() if u.startswith("https://")][:MAX_FOTOS]),
                "_caminhos": [f"{c['id'].strip()}/{nome_da_foto(u)}" for u in urls] if c.get("id", "").strip() else [],
                "_situacao": c.get("situacao", ""), "_preco_bndv": preco,
            })
    return carros


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    laudos = {}
    if "--laudos" in sys.argv:
        laudos = {k.upper().replace("-", ""): v for k, v in json.load(open(sys.argv[sys.argv.index("--laudos") + 1])).items() if v}
    chave = os.environ.get("SR")
    loja = None
    if chave:
        loja = api("GET", f"pa_lojas?select=id&slug=eq.{LOJA}", chave)[0]["id"]
        anteriores = api("GET", f"pa_veiculos?select=id,laudo_cautelar,anuncios,fotos&loja_id=eq.{loja}", chave)
        guardados = {(v["anuncios"] or {}).get("placa", "").replace("-", ""): v["laudo_cautelar"] for v in anteriores if v["laudo_cautelar"]}
        for placa, laudo in guardados.items():
            laudos.setdefault(placa, laudo)
        for certa, errada in APELIDOS.items():
            if errada in guardados:
                laudos.setdefault(certa, guardados[errada])
    carros = ler(sys.argv[1], laudos)
    sem_preco = [c["titulo"] for c in carros if c["preco"] is None]
    sem_km = [c["titulo"] for c in carros if c["km"] is None]
    sem_laudo = [c["titulo"] for c in carros if not c["laudo_cautelar"]]
    reprovados = [c["titulo"] for c in carros if (c["laudo_cautelar"] or "").upper().startswith("REPROV")]
    print(f"{len(carros)} veículos lidos do BNDV. Sem preço: {len(sem_preco)}. Sem km: {len(sem_km)}. Sem laudo: {len(sem_laudo)}. Reprovados: {len(reprovados)}.")
    if "--conferir" in sys.argv or not chave:
        for c in carros:
            print(f"  {c['anuncios']['placa']:8} {c['titulo'][:70]:70} | {c['preco'] or 'sem preço'} | {c['km'] or 'sem km'} km | {c['laudo_cautelar'] or 'sem laudo'}")
        if not chave and "--conferir" not in sys.argv:
            sys.exit("Falta a chave de serviço na variável SR (veja o uso no topo do arquivo).")
        return
    # trava: leitura que encolheu demais é erro de leitura, não venda em massa. Não troca nada (use --forcar se for real).
    atual = len(anteriores)
    if "--forcar" not in sys.argv and (len(carros) < 10 or (atual and len(carros) < 0.6 * atual)):
        print(f"RECUSADO: o BNDV trouxe {len(carros)} veículos e a Bia tem {atual}. O estoque da Bia ficou como estava.", file=sys.stderr)
        sys.exit(3)
    try:
        sincronizar_fotos(carros, chave)
    except Exception as e:
        # armazenamento fora do ar: cada carro fica com as fotos que já tinha (a troca do estoque não para por foto)
        print(f"Fotos não sincronizadas ({e}): ficam as do cadastro anterior.", file=sys.stderr)
        antes = {(v["anuncios"] or {}).get("bndv"): [f for f in (v.get("fotos") or []) if not f.startswith("http")] for v in anteriores}
        for c in carros:
            c["fotos"] = antes.get(c["anuncios"].get("bndv"), [])
    linhas = [{k: v for k, v in c.items() if not k.startswith("_")} | {"loja_id": loja} for c in carros]
    # grava o novo antes de apagar o antigo: se a gravação falhar, a Bia continua com o estoque de ontem
    gravados = api("POST", "pa_veiculos", chave, linhas)
    velhos = [v["id"] for v in anteriores]
    for i in range(0, len(velhos), 50):
        api("DELETE", f"pa_veiculos?id=in.({','.join(velhos[i:i + 50])})", chave)
    print(f"Estoque da Bia trocado pelo do BNDV: {len(gravados)} veículos.")
    try:
        limpar_fotos_vendidos(carros, chave)
    except Exception as e:
        print(f"Limpeza das fotos de carro vendido ficou para amanhã: {e}", file=sys.stderr)
    if sem_preco:
        print("Sem preço confirmado (a Bia diz que o consultor confirma):", "; ".join(sem_preco))
    if sem_laudo:
        print("Sem laudo conhecido:", "; ".join(sem_laudo))


if __name__ == "__main__":
    main()
