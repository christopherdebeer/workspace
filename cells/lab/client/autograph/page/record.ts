/** The record, grouped by the book's chapters: the sessions each chapter tells, and those no chapter tells yet. A session
 * is a line until it's opened; opened, its findings and decisions, and its samples, each made by its hand then and
 * writing itself out as it comes into view. */
import { CATALOG, SESSIONS } from '../catalog';
import { BOOK } from '../autobiography';
import { Card, card } from './cards';
import { esc } from './ui';

/** the parts of the record: each chapter's sessions (from the one after the last chapter was written to the one before
 * this one was), and then the sessions no chapter tells yet */
export function parts() {
  const latest = SESSIONS[SESSIONS.length - 1].n, out: { title: string; label: string; from: number; to: number; chapter?: number }[] = [];
  let from = 1;
  for (const c of [...BOOK.chapters].sort((a, b) => a.n - b.n)) { out.push({ title: c.title, label: `Chapter ${c.n} · sessions ${from}–${c.session - 1}`, from, to: c.session - 1, chapter: c.n }); from = c.session; }
  if (from <= latest) out.push({ title: 'Not yet written', label: `Chapter ${BOOK.chapters.length + 1} · sessions ${from}–${latest}`, from, to: latest });
  return out;
}

/** `scripts`: the font's scripts for type in time, which a sample set in time needs before it's built */
export function buildRecord(list: HTMLElement, scripts: Promise<void>) {
  const cards: Card[] = [];
  const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { cards.find((c) => c.el === e.target)?.write(); seen.unobserve(e.target); } }, { threshold: 0.35 });
  const latest = SESSIONS[SESSIONS.length - 1];
  const jump = document.createElement('p');
  jump.className = 'jump';
  jump.innerHTML = `${SESSIONS.length} sessions, from the first, grouped by the chapters of the book that tell them. <a href="#session-${latest.n}">The latest, session ${latest.n}: ${esc(latest.title)} ↓</a>`;
  list.append(jump);
  const groups: { el: HTMLDetailsElement; from: number; to: number }[] = [], fills = new Map<number, () => Promise<void>>();
  for (const p of parts()) {
    const g = document.createElement('details');
    g.className = 'part-group';
    g.innerHTML = `<summary><span>${esc(p.label)}</span>${esc(p.title)}</summary>${p.chapter ? `<p class="read"><a href="#chapter-${p.chapter}">Read chapter ${p.chapter} in the book →</a></p>` : '<p class="read">Its chapter will be written at the end of the work it covers.</p>'}`;
    for (const s of SESSIONS.filter((x) => x.n >= p.from && x.n <= p.to)) {
      const d = document.createElement('details');
      d.className = 'session'; d.id = `session-${s.n}`;
      d.innerHTML = `<summary><span>Session ${s.n} · ${esc(s.date)}</span>${esc(s.title)}</summary>`;
      let filled = false;
      const fill = () => {
        if (filled) return;
        filled = true;
        const body = document.createElement('div');
        body.className = 'body';
        body.innerHTML = `<p>${esc(s.summary)}</p><div class="decided"><b>Decided</b><ol>${s.decided.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>${BOOK.chapters.filter((c) => c.session === s.n).map((c) => `<p class="read">In this session I wrote chapter ${c.n} of the book, <a href="#chapter-${c.n}"><i>${esc(c.title)}</i> →</a></p>`).join('')}`;
        d.append(body);
        const mine = CATALOG.filter((e) => e.session === s.n).map(card);
        for (const c of mine) { body.append(c.el); cards.push(c); }
        for (const c of mine) { c.size(); seen.observe(c.el); }
      };
      // (a session with a sample set in time waits for the scripts; one without needn't)
      const timedHere = CATALOG.some((e) => e.session === s.n && e.type?.some((l) => l.way === 'time'));
      d.addEventListener('toggle', () => { if (d.open) { if (timedHere) void scripts.then(fill); else fill(); } });
      fills.set(s.n, async () => { if (timedHere) await scripts; fill(); });
      g.append(d);
    }
    list.append(g);
    groups.push({ el: g, from: p.from, to: p.to });
  }
  /** open the part and the session a place is in (a session, or a sample by its id), and give back the element */
  const open = async (target: string): Promise<HTMLElement | null> => {
    const m = /^session-(\d+)$/.exec(target), n = m ? Number(m[1]) : CATALOG.find((e) => e.id === target)?.session;
    if (n == null) return null;
    const g = groups.find((x) => n >= x.from && n <= x.to);
    if (g) g.el.open = true;
    const d = document.getElementById(`session-${n}`) as HTMLDetailsElement | null;
    if (d) { d.open = true; await fills.get(n)?.(); }
    return document.getElementById(target);
  };
  // (the part being written now, open; its latest session too)
  groups[groups.length - 1].el.open = true;
  return { open, size: () => { for (const c of cards) c.size(); } };
}
