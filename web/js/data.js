// Finding the local bridge and loading the ERCOT data.
//
// Bridge discovery order:
//   1. ?bridge=http://host:port in the page URL
//   2. Same origin (when the page is served by the bridge itself)
//   3. http://localhost:8000

const params = new URLSearchParams(location.search);

function candidates() {
  const list = [];
  if (params.get("bridge")) list.push(params.get("bridge").replace(/\/$/, ""));
  if (location.protocol.startsWith("http")) list.push("");
  list.push("http://localhost:8000");
  return [...new Set(list)];
}

async function getJSON(url, timeoutMs = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Base URL of a running SiteStar bridge ("" = same origin), or null. */
export async function findBridge() {
  for (const base of candidates()) {
    try {
      const s = await getJSON(`${base}/api/status`, 2500);
      if (typeof s.connected === "boolean") return base;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Live ERCOT data from the bridge if possible, else the saved snapshot. */
export async function loadErcot(base) {
  if (base !== null) {
    try {
      return { data: await getJSON(`${base}/api/ercot`), live: true };
    } catch {
      /* fall back to the snapshot */
    }
  }
  return { data: await getJSON("data/ercot.json"), live: false };
}

export { getJSON };
