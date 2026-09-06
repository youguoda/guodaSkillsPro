@echo off
chcp 65001 > nul
echo ================================================================
echo        Starting SkillsHub: Agent Skills Web Console             
echo ================================================================
echo.

node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    pause
    exit /b 1
)

echo [INFO] Starting Web Console at http://localhost:3721 ...
start "" http://localhost:3721
node server/server.js

pause
