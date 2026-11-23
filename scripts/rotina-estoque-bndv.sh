#!/bin/bash
# Rotina diária das 9h: o estoque da Bia vira o BNDV da PP GARAGE 37 (pedido do Kauan, 23/11/2026).
# Roda pelo launchd no Mac do Kauan (br.com.mozabr.pp-estoque-bndv, instalado por scripts/instalar-rotina-estoque.sh)
# e também ao ligar o Mac, para não perder o dia se ele estava desligado às 9h.
#
# Nunca deixa a Bia sem estoque: o leitor só grava leitura completa, e o importador recusa leitura que encolheu
# demais. Se falhar (sessão do BNDV caída, Chrome fechado, internet), avisa na hora (notificação no Mac e no
# celular de quem é administrador, pelo painel) e tenta de novo a cada 15 min, até 5 vezes.
# Sessão caída: se o Kauan guardou o acesso no Chaves (serviço pre-atendimento-pp-bndv), refaz o login sozinho.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ABRIR="${BNDV_ABRIR_CHROME:-$HOME/Documents/Next-Assessoria/Claude Code/next-cerebro/clientes/pp-automoveis/bndv/abrir-chrome.sh}"
PASTA="$HOME/.config/pre-atendimento-pp/estoque"; mkdir -p "$PASTA"
LOG="$PASTA/rotina.log"
TENTATIVAS="${TENTATIVAS:-5}"; ESPERA="${ESPERA:-900}"
TRAVA="$PASTA/.rotina-rodando"

log() { echo "$(date '+%d/%m %H:%M:%S') $*" >> "$LOG"; }

# uma rotina por vez (a das 9h e a do login do Mac podem se encontrar)
if [ -f "$TRAVA" ] && kill -0 "$(cat "$TRAVA")" 2>/dev/null; then log "outra rotina já está rodando"; exit 0; fi
echo $$ > "$TRAVA"; trap 'rm -f "$TRAVA"' EXIT

# já atualizou hoje: a do login do Mac não repete a das 9h
if [ "${1:-}" != "--agora" ] && [ -f "$PASTA/ultima-ok" ] && [ "$(cat "$PASTA/ultima-ok")" = "$(date +%F)" ]; then exit 0; fi

relatar() {  # ok carros erro final avisar
  local sr; sr="$("$RAIZ/scripts/chave-servico.sh" 2>/dev/null)" || { log "sem chave de serviço para relatar"; return; }
  curl -s --max-time 30 -X POST "https://qdzuwnqejtjbtcysteip.supabase.co/functions/v1/pre-atendimento?rotina_estoque" \
    -H "Authorization: Bearer $sr" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"ok": sys.argv[1]=="1", "carros": int(sys.argv[2]) if sys.argv[2] else None, "erro": sys.argv[3], "final": sys.argv[4]=="1", "avisar": sys.argv[5]=="1"}))' "$1" "$2" "$3" "$4" "$5")" >/dev/null || log "não consegui relatar ao painel"
}
avisar_mac() { osascript -e "display notification \"$1\" with title \"Estoque da Bia\" sound name \"Basso\"" >/dev/null 2>&1 || true; }

entrar_sozinho() {
  local cnpj email senha
  cnpj="$(security find-generic-password -s pre-atendimento-pp-bndv -a cnpj -w 2>/dev/null)" || return 1
  email="$(security find-generic-password -s pre-atendimento-pp-bndv -a email -w 2>/dev/null)" || return 1
  senha="$(security find-generic-password -s pre-atendimento-pp-bndv -a senha -w 2>/dev/null)" || return 1
  BNDV_CNPJ="$cnpj" BNDV_EMAIL="$email" BNDV_SENHA="$senha" PW_DIR="$HOME/.cache/pre-atendimento-pp/pw/node_modules" \
    node "$RAIZ/scripts/entrar-bndv.mjs" >> "$LOG" 2>&1
}

avisou=0
for i in $(seq 1 "$TENTATIVAS"); do
  bash "$ABRIR" >/dev/null 2>&1; sleep 6
  saida="$("$RAIZ/scripts/atualizar-estoque-bndv.sh" 2>&1)"; cod=$?
  echo "$saida" | sed "s/^/   /" >> "$LOG"
  # sessão caída: refaz o login pelo Chaves e lê de novo na hora, sem gastar tentativa
  if [ $cod -ne 0 ] && echo "$saida" | grep -q "sessão do BNDV caiu" && entrar_sozinho; then
    log "login refeito pelo Chaves"
    saida="$("$RAIZ/scripts/atualizar-estoque-bndv.sh" 2>&1)"; cod=$?
    echo "$saida" | sed "s/^/   /" >> "$LOG"
  fi
  if [ $cod -eq 0 ]; then
    carros="$(echo "$saida" | sed -n 's/.*trocado pelo do BNDV: \([0-9]*\).*/\1/p' | tail -1)"
    log "ok: $carros veículos (tentativa $i)"
    date +%F > "$PASTA/ultima-ok"
    relatar 1 "$carros" "" 0 0
    [ $avisou -eq 1 ] && avisar_mac "Resolvido: estoque atualizado com $carros veículos."
    ls -1t "$PASTA"/estoque-bndv-*.csv 2>/dev/null | tail -n +31 | while read -r velho; do rm -f "$velho" "$velho.laudos.json"; done
    exit 0
  fi
  if echo "$saida" | grep -q "sessão do BNDV caiu"; then
    motivo="A sessão do BNDV caiu e o login pelo Chaves não passou (senha trocada?). Entre no BNDV na janela do Chrome do agente."
  elif [ $cod -eq 3 ]; then motivo="O BNDV trouxe carros de menos e o estoque da Bia ficou como estava. Confira no BNDV."
  elif echo "$saida" | grep -q "Chrome do agente fechado"; then motivo="O Chrome do agente não abriu."
  else motivo="$(echo "$saida" | grep -v '^\s*$' | tail -1 | cut -c1-200)"; fi
  log "falhou (tentativa $i, código $cod): $motivo"
  if [ $avisou -eq 0 ]; then avisar_mac "$motivo"; relatar 0 "" "$motivo" 0 1; avisou=1; fi
  [ "$i" -lt "$TENTATIVAS" ] && sleep "$ESPERA"
done
log "desisti por hoje: $motivo"
relatar 0 "" "Não atualizou hoje: $motivo" 1 1
avisar_mac "Não atualizou hoje: $motivo"
exit 1
