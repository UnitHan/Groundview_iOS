#!/bin/bash
# iOS 기기 시스템 로그 모니터링 (idevicesyslog)
# TC_03 실행 전 백그라운드로 시작하여 freeze 시점 원인 파악

IOS_UDID="${1:-00008140-0018481E118B001C}"
LOG_DIR="/Users/qa_tech/Documents/CallTestAgent/logs/ios_syslog"
mkdir -p "$LOG_DIR"

LOGFILE="$LOG_DIR/ios_syslog_$(date +%Y%m%d_%H%M%S).log"
START_EPOCH=$(date +%s)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " iOS 시스템 로그 캡처 (idevicesyslog)"
echo " 기기: $IOS_UDID"
echo " 시작: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 로그: $LOGFILE"
echo " [중지: Ctrl+C]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# aicallagent, SpringBoard, ReportCrash, jetsam, watchdog 관련 로그만 필터링하여 저장
# 전체 로그도 별도 저장
idevicesyslog -u "$IOS_UDID" 2>&1 | while IFS= read -r line; do
    NOW=$(date '+%H:%M:%S')
    T=$(( $(date +%s) - START_EPOCH ))
    TAGGED="[$NOW T+${T}s] $line"

    # 전체 로그 저장
    echo "$TAGGED" >> "$LOGFILE"

    # 중요 이벤트만 콘솔 출력 (aicallagent, crash, jetsam, watchdog, SpringBoard)
    if echo "$line" | grep -qiE "aicallagent|crash|jetsam|watchdog|SpringBoard|OOM|memorystatus|low memory|killed|exception|fault|assertion|died|freeze|hang|XCTest|WebDriverAgent"; then
        echo "$TAGGED"
    fi
done
