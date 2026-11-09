# GroundView iOS

WDA(WebDriverAgent)로 iPhone의 화면과 UI 계층을 수집하고, 요소를 선택해 Appium 테스트 코드를 생성하는 Electron 데스크톱 앱입니다. React·TypeScript UI와 Node.js API 서버로 구성됩니다.

현재 버전은 **0.1.0**입니다. macOS Apple Silicon용 패키징과 Windows 지원 코드가 있으며, Windows 설치·무선 연결의 전체 검증은 진행 중입니다.

## 구현된 기능

- WDA 상태 확인, 스크린샷·XML 수집, USB/WiFi 연결
- UI 계층 트리 탐색, 화면 오버레이 선택, Shift+클릭으로 겹친 요소 순환
- Accessibility ID / iOS Predicate / Class Chain / XPath 기반 Python·Java 코드 생성
- UI에서 Appium 1.x·2.x 코드 선택; 별도 코드 생성 모듈은 Appium 3 옵션도 제공
- 기기·앱 정보 조회와 Appium capabilities 생성
- Gemini API를 이용한 코드 추천·OCR (API 키와 네트워크 필요)
- 캡처 ZIP 저장·불러오기
- 설치된 WDA 러너 실행·중지, 무선 IP 재탐색
- Windows용 별도 Python GUI, 포워더·워치독 도구

## 플랫폼과 준비 사항

| 환경 | 준비 사항 및 현재 범위 |
|------|-----------------------|
| macOS | Apple Silicon용 DMG 구성. WDA 최초 빌드·서명에는 기기 iOS와 호환되는 Xcode 및 Apple 개발 서명 환경 필요 |
| Windows 10/11 | Electron 앱·NSIS 설치 구성 및 무선 WDA 실행 코드 제공. 설치·재부팅·실기기 통합 검증은 [체크리스트](win/WINDOWS_TODO.md) 참고 |
| iPhone | 서명된 WDA 러너 설치, 개발자 모드·컴퓨터 신뢰 설정. Windows 무선 도구는 iOS 17+ 대상 |
| 개발 환경 | Node.js 22.12 이상 권장. 현재 Vite 7의 Node 조건은 `^20.19.0 || >=22.12.0` |

WDA 최초 빌드·서명·설치는 별도로 준비해야 합니다. 앱의 **WDA 실행** 기능은 이미 설치된 러너를 실행합니다. 무선 실행에는 `pymobiledevice3`와 실행 중인 `tunneld`가 필요합니다. Windows의 터널 구성에는 Apple Mobile Device Support와 Wintun, 관리자 권한이 필요합니다.

## 설치와 사용

