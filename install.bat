@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Please install Node.js first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Please install Node.js with npm first.
  pause
  exit /b 1
)
echo Installing MCP Harness dependencies...
call npm install
if errorlevel 1 goto fail
echo Building MCP Harness...
call npm run build
if errorlevel 1 goto fail
echo Initializing MCP Harness and opening the desktop app...
call npm run harness:install:open
if errorlevel 1 goto fail
exit /b 0
:fail
echo MCP Harness installation failed.
pause
exit /b 1
