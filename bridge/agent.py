"""SiteStar's inspection agent: Claude inspects one building with tools over our own data.

The fixed rules in costar_sites.py decide pass or fail; the agent never overrides them. It
gathers the evidence (CoStar record, flood and neighbors, the aerial photo, the 3D-scan
snapshots, the power gap, the pause budget), looks at the images, and writes the passport's
headline, observations, conversion items and open questions. Numbers must come from tools.

Credentials: ANTHROPIC_API_KEY (or anything else the Anthropic SDK can find), optionally set
in bridge/.env. Without them the website runs the same inspection with rules only.

Each event is a dict the bridge streams to the page as Server-Sent Events. A finished run is
saved to bridge/.cache/agent/<site>.json so the demo can replay it if the network fails.
"""

import base64
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
CACHE = Path(os.environ.get("SITESTAR_AGENT_CACHE") or Path(__file__).resolve().parent / ".cache" / "agent")
MODEL = os.environ.get("SITESTAR_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("SITESTAR_EFFORT", "medium")
MAX_TURNS = 10

SYSTEM = """You inspect existing Houston industrial buildings for conversion into AI compute sites, a first phase of roughly 1 to 30 MW. A broker or an AI operator's site team reads your findings before deciding whether to visit.

How to work:
- Use the tools to gather the evidence: the CoStar record, flood zone and neighbors, the aerial photo, the 3D-scan snapshots, the power gap and the pause budget. Look at the images closely.
- SiteStar's fixed rules already decide pass or fail. Never contradict them; explain what the evidence shows and what still needs checking.
- Every number you write must come from a tool result. Do not invent capacities, prices, dates or distances. If the data doesn't say, name it as something to verify on site.
- What you see in an image is an observation, not a measurement: say what you see and how sure you are.
- Finish by calling submit_passport once: a headline under 20 words, at most 6 observations of under 30 words each, the conversion work items, and the open questions a site visit must answer."""

EMPTY = {"type": "object", "properties": {}, "additionalProperties": False, "required": []}
TOOLS = [
    {"name": "get_building_record", "strict": True, "input_schema": EMPTY,
     "description": "CoStar's record for the building: use, size, year built, clear height, slab, column spacing, sprinklers, docks, electrical service, zoning, listing status, and SiteStar's rule results for each item."},
    {"name": "check_flood_and_neighbors", "strict": True, "input_schema": EMPTY,
     "description": "FEMA flood zone at the building (queried live when the data was built) and the distance to the nearest mapped residential area, with the pass/fail gate results."},
    {"name": "look_from_above", "strict": True, "input_schema": EMPTY,
     "description": "A recent aerial photo centred on the building, north up, about 700 m across. Use it to judge yard space for transformers, chillers and generators, truck access, rooftop equipment, and what the neighbors are."},
    {"name": "walk_3d_scan", "strict": True, "input_schema": EMPTY,
     "description": "Snapshots from the building's public Matterport 3D scan: a dollhouse view of the scanned space and an interior photo. Use them to judge the open floor, ceiling structure, columns and the current use."},
    {"name": "size_power", "strict": True,
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["pod_mw"],
                      "properties": {"pod_mw": {"type": "number", "description": "IT load of the first phase, MW"}}},
     "description": "Existing electrical service versus the first phase's load, and the distance to high-voltage substations and 345 kV lines. Distance is not capacity."},
    {"name": "plan_pauses", "strict": True,
     "input_schema": {"type": "object", "additionalProperties": False, "required": ["pod_mw", "flexible_share"],
                      "properties": {"pod_mw": {"type": "number"},
                                     "flexible_share": {"type": "number", "description": "share of the load that can pause, 0 to 1"}}},
     "description": "From ERCOT's 2025 hourly load: the hours the site would have paused (the four summer system peaks that set Texas transmission charges, plus Houston's tightest hours) and the estimated transmission charge avoided."},
    {"name": "submit_passport", "strict": True,
     "input_schema": {
         "type": "object", "additionalProperties": False,
         "required": ["headline", "observations", "conversion_items", "open_questions"],
         "properties": {
             "headline": {"type": "string"},
             "observations": {"type": "array", "items": {
                 "type": "object", "additionalProperties": False, "required": ["source", "text"],
                 "properties": {"source": {"type": "string", "enum": ["record", "aerial", "scan", "flood", "grid", "pauses"]},
                                "text": {"type": "string"}}}},
             "conversion_items": {"type": "array", "items": {"type": "string"}},
             "open_questions": {"type": "array", "items": {"type": "string"}},
         }},
     "description": "Submit the inspection findings for the passport. Call this once, at the end."},
]

