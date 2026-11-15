"""Launcher that works from any folder:  python twin/run.py run   (same args as python -m plotstar_twin)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    from plotstar_twin.__main__ import main

    sys.exit(main())
