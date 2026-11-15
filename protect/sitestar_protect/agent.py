"""AI incident commander: LangChain Deep Agents on Claude (Amazon Bedrock or the Anthropic API).

Main agent  : incident commander. Owns the actuators that need judgment and the manager channel.
Sub-agents  : diagnostician (sensor history + building topology -> cause, confidence, unknowns)
              maintenance-planner (vendor choice + work order)
Filesystem  : every incident gets a dossier the agent writes itself: /incidents/<id>/report.md
Human loop  : dispatch_vendor and reopening the valve pause for the building manager's approval,
              which arrives as an iMessage reply (Photon) or a tap on the dashboard phone.

Safety reflexes never wait for this agent: the valve already closed in firmware and the
controller already ran the deterministic playbook before the agent starts.

No model credentials (or a model error)? An offline playbook produces the same dossier,
work order, manager messages and approval flow, labelled OFFLINE, so the demo cannot die.
"""
from __future__ import annotations

import itertools
import os
import queue
import re
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Optional

from .detector import Incident
from .messaging import parse_decision

FS_ROOT = Path(__file__).resolve().parents[1] / "data" / "agent_fs"

VENDORS = {
    "plumbing": [
        {"name": "Bayou City Plumbing (demo vendor)", "eta": "45-60 min", "callout_usd": 185, "rating": 4.8},
        {"name": "Westheimer Rooter (demo vendor)", "eta": "2-3 h", "callout_usd": 120, "rating": 4.5},
    ],
    "fire": [{"name": "Gulf Coast Fire & Safety (demo vendor)", "eta": "60-90 min", "callout_usd": 240, "rating": 4.7}],
    "hvac": [{"name": "Montrose Mechanical (demo vendor)", "eta": "2 h", "callout_usd": 160, "rating": 4.6}],
}
TRADE_FOR = {"leak": "plumbing", "freeze_risk": "plumbing", "sump_high": "plumbing", "valve_fault": "plumbing",
             "smoke": "fire", "overheat": "hvac", "humidity_spike": "hvac"}

SYSTEM_PROMPT = """You are the SiteStar PROTECT incident commander for {project} ({city}).
A building's sensors raised an incident. Deterministic safety reflexes ALREADY ran (listed in the
incident); you handle judgment, coordination and communication.
Hardware facts: the water valve has a micro switch that confirms it is physically shut
(valve_switch_confirms_shut); a valve_fault incident means it was told to close but did not, so
water may still be flowing and someone must close the manual shutoff. Smoke releases the lounge fire
door (fire_door_open). Dispatched vendors check in by tapping their badge at the lobby panel.

Work like a senior facilities engineer:
1. Delegate to the `diagnostician` sub-agent: give it the incident id and ask for the likely cause,
   confidence, affected rooms (use the building topology: what is below the room, who is present),
   and what is still unknown. It must cite real sensor values and times from the tools.
2. Write the dossier with write_file to /incidents/<incident id>/report.md: timeline, evidence
   (sensor values + times), automatic actions already taken, likely cause + confidence, risks to
   other rooms and people, next steps. Never invent readings.
3. Take any further actuator action that is clearly safe and justified (set_fan, close_valve).
   Never call reopen_valve during an active leak; it needs the manager's approval anyway.
4. Delegate to `maintenance-planner` to choose a vendor and create the work order.
5. Send the manager ONE concise update with notify_manager (iMessage length, under 320 characters):
   what happened, what was already done automatically, what you recommend.
6. Call dispatch_vendor for the chosen vendor. It pauses until the manager approves or declines.
   If declined, acknowledge and record that in the dossier; do not retry.
Finish with a two-sentence summary. Be concrete; times as HH:MM:SS."""

DIAG_PROMPT = """You are a building diagnostician. Use the tools to read the incident, the building
topology and sensor history. Report: likely cause, confidence (low/medium/high) with the reason,
rooms and people at risk (rooms below wet rooms; occupancy sensors), and what is unknown.
Cite actual values and times. Plain text, under 180 words."""

