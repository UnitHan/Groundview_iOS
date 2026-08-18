"""
Build the standalone Windows bundle with PyInstaller:

  1. pymobiledevice3.exe    — the tunneld/dvt engine (onefile, wintun bundled)
  2. GroundViewWireless.exe — the tkinter GUI, with pymobiledevice3.exe bundled

Run from an activated venv that has pymobiledevice3 + pyinstaller installed:
    python win/gui/build_bundle.py

Outputs land in win/tools/ (pymobiledevice3.exe) and win/dist/ (the GUI exe),
and a copy of pymobiledevice3.exe is placed next to the GUI for dev runs.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(HERE, "_build")
TOOLS = os.path.normpath(os.path.join(HERE, "..", "tools"))
DIST = os.path.normpath(os.path.join(HERE, "..", "dist"))

# wintun.dll shipped inside pytun_pmd3 (amd64 build for x64 Windows).
import pytun_pmd3  # noqa: E402
WINTUN = os.path.join(os.path.dirname(pytun_pmd3.__file__), "wintun", "bin", "amd64", "wintun.dll")

SEP = ";" if os.name == "nt" else ":"


def run(args):
    print("».", " ".join(args))
    subprocess.check_call(args)


def pyinstaller(*args):
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", DIST, "--workpath", WORK,
         "--specpath", WORK, *args])


def build_pmd3():
    extra = []
    if os.path.isfile(WINTUN):
        extra += ["--add-binary", f"{WINTUN}{SEP}pytun_pmd3/wintun/bin/amd64"]
    pyinstaller(
        "--onefile", "--name", "pymobiledevice3", "--console",
        "--collect-all", "pymobiledevice3",
        "--collect-all", "pytun_pmd3",
        "--collect-submodules", "pymobiledevice3",
        # pymobiledevice3 and deps (pyimg4, developer_disk_image, ...) query their
        # own version via importlib.metadata at import time — bundle that metadata.
        "--recursive-copy-metadata", "pymobiledevice3",
        *extra,
        os.path.join(HERE, "pmd3_entry.py"),
    )
    src = os.path.join(DIST, "pymobiledevice3.exe")
    os.makedirs(TOOLS, exist_ok=True)
    shutil.copy2(src, os.path.join(TOOLS, "pymobiledevice3.exe"))
    print(f"[OK] pymobiledevice3.exe -> {TOOLS}")
    return src


def build_gui(pmd3_exe):
    extra = []
    if os.path.isfile(pmd3_exe):
        extra += ["--add-binary", f"{pmd3_exe}{SEP}tools"]
    pyinstaller(
        "--onefile", "--name", "GroundViewWireless", "--windowed",
        # tunneld (Wintun) needs admin — always request elevation on launch.
        "--uac-admin",
        *extra,
        os.path.join(HERE, "groundview_wireless.py"),
    )
    # Also drop a loose pymobiledevice3.exe next to the GUI for dev runs.
    if os.path.isfile(pmd3_exe):
        shutil.copy2(pmd3_exe, os.path.join(DIST, "pymobiledevice3.exe"))
    print(f"[OK] GroundViewWireless.exe -> {DIST}")


def build_forwarder():
    # Small pure-socket forwarder; standalone exe for Scheduled-Task aging runs.
    pyinstaller(
        "--onefile", "--name", "wda_forward", "--console",
        os.path.join(HERE, "wda_forward.py"),
    )
    print(f"[OK] wda_forward.exe -> {DIST}")


def build_watchdog():
    # WDA keep-alive engine; standalone exe for Scheduled-Task aging runs.
    pyinstaller(
        "--onefile", "--name", "wda_watchdog", "--console",
        os.path.join(HERE, "wda_watchdog.py"),
    )
    print(f"[OK] wda_watchdog.exe -> {DIST}")


if __name__ == "__main__":
    print(f"wintun.dll = {WINTUN} ({'found' if os.path.isfile(WINTUN) else 'MISSING'})")
    pmd3 = build_pmd3()
    build_forwarder()
    build_watchdog()
    build_gui(pmd3)  # bundles wda_forward.py + wda_watchdog.py via their imports
    print("\nDone. Bundle in:", DIST)
