#!/bin/bash
# ============================================================
# WDA Xcode 프로젝트 준비 + 열기
# 수동으로 Archive → IPA 내보내기를 위한 준비 스크립트
# ============================================================
set -euo pipefail

TEAM_ID="${WDA_TEAM_ID:-J845P53DFM}"
BUNDLE_PREFIX="com.seyong.1"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
info() { echo -e "${CYAN}ℹ️  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}"; exit 1; }

WDA_DIR=$(find ~/.appium -name "appium-webdriveragent" -maxdepth 8 -type d 2>/dev/null | head -1)
[[ -z "$WDA_DIR" ]] && die "appium-webdriveragent를 찾을 수 없습니다."
PBXPROJ="$WDA_DIR/WebDriverAgent.xcodeproj/project.pbxproj"

echo ""
echo "══════════════════════════════════════════════"
echo " WDA Xcode 프로젝트 준비"
echo "══════════════════════════════════════════════"
ok "WDA 소스: $WDA_DIR"

# ── 1. 배포 타겟 패치 ──
echo ""
echo "── 1. 배포 타겟 패치 ──"
cp "$PBXPROJ" "$PBXPROJ.bak_open" 2>/dev/null || true
# iOS 26.x → 18.0 (기기 OS와 맞춤)
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = [0-9][0-9]*\.[0-9]*;/IPHONEOS_DEPLOYMENT_TARGET = 18.0;/g' "$PBXPROJ"
ok "배포 타겟 → 18.0"

# ── 2. 서명 설정 패치 ──
echo ""
echo "── 2. 자동 서명 패치 ──"
# CODE_SIGN_STYLE = Automatic
python3 - "$PBXPROJ" "$TEAM_ID" "$BUNDLE_PREFIX" << 'PYEOF'
import sys, re

pbx_path, team_id, bundle_prefix = sys.argv[1], sys.argv[2], sys.argv[3]
with open(pbx_path, 'r', encoding='utf-8') as f:
    content = f.read()

# CODE_SIGN_STYLE 강제 Automatic
content = re.sub(r'CODE_SIGN_STYLE = Manual;', 'CODE_SIGN_STYLE = Automatic;', content)

# DEVELOPMENT_TEAM 설정
content = re.sub(r'DEVELOPMENT_TEAM = [A-Z0-9]*;', f'DEVELOPMENT_TEAM = {team_id};', content)

# WebDriverAgentRunner Bundle ID 패치
content = re.sub(
    r'(PRODUCT_BUNDLE_IDENTIFIER = )(com\.facebook\.WebDriverAgentRunner[^;]*)(;)',
    rf'\g<1>{bundle_prefix}.WebDriverAgentRunner\3',
    content
)

