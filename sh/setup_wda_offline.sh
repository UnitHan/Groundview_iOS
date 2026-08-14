#!/usr/bin/env bash
# =============================================================
# setup_wda_offline.sh  —  WDA 무선(Wi-Fi) 기동  (인터넷 불필요)
#
# 개발자 계정 : seyong park   /   Team ID: L78W862TSU
# Bundle      : com.seyong.1.WebDriverAgentRunner.xctrunner
#
# 동작 방식 (왜 인터넷/수동 신뢰가 필요 없는가):
#   1) pymobiledevice3(파이썬 3.13+) 의 RemoteXPC 터널을 같은 LAN 위에 만든다.
#      - iOS 18.2+/26 은 QUIC 제거 → TCP 터널 필요 → python3.13+ 필수.
#   2) 'developer dvt xcuitest' 가 testmanagerd(DDI) 경로로 WDA 를 기동한다.
#      - SpringBoard 의 개발자 인증서 신뢰(OCSP) 검사를 거치지 않으므로
#        오프라인에서도, 수동 '신뢰' 단계 없이도 실행된다.
#   3) WDA HTTP 서버(8100)는 기기 LAN IP 로 같은 Wi-Fi 에서 직접 접속된다.
#      - HTTP 트래픽 자체는 터널조차 필요 없다 (같은 네트워크면 충분).
#
# 전제:
#   - WDA 앱이 기기에 이미 설치되어 있을 것 (온라인에서 1회 설치).
#   - 개발자 모드 ON, DDI 마운트됨(ddiServicesAvailable).
#   - Mac 과 iPhone 이 같은 Wi-Fi(LAN) 에 있을 것.
#
# 사용법:
#   ./setup_wda_offline.sh                       # 기동(이미 떠있으면 재사용)
#   ./setup_wda_offline.sh --udid 00008140-...   # 대상 기기 지정
#   ./setup_wda_offline.sh --restart             # WDA 강제 재기동
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WDA_PORT="${WDA_PORT:-8100}"
SUDO_PASSWORD="${WDA_SUDO_PASSWORD:-1234}"
TUNNELD_PORT="${TUNNELD_PORT:-49151}"
VENV313="${WDA_VENV313:-${SCRIPT_DIR}/.venv313}"

FORCE_RESTART=false
DO_INSTALL=false
DO_REINSTALL=false
TARGET_UDID="${WDA_UDID:-}"
WDA_ACCOUNT="${WDA_ACCOUNT:-seyong}"   # seyong | jjun
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart)   FORCE_RESTART=true; shift ;;
    --install)   DO_INSTALL=true; shift ;;
    --reinstall) DO_REINSTALL=true; FORCE_RESTART=true; shift ;;
    --udid|-u)
      [[ $# -ge 2 ]] || { echo "❌ --udid 값이 필요합니다" >&2; exit 1; }
      TARGET_UDID="$2"; shift 2 ;;
    --udid=*) TARGET_UDID="${1#*=}"; shift ;;
    --account|-a)
      [[ $# -ge 2 ]] || { echo "❌ --account 값이 필요합니다 (seyong|jjun)" >&2; exit 1; }
      WDA_ACCOUNT="$2"; shift 2 ;;
    --account=*) WDA_ACCOUNT="${1#*=}"; shift ;;
    -h|--help)
      echo "사용법: ./setup_wda_offline.sh [--account seyong|jjun] [--udid UDID] [--install|--reinstall|--restart]"
      echo "  --account    계정 선택: seyong(기본) 또는 jjun"
      echo "  (옵션 없음) 기동 (이미 떠있으면 재사용)"
      echo "  --install    WDA 미설치면 IPA 설치 후 기동 (이미 설치돼 있으면 그대로)"
      echo "  --reinstall  기존 WDA 삭제 후 IPA 재설치 + 재기동"
      echo "  --restart    WDA 재기동만 (설치 변경 없음)"
      exit 0 ;;
    *) echo "❌ 알 수 없는 옵션: $1  (--help 참고)" >&2; exit 1 ;;
  esac
done

