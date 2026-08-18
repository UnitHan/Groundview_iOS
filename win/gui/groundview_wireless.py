"""
GroundView Wireless - one-click iOS wireless-WDA tool (Windows).

Design goal: a non-expert clicks ONE button and ends up with a stable
`http://127.0.0.1:8100` that stays alive. The tool enforces the correct order
(which is also the fix for "launched while USB-connected -> dies on unplug"):

    기기 확인 -> 무선설정+DDI(케이블 O) -> tunneld -> "케이블 뽑기" 안내
      -> 무선 터널 확보 대기 -> WDA 실행 -> 포워더(127.0.0.1:8100) -> 자동 유지(워치독)

WDA is launched ONLY after the cable is out and a WiFi RemoteXPC tunnel exists,
so the runner binds the wireless tunnel and survives. A built-in watchdog then
relaunches WDA whenever it dies, and a forwarder gives scripts a fixed localhost
URL immune to the device's DHCP IP changing.

Ships as a single .exe (pymobiledevice3 bundled); no Node/Electron/Python needed.
"""

import json
import os
import queue
import subprocess
import sys
import threading
import time
import urllib.request
import tkinter as tk
from tkinter import StringVar, Text, END, DISABLED, NORMAL, W, E, N, S
from tkinter import ttk

import wda_forward   # in-process stable-localhost forwarder (dynamic IP tracking)
import wda_watchdog  # in-process WDA keep-alive engine (launch + auto-restart)

APP_TITLE = "GroundView Wireless - iOS WDA"
TUNNELD_PORT = 49151
WDA_PORT = 8100
MJPEG_PORT = 9100

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# All logs (GUI transcript + tunneld/WDA process output) land here.
LOG_DIR = os.path.join(os.path.expanduser("~"), "GroundView_log")
try:
    os.makedirs(LOG_DIR, exist_ok=True)
except Exception:
    LOG_DIR = os.path.abspath(".")
GUI_LOG = os.path.join(LOG_DIR, "wireless-gui.log")


def _ts():
    return time.strftime("[%Y-%m-%d %H:%M:%S] ")


def file_log(msg):
    try:
        with open(GUI_LOG, "a", encoding="utf-8") as f:
            f.write(_ts() + msg + "\n")
    except Exception:
        pass


def open_proc_log(name):
    """Open a per-process log file (append) for tunneld / WDA output."""
    try:
        return open(os.path.join(LOG_DIR, name), "a", encoding="utf-8", errors="replace")
    except Exception:
        return subprocess.DEVNULL

# status banner colors
C_IDLE = "#334155"
C_WORK = "#b45309"
C_OK = "#15803d"
C_ERR = "#b91c1c"
C_FG = "#f8fafc"


# --------------------------------------------------------------------------
# tool resolution
# --------------------------------------------------------------------------
def _candidate_dirs():
    dirs = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs += [meipass, os.path.join(meipass, "tools")]
    exe_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    dirs += [exe_dir, os.path.join(exe_dir, "tools")]
    here = os.path.dirname(os.path.abspath(__file__))
    dirs += [os.path.join(here, "..", "tools"),
             os.path.join(here, "..", "..", ".venv", "Scripts"),
             os.path.join(here, "..", "..", "resources", "win", "tools")]
    return dirs


def _persist_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "GroundViewWireless")
    os.makedirs(d, exist_ok=True)
    return d


def _persist_pmd3(cand):
    """If cand lives inside the PyInstaller onefile temp dir (_MEIxxxx), copy it
    to a stable folder and return that. Children (tunneld/WDA) launched from the
    temp dir keep it locked, which both breaks cleanup on exit ("Failed to remove
    temporary directory") and would kill tunneld when the GUI closes."""
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return cand
    try:
        inside = os.path.commonpath([os.path.abspath(cand), os.path.abspath(meipass)]) == os.path.abspath(meipass)
    except Exception:
        inside = os.path.abspath(cand).startswith(os.path.abspath(meipass))
    if not inside:
        return cand
    try:
        import shutil
        dst = os.path.join(_persist_dir(), os.path.basename(cand))
        if (not os.path.exists(dst)) or os.path.getsize(dst) != os.path.getsize(cand):
            shutil.copy2(cand, dst)
        return dst
    except Exception:
        return cand


