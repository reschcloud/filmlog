#!/usr/bin/env bash
# Richtet Filmlog als systemd-Dienst ein, der beim Booten automatisch startet.
#
# Aufruf (im filmlog-Verzeichnis oder von irgendwo aus):
#   sudo bash deploy/install-service.sh [venv-pfad] [benutzer]
#
# Ohne Argumente wird ein venv-Ordner "venv" direkt im Projektverzeichnis
# und der aktuell aufrufende Benutzer angenommen.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${1:-$APP_DIR/venv}"
SERVICE_USER="${2:-${SUDO_USER:-$(whoami)}}"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Kein venv mit Python gefunden unter: $VENV_DIR"
  echo "Aufruf: sudo bash deploy/install-service.sh /pfad/zum/venv [benutzer]"
  exit 1
fi

echo "Projektverzeichnis: $APP_DIR"
echo "venv:               $VENV_DIR"
echo "Dienst-Benutzer:    $SERVICE_USER"

sed -e "s#__APP_DIR__#$APP_DIR#g" \
    -e "s#__VENV_DIR__#$VENV_DIR#g" \
    -e "s#__USER__#$SERVICE_USER#g" \
    "$APP_DIR/deploy/filmlog.service" > /etc/systemd/system/filmlog.service

systemctl daemon-reload
systemctl enable --now filmlog.service

echo
echo "Fertig. Status pruefen mit:"
echo "  systemctl status filmlog"
echo "Logs ansehen mit:"
echo "  journalctl -u filmlog -f"
