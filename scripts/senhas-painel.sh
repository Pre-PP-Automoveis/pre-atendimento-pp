#!/usr/bin/env bash
# Cria a senha padrão de quem ainda não tem e grava usuário e senha em ~/.config/pre-atendimento-pp/acessos-painel.txt.
#   scripts/senhas-painel.sh            só quem ainda não tem senha
#   scripts/senhas-painel.sh --todas    senha nova para todo mundo (derruba as sessões abertas)
#   scripts/senhas-painel.sh Ryan       senha nova só para essa pessoa
# A senha padrão vale só para o primeiro acesso: o painel obriga a trocar. No banco fica só o hash (PBKDF2, o mesmo formato de acesso.ts). Mande cada acesso só para a pessoa dele, no privado,
# e apague o arquivo depois de entregar.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PAINEL="${PAINEL_URL:-https://pp-painel-leads.vercel.app}"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
SAIDA="${SAIDA_PAINEL:-$HOME/.config/pre-atendimento-pp/acessos-painel.txt}"
umask 077
mkdir -p "$(dirname "$SAIDA")"
SR="$SR" PAINEL="$PAINEL" SAIDA="$SAIDA" QUEM="${1:-}" python3 - <<'PY'
import hashlib, json, os, secrets, urllib.request, datetime
API = "https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"
SR, PAINEL, SAIDA, QUEM = os.environ["SR"], os.environ["PAINEL"], os.environ["SAIDA"], os.environ["QUEM"]
H = {"apikey": SR, "Authorization": "Bearer " + SR, "Content-Type": "application/json"}

def pedir(metodo, caminho, corpo=None):
    req = urllib.request.Request(API + caminho, method=metodo, headers=H, data=json.dumps(corpo).encode() if corpo is not None else None)
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else None

equipe = pedir("GET", "/pa_vendedores?select=id,nome,usuario,gerente,admin,no_rodizio,senha_hash,pa_lojas!inner(slug)&pa_lojas.slug=eq.pp-automoveis&ativo=eq.true&order=ordem")
if QUEM == "--todas": alvo = equipe
elif QUEM: alvo = [v for v in equipe if v["nome"].lower() == QUEM.lower()]
else: alvo = [v for v in equipe if not v["senha_hash"]]
if QUEM and QUEM != "--todas" and not alvo: raise SystemExit("Ninguém ativo com o nome " + QUEM)

linhas = []
for v in alvo:
    senha = "pp" + str(secrets.randbelow(1_000_000)).zfill(6)
    sal = secrets.token_hex(16)
    h = "pbkdf2$100000$%s$%s" % (sal, hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), 100000).hex())
    pedir("PATCH", "/pa_vendedores?id=eq." + v["id"], {"senha_hash": h, "trocar_senha": True, "falhas_login": 0, "bloqueado_ate": None})
    pedir("DELETE", "/pa_sessoes?vendedor_id=eq." + v["id"])
    papel = "administrador da Moza" if v.get("admin") else "gerente, vê a loja inteira" if v["gerente"] else ("no rodízio" if v["no_rodizio"] else "fora do rodízio")
    linhas.append("%s (%s)\n  usuário: %s\n  senha:   %s" % (v["nome"], papel, v["usuario"], senha))

agora = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")
with open(SAIDA, "w") as f:
    f.write("Painel de leads da Pedro Paulo Automóveis: %s\nAcessos gerados em %s. A senha vale só para o primeiro acesso: o painel pede uma nova na hora.\n\n" % (PAINEL, agora))
    f.write("\n\n".join(linhas) if linhas else "Ninguém sem senha. Use --todas ou o nome da pessoa para gerar de novo.")
    f.write("\n")
print("%d acesso(s) gravado(s) em %s" % (len(linhas), SAIDA))
PY
