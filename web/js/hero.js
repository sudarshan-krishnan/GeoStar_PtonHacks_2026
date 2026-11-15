// Hero: a drone surveys CoStar's 121 Houston buildings over the real 345 kV grid.
// As its scan passes, each building drops out or lights up, and the funnel under the
// scene counts down in step, ending on the 8 finalists with the drone over #1.

import { $ } from "./util.js";
import { store, finalists } from "./store.js";
import { reduced, ease, drawDrone } from "./anim.js";
import { setFunnel } from "./find.js";

const ORANGE = [235, 104, 52];
const T = { lines: 1400, dotsIn: 300, dotsDur: 1500, scanAt: 1900, scanDur: 5600, homeDur: 1500 };

let canvas, ctx, W = 0, H = 0, dpr = 1;
let base = null; // offscreen: grid + lines
let dots = [], proj = null, grid = null;
let path = [], pathLen = 0, scanR = 40;
let elapsed = 0, last = 0, running = false, visible = true, raf = 0;
let heading = 0, phase = "";
let shown = { candidates: -1, pass_gates: -1, usable_shell: -1, finalists: -1 };

export async function initHero() {
  canvas = $("#survey-canvas");
  if (!canvas?.getContext) return setFunnel(null);
  ctx = canvas.getContext("2d");
  try {
    grid = await store.gridPromise;
  } catch {
    grid = null; // the scene still runs without the grid lines
  }
  const sites = store.sites.sites;
  dots = sites.map((s) => ({ s, x: 0, y: 0, appear: 0, at: Infinity }));
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    if (visible) start();
  }, { threshold: 0.05 }).observe(canvas);
  document.addEventListener("visibilitychange", () => !document.hidden && start());
  if (reduced) {
    elapsed = 1e9;
    draw(performance.now());
    setFunnel(null);
    status("8 finalists found");
    return;
  }
  start();
}

function start() {
  if (running || !visible || document.hidden) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function frame(now) {
  if (!visible || document.hidden) {
    running = false;
    return;
  }
  // rAF's timestamp can precede the performance.now() taken when the loop started: never step backwards,
  // and cap the step so a stalled tab doesn't skip the scan
  elapsed += Math.max(0, Math.min(64, now - last));
  last = now;
  try {
    draw(now);
  } catch (err) {
    console.error(err); // keep the loop alive; one bad frame shouldn't freeze the scene
  }
  raf = requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- layout */

function resize() {
  const box = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(280, box.width);
  H = Math.max(240, box.height);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  // equirectangular projection fitted to the buildings, with room for the HUD
  const sites = store.sites.sites;
  const lats = sites.map((s) => s.lat), lons = sites.map((s) => s.lon);
  let s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
  const padLat = (n - s) * 0.12, padLon = (e - w) * 0.1;
  s -= padLat; n += padLat; w -= padLon; e += padLon;
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
  const pad = { l: 24, r: 24, t: 54, b: 40 };
  const scale = Math.min((W - pad.l - pad.r) / ((e - w) * kx), (H - pad.t - pad.b) / (n - s));
  const ox = pad.l + (W - pad.l - pad.r - (e - w) * kx * scale) / 2;
  const oy = pad.t + (H - pad.t - pad.b - (n - s) * scale) / 2;
  proj = { x: (lon) => ox + (lon - w) * kx * scale, y: (lat) => oy + (n - lat) * scale, box: { x0: ox, y0: oy, x1: ox + (e - w) * kx * scale, y1: oy + (n - s) * scale } };

  const cx = (proj.box.x0 + proj.box.x1) / 2, cy = (proj.box.y0 + proj.box.y1) / 2;
  const far = Math.hypot(proj.box.x1 - cx, proj.box.y1 - cy) || 1;
  for (const d of dots) {
    d.x = proj.x(d.s.lon);
    d.y = proj.y(d.s.lat);
    d.appear = T.dotsIn + (Math.hypot(d.x - cx, d.y - cy) / far) * T.dotsDur * 0.8;
  }
  buildPath();
  // which point of the survey path first brings each building inside the scan
  for (const d of dots) {
    d.at = Infinity;
    for (const p of path) {
      if (Math.hypot(p.x - d.x, p.y - d.y) <= scanR) {
        d.at = T.scanAt + scanTime(p.s);
        break;
      }
    }
    if (!Number.isFinite(d.at)) d.at = T.scanAt + T.scanDur; // safety: classify at the end
  }
  buildBase();
  if (!running) draw(performance.now());
}

/** Lawnmower survey: three passes across the map, joined by smooth turns. */
function buildPath() {
  const b = proj.box;
  const rows = 3;
  const rowH = (b.y1 - b.y0) / rows;
  scanR = Math.max(rowH * 0.62, 26);
  const x0 = b.x0 - 30, x1 = b.x1 + 30;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const y = b.y0 + rowH * (r + 0.5);
    const ltr = r % 2 === 0;
    const xa = ltr ? x0 : x1, xb = ltr ? x1 : x0;
    for (let i = 0; i <= 40; i++) pts.push([xa + ((xb - xa) * i) / 40, y]);
    if (r < rows - 1) { // half-circle turn down to the next row
      const cxT = xb, cyT = y + rowH / 2, rad = rowH / 2;
      for (let i = 1; i < 16; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 16;
        pts.push([cxT + (ltr ? 1 : -1) * Math.cos(a) * rad, cyT + Math.sin(a) * rad]);
      }
    }
  }
  path = [];
  let acc = 0;
  pts.forEach(([x, y], i) => {
    if (i) acc += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    path.push({ x, y, s: acc });
  });
  pathLen = acc;
}

/** Arc length s -> ms into the scan (smooth start and finish, steady in the middle). */
function scanTime(s) {
  // invert p - sin(2πp)/2π ≈ s/L numerically (cheap: 24 bisection steps)
  const target = s / pathLen;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (mid - Math.sin(2 * Math.PI * mid) / (2 * Math.PI) < target) lo = mid;
    else hi = mid;
  }
  return lo * T.scanDur;
}

