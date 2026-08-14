#!/bin/bash
# ============================================================
# WDA (WebDriverAgent) 응답 시간 실시간 모니터링
# 사용법: TC_03 실행 직전에 별도 터미널에서 실행
#   ./monitor_wda_health.sh
#   ./monitor_wda_health.sh 192.168.123.105 8100   # 기본값
# ============================================================

WDA_HOST="${1:-192.168.123.105}"
WDA_PORT="${2:-8100}"
WDA_URL="http://${WDA_HOST}:${WDA_PORT}/status"

LOG_DIR="/Users/qa_tech/Documents/CallTestAgent/logs/wda_health"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/wda_$(date +%Y%m%d_%H%M%S).log"

START_EPOCH=$(date +%s)   # 초 단위 시작 시각

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee "$LOG_FILE"
echo " WDA 모니터링: $WDA_URL" | tee -a "$LOG_FILE"
echo " 시작: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG_FILE"
echo " 로그: $LOG_FILE" | tee -a "$LOG_FILE"
echo " [중지: Ctrl+C]" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
printf "%-12s  %-7s  %-8s  %s\n" "TIME" "T+(s)" "RESP(s)" "STATUS" | tee -a "$LOG_FILE"
echo "──────────────────────────────────────────────────────" | tee -a "$LOG_FILE"

SLOW_THRESHOLD=1.0   # 1초 이상이면 SLOW 경고

while true; do
    NOW_EPOCH=$(date +%s)
    ELAPSED_S=$(( NOW_EPOCH - START_EPOCH ))
    TIME_STR=$(date '+%H:%M:%S')

    # WDA /status 요청 — max-time 5초
    RESP=$(curl -s -o /tmp/_wda_status_body.json \
               -w "%{http_code}|%{time_total}" \
               --max-time 5 \
               "$WDA_URL" 2>/dev/null)

    HTTP_CODE=$(echo "$RESP" | cut -d'|' -f1)
    RESP_TIME=$(echo "$RESP" | cut -d'|' -f2)
    # RESP_TIME이 비어있으면 5초 타임아웃으로 처리
    RESP_TIME="${RESP_TIME:-5.000}"

    IS_SLOW=$(awk "BEGIN { print ($RESP_TIME > $SLOW_THRESHOLD) ? 1 : 0 }")

    if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
        STATUS="❌ NO_RESPONSE (타임아웃 or 연결불가)"
    elif [ "$IS_SLOW" = "1" ]; then
        STATUS="⚠️  SLOW  ← 주목!"
    else
        STATUS="✅ OK"
    fi

    LINE=$(printf "%-12s  T+%-5s  %-8s  %s" "$TIME_STR" "${ELAPSED_S}s" "${RESP_TIME}s" "$STATUS")
    echo "$LINE" | tee -a "$LOG_FILE"

    sleep 1
done
