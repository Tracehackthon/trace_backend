@echo off
node "%~dp0trace.mjs" %*
exit /b %ERRORLEVEL%