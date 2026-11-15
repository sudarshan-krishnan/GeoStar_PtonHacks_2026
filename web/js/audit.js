// "Every number shows its work": click an underlined number to see its source,
// retrieval time, formula and label in a side drawer.
//
// info = { title, value, label, source, url, retrieved, formula, inputs: [[name, value]], note }

import { $, h, LABEL_CLASS } from "./util.js";

const drawer = $("#audit");
const scrim = $("#audit-scrim");
let returnFocus = null;

export function auditable(el, getInfo) {
  el._audit = getInfo;
  if (el._auditBound) return;
  el._auditBound = true;
  el.classList.add("auditable");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-haspopup", "dialog");
  el.title = "Where does this number come from?";
  el.addEventListener("click", () => open(el._audit(), el));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(el._audit(), el);
    }
  });
}

function open(info, from) {
  if (!info) return;
  returnFocus = from;
  $("#audit-title").textContent = info.title;
  $("#audit-value").textContent = info.value ?? "";
  const label = $("#audit-label");
  label.textContent = info.label;
  label.className = `chip ${LABEL_CLASS[info.label] || ""}`;

  const list = $("#audit-list");
  list.replaceChildren();
  const row = (term, ...content) => list.append(h("dt", {}, term), h("dd", {}, ...content));
  if (info.source) {
    row("Source", info.url ? h("a", { href: info.url, target: "_blank", rel: "noopener" }, info.source) : info.source);
  }
  if (info.retrieved) row("Retrieved", info.retrieved);
  if (info.formula) row("How it's calculated", h("code", {}, info.formula));
  if (info.inputs?.length) {
    row("Inputs", h("div", { class: "audit-inputs" }, info.inputs.flatMap(([k, v]) => [h("span", {}, k), h("span", {}, v)])));
  }
  if (info.note) row("Keep in mind", info.note);

  scrim.hidden = false;
  drawer.hidden = false;
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    drawer.classList.add("open");
  });
  $("#audit-close").focus();
}

function close() {
  scrim.classList.remove("open");
  drawer.classList.remove("open");
  setTimeout(() => {
    scrim.hidden = true;
    drawer.hidden = true;
  }, 260);
  returnFocus?.focus();
}

$("#audit-close").addEventListener("click", close);
scrim.addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !drawer.hidden) close();
});
