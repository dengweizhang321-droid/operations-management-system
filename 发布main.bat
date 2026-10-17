@echo off
setlocal
chcp 65001 >nul
"C:\Program Files\nodejs\node.exe" "%~dp0tools\publish-latest-main.mjs" --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json" %*
set "release_exit=%errorlevel%"
echo.
if /i not "%~1"=="--no-pause" if /i not "%~2"=="--no-pause" pause
exit /b %release_exit%
