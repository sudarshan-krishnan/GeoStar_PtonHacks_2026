// The inspection: a step-by-step trace on the left, the evidence for each step on the right.
//
// Rules only: runs in the browser from the saved data (plus a live FEMA check).
// Claude agent: streams the agent's tool calls from the bridge as Server-Sent Events, live
// when Claude credentials are set, otherwise a replay of the last saved run if there is one.

import { $, $$, h, fmt, chip, ICON } from "./util.js";
import { auditable } from "./audit.js";
import { store, on, emit, save, sqft, mva, VERDICT, STATUS, rulesHeadline } from "./store.js";
import { flyover } from "./drone.js";
import { switchBuilding } from "./scrolly.js";

const FEMA = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";
const STEPS = {
  get_building_record: { title: "Reading CoStar's record", pane: "record", label: "Sourced" },
  walk_3d_scan: { title: "Walking the 3D scan", pane: "scan", label: "Sourced" },
  look_from_above: { title: "Looking from above", pane: "aerial", label: "Sourced" },
  check_flood_and_neighbors: { title: "Checking flood zone and neighbors", pane: "grid", label: "Sourced" },
  size_power: { title: "Sizing the power", pane: "grid", label: "Estimated" },
  plan_pauses: { title: "Planning the pauses", pane: "grid", label: "Estimated" },
  submit_passport: { title: "Writing the passport", pane: null, label: "Estimated" },
};
const RULE_ORDER = ["get_building_record", "walk_3d_scan", "look_from_above", "check_flood_and_neighbors", "size_power", "plan_pauses"];
const PACE_MS = 650;

let mode = "agent";
let run = 0; // incremented to cancel a running inspection
let source = null; // EventSource
let findings = null; // agent passport for the selected building
let flood = null; // live FEMA answer for the selected building
let aerial = null, gridMap = null, gridData = null;

export function initInspect() {
  $$("#insp-mode button").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      $$("#insp-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      agentLine();
    }),
  );
  $$("#stage-tabs button").forEach((b) => b.addEventListener("click", () => showPane(b.dataset.pane)));
  $("#insp-go").addEventListener("click", () => start());
  $("#cta-inspect").addEventListener("click", () => setTimeout(() => start(), 1000)); // after the travel lands
  $("#insp-prev").addEventListener("click", () => switchBuilding(-1));
  $("#insp-next").addEventListener("click", () => switchBuilding(1));
  on((type) => {
    if (type === "select") reset();
    if (type === "agent") agentLine();
  });
  reset();
}

/* ---------------------------------------------------------------- header and status */

function reset() {
  cancel();
  const s = store.selected;
  if (!s) return;
  findings = null;
  flood = null;
  $("#insp-kicker").textContent = `Finalist #${s.rank} of ${store.sites.summary.funnel.finalists}`;
  $("#insp-rank").textContent = s.rank;
  $("#insp-title").textContent = s.name;
  $("#insp-sub").textContent = `${s.address} · ${s.use} · ${sqft(s.building.gross_sf || s.building_sf)}`;
  $("#insp-steps").replaceChildren(h("li", { class: "steps-empty" }, "Press ", h("strong", {}, "Run inspection"), ". Each step brings up its evidence."));
  $("#insp-verdict").hidden = true;
  $("#insp-go").replaceChildren("Run inspection ", h("span", { class: "arrow", "aria-hidden": "true" }, "→"));
  renderRecord();
  renderScan();
  renderAerial();
  renderGrid();
  showPane("record");
  agentLine();
}

function agentMode() {
  const a = store.agent;
  if (mode === "rules") return "rules";
  if (a.available) return "live";
  if (a.cached.includes(store.selected?.id)) return "replay";
  return "rules";
}

function agentLine(text) {
  const a = store.agent;
  const m = agentMode();
  const el = $("#insp-agent");
  if (text) {
    el.replaceChildren(text);
    return;
  }
  el.replaceChildren(...(
    m === "live" ? [h("i", { class: "dot on" }), `Claude agent ready (${a.model}). It decides which evidence to pull and reads the photos itself.`]
    : m === "replay" ? [h("i", { class: "dot sim" }), "Claude credentials aren't set on this laptop, so the agent will replay its last saved run for this building."]
    : mode === "rules" ? [h("i", { class: "dot" }), "Rules only: the same checks, in a fixed order, with no model."]
    : [h("i", { class: "dot" }), `Claude agent unavailable (${a.reason}). Running the rules-only inspection instead.`]
  ));
}

