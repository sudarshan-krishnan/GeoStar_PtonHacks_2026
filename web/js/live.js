// Control room: measured watts from the two workload machines, the grid emergency
// switch, and Grid Passport records of each pause.

import { $, h, fmt, localTime, localDate, duration, chip, onResize } from "./util.js";
import { s, lin, niceDomain, frame, yGrid, hoverLayer, showTip, tipRows } from "./charts.js";
import { auditable } from "./audit.js";
import { findBridge, getJSON } from "./data.js";

const WINDOW_S = 120;
const COLORS = { flat: "#898781", ss: "#f0efec" };

let base = null; // bridge URL ("" = same origin) or null
let grid = null; // last /api/grid
let lastEventId; // undefined until the first grid state arrives

export function initLive(initialBase) {
  base = initialBase;
  $("#ev-btn").addEventListener("click", toggleEmergency);
  onResize($("#lv-chart"), drawChart);
  renderOffline();
  loop();
}

const api = (path) => getJSON(`${base}${path}`, 4000);
async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------------------------------------------------------------- loop */

async function loop() {
  try {
    if (base === null) base = await findBridge();
    if (base !== null) {
      grid = await api("/api/grid");
      renderGrid();
    } else {
      renderOffline();
    }
  } catch {
    base = null;
    renderOffline();
  } finally {
    setTimeout(loop, base === null ? 4000 : 1000);
  }
}

/* ---------------------------------------------------------------- status pill */

function renderPill() {
  const machines = grid ? Object.values(grid.machines).filter(Boolean) : [];
  let cls = "", text = "Hardware offline", src = "Offline: start the bridge on the demo laptop";
  if (base !== null && grid) {
    const real = machines.filter((x) => !x.simulated && !x.stale).length;
    if (real) [cls, text, src] = ["on", "Hardware live", `Live: ${real} real machine${real > 1 ? "s" : ""} reporting${machines.length > real ? ", the other simulated" : ""}`];
    else if (grid.mock) [cls, text, src] = ["sim", "Hardware simulated", "Bridge running with simulated machines"];
    else [cls, text, src] = ["", "Bridge up", "Bridge running; no machines reporting yet"];
  }
  const pill = $("#pill-hw");
  pill.querySelector(".dot").className = `dot ${cls}`;
  pill.querySelector("span").textContent = text;
  $("#src-hw").innerHTML = `<i class="dot ${cls}"></i>${src}`;
}

/* ---------------------------------------------------------------- offline */

function renderOffline() {
  grid = null;
  $("#prove")?.classList.remove("alert");
  $("#ev-state").replaceChildren("Hardware offline");
  $("#ev-btn").disabled = true;
  for (const id of ["lv-base", "lv-ss", "lv-cut"]) $(`#${id}`).textContent = "—";
  $("#lv-base-sub").textContent = "No readings";
  $("#lv-ss-sub").textContent = "No readings";
  $("#lv-cut-sub").textContent = "Trigger an event to measure";
  setLabel("Offline", "");
  const note = $("#lv-offline");
  note.hidden = false;
  note.innerHTML = "The live demo runs from our demo laptop. To run it yourself: <code>python bridge/server.py --mock</code>, then reload this page.";
  drawChart();
  renderPill();
}

function setLabel(text, cls) {
  const el = $("#lv-label");
  el.textContent = text;
  el.className = `chip ${cls}`;
}

/* ---------------------------------------------------------------- live grid */

function renderGrid() {
  const g = grid;
  const m = g.machines;
  const any = m.baseline || m.optimized;
  const sims = [m.baseline, m.optimized].filter(Boolean).map((x) => !!x.simulated);
  const mixed = sims.includes(true) && sims.includes(false);
  setLabel(mixed ? "SiteStar measured · flat simulated" : g.mock ? "Simulated" : any ? "Measured" : "Waiting",
    mixed ? "chip-measured" : g.mock ? "chip-simulated" : any ? "chip-measured" : "");

  const note = $("#lv-offline");
  note.hidden = !!any;
  if (!any) note.innerHTML = "Bridge connected. Waiting for the workload machines to report watts to <code>POST /api/grid/telemetry</code>.";

  // emergency control (the whole section glows while a grid event runs)
  $("#prove")?.classList.toggle("alert", !!g.emergency);
  const btn = $("#ev-btn");
  btn.disabled = false;
  btn.classList.toggle("on", g.emergency);
  btn.textContent = g.emergency ? "End grid emergency" : "Trigger grid emergency";
  $("#ev-state").replaceChildren(
    ...(g.emergency
      ? [h("i", { class: "dot live" }), `Grid emergency · ${duration(g.now - g.emergency_since)}`]
      : [h("i", { class: "dot on" }), "Normal operation"]),
  );

  machineStat("lv-base", m.baseline, "Flat machine");
  machineStat("lv-ss", m.optimized, "SiteStar machine");
  renderCut();
  drawChart();
  renderPassport();
  renderPill();
}

