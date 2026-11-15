// The AI-ready passport: one printable page per building, built from the same data as the
// main page plus what this browser saved (the inspection findings and the hardware pause).

import { $, h, fmt, ICON, hourShort } from "./util.js";
import { getJSON } from "./data.js";
import { load, sqft, mva, VERDICT, STATUS, rulesHeadline } from "./store.js";

$("#pp-print").addEventListener("click", () => window.print());

const SOURCE_NAME = { record: "CoStar record", aerial: "Aerial photo", scan: "3D scan", flood: "Flood map", grid: "Grid", pauses: "Pause budget" };

(async function start() {
  const id = Number(new URLSearchParams(location.search).get("id"));
  let sites, pb;
  try {
    [sites, pb] = await Promise.all([getJSON("data/costar-sites.json", 15000), getJSON("data/pause-budget.json", 15000)]);
  } catch {
    $("#sheet").replaceChildren(h("p", {}, "CoStar's data isn't on this machine, so there is no passport to show."));
    return;
  }
  const s = sites.sites.find((x) => x.id === id) || sites.sites.find((x) => x.ready.stage === 3);
  const insp = load("inspection", s.id);
  const ver = load("verified", s.id);
  const caps = load("captures", s.id) || [];
  document.title = `SiteStar passport · ${s.name}`;

  const b = s.building, p = s.power, sc = s.screen;
  const v = VERDICT[s.ready.verdict];
  const pod = insp?.pod || s.first_phase_mw || 10;
  const flex = insp?.flex ?? 0.5;
  const have = (p.service_kva || 0) / 1000;
  const saved = pod * 1000 * flex * pb.tcrf.per_kw_year;
  const sm = pb.summary;
  const shots = (s.media?.scans || []).flatMap((x) => x.images);
  const doll = shots.find((i) => i.kind === "photo") || shots[0];
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const label = (t) => h("span", { class: `chip ${{ Measured: "chip-measured", Sourced: "chip-sourced", Estimated: "chip-estimated", Simulated: "chip-simulated" }[t] || ""}` }, t);

  $("#sheet").replaceChildren(
    h("header", { class: "pp-head" },
      h("div", { class: "pp-brand" },
        h("span", { class: "brand", html: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2l3.6 9.4L29 13l-7.2 6.4L24 29l-8-5-8 5 2.2-9.6L3 13l9.4-1.6z"/></svg>SiteStar' }),
        h("p", { class: "kicker" }, "AI-ready passport")),
      h("p", { class: "pp-meta" }, `${today} · CoStar property ${s.id} · finalist #${s.rank} of ${sites.summary.funnel.finalists}`)),

    h("section", { class: "pp-title" },
      h("div", {},
        h("h1", {}, s.name),
        h("p", { class: "pp-sub" }, `${s.address} · ${s.use} · ${sqft(b.gross_sf || s.building_sf)}${b.year_built ? ` · built ${b.year_built}` : ""}`)),
      h("span", { class: `verdict-badge stamp ${v.cls}` }, v.text)),
    h("p", { class: "pp-headline" }, insp?.headline || rulesHeadline(s),
      h("span", { class: "fine" }, insp?.how === "agent" || insp?.how === "replay" ? `  Findings by Claude (${insp.model}); verdict by SiteStar's fixed rules.` : "  Verdict by SiteStar's fixed rules.")),

    h("section", { class: "pp-images" },
      s.media?.aerial ? h("figure", {}, h("img", { src: s.media.aerial.file, alt: `Aerial photo of ${s.name}` }),
        h("figcaption", {}, `From above · ${s.media.aerial.source}, ${s.media.aerial.side_m} m across, north up`)) : null,
      doll ? h("figure", {}, h("img", { src: doll.file, alt: `3D scan of ${s.name}` }),
        h("figcaption", {}, "Inside · from the public Matterport scan on CoStar's list")) : null),

    h("section", { class: "pp-cols" },
      h("div", {},
        h("h2", {}, "Readiness checklist"),
        h("table", { class: "pp-table" },
          h("tbody", {}, s.ready.items.map((i) => h("tr", { class: `ck-${i.status}` },
            h("td", { class: "pp-ic", html: ICON[STATUS[i.status].icon] }),
            h("td", {}, i.name),
            h("td", { class: "pp-v" }, i.value),
            h("td", { class: "pp-w" }, STATUS[i.status].word),
            h("td", {}, label(i.label)))))),
        h("p", { class: "fine" }, "Pass, Work (a conversion item), Fail (a hard limit), Verify (not in the data: check on site).")),
      h("div", {},
        h("h2", {}, "Power and pauses"),
        h("dl", { class: "pp-dl" },
          h("dt", {}, "Service today"), h("dd", {}, p.service_kva ? `≈${mva(p.service_kva)}${p.volts_assumed ? " (480 V assumed)" : ""}` : p.heavy ? "Heavy power, size not recorded" : "Not recorded"),
          h("dt", {}, "First phase"), h("dd", {}, `${pod} MW`),
          h("dt", {}, "From the grid"), h("dd", {}, p.service_kva ? `${Math.max(0, pod - have).toFixed(1)} MW` : "Utility check first"),
          h("dt", {}, "Nearest 345 kV line"), h("dd", {}, sc.line345_km != null ? fmt.dist(sc.line345_km) : "—"),
          h("dt", {}, "Nearest substation"), h("dd", {}, sc.substation ? `${fmt.dist(sc.substation.km)}${sc.substation.kv ? ` · ${sc.substation.kv} kV` : ""}` : "—"),
          h("dt", {}, `Pause hours (${pb.year})`), h("dd", {}, `${sm.pause_hours} h · ${fmt.pct(sm.share_of_year, 1)} of the year · ${pb.peaks_caught} of 4 summer peaks`),
          h("dt", {}, "Charge avoided"), h("dd", {}, `≈$${fmt.int(saved / 1000)}K a year `, label("Estimated"))),
        h("p", { class: "fine" }, `${fmt.pct(flex)} of the load pauses. Peaks: ${pb.peaks.map((x) => `${new Date(`${x.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hourShort(x.hour)}`).join(", ")}. Distance to the grid is not capacity.`))),

    h("section", { class: "pp-cols" },
      h("div", {},
        h("h2", {}, "Inspection findings"),
        insp?.observations?.length
          ? h("ul", { class: "pp-obs" }, insp.observations.map((o) => h("li", {}, h("strong", {}, `${SOURCE_NAME[o.source] || o.source}: `), o.text)))
          : h("p", { class: "fine" }, insp ? "Rules-only inspection: no model findings." : "Run the inspection on the SiteStar page to add findings."),
        insp?.conversion_items?.length ? h("div", {}, h("h3", {}, "Conversion work"), h("ul", {}, insp.conversion_items.map((t) => h("li", {}, t)))) : null,
        insp?.open_questions?.length ? h("div", {}, h("h3", {}, "Verify on site"), h("ul", {}, insp.open_questions.map((t) => h("li", {}, t)))) : null),
      h("div", {},
        h("h2", {}, "Pause, verified on hardware"),
        ver
          ? h("div", { class: "pp-ver" },
            h("p", { class: "pp-ver-head" }, h("span", { class: "pp-ok", html: ICON.check }), `Paused ${ver.change_pct != null ? `${Math.abs(ver.change_pct).toFixed(0)}% ` : ""}${ver.response_s != null ? `in ${ver.response_s.toFixed(1)} s` : ""}`, label(ver.label)),
            h("dl", { class: "pp-dl" },
              h("dt", {}, "Record"), h("dd", {}, `Grid Passport #${ver.event}, ${new Date(ver.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`),
              h("dt", {}, "SiteStar machine"), h("dd", {}, `${ver.before_w ?? "—"} → ${ver.during_w ?? "—"} W`),
              h("dt", {}, "Flat machine"), h("dd", {}, ver.flat_change_pct != null ? `${ver.flat_change_pct > 0 ? "+" : ""}${ver.flat_change_pct.toFixed(0)}%` : "—"),
              h("dt", {}, "Job"), h("dd", {}, ver.job_finished ? "Finished" : "Still running at the end of the event")),
            h("p", { class: "fine" }, "The machines show how a workload responds to a grid signal; they do not prove a multi-megawatt interconnection."))
          : h("p", { class: "fine" }, "Not yet verified. Trigger a grid event in the Prove section with this building selected."))),

    caps.length ? h("section", { class: "pp-caps" },
      h("h2", {}, "On-site frames from the drone"),
      h("div", { class: "pp-caps-grid" }, caps.slice(0, 6).map((c) => h("figure", {},
        h("img", { src: c.url, alt: `Drone frame, ${new Date(c.time * 1000).toLocaleString("en-US")}` }),
        h("figcaption", {}, label(c.simulated ? "Simulated" : "Measured"), " ",
          new Date(c.time * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })))))) : null,

    h("footer", { class: "pp-foot" },
      h("p", {}, "Sources: CoStar Data Extract (HackPrinceton kit) · Matterport public scans · Esri World Imagery · FEMA National Flood Hazard Layer · OpenStreetMap · ERCOT Native Load 2025 · CenterPoint TCRF (as listed)."),
      h("p", {}, "Labels: Sourced (named dataset), Estimated (documented method or AI observation), Measured or Simulated (our hardware). Not a utility study, an appraisal or an engineering report.")),
  );
})();
