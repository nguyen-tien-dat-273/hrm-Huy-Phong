# Dang ky bridge may cham cong thanh Scheduled Task tren Windows.
#
# Vi sao can: bridge phai chay lien tuc tren may tinh cung mang LAN voi may cham
# cong. Mo cua so terminal roi de do thi chi can ai do dong cua so, hoac may
# khoi dong lai sau khi Windows Update, la ngay cong ngung chay vao HRM ma khong
# co canh bao nao - den ky luong moi phat hien thieu ngay.
#
# Chay trong PowerShell (KHONG can quyen Administrator vi task chay duoi chinh
# tai khoan dang dang nhap):
#   powershell -ExecutionPolicy Bypass -File tools\attendance-bridge-install-task.ps1
#
# Xoa task:
#   Unregister-ScheduledTask -TaskName "HRM Attendance Bridge" -Confirm:$false

$ErrorActionPreference = 'Stop'

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

# AtLogOn thay vi AtStartup: AtStartup doi hoi quyen Administrator, con day thi
# khong. Doi lai may phai dang nhap vao mot tai khoan de bridge chay.
$triggers = @(
  New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
)

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
  -Trigger $triggers `
  -Settings $settings | Out-Null

Write-Host ""
Write-Host "Da dang ky task '$taskName'." -ForegroundColor Green
Write-Host "  Chay ngay        : Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  Xem trang thai   : Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Xem log          : Get-Content logs\attendance-bridge.log -Tail 30 -Wait"
Write-Host "  Dung han         : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
