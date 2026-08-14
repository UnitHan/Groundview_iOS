#!/bin/bash
# Install a persistent root LaunchDaemon that runs `pymobiledevice3 remote tunneld`.
#
# iOS 17.4+ requires a RemoteXPC (userspace TUN) tunnel that only root can create.
# Running tunneld once as a daemon lets the GroundView "WDA 실행" button launch WDA
# WITHOUT sudo afterwards. Run this ONCE with sudo:
#
#   sudo bash sh/install_tunneld_daemon.sh [/path/to/pymobiledevice3]
#
set -euo pipefail

LABEL="com.groundview.tunneld"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
PMD3="${1:-/Users/qabulls/Appkium_ixiO_Caller/.venv/bin/pymobiledevice3}"
OUT_LOG="/tmp/groundview-tunneld.log"
ERR_LOG="/tmp/groundview-tunneld-error.log"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ sudo로 실행하세요:  sudo bash sh/install_tunneld_daemon.sh"
  exit 1
fi

if [ ! -x "$PMD3" ]; then
  echo "❌ pymobiledevice3 실행 파일을 찾을 수 없습니다: $PMD3"
  echo "   경로를 인자로 넘기세요:  sudo bash sh/install_tunneld_daemon.sh /path/to/pymobiledevice3"
  exit 1
fi

echo "1) 기존 데몬 정리..."
launchctl bootout system "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true

echo "2) plist 작성: $PLIST  (pymobiledevice3=$PMD3)"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PMD3}</string>
        <string>remote</string>
        <string>tunneld</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${OUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${ERR_LOG}</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLISTEOF

chown root:wheel "$PLIST"
chmod 644 "$PLIST"

echo "3) 데몬 로드..."
launchctl bootstrap system "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo "4) 기동 대기(최대 15초)..."
for i in $(seq 1 15); do
  if curl -sf --max-time 2 "http://127.0.0.1:49151/" >/dev/null 2>&1; then
    echo "✅ tunneld REST 응답 확인 (:49151)"
    break
  fi
  sleep 1
done

echo ""
echo "상태:"
launchctl list | grep "$LABEL" || echo "  (launchctl 목록에 없음 — 로그 확인)"
echo "  out: $OUT_LOG"
echo "  err: $ERR_LOG"
echo ""
echo "완료. 이제 앱의 'WDA 실행' 버튼이 sudo 없이 동작합니다."
echo "제거하려면:  sudo launchctl bootout system $PLIST && sudo rm $PLIST"
