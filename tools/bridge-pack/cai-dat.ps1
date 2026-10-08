# Dang ky bridge may cham cong chay nen tren Windows.
#
# PHAI mo PowerShell bang chuot phai > "Run as administrator".
# Task dung trigger AtStartup va chay duoi tai khoan SYSTEM, ca hai deu doi
# quyen do. Doi lai: bridge chay ngay khi may bat, khong doi ai dang nhap, va
# khong chet khi nguoi dung dang xuat.
#
# Chay:  powershell -ExecutionPolicy Bypass -File cai-dat.ps1
# Go  :  Unregister-ScheduledTask -TaskName "HRM Attendance Bridge" -Confirm:$false

$ErrorActionPreference = 'Stop'

$laAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $laAdmin) {
  throw 'Can quyen Administrator. Dong cua so nay, mo lai PowerShell bang chuot phai > "Run as administrator".'
}

$taskName = 'HRM Attendance Bridge'
$thuMuc   = $PSScriptRoot
$launcher = Join-Path $thuMuc 'chay-bridge.cmd'
$envFile  = Join-Path $thuMuc '.env.attendance-bridge'

if (-not (Test-Path $launcher)) { throw "Khong thay $launcher" }
if (-not (Test-Path $envFile))  { throw "Khong thay $envFile" }

# Kiem Node truoc. Thieu Node thi task van dang ky duoc nhung chay lan nao cung
# that bai, va loi chi nam trong file log khong ai mo.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai script nay.'
}
$phienBan = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$phienBan -lt 20) {
  throw "Node.js dang la v$phienBan, can tu v20 tro len (tuy chon --env-file chi co tu v20)."
}

$action = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $thuMuc

# Hoan 1 phut: luc Windows vua len, card mang thuong chua lay xong dia chi.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'

# SYSTEM: luon ton tai, khong can mat khau. Dung tai khoan nguoi dung thi
# Windows doi luu mat khau, va hom nao doi mat khau la task chet im lang.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

# Bridge tu lap lich ben trong nen khong dat gioi han thoi gian chay.
# RestartCount lo phan bridge chet han: mat mang keo dai, may cham cong rut dien.
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
  -Description 'Doc log may cham cong Ronald Jack/ZKTeco trong LAN va day vao HRM.' `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Da cai xong va khoi dong bridge." -ForegroundColor Green
Write-Host "  Xem log        : Get-Content '$thuMuc\logs\bridge.log' -Tail 30 -Wait"
Write-Host "  Xem trang thai : Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Go bo          : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