macOS 배포 파일은 [Releases](https://github.com/UnitHan/Groundview_iOS/releases)에서 확인할 수 있습니다. DMG를 열어 앱을 Applications 폴더로 복사합니다. 서명·공증 여부는 개별 배포 파일에 따라 확인해야 합니다.

1. iPhone에 WDA를 설치하고 실행합니다. USB 연결은 `iproxy`, WiFi 연결은 기기 IP와 WDA 포트(기본 `8100`)를 사용합니다.
2. Devices 화면에서 기기를 선택합니다. 필요하면 **WDA 실행** 또는 WiFi 연결 패널을 사용합니다.
3. **Capture**로 현재 화면을 수집합니다.
4. 화면이나 트리에서 요소를 선택하고 Python·Java 코드를 생성·복사합니다.
5. 필요하면 캡처를 ZIP으로 저장하거나 기존 ZIP을 불러옵니다.

자세한 사용법은 [사용자 매뉴얼](USER_MANUAL.md), Windows 전용 GUI는 [별도 안내](win/gui/README.md)를 참고하세요.

## 로컬 개발

```bash
npm ci
npm run dev
```

`dev`는 백엔드 빌드·감시, API 서버, Vite, Electron을 함께 실행합니다. UI 개발 서버는 `5173`, API 서버는 `4321` 포트를 사용합니다. 현재 UI는 API 주소 `http://localhost:4321`을 사용하므로 백엔드 포트만 바꾸면 연결되지 않습니다.

```bash
npm test          # 기기 없이 실행하는 단위 테스트
npm run build     # 백엔드 TypeScript 빌드
npm run build:ui  # React UI 빌드
```

UI 빌드는 Vite 번들링 검사이며 별도의 UI 전체 타입 검사를 포함하지 않습니다. 자동 테스트 통과만으로 실기기 연결·캡처·설치 검증이 완료되는 것은 아닙니다.

### WDA와 실행 도구 설정

`wda.config.sample.json`을 참고해 `wda.config.json`을 설정하거나 `WDA_CONFIG`로 별도 파일을 지정합니다. 환경 변수가 파일 설정보다 우선합니다.

| 환경 변수 | 용도 |
|-----------|------|
| `WDA_CONFIG` | 설정 파일 경로 |
| `WDA_HOST`, `WDA_PORT` | WDA 주소·포트 |
| `PYMOBILEDEVICE3_PATH` | WDA 실행 도구 경로 또는 PATH 명령 |
| `IPROXY_PATH` | USB 포트 포워딩 도구 경로 |
| `GO_IOS_PATH` | go-ios 도구 경로 |
| `WDA_RUNNER_BUNDLE_ID` | 자동 탐색 실패 시 러너 번들 ID |
| `TUNNELD_HOST`, `TUNNELD_PORT` | 터널 데몬 주소 (기본 `127.0.0.1:49151`) |

macOS에서는 프로젝트 `.venv/bin/pymobiledevice3`를 찾고, 없으면 PATH의 명령을 사용합니다. Windows에서는 패키지의 `win/tools/`, 프로젝트 `win/tools/`, `.venv/Scripts/` 순으로 확인한 뒤 PATH를 사용합니다. 환경 변수로 지정한 경로는 그대로 사용하며, 설정 파일에 남은 다른 PC의 존재하지 않는 경로는 건너뜁니다.

### 수동 진단

`diagnostics/`는 과거 파서·클릭 동작을 살펴보는 독립 진단 스크립트입니다. 실제 앱 구현의 회귀 테스트를 대신하지 않으며 `npm test`와 앱 빌드에서는 제외됩니다.

```bash
npm run diagnose:click
npm run diagnose:xml
# /tmp/wda_full.xml에 WDA XML을 준비한 다음 실행
npm run diagnose:xml:real
```

## 패키징

### macOS

```bash
npm run dist -- --mac --arm64
```

`release/`에 DMG가 생성됩니다. 현재 `package.json`에는 프로젝트의 Developer ID 서명 ID가 지정되어 있어, 다른 개발자는 자신의 서명 환경으로 바꿔야 합니다. Hardened Runtime·entitlements가 설정되어 있고, `build/notarize.js`의 `afterSign` 훅이 공증과 staple을 수행합니다.

공증 자격 증명을 로컬 Keychain에 먼저 등록합니다. 비밀번호는 명령에 넣지 않고 대화형으로 입력합니다.

```bash
xcrun notarytool store-credentials groundview-notary
npm run dist -- --mac --arm64
```

다른 프로필 이름은 `NOTARY_KEYCHAIN_PROFILE`로 지정합니다. `SKIP_NOTARIZE=1`은 공증만 생략하며 코드 서명은 유지합니다. 로컬 확인용 앱 디렉터리는 `SKIP_NOTARIZE=1 npm run pack`으로 만들 수 있습니다.

### Windows

Windows에서 `win/tools/`에 실행 도구를 준비한 뒤 패키징합니다.

```powershell
# Python venv에 pymobiledevice3와 pyinstaller 설치 후 실행
python win/gui/build_bundle.py
npm ci
npm run dist -- --win
```

Python 빌드는 `win/tools/pymobiledevice3.exe`와 `win/dist/`의 독립 GUI·포워더·워치독을 생성합니다. Electron NSIS 설치 프로그램은 별도 산출물이며, 설치 시 `GroundViewTunneld` 예약 작업 등록을 시도하고 제거 시 해당 작업을 삭제합니다. 실제 설치·서비스 동작은 [Windows 검증 목록](win/WINDOWS_TODO.md)에 따라 확인해야 합니다.

## 코드 구조와 남은 검증

- `src/`: WDA 클라이언트·런처, 기기 탐색, API, 코드 생성
- `ui/src/`: Devices·Analyze 화면, 트리·오버레이, 상태 관리
- `electron/`: 데스크톱 프로세스·preload
- `build/`: macOS 공증 훅·entitlements
- `sh/`, `win/`: 플랫폼별 실행·설정 도구
- `diagnostics/`: 수동 진단

다음 검증이 남아 있습니다: 새 PC에서 도구 탐색·설치, USB/WiFi 실기기 캡처, Windows 설치·재부팅·잠금 복귀, Appium 코드 실제 실행. 히스토리 비교·배치 처리·로케이터 안정성 점수화는 확장 계획입니다. [개발 계획](plan.md)과 [요구사항](requirements.md)은 초기 목표를 포함하므로 현재 지원 범위는 이 README와 구현을 기준으로 확인하세요.
