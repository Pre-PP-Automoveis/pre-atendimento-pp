#!/usr/bin/env bash
# Gera os links do painel de leads (gerente e cada consultor) e grava em ~/.config/pre-atendimento-pp/links-painel.txt.
# Os links dão acesso aos leads da loja: mande cada um só para a pessoa dele, por canal privado.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
SR=$("$RAIZ/scripts/supabase.sh" projects api-keys --project-ref qdzuwnqejtjbtcysteip 2>/dev/null | awk '/service_role/{print $NF}')
API="https://qdzuwnqejtjbtcysteip.supabase.co/rest/v1"
SAIDA="$HOME/.config/pre-atendimento-pp/links-painel.txt"
umask 077
{
  echo "Painel de leads da Pedro Paulo Automóveis, gerado em $(date '+%d/%m/%Y %H:%M')"
  curl -s "$API/pa_lojas?select=nome,gerente_nome,token_painel_gerente&slug=eq.pp-automoveis" -H "apikey: $SR" -H "Authorization: Bearer $SR" |
    python3 -c 'import sys,json;[print(f"\nGerente ({l.get(\"gerente_nome\") or \"definir nome\"}): https://www.mozabr.com.br/painel-leads?t={l[\"token_painel_gerente\"]}") for l in json.load(sys.stdin)]'
  curl -s "$API/pa_vendedores?select=nome,ativo,token_painel,pa_lojas!inner(slug)&pa_lojas.slug=eq.pp-automoveis&order=ordem" -H "apikey: $SR" -H "Authorization: Bearer $SR" |
    python3 -c 'import sys,json;v=json.load(sys.stdin);print("\nConsultores:" if v else "\nNenhum consultor cadastrado ainda.");[print(f"  {x[\"nome\"]}{\"\" if x[\"ativo\"] else \" (fora do rodízio)\"}: https://www.mozabr.com.br/painel-leads?t={x[\"token_painel\"]}") for x in v]'
} > "$SAIDA"
echo "Links gravados em $SAIDA"
