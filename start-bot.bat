@echo off
title Pokemon Restock Bot
cd /d "%~dp0"

echo ============================================
echo   Pokemon Restock Bot - Starting up...
echo ============================================
echo.

:: Check Node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install it from https://nodejs.org
    pause
    exit /b 1
)

:: Check cloudflared is installed
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: cloudflared not found.
    echo Download it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo Place cloudflared.exe in this folder or add it to your PATH.
    pause
    exit /b 1
)

:: Check .env exists
if not exist ".env" (
    echo ERROR: .env file not found in this folder.
    echo Copy your environment variables into a .env file first.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3000 2>&1"

echo Waiting for tunnel to initialize...
timeout /t 5 /nobreak >nul

echo Starting bot...
echo.
echo ============================================
echo   Bot is running. Check the tunnel window
echo   for your public URL, then update it in
echo   Discord Developer Portal if needed.
echo
echo   Close this window to stop the bot.
echo ============================================
echo.

node src/index.js

echo.
echo Bot stopped. Press any key to exit.
pause
