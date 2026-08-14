#!/usr/bin/env bash
# =============================================================
# build_wda_local.sh  —  WDA IPA 오프라인 빌드
#
# 계정 선택:
#   기본 (seyong): Team L78W862TSU / com.seyong.1  →  bash build_wda_local.sh
#   jjun 계정:    Team 35597M53Y5 / com.jjun.1    →  bash build_wda_local.sh --account jjun
#
# 사용법:
#   ./build_wda_local.sh                         # seyong 계정, UDID 자동 감지
#   ./build_wda_local.sh --account jjun           # jjun 계정
#   ./build_wda_local.sh --force                  # 강제 재빌드
#   ./build_wda_local.sh --export-only            # 기존 .app → IPA만 패키징
#   ./build_wda_local.sh --account jjun --force   # jjun 계정 강제 재빌드
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CERTS_DIR="${PROJECT_ROOT}/certs"
PP_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"

FORCE_BUILD=false
EXPORT_ONLY=false
TARGET_UDID="${WDA_UDID:-}"
WDA_ACCOUNT="${WDA_ACCOUNT:-seyong}"   # seyong | jjun
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)       FORCE_BUILD=true; shift ;;
    --export-only) EXPORT_ONLY=true; shift ;;
    --udid|-u)
      [[ $# -ge 2 ]] || { echo "❌ --udid 값이 필요합니다" >&2; exit 1; }
      TARGET_UDID="$2"; shift 2 ;;
    --udid=*)
      TARGET_UDID="${1#*=}"; shift ;;
    --account|-a)
      [[ $# -ge 2 ]] || { echo "❌ --account 값이 필요합니다 (seyong|jjun)" >&2; exit 1; }
      WDA_ACCOUNT="$2"; shift 2 ;;
    --account=*)
      WDA_ACCOUNT="${1#*=}"; shift ;;
    *)
      echo "❌ 알 수 없는 옵션: $1  (--account seyong|jjun)" >&2; exit 1 ;;
  esac
done

# ── 계정 프리셋 ──────────────────────────────────────────────────────
case "$WDA_ACCOUNT" in
  jjun)
    TEAM_ID="${WDA_TEAM_ID:-35597M53Y5}"
    BUNDLE_PREFIX="${WDA_BUNDLE_PREFIX:-com.jjun.1}"
    CERT_IDENTITY="Apple Development: SeongJun Choi"
    ARTIFACTS_DIR="${PROJECT_ROOT}/wda_artifacts_jjun"
    ;;
  seyong|*)
    WDA_ACCOUNT="seyong"
    TEAM_ID="${WDA_TEAM_ID:-L78W862TSU}"
    BUNDLE_PREFIX="${WDA_BUNDLE_PREFIX:-com.seyong.1}"
    CERT_IDENTITY="Apple Development: seyong park"
    ARTIFACTS_DIR="${PROJECT_ROOT}/wda_artifacts_seyong"
    ;;
esac
mkdir -p "$ARTIFACTS_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}" >&2; exit 1; }
info() { echo -e "${BLUE}ℹ️  $*${NC}"; }

mkdir -p "$ARTIFACTS_DIR"


# ── STEP 1: iPhone 연결 확인 ───────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 1: iPhone 연결 확인"
echo "══════════════════════════════════════════════"

# 연결된 전체 기기 수집 (TARGET_UDID 지정 시 해당 기기만)
ALL_UDIDS=()
if [[ -n "$TARGET_UDID" ]]; then
  ALL_UDIDS=("$TARGET_UDID")
