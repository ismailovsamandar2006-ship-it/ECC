@echo off
chcp 65001 >nul
rem Root Directory of the Vercel project is apps/bank-battle-live, so deploy from the repo root.
cd /d "%~dp0..\.."
echo.
echo  ===============================================
echo        BANK BATTLE LIVE - VERCEL
echo  ===============================================
echo.
echo 1. Убедитесь, что установлен Node.js версии 22.
echo 2. При первом запуске выберите существующий проект bank-battle-live.
echo 3. База: Vercel - проект - Storage - Upstash for Redis (один раз).
echo 4. После подключения базы запустите этот файл ещё раз.
echo.
call npx vercel --prod
if errorlevel 1 echo Возникла ошибка. Проверьте Node.js, интернет и авторизацию в Vercel.
pause
