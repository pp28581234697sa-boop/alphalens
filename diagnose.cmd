@echo off
setlocal
cd /d "%~dp0"
echo AlphaLens v7.3 diagnostics
echo Folder: %CD%
echo.
node.exe -v
call npm.cmd -v
echo.
echo Testing backend...
node.exe -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log('HTTP',r.status);console.log(await r.text())}).catch(e=>{console.error('FAILED:',e.message);process.exit(1)})"
echo.
if exist "server.log" (
 echo Last server log lines:
 powershell.exe -NoProfile -Command "Get-Content -Path 'server.log' -Tail 30"
)
pause
