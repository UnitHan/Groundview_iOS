#!/bin/bash
# ============================================================
# WDA 감시 데몬 (wda_watchdog.sh)
# iPhone 연결 상태와 WDA 동작을 주기적으로 확인하고
# 문제 발생 시 자동으로 재기동합니다.
#
# 사용법:
#   ./wda_watchdog.sh start    # 백그라운드 감시 시작
#   ./wda_watchdog.sh stop     # 감시 중지
#   ./wda_watchdog.sh status   # 현재 상태 확인
#   ./wda_watchdog.sh once     # 1회 점검/복구
# ============================================================

# ── 설정 ──────────────────────────────────────────────────
WDA_PORT="${WDA_PORT:-8100}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"          # 점검 주기 (초)
MAX_SETUP_RETRIES="${MAX_SETUP_RETRIES:-3}"     # setup 재시도 최대 횟수
GH_REPO="${GH_REPO:-UnitHan/wda-build}"
GH_TOKEN="${GH_TOKEN:-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}"
GH_WORKFLOW="${GH_WORKFLOW:-build-wda.yml}"     # 트리거할 workflow 파일명

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SCRIPT="$SCRIPT_DIR/setup_wda_iphone.sh"
PID_FILE="/tmp/wda_watchdog.pid"
LOG_FILE="/tmp/wda_watchdog.log"
STATE_FILE="/tmp/wda_watchdog.state"           # last_ok / last_fail / last_build

# ── 색상 / 헬퍼 ───────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo -e "[$(ts)] $*" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}✅ $*${NC}"; }
warn() { log "${YELLOW}⚠️  $*${NC}"; }
err()  { log "${RED}❌ $*${NC}"; }
info() { log "${CYAN}ℹ️  $*${NC}"; }

# ── 상태 저장/읽기 ─────────────────────────────────────────
save_state() { echo "$1=$(ts)" >> "$STATE_FILE"; }
get_state()  { grep "^$1=" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

# ── iPhone + WDA 상태 점검 ─────────────────────────────────
check_iphone() {
    idevice_id -l 2>/dev/null | grep -q . && return 0 || return 1
}

check_wda() {
    curl -s --max-time 5 "http://localhost:${WDA_PORT}/status" 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['value']['build']['version'])" \
        2>/dev/null | grep -q . && return 0 || return 1
}

# ── setup_wda_iphone.sh 실행 ──────────────────────────────
run_setup() {
    info "setup_wda_iphone.sh 실행 중..."
    GH_REPO="$GH_REPO" GH_TOKEN="$GH_TOKEN" \
        bash "$SETUP_SCRIPT" >> "$LOG_FILE" 2>&1
    return $?
}

# ── GitHub Actions 빌드 트리거 ──────────────────────────────
trigger_gh_build() {
    info "GitHub Actions WDA 빌드 트리거 중..."
    local resp
    resp=$(curl -sf -X POST \
        -H "Authorization: token $GH_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches" \
        -d '{"ref":"main"}' 2>&1)
    if [[ $? -eq 0 ]]; then
        ok "빌드 트리거 성공. GitHub Actions 진행 중..."
        save_state "last_build"
        return 0
    else
        err "빌드 트리거 실패: $resp"
        return 1
    fi
}