with open(pbx_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("서명/번들ID 패치 완료")
PYEOF
ok "서명 설정 완료 (Team: $TEAM_ID, Bundle: ${BUNDLE_PREFIX}.WebDriverAgentRunner)"

# ── 3. ExportOptions.plist 생성 ──
echo ""
echo "── 3. ExportOptions.plist 생성 ──"
EXPORT_OPTS="$WDA_DIR/ExportOptions.plist"
cat > "$EXPORT_OPTS" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>development</string>
    <key>teamID</key>
    <string>${TEAM_ID}</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>thinning</key>
    <string>&lt;none&gt;</string>
</dict>
</plist>
PLIST
ok "ExportOptions.plist → $EXPORT_OPTS"

# ── 4. CLI 빌드 옵션 제시 ──
echo ""
echo "══════════════════════════════════════════════"
echo " 선택지"
echo "══════════════════════════════════════════════"
echo ""
echo "  [A] CLI 자동 Archive + IPA 내보내기 (권장)"
echo "  [B] Xcode GUI로 열기 (수동 빌드)"
echo ""
read -p "선택 (A/B, 기본 A): " CHOICE
CHOICE="${CHOICE:-A}"

if [[ "$CHOICE" =~ ^[Bb]$ ]]; then
    # ── B: Xcode GUI 열기 ──
    echo ""
    info "Xcode로 프로젝트 열기..."
    open -a Xcode "$WDA_DIR/WebDriverAgent.xcodeproj"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " Xcode 수동 빌드 순서:"
    echo "  1. scheme → WebDriverAgentRunner 선택"
    echo "  2. 연결된 기기 (앱상용화검증의 iPhone) 선택"
    echo "  3. Product → Build (⌘B)"
    echo "  4. 완료 후 ./setup_wda_iphone.sh --restart 실행"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    # ── A: build-for-testing → tidevice 설치+실행 ──
    # XCTest 타겟은 xcodebuild archive/exportArchive가 지원되지 않음
    # build-for-testing + tidevice 조합으로 iOS SDK 불일치 우회
    echo ""
    HW_UDID=$(idevice_id -l 2>/dev/null | head -1 || true)
    [[ -z "$HW_UDID" ]] && die "USB로 연결된 iPhone이 없습니다."
    ok "하드웨어 UDID: $HW_UDID"

    # tidevice 경로
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    PMD3="$PROJECT_ROOT/.venv/bin/pymobiledevice3"
    if [[ ! -x "$PMD3" ]]; then
        warn "pymobiledevice3 없음 → 설치 중..."
        "$PROJECT_ROOT/.venv/bin/pip" install pymobiledevice3 2>&1 | tail -2
    fi
    ok "pymobiledevice3: $PMD3"

    # ── 1. build-for-testing ──
    DERIVED="$HOME/Library/Developer/Xcode/DerivedData/WDA_seyong_${HW_UDID:0:8}"
    mkdir -p "$DERIVED"
    BFT_LOG="/tmp/wda_bft_$(date +%s).log"
    warn "build-for-testing 실행 중 (배포타겟 18.0, 예상 5~15분)..."
    cd "$WDA_DIR"
    xcodebuild build-for-testing \
        -project WebDriverAgent.xcodeproj \
        -scheme WebDriverAgentRunner \
        -destination "id=${HW_UDID}" \
        -derivedDataPath "$DERIVED" \
        -sdk iphoneos \
        DEVELOPMENT_TEAM="$TEAM_ID" \
        PRODUCT_BUNDLE_IDENTIFIER="${BUNDLE_PREFIX}.WebDriverAgentRunner" \
        CODE_SIGN_STYLE=Automatic \
        IPHONEOS_DEPLOYMENT_TARGET=18.0 \
        -allowProvisioningUpdates \
        -allowProvisioningDeviceRegistration \
        ONLY_ACTIVE_ARCH=NO \
        2>&1 | tee "$BFT_LOG" \
        | grep -E "error:|BUILD|FAILED|SUCCEED|Signing" | grep -v "note:" | tail -10
    cd - > /dev/null

    APP_PATH="$DERIVED/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app"
    [[ ! -d "$APP_PATH" ]] && { grep -E "error:|FAILED" "$BFT_LOG" | tail -5; die "빌드 실패. 로그: $BFT_LOG"; }
    ok "빌드 완료: $APP_PATH"

    # ── 2. IPA 패키징 ──
    IPA_DIR="/tmp/wda_ipa_tidevice_$(date +%s)"
    mkdir -p "$IPA_DIR/Payload"
    cp -R "$APP_PATH" "$IPA_DIR/Payload/"
    cd "$IPA_DIR"
    zip -qr WDA.ipa Payload/ --exclude "*.DS_Store"
    IPA_FILE="$IPA_DIR/WDA.ipa"
    ok "IPA 생성: $(du -sh "$IPA_FILE" | cut -f1) → $IPA_FILE"
    cd - > /dev/null

    # ── 3. pymobiledevice3로 설치 ──
    echo ""
    echo "pymobiledevice3로 WDA 앱 설치 중..."
    "$PMD3" apps install "$IPA_FILE" --udid "$HW_UDID" 2>&1 | tail -3
    ok "앱 설치 완료"

    # ── 4. pymobiledevice3 dvt xcuitest로 WDA 실행 ──
    echo ""
    WDA_PORT=8100
    WDA_LOG="/tmp/wda_${HW_UDID:0:8}.log"
    pkill -f iproxy 2>/dev/null || true
    pkill -f "pymobiledevice3.*xcuitest" 2>/dev/null || true
    sleep 1

    iproxy "$WDA_PORT" "$WDA_PORT" --udid "$HW_UDID" >/dev/null 2>&1 &
    IPROXY_PID=$!
    ok "iproxy 시작 (PID: $IPROXY_PID)"

    # pymobiledevice3 dvt xcuitest: iOS 17+ PersonalizedDDI 완전 지원
    "$PMD3" developer dvt xcuitest \
        --udid "$HW_UDID" \
        --env USE_PORT="$WDA_PORT" \
        --env MJPEG_SERVER_PORT=9100 \
        --target-bundle-id "${BUNDLE_PREFIX}.WebDriverAgentRunner" \
        "${BUNDLE_PREFIX}.WebDriverAgentRunner.xctrunner" \
        > "$WDA_LOG" 2>&1 &
    WDA_PID=$!
    echo "WDA 기동 중 (PID: $WDA_PID, 로그: $WDA_LOG)"

    # ── 5. URL 대기 ──
    WDA_URL=""
    for i in $(seq 1 90); do
        if curl -s --max-time 2 "http://localhost:${WDA_PORT}/status" 2>/dev/null | grep -q '"build"'; then
            WDA_URL="http://localhost:${WDA_PORT}"
            break
        fi
        URL=$(grep -oE "ServerURLHere->http://[^ ]+" "$WDA_LOG" 2>/dev/null | head -1 | sed 's/ServerURLHere->//')
        [[ -n "$URL" ]] && { WDA_URL="$URL"; break; }
        printf "  대기 중... ${i}s\r"
        sleep 1
    done
    echo ""

    if [[ -n "$WDA_URL" ]]; then
        ok "WDA 기동 완료: $WDA_URL"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  WDA_URL = $WDA_URL"
        echo "  IPA     = $IPA_FILE"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
        warn "WDA URL 감지 실패. 로그 확인:"
        tail -20 "$WDA_LOG"
    fi
fi
