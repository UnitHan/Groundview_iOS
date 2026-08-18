<#
.SYNOPSIS
  ONE-TIME (USB) setup to make an iPhone reachable wirelessly for WDA on Windows.

.DESCRIPTION
  Mirrors the macOS flow. Run ONCE with the device connected by USB and UNLOCKED:
    1. Enable "wifi connections"  (== Xcode "Connect via network")
    2. Ensure Developer Mode is ON
    3. Mount the personalized Developer Disk Image (DDI) matching the iOS version
  After this, the device is discoverable over WiFi and `install-tunneld-service.ps1`
  can create the RemoteXPC tunnel without a cable.

  Requires Apple Mobile Device Support (usbmux) — installed with iTunes.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\win\setup-wireless.ps1
  powershell -ExecutionPolicy Bypass -File .\win\setup-wireless.ps1 -Pmd3 "C:\tools\pymobiledevice3.exe"
#>
param(
  [string]$Udid = "",
  [string]$Pmd3 = "pymobiledevice3"
)

$ErrorActionPreference = "Stop"
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[!] $m" -ForegroundColor Yellow }

# --- resolve device UDID (USB) --------------------------------------------
if (-not $Udid) {
  Info "USB로 연결된 기기 조회..."
  $json = & $Pmd3 usbmux list 2>$null | Out-String
  try {
    $devs = @($json | ConvertFrom-Json)
    # pymobiledevice3 v10 short_info uses Identifier/UniqueDeviceID (older builds: Udid)
    if ($devs.Count -ge 1) {
      $d = $devs[0]
      $Udid = $d.Identifier; if (-not $Udid) { $Udid = $d.UniqueDeviceID }; if (-not $Udid) { $Udid = $d.Udid }
    }
  } catch { }
  if (-not $Udid) { throw "USB 기기를 찾지 못했습니다. 케이블 연결 + 잠금 해제 + '신뢰'를 확인하세요." }
}
Ok "UDID = $Udid"

# --- 1) enable wifi connections (Xcode 'Connect via network' equivalent) ---
Info "WiFi 연결 활성화 (wifi-connections on)..."
& $Pmd3 lockdown wifi-connections --state on --udid $Udid
Ok "WiFi 연결 활성화됨"

# --- 2) developer mode ----------------------------------------------------
Info "개발자 모드 상태 확인..."
$dm = & $Pmd3 amfi developer-mode-status --udid $Udid 2>&1 | Out-String
if ($dm -match "true") {
  Ok "개발자 모드 ON"
} else {
  Warn "개발자 모드 OFF → 활성화 시도 (기기 재부팅될 수 있음, 잠금 해제 필요)"
  & $Pmd3 amfi enable-developer-mode --udid $Udid
  Warn "재부팅 후 설정>개인정보 보호 및 보안>개발자 모드에서 켠 뒤 이 스크립트를 다시 실행하세요."
}

# --- 3) mount DDI (personalized, matches the device iOS version) ----------
Info "Developer Disk Image(DDI) 마운트 (auto-mount)..."
try {
  & $Pmd3 mounter auto-mount --udid $Udid
  Ok "DDI 마운트 완료(또는 이미 마운트됨)"
} catch {
  Warn "auto-mount 실패: $($_.Exception.Message)"
  Warn "인터넷 연결 상태에서 다시 시도하세요 (Apple에서 DDI를 받아옵니다)."
}

# --- report device WiFi IP ------------------------------------------------
Info "설치 요약"
& $Pmd3 mounter list --udid $Udid 2>$null | Out-String | Write-Host
Ok "완료. 이제 관리자 PowerShell에서 install-tunneld-service.ps1 을 실행하세요."
Write-Host "   powershell -ExecutionPolicy Bypass -File .\win\install-tunneld-service.ps1"
