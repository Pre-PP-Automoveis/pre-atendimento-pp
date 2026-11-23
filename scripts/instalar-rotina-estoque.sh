#!/bin/bash
# Instala (ou reinstala) a rotina diária do estoque da Bia no Mac: todo dia às 9h, e ao ligar o Mac se ele estava
# desligado às 9h. O macOS não deixa programa agendado ler a pasta Documentos, então os scripts da rotina são
# copiados para ~/.local/share/pre-atendimento-pp e o agendamento roda de lá: depois de mudar qualquer um deles
# no repositório, rode este instalador de novo.
# Para tirar: launchctl bootout gui/$(id -u)/br.com.mozabr.pp-estoque-bndv
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
BNDV="$HOME/Documents/Next-Assessoria/Claude Code/next-cerebro/clientes/pp-automoveis/bndv"
DEST="$HOME/.local/share/pre-atendimento-pp"
ROTULO="br.com.mozabr.pp-estoque-bndv"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
LOGS="$HOME/.config/pre-atendimento-pp/estoque"
mkdir -p "$LOGS" "$(dirname "$PLIST")" "$DEST/scripts" "$DEST/bndv"
for f in rotina-estoque-bndv.sh atualizar-estoque-bndv.sh ler-estoque-bndv.mjs importar-estoque-bndv.py entrar-bndv.mjs chave-servico.sh supabase.sh; do
  cp "$RAIZ/scripts/$f" "$DEST/scripts/$f"
done
cp "$BNDV/abrir-chrome.sh" "$DEST/bndv/abrir-chrome.sh"
chmod +x "$DEST"/scripts/*.sh "$DEST/bndv/abrir-chrome.sh"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DEST/scripts/rotina-estoque-bndv.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>BNDV_ABRIR_CHROME</key><string>$DEST/bndv/abrir-chrome.sh</string>
    <key>PA_SUPABASE_TOKEN_FILE</key><string>$HOME/.config/pre-atendimento-pp/supabase-token</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/launchd.log</string>
  <key>StandardErrorPath</key><string>$LOGS/launchd.log</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$ROTULO" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Rotina instalada: todo dia às 9h (e ao ligar o Mac). Scripts em $DEST. Log em $LOGS/rotina.log"