/* ---------------------------------------------------------------- running */

function cancel() {
  run += 1;
  if (source) {
    source.close();
    source = null;
  }
}

function start() {
  if (!store.selected) return;
  cancel();
  findings = null;
  const id = run;
  $("#insp-steps").replaceChildren();
  $("#insp-verdict").hidden = true;
  $("#insp-go").replaceChildren("Run again ", h("span", { class: "arrow", "aria-hidden": "true" }, "↻"));
  renderObservations();
  const m = agentMode();
  if (m === "rules") runRules(id);
  else runAgent(id, m);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRules(id) {
  agentLine(h("span", {}, h("i", { class: "dot" }), mode === "rules" ? "Rules only: fixed checks, no model." : `Claude agent unavailable (${store.agent.reason}). Rules-only inspection.`));
  for (const name of RULE_ORDER) {
    if (id !== run) return;
    const li = addStep(name);
    if (STEPS[name].pane) showPane(STEPS[name].pane);
    if (name === "look_from_above") {
      setTimeout(() => flyover($("#pane-aerial .aerial-box")), 120);
      await sleep(2700); // let the drone finish its circle before the next pane
    }
    if (name === "check_flood_and_neighbors") await femaLive();
    await sleep(PACE_MS);
    if (id !== run) return;
    doneStep(li, rulesSummary(name));
  }
  finish("rules");
}

function runAgent(id, m) {
  const s = store.selected;
  const q = new URLSearchParams({ mode: m, pod: store.pod, flex: store.flex });
  const es = new EventSource(`${store.base}/api/agent/inspect/${s.id}?${q}`);
  source = es;
  const open = new Map(); // tool name -> step element
  let finished = false;
  agentLine(h("span", {}, h("i", { class: `dot ${m === "live" ? "live" : "sim"}` }), m === "live" ? `Claude (${store.agent.model}) is inspecting…` : "Replaying the agent's last saved run…"));
  const stop = () => {
    finished = true;
    es.close();
    if (source === es) source = null;
  };
  es.onmessage = (msg) => {
    if (id !== run) return stop();
    const ev = JSON.parse(msg.data);
    if (ev.type === "tool") {
      open.set(ev.name, addStep(ev.name, ev.title));
      if (STEPS[ev.name]?.pane) showPaneSoon(STEPS[ev.name].pane);
      if (ev.name === "look_from_above") {
        holdUntil = performance.now() + 3000; // the next pane waits for the drone
        setTimeout(() => flyover($("#pane-aerial .aerial-box")), 120);
      }
    } else if (ev.type === "tool_done") {
      const li = open.get(ev.name) || addStep(ev.name);
      doneStep(li, ev.summary);
    } else if (ev.type === "text") {
      $("#insp-steps").append(h("li", { class: "step note" }, h("span", { class: "s-icon", html: ICON.info }), h("p", { class: "s-note" }, ev.text)));
    } else if (ev.type === "passport") {
      findings = ev;
      renderObservations();
    } else if (ev.type === "error") {
      stop();
      agentLine(h("span", { class: "err" }, h("i", { class: "dot" }), `${ev.message} Falling back to the rules-only inspection.`));
      setTimeout(() => id === run && runRules(id), 900);
    } else if (ev.type === "done") {
      stop();
      const when = ev.replay ? ` · replay of a run saved ${new Date(ev.saved_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
      agentLine(h("span", {}, h("i", { class: `dot ${ev.replay ? "sim" : "on"}` }), `Inspected by Claude (${ev.model}) in ${(ev.ms / 1000).toFixed(0)} s${when}.`));
      finish(ev.replay ? "replay" : "agent", ev);
    }
  };
  es.onerror = () => {
    if (finished || id !== run) return;
    stop();
    agentLine(h("span", { class: "err" }, h("i", { class: "dot" }), "Lost the agent's stream. Falling back to the rules-only inspection."));
    runRules(id);
  };
}

function addStep(name, title) {
  const st = STEPS[name] || { title: title || name, label: "Estimated" };
  const li = h("li", { class: "step run" },
    h("span", { class: "s-icon", html: ICON.spinner }),
    h("div", { class: "s-body" }, h("p", { class: "s-title" }, title || st.title), h("p", { class: "s-sum" }, "…")),
    chip(st.label));
  $("#insp-steps").append(li);
  li.scrollIntoView({ block: "nearest" });
  return li;
}

function doneStep(li, summary) {
  li.classList.remove("run");
  li.classList.add("ok");
  li.querySelector(".s-icon").innerHTML = ICON.check;
  li.querySelector(".s-sum").textContent = summary;
}

function finish(how, ev) {
  const s = store.selected;
  renderVerdict(how);
  save("inspection", s.id, {
    at: new Date().toISOString(), how, model: ev?.model || null, pod: store.pod, flex: store.flex,
    headline: findings?.headline || rulesHeadline(s),
    observations: findings?.observations || [], conversion_items: findings?.conversion_items || [], open_questions: findings?.open_questions || [],
    flood_live: flood,
  });
  emit("inspected", s);
}

/* ---------------------------------------------------------------- rules-mode summaries (mirror bridge/agent.py) */

function rulesSummary(name) {
  const s = store.selected, b = s.building, p = s.power, sc = s.screen;
  if (name === "get_building_record") {
    const bits = [s.use.toLowerCase(), `${fmt.int(b.gross_sf || s.building_sf)} sq ft`, b.year_built && `built ${b.year_built}`,
      b.clear_ft && `${b.clear_ft} ft clear`, p.amps ? `${fmt.int(p.amps)} A service` : p.heavy ? "heavy power" : null].filter(Boolean).join(", ");
    return bits.charAt(0).toUpperCase() + bits.slice(1);
  }
  if (name === "walk_3d_scan") {
    const n = (s.media?.scans || []).reduce((a, x) => a + x.images.length, 0);
    return n ? `${n} snapshots from ${s.media.scans.length} public Matterport scan${s.media.scans.length > 1 ? "s" : ""}` : "No public 3D scan for this building";
  }
  if (name === "look_from_above") return s.media?.aerial ? `Aerial photo, ${s.media.aerial.side_m} m across` : "No aerial photo cached";
  if (name === "check_flood_and_neighbors") {
    const z = flood?.zone || sc.flood?.zone || "?";
    return `FEMA zone ${z}${flood ? " (checked live)" : ""}; nearest homes ${sc.homes_km != null ? fmt.dist(sc.homes_km) : "beyond 3 km"}`;
  }
  if (name === "size_power") {
    const have = (p.service_kva || 0) / 1000;
    return `${store.pod} MW needed vs ${p.service_kva ? `≈${have.toFixed(1)} MVA` : "unrecorded service"} today; 345 kV line ${fmt.dist(sc.line345_km)}`;
  }
  if (name === "plan_pauses") {
    const pb = store.pauses, sm = pb.summary;
    const saved = store.pod * 1000 * store.flex * pb.tcrf.per_kw_year;
    return `${sm.pause_hours} h in ${pb.year} (${fmt.pct(sm.share_of_year, 1)}), all ${pb.peaks_caught} summer peaks; ≈$${fmt.int(saved / 1000)}K/yr`;
  }
  return "";
}

async function femaLive() {
  const s = store.selected;
  const q = new URLSearchParams({ geometry: `${s.lon},${s.lat}`, geometryType: "esriGeometryPoint", inSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", returnGeometry: "false", f: "json" });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const j = await (await fetch(`${FEMA}?${q}`, { signal: ctl.signal })).json();
    const a = (j.features || []).map((f) => f.attributes).sort((x, y) => (x.SFHA_TF === "T" ? -1 : 1) - (y.SFHA_TF === "T" ? -1 : 1))[0];
    if (a) flood = { zone: a.FLD_ZONE, subtype: a.ZONE_SUBTY, sfha: a.SFHA_TF, at: new Date().toISOString() };
  } catch {
    flood = null;
  } finally {
    clearTimeout(t);
  }
  paintFlood();
}

/* ---------------------------------------------------------------- panes */

let holdUntil = 0;
function showPaneSoon(name) {
  const wait = holdUntil - performance.now();
  if (wait > 0) setTimeout(() => showPane(name), wait);
  else showPane(name);
}

function showPane(name) {
  $$("#stage-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pane === name)));
  $$(".stage .pane").forEach((p) => {
    const show = p.dataset.pane === name;
    if (show && p.hidden) {
      p.classList.remove("pane-in");
      void p.offsetWidth; // restart the entrance animation
      p.classList.add("pane-in");
    }
    p.hidden = !show;
  });
  emit("pane", name);
  if (name === "aerial") drawAerial();
  if (name === "grid") drawGridMap();
}

function renderRecord() {
  const s = store.selected, b = s.building, p = s.power;
  const facts = [
    ["Use", `${s.use}${b.year_built ? `, built ${b.year_built}` : ""}`],
    ["Building", `${fmt.int(b.gross_sf || s.building_sf)} sq ft${b.stories ? `, ${b.stories} stor${b.stories > 1 ? "ies" : "y"}` : ""}`],
    ["Lot", s.lot_acres ? `${s.lot_acres.toFixed(1)} acres` : "—"],
    ["Construction", [b.construction, b.class && `Class ${b.class}`].filter(Boolean).join(", ") || "—"],
    ["Electrical", [p.heavy ? "Heavy power" : p.heavy === false ? "Standard" : null, p.amps && `${fmt.int(p.amps)} A`, p.volts && `${p.volts} V`, p.phases && `${p.phases}-phase`].filter(Boolean).join(" · ") || "Not recorded"],
    ["Zoning", s.zoning || "Not recorded"],
    ["Listed", s.listing.active.length ? s.listing.active.join(" and ") : "Not listed now"],
    ["CoStar ID", String(s.id)],
  ];
  const src = h("span", {}, "CoStar Data Extract");
  auditable(src, () => ({
    title: s.name, value: `CoStar property ${s.id}`, label: "Sourced", source: store.sites.source,
    retrieved: `Read ${new Date(store.sites.generated_at).toLocaleString("en-US")}`,
    formula: `Fields from ${s.source.file}: building size, structural (clear height, slab, columns), sprinklers, docks, electric service, zoning, construction events, listings.`,
    note: "CoStar's data stays on the demo laptop; it is not published with the site.",
  }));
  $("#pane-record").replaceChildren(
    h("div", { class: "rec" },
      h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      h("div", {},
        h("p", { class: "kicker" }, "Readiness checklist"),
        h("ul", { class: "checklist" }, s.ready.items.map(checkItem)),
        h("p", { class: "g-note" }, chip("Sourced"), " ", src))),
  );
}

function checkItem(i) {
  const st = STATUS[i.status];
  return h("li", { class: `ck ck-${i.status}`, title: i.note || "" },
    h("span", { class: "ck-icon", html: ICON[st.icon] }),
    h("span", { class: "ck-name" }, i.name),
    h("span", { class: "ck-val" }, i.value),
    h("span", { class: "ck-word" }, st.word));
}

function renderScan() {
  const s = store.selected;
  const scans = s.media?.scans || [];
  // interior photos first: they show the shell; the dollhouse view can be a partial scan
  const imgs = scans.flatMap((sc) => sc.images.map((im) => ({ ...im, model: sc.model, name: sc.name })))
    .sort((a, b) => (a.kind === "photo" ? 0 : 1) - (b.kind === "photo" ? 0 : 1));
  const box = $("#pane-scan");
  if (!imgs.length) {
    box.replaceChildren(h("div", { class: "pane-empty" }, h("p", {}, h("strong", {}, "No public 3D scan for this building.")),
      h("p", { class: "fine" }, s.matterport.length ? "CoStar lists a scan, but its snapshots aren't cached on this laptop. Run bridge/costar_sites.py --media." : "CoStar lists no Matterport model for it.")));
    return;
  }
  const main = h("img", { class: "scan-main", src: imgs[0].file, alt: `${imgs[0].label} from the 3D scan of ${s.name}` });
  const frameBox = h("div", { class: "scan-frame" }, main);
  const thumbs = h("div", { class: "scan-thumbs" }, imgs.map((im, i) =>
    h("button", { type: "button", class: `thumb${i === 0 ? " on" : ""}`, title: im.label, onclick: (e) => {
      frameBox.replaceChildren(main);
      main.src = im.file;
      main.alt = `${im.label} from the 3D scan of ${s.name}`;
      $$(".scan-thumbs .thumb", box).forEach((t) => t.classList.toggle("on", t === e.currentTarget));
    } }, h("img", { src: im.file, alt: "", loading: "lazy" }))));
  const tour = h("button", { type: "button", class: "btn-small", onclick: () => {
    frameBox.replaceChildren(h("iframe", { src: scans[0].embed, title: `Matterport 3D tour of ${s.name}`, allow: "fullscreen; xr-spatial-tracking", allowfullscreen: true }));
  } }, "Open the live 3D tour");
  box.replaceChildren(
    frameBox,
    h("div", { class: "scan-bar" }, thumbs, tour),
    h("p", { class: "fine" }, `Public Matterport scan${scans.length > 1 ? "s" : ""} on CoStar's list · ${scans.map((x) => `“${x.name}”, ${x.sweeps} scan positions`).join("; ")}. The live tour loads Matterport's player and needs internet.`),
    h("div", { class: "obs", "data-src": "scan" }),
  );
}

function renderAerial() {
  const s = store.selected;
  const box = $("#pane-aerial");
  if (aerial) {
    aerial.remove();
    aerial = null;
  }
  box.replaceChildren(
    h("div", { class: "aerial-box" }, h("div", { class: "aerial-map", id: "aerial-map", "aria-label": `Aerial photo of ${s.name}` })),
    h("div", { class: "legend" },
      h("span", { class: "item" }, h("span", { class: "sw-ring" }), "500 m from the building (homes limit)"),
      h("span", { class: "item" }, h("span", { class: "sw-dot", style: { background: "var(--homes)" } }), "Nearest mapped homes"),
      chip("Sourced"), h("span", { class: "fine" }, s.media?.aerial ? `${s.media.aerial.source}, retrieved ${new Date(s.media.aerial.retrieved_at).toLocaleDateString("en-US")}` : "Esri World Imagery")),
    h("div", { class: "obs", "data-src": "aerial" }),
  );
}

function drawAerial() {
  const s = store.selected;
  const el = $("#aerial-map");
  if (!el) return;
  if (aerial) {
    aerial.invalidateSize();
    return;
  }
  aerial = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([s.lat, s.lon], 16);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagery &copy; Esri and its partners",
  }).addTo(aerial);
  if (s.media?.aerial) L.imageOverlay(s.media.aerial.file, s.media.aerial.bounds, { interactive: false }).addTo(aerial); // works offline
  L.circle([s.lat, s.lon], { radius: 500, color: "#fff", weight: 2, dashArray: "6 6", fill: false }).addTo(aerial);
  L.circleMarker([s.lat, s.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#eb6834", fillOpacity: 1 }).bindTooltip(s.name, { className: "sub-tip" }).addTo(aerial);
  const hp = s.screen.homes_point;
  if (hp) {
    L.polyline([[s.lat, s.lon], hp], { color: "#e87ba4", weight: 2, dashArray: "4 5" }).addTo(aerial);
    L.circleMarker(hp, { radius: 6, color: "#fff", weight: 2, fillColor: "#e87ba4", fillOpacity: 1 }).bindTooltip(`Nearest mapped homes, ${fmt.dist(s.screen.homes_km)}`, { className: "sub-tip" }).addTo(aerial);
  }
  aerial.on("click focus", () => aerial.scrollWheelZoom.enable());
  aerial.on("mouseout", () => aerial.scrollWheelZoom.disable());
  setTimeout(() => aerial?.invalidateSize(), 50);
}

function renderGrid() {
  const s = store.selected, sc = s.screen;
  const f = flood || sc.flood || {};
  const fstat = sc.flood_status;
  const sub = sc.substation || {};
  const have = s.power.service_kva;
  const zone = h("dd", { id: "gf-flood" });
  auditable(zone, () => ({
    title: "FEMA flood zone", value: `Zone ${f.zone}${f.subtype ? ` (${f.subtype.toLowerCase()})` : ""}`, label: "Sourced",
    source: "FEMA National Flood Hazard Layer, layer 28 (flood hazard zones)", url: FEMA,
    retrieved: flood ? new Date(flood.at).toLocaleString("en-US") : `With the CoStar data, ${new Date(store.sites.generated_at).toLocaleDateString("en-US")}`,
    formula: "Point query at the building's CoStar coordinates. Zones starting with A or V (the 100-year floodplain) fail.",
  }));
  const homes = h("dd", {}, sc.homes_km != null ? fmt.dist(sc.homes_km) : "None within 3 km");
  auditable(homes, () => ({
    title: "Distance to the nearest homes", value: homes.textContent, label: "Estimated",
    source: "OpenStreetMap landuse=residential outlines, rasterized to ~110 m cells", retrieved: "Saved snapshot (web/data/houston-grid.json)",
    formula: "Straight-line distance from the building to the nearest residential cell edge. Fails within 500 m (team assumption).",
    note: "OpenStreetMap misses some neighborhoods: confirm on the aerial photo.",
  }));
  $("#pane-grid").replaceChildren(
    h("div", { class: "grid-pane" },
      h("div", { class: "grid-map", id: "grid-map", "aria-label": "Map of the building, nearby homes and the high-voltage grid" }),
      h("dl", { class: "grid-facts" },
        h("div", { class: `gf gf-${fstat}` }, h("dt", {}, "Flood"), zone),
        h("div", { class: `gf gf-${sc.homes_status}` }, h("dt", {}, "Nearest homes"), homes),
        h("div", { class: "gf" }, h("dt", {}, "345 kV line"), h("dd", {}, sc.line345_km != null ? fmt.dist(sc.line345_km) : "—")),
        h("div", { class: "gf" }, h("dt", {}, "Substation"), h("dd", {}, sub.km != null ? fmt.dist(sub.km) : "—", h("small", {}, sub.kv ? ` · ${sub.kv} kV${sub.name ? `, ${sub.name}` : ""}` : ""))),
        h("div", { class: "gf" }, h("dt", {}, "Service today"), h("dd", {}, have ? `≈${mva(have)}` : s.power.heavy ? "Heavy power" : "—", h("small", {}, s.power.volts_assumed && have ? " · 480 V assumed" : ""))),
      ),
    ),
    h("p", { class: "fine" }, "Distance to the grid is not capacity: only CenterPoint's study says what it can deliver, and when."),
    h("div", { class: "obs", "data-src": "grid" }),
  );
  paintFlood();
  if (gridMap) {
    gridMap.remove();
    gridMap = null;
  }
  if (!$("#pane-grid").hidden) drawGridMap();
}

function paintFlood() {
  const el = $("#gf-flood");
  if (!el) return;
  const f = flood || store.selected.screen.flood || {};
  el.replaceChildren(`Zone ${f.zone || "?"}`, h("small", {}, flood ? " · checked live just now" : " · when the data was built"));
}

async function drawGridMap() {
  const s = store.selected;
  const el = $("#grid-map");
  if (!el) return;
  if (gridMap) {
    gridMap.invalidateSize();
    return;
  }
  gridMap = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([s.lat, s.lon], 13);
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
  L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: "Tiles &copy; Esri · Grid &copy; OpenStreetMap contributors" }).addTo(gridMap);
  const pts = [[s.lat, s.lon]];
  try {
    gridData = gridData || (await (await fetch("data/houston-grid.json")).json());
    const box = { s: s.lat - 0.09, n: s.lat + 0.09, w: s.lon - 0.11, e: s.lon + 0.11 };
    const near = (flat) => { for (let i = 0; i < flat.length; i += 2) if (flat[i + 1] > box.s && flat[i + 1] < box.n && flat[i] > box.w && flat[i] < box.e) return true; return false; };
    for (const [kv, color, w] of [["138", "#86b6ef", 1.5], ["345", "#1c5cab", 3]]) {
      for (const flat of gridData.lines[kv]) {
        if (!near(flat)) continue;
        const ll = [];
        for (let i = 0; i < flat.length; i += 2) ll.push([flat[i + 1], flat[i]]);
        L.polyline(ll, { color, weight: w, opacity: 0.9, interactive: false }).addTo(gridMap);
      }
    }
    for (const [lon, lat, kv, name] of gridData.substations) {
      if (lat > box.s && lat < box.n && lon > box.w && lon < box.e && (kv || 0) >= 69)
        L.circleMarker([lat, lon], { radius: 4, color: "#1c5cab", weight: 1.5, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(`${name || "Substation"}${kv ? ` · ${kv} kV` : ""}`, { className: "sub-tip" }).addTo(gridMap);
    }
  } catch {
    /* grid layer is optional */
  }
  L.circle([s.lat, s.lon], { radius: 500, color: "#e87ba4", weight: 1.5, dashArray: "5 5", fillOpacity: 0.04 }).addTo(gridMap);
  L.circleMarker([s.lat, s.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#eb6834", fillOpacity: 1 }).bindTooltip(s.name, { className: "sub-tip" }).addTo(gridMap);
  const sc = s.screen;
  if (sc.line345_point) {
    L.polyline([[s.lat, s.lon], sc.line345_point], { color: "#1c5cab", weight: 2, dashArray: "3 5" }).addTo(gridMap);
    pts.push(sc.line345_point);
  }
  if (sc.substation?.lat) {
    L.polyline([[s.lat, s.lon], [sc.substation.lat, sc.substation.lon]], { color: "#52514e", weight: 1.5, dashArray: "2 5" }).addTo(gridMap);
    pts.push([sc.substation.lat, sc.substation.lon]);
  }
  if (sc.homes_point) {
    L.circleMarker(sc.homes_point, { radius: 5, color: "#fff", weight: 1.5, fillColor: "#e87ba4", fillOpacity: 1 }).bindTooltip(`Nearest mapped homes, ${fmt.dist(sc.homes_km)}`, { className: "sub-tip" }).addTo(gridMap);
    pts.push(sc.homes_point);
  }
  gridMap.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 15, animate: false });
  setTimeout(() => gridMap?.invalidateSize(), 50);
}

/* ---------------------------------------------------------------- agent findings */

const OBS_PANE = { record: "record", scan: "scan", aerial: "aerial", flood: "grid", grid: "grid", pauses: "grid" };

function renderObservations() {
  $$(".obs").forEach((box) => {
    const pane = box.dataset.src;
    const items = (findings?.observations || []).filter((o) => OBS_PANE[o.source] === pane);
    box.replaceChildren(...(items.length ? [
      h("p", { class: "obs-head" }, h("span", { class: "obs-who" }, "Claude saw"), chip("Estimated")),
      h("ul", {}, items.map((o, i) => h("li", { style: { "--i": i } }, o.text))),
    ] : []));
  });
}

function renderVerdict(how) {
  const s = store.selected;
  const v = VERDICT[s.ready.verdict];
  const counts = s.ready.items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] || 0) + 1 }), {});
  const headline = findings?.headline || rulesHeadline(s);
  const extra = findings ? [
    findings.conversion_items?.length ? h("div", { class: "vb-list" }, h("p", { class: "kicker" }, "Conversion work"), h("ul", {}, findings.conversion_items.map((t) => h("li", {}, t)))) : null,
    findings.open_questions?.length ? h("div", { class: "vb-list" }, h("p", { class: "kicker" }, "Verify on site"), h("ul", {}, findings.open_questions.map((t) => h("li", {}, t)))) : null,
  ] : [];
  const bar = $("#insp-verdict");
  bar.replaceChildren(
    h("div", { class: "vb-main" },
      h("span", { class: `verdict-badge stamp ${v.cls}` }, v.text),
      h("p", { class: "vb-head" }, headline),
      h("p", { class: "vb-counts" },
        `${counts.pass || 0} pass · ${counts.work || 0} conversion work · ${counts.unknown || 0} to verify · ${counts.fail || 0} fail`,
        h("span", { class: "fine" }, how === "rules" ? " · fixed rules" : findings ? " · findings by Claude, verdict by the rules" : "")),
      h("div", { class: "vb-actions" },
        h("a", { class: "btn", href: `passport.html?id=${s.id}`, target: "_blank", rel: "noopener" }, "Open the passport ", h("span", { class: "arrow", "aria-hidden": "true" }, "→")),
        h("a", { class: "btn btn-quiet", href: "#power" }, "Close the power gap"))),
    ...extra.filter(Boolean),
  );
  bar.hidden = false;
}
