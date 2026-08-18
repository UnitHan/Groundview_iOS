"""
WDA Watchdog - keep WebDriverAgent alive over WiFi for long-running (aging) tests.

Polls WDA /status through the RemoteXPC tunnel; when WDA is down it relaunches the
installed XCUITest runner over the CURRENT tunnel (which, once the cable is out and
tunneld --wifi has re-discovered the device, is a WiFi tunnel - so the relaunched
session is wireless and survives). Reports heartbeats, restarts and downtime.

This is the piece that makes 1-month wireless aging practical: WDA will occasionally
die (sleep, memory, iOS events); the watchdog brings it back in seconds with no
human action. Pair with wda_forward for a stable 127.0.0.1:8100 URL.

Usage:
    wda_watchdog.exe --udid <UDID> [--runner <bundleId>] [--poll 5]
                     [--ready-timeout 60] [--pmd3 <path>]
Prereqs: tunneld running (pymobiledevice3 remote tunneld --wifi), device wireless-
enabled (wifi-connections + DDI), WDA runner already installed. Stop with Ctrl+C.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# Console may be cp949 (Korean Windows); force UTF-8 so any char prints safely.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def log(msg):
    try:
        print(time.strftime("[%H:%M:%S] ") + msg, flush=True)
    except UnicodeEncodeError:
        print(time.strftime("[%H:%M:%S] ") + msg.encode("ascii", "replace").decode(), flush=True)


# --- pymobiledevice3 resolution (bundled -> venv -> PATH) ------------------
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


def _persist_pmd3(cand):
    """Copy a pymobiledevice3 that lives inside the onefile temp dir (_MEIxxxx) out
    to a stable folder, so long-lived children don't lock the temp dir (which both
    breaks exit cleanup and would kill WDA/tunneld when this process exits)."""
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
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        dstdir = os.path.join(base, "GroundViewWireless")
        os.makedirs(dstdir, exist_ok=True)
        dst = os.path.join(dstdir, os.path.basename(cand))
        if (not os.path.exists(dst)) or os.path.getsize(dst) != os.path.getsize(cand):
            shutil.copy2(cand, dst)
        return dst
    except Exception:
        return cand


def resolve_pmd3(explicit=None):
    if explicit:
        return explicit
    name = "pymobiledevice3.exe" if os.name == "nt" else "pymobiledevice3"
    for d in _candidate_dirs():
        cand = os.path.normpath(os.path.join(d, name))
        if os.path.isfile(cand):
            return _persist_pmd3(cand)
    return name


# --- helpers --------------------------------------------------------------
def http_get_json(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def device_tunnel(udid, tunneld_port):
    data = http_get_json(f"http://127.0.0.1:{tunneld_port}/", timeout=3)
    if not data:
        return None
    entry = data.get(udid)
    first = entry[0] if isinstance(entry, list) and entry else entry
    if isinstance(first, dict) and first.get("tunnel-address"):
        return str(first["tunnel-address"])
    return None


def wda_status(host, port, timeout=2):
    host_fmt = f"[{host}]" if ":" in host else host
    return http_get_json(f"http://{host_fmt}:{port}/status", timeout=timeout)


def run_pmd3(pmd3, args, timeout=25):
    try:
        p = subprocess.run([pmd3, *args], capture_output=True, text=True,
                           timeout=timeout, creationflags=CREATE_NO_WINDOW)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except Exception as e:  # noqa: BLE001
        return 1, "", str(e)


def discover_runner(pmd3, udid):
    rc, out, _ = run_pmd3(pmd3, ["apps", "list", "-t", "User", "--udid", udid])
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


# --- watchdog core --------------------------------------------------------
def run_watchdog(udid, runner=None, pmd3=None, wda_port=8100, mjpeg_port=9100,
                 tunneld_port=49151, poll=5.0, ready_timeout=60.0,
                 stop=None, on_event=None, log_dir=None):
    """Blocking watch loop. Reusable from CLI and GUI (in a thread).

    log_dir: if given, WDA (dvt xcuitest) stdout/stderr is captured to wda.log
    there (instead of discarded) for debugging launch/tunnel failures.
    """
    if stop is None:
        stop = threading.Event()
    pmd3 = resolve_pmd3(pmd3)

    def wda_out():
        if not log_dir:
            return subprocess.DEVNULL
        try:
            return open(os.path.join(log_dir, "wda.log"), "a", encoding="utf-8", errors="replace")
        except Exception:
            return subprocess.DEVNULL

    def emit(kind, msg):
        log(msg)
        if on_event:
            try:
                on_event(kind, msg)
            except Exception:
                pass

    launch_proc = None
    restarts = 0
    fails = 0
    down_since = None
    was_alive = None
    emit("start", f"watchdog 시작 udid={udid[:8]} pmd3={pmd3}")

    while not stop.is_set():
        tunnel = device_tunnel(udid, tunneld_port)
        alive = False
        ip = None
        if tunnel:
            st = wda_status(tunnel, wda_port, timeout=2)
            if st and st.get("value", {}).get("ready"):
                alive = True
                ip = st["value"].get("ios", {}).get("ip")

        if alive:
            if was_alive is not True:
                if down_since is not None:
                    emit("recovered", f"WDA 복구됨 (다운 {int(time.time()-down_since)}s) ip={ip}")
                    down_since = None
                else:
                    emit("alive", f"WDA 정상 ip={ip} tunnel={tunnel}")
                was_alive = True
                fails = 0
            stop.wait(poll)
            continue

        # WDA down
        if was_alive is not False:
            emit("down", f"WDA 다운 감지 (tunnel={'있음' if tunnel else '없음'}) - 재실행 시도")
            was_alive = False
            down_since = down_since or time.time()

        if not tunnel:
            # tunneld hasn't (re)discovered the device yet - wait, don't thrash
            emit("wait-tunnel", "터널 없음 - tunneld의 WiFi 재발견 대기 (mDNS)")
            stop.wait(poll)
            continue

        runner_id = runner or discover_runner(pmd3, udid)
        if not runner_id:
            emit("no-runner", "러너 번들 미발견 - --runner 지정 필요")
            stop.wait(poll)
            continue

        # clear any zombie runner, then relaunch over the current tunnel
        if launch_proc and launch_proc.poll() is None:
            try:
                launch_proc.terminate()
            except Exception:
                pass
        run_pmd3(pmd3, ["developer", "dvt", "pkill", "WebDriverAgentRunner-Runner", "--tunnel", udid], timeout=15)
        try:
            _out = wda_out()
            launch_proc = subprocess.Popen(
                [pmd3, "developer", "dvt", "xcuitest", "--tunnel", udid,
                 "--env", f"USE_PORT={wda_port}", "--env", f"MJPEG_SERVER_PORT={mjpeg_port}", runner_id],
                stdout=_out, stderr=_out,
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception as e:  # noqa: BLE001
            emit("launch-fail", f"재실행 실패: {e}")
            fails += 1
            stop.wait(min(poll * max(fails, 1), 30))
            continue
        restarts += 1
        emit("relaunch", f"WDA 재실행 #{restarts} (runner={runner_id}, pid={launch_proc.pid}) - 준비 대기...")

        # wait for ready
        deadline = time.time() + ready_timeout
        recovered = False
        while time.time() < deadline and not stop.is_set():
            t2 = device_tunnel(udid, tunneld_port) or tunnel
            st = wda_status(t2, wda_port, timeout=2)
            if st and st.get("value", {}).get("ready"):
                recovered = True
                break
            stop.wait(2)
        if recovered:
            emit("recovered", f"WDA 복구됨 (다운 {int(time.time()-(down_since or time.time()))}s, 재실행 #{restarts})")
            was_alive = True
            down_since = None
            fails = 0
        else:
            fails += 1
            emit("timeout", f"재실행 후 {int(ready_timeout)}s 내 미준비 (연속실패 {fails}) - 백오프")
            stop.wait(min(poll * fails, 30))

    emit("stop", f"watchdog 종료 (총 재실행 {restarts})")


def main():
    ap = argparse.ArgumentParser(description="Keep WDA alive over WiFi for aging tests")
    ap.add_argument("--udid", required=True)
    ap.add_argument("--runner", default=None, help="WDA runner bundle id (auto-discover if omitted)")
    ap.add_argument("--pmd3", default=None, help="path to pymobiledevice3(.exe)")
    ap.add_argument("--wda-port", type=int, default=8100)
    ap.add_argument("--mjpeg-port", type=int, default=9100)
    ap.add_argument("--tunneld-port", type=int, default=49151)
    ap.add_argument("--poll", type=float, default=5.0)
    ap.add_argument("--ready-timeout", type=float, default=60.0)
    args = ap.parse_args()
    run_watchdog(args.udid, args.runner, args.pmd3, args.wda_port, args.mjpeg_port,
                 args.tunneld_port, args.poll, args.ready_timeout)


if __name__ == "__main__":
    main()
