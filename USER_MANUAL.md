# GroundView iOS - 설치 및 사용 매뉴얼

## 📋 시스템 요구사항

### macOS 버전
- **macOS 11.0 (Big Sur) 이상**
- Apple Silicon (M1/M2/M3) 또는 Intel Mac

### 필수 소프트웨어

#### 1. Xcode & Command Line Tools
GroundView iOS는 iOS 기기 개발을 위해 Xcode가 필요합니다:

```bash
# Xcode 설치 확인
xcode-select -p

# 설치되지 않은 경우, App Store에서 다운로드하거나 실행:
xcode-select --install
```

**최소 버전:** Xcode 13.0 이상

#### 2. WebDriverAgent (WDA)
GroundView가 화면과 UI 계층구조를 캡처하려면 WDA가 iOS 기기에서 실행되어야 합니다.

**설치 방법:**
1. Appium에서 WebDriverAgent 다운로드:
   ```bash
   git clone https://github.com/appium/WebDriverAgent.git
   cd WebDriverAgent
   ```

2. Xcode에서 `WebDriverAgent.xcodeproj` 열기

3. Signing 설정에서 개발 팀 선택

4. iPhone을 USB로 연결

5. Target 기기로 iPhone 선택

6. `WebDriverAgentRunner` 스킴 실행 (⌘+R)

7. iPhone에서 개발자 인증서 신뢰:
   - 설정 → 일반 → VPN 및 기기 관리
   - 개발자 프로필 신뢰

8. WDA가 기기의 8100 포트에서 실행됨

#### 3. iOS 기기 설정
- **USB 연결:** Lightning/USB-C 케이블로 iPhone을 Mac에 연결
- **컴퓨터 신뢰:** iPhone에서 메시지 표시 시 "이 컴퓨터 신뢰" 탭
- **개발자 모드:** iOS 16 이상 기기에서 개발자 모드 활성화
  - 설정 → 개인정보 보호 및 보안 → 개발자 모드 → 켜기

---

## 🚀 설치 방법

### 1단계: GroundView iOS 설치

1. `GroundView iOS-0.1.0-arm64.dmg` 다운로드

2. DMG 파일을 더블클릭하여 마운트

3. **GroundView iOS.app**을 응용 프로그램 폴더로 드래그

4. DMG 마운트 해제

### 2단계: 첫 실행

1. **응용 프로그램** 폴더 열기

2. **GroundView iOS** 우클릭 → 열기
   - (처음 실행 시: 확인된 개발자의 앱 열기 확인 필요)

3. Gatekeeper에 의해 차단된 경우:
   - 시스템 설정 → 개인정보 보호 및 보안
   - GroundView iOS 메시지 옆 "확인 후 열기" 클릭

---

## 📱 사용 가이드

### iPhone 연결하기

1. **iPhone USB 연결**
   - Apple 정품 Lightning/USB-C 케이블 사용
   - iPhone 잠금 해제
   - 메시지 표시 시 컴퓨터 신뢰

2. **WebDriverAgent 시작**
   - Xcode 실행
   - WebDriverAgent 프로젝트 열기
   - 기기에서 WebDriverAgentRunner 실행 (⌘+R)
   - 콘솔에 "ServerURLHere" 메시지 대기

3. **GroundView iOS 실행**
   - 앱이 자동으로:
     - ✅ 연결된 iPhone 감지
     - ✅ iproxy 시작하여 기기 포트 8100 포워딩
     - ✅ WebDriverAgent에 연결

4. **연결 확인**
   - 메인 화면에 표시되어야 함:
     - ✅ **"✓ WDA CONNECTED"** (녹색 배너)
     - ✅ **"1 device(s) found"** 및 iPhone 목록
     - ✅ 하단에 **Health: ✓ OK**

### 화면 및 UI 계층구조 캡처

1. **기기 선택**
   - "Connected Devices" 아래 드롭다운 클릭
   - 목록에서 iPhone 선택

2. **화면 캡처**
   - 파란색 **"📸 Capture Screen"** 버튼 클릭
   - 캡처 완료까지 2-3초 대기

3. **분석 화면**
   - 왼쪽 패널: 클릭 가능한 UI 요소가 있는 인터랙티브 스크린샷
   - 오른쪽 패널: 요소 세부정보가 있는 UI 계층구조 트리
   - 요소를 클릭하여 속성 확인

---

## ⚠️ 문제 해결

### "✗ WDA NOT CONNECTED"

**원인:** WebDriverAgent가 실행되지 않았거나 iproxy 시작 실패

**해결 방법:**

1. **WDA 실행 확인:**
   ```bash
   # Mac 터미널에서:
   curl http://localhost:8100/status
   
   # "state": "success"가 포함된 JSON 반환되어야 함
   ```

2. **WebDriverAgent 재시작:**
   - Xcode에서 WDA 중지 (⌘+.)
   - 다시 실행 (⌘+R)
   - "ServerURLHere" 메시지 대기

3. **기기 연결 확인:**
   ```bash
   # 기기 감지 확인:
   xcrun xctrace list devices
   ```

4. **GroundView iOS 재시작:**
   - 앱 완전히 종료 (⌘+Q)
   - 응용 프로그램에서 다시 실행

### "0 device(s) found"

**원인:** macOS에서 기기 감지 안 됨

**해결 방법:**

1. **iPhone 재연결:**
   - USB 케이블 뽑았다가 다시 꽂기
   - iPhone 잠금 해제
   - 메시지 표시 시 "신뢰" 탭

