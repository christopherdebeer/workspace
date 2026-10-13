/**
 * Taohua: the paper surfaces over the painting. Three ways of setting the painting aside for a while,
 * each a sheet of the same paper (styled in taohua.html): the page, near the whole screen, for reading
 * (the painting set aside); the drawer, from the foot of the screen, for doing something there (the
 * painting still seen above it); the side sheet, from an edge and on past it, for finding one's way
 * (the painting kept beside it). They're the page's, not the painting's: HTML over the canvas, so long
 * text reads and scrolls as text does.
 *
 * What's shown (an encounter: a station's cast, a place, the journal) is kept apart from how it's
 * shown (which surface), so the same thing can be shown more than one way. Each encounter has a stable
 * identity: a station's is the seed and its number, and its cast is the hill's, never cast again.
 */
import { classical } from '../changes/classical';
import { identify, moving, type Line } from '../changes/model';

export type Surface = 'page' | 'drawer' | 'side';
export type Encounter = { kind: 'station'; seed: number; station: number; lines: Line[] };
export interface Presentation { surface: Surface; encounter: Encounter }

let root: HTMLElement | null = null, open: Presentation | null = null, onChange: (p: Presentation | null) => void = () => {};
/** Whether a surface is open (the painting's taps and keys wait), and whether it covers the painting (so it needn't be drawn). */
export const isOpen = () => !!open;
export const covers = () => !!open && open.surface === 'page' && root?.classList.contains('shown') === true;
export function watch(f: (p: Presentation | null) => void) { onChange = f; }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PLACE = ['at the beginning', 'in the second place', 'in the third place', 'in the fourth place', 'in the fifth place', 'at the top'];
/** a line's name, as the classics give it: its number (six, yin; nine, yang) and its place */
const lineName = (v: Line, k: number) => `${v % 2 ? 'Nine' : 'Six'} ${PLACE[k]}`;
/** the figure: six lines, the first at the bottom; a yin line broken; the moving lines vermilion */
function figure(lines: Line[]) {
  return `<div class="hx" aria-hidden="true">${[...lines].reverse().map((v) => `<i class="${v % 2 ? 'yang' : 'yin'}${moving(v) ? ' moving' : ''}"><b></b><b></b></i>`).join('')}</div>`;
}

/** what an encounter says, shown so */
function content(p: Presentation): string {
  const e = p.encounter;
  const h = identify(e.lines), moves = e.lines.map((v, k) => (moving(v) ? k : -1)).filter((k) => k >= 0), rel = moves.length ? identify(e.lines, true) : null;
  const t = classical[h.number];
  const passage = (k: number) => `<li><span class="ln ${e.lines[k] % 2 ? 'yang' : 'yin'}${moving(e.lines[k]) ? ' moving' : ''}" aria-hidden="true"><b></b><b></b></span><div><h4>${lineName(e.lines[k], k)}</h4><p>${esc(t.lines[k])}</p></div></li>`;
  return `
    <header class="head">
      ${figure(e.lines)}
      <div>
        <div class="num">${h.number}${rel ? ` → ${rel.number}` : ''}</div>
        <h1 lang="zh">${h.han}${rel ? `<span class="zhi">之</span>${rel.han}` : ''}</h1>
        <p class="en"><i>${esc(h.title)}</i>${rel ? ` → <i>${esc(rel.title)}</i>` : ''}</p>
        <p class="pin">${esc(h.pinyin)}${rel ? ` · ${esc(rel.pinyin)}` : ''}</p>
      </div>
    </header>
    <hr>
    <section><h3>The Judgment</h3><p class="text">${esc(t.judgment)}</p></section>
    <section><h3>The Image</h3><p class="text">${esc(t.image)}</p></section>
    <hr>
    <section>
      <h3>${moves.length ? 'The changing lines' : 'The figure at rest'}</h3>
      ${moves.length ? `<ol class="lines">${moves.map(passage).join('')}</ol>${moves.length === 6 && t.allChanging ? `<p class="text">${esc(t.allChanging)}</p>` : ''}` : '<p class="note">No line moves here: stay with its image.</p>'}
      <details><summary>All six lines, from the bottom</summary><ol class="lines">${[0, 1, 2, 3, 4, 5].map(passage).join('')}</ol></details>
    </section>
    <hr>
    <section><h3>To sit with</h3><p class="text quiet">${esc(h.prompt)}</p></section>
    <footer><p>Cast on the hill, at its ${ordinal(e.station + 1)} station (seed ${e.seed}): the hill's own, the same each time it's read.</p><p>The Judgment, the Image and the lines from James Legge, <i>The Yî King</i> (1882).</p></footer>`;
}
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/** Show it so. */
export function present(p: Presentation) {
  if (!root) {
    root = document.createElement('div');
    root.id = 'sheets';
    root.innerHTML = '<div class="veil"></div><article class="sheet" role="dialog" aria-modal="true" tabindex="-1"><button class="x" aria-label="Close">×</button><div class="body"></div></article>';
    document.body.appendChild(root);
    root.querySelector('.veil')!.addEventListener('click', () => dismiss());
    root.querySelector('.x')!.addEventListener('click', () => dismiss());
    addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.stopPropagation(); dismiss(); } }, true);
  }
  open = p;
  root.className = `on ${p.surface}`;
  const body = root.querySelector('.body') as HTMLElement;
  body.innerHTML = content(p);
  body.scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => root!.classList.add('shown')));
  (root.querySelector('.sheet') as HTMLElement).focus({ preventScroll: true });
  onChange(p);
}
/** Put it away. */
export function dismiss() {
  if (!root || !open) return;
  open = null;
  root.classList.remove('shown');
  onChange(null);
  setTimeout(() => { if (!open && root) root.className = ''; }, 420);
}
