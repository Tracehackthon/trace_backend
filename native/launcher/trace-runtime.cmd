@echo off
node "%~dp0trace-runtime.mjs" %*
exit /b %ERRORLEVEL%