STEP_TITLES = {
    "get_building_record": "Reading CoStar's record",
    "check_flood_and_neighbors": "Checking flood zone and neighbors",
    "look_from_above": "Looking from above",
    "walk_3d_scan": "Walking the 3D scan",
    "size_power": "Sizing the power",
    "plan_pauses": "Planning the pauses",
    "submit_passport": "Writing the passport",
}


# ---------------------------------------------------------------- credentials

def load_env_file(path=Path(__file__).resolve().parent / ".env"):
    """KEY=VALUE lines from bridge/.env into os.environ (never overrides what's already set)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def status() -> dict:
    try:
        import anthropic  # noqa: F401
        sdk = True
    except ImportError:
        sdk = False
    creds = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                 or (Path.home() / ".config" / "anthropic").exists())
    cached = sorted(int(p.stem) for p in CACHE.glob("*.json")) if CACHE.exists() else []
    reason = None if sdk and creds else "Anthropic SDK not installed" if not sdk else "No Claude credentials (set ANTHROPIC_API_KEY in bridge/.env)"
    return {"available": sdk and creds, "model": MODEL, "effort": EFFORT, "reason": reason, "cached": cached}


# ---------------------------------------------------------------- the data the tools read

def _sites():
    return json.loads((DATA / "costar-sites.json").read_text())


def _image_block(rel_path):
    data = (DATA.parent / rel_path).read_bytes()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(data).decode()}}


class Inspection:
    def __init__(self, site_id: int, pod_mw: float | None = None, flexible_share: float = 0.5):
        doc = _sites()
        self.site = next(s for s in doc["sites"] if s["id"] == site_id)
        self.summary = doc["summary"]
        self.pauses = json.loads((DATA / "pause-budget.json").read_text())
        self.pod_mw = pod_mw or self.site.get("first_phase_mw") or 10
        self.flexible_share = flexible_share

    # each tool returns (content for Claude, one-line summary for the page)

    def get_building_record(self, _):
        s, b, p = self.site, self.site["building"], self.site["power"]
        rec = {
            "use": s["use"], "type": s["type"], "gross_sq_ft": b["gross_sf"] or s["building_sf"], "lot_acres": s["lot_acres"],
            "year_built": b["year_built"], "construction": b["construction"], "building_class": b["class"], "stories": b["stories"],
            "clear_height_ft": b["clear_ft"], "slab_in": b["slab_in"], "column_spacing_ft": b["columns_ft"],
            "sprinklers": b["sprinklers"], "loading_docks": b["docks"], "dock_count": b["dock_count"], "cranes": b["cranes"],
            "electrical_service": {"heavy_power": p["heavy"], "amps": p["amps"], "volts": p["volts"], "phases": p["phases"],
                                   "estimated_kva": p["service_kva"], "volts_assumed_480": p["volts_assumed"]},
            "zoning": s["zoning"], "listing": s["listing"]["active"] or "not listed now", "tenancy": b["tenancy"],
            "rule_results": [{k: i[k] for k in ("name", "status", "value", "note")} for i in s["ready"]["items"]],
            "funnel": f"#{s['rank']} of {self.summary['funnel']['finalists']} finalists among {self.summary['sites']} Houston industrial, flex and land properties",
        }
        bits = [s["use"].lower(), f"{int(rec['gross_sq_ft']):,} sq ft" if rec["gross_sq_ft"] else None,
                f"built {b['year_built']}" if b["year_built"] else None, f"{b['clear_ft']:g} ft clear" if b["clear_ft"] else None,
                f"{p['amps']:,} A service" if p["amps"] else ("heavy power" if p["heavy"] else None)]
        line = ", ".join(x for x in bits if x)
        return json.dumps(rec), line[:1].upper() + line[1:]

    def check_flood_and_neighbors(self, _):
        sc = self.site["screen"]
        f = sc.get("flood") or {}
        out = {"fema_flood_zone": f.get("zone"), "fema_subtype": f.get("subtype"), "in_100_year_floodplain": f.get("sfha") == "T",
               "flood_gate": sc["flood_status"], "nearest_residential_km": sc["homes_km"], "homes_gate": sc["homes_status"],
               "homes_rule": "fail within 0.5 km (team assumption); residential areas from OpenStreetMap, which misses some neighborhoods"}
        hk = sc["homes_km"]
        return json.dumps(out), f"FEMA zone {f.get('zone') or '?'}; nearest homes {hk:.1f} km" if hk is not None else f"FEMA zone {f.get('zone') or '?'}; no homes mapped within 3 km"

    def look_from_above(self, _):
        a = (self.site.get("media") or {}).get("aerial")
        if not a:
            return "No aerial photo cached for this building.", "No aerial photo available"
        sc = self.site["screen"]
        note = (f"Aerial photo ({a['source']}), north up, {a['side_m']} m across, the building at the centre. "
                f"Nearest mapped homes: {sc['homes_km']} km. Nearest 345 kV line: {sc['line345_km']} km.")
        return [_image_block(a["file"]), {"type": "text", "text": note}], f"Aerial photo, {a['side_m']} m across"

    def walk_3d_scan(self, _):
        scans = (self.site.get("media") or {}).get("scans") or []
        imgs = [i for sc in scans for i in sc["images"]]
        pick = [i for i in imgs if i["kind"] == "dollhouse"][:1] + [i for i in imgs if i["kind"] == "photo"][:1]
        if not pick:
            return "This building has no public 3D-scan snapshots.", "No 3D scan available"
        sc = scans[0]
        note = f"Matterport scan '{sc['name']}' ({sc['sweeps']} scan positions). Images: " + ", ".join(i["label"] for i in pick) + "."
        return [*(_image_block(i["file"]) for i in pick), {"type": "text", "text": note}], f"{len(pick)} snapshots from the 3D scan"

    def size_power(self, args):
        mw = float(args.get("pod_mw") or self.pod_mw)
        p, sc = self.site["power"], self.site["screen"]
        have = (p["service_kva"] or 0) / 1000
        sub = sc.get("substation") or {}
        out = {"first_phase_mw": mw, "existing_service_mva": round(have, 2) if p["service_kva"] else None,
               "existing_service_basis": "amps x volts x sqrt(3); 480 V assumed" if p["volts_assumed"] else "amps x volts x sqrt(3)",
               "gap_mw": round(mw - have, 1) if p["service_kva"] else None,
               "nearest_substation": {"km": sub.get("km"), "kv": sub.get("kv"), "name": sub.get("name")},
               "nearest_345kv_line_km": sc["line345_km"],
               "caveat": "Distance to the grid is not capacity. Only the utility's study says what it can deliver and when."}
        gap = f"gap {mw - have:.1f} MW" if p["service_kva"] else "service size not recorded"
        return json.dumps(out), f"{mw:g} MW needed vs ≈{have:.1f} MVA today; {gap}; 345 kV line {sc['line345_km']:.1f} km"

    def plan_pauses(self, args):
        mw = float(args.get("pod_mw") or self.pod_mw)
        share = max(0.0, min(1.0, float(args.get("flexible_share", self.flexible_share))))
        pb = self.pauses
        s = pb["summary"]
        saved = mw * 1000 * share * pb["tcrf"]["per_kw_year"]
        out = {"year": pb["year"], "pause_hours": s["pause_hours"], "share_of_year": s["share_of_year"], "pause_days": s["pause_days"],
               "summer_peaks": pb["peaks"], "peaks_caught": pb["peaks_caught"], "method": pb["method"],
               "flexible_mw_paused": round(mw * share, 2), "deferred_mwh": round(mw * share * s["pause_hours"], 1),
               "transmission_charge_avoided_per_year_usd": round(saved), "charge_basis": pb["tcrf"]["basis"], "label": "Estimated"}
        return json.dumps(out), f"{s['pause_hours']} h in {pb['year']} ({s['share_of_year']:.1%}), all {pb['peaks_caught']} summer peaks; ≈${saved / 1000:,.0f}K/yr"

    def submit_passport(self, args):
        return "Passport saved.", "Passport written"

    # ---------------------------------------------------------------- the loop

    def run(self):
        """Yield events. Needs the Anthropic SDK and credentials."""
        import anthropic

        t0 = time.time()
        s = self.site
        yield {"type": "start", "model": MODEL, "site_id": s["id"], "pod_mw": self.pod_mw, "flexible_share": self.flexible_share}
        client = anthropic.Anthropic(timeout=180.0, max_retries=1)
        messages = [{"role": "user", "content":
                     f"Inspect {s['name']} at {s['address']} (CoStar property {s['id']}). It is #{s['rank']} of the "
                     f"{self.summary['funnel']['finalists']} finalists among CoStar's {self.summary['sites']} Houston industrial, flex and land properties. "
                     f"Target first phase: {self.pod_mw:g} MW, of which {self.flexible_share:.0%} of the computing can pause."}]
        passport, nudged, usage = None, False, {"input_tokens": 0, "output_tokens": 0}
        for _ in range(MAX_TURNS):
            try:
                resp = client.beta.messages.create(
                    model=MODEL, max_tokens=16000, system=SYSTEM, tools=TOOLS, messages=messages,
                    output_config={"effort": EFFORT},
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                )
            except anthropic.AuthenticationError:
                yield {"type": "error", "message": "Claude rejected the API key."}
                return
            except anthropic.RateLimitError:
                yield {"type": "error", "message": "Claude is rate-limiting this key; try again in a minute."}
                return
            except anthropic.APIStatusError as e:
                yield {"type": "error", "message": f"Claude API error {e.status_code}."}
                return
            except anthropic.APIConnectionError:
                yield {"type": "error", "message": "Couldn't reach the Claude API."}
                return
            usage["input_tokens"] += getattr(resp.usage, "input_tokens", 0) or 0
            usage["output_tokens"] += getattr(resp.usage, "output_tokens", 0) or 0
            if resp.stop_reason == "refusal":
                yield {"type": "error", "message": "Claude declined this request."}
                return
            messages.append({"role": "assistant", "content": resp.content})
            for block in resp.content:
                if block.type == "text" and block.text.strip():
                    yield {"type": "text", "text": block.text.strip()}
            if resp.stop_reason == "pause_turn":
                continue
            calls = [b for b in resp.content if b.type == "tool_use"]
            if not calls:
                if nudged:
                    break
                nudged = True
                messages.append({"role": "user", "content": "Please call submit_passport now with your findings."})
                continue
            results = []
            for call in calls:
                yield {"type": "tool", "name": call.name, "title": STEP_TITLES.get(call.name, call.name), "input": call.input}
                t1 = time.time()
                try:
                    content, summary = getattr(self, call.name)(call.input or {})
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": content})
                    if call.name == "submit_passport":
                        passport = call.input
                except Exception as exc:  # report the tool failure to Claude rather than crash
                    summary = f"Failed: {exc}"
                    results.append({"type": "tool_result", "tool_use_id": call.id, "content": f"Error: {exc}", "is_error": True})
                yield {"type": "tool_done", "name": call.name, "summary": summary, "ms": round((time.time() - t1) * 1000)}
            messages.append({"role": "user", "content": results})
            if passport:
                break
        if passport:
            yield {"type": "passport", **passport}
        else:
            yield {"type": "error", "message": "The agent finished without writing a passport."}
        yield {"type": "done", "ms": round((time.time() - t0) * 1000), "usage": usage, "model": MODEL}


def inspect(site_id: int, pod_mw: float | None = None, flexible_share: float = 0.5):
    """Run live and save the run for replay. Yields events with a 't' offset in seconds."""
    t0 = time.time()
    events = []
    try:
        for ev in Inspection(site_id, pod_mw, flexible_share).run():
            ev = {**ev, "t": round(time.time() - t0, 2)}
            events.append(ev)
            yield ev
    except StopIteration:
        return
    except Exception as exc:  # anything unexpected becomes an event, not a broken stream
        ev = {"type": "error", "message": f"Agent failed: {exc}", "t": round(time.time() - t0, 2)}
        events.append(ev)
        yield ev
        return
    if any(e["type"] == "passport" for e in events):
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"{site_id}.json").write_text(json.dumps({"saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "events": events}))


def replay(site_id: int, speed: float = 1.0):
    """Stream a saved run with its original pacing (shortened by speed)."""
    path = CACHE / f"{site_id}.json"
    if not path.exists():
        yield {"type": "error", "message": "No saved run for this building yet."}
        return
    saved = json.loads(path.read_text())
    last = 0.0
    for ev in saved["events"]:
        time.sleep(max(0.0, min(4.0, (ev.get("t", last) - last) / speed)))
        last = ev.get("t", last)
        yield {**ev, "replay": True, "saved_at": saved["saved_at"]}


def main() -> int:
    """Run the agent from the terminal and save each run for replay (warm the cache before a demo).

        python bridge/agent.py --all          # every finalist
        python bridge/agent.py 11175666       # one building
    """
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="Run SiteStar's inspection agent and save the runs for replay")
    ap.add_argument("site", nargs="?", type=int, help="CoStar property id")
    ap.add_argument("--all", action="store_true", help="every finalist")
    args = ap.parse_args()
    load_env_file()
    st = status()
    if not st["available"]:
        print(f"Agent unavailable: {st['reason']}")
        return 1
    ids = [s["id"] for s in _sites()["sites"] if s["ready"]["stage"] == 3] if args.all else [args.site] if args.site else []
    if not ids:
        ap.print_help()
        return 1
    for sid in ids:
        print(f"== {sid}")
        for ev in inspect(sid):
            if ev["type"] in ("tool_done", "text", "error"):
                print(f"   {ev['type']}: {ev.get('summary') or ev.get('text') or ev.get('message')}")
            elif ev["type"] == "passport":
                print(f"   passport: {ev['headline']}")
            elif ev["type"] == "done":
                print(f"   done in {ev['ms'] / 1000:.0f} s, {ev['usage']['input_tokens']:,} tokens in, {ev['usage']['output_tokens']:,} out")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
