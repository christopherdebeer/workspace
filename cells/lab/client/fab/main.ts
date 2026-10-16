/**
 * Fab: a dressmaking workbench for children. A little wooden figure on its stand, and a skirt: not chosen, made. The
 * bench holds what a dressmaker decides (how long; how full; whether that fullness is cut in as flare, gathered or
 * pleated; how many panels; where on the cloth's grain they're cut; which cloth, which print) and the pattern that
 * follows from it, drafted to the figure (pattern.ts), lies on the bench beside it. Every change re-cuts the pattern,
 * which is sewn up and falls as that cloth falls (cloth.ts): its silhouette, its folds and how it swings are never
 * set, only found.
 *
 * It starts at the rails (rails.ts): along the workshop's wall, a clothes rail for the workshop and one for each person,
 * hung with skirts. Slide a rail's skirts along it, swipe up or down for the next rail, tap the one in front to put it
 * on the figure; it's taken off its hanger and sewn on, and the camera crosses the room to the bench. **hang up**
 * hangs it back on its owner's rail (or a new rail, asking whose); going back to the **rails** does too, if it's
 * changed.
 *
 * At the bench, drag the figure round, pinch to come close. **twirl** turns the figure on its stand; **sew** lays the
 * pieces out flat round it and sews them up again. The pattern's pinned up beside it: tap it to take it to the cutting
 * table. Across the top, the room's three places: the rails, the figure, the table.
 *
 * `?len=` `&full=` `&cut=flare|gather|pleat` `&panels=` `&grain=` (degrees) `&fabric=` `&print=` `&colour=` ·
 * `?settle=N` (frames of cloth before the first's drawn) · `?preview` · `?rails` (start at the rails; a design in the
 * query starts at the bench) · `?warm` (the rails' skirts settled before the first frame) · `?bench=evidence`.
 */
import { Cloth } from './cloth';
import { FABRICS, COLOURWAYS, PRINTS, fabricById, makePrint } from './fabric';
import { DEFAULT_DESIGN, describe, draftRecipe, fromDesign, toBuild, type Design, type Method, type Move, type Recipe, type Skirt } from './pattern';
import { Paper, SHEET_H, SHEET_W, TOOLS, moveWords } from './paper';
import { RAIL_Z, Room, railX } from './rails';
import { FLOOR, RAIL_W, RAIL_Y, TABLE, createRenderer, invert, placeTurned, type Item } from './render';
import { RAIL_COLOURS, activeRail, addRail, hang, rails, recipeOf, removeRail, renameRail, setActive, takeOff, type Rail } from './store';
import { drawSheet } from './sheet';

const qs = new URLSearchParams(location.search), preview = qs.has('preview');
if (qs.get('bench') === 'evidence') { void import('./evidence').then((m) => m.mountEvidence()); throw new Error('evidence bench'); }
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL2 needed');
const R = createRenderer(gl);

// ─── the design ────────────────────────────────────────────────────────────────────────────────
const d: Design = { ...DEFAULT_DESIGN };
const num = (k: string) => (qs.has(k) ? Number(qs.get(k)) : NaN);
if (Number.isFinite(num('len'))) d.length = num('len');
if (Number.isFinite(num('full'))) d.fullness = num('full');
if (['flare', 'gather', 'pleat'].includes(qs.get('cut') ?? '')) d.method = qs.get('cut') as Method;
if (Number.isFinite(num('panels'))) d.panels = num('panels');
if (Number.isFinite(num('grain'))) d.grain = num('grain');
if (qs.get('fabric')) d.fabric = fabricById(qs.get('fabric')!).id;
if (Number.isFinite(num('print'))) d.print = num('print');
if (Number.isFinite(num('colour'))) d.colour = num('colour');

// (the skirt as made: a recipe. From a link's moves (`m=`), or written from an older link's design, as the dials
// write it)
const NEW: Recipe = { length: 34, panels: 4, grain: 0, fabric: 'lawn', print: 0, colour: 0, moves: [] };
const encodeMoves = (ms: Move[]) => ms.map((m) => m.kind === 'spread' ? `s${Math.round(m.at * 1000)}.${Math.round(m.open * 10)}` : m.kind === 'pleat' ? `p${Math.round(m.at * 1000)}.${Math.round(m.depth * 10)}` : m.kind === 'gather' ? `g${Math.round(m.at * 1000)}.${Math.round(m.add * 10)}` : m.kind === 'close-dart' ? `c${m.dart}` : `r${m.dart}`).join('_');
const decodeMoves = (t: string): Move[] => t.split('_').filter(Boolean).flatMap((x): Move[] => {
  const k = x[0], [a, b] = x.slice(1).split('.').map(Number);
  if (k === 's') return [{ kind: 'spread', at: a / 1000, open: b / 10 }];
  if (k === 'p') return [{ kind: 'pleat', at: a / 1000, depth: b / 10 }];
  if (k === 'g') return [{ kind: 'gather', at: a / 1000, add: b / 10 }];
  if (k === 'c') return [{ kind: 'close-dart', dart: a }];
  if (k === 'r') return [{ kind: 'release-dart', dart: a }];
  return [];
});
let rec: Recipe = qs.has('m') ? { length: d.length, panels: d.panels, grain: d.grain, fabric: d.fabric, print: d.print, colour: d.colour, moves: decodeMoves(qs.get('m') ?? '') } : fromDesign(d);
/** the dials, kept to compare with the paper (`?ui=dials`): they write moves too */
const dialsUI = qs.get('ui') === 'dials';
let sk: Skirt = draftRecipe(rec), cloth: Cloth | null = null;
function makeFrom(r: Recipe, fresh = false) {
  sk = draftRecipe(r);
  const next = new Cloth(toBuild(sk, fabricById(r.fabric)), fresh ? null : cloth);
  if (cloth && !fresh) { next.spin = cloth.spin; next.omega = cloth.omega; }
  cloth = next;
}
function make(fresh = false) {
  makeFrom(rec, fresh);
  if (!preview && mode === 'bench') {
    const u = new URL(location.href);
    for (const k of ['full', 'cut']) u.searchParams.delete(k);
    for (const [k, v] of [['len', String(rec.length)], ['panels', String(rec.panels)], ['grain', String(rec.grain)], ['fabric', rec.fabric], ['print', String(rec.print)], ['colour', String(rec.colour)], ['m', encodeMoves(rec.moves)]]) u.searchParams.set(k, v);
    history.replaceState(null, '', u);
  }
  ui();
}
// (while a hand's on the paper or a dial: the figure follows, a few times a second, without the move being made yet)
let pending = 0, pendingRec: Recipe | null = null;
function remake(r?: Recipe) { pendingRec = r ?? null; if (pending) return; pending = window.setTimeout(() => { pending = 0; if (pendingRec) makeFrom(pendingRec); else make(); }, 90); }

