#!/usr/bin/env bash
# Atualiza o estoque da Bia com o BNDV da PP GARAGE 37, num comando só (23/11/2026).
#   scripts/atualizar-estoque-bndv.sh             lê o BNDV, mostra e grava
#   scripts/atualizar-estoque-bndv.sh --conferir  lê o BNDV e só mostra
# Precisa do Chrome do agente aberto e logado no BNDV (next-cerebro/clientes/pp-automoveis/bndv/abrir-chrome.sh).
# O laudo cautelar não existe no BNDV: o importador guarda o do cadastro anterior, pela placa.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
# playwright-core numa pasta própria, fora do repositório (só a primeira vez baixa)
PW_DIR="${PW_DIR:-$HOME/.cache/pre-atendimento-pp/pw}"
[ -d "$PW_DIR/node_modules/playwright-core" ] || npm install --silent --no-audit --no-fund --prefix "$PW_DIR" playwright-core@1.48.2 >/dev/null
PASTA="${ESTOQUE_PASTA:-$HOME/.config/pre-atendimento-pp/estoque}"
mkdir -p "$PASTA"
CSV="$PASTA/estoque-bndv-$(date +%Y-%m-%d-%H%M).csv"

PW_DIR="$PW_DIR/node_modules" node "$RAIZ/scripts/ler-estoque-bndv.mjs" "$CSV"
LAUDOS=(); [ -s "$CSV.laudos.json" ] && LAUDOS=(--laudos "$CSV.laudos.json")
if [ "${1:-}" = "--conferir" ]; then
  python3 "$RAIZ/scripts/importar-estoque-bndv.py" "$CSV" --conferir ${LAUDOS[@]+"${LAUDOS[@]}"}
else
  SR="$("$RAIZ/scripts/chave-servico.sh")" python3 "$RAIZ/scripts/importar-estoque-bndv.py" "$CSV" ${LAUDOS[@]+"${LAUDOS[@]}"} "$@"
fi
