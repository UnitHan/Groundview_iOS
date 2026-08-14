#!/bin/bash
# ============================================================
# WDA 설치 및 실행 스크립트 (새 맥북 / 새 iPhone 연결용)
# 계정: seyong park (Personal Team) - Team ID: J845P53DFM
# Bundle prefix: com.seyong.1
#
# 사용법:
#   ./setup_wda_iphone.sh            # 기본: 이미 실행 중이면 스킵
#   ./setup_wda_iphone.sh --build    # 강제 재빌드 + 재시작
#   ./setup_wda_iphone.sh --restart  # 재빌드 없이 재시작만
# ============================================================
set -euo pipefail

# ── 플래그 파싱 ──
FORCE_BUILD=0
FORCE_RESTART=0
for arg in "$@"; do
    case "$arg" in
        --build)   FORCE_BUILD=1; FORCE_RESTART=1 ;;
        --restart) FORCE_RESTART=1 ;;
    esac
done

WDA_PORT="${WDA_PORT:-8100}"
TEAM_ID="${WDA_TEAM_ID:-J845P53DFM}"
BUNDLE_PREFIX="com.seyong.1"
WDA_DIR=$(find ~/.appium -name "appium-webdriveragent" -maxdepth 8 -type d 2>/dev/null | head -1)

# GitHub Actions 빌드서버 설정 (환경변수로만 주입, 코드에 토큰 하드코딩 금지)
# export GH_REPO=owner/repo
# export GH_TOKEN=<your_pat>
GH_REPO="${GH_REPO:-}"
GH_TOKEN="${GH_TOKEN:-}"

# ──────────────────────────────────────────
# 색상 출력 헬퍼
# ──────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}"; exit 1; }

# ──────────────────────────────────────────
# 1. iPhone UDID 자동 감지
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 1: iPhone 연결 확인"
echo "══════════════════════════════════════════════"