# ── 계정 프리셋 ──────────────────────────────────────────────────────
case "$WDA_ACCOUNT" in
  jjun)
    TEAM_ID="${WDA_TEAM_ID:-35597M53Y5}"
    BUNDLE_PREFIX="${WDA_BUNDLE_PREFIX:-com.jjun.1}"
    ARTIFACTS_DIR="${PROJECT_ROOT}/wda_artifacts_jjun"
    ;;
  seyong|*)
    WDA_ACCOUNT="seyong"
    TEAM_ID="${WDA_TEAM_ID:-L78W862TSU}"
    BUNDLE_PREFIX="${WDA_BUNDLE_PREFIX:-com.seyong.1}"
    ARTIFACTS_DIR="${PROJECT_ROOT}/wda_artifacts_seyong"
    ;;
esac
RUNNER_BUNDLE="${RUNNER_BUNDLE:-${BUNDLE_PREFIX}.WebDriverAgentRunner.xctrunner}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}" >&2; exit 1; }
info() { echo -e "${BLUE}ℹ️  $*${NC}"; }

# IPv4/IPv6 모두 안전하게 URL 구성 (IPv6 면 대괄호)
wda_url_for() {
  local host="$1"
  if [[ "$host" == *:* ]]; then echo "http://[${host}]:${WDA_PORT}"; else echo "http://${host}:${WDA_PORT}"; fi
}

# 특정 host 의 WDA /status 가 ready 인지 (raw json 출력, 실패 시 비어있음)
wda_status_json() {
  local host="$1" url
  url="$(wda_url_for "$host")"
  curl -g -sf --max-time 4 "${url}/status" 2>/dev/null | grep -q '"ready"' && \
    curl -g -sf --max-time 4 "${url}/status" 2>/dev/null || true
}

# tunneld REST 에서 대상 UDID 의 터널 주소/포트 추출  ("addr port" 출력)
get_tunnel_info() {
  local udid="$1"
  curl -sf --max-time 4 "http://127.0.0.1:${TUNNELD_PORT}/" 2>/dev/null | \
    python3 -c "
import sys, json
udid = '$udid'
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
items = d.get(udid) or d.get(udid.upper()) or d.get(udid.lower())
if not items:
    sys.exit(1)
it = items[0]
print(it.get('tunnel-address',''), it.get('tunnel-port',''))
" 2>/dev/null || true
}

# WDA /status 의 value.ios.ip (기기 LAN IP) 추출
wda_device_ip() {
  local host="$1" url
  url="$(wda_url_for "$host")"
  curl -g -sf --max-time 4 "${url}/status" 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['value'].get('ios',{}).get('ip',''))" 2>/dev/null || true
}

# ──────────────────────────────────────────
# STEP 1: 필수 도구 확인 (python3.13 pymobiledevice3)
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " WDA 무선 기동 (인터넷 불필요)"
echo " Team ID: $TEAM_ID  /  Port: $WDA_PORT"
echo "══════════════════════════════════════════════"
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 1: 필수 도구 확인"
echo "══════════════════════════════════════════════"

# python3.13+ 기반 pmd3 위치 결정
PMD3=""
PMD3_PY=""
if [[ -x "${VENV313}/bin/pymobiledevice3" ]]; then
  PMD3="${VENV313}/bin/pymobiledevice3"
  PMD3_PY="${VENV313}/bin/python"
fi

py_ge_313() {  # $1 = python 실행파일
  "$1" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3,13) else 1)' 2>/dev/null
}

# ① 프로젝트 루트 .venv 에 python3.13+ pymobiledevice3 가 있으면 재활용
if [[ -z "$PMD3" ]]; then
  MAIN_VENV="${PROJECT_ROOT}/.venv"
  if [[ -x "${MAIN_VENV}/bin/pymobiledevice3" ]] && py_ge_313 "${MAIN_VENV}/bin/python" 2>/dev/null; then
    PMD3="${MAIN_VENV}/bin/pymobiledevice3"
    PMD3_PY="${MAIN_VENV}/bin/python"
    ok ".venv (프로젝트 루트) 에서 pymobiledevice3 재활용"
  fi
fi

