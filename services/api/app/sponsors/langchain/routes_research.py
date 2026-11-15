"""POST /agent/explain -> plain-language explanation of an optimizer run, with the tool trace."""
from __future__ import annotations

from typing import Any

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.sponsors.langchain import research_agent as agent

router = APIRouter(tags=["agent"])


class ExplainIn(BaseModel):
    run_id: str
    question: str | None = Field(None, max_length=500)


@router.post("/agent/explain")
def explain(q: ExplainIn) -> dict[str, Any]:
    return agent.explain(q.run_id, q.question)


class ChatMsg(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMsg] = Field(default_factory=list, max_length=20)
    run_id: str | None = None
    thread_id: str | None = Field(None, max_length=64)
    resume: str | None = Field(None, pattern="^(approve|reject)$")


@router.post("/agent/chat")
def chat(q: ChatIn) -> StreamingResponse:
    """Research agent, streamed as server-sent events: plan, tool, result, answer, error."""
    def gen():
        for ev in agent.stream_chat([m.model_dump() for m in q.messages], q.run_id, q.thread_id, q.resume):
            yield "data: " + json.dumps(ev) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/eval/run")
def eval_run(agent_samples: int = 0) -> dict[str, Any]:
    """Optimizer-vs-baseline checks over a scenario grid; optional explanation groundedness (calls the explainer)."""
    from app.engine import evals

    return evals.run(max(0, min(agent_samples, 5)))


@router.get("/agent/status")
def status() -> dict[str, Any]:
    llm, kind = agent._llm()
    import os

    return {"langsmith_tracing": bool(os.getenv("LANGSMITH_API_KEY") and os.getenv("LANGSMITH_TRACING", "").lower() == "true"),
            "sandbox": {"enabled": bool(os.getenv("LANGSMITH_API_KEY") and os.getenv("PLOTSTAR_SANDBOX") == "1"), "error": agent._SANDBOX.get("error")},
            "model": kind or "deterministic", "note": "Set ANTHROPIC_API_KEY, or AWS credentials + BEDROCK_MODEL_ID, "
            "to run the LangChain deep agent; otherwise explanations are built deterministically from tool outputs."}
