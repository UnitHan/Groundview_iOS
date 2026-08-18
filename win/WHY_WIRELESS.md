# 왜 Wi-Fi 무선 연결이 가능해졌나

GroundView iOS(Appkium Inspector iOS)를 Windows에서 **USB 케이블 없이** iPhone에
연결해 WDA(WebDriverAgent)를 구동할 수 있게 된 원리 요약.

---

## 한 줄 요약

iOS 17+는 개발자 기능을 **RemoteXPC 터널** 위에서 제공한다. 이 터널은 USB든
Wi-Fi든 무관하게 동작하므로, USB에만 묶여 있던 유일한 조각(`iproxy` 포트 포워딩)을
걷어내고 **기기의 LAN IP로 직접 접속**하면 무선으로 완성된다.

---

## 기존에 왜 USB만 됐나

과거 파이프라인의 USB 의존은 딱 하나, `iproxy`였다.

- WDA는 기기 안에서 HTTP 서버를 `0.0.0.0:8100`에 연다 (모든 인터페이스 바인딩).
- 하지만 PC는 그걸 `iproxy 8100:8100`로 **usbmux(USB) 위에서** `127.0.0.1:8100`으로
  당겨 썼다. usbmux는 USB 케이블 전용 → 케이블 뽑으면 끊김.
- 앱 코드도 macOS 전용으로 하드코딩돼 있어 Windows에선 기기 목록조차 비어 있었다.

즉 "무선이 원리적으로 불가능"했던 게 아니라, **USB 전용 부품 하나 + macOS 게이트**가
막고 있었을 뿐.

---

## iOS 17+에서 무선이 되는 진짜 이유

iOS 17.4+부터 개발자 서비스(테스트 러너 실행, 스크린샷, DDI 등)는 모두
**RemoteXPC 터널**을 통해 오간다. 이 터널의 특성:

1. **전송 계층 독립** — 터널만 서면 그 위 개발자 명령은 USB/Wi-Fi를 가리지 않는다.
2. **네트워크 디스커버리 지원** — `wifi-connections`(Xcode의 "Connect via network"에
   해당)를 켜면 기기가 mDNS/Bonjour로 같은 LAN에 광고된다.
3. **WDA는 어차피 IP로 접속** — 러너가 뜨면 기기 `LAN IP:8100`이 열리므로 PC는
   `iproxy` 없이 그 IP로 바로 HTTP 접속하면 된다.

그래서 무선 완성에 필요한 건 세 가지뿐이다: **터널을 세우고 → 러너를 띄우고 →
기기 IP로 접속**.

---

## 이 프로그램이 한 일

### 1. Windows용 터널 엔진 확보 (pymobiledevice3 + Wintun)

- `pymobiledevice3`가 iOS 17 RemoteXPC 터널을 만든다.
- 터널은 유저스페이스 TUN 장치를 필요로 하는데, Windows에선 `pytun_pmd3`가
  **Wintun**(`wintun.dll`)으로 이걸 생성한다. → 번들 exe에 wintun.dll 내장.
- 이 터널 생성은 관리자 권한이 필요 → GUI를 `requireAdministrator`로 승격 실행.

### 2. 앱을 크로스플랫폼화

macOS 전용 차단을 걷어냄:

| 파일 | 변경 |
|------|------|
| `src/service.ts` | `listDevices/capture/health`의 macOS 게이트 제거 (WDA는 HTTP라 OS 무관) |
| `src/deviceList.ts` | Windows 기기 탐색을 `pymobiledevice3 usbmux list`로 (USB+무선 모두) |
| `src/iproxyManager.ts` | Windows는 `iproxy` 안 씀 → 무선 직결 경로로 |
| `src/wdaLauncher.ts` | 러너 번들 자동 탐색을 `pymobiledevice3 apps list`로 |
| `src/config.ts` | pymobiledevice3 경로 자동 해석(venv/번들/PATH) |

### 3. 무선 파이프라인 3단계 (GUI 버튼 ①②③)

```
① (USB 1회)  wifi-connections --state on  +  mounter auto-mount
                 └ 기기를 Wi-Fi로 발견 가능하게 + 개발자 이미지(DDI) 마운트

② (관리자)   pymobiledevice3 remote tunneld --wifi     → REST :49151
                 └ RemoteXPC 터널 상시 유지, Wi-Fi 기기 mDNS로 발견

③ (무선)     developer dvt xcuitest --tunnel <UDID> <runner>
                 └ 설치된 WDA 러너 실행 → 기기 LAN IP:8100 오픈
                    앱/Appium은 http://<기기IP>:8100 으로 직접 접속
```

①은 케이블 꽂고 딱 한 번. 이후 ②③은 케이블 없이 같은 Wi-Fi에서 반복.

---

## 데이터 흐름 비교

```
[기존·USB]
  PC ──USB(usbmux)──> iproxy ──> 127.0.0.1:8100 ──> WDA
        (케이블 뽑으면 끊김)

[현재·무선]
  PC ──Wi-Fi/LAN──────────────> 기기IP:8100 ──> WDA (HTTP 직결)
  PC ──RemoteXPC 터널(Wintun)──> testmanagerd (러너 세션 유지)
        (Bonjour + 같은 서브넷이면 케이블 뽑아도 유지)
```

