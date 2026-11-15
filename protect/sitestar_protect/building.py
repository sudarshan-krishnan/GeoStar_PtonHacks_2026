"""Building model (exported by DESIGN) and the sensor planner that places sensors from it.

The planner is a conceptual layout aid. Real placement must follow NFPA 72, the IFC/IBC
and the local fire marshal; the output says so on every item.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

CONFIG = Path(__file__).resolve().parents[1] / "config" / "building.json"

SMOKE_COVERAGE_M2 = 84.0   # ~30 ft spacing for a spot smoke detector on a smooth ceiling (rule of thumb)
CODE_NOTE = "Conceptual placement - must be confirmed against NFPA 72 / IFC and the local AHJ."


@dataclass
class Room:
    id: str
    name: str
    floor: int
    type: str
    x: float
    y: float
    w: float
    h: float
    wet_fixtures: int = 0
    notes: str = ""

    @property
    def area_m2(self) -> float:
        return self.w * self.h


@dataclass
class SensorPlanItem:
    room: str
    kind: str              # leak | shutoff_valve | smoke | heat | temp_humidity | occupancy | electrical
    count: int
    reason: str
    physical: bool = False  # True if this sensor exists on the table model
    code_note: str = CODE_NOTE


@dataclass
class Building:
    project: dict
    rooms: list[Room]
    below: dict
    hardware_map: dict
    led_rooms: list[str]
    plan: list[SensorPlanItem] = field(default_factory=list)

    def room(self, room_id: str) -> Optional[Room]:
        return next((r for r in self.rooms if r.id == room_id), None)

    def room_name(self, room_id: str) -> str:
        r = self.room(room_id)
        return r.name if r else room_id

    def to_json(self) -> dict:
        return {
            "project": self.project,
            "rooms": [{**asdict(r), "area_m2": round(r.area_m2, 1)} for r in self.rooms],
            "below": self.below,
            "hardware_map": self.hardware_map,
            "led_rooms": self.led_rooms,
            "plan": [asdict(p) for p in self.plan],
        }


def load_building(path: Optional[str] = None) -> Building:
    cfg = json.loads(Path(path or CONFIG).read_text())
    rooms = [Room(**{k: v for k, v in r.items() if k in Room.__dataclass_fields__}) for r in cfg["rooms"]]
    b = Building(cfg["project"], rooms, cfg.get("below", {}), cfg["hardware_map"], cfg["led_rooms"])
    b.plan = plan_sensors(b)
    return b


def plan_sensors(b: Building) -> list[SensorPlanItem]:
    """Rule-based layout from the floor plan. Deterministic so it can be checked and explained."""
    hw = b.hardware_map
    out: list[SensorPlanItem] = []
    for r in b.rooms:
        if r.wet_fixtures > 0:
            out.append(SensorPlanItem(r.id, "leak", max(1, math.ceil(r.wet_fixtures / 2)),
                                      f"{r.wet_fixtures} wet fixtures; one probe per pair at floor level",
                                      physical=hw.get("leak") == r.id))
            if r.type in ("bathroom", "laundry", "mechanical"):
                out.append(SensorPlanItem(r.id, "shutoff_valve", 1,
                                          "automatic branch shut-off so a leak is stopped, not just reported"
                                          + (f"; protects {b.room_name(b.below[r.id])} below" if r.id in b.below else ""),
                                          physical=hw.get("valve") == r.id))
        if r.type == "kitchen":
            out.append(SensorPlanItem(r.id, "heat", 1, "heat detector instead of smoke: cooking causes nuisance smoke alarms"))
        elif r.type in ("bedroom", "corridor", "lounge", "laundry"):
            n = max(1, math.ceil(r.area_m2 / SMOKE_COVERAGE_M2))
            if r.type == "bedroom":
                n = max(n, 12 if "201-212" in r.name else 1)
                reason = "one smoke alarm in every sleeping room"
            else:
                reason = f"{r.area_m2:.0f} m2 at ~{SMOKE_COVERAGE_M2:.0f} m2 per detector"
            out.append(SensorPlanItem(r.id, "smoke", n, reason, physical=hw.get("smoke") == r.id))
        if r.type in ("mechanical", "electrical"):
            out.append(SensorPlanItem(r.id, "temp_humidity", 1, "equipment overheating and condensation / slow leaks",
                                      physical=hw.get("dht") == r.id))
            out.append(SensorPlanItem(r.id, "electrical", 1, "panel temperature / load monitoring (not on the table model)"))
        if r.type in ("lounge", "corridor"):
            out.append(SensorPlanItem(r.id, "occupancy", 1, "who is in the building when an alarm sounds",
                                      physical=hw.get("pir") == r.id))
    return out
