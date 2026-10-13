/**
 * Taohua: the paper surfaces over the painting. Three ways of setting the painting aside for a while,
 * each a sheet of the same paper (styled in taohua.html), its edges rough as a sheet's are: the page,
 * near the whole screen, for reading (the painting set aside); the drawer, from the foot of the screen,
 * for doing something there (the painting still seen above it); the side sheet, from the right and on
 * past the edge, for finding one's way (the painting kept beside it). They're the page's, not the
 * painting's: HTML over the canvas, so text reads, scrolls and is typed as text is.
 *
 * What's shown (an encounter: a station's cast, a cast of one's own, the casting of it, the place and
 * the journal) is kept apart from how it's shown (which surface). Each has a stable identity: a
 * station's is the seed and its number, its cast the hill's, never cast again; a cast of one's own is
 * its question and the hour it was cast in (as the Changes experiment casts: the same question in the
 * same hour, the same figure), and when.
 */
import { classical } from '../changes/classical';
import { castContext, deterministicCast, type CastContext } from '../changes/casting';
import { identify, moving, type Line } from '../changes/model';
import { hash, seeded } from '../kit/rng';

export type Surface = 'page' | 'drawer' | 'side';
export type Tab = 'nearby' | 'journal' | 'settings';
export type Encounter =
  | { kind: 'station'; seed: number; station: number; lines: Line[] }
  | { kind: 'casting'; id: string; date: string; question: string; lines: Line[]; context: CastContext }
  | { kind: 'cast' }
  | { kind: 'atlas'; tab: Tab };
export interface Presentation { surface: Surface; encounter: Encounter }

/** what the painting tells the surfaces: what's about the walker, and its settings */
export interface Place { kind: 'temple' | 'station' | 'landing'; title: string; han?: string; sub: string; dist: number; go?: () => void; read?: Encounter; lines?: Line[] }
export interface World {
  /** the nearest temple's name, for the side sheet's heading */
  here(): string;
  nearby(): Place[];
  ink(): boolean; setInk(on: boolean): void;
}
let world: World | null = null;
export function attach(w: World) { world = w; }

let root: HTMLElement | null = null, open: Presentation | null = null, onChange: (p: Presentation | null) => void = () => {};
/** Whether a surface is open (the painting's taps and keys wait), and whether it covers the painting (so it needn't be drawn). */
export const isOpen = () => !!open;
export const covers = () => !!open && open.surface === 'page' && root?.classList.contains('shown') === true;
export function watch(f: (p: Presentation | null) => void) { onChange = f; }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** (Legge's text, as transcribed, keeps the transcriber's page-break notes: not his words, so left out) */
const clean = (s: string) => esc(s.replace(/\s*\[paragraph continues\]\s*/g, ' '));
const PLACE = ['at the beginning', 'in the second place', 'in the third place', 'in the fourth place', 'in the fifth place', 'at the top'];
/** a line's name, as the classics give it: its number (six, yin; nine, yang) and its place */
const lineName = (v: Line, k: number) => `${v % 2 ? 'Nine' : 'Six'} ${PLACE[k]}`;
/** the figure: six lines, the first at the bottom; a yin line broken; the moving lines vermilion */
const figure = (lines: Line[], cls = 'hx') => `<div class="${cls}" aria-hidden="true">${[...lines].reverse().map((v) => `<i class="${v % 2 ? 'yang' : 'yin'}${moving(v) ? ' moving' : ''}"><b></b><b></b></i>`).join('')}</div>`;
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