2. **USB 연결 확인:**
   ```bash
   # 기기 연결 확인:
   system_profiler SPUSBDataType | grep iPhone
   ```

3. **위치 서비스 재시작:**
   - iPhone에서: 설정 → 개인정보 보호 → 위치 서비스
   - 끄기 후 다시 켜기

4. **신뢰 설정 재설정:**
   - iPhone에서: 설정 → 일반 → iPhone 전송 또는 재설정
   - 위치 및 개인정보 보호 재설정
   - 재연결 후 컴퓨터 다시 신뢰

### 캡처 실패 또는 타임아웃

**해결 방법:**

1. **WDA 상태 확인:**
   ```bash
   curl http://localhost:8100/health
   ```

2. **WDA와 GroundView 모두 재시작:**
   - Xcode에서 WDA 중지
   - GroundView 종료 (⌘+Q)
   - WDA 먼저 실행 (⌘+R)
   - GroundView 다시 실행

3. **디스크 여유 공간 확인:**
   - GroundView가 `/tmp/`에 스크린샷 저장
   - 최소 1GB 여유 공간 확보

### 권한 오류

"작업이 허용되지 않음" 오류 발생 시:

1. **전체 디스크 접근 권한 부여:**
   - 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한
   - 목록에 GroundView iOS 추가

2. **개발자 도구 접근 권한 부여:**
   - 시스템 설정 → 개인정보 보호 및 보안 → 개발자 도구
   - 터미널 및 GroundView iOS 활성화

---

## 🔧 고급 설정

### 수동 iproxy 설정 (선택사항)

자동 iproxy가 작동하지 않는 경우 수동 실행:

```bash
# 별도 터미널 창에서:
iproxy 8100:8100

# GroundView 사용 중 터미널 창 열어두기
```

### 커스텀 WDA 포트

WDA가 다른 포트에서 실행 중인 경우:

1. 앱 번들의 `wda.config.json` 편집:
   ```bash
   # 앱 설정 찾기:
   /Applications/GroundView\ iOS.app/Contents/Resources/wda.config.json
   ```

2. 포트 변경:
   ```json
   {
     "host": "127.0.0.1",
     "port": 8100  # WDA 포트로 변경
   }
   ```

### 로그 위치

GroundView iOS는 디버깅용 로그를 저장합니다:

- **앱 로그:** `~/Library/Logs/GroundView iOS/`
- **스크린샷:** `/tmp/groundview-ios-*.png`
- **XML 파일:** `/tmp/groundview-ios-*.xml`

실시간 로그 확인:
```bash
# 앱 로그 추적:
tail -f ~/Library/Logs/GroundView\ iOS/groundview-ios.log

# 또는 Console.app 사용:
# Console.app 열기 → "GroundView" 검색
```

---

## 📦 포함 내용

GroundView iOS는 **완전히 독립적**이며 다음을 포함합니다:

- ✅ **iproxy** (USB 포워딩 도구)
- ✅ **idevice_id** (기기 감지 도구)
- ✅ **모든 필수 라이브러리** (libimobiledevice, libusbmuxd, libplist 등)
- ✅ **API 서버** (내장 Node.js 서버)
- ✅ **UI 애플리케이션** (Electron 기반 데스크톱 앱)

**추가 Homebrew 패키지 불필요!**

---

## 🆘 지원 및 도움말

### 앱 버전 확인

- 메뉴 바에서 "GroundView iOS" 클릭 → "GroundView iOS 정보"
- 현재 버전: **0.1.0**

### 앱 초기화

앱이 제대로 작동하지 않는 경우:

```bash
# 앱 데이터 제거:
rm -rf ~/Library/Application\ Support/groundview-ios
rm -rf ~/Library/Logs/GroundView\ iOS

# DMG에서 앱 재설치
```

### 일반적인 문제 요약

| 문제 | 빠른 해결 |
|------|-----------|
| WDA 연결 안 됨 | Xcode에서 WDA 재시작 |
| 기기 찾을 수 없음 | iPhone USB 케이블 재연결 |
| 캡처 타임아웃 | `curl http://localhost:8100/status` 확인 |
| 권한 거부됨 | 시스템 설정에서 전체 디스크 접근 권한 부여 |
| 빈 화면 | Console.app에서 로그 확인 |

---

## 💡 팁 및 권장사항

1. **WDA 계속 실행:** GroundView 사용 중 WebDriverAgent 중지하지 않기
2. **정품 케이블 사용:** 서드파티 USB 케이블은 연결 문제 발생 가능
3. **iPhone 잠금 해제:** 캡처 중 기기 잠금 해제 상태 유지
4. **Xcode Inspector 종료:** Xcode의 Accessibility Inspector 동시 사용 금지
5. **한 번에 하나씩:** 여러 iOS 자동화 도구 동시 실행 금지

---

## 🔄 업데이트

GroundView iOS 업데이트 방법:

1. 최신 DMG 다운로드
2. 현재 앱 종료
3. 응용 프로그램 폴더의 앱 교체
4. 새 버전 실행

설정 및 로그는 `~/Library/Application Support/groundview-ios`에 보존됩니다.

---

## 📄 라이선스 및 크레딧

- **GroundView iOS** - MIT License
- **WebDriverAgent** - Apache License 2.0 (by Appium)
- **libimobiledevice** - LGPL v2.1

자세한 정보: [GitHub Repository]

---

**최종 업데이트:** 2025년 12월 12일
**버전:** 0.1.0
