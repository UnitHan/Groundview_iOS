"""
WDA Forward — stable localhost -> iPhone WDA forwarder with dynamic IP tracking.

Gives WDA test scripts a FIXED base URL (http://127.0.0.1:8100) even in a
dynamic-DHCP environment. The forwarder resolves the device's current LAN IP
from the (stable) RemoteXPC tunnel and TCP-proxies 127.0.0.1:8100 to it; when the
device IP changes it re-resolves and switches target with no client change.

    scripts ──> 127.0.0.1:8100 (never changes)
                    │  [this forwarder, auto-tracks device IP]
                    ▼
              <deviceIP>:8100 ──> WDA on iPhone

Resolution chain (keyed only by the unchanging UDID):
    UDID -> tunneld REST :49151 -> tunnel-address -> GET /status -> value.ios.ip
LAN IP is preferred (direct WiFi, fast); the IPv6 tunnel address is the fallback
so forwarding survives even when only the tunnel is reachable.

Usage:
    wda_forward.exe --udid <UDID> [--local-port 8100] [--wda-port 8100]
                    [--tunneld-port 49151] [--pmd3 <path>]
Stop with Ctrl+C.
"""

import argparse
import json
import socket
import threading
import time
import urllib.request


def log(msg):
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)


def http_get_json(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def wda_status(host, port, timeout=2):
    host_fmt = f"[{host}]" if ":" in host else host
    return http_get_json(f"http://{host_fmt}:{port}/status", timeout=timeout)


class Resolver:
    """Tracks the current device WDA endpoint (ip, port, family)."""

    def __init__(self, udid, tunneld_port, wda_port):
        self.udid = udid
        self.tunneld_port = tunneld_port
        self.wda_port = wda_port
        self.lock = threading.Lock()
        self.target = None  # (host, port)

    def tunnel_address(self):
        data = http_get_json(f"http://127.0.0.1:{self.tunneld_port}/", timeout=3)
        if not data:
            return None
        entry = data.get(self.udid)
        first = entry[0] if isinstance(entry, list) and entry else entry
        if isinstance(first, dict) and first.get("tunnel-address"):
            return str(first["tunnel-address"])
        return None

    def resolve(self):
        """Return (host, port) for the live WDA, preferring LAN IPv4."""
        tun = self.tunnel_address()
        if tun:
            st = wda_status(tun, self.wda_port, timeout=2)
            ip = (st or {}).get("value", {}).get("ios", {}).get("ip")
            if ip:
                # verify LAN IP actually reachable; else fall back to tunnel
                if wda_status(ip, self.wda_port, timeout=2):
                    return (ip, self.wda_port)
                return (tun, self.wda_port)
            if st:
                return (tun, self.wda_port)
        # last resort: keep previous target
        with self.lock:
            return self.target

    def refresh(self, reason=""):
        new = self.resolve()
        if not new:
            return None
        with self.lock:
            old = self.target
            if new != old:
                self.target = new
                log(f"target {'set' if old is None else 'changed'}: "
                    f"{old} -> {new}" + (f"  ({reason})" if reason else ""))
        return new

    def current(self):
        with self.lock:
            return self.target


def pump(src, dst, stop):
    try:
        while not stop.is_set():
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass


def open_backend(host, port, timeout=5):
    # getaddrinfo handles both IPv4 LAN and IPv6 tunnel addresses.
    last = None
    for fam, stype, proto, _, sockaddr in socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM):
        try:
            s = socket.socket(fam, stype, proto)
            s.settimeout(timeout)
            s.connect(sockaddr)
            s.settimeout(None)
            return s
        except Exception as e:
            last = e
            continue
    raise last or OSError("connect failed")


def handle_client(client, resolver, stop):
    target = resolver.current()
    backend = None
    if target:
        try:
            backend = open_backend(*target)
        except Exception:
            backend = None
    if backend is None:
        # target stale — force a re-resolve, then retry once
        target = resolver.refresh("connect failed")
        if target:
            try:
                backend = open_backend(*target)
            except Exception:
                backend = None
    if backend is None:
        client.close()
        return
    threading.Thread(target=pump, args=(client, backend, stop), daemon=True).start()
    threading.Thread(target=pump, args=(backend, client, stop), daemon=True).start()


def resolver_loop(resolver, interval, stop):
    while not stop.is_set():
        resolver.refresh("poll")
        stop.wait(interval)


def run_forwarder(udid, local_host="127.0.0.1", local_port=8100, wda_port=8100,
                  tunneld_port=49151, poll=5.0, stop=None, on_ready=None):
    """Blocking forwarder loop. Reusable from CLI and from the GUI (in a thread).

    `stop` is a threading.Event the caller can set to shut it down; `on_ready`
    (optional) is called with (local_host, local_port) once the socket is listening.
    """
    if stop is None:
        stop = threading.Event()
    resolver = Resolver(udid, tunneld_port, wda_port)
    log(f"resolving initial target for {udid} ...")
    if not resolver.refresh("startup"):
        log("초기 타깃 해석 실패 — tunneld 실행/무선설정/WDA 기동 확인 후 재시도")
    threading.Thread(target=resolver_loop, args=(resolver, poll, stop), daemon=True).start()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((local_host, local_port))
    srv.listen(128)
    srv.settimeout(1.0)  # so stop is checked even with no incoming connections
    log(f"listening on http://{local_host}:{local_port}  ->  WDA (auto-tracked)")
    if on_ready:
        try:
            on_ready(local_host, local_port)
        except Exception:
            pass
    try:
        while not stop.is_set():
            try:
                client, _ = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            handle_client(client, resolver, stop)
    except KeyboardInterrupt:
        log("stopping")
    finally:
        stop.set()
        srv.close()


def main():
    ap = argparse.ArgumentParser(description="Stable localhost -> WDA forwarder with dynamic IP tracking")
    ap.add_argument("--udid", required=True)
    ap.add_argument("--local-host", default="127.0.0.1")
    ap.add_argument("--local-port", type=int, default=8100)
    ap.add_argument("--wda-port", type=int, default=8100)
    ap.add_argument("--tunneld-port", type=int, default=49151)
    ap.add_argument("--poll", type=float, default=5.0, help="re-resolve interval (s)")
    args = ap.parse_args()
    run_forwarder(args.udid, args.local_host, args.local_port, args.wda_port,
                  args.tunneld_port, args.poll)


if __name__ == "__main__":
    main()
