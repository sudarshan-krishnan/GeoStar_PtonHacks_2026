// Minimal SVG chart toolkit: scales, ticks, a shared tooltip and a hover layer.
// Mark specs follow the dataviz guidance: 2px lines, hairline grid, thin columns
// with 4px rounded tops, 2px surface gaps between stacked parts.

import { $ } from "./util.js";

const NS = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v);
  }
  if (parent) parent.append(el);
  return el;
}

export const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** A "nice" step for an axis spanning `span` with about `n` ticks. */
export function niceStep(span, n = 4) {
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
export function niceDomain(min, max, n = 4) {
  const step = niceStep(max - min || 1, n);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo, hi, ticks };
}

/** Create an <svg> sized to its container's width. */
export function frame(container, height, margin) {
  container.replaceChildren();
  const width = Math.max(container.clientWidth, 280);
  const svg = s("svg", { width, height, viewBox: `0 0 ${width} ${height}` }, container);
  const inner = { x0: margin.left, x1: width - margin.right, y0: margin.top, y1: height - margin.bottom };
  return { svg, width, height, ...inner };
}

export function yGrid(svg, f, ticks, y, label) {
  const g = s("g", {}, svg);
  for (const t of ticks) {
    const ty = Math.round(y(t)) + 0.5;
    const tick = s("g", { class: "tick" }, g);
    s("line", { x1: f.x0, x2: f.x1, y1: ty, y2: ty }, tick);
    s("text", { x: f.x0 - 8, y: ty + 4, "text-anchor": "end", text: label(t) }, tick);
  }
  return g;
}

/* ---------- tooltip ---------- */

const tip = $("#tooltip");

export function showTip(html, clientX, clientY) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const { width, height } = tip.getBoundingClientRect();
  let x = clientX + pad;
  if (x + width > window.innerWidth - 8) x = clientX - width - pad;
  let y = clientY - height / 2;
  y = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${y}px`;
}
export const hideTip = () => {
  tip.hidden = true;
};

export function tipRows(title, rows) {
  const body = rows
    .map((r) =>
      r === "sep"
        ? '<div class="tt-sep"></div>'
        : `<div class="tt-row">${r.color ? `<span class="tt-sw" style="background:${r.color}"></span>` : ""}<span class="tt-k">${r.k}</span><span class="tt-v">${r.v}</span></div>`,
    )
    .join("");
  return `<div class="tt-title">${title}</div>${body}`;
}

/**
 * Hover layer over the plot area. xs are the pixel x positions of the data
 * points; onMove(i, event) fires with the nearest index.
 */
export function hoverLayer(f, xs, onMove, onLeave) {
  const cross = s("line", { class: "crosshair", y1: f.y0, y2: f.y1, visibility: "hidden" }, f.svg);
  const hit = s("rect", { class: "hit", x: f.x0, y: f.y0, width: Math.max(f.x1 - f.x0, 1), height: Math.max(f.y1 - f.y0, 1) }, f.svg);
  const pick = (e) => {
    const box = f.svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * f.width;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    return best;
  };
  const move = (e) => {
    if (!xs.length) return;
    const i = pick(e);
    const x = Math.round(xs[i]) + 0.5;
    cross.setAttribute("x1", x);
    cross.setAttribute("x2", x);
    cross.setAttribute("visibility", "visible");
    onMove(i, e);
  };
  const leave = () => {
    cross.setAttribute("visibility", "hidden");
    hideTip();
    onLeave?.();
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
  return { cross, hit };
}

/** Column path: 4px rounded data end at the top, square at the baseline. */
export function columnPath(x, w, yTop, yBase, r = 4) {
  const hgt = yBase - yTop;
  if (hgt <= 0.5) return "";
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${yBase}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yBase}Z`;
}

export function hatchDefs(svg, id, color) {
  const defs = s("defs", {}, svg);
  const p = s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  s("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: color, "stroke-width": 1 }, p);
  return defs;
}