# ② .venv313 없으면: python3.13 으로 자동 생성 시도 (동시 실행 방지 잠금 포함)
if [[ -z "$PMD3" ]]; then
  PY313="$(command -v python3.13 2>/dev/null || echo /opt/homebrew/bin/python3.13)"
  if [[ -x "$PY313" ]]; then
    LOCK_FILE="/tmp/venv313_create.lock"
    warn ".venv313 없음 → python3.13 으로 생성 시도 (pip 설치에 인터넷 필요)"
    (
      exec 200>"$LOCK_FILE"
      flock -x 200
      # 잠금 획득 후 다시 확인 (다른 프로세스가 먼저 완료했을 수 있음)
      if [[ -x "${VENV313}/bin/pymobiledevice3" ]]; then
        echo "already done by another process"
      else
        rm -rf "$VENV313"   # 깨진 venv 완전히 제거 후 재생성
        "$PY313" -m venv "$VENV313" && \
          "${VENV313}/bin/pip" install --quiet --upgrade pip && \
          "${VENV313}/bin/pip" install --quiet pymobiledevice3 && \
          echo "VENV313_OK"
      fi
    )
    if [[ -x "${VENV313}/bin/pymobiledevice3" ]]; then
      PMD3="${VENV313}/bin/pymobiledevice3"
      PMD3_PY="${VENV313}/bin/python"
      ok ".venv313 생성 + pymobiledevice3 설치 완료"
    fi
  fi
fi

[[ -n "$PMD3" && -x "$PMD3" ]] || die "python3.13 기반 pymobiledevice3 없음\n  brew install python@3.13\n  python3.13 -m venv ${VENV313}\n  ${VENV313}/bin/pip install pymobiledevice3"
py_ge_313 "$PMD3_PY" || die "pymobiledevice3 가 python3.13+ 가 아님: $PMD3_PY\n  iOS 26 무선 터널(TCP)에는 python3.13+ 필요"

PMD3_VER="$("$PMD3" version 2>/dev/null || echo "?")"
ok "pymobiledevice3: $PMD3 (v${PMD3_VER}, $("$PMD3_PY" --version 2>&1))"
command -v iproxy >/dev/null 2>&1 && ok "iproxy 확인 (USB 폴백용, 선택)" || warn "iproxy 없음 (무선만 사용하면 무방)"

# ──────────────────────────────────────────
# STEP 2: 대상 기기(UDID) 결정
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 2: 대상 기기 확인"
echo "══════════════════════════════════════════════"

UDID="$TARGET_UDID"
if [[ -z "$UDID" ]]; then
  UDID="$(idevice_id -l 2>/dev/null | head -1 || true)"
