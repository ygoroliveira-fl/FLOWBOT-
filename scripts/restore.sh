#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh. DESTRUTIVO: substitui os dados atuais.
# Uso: scripts/restore.sh backups/aurora-AAAAMMDDTHHMMSSZ.dump
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?informe o arquivo .dump}"
[[ -f "$FILE" ]] || { echo "Arquivo não encontrado: $FILE" >&2; exit 1; }

docker compose exec -T postgres pg_restore --list < "$FILE" > /dev/null || {
  echo "Arquivo inválido ou corrompido." >&2; exit 1; }

echo "ATENÇÃO: todos os dados atuais do banco 'aurora' serão substituídos por $FILE."
echo "Um backup de segurança do estado atual será feito antes."
read -r -p "Digite RESTAURAR para continuar: " answer
[[ "$answer" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

scripts/backup.sh backups/pre-restore
docker compose stop bot
docker compose exec -T postgres pg_restore -U aurora -d aurora --clean --if-exists --no-owner --single-transaction < "$FILE"
docker compose run --rm migrate
docker compose start bot
echo "✓ Restaurado. Verifique: docker compose logs -f bot"