function pointAt(p) {
  const s = pathLen * (p - Math.sin(2 * Math.PI * p) / (2 * Math.PI));
  let i = 1;
  while (i < path.length - 1 && path[i].s < s) i++;
  const a = path[i - 1], b = path[i];
  const k = (s - a.s) / ((b.s - a.s) || 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: Math.atan2(b.y - a.y, b.x - a.x) };
}

function buildBase() {
  base = document.createElement("canvas");
  base.width = canvas.width;
  base.height = canvas.height;
  const g = base.getContext("2d");
  g.scale(dpr, dpr);
  // fine survey grid
  g.strokeStyle = "rgba(255,255,255,.045)";
  g.lineWidth = 1;
  for (let x = 0.5; x < W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0.5; y < H; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  if (!grid) return;
  const inBox = (lon, lat) => { const x = proj.x(lon), y = proj.y(lat); return x > -60 && x < W + 60 && y > -60 && y < H + 60; };
  const drawLines = (lines, color, width) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = "round";
    for (const flat of lines) {
      let ok = false;
      for (let i = 0; i < flat.length; i += 2) if (inBox(flat[i], flat[i + 1])) { ok = true; break; }
      if (!ok) continue;
      g.beginPath();
      for (let i = 0; i < flat.length; i += 2) {
        const x = proj.x(flat[i]), y = proj.y(flat[i + 1]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  drawLines(grid.lines["138"], "rgba(134,182,239,.16)", 1);
  g.shadowColor = "rgba(90,150,255,.55)";
  g.shadowBlur = 6;
  drawLines(grid.lines["345"], "rgba(120,170,255,.55)", 1.6);
  g.shadowBlur = 0;
  g.fillStyle = "rgba(160,195,255,.5)";
  for (const [lon, lat, kv] of grid.substations) {
    if ((kv || 0) < 138 || !inBox(lon, lat)) continue;
    g.beginPath();
    g.arc(proj.x(lon), proj.y(lat), 1.6, 0, Math.PI * 2);
    g.fill();
  }
}

/* ---------------------------------------------------------------- drawing */

const STYLE = [
  { r: 2.1, c: "rgba(255,255,255,.16)" }, // fails flood or homes
  { r: 2.6, c: "rgba(255,255,255,.5)" }, // passes the gates
  { r: 3.1, c: "rgba(255,255,255,.85)" }, // usable shell
];

function draw(now) {
  const t = elapsed;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // the grid boots up from the centre
  if (base && t >= T.lines) {
    ctx.drawImage(base, 0, 0, W, H);
  } else if (base) {
    const p = ease.outCubic(Math.max(0, Math.min(1, t / T.lines)));
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.max(0, Math.hypot(W, H) * 0.55 * p), 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(base, 0, 0, W, H);
    ctx.restore();
  }

  // drone position
  let dx, dy, dir;
  const scanP = (t - T.scanAt) / T.scanDur;
  const top = finalists()[0];
  const topDot = dots.find((d) => d.s.id === top?.id);
  if (scanP < 0) {
    const p0 = pointAt(0);
    const k = ease.outCubic(Math.min(1, t / T.scanAt));
    dx = p0.x - 80 + 80 * k; dy = p0.y - 40 + 40 * k; dir = p0.dir;
  } else if (scanP <= 1) {
    ({ x: dx, y: dy, dir } = pointAt(scanP));
  } else {
    const end = pointAt(1);
    const k = ease.inOutCubic(Math.min(1, (t - T.scanAt - T.scanDur) / T.homeDur));
    const hx = topDot ? topDot.x + 34 : W / 2, hy = topDot ? topDot.y - 30 : H / 2;
    dx = end.x + (hx - end.x) * k;
    dy = end.y + (hy - end.y) * k;
    dir = k < 1 ? Math.atan2(hy - end.y, hx - end.x) : heading;
    if (k >= 1) { dx += Math.sin(now / 900) * 3; dy += Math.cos(now / 1100) * 2.5; }
  }
  // turn smoothly toward the direction of travel
  let dd = dir - heading;
  while (dd > Math.PI) dd -= Math.PI * 2;
  while (dd < -Math.PI) dd += Math.PI * 2;
  heading += dd * 0.12;

  // scan footprint (during the survey) or a pulse ring over #1 (afterwards)
  if (scanP >= 0 && scanP <= 1) drawScan(dx, dy, now);

  // buildings
  const counts = { candidates: 0, pass_gates: 0, usable_shell: 0, finalists: 0 };
  for (const d of dots) {
    if (t < d.appear) continue;
    counts.candidates++;
    const a = Math.min(1, (t - d.appear) / 350);
    const st = d.s.ready.stage;
    if (t < d.at) {
      ctx.fillStyle = `rgba(150,190,255,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2.5 * (0.6 + 0.4 * ease.outBack(a)), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (st >= 1) counts.pass_gates++;
    if (st >= 2) counts.usable_shell++;
    if (st >= 3) counts.finalists++;
    const since = t - d.at;
    if (st === 3) drawFinalist(d, since, now);
    else {
      const sty = STYLE[st];
      ctx.fillStyle = sty.c;
      ctx.beginPath();
      ctx.arc(d.x, d.y, sty.r, 0, Math.PI * 2);
      ctx.fill();
      if (since < 520) { // a ring as it's classified: red for a fail, white for a pass
        const k = since / 520;
        ctx.strokeStyle = st === 0 ? `rgba(240,90,80,${0.7 * (1 - k)})` : `rgba(255,255,255,${0.5 * (1 - k)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3 + 9 * ease.outCubic(k), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // the top finalist's callout, once the drone arrives
  if (scanP > 1 && topDot) {
    const k = ease.outCubic(Math.min(1, (t - T.scanAt - T.scanDur - T.homeDur * 0.6) / 600));
    if (k > 0) drawCallout(topDot, k, now);
  }

  drawDrone(ctx, dx, dy, heading + Math.PI / 2, now, 0.58);

  if (counts.candidates !== shown.candidates || counts.pass_gates !== shown.pass_gates || counts.finalists !== shown.finalists || counts.usable_shell !== shown.usable_shell) {
    shown = counts;
    setFunnel(counts);
    if (phase === "scan") status(`Scanning · ${counts.pass_gates} pass · ${counts.finalists} finalist${counts.finalists === 1 ? "" : "s"}`);
  }
  const ph = scanP < 0 ? "boot" : scanP <= 1 ? "scan" : "done";
  if (ph !== phase) {
    phase = ph;
    status(ph === "boot" ? "Loading CoStar's Houston buildings…" : ph === "scan" ? "Scanning: flood, homes, shell, power…" : `${counts.finalists} finalists · drone over #1`);
    canvas.closest(".survey")?.setAttribute("data-phase", ph);
  }
}

function drawScan(x, y, now) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, scanR);
  g.addColorStop(0, "rgba(235,104,52,.10)");
  g.addColorStop(0.7, "rgba(235,104,52,.05)");
  g.addColorStop(1, "rgba(235,104,52,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, scanR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(235,104,52,.35)";
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, scanR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (ctx.createConicGradient) { // radar sweep
    const a = (now / 700) % (Math.PI * 2);
    const cg = ctx.createConicGradient(a, x, y);
    cg.addColorStop(0, "rgba(235,104,52,.32)");
    cg.addColorStop(0.12, "rgba(235,104,52,0)");
    cg.addColorStop(1, "rgba(235,104,52,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, scanR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFinalist(d, since, now) {
  const pop = ease.outBack(Math.min(1, since / 420));
  const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 16);
  glow.addColorStop(0, `rgba(${ORANGE},.55)`);
  glow.addColorStop(1, `rgba(${ORANGE},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 16 * pop, 0, Math.PI * 2);
  ctx.fill();
  const k = ((now / 1600 + d.s.rank * 0.17) % 1);
  ctx.strokeStyle = `rgba(${ORANGE},${0.55 * (1 - k)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 5 + 13 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgb(${ORANGE})`;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 4.6 * pop, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawCallout(d, k, now) {
  const label = `#1 · ${d.s.building.clear_ft || "—"} ft clear · ${d.s.power.amps ? `${d.s.power.amps.toLocaleString("en-US")} A` : "heavy power"}`;
  ctx.font = "600 12px Geist, system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const right = d.x + 26 + tw + 22 < W;
  const bx = right ? d.x + 26 : d.x - 26 - tw - 20, by = d.y + 22;
  ctx.globalAlpha = k;
  ctx.strokeStyle = "rgba(255,255,255,.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(d.x + (right ? 6 : -6), d.y + 5);
  ctx.lineTo(right ? bx : bx + tw + 20, by + 12);
  ctx.stroke();
  ctx.fillStyle = "rgba(20,22,27,.92)";
  ctx.strokeStyle = `rgba(${ORANGE},.8)`;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + 20, 24, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, bx + 10, by + 16);
  ctx.globalAlpha = 1;
}

function status(text) {
  const el = $("#survey-status");
  if (el) el.textContent = text;
}