// ─── the journal: what's been read on the way, and cast; kept in this browser only ──────────────
const KEY = 'taohua-journal-v1';
type Entry = (Extract<Encounter, { kind: 'station' }> & { date: string }) | Extract<Encounter, { kind: 'casting' }>;
function journal(): Entry[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[]; } catch { return []; } }
function keep(e: Entry) {
  try {
    const all = journal().filter((o) => (e.kind === 'station' ? !(o.kind === 'station' && o.seed === e.seed && o.station === e.station) : !(o.kind === 'casting' && o.id === e.id)));
    all.unshift(e);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch { /* (a journal's a convenience: without storage, nothing's kept) */ }
}

// ─── what each shows, so ─────────────────────────────────────────────────────────────────────────
/** a reading: a station's cast, or one's own */
function reading(e: Extract<Encounter, { kind: 'station' } | { kind: 'casting' }>): string {
  const h = identify(e.lines), moves = e.lines.map((v, k) => (moving(v) ? k : -1)).filter((k) => k >= 0), rel = moves.length ? identify(e.lines, true) : null;
  const t = classical[h.number];
  const passage = (k: number) => `<li><span class="ln ${e.lines[k] % 2 ? 'yang' : 'yin'}${moving(e.lines[k]) ? ' moving' : ''}" aria-hidden="true"><b></b><b></b></span><div><h4>${lineName(e.lines[k], k)}</h4><p>${clean(t.lines[k])}</p></div></li>`;
  const prov = e.kind === 'station'
    ? `<p>Cast on the hill, at its ${ordinal(e.station + 1)} station (seed ${e.seed}): the hill's own, the same each time it's read.</p>`
    : `<p>Cast by you, ${esc(new Date(e.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}: three coins, six times. The same question in the same hour casts the same figure.</p>`;
  return `
    ${e.kind === 'casting' && e.question ? `<p class="query">${esc(e.question)}</p>` : ''}
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
    <section><h3>The Judgment</h3><p class="text">${clean(t.judgment)}</p></section>
    <section><h3>The Image</h3><p class="text">${clean(t.image)}</p></section>
    <hr>
    <section>
      <h3>${moves.length ? 'The changing lines' : 'The figure at rest'}</h3>
      ${moves.length ? `<ol class="lines">${moves.map(passage).join('')}</ol>${moves.length === 6 && t.allChanging ? `<p class="text">${clean(t.allChanging)}</p>` : ''}` : '<p class="note">No line moves here: stay with its image.</p>'}
      <details><summary>All six lines, from the bottom</summary><ol class="lines">${[0, 1, 2, 3, 4, 5].map(passage).join('')}</ol></details>
    </section>
    <hr>
    <section><h3>To sit with</h3><p class="text quiet">${esc(h.prompt)}</p></section>
    <footer>${prov}<p>The Judgment, the Image and the lines from James Legge, <i>The Yî King</i> (1882).</p></footer>`;
}

/** a coin, as the Tang struck them (開元通寶), its face, or its plain back */
const coin = (k: number) => `<div class="coin" data-k="${k}"><svg viewBox="0 0 100 100" aria-hidden="true">
  <g class="face"><circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="40.5"/><rect x="40" y="40" width="20" height="20"/>
    <text x="50" y="31">開</text><text x="50" y="86">元</text><text x="80" y="58">通</text><text x="20" y="58">寶</text></g>
  <g class="back"><circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="40.5"/><rect x="40" y="40" width="20" height="20"/><path d="M38 70 Q50 80 62 70"/></g>
</svg></div>`;
/** the casting: a question, three coins, six throws */
function casting(): string {
  return `
    <h2>Cast a reading</h2>
    <p class="sub">Hold a question, then cast the coins: three, six times, the figure built from the bottom.</p>
    <div class="coins">${coin(0)}${coin(1)}${coin(2)}</div>
    <div class="building">${figure([], 'hx small')}</div>
    <input class="ask" type="text" maxlength="200" autocomplete="off" aria-label="Your question" placeholder="What would you like to ask?">
    <div class="acts"><button class="primary" data-act="cast">Cast the coins</button><button class="quiet" data-act="cancel">Not now</button></div>
    <div class="result"></div>`;
}

/** the side sheet: this place, the journal, the settings */
function atlas(tab: Tab): string {
  const tabs = (['nearby', 'journal', 'settings'] as Tab[]).map((t) => `<button class="tab${t === tab ? ' on' : ''}" data-tab="${t}">${{ nearby: 'Nearby', journal: 'Journal', settings: 'Settings' }[t]}</button>`).join('');
  let body = '';
  if (tab === 'nearby') {
    places = world?.nearby() ?? [];
    body = `<button class="row" data-act="draw"><span class="mk" aria-hidden="true">${coin(9)}</span><span><b>Cast a reading</b><small>Three coins, six times, here</small></span><span class="d">›</span></button>`
      + places.map((p, i) => `<button class="row" data-place="${i}"><span class="mk" aria-hidden="true">${p.lines ? figure(p.lines, 'hx tiny') : `<span lang="zh">${p.kind === 'temple' ? '寺' : '渡'}</span>`}</span><span><b>${esc(p.title)}${p.han ? ` <span lang="zh">${p.han}</span>` : ''}</b><small>${esc(p.sub)}</small></span><span class="d">${p.dist < 1000 ? `${Math.max(5, Math.round(p.dist / 5) * 5)} m` : `${(p.dist / 1000).toFixed(1)} km`}</span></button>`).join('');
  } else if (tab === 'journal') {
    const all = journal();
    body = all.length ? all.map((e, i) => {
      const h = identify(e.lines);
      return `<button class="row" data-entry="${i}"><span class="mk" aria-hidden="true">${figure(e.lines, 'hx tiny')}</span><span><b>${esc(h.title)} <span lang="zh">${h.han}</span></b><small>${e.kind === 'station' ? `Read on the hill, its ${ordinal(e.station + 1)} station` : esc(e.question || 'Cast without a question')} · ${esc(new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</small></span></button>`;
    }).join('') : '<p class="note">Nothing yet. What you read on the hill, and what you cast, is kept here, in this browser only.</p>';
  } else {
    body = `<label class="row set"><span><b>Composition view</b><small>The painting as its masses, in a few inks (墨)</small></span><input type="checkbox" data-set="ink"${world?.ink() ? ' checked' : ''}></label>
      <label class="row set"><span><b>Steps climbed</b><small>Counted at the top of the screen</small></span><input type="checkbox" data-set="steps"${document.body.classList.contains('nosteps') ? '' : ' checked'}></label>
      <a class="row" href="${location.pathname.replace(/\/?$/, '/readme')}"><span><b>About Taohua</b><small>How it's made, and what it's after</small></span><span class="d">›</span></a>`;
  }
  return `<h2>${tab === 'nearby' ? esc(world?.here() ?? 'This place') : tab === 'journal' ? 'The journal' : 'Settings'}</h2><div class="tabs" role="tablist">${tabs}</div><div class="rows">${body}</div>`;
}
/** the places listed in the side sheet as last shown, for a tap on one */
let places: Place[] = [];

function content(p: Presentation): string {
  const e = p.encounter;
  if (e.kind === 'station' || e.kind === 'casting') return reading(e);
  if (e.kind === 'cast') return casting();
  return atlas(e.tab);
}

// ─── the paper's edge: rough, as a sheet's is, cut afresh to each sheet's size ─────────────────────
/**
 * A mask for a sheet so wide and high: its outline a little in from its box, wandering by a pixel or
 * two in small runs, with now and then a nick, as the edge of handmade paper does; from its seed, so
 * the same sheet keeps the same edge.
 */
function roughen(el: HTMLElement, seed: number) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const r = seeded(hash(seed, Math.round(w), Math.round(h))), I = 3.5;
  const pts: string[] = [];
  let drift = 0;
  const jit = () => { drift = drift * 0.72 + (r() - 0.5) * 1.3; return drift + (r() < 0.025 ? -1.8 - r() * 1.8 : 0) + (r() - 0.5) * 0.6; };
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(L / 3));
    for (let i = 0; i < n; i++) { const t = i / n, d = jit(); pts.push(`${(x0 + (x1 - x0) * t + nx * d).toFixed(1)},${(y0 + (y1 - y0) * t + ny * d).toFixed(1)}`); }
  };
  edge(I, I, w - I, I, 0, -1); edge(w - I, I, w - I, h - I, 1, 0); edge(w - I, h - I, I, h - I, 0, 1); edge(I, h - I, I, I, -1, 0);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><polygon points='${pts.join(' ')}' fill='black'/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  el.style.setProperty('-webkit-mask-image', url); el.style.setProperty('mask-image', url);
  el.style.setProperty('-webkit-mask-size', '100% 100%'); el.style.setProperty('mask-size', '100% 100%');
}

