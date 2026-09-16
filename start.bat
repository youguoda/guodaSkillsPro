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

if not exist "node_modules\express" (
    echo [INFO] Dependencies not found. Running npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo.
)

echo [INFO] Starting Web Console at http://localhost:3721 ...
echo [INFO] Browser will open automatically once the server is ready.

start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try{ $c=New-Object Net.Sockets.TcpClient('localhost',3721); $c.Close(); Start-Process 'http://localhost:3721'; break }catch{ Start-Sleep -Milliseconds 500 } }"

node server/server.js

pause
