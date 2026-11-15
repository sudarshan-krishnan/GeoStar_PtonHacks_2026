// Motion toolkit: easing, tweens, count-ups, scroll reveals and the drone drawing.
// Everything animates transform/opacity or a canvas, runs on requestAnimationFrame,
// and collapses to the final state for people who prefer reduced motion.

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const ease = {
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};

/** Run onFrame(p) with p eased from 0 to 1 over `ms`; resolves when done. */
export function tween(ms, onFrame, easing = ease.outExpo) {
  return new Promise((resolve) => {
    if (reduced || ms <= 0) {
      onFrame(1);
      resolve();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      onFrame(easing(p));
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Animate an element's number from its last shown value to `to`. */
export function countUp(el, to, { ms = 1100, format = (v) => Math.round(v).toLocaleString("en-US"), from } = {}) {
  const start = from ?? el._num ?? 0;
  el._num = to;
  const id = (el._tween = (el._tween || 0) + 1);
  return tween(ms, (p) => {
    if (el._tween === id) el.textContent = format(start + (to - start) * p);
  });
}

/** Elements with [data-reveal] fade up when they scroll into view; [data-stagger] children cascade. */
export function initReveals(root = document) {
  const els = [...root.querySelectorAll("[data-reveal]")];
  for (const el of els) {
    [...el.querySelectorAll("[data-stagger]")].forEach((c, i) => c.style.setProperty("--i", i));
  }
  if (reduced) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    }),
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
  );
  els.forEach((el) => io.observe(el));
}

/** Call fn once, the first time el is on screen. */
export function onceVisible(el, fn, threshold = 0.25) {
  if (!el) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { threshold });
  io.observe(el);
}

/** Wrap each word of a plain-text heading so the words can rise in one by one. */
export function splitWords(el) {
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) frag.append(part.replace(/ /g, " "));
          else {
            const w = document.createElement("span");
            w.className = "w";
            const inner = document.createElement("span");
            inner.textContent = part;
            w.append(inner);
            frag.append(w);
          }
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(el);
  [...el.querySelectorAll(".w > span")].forEach((s, i) => s.style.setProperty("--i", i));
}

/** A top-down quadcopter as inline SVG; rotors spin with CSS. */
export function droneSVG(cls = "") {
  const rotor = (x, y) => `<g transform="translate(${x} ${y})"><circle r="15" class="rotor-disc"/><g class="rotor"><rect x="-14" y="-1.6" width="28" height="3.2" rx="1.6"/><rect x="-1.6" y="-14" width="3.2" height="28" rx="1.6" opacity=".55"/></g></g>`;
  return `<svg class="drone ${cls}" viewBox="-50 -50 100 100" aria-hidden="true">
    <g class="drone-arms"><path d="M-27 -27L27 27M27 -27L-27 27" stroke-width="5" stroke-linecap="round"/></g>
    ${rotor(-27, -27)}${rotor(27, -27)}${rotor(-27, 27)}${rotor(27, 27)}
    <rect x="-11" y="-14" width="22" height="28" rx="7" class="drone-body"/>
    <circle cx="0" cy="-9" r="2.6" class="drone-led"/>
    <circle cx="0" cy="5" r="3.4" class="drone-cam"/>
  </svg>`;
}

/** Draw the same drone on a canvas at (x, y), heading `rot` (radians), at time t (ms). */
export function drawDrone(ctx, x, y, rot, t, scale = 1, dark = true) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  // shadow (a gradient, not a blur filter: cheap at 60 fps)
  const sh = ctx.createRadialGradient(10, 14, 4, 10, 14, 38);
  sh.addColorStop(0, "rgba(0,0,0,.34)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(10, 14, 38, 0, Math.PI * 2);
  ctx.fill();
  // arms
  ctx.strokeStyle = dark ? "#2c2f36" : "#3a3a38";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-27, -27); ctx.lineTo(27, 27);
  ctx.moveTo(27, -27); ctx.lineTo(-27, 27);
  ctx.stroke();
  // rotors
  for (const [rx, ry, dir] of [[-27, -27, 1], [27, -27, -1], [-27, 27, -1], [27, 27, 1]]) {
    ctx.save();
    ctx.translate(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 3, 0, 0, 17);
    g.addColorStop(0, "rgba(255,255,255,.28)");
    g.addColorStop(0.75, "rgba(255,255,255,.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.rotate(dir * t * 0.06);
    ctx.fillStyle = "rgba(240,239,236,.55)"; // blades read as a blur, not a cross
    ctx.fillRect(-15, -1, 30, 2);
    ctx.fillStyle = "rgba(240,239,236,.18)";
    ctx.fillRect(-1, -15, 2, 30);
    ctx.restore();
  }
  // body
  const body = ctx.createLinearGradient(0, -14, 0, 14);
  body.addColorStop(0, "#f4f3ef");
  body.addColorStop(1, "#bdbcb5");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-13, -16, 26, 32, 8);
  ctx.fill();
  // led + camera
  const blink = 0.55 + 0.45 * Math.sin(t / 160);
  ctx.fillStyle = `rgba(235,104,52,${blink})`;
  ctx.beginPath();
  ctx.arc(0, -9, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1b1d22";
  ctx.beginPath();
  ctx.arc(0, 5, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