// ─── showing, and putting away ───────────────────────────────────────────────────────────────────
const SEEDS: Record<Surface, number> = { page: 11, drawer: 23, side: 37 };
function build() {
  root = document.createElement('div');
  root.id = 'sheets';
  root.innerHTML = '<div class="veil"></div><article class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="paper"></div><div class="grip" aria-hidden="true"></div><button class="x" aria-label="Close">×</button><div class="body"></div></article>';
  document.body.appendChild(root);
  root.querySelector('.veil')!.addEventListener('click', () => dismiss());
  root.querySelector('.x')!.addEventListener('click', () => dismiss());
  addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.stopPropagation(); dismiss(); } }, true);
  addEventListener('resize', () => { if (open) roughen(root!.querySelector('.paper') as HTMLElement, SEEDS[open.surface]); });
  // (what's tapped on a sheet)
  const body = root.querySelector('.body') as HTMLElement;
  body.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest('[data-tab],[data-place],[data-entry],[data-act]') as HTMLElement | null;
    if (!t || !open) return;
    if (t.dataset.tab) present({ surface: 'side', encounter: { kind: 'atlas', tab: t.dataset.tab as Tab } }, true);
    else if (t.dataset.place) {
      const p = places[Number(t.dataset.place)];
      if (p?.read) present({ surface: 'page', encounter: p.read });
      else if (p?.go) { dismiss(); p.go(); }
    } else if (t.dataset.entry) present({ surface: 'page', encounter: journal()[Number(t.dataset.entry)] });
    else if (t.dataset.act === 'draw') present({ surface: 'drawer', encounter: { kind: 'cast' } });
    else if (t.dataset.act === 'cancel') dismiss();
    else if (t.dataset.act === 'cast') void cast();
    else if (t.dataset.act === 'read' && lastCast) present({ surface: 'page', encounter: lastCast });
  });
  body.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.target as HTMLElement).classList.contains('ask')) void cast(); });
  body.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.set === 'ink') world?.setInk(t.checked);
    if (t.dataset.set === 'steps') { document.body.classList.toggle('nosteps', !t.checked); try { localStorage.setItem('taohua-steps', t.checked ? '1' : '0'); } catch { /* */ } }
  });
}
try { if (localStorage.getItem('taohua-steps') === '0') document.body.classList.add('nosteps'); } catch { /* */ }

