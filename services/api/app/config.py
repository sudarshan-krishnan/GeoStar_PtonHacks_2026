"""Runtime configuration. Secrets come from the repo-root .env only; never log them."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

PRODUCT_NAME = "PlotStar"
TEAM_NAME = "PlotStar"

COSTAR_KIT_DIR = Path(os.getenv("COSTAR_KIT_DIR", REPO_ROOT.parent / "PlotStar-data" / "costar-kit"))
if not COSTAR_KIT_DIR.is_absolute():
    COSTAR_KIT_DIR = (REPO_ROOT / COSTAR_KIT_DIR).resolve()

CACHE_DIR = REPO_ROOT / "data" / "cache"
DB_PATH = Path(os.getenv("PLOTSTAR_DB", CACHE_DIR / "plotstar.db"))

MATTERPORT_API_KEY = os.getenv("MATTERPORT_API_KEY", "")
MATTERPORT_API_TOKEN = os.getenv("MATTERPORT_API_TOKEN", "")
MATTERPORT_GRAPH_URL = "https://api.matterport.com/api/models/graph"

VEXCEL_API_KEY = os.getenv("VEXCEL_API_KEY", "")

TELEMETRY_API_KEY = os.getenv("TELEMETRY_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "plotstar")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")]
