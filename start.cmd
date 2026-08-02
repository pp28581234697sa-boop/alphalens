@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title AlphaLens Pro v11.1 Launcher

set "URL=http://127.0.0.1:3000"
set "HEALTH=http://127.0.0.1:3000/api/health"
set "LOG=%~dp0server.log"

if not exist "package.json" (
 echo ERROR: package.json not found.
 pause
 exit /b 1
)
if not exist "server.js" (
 echo ERROR: server.js not found.
 pause
 exit /b 1
)
where node.exe >nul 2>nul || (echo ERROR: Node.js not found.& pause& exit /b 1)
where npm.cmd >nul 2>nul || (echo ERROR: npm.cmd not found.& pause& exit /b 1)

if not exist "node_modules\dotenv\package.json" goto INSTALL
if not exist "node_modules\express\package.json" goto INSTALL
if not exist "node_modules\ws\package.json" goto INSTALL
goto INSTALLED

:INSTALL
(
 echo Installing required packages...
 call npm.cmd install --no-audit --no-fund
 if errorlevel 1 (echo ERROR: npm install failed.& pause& exit /b 1)
)
:INSTALLED

call npm.cmd run check
if errorlevel 1 (echo ERROR: Source check failed.& pause& exit /b 1)

node.exe -e "fetch('%HEALTH%').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 (
 echo Existing backend detected.
 start "" "%URL%"
 exit /b 0
)

> "%LOG%" echo [%date% %time%] Starting AlphaLens Pro v11.1
start "AlphaLens Backend" /min cmd.exe /d /c "cd /d ""%~dp0"" && node.exe server.js >> ""%LOG%"" 2>&1"

echo Waiting for backend...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0; $i -lt 45; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing '%HEALTH%' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if($ok){ exit 0 } else { exit 1 }"

if errorlevel 1 (
 echo.
 echo ERROR: Backend did not become ready.
 echo Server log: %LOG%
 echo.
 if exist "%LOG%" type "%LOG%"
 echo.
 pause
 exit /b 1
)

echo Backend is ready. Opening AlphaLens...
start "" "%URL%"
timeout /t 2 /nobreak >nul
exit /b 0
