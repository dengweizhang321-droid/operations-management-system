@echo off
setlocal
cd /d "%~dp0\.."
node --import tsx tools\jackyun-continue-helper.ts
