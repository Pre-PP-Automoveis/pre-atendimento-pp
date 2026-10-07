#!/usr/bin/env bash
# Leads de exemplo no painel da PP, para demonstrar ao time sem cliente de verdade.
#   scripts/leads-exemplo.sh          apaga os exemplos anteriores e cria 3 novos, com o relógio zerado agora
#   scripts/leads-exemplo.sh apagar   tira todos os exemplos do painel
# Os exemplos têm "(exemplo)" no nome e telefone com DDD 00, que não existe: "Abrir conversa" não cai em ninguém.
# Com a loja desligada (antes do robô entrar no ar) o repasse automático não roda: os exemplos ficam parados.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
SR="$SR" ACAO="${1:-criar}" python3 - <<'PY'
import json, os, urllib.request, datetime
API = "https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"; SR = os.environ["SR"]
H = {"apikey": SR, "Authorization": "Bearer " + SR, "Content-Type": "application/json", "Prefer": "return=representation"}
def req(m, c, corpo=None):
    r = urllib.request.Request(API + c, method=m, headers=H, data=json.dumps(corpo).encode() if corpo is not None else None)
    with urllib.request.urlopen(r) as x:
        t = x.read().decode(); return json.loads(t) if t else None
FONES = ["5500000000901", "5500000000902", "5500000000903"]
loja = req("GET", "/pa_lojas?select=id,ativo&slug=eq.pp-automoveis")[0]
antigos = req("GET", "/pa_conversas?select=id&lead_wa=in.(%s)" % ",".join(FONES))
for c in antigos:
    req("DELETE", "/pa_mensagens?conversa_id=eq." + c["id"]); req("DELETE", "/pa_conversas?id=eq." + c["id"])
req("DELETE", "/pa_ignorados?wa=in.(%s)" % ",".join(FONES))
if os.environ["ACAO"] == "apagar":
    print("exemplos apagados:", len(antigos)); raise SystemExit
if loja["ativo"]:
    raise SystemExit("A loja já está com o robô ligado: não crio exemplos para não misturar com lead de verdade.")
v = {x["nome"]: x["id"] for x in req("GET", "/pa_vendedores?select=id,nome&admin=eq.false")}
agora = datetime.datetime.now(datetime.timezone.utc)
ha = lambda m: (agora - datetime.timedelta(minutes=m)).isoformat()
AVISO = "Este é o atendimento automático da Pedro Paulo Automóveis. Seus dados são usados só para o atendimento comercial da loja, e se preferir falar com uma pessoa do time é só pedir."
exemplos = [
  # 1. lead pronto, na vez do Rayan, com o relógio do repasse correndo
  ({"lead_wa": FONES[0], "lead_nome": "Juliana Prado (exemplo)", "origem": "Mercado Livre", "estado": "encaminhada", "vendedor_id": v["Rayan"],
    "tentativas": [v["Rayan"]], "iniciada_em": ha(9), "respondido_robo_em": ha(9), "avisado_em": ha(2), "encaminhado_em": ha(2), "ultima_msg_em": ha(2),
    "origem_detalhe": {"veiculo_texto": "Hyundai I30 2.0 2010/2011"},
    "resumo": {"motivo": "qualificado", "consultor": "nenhum", "veiculo": "Hyundai I30 2.0 2010/2011", "troca": "Ka 2014 1.6, 140 mil km, ainda financiado",
               "pagamento": "financiamento", "visita": "convidado, sem resposta", "pendencias": "simular o financiamento e avaliar o Ka",
               "resumo": "Quer o I30, tem um Ka 2014 financiado na troca e quer financiar o restante."}},
   [("lead", "Pega na troca veículo tb?"),
    ("robo", AVISO + "\n\nOi, Juliana! Aceitamos troca sim. Qual é o seu carro, o ano e quantos km ele tem?"),
    ("lead", "um ka 2014 1.6 com 140 mil, ainda tá financiado"),
    ("robo", "A loja quita o financiamento do seu Ka e o que sobrar do valor entra na compra do I30, essa conta o consultor fecha com você. Quer passar na loja para ver o I30 de perto? Rua Juquiá, 275, Paraíso, Santo André, SP, CEP 09190-675."),
    ("lead", "financiamento"),
    ("robo", "Um consultor continua com você aqui mesmo em instantes."),
    ("sistema", "encaminhado para Rayan (qualificado)")]),
  # 2. cliente que pediu o Pedro pelo nome: vai direto para ele, sem repasse
  ({"lead_wa": FONES[1], "lead_nome": "Sérgio Lima (exemplo)", "origem": "Não identificado", "estado": "encaminhada", "vendedor_id": v["Pedro"],
    "tentativas": [v["Pedro"]], "fixado_por": "lead", "iniciada_em": ha(5), "respondido_robo_em": ha(5), "avisado_em": ha(5), "encaminhado_em": ha(5), "ultima_msg_em": ha(5),
    "resumo": {"motivo": "pediu_pessoa", "consultor": "Pedro", "veiculo": "Jeep Compass", "troca": "não perguntado", "pagamento": "não perguntado",
               "visita": "não convidado", "pendencias": "retomar a conversa da semana passada sobre o Compass",
               "resumo": "Cliente do Pedro, chamou ele pelo nome para continuar a conversa sobre um Compass."}},
   [("lead", "Oi Pedro, tudo bem? Sobre aquele Compass que a gente falou semana passada"),
    ("robo", AVISO + "\n\nOi, Sérgio! Vou te deixar direto com o Pedro, que continua essa conversa com você aqui mesmo daqui a pouco."),
    ("sistema", "encaminhado para Pedro (pediu_pessoa), a pedido do cliente")]),
  # 3. ainda com o robô: dá para mostrar o "Puxar para mim"
  ({"lead_wa": FONES[2], "lead_nome": "Gustavo Ramos (exemplo)", "origem": "WebMotors", "estado": "robo", "iniciada_em": ha(3), "respondido_robo_em": ha(3), "ultima_msg_em": ha(1),
    "origem_detalhe": {"veiculo_texto": "Chevrolet Onix 1.4 LT 2014/2015"}},
   [("lead", "boa tarde, vi o onix de vocês"),
    ("robo", AVISO + "\n\nBoa tarde, Gustavo! O Onix 1.4 LT 2014/2015 está disponível, por R$ 49.900, com 118.423 km. É esse que você viu?"),
    ("lead", "esse mesmo. tem multimídia?"),
    ("robo", "Esse detalhe o consultor confirma certinho com você. Quer passar na loja para ver o Onix de perto? O endereço é Rua Juquiá, 275, Paraíso, Santo André, SP, CEP 09190-675.")]),
]
for conversa, falas in exemplos:
    c = req("POST", "/pa_conversas", {"loja_id": loja["id"], **conversa})[0]
    req("POST", "/pa_mensagens", [{"conversa_id": c["id"], "autor": a, "texto": t} for a, t in falas])
print("3 leads de exemplo no painel: Juliana (na vez do Rayan), Sérgio (pediu o Pedro) e Gustavo (com o robô).")
PY
