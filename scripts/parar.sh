#!/usr/bin/env bash
# Para o bot sem apagar dados (playlists e configurações ficam no volume do Docker).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose stop
echo "✓ Bot parado. Para ligar de novo, execute INICIAR-MAC-LINUX.command."
read -r -p "Pressione Enter para fechar..." _ || true
