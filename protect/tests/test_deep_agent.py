"""Drives the REAL Deep Agents graph (tools, filesystem backend, human-in-the-loop interrupt and
resume) with a scripted chat model, so the LLM path is verified without network or credentials."""
import time

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from sitestar_protect.agent import IncidentCommander
from sitestar_protect.building import load_building
from sitestar_protect.controller import ProtectController
from sitestar_protect.device import NullLink, Reading
from sitestar_protect.messaging import Messenger


class ScriptedModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def wait_for(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def call(name, args, i):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"call_{i}", "type": "tool_call"}])


def test_deep_agent_tools_dossier_and_human_approval(tmp_path):
    script = iter([
        call("get_incident", {"incident_id": "INC-0001"}, 1),
        call("get_sensor_history", {"sensor": "leak", "minutes": 5}, 2),
        call("write_file", {"file_path": "/incidents/INC-0001/report.md",
                            "content": "# INC-0001\nLeak in 2F Bathroom; lounge below occupied."}, 3),
        call("notify_manager", {"message": "Leak 2F bath, valve shut, plumber recommended."}, 4),
        call("dispatch_vendor", {"work_order_id": "WO-101", "vendor": "Bayou City Plumbing (demo vendor)",
                                 "eta": "45-60 min", "callout_usd": 185}, 5),
        AIMessage(content="Leak contained; plumber dispatched with manager approval."),
    ])
    b = load_building()
    m = Messenger(None)
    c = ProtectController(b, NullLink(), m)
    # Detector ids are global across tests; make this one deterministic.
    from sitestar_protect import detector as det
    import itertools
    det.Detector._ids = itertools.count(1)
    c.detector = det.Detector(b, c.history)
    cmd = IncidentCommander(c, m, fs_root=tmp_path, model=ScriptedModel(messages=script), mode="test-llm")
    c.commander = cmd
    assert cmd.agent is not None

    c.ingest(Reading(leak=2600, wet=True, valve_open=False, pir=True))
    inc = c.detector.all[0]
    assert inc.id == "INC-0001"
    assert wait_for(lambda: inc.agent_state == "waiting_approval")       # paused at dispatch_vendor
    assert (tmp_path / "incidents" / "INC-0001" / "report.md").exists()  # written via the agent filesystem
    assert any(x["kind"] == "update" for x in m.transcript)               # notify_manager ran
    assert "Bayou City Plumbing" in m.transcript[-1]["text"] and m.transcript[-1]["kind"] == "approval"
    assert not cmd.dispatches                                             # nothing happened before approval

    m.receive("YES", channel="imessage")
    assert wait_for(lambda: inc.agent_state == "done")
    assert cmd.dispatches and cmd.dispatches[0]["vendor"].startswith("Bayou City")
    kinds = [t["kind"] for t in cmd.trace]
    assert "tool" in kinds and "file" in kinds and "approval" in kinds and "human" in kinds
