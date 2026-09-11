@echo off
setlocal
set "TRACE_ROOT=%~dp0"

echo Trace will first show what it plans to connect to Codex.
node "%TRACE_ROOT%native\install-codex-plugin.mjs" --dry-run %*
if errorlevel 1 (
  echo.
  echo Trace could not prepare the Codex connection. Review the message above.
  exit /b %ERRORLEVEL%
)

echo.
choice /M "Connect Trace to Codex now"
if errorlevel 2 exit /b 0
node "%TRACE_ROOT%native\install-codex-plugin.mjs" --confirm true %*
exit /b %ERRORLEVEL%
