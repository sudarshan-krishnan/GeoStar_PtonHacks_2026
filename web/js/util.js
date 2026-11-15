// Small shared helpers: DOM building, number/time formatting, icons.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const LABEL_CLASS = {
  Measured: "chip-measured",
  Sourced: "chip-sourced",
  Estimated: "chip-estimated",
  Simulated: "chip-simulated",
  "Utility-confirmed": "chip-utility",
};
export const chip = (label) => h("span", { class: `chip ${LABEL_CLASS[label] || ""}` }, label);

export const fmt = {
  int: (v) => Math.round(v).toLocaleString("en-US"),
  gw: (mw) => (mw / 1000).toFixed(1),
  money: (v) => (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US"),
  price: (v) => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2),
  pct: (v, d = 0) => `${(v * 100).toFixed(d)}%`,
  signedPct: (v, d = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`,
  dist: (km) => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `${km.toFixed(1)} km`),
  watts: (w) => (w >= 100 ? Math.round(w).toString() : w.toFixed(1)),
};

/** Minutes after midnight -> "6:05 PM". */
export function clock(minute) {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  return `${h24 % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
/** Hour index 0-23 -> "12a", "6p". */
export const hourShort = (hr) => `${hr % 12 || 12}${hr < 12 || hr === 24 ? "a" : "p"}`;
export const hourRange = (hr) => `${clock(hr * 60)} – ${clock((hr + 1) * 60)}`;

/** "2026-11-13" -> "Nov 13". */
export function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/** Epoch seconds -> local "1:05:12 AM". */
export const localTime = (sec) =>
  new Date(sec * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const localDate = (sec) =>
  new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function duration(sec) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")} min`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Re-run fn when el's width changes. */
export function onResize(el, fn) {
  let last = el.clientWidth;
  new ResizeObserver(
    debounce(() => {
      if (el.clientWidth !== last) {
        last = el.clientWidth;
        fn();
      }
    }, 80),
  ).observe(el);
}

const svg = (body, extra = "") =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
export const ICON = {
  check: svg('<path d="M5 10.5l3.2 3.2L15 7"/>'),
  x: svg('<path d="M6 6l8 8M14 6l-8 8"/>'),
  alert: svg('<path d="M10 5.5v5.5M10 14.4v.1"/>'),
  info: svg('<circle cx="10" cy="10" r="7.2" stroke-width="1.6"/><path d="M10 9v4.5M10 6.6v.1"/>'),
  bolt: svg('<path d="M11 2.5L4.5 11h5l-1 6.5L15.5 9h-5z" stroke-width="1.7"/>'),
  pause: svg('<path d="M7.5 5v10M12.5 5v10"/>'),
  minus: svg('<path d="M5.5 10h9"/>'),
  spinner: svg('<circle cx="10" cy="10" r="7" stroke-dasharray="30 14"/>', 'class="spin"'),
};
