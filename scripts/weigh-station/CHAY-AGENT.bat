@echo off
REM Chay agent dong bo tram can -> WMS (sua CONFIG trong agent-tram-can.ps1 truoc)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-tram-can.ps1"
pause
