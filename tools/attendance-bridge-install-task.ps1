# Dang ky bridge may cham cong thanh Scheduled Task tren Windows.
#
# Vi sao can: bridge phai chay lien tuc tren may tinh cung mang LAN voi may cham
# cong. Mo cua so terminal roi de do thi chi can ai do dong cua so, hoac may
# khoi dong lai sau khi Windows Update, la ngay cong ngung chay vao HRM ma khong
# co canh bao nao - den ky luong moi phat hien thieu ngay.
#
# PHAI chay bang quyen Administrator: task dung trigger AtStartup va chay duoi
# tai khoan SYSTEM, ca hai deu doi quyen do. Mo PowerShell bang chuot phai >
# "Run as administrator", roi:
#   powershell -ExecutionPolicy Bypass -File tools\attendance-bridge-install-task.ps1
#
# Doi lai: bridge chay ngay khi may khoi dong, khong doi ai dang nhap, va
# khong chet khi nguoi dung dang xuat.
#
# Xoa task:
#   Unregister-ScheduledTask -TaskName "HRM Attendance Bridge" -Confirm:$false

$ErrorActionPreference = 'Stop'

# Trigger AtStartup va principal SYSTEM deu doi quyen Administrator. Kiem truoc
# de bao ro, thay vi de Register-ScheduledTask nem mot loi kho hieu.
$dangLaAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $dangLaAdmin) {
  throw 'Can quyen Administrator. Mo PowerShell bang "Run as administrator" roi chay lai script nay.'
}

$taskName = 'HRM Attendance Bridge'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'attendance-bridge.cmd'
$envFile = Join-Path $projectRoot '.env.attendance-bridge'

if (-not (Test-Path $launcher)) { throw "Khong thay $launcher" }
if (-not (Test-Path $envFile)) {
  throw "Thieu $envFile. Copy tu .env.attendance-bridge.example roi dien IP may + token truoc."
}

# Kiem tra token da dien chua: dang ky task voi token placeholder thi task chay
# duoc nhung moi lan dong bo deu bi Supabase tu choi.
$envText = Get-Content $envFile -Raw
if ($envText -match 'ATTENDANCE_BRIDGE_TOKEN=rj_replace') {
  throw 'ATTENDANCE_BRIDGE_TOKEN van con la placeholder. Tao token trong HRM > May cham cong truoc.'
}

$action = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $projectRoot

# AtStartup chay ngay khi may khoi dong, khong doi ai dang nhap. Doi lai PHAI
# dang ky bang quyen Administrator - da kiem o dau file.
#
# Hoan 1 phut: luc Windows vua len, card mang thuong chua lay xong dia chi.
# Khong hoan thi lan dong bo dau tien chac chan truot, phai doi het 5 phut moi
# thu lai.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'

# SYSTEM: luon ton tai, khong can mat khau, chay duoc khi khong ai dang nhap.
# Dung tai khoan nguoi dung thi Windows doi luu mat khau, va doi mat khau la
# task chet im lang.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

# Bridge tu poll theo RJ_POLL_MINUTES nen khong dat ExecutionTimeLimit; RestartCount
# lo phan bridge chet han (mat mang keo dai, may cham cong bi rut dien).
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Da xoa task cu cung ten."
}

Register-ScheduledTask `
  -TaskName $taskName `
  -Description 'Doc log may cham cong Ronald Jack/ZKTeco trong LAN va day vao HRM qua Supabase RPC.' `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings | Out-Null

Write-Host ""
Write-Host "Da dang ky task '$taskName'." -ForegroundColor Green
Write-Host "  Chay ngay        : Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  Xem trang thai   : Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Xem log          : Get-Content logs\attendance-bridge.log -Tail 30 -Wait"
Write-Host "  Dung han         : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
