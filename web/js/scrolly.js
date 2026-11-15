// Moving around the page.
//  - travel(): a jump between sections plays as one cinematic transition (View Transitions
//    API): the old view lifts away, the new one rises in. Named elements morph across it, so
//    a building picked from the list or map flies its rank badge and name into Inspect.
//  - switchBuilding(): ← / → in Inspect slides the inspection sideways to the next finalist.
//  - initRail(): the chapter rail on the right, with a current that fills section by section.
// Without the API, or with reduced motion, everything falls back to a plain (smooth) scroll.

import { $, $$ } from "./util.js";
import { store, select, finalists } from "./store.js";
import { reduced, droneSVG } from "./anim.js";

const canTravel = typeof document.startViewTransition === "function" && !reduced;
const html = document.documentElement;
let busy = false;

const resolve = (x) => (typeof x === "string" ? $(x) : x);

// the drone that carries a travel: exists only in the new view, so it flies above both
let courier = null;
function courierFor(dir) {
  if (!courier) {
    courier = document.createElement("div");
    courier.className = "courier";
    courier.setAttribute("aria-hidden", "true");
    courier.innerHTML = `<i class="courier-glow"></i><i class="courier-beam"></i>${droneSVG("courier-drone")}`;
  }
  courier.dataset.dir = dir;
  return courier;
}

/** Go to `target` (element or selector), running `update` on the way; `morph` = [[from, to, name], …]. */
export function travel(target, { update, morph = [], dir } = {}) {
  const el = resolve(target);
  const pad = parseFloat(getComputedStyle(html).scrollPaddingTop) || 0;
  const offset = el ? el.getBoundingClientRect().top - pad : 0;
  const here = el && Math.abs(offset) < 8 && !morph.length;
  if (!canTravel || busy || here) {
    update?.();
    if (!here) el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    return Promise.resolve();
  }
  busy = true;
  const pairs = morph.filter(([from, to]) => from && resolve(to));
  const way = dir || (offset < 0 ? "up" : "down");
  html.dataset.vt = way;
  pairs.forEach(([from, , name]) => (from.style.viewTransitionName = name));
  const vt = document.startViewTransition(() => {
    pairs.forEach(([from]) => (from.style.viewTransitionName = ""));
    update?.();
    el?.scrollIntoView({ behavior: "instant", block: "start" });
    pairs.forEach(([, to, name]) => (resolve(to).style.viewTransitionName = name));
    document.body.append(courierFor(way));
  });
  const done = () => {
    pairs.forEach(([, to]) => {
      const n = resolve(to);
      if (n) n.style.viewTransitionName = "";
    });
    courier?.remove();
    delete html.dataset.vt;
    busy = false;
  };
  vt.finished.then(done, done);
  return vt.finished.catch(() => {});
}

/** Pick a building and travel to Inspect; `src` = the elements to fly across ({rank, name}). */
export function goToBuilding(site, src = {}) {
  return travel("#inspect", {
    update: () => select(site),
    morph: [[src.rank, "#insp-rank", "site-rank"], [src.name, "#insp-title", "site-name"]],
  });
}

/** Step to the previous (-1) or next (+1) finalist inside Inspect, sliding sideways. */
export function switchBuilding(delta) {
  const fin = finalists();
  const i = fin.findIndex((s) => s.id === store.selected?.id);
  const next = fin[(i + delta + fin.length) % fin.length];
  if (!canTravel || busy) {
    select(next);
    return;
  }
  busy = true;
  const parts = [[".insp-body", "insp-body"], [".insp-name", "insp-name"], ["#insp-sub", "insp-sub"], ["#insp-kicker", "insp-kicker"]]
    .map(([sel, name]) => [$(sel), name]).filter(([el]) => el);
  html.dataset.vt = delta > 0 ? "next" : "prev";
  parts.forEach(([el, name]) => (el.style.viewTransitionName = name));
  const vt = document.startViewTransition(() => select(next));
  const done = () => {
    parts.forEach(([el]) => (el.style.viewTransitionName = ""));
    delete html.dataset.vt;
    busy = false;
  };
  vt.finished.then(done, done);
}

/** In-page links (nav, CTAs, the rail, "Close the power gap"…) travel instead of jumping. */
export function initTravelLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    const id = a.getAttribute("href");
    if (id.length < 2 || id === "#main") return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    travel(el);
    history.replaceState(null, "", id);
  });
}

/** The chapter rail; returns an update function to call on scroll. */
export function initRail() {
  const rail = $("#rail");
  if (!rail) return () => {};
  const links = $$("#rail a");
  const secs = links.map((a) => $(a.getAttribute("href")));
  const fillEl = $("#rail-fill");
  let tops = [];
  const measure = () => {
    tops = secs.map((s) => s.getBoundingClientRect().top + scrollY);
  };
  const update = () => {
    const mid = scrollY + innerHeight * 0.45;
    let i = tops.length - 1;
    while (i > 0 && mid < tops[i]) i--;
    const before = mid < tops[0];
    const frac = !before && i < tops.length - 1 ? Math.min(1, Math.max(0, (mid - tops[i]) / (tops[i + 1] - tops[i]))) : 0;
    rail.classList.toggle("show", scrollY > innerHeight * 0.55);
    rail.classList.toggle("on-dark", !before && secs[i]?.classList.contains("dark") && frac < 0.92);
    links.forEach((a, k) => {
      a.classList.toggle("on", !before && k === i);
      a.classList.toggle("past", !before && k < i);
    });
    fillEl.style.transform = `scaleY(${before ? 0 : (i + frac) / (tops.length - 1)})`;
  };
  measure();
  update();
  new ResizeObserver(() => {
    measure();
    update();
  }).observe(document.body);
  return update;
}
