#!/usr/bin/env bash
# Troca a credencial do WhatsApp da PP (a do cadastro incorporado vence em 60 dias) pelo token permanente de um usuário
# do sistema criado no Gerenciador de Negócios da própria PP. O token é digitado sem aparecer na tela e vai direto
# para pa_credenciais; não fica em arquivo nem no histórico do terminal.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
read -rs "?Token permanente do usuário do sistema da PP: " TOKEN; echo
[ -n "$TOKEN" ] || { echo "Nenhum token digitado."; exit 1; }
SR="$SR" TOKEN="$TOKEN" python3 - <<'PY'
import json, os, urllib.request, datetime
API = "https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"; SR = os.environ["SR"]; TOKEN = os.environ["TOKEN"]
H = {"apikey": SR, "Authorization": "Bearer " + SR, "Content-Type": "application/json"}
def req(m, c, corpo=None):
    r = urllib.request.Request(API + c, method=m, headers=H, data=json.dumps(corpo).encode() if corpo is not None else None)
    with urllib.request.urlopen(r) as x:
        t = x.read().decode(); return json.loads(t) if t else None
loja = req("GET", "/pa_lojas?select=id,phone_number_id&slug=eq.pp-automoveis")[0]
if not loja["phone_number_id"]:
    raise SystemExit("A loja ainda não está conectada. Faça a conexão pela página antes de trocar o token.")
# confere na Meta que o token enxerga o número da loja antes de gravar
g = urllib.request.Request("https://graph.facebook.com/v25.0/%s?fields=display_phone_number" % loja["phone_number_id"], headers={"Authorization": "Bearer " + TOKEN})
try:
    with urllib.request.urlopen(g) as x: numero = json.loads(x.read().decode()).get("display_phone_number")
except urllib.error.HTTPError as e:
    raise SystemExit("A Meta recusou esse token para o número da loja: " + e.read().decode()[:200])
req("PATCH", "/pa_credenciais?loja_id=eq." + loja["id"], {"token_whatsapp": TOKEN, "atualizado_em": datetime.datetime.now(datetime.timezone.utc).isoformat()})
print("Token permanente gravado. Número conferido na Meta:", numero)
PY
unset TOKEN
