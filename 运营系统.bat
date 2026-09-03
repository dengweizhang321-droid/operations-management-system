@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

rem 运营管理系统 Windows 生命周期入口（启动 / 后台启动 / 停止 / 重启 / 状态 / 日志）。
rem 用法：运营系统.bat [start|start-bg|stop|stop-worker|restart|restart-bg|status|logs]
rem 不带参数时显示菜单。实际逻辑全部在 tools\operations-system-service.ps1，
rem 启动仍通过唯一总控 tools\operations-system-control.ps1 -> tools\worker-local-service.ps1。

set "SERVICE=%~dp0tools\operations-system-service.ps1"
if not exist "%SERVICE%" (
  echo [错误] 未找到 %SERVICE%
  pause
  exit /b 1
)

if not "%~1"=="" (
  set "CHOICE=%~1"
  goto :dispatch
)

:menu
echo ==========================================
echo  运营管理系统
echo ==========================================
echo  1  启动（前台，显示进度）
echo  2  后台启动（立即返回，用 6 查看进度）
echo  3  停止（Worker + Django/PostgreSQL）
echo  4  只停止网页 Worker（保留后端）
echo  5  重启
echo  6  查看日志
echo  7  查看状态
echo  0  退出
echo.
set "CHOICE="
set /p "CHOICE=请选择: "
if "%CHOICE%"=="0" exit /b 0
if "%CHOICE%"=="1" set "CHOICE=start"
if "%CHOICE%"=="2" set "CHOICE=start-bg"
if "%CHOICE%"=="3" set "CHOICE=stop"
if "%CHOICE%"=="4" set "CHOICE=stop-worker"
if "%CHOICE%"=="5" set "CHOICE=restart"
if "%CHOICE%"=="6" set "CHOICE=logs"
if "%CHOICE%"=="7" set "CHOICE=status"

:dispatch
set "PSARGS="
if /i "%CHOICE%"=="start"       set "PSARGS=-Action Start -Open"
if /i "%CHOICE%"=="start-bg"    set "PSARGS=-Action Start -Open -Background"
if /i "%CHOICE%"=="stop"        set "PSARGS=-Action Stop"
if /i "%CHOICE%"=="stop-worker" set "PSARGS=-Action Stop -KeepBackend"
if /i "%CHOICE%"=="restart"     set "PSARGS=-Action Restart -Open"
if /i "%CHOICE%"=="restart-bg"  set "PSARGS=-Action Restart -Open -Background"
if /i "%CHOICE%"=="status"      set "PSARGS=-Action Status"
if /i "%CHOICE%"=="logs"        set "PSARGS=-Action Logs"
if "%PSARGS%"=="" (
  echo [错误] 无效选项：%CHOICE%
  echo 可用参数：start ^| start-bg ^| stop ^| stop-worker ^| restart ^| restart-bg ^| status ^| logs
  if "%~1"=="" goto :menu
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SERVICE%" %PSARGS%
set "RESULT=%ERRORLEVEL%"
if not "%~1"=="" exit /b %RESULT%
echo.
pause
goto :menu
