#!/usr/bin/env bash
# Liga a transcrição de áudio da Bia (23/11/2026). A API da Claude não ouve áudio: o áudio do cliente vai para a OpenAI
# (padrão) ou para o Gemini e volta como texto. Rode no seu terminal; a chave é digitada sem aparecer na tela e vai
# direto para os segredos da função no Supabase, sem ficar em arquivo nem no histórico.
#   scripts/chave-transcricao.sh            OpenAI (OPENAI_API_KEY)
#   scripts/chave-transcricao.sh gemini     Gemini (GEMINI_API_KEY)
# Use chave de conta paga: no plano grátis o provedor pode usar o áudio dos clientes para treinar modelo (LGPD).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
NOME=OPENAI_API_KEY; [ "${1:-}" = "gemini" ] && NOME=GEMINI_API_KEY
read -r -s -p "Cole a chave ($NOME) e tecle Enter: " CHAVE; echo
[ -n "$CHAVE" ] || { echo "Nada digitado. Nada mudou."; exit 1; }
printf '%s=%s\n' "$NOME" "$CHAVE" > "${TMPDIR:-/tmp}/pa-chave.env"
trap 'rm -f "${TMPDIR:-/tmp}/pa-chave.env"' EXIT
"$RAIZ/scripts/supabase.sh" secrets set --env-file "${TMPDIR:-/tmp}/pa-chave.env" >/dev/null
echo "Pronto: $NOME gravada. A Bia passa a ouvir os áudios dos clientes na próxima mensagem."
