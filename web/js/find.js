// Hero funnel and the Find section: every CoStar building on a map, the finalists in a list.

import { $, h, fmt } from "./util.js";
import { auditable } from "./audit.js";
import { store, on, finalists, sqft } from "./store.js";
import { goToBuilding } from "./scrolly.js";

let map = null;
const pins = new Map(); // site id -> marker
let funnelEls = []; // [{key, num, bar, li}]

const STAGES = [
  { key: "candidates", label: "industrial, flex and land buildings in CoStar's Houston data", rule: "CoStar property type Industrial, Flex or Land in the Houston research market" },
  { key: "pass_gates", label: "outside the floodplain and 500 m from homes", rule: "FEMA flood zone not A or V, and no mapped residential area within 500 m (OpenStreetMap)" },
  { key: "usable_shell", label: "with 24 ft or more of clear height", rule: "CoStar clear height of at least 24 ft: room for overhead power and hot-aisle containment" },
  { key: "finalists", label: "that also have heavy power on site", rule: "CoStar heavy-power flag: electrical service of 800 A or more" },
];

export function initFind() {
  renderFunnel();
  renderMap();
  renderList();
  on((type) => {
    if (type === "select") {
      renderList();
      highlightPin();
    }
  });
}

/* ---------------------------------------------------------------- hero funnel */

function renderFunnel() {
  const f = store.sites.summary.funnel;
  funnelEls = [];
  const steps = STAGES.map((st, i) => {
    const n = f[st.key];
    const num = h("span", { class: "fn-n" }, "0");
    const bar = h("i", { style: { width: "0%" } });
    auditable(num, () => ({
      title: st.label.charAt(0).toUpperCase() + st.label.slice(1),
      value: `${n} of ${f.candidates} buildings`,
      label: i === 0 ? "Sourced" : "Estimated",
      source: i === 0 ? "CoStar Data Extract, HackPrinceton kit (Houston research market)" : "SiteStar's fixed rules on CoStar, FEMA and OpenStreetMap data",
      retrieved: `Built ${new Date(store.sites.generated_at).toLocaleString("en-US")}`,
      formula: i === 0 ? st.rule : `Previous step, and: ${st.rule}`,
      note: i === 1 ? "OpenStreetMap misses some neighborhoods; aerial photos confirm homes before a decision." : undefined,
    }));
    const li = h("li", { class: `fn-step${i === STAGES.length - 1 ? " fn-last" : ""}`, "data-stagger": "" },
      num,
      h("span", { class: "fn-bar" }, bar),
      h("span", { class: "fn-l" }, st.label));
    funnelEls.push({ key: st.key, num, bar, li, final: n });
    return li;
  });
  $("#funnel").replaceChildren(h("ol", { class: "fn" }, steps));
}

/** Show funnel counts (null = the final numbers). The survey scene drives this. */
export function setFunnel(counts) {
  const f = store.sites?.summary.funnel;
  if (!f || !funnelEls.length) return;
  for (const el of funnelEls) {
    const v = counts ? counts[el.key] : el.final;
    el.num.textContent = fmt.int(v);
    el.bar.style.width = `${Math.max((v / f.candidates) * 100, v ? 2 : 0)}%`;
    const done = v === el.final && (!counts || counts.candidates === f.candidates);
    if (done && !el.li.classList.contains("done")) el.li.classList.add("done");
  }
}

/* ---------------------------------------------------------------- map */

