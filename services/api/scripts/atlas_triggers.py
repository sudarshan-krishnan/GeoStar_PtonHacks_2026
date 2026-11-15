"""Create (or update) PlotStar's real Atlas Triggers through the App Services admin API. Idempotent.

Run:  services/api/.venv/Scripts/python services/api/scripts/atlas_triggers.py
Needs ATLAS_PUBLIC_KEY / ATLAS_PRIVATE_KEY in .env (a project API key) and the project id below.

What it creates, in an app named `plotstar-triggers` linked to the `PlotStar` cluster:
  decisions_insert    DATABASE trigger on plotstar.decisions INSERT  -> function onDecision  (writes `notifications`)
  projects_change     DATABASE trigger on plotstar.studio_projects   -> function onProjectChange (refreshes `portfolio_snapshot`)
  grid_minutes_rollup SCHEDULED trigger every minute                 -> function gridMinutesRollup (minute windows -> `grid_minutes`)
Time-series collections cannot have database triggers, so the high-watts alert runs in the API at ingest (triggers.py).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")
BASE = "https://services.cloud.mongodb.com/api/admin/v3.0"
GROUP = os.getenv("ATLAS_PROJECT_ID", "6af88bb495d62627ebb69ca5")
CLUSTER = os.getenv("ATLAS_CLUSTER", "PlotStar")
APP = "plotstar-triggers"

FUNCTIONS = {
    "onDecision": r'''exports = async function(changeEvent) {
  const doc = changeEvent.fullDocument || {};
  const db = context.services.get("mongodb-atlas").db("plotstar");
  await db.collection("notifications").insertOne({
    kind: "decision", source: "atlas-trigger", project_id: doc.project_id, event: doc.event,
    by: doc.by || null, status: doc.status || null, mw_it: doc.mw_it || null, at: new Date(),
    message: `${doc.by || "Someone"}: ${doc.event} on ${doc.project_id}`
  });
  return true;
};''',
    "onProjectChange": r'''exports = async function(changeEvent) {
  const db = context.services.get("mongodb-atlas").db("plotstar");
  const agg = await db.collection("studio_projects").aggregate([
    { $group: { _id: null, projects: { $sum: 1 }, mw: { $sum: "$mw_it" },
                capex: { $sum: { $ifNull: ["$summary.capex", 0] } },
                decided: { $sum: { $cond: [{ $eq: ["$status", "decided"] }, 1, 0] } } } }
  ]).toArray();
  const t = agg[0] || { projects: 0, mw: 0, capex: 0, decided: 0 };
  delete t._id;
  await db.collection("portfolio_snapshot").updateOne({ _id: "latest" },
    { $set: { ...t, source: "atlas-trigger", updated_at: new Date(), last_change: changeEvent.operationType } },
    { upsert: true });
  return true;
};''',
    "gridMinutesRollup": r'''exports = async function() {
  const db = context.services.get("mongodb-atlas").db("plotstar");
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db.collection("grid_telemetry").aggregate([
    { $match: { ts: { $gte: since } } },
    { $group: { _id: { minute: { $dateTrunc: { date: "$ts", unit: "minute" } }, machine: "$meta.machine" },
                avg_watts: { $avg: "$watts" }, max_watts: { $max: "$watts" }, min_watts: { $min: "$watts" }, points: { $sum: 1 } } }
  ]).toArray();
  for (const r of rows) {
    await db.collection("grid_minutes").updateOne({ minute: r._id.minute, machine: r._id.machine },
      { $set: { avg_watts: r.avg_watts, max_watts: r.max_watts, min_watts: r.min_watts, points: r.points,
                source: "atlas-scheduled-trigger", updated_at: new Date() } }, { upsert: true });
  }
  return rows.length;
};''',
}
TRIGGERS = [
    ("decisions_insert", "onDecision", {"type": "DATABASE", "config": {"operation_types": ["INSERT"], "database": "plotstar",
                                                                       "collection": "decisions", "full_document": True, "unordered": False}}),
    ("projects_change", "onProjectChange", {"type": "DATABASE", "config": {"operation_types": ["INSERT", "UPDATE", "REPLACE", "DELETE"],
                                                                           "database": "plotstar", "collection": "studio_projects",
                                                                           "full_document": True, "unordered": False}}),
    ("grid_minutes_rollup", "gridMinutesRollup", {"type": "SCHEDULED", "config": {"schedule": "* * * * *", "skip_catchup_events": True}}),
]


def main() -> int:
    pub, priv = os.getenv("ATLAS_PUBLIC_KEY"), os.getenv("ATLAS_PRIVATE_KEY")
    if not pub or not priv:
        print("ATLAS_PUBLIC_KEY / ATLAS_PRIVATE_KEY missing in .env"); return 2
    c = httpx.Client(base_url=BASE, timeout=60)
    tok = c.post("/auth/providers/mongodb-cloud/login", json={"username": pub, "apiKey": priv}).raise_for_status().json()["access_token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    apps = c.get(f"/groups/{GROUP}/apps").raise_for_status().json()
    app = next((a for a in apps if a["name"] == APP), None)
    if not app:
        r = c.post(f"/groups/{GROUP}/apps", json={"name": APP, "location": "US-VA", "deployment_model": "LOCAL", "provider_region": "aws-us-east-1"})
        if r.status_code >= 300:
            print("create app failed:", r.status_code, r.text[:300]); return 1
        app = r.json(); print("created app", app["_id"])
    else:
        print("app exists", app["_id"])
    A = f"/groups/{GROUP}/apps/{app['_id']}"
    svcs = c.get(f"{A}/services").raise_for_status().json()
    svc = next((s for s in svcs if s["type"] == "mongodb-atlas"), None)
    if not svc:
        r = c.post(f"{A}/services", json={"name": "mongodb-atlas", "type": "mongodb-atlas", "config": {"clusterName": CLUSTER, "readPreference": "primary", "wireProtocolEnabled": False}})
        if r.status_code >= 300:
            print("link cluster failed:", r.status_code, r.text[:300]); return 1
        svc = r.json(); print("linked cluster", CLUSTER)
    else:
        print("cluster already linked")
    fns = {f["name"]: f for f in c.get(f"{A}/functions").raise_for_status().json()}
    for name, src in FUNCTIONS.items():
        body = {"name": name, "source": src, "private": True, "run_as_system": True}
        if name in fns:
            c.put(f"{A}/functions/{fns[name]['_id']}", json=body).raise_for_status(); print("updated function", name)
        else:
            fns[name] = c.post(f"{A}/functions", json=body).raise_for_status().json(); print("created function", name)
    trs = {t["name"]: t for t in c.get(f"{A}/triggers").raise_for_status().json()}
    for name, fn, spec in TRIGGERS:
        body = {"name": name, "type": spec["type"], "config": dict(spec["config"]), "function_id": fns[fn]["_id"], "disabled": False}
        if spec["type"] == "DATABASE":
            body["config"]["service_id"] = svc["_id"]
        if name in trs:
            r = c.put(f"{A}/triggers/{trs[name]['_id']}", json=body); print("updated trigger", name, r.status_code, "" if r.status_code < 300 else r.text[:200])
        else:
            r = c.post(f"{A}/triggers", json=body); print("created trigger", name, r.status_code, "" if r.status_code < 300 else r.text[:200])
    final = c.get(f"{A}/triggers").raise_for_status().json()
    print("TRIGGERS:", [(t["name"], t["type"], "disabled" if t.get("disabled") else "enabled") for t in final])
    try:  # tell the API's in-app worker which rules Atlas now owns
        sys.path.insert(0, str(ROOT / "services" / "api"))
        from app import atlas
        db = atlas._db()
        if db is not None:
            db.meta.update_one({"_id": "atlas_triggers"}, {"$set": {"app_id": app["_id"], "triggers": [t["name"] for t in final], "at": atlas._now()}}, upsert=True)
            print("recorded in meta.atlas_triggers")
    except Exception as e:
        print("meta note skipped:", type(e).__name__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
