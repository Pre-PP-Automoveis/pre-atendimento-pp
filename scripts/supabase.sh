#!/usr/bin/env bash
# Supabase CLI com a conta dona do projeto deste repositório, sem trocar o login global da máquina
# (que continua publicando os outros projetos da casa). O token fica fora do git, só legível pelo usuário.
#   uso: scripts/supabase.sh db push | functions deploy pre-atendimento | secrets list ...
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${PA_SUPABASE_TOKEN_FILE:-$HOME/.config/$(basename "$RAIZ")/supabase-token}"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "Token não encontrado em $TOKEN_FILE." >&2
  echo "Gere em supabase.com/dashboard/account/tokens, logado na conta dona do projeto, e grave com:" >&2
  echo "  mkdir -p \"$(dirname "$TOKEN_FILE")\" && read -rs \"T?Token: \" && printf %s \"\$T\" > \"$TOKEN_FILE\" && chmod 600 \"$TOKEN_FILE\" && unset T" >&2
  exit 1
fi
cd "$RAIZ"
SUPABASE_ACCESS_TOKEN="$(cat "$TOKEN_FILE")" exec supabase "$@"
