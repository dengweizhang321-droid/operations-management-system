@echo off
echo TERUISI FIXED APPROVED F15 STOP POSTCONDITION AND RESUME
echo Run this in the existing Administrator PowerShell or Command Prompt.
echo No new backup. No Stop replay. Original candidate and remaining acceptance steps.
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "E:\codex-artifacts\release-site-blockers-20261011\production-f15d06a\resume3\BOOTSTRAP_V3.ps1"
exit /b %ERRORLEVEL%
