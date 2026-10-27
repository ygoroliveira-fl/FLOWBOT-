#!/usr/bin/env bash
# Sobe o bot no próprio computador (macOS/Linux) com Docker Desktop. Ver docs/RODAR_NO_PC.md.
# Na primeira vez pergunta o token e cria o .env; depois só reinicia. Não apaga nada.
set -euo pipefail
cd "$(dirname "$0")/.."

pause() { read -r -p "Pressione Enter para fechar..." _ || true; }
fail() { echo; echo "✗ $1" >&2; pause; exit 1; }

command -v docker >/dev/null || fail "Docker não encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || fail "O Docker não está rodando. Abra o Docker Desktop, espere ficar verde e tente de novo."

secret() {
  if command -v openssl >/dev/null; then openssl rand -hex 24
  else LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48; fi
}

if [[ ! -f .env ]]; then
  echo "Primeira execução: vou precisar de dois dados do portal do Discord"
  echo "(https://discord.com/developers/applications → sua aplicação)."
  echo
  read -r -p "Application ID (General Information): " client_id
  read -r -s -p "Token do bot (aba Bot → Reset Token; não aparece ao digitar): " token
  echo
  [[ "$client_id" =~ ^[0-9]{17,20}$ ]] || fail "Application ID inválido (deve ter só números)."
  [[ ${#token} -ge 50 ]] || fail "Token curto demais; copie o token inteiro."

  umask 077
  awk -v t="$token" -v c="$client_id" -v pg="$(secret)" -v rd="$(secret)" -v ll="$(secret)" '
    /^DISCORD_TOKEN=$/ { print "DISCORD_TOKEN=" t; next }
    /^DISCORD_CLIENT_ID=$/ { print "DISCORD_CLIENT_ID=" c; next }
    /^POSTGRES_PASSWORD=$/ { print "POSTGRES_PASSWORD=" pg; next }
    /^REDIS_PASSWORD=$/ { print "REDIS_PASSWORD=" rd; next }
    /^LAVALINK_PASSWORD=$/ { print "LAVALINK_PASSWORD=" ll; next }
    { print }
  ' .env.example > .env
  echo "• Configuração salva em .env (guarde este arquivo; ele contém o token)."
fi

echo "• Construindo e iniciando (a primeira vez leva alguns minutos)..."
docker compose up -d --build || fail "Falha ao iniciar. Veja as mensagens acima."
echo "• Registrando os comandos no Discord..."
docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js --global \
  || fail "Não consegui registrar os comandos. Confira o token e o Application ID no arquivo .env."

echo
echo "✓ Bot no ar! Ele fica online enquanto este computador e o Docker Desktop estiverem ligados."
echo "  Os comandos podem levar alguns minutos para aparecer no Discord."
echo "  Para parar: execute PARAR-MAC-LINUX.command (ou 'docker compose stop')."
pause
