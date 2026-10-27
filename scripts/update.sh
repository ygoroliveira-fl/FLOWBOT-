#!/usr/bin/env bash
# Atualiza para a versão do Git informada (ou a mais recente da branch atual) com backup antes.
# Rollback: scripts/update.sh <commit-ou-tag-anterior> — ver docs/OPERATIONS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-}"

scripts/backup.sh
PREVIOUS="$(git rev-parse --short HEAD)"
git fetch --tags origin
if [[ -n "$TARGET" ]]; then git checkout --detach "$TARGET"; else git pull --ff-only; fi
echo "• $PREVIOUS → $(git rev-parse --short HEAD)"

docker compose build bot
docker compose up -d
docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js --global
echo "✓ Atualizado. Se algo der errado: scripts/update.sh $PREVIOUS"
echo "  (migrações não são revertidas automaticamente; ver docs/BACKUP_RESTORE.md)"
