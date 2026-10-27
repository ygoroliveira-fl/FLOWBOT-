#!/usr/bin/env bash
# Coleta um diagnóstico sem segredos para investigar problemas. Ver docs/TROUBLESHOOTING.md.
set -uo pipefail
cd "$(dirname "$0")/.."
section() { printf '\n==== %s ====\n' "$1"; }

section "Versões"
docker --version; docker compose version
section "Serviços"
docker compose ps
section "Uso de recursos"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
section "Disco"
df -h / | tail -1
docker system df
section "Health / readiness do bot"
curl -fsS http://127.0.0.1:9464/healthz; echo
curl -sS http://127.0.0.1:9464/readyz; echo
section "Lavalink"
docker compose exec -T lavalink sh -c 'wget -qO- --header "Authorization: $LAVALINK_SERVER_PASSWORD" http://127.0.0.1:2333/version' ; echo
docker compose logs --tail 40 lavalink 2>&1 | grep -viE 'password|authorization'
section "Últimos erros do bot"
docker compose logs --tail 300 bot 2>&1 | grep -E '"level":(50|60)' | tail -20
section "Migrações"
docker compose run --rm migrate node_modules/.bin/prisma migrate status 2>&1 | tail -5