# devicectl 우선 (iOS 17+ CoreDevice, USB/무선 모두 지원)
# 기기명에 공백이 있어 awk 컬럼이 어긋나므로 UUID 패턴으로 직접 추출
UDID=$(xcrun devicectl list devices 2>/dev/null \
    | grep -i "connected" \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' \
    | head -1 || true)
if [[ -z "$UDID" ]]; then
    UDID=$(idevice_id -l 2>/dev/null | head -1 || true)
fi
if [[ -z "$UDID" ]]; then
    die "연결된 iPhone이 없습니다. USB 또는 같은 WiFi에서 무선으로 연결 후 재시도하세요."
fi
ok "iPhone UDID: $UDID"

# 기기 이름/iOS 버전 출력 (devicectl 상세 정보 사용)
DEVICE_INFO=$(xcrun devicectl device info details --device "$UDID" 2>/dev/null || true)
DEVICE_NAME=$(echo "$DEVICE_INFO" | awk '/name:/{print $2; exit}' || \
    xcrun devicectl list devices 2>/dev/null | grep "$UDID" | awk '{print $1}' || echo "Unknown")
IOS_VER=$(echo "$DEVICE_INFO" | awk '/productVersion:/{print $2; exit}' || echo "Unknown")
ok "기기명: $DEVICE_NAME  /  iOS: $IOS_VER"

# ── 연결 방식 감지: USB(iproxy 가능) vs 무선(디바이스 IP 직접 사용) ──
# idevice_id -l 은 libimobiledevice 기반 — USB 연결 기기만 반환
OLD_UDID=$(idevice_id -l 2>/dev/null | head -1 || true)
if [[ -n "$OLD_UDID" ]]; then
    CONN_MODE="usb"
    ok "연결 방식: USB"
else
    CONN_MODE="wireless"
    ok "연결 방식: 무선 WiFi (iproxy 생략, WDA 디바이스 IP 직접 사용)"
fi

# ── WDA 이미 실행 중인지 확인 ──
echo "WDA 이미 실행 중인지 확인 중..."
RUNNING_URL=""

if [[ "$CONN_MODE" == "usb" ]]; then
    # USB: iproxy로 포트포워딩 후 localhost 확인
    iproxy "$WDA_PORT" "$WDA_PORT" --udid "$OLD_UDID" > /dev/null 2>&1 &
    IPROXY_CHECK_PID=$!
    sleep 1
    if curl -s --max-time 4 "http://localhost:${WDA_PORT}/status" 2>/dev/null | grep -q '"build"'; then
        RUNNING_URL="http://localhost:${WDA_PORT}"
    fi
    kill $IPROXY_CHECK_PID 2>/dev/null || true
else
    # 무선: 이전 WDA 로그에서 디바이스 URL 확인
    LAST_LOG=$(ls -t /tmp/wda_*.log 2>/dev/null | head -1 || true)
    if [[ -n "$LAST_LOG" ]]; then
        CACHED_URL=$(grep -o 'ServerURLHere->http://[^<]*' "$LAST_LOG" 2>/dev/null \
            | tail -1 | sed 's/ServerURLHere->//' || true)
        if [[ -n "$CACHED_URL" ]] && curl -s --max-time 4 "${CACHED_URL}/status" 2>/dev/null | grep -q '"build"'; then
            RUNNING_URL="$CACHED_URL"
        fi
    fi
    # localhost도 혹시 iproxy 살아있을 경우 체크
    if [[ -z "$RUNNING_URL" ]] && curl -s --max-time 2 "http://localhost:${WDA_PORT}/status" 2>/dev/null | grep -q '"build"'; then
        RUNNING_URL="http://localhost:${WDA_PORT}"
    fi
fi

if [[ -n "$RUNNING_URL" ]]; then
    WDA_VER=$(curl -s --max-time 5 "${RUNNING_URL}/status" 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['value']['build']['version'])" 2>/dev/null || echo "unknown")
    if [[ $FORCE_RESTART -eq 0 ]]; then
        ok "WDA 이미 실행 중 (버전: $WDA_VER) → $RUNNING_URL"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  WDA_URL = $RUNNING_URL"
        echo "  재빌드: ./setup_wda_iphone.sh --build"
        echo "  재시작: ./setup_wda_iphone.sh --restart"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        ok "모든 단계 완료 (이미 실행 중)"
        exit 0
    else
        warn "WDA 실행 중이지만 $([ $FORCE_BUILD -eq 1 ] && echo '--build' || echo '--restart') 플래그 → 재시작"
    fi
fi

# ──────────────────────────────────────────
# 2. WDA 소스 확인
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 2: WDA 소스 확인"
echo "══════════════════════════════════════════════"

if [[ -z "$WDA_DIR" ]]; then
    warn "appium-webdriveragent를 찾을 수 없습니다. appium 설치 시도..."
    npm install -g appium 2>&1 | tail -3
    appium driver install xcuitest 2>&1 | tail -3
    WDA_DIR=$(find ~/.appium -name "appium-webdriveragent" -maxdepth 8 -type d 2>/dev/null | head -1)
    [[ -z "$WDA_DIR" ]] && die "WDA 소스를 찾을 수 없습니다."
fi
ok "WDA 소스: $WDA_DIR"

# ──────────────────────────────────────────
# 3. pbxproj 배포 타겟 패치 (iOS 16.0 이상 호환)
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 3: 배포 타겟 패치 (iOS 26.x → 16.0)"
echo "══════════════════════════════════════════════"

PBXPROJ="$WDA_DIR/WebDriverAgent.xcodeproj/project.pbxproj"
CURRENT_TARGET=$(grep "IPHONEOS_DEPLOYMENT_TARGET" "$PBXPROJ" 2>/dev/null | grep -E "2[0-9]\." | head -1 || echo "")

if [[ -n "$CURRENT_TARGET" ]]; then
    warn "배포 타겟에 iOS 20+ 값 발견 → 16.0으로 패치"
    cp "$PBXPROJ" "$PBXPROJ.bak"
    sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 2[0-9]\.[0-9]*;/IPHONEOS_DEPLOYMENT_TARGET = 16.0;/g' "$PBXPROJ"
    ok "패치 완료 (백업: project.pbxproj.bak)"
else
    ok "배포 타겟 패치 불필요 (이미 16.0 이하)"
fi

# ──────────────────────────────────────────
# 4. xctestrun 확인 / GitHub artifact 다운로드 / 로컬 빌드
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 4: xctestrun 확인 / 빌드"
echo "══════════════════════════════════════════════"

# 유효한 xctestrun = 파일 크기 > 2KB, 현재 기기 UDID 기준 최신 빌드 우선
_find_valid_xctestrun() {
    local udid="${1:-}"
    # UDID 기준 폴더 먼저 탐색 (build_wda_local.sh 산출물)
    local search_dirs=()
    if [[ -n "$udid" ]]; then
        while IFS= read -r d; do
            search_dirs+=("$d")
        done < <(find ~/Library/Developer/Xcode/DerivedData -maxdepth 1 -name "WDA_*${udid:0:8}*" -type d 2>/dev/null)
    fi
    # 폴백: 모든 WebDriverAgent DerivedData
    while IFS= read -r d; do
        search_dirs+=("$d")
    done < <(find ~/Library/Developer/Xcode/DerivedData -maxdepth 1 -name "WebDriverAgent-*" -type d 2>/dev/null)

    for dir in "${search_dirs[@]}"; do
        find "$dir/Build/Products" -name "*.xctestrun" 2>/dev/null \
        | while IFS= read -r f; do
            sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
            [[ $sz -gt 2000 ]] && echo "$f"
        done
    done | xargs ls -t 2>/dev/null | head -1 || true
}

GH_IPA=""
XCTESTRUN=$(_find_valid_xctestrun "$UDID")

# 현재 기기 전용 DerivedData가 없으면 재사용 무시 (다른 기기 빌드 오염 방지)
if [[ $FORCE_BUILD -eq 1 ]]; then
    warn "--build 플래그: xctestrun 무시하고 재빌드"
    XCTESTRUN=""
elif [[ -n "$XCTESTRUN" ]]; then
    DERIVED_DEVICE_DIR=$(find ~/Library/Developer/Xcode/DerivedData -maxdepth 1 -name "WDA_seyong_${UDID:0:8}*" -type d 2>/dev/null | head -1 || true)
    if [[ -z "$DERIVED_DEVICE_DIR" ]]; then
        warn "현재 기기(${UDID:0:8}) 전용 빌드 없음 → 재빌드"
        XCTESTRUN=""
    fi
fi

if [[ -n "$XCTESTRUN" ]]; then
    ok "기존 xctestrun 재사용: $(basename "$XCTESTRUN") (기기: ${UDID:0:8})"
elif [[ -n "$GH_REPO" && -n "$GH_TOKEN" ]]; then
    # ── GitHub Actions artifact 다운로드 ──
    warn "로컬 xctestrun 없음 → GitHub Actions artifact 다운로드 시도..."
    ARTIFACT_DIR="/tmp/wda_artifact_$(date +%s)"
    mkdir -p "$ARTIFACT_DIR"

    # 최신 성공한 workflow run 찾기
    RUN_ID=$(curl -sf -H "Authorization: token $GH_TOKEN" \
        "https://api.github.com/repos/${GH_REPO}/actions/runs?status=success&per_page=5" \
        | python3 -c "
import sys, json
runs = json.load(sys.stdin).get('workflow_runs', [])
build = [r for r in runs if 'wda' in r.get('name','').lower()]
print(build[0]['id'] if build else runs[0]['id'] if runs else '')
" 2>/dev/null || true)

    if [[ -z "$RUN_ID" ]]; then
        warn "GitHub에서 빌드 결과를 찾을 수 없습니다. 로컬 빌드로 전환..."
    else
        ARTIFACT_ID=$(curl -sf -H "Authorization: token $GH_TOKEN" \
            "https://api.github.com/repos/${GH_REPO}/actions/runs/${RUN_ID}/artifacts" \
            | python3 -c "
import sys, json
arts = json.load(sys.stdin).get('artifacts', [])
wda = [a for a in arts if 'wda' in a['name'].lower()]
print(wda[0]['id'] if wda else '')
" 2>/dev/null || true)

        if [[ -n "$ARTIFACT_ID" ]]; then
            ok "GitHub artifact 발견 (run: $RUN_ID) → 다운로드 중..."
            curl -sfL -H "Authorization: token $GH_TOKEN" \
                "https://api.github.com/repos/${GH_REPO}/actions/artifacts/${ARTIFACT_ID}/zip" \
                -o "$ARTIFACT_DIR/wda_artifact.zip"
            unzip -q "$ARTIFACT_DIR/wda_artifact.zip" -d "$ARTIFACT_DIR/"
            XCTESTRUN=$(find "$ARTIFACT_DIR" -name "*.xctestrun" 2>/dev/null | head -1)
            GH_IPA=$(find "$ARTIFACT_DIR" -name "*.ipa" 2>/dev/null | head -1 || true)
            if [[ -n "$XCTESTRUN" ]]; then
                ok "GitHub artifact에서 xctestrun 획득: $(basename "$XCTESTRUN")"
            else
                warn "artifact에 xctestrun 없음. 로컬 빌드로 전환..."
                XCTESTRUN=""
            fi
        else
            warn "artifact ID를 찾을 수 없습니다. 로컬 빌드로 전환..."
        fi
    fi
fi

# ── 로컬 빌드 폴백 ──
# 어떤 단말이든 현재 연결된 기기 UDID로 자동 빌드
_build_for_device() {
    local udid="${1:-$UDID}"
    [[ -z "$WDA_DIR" ]] && die "WDA 소스를 찾을 수 없습니다. GH_REPO/GH_TOKEN을 설정하거나 appium을 설치하세요."
    local derived="$HOME/Library/Developer/Xcode/DerivedData/WDA_seyong_${udid:0:8}"
    mkdir -p "$derived"
    warn "기기 ${udid:0:8} 대상으로 build-for-testing 실행 (Team: $TEAM_ID)..."
    local bft_log="/tmp/wda_bft_$(date +%s).log"
    cd "$WDA_DIR"
    xcodebuild build-for-testing \
        -project WebDriverAgent.xcodeproj \
        -scheme WebDriverAgentRunner \
        -destination "id=${udid}" \
        -derivedDataPath "$derived" \
        -sdk iphoneos \
        DEVELOPMENT_TEAM="$TEAM_ID" \
        PRODUCT_BUNDLE_IDENTIFIER="${BUNDLE_PREFIX}.WebDriverAgentRunner" \
        CODE_SIGN_STYLE=Automatic \
        -allowProvisioningUpdates \
        -allowProvisioningDeviceRegistration \
        ONLY_ACTIVE_ARCH=NO \
        2>&1 | tee "$bft_log" \
        | grep -E "error:|TEST BUILD|FAILED|SUCCEED|Signing" | grep -v "note:" | tail -5
    cd - > /dev/null
    XCTESTRUN=$(_find_valid_xctestrun "$udid")
    if [[ -z "$XCTESTRUN" ]]; then
        echo "마지막 에러:"
        grep -E "error:|FAILED" "$bft_log" | tail -5
        die "build-for-testing 실패. 전체 로그: $bft_log"
    fi
    ok "xctestrun 생성: $(basename "$XCTESTRUN")"
}

# ──────────────────────────────────────────
# 5. IPA 설치
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 5: IPA 설치"
echo "══════════════════════════════════════════════"

PRODUCTS_DIR=$(dirname "$XCTESTRUN")
APP_PATH="$PRODUCTS_DIR/Debug-iphoneos/WebDriverAgentRunner-Runner.app"

# GitHub artifact에서 받은 IPA가 있으면 바로 사용
if [[ -n "$GH_IPA" && -f "$GH_IPA" ]]; then
    ok "GitHub artifact IPA 사용: $(du -sh "$GH_IPA" | cut -f1)"
    echo "iPhone에 WDA 설치 중..."
    xcrun devicectl device install app --device "$UDID" "$GH_IPA" 2>&1 | tail -3 \
        && ok "WDA 설치 완료" \
        || warn "설치 실패 (무시하고 계속 - 이미 설치된 경우 정상)"
elif [[ -d "$APP_PATH" ]]; then
    IPA_DIR="/tmp/wda_ipa_$(date +%s)"
    mkdir -p "$IPA_DIR/Payload"
    cp -R "$APP_PATH" "$IPA_DIR/Payload/"
    cd "$IPA_DIR"
    zip -qr WDA.ipa Payload/ --exclude "*.DS_Store"
    ok "IPA 생성: $(du -sh WDA.ipa | cut -f1)"
    echo "iPhone에 WDA 설치 중..."
    INSTALL_OUT=$(xcrun devicectl device install app --device "$UDID" "$IPA_DIR/WDA.ipa" 2>&1)
    INSTALL_EC=$?
    cd - > /dev/null
    if [[ $INSTALL_EC -eq 0 ]]; then
        ok "WDA 설치 완료"
    elif echo "$INSTALL_OUT" | grep -q "402620398\|ApplicationVerificationFailed"; then
        warn "프로비저닝 불일치 감지 (-402620398) → 현재 기기로 자동 재빌드 시작..."
        _build_for_device "$UDID"
        # 재빌드 후 .app 위치 갱신
        PRODUCTS_DIR=$(dirname "$XCTESTRUN")
        APP_PATH="$PRODUCTS_DIR/Debug-iphoneos/WebDriverAgentRunner-Runner.app"
        if [[ -d "$APP_PATH" ]]; then
            IPA_DIR2="/tmp/wda_ipa2_$(date +%s)"
            mkdir -p "$IPA_DIR2/Payload"
            cp -R "$APP_PATH" "$IPA_DIR2/Payload/"
            cd "$IPA_DIR2"
            zip -qr WDA.ipa Payload/ --exclude "*.DS_Store"
            xcrun devicectl device install app --device "$UDID" "$IPA_DIR2/WDA.ipa" 2>&1 | tail -3 \
                && ok "WDA 설치 완료 (재빌드 후)" \
                || warn "재설치도 실패 — xcodebuild test-without-building가 자체 설치 시도"
            cd - > /dev/null
        fi
    else
        warn "설치 실패 (이미 설치된 경우 정상)"
        echo "$INSTALL_OUT" | tail -3
    fi
else
    warn ".app 파일 없음 ($APP_PATH) - 설치 건너뜀"
fi

# ──────────────────────────────────────────
# 6. WDA 실행
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 6: WDA 실행"
echo "══════════════════════════════════════════════"

# 기존 WDA 프로세스 완전 종료 (Cannot initiate shared session more than once 방지)
echo "기존 WDA 프로세스 종료 중..."
# xcrun devicectl device process terminate 제거 (macOS 인증 프롬프트 발생)
pkill -f "xcodebuild.*xctestrun" 2>/dev/null || true
pkill -f "XCTRunner" 2>/dev/null || true
pkill -f iproxy 2>/dev/null || true
# 기기 side XCTestManager 세션 해제 대기
sleep 2
ok "기존 WDA 프로세스 종료 완료"

# USB면 iproxy 포트포워딩, 무선이면 WDA 로그의 디바이스 IP URL을 직접 사용
IPROXY_PID=""
if [[ "$CONN_MODE" == "usb" && -n "$OLD_UDID" ]]; then
    pkill -f iproxy 2>/dev/null || true
    sleep 0.5
    iproxy "$WDA_PORT" "$WDA_PORT" --udid "$OLD_UDID" > /dev/null 2>&1 &
    IPROXY_PID=$!
    ok "iproxy 포트포워딩 시작 (PID: $IPROXY_PID, localhost:${WDA_PORT} → device:${WDA_PORT})"
else
    ok "무선 연결 — iproxy 생략 (WDA URL은 디바이스 IP로 자동 감지)"
fi

WDA_LOG="/tmp/wda_${UDID:0:8}.log"

# ── 실행 엔진 선택: pymobiledevice3(iOS 17+ PersonalizedDDI 지원) vs xcodebuild ──
_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PMD3=$(find "$_PROJECT_ROOT/.venv" -name pymobiledevice3 2>/dev/null | head -1 || \
       command -v pymobiledevice3 2>/dev/null || true)
[[ -z "$PMD3" ]] && PMD3="$_PROJECT_ROOT/.venv/bin/pymobiledevice3"

# pymobiledevice3는 hardware UDID(libimobiledevice 형식) 필요
HW_UDID="${OLD_UDID:-}"

if [[ -x "$PMD3" && -n "$HW_UDID" ]]; then
    ok "pymobiledevice3 사용 → iOS 17+ PersonalizedDDI 우회 (HW_UDID: ${HW_UDID:0:8}...)"

    # iOS 17+: developer 명령에 tunneld 필수
    if ! pgrep -f "pymobiledevice3.*tunneld" >/dev/null 2>&1; then
        echo "tunneld 시작 중 (sudo 필요)..."
        sudo "$PMD3" remote tunneld > /tmp/tunneld.log 2>&1 &
        sleep 5
    else
        echo "tunneld 이미 실행 중"
    fi

    # IPA 재설치
    IPA_FOR_PMD3=$(ls -t /tmp/wda_ipa*/WDA.ipa /tmp/wda_ipa2*/WDA.ipa /tmp/wda_ipa_tidevice*/WDA.ipa 2>/dev/null | head -1 || true)
    if [[ -n "$IPA_FOR_PMD3" ]]; then
        echo "pymobiledevice3로 WDA 앱 재설치 중..."
        "$PMD3" apps install "$IPA_FOR_PMD3" --udid "$HW_UDID" 2>&1 | tail -3 || true
    fi
    # --target-bundle-id 미사용: runner(.xctrunner)만 설치됐을 때도 동작
    "$PMD3" developer dvt xcuitest \
        --udid "$HW_UDID" \
        --env USE_PORT="$WDA_PORT" \
        --env MJPEG_SERVER_PORT=9100 \
        "${BUNDLE_PREFIX}.WebDriverAgentRunner.xctrunner" \
        > "$WDA_LOG" 2>&1 &
    WDA_PID=$!
    echo "WDA 기동 중 (pymobiledevice3, PID: $WDA_PID, 로그: $WDA_LOG)"
else
    warn "pymobiledevice3 없음 또는 HW_UDID 없음 → xcodebuild fallback"
    xcodebuild test-without-building \
        -xctestrun "$XCTESTRUN" \
        -destination "id=${UDID}" > "$WDA_LOG" 2>&1 &
    WDA_PID=$!
    echo "WDA 기동 중 (xcodebuild, PID: $WDA_PID, 로그: $WDA_LOG)"
fi

# localhost:WDA_PORT 응답 대기 (최대 90초)
WDA_URL=""
for i in $(seq 1 90); do
    if curl -s --max-time 2 "http://localhost:${WDA_PORT}/status" 2>/dev/null | grep -q '"build"'; then
        WDA_URL="http://localhost:${WDA_PORT}"
        break
    fi
    # 로그에서 디바이스 IP 확인 (WiFi 연결 시 / tidevice 출력)
    URL=$(grep -oE "ServerURLHere->http://[^ <]+" "$WDA_LOG" 2>/dev/null | head -1 | sed 's/ServerURLHere->//')
    if [[ -n "$URL" ]]; then
        WDA_URL="$URL"
        break
    fi
    printf "  기다리는 중... ${i}s\r"
    sleep 1
done

echo ""
if [[ -z "$WDA_URL" ]]; then
    warn "WDA URL 자동 감지 실패. 로그 확인: tail -f $WDA_LOG"
else
    ok "WDA 기동 완료: $WDA_URL"

    # 응답 확인
    STATUS=$(curl -s --max-time 5 "${WDA_URL}/status" 2>/dev/null | python3 -c \
        "import sys,json; d=json.load(sys.stdin); print('ready=', d.get('value',{}).get('ready'))" 2>/dev/null || echo "파싱실패")
    ok "WDA 상태: $STATUS"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  WDA_URL = $WDA_URL"
    [[ -n "$IPROXY_PID" ]] && echo "  iproxy PID: $IPROXY_PID (포트포워딩 유지 중)"
    echo "  diag_tc02_call.py의 WDA_URL을 위 값으로 업데이트하세요."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

echo ""
ok "모든 단계 완료"
