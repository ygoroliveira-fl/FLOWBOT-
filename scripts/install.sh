#!/usr/bin/env bash
# Primeira instalação na VPS (Ubuntu/Debian com Docker já instalado). Ver docs/DEPLOYMENT.md.
# Não sobrescreve um .env existente e não apaga nada.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker não encontrado. Veja docs/DEPLOYMENT.md." >&2; exit 1; }
docker compose version >/dev/null || { echo "Plugin 'docker compose' não encontrado." >&2; exit 1; }

secret() { openssl rand -hex 24; }

if [[ -f .env ]]; then
  echo "• .env já existe — mantido como está."
else
  cp .env.example .env
  sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(secret)/" .env
  sed -i "s/^REDIS_PASSWORD=$/REDIS_PASSWORD=$(secret)/" .env
  sed -i "s/^LAVALINK_PASSWORD=$/LAVALINK_PASSWORD=$(secret)/" .env
  sed -i "s/^METRICS_TOKEN=$/METRICS_TOKEN=$(secret)/" .env
  chmod 600 .env
  echo "• .env criado com senhas aleatórias. Preencha DISCORD_TOKEN e DISCORD_CLIENT_ID antes de continuar."
fi

if ! grep -qE '^DISCORD_TOKEN=.{50,}' .env || ! grep -qE '^DISCORD_CLIENT_ID=[0-9]{17,20}$' .env; then
  echo "✗ Preencha DISCORD_TOKEN e DISCORD_CLIENT_ID no .env e rode este script de novo." >&2
  exit 1
fi

# Token do Prometheus (opcional) em arquivo separado, legível só pelo dono.
if [[ ! -f monitoring/metrics_token ]]; then
  grep '^METRICS_TOKEN=' .env | cut -d= -f2- | tr -d '\n' > monitoring/metrics_token
  chmod 600 monitoring/metrics_token
fi

echo "• Construindo a imagem do bot…"
docker compose build bot
echo "• Subindo serviços (migrações rodam automaticamente)…"
docker compose up -d
echo "• Registrando comandos slash…"
docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js --global
echo "✓ Pronto. Acompanhe com: docker compose logs -f bot"
