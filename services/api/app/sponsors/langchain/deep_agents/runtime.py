"""Runs, the live execution recorder, and the evidence store.

Every node the UI draws comes from a LangChain callback fired by the actual runtime: the orchestrator graph run, each
subagent graph run started by the deepagents `task` tool, every chat-model call and every tool call. The callback
`run_id`s are the same ids LangSmith records, so a node can be looked up in the trace.

Evidence: a tool's full output is stored here, locally, and served to the GeoStar UI. The language model (and therefore
the LangSmith trace) receives a *view*. For CoStar tools the view drops CoStar descriptive fields (names, addresses,
prices, rents, tenants, coordinates) unless COPILOT_LLM_COSTAR=1, the same rule the rest of GeoStar follows.
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import threading
import time
import uuid
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler

LLM_COSTAR = os.getenv("COPILOT_LLM_COSTAR", "") == "1"
CURRENT: contextvars.ContextVar["Run | None"] = contextvars.ContextVar("plotstar_deep_run", default=None)

# slug -> how the UI and traces present an agent. Filled by agents.py.
AGENT_INFO: dict[str, dict[str, str]] = {}
ORCHESTRATOR = "plotstar-orchestrator"
HIDDEN_TOOLS = {"task"}  # a delegation: drawn as the edge to the subagent, not as its own node

_RUNS: dict[str, "Run"] = {}
_RUNS_LOCK = threading.Lock()
MAX_RUNS = 60


# ------------------------------------------------------------------------------------------------------- the run

class Run:
    """One orchestrated execution: its nodes, events, evidence, findings, score and answer."""

    def __init__(self, kind: str, title: str, context: dict[str, Any]):
        self.id = uuid.uuid4().hex[:12]
        self.kind, self.title, self.context = kind, title, context
        self.t0 = time.time()
        self.status = "running"
        self.lock = threading.RLock()
        self.events: list[dict[str, Any]] = []
        self.nodes: dict[str, dict[str, Any]] = {}
        self.evidence: dict[str, dict[str, Any]] = {}
        self.findings: dict[str, dict[str, Any]] = {}
        self.plan: list[dict[str, Any]] = []
        self.score: dict[str, Any] | None = None
        self.answer: str | None = None
        self.proposal: dict[str, Any] | None = None
        self.verification: dict[str, Any] | None = None
        self.approval: dict[str, Any] | None = None
        self.dispatches: list[dict[str, Any]] = []
        self.error: str | None = None
        self.trace_id: str | None = None
        self.thread_id: str | None = None
        self._decision: dict[str, Any] | None = None
        self._decided = threading.Event()
        self.ctx: Any = None  # copilot.Ctx for engine tools (set by agents.py)

    # events -------------------------------------------------------------------------------------------------
    def emit(self, type_: str, **payload: Any) -> None:
        with self.lock:
            self.events.append({"seq": len(self.events), "type": type_, "t": round(time.time() - self.t0, 3), **payload})

    def since(self, cursor: int) -> list[dict[str, Any]]:
        with self.lock:
            return self.events[cursor:]

    def set_status(self, status: str, **extra: Any) -> None:
        self.status = status
        self.emit("status", status=status, **extra)

    # evidence -----------------------------------------------------------------------------------------------
    def add_evidence(self, tool: str, provider: str, data: Any, view: Any, *, label: str | None = None,
                     sources: list[str] | None = None, redacted: bool = False) -> str:
        with self.lock:
            eid = f"E{len(self.evidence) + 1}"
            self.evidence[eid] = dict(id=eid, tool=tool, provider=provider, label=label, sources=(sources or [])[:80],
                                      source_count=len(sources or []), data=data, view=view, redacted=redacted,
                                      agent=None, node=None, at=round(time.time() - self.t0, 3))
        return eid

    def latest(self, tool: str) -> dict[str, Any] | None:
        with self.lock:
            hits = [e for e in self.evidence.values() if e["tool"] == tool and e["data"] is not None]
        return hits[-1] if hits else None

    # human approval -----------------------------------------------------------------------------------------
    def request_approval(self, actions: list[dict[str, Any]]) -> dict[str, Any]:
        self.approval = {"actions": actions, "decision": None}
        self._decided.clear()
        self.set_status("awaiting_approval", actions=actions)
        if not self._decided.wait(timeout=600):
            self._decision = {"type": "reject", "message": "No one approved within 10 minutes. Do not retry; say it was not sent."}
        self.approval["decision"] = self._decision["type"]
        self.set_status("running")
        return self._decision

    def decide(self, approve: bool, note: str | None = None) -> None:
        self._decision = {"type": "approve"} if approve else {
            "type": "reject", "message": note or "The operator declined. Do not retry; say it was not sent."}
        self._decided.set()

    # serialisation ------------------------------------------------------------------------------------------
    def summary(self) -> dict[str, Any]:
        active = [n for n in self.nodes.values() if n["kind"] == "agent" and n["status"] == "running" and n["name"] != ORCHESTRATOR]
        return dict(id=self.id, kind=self.kind, title=self.title, status=self.status, started=self.t0,
                    elapsed=round(time.time() - self.t0, 1), active_agents=len(active), trace_id=self.trace_id,
                    verdict=(self.score or {}).get("verdict"), score=(self.score or {}).get("score"))

    def snapshot(self, with_data: bool = False) -> dict[str, Any]:
        with self.lock:
            ev = {k: ({**v} if with_data else {kk: vv for kk, vv in v.items() if kk != "data"}) for k, v in self.evidence.items()}
            out = self.summary()
            out.update(context=self.context, nodes=list(self.nodes.values()), plan=self.plan, findings=self.findings,
                       evidence=ev, score=self.score, answer=self.answer, proposal=self.proposal,
                       verification=self.verification, approval=self.approval, dispatches=self.dispatches,
                       error=self.error, langsmith=langsmith_ref(self.trace_id))
            return out


def register(run: Run) -> Run:
    with _RUNS_LOCK:
        _RUNS[run.id] = run
        if len(_RUNS) > MAX_RUNS:
            for k in sorted(_RUNS, key=lambda k: _RUNS[k].t0)[: len(_RUNS) - MAX_RUNS]:
                if _RUNS[k].status not in ("running", "awaiting_approval"):
                    _RUNS.pop(k, None)
    return run


def get(run_id: str) -> Run | None:
    return _RUNS.get(run_id)


def recent(limit: int = 20) -> list[dict[str, Any]]:
    with _RUNS_LOCK:
        runs = sorted(_RUNS.values(), key=lambda r: r.t0, reverse=True)[:limit]
    return [r.summary() for r in runs]


def langsmith_ref(trace_id: str | None) -> dict[str, Any] | None:
    if not trace_id:
        return None
    on = bool(os.getenv("LANGSMITH_API_KEY")) and os.getenv("LANGSMITH_TRACING", "").lower() == "true"
    return dict(enabled=on, project=os.getenv("LANGSMITH_PROJECT") or "default", trace_id=trace_id,
                url=os.getenv("LANGSMITH_TRACE_URL_TEMPLATE", "").format(trace_id=trace_id) or None)


# --------------------------------------------------------------------------------------------------- redaction

_SENSITIVE = re.compile(r"(name|address|street|city|postcode|zip|phone|email|contact|owner|tenant|broker|price|rent|"
                        r"sold|asking|value|sale|desc|url|wording|building_park|source_file|source_row|nearest_homes|"
                        r"nearest_apartments|points|records|rows|listing|units_available)", re.I)
_EXACT = {"lat", "lon", "lng", "id", "home_id", "property_id", "costar_property_id", "sources"}
_NAMED_LISTS = {"checks", "gates", "missing", "gaps", "failed_checks", "concepts", "risks"}


def _trim(v: Any, depth: int = 0) -> Any:
    if isinstance(v, str):
        return v if len(v) <= 400 else v[:400] + "…"
    if isinstance(v, list):
        out = [_trim(x, depth + 1) for x in v[:10]]
        return out + [f"… {len(v) - 10} more"] if len(v) > 10 else out
    if isinstance(v, dict) and depth < 6:
        return {k: _trim(x, depth + 1) for k, x in v.items()}
    return v


def costar_view(data: Any, parent: str = "", depth: int = 0) -> Any:
    """What a model may see of a CoStar tool result when CoStar fields are kept out of prompts: GeoStar-computed
    results, gate and check statuses, counts and data gaps; never names, addresses, prices, rents or coordinates."""
    if LLM_COSTAR:
        return _trim(data)
    if isinstance(data, dict):
        out: dict[str, Any] = {}
        for k, v in data.items():
            keep_name = k == "name" and parent in _NAMED_LISTS
            if (k in _EXACT or _SENSITIVE.search(k)) and not keep_name:
                if isinstance(v, list):
                    out[f"{k}_count"] = len(v)
                continue
            out[k] = costar_view(v, k, depth + 1)
        return out
    if isinstance(data, list):
        items = [costar_view(x, parent, depth + 1) for x in data[:10]]
        return items + [f"… {len(data) - 10} more"] if len(data) > 10 else items
    if isinstance(data, str):
        return data if len(data) <= 300 else data[:300] + "…"
    return data


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)


# ------------------------------------------------------------------------------------------------ the recorder

def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content).strip()
    return str(content or "")


def _clip(s: str, n: int = 360) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[:n] + "…"


class Recorder(BaseCallbackHandler):
    """Turns the runtime's callbacks into graph nodes. Inline and thread-safe: ToolNode runs parallel tool calls
    (including parallel subagents) on worker threads."""

    run_inline = True
    raise_error = False

    def __init__(self, run: Run, root_name: str):
        self.run, self.root_name = run, root_name
        self.parent: dict[UUID, UUID | None] = {}
        self.kept: dict[UUID, str] = {}        # langchain run id -> node id
        self.delegations: dict[UUID, dict[str, Any]] = {}
        self.lock = threading.RLock()

    # helpers ------------------------------------------------------------------------------------------------
    def _owner(self, rid: UUID | None) -> str | None:
        """Nearest recorded ancestor node."""
        seen = 0
        while rid is not None and seen < 400:
            if rid in self.kept:
                return self.kept[rid]
            rid = self.parent.get(rid)
            seen += 1
        return None

    def _agent_of(self, node_id: str | None) -> str | None:
        n = self.run.nodes.get(node_id or "")
        while n is not None and n["kind"] != "agent":
            n = self.run.nodes.get(n.get("parent") or "")
        return n["name"] if n else None

    def _delegation_for(self, rid: UUID | None) -> dict[str, Any] | None:
        seen = 0
        while rid is not None and seen < 400:
            if rid in self.delegations:
                return self.delegations[rid]
            rid = self.parent.get(rid)
            seen += 1
        return None

    def _by_metadata(self, md: dict[str, Any] | None) -> str | None:
        """The agent node a call belongs to, from the metadata LangGraph/deepagents stamp on every run: the delegating
        `task` call id (exact) or the agent name. Needed because some wrapper runs (e.g. model middleware) never report
        a chain start, so walking parent ids alone can dead-end."""
        md = md or {}
        agents = [n for n in self.run.nodes.values() if n["kind"] == "agent"]
        tcid = md.get("lc_subagent_tool_call_id")
        if tcid:
            hit = next((n for n in reversed(agents) if n.get("delegation_id") == tcid), None)
            if hit:
                return hit["id"]
        name = md.get("lc_agent_name")
        if name:
            hit = next((n for n in reversed(agents) if n["name"] == name and n["status"] == "running"), None) \
                or next((n for n in reversed(agents) if n["name"] == name), None)
            if hit:
                return hit["id"]
        return None

    def _add(self, rid: UUID, parent_rid: UUID | None, md: dict[str, Any] | None = None, **node: Any) -> dict[str, Any]:
        with self.run.lock:
            nid = f"n{len(self.run.nodes) + 1}"
            parent = (self._by_metadata(md) if node.get("kind") != "agent" else None) or self._owner(parent_rid)
            if parent is None and node.get("name") != ORCHESTRATOR:
                parent = next((n["id"] for n in self.run.nodes.values() if n["name"] == ORCHESTRATOR), None)
            n: dict[str, Any] = dict(id=nid, parent=parent, status="running", start=round(time.time() - self.run.t0, 3),
                                     end=None, ms=None, lc_run_id=str(rid), error=None, input=None, output=None, evidence=[])
            n.update(node)
            n.setdefault("agent", self._agent_of(parent) if node.get("kind") != "agent" else node.get("name"))
            self.run.nodes[nid] = n
            self.kept[rid] = nid
        self.run.emit("node", node=dict(n))
        return n

    def _finish(self, rid: UUID, status: str = "done", **patch: Any) -> None:
        nid = self.kept.get(rid)
        if not nid:
            return
        with self.run.lock:
            n = self.run.nodes[nid]
            n.update(patch, status=status, end=round(time.time() - self.run.t0, 3))
            n["ms"] = round((n["end"] - n["start"]) * 1000)
            snap = dict(n)
        self.run.emit("node", node=snap)

    # chains: the orchestrator and each subagent graph ------------------------------------------------------
    def on_chain_start(self, serialized: dict[str, Any] | None, inputs: Any, *, run_id: UUID,
                       parent_run_id: UUID | None = None, tags: list[str] | None = None,
                       metadata: dict[str, Any] | None = None, **kw: Any) -> None:
        name = kw.get("name") or (serialized or {}).get("name") or ""
        with self.lock:
            self.parent[run_id] = parent_run_id
            if parent_run_id is None:
                existing = next((n for n in self.run.nodes.values() if n["name"] == ORCHESTRATOR), None)
                self.run.trace_id = self.run.trace_id or str(run_id)
                if existing:  # resumed after a human decision: same orchestrator node, new trace segment
                    self.kept[run_id] = existing["id"]
                    existing["status"] = "running"
                    self.run.emit("node", node=dict(existing))
                    return
                info = AGENT_INFO.get(ORCHESTRATOR, {})
                self._add(run_id, None, kind="agent", name=ORCHESTRATOR, label=info.get("title", "Orchestrator"),
                          role=info.get("role"), model=info.get("model"), run_name=self.root_name,
                          objective=self.run.title)
                return
            if name in AGENT_INFO and name != ORCHESTRATOR and (metadata or {}).get("lc_agent_name", name) == name \
                    and self._agent_of(self._owner(parent_run_id)) != name:
                info = AGENT_INFO[name]
                d = self._delegation_for(parent_run_id) or {}
                self._add(run_id, parent_run_id, kind="agent", name=name, label=info.get("title", name),
                          role=info.get("role"), model=info.get("model"), run_name=name,
                          objective=d.get("description"),
                          delegation_id=(metadata or {}).get("lc_subagent_tool_call_id") or d.get("tool_call_id"),
                          input=_clip(d.get("description") or "", 600))

    def on_chain_end(self, outputs: Any, *, run_id: UUID, **kw: Any) -> None:
        nid = self.kept.get(run_id)
        if not nid:
            return
        n = self.run.nodes[nid]
        if n["kind"] != "agent":
            return
        patch: dict[str, Any] = {}
        if isinstance(outputs, dict):
            sr = outputs.get("structured_response")
            if sr is not None:
                f = sr.model_dump() if hasattr(sr, "model_dump") else dict(sr) if isinstance(sr, dict) else None
                if f:
                    with self.run.lock:
                        self.run.findings[n["name"]] = {**f, "node": nid, "agent": n["name"]}
                    self.run.emit("finding", agent=n["name"], finding=self.run.findings[n["name"]])
                    patch["output"] = _clip(f.get("summary") or "; ".join(f.get("findings") or []), 600)
            msgs = outputs.get("messages")
            if not patch and msgs:
                patch["output"] = _clip(_text(getattr(msgs[-1], "content", "")), 600)
        if n["name"] == ORCHESTRATOR and self.run.status == "awaiting_approval":
            return
        self._finish(run_id, **patch)

    def on_chain_error(self, error: BaseException, *, run_id: UUID, **kw: Any) -> None:
        if type(error).__name__ in ("GraphInterrupt", "ParentCommand"):
            return
        if run_id in self.kept and self.run.nodes[self.kept[run_id]]["kind"] == "agent":
            self._finish(run_id, status="error", error=f"{type(error).__name__}: {_clip(str(error), 300)}")

    # model calls ----------------------------------------------------------------------------------------------
    def on_chat_model_start(self, serialized: dict[str, Any], messages: list[list[Any]], *, run_id: UUID,
                            parent_run_id: UUID | None = None, tags: list[str] | None = None,
                            metadata: dict[str, Any] | None = None, **kw: Any) -> None:
        md = metadata or {}
        with self.lock:
            self.parent[run_id] = parent_run_id
            msgs = messages[0] if messages else []
            last = msgs[-1] if msgs else None
            role = getattr(last, "type", "message") if last is not None else "message"
            preview = f"{len(msgs)} messages in context. Last ({role}): {_clip(_text(getattr(last, 'content', '')), 280)}"
            provider, model = md.get("ls_provider") or "anthropic", md.get("ls_model_name") or (serialized or {}).get("name")
            self._add(run_id, parent_run_id, md, kind="model", name=f"Model / {model}", label=model,
                      model={"provider": provider, "name": model}, input=preview, tokens=None)

    def on_llm_end(self, response: Any, *, run_id: UUID, **kw: Any) -> None:
        try:
            msg = response.generations[0][0].message
        except Exception:
            msg = None
        calls = [c.get("name") for c in (getattr(msg, "tool_calls", None) or [])]
        text = _clip(_text(getattr(msg, "content", "")), 400)
        out = (f"Calls: {', '.join(calls)}. " if calls else "") + text
        use = getattr(msg, "usage_metadata", None) or {}
        self._finish(run_id, output=out or "(no text)", tool_calls=calls,
                     tokens={"input": use.get("input_tokens"), "output": use.get("output_tokens")} if use else None)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kw: Any) -> None:
        self._finish(run_id, status="error", error=f"{type(error).__name__}: {_clip(str(error), 300)}")

    # tools ------------------------------------------------------------------------------------------------
    def on_tool_start(self, serialized: dict[str, Any], input_str: str, *, run_id: UUID,
                      parent_run_id: UUID | None = None, tags: list[str] | None = None,
                      metadata: dict[str, Any] | None = None, inputs: dict[str, Any] | None = None, **kw: Any) -> None:
        name = (serialized or {}).get("name") or kw.get("name") or "tool"
        md = metadata or {}
        args = inputs if isinstance(inputs, dict) else {}
        with self.lock:
            self.parent[run_id] = parent_run_id
            if name in HIDDEN_TOOLS:
                self.delegations[run_id] = dict(description=args.get("description"), subagent=args.get("subagent_type"),
                                                tool_call_id=(md.get("tool_call_id") or kw.get("tool_call_id")))
                return
            provider = md.get("tool_provider") or ("deepagents" if name in _HARNESS else "geostar")
            kind = "mcp" if provider.startswith("costar-mcp") else "compute" if md.get("kind") == "computation" \
                else "verify" if md.get("kind") == "verification" else "plan" if name == "write_todos" else "tool"
            safe_args = {k: v for k, v in args.items() if k not in ("runtime", "config")}
            self._add(run_id, parent_run_id, md, kind=kind, name=name, label=md.get("display_name") or name.replace("_", " "),
                      provider=provider, input=_clip(dumps(safe_args), 600), args=safe_args)
            if name == "write_todos":
                todos = args.get("todos") or []
                self.run.plan = [{"content": t.get("content"), "status": t.get("status")} for t in todos if isinstance(t, dict)]
                self.run.emit("plan", plan=self.run.plan)

    def on_tool_end(self, output: Any, *, run_id: UUID, **kw: Any) -> None:
        if run_id not in self.kept:
            return
        content = getattr(output, "content", output)
        text = _text(content) if not isinstance(content, (dict, list)) else dumps(content)
        patch: dict[str, Any] = {"output": _clip(text, 600)}
        try:
            body = json.loads(text)
        except (ValueError, TypeError):
            body = None
        if isinstance(body, dict):
            eid = body.get("evidence_id")
            if eid:
                patch["evidence"] = [eid]
                nid = self.kept[run_id]
                with self.run.lock:
                    if eid in self.run.evidence:
                        self.run.evidence[eid].update(node=nid, agent=self.run.nodes[nid].get("agent"))
                self.run.emit("evidence", evidence={k: v for k, v in self.run.evidence.get(eid, {}).items() if k != "data"})
            if body.get("headline"):
                patch["output"] = _clip(body["headline"], 400)
            if body.get("ok") is False:
                self._finish(run_id, status="error", error=_clip(body.get("error") or body.get("headline") or "failed", 300), **patch)
                return
        self._finish(run_id, **patch)

    def on_tool_error(self, error: BaseException, *, run_id: UUID, **kw: Any) -> None:
        if type(error).__name__ in ("GraphInterrupt",):
            return
        self._finish(run_id, status="error", error=f"{type(error).__name__}: {_clip(str(error), 300)}")


_HARNESS = {"write_todos", "ls", "read_file", "write_file", "edit_file", "glob", "grep", "delete", "execute"}