// ─── the bench ─────────────────────────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;
const card = $('card') as HTMLCanvasElement, sheet = $('sheet') as HTMLCanvasElement, notes = $('notes');
interface Knob { key: 'length' | 'fullness' | 'panels' | 'grain'; label: string; lo: number; hi: number; step: number; word: (v: number) => string }
const KNOBS: Knob[] = [
  { key: 'length', label: 'length', lo: 12, hi: 62, step: 1, word: (v) => `${v.toFixed(0)} cm` },
  { key: 'fullness', label: 'fullness', lo: 1, hi: 4, step: 0.05, word: (v) => `${v.toFixed(1)}× round` },
  { key: 'panels', label: 'panels', lo: 1, hi: 10, step: 1, word: (v) => `${v.toFixed(0)}` },
  { key: 'grain', label: 'grain', lo: 0, hi: 45, step: 1, word: (v) => (v < 4 ? 'straight' : v > 41 ? 'bias' : `${v.toFixed(0)}° off`) },
];
const knobs = new Map<string, { arc: SVGPathElement; dot: SVGCircleElement; word: HTMLElement }>();
const arcPath = (t: number) => {
  const a0 = -2.36, a1 = a0 + 4.71 * Math.max(0.001, t), p = (a: number) => `${32 + Math.sin(a) * 25} ${32 - Math.cos(a) * 25}`;
  return `M ${p(a0)} A 25 25 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
};
for (const k of KNOBS) {
  const el = document.createElement('div'); el.className = 'knob';
  el.innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" class="face"/><path class="track" d="${arcPath(1)}"/><path class="arc" d=""/><circle class="dot" r="4.5"/></svg><b>${k.label}</b><i></i>`;
  $('knobs').appendChild(el);
  knobs.set(k.key, { arc: el.querySelector('.arc')!, dot: el.querySelector('.dot')!, word: el.querySelector('i')! });
  // (turned by dragging round it, or up and down)
  let startA = 0, last = 0, acc = 0;
  const angle = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.width / 2))); };
  el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); startA = angle(ev); last = ev.clientY - ev.clientX; acc = (d[k.key] - k.lo) / (k.hi - k.lo); el.classList.add('turning'); ev.preventDefault(); });
  el.addEventListener('pointermove', (ev) => {
    if (!el.hasPointerCapture(ev.pointerId)) return;
    const a = angle(ev); let da = a - startA; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; startA = a;
    const lin = ev.clientY - ev.clientX, dl = (last - lin) / 240; last = lin;
    acc = Math.max(0, Math.min(1, acc + Math.max(-0.2, Math.min(0.2, da / 4.7 + dl))));
    const v = Math.round((k.lo + acc * (k.hi - k.lo)) / k.step) * k.step;
    if (v !== d[k.key]) { d[k.key] = v; knob(k); rec = fromDesign(d); remake(); }
  });
  el.addEventListener('pointerup', () => el.classList.remove('turning'));
}
function knob(k: Knob) {
  const kb = knobs.get(k.key)!, t = (d[k.key] - k.lo) / (k.hi - k.lo), a = -2.36 + 4.71 * t;
  kb.arc.setAttribute('d', arcPath(t));
  kb.dot.setAttribute('cx', `${32 + Math.sin(a) * 25}`); kb.dot.setAttribute('cy', `${32 - Math.cos(a) * 25}`);
  kb.word.textContent = k.key === 'panels' && sk.m.panels !== d.panels ? `${sk.m.panels} (needs)` : k.word(d[k.key]);
}
// (how the fullness is made: three ways, each drawn as it's cut)
const METHODS: Array<{ m: Method; label: string; icon: string }> = [
  { m: 'flare', label: 'flared', icon: '<path d="M14 6h8l8 22H6z"/>' },
  { m: 'gather', label: 'gathered', icon: '<path d="M8 6h20M8 6q2 4 0 8t0 8M14 6q2 4 0 8t0 8M20 6q2 4 0 8t0 8M26 6q2 4 0 8t0 8M6 28h24"/>' },
  { m: 'pleat', label: 'pleated', icon: '<path d="M6 6h24M9 6v22M15 6v22M21 6v22M27 6v22M6 28h24"/>' },
];
for (const x of METHODS) {
  const b = document.createElement('button'); b.dataset.m = x.m;
  b.innerHTML = `<svg viewBox="0 0 36 34">${x.icon}</svg><span>${x.label}</span>`;
  b.addEventListener('click', () => { d.method = x.m; rec = fromDesign(d); make(); });
  $('methods').appendChild(b);
}
for (const f of FABRICS) {
  const b = document.createElement('button'); b.className = 'swatch'; b.dataset.f = f.id;
  b.innerHTML = `<span style="background:${f.card}"></span>${f.name}`;
  b.addEventListener('click', () => { d.fabric = f.id; rec = { ...rec, fabric: f.id }; make(); });
  $('fabrics').appendChild(b);
}
for (let k = 0; k < PRINTS.length; k++) {
  const b = document.createElement('button'); b.className = 'print'; b.dataset.k = String(k);
  b.innerHTML = `<canvas width="56" height="40"></canvas>${PRINTS[k]}`;
  // (tap a print to choose it; tap it again for its next colourway)
  b.addEventListener('click', () => { if (rec.print === k) rec = { ...rec, colour: (rec.colour + 1) % COLOURWAYS.length }; rec = { ...rec, print: k }; d.print = rec.print; d.colour = rec.colour; make(); });
  $('prints').appendChild(b);
}
function ui() {
  for (const k of KNOBS) knob(k);
  for (const b of Array.from($('methods').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.m === d.method);
  for (const b of Array.from($('fabrics').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.f === rec.fabric);
  for (const b of Array.from($('prints').children) as HTMLElement[]) {
    const k = Number(b.dataset.k); b.classList.toggle('on', k === rec.print);
    const cv = b.querySelector('canvas')!; cv.style.width = '28px'; cv.style.height = '20px';
    drawSwatch(cv, k, rec.colour);
  }
  // (the paper, its tools, and the history of what's been done to it)
  for (const b of Array.from($('palette').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.tool === paper.tool);
  $('panelsn').textContent = String(rec.panels);
  toolPanel();
  const hist = $('history'); hist.innerHTML = '';
  if (!rec.moves.length) hist.innerHTML = '<span class="none">the block, as drafted: nothing done to it yet</span>';
  rec.moves.forEach((m, i) => {
    const c = document.createElement('button'); c.className = `chip${sk.made[i] === false ? ' dud' : ''}`; c.textContent = moveWords(m);
    c.appendChild(Object.assign(document.createElement('i'), { textContent: '×' }));
    c.title = 'take this back';
    c.addEventListener('click', () => { rec = { ...rec, moves: rec.moves.filter((_, j) => j !== i) }; make(); });
    hist.appendChild(c);
  });
  paper.draw();
  notes.textContent = sk.notes.join(' · ');
  const bad = sk.checks.filter((c) => !c.ok);
  if (bad.length) notes.textContent += ` · ✗ ${bad.map((c) => c.name).join(', ')}`;
  // (the pattern pinned up by the figure: the cloth on it only if it's shown on the table too)
  const pr = makePrint(rec.print, rec.colour);
  if (mode === 'bench') {
    drawSheet(card, sk, paper.cloth ? pr : null, true);
    $('notename').textContent = describe(rec).replace(/^./, (c) => c.toUpperCase());
    $('notewhat').textContent = `${sk.m.length.toFixed(0)} cm long · hem ${sk.m.hem.toFixed(0)} cm round${rec.panels > 1 ? ` · ${rec.panels} panels` : ''}`;
  }
  $('cloth').classList.toggle('on', paper.cloth);
  if (sheetOn) drawSheet(sheet, sk, paper.cloth ? pr : null);
}
function drawSwatch(cv: HTMLCanvasElement, kind: number, colour: number) {
  const c = cv.getContext('2d')!, inks = COLOURWAYS[colour].inks;
  c.fillStyle = inks[0]; c.fillRect(0, 0, 56, 40); c.fillStyle = inks[1];
  if (kind === 1) for (let x = 0; x < 56; x += 12) c.fillRect(x, 0, 4, 40);
  if (kind === 2) { c.globalAlpha = 0.5; for (let x = 0; x < 56; x += 12) { c.fillRect(x, 0, 6, 40); c.fillRect(0, x, 56, 6); } c.globalAlpha = 1; }
  if (kind === 3) for (let y = 6; y < 40; y += 12) for (let x = (y / 12) % 2 ? 6 : 12; x < 56; x += 12) { c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); }
  if (kind === 4) for (const [x, y] of [[12, 12], [36, 26], [52, 8]]) for (let p = 0; p < 5; p++) { const a = (p / 5) * 6.28; c.beginPath(); c.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, 7); c.fill(); }
  if (kind === 5) for (const [x, y] of [[12, 12], [36, 26], [50, 10]]) { c.beginPath(); for (let p = 0; p < 10; p++) { const a = -1.57 + (p / 10) * 6.28, r = p % 2 ? 2.5 : 6; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.fill(); }
}
// (the paper and its tools)
const paper = new Paper(document.createElement('canvas'), () => rec, (r) => { remake(r); toolPanel(); }, (r) => { rec = r; make(); }, (r) => { rec = r; make(); });
for (const t of TOOLS) {
  const b = document.createElement('button'); b.dataset.tool = t.id; b.className = 'tool';
  b.innerHTML = `<svg viewBox="0 0 40 40">${t.icon}</svg><span>${t.label}</span>`;
  b.addEventListener('click', () => { paper.tool = t.id; ui(); });
  $('palette').appendChild(b);
}
// (the drawer at the table: the tool in hand, what it does, the gestures it answers to, and what it's set to)
const G = {
  tap: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5" stroke-dasharray="2.5 2.5"/>',
  updown: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M9.5 5l2.5-2.5L14.5 5M12 21.5v-4M9.5 19l2.5 2.5 2.5-2.5"/>',
  side: '<circle cx="12" cy="12" r="3"/><path d="M2.5 12h4M5 9.5L2.5 12 5 14.5M21.5 12h-4M19 9.5l2.5 2.5-2.5 2.5"/>',
  turn: '<circle cx="12" cy="17" r="2.5"/><path d="M5 13a8 8 0 0114 0"/><path d="M16.5 10.5L19 13l2.5-2"/>',
};
const PANEL: Record<string, { name: string; what: string; gestures: Array<[keyof typeof G, string, string]> }> = {
  hand: { name: 'Hand', what: 'shape the piece as it is', gestures: [['updown', 'drag the hem', 'longer · shorter'], ['turn', 'turn the grain arrow by its knob', 'straight → bias'], ['tap', 'tap a dart', 'flare → gathers → sewn']] },
  scissors: { name: 'Slash', what: 'cut up from the hem and spread it open: flare', gestures: [['tap', 'touch the hem where to cut', 'anywhere along it'], ['side', 'drag sideways to open it', 'wider → fuller']] },
  fold: { name: 'Fold', what: 'fold the waist into a pleat', gestures: [['tap', 'touch the waist where it goes', 'anywhere along it'], ['side', 'drag sideways to fold it', 'further → deeper']] },
  thread: { name: 'Gather', what: 'add width at the waist and draw it in', gestures: [['tap', 'touch the waist where to add', 'anywhere along it'], ['side', 'drag sideways to add more', 'further → fuller']] },
};
function toolPanel() {
  const t = PANEL[paper.tool];
  $('toolname').textContent = t.name; $('toolwhat').textContent = t.what;
  $('gestures').innerHTML = t.gestures.map(([g, w, i]) => `<div class="gest"><svg viewBox="0 0 24 24">${G[g]}</svg>${w}<i>${i}</i></div>`).join('');
  // (what it's set to: the hand's length and grain, with steps; the others, what they've done so far)
  const ctl = $('toolctl'); ctl.innerHTML = '';
  // (a label and its value; − and + either side of it, or words to pick after it)
  const box = (label: string, value: string, buttons: Array<[string, () => void, boolean?]>) => {
    const el = document.createElement('div'); el.className = 'ctl'; el.append(label);
    const btn = ([w, f, on]: [string, () => void, boolean?]) => { const b = document.createElement('button'); b.textContent = w; if (w.length > 1) b.className = `word${on ? ' on' : ''}`; b.addEventListener('click', () => { f(); make(); }); return b; };
    const v = document.createElement('b'); v.textContent = value;
    if (buttons.length === 2 && buttons[0][0] === '−') el.append(btn(buttons[0]), v, btn(buttons[1]));
    else el.append(v, ...buttons.map(btn));
    ctl.appendChild(el);
  };
  // (while a move's being made, what it'll be: the drawer keeps up with the finger)
  const now = paper.preview ?? rec, ms = now.moves, made = (k: Move['kind']) => ms.filter((m) => m.kind === k);
  if (paper.tool === 'hand') {
    box('length', `${now.length} cm`, [['−', () => { rec = { ...rec, length: Math.max(12, rec.length - 1) }; }], ['+', () => { rec = { ...rec, length: Math.min(62, rec.length + 1) }; }]]);
    box('grain', now.grain === 0 || now.grain === 45 ? '' : `${now.grain}°`, [['straight', () => { rec = { ...rec, grain: 0 }; }, now.grain === 0], ['bias', () => { rec = { ...rec, grain: 45 }; }, now.grain === 45]]);
    const sewn = sk.cut.strips.filter((x) => x.kind === 'dart').length, closed = made('close-dart').length, gathered = made('release-dart').length;
    if (sewn + closed + gathered) box('darts', [sewn && `${sewn} sewn`, closed && `${closed} flared`, gathered && `${gathered} gathered`].filter(Boolean).join(' · '), []);
  } else {
    const k = paper.tool === 'scissors' ? 'spread' : paper.tool === 'fold' ? 'pleat' : 'gather', n = made(k).length;
    const cm = made(k).reduce((a, m) => a + (m.kind === 'spread' ? m.open : m.kind === 'pleat' ? m.depth * 2 : m.kind === 'gather' ? m.add : 0), 0);
    const noun = k === 'spread' ? ['slash', 'slashes', 'opened at the hem'] : k === 'pleat' ? ['pleat', 'pleats', 'folded in'] : ['gather', 'gathers', 'added'];
    box('so far', n ? `${n} ${n === 1 ? noun[0] : noun[1]} · ${cm.toFixed(cm < 10 ? 1 : 0)} cm ${noun[2]}` : `none yet`, []);
  }
}
$('panelsless').addEventListener('click', () => { rec = { ...rec, panels: Math.max(1, rec.panels - 1) }; make(); });
$('panelsmore').addEventListener('click', () => { rec = { ...rec, panels: Math.min(10, rec.panels + 1) }; make(); });
$('undo').addEventListener('click', () => { if (rec.moves.length) { rec = { ...rec, moves: rec.moves.slice(0, -1) }; make(); } });
if (dialsUI) document.body.classList.add('dials');
let sheetOn = false;
const toggleSheet = () => { sheetOn = !sheetOn; document.body.classList.toggle('sheet', sheetOn); ui(); };
sheet.addEventListener('click', toggleSheet);
// (the cloth laid on the paper, or not: off, the paper's plain and its marks easier to see)
paper.cloth = qs.has('cloth');
$('cloth').addEventListener('click', () => { paper.cloth = !paper.cloth; ui(); });
$('pattern').addEventListener('click', toggleSheet);
$('sew').addEventListener('click', () => make(true));
let twirlUntil = 0;
$('twirl').addEventListener('click', () => { twirlUntil = performance.now() + 3200; });

// ─── the rails: where every skirt starts and ends ──────────────────────────────────────────────
type Mode = 'rails' | 'bench' | 'table';
const hasDesign = ['len', 'full', 'cut', 'panels', 'grain', 'fabric', 'print', 'colour', 'm'].some((k) => qs.has(k));
let mode: Mode = qs.has('rails') || (!hasDesign && !preview && !qs.has('settle') && !qs.has('sheet')) ? 'rails' : 'bench';
const room = new Room();
room.active = Math.max(0, room.states.findIndex((st) => st.rail.id === activeRail()));
/** where the skirt on the figure came from: a rail and the garment on it, and its recipe as it was then */
let origin: { rail: string; garment: string | null; recipe: Recipe } | null = null;
const same = (a: Recipe, b: Recipe) => JSON.stringify(a) === JSON.stringify(b);
let lastVP: Float32Array | null = null, toastT = 0, lastFront = -1;
const toast = (t: string) => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = window.setTimeout(() => el.classList.remove('show'), 2400); };
const railName = (r: Rail) => (r.workshop ? 'the workshop’s rail' : /rail/i.test(r.name) ? r.name : `${r.name}’s rail`);

function railUI() {
  const tags = $('railtags'); tags.innerHTML = '';
  room.states.forEach((st, k) => {
    const b = document.createElement('button'); b.className = `tag${k === room.active ? ' on' : ''}`;
    b.style.setProperty('--c', st.rail.workshop ? '#9a9aa0' : RAIL_COLOURS[st.rail.colour % RAIL_COLOURS.length].css);
    b.textContent = st.rail.workshop ? 'workshop' : st.rail.name;
    b.addEventListener('click', () => {
      // (tap your own rail's tag again to rename it; clear its name to take it away)
      if (k === room.active && !st.rail.workshop) {
        const n = prompt('A new name for this rail (clear it to take the rail away)', st.rail.name);
        if (n === null) return;
        if (!n.trim()) { if (confirm(`Take away ${railName(st.rail)}, and everything on it?`)) { removeRail(st.rail.id); room.refresh(); showRail(room.active - 1); } return; }
        renameRail(st.rail.id, n); room.refresh(); railUI(); return;
      }
      showRail(k);
    });
    tags.appendChild(b);
  });
  const add = document.createElement('button'); add.className = 'tag add'; add.textContent = '+ a rail';
  add.addEventListener('click', () => { const n = prompt('Whose rail is it? (a name)'); if (!n || !n.trim()) return; addRail(n); room.refresh(); showRail(room.states.length - 1); });
  tags.appendChild(add);
  railInfo();
}
function railInfo() {
  const st = room.states[room.active], h = room.frontHung();
  lastFront = room.front();
  $('railname').textContent = st ? railName(st.rail) : '';
  // (the button's only for a bare hanger, to start something new; a skirt's put on by tapping it)
  $('wear').hidden = !h || !!h.g;
  if (!h) { $('railwhat').textContent = ''; return; }
  if (!h.g) { $('railwhat').textContent = 'a bare hanger: start a new skirt'; return; }
  const g = recipeOf(h.g);
  $('railwhat').textContent = `${describe(g)} in ${fabricById(g.fabric).name}${g.print ? `, ${PRINTS[g.print]}` : ''}`;
}
function showRail(k: number) {
  if (!room.states.length) return;
  room.active = Math.max(0, Math.min(room.states.length - 1, k));
  setActive(room.states[room.active].rail.id); railUI();
}
/** take garment i off the rail and sew it onto the figure */
function wear(i: number) {
  const st = room.states[room.active], h = st?.hung[i];
  if (!st || !h) return;
  // (a bare hanger starts a new skirt from the block itself: nothing done to it yet)
  rec = structuredClone(h.g ? recipeOf(h.g) : NEW);
  origin = { rail: st.rail.id, garment: h.g?.id ?? null, recipe: structuredClone(rec) };
  room.onFigure = h.g?.id ?? null;
  setMode('bench');
  make(true);
}
/** hang what's on the figure up: back on its own hanger if it's someone's, else on the rail in use (asking whose, if
 * nobody has a rail yet). Nothing's hung if it's unchanged and already someone's. */
function hangUp(): boolean {
  const own = origin ? rails().find((r) => r.id === origin!.rail && !r.workshop) : undefined;
  if (own && origin?.garment && same(origin.recipe, rec)) { toast(`it’s on ${railName(own)} already`); return false; }
  let id = own?.id ?? (rails().find((r) => r.id === activeRail() && !r.workshop) ?? rails().find((r) => !r.workshop))?.id;
  if (!id) { const n = prompt('Hang it on whose rail? (a name)'); if (!n || !n.trim()) return false; id = addRail(n).id; }
  const g = hang(id, rec, own ? origin?.garment ?? undefined : undefined);
  if (!g) return false;
  origin = { rail: id, garment: g.id, recipe: structuredClone(rec) };
  room.refresh(); room.onFigure = g.id;
  toast(`hung on ${railName(rails().find((r) => r.id === id)!)}`);
  return true;
}
function backToRails() {
  if (!origin || !same(origin.recipe, rec)) hangUp();
  room.onFigure = null; room.refresh();
  if (origin) {
    const k = room.states.findIndex((st) => st.rail.id === origin!.rail);
    if (k >= 0) { room.active = k; setActive(origin.rail); const i = room.states[k].hung.findIndex((h) => (h.g?.id ?? null) === origin!.garment); if (i >= 0) room.goTo(i); }
  }
  setMode('rails');
}
function setMode(m: Mode) {
  mode = m; flying = 1; flyT0 = performance.now(); flyFrom = { ...view, target: [...view.target] as [number, number, number] };
  document.body.classList.toggle('rails', m === 'rails');
  document.body.classList.toggle('table', m === 'table');
  places();
  if (m === 'rails') {
    if (sheetOn) toggleSheet();
    if (!preview) { const u = new URL(location.href); for (const k of ['len', 'full', 'cut', 'panels', 'grain', 'fabric', 'print', 'colour', 'm']) u.searchParams.delete(k); history.replaceState(null, '', u); }
    railUI();
  } else ui();
}
$('wear').addEventListener('click', () => wear(room.front()));
/** the room's three places, along the top: where you are, dark */
function places() { for (const b of Array.from($('places').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.place === mode); }
function toTable() { tableZoom = 0; tableTurn = 0; setMode('table'); }
function go(m: Mode) {
  if (m === mode) return;
  if (m === 'rails') { backToRails(); return; }
  // (from the rails, to whatever's on the figure)
  if (mode === 'rails' && !cloth) make(true);
  if (m === 'table') toTable(); else setMode('bench');
}
for (const b of Array.from($('places').children) as HTMLElement[]) b.addEventListener('click', () => go(b.dataset.place as Mode));
$('note').addEventListener('click', toTable);
$('hang').addEventListener('click', () => hangUp());

// ─── turning round it, and along the rails ─────────────────────────────────────────────────────
const BENCH_VIEW = { az: Number(qs.get('az') ?? -0.5), el: Number(qs.get('el') ?? 0.1), dist: Number(qs.get('dist') ?? 290), target: [0, Number(qs.get('ty') ?? 62), 0] as [number, number, number] };
const view = { ...BENCH_VIEW, target: [...BENCH_VIEW.target] as [number, number, number] };
/** crossing the room, between the rails and the bench: where from, and when it set off (1.2 s, eased) */
let flying = 0, flyFrom = { ...view, target: [...view.target] as [number, number, number] }, flyT0 = 0;
const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
const cmPerPx = () => (2 * view.dist * Math.tan(0.3) * aspect()) / Math.max(1, canvas.clientWidth);
let drag = false, lx = 0, ly = 0, pinch = 0, idle = 0, sx = 0, sy = 0, st0 = 0, axis: '' | 'x' | 'y' = '', press = 0, lastMove = 0;
const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
canvas.addEventListener('pointerdown', (e) => {
  drag = true; lx = sx = e.clientX; ly = sy = e.clientY; st0 = performance.now(); axis = ''; canvas.setPointerCapture(e.pointerId); idle = 0;
  if (mode === 'rails') {
    // (a long press on one of your own: take it off the rail)
    clearTimeout(press);
    press = window.setTimeout(() => {
      if (!lastVP || axis) return;
      const [px, py] = local({ clientX: sx, clientY: sy }), i = room.pick(px, py, lastVP, canvas.clientWidth, canvas.clientHeight), stt = room.states[room.active], h = stt?.hung[i];
      if (!h?.g) return;
      if (stt.rail.workshop) { toast('the workshop’s skirts stay: put one on the figure, and hang up your own'); return; }
      drag = false;
      if (confirm(`Take ${describe(recipeOf(h.g))} off ${railName(stt.rail)}? It’ll be gone.`)) { takeOff(stt.rail.id, h.g.id); room.refresh(); railInfo(); }
    }, 650);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || pinch) return;
  const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; idle = 0;
  if (mode === 'rails') {
    if (!axis && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { axis = Math.abs(e.clientX - sx) > Math.abs(e.clientY - sy) ? 'x' : 'y'; clearTimeout(press); }
    if (axis === 'x') { room.dragging = true; const now = performance.now(); room.push(dx * cmPerPx(), Math.max(0.008, (now - lastMove) / 1000)); lastMove = now; }
    return;
  }
  if (mode === 'table') return;
  view.az -= dx * 0.008; view.el = Math.max(-0.2, Math.min(1.2, view.el + dy * 0.004));
});
canvas.addEventListener('pointerup', (e) => {
  drag = false; clearTimeout(press);
  // (at the figure, a tap on another place in the room (the table, a rail) goes over to it)
  if (mode === 'bench' && performance.now() - st0 < 450 && Math.hypot(e.clientX - sx, e.clientY - sy) < 10 && tapPlace(e.clientX, e.clientY)) return;
  if (mode !== 'rails') return;
  if (room.dragging) { room.dragging = false; if (performance.now() - lastMove > 90) room.states[room.active].vel = 0; return; }
  if (axis === 'y') { const dy = e.clientY - sy; if (Math.abs(dy) > 40) showRail(room.active + (dy < 0 ? 1 : -1)); return; }
  if (!axis && performance.now() - st0 < 600 && lastVP) {
    const [px, py] = local(e), i = room.pick(px, py, lastVP, canvas.clientWidth, canvas.clientHeight);
    if (i < 0) { tapPlace(e.clientX, e.clientY); return; }
    if (i === room.front()) wear(i); else { room.nudge(i, i > room.front() ? -1 : 1); room.goTo(i); }
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'rails') { room.push(-(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.08, 0.016); return; }
  view.dist = Math.max(80, Math.min(360, view.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2 && mode === 'bench') pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pinch) { const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); view.dist = Math.max(80, Math.min(360, view.dist * pinch / p)); pinch = p; } }, { passive: true });
canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = 0; });

// ─── the cutting table ─────────────────────────────────────────────────────────────────────────
// (the paper lies on the table at true size: a pixel of its sheet is 1/sc cm)
// (on the table's own axes: x across it, z toward you; turned with the table to face the figure)
const tcos = Math.cos(TABLE.rot), tsin = Math.sin(TABLE.rot);
const tableToRoom = (lx: number, lz: number): [number, number, number] => [TABLE.x + lx * tcos + lz * tsin, TABLE.y + 0.12, TABLE.z - lx * tsin + lz * tcos];
const sheetToRoom = (px: number, py: number) => tableToRoom((px - SHEET_W / 2) / paper.sc, (py - SHEET_H / 2) / paper.sc);
const sheetModel = () => placeTurned(TABLE.x, TABLE.y + 0.12, TABLE.z, TABLE.rot, SHEET_W / paper.sc, 1, SHEET_H / paper.sc);
/** where to look at the table from: down onto the piece, from in front and a little to the side, the figure behind */
function tableView() {
  // (sitting at the table: looking across it at the figure, down onto the paper; the piece filling the open part of the
  // screen above the drawer, the figure standing behind it)
  const b = paper.bounds(), lx = ((b.x0 + b.x1) / 2 - SHEET_W / 2) / paper.sc, lz = ((b.y0 + b.y1) / 2 - SHEET_H / 2) / paper.sc;
  const w = Math.max(30, (b.x1 - b.x0) / paper.sc) * 1.35, d = Math.max(24, (b.y1 - b.y0) / paper.sc) * 1.2, el = 0.5, asp = Math.max(0.4, (canvas.clientWidth - 76) / Math.max(1, canvas.clientHeight));
  const dist = Math.max(75, w / (2 * Math.tan(0.3) * asp), (d * Math.sin(el)) / (2 * Math.tan(0.3)) * 1.5);
  // (and over to the right, by half the palette's width: so the piece sits in the open part of the screen, left of it)
  const pal = ($('palette').getBoundingClientRect().width || 0) + 10, shift = (pal / 2) * ((2 * dist * Math.tan(0.3)) / Math.max(1, canvas.clientHeight));
  return { az: TABLE.rot, el, dist, target: tableToRoom(lx + shift, lz - d * 0.35) };
}
/** a touch on the screen as a ray into the room: from the near plane, `t` = 1 at the far one */
type Ray = { o: [number, number, number]; d: [number, number, number] };
function rayAt(clientX: number, clientY: number): Ray | null {
  if (!lastVP) return null;
  const r = canvas.getBoundingClientRect(), x = ((clientX - r.left) / r.width) * 2 - 1, y = 1 - ((clientY - r.top) / r.height) * 2, inv = invert(lastVP);
  const un = (z: number) => { const v = [x, y, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += inv[k * 4 + i] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]] as [number, number, number]; };
  const p0 = un(-1), p1 = un(1);
  return { o: p0, d: [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] };
}
/** where a ray meets the tabletop, on the table's own axes (and how far along the ray) */
function tableHit(ray: Ray): { lx: number; lz: number; t: number } | null {
  const t = (TABLE.y + 0.12 - ray.o[1]) / ray.d[1];
  if (!(t > 0)) return null;
  const dx = ray.o[0] + ray.d[0] * t - TABLE.x, dz = ray.o[2] + ray.d[2] * t - TABLE.z;
  return { lx: dx * tcos - dz * tsin, lz: dx * tsin + dz * tcos, t };
}
/** a touch on the screen, cast down onto the table: where it lands on the paper's sheet, in its pixels */
function onSheet(clientX: number, clientY: number): [number, number] | null {
  const ray = rayAt(clientX, clientY), h = ray && tableHit(ray);
  return h ? [h.lx * paper.sc + SHEET_W / 2, h.lz * paper.sc + SHEET_H / 2] : null;
}
/** how far along a ray it meets the figure (its body, its arms over its head, and as far out as its skirt reaches) */
function figureHit(ray: Ray): number | null {
  const [dx, dy, dz] = ray.d, p0 = ray.o, dd = dx * dx + dz * dz;
  if (dd < 1e-9) return null;
  // (where the ray passes closest to the figure's upright axis, and how far from it)
  const t = -(p0[0] * dx + p0[2] * dz) / dd, h = p0[1] + dy * t, gap = Math.hypot(p0[0] + dx * t, p0[2] + dz * t);
  if (t < 0 || h < -4 || h > 124) return null;
  let reach = h > 86 ? 30 : 17;
  if (cloth && h < 74) { const P = cloth.pos; let m = 0; for (let i = 0; i < cloth.n; i += 3) m = Math.max(m, Math.hypot(P[i * 3], P[i * 3 + 2])); reach = Math.max(reach, m + 2); }
  return gap < reach ? t : null;
}
const onFigure = (clientX: number, clientY: number) => { const ray = rayAt(clientX, clientY); return !!ray && figureHit(ray) !== null; };
/** how far along a ray it meets a box (axis-aligned), if it does */
function boxHit(ray: Ray, lo: [number, number, number], hi: [number, number, number]): number | null {
  let t0 = 0, t1 = Infinity;
  for (let c = 0; c < 3; c++) {
    if (Math.abs(ray.d[c]) < 1e-12) { if (ray.o[c] < lo[c] || ray.o[c] > hi[c]) return null; continue; }
    let a = (lo[c] - ray.o[c]) / ray.d[c], b = (hi[c] - ray.o[c]) / ray.d[c];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

// ─── the room's places ─────────────────────────────────────────────────────────────────────────
/** The three places in the room, each something you can see from the others: tap it, wherever you are, and you go
 * there (the nearest along the touch wins, so what's in front hides what's behind it). Each says how a touch finds it
 * and how to arrive; its view and drawer are its mode's. */
interface Place { id: Mode; hit: (ray: Ray) => { t: number; go: () => void } | null }
const PLACES: Place[] = [
  {
    id: 'rails',
    // (each rail: its stand, the bar, and what hangs from it; tap one to go to it)
    hit: (ray) => {
      let best: { t: number; go: () => void } | null = null;
      room.states.forEach((_, k) => {
        const x = railX(k), t = boxHit(ray, [x - RAIL_W / 2 - 6, FLOOR, RAIL_Z - 26], [x + RAIL_W / 2 + 6, FLOOR + RAIL_Y + 10, RAIL_Z + 26]);
        if (t !== null && (!best || t < best.t)) best = { t, go: () => { go('rails'); showRail(k); } };
      });
      return best;
    },
  },
  { id: 'bench', hit: (ray) => { const t = figureHit(ray); return t === null ? null : { t, go: () => go('bench') }; } },
  {
    id: 'table',
    hit: (ray) => {
      const h = tableHit(ray);
      return h && Math.abs(h.lx) < TABLE.w / 2 && h.lz > -TABLE.d / 2 && h.lz < TABLE.d / 2 + TABLE.near ? { t: h.t, go: () => go('table') } : null;
    },
  },
];
/** a tap that the place you're at didn't take: if it's on another place, go there. True if it went. */
function tapPlace(clientX: number, clientY: number): boolean {
  const ray = rayAt(clientX, clientY);
  if (!ray) return false;
  let best: { t: number; go: () => void; id: Mode } | null = null;
  for (const p of PLACES) { const h = p.hit(ray); if (h && (!best || h.t < best.t)) best = { ...h, id: p.id }; }
  if (!best || best.id === mode) return false;
  best.go();
  return true;
}
// (only a touch on the piece is the paper's; anywhere else at the table moves the view: from the paper, close, out to
// the figure across the room (`tableZoom` 0 → 1), and a little round)
let figureDrag: { x: number; y: number; t: number; x0: number; y0: number; t0: number } | null = null;
let onPaper = false, tableZoom = 0, tableTurn = 0, sceneDrag: { x: number; y: number; x0: number; y0: number; t0: number } | null = null, tablePinch = 0;
const touches = new Map<number, [number, number]>();
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'table') return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size > 1) { if (onPaper) { onPaper = false; paper.cancel(); } sceneDrag = null; return; }
  const q = onSheet(e.clientX, e.clientY), q2 = onSheet(e.clientX + 10, e.clientY);
  // (how many of the sheet's pixels a pixel of the screen is, there: so a fingertip's a fingertip)
  if (q && q2) paper.k = Math.max(0.2, Math.hypot(q2[0] - q[0], q2[1] - q[1]) / 10);
  canvas.setPointerCapture(e.pointerId);
  if (q && tableZoom < 0.5 && paper.hits(q[0], q[1])) { onPaper = true; paper.downAt(q[0], q[1]); }
  // (the figure across the room: tap it to go over to it; drag it round to spin it on its stand)
  else if (onFigure(e.clientX, e.clientY)) { const t = performance.now(); figureDrag = { x: e.clientX, y: e.clientY, t, x0: e.clientX, y0: e.clientY, t0: t }; }
  else sceneDrag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'table') return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) {
    // (pinch: fingers apart, in to the paper; together, out to the figure)
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (tablePinch) tableZoom = Math.max(0, Math.min(1, tableZoom + (tablePinch - d) * 0.004));
    tablePinch = d; return;
  }
  if (onPaper) { const q = onSheet(e.clientX, e.clientY); if (q) paper.moveAt(q[0], q[1]); return; }
  if (figureDrag) {
    // (the front of it follows the finger: right is the way its front turns, seen from here)
    const t = performance.now(), dt = Math.max(0.008, (t - figureDrag.t) / 1000), v = (e.clientX - figureDrag.x) / dt;
    if (cloth && Math.hypot(e.clientX - figureDrag.x0, e.clientY - figureDrag.y0) > 8) cloth.omega = cloth.omega * 0.5 + Math.max(-9, Math.min(9, v * 0.02)) * 0.5;
    figureDrag.x = e.clientX; figureDrag.y = e.clientY; figureDrag.t = t;
    return;
  }
  if (sceneDrag) {
    // (drag up to look up across the room at the figure, down to come back to the paper; sideways to look round)
    tableZoom = Math.max(0, Math.min(1, tableZoom - (e.clientY - sceneDrag.y) * 0.004));
    tableTurn = Math.max(-0.5, Math.min(0.5, tableTurn - (e.clientX - sceneDrag.x) * 0.004));
    sceneDrag.x = e.clientX; sceneDrag.y = e.clientY;
  }
});
const tableUp = (e: PointerEvent) => {
  touches.delete(e.pointerId); if (touches.size < 2) tablePinch = 0;
  if (mode !== 'table') return;
  if (onPaper) { onPaper = false; if (e.type === 'pointercancel') paper.cancel(); else paper.upAt(); }
  const tap = (d: { x0: number; y0: number; t0: number }) => e.type === 'pointerup' && performance.now() - d.t0 < 450 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10;
  if (figureDrag && tap(figureDrag)) go('bench');
  // (a tap on the room, off the paper: if it's on another place (a rail), go there)
  else if (sceneDrag && tap(sceneDrag)) tapPlace(e.clientX, e.clientY);
  // (a flick's let run down on the stand; a drag that stopped, stops)
  else if (figureDrag && cloth && performance.now() - figureDrag.t > 80) cloth.omega *= 0.3;
  figureDrag = null; sceneDrag = null;
};
canvas.addEventListener('pointerup', tableUp);
canvas.addEventListener('pointercancel', tableUp);
canvas.addEventListener('wheel', (e) => { if (mode === 'table') tableZoom = Math.max(0, Math.min(1, tableZoom + e.deltaY * 0.002)); });
/** from the table, out to the figure: across the table and up to it, the table and its paper in the foreground */
const FIGURE_FROM_TABLE = { az: TABLE.rot, el: 0.2, dist: 300, target: [18, 60, 12] as [number, number, number] };
function tableGoal() {
  const a = tableView(), b = FIGURE_FROM_TABLE, t = tableZoom * tableZoom * (3 - 2 * tableZoom), mix = (x: number, y: number) => x + (y - x) * t;
  return { az: mix(a.az, b.az) + tableTurn, el: mix(a.el, b.el), dist: mix(a.dist, b.dist), target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])] as [number, number, number] };
}

