// Prove section: the 2025 peak day the hardware replays, and attaching each Grid Passport
// record to the selected building's passport.

import { $, h, fmt, hourShort, onResize } from "./util.js";
import { s as svgEl, lin, niceDomain, frame, yGrid, hoverLayer, showTip, tipRows } from "./charts.js";
import { store, on, save, load } from "./store.js";
import { onceVisible, reduced } from "./anim.js";

let replayShown = reduced;

export function initProve() {
  onResize($("#replay"), drawReplay);
  drawReplay();
  onceVisible($("#replay"), () => {
    replayShown = true;
    $("#replay").classList.add("play");
  }, 0.45);
  window.addEventListener("sitestar:passport", (e) => attach(e.detail));
  on((type) => type === "select" && showAttach());
  showAttach();
}

function drawReplay() {
  const r = store.pauses.replay_day;
  const day = new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const pauses = r.pause_hours;
  const box = $("#replay");
  const chart = h("div", { class: "chart", role: "img", "aria-label": `ERCOT load on ${day}, with the hours the SiteStar site pauses` });
  box.replaceChildren(
    h("div", { class: "replay-head" },
      h("div", {}, h("p", { class: "kicker" }, "The day we replay"), h("h3", {}, day)),
      h("p", { class: "replay-facts" },
        h("span", {}, h("strong", {}, `${fmt.int(r.peak_mw)} MW`), ` ERCOT's highest load of ${store.pauses.year}, ${hourShort(r.peak_hour)}–${hourShort(r.peak_hour + 1)}`),
        h("span", {}, h("strong", {}, `${hourShort(pauses[0])}–${hourShort(pauses[pauses.length - 1] + 1)}`), " the SiteStar site pauses its flexible work"))),
    chart,
  );
  const f = frame(chart, 150, { top: 12, right: 12, bottom: 22, left: 46 });
  const dom = niceDomain(Math.min(...r.ercot) * 0.95, r.peak_mw * 1.02, 3);
  const x = lin(0, 23, f.x0, f.x1);
  const y = lin(dom.lo, dom.hi, f.y1, f.y0);
  const step = (f.x1 - f.x0) / 23;
  const band = svgEl("g", { class: "replay-band" }, f.svg);
  for (const hr of pauses) svgEl("rect", { x: x(hr) - step / 2, y: f.y0, width: step, height: f.y1 - f.y0, fill: "rgba(235,104,52,.28)" }, band);
  yGrid(f.svg, f, dom.ticks, y, (v) => `${Math.round(v / 1000)} GW`);
  for (const hr of [0, 6, 12, 18, 23]) svgEl("text", { x: x(hr), y: f.height - 5, "text-anchor": hr === 0 ? "start" : hr === 23 ? "end" : "middle", text: hourShort(hr) }, f.svg);
  const d = r.ercot.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const line = svgEl("path", { class: "replay-line", d, fill: "none", stroke: "#f0efec", "stroke-width": 2, "stroke-linejoin": "round", pathLength: 1000 }, f.svg);
  const peak = svgEl("g", { class: "replay-peak" }, f.svg);
  svgEl("circle", { cx: x(r.peak_hour), cy: y(r.peak_mw), r: 4.5, fill: "#eb6834", stroke: "#1a1a19", "stroke-width": 2 }, peak);
  svgEl("text", { class: "halo", x: x(r.peak_hour), y: y(r.peak_mw) - 10, "text-anchor": "middle", text: "Year's peak" }, peak);
  if (replayShown) box.classList.add("play", "instant");
  line.style.setProperty("--len", 1000);
  hoverLayer(f, r.ercot.map((_, i) => x(i)), (i, e) => {
    showTip(tipRows(`${hourShort(i)}–${hourShort(i + 1)}`, [
      { k: "ERCOT load", v: `${fmt.int(r.ercot[i])} MW` },
      { k: "Houston (COAST)", v: `${fmt.int(r.coast[i])} MW` },
      { k: pauses.includes(i) ? "SiteStar site pauses" : "Runs normally", v: "", color: pauses.includes(i) ? "#eb6834" : undefined },
    ]), e.clientX, e.clientY);
  });
}

function attach(ev) {
  const s = store.selected;
  if (!s) return;
  const ss = ev.machines.optimized;
  save("verified", s.id, {
    event: ev.id, at: new Date(ev.started * 1000).toISOString(), label: ev.mock ? "Simulated" : "Measured",
    response_s: ev.response_s, change_pct: ss.change_pct, before_w: ss.before_w, during_w: ss.during_w,
    flat_change_pct: ev.machines.baseline.change_pct, job_finished: !!ev.job.finished_at, measure: ss.measure, duration_s: ev.duration_s,
  });
  showAttach();
}

function showAttach() {
  const s = store.selected;
  const el = $("#attach");
  if (!s) return;
  const v = load("verified", s.id);
  el.replaceChildren(v
    ? h("span", {}, `✓ Pause record #${v.event} (${v.label.toLowerCase()}) is on the passport for ${s.name}. `, h("a", { href: `passport.html?id=${s.id}`, target: "_blank", rel: "noopener" }, "Open it"))
    : `The next pause record attaches to the passport for ${s.name}.`);
}