# ── GitHub Actions 최신 빌드 완료 대기 ─────────────────────
wait_for_build() {
    info "빌드 완료 대기 중 (최대 10분)..."
    local i
    for i in $(seq 1 60); do
        sleep 10
        local status
        status=$(curl -sf -H "Authorization: token $GH_TOKEN" \
            "https://api.github.com/repos/${GH_REPO}/actions/runs?per_page=1" \
            | python3 -c "
import sys, json
runs = json.load(sys.stdin).get('workflow_runs', [])
if runs:
    r = runs[0]
    print(r.get('status',''), r.get('conclusion',''))
" 2>/dev/null || echo "")
        local run_status run_conclusion
        run_status=$(echo "$status" | awk '{print $1}')
        run_conclusion=$(echo "$status" | awk '{print $2}')

        if [[ "$run_status" == "completed" ]]; then
            if [[ "$run_conclusion" == "success" ]]; then
                ok "빌드 완료 (success)"
                return 0
            else
                err "빌드 실패 (conclusion: $run_conclusion)"
                return 1
            fi
        fi
        info "빌드 진행 중... ($((i * 10))초 경과)"
    done
    err "빌드 대기 시간 초과 (10분)"
    return 1
}

# ── 1회 점검+복구 로직 ─────────────────────────────────────
do_check() {
    local iphone_ok=0 wda_ok=0

    check_iphone && iphone_ok=1
    check_wda    && wda_ok=1

    if [[ $iphone_ok -eq 1 && $wda_ok -eq 1 ]]; then
        ok "iPhone ✓  WDA ✓  (포트 $WDA_PORT)"
        save_state "last_ok"
        return 0
    fi

    # 문제 감지 → 상세 로그
    [[ $iphone_ok -eq 0 ]] && warn "iPhone USB 연결 끊김"
    [[ $wda_ok -eq 0   ]] && warn "WDA 응답 없음 (포트 $WDA_PORT)"

    # iPhone 자체가 없으면 setup 의미 없음
    if [[ $iphone_ok -eq 0 ]]; then
        err "iPhone이 연결되지 않아 복구 불가. USB 연결을 확인하세요."
        save_state "last_fail"
        return 1
    fi

    # setup 재시도
    local attempt
    for attempt in $(seq 1 "$MAX_SETUP_RETRIES"); do
        warn "복구 시도 $attempt/$MAX_SETUP_RETRIES..."
        if run_setup; then
            ok "복구 성공 (시도 $attempt)"
            save_state "last_ok"
            return 0
        fi
        warn "setup 실패 (시도 $attempt)"
        sleep 5
    done

    # setup 계속 실패 → 온라인 빌드 트리거
    warn "로컬 복구 실패 → GitHub Actions 빌드 트리거"
    if trigger_gh_build && wait_for_build; then
        info "빌드 완료 → setup 재실행..."
        if run_setup; then
            ok "온라인 빌드 후 복구 성공"
            save_state "last_ok"
            return 0
        fi
    fi

    err "자동 복구 모두 실패. 수동 확인이 필요합니다."
    save_state "last_fail"
    return 1
}

# ── 감시 루프 ──────────────────────────────────────────────
watchdog_loop() {
    info "WDA 감시 데몬 시작 (PID: $$, 주기: ${CHECK_INTERVAL}초)"
    echo $$ > "$PID_FILE"
    while true; do
        do_check
        sleep "$CHECK_INTERVAL"
    done
}

# ── start / stop / status / once ──────────────────────────
CMD="${1:-once}"

case "$CMD" in
    start)
        if [[ -f "$PID_FILE" ]]; then
            OLD_PID=$(cat "$PID_FILE")
            if kill -0 "$OLD_PID" 2>/dev/null; then
                echo -e "${YELLOW}이미 실행 중입니다 (PID: $OLD_PID). 'stop' 먼저 실행하세요.${NC}"
                exit 1
            fi
        fi
        nohup bash "$0" _loop >> "$LOG_FILE" 2>&1 &
        echo -e "${GREEN}✅ WDA 감시 데몬 시작됨 (PID: $!, 로그: $LOG_FILE)${NC}"
        ;;
    stop)
        if [[ -f "$PID_FILE" ]]; then
            PID=$(cat "$PID_FILE")
            if kill "$PID" 2>/dev/null; then
                echo -e "${GREEN}✅ 감시 데몬 중지됨 (PID: $PID)${NC}"
                rm -f "$PID_FILE"
            else
                echo -e "${YELLOW}프로세스 없음 (pid 파일만 정리)${NC}"
                rm -f "$PID_FILE"
            fi
        else
            echo -e "${YELLOW}실행 중인 감시 데몬이 없습니다.${NC}"
        fi
        ;;
    status)
        echo "══════════════════════════════════════════"
        echo " WDA 감시 데몬 상태"
        echo "══════════════════════════════════════════"
        if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo -e "${GREEN}● 실행 중 (PID: $(cat "$PID_FILE"))${NC}"
        else
            echo -e "${RED}● 중지됨${NC}"
        fi
        echo ""
        echo "마지막 정상:  $(get_state last_ok  || echo '-')"
        echo "마지막 실패:  $(get_state last_fail || echo '-')"
        echo "마지막 빌드:  $(get_state last_build || echo '-')"
        echo ""
        echo "── 현재 iPhone/WDA 상태 ──"
        if check_iphone; then
            UDID=$(idevice_id -l 2>/dev/null | head -1)
            DNAME=$(ideviceinfo -u "$UDID" --key DeviceName 2>/dev/null || echo "?")
            echo -e "${GREEN}  iPhone ✓ ($DNAME / $UDID)${NC}"
        else
            echo -e "${RED}  iPhone ✗ (연결 없음)${NC}"
        fi
        if check_wda; then
            WDA_VER=$(curl -s --max-time 5 "http://localhost:${WDA_PORT}/status" \
                | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['value']['build']['version'])" 2>/dev/null)
            echo -e "${GREEN}  WDA ✓ (v${WDA_VER}, 포트 $WDA_PORT)${NC}"
        else
            echo -e "${RED}  WDA ✗ (응답 없음)${NC}"
        fi
        echo "══════════════════════════════════════════"
        ;;
    once)
        do_check
        ;;
    _loop)
        watchdog_loop
        ;;
    *)
        echo "사용법: $0 {start|stop|status|once}"
        exit 1
        ;;
esac