function machineStat(id, mm, name) {
  const el = $(`#${id}`);
  const sub = $(`#${id}-sub`);
  if (!mm) {
    el.textContent = "—";
    sub.textContent = "No readings yet";
    return;
  }
  el.replaceChildren(h("span", {}, fmt.watts(mm.watts), h("small", {}, "W")));
  const bits = [];
  if (mm.progress != null) bits.push(mm.done ? "Job finished" : `Job ${Math.round(mm.progress * 100)}%`);
  if (mm.stale) bits.push("no update for 5 s+");
  sub.textContent = bits.join(" · ") || "Reporting";
  auditable(el, () => ({
    title: `${name}: power draw`,
    value: `${fmt.watts(mm.watts)} W`,
    label: mm.simulated ? "Simulated" : "Measured",
    source: mm.simulated ? "Bridge test mode (no hardware)" : `Workload controller on the ${name.toLowerCase()} (bridge/controller.py)`,
    retrieved: `${localTime(mm.updated)} (pushed to the bridge)`,
    formula: mm.measure === "wall" ? "Wall-plug power meter reading."
      : mm.measure === "chip" ? "The machine's own power sensor (chip level)."
      : mm.measure === "system" ? "The laptop's own power telemetry: whole-system load reported by macOS (AppleSmartBattery → SystemLoad), averaged over each second."
      : "Reported watts; measurement point not stated.",
    note: mm.measure === "chip" ? "Chip-level readings can leave out part of the wall-plug draw." : undefined,
  }));
}

function renderCut() {
  const g = grid;
  const el = $("#lv-cut");
  const sub = $("#lv-cut-sub");
  const cur = g.machines.optimized?.watts;
  const before = g.active?.before?.optimized;
  if (g.emergency && before && cur != null) {
    const change = cur / before - 1;
    el.textContent = fmt.signedPct(change);
    sub.textContent = `${fmt.watts(before)} → ${fmt.watts(cur)} W, live`;
    auditable(el, () => ({
      title: "Power change during this event",
      value: fmt.signedPct(change, 1),
      label: g.mock ? "Simulated" : "Measured",
      source: "SiteStar machine readings",
      formula: "change = current watts ÷ average watts in the 10 s before the event − 1",
      inputs: [["Before", `${fmt.watts(before)} W`], ["Now", `${fmt.watts(cur)} W`]],
    }));
    return;
  }
  const ev = (g.events || [])[0];
  if (ev && ev.machines.optimized.change_pct != null) {
    el.textContent = `${ev.machines.optimized.change_pct > 0 ? "+" : "−"}${Math.abs(ev.machines.optimized.change_pct).toFixed(0)}%`;
    sub.textContent = `Event #${ev.id}, average over ${duration(ev.duration_s)}`;
    auditable(el, () => passportInfo(ev, "change"));
    return;
  }
  el.textContent = "—";
  sub.textContent = "Trigger an event to measure";
}