fi
if [[ -z "$UDID" ]] && command -v xcrun >/dev/null 2>&1; then
  DEV_JSON=$(mktemp -t wda_devicectl.XXXXXX.json)
  if xcrun devicectl list devices --json-output "$DEV_JSON" &>/dev/null; then
    UDID=$(python3 -c "
import json
d=json.load(open('$DEV_JSON'))
for r in d.get('result',{}).get('devices',[]):
    hw=r.get('hardwareProperties',{})
    if 'iPhone' in hw.get('productType','') or 'iPad' in hw.get('productType',''):
        print(hw.get('udid','')); break
" 2>/dev/null)
  fi
  rm -f "$DEV_JSON"
fi
[[ -z "$UDID" ]] && die "iPhone 미감지\n  --udid 로 지정하거나, 같은 Wi-Fi 에 연결/페어링 상태를 확인하세요"
ok "UDID: $UDID"
UDID_SHORT="${UDID:0:8}"
URL_CACHE="${ARTIFACTS_DIR}/.last_wda_url_${UDID_SHORT}"

# ──────────────────────────────────────────
# STEP 3: 이미 기동된 WDA 확인 (재사용)
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 3: WDA 실행 상태 확인"
echo "══════════════════════════════════════════════"

WDA_URL=""
# 1) 캐시된 URL  2) 알려진 LAN IP 후보  로 빠르게 확인
CANDIDATES=()
[[ -n "${WDA_URL_OVERRIDE:-}" ]] && CANDIDATES+=("$WDA_URL_OVERRIDE")
[[ -f "$URL_CACHE" ]] && CANDIDATES+=("$(cat "$URL_CACHE" 2>/dev/null || true)")
for c in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
  [[ -z "$c" ]] && continue
  if curl -g -sf --max-time 3 "${c}/status" 2>/dev/null | grep -q '"ready"'; then
    WDA_URL="$c"; break
  fi
done

if [[ -n "$WDA_URL" ]] && [[ "$FORCE_RESTART" == false ]]; then
  VER=$(curl -g -sf --max-time 3 "${WDA_URL}/status" 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['value']['build']['version'])" 2>/dev/null || echo "?")
  ok "WDA 이미 실행 중 (버전: $VER)"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  WDA_URL = $WDA_URL"
  echo "  재기동:  ./setup_wda_offline.sh --udid $UDID --restart"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# ──────────────────────────────────────────
# STEP 4: RemoteXPC 터널(tunneld) 확보  — 같은 LAN 위, 인터넷 불필요
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 4: tunneld(RemoteXPC) 확보"
echo "══════════════════════════════════════════════"

TUNNELD_LOG="/tmp/wda_tunneld_${UDID_SHORT}.log"

tunneld_rest_up() { curl -sf --max-time 3 "http://127.0.0.1:${TUNNELD_PORT}/" >/dev/null 2>&1; }

start_tunneld() {
  info "tunneld 시작 (sudo 필요)..."
  # nohup 으로 분리하여 스크립트 종료 후에도 유지. sudo 비밀번호는 표준입력으로 주입.
  nohup bash -c "printf '%s\n' '$SUDO_PASSWORD' | sudo -S -p '' '$PMD3' remote tunneld" \
    > "$TUNNELD_LOG" 2>&1 &
  disown || true
  for i in $(seq 1 20); do
    tunneld_rest_up && return 0
    sleep 1
  done
  return 1
}

kill_tunneld() {
  printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' pkill -f "remote tunneld" 2>/dev/null || true
  sleep 2
}

# 기기 터널이 실제로 잡혔는지 폴링 (REST 응답만으론 부족 — 좀비 tunneld 판별)
wait_for_device_tunnel() {
  local timeout="$1"
  TUN_ADDR=""; TUN_PORT=""
  for i in $(seq 1 "$timeout"); do
    read -r TUN_ADDR TUN_PORT < <(get_tunnel_info "$UDID")
    [[ -n "$TUN_ADDR" ]] && return 0
    printf "  %2ds...\r" "$i"; sleep 1
  done
  return 1
}

# tunneld 확보: REST 가 떠 있어도, 며칠 방치되면 끊김 반복으로 '좀비'(REST는 응답하나
# 기기 터널을 더는 못 만드는 상태)가 될 수 있다. 따라서 REST 가 있으면 기기 터널을
# 짧게(20초) 확인하고, 안 잡히면 tunneld 를 재시작한 뒤 길게(90초) 다시 기다린다.
TUN_ADDR=""; TUN_PORT=""
if tunneld_rest_up; then
  ok "tunneld 실행 중 (REST :${TUNNELD_PORT}) — 기기 터널 확인"
  info "기기 터널 확인 (최대 20초)..."
  if wait_for_device_tunnel 20; then
    echo ""
  else
    echo ""
    warn "REST 는 응답하나 기기 터널 없음 → 좀비 tunneld 로 판단, 재시작합니다"
    kill_tunneld
    start_tunneld || { tail -15 "$TUNNELD_LOG" 2>/dev/null; die "tunneld 재기동 실패 (로그: $TUNNELD_LOG)"; }
    ok "tunneld 재기동 완료"
  fi
else
  start_tunneld || { tail -15 "$TUNNELD_LOG" 2>/dev/null; die "tunneld 기동 실패 (로그: $TUNNELD_LOG)"; }
  ok "tunneld 기동 완료"
fi

# 아직 터널 주소를 못 얻었으면 길게 대기 (무선 디스커버리는 콜드 스타트 시 60초+ 가능)
if [[ -z "$TUN_ADDR" ]]; then
  info "기기 터널 수립 대기 (최대 90초)..."
  wait_for_device_tunnel 90 || true
  echo ""
fi
[[ -z "$TUN_ADDR" ]] && { tail -20 "$TUNNELD_LOG" 2>/dev/null; die "기기 터널 미수립\n  iPhone 화면을 켜고(잠금 해제) 같은 Wi-Fi 인지 확인 후 재시도\n  (무선 터널은 화면이 꺼지면 절전으로 끊길 수 있습니다)"; }
ok "터널 수립: rsd ${TUN_ADDR}:${TUN_PORT}"

# ──────────────────────────────────────────
# STEP 5: WDA 설치 확인
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 5: WDA 설치 확인 / 설치"
echo "══════════════════════════════════════════════"

wda_is_installed() {
  "$PMD3" apps list --udid "$UDID" 2>/dev/null | grep -qF "$RUNNER_BUNDLE" && return 0
  xcrun devicectl device info apps --device "$UDID" 2>/dev/null | grep -qF "$RUNNER_BUNDLE" && return 0
  return 1
}

install_wda() {
  local ipa app target log
  ipa="${ARTIFACTS_DIR}/WDA.ipa"
  app="${ARTIFACTS_DIR}/Debug-iphoneos/WebDriverAgentRunner-Runner.app"
  [[ -f "$ipa" ]] || ipa="$(ls -t "${ARTIFACTS_DIR}"/*.ipa 2>/dev/null | head -1 || true)"
  log="/tmp/wda_install_${UDID_SHORT}.log"
  : > "$log"

  if [[ ! -f "$ipa" ]] && [[ ! -d "$app" ]]; then
    warn "설치 산출물 없음: ${ARTIFACTS_DIR}/WDA.ipa (또는 .app)"
    warn "Xcode 있는 Mac에서 ./build_wda_local.sh 로 빌드 후 wda_artifacts_seyong/ 에 복사하세요"
    return 1
  fi

  # 1) pmd3 apps install --tunnel (무선 — STEP4 터널 사용, 검증된 주 경로)
  if [[ -f "$ipa" ]]; then
    info "설치 시도 (pmd3 --tunnel, 무선): $(basename "$ipa")"
    if "$PMD3" apps install "$ipa" --tunnel "$UDID" >"$log" 2>&1; then
      grep -qiE "Installation succeed|100% Complete" "$log" && { ok "설치 완료 (pmd3 무선 터널)"; return 0; }
    fi
    warn "pmd3 --tunnel 설치 실패 → 다른 방법 시도 (로그: $log)"
  fi
  # 2) devicectl (CoreDevice 연결 시) — .app 우선
  if command -v xcrun >/dev/null 2>&1; then
    target=""
    [[ -d "$app" ]] && target="$app"
    [[ -z "$target" && -f "$ipa" ]] && target="$ipa"
    if [[ -n "$target" ]]; then
      info "설치 시도 (devicectl): $(basename "$target")"
      if xcrun devicectl device install app --device "$UDID" "$target" >>"$log" 2>&1; then
        ok "설치 완료 (devicectl)"; return 0
      fi
    fi
  fi
  # 3) ideviceinstaller (USB)
  if [[ -f "$ipa" ]] && command -v ideviceinstaller >/dev/null 2>&1; then
    info "설치 시도 (ideviceinstaller, USB): $(basename "$ipa")"
    if ideviceinstaller -u "$UDID" install "$ipa" >>"$log" 2>&1; then
      ok "설치 완료 (ideviceinstaller)"; return 0
    fi
  fi
  # 4) pmd3 apps install --udid (USB usbmux)
  if [[ -f "$ipa" ]]; then
    info "설치 시도 (pmd3 --udid, USB): $(basename "$ipa")"
    if "$PMD3" apps install "$ipa" --udid "$UDID" >>"$log" 2>&1; then
      grep -qiE "Installation succeed|100% Complete" "$log" && { ok "설치 완료 (pmd3 USB)"; return 0; }
    fi
  fi
  warn "WDA 설치 실패 — 로그: $log"
  return 1
}

uninstall_wda() {
  info "기존 WDA 삭제: $RUNNER_BUNDLE"
  "$PMD3" apps uninstall "$RUNNER_BUNDLE" --tunnel "$UDID" >/dev/null 2>&1 \
    || xcrun devicectl device uninstall app --device "$UDID" "$RUNNER_BUNDLE" >/dev/null 2>&1 \
    || "$PMD3" apps uninstall "$RUNNER_BUNDLE" --udid "$UDID" >/dev/null 2>&1 \
    || ideviceinstaller -u "$UDID" uninstall "$RUNNER_BUNDLE" >/dev/null 2>&1 || true
  sleep 2
}

if [[ "$DO_REINSTALL" == true ]]; then
  # 재설치 전에 실행 중인 WDA부터 정리 (파일 잠금/충돌 방지)
  pkill -f "developer dvt xcuitest.*${RUNNER_BUNDLE}" 2>/dev/null || true
  "$PMD3" developer dvt pkill "WebDriverAgentRunner-Runner" --tunnel "$UDID" 2>/dev/null || true
  sleep 2
  if wda_is_installed; then uninstall_wda; fi
  install_wda || die "WDA 재설치 실패 (로그: /tmp/wda_install_${UDID_SHORT}.log)"
  ok "WDA 재설치 완료"
elif wda_is_installed; then
  ok "WDA 설치 확인: $RUNNER_BUNDLE"
else
  warn "WDA 미설치: $RUNNER_BUNDLE"
  if [[ "$DO_INSTALL" == true ]]; then
    install_wda || die "WDA 설치 실패 (로그: /tmp/wda_install_${UDID_SHORT}.log)"
    ok "WDA 설치 완료"
    info "최초 설치라면 단말을 인터넷에 1회 연결해 두면 인증서 신뢰가 안정적으로 캐시됩니다."
  else
    die "WDA 미설치. 설치하려면 --install (또는 새로 받으려면 --reinstall) 로 실행하세요\n  예: ./setup_wda_offline.sh --udid $UDID --install"
  fi
fi

# ──────────────────────────────────────────
# STEP 6: WDA 기동 (dvt xcuitest, testmanagerd 경로 → 신뢰/OCSP 불필요)
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 6: WDA 기동 (xcuitest)"
echo "══════════════════════════════════════════════"

# 기존 WDA 완전 종료 + 기기 프로세스가 실제로 사라질 때까지 대기
ensure_wda_stopped() {
  pkill -f "developer dvt xcuitest.*${RUNNER_BUNDLE}" 2>/dev/null || true
  "$PMD3" developer dvt pkill "WebDriverAgentRunner-Runner" --tunnel "$UDID" 2>/dev/null || true
  # 기기 측 러너가 종료되어 /status 가 더는 응답하지 않을 때까지 (최대 10초)
  local u; u="$(wda_url_for "$TUN_ADDR")"
  for _ in $(seq 1 10); do
    curl -g -sf --max-time 2 "${u}/status" 2>/dev/null | grep -q '"ready"' || return 0
    sleep 1
  done
  return 0
}

launch_wda() {
  WDA_LOG="/tmp/wda_${UDID_SHORT}_$(date +%s).log"
  # 분리 실행: 스크립트가 끝나도 WDA 가 계속 떠 있어야 함
  nohup "$PMD3" developer dvt xcuitest \
    --tunnel "$UDID" \
    --env USE_PORT="$WDA_PORT" \
    "$RUNNER_BUNDLE" \
    > "$WDA_LOG" 2>&1 &
  WDA_PID=$!
  disown || true
}

# 강제 재기동 시 기존 WDA 정리
if [[ "$FORCE_RESTART" == true ]]; then
  info "기존 WDA 종료 대기..."
  ensure_wda_stopped
fi

# 런치 재시도: 기기 정리 직후 즉시 재실행하면 deviceprocesscontrolservice 가
# 'Failed to launch' 과도기 오류를 내는 경우가 있어, 곧바로 죽으면 정리 후 재시도한다.
WDA_PID=""
LAUNCHED=false
for attempt in 1 2 3; do
  info "WDA 런처 시작 (시도 ${attempt}/3)"
  launch_wda
  # 런치 성패는 보통 몇 초 안에 갈린다 — 5초 관찰
  sleep 5
  if kill -0 "$WDA_PID" 2>/dev/null; then
    ok "WDA 런처 기동 (PID: $WDA_PID, 로그: $WDA_LOG)"
    LAUNCHED=true
    break
  fi
  warn "런처가 곧바로 종료됨 (과도기 런치 충돌 추정)"
  grep -iE "failed to launch|DTXNsError" "$WDA_LOG" 2>/dev/null | head -2 || true
  ensure_wda_stopped
  sleep 3
done

if [[ "$LAUNCHED" == false ]]; then
  echo "WDA 로그 (마지막 25줄):"; tail -25 "$WDA_LOG" 2>/dev/null
  die "WDA 런치 3회 실패 — iPhone 화면을 켜고(잠금 해제) 재시도하세요\n  로그: $WDA_LOG"
fi

# ──────────────────────────────────────────
# STEP 7: WDA 응답 대기
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
WDA_WAIT_TIMEOUT="${WDA_WAIT_TIMEOUT:-90}"
echo " STEP 7: WDA 응답 대기 (최대 ${WDA_WAIT_TIMEOUT}초)"
echo "══════════════════════════════════════════════"

# 먼저 터널 IPv6 주소로 status 를 확인하고, 거기서 기기 LAN IP 를 얻는다.
WDA_URL=""
DEVICE_IP=""
for i in $(seq 1 "$WDA_WAIT_TIMEOUT"); do
  # 런처가 죽었는지 확인
  if ! kill -0 "$WDA_PID" 2>/dev/null; then
    echo ""
    warn "WDA 런처 프로세스 종료됨 (PID: $WDA_PID)"
    echo "WDA 로그 (마지막 25줄):"; tail -25 "$WDA_LOG" 2>/dev/null
    die "WDA 기동 실패 — 로그를 확인하세요: $WDA_LOG"
  fi

  if curl -g -sf --max-time 3 "$(wda_url_for "$TUN_ADDR")/status" 2>/dev/null | grep -q '"ready"'; then
    DEVICE_IP="$(wda_device_ip "$TUN_ADDR")"
    if [[ -n "$DEVICE_IP" ]] && curl -sf --max-time 3 "$(wda_url_for "$DEVICE_IP")/status" 2>/dev/null | grep -q '"ready"'; then
      WDA_URL="$(wda_url_for "$DEVICE_IP")"      # 순수 Wi-Fi 직접 경로 (권장)
    else
      WDA_URL="$(wda_url_for "$TUN_ADDR")"       # 터널 경유 폴백
    fi
    break
  fi
  printf "  %2ds...\r" "$i"; sleep 1
done
echo ""

if [[ -z "$WDA_URL" ]]; then
  echo "WDA 로그 (마지막 25줄):"; tail -25 "$WDA_LOG" 2>/dev/null
  warn "WDA 응답 없음 (${WDA_WAIT_TIMEOUT}초 타임아웃)"
  die "WDA 기동 실패"
fi

STATUS=$(curl -g -sf --max-time 5 "${WDA_URL}/status" 2>/dev/null | \
  python3 -c "import sys,json; v=json.load(sys.stdin)['value']; print(f\"ready={v.get('ready')}, version={v.get('build',{}).get('version','?')}\")" 2>/dev/null || echo "확인 불가")
ok "WDA 기동 완료"
ok "상태: $STATUS"
printf '%s\n' "$WDA_URL" > "$URL_CACHE" 2>/dev/null || true

# ──────────────────────────────────────────
# STEP 8: WDA 위치 권한 팝업 트리거 (세션 불필요 라우트)
# ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 8: WDA 위치 권한 팝업 트리거"
echo "══════════════════════════════════════════════"
_LOCATION_OK=false
_LOCATION_RESULT=$(python3 - "$WDA_URL" <<'PYEOF' 2>&1
import sys, json, urllib.request, urllib.error
wda_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8100"
try:
    req = urllib.request.Request(f"{wda_url}/wda/device/location", method="GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        val = json.loads(r.read()).get("value", {})
    s = val.get("authorizationStatus", -1)
    print("ALREADY_GRANTED" if s in (3,4) else "POPUP_TRIGGERED" if s == 0 else "DENIED" if s == 2 else f"AUTH_STATUS:{s}")
except urllib.error.URLError:
    print("WDA_NOT_RUNNING")
except Exception as e:
    print(f"ERR:{e}")
PYEOF
)
case "$_LOCATION_RESULT" in
  ALREADY_GRANTED) ok "위치 권한 이미 허용됨"; _LOCATION_OK=true ;;
  POPUP_TRIGGERED) ok "위치 권한 팝업 트리거됨 → iPhone 에서 '허용' 탭"; _LOCATION_OK=true ;;
  DENIED)          warn "위치 권한 거부 상태 → 설정에서 수동 허용 필요" ;;
  WDA_NOT_RUNNING) warn "WDA 미응답 → 위치 권한 수동 허용 필요" ;;
  *)               warn "위치 권한 트리거 결과: $_LOCATION_RESULT" ;;
esac
if [[ "$_LOCATION_OK" == false ]]; then
  echo "  📌 수동: 설정 → 개인정보 보호 및 보안 → 위치 서비스 → WebDriverAgentRunner → '앱을 사용하는 동안'"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WDA_URL    = $WDA_URL"
[[ -n "$DEVICE_IP" ]] && echo "  기기 LAN IP = $DEVICE_IP  (같은 Wi-Fi 에서 직접 접속)"
echo "  터널 rsd   = ${TUN_ADDR}:${TUN_PORT}"
echo "  WDA 로그   : tail -f $WDA_LOG"
echo "  tunneld    : tail -f $TUNNELD_LOG"
echo "  WDA PID    : $WDA_PID"
echo ""
echo "  ※ WDA/tunneld 는 백그라운드로 계속 실행됩니다 (스크립트 종료 후에도 유지)."
echo "  재기동:  ./setup_wda_offline.sh --udid $UDID --restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
