"""Voice guide: the ElevenLabs agent config is valid and safe, and the endpoints degrade cleanly without a key.
No test here calls ElevenLabs."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import guide
from app.main import app


def test_agent_config_is_client_tools_only_and_signed_url_only():
    cfg = guide.agent_config()
    prompt = cfg["conversation_config"]["agent"]["prompt"]
    names = [t["name"] for t in prompt["tools"]]
    assert names == ["ask_plotstar", "read_screen", "point_at", "click", "agents_status", "next_steps"]
    assert all(t["type"] == "client" and t["expects_response"] for t in prompt["tools"])  # no server webhooks
    assert cfg["platform_settings"]["auth"]["enable_auth"] is True  # no public sessions
    assert cfg["conversation_config"]["tts"]["model_id"] in ("eleven_flash_v2", "eleven_turbo_v2")  # English agents
    click = next(t for t in prompt["tools"] if t["name"] == "click")
    assert "confirmed" in click["parameters"]["properties"]
    assert "Never state a number you did not get from a tool" in prompt["prompt"]


def test_config_hash_changes_with_the_prompt(monkeypatch):
    h1 = guide._hash(guide.agent_config())
    monkeypatch.setattr(guide, "PROMPT", guide.PROMPT + " Extra.")
    assert guide._hash(guide.agent_config()) != h1


def test_session_without_key_is_503(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    r = TestClient(app).get("/guide/session")
    assert r.status_code == 503 and "ELEVENLABS_API_KEY" in r.json()["detail"]


def test_status_and_services_are_readable(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    c = TestClient(app)
    st = c.get("/guide/status").json()
    assert st["configured"] is False and len(st["tools"]) == 6
    services = c.get("/guide/agents").json()["services"]
    names = [s["name"] for s in services]
    assert {"PlotStar Guide", "PlotStar copilot", "Layout engine", "CoStar Data Extract", "MongoDB Atlas"} <= set(names)
    assert all(isinstance(s["running"], bool) and s["detail"] for s in services)
