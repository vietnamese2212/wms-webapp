@echo off
REM Khao sat may tram can — nhay dup file nay la chay (khong can biet gi them)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0khao-sat-tram-can.ps1"
