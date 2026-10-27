@echo off
setlocal
REM Duplo clique para ligar o bot no seu PC. O Docker Desktop precisa estar aberto.
REM Na primeira vez pergunta o token e cria o arquivo .env. Nao apaga nada.
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker nao encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/
  goto :erro
)
docker info >nul 2>nul
if errorlevel 1 (
  echo O Docker nao esta rodando. Abra o Docker Desktop, espere ficar verde e tente de novo.
  goto :erro
)

if exist ".env" goto :subir

echo Primeira execucao: preciso de dois dados do portal do Discord
echo https://discord.com/developers/applications  ^(sua aplicacao^)
echo.
set /p CLIENT_ID=Application ID (General Information):
set /p TOKEN=Token do bot (aba Bot, Reset Token):
if "%CLIENT_ID%"=="" goto :faltou
if "%TOKEN%"=="" goto :faltou

for /f %%s in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set PG=%%s
for /f %%s in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set RD=%%s
for /f %%s in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set LL=%%s

(
  echo DISCORD_TOKEN=%TOKEN%
  echo DISCORD_CLIENT_ID=%CLIENT_ID%
  echo BOT_NAME=Aurora
  echo POSTGRES_PASSWORD=%PG%
  echo REDIS_PASSWORD=%RD%
  echo LAVALINK_PASSWORD=%LL%
  echo LOG_LEVEL=info
) > .env
cls
echo Configuracao salva no arquivo .env ^(guarde-o; ele contem o token^).

:subir
echo Construindo e iniciando ^(a primeira vez leva alguns minutos^)...
docker compose up -d --build
if errorlevel 1 (
  echo Falha ao iniciar. Veja as mensagens acima.
  goto :erro
)
echo Registrando os comandos no Discord...
docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js --global
if errorlevel 1 (
  echo Nao consegui registrar os comandos. Confira o token e o Application ID no arquivo .env
  echo ^(para recomecar, apague o arquivo .env e rode este arquivo de novo^).
  goto :erro
)

echo.
echo Bot no ar! Ele fica online enquanto este PC e o Docker Desktop estiverem ligados.
echo Os comandos podem levar alguns minutos para aparecer no Discord.
echo Para desligar: duplo clique em PARAR-WINDOWS.bat
pause
exit /b 0

:faltou
echo Application ID e token sao obrigatorios.
:erro
pause
exit /b 1
