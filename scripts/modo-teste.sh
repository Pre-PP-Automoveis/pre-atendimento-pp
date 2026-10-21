#!/usr/bin/env bash
# Liga, troca ou desliga o modo de teste da Bia na PP.
#   scripts/modo-teste.sh 11987654321 11912345678   só esses números falam com a Bia (o resto segue com o time)
#   scripts/modo-teste.sh desligar                 ninguém fala com a Bia (loja desligada, como antes do teste)
#   scripts/modo-teste.sh ligar-de-vez             a Bia atende todo mundo (fim do teste)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/chave-servico.sh")
[ $# -ge 1 ] || { sed -n 2,5p "$0"; exit 1; }
SR="$SR" python3 - "$@" <<'PY'
import json, os, re, sys, urllib.request
API = "https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1/pa_lojas?slug=eq.pp-automoveis"; SR = os.environ["SR"]
args = sys.argv[1:]
if args == ["desligar"]: corpo = {"ativo": False, "numeros_teste": None}
elif args == ["ligar-de-vez"]: corpo = {"ativo": True, "numeros_teste": None}
else:
    nums = []
    for a in args:
        d = re.sub(r"\D", "", a)
        d = d if d.startswith("55") else "55" + d
        if not re.fullmatch(r"55\d{10,11}", d): raise SystemExit("número inválido: " + a)
        nums.append(d)
    corpo = {"ativo": False, "numeros_teste": nums}
r = urllib.request.Request(API, method="PATCH", data=json.dumps(corpo).encode(),
    headers={"apikey": SR, "Authorization": "Bearer " + SR, "Content-Type": "application/json", "Prefer": "return=representation"})
with urllib.request.urlopen(r) as x: l = json.loads(x.read())[0]
print("ativo:", l["ativo"], "| números de teste:", l["numeros_teste"])
PY
