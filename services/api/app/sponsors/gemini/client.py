"""Google Gemini over the REST API: embeddings for Atlas Vector Search and short, number-checked concept summaries.

    embed(texts, task)   gemini-embedding-001 at 768 dimensions, paced for the free tier (8 per batch, backoff on 429)
    generate(prompt)     GEMINI_MODEL (default gemini-3.5-flash-lite); raises on any failure so callers keep their
                         built-in text

The key (GEMINI_API_KEY) stays server-side. Neither function ever receives CoStar descriptive fields.
"""
from __future__ import annotations

import time

import httpx

from app import config

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMS = 768
LAST_ERROR: str | None = None


def available() -> bool:
    return bool(config.GEMINI_API_KEY)


def _headers() -> dict[str, str]:
    return {"x-goog-api-key": config.GEMINI_API_KEY}


def embed(texts: list[str], task: str, dims: int = EMBED_DIMS) -> list[list[float]] | None:
    """One vector per text, or None on failure (the reason is in LAST_ERROR)."""
    global LAST_ERROR
    if not config.GEMINI_API_KEY or not texts:
        LAST_ERROR = "GEMINI_API_KEY not set"
        return None
    out: list[list[float]] = []
    for i in range(0, len(texts), 8):
        chunk = texts[i:i + 8]
        for attempt in range(4):
            try:
                r = httpx.post(f"{BASE}/{EMBED_MODEL}:batchEmbedContents", headers=_headers(),
                               json={"requests": [{"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t}]},
                                                   "outputDimensionality": dims, "taskType": task} for t in chunk]}, timeout=60)
                if r.status_code == 429:
                    LAST_ERROR = "Gemini quota (429)"
                    time.sleep(15 * (attempt + 1))
                    continue
                r.raise_for_status()
                out += [e["values"] for e in r.json()["embeddings"]]
                break
            except Exception as e:  # noqa: BLE001
                LAST_ERROR = f"{type(e).__name__}: {str(e)[:120]}"
                time.sleep(3)
        else:
            return None
        if i + 8 < len(texts):
            time.sleep(1.5)
    return out


def generate(prompt: str, timeout: float = 25) -> str:
    """The model's text for one prompt. Raises on network, quota or response-shape errors."""
    res = httpx.post(f"{BASE}/{config.GEMINI_MODEL}:generateContent", headers=_headers(),
                     json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=timeout)
    res.raise_for_status()
    return "".join(part.get("text", "") for part in res.json()["candidates"][0]["content"]["parts"]).strip()