// ─── the frame ─────────────────────────────────────────────────────────────────────────────────
let frames = 0, last = performance.now(), stepMs = 0;
// (the cloth's clock: it runs in fixed 1/60 s steps, as many as wall-clock time has gone by (at most two a frame: a
// slow device sees the cloth slow down rather than fall ever further behind), and the time it couldn't keep up with
// is counted, not hidden)
const STEP = 1 / 60;
let kAt = 0;
/** a point of the paper's sheet, on the screen (css pixels) */
function sheetPx(px: number, py: number): [number, number] { const q = sheetToRoom(px, py), m = lastVP!, x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12], y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13], w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15]; return [(x / w * 0.5 + 0.5) * canvas.clientWidth, (1 - (y / w * 0.5 + 0.5)) * canvas.clientHeight]; }
let owed = 0, simTime = 0, wallTime = 0, renderMs = 0, frameMs = 16.7, perfAt = 0;
const perf = { fps: 0, frameMs: 0, simMs: 0, renderMs: 0, stepsPerFrame: 0, simSpeed: 1, particles: 0 };
let stepsWindow = 0, framesWindow = 0, simWindow = 0, wallWindow = 0;
function frame(now: number) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  frameMs = frameMs * 0.9 + raw * 1000 * 0.1;
  // (the camera: at the rails it rests in front of the one in use; crossing the room, it eases from one to the other)
  if (flying > 0) {
    const goal = mode === 'rails' ? room.viewOf(room.active, aspect()) : mode === 'table' ? tableGoal() : BENCH_VIEW, p = Math.min(1, (now - flyT0) / 1200), e = p * p * (3 - 2 * p);
    // (up and over a little as it crosses, as a walk across a room would look)
    view.az = flyFrom.az + (goal.az - flyFrom.az) * e; view.el = flyFrom.el + (goal.el - flyFrom.el) * e + Math.sin(Math.PI * p) * 0.08; view.dist = flyFrom.dist + (goal.dist - flyFrom.dist) * e + Math.sin(Math.PI * p) * 60;
    for (let c = 0; c < 3; c++) view.target[c] = flyFrom.target[c] + (goal.target[c] - flyFrom.target[c]) * e;
    if (p >= 1) flying = 0;
  } else if (mode === 'rails' || (mode === 'table' && !paper.dragging)) {
    // (at the rails, in front of the one in use; at the table, over the piece, following it as it grows or shrinks)
    const goal = mode === 'rails' ? room.viewOf(room.active, aspect()) : tableGoal(), k = 1 - Math.exp(-dt * (mode === 'table' ? 5 : 5));
    view.az += (goal.az - view.az) * k; view.el += (goal.el - view.el) * k; view.dist += (goal.dist - view.dist) * k;
    for (let c = 0; c < 3; c++) view.target[c] += (goal.target[c] - view.target[c]) * k;
  } else if (!drag && mode === 'bench') { idle += dt; if (preview || idle > 8) view.az += dt * 0.1; }
  if (mode === 'rails') { room.update(dt, 7); if (room.front() !== lastFront) railInfo(); }
  // (at the table, now and then: how big a fingertip is on the sheet from here, so its handles and badges are drawn a
  // fingertip's size on the screen)
  if (mode === 'table' && !paper.dragging && lastVP && now - kAt > 250) {
    kAt = now;
    const b = paper.bounds(), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, s0 = sheetPx(cx - 50, cy), s1 = sheetPx(cx + 50, cy), px = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const k = px > 1 ? Math.max(0.2, Math.min(6, 100 / px)) : paper.k;
    if (Math.abs(k - paper.k) / paper.k > 0.08) { paper.k = k; paper.draw(); }
  }
  if (cloth && mode !== 'rails') {
    // (a twirl: the figure spun up on its stand, held, and let run down)
    const want = now < twirlUntil ? Math.PI * 2 * 0.9 : 0, acc = now < twirlUntil ? 7 : 3.5;
    if (!figureDrag) cloth.omega += Math.max(-acc * dt, Math.min(acc * dt, want - cloth.omega));
    owed = Math.min(owed + raw, 0.25);
    let n = 0;
    const t0 = performance.now();
    while (owed >= STEP * 0.999 && n < 2) { cloth.step(STEP); owed -= STEP; simTime += STEP; n++; }
    // (whatever's still owed after two steps is let go: the cloth runs slow, it doesn't run away)
    if (n === 2 && owed > STEP) owed = 0;
    const took = performance.now() - t0;
    if (n) stepMs = stepMs * 0.9 + (took / n) * 0.1;
    simWindow += n * STEP; stepsWindow += n;
  }
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const items: Item[] = room.items();
  if (cloth) items.push({ cloth, look: { fabric: fabricById(rec.fabric), print: makePrint(rec.print, rec.colour) } });
  const r0 = performance.now();
  const fit = room.fittings();
  if (paper.version > 0) fit.paper = { canvas: paper.cv, version: paper.version, model: sheetModel() };
  lastVP = R.frame(view, items, w, h, cloth?.spin ?? 0, fit).vp;
  renderMs = renderMs * 0.9 + (performance.now() - r0) * 0.1;
  frames++; framesWindow++; wallWindow += raw; wallTime += raw;
  // (once a second: the whole frame on this device, not only the cloth's part of it)
  if (now - perfAt > 1000) {
    Object.assign(perf, { fps: Math.round(framesWindow / Math.max(1e-3, wallWindow)), frameMs: +frameMs.toFixed(1), simMs: +(stepMs * (stepsWindow / Math.max(1, framesWindow))).toFixed(1), renderMs: +renderMs.toFixed(1), stepsPerFrame: +(stepsWindow / Math.max(1, framesWindow)).toFixed(2), simSpeed: mode === 'bench' && wallWindow > 0 ? +(simWindow / wallWindow).toFixed(2) : 1, particles: cloth?.n ?? 0 });
    if (perfEl) perfEl.textContent = `${perf.fps} fps · frame ${perf.frameMs} ms · cloth ${perf.simMs} ms (${perf.stepsPerFrame} steps) · draw ${perf.renderMs} ms · cloth at ${Math.round(perf.simSpeed * 100)}% speed · ${perf.particles} pts`;
    perfAt = now; framesWindow = stepsWindow = 0; simWindow = wallWindow = 0;
  }
  requestAnimationFrame(frame);
}
if (preview) document.body.classList.add('preview');
document.body.classList.toggle('rails', mode === 'rails');
places();
// (the frame readout: `?perf`, or tap the title three times)
let perfEl: HTMLElement | null = null;
const showPerf = () => { perfEl ??= Object.assign(document.createElement('div'), { id: 'perf' }); document.getElementById('stage')!.appendChild(perfEl); };
if (qs.has('perf')) showPerf();
{ let taps = 0, at = 0; document.querySelector('nav .title')!.addEventListener('click', () => { const t = performance.now(); taps = t - at < 500 ? taps + 1 : 1; at = t; if (taps >= 3) { if (perfEl?.isConnected) perfEl.remove(); else showPerf(); } }); }
if (qs.get('at') === 'table' && mode === 'bench') { mode = 'table'; document.body.classList.add('table'); places(); }
if (mode !== 'rails') make();
else { Object.assign(view, room.viewOf(room.active, aspect()), { target: [...room.viewOf(room.active, aspect()).target] }); if (qs.has('warm')) for (let k = 0; k < 4; k++) room.update(1 / 60, 1e9); railUI(); }
if (qs.has('sheet')) toggleSheet();
for (let i = 0, n = Math.min(900, Number(qs.get('settle')) || 0); i < n; i++) (cloth as Cloth | null)?.step(1 / 60);
if (qs.has('twirl')) twirlUntil = performance.now() + 3200;
(window as unknown as { __fab: unknown }).__fab = {
  perf, probe: () => ({ mode, omega: cloth ? +cloth.omega.toFixed(2) : 0, cloth: paper.cloth, tableZoom: +tableZoom.toFixed(3), tableTurn: +tableTurn.toFixed(3), recipe: rec, moves: encodeMoves(rec.moves), frames, perf, simTime: +simTime.toFixed(2), wallTime: +wallTime.toFixed(2), particles: cloth?.n ?? 0, stepMs: +stepMs.toFixed(2), notes: sk.notes, checks: sk.checks.map((c) => `${c.ok ? 'ok' : 'BAD'} ${c.name}: ${c.detail}`), strain: cloth?.strain(), rail: room.states[room.active]?.rail.name, front: room.front(), onRail: room.states[room.active]?.hung.length }),
  // (for tests: where a point in the room is on the screen; where a point of the paper's sheet is)
  roomToScreen: (q: [number, number, number]) => { const m = lastVP!, x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12], y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13], w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15], r = canvas.getBoundingClientRect(); return [r.left + (x / w * 0.5 + 0.5) * r.width, r.top + (1 - (y / w * 0.5 + 0.5)) * r.height]; },
  sheetToScreen: (px: number, py: number) => { const q = sheetToRoom(px, py), m = lastVP!, x = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12], y = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13], w = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15], r = canvas.getBoundingClientRect(); return [r.left + (x / w * 0.5 + 0.5) * r.width, r.top + (1 - (y / w * 0.5 + 0.5)) * r.height]; },
  view, room, wear, backToRails, hangUp, paper, setRecipe: (r: Recipe) => { rec = r; make(); }, twirl: () => { twirlUntil = performance.now() + 3200; },
};
addEventListener('resize', () => (mode === 'rails' ? railUI() : ui()));
requestAnimationFrame(frame);
