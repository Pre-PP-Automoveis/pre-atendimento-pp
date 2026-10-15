#!/usr/bin/env bash
# Liga o número próprio da Bia (cadastrado no app PP37 Atendimento, na conta empresarial da PP) ao pré-atendimento.
# É um chip novo, só da Bia, que vai nos portais e nos anúncios (Kauan, 15/10/2026). Os números do time, como o
# (11) 96606-3690, ficam no WhatsApp Business e nunca vão para a API: isso tiraria o número do aplicativo.
# Não usa o cadastro incorporado, que a Meta só libera para provedor aprovado.
#   scripts/ligar-numero-bia.sh 11912345678
# Pede, sem mostrar na tela: o token permanente do usuário do sistema da PP e o PIN de 6 dígitos do número.
# Faz: acha o número na conta, ativa na API (register) se preciso, assina o app nos avisos da conta e grava no banco.
# A loja continua desligada (ativo = false) até o teste com o time.
set -euo pipefail
[ $# -eq 1 ] || { echo "uso: scripts/ligar-numero-bia.sh <número da Bia com DDD, só dígitos>"; exit 1; }
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
read -rs "?Token permanente do usuário do sistema da PP: " TOKEN; echo
read -rs "?PIN de 6 dígitos do número da Bia (crie um, se for o primeiro registro): " PIN; echo
SR="$SR" TOKEN="$TOKEN" PIN="$PIN" NUMERO="$1" python3 - <<'PY'
import json, os, re, urllib.request, urllib.error, datetime
API = "https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"; GRAPH = "https://graph.facebook.com/v25.0"
SR, TOKEN, PIN = os.environ["SR"], os.environ["TOKEN"], os.environ["PIN"]
NEGOCIO = "2037840740293508"  # Pp Garage 37
digitos = re.sub(r"\D", "", os.environ["NUMERO"]); digitos = digitos if digitos.startswith("55") else "55" + digitos
def graph(caminho, metodo="GET", corpo=None):
    r = urllib.request.Request(GRAPH + "/" + caminho, method=metodo, headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
                               data=json.dumps(corpo).encode() if corpo is not None else None)
    try:
        with urllib.request.urlopen(r) as x: return json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit("Meta recusou %s: %s" % (caminho.split("?")[0], e.read().decode()[:300]))
def banco(metodo, caminho, corpo=None):
    r = urllib.request.Request(API + caminho, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={"apikey": SR, "Authorization": "Bearer " + SR, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"})
    with urllib.request.urlopen(r) as x:
        t = x.read().decode(); return json.loads(t) if t else None
achado = None
for conta in graph(NEGOCIO + "/owned_whatsapp_business_accounts?fields=id,name").get("data", []):
    for n in graph(conta["id"] + "/phone_numbers?fields=id,display_phone_number,verified_name,status,platform_type,code_verification_status").get("data", []):
        if re.sub(r"\D", "", n.get("display_phone_number", "")) == digitos:
            achado = (conta, n)
if not achado: raise SystemExit("Não achei o número %s nas contas de WhatsApp da Pp Garage 37. Ele foi cadastrado no app PP37 Atendimento?" % digitos)
conta, n = achado
if digitos.endswith("966063690"): raise SystemExit("Esse é o número do time (WhatsApp Business). A Bia usa o chip novo.")
print("Conta %s, número %s (%s), status %s, plataforma %s" % (conta["id"], n["display_phone_number"], n.get("verified_name"), n.get("status"), n.get("platform_type")))
if n.get("platform_type") != "CLOUD_API" or n.get("status") not in ("CONNECTED",):
    if not re.fullmatch(r"\d{6}", PIN): raise SystemExit("O PIN precisa ter 6 dígitos.")
    graph(n["id"] + "/register", "POST", {"messaging_product": "whatsapp", "pin": PIN})
    print("Número ativado na API.")
graph(conta["id"] + "/subscribed_apps", "POST")
print("App assinado nos avisos da conta.")
loja = banco("GET", "/pa_lojas?select=id&slug=eq.pp-automoveis")[0]
agora = datetime.datetime.now(datetime.timezone.utc).isoformat()
banco("POST", "/pa_credenciais", {"loja_id": loja["id"], "token_whatsapp": TOKEN, "atualizado_em": agora})
banco("PATCH", "/pa_lojas?id=eq." + loja["id"], {"waba_id": conta["id"], "phone_number_id": n["id"], "numero_exibido": n["display_phone_number"], "ligada_em": agora, "convite_onboarding": None})
print("Gravado. Número da Bia: %s. A loja segue desligada até o teste com o time." % n["display_phone_number"])
PY
unset TOKEN PIN