/** Show it so (`stay`: the same sheet, its content changed in place, as between a side sheet's tabs). */
export function present(p: Presentation, stay = false) {
  if (!root) build();
  const same = stay && open?.surface === p.surface;
  open = p;
  if (p.encounter.kind === 'station') keep({ ...p.encounter, date: new Date().toISOString() });
  const body = root!.querySelector('.body') as HTMLElement;
  body.classList.remove('casting');
  body.innerHTML = content(p);
  if (!same) {
    root!.className = `on ${p.surface}`;
    body.scrollTop = 0;
    requestAnimationFrame(() => { roughen(root!.querySelector('.paper') as HTMLElement, SEEDS[p.surface]); requestAnimationFrame(() => root!.classList.add('shown')); });
    (root!.querySelector('.sheet') as HTMLElement).focus({ preventScroll: true });
  }
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

// ─── the casting ─────────────────────────────────────────────────────────────────────────────────
let lastCast: Extract<Encounter, { kind: 'casting' }> | null = null, busy = false;
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
/**
 * Cast: the question and the hour give the six lines (as the Changes experiment casts); then they're
 * thrown, three coins at a time, the figure built line by line from the bottom: a line's value is the
 * coins' sum, a face two and a plain back three, so a six is three faces, a nine three backs.
 */
async function cast() {
  if (!root || busy || open?.encounter.kind !== 'cast') return;
  busy = true;
  const body = root.querySelector('.body') as HTMLElement, input = body.querySelector('input.ask') as HTMLInputElement;
  const question = input.value.trim(), context = castContext('hourly'), lines = await deterministicCast(question, context);
  body.classList.add('casting');
  input.disabled = true;
  (body.querySelector('.acts') as HTMLElement).style.visibility = 'hidden';
  const coins = [...body.querySelectorAll('.coins .coin')] as HTMLElement[], built: Line[] = [];
  for (let k = 0; k < 6; k++) {
    if (open?.encounter.kind !== 'cast') { busy = false; return; }
    const backs = lines[k] - 6, r = seeded(hash(k, lines[k], question.length + 1));
    const order = [0, 1, 2].map((i) => [i, r()] as [number, number]).sort((a, b) => a[1] - b[1]).map((q) => q[0]);
    coins.forEach((c, i) => { c.classList.remove('back', 'toss'); void c.offsetWidth; c.classList.add('toss'); c.classList.toggle('back', order.indexOf(i) < backs); });
    await wait(780);
    built.push(lines[k]);
    (body.querySelector('.building') as HTMLElement).innerHTML = figure(built, 'hx small');
    await wait(280);
  }
  const h = identify(lines), rel = lines.some(moving) ? identify(lines, true) : null;
  lastCast = { kind: 'casting', id: `${context.window}|${context.zone}|${question}`, date: new Date().toISOString(), question, lines, context };
  keep(lastCast);
  (body.querySelector('.acts') as HTMLElement).style.display = 'none';
  (body.querySelector('.result') as HTMLElement).innerHTML = `<p class="got"><span lang="zh">${h.han}${rel ? ` 之 ${rel.han}` : ''}</span> · <i>${esc(h.title)}</i>${rel ? ` → <i>${esc(rel.title)}</i>` : ''}</p><div class="acts"><button class="primary" data-act="read">Read it</button><button class="quiet" data-act="cancel">Later</button></div><p class="note">Kept in the journal.</p>`;
  busy = false;
}
