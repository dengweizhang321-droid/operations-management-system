@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo  电扇运营管理系统启动中
 echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 22+。
  pause
  exit /b 1
)

if not exist node_modules (
  echo [信息] 检测到未安装依赖，正在执行 npm install ...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo [信息] 正在启动项目开发服务器...
start "电扇运营管理系统" cmd /k "cd /d "%~dp0" && npm run dev"

echo [信息] 等待服务启动...
timeout /t 8 /nobreak >nul

start "" "http://localhost:3000"

echo [完成] 已尝试启动项目并打开浏览器。
echo 如果页面未自动打开，请手动访问 http://localhost:3000
pause