---

## 무선이 "유지"되는 조건

케이블을 뽑아도 연결이 살아 있으려면:

1. `wifi-connections` 켜짐 (①)
2. `tunneld`가 `--wifi`로 실행 중 (②)
3. **Apple Mobile Device Support(usbmux) 설치** — 기기 페어링/USB 인식용
   (iTunes **또는** Microsoft Store "Apple Devices" 앱, 아래 참고)
4. PC와 iPhone이 **같은 Wi-Fi 서브넷**, 방화벽에서 **mDNS(UDP 5353) 허용**
5. WDA URL이 **터널 전용 IPv6(`[fdxx::]`)가 아니라 실제 LAN IP(`192.168.x.x`)**

5번이 핵심: 실제 LAN IP로 잡히면 WDA HTTP는 순수 Wi-Fi 경로라 케이블과 무관하다.

---

## Apple Mobile Device Support / Bonjour 관련 (회사 보안정책 대응)

**iTunes가 정책으로 막혀도 무선 연결 가능하다.** 실제 필요한 건 Bonjour가 아니라
**Apple Mobile Device Support(usbmux)** 하나다.

- **usbmux(Apple Mobile Device Support)** — USB 기기 인식과 페어링에 필요.
  → **Microsoft Store "Apple Devices" 앱**이 이걸 포함한다. iTunes 대체로 충분.
- **Bonjour(iTunes 번들 mDNSResponder)** — **필수 아님.** `pymobiledevice3`의
  `remote tunneld --wifi`는 `pymobiledevice3/bonjour.py`에 **자체 mDNS 브라우저**
  (raw UDP 5353, `ifaddr`로 인터페이스 매핑)를 내장해 스스로 기기를 찾는다.
  Apple의 Bonjour 서비스에 의존하지 않는다.

| 설치물 | 무선에 필요? | 어디서 |
|--------|:---:|--------|
| Apple Mobile Device Support (usbmux) | ✅ 필요 | Store **Apple Devices** 앱 또는 iTunes |
| Bonjour (mDNSResponder) | ❌ 불필요 | (tunneld `--wifi`가 자체 mDNS 수행) |

**따라서 권장 셋업(iTunes 차단 환경):**
1. Microsoft Store에서 **"Apple Devices"** 설치 → usbmux 확보
2. 방화벽에서 **UDP 5353(mDNS)** 인/아웃바운드 허용, PC·iPhone 같은 서브넷
3. 나머지 파이프라인(①②③) 동일

> 참고: tunneld의 `--mobdev2` 모니터는 usbmux의 네트워크 기기 목록을 쓰므로 usbmux가
> 필요하지만, `--wifi` 모니터는 자체 mDNS라 usbmux 없이도 발견은 가능하다. 다만 **최초
> 페어링(①)과 USB 기기 인식엔 usbmux가 반드시 있어야** 하므로 Apple Devices 앱은 설치할 것.

---

## 유동 IP 환경 + 장기 aging: 고정 localhost URL

공유기가 고정 IP를 안 주는(유동 DHCP) 환경에서도, **바뀌지 않는 UDID로 현재 IP를
매번 역추적**하면 IP 변동을 자동 흡수할 수 있다.

```
UDID(불변) → tunneld REST → 현재 터널주소 → GET /status → value.ios.ip = 현재 IP
```

두 층위로 대응한다:

1. **앱 내부(자동 갱신)** — `src/wdaLauncher.ts`의 `resolveWirelessIp()` +
   `src/uiServer.ts`. health/capture가 실패하면 위 체인으로 새 IP를 뽑아 재등록·재시도.
   GroundView 앱으로 캡처하는 경로는 고정 IP 없이도 IP 변동을 따라간다.

2. **WDA 직접 주입 / 장기 aging(권장) — 로컬 포워더** — 테스트 스크립트가 WDA에
   직접 HTTP를 쏘는 경우, 스크립트엔 **고정 URL `http://127.0.0.1:8100`**만 주고
   포워더가 뒤에서 현재 기기 IP로 전달한다. IP가 바뀌면 포워더가 터널로 재조회해
   타깃만 교체 → 스크립트는 무변경.

   ```
   스크립트 ──> 127.0.0.1:8100 (불변) ──[wda_forward, IP 자동추적]──> 기기IP:8100 ──> WDA
   ```

   실행:
   ```powershell
   # 독립 exe (Scheduled Task로 상주 권장)
   wda_forward.exe --udid <UDID> --local-port 8100
   # 또는 GUI의 "④ 포워더 시작/중지" 버튼 → "고정 URL" 칸의 주소 사용
   ```

   유동 IP·1개월+ aging에는 이 방식이 가장 견고하다(고정 IP/DHCP 예약 불필요).

---

## 참고

- 상세 셋업/체크리스트: `win/WINDOWS_TODO.md`
- 번들 GUI + 포워더 사용법: `win/gui/README.md`
- 크로스플랫폼 런처 코드: `src/wdaLauncher.ts`, `src/config.ts`
- 유동 IP 자동 갱신: `resolveWirelessIp()` (`src/wdaLauncher.ts`), `win/gui/wda_forward.py`
