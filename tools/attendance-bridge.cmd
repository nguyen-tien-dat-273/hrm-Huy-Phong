@echo off
rem Chay bridge may cham cong tren may tinh trong mang LAN.
rem Dung cho Task Scheduler cua Windows: tro Program/script vao dung file nay,
rem khong can dat "Start in" vi script tu nhay ve thu muc du an.

setlocal
cd /d "%~dp0.."

if not exist ".env.attendance-bridge" (
  echo [attendance-bridge] Thieu .env.attendance-bridge trong %CD%.
  echo [attendance-bridge] Copy tu .env.attendance-bridge.example roi dien IP may + token.
  exit /b 1
)

if not exist "logs" mkdir "logs"

rem Ghi ra file log vi Task Scheduler khong giu lai console: khong co file nay
rem thi mot bridge chet luc 2 gio sang se im lang tuyet doi, den cuoi thang moi
rem phat hien ra vi bang luong thieu ngay cong.
echo [%DATE% %TIME%] Bridge khoi dong.>> "logs\attendance-bridge.log"
node --env-file=.env.attendance-bridge tools\attendance-bridge.mjs>> "logs\attendance-bridge.log" 2>&1

set EXITCODE=%ERRORLEVEL%
echo [%DATE% %TIME%] Bridge dung, exit code %EXITCODE%.>> "logs\attendance-bridge.log"
exit /b %EXITCODE%
