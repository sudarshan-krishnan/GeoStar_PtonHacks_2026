"""Voice: ElevenLabs text-to-speech proxy. The key stays server-side; without a key the UI uses the browser voice."""
from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter(tags=["voice"])
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


def _key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "")


class SpeakIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2500)


@router.get("/voice/status")
def status() -> dict[str, Any]:
    return {"elevenlabs_configured": bool(_key())}


@router.post("/voice/speak")
def speak(body: SpeakIn) -> Response:
    if not _key():
        raise HTTPException(503, "ELEVENLABS_API_KEY is not set")
    voice = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    try:
        r = httpx.post(API.format(voice_id=voice), headers={"xi-api-key": _key(), "accept": "audio/mpeg"},
                       json={"text": body.text, "model_id": os.getenv("ELEVENLABS_MODEL", "eleven_turbo_v2_5")}, timeout=60)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ElevenLabs unreachable: {type(e).__name__}") from e
    if r.status_code != 200:
        raise HTTPException(502, f"ElevenLabs returned HTTP {r.status_code}")
    return Response(r.content, media_type="audio/mpeg")
