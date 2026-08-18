"""PyInstaller entry for a standalone pymobiledevice3.exe (onefile)."""
import multiprocessing

from pymobiledevice3.__main__ import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