else
  while IFS= read -r _u; do
    [[ -n "$_u" ]] && ALL_UDIDS+=("$_u")
  done < <(idevice_id -l 2>/dev/null || true)
  # devicectl fallback
  if [[ ${#ALL_UDIDS[@]} -eq 0 ]]; then
    while IFS= read -r _u; do
      [[ -n "$_u" ]] && ALL_UDIDS+=("$_u")
    done < <(xcrun devicectl list devices 2>/dev/null \
      | grep -i "connected" \
      | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' || true)
  fi
fi

[[ ${#ALL_UDIDS[@]} -eq 0 ]] && die "iPhone 미감지\n  USB로 연결 후 '이 컴퓨터를 신뢰' 탭 → 재시도"
UDID="${ALL_UDIDS[0]}"   # 기기 정보 조회용 대표 UDID
ok "감지된 기기 ${#ALL_UDIDS[@]}대: ${ALL_UDIDS[*]}"

# ── STEP 2: 기기 잊금 해제 + 빌드 허용 확인 ─────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 2: 기기 상태 확인 (잊금 해제 + Developer Mode)"
echo "══════════════════════════════════════════════"

DEVICE_NAME=$(ideviceinfo -u "$UDID" -k DeviceName 2>/dev/null || echo "")
IOS_VER=$(ideviceinfo -u "$UDID" -k ProductVersion 2>/dev/null || echo "")
if [[ -z "$DEVICE_NAME" ]] && command -v xcrun &>/dev/null; then
  DEV_JSON=$(mktemp -t wda_build_devicectl.XXXXXX.json)
  if xcrun devicectl list devices --json-output "$DEV_JSON" &>/dev/null; then
    PARSED=$(python3 -c "
import json
target='$UDID'.upper()
d=json.load(open('$DEV_JSON'))
for r in d.get('result',{}).get('devices',[]):
    hw=r.get('hardwareProperties',{})
    if hw.get('udid','').upper()!=target:
        continue
    dp=r.get('deviceProperties',{})
    print(f\"{dp.get('name','iPhone')}|{dp.get('osVersionNumber','18.0')}\")
    break
" 2>/dev/null || true)
    if [[ -n "$PARSED" ]]; then
      DEVICE_NAME=$(echo "$PARSED" | cut -d'|' -f1)
      IOS_VER=$(echo "$PARSED" | cut -d'|' -f2)
      warn "lockdownd 접근 불가 → devicectl 기기 정보로 진행"
    fi
  fi
  rm -f "$DEV_JSON"
fi
if [[ -z "$DEVICE_NAME" ]]; then
  die "기기 접근 불가\n  - iPhone 화면을 잠금 해제하고\n  - '이 컴퓨터를 신뢰하겠습니까?' → 신뢰 탭 후 재시도\n  - 두 대 연결 시 --udid 로 대상 지정"
fi
ok "기기: $DEVICE_NAME"

IOS_VER="${IOS_VER:-0.0}"
IOS_MAJOR=$(echo "$IOS_VER" | cut -d. -f1)
ok "iOS: $IOS_VER"

# iOS 16+ Developer Mode 확인
if [[ "$IOS_MAJOR" -ge 16 ]]; then
  DEV_STATUS=$(ideviceinfo -u "$UDID" -k DeveloperModeStatus 2>/dev/null || echo "unknown")
  if [[ "$DEV_STATUS" == "disabled" ]]; then
    die "Developer Mode 비활성화\n  설정 → 개인 정보 보호 및 보안 → 개발자 모드 → 켜기 (재부팅 필요)"
  fi
  [[ "$DEV_STATUS" != "unknown" ]] && ok "Developer Mode: $DEV_STATUS" || \
    info "Developer Mode 상태 미확인 (iOS $IOS_VER, 빌드 계속)"
fi

# ── STEP 3: 기존 산출물 유효성 확인 ──────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 3: 기존 산출물 확인"
echo "══════════════════════════════════════════════"

EXISTING_IPA="${ARTIFACTS_DIR}/WDA.ipa"
EXISTING_XCTESTRUN=$(find "$ARTIFACTS_DIR" -name "*.xctestrun" 2>/dev/null | head -1 || true)

if [[ "$FORCE_BUILD" == false && "$EXPORT_ONLY" == false ]] && \
   [[ -f "$EXISTING_IPA" ]] && [[ -n "$EXISTING_XCTESTRUN" ]]; then
  IPA_DATE=$(date -r "$EXISTING_IPA" "+%Y-%m-%d %H:%M" 2>/dev/null || echo "unknown")
  ok "IPA: $EXISTING_IPA  ($(du -sh "$EXISTING_IPA" | cut -f1), 빌드: $IPA_DATE)"
  ok "xctestrun: $(basename "$EXISTING_XCTESTRUN")"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  info "유효한 산출물 존재 → 재빌드 불필요, 설치 진행"
  echo "  재빌드: ./build_wda_local.sh --force"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # STEP 8로 바로 점프 (빌드/패키징 스킵)
  _SKIP_TO_INSTALL=true
fi

if [[ "${_SKIP_TO_INSTALL:-false}" == false ]]; then

# wda_artifacts_seyong/ 에 산출물이 없더라도 기존 DerivedData 에서 탐색.
# 다른 TEAM_ID / 폴더명으로 빌드된 산출물도 재사용 가능.
if [[ "$FORCE_BUILD" == false && "$EXPORT_ONLY" == false ]]; then
  UDID_SHORT="${UDID:0:8}"
  DD_XCTESTRUN=$(find "$HOME/Library/Developer/Xcode/DerivedData" \
    -maxdepth 5 \
    \( -path "*${UDID_SHORT}*" -o -path "*${UDID}*" \) \
    -name "*.xctestrun" 2>/dev/null | head -1 || true)
  if [[ -n "$DD_XCTESTRUN" ]]; then
    DD_DIR=$(dirname "$(dirname "$DD_XCTESTRUN")")   # .../Build
    DD_APP=$(find "$(dirname "$DD_XCTESTRUN")" -name "WebDriverAgentRunner-Runner.app" \
      -not -path "*simulator*" 2>/dev/null | head -1 || true)
    ok "기존 빌드 산출물 발견 (DerivedData): $(basename "$DD_XCTESTRUN")"
    ok "  경로: $DD_XCTESTRUN"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "DerivedData 기존 빌드 재사용 → xcodebuild 스킵"
    echo "  강제 재빌드: ./build_wda_local.sh --udid $UDID --force"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    XCTESTRUN="$DD_XCTESTRUN"
    APP_PATH="${DD_APP:-}"
    # IPA 패키징 단계로 점프 (STEP 6 빌드 건너뜀)
    EXPORT_ONLY=true
  fi
fi


# ── STEP 4: WDA 소스 확인 ─────────────────────────────────────────
if [[ "$EXPORT_ONLY" == false ]]; then
  echo ""
  echo "══════════════════════════════════════════════"
  echo " STEP 4: WDA 소스 확인"
  echo "══════════════════════════════════════════════"
  WDA_DIR=$(find ~/.appium -name "appium-webdriveragent" -maxdepth 8 -type d 2>/dev/null | head -1 || true)
  [[ -z "$WDA_DIR" ]] && die "WDA 소스 없음\n  npm install -g appium && appium driver install xcuitest"
  ok "WDA 소스: $WDA_DIR"

  # 배포 타겟 패치 (Xcode 26 이상 → iOS 16.0)
  PBXPROJ="$WDA_DIR/WebDriverAgent.xcodeproj/project.pbxproj"
  if grep -qE "IPHONEOS_DEPLOYMENT_TARGET = 2[0-9]\." "$PBXPROJ" 2>/dev/null; then
    cp "$PBXPROJ" "${PBXPROJ}.bak"
    sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 2[0-9]\.[0-9]*;/IPHONEOS_DEPLOYMENT_TARGET = 16.0;/g' "$PBXPROJ"
    ok "배포 타겟 패치 완료 → 16.0"
  fi
fi

# ── STEP 5: 인증서 확인 (로컈 우선, 없으면 키체인) ────────────
# EXPORT_ONLY(DerivedData 재사용 포함) 시 코드 서명 불필요 → 스킵
if [[ "$EXPORT_ONLY" == false ]]; then
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 5: 코드 서명 인증서 확인"
echo "══════════════════════════════════════════════"

# 로컈 p12가 있고 키체인에 없으면 임포트
LOCAL_P12="${CERTS_DIR}/developer.p12"
if [[ -f "$LOCAL_P12" ]]; then
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -qi "Apple Development"; then
    warn "키체인에 인증서 없음 → 로컈 p12 임포트 시도..."
    bash "${CERTS_DIR}/import_certs.sh"
  fi
fi

CERT=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -i "$CERT_IDENTITY" | grep -v "REVOKED\|expired" | head -1 || true)
# fallback: 계정 무관 첫 번째 Apple Development 인증서
[[ -z "$CERT" ]] && CERT=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -i "Apple Development" | grep -v "REVOKED\|expired" | head -1 || true)
[[ -z "$CERT" ]] && die "Apple Development 인증서 없음\n  bash certs/export_certs.sh (연결 후 bash certs/import_certs.sh)"
ok "계정: $WDA_ACCOUNT  인증서: $CERT"

# 프로비저닝 프로파일 확인 + 로컈 임포트
PP_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
LOCAL_PP="${CERTS_DIR}/developer.mobileprovision"

INSTALLED_PP=$(while IFS= read -r f; do
  security cms -D -i "$f" 2>/dev/null | grep -q "$BUNDLE_PREFIX" && echo "$f"
done < <(ls "$PP_DIR"/*.mobileprovision 2>/dev/null || true) | head -1 || true)

if [[ -z "$INSTALLED_PP" ]] && [[ -f "$LOCAL_PP" ]]; then
  warn "프로파일 미설치 → 로컈 파일 임포트"
  PP_UUID=$(/usr/libexec/PlistBuddy -c "Print :UUID" \
    <(security cms -D -i "$LOCAL_PP" 2>/dev/null) 2>/dev/null || echo "wda_seyong")
  mkdir -p "$PP_DIR"
  cp "$LOCAL_PP" "$PP_DIR/${PP_UUID}.mobileprovision"
  INSTALLED_PP="$PP_DIR/${PP_UUID}.mobileprovision"
  ok "프로파일 임포트: ${PP_UUID}.mobileprovision"
fi

NEED_NETWORK=true
if [[ -n "$INSTALLED_PP" ]]; then
  ok "프로파일: $(basename "$INSTALLED_PP")"
  if security cms -D -i "$INSTALLED_PP" 2>/dev/null | grep -q "$UDID"; then
    ok "기기 UDID 프로파일 포함 확인 → 오프라인 빌드 가능"
    NEED_NETWORK=false
  else
    warn "기기 UDID가 프로파일에 없음 → 최초 1회 인터넷 연결 필요 (UDID 자동 등록)"
  fi
else
  warn "프로파일 없음 → 빌드 시 자동 생성 (인터넷 필요)"
fi
fi  # EXPORT_ONLY == false (STEP 5)
NEED_NETWORK="${NEED_NETWORK:-true}"   # EXPORT_ONLY 스킵 시 기본값

# ── STEP 6: build-for-testing ─────────────────────────────────────
if [[ "$EXPORT_ONLY" == false ]]; then
  echo ""
  echo "══════════════════════════════════════════════"
  echo " STEP 6: build-for-testing"
  echo "══════════════════════════════════════════════"

  DERIVED="${HOME}/Library/Developer/Xcode/DerivedData/WDA_${TEAM_ID}"
  mkdir -p "$DERIVED"
  BUILD_LOG="/tmp/wda_build_$(date +%s).log"
  info "로그: $BUILD_LOG"

  # 서명 방식 결정
  SIGN_STYLE="Automatic"
  PP_SPEC_ARG=""
  PROV_UPDATE_ARGS=()

  if [[ "$NEED_NETWORK" == false ]] && [[ -n "$INSTALLED_PP" ]]; then
    PP_UUID=$(/usr/libexec/PlistBuddy -c "Print :UUID" \
      <(security cms -D -i "$INSTALLED_PP" 2>/dev/null) 2>/dev/null || echo "")
    if [[ -n "$PP_UUID" ]]; then
      SIGN_STYLE="Manual"
      PP_SPEC_ARG="PROVISIONING_PROFILE_SPECIFIER=${PP_UUID}"
      info "오프라인 모드: Manual 서명, 프로파일 UUID=$PP_UUID"
    fi
  else
    PROV_UPDATE_ARGS=(-allowProvisioningUpdates -allowProvisioningDeviceRegistration)
    info "온라인 모드: 기기 UDID 자동 등록 활성화"
  fi

  cd "$WDA_DIR"
  set +e
  # shellcheck disable=SC2086
  xcodebuild build-for-testing \
    -project WebDriverAgent.xcodeproj \
    -scheme WebDriverAgentRunner \
    -destination "generic/platform=iOS" \
    -derivedDataPath "$DERIVED" \
    -sdk iphoneos \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    PRODUCT_BUNDLE_IDENTIFIER="${BUNDLE_PREFIX}.WebDriverAgentRunner" \
    CODE_SIGN_STYLE="${SIGN_STYLE}" \
    CODE_SIGN_IDENTITY="Apple Development" \
    ${PP_SPEC_ARG} \
    "${PROV_UPDATE_ARGS[@]}" \
    ONLY_ACTIVE_ARCH=NO \
    2>&1 | tee "$BUILD_LOG" | \
    grep -E "BUILD|error:|SUCCEEDED|FAILED|Signing|Check dep" | \
    grep -v "note:" | tail -20
  BUILD_EC=$?
  set -e
  cd - > /dev/null

  if [[ $BUILD_EC -ne 0 ]]; then
    echo ""
    echo "마지막 오류:"
    grep -E "error:|FAILED" "$BUILD_LOG" | grep -v "^note:" | tail -10
    die "빌드 실패 (종료코드 $BUILD_EC)\n  전체 로그: $BUILD_LOG"
  fi

  XCTESTRUN=$(find "$DERIVED/Build/Products" -name "*.xctestrun" 2>/dev/null | head -1 || true)
  [[ -z "$XCTESTRUN" ]] && die "xctestrun 생성 실패. 로그: $BUILD_LOG"
  APP_PATH=$(find "$DERIVED/Build/Products" -name "WebDriverAgentRunner-Runner.app" \
    -not -path "*simulator*" 2>/dev/null | head -1 || true)
  ok "빌드 성공"
fi

# ── STEP 7: IPA 패키징 → wda_artifacts_seyong/ 저장 ──────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo " STEP 7: IPA 패키징"
echo "══════════════════════════════════════════════"

# --export-only 시: 기존 DerivedData에서 최신 .app 탐색
if [[ -z "${APP_PATH:-}" ]]; then
  APP_PATH=$(find "$HOME/Library/Developer/Xcode/DerivedData" \
    -name "WebDriverAgentRunner-Runner.app" -not -path "*simulator*" 2>/dev/null | \
    xargs ls -dt 2>/dev/null | head -1 || true)
fi

if [[ ! -d "${APP_PATH:-}" ]]; then
  warn ".app 없음 — IPA 패키징 건너뤃 (빌드가 필요합니다)"
else
  IPA_TMP="/tmp/wda_ipa_pkg_$$"
  mkdir -p "$IPA_TMP/Payload"
  cp -R "$APP_PATH" "$IPA_TMP/Payload/"
  cd "$IPA_TMP"
  zip -qr WDA.ipa Payload/ --exclude "*.DS_Store"
  cp WDA.ipa "${ARTIFACTS_DIR}/WDA.ipa"
  cd - > /dev/null
  rm -rf "$IPA_TMP"
  ok "IPA 저장: ${ARTIFACTS_DIR}/WDA.ipa  ($(du -sh "${ARTIFACTS_DIR}/WDA.ipa" | cut -f1))"
fi

# xctestrun 저장
if [[ -n "${XCTESTRUN:-}" ]]; then
  cp "$XCTESTRUN" "${ARTIFACTS_DIR}/"
  ok "xctestrun 저장: ${ARTIFACTS_DIR}/$(basename "$XCTESTRUN")"
fi

# 갱신된 프로비저닝 프로파일 certs/ 에 저장 (기기 UDID 등록 후)
NEW_PP=$(while IFS= read -r f; do
  security cms -D -i "$f" 2>/dev/null | grep -q "$BUNDLE_PREFIX" && echo "$f"
done < <(ls "$PP_DIR"/*.mobileprovision 2>/dev/null || true) | head -1 || true)

if [[ -n "$NEW_PP" ]]; then
  cp "$NEW_PP" "${CERTS_DIR}/developer.mobileprovision"
  ok "프로비저닝 프로파일 갱신: certs/developer.mobileprovision"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  IPA      : ${ARTIFACTS_DIR}/WDA.ipa"
[[ -n "${XCTESTRUN:-}" ]] && echo "  xctestrun: ${ARTIFACTS_DIR}/$(basename "$XCTESTRUN")"
echo ""
echo "  설치+실행 (Xcode 불필요): ./setup_wda_offline.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

fi  # _SKIP_TO_INSTALL == false

# ── STEP 8: 연결된 전체 기기에 WDA 설치 ──────────────────────
# xctestrun은 DerivedData 원본 우선 (상대경로로 .xctest 번들 참조)
DERIVED_INSTALL="${HOME}/Library/Developer/Xcode/DerivedData/WDA_${TEAM_ID}"
XCTESTRUN_FILE=$(find "$DERIVED_INSTALL/Build/Products" -name "*.xctestrun" 2>/dev/null | head -1 || true)
# fallback: wda_artifacts_seyong 복사본
if [[ -z "$XCTESTRUN_FILE" ]]; then
  XCTESTRUN_FILE=$(find "${ARTIFACTS_DIR}" -name "*.xctestrun" 2>/dev/null | head -1 || true)
fi

if [[ -n "$XCTESTRUN_FILE" ]] && [[ ${#ALL_UDIDS[@]} -gt 0 ]]; then
  echo ""
  echo "══════════════════════════════════════════════"
  echo " STEP 8: WDA 전체 기기 설치 (${#ALL_UDIDS[@]}대)"
  echo "══════════════════════════════════════════════"
  for _install_udid in "${ALL_UDIDS[@]}"; do
    _dname=$(ideviceinfo -u "$_install_udid" -k DeviceName 2>/dev/null || echo "$_install_udid")
    info "설치 중: $_dname ($_install_udid)"
    set +e
    xcodebuild test-without-building \
      -xctestrun "$XCTESTRUN_FILE" \
      -destination "id=${_install_udid}" \
      -derivedDataPath "$DERIVED_INSTALL" \
      -only-testing WebDriverAgentRunner/DummyTest 2>&1 | \
      grep -E "Installed|error:|FAILED|SUCCEEDED|Test session" | tail -5
    _ec=$?
    set -e
    # 종료코드 65(테스트 없음)도 설치 성공으로 간주
    if [[ $_ec -eq 0 || $_ec -eq 65 ]]; then
      ok "설치 완료: $_dname"
    else
      warn "설치 실패: $_dname (코드 $_ec)"
      warn "  수동 실행: xcodebuild test-without-building -xctestrun wda_artifacts_seyong/$(basename $XCTESTRUN_FILE) -destination id=$_install_udid"
    fi
  done
fi
