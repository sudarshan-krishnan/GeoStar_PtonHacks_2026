'use client';
// A small, safe Markdown renderer for agent answers: headings, paragraphs, bullet and numbered lists, **bold** and
// `code`. Text is rendered as React text nodes (never as HTML), so model output cannot inject markup.
import type { ReactNode } from 'react';

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${key}-${i++}`}>{t.slice(2, -2)}</b> : <code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>); para = []; } };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inline(it, `l${blocks.length}-${j}`)}</li>);
    blocks.push(list.ordered ? <ol key={`l${blocks.length}`}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const ln = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    const b = /^\s*[-*•]\s+(.*)$/.exec(ln);
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(ln);
    if (!ln.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push(<h4 key={`h${blocks.length}`}>{inline(h[2], `h${blocks.length}`)}</h4>); continue; }
    if (b || n) {
      flushPara();
      const ordered = !!n;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((b ?? n)![1]);
      continue;
    }
    flushList();
    para.push(ln.trim());
  }
  flushPara(); flushList();
  return <div className={className}>{blocks}</div>;
}
