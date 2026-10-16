@echo off
setlocal
chcp 65001 >nul
"C:\Program Files\nodejs\node.exe" "%~dp0tools\publish-main.mjs"
set "release_exit=%errorlevel%"
echo.
pause
exit /b %release_exit%
