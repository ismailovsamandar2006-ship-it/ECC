@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск локальной версии BANK BATTLE LIVE...
echo Требуется Node.js 20 или выше.
node local-server.js
pause