function drawChart() {
  const el = $("#lv-chart");
  const f = frame(el, el.clientWidth < 560 ? 200 : 240, { top: 18, right: 14, bottom: 24, left: 44 });
  const now = grid?.now ?? Date.now() / 1000;
  const t0 = now - WINDOW_S;
  const series = ["baseline", "optimized"].map((k) => ({
    key: k,
    color: k === "baseline" ? COLORS.flat : COLORS.ss,
    name: k === "baseline" ? "Flat machine" : "SiteStar machine",
    pts: (grid?.machines[k]?.history || []).filter(([t]) => t >= t0),
  }));
  const maxW = Math.max(10, ...series.flatMap((sr) => sr.pts.map(([, w]) => w)));
  const dom = niceDomain(0, maxW * 1.1, 4);
  const x = lin(t0, now, f.x0, f.x1);
  const y = lin(0, dom.hi, f.y1, f.y0);

  // emergency bands
  const spans = [];
  for (const ev of grid?.events || []) if (ev.ended > t0) spans.push([Math.max(ev.started, t0), ev.ended]);
  if (grid?.emergency && grid.emergency_since) spans.push([Math.max(grid.emergency_since, t0), now]);
  spans.forEach(([a, b], i) => {
    s("rect", { class: "band", x: x(a), y: f.y0, width: Math.max(x(b) - x(a), 1), height: f.y1 - f.y0 }, f.svg);
    if (i === spans.length - 1 && x(b) - x(a) > 70) s("text", { class: "band-label halo", x: x(a) + 6, y: f.y0 + 13, text: "Grid emergency" }, f.svg);
  });

  yGrid(f.svg, f, dom.ticks, y, (v) => `${v} W`);
  s("line", { class: "baseline", x1: f.x0, x2: f.x1, y1: Math.round(y(0)) + 0.5, y2: Math.round(y(0)) + 0.5 }, f.svg);
  for (const [sec, label] of [[WINDOW_S, "2 min ago"], [60, "1 min ago"], [0, "now"]]) {
    s("text", { x: x(now - sec), y: f.height - 6, "text-anchor": sec === WINDOW_S ? "start" : sec === 0 ? "end" : "middle", text: label }, f.svg);
  }

  if (!series.some((sr) => sr.pts.length)) {
    s("text", { x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2, "text-anchor": "middle", text: base === null ? "Hardware offline" : "Waiting for readings" }, f.svg);
    return;
  }
  for (const sr of series) {
    if (sr.pts.length < 2) continue;
    const d = sr.pts.map(([t, w], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(w).toFixed(1)}`).join("");
    s("path", { d, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, f.svg);
    const [lt, lw] = sr.pts[sr.pts.length - 1];
    s("circle", { cx: x(lt), cy: y(lw), r: 4, fill: sr.color, stroke: "#1a1a19", "stroke-width": 2 }, f.svg);
  }
  const ref = series.find((sr) => sr.pts.length)?.pts || [];
  hoverLayer(f, ref.map(([t]) => x(t)), (i, e) => {
    const t = ref[i][0];
    const rows = series.map((sr) => {
      const near = sr.pts.reduce((best, p) => (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t) ? p : best), null);
      return { color: sr.color, k: sr.name, v: near ? `${fmt.watts(near[1])} W` : "—" };
    });
    showTip(tipRows(localTime(t), rows), e.clientX, e.clientY);
  });
}

async function toggleEmergency() {
  const btn = $("#ev-btn");
  btn.disabled = true;
  try {
    await post("/api/grid/emergency", { active: !grid?.emergency, source: "web" });
    grid = await api("/api/grid");
    renderGrid();
  } catch (err) {
    $("#ev-state").textContent = `Couldn't reach the bridge: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------------- Grid Passport */

function passportInfo(ev, focus) {
  const ss = ev.machines.optimized;
  const bl = ev.machines.baseline;
  const label = ev.mock ? "Simulated" : "Measured";
  const common = {
    label,
    source: ev.mock ? "Bridge test mode (no hardware)" : "Workload controllers on both machines, via the SiteStar bridge",
    retrieved: `${localDate(ev.started)}, ${localTime(ev.started)} – ${localTime(ev.ended)}`,
  };
  if (focus === "response") {
    return {
      ...common,
      title: "Response time",
      value: ev.response_s != null ? duration(ev.response_s) : "No drop detected",
      formula: `time from the emergency signal to the ${ev.response_rule}`,
      note: "Includes the controller's polling interval.",
    };
  }
  return {
    ...common,
    title: "Power change during the event",
    value: `${ss.change_pct}% (SiteStar) vs ${bl.change_pct ?? "—"}% (flat)`,
    formula: "change = average watts during the event ÷ average watts in the 10 s before − 1",
    inputs: [
      ["SiteStar before", `${ss.before_w ?? "—"} W`], ["SiteStar during", `${ss.during_w ?? "—"} W`],
      ["Flat before", `${bl.before_w ?? "—"} W`], ["Flat during", `${bl.during_w ?? "—"} W`],
      ["Readings (SiteStar)", ss.samples],
    ],
    note: ss.measure === "chip" ? "Chip-level readings can leave out part of the wall-plug draw." : undefined,
  };
}

function renderPassport() {
  const box = $("#passport");
  const events = grid.events || [];
  const ev = events[0];
  if (lastEventId === undefined) lastEventId = ev ? ev.id : null; // records from before this page loaded
  const head = [h("p", { class: "kicker" }, "Grid Passport")];
  if (!ev) {
    box.replaceChildren(...head, h("h3", {}, "Verified curtailment record"),
      h("p", { class: "pp-empty" }, "After a grid event, the measured response is recorded here: how fast power fell, by how much, and whether the job still finished."));
    return;
  }
  const ss = ev.machines.optimized;
  const bl = ev.machines.baseline;
  const w = (v) => (v == null ? "—" : fmt.watts(v));
  const pct = (v) => (v == null ? "" : ` (${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%)`);
  const resp = h("dd", {}, ev.response_s != null ? duration(ev.response_s) : "no drop");
  const ssDd = h("dd", {}, `${w(ss.before_w)} → ${w(ss.during_w)} W`, h("small", {}, pct(ss.change_pct)));
  auditable(resp, () => passportInfo(ev, "response"));
  auditable(ssDd, () => passportInfo(ev, "change"));
  const job = ev.job.finished_at
    ? "Finished"
    : `Running${ev.job.progress_end != null ? `, ${Math.round(ev.job.progress_end * 100)}%` : ""}`;
  const measure = { wall: "Wall plug", chip: "Chip sensor", system: "Laptop telemetry" }[ss.measure] || "Not stated";
  const fresh = ev.id !== lastEventId && lastEventId !== undefined;
  if (ev.id !== lastEventId) {
    if (fresh) window.dispatchEvent(new CustomEvent("sitestar:passport", { detail: ev }));
    lastEventId = ev.id;
  }

  box.replaceChildren(
    ...head,
    h("h3", {}, `Event #${ev.id} `, chip(ev.mock ? "Simulated" : "Measured")),
    h("p", { class: "pp-id" }, `${localDate(ev.started)} · ${localTime(ev.started)} → ${localTime(ev.ended)} · from ${ev.source}`),
    h("dl", { class: "pp-grid" },
      h("div", {}, h("dt", {}, "Response time"), resp),
      h("div", {}, h("dt", {}, "Event length"), h("dd", {}, duration(ev.duration_s))),
      h("div", {}, h("dt", {}, "SiteStar machine"), ssDd),
      h("div", {}, h("dt", {}, "Flat machine"), h("dd", {}, `${w(bl.before_w)} → ${w(bl.during_w)} W`, h("small", {}, pct(bl.change_pct)))),
      h("div", {}, h("dt", {}, "Job"), h("dd", {}, job)),
      h("div", {}, h("dt", {}, "Measured at"), h("dd", {}, measure))),
    h("div", { class: "pp-actions" },
      h("button", { class: "btn-small", type: "button", onclick: () => download(ev) }, "Download record"),
      events.length > 1 ? h("span", { class: "fine", style: { alignSelf: "center" } }, `${events.length - 1} earlier event${events.length > 2 ? "s" : ""} on the bridge`) : null),
  );
  if (fresh) {
    box.classList.remove("pop");
    void box.offsetWidth; // restart the landing animation
    box.classList.add("pop");
  }
}

function download(ev) {
  const record = {
    record: "SiteStar Grid Passport",
    label: ev.mock ? "Simulated" : "Measured",
    generated_at: new Date().toISOString(),
    event: ev,
    methodology: {
      before: "average watts in the 10 seconds before the emergency signal",
      during: "average watts from the signal until the event ended",
      response: ev.response_rule,
    },
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
  const a = h("a", { href: url, download: `grid-passport-event-${ev.id}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