function renderMap() {
  map = L.map("find-map", { scrollWheelZoom: false, zoomSnap: 0.5 }).setView([29.8, -95.4], 10);
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
  L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16,
    attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.createPane("labels");
  map.getPane("labels").style.zIndex = 450;
  map.getPane("labels").style.pointerEvents = "none";
  L.tileLayer(`${esri}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: "labels" }).addTo(map);
  map.on("click focus", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());

  // finalists last so they draw on top
  const sites = [...store.sites.sites].sort((a, b) => a.ready.stage - b.ready.stage);
  for (const s of sites) {
    const st = s.ready.stage;
    const fail = s.ready.verdict === "not_suitable";
    const html = st === 3 ? `<span>${s.rank}</span>` : "<span></span>";
    const icon = L.divIcon({ className: `bpin s${st}${fail ? " fail" : ""}`, html: html.replace("<span", `<span style="--d:${(st === 3 ? 500 + s.rank * 110 : Math.random() * 600).toFixed(0)}ms"`), iconSize: st === 3 ? [26, 26] : [12, 12] });
    const m = L.marker([s.lat, s.lon], { icon, riseOnHover: true, keyboard: st === 3, title: st === 3 ? `#${s.rank} ${s.name}` : undefined })
      .bindTooltip(tipFor(s), { direction: "top", offset: [0, st === 3 ? -12 : -6], className: "sub-tip" })
      .addTo(map);
    if (st === 3) m.on("click", () => goToBuilding(s, { rank: m.getElement()?.querySelector("span") }));
    pins.set(s.id, m);
  }
  const fin = finalists();
  if (fin.length) map.fitBounds(L.latLngBounds(fin.map((s) => [s.lat, s.lon])).pad(0.25), { maxZoom: 11 });

  $("#find-legend").replaceChildren(
    ...[["s3", "Finalist (number = rank)"], ["s2", "Tall shell, no heavy power"], ["s1", "Passes flood and homes only"], ["s0 fail", "Fails flood or homes"]].map(([cls, text]) =>
      h("span", { class: "item" }, h("span", { class: `bpin-key ${cls}` }), text)),
  );
}

function tipFor(s) {
  const reasons = s.ready.items.filter((i) => i.status === "fail").map((i) => i.name.toLowerCase());
  const why = s.ready.stage === 3 ? "Finalist"
    : reasons.length ? `Fails: ${reasons.join(", ")}`
    : s.ready.stage === 2 ? "No heavy power recorded"
    : s.ready.stage === 1 ? (s.building.clear_ft ? `Clear height ${s.building.clear_ft} ft` : "Clear height not recorded")
    : "Flood zone not confirmed";
  return `<strong>${s.ready.stage === 3 ? `#${s.rank} ` : ""}${escape(s.name)}</strong><br>${escape(s.use)} · ${sqft(s.building.gross_sf || s.building_sf)}<br>${why}`;
}

const escape = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function highlightPin() {
  for (const [id, m] of pins) m.getElement()?.classList.toggle("sel", id === store.selected?.id);
}

/* ---------------------------------------------------------------- finalist list */

function renderList() {
  const sel = store.selected?.id;
  $("#fin-list").replaceChildren(...finalists().map((s) => {
    const b = s.building, p = s.power, sc = s.screen;
    const facts = [
      b.clear_ft ? `${b.clear_ft} ft clear` : null,
      p.amps ? `${p.amps.toLocaleString("en-US")} A` : "Heavy power",
      sc.line345_km != null ? `345 kV ${fmt.dist(sc.line345_km)}` : null,
      s.listing.active.length ? s.listing.active.join(", ") : null,
    ].filter(Boolean);
    const rank = h("span", { class: "fin-rank" }, s.rank);
    const name = h("span", { class: "fin-name" }, s.name);
    const li = h("li", { class: `fin${s.id === sel ? " on" : ""}` },
      h("button", { type: "button", class: "fin-btn", "aria-pressed": String(s.id === sel), onclick: () => goToBuilding(s, { rank, name }) },
        rank,
        h("span", { class: "fin-main" },
          name,
          h("span", { class: "fin-meta" }, `${s.use} · ${sqft(b.gross_sf || s.building_sf)}${b.year_built ? ` · built ${b.year_built}` : ""}`),
          h("span", { class: "fin-facts" }, facts.map((t) => h("span", {}, t)))),
        h("span", { class: "fin-go", "aria-hidden": "true" }, "→")));
    li.addEventListener("mouseenter", () => pins.get(s.id)?.openTooltip());
    li.addEventListener("mouseleave", () => pins.get(s.id)?.closeTooltip());
    return li;
  }));
}

