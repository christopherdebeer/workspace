/**
 * Seals: the page. Pick a suit, a card, a seed; turn the suit's hyperparameters and watch the
 * family move. Every drawing comes from seal.ts (pure), so what is tuned here ports to the game
 * as a style object: "Copy style" gives the JSON.
 *
 * Query: suit=0..3 · rank=0 (bare) | 1..10 · seed=<name or number> · view=one|suit|suits|seeds|shapes ·
 * faces=shown|hidden|zones · overlay (the fill's discs) · label=<text> (the shapes' label) ·
 * <h|d|c|s>.<key>=<value> for a style override · preview (four suits, no controls).
 */
import { SHAPES, facesOf } from '../markovs/deck';
import { randomSeed, seedFrom, seedName } from '../kit/rng';
import { card as drawCard, type FacesMode } from './seal';
import { SHAPE_KINDS, shapeTile } from './shapes';
import type { Evenness } from './pack';
import { SCHEMA, SUIT_STYLES, type Control, type Style } from './styles';

const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);
const SUIT_KEYS = ['h', 'd', 'c', 's'];
const SUIT_GLYPHS = ['♥', '♦', '♣', '♠'];
const ROMAN = ['', 'A', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
type View = 'one' | 'suit' | 'suits' | 'seeds' | 'shapes';
const VIEWS: View[] = ['one', 'suit', 'suits', 'seeds', 'shapes'];
const MODES: FacesMode[] = ['shown', 'hidden', 'zones'];

const state = {
  suit: clampInt(qs.get('suit'), 0, 3, 3),
  rank: clampInt(qs.get('rank'), 0, 10, 3),
  seed: seedFrom(qs.get('seed')) ?? 1,
  view: (VIEWS.includes(qs.get('view') as View) ? qs.get('view') : 'one') as View,
  mode: (MODES.includes(qs.get('faces') as FacesMode) ? qs.get('faces') : 'shown') as FacesMode,
  overlay: qs.has('overlay'),
  label: qs.get('label') ?? 'Markovs',
  over: [{}, {}, {}, {}] as Array<Partial<Style>>,
};
function clampInt(v: string | null, lo: number, hi: number, d: number) {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
}
// overrides from the query: h.rings=5
for (const [k, v] of qs) {
  const m = /^([hdcs])\.(\w+)$/.exec(k);
  const c = m && SCHEMA.find((x) => x.key === m[2]);
  if (m && c) (state.over[SUIT_KEYS.indexOf(m[1])] as Record<string, unknown>)[c.key] = parse(c, v);
}
function parse(c: Control, v: string): unknown {
  if (c.kind === 'num') return Number(v);
  if (c.kind === 'bool') return v === '1' || v === 'true';
  if (c.kind === 'enum') return typeof c.options![0] === 'number' ? Number(v) : v;
  return v;
}
const styleOf = (suit: number): Style => ({ ...SUIT_STYLES[suit], ...state.over[suit] });
const facesFor = (suit: number, rank: number) => (rank ? facesOf({ suit, rank }) : null);
const titleFor = (suit: number, rank: number) => (rank ? `${ROMAN[rank]} · ${rank === 1 ? 'WILD' : SHAPES[rank].name}` : `${SUIT_STYLES[suit].name.toUpperCase()}`);
let uid = 0;
let lastStats: string[] = [];
const fmtStats = (name: string, e: Evenness) => `${name}: ${e.n} discs · coverage ${Math.round(e.coverage * 100)}% · gap mean ${e.meanGap} · p95 ${e.p95Gap} · max ${e.maxGap}`;
const card = (suit: number, rank: number, seed: number, label = '') => {
  const c = drawCard({ stats: state.view === 'one', style: styleOf(suit), seed, faces: facesFor(suit, rank), title: titleFor(suit, rank), id: `k${uid++}`, mode: state.mode, overlay: state.overlay });
  lastStats = [fmtStats('seal', c.seal.stats), ...(c.border ? [fmtStats('border', c.border.stats)] : [])];
  return `<figure class="card">${c.svg}${label ? `<figcaption>${label}</figcaption>` : ''}</figure>`;
};

if (qs.has('preview')) {
  document.documentElement.classList.add('preview');
  $('cards').className = 'cards grid4';
  $('cards').innerHTML = [0, 1, 2, 3].map((s) => card(s, 3, state.seed)).join('');
} else start();

function start() {
  // suits and ranks
  $('suits').innerHTML = SUIT_GLYPHS.map((g, i) => `<button data-suit="${i}" aria-label="${SUIT_STYLES[i].name}">${g}</button>`).join('');
  $('ranks').innerHTML = ['—', ...ROMAN.slice(1)].map((r, i) => `<button data-rank="${i}" aria-label="${i ? `rank ${r}` : 'bare seal'}">${i === 0 ? 'seal' : r}</button>`).join('');
  $('views').innerHTML = VIEWS.map((v) => `<button data-view="${v}">${{ one: 'One', suit: 'The suit', suits: 'Four suits', seeds: 'Six seeds', shapes: 'Shapes' }[v]}</button>`).join('');
  $('modes').innerHTML = `<span class="lbl">Faces</span>${MODES.map((m) => `<button data-mode="${m}">${m}</button>`).join('')}<button id="overlay" aria-pressed="${state.overlay}">discs</button>`;
  const lab = $('label') as HTMLInputElement;
  lab.value = state.label;
  lab.addEventListener('input', () => { state.label = lab.value.slice(0, 40); schedule(); });
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.suit) { state.suit = Number(b.dataset.suit); buildControls(); }
    else if (b.dataset.rank) state.rank = Number(b.dataset.rank);
    else if (b.dataset.view) state.view = b.dataset.view as View;
    else if (b.dataset.mode) state.mode = b.dataset.mode as FacesMode;
    else if (b.id === 'overlay') state.overlay = !state.overlay;
    else if (b.id === 'prev') state.seed = Math.max(0, state.seed - 1);
    else if (b.id === 'next') state.seed += 1;
    else if (b.id === 'dice') state.seed = randomSeed();
    else if (b.id === 'reset') { state.over[state.suit] = {}; buildControls(); }
    else if (b.id === 'copy') { void navigator.clipboard?.writeText(JSON.stringify(styleOf(state.suit), null, 2)); flash('Style copied'); return; }
    else if (b.id === 'svg') { download(); return; }
    else return;
    render();
  });
  buildControls();
  render();
}

