#!/usr/bin/env bash
# Cópia de segurança diária da Biva: base de dados + fotos/vídeos enviados.
# Guarda em $BACKUP_DIR e apaga as cópias com mais de $KEEP_DAYS dias.
# Opcional: envia uma cópia para fora do servidor com rclone (Google Drive, Backblaze, S3...).
#
# Uso (cron, todos os dias às 03:30):
#   30 3 * * * /opt/biva/deploy/backup.sh >> /var/log/biva-backup.log 2>&1
#
# Variáveis (lidas de /opt/biva/.env se existir):
#   BACKUP_DIR      pasta das cópias (predefinição /var/backups/biva)
#   KEEP_DAYS       dias a manter (predefinição 14)
#   BIVA_DOCKER=1   a base de dados corre no docker compose (serviço "database")
#   DATABASE_URL    caso contrário, usa pg_dump com este endereço (também serve para Supabase)
#   UPLOAD_DIR      pasta dos ficheiros enviados (predefinição /opt/biva/uploads)
#   RCLONE_REMOTE   ex.: "drive:biva-backups" — se definido, copia também para lá
#   ALERT_WEBHOOK_URL  se a cópia falhar, avisa aqui (ver healthcheck.sh)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$APP_DIR/.env" ]; then set -a; . "$APP_DIR/.env"; set +a; fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/biva}"
KEEP_DAYS="${KEEP_DAYS:-14}"
UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/uploads}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

fail() {
  echo "[$(date -Is)] ERRO: $1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -d "Biva: a cópia de segurança falhou ($1)" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
  exit 1
}
trap 'fail "linha $LINENO"' ERR

# 1. Base de dados (formato "custom": comprimido e restaurável tabela a tabela com pg_restore).
DB_FILE="$BACKUP_DIR/db_$STAMP.dump"
if [ "${BIVA_DOCKER:-0}" = "1" ]; then
  docker compose -f "$APP_DIR/docker-compose.yml" exec -T database pg_dump -U biva -Fc biva > "$DB_FILE"
else
  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" > "$DB_FILE"
fi
[ -s "$DB_FILE" ] || fail "o ficheiro da base de dados ficou vazio"

# 2. Fotos e vídeos enviados.
if [ "${BIVA_DOCKER:-0}" = "1" ]; then
  docker compose -f "$APP_DIR/docker-compose.yml" exec -T app tar -C /app -czf - uploads > "$BACKUP_DIR/uploads_$STAMP.tar.gz"
elif [ -d "$UPLOAD_DIR" ]; then
  tar -C "$(dirname "$UPLOAD_DIR")" -czf "$BACKUP_DIR/uploads_$STAMP.tar.gz" "$(basename "$UPLOAD_DIR")"
fi
chmod 600 "$BACKUP_DIR"/*_"$STAMP".* 2>/dev/null || true

# 3. Limpa cópias antigas.
find "$BACKUP_DIR" -type f \( -name 'db_*.dump' -o -name 'uploads_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

# 4. Cópia fora do servidor (se o servidor avariar ou for apagado, as cópias locais vão com ele).
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "*_$STAMP.*"
fi

echo "[$(date -Is)] Cópia feita: $(du -sh "$BACKUP_DIR" | cut -f1) em $BACKUP_DIR"