def resolve_pmd3():
    name = "pymobiledevice3.exe" if os.name == "nt" else "pymobiledevice3"
    for d in _candidate_dirs():
        cand = os.path.normpath(os.path.join(d, name))
        if os.path.isfile(cand):
            return _persist_pmd3(cand)
    return name


PMD3 = resolve_pmd3()


def is_admin():
    if os.name != "nt":
        return os.geteuid() == 0  # type: ignore[attr-defined]
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# --------------------------------------------------------------------------
# pymobiledevice3 / http helpers
# --------------------------------------------------------------------------
def run_pmd3(args, timeout=30):
    try:
        p = subprocess.run([PMD3, *args], capture_output=True, text=True,
                           timeout=timeout, creationflags=CREATE_NO_WINDOW)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except FileNotFoundError:
        return 127, "", f"pymobiledevice3 not found: {PMD3}"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as e:  # noqa: BLE001
        return 1, "", str(e)


def http_get_json(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def list_devices():
    rc, out, _ = run_pmd3(["usbmux", "list"], timeout=15)
    if rc != 0 or not out:
        return []
    try:
        arr = json.loads(out)
    except Exception:  # noqa: BLE001
        return []
    # A single physical device can appear twice (USB + Network) once wifi-connections
    # is on. Dedup by UDID and merge the transports so it shows as one device.
    by_udid = {}
    order = []
    for d in arr:
        if not isinstance(d, dict):
            continue
        udid = str(d.get("Identifier") or d.get("UniqueDeviceID") or "").strip()
        if not udid:
            continue
        cls = str(d.get("DeviceClass") or "").lower()
        if cls and not any(k in cls for k in ("iphone", "ipad", "ipod")):
            continue
        conn = str(d.get("ConnectionType") or "").lower()
        transport = "USB" if conn == "usb" else ("WiFi" if conn == "network" else None)
        if udid not in by_udid:
            by_udid[udid] = {
                "udid": udid,
                "name": str(d.get("DeviceName") or "iOS Device"),
                "ios": str(d.get("ProductVersion") or ""),
                "transports": set(),
            }
            order.append(udid)
        rec = by_udid[udid]
        if transport:
            rec["transports"].add(transport)
        if not rec["ios"] and d.get("ProductVersion"):
            rec["ios"] = str(d["ProductVersion"])

    devs = []
    for udid in order:
        rec = by_udid[udid]
        t = rec.pop("transports")
        rec["conn"] = "+".join(x for x in ("USB", "WiFi") if x in t) or "?"
        devs.append(rec)
    return devs


def usbmux_usb_udids():
    """UDIDs currently connected by USB cable (empty once unplugged)."""
    rc, out, _ = run_pmd3(["usbmux", "list", "--usb", "--simple"], timeout=10)
    if rc != 0 or not out:
        return []
    try:
        a = json.loads(out)
        return [str(x) for x in a] if isinstance(a, list) else []
    except Exception:  # noqa: BLE001
        return []


def tunneld_up():
    return http_get_json(f"http://127.0.0.1:{TUNNELD_PORT}/", timeout=2) is not None


def device_tunnel(udid):
    data = http_get_json(f"http://127.0.0.1:{TUNNELD_PORT}/", timeout=3)
    if not data:
        return None
    entry = data.get(udid)
    first = entry[0] if isinstance(entry, list) and entry else entry
    if isinstance(first, dict) and first.get("tunnel-address"):
        return str(first["tunnel-address"])
    return None


def discover_runner(udid):
    rc, out, _ = run_pmd3(["apps", "list", "-t", "User", "--udid", udid], timeout=25)
    if rc != 0 or not out:
        return None
    try:
        apps = json.loads(out)
    except Exception:  # noqa: BLE001
        return None
    xct = [i for i in (apps.keys() if isinstance(apps, dict) else []) if i.lower().endswith(".xctrunner")]
    for i in xct:
        if "webdriveragent" in i.lower():
            return i
    return xct[0] if xct else None


# --------------------------------------------------------------------------
# GUI
# --------------------------------------------------------------------------
STEPS = [
    ("device", "📱", "기기 확인"),
    ("setup", "📶", "무선 설정 + 개발자 이미지"),
    ("tunneld", "🛡️", "tunneld (무선 터널 서비스)"),
    ("unplug", "🔌", "USB 케이블 뽑기"),
    ("tunnel", "🌐", "무선 터널 확보"),
    ("forward", "🔗", "고정 주소 포워더 (127.0.0.1:8100)"),
    ("keepalive", "♻️", "WDA 실행 + 자동 유지"),
]

# status glyphs per step state
STATE_ICON = {"todo": "⚪", "doing": "🔄", "ok": "✅", "fail": "❌"}


class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.devices = []
        self.session_stop = None
        self.tunneld_proc = None
        self.unplug_popup = None
        self.runner_var = StringVar(value="")
        self.fwd_url = StringVar(value="")
        self.step_vars = {}

        root.title(APP_TITLE)
        root.geometry("720x640")
        root.minsize(660, 560)
        pad = {"padx": 8, "pady": 4}

        frm = ttk.Frame(root, padding=12)
        frm.grid(row=0, column=0, sticky=(N, S, E, W))
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        frm.columnconfigure(1, weight=1)

        # device row
        ttk.Label(frm, text="기기").grid(row=0, column=0, sticky=W, **pad)
        self.dev_combo = ttk.Combobox(frm, state="readonly", values=[])
        self.dev_combo.grid(row=0, column=1, sticky=(E, W), **pad)
        ttk.Button(frm, text="새로고침", command=self.refresh_devices).grid(row=0, column=2, **pad)

        # status banner
        self.banner = tk.Label(frm, text="대기 중", bg=C_IDLE, fg=C_FG,
                               font=("Segoe UI", 14, "bold"), anchor="center", pady=12)
        self.banner.grid(row=1, column=0, columnspan=3, sticky=(E, W), padx=8, pady=(8, 4))

        # primary action
        self.primary = ttk.Button(frm, text="🚀  무선 연결 시작", command=self.toggle_session)
        self.primary.grid(row=2, column=0, columnspan=3, sticky=(E, W), padx=8, pady=(2, 8))

        # checklist
        chk = ttk.LabelFrame(frm, text="진행 상태", padding=8)
        chk.grid(row=3, column=0, columnspan=3, sticky=(E, W), **pad)
        chk.columnconfigure(0, weight=1)
        for i, (key, emoji, label) in enumerate(STEPS):
            v = StringVar(value=f"{STATE_ICON['todo']}  {emoji}  {label}")
            self.step_vars[key] = (v, emoji, label)
            tk.Label(chk, textvariable=v, anchor="w", font=("Segoe UI", 11)).grid(
                row=i, column=0, sticky=W, pady=2)

        # stable URL
        urlf = ttk.Frame(frm)
        urlf.grid(row=4, column=0, columnspan=3, sticky=(E, W), **pad)
        urlf.columnconfigure(1, weight=1)
        ttk.Label(urlf, text="고정 URL").grid(row=0, column=0, sticky=W)
        ttk.Entry(urlf, textvariable=self.fwd_url, state="readonly").grid(row=0, column=1, sticky=(E, W), padx=6)
        ttk.Button(urlf, text="복사", command=self.copy_fwd).grid(row=0, column=2)

        # advanced (manual) — collapsed by default
        self.adv_open = tk.BooleanVar(value=False)
        ttk.Checkbutton(frm, text="고급 (수동 제어)", variable=self.adv_open,
                        command=self._toggle_adv).grid(row=5, column=0, sticky=W, padx=8)
        self.adv = ttk.Frame(frm)
        self.adv.grid(row=6, column=0, columnspan=3, sticky=(E, W), **pad)
        ttk.Label(self.adv, text="Runner 번들 ID").grid(row=0, column=0, sticky=W)
        ttk.Entry(self.adv, textvariable=self.runner_var, width=42).grid(row=0, column=1, sticky=(E, W), padx=4)
        ttk.Button(self.adv, text="자동 탐색", command=self.autodetect_runner).grid(row=0, column=2, padx=2)
        self.adv.columnconfigure(1, weight=1)
        abtn = ttk.Frame(self.adv)
        abtn.grid(row=1, column=0, columnspan=3, sticky=W, pady=(4, 0))
        ttk.Button(abtn, text="무선설정", command=self.m_setup).grid(row=0, column=0, padx=2)
        ttk.Button(abtn, text="tunneld", command=self.m_tunneld).grid(row=0, column=1, padx=2)
        ttk.Button(abtn, text="WDA 실행", command=self.m_launch).grid(row=0, column=2, padx=2)
        ttk.Button(abtn, text="WDA 중지", command=self.m_stop).grid(row=0, column=3, padx=2)
        self.adv.grid_remove()

        # log
        self.log = Text(frm, height=10, wrap="word", state=DISABLED,
                        bg="#0b1221", fg="#e5e7eb", insertbackground="#e5e7eb")
        self.log.grid(row=7, column=0, columnspan=3, sticky=(N, S, E, W), **pad)
        frm.rowconfigure(7, weight=1)

        self._log(f"pymobiledevice3 = {PMD3}")
        self._log("권한: " + ("관리자 (tunneld 자동 시작 가능)" if is_admin()
                              else "일반 - tunneld 시작하려면 '관리자 권한으로 실행'"))
        self._log(f"로그 폴더: {LOG_DIR}  (wireless-gui.log / tunneld.log / wda.log)")
        self.refresh_devices()
        self.root.after(100, self._drain)

    # --- infra ------------------------------------------------------------
    def _toggle_adv(self):
        (self.adv.grid if self.adv_open.get() else self.adv.grid_remove)()

    def _log(self, msg):
        self.log.configure(state=NORMAL)
        self.log.insert(END, msg + "\n")
        self.log.see(END)
        self.log.configure(state=DISABLED)
        file_log(msg)

    def _post(self, fn, *a):
        self.q.put((fn, a))

    def _drain(self):
        try:
            while True:
                fn, a = self.q.get_nowait()
                fn(*a)
        except queue.Empty:
            pass
        self.root.after(100, self._drain)

    def _bg(self, target):
        threading.Thread(target=target, daemon=True).start()

    def selected_udid(self):
        i = self.dev_combo.current()
        if i < 0 or i >= len(self.devices):
            return None
        return self.devices[i]["udid"]

    def set_banner(self, text, color):
        self._post(lambda: self.banner.config(text=text, bg=color))

    def set_step(self, key, state):
        # state: 'todo' | 'doing' | 'ok' | 'fail'
        icon = STATE_ICON.get(state, "⚪")
        v, emoji, label = self.step_vars[key]
        self._post(v.set, f"{icon}  {emoji}  {label}")

    def reset_steps(self):
        for key in self.step_vars:
            self.set_step(key, "todo")

    # --- device -----------------------------------------------------------
    def refresh_devices(self):
        def work():
            devs = list_devices()
            self._post(self._apply_devices, devs)
        self._bg(work)

    def _apply_devices(self, devs):
        self.devices = devs
        labels = [f'{d["name"]}  ({d["ios"]})  [{d["conn"]}]  {d["udid"][:8]}' for d in devs]
        self.dev_combo["values"] = labels
        if labels:
            self.dev_combo.current(0)
            self._log(f"기기 {len(devs)}대 발견")
        else:
            self._log("기기 없음 - USB 연결 + 잠금 해제 + '신뢰' 확인")

    def autodetect_runner(self):
        udid = self.selected_udid()
        if not udid:
            self._log("기기를 먼저 선택하세요")
            return

        def work():
            r = discover_runner(udid)
            if r:
                self._post(self.runner_var.set, r)
                self._post(self._log, f"Runner = {r}")
            else:
                self._post(self._log, "Runner 자동 탐색 실패 - 수동 입력 필요")
        self._bg(work)

    # --- one-click session ------------------------------------------------
    def toggle_session(self):
        if self.session_stop is not None:
            self.stop_session()
        else:
            self.start_session()

    def stop_session(self):
        if self.session_stop:
            self.session_stop.set()
        self.session_stop = None
        self._post(self._close_unplug_popup)
        self.fwd_url.set("")
        self._post(lambda: self.primary.config(text="🚀  무선 연결 시작"))
        self.set_banner("중지됨", C_IDLE)
        self._log("세션 중지 (tunneld는 계속 실행됨)")

    def start_session(self):
        udid = self.selected_udid()
        if not udid:
            self._log("기기를 먼저 선택하세요")
            return
        self.session_stop = threading.Event()
        self.reset_steps()
        self.fwd_url.set("")
        self._post(lambda: self.primary.config(text="■  중지"))
        self._bg(lambda: self._session_worker(udid, self.session_stop))

    def _session_worker(self, udid, stop):
        try:
            # 1) device
            self.set_step("device", "ok")
            self.set_banner("무선 설정 중...", C_WORK)

            # 2) wifi-connections + DDI (best over USB)
            self.set_step("setup", "doing")
            rc, out, err = run_pmd3(["lockdown", "wifi-connections", "--state", "on", "--udid", udid], timeout=20)
            self._post(self._log, "wifi-connections on " + ("OK" if rc == 0 else f"({err or out})"))
            self._post(self._log, "개발자 이미지(DDI) 마운트 중... (인터넷 필요, 시간 소요 가능)")
            run_pmd3(["mounter", "auto-mount", "--udid", udid], timeout=180)
            self.set_step("setup", "ok")
            if stop.is_set():
                return

            # 3) tunneld
            self.set_step("tunneld", "doing")
            if not tunneld_up():
                if is_admin():
                    self._post(self._log, "tunneld 시작 (관리자, Wintun)...")
                    try:
                        tlog = open_proc_log("tunneld.log")
                        self.tunneld_proc = subprocess.Popen(
                            [PMD3, "remote", "tunneld", "--wifi"],
                            stdout=tlog, stderr=tlog,
                            creationflags=CREATE_NO_WINDOW)
                    except Exception as e:  # noqa: BLE001
                        self._post(self._log, f"tunneld 시작 실패: {e}")
                    for _ in range(20):
                        if tunneld_up() or stop.is_set():
                            break
                        time.sleep(1)
                else:
                    self.set_step("tunneld", "fail")
                    self.set_banner("관리자 권한 필요 - '관리자 권한으로 실행'", C_ERR)
                    self._post(self._log, "tunneld는 관리자 권한 필요. 프로그램을 관리자로 다시 실행하세요.")
                    self._finish_fail()
                    return
            if not tunneld_up():
                self.set_step("tunneld", "fail")
                self.set_banner("tunneld 응답 없음 - Wintun/방화벽 확인", C_ERR)
                self._finish_fail()
                return
            self.set_step("tunneld", "ok")
            if stop.is_set():
                return

            # 4) unplug + 5) wireless tunnel — launch ONLY after cable out + wifi tunnel
            self.set_step("unplug", "doing")
            self.set_step("tunnel", "doing")
            popup_shown = False
            waited = 0
            while not stop.is_set():
                usb = usbmux_usb_udids()
                tun = device_tunnel(udid)
                cable_out = udid not in usb
                if not cable_out:
                    if not popup_shown:
                        self._post(self._show_unplug_popup)
                        popup_shown = True
                    self.set_banner("👉  지금 USB 케이블을 뽑으세요", C_WORK)
                else:
                    if popup_shown:
                        self._post(self._close_unplug_popup)
                        popup_shown = False
                    if not tun:
                        self.set_banner("케이블 뽑힘 - 무선 터널 잡는 중...", C_WORK)
                    else:
                        break
                time.sleep(2)
                waited += 2
                if waited in (30, 60, 90):
                    self._post(self._log, f"무선 터널 대기 {waited}s... (같은 WiFi/방화벽 UDP 5353 확인)")
            self._post(self._close_unplug_popup)
            if stop.is_set():
                return
            self.set_step("unplug", "ok")
            self.set_step("tunnel", "ok")
            self._post(self._log, f"무선 터널 확보: {device_tunnel(udid)}")

            # 6) forwarder (fixed localhost URL)
            self.set_step("forward", "doing")

            def on_ready(host, port):
                url = f"http://{host}:{port}"
                self._post(self.fwd_url.set, url)
                self._post(self._log, f"고정 URL 준비: {url} (스크립트는 이 주소 사용)")
                self.set_step("forward", "ok")
            self._bg(lambda: self._safe_forwarder(udid, stop, on_ready))

            # 7) WDA launch + keep-alive (watchdog engine)
            self.set_step("keepalive", "doing")
            self.set_banner("WDA 실행 + 자동 유지 시작...", C_WORK)
            runner = self.runner_var.get().strip() or None
            self._bg(lambda: self._safe_watchdog(udid, runner, stop))
        except Exception as e:  # noqa: BLE001
            self._post(self._log, f"세션 오류: {e}")
            self.set_banner("오류 발생 - 로그 확인", C_ERR)
            self._finish_fail()

    def _safe_forwarder(self, udid, stop, on_ready):
        try:
            wda_forward.run_forwarder(udid, local_host="127.0.0.1", local_port=WDA_PORT,
                                      wda_port=WDA_PORT, tunneld_port=TUNNELD_PORT,
                                      stop=stop, on_ready=on_ready)
        except OSError as e:
            self._post(self._log, f"포워더 실패(포트 {WDA_PORT} 사용중?): {e}")
        except Exception as e:  # noqa: BLE001
            self._post(self._log, f"포워더 오류: {e}")

    def _safe_watchdog(self, udid, runner, stop):
        def on_event(kind, msg):
            self._post(self._log, f"[유지] {msg}")
            if kind in ("alive", "recovered"):
                self.set_step("keepalive", "ok")
                self.set_banner(f"✅  무선 연결됨 · http://127.0.0.1:{WDA_PORT}", C_OK)
            elif kind in ("down", "relaunch", "wait-tunnel", "timeout", "launch-fail"):
                self.set_banner("재연결 중... (WDA 복구 대기)", C_WORK)
            elif kind == "no-runner":
                self.set_banner("Runner 번들 미발견 - 고급에서 지정", C_ERR)
        try:
            wda_watchdog.run_watchdog(udid, runner=runner, pmd3=PMD3,
                                      wda_port=WDA_PORT, mjpeg_port=MJPEG_PORT,
                                      tunneld_port=TUNNELD_PORT, poll=5.0,
                                      ready_timeout=60.0, stop=stop, on_event=on_event,
                                      log_dir=LOG_DIR)
        except Exception as e:  # noqa: BLE001
            self._post(self._log, f"워치독 오류: {e}")

    # --- unplug popup (main thread only) ----------------------------------
    def _show_unplug_popup(self):
        if self.unplug_popup is not None:
            return
        top = tk.Toplevel(self.root)
        top.title("USB 케이블 뽑기")
        top.configure(bg=C_WORK)
        top.resizable(False, False)
        top.transient(self.root)
        tk.Label(top, text="🔌", font=("Segoe UI Emoji", 52), bg=C_WORK, fg=C_FG).pack(pady=(22, 2))
        tk.Label(top, text="지금 USB 케이블을 뽑으세요", font=("Segoe UI", 16, "bold"),
                 bg=C_WORK, fg=C_FG).pack()
        tk.Label(top, text="뽑으면 자동으로 다음 단계로 진행됩니다.",
                 font=("Segoe UI", 10), bg=C_WORK, fg="#fde68a").pack(pady=(6, 12))
        ttk.Button(top, text="확인", command=self._close_unplug_popup).pack(pady=(0, 16))
        # center over the main window
        top.update_idletasks()
        try:
            px, py = self.root.winfo_rootx(), self.root.winfo_rooty()
            pw, ph = self.root.winfo_width(), self.root.winfo_height()
            w, h = 380, 240
            top.geometry(f"{w}x{h}+{px + (pw - w) // 2}+{py + (ph - h) // 2}")
        except Exception:
            top.geometry("380x240")
        top.grab_set()
        top.attributes("-topmost", True)
        try:
            top.bell()
        except Exception:
            pass
        self.unplug_popup = top

    def _close_unplug_popup(self):
        if self.unplug_popup is not None:
            try:
                self.unplug_popup.grab_release()
                self.unplug_popup.destroy()
            except Exception:
                pass
            self.unplug_popup = None

    def _finish_fail(self):
        self._post(self._close_unplug_popup)
        self.session_stop = None
        self._post(lambda: self.primary.config(text="🚀  무선 연결 시작"))

    def copy_fwd(self):
        url = self.fwd_url.get()
        if not url:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        self._log(f"복사됨: {url}")

    # --- advanced manual --------------------------------------------------
    def m_setup(self):
        udid = self.selected_udid()
        if not udid:
            self._log("기기 선택 필요"); return

        def work():
            rc, out, err = run_pmd3(["lockdown", "wifi-connections", "--state", "on", "--udid", udid], timeout=20)
            self._post(self._log, "wifi-connections on " + ("OK" if rc == 0 else f"FAIL: {err or out}"))
            run_pmd3(["mounter", "auto-mount", "--udid", udid], timeout=180)
            self._post(self._log, "auto-mount 완료")
        self._bg(work)

    def m_tunneld(self):
        def work():
            if tunneld_up():
                self._post(self._log, "tunneld 이미 실행 중"); return
            if not is_admin():
                self._post(self._log, "tunneld는 관리자 권한 필요"); return
            try:
                tlog = open_proc_log("tunneld.log")
                self.tunneld_proc = subprocess.Popen(
                    [PMD3, "remote", "tunneld", "--wifi"],
                    stdout=tlog, stderr=tlog,
                    creationflags=CREATE_NO_WINDOW)
            except Exception as e:  # noqa: BLE001
                self._post(self._log, f"tunneld 시작 실패: {e}"); return
            for _ in range(20):
                if tunneld_up():
                    self._post(self._log, "tunneld READY"); return
                time.sleep(1)
            self._post(self._log, "tunneld REST 무응답")
        self._bg(work)

    def m_launch(self):
        udid = self.selected_udid()
        if not udid:
            self._log("기기 선택 필요"); return
        runner = self.runner_var.get().strip() or None
        stop = threading.Event()

        def work():
            wda_watchdog.run_watchdog(udid, runner=runner, pmd3=PMD3, wda_port=WDA_PORT,
                                      mjpeg_port=MJPEG_PORT, tunneld_port=TUNNELD_PORT,
                                      poll=5.0, ready_timeout=60.0, stop=stop,
                                      on_event=lambda k, m: self._post(self._log, f"[유지] {m}"))
        self._manual_stop = stop
        self._bg(work)
        self._log("수동 WDA 유지 시작 (중지 버튼으로 종료)")

    def m_stop(self):
        s = getattr(self, "_manual_stop", None)
        if s:
            s.set()
        udid = self.selected_udid()
        if udid:
            self._bg(lambda: run_pmd3(["developer", "dvt", "pkill", "WebDriverAgentRunner-Runner", "--tunnel", udid], timeout=15))
        self._log("WDA 중지")


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