function buildControls() {
  const s = styleOf(state.suit);
  const groups = [...new Set(SCHEMA.map((c) => c.group))];
  $('controls').innerHTML = groups.map((g) => `<fieldset><legend>${g}</legend>${SCHEMA.filter((c) => c.group === g).map((c) => control(c, s[c.key])).join('')}</fieldset>`).join('');
  $('controls').querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((el) => {
    el.addEventListener('input', () => {
      const c = SCHEMA.find((x) => x.key === el.dataset.key)!;
      const v = c.kind === 'bool' ? (el as HTMLInputElement).checked : parse(c, el.value);
      (state.over[state.suit] as Record<string, unknown>)[c.key] = v;
      const out = el.parentElement!.querySelector('output');
      if (out) out.textContent = String(v);
      schedule();
    });
  });
}
function control(c: Control, v: unknown): string {
  const id = `ctl-${c.key}`;
  const changed = c.key in state.over[state.suit] ? ' class="changed"' : '';
  if (c.kind === 'num') return `<label${changed} for="${id}"><span>${c.label}${c.vary ? ' <i title="a seed moves it">~</i>' : ''}</span><input id="${id}" data-key="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"><output>${v}</output></label>`;
  if (c.kind === 'bool') return `<label${changed} for="${id}"><span>${c.label}</span><input id="${id}" data-key="${c.key}" type="checkbox"${v ? ' checked' : ''}></label>`;
  if (c.kind === 'color') return `<label${changed} for="${id}"><span>${c.label}</span><input id="${id}" data-key="${c.key}" type="color" value="${v}"></label>`;
  return `<label${changed} for="${id}"><span>${c.label}</span><select id="${id}" data-key="${c.key}">${c.options!.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`;
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  uid = 0;
  const { suit, rank, seed, view } = state;
  const box = $('cards');
  if (view === 'one') { box.className = 'cards one'; box.innerHTML = card(suit, rank, seed); }
  else if (view === 'suit') { box.className = 'cards many'; box.innerHTML = Array.from({ length: 10 }, (_, i) => card(suit, i + 1, seed)).join(''); }
  else if (view === 'suits') { box.className = 'cards many'; box.innerHTML = [0, 1, 2, 3].map((s) => card(s, rank, seed)).join(''); }
  else if (view === 'seeds') { box.className = 'cards many'; box.innerHTML = Array.from({ length: 6 }, (_, i) => card(suit, rank, seed + i, seedName(seed + i))).join(''); }
  else {
    box.className = 'cards tiles';
    box.innerHTML = SHAPE_KINDS.map((k) => { const t = shapeTile({ kind: k, style: styleOf(suit), seed, label: state.label, overlay: state.overlay, zones: state.mode === 'zones' }); lastStats = [fmtStats(k, t.fill.stats)]; return `<figure class="card">${t.svg}<figcaption>${k} · ${t.fill.stats.n} discs · coverage ${Math.round(t.fill.stats.coverage * 100)}% · gap p95 ${t.fill.stats.p95Gap}</figcaption></figure>`; }).join('');
  }
  $('stats').textContent = view === 'one' ? lastStats.join('\n') : '';
  $('labelrow').hidden = view !== 'shapes';
  $('seed').textContent = seedName(seed);
  document.querySelectorAll<HTMLElement>('[data-suit]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.suit) === suit)));
  document.querySelectorAll<HTMLElement>('[data-rank]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.rank) === rank)));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('overlay').setAttribute('aria-pressed', String(state.overlay));
  document.documentElement.style.setProperty('--ink', styleOf(suit).ink);
  // the address keeps the state, so a seal can be shared
  const q = new URLSearchParams({ suit: String(suit), rank: String(rank), seed: seedName(seed), view, faces: state.mode });
  if (state.overlay) q.set('overlay', '');
  if (view === 'shapes') q.set('label', state.label);
  state.over.forEach((o, i) => Object.entries(o).forEach(([k, v]) => q.set(`${SUIT_KEYS[i]}.${k}`, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))));
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
function download() {
  const svg = drawCard({ style: styleOf(state.suit), seed: state.seed, faces: facesFor(state.suit, state.rank), title: titleFor(state.suit, state.rank), id: 'k', mode: state.mode }).svg;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `seal-${SUIT_STYLES[state.suit].name}-${state.rank || 'bare'}-${seedName(state.seed)}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function flash(t: string) { const el = $('status'); el.textContent = t; setTimeout(() => { el.textContent = ''; }, 1600); }
