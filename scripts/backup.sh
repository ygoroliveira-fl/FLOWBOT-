#!/usr/bin/env bash
# Backup lógico do PostgreSQL (formato custom, comprimido). Uso: scripts/backup.sh [diretório]
# Mantém os últimos $KEEP arquivos (padrão 14). Ver docs/BACKUP_RESTORE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DEST"
chmod 700 "$DEST"
FILE="$DEST/aurora-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres pg_dump -U aurora -d aurora --format=custom --no-owner > "$FILE.partial"
mv "$FILE.partial" "$FILE"
chmod 600 "$FILE"
# Confere se o arquivo é legível pelo pg_restore antes de considerar o backup válido.
docker compose exec -T postgres pg_restore --list < "$FILE" > /dev/null
echo "✓ Backup: $FILE ($(du -h "$FILE" | cut -f1))"

# Rotação: remove apenas backups antigos gerados por este script (padrão de nome fixo).
ls -1t "$DEST"/aurora-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
  echo "• Removido backup antigo: $old"
done
