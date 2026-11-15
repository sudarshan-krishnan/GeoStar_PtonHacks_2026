// SiteStar: find the existing Houston buildings that can host AI compute, inspect them,
// close the power gap with a pause commitment, and prove the pause on real machines.

import { $ } from "./util.js";
import { findBridge, getJSON } from "./data.js";
import { auditable } from "./audit.js";
import { store, select, finalists, emit } from "./store.js";
import { initFind } from "./find.js";
import { initInspect } from "./inspect.js";
import { initPower } from "./power.js";
import { initProve } from "./prove.js";
import { initLive } from "./live.js";
import { initHero } from "./hero.js";
import { initDrone } from "./drone.js";
import { initReveals, onceVisible, splitWords } from "./anim.js";
import { travel, initTravelLinks, initRail } from "./scrolly.js";

// the headline's words rise in straight away, before any data arrives
splitWords($("#hero-title"));

// Presenter keys: 1-5 jump between sections, 0 back to the top.
const KEYS = { 0: "#top", 1: "#find", 2: "#inspect", 3: "#power", 4: "#prove", 5: "#evidence" };
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
  const target = KEYS[e.key];
  if (target) travel(target);
});
initTravelLinks();

// a thin progress line under the top bar
const progress = $("#scroll-progress");
let ticking = false;
let updateRail = () => {};
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty("--progress", max > 0 ? (scrollY / max).toFixed(4) : "0");
    updateRail();
    ticking = false;
  });
};
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const setStatus = (sel, cls, text) => {
  const el = $(sel);
  if (el) el.innerHTML = `<i class="dot ${cls}"></i>${text}`;
};

function renderAgentPill() {
  const a = store.agent;
  const [cls, text, src] = a.available
    ? ["on", "Claude live", `Live: ${a.model}, effort ${a.effort}`]
    : a.cached?.length
      ? ["sim", "Agent replay", `No credentials on this laptop; replays ${a.cached.length} saved run${a.cached.length > 1 ? "s" : ""}`]
      : ["", "Rules only", `Off: ${a.reason}`];
  const pill = $("#pill-agent");
  pill.querySelector(".dot").className = `dot ${cls}`;
  pill.querySelector("span").textContent = text;
  setStatus("#src-agent", cls, src);
}

(async function start() {
  const params = new URLSearchParams(location.search);
  try {
    [store.sites, store.pauses] = await Promise.all([getJSON("data/costar-sites.json", 15000), getJSON("data/pause-budget.json", 15000)]);
  } catch (err) {
    console.error(err);
    $("#funnel").innerHTML =
      "<p class=\"fine\">CoStar's data isn't on this machine. Unzip the kit into <code>Data/costar-kit</code> and run <code>python bridge/costar_sites.py --media</code>, then reload.</p>";
    $("#funnel").classList.add("in");
    return;
  }
  store.gridPromise = getJSON("data/houston-grid.json", 20000);
  store.gridPromise.catch(() => {}); // the hero runs without it if it fails

  const sm = store.sites.summary;
  const fin = finalists();
  setStatus("#src-costar", "on", `${sm.sites} Houston buildings, on this laptop only`);
  const scanned = fin.filter((s) => s.media?.scans?.some((x) => x.images.length)).length;
  setStatus("#src-scan", scanned ? "on" : "", scanned ? `Snapshots cached for ${scanned} of ${fin.length} finalists` : "Not cached: run costar_sites.py --media");
  setStatus("#src-aerial", fin.some((s) => s.media?.aerial) ? "on" : "", fin.some((s) => s.media?.aerial) ? "Cached for every finalist; live tiles when online" : "Live tiles only");
  setStatus("#src-ercot", "on", `${store.pauses.source.hours_in_file.toLocaleString("en-US")} hours of ${store.pauses.year}, saved`);

  auditable($("#hero-queue"), () => ({
    title: "Large loads waiting to connect to the Texas grid",
    value: "More than 438,000 MW, nearly 89% of it data centers",
    label: "Sourced",
    source: "ERCOT, “New Batch Connection Process for Large Electricity Users” (Trending Topics, June 2026)",
    url: "https://www.ercot.com/files/docs/2026/06/18/ERCOT-Trending-Topic-New-Batch-Connection-Process-for-Large-Electricity-Users.pdf",
    note: "Requests, not commitments: many are speculative. ERCOT's peak demand is about 85 GW.",
  }));

  const wanted = store.sites.sites.find((s) => String(s.id) === params.get("site") && s.ready.stage === 3) || fin[0];
  store.selected = wanted;
  store.pod = wanted.first_phase_mw || 10;
  initFind();
  initInspect();
  initPower();
  initProve();
  initDrone();
  select(wanted);
  initHero();
  initReveals();
  updateRail = initRail();
  onceVisible($("#find-map"), () => $("#find-map").classList.add("in"), 0.2);
  renderAgentPill();

  store.base = await findBridge();
  initLive(store.base);
  if (store.base !== null) {
    try {
      store.agent = await getJSON(`${store.base}/api/agent/status`, 4000);
    } catch {
      store.agent = { ...store.agent, reason: "this bridge has no agent endpoint" };
    }
  }
  renderAgentPill();
  emit("agent");
  if (params.get("inspect")) setTimeout(() => $("#insp-go").click(), 700);
})();
