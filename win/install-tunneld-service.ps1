<#
.SYNOPSIS
  Register `pymobiledevice3 remote tunneld` as a background, auto-start,
  admin-privileged task on Windows (the equivalent of the macOS LaunchDaemon).

.DESCRIPTION
  iOS 17.4+ needs a RemoteXPC (userspace TUN) tunnel that only an Administrator
  can create. pymobiledevice3 uses pytun_pmd3 → Wintun on Windows, so `wintun.dll`
  must be resolvable (next to pymobiledevice3.exe or on PATH) and this must run
  elevated. We register a Scheduled Task that runs at boot as SYSTEM with highest
  privileges and keeps tunneld alive; its REST API is on http://127.0.0.1:49151.

  Run from an ELEVATED PowerShell:
    powershell -ExecutionPolicy Bypass -File .\win\install-tunneld-service.ps1

.NOTES
  --wifi enables WiFi monitoring; --mobdev2 (default) discovers network devices
  over mDNS (needs Bonjour, installed with iTunes). Uninstall:
    Unregister-ScheduledTask -TaskName GroundViewTunneld -Confirm:$false
#>
param(
  [string]$Pmd3 = "pymobiledevice3",
  [int]$TunneldPort = 49151
)

$ErrorActionPreference = "Stop"
$TaskName = "GroundViewTunneld"

# --- must be admin --------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "관리자 권한이 필요합니다. '관리자 권한으로 실행'된 PowerShell에서 다시 실행하세요." -ForegroundColor Red
  exit 1
}

# --- resolve pymobiledevice3 full path ------------------------------------
$pmd3Full = (Get-Command $Pmd3 -ErrorAction SilentlyContinue).Source
if (-not $pmd3Full) {
  if (Test-Path $Pmd3) { $pmd3Full = (Resolve-Path $Pmd3).Path }
  else { throw "pymobiledevice3 실행 파일을 찾을 수 없습니다: $Pmd3 (-Pmd3 로 경로 지정)" }
}
Write-Host "pymobiledevice3 = $pmd3Full" -ForegroundColor Cyan

# --- (re)create scheduled task --------------------------------------------
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "기존 작업 제거..." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action    = New-ScheduledTaskAction -Execute $pmd3Full -Argument "remote tunneld --wifi"
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description "GroundView iOS RemoteXPC tunneld" | Out-Null

Write-Host "작업 등록 완료. 지금 시작합니다..." -ForegroundColor Green
Start-ScheduledTask -TaskName $TaskName

# --- wait for REST --------------------------------------------------------
Write-Host "tunneld REST 대기 (:$TunneldPort, 최대 20초)..." -ForegroundColor Cyan
$up = $false
for ($i=0; $i -lt 20; $i++) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$TunneldPort/" -TimeoutSec 2 | Out-Null
    $up = $true; break
  } catch { Start-Sleep -Seconds 1 }
}
if ($up) {
  Write-Host "[OK] tunneld 실행 중 (http://127.0.0.1:$TunneldPort/)" -ForegroundColor Green
  Write-Host "이제 앱의 'WDA 실행' 버튼(또는 win\launch-wda.ps1)이 관리자 프롬프트 없이 동작합니다."
} else {
  Write-Host "[!] tunneld REST 응답 없음. Wintun(wintun.dll) 배치와 관리자 권한을 확인하세요." -ForegroundColor Yellow
  Write-Host "    로그: Event Viewer 또는 tunneld를 수동 실행해 확인: `"$pmd3Full`" remote tunneld --wifi"
}
