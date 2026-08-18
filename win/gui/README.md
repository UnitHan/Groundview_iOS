# GroundView Wireless — standalone iOS wireless-WDA bundle (Windows)

A single-file GUI (`GroundViewWireless.exe`) that brings an iPhone up over WiFi
and launches its already-installed WebDriverAgent, printing the `WDA URL` for
Appium / GroundView iOS. No Node, Electron, or Python install required —
`pymobiledevice3.exe` (with Wintun) is bundled inside.

## Files

| File | Role |
|------|------|
| `groundview_wireless.py` | tkinter GUI (device list, status, ①②③ launch, ④ forwarder, WDA URL) |
| `wda_forward.py` | stable `127.0.0.1:8100` → device WDA forwarder with dynamic IP tracking |
| `pmd3_entry.py` | PyInstaller entry for a standalone `pymobiledevice3.exe` |
| `build_bundle.py` | builds all exes end-to-end |

## Build (from the project venv)

```powershell
# one-time: python -m venv .venv ; .venv\Scripts\pip install pymobiledevice3 pyinstaller
python win\gui\build_bundle.py
```

Outputs:
- `win\dist\GroundViewWireless.exe` — the standalone GUI (ships `pymobiledevice3.exe` inside)
- `win\tools\pymobiledevice3.exe` — engine, also consumed by the Electron app + NSIS installer

## Use

The exe is built with a `requireAdministrator` manifest, so it **always launches
elevated** (a UAC prompt appears) — the RemoteXPC tunnel (Wintun) needs admin.

1. **① 무선 설정 (USB 1회)** — connect the iPhone by USB, unlock, Trust. Enables
   `wifi-connections` and mounts the Developer Disk Image. Run once per device.
2. **② tunneld 시작/확인** — because the GUI runs elevated, it starts
   `pymobiledevice3 remote tunneld --wifi` itself and waits for `tunneld: ON`.
   (For a boot-persistent daemon instead, use `install-tunneld-service.ps1`.)
3. Unplug USB, stay on the same WiFi, pick the device, **③ WDA 실행 (무선)**.
   On success the `WDA URL` box fills in (`http://<deviceIp>:8100`) — copy it into
   Appium's `webDriverAgentUrl`.

## 유동 IP + 장기 aging: 고정 URL 포워더

테스트 스크립트가 WDA에 직접 붙거나 IP가 유동(DHCP)일 때, 스크립트엔 **고정
`http://127.0.0.1:8100`**만 주고 포워더가 현재 기기 IP를 자동 추적한다.

```powershell
wda_forward.exe --udid <UDID> --local-port 8100
```

또는 GUI **④ 포워더 시작/중지** → "고정 URL" 칸 주소 사용. IP가 바뀌면 포워더가
UDID→tunneld→`/status`→`ios.ip` 체인으로 재조회해 타깃만 교체(스크립트 무변경).
1개월+ aging에는 이 방식 권장(고정 IP 불필요).

## Notes

- Wintun + the RemoteXPC tunnel require **Administrator** — the exe's manifest
  forces elevation on launch, so tunneld can be started from the GUI.
- 포워더는 순수 소켓/HTTP만 사용(관리자 불필요, pymobiledevice3 미호출) — tunneld가
  떠 있으면 동작한다.
- `pymobiledevice3.exe` is located next to the GUI / in `tools\` / on PATH, in
  that order — the same resolution the Electron app uses (`src/config.ts`).
- Runner bundle id: **자동 탐색** uses `pymobiledevice3 apps list`; if it fails,
  type it manually (e.g. `com.jjun.1.WebDriverAgentRunner.xctrunner`).
