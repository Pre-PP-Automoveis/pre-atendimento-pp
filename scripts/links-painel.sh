#!/usr/bin/env bash
# Gera o link do painel de leads de cada pessoa do time e grava em ~/.config/pre-atendimento-pp/links-painel.txt.
# O link do gerente abre a visão da loja inteira, com os controles. Os links dão acesso aos leads da loja:
# mande cada um só para a pessoa dele, por canal privado.
set -euo pipefail
# endereço do projeto do painel na Vercel (pasta painel/ deste repositório)
PAINEL="${PAINEL_URL:-https://pp-painel-leads.vercel.app}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
API="https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"
SAIDA="$HOME/.config/pre-atendimento-pp/links-painel.txt"
umask 077
mkdir -p "$(dirname "$SAIDA")"
{
  echo "Painel de leads da Pedro Paulo Automóveis, gerado em $(date '+%d/%m/%Y %H:%M')"
  curl -s "$API/pa_vendedores?select=nome,ativo,no_rodizio,gerente,token_painel,pa_lojas!inner(slug)&pa_lojas.slug=eq.pp-automoveis&ativo=eq.true&order=ordem" -H "apikey: $SR" -H "Authorization: Bearer $SR" |
    PAINEL="$PAINEL" python3 -c '
import json, os, sys
painel = os.environ["PAINEL"]
v = json.load(sys.stdin)
if not v: print("\nNinguém cadastrado ainda.")
for x in v:
    papel = "gerente, vê a loja inteira" if x["gerente"] else ("no rodízio" if x["no_rodizio"] else "fora do rodízio")
    print("\n" + x["nome"] + " (" + papel + "):\n  " + painel + "/?t=" + x["token_painel"])'
} > "$SAIDA"
echo "Links gravados em $SAIDA"
