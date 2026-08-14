<#
.SYNOPSIS
  Launch an already-installed WebDriverAgent on an iOS 17+ device over WiFi (Windows).

.DESCRIPTION
  Mirrors the proven macOS recipe. Prereqs:
    - setup-wireless.ps1 has been run once over USB (wifi-connections + DDI)
    - install-tunneld-service.ps1 registered the background tunneld (REST :49151)
  Then this needs NO admin and NO cable:
    1. Read the device's RemoteXPC tunnel from tunneld REST
    2. pymobiledevice3 developer dvt xcuitest --tunnel <UDID> --env USE_PORT=8100 <runner>
    3. Reach WDA at the device LAN IP:8100 (WDA binds 0.0.0.0; no iproxy needed)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\win\launch-wda.ps1 `
    -Udid 00008110-001679810281401E -Runner com.jjun.1.WebDriverAgentRunner.xctrunner
#>
param(
  [Parameter(Mandatory=$true)][string]$Udid,
  [Parameter(Mandatory=$true)][string]$Runner,   # e.g. com.jjun.1.WebDriverAgentRunner.xctrunner
  [string]$Pmd3 = "pymobiledevice3",
  [int]$WdaPort = 8100,
  [int]$MjpegPort = 9100,
  [int]$TunneldPort = 49151,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"
function Info($m){ Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Fail($m){ Write-Host "[X] $m" -ForegroundColor Red }

# --- 1) tunnel from tunneld REST ------------------------------------------
Info "tunneld에서 기기 터널 조회..."
try {
  $rest = Invoke-RestMethod -Uri "http://127.0.0.1:$TunneldPort/" -TimeoutSec 3
} catch {
  Fail "tunneld REST(:$TunneldPort) 응답 없음. install-tunneld-service.ps1 을 먼저 실행하세요."
  exit 1
}
$entry = $rest.$Udid
if (-not $entry) {
  Fail "이 기기($Udid)의 터널이 없습니다. 같은 WiFi + setup-wireless.ps1(무선 활성화) 여부를 확인하세요."
  exit 1
}
$tunAddr = $entry[0].'tunnel-address'
Ok "tunnel = [$tunAddr]:$($entry[0].'tunnel-port')"

# --- 2) launch WDA runner (background) ------------------------------------
Info "WDA 런치 (dvt xcuitest --tunnel)..."
$log = Join-Path $env:TEMP "wda-launch-$($Udid.Substring(0,8)).log"
$args = @("developer","dvt","xcuitest","--tunnel",$Udid,
          "--env","USE_PORT=$WdaPort","--env","MJPEG_SERVER_PORT=$MjpegPort",$Runner)
$proc = Start-Process -FilePath $Pmd3 -ArgumentList $args -PassThru -WindowStyle Hidden `
          -RedirectStandardOutput $log -RedirectStandardError "$log.err"
Ok "런처 PID = $($proc.Id), 로그 = $log"

# --- 3) wait for readiness, discover device LAN IP ------------------------
Info "WDA 준비 대기 (최대 ${TimeoutSec}s)..."
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$wdaUrl = $null; $deviceIp = $null
while ((Get-Date) -lt $deadline) {
  try {
    # tunnel address is reachable first; use it to learn the device LAN IP
    $st = Invoke-RestMethod -Uri "http://[$tunAddr]:$WdaPort/status" -TimeoutSec 2
    if ($st.value.ready) {
      $deviceIp = $st.value.ios.ip
      try {
        $st2 = Invoke-RestMethod -Uri "http://${deviceIp}:$WdaPort/status" -TimeoutSec 2
        if ($st2.value.ready) { $wdaUrl = "http://${deviceIp}:$WdaPort" }
      } catch { }
      if (-not $wdaUrl) { $wdaUrl = "http://[$tunAddr]:$WdaPort" }  # tunnel-only fallback
      break
    }
  } catch { }
  Start-Sleep -Seconds 2
}

if ($wdaUrl) {
  Ok "WDA READY"
  Write-Host "  WDA_URL   = $wdaUrl"
  Write-Host "  deviceIp  = $deviceIp"
  Write-Host "  Appium    : capabilities.webDriverAgentUrl = `"http://${deviceIp}:$WdaPort`""
} else {
  Fail "시간 내 준비되지 않음. 로그 확인: $log"
  Get-Content $log -Tail 20 -ErrorAction SilentlyContinue
  exit 1
}
