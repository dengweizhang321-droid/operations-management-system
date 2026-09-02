@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo  运营管理系统唯一启动总控
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 24.x。
  pause
  exit /b 1
)

echo [信息] 正在通过唯一引擎按 Django/PostgreSQL -^> Worker 顺序启动...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\worker-local-service.ps1" -Action Start
if errorlevel 1 (
  echo [错误] 唯一启动总控执行失败，请查看上方错误信息。
  pause
  exit /b 1
)

start "" "http://localhost:3000"

echo [完成] 系统已通过完整启动门禁并打开浏览器。
echo 如果页面未自动打开，请手动访问 http://localhost:3000
pause
