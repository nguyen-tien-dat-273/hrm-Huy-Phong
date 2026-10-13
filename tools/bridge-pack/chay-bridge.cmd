@echo off
rem Chay bridge may cham cong. Task Scheduler tro thang vao file nay.
setlocal
cd /d "%~dp0"

if not exist ".env.attendance-bridge" (
  echo [bridge] Thieu .env.attendance-bridge trong %CD%.
  exit /b 1
)
if not exist "logs" mkdir "logs"

rem Ghi ra file log vi Task Scheduler khong giu console: khong co file nay thi
rem mot bridge chet luc 2 gio sang se im lang tuyet doi, den cuoi thang moi
rem phat hien ra vi bang luong thieu ngay cong.
echo [%DATE% %TIME%] Bridge khoi dong.>> "logs\bridge.log"
node --env-file=.env.attendance-bridge attendance-bridge.mjs>> "logs\bridge.log" 2>&1

set EXITCODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Bridge dung, exit code %EXITCODE%.>> "logs\bridge.log"
exit /b %EXITCODE%
