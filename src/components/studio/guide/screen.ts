// What the PlotStar Guide can see and touch on the page. Read-only scanning of the DOM: visible controls get a stable
// target id the voice agent can name ("step:analyze", "code:DH-01", "btn:generate-layouts"). Nothing here sends the
// page anywhere; the agent receives only the short labels this module returns.

export interface Target { id: string; kind: 'step' | 'code' | 'button' | 'tab' | 'field' | 'link'; label: string; disabled?: boolean; risky?: boolean }

/** Labels that change or save something. Clicking one needs the user's spoken yes. */
const RISKY = /\b(apply|save|generate|delete|remove|undo|reset|discard|decide|record|rotate|use site|yes, apply|open)\b/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const lab = el.closest('label')?.querySelector('span')?.textContent || el.getAttribute('placeholder') || el.name;
    return (lab || 'field').trim();
  }
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export class Screen {
  private els = new Map<string, Element>();

  constructor(private root: () => ParentNode = () => document) {}

  /** Visible things the guide can point at or click. Rebuilt on every call so ids follow the page. */
  scan(): Target[] {
    this.els.clear();
    const out: Target[] = [];
    const used = new Set<string>();
    const add = (el: Element, kind: Target['kind'], label: string, id?: string) => {
      if (!label || el.closest('[data-guide-ui]') || !visible(el)) return;
      let tid = id ?? `${kind === 'button' ? 'btn' : kind}:${slug(label)}`;
      for (let n = 2; used.has(tid); n++) tid = `${id ?? `${kind === 'button' ? 'btn' : kind}:${slug(label)}`}-${n}`;
      used.add(tid);
      this.els.set(tid, el);
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('locked');
      out.push({ id: tid, kind, label, ...(disabled ? { disabled: true } : {}), ...(kind === 'button' && RISKY.test(label) ? { risky: true } : {}) });
    };
    const root = this.root();
    root.querySelectorAll('.st-rail li').forEach((li) => add(li, 'step', li.querySelector('b')?.textContent?.trim() ?? '', `step:${slug(li.querySelector('b')?.textContent ?? '')}`));
    root.querySelectorAll('[data-code]').forEach((g) => add(g, 'code', g.getAttribute('data-code')!, `code:${g.getAttribute('data-code')!.toLowerCase()}`));
    root.querySelectorAll('.st-tabs button, .st-seg button').forEach((b) => add(b, 'tab', labelOf(b)));
    root.querySelectorAll('button, a[href], [role="button"]').forEach((b) => {
      if (b.closest('.st-rail, .st-tabs, .st-seg')) return;
      add(b, b.tagName === 'A' ? 'link' : 'button', labelOf(b));
    });
    root.querySelectorAll('input, select, textarea').forEach((f) => add(f, 'field', labelOf(f)));
    return out;
  }

  /** Resolve what the agent said: an exact id, a step name, a plan code, or a label it heard. */
  find(target: string): { el: Element; t: Target } | null {
    const list = this.scan();
    const q = target.trim().toLowerCase();
    const hit = list.find((t) => t.id === q)
      ?? list.find((t) => t.kind === 'step' && t.label.toLowerCase() === q.replace(/^step:/, ''))
      ?? list.find((t) => t.kind === 'code' && t.label.toLowerCase() === q.replace(/^code:/, ''))
      ?? list.find((t) => t.label.toLowerCase() === q)
      ?? list.find((t) => t.label.toLowerCase().includes(q) || t.id.includes(slug(q)));
    return hit ? { el: this.els.get(hit.id)!, t: hit } : null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Click like a person: in view, pointer events, then click(). SVG groups (plan rooms) get a bubbling click event. */
export async function realClick(el: Element) {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  await sleep(250);
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  el.dispatchEvent(new MouseEvent('mousedown', at));
  el.dispatchEvent(new PointerEvent('pointerup', at));
  el.dispatchEvent(new MouseEvent('mouseup', at));
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', at));
}
