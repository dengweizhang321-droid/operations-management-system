@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo  电扇运营管理系统启动中
 echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 24.x。
  pause
  exit /b 1
)

echo [信息] 正在启动已验证的不可变本地 Worker...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\worker-local-service.ps1" -Action Start
if errorlevel 1 (
  echo [错误] 不可变 Worker 启动失败。
  pause
  exit /b 1
)

echo [信息] 等待服务启动...
timeout /t 8 /nobreak >nul

start "" "http://localhost:3000"

echo [完成] 已尝试启动项目并打开浏览器。
echo 如果页面未自动打开，请手动访问 http://localhost:3000
pause
