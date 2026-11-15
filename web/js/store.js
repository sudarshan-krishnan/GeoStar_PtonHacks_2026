// Shared page state: the loaded data, the selected building, and saved results.

const listeners = new Set();

export const store = {
  base: null, // bridge URL ("" = same origin) or null
  sites: null, // data/costar-sites.json
  pauses: null, // data/pause-budget.json
  agent: { available: false, cached: [], reason: "Bridge not running", model: null },
  selected: null, // the building being inspected
  pod: 10, // first-phase MW
  flex: 0.5, // share of the load that can pause
};

export const on = (fn) => listeners.add(fn);
export function emit(type, detail) {
  for (const fn of listeners) fn(type, detail);
}

export const finalists = () => store.sites.sites.filter((s) => s.ready.stage === 3);

export function select(site, { scroll = false } = {}) {
  if (!site) return;
  store.selected = site;
  store.pod = site.first_phase_mw || 10;
  emit("select", site);
  if (scroll) document.querySelector("#inspect").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Per-building results kept in this browser (the passport page reads them too).
const KEY = (kind, id) => `sitestar:${kind}:${id}`;
export function save(kind, id, value) {
  try {
    localStorage.setItem(KEY(kind, id), JSON.stringify(value));
  } catch {
    /* private mode: the page still works, the passport just won't carry it */
  }
}
export function load(kind, id) {
  try {
    return JSON.parse(localStorage.getItem(KEY(kind, id)) || "null");
  } catch {
    return null;
  }
}

/** Display helpers shared by the page and the passport. */
export const sqft = (v) => (!v ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M sq ft` : `${Math.round(v / 1000)}K sq ft`);
export const mva = (kva) => (kva == null ? null : `${(kva / 1000).toFixed(1)} MVA`);
export const VERDICT = {
  strong: { text: "Strong candidate", cls: "v-pass" },
  possible: { text: "Possible, needs work", cls: "v-review" },
  not_suitable: { text: "Not suitable", cls: "v-fail" },
};
export const STATUS = {
  pass: { word: "Pass", icon: "check" },
  work: { word: "Work", icon: "alert" },
  fail: { word: "Fail", icon: "x" },
  unknown: { word: "Verify", icon: "info" },
};

/** One line that sums a building up, from its own data. */
export function rulesHeadline(s) {
  const b = s.building, sc = s.screen, p = s.power;
  const bits = [];
  if (b.clear_ft) bits.push(`${b.clear_ft} ft clear`);
  if (p.amps) bits.push(`${p.amps.toLocaleString("en-US")} A service`);
  else if (p.heavy) bits.push("heavy power");
  if (sc.line345_km != null) bits.push(`${sc.line345_km < 1 ? Math.max(10, Math.round(sc.line345_km * 100) * 10) + " m" : sc.line345_km.toFixed(1) + " km"} from a 345 kV line`);
  const lead = bits.join(", ");
  return s.ready.verdict === "not_suitable"
    ? `Fails a hard limit: ${s.ready.items.filter((i) => i.status === "fail").map((i) => i.name.toLowerCase()).join(" and ")}.`
    : `${lead.charAt(0).toUpperCase()}${lead.slice(1)}. Power is the gap to close.`;
}
