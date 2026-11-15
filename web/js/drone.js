// The drone's two jobs:
//  1. On-site check (the Inspect "Drone" tab): the live Tello feed under a HUD, with
//     take off / land / capture. Captured frames go on the building's passport as
//     Measured evidence. The MJPEG stream is only open while the tab is on screen.
//  2. Flyover: when the inspection looks at a building from above, a drone flies in
//     over the aerial photo, circles the building with scan pulses, and leaves.

import { $, $$, h, localTime } from "./util.js";
import { store, on, save, load } from "./store.js";
import { reduced, droneSVG } from "./anim.js";

let status = null; // last /api/status
let streaming = false;
let paneOpen = false;
let clockT0 = 0;

export function initDrone() {
  $("#dr-off-art").innerHTML = droneSVG("drone-big");
  $$("#dr-ctl [data-action]").forEach((b) => b.addEventListener("click", () => command(b.dataset.action, b)));
  $("#dr-snap").addEventListener("click", capture);
  $("#dr-img").addEventListener("error", () => (streaming = false));
  on((type, detail) => {
    if (type === "select") renderCaptures();
    if (type === "pane") {
      paneOpen = detail === "drone";
      render();
    }
  });
  poll();
  setInterval(tickClock, 1000);
  renderCaptures();
}

async function poll() {
  try {
    if (store.base !== null) {
      const res = await fetch(`${store.base}/api/status`, { cache: "no-store" });
      status = res.ok ? await res.json() : null;
    } else {
      status = null;
    }
  } catch {
    status = null;
  }
  render();
  setTimeout(poll, paneOpen ? 1000 : 3000);
}

function render() {
  const s = status;
  const live = !!(s && s.connected);
  const tab = $('#stage-tabs [data-pane="drone"]');
  if (tab) tab.dataset.live = live ? (s.mock ? "sim" : "on") : "off";
  const img = $("#dr-img");
  if (live && paneOpen) {
    if (!streaming) {
      img.src = `${store.base}/video?t=${Date.now()}`;
      streaming = true;
      clockT0 = Date.now();
    }
    img.hidden = false;
    $("#dr-off").hidden = true;
    $("#dr-hud").hidden = false;
  } else {
    if (streaming) {
      img.removeAttribute("src"); // closes the MJPEG connection
      streaming = false;
    }
    img.hidden = true;
    $("#dr-off").hidden = false;
    $("#dr-hud").hidden = true;
    $("#dr-msg").textContent =
      store.base === null ? "Start the bridge on the demo laptop to fly it."
      : !s ? "The bridge isn't answering."
      : s.disabled ? "Start the bridge with --drone (and --tello-ip on a hotspot) to fly it live."
      : s.error ? "The drone isn't answering. Check it's on and on the same Wi-Fi as this laptop."
      : "Connecting to the drone…";
  }
  $("#hud-alt").textContent = s?.height != null ? `${s.height} cm` : "—";
  $("#hud-bat").textContent = s?.battery != null ? `${s.battery}%` : "—";
  $("#hud-temp").textContent = s?.temp != null ? `${s.temp} °C` : "—";
  $("#hud-mode").textContent = s?.mock ? "SIMULATED" : "LIVE";
  $$("#dr-ctl button").forEach((b) => (b.disabled = !live));
}

function tickClock() {
  if (!streaming) return;
  const sec = Math.floor((Date.now() - clockT0) / 1000);
  $("#hud-clock").textContent = `REC ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

async function post(path, body) {
  const res = await fetch(`${store.base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function msg(text, err = false) {
  const el = $("#dr-cmd");
  el.textContent = text;
  el.classList.toggle("err", err);
}

async function command(action, btn) {
  btn.disabled = true;
  msg(action === "emergency" ? "Stopping motors…" : `Sending “${action}”…`);
  try {
    await post("/api/command", { action });
    msg(`✓ ${action === "emergency" ? "Motors stopped" : action}`);
  } catch (e) {
    msg(`✗ ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function capture() {
  const s = store.selected;
  const btn = $("#dr-snap");
  btn.disabled = true;
  try {
    const shot = await post("/api/drone/snapshot", {});
    const list = load("captures", s.id) || [];
    list.unshift({ url: shot.url, time: shot.time, simulated: shot.simulated });
    save("captures", s.id, list.slice(0, 12));
    $("#dr-feed").classList.remove("flash");
    void $("#dr-feed").offsetWidth; // restart the flash animation
    $("#dr-feed").classList.add("flash");
    msg(`✓ Frame saved to the passport for ${s.name}`);
    renderCaptures();
  } catch (e) {
    msg(`✗ capture: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function renderCaptures() {
  const s = store.selected;
  if (!s) return;
  const list = load("captures", s.id) || [];
  $("#dr-caps").replaceChildren(...(list.length
    ? list.map((c) => h("a", { href: `${store.base ?? ""}${c.url}`, target: "_blank", rel: "noopener", class: "cap", title: `${c.simulated ? "Simulated" : "Measured"} · ${localTime(c.time)}` },
      h("img", { src: `${store.base ?? ""}${c.url}`, alt: `Drone frame at ${localTime(c.time)}`, loading: "lazy" }),
      h("span", {}, new Date(c.time * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))))
    : [h("p", { class: "fine" }, `No frames yet for ${s.name}. Captures land on its passport.`)]));
}

/* ---------------------------------------------------------------- flyover */

/** A drone flies in over `box`, circles its centre with scan pulses, and leaves. */
export function flyover(box) {
  if (!box || reduced) return;
  box.querySelector(".flyover")?.remove();
  const w = box.clientWidth, hgt = box.clientHeight;
  const cx = w / 2, cy = hgt / 2;
  const layer = h("div", { class: "flyover", "aria-hidden": "true" },
    h("div", { class: "scan-ring" }), h("div", { class: "scan-ring r2" }), h("div", { class: "scan-ring r3" }),
    h("div", { class: "fly-drone", html: droneSVG("drone-fly") }));
  box.append(layer);
  const d = layer.querySelector(".fly-drone");
  const at = (x, y, r, s = 1) => ({ transform: `translate(${x - 40}px, ${y - 40}px) rotate(${r}deg) scale(${s})` });
  const R = Math.min(w, hgt) * 0.16;
  const loop = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
    loop.push({ ...at(cx + Math.cos(a) * R, cy + Math.sin(a) * R, (a * 180) / Math.PI + 180, 1.08), offset: 0.38 + (i / 8) * 0.4 });
  }
  d.animate([
    { ...at(-80, hgt + 60, 40, 0.8), offset: 0 },
    { ...at(cx, cy - R, 90, 1.1), offset: 0.38 },
    ...loop.slice(1),
    { ...at(w + 90, -70, 495, 0.85), offset: 1 },
  ], { duration: 3600, easing: "cubic-bezier(.45,.05,.25,1)", fill: "forwards" });
  layer.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: 3700, fill: "forwards" })
    .finished.then(() => layer.remove()).catch(() => layer.remove());
}
