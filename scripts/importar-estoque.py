#!/usr/bin/env python3
"""Importa a planilha de estoque da Pedro Paulo (exportação em CSV, separada por marca) para pa_veiculos.

Uso:
  python3 scripts/importar-estoque.py "~/Downloads/ESTOQUE PP GARAGE - Pp Garage 37.csv" --conferir   # só mostra
  SR=$(scripts/supabase.sh projects api-keys --project-ref qdzuwnqejtjbtcysteip | awk '/service_role/{print $NF}') \
    python3 scripts/importar-estoque.py "<arquivo>.csv"                                                  # grava

Troca o estoque inteiro da loja: a planilha do dia é a verdade. Conversas antigas que apontavam para um carro
que saiu ficam com veiculo_id vazio (on delete set null).
O resultado do laudo (coluna OBSERVAÇÕES) e a placa ficam guardados, mas o robô não vê nenhum dos dois:
decisão do Kauan em 05/10/2026, procedência e estado do carro são conversa do consultor.
"""
import csv, json, os, re, sys, urllib.request

PROJETO = "https://qdzuwnqejtjbtcysteip.supabase.co"
LOJA = "pp-automoveis"
MARCAS_SECAO = {"VOLKS": "Volkswagen", "FORD": "Ford", "GM": "Chevrolet", "FIAT": "Fiat", "IMPORTADOS": None}
MARCAS = {"NISSAN": "Nissan", "HONDA": "Honda", "HYUNDAI": "Hyundai", "JEEP": "Jeep", "PEUGEOT": "Peugeot",
          "TOYOTA": "Toyota", "BMW": "BMW", "VOLVO": "Volvo", "RENAULT": "Renault", "CITROEN": "Citroën",
          "MITSUBISHI": "Mitsubishi", "KIA": "Kia", "CHERY": "Chery", "CAOA CHERY": "Caoa Chery"}


def ano(txt):
    """17/17 vira 2017/2017; 9/10 vira 2009/2010"""
    partes = [p.strip() for p in txt.split("/") if p.strip()]
    def cheio(p):
        n = int(p)
        return n if n > 1900 else (2000 + n if n < 70 else 1900 + n)
    return "/".join(str(cheio(p)) for p in partes)


def numero(txt):
    d = re.sub(r"[^\d,]", "", txt or "").split(",")[0]
    return int(d) if d else None


COMBUSTIVEL = {"GAS": "gasolina", "GASOLINA": "gasolina", "GAS/ELETRICO": "híbrido", "FLEX": "flex", "DIESEL": "diesel"}


def ler(caminho):
    """um carro por placa: se a planilha repete a placa em duas marcas, vale a última (a seção certa vem depois)"""
    carros, marca_secao = {}, None
    with open(os.path.expanduser(caminho), encoding="utf-8-sig") as f:
        for linha in csv.reader(f):
            c = [x.strip() for x in linha] + [""] * 9
            if c[0].upper() in MARCAS_SECAO and not c[1]:
                marca_secao = MARCAS_SECAO[c[0].upper()]
                continue
            if c[0].upper() == "MODELO" or not c[0] or not re.match(r"^\d{1,4}/\d{1,4}$", c[1]):
                continue  # cabeçalho, data, linha vazia
            modelo, marca = re.sub(r"^I\s*/\s*", "", c[0]), marca_secao
            if " / " in modelo or "/" in modelo.split()[0]:
                m, modelo = [x.strip() for x in modelo.split("/", 1)]
                marca = MARCAS.get(m.upper(), m.title())
            elif modelo.split()[0].upper() in MARCAS:
                m, modelo = modelo.split(None, 1)
                marca = MARCAS[m.upper()]
            placa = c[3].upper()
            comb = COMBUSTIVEL.get(c[6].upper(), c[6].lower())
            partes = [marca, modelo, ano(c[1]), comb]
            carros[placa or f"sem-placa-{len(carros)}"] = {
                "titulo": " ".join(p for p in partes if p),
                "disponivel": True,
                "preco": numero(c[7]),
                "km": numero(c[4]),
                "laudo_cautelar": c[5] or None,  # guardado para o consultor, fora do prompt
                "observacoes": f"cor {c[2].lower()}" if c[2] else None,
                "anuncios": {"placa": placa} if placa else {},
            }
    return list(carros.values())


def api(metodo, caminho, chave, corpo=None):
    req = urllib.request.Request(f"{PROJETO}/rest/v1/{caminho}", method=metodo,
                                 data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"apikey": chave, "Authorization": f"Bearer {chave}",
                                          "Content-Type": "application/json", "Prefer": "return=representation"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or "null")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    carros = ler(sys.argv[1])
    sem_preco = [c["titulo"] for c in carros if c["preco"] is None]
    sem_km = [c["titulo"] for c in carros if c["km"] is None]
    print(f"{len(carros)} carros lidos. Sem preço: {len(sem_preco)}. Sem km: {len(sem_km)}.")
    if "--conferir" in sys.argv:
        for c in carros:
            print(f"  {c['titulo']} | {c['preco'] or 'sem preço'} | {c['km'] or 'sem km'} km")
        return
    chave = os.environ.get("SR")
    if not chave:
        sys.exit("Falta a chave de serviço na variável SR (veja o uso no topo do arquivo).")
    loja = api("GET", f"pa_lojas?select=id&slug=eq.{LOJA}", chave)[0]["id"]
    api("DELETE", f"pa_veiculos?loja_id=eq.{loja}", chave)
    gravados = api("POST", "pa_veiculos", chave, [{**c, "loja_id": loja} for c in carros])
    print(f"Estoque da loja trocado: {len(gravados)} carros gravados.")
    if sem_preco:
        print("Sem preço (o robô diz que o consultor confirma):", "; ".join(sem_preco))


if __name__ == "__main__":
    main()
