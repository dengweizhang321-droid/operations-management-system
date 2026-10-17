@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node --import tsx "%~dp0tmall-warehouse-login.ts"
set "WAREHOUSE_LOGIN_EXIT=%ERRORLEVEL%"
pause
exit /b %WAREHOUSE_LOGIN_EXIT%