PLAN_PROMPT = """You are a maintenance planner. Choose the right trade and vendor with lookup_vendors
(prefer speed for critical incidents, cost for warnings), then create_work_order with a clear title,
priority (P1 critical / P2 warning), description, suspected cause and parts to bring.
Return the work order id, vendor name, ETA and call-out cost."""


def next_incident_number(fs_root: Path) -> int:
    nums = [int(m.group(1)) for p in (Path(fs_root) / "incidents").glob("INC-*")
            if (m := re.fullmatch(r"INC-(\d+)", p.name))]
    return max(nums, default=0) + 1


def make_model():
    """Bedrock (Amazon track) if AWS credentials exist, else the Anthropic API, else None (offline)."""
    choice = os.getenv("PROTECT_LLM", "auto").lower()
    if choice in ("auto", "bedrock"):
        try:
            import boto3

            if boto3.Session().get_credentials() is not None:
                from langchain_aws import ChatBedrockConverse

                return ChatBedrockConverse(model=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-opus-5-5"),
                                           region_name=os.getenv("AWS_REGION", "us-east-1"),
                                           max_tokens=16000), "bedrock"
        except Exception as exc:  # noqa: BLE001
            if choice == "bedrock":
                print(f"[agent] Bedrock unavailable: {exc}")
    if choice in ("auto", "anthropic") and os.getenv("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5"), max_tokens=16000), "anthropic"
    return None, "offline"


