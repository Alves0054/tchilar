#!/usr/bin/env bash
# Alerta quando a Tchilar (ou a base de dados) deixa de responder. Corre a cada 5 minutos pelo cron:
#   */5 * * * * /opt/tchilar/deploy/healthcheck.sh
#
# Envia o aviso para ALERT_WEBHOOK_URL. A forma mais simples é o ntfy (grátis, app para Android/iPhone):
#   1. instala a app "ntfy" no telemóvel e subscreve um tópico com um nome difícil, ex.: tchilar-alertas-x7k2q9
#   2. no .env: ALERT_WEBHOOK_URL=https://ntfy.sh/tchilar-alertas-x7k2q9
# Só avisa quando o estado muda (cai / volta), para não encher o telemóvel de mensagens.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$APP_DIR/.env" ]; then set -a; . "$APP_DIR/.env"; set +a; fi

URL="${HEALTHCHECK_URL:-http://127.0.0.1:${PORT:-4000}/api/health/ready}"
STATE_FILE="${HEALTHCHECK_STATE:-/tmp/tchilar-health.state}"
previous="$(cat "$STATE_FILE" 2>/dev/null || echo up)"

if curl -fsS -m 10 "$URL" >/dev/null 2>&1; then current=up; else current=down; fi

if [ "$current" != "$previous" ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  if [ "$current" = down ]; then
    message="Tchilar em baixo: $URL não responde ($(hostname), $(date '+%d/%m %H:%M'))"
  else
    message="Tchilar voltou a responder ($(date '+%d/%m %H:%M'))"
  fi
  curl -fsS -m 10 -d "$message" "$ALERT_WEBHOOK_URL" >/dev/null || true
fi
echo "$current" > "$STATE_FILE"
