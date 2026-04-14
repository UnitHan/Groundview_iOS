# GroundView iOS

iOS 앱 UI 요소를 실시간으로 캡처하고, Appium 자동화 테스트 코드를 자동 생성하는 macOS 데스크탑 앱입니다.

<p align="center">
  <img src="docs/screenshot.png" alt="GroundView iOS 스크린샷" width="800"/>
</p>

---

## 주요 기능

- **실시간 UI 캡처** — WDA(WebDriverAgent)를 통해 iOS 기기의 화면과 UI 계층 구조를 즉시 덤프
- **USB / WiFi 연결 지원** — USB 케이블 없이 같은 네트워크의 iPhone에 무선으로 연결
- **UI 계층 트리 뷰** — 모든 XCUIElement를 트리 형태로 탐색, 숨겨진 요소(visible=false)도 👻 표시로 확인 가능
- **오버레이 클릭 선택** — 스크린샷 위를 클릭하면 해당 요소 자동 선택, Shift+클릭으로 겹친 레이어 순환
- **접근성 기반 요소 인식** — `accessible="true"` 요소 우선 선택, `traits` 속성으로 버튼/링크 자동 식별
- **Appium 로케이터 자동 생성** — Accessibility ID / Predicate / Class Chain / XPath 우선순위 순으로 코드 생성
- **Appium 1.x / 2.x 지원** — Python, Java 코드 동시 생성
- **Gemini AI 코드 추천** — Google Gemini API 연동으로 더 안정적인 로케이터 제안
- **캡처 저장** — 스크린샷 + XML + 트리 JSON을 ZIP으로 저장

---

## 시스템 요구사항

| 항목 | 요구사항 |
|------|----------|
| OS | macOS 12 Ventura 이상 (Apple Silicon) |
| Xcode | 14 이상 (WDA 빌드용) |
| iPhone | iOS 15 이상, WDA 실행 중 |
| 연결 | USB 또는 WiFi (같은 네트워크) |

---

## 설치 및 실행

### 1. DMG 다운로드

[Releases](https://github.com/UnitHan/Groundview_iOS/releases) 페이지에서 최신 `GroundView iOS-x.x.x-arm64.dmg`를 다운로드합니다.

### 2. WDA 준비

iPhone에서 WebDriverAgent가 실행 중이어야 합니다.

```bash
# USB 연결 시 iproxy로 포트 포워딩
iproxy 8100:8100
```

WiFi 연결 시에는 앱 내 **WiFi 연결** 패널에서 iPhone IP를 직접 입력합니다.

### 3. 앱 실행

DMG를 열어 Applications 폴더로 드래그 후 실행합니다.

> **Gatekeeper 경고 시**: 시스템 환경설정 → 보안 및 개인 정보 → "확인 없이 열기"

---

## 사용 방법

1. 앱 실행 후 **Devices** 화면에서 연결된 iPhone 선택
2. **Capture** 버튼으로 현재 화면 캡처
3. 스크린샷 위를 클릭하거나 트리에서 요소 선택
4. **코드 추천** 버튼으로 Appium 코드 자동 생성
5. 생성된 코드를 복사해서 테스트 스크립트에 붙여넣기

---

## 개발 환경 설정

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 빌드
npm run build
npm run build:ui

# DMG 패키징
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

---

## 기술 스택

- **Electron** — 데스크탑 앱 프레임워크
- **React + TypeScript** — UI
- **Vite** — 프론트엔드 빌드
- **WDA (WebDriverAgent)** — iOS UI 덤프
- **xml2js** — XML 파싱
- **Zustand** — 상태 관리

---

## 라이선스

MIT License