class IncidentCommander:
    def __init__(self, ctx, messenger, fs_root: Path = FS_ROOT, model=None, mode: Optional[str] = None):
        """ctx: the ProtectController (building, history, detector, set_fan, request_valve, ...)."""
        self.ctx, self.messenger, self.fs_root = ctx, messenger, Path(fs_root)
        self.fs_root.mkdir(parents=True, exist_ok=True)
        if model is None and mode is None:
            model, mode = make_model()
        self.mode = mode or ("llm" if model else "offline")
        self.trace: list[dict] = []
        self.pending: dict[str, dict] = {}      # incident id -> approval request
        self.work_orders: dict[str, dict] = {}
        self.dispatches: list[dict] = []
        self._q: "queue.Queue[tuple]" = queue.Queue()
        self._current_sub: Optional[str] = None
        self._last_incident: Optional[str] = None
        # Continue numbering after the last saved dossier so a restart never overwrites evidence.
        ctx.detector._ids = itertools.count(next_incident_number(self.fs_root))
        self.agent = None
        if model is not None:
            try:
                self.agent = self._build(model)
            except Exception as exc:  # noqa: BLE001
                print(f"[agent] could not build deep agent ({exc}); using offline playbook")
                self.mode = "offline"
        messenger.on_reply = self.on_manager_reply
        threading.Thread(target=self._worker, name="commander", daemon=True).start()

    # ------------------------------------------------------------------ tools
    def _tools(self):
        ctx, me = self.ctx, self

        def get_incident(incident_id: str) -> dict:
            """Full record of one incident: kind, room, severity, start time, evidence snapshot, and the
            automatic reflex actions already taken (with latency in ms)."""
            inc = ctx.detector.get(incident_id)
            return inc.to_json() if inc else {"error": f"no incident {incident_id}"}

        def get_building() -> dict:
            """Building topology from the DESIGN module: rooms (floor, type, area, wet fixtures), which room
            is directly below which, and which room each physical sensor/actuator covers."""
            b = ctx.building.to_json()
            return {"project": b["project"], "rooms": b["rooms"], "below": b["below"], "hardware_map": b["hardware_map"]}

        def get_sensor_history(sensor: str, minutes: float = 10.0) -> dict:
            """Summary of one sensor over the last N minutes (min, max, first, last, 10-bucket trend).
            sensor is one of: leak, wet, beam_pct, smoke, t (mech temp C), rh (mech humidity %),
            pipe (pipe temp C), pir (lounge occupied), lvl (sump distance cm), valve_open."""
            name = {"beam_pct": "beam"}.get(sensor, sensor)
            if sensor == "valve_open":
                return ctx.history.summary("valve_open", minutes)
            return ctx.history.summary(name, minutes)

        def get_live_status() -> dict:
            """Latest reading of every sensor and the current actuator states."""
            return ctx.live_status()

        def set_fan(level: float, reason: str) -> str:
            """Set the mechanical-room exhaust fan, 0.0 (off) to 1.0 (full). Do NOT run it during a smoke
            incident (fans spread smoke; fire code shuts air handling down on smoke)."""
            return ctx.set_fan(level, by=f"agent: {reason}")

        def close_valve(reason: str) -> str:
            """Close the 2F bathroom water shut-off valve. Always allowed, no approval needed."""
            return ctx.request_valve(False, by=f"agent: {reason}")

        def reopen_valve(reason: str) -> str:
            """Reopen the 2F bathroom water shut-off valve. Pauses for the building manager's approval,
            and the firmware interlock refuses anyway while the leak probe is still wet."""
            return ctx.request_valve(True, by=f"agent (approved): {reason}")

        def notify_manager(message: str) -> str:
            """Text the building manager (iMessage via Photon; mirrored on the dashboard). Keep it under
            320 characters: what happened, what was done automatically, what you recommend."""
            me.messenger.send(message[:600], kind="update", incident=me._last_incident)
            return "sent"

        def lookup_vendors(trade: str) -> list:
            """Vendors for a trade: plumbing, fire, or hvac. Returns name, ETA, call-out cost, rating."""
            return VENDORS.get(trade, [])

        def create_work_order(title: str, room: str, priority: str, description: str,
                              suspected_cause: str, parts: str = "") -> dict:
            """Create a maintenance work order and save it as /incidents/<id>/work_order.md.
            priority: P1 (critical) or P2 (warning)."""
            return me._create_work_order(me._last_incident or "INC-0000", title, room, priority,
                                         description, suspected_cause, parts)

        def dispatch_vendor(work_order_id: str, vendor: str, eta: str, callout_usd: float) -> str:
            """Dispatch a vendor for a work order. Requires the building manager's approval (the call
            pauses until they reply)."""
            return me._dispatch(work_order_id, vendor, eta, callout_usd)

        diag = [get_incident, get_building, get_sensor_history, get_live_status]
        plan = [lookup_vendors, create_work_order]
        main = diag + [set_fan, close_valve, reopen_valve, notify_manager, dispatch_vendor]
        return main, diag, plan

    def _build(self, model):
        from deepagents import create_deep_agent
        from deepagents.backends import FilesystemBackend
        from langgraph.checkpoint.memory import InMemorySaver

        main, diag, plan = self._tools()
        p = self.ctx.building.project
        return create_deep_agent(
            model=model,
            tools=main,
            system_prompt=SYSTEM_PROMPT.format(project=p.get("name", "the building"), city=p.get("city", "")),
            subagents=[
                {"name": "diagnostician", "description": "Investigates an incident from sensor history and "
                 "building topology; returns cause, confidence, people/rooms at risk, unknowns.",
                 "system_prompt": DIAG_PROMPT, "tools": diag},
                {"name": "maintenance-planner", "description": "Chooses a vendor and creates the work order "
                 "for an incident.", "system_prompt": PLAN_PROMPT, "tools": plan},
            ],
            backend=FilesystemBackend(root_dir=str(self.fs_root), virtual_mode=True),
            interrupt_on={
                "dispatch_vendor": {"allowed_decisions": ["approve", "reject"]},
                "reopen_valve": {"allowed_decisions": ["approve", "reject"]},
            },
            checkpointer=InMemorySaver(),
            name="sitestar-incident-commander",
        )

    # ------------------------------------------------------------- shared ops
    def _create_work_order(self, inc_id, title, room, priority, description, cause, parts) -> dict:
        wo_id = f"WO-{len(self.work_orders) + 101}"
        wo = {"id": wo_id, "incident": inc_id, "title": title, "room": room, "priority": priority,
              "description": description, "suspected_cause": cause, "parts": parts,
              "created": time.strftime("%H:%M:%S"), "status": "open"}
        self.work_orders[wo_id] = wo
        d = self.fs_root / "incidents" / inc_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "work_order.md").write_text(
            f"# {wo_id}: {title}\n\n- Incident: {inc_id}\n- Room: {room}\n- Priority: {priority}\n"
            f"- Created: {wo['created']}\n\n## Description\n{description}\n\n## Suspected cause\n{cause}\n\n"
            f"## Parts / tools\n{parts or '-'}\n")
        inc = self.ctx.detector.get(inc_id)
        if inc:
            inc.work_order = wo_id
        self._t(inc_id, "tool", f"work order {wo_id} created: {title}")
        return wo

    def _dispatch(self, wo_id, vendor, eta, cost) -> str:
        rec = {"work_order": wo_id, "vendor": vendor, "eta": eta, "callout_usd": cost,
               "at": time.strftime("%H:%M:%S"), "approved_by": "building manager"}
        self.dispatches.append(rec)
        if wo_id in self.work_orders:
            self.work_orders[wo_id]["status"] = f"dispatched: {vendor}"
        self.messenger.send(f"Done: {vendor} dispatched for {wo_id}, ETA {eta}.", kind="confirm",
                            incident=self._last_incident)
        return f"dispatched {vendor} for {wo_id}, ETA {eta}"

    def _t(self, inc_id: Optional[str], kind: str, text: str, who: str = "commander") -> None:
        self.trace.append({"t": time.time(), "incident": inc_id, "kind": kind, "who": who, "text": text[:400]})
        del self.trace[:-300]

    def _set_state(self, inc: Incident, state: str) -> None:
        inc.agent_state = state
        self.ctx.on_agent_state(state)

    # ---------------------------------------------------------------- intake
    def handle(self, inc: Incident) -> None:
        self._q.put(("incident", inc))

    def on_manager_reply(self, text: str, channel: str) -> None:
        self._q.put(("reply", text, channel))

    def request_grid(self, depth: int, before_w) -> None:
        """Grid event: the cut needs the manager (badge tap or YES)."""
        line = f"PAUSE {depth}% of flexible AI jobs and slow cooling for the grid event"
        est = f" Now drawing {before_w:.0f} W." if before_w else ""
        self.pending["GRID"] = {"incident": None, "n": 1, "lines": [line], "mode": "offline", "grid": True}
        self._t(None, "approval", f"Approve: {line}?")
        self.messenger.send(f"Grid event from the utility (ERCOT peak).{est} Approve: {line}? "
                            f"Jobs pause, they don't fail. Tap your badge or reply YES / NO.",
                            kind="approval", actions=["YES", "NO"])

    def handle_badge(self, uid: str, role: str) -> None:
        self._q.put(("badge", uid, role))

    # ------------------------------------------------------------ lobby badges
    @staticmethod
    def _short(vendor: str) -> str:
        return re.sub(r"\s*\(.*?\)", "", vendor).strip()

    def expected_vendor(self) -> Optional[dict]:
        """The oldest approved dispatch whose vendor has not checked in yet."""
        for rec in self.dispatches:
            if not rec.get("arrived"):
                return {**rec, "short": self._short(rec["vendor"]).upper()}
        return None

    def _run_badge(self, uid: str, role: str) -> None:
        tail = uid[-4:]
        if role == "manager":
            if self.pending:
                self._t(None, "human", f"manager badge {uid} tapped at the lobby: approve")
                self.ctx.badge_result(uid, "approved what was pending", "check", "MANAGER APPROVED")
                if getattr(self.ctx, "haven", None):
                    self.ctx.haven.approved()
                self.messenger.receive("YES", sender=f"manager badge {uid}", channel="badge")
            else:
                active = list(self.ctx.detector.active.values())
                self.ctx.badge_result(uid, "manager card, nothing pending", "idle",
                                      "HELLO MANAGER  " + (active[0].title if active else "ALL CLEAR"))
            return
        rec = next((r for r in self.dispatches if not r.get("arrived")), None)
        if rec is None:
            self._t(None, "warn", f"badge ...{tail} refused at the lobby: no vendor expected")
            self.ctx.badge_result(uid, "refused: no vendor expected", "cross", "NO WORK ORDER - ACCESS DENIED")
            self.messenger.send(f"Heads up: unrecognised badge (...{tail}) tapped at the lobby and no vendor is "
                                f"expected. Door stayed locked.", kind="info")
            return
        now = time.strftime("%H:%M")
        rec["arrived"], rec["badge"] = now, uid
        wo = self.work_orders.get(rec["work_order"], {})
        if wo:
            wo["status"] = f"on site: {rec['vendor']} ({now})"
        inc_id = wo.get("incident") or self._last_incident
        inc = self.ctx.detector.get(inc_id) if inc_id else None
        name = self._short(rec["vendor"])
        self._t(inc_id, "human", f"{name} checked in at the lobby (badge ...{tail}) for {rec['work_order']}")
        self._append_report(inc_id, f"Site visit: {name} checked in at the lobby, badge ...{tail} "
                                    f"({rec['work_order']})")
        self.ctx.badge_result(uid, f"checked in: {name}", "check", f"WELCOME {name.upper()}  {rec['work_order']}")
        extra = ""
        if inc and inc.kind == "leak" and not self.ctx.live_status().get("valve_open", True):
            extra = " The valve stays shut until the leak sensor is dry and you approve reopening it."
        self.messenger.send(f"{name} checked in at the lobby at {now} for {rec['work_order']} "
                            f"(badge ...{tail}).{extra}", kind="info", incident=inc_id)

    def _worker(self) -> None:
        while True:
            job = self._q.get()
            try:
                if job[0] == "incident":
                    self._run_incident(job[1])
                elif job[0] == "badge":
                    self._run_badge(job[1], job[2])
                else:
                    self._run_reply(job[1], job[2])
            except Exception:  # keep the commander alive whatever happens
                traceback.print_exc()

    # ------------------------------------------------------------ incidents
    def _run_incident(self, inc: Incident) -> None:
        self._last_incident = inc.id
        self._set_state(inc, "thinking")
        self._t(inc.id, "start", f"{inc.title} in {inc.room_name}: investigating ({self.mode})")
        if self.agent is not None:
            try:
                prompt = (f"Incident {inc.id}: {inc.title} in {inc.room_name} ({inc.room}), severity "
                          f"{inc.severity}. Reflex actions already taken: "
                          f"{'; '.join(r['action'] for r in inc.reflex) or 'none'}. Handle it.")
                self._stream(inc, {"messages": [{"role": "user", "content": prompt}]})
                return
            except Exception as exc:  # noqa: BLE001
                self._t(inc.id, "error", f"model error, switching to offline playbook: {exc}")
        self._offline_incident(inc)

    def _config(self, inc_id: str) -> dict:
        return {"configurable": {"thread_id": inc_id}, "recursion_limit": 80}

    def _stream(self, inc: Incident, payload: Any) -> None:
        interrupts = None
        for item in self.agent.stream(payload, self._config(inc.id), stream_mode="updates", subgraphs=True):
            ns, update = item if isinstance(item, tuple) and len(item) == 2 else ((), item)
            if not isinstance(update, dict):
                continue
            for node, data in update.items():
                if node == "__interrupt__":
                    interrupts = data
                    continue
                msgs = data.get("messages") if isinstance(data, dict) else None
                msgs = getattr(msgs, "value", msgs) or []
                for m in msgs if isinstance(msgs, list) else [msgs]:
                    self._trace_message(inc.id, m, sub=bool(ns))
        if interrupts:
            self._ask_approval(inc, interrupts)
        else:
            self._set_state(inc, "done")
            self._t(inc.id, "done", "incident handled")

    def _trace_message(self, inc_id: str, m: Any, sub: bool) -> None:
        who = (self._current_sub or "sub-agent") if sub else "commander"
        calls = getattr(m, "tool_calls", None) or []
        for c in calls:
            name, args = c.get("name"), c.get("args", {})
            if name == "task":
                self._current_sub = args.get("subagent_type")
                self._t(inc_id, "delegate", f"-> {self._current_sub}: {str(args.get('description', ''))[:200]}", who)
            elif name in ("write_file", "edit_file"):
                self._t(inc_id, "file", f"{name} {args.get('file_path', '')}", who)
            else:
                short = ", ".join(f"{k}={str(v)[:60]}" for k, v in args.items())
                self._t(inc_id, "tool", f"{name}({short})", who)
        if not calls and getattr(m, "type", "") == "ai":
            text = m.content if isinstance(m.content, str) else " ".join(
                b.get("text", "") for b in m.content if isinstance(b, dict) and b.get("type") == "text")
            if text.strip():
                self._t(inc_id, "say", text.strip(), who)

    def _ask_approval(self, inc: Incident, interrupts) -> None:
        intr = interrupts[0] if isinstance(interrupts, (list, tuple)) else interrupts
        value = getattr(intr, "value", intr) or {}
        actions = value.get("action_requests", []) if isinstance(value, dict) else []
        lines = []
        for a in actions:
            args = a.get("args", {})
            if a.get("name") == "dispatch_vendor":
                lines.append(f"dispatch {args.get('vendor')} for {args.get('work_order_id')} "
                             f"(ETA {args.get('eta')}, call-out ${args.get('callout_usd')})")
            elif a.get("name") == "reopen_valve":
                lines.append(f"REOPEN the {inc.room_name} water valve ({args.get('reason', '')})")
            else:
                lines.append(f"{a.get('name')} {args}")
        self.pending[inc.id] = {"incident": inc.id, "n": max(1, len(actions)), "lines": lines, "mode": "llm"}
        inc.pending_approval = self.pending[inc.id]
        self._set_state(inc, "waiting_approval")
        text = "Approve: " + "; ".join(lines) + "? Reply YES or NO."
        self._t(inc.id, "approval", text)
        self.messenger.send(text, kind="approval", incident=inc.id, actions=["YES", "NO"])

    # --------------------------------------------------------------- replies
    def _run_reply(self, text: str, channel: str) -> None:
        decision = parse_decision(text)
        if self.pending:
            key = next(reversed(self.pending))
            inc_id = self.pending[key]["incident"]
            inc = self.ctx.detector.get(inc_id)
            if decision is None:
                self.messenger.send(f"Waiting on your call: {self.pending[key]['lines'][0]}. Reply YES or NO.",
                                    kind="info", incident=inc_id)
                return
            req = self.pending.pop(key)
            if inc:
                inc.pending_approval = None
            self._t(inc_id, "human", f"manager replied '{text}' via {channel} -> {decision}")
            if req["mode"] == "offline" or self.agent is None:
                self._offline_decision(inc, req, decision, text)
                return
            self._set_state(inc, "thinking")
            d = {"type": "approve"} if decision == "approve" else {"type": "reject", "message": f"Manager declined: {text}"}
            from langgraph.types import Command

            try:
                self._stream(inc, Command(resume={"decisions": [d] * req["n"]}))
            except Exception as exc:  # noqa: BLE001
                self._t(inc_id, "error", f"resume failed ({exc}); finishing offline")
                self._offline_decision(inc, req, decision, text)
            return
        inc_id = self._last_incident
        if decision is not None:
            # A bare YES/NO with nothing waiting: say so plainly instead of treating it as a question.
            self._t(inc_id, "human", f"manager replied '{text}' (nothing pending)")
            self.messenger.send("Nothing needs your approval right now. " + self._offline_answer(text),
                                kind="info", incident=inc_id)
            return
        # Not an approval: a question for the commander about the latest incident.
        self._t(inc_id, "human", f"manager asked: {text}")
        if self.agent is not None and inc_id:
            try:
                answer = self._ask(inc_id, text)
                self.messenger.send(answer[:600], kind="answer", incident=inc_id)
                return
            except Exception as exc:  # noqa: BLE001
                self._t(inc_id, "error", f"model error: {exc}")
        self.messenger.send(self._offline_answer(text), kind="answer", incident=inc_id)

    def _ask(self, inc_id: str, question: str) -> str:
        msg = {"role": "user", "content": f"The building manager asks (reply in under 300 characters, "
                                          f"plain text, iMessage style): {question}"}
        result = self.agent.invoke({"messages": [msg]}, self._config(inc_id))
        last = result["messages"][-1]
        content = last.content
        if isinstance(content, list):
            content = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
        self._t(inc_id, "say", content)
        return content.strip() or "Working on it."

    # ------------------------------------------------------- offline playbook
    def _offline_incident(self, inc: Incident) -> None:
        self.mode = "offline" if self.agent is None else self.mode
        ctx = self.ctx
        ev = inc.evidence
        b = ctx.building
        below = b.below.get(inc.room)
        occupied = ev.get("lounge_occupied")
        cause, risk = self._offline_diagnosis(inc, below, occupied)
        self._t(inc.id, "delegate", "-> diagnostician (offline rules)", "commander")
        self._t(inc.id, "say", f"cause: {cause}", "diagnostician")
        reflex = "\n".join(f"- {time.strftime('%H:%M:%S', time.localtime(r['t']))} {r['action']} "
                           f"({r['latency_ms']} ms)" for r in inc.reflex) or "- none"
        d = self.fs_root / "incidents" / inc.id
        d.mkdir(parents=True, exist_ok=True)
        (d / "report.md").write_text(
            f"# {inc.id}: {inc.title} - {inc.room_name}\n\n*Mode: OFFLINE playbook (no model reachable)*\n\n"
            f"## Timeline\n- {time.strftime('%H:%M:%S', time.localtime(inc.started))} detected ({inc.severity})\n"
            f"{reflex}\n\n## Evidence\n" + "\n".join(f"- {k}: {v}" for k, v in ev.items()) +
            f"\n\n## Likely cause\n{cause}\n\n## Risk to other rooms / people\n{risk}\n")
        self._t(inc.id, "file", f"write_file /incidents/{inc.id}/report.md")
        trade = TRADE_FOR.get(inc.kind, "plumbing")
        vendor = VENDORS[trade][0]
        self._t(inc.id, "delegate", "-> maintenance-planner (offline rules)")
        wo = self._create_work_order(inc.id, f"{inc.title} - {inc.room_name}", inc.room,
                                     "P1" if inc.severity == "critical" else "P2", f"{inc.title} detected by sensors.",
                                     cause, "pipe repair kit, moisture meter" if trade == "plumbing" else "")
        done = "; ".join(r["action"] for r in inc.reflex) or "monitoring"
        self.messenger.send(f"SiteStar: {inc.title} in {inc.room_name} at "
                            f"{time.strftime('%H:%M', time.localtime(inc.started))}. Done automatically: {done}. "
                            f"{risk.split('.')[0]}.", kind="update", incident=inc.id)
        if inc.severity != "critical":
            # Warnings (heat, humidity, freeze risk): handled automatically and logged. No call-out
            # approval, so the manager's one tap always goes to what matters (leaks, fire).
            self._append_report(inc.id, f"Logged {wo['id']} for routine follow-up; no call-out needed.")
            self._set_state(inc, "done")
            self._t(inc.id, "done", f"warning handled automatically; {wo['id']} logged, no approval needed")
            return
        line = f"dispatch {vendor['name']} for {wo['id']} (ETA {vendor['eta']}, call-out ${vendor['callout_usd']})"
        self.pending[inc.id] = {"incident": inc.id, "n": 1, "lines": [line], "mode": "offline",
                                "dispatch": (wo["id"], vendor["name"], vendor["eta"], vendor["callout_usd"])}
        inc.pending_approval = self.pending[inc.id]
        self._set_state(inc, "waiting_approval")
        self._t(inc.id, "approval", f"Approve: {line}?")
        self.messenger.send(f"Approve: {line}? Reply YES or NO.", kind="approval", incident=inc.id, actions=["YES", "NO"])

    def _offline_diagnosis(self, inc: Incident, below: Optional[str], occupied) -> tuple[str, str]:
        b = self.ctx.building
        if inc.kind == "leak":
            cause = "Water at the floor-level probe; supply valve closed automatically. Likely fixture or supply-line failure."
            risk = (f"Water can reach {b.room_name(below)} directly below" if below else "Contained to the room")
            risk += "; it is OCCUPIED now - keep people away from ceiling lights." if occupied else "."
        elif inc.kind == "valve_fault":
            cause = ("The valve was commanded shut but its position switch never closed: the valve is jammed or "
                     "the linkage slipped. Water may still be flowing.")
            risk = "The leak continues until someone closes the manual shutoff by hand."
        elif inc.kind == "smoke":
            cause = ("Light-beam smoke sensor obscured; strobe on, fire door released, exhaust fan held off to avoid "
                     "spreading smoke.")
            risk = "Lounge is OCCUPIED - evacuate and confirm headcount." if occupied else "Lounge appears empty."
        elif inc.kind == "freeze_risk":
            cause = "Pipe surface temperature near freezing; burst risk if it continues."
            risk = "A burst would flood the mechanical room and riser."
        elif inc.kind == "humidity_spike":
            cause = "Fast humidity rise in the mechanical room: possible steam or slow leak."
            risk = "Condensation on electrical gear if it persists."
        elif inc.kind == "overheat":
            cause = "Mechanical room above normal temperature; exhaust fan set to full."
            risk = "Equipment derating or shutdown if it continues."
        else:
            cause, risk = "Sump water level high.", "Basement flooding if the pump fails."
        return cause, risk

    def offer_reopen(self, inc: Incident) -> None:
        """Leak cleared: the valve stays shut until the manager says so."""
        key = f"{inc.id}:reopen"
        if key in self.pending:
            return
        line = f"REOPEN the {inc.room_name} water valve (leak probe has read dry)"
        self.pending[key] = {"incident": inc.id, "n": 1, "lines": [line], "mode": "offline", "valve": True}
        self._t(inc.id, "approval", f"Approve: {line}?")
        self.messenger.send(f"Leak probe in {inc.room_name} is dry again. Approve: {line}? Reply YES or NO.",
                            kind="approval", incident=inc.id, actions=["YES", "NO"])

    def _offline_decision(self, inc: Optional[Incident], req: dict, decision: str, text: str) -> None:
        inc_id = req["incident"]
        if req.get("grid"):
            self.ctx.grid_decide(decision == "approve", by="manager")
            self.messenger.send("Grid event approved: flexible AI jobs paused, cooling slowed. Watch the meter."
                                if decision == "approve" else "OK, no cut. Running at full power.", kind="confirm")
            self._t(None, "done", f"grid event decision: {decision}")
            return
        if req.get("valve"):
            if decision == "approve":
                result = self.ctx.request_valve(True, by="manager approval")
                self.messenger.send(f"Valve: {result}.", kind="confirm", incident=inc_id)
                if inc and not result.startswith("refused"):
                    inc.status = "resolved"
            else:
                self.messenger.send("OK - valve stays closed.", kind="confirm", incident=inc_id)
            self._append_report(inc_id, f"Valve reopen: '{text}' -> {decision}")
            self._t(inc_id, "done", f"reopen decision: {decision}")
            return
        if decision == "approve" and req.get("dispatch"):
            self._dispatch(*req["dispatch"])
        elif decision == "approve":
            self.messenger.send("Approved. Done.", kind="confirm", incident=inc_id)
        else:
            self.messenger.send("Understood - not dispatching. I'll keep monitoring and log it.", kind="confirm",
                                incident=inc_id)
        self._append_report(inc_id, f"Vendor dispatch: '{text}' -> {decision}")
        if inc:
            self._set_state(inc, "done")
        self._t(inc_id, "done", f"manager decision recorded: {decision}")

    def _append_report(self, inc_id: Optional[str], line: str) -> None:
        if not inc_id:
            return
        d = self.fs_root / "incidents" / inc_id / "report.md"
        if d.exists():
            body = d.read_text()
            if "## Decisions and site visits" not in body:
                body += "\n## Decisions and site visits\n"
            d.write_text(body + f"- {time.strftime('%H:%M:%S')} {line}\n")

    def _offline_answer(self, text: str) -> str:
        inc = self.ctx.detector.get(self._last_incident) if self._last_incident else None
        if not inc:
            return "All clear: no active incidents. Every sensor is reporting normally."
        live = self.ctx.live_status()
        return (f"{inc.title} in {inc.room_name} ({inc.status}). Valve is {'open' if live['valve_open'] else 'closed'}; "
                f"work order {inc.work_order or 'pending'}.")

    def snapshot(self) -> dict:
        return {"mode": self.mode, "trace": self.trace[-120:], "pending": list(self.pending.values()),
                "work_orders": list(self.work_orders.values()), "dispatches": self.dispatches}
