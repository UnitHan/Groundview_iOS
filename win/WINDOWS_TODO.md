# GroundView iOS — Windows 무선 WDA 지원 TODO

Windows 10/11에서 iOS 17+ 단말을 **무선(WiFi)**으로 WDA 기동하게 만드는 작업 목록입니다.
macOS에서 원리·레시피를 검증했고, 크로스플랫폼 코드와 Windows 스크립트를 미리 넣어두었습니다.
이 문서를 체크리스트 삼아 Windows에서 이어서 진행하세요.

> ⚠️ macOS에서 작성/빌드 검증한 부분과, **Windows에서만 검증 가능한 부분**을 구분해 표기했습니다.
> `.exe` 빌드·서비스 등록·Wintun 터널은 반드시 Windows에서 테스트해야 합니다.

---

## 0. 배경: 왜 무선이 되는가 (검증 완료)

- iOS 17+ 개발자 서비스(WDA 런치)는 **RemoteXPC 터널**만 있으면 USB/WiFi 무관하게 동작.
- 유일한 USB 의존은 `iproxy`(usbmux 포워딩)뿐 → 무선에선 **기기 LAN IP:8100**으로 직접 접속(WDA가 0.0.0.0 바인딩).
- macOS에서 `USB 뽑은 상태`로 실측 검증: `dvt xcuitest --tunnel` 런치 → 기기 LAN IP:8100 `ready:true`.

**Windows 대응 근거 (설치된 pymobiledevice3 9.33.1 코드에서 확인):**
- `lockdown wifi-connections` (Xcode "Connect via network" 대응) 존재
- `remote tunneld --wifi / --mobdev2` (mDNS 네트워크 디스커버리) 존재
- `pytun_pmd3` 3.0.3 → `if sys.platform=="win32": TunTapDevice(...)` = **Windows는 Wintun으로 TUN 생성**
- `osu/win_util.py` = 관리자 권한 확인/처리 존재

---

## 1. 사전 설치 (Windows) — [ ]

- [ ] **Python 3.11+** 설치, `pip install pymobiledevice3` (또는 빌드된 `pymobiledevice3.exe` 사용)
- [ ] **go-ios** (`ios.exe`) 다운로드 — 대체 터널/런치 도구 (선택)
- [ ] **Apple Mobile Device Support(usbmux)** — **Microsoft Store "Apple Devices" 앱** 또는 iTunes 설치.
      회사 정책으로 iTunes 차단 시 Store 앱 사용. Bonjour는 불필요(tunneld `--wifi`가 자체 mDNS 수행).
      자세한 근거: `win/WHY_WIRELESS.md`
