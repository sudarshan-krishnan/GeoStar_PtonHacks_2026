"""Launcher that works from any folder:  python protect/run.py run --sim"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    from sitestar_protect.__main__ import main

    sys.exit(main())
