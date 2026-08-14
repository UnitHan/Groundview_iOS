#!/bin/zsh
# ================================================================
# monitor_oom.sh — 999회 장기 테스트 실시간 모니터링
# 사용법: chmod +x monitor_oom.sh && ./monitor_oom.sh
# ================================================================
DB="/Users/qa_tech/Library/Application Support/com.qabulls.call/ixio_results.db"
LOG_OUT="./logs/oom_monitor_$(date +%Y%m%d_%H%M%S).log"

mkdir -p ./logs

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_OUT"; }

# ── 현재 세션 ID 추적 (가장 최근 세션)
get_session() {
  sqlite3 "$DB" "SELECT session_id FROM tc_sessions ORDER BY started_at DESC LIMIT 1;" 2>/dev/null
}

to_epoch_utc() {
  local iso="$1"
  [[ -z "$iso" ]] && { echo 0; return; }
  # DB 시각은 UTC ISO 문자열(예: 2026-05-12T09:13:14.527Z)
  local base="${iso%Z}"
  base="${base%.*}"
  date -u -j -f "%Y-%m-%dT%H:%M:%S" "$base" +%s 2>/dev/null || echo 0
}

# ── DB 카운트 vs 현재 세션 집계
print_db_stats() {
  local sid
  sid=$(get_session)
  [[ -z "$sid" ]] && { log "❗ DB에 세션 없음"; return; }

  sqlite3 "$DB" "
    SELECT
      s.repeat_count,
      s.started_at,
      s.finished_at,
      COUNT(r.run_id) as total,
      COALESCE(SUM(CASE WHEN r.status='PASS'  THEN 1 ELSE 0 END), 0) as pass,
      COALESCE(SUM(CASE WHEN r.status='FAIL'  THEN 1 ELSE 0 END), 0) as fail,
      COALESCE(SUM(CASE WHEN r.status='ERROR' THEN 1 ELSE 0 END), 0) as err,
      MAX(r.started_at) as last_at
    FROM tc_sessions s
    LEFT JOIN tc_results r ON r.session_id = s.session_id
    WHERE s.session_id='$sid'
    GROUP BY s.session_id;
  " 2>/dev/null | while IFS='|' read -r repeat_count started_at finished_at total pass fail err last_at; do
    local state="RUNNING"
    [[ -n "$finished_at" ]] && state="DONE"
    [[ -z "$last_at" ]] && last_at="-"
    log "📊 DB 현황 [${sid:0:8}] $state total=$total/${repeat_count:-?}  PASS=$pass  FAIL=$fail  ERROR=$err  start=$started_at  last=$last_at"
  done
}

# ── 앱/WebContent 메모리 사용량
print_mem() {
  local app_pid app_mem
  app_pid=$(pgrep -f "target/debug/sound-test-app|/sound-test-app$|qa-bulls-call-test" 2>/dev/null | head -1)
  if [[ -z "$app_pid" ]]; then
    log "🔴 앱 프로세스 없음 (sound-test-app 종료됨)"
  else
    app_mem=$(ps -o rss= -p "$app_pid" 2>/dev/null | awk '{printf "%.0f", $1/1024}')
    log "🟢 App[$app_pid] 메모리: ${app_mem:-0}MB"
  fi

  local web_pids
  web_pids=(${(f)"$(pgrep -f "com.apple.WebKit.WebContent" 2>/dev/null)"})
  if [[ ${#web_pids[@]} -eq 0 ]]; then
    log "ℹ️  WebContent 프로세스 없음"
    return
  fi

  local pid rss total_mb=0
  for pid in $web_pids; do
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{print int($1/1024)}')
    [[ -n "$rss" ]] && total_mb=$((total_mb + rss))
  done
  local mem_mb=$total_mb
  if [[ "$mem_mb" -gt 3000 ]]; then
    log "🔴 WebContent[${#web_pids[@]}개] 메모리 경고: ${mem_mb}MB (>3GB)"
  elif [[ "$mem_mb" -gt 1500 ]]; then
    log "🟡 WebContent[${#web_pids[@]}개] 메모리 주의: ${mem_mb}MB"
  else
    log "🟢 WebContent[${#web_pids[@]}개] 메모리: ${mem_mb}MB"
  fi
}

# ── 시스템 로그에서 OOM 이벤트 감지 (백그라운드)
start_oom_watcher() {
  log "👀 OOM 감시 시작 (system log 스트리밍)..."
  log stream \
    --predicate 'eventMessage CONTAINS "ExceededMemoryLimit"' \
    --level error 2>/dev/null | tail -n +2 | grep --line-buffered "ExceededMemoryLimit" | while read -r line; do
    echo "[$(date '+%H:%M:%S')] 🚨 OOM 감지: $line" | tee -a "$LOG_OUT"
  done &
  OOM_WATCHER_PID=$!
  log "OOM 감시 PID: $OOM_WATCHER_PID"
}

# ── DB 적재 지연 감지 (마지막 기록이 N분 이상 없으면 경고)
check_db_lag() {
  local sid started_at finished_at last_at
  sid=$(get_session)
  [[ -z "$sid" ]] && return

  IFS='|' read -r started_at finished_at last_at <<< "$(sqlite3 "$DB" "
    SELECT s.started_at, COALESCE(s.finished_at, ''), COALESCE(MAX(r.started_at), '')
    FROM tc_sessions s
    LEFT JOIN tc_results r ON r.session_id = s.session_id
    WHERE s.session_id='$sid'
    GROUP BY s.session_id;
  " 2>/dev/null)"

  if [[ -n "$finished_at" ]]; then
    log "ℹ️  최신 세션 종료됨: ${finished_at} (DB 적재 지연 감시 대기)"
    return
  fi

  local basis_at="$last_at"
  local basis_label="마지막 결과"
  if [[ -z "$basis_at" ]]; then
    basis_at="$started_at"
    basis_label="세션 시작"
  fi
  [[ -z "$basis_at" ]] && return

  local now_utc last_epoch lag_min
  now_utc=$(date -u +%s)
  last_epoch=$(to_epoch_utc "$basis_at")
  [[ "$last_epoch" -le 0 ]] && { log "⚠️  DB 시각 파싱 실패: $basis_at"; return; }
  lag_min=$(( (now_utc - last_epoch) / 60 ))

  if [[ "$lag_min" -gt 15 ]]; then
    log "⚠️  DB 적재 지연: ${basis_label}로부터 ${lag_min}분 경과 (테스트 멈춤 또는 JS 동결 의심)"
  else
    log "✅ DB 적재 정상: ${basis_label} ${lag_min}분 전"
  fi
}

# ── 메인 루프
trap 'log "모니터 종료"; kill $OOM_WATCHER_PID 2>/dev/null; exit 0' INT TERM

log "================================================================"
log "모니터링 시작 — DB: $DB"
log "로그 출력: $LOG_OUT"
log "================================================================"

start_oom_watcher

INTERVAL=120  # 2분마다 체크
COUNT=0
while true; do
  COUNT=$((COUNT + 1))
  log "── 체크 #${COUNT} ──────────────────────────────────"
  print_mem
  print_db_stats
  check_db_lag
  sleep $INTERVAL
done
