@echo off
REM Duplo clique para desligar o bot. Playlists e configuracoes ficam guardadas.
cd /d "%~dp0"
docker compose stop
echo Bot desligado. Para ligar de novo, use INICIAR-WINDOWS.bat
pause
