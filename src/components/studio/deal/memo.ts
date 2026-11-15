// Printable investment memo for one CoStar property: POST /intel/tools/generate_investment_memo, rendered as a clean
// page the browser can print or save as PDF. Every figure comes from the tool's result; nothing is computed here.
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';

const usd = (n: unknown) => (typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n) : 'Unknown');
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Memo {
  title: string; recommendation: string; because: string; rule: string; disclaimer: string; irr_note?: string;
  property: { parcel_id: string; type?: string; lot_acres?: number; building_sf?: number; year_built?: number; source: string };
  acquisition: { value?: number | null; label?: string; basis?: string; comps_used?: number; comps_stale?: number };
  development: Record<string, number | string | null>;
  diligence: { area: string; gap: string; severity: string }[];
}

/** Opens the memo in a new window and starts the print dialog. Returns an error message, or null on success. */
export async function openInvestmentMemo(parcelId: string, mwIt: number, rackKw: number): Promise<string | null> {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return 'The browser blocked the memo window. Allow pop-ups for this page.';
  w.document.write('<p style="font:14px system-ui;margin:40px">Building the investment memo from CoStar records…</p>');
  try {
    const r = await fetch(`${PUBLIC_DATA_API}/intel/tools/generate_investment_memo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parcel_id: parcelId, mw_it: mwIt, rack_kw: rackKw }) });
    const env = await r.json();
    if (!r.ok || !env.ok) throw new Error(env?.error ?? env?.detail ?? `HTTP ${r.status}`);
    const m = env.data as Memo, d = m.development;
    const gaps = m.diligence.map((g) => `<li><b>${esc(g.area)}</b> <small>${esc(g.severity)}</small>: ${esc(g.gap)}</li>`).join('');
    const sources = (env.sources as string[]).slice(0, 40).map((x) => `<li>${esc(x)}</li>`).join('');
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.title)}</title>
<style>body{font:13px/1.55 -apple-system,Segoe UI,system-ui,sans-serif;color:#18231d;margin:40px;max-width:760px}h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:12px;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.1em;color:#264d39}dl{display:grid;grid-template-columns:200px 1fr;gap:4px 16px;margin:0}dt{color:#747f78}dd{margin:0}
.rec{font-size:17px;font-weight:600;color:#264d39;margin:10px 0 2px}small{color:#747f78}ul{padding-left:18px}.note{color:#747f78;font-size:11.5px;margin-top:28px;border-top:1px solid #dfe3da;padding-top:12px}</style></head><body>
<h1>${esc(m.title)}</h1><small>PlotStar investment memo · CoStar property ${esc(m.property.parcel_id)} · ${new Date().toLocaleDateString()}</small>
<p class="rec">${esc(m.recommendation)}</p><p>Because ${esc(m.because)}.<br><small>Rule: ${esc(m.rule)}</small></p>
<h2>Property (CoStar)</h2><dl><dt>Type</dt><dd>${esc(m.property.type ?? 'Unknown')}</dd><dt>Lot</dt><dd>${esc(m.property.lot_acres ?? 'Unknown')} acres</dd>
<dt>Building</dt><dd>${m.property.building_sf ? esc(Math.round(m.property.building_sf).toLocaleString()) + ' sf' : 'Unknown'}${m.property.year_built ? ', built ' + esc(m.property.year_built) : ''}</dd><dt>Record</dt><dd><small>${esc(m.property.source)}</small></dd></dl>
<h2>Acquisition</h2><dl><dt>Value</dt><dd>${esc(usd(m.acquisition.value))} <small>(${esc(m.acquisition.label)})</small></dd><dt>Basis</dt><dd>${esc(m.acquisition.basis)}</dd>
${m.acquisition.comps_used != null ? `<dt>Comparable sales used</dt><dd>${esc(m.acquisition.comps_used)} (${esc(m.acquisition.comps_stale ?? 0)} older ones shown but not used)</dd>` : ''}</dl>
<h2>Development (PlotStar model)</h2><dl><dt>Concept</dt><dd>${esc(d.concept)}</dd><dt>Build cost</dt><dd>${esc(usd(d.capex))}</dd><dt>Total investment</dt><dd>${esc(usd(d.total_investment))}</dd>
<dt>NPV P50 (P10 to P90)</dt><dd>${esc(usd(d.npv))} (${esc(usd(d.npv_p10))} to ${esc(usd(d.npv_p90))})</dd><dt>Payback</dt><dd>${d.payback_years != null ? esc(d.payback_years) + ' years' : 'Not within the analysis period'}</dd>
<dt>Months to power</dt><dd>${esc(d.months_to_power)}</dd></dl><p><small>${esc(m.irr_note ?? '')}</small></p>
<h2>Diligence still required</h2><ul>${gaps}</ul>
<h2>Sources</h2><ul><small>${sources}</small></ul>
<p class="note">${esc(m.disclaimer)}</p><script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
    w.document.close();
    return null;
  } catch (e) {
    w.document.open();
    w.document.write(`<p style="font:14px system-ui;margin:40px;color:#b3362b">Could not build the memo: ${esc((e as Error).message)}</p>`);
    w.document.close();
    return (e as Error).message;
  }
}
