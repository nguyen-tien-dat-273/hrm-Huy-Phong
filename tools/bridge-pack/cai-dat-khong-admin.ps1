# ============================================================================
# Dang ky bridge ma KHONG can quyen Administrator.
# ----------------------------------------------------------------------------
# Ban cai-dat.ps1 doi quyen Administrator vi no dung trigger AtStartup va chay
# duoi tai khoan SYSTEM — bridge chay ngay khi may bat, khong doi ai dang nhap.
# Dep nhat, nhung tren may cua nguoi khac thi thuong khong xin duoc quyen do,
# va the la khong cai duoc gi ca.
#
# Ban nay doi lai: tac vu chay duoi CHINH tai khoan dang dang nhap, kich hoat
# luc NGUOI DO DANG NHAP. Windows cho mot nguoi dung thuong tu tao tac vu cho
# chinh minh, nen khong can xin ai.
#
# Danh doi: bridge chi chay khi tai khoan do con dang nhap. Tren may van phong
# bat ca ngay va luon dang nhap san thi khong khac gi. May bi dang xuat hoac
# khoi dong lai ma chua ai dang nhap thi bridge nam cho.
#
# Chay:  powershell -ExecutionPolicy Bypass -File cai-dat-khong-admin.ps1
# Go  :  Unregister-ScheduledTask -TaskName "HRM Attendance Bridge (user)" -Confirm:$false
# ============================================================================

$ErrorActionPreference = 'Stop'

$taskName = 'HRM Attendance Bridge (user)'
$thuMuc   = $PSScriptRoot
$launcher = Join-Path $thuMuc 'chay-bridge.cmd'
$envFile  = Join-Path $thuMuc '.env.attendance-bridge'

if (-not (Test-Path $launcher)) { throw "Khong thay $launcher" }
if (-not (Test-Path $envFile))  {
  throw "Khong thay $envFile. Tao file nay truoc — xem HUONG-DAN.txt."
}

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

$action  = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $thuMuc
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Chay an, khong hien cua so den giua man hinh moi lan dang nhap.
# Khong dat -RunLevel Highest: dat la doi quyen admin, dung thu phai tranh.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartInterval (New-TimeSpan -Minutes 5) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host "Da dang ky va khoi dong: $taskName" -ForegroundColor Green
Write-Host "Bridge chay lai moi lan $env:USERNAME dang nhap vao may nay."
Write-Host ''
Write-Host 'Xem bridge co chay khong:'
Write-Host "    Get-Content '$thuMuc\logs\bridge.log' -Tail 20 -Wait"
Write-Host ''
Write-Host 'Kiem tra cau hinh 6 buoc:'
Write-Host "    node --env-file=.env.attendance-bridge kiem-tra.mjs"
Write-Host ''