- [ ] **Wintun** — `wintun.dll`을 `pymobiledevice3.exe`와 같은 폴더 또는 PATH에 배치 (https://www.wintun.net)
- [ ] **Node.js 18+** (앱 빌드용), 이 리포지토리 클론 후 `npm ci`
- [ ] 방화벽: mDNS(UDP 5353) 및 로컬 터널 트래픽 허용

---

## 2. Phase A — 스크립트로 무선 파이프라인 수동 검증 (앱 없이) — [ ]

`win/` 폴더의 PowerShell 스크립트로 먼저 파이프라인이 뚫리는지 확인합니다.

- [ ] **(1회, USB 연결·잠금 해제)** 무선 활성화 + DDI 마운트
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\win\setup-wireless.ps1 -Pmd3 "C:\path\to\pymobiledevice3.exe"
  ```
  - [ ] `wifi-connections on` 성공
  - [ ] 개발자 모드 ON (꺼져 있으면 스크립트가 활성화 → 재부팅 후 재실행)
  - [ ] `mounter auto-mount` 성공 (인터넷 연결 필요 — Apple에서 DDI 수신)

- [ ] **(관리자 PowerShell)** 상시 tunneld 백그라운드 작업 등록
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\win\install-tunneld-service.ps1 -Pmd3 "C:\path\to\pymobiledevice3.exe"
  ```
  - [ ] `http://127.0.0.1:49151/` REST 응답 확인
  - [ ] ⚠️ 여기서 **Wintun/관리자** 문제가 가장 많이 발생 → 실패 시 수동 실행으로 원인 확인:
        `pymobiledevice3 remote tunneld --wifi`

- [ ] **(USB 뽑고, 같은 WiFi)** 무선 런치
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\win\launch-wda.ps1 `
    -Udid <UDID> -Runner <러너번들> -Pmd3 "C:\path\to\pymobiledevice3.exe"
  ```
  - [ ] tunneld REST에 해당 UDID 터널 표시됨
  - [ ] `WDA READY` + `deviceIp` 출력, `http://<deviceIp>:8100/status` 응답
  - [ ] (참고) Appium: `capabilities.webDriverAgentUrl = http://<deviceIp>:8100`

> go-ios 대안 경로도 확인해볼 것: `ios tunnel start`(관리자) + `ios runwda --udid <UDID>`.
> 어느 쪽이 이 환경에서 더 안정적인지 비교 후 기본 도구 결정.

---

## 3. Phase B — 앱에 무선 런치 통합 (크로스플랫폼) — [ ]

크로스플랫폼 런처는 이미 반영됨(코드에서 확인만 하면 됨):
- `src/wdaLauncher.ts` — `pkill`/iproxy를 OS 분기 처리(Windows는 iproxy 스킵, PID 추적으로 stop), 런치는 pymobiledevice3 공통.
- `src/config.ts` `loadLauncherConfig` — `process.platform==='win32'`일 때 `pymobiledevice3`/`ios` 기본 경로 사용.
- 무선 성공 시 기기 LAN IP를 앱 WiFi 경로에 자동 등록(health/capture가 IP로 접속).

Windows에서 할 일:
- [x] pymobiledevice3 경로 자동 해석 — `src/config.ts`가 win에서 `.venv\Scripts\` →
      `resources\win\tools\` → PATH 순으로 `pymobiledevice3.exe`를 찾음. config 파일의
      macOS 경로는 존재하지 않으면 자동 무시. (env `PYMOBILEDEVICE3_PATH`로 override 가능)
- [ ] `launcher.runnerBundleId` 설정(선택) — 자동 탐색 실패 시에만 필요.
      예: `com.jjun.1.WebDriverAgentRunner.xctrunner` (설치된 러너 번들 ID)
- [x] `npm install && npm run build && npm run build:ui` 검증 완료 (Windows). `npm run dev:electron` 실행 가능
- [ ] Devices에서 기기 선택 → **"WDA 실행"** 클릭 → 무선 기동 확인 (실기기 + tunneld 등록 후)
- [x] `discoverRunnerBundleId` Windows 지원 추가 완료:
      `pymobiledevice3 apps list -t User --udid <UDID>`의 `.xctrunner` 키 파싱
- [x] **추가 발견/수정**: 앱이 macOS 전용으로 막혀 있던 부분 크로스플랫폼화
      - `src/service.ts` — `listDevices/capture/health`의 macOS 게이트 제거 (WDA는 HTTP)
      - `src/deviceList.ts` — Windows 기기 탐색(`pymobiledevice3 usbmux list`, USB+Network)
      - `src/iproxyManager.ts` — Windows는 iproxy 미사용(무선 직결), 기기 탐색은 pymobiledevice3
      - 검증: Windows에서 `/api/devices`가 실기기(UDID/이름/iOS버전) 정상 반환

---

## 4. Phase C — 종합 설치 exe 빌드 — [ ]

설치 구성은 이미 반영됨:
- `package.json` `build.win`(nsis) + `build.nsis.include = win/installer.nsh`
- `build.extraResources`에 `win/` 포함 → 설치 시 `resources\win\`으로 배포
- `win/installer.nsh` — 설치 시 `install-tunneld-service.ps1` 자동 실행(작업 등록), 제거 시 작업 삭제

Windows에서 할 일:
- [ ] **번들 도구 배치**: `win/tools/`에 `pymobiledevice3.exe`, `ios.exe`, `wintun.dll` 넣기
      (pymobiledevice3는 PyInstaller onefile로 빌드하거나 배포본 사용)
- [ ] `electron/icon.ico` 준비(현재 `.icns`만 있음) → win 아이콘
- [ ] `npm run dist` (Windows에서) → NSIS 설치 exe 생성 (`release/`)
- [ ] 설치 테스트:
  - [ ] 설치 시 `GroundViewTunneld` 예약 작업이 등록되고 tunneld가 부팅 시 상시 구동
  - [ ] 설치 후 앱의 "WDA 실행"이 **관리자 프롬프트 없이** 무선 동작
  - [ ] 제거 시 예약 작업 삭제 확인
- [ ] (권장) 코드 서명(EV/OV 인증서) — SmartScreen 경고 완화
- [ ] `installer.nsh`의 `-Pmd3` 경로가 실제 번들 경로(`$INSTDIR\resources\win\tools\pymobiledevice3.exe`)와 일치하는지 확인

---

## 5. Phase D — 미니 GUI — [ ]

경량 전용 도구(기기 선택 + "무선 WDA 실행" 버튼만).
- [ ] 방식 결정:
  - (A) 같은 Electron 앱의 **컴팩트 모드**(작은 BrowserWindow, DevicesPage 축소판) — 재사용 최대
  - (B) 독립 Python+tkinter 도구 — `launch-wda.ps1` 로직을 그대로 호출
- [ ] 최소 기능: 기기 목록 / 상태 표시(tunneld·DDI·WDA) / 실행·중지 / WDA_URL 복사
- [ ] 상태 API 재사용: `GET /api/wda/status`, `POST /api/wda/launch`, `POST /api/wda/stop`

---

## 6. 통합 테스트 체크리스트 — [ ]

- [ ] Windows 10 / Windows 11 각각에서 무선 런치 성공
- [ ] 재부팅 후 tunneld 자동 구동 + 버튼 동작(관리자 프롬프트 없음)
- [ ] 기기 잠금/절전 후 복귀 시 재연결 동작
- [ ] 서로 다른 WiFi/서브넷일 때 동작 여부(터널주소 폴백 확인)
- [ ] Appium 자동화가 `webDriverAgentUrl`로 정상 구동
- [ ] USB 연결 상태에서도 동일 버튼으로 동작(회귀)

---

## 7. 트러블슈팅

| 증상 | 원인/조치 |
|---|---|
| tunneld REST 무응답 | Wintun 미배치 / 관리자 아님 → `wintun.dll` 위치, 관리자 실행 확인. 수동: `pymobiledevice3 remote tunneld --wifi` |
| 기기 터널이 REST에 안 뜸 | `wifi-connections` 미활성 / 다른 WiFi / Bonjour 미설치 → `setup-wireless.ps1` 재실행, iTunes(Bonjour) 설치 |
| `AppNotInstalledError` | 러너 번들 ID 오타 / WDA 미설치 → `pymobiledevice3 apps list`로 실제 `.xctrunner` 확인 |
| DDI 관련 오류 | `mounter auto-mount` 재실행(인터넷 필요). 17.x는 personalized DDI 자동 수신 |
| `dvt xcuitest` 즉시 종료 | 이전 러너 잔존 → `pymobiledevice3 developer dvt pkill WebDriverAgentRunner-Runner --tunnel <UDID>` 후 재시도 |
| SmartScreen/설치 경고 | 코드 서명 필요 |

---

## 8. 결정 필요 항목 (Open)

- [ ] 기본 터널 도구: **pymobiledevice3** vs **go-ios** (안정성 비교 후 결정)
- [ ] 백그라운드 상주 방식: **예약 작업(현재 기본)** vs 정식 Windows 서비스(NSSM/WinSW)
- [ ] pymobiledevice3 배포 방식: PyInstaller onefile 번들 vs 설치 시 pip
- [ ] 미니 GUI: Electron 컴팩트 모드 vs 독립 tkinter

---

## 참고 파일

- `win/setup-wireless.ps1` — 1회 USB 무선 활성화 + DDI
- `win/install-tunneld-service.ps1` — tunneld 백그라운드 작업 등록(관리자)
- `win/launch-wda.ps1` — 무선 WDA 런치(앱 없이 테스트)
- `win/installer.nsh` — NSIS 설치/제거 훅
- `src/wdaLauncher.ts`, `src/config.ts`, `src/uiServer.ts` — 크로스플랫폼 런처 + API
- macOS 검증 레시피: `sh/setup_wda_offline.sh`, `sh/open_wda_xcode.sh`
