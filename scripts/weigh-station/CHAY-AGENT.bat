@echo off
REM Chay agent dong bo tram can -> WMS (sua CONFIG trong agent-tram-can.ps1 truoc)
REM Thu PowerShell 64-bit truoc; may chi co driver Access 32-bit (Jet 4.0) -> tu chuyen sang 32-bit
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-tram-can.ps1"
if %errorlevel%==2 (
  echo Chuyen sang PowerShell 32-bit ^(driver Access cu^)...
  "%windir%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-tram-can.ps1"
)
pause
