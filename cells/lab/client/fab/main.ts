/**
 * Fab: a dressmaking workbench for children. A little wooden figure on its stand, and something to wear: not chosen,
 * made. A skirt, a top, a dress, trousers or a jumpsuit, and the bench holds what a dressmaker decides about each part
 * of it: a skirt's length, fullness, whether that fullness is cut in as flare, gathered or pleated, how many panels and
 * tiers, where on the grain; a bodice's length and room, its neckline, sleeves and collar; trousers' legs, their width
 * and flare; which cloth, which print. The pattern that follows, drafted to the figure (garment.ts), lies on the bench
 * beside it. Every change re-cuts the pattern, which is sewn up and falls as that cloth falls (cloth.ts): its
 * silhouette, its folds and how it swings are never set, only found.
 *
 * It starts at the rails (rails.ts): along the workshop's wall, the workshop's rails (one for each kind of thing) and one
 * for each person, hung with what's been made. Slide a rail's garments along it, swipe up or down for the next rail, tap
 * the one in front to put it on the figure; it's taken off its hanger and sewn on, and the camera crosses the room to
 * the bench. **hang up** hangs it back on its owner's rail (or a new rail, asking whose); going back to the **rails**
 * does too, if it's changed.
 *
 * At the bench, drag the figure round, pinch to come close. **twirl** turns the figure on its stand; **sew** lays the
 * pieces out flat round it and sews them up again. The little pattern card opens the whole pattern.
 *
 * The design's in the address (see PARAMS): `?fam=skirt|top|dress|trousers|jumpsuit` · skirts `&len=` `&full=`
 * `&cut=flare|gather|pleat` `&panels=` `&grain=` (degrees) `&tiers=` · bodices `&blen=` `&ease=` `&swing=`
 * `&neck=round|v|square|boat|scoop` `&ndepth=` `&slen=` `&sleeve=plain|puff|bell` `&collar=none|peterpan|band|frill` ·
 * trousers `&llen=` `&lwidth=` `&flare=` · `&fabric=` `&print=` `&colour=` · `?settle=N` (frames of cloth before the
 * first's drawn) · `?preview` · `?rails` (start at the rails; a design in the query starts at the bench) · `?warm` (the
 * rails' garments settled before the first frame) · `?bench=evidence`.
 */
import { Cloth } from './cloth';
import { FABRICS, COLOURWAYS, PRINTS, fabricById, makePrint } from './fabric';
import { FAMILIES, describe, draftGarment, poseFor, sanitize, toBuild, type Garment } from './garment';
import { DEFAULT_DESIGN, type Design, type Family } from './pattern';
import { Room } from './rails';
import { createRenderer, type Item } from './render';
import { RAIL_COLOURS, activeRail, addRail, hang, rails, removeRail, renameRail, setActive, takeOff, type Rail } from './store';
import { drawSheet } from './sheet';

const qs = new URLSearchParams(location.search), preview = qs.has('preview');
if (qs.get('bench') === 'evidence') { void import('./evidence').then((m) => m.mountEvidence()); throw new Error('evidence bench'); }
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL2 needed');
const R = createRenderer(gl);

// ─── the design ────────────────────────────────────────────────────────────────────────────────
/** the design in the address: each field and the name it goes by there */
const PARAMS: Array<[keyof Design, string]> = [
  ['family', 'fam'], ['length', 'len'], ['fullness', 'full'], ['method', 'cut'], ['panels', 'panels'], ['grain', 'grain'], ['tiers', 'tiers'],
  ['bodyLen', 'blen'], ['ease', 'ease'], ['swing', 'swing'], ['neck', 'neck'], ['neckDepth', 'ndepth'], ['sleeveLen', 'slen'], ['sleeve', 'sleeve'], ['collar', 'collar'],
  ['legLen', 'llen'], ['legWidth', 'lwidth'], ['flare', 'flare'], ['fabric', 'fabric'], ['print', 'print'], ['colour', 'colour'],
];
const fromQuery = (): Design => {
  const x: Record<string, unknown> = {};
  for (const [k, q] of PARAMS) if (qs.has(q)) { const v = qs.get(q)!; x[k] = typeof DEFAULT_DESIGN[k] === 'number' ? Number(v) : v; }
  return sanitize(x as Partial<Design>);
};
const d: Design = fromQuery();

let g: Garment = draftGarment(d), cloth: Cloth | null = null;
function make(fresh = false) {
  const was = g;
  g = draftGarment(d);
  // (posed for it, then laid out and sewn: warm, from where the last cloth was, when it's the same kind of thing)
  poseFor(g);
  const warm = !fresh && !!cloth && was.design.family === g.design.family && was.pose === g.pose;
  const next = new Cloth(toBuild(g, fabricById(d.fabric)), warm ? cloth : null);
  if (cloth && warm) { next.spin = cloth.spin; next.omega = cloth.omega; }
  cloth = next;
  if (!preview && mode === 'bench') {
    const u = new URL(location.href);
    for (const [k, q] of PARAMS) { const v = d[k]; u.searchParams.set(q, typeof v === 'number' ? String(+v.toFixed(2)) : String(v)); }
    history.replaceState(null, '', u);
  }
  ui();
}
let pending = 0;
function remake() { if (pending) return; pending = window.setTimeout(() => { pending = 0; make(); }, 120); }

// ─── the bench ─────────────────────────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;
const card = $('card') as HTMLCanvasElement, sheet = $('sheet') as HTMLCanvasElement, notes = $('notes');
/** what's being worked on: a garment's parts (a dress is a bodice and a skirt) each have their own dials */
type Part = 'skirt' | 'bodice' | 'trousers';
const PARTS: Record<Family, Part[]> = { skirt: ['skirt'], top: ['bodice'], dress: ['bodice', 'skirt'], trousers: ['trousers'], jumpsuit: ['bodice', 'trousers'] };
let part: Part = PARTS[d.family][0];
type NumKey = { [K in keyof Design]: Design[K] extends number ? K : never }[keyof Design];
interface Knob { key: NumKey; label: string; lo: number; hi: number; step: number; word: (v: number) => string; only?: Family[] }
const KNOBS: Record<Part, Knob[]> = {
  skirt: [
    { key: 'length', label: 'length', lo: 12, hi: 62, step: 1, word: (v) => `${v.toFixed(0)} cm` },
    { key: 'fullness', label: 'fullness', lo: 1, hi: 4, step: 0.05, word: (v) => `${v.toFixed(1)}× round` },
    { key: 'panels', label: 'panels', lo: 1, hi: 10, step: 1, word: (v) => `${v.toFixed(0)}` },
    { key: 'grain', label: 'grain', lo: 0, hi: 45, step: 1, word: (v) => (v < 4 ? 'straight' : v > 41 ? 'bias' : `${v.toFixed(0)}° off`) },
  ],
  bodice: [
    { key: 'bodyLen', label: 'length', lo: -6, hi: 30, step: 1, word: (v) => (v < 0 ? `${(-v).toFixed(0)} cm cropped` : `${v.toFixed(0)} cm below`), only: ['top'] },
    { key: 'ease', label: 'room', lo: 4, hi: 16, step: 0.5, word: (v) => (v < 6 ? 'snug' : v > 12 ? 'roomy' : `${v.toFixed(0)} cm`) },
    { key: 'sleeveLen', label: 'sleeves', lo: 0, hi: 34, step: 1, word: (v) => (v < 2 ? 'none' : `${v.toFixed(0)} cm`) },
    { key: 'neckDepth', label: 'neck', lo: -4, hi: 8, step: 0.5, word: (v) => (Math.abs(v) < 0.6 ? 'as cut' : v > 0 ? `${v.toFixed(0)} cm lower` : `${(-v).toFixed(0)} cm higher`) },
    { key: 'swing', label: 'swing', lo: 1, hi: 1.8, step: 0.05, word: (v) => (v < 1.05 ? 'straight' : `${v.toFixed(2)}× wide`), only: ['top'] },
  ],
  trousers: [
    { key: 'legLen', label: 'legs', lo: 3, hi: 34, step: 1, word: (v) => `${v.toFixed(0)} cm` },
    { key: 'legWidth', label: 'width', lo: 1, hi: 2, step: 0.05, word: (v) => (v < 1.15 ? 'slim' : v > 1.7 ? 'wide' : `${v.toFixed(1)}× room`) },
    { key: 'flare', label: 'flare', lo: 0.8, hi: 1.8, step: 0.05, word: (v) => (v < 0.95 ? 'tapered' : v < 1.08 ? 'straight' : `${v.toFixed(1)}× flared`) },
  ],
};
/** the choices on each part, in one row: each group's options, drawn or named */
interface Choice { key: keyof Design; label: string; opts: Array<{ v: string | number; label: string; icon?: string }> }
const CHOICES: Record<Part, Choice[]> = {
  skirt: [
    { key: 'method', label: '', opts: [
      { v: 'flare', label: 'flared', icon: '<path d="M14 6h8l8 22H6z"/>' },
      { v: 'gather', label: 'gathered', icon: '<path d="M8 6h20M8 6q2 4 0 8t0 8M14 6q2 4 0 8t0 8M20 6q2 4 0 8t0 8M26 6q2 4 0 8t0 8M6 28h24"/>' },
      { v: 'pleat', label: 'pleated', icon: '<path d="M6 6h24M9 6v22M15 6v22M21 6v22M27 6v22M6 28h24"/>' },
    ] },
    { key: 'tiers', label: 'tiers', opts: [{ v: 1, label: 'one' }, { v: 2, label: 'two' }, { v: 3, label: 'three' }] },
  ],
  bodice: [
    { key: 'neck', label: 'neck', opts: [
      { v: 'round', label: 'round', icon: '<path d="M6 8h7q5 9 10 0h7"/>' }, { v: 'v', label: 'V', icon: '<path d="M6 8h7l5 12 5-12h7"/>' },
      { v: 'square', label: 'square', icon: '<path d="M6 8h6l1 10h10l1-10h6"/>' }, { v: 'boat', label: 'boat', icon: '<path d="M6 8h3q9 6 18 0h3"/>' },
      { v: 'scoop', label: 'scoop', icon: '<path d="M6 8h5q7 16 14 0h5"/>' },
    ] },
    { key: 'sleeve', label: 'sleeve', opts: [
      { v: 'plain', label: 'plain', icon: '<path d="M8 8l-4 12h10l1-8"/>' }, { v: 'puff', label: 'puff', icon: '<path d="M8 10q-6-6-6 4t6 6h6q2-8-6-10z"/>' },
      { v: 'bell', label: 'bell', icon: '<path d="M8 8l-6 14h14l-4-12"/>' },
    ] },
    { key: 'collar', label: 'collar', opts: [
      { v: 'none', label: 'none' }, { v: 'peterpan', label: 'Peter Pan', icon: '<path d="M6 8q2 10 11 8l1-6 1 6q9 2 11-8"/>' },
      { v: 'band', label: 'band', icon: '<path d="M8 6h20v6H8z"/>' }, { v: 'frill', label: 'frill', icon: '<path d="M6 10q3 4 6 0t6 0 6 0 6 0"/>' },
    ] },
  ],
  trousers: [],
};
const knobs = new Map<string, { arc: SVGPathElement; dot: SVGCircleElement; word: HTMLElement; k: Knob }>();
const arcPath = (t: number) => {
  const a0 = -2.36, a1 = a0 + 4.71 * Math.max(0.001, t), p = (a: number) => `${32 + Math.sin(a) * 25} ${32 - Math.cos(a) * 25}`;
  return `M ${p(a0)} A 25 25 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
};
/** the dials and choices for the part being worked on (built again when it changes) */
let builtFor = '';
function bench() {
  const key = `${d.family}/${part}`;
  if (key === builtFor) return;
  builtFor = key;
  // (what's made, and which part of it)
  const fam = $('families'); fam.innerHTML = '';
  for (const f of FAMILIES) {
    const b = document.createElement('button'); b.className = `fam${f.f === d.family ? ' on' : ''}`; b.textContent = f.label;
    b.addEventListener('click', () => { if (d.family === f.f) return; d.family = f.f; part = PARTS[f.f][0]; make(true); });
    fam.appendChild(b);
  }
  const parts = $('parts'); parts.innerHTML = ''; parts.style.display = PARTS[d.family].length > 1 ? '' : 'none';
  for (const p of PARTS[d.family]) {
    const b = document.createElement('button'); b.className = `fam part${p === part ? ' on' : ''}`; b.textContent = `the ${p}`;
    b.addEventListener('click', () => { part = p; bench(); ui(); });
    parts.appendChild(b);
  }
  const ch = $('choices'); ch.innerHTML = ''; ch.style.display = CHOICES[part].length ? '' : 'none';
  for (const c of CHOICES[part]) {
    if (c.label) { const l = document.createElement('i'); l.textContent = c.label; ch.appendChild(l); }
    for (const o of c.opts) {
      const b = document.createElement('button'); b.dataset.k = c.key; b.dataset.v = String(o.v);
      b.innerHTML = `${o.icon ? `<svg viewBox="0 0 36 34">${o.icon}</svg>` : ''}<span>${o.label}</span>`;
      b.addEventListener('click', () => { (d as unknown as Record<string, unknown>)[c.key] = o.v; make(); });
      ch.appendChild(b);
    }
  }
  const kn = $('knobs'); kn.innerHTML = ''; knobs.clear();
  for (const k of KNOBS[part].filter((x) => !x.only || x.only.includes(d.family))) {
    const el = document.createElement('div'); el.className = 'knob';
    el.innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" class="face"/><path class="track" d="${arcPath(1)}"/><path class="arc" d=""/><circle class="dot" r="4.5"/></svg><b>${k.label}</b><i></i>`;
    kn.appendChild(el);
    knobs.set(k.key, { arc: el.querySelector('.arc')!, dot: el.querySelector('.dot')!, word: el.querySelector('i')!, k });
    // (turned by dragging round it, or up and down)
    let startA = 0, last = 0, acc = 0;
    const angle = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.width / 2))); };
    el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); startA = angle(ev); last = ev.clientY - ev.clientX; acc = (d[k.key] - k.lo) / (k.hi - k.lo); el.classList.add('turning'); ev.preventDefault(); });
    el.addEventListener('pointermove', (ev) => {
      if (!el.hasPointerCapture(ev.pointerId)) return;
      const a = angle(ev); let da = a - startA; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; startA = a;
      const lin = ev.clientY - ev.clientX, dl = (last - lin) / 240; last = lin;
      acc = Math.max(0, Math.min(1, acc + Math.max(-0.2, Math.min(0.2, da / 4.7 + dl))));
      const v = +(Math.round((k.lo + acc * (k.hi - k.lo)) / k.step) * k.step).toFixed(3);
      if (v !== d[k.key]) { (d as unknown as Record<string, number>)[k.key] = v; knob(k); remake(); }
    });
    el.addEventListener('pointerup', () => el.classList.remove('turning'));
  }
}
function knob(k: Knob) {
  const kb = knobs.get(k.key); if (!kb) return;
  const t = Math.max(0, Math.min(1, (d[k.key] - k.lo) / (k.hi - k.lo))), a = -2.36 + 4.71 * t;
  kb.arc.setAttribute('d', arcPath(t));
  kb.dot.setAttribute('cx', `${32 + Math.sin(a) * 25}`); kb.dot.setAttribute('cy', `${32 - Math.cos(a) * 25}`);
  const cutPanels = Number(/cut in (\d+) panels/.exec(g.notes.join(' '))?.[1] ?? NaN);
  kb.word.textContent = k.key === 'panels' && Number.isFinite(cutPanels) && cutPanels !== d.panels ? `${cutPanels} (needs)` : k.word(d[k.key]);
}
for (const f of FABRICS) {
  const b = document.createElement('button'); b.className = 'swatch'; b.dataset.f = f.id;
  b.innerHTML = `<span style="background:${f.card}"></span>${f.name}`;
  b.addEventListener('click', () => { d.fabric = f.id; make(); });
  $('fabrics').appendChild(b);
}
for (let k = 0; k < PRINTS.length; k++) {
  const b = document.createElement('button'); b.className = 'print'; b.dataset.k = String(k);
  b.innerHTML = `<canvas width="56" height="40"></canvas>${PRINTS[k]}`;
  // (tap a print to choose it; tap it again for its next colourway)
  b.addEventListener('click', () => { if (d.print === k) d.colour = (d.colour + 1) % COLOURWAYS.length; d.print = k; make(); });
  $('prints').appendChild(b);
}
function ui() {
  if (!PARTS[d.family].includes(part)) part = PARTS[d.family][0];
  bench();
  for (const kb of knobs.values()) knob(kb.k);
  for (const b of Array.from($('choices').querySelectorAll('button')) as HTMLElement[]) {
    const v = (d as unknown as Record<string, unknown>)[b.dataset.k!];
    b.classList.toggle('on', String(v) === b.dataset.v);
    // (a sleeve's cut means nothing without a sleeve)
    b.classList.toggle('off', b.dataset.k === 'sleeve' && d.sleeveLen < 2);
  }
  for (const b of Array.from($('fabrics').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.f === d.fabric);
  for (const b of Array.from($('prints').children) as HTMLElement[]) {
    const k = Number(b.dataset.k); b.classList.toggle('on', k === d.print);
    const cv = b.querySelector('canvas')!; cv.style.width = '28px'; cv.style.height = '20px';
    drawSwatch(cv, k, d.colour);
  }
  notes.textContent = `${describe(d)} · ${g.notes.join(' · ')}`;
  const bad = g.checks.filter((c) => !c.ok);
  if (bad.length) notes.textContent += ` · ✗ ${bad.map((c) => c.name).join(', ')}`;
  const pr = makePrint(d.print, d.colour);
  drawSheet(card, g, pr, true);
  if (sheetOn) drawSheet(sheet, g, pr);
}
function drawSwatch(cv: HTMLCanvasElement, kind: number, colour: number) {
  const c = cv.getContext('2d')!, inks = COLOURWAYS[((colour % COLOURWAYS.length) + COLOURWAYS.length) % COLOURWAYS.length].inks;
  c.fillStyle = inks[0]; c.fillRect(0, 0, 56, 40); c.fillStyle = inks[1];
  if (kind === 1) for (let x = 0; x < 56; x += 12) c.fillRect(x, 0, 4, 40);
  if (kind === 2) { c.globalAlpha = 0.5; for (let x = 0; x < 56; x += 12) { c.fillRect(x, 0, 6, 40); c.fillRect(0, x, 56, 6); } c.globalAlpha = 1; }
  if (kind === 3) for (let y = 6; y < 40; y += 12) for (let x = (y / 12) % 2 ? 6 : 12; x < 56; x += 12) { c.beginPath(); c.arc(x, y, 2.6, 0, 7); c.fill(); }
  if (kind === 4) for (const [x, y] of [[12, 12], [36, 26], [52, 8]]) for (let p = 0; p < 5; p++) { const a = (p / 5) * 6.28; c.beginPath(); c.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, 7); c.fill(); }
  if (kind === 5) for (const [x, y] of [[12, 12], [36, 26], [50, 10]]) { c.beginPath(); for (let p = 0; p < 10; p++) { const a = -1.57 + (p / 10) * 6.28, r = p % 2 ? 2.5 : 6; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.fill(); }
}
let sheetOn = false;
const toggleSheet = () => { sheetOn = !sheetOn; document.body.classList.toggle('sheet', sheetOn); ui(); };
card.addEventListener('click', toggleSheet);
sheet.addEventListener('click', toggleSheet);
$('pattern').addEventListener('click', toggleSheet);
$('sew').addEventListener('click', () => make(true));
let twirlUntil = 0;
$('twirl').addEventListener('click', () => { twirlUntil = performance.now() + 3200; });

// ─── the rails: where every skirt starts and ends ──────────────────────────────────────────────
type Mode = 'rails' | 'bench';
const hasDesign = PARAMS.some(([, q]) => qs.has(q));
let mode: Mode = qs.has('rails') || (!hasDesign && !preview && !qs.has('settle') && !qs.has('sheet')) ? 'rails' : 'bench';
const room = new Room();
room.active = Math.max(0, room.states.findIndex((st) => st.rail.id === activeRail()));
/** where the skirt on the figure came from: a rail and the garment on it, and its design as it was then */
let origin: { rail: string; garment: string | null; design: Design } | null = null;
let lastVP: Float32Array | null = null, toastT = 0, lastFront = -1;
const toast = (t: string) => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = window.setTimeout(() => el.classList.remove('show'), 2400); };
const railName = (r: Rail) => (r.workshop ? (r.id === 'workshop' ? 'the workshop’s skirts' : `the workshop’s ${r.name.replace(/^the workshop: /, '')}`) : /rail/i.test(r.name) ? r.name : `${r.name}’s rail`);

function railUI() {
  const tags = $('railtags'); tags.innerHTML = '';
  room.states.forEach((st, k) => {
    const b = document.createElement('button'); b.className = `tag${k === room.active ? ' on' : ''}`;
    b.style.setProperty('--c', st.rail.workshop ? '#9a9aa0' : RAIL_COLOURS[st.rail.colour % RAIL_COLOURS.length].css);
    b.textContent = st.rail.workshop ? (st.rail.id === 'workshop' ? 'skirts' : st.rail.name.replace(/^the workshop: /, '')) : st.rail.name;
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
  if (!h) { $('railwhat').textContent = ''; return; }
  if (!h.g) { $('railwhat').textContent = 'a bare hanger: start something new'; $('wear').textContent = 'start one'; return; }
  const g = h.g.design;
  $('railwhat').textContent = `${describe(g)} in ${fabricById(g.fabric).name}${g.print ? `, ${PRINTS[g.print]}` : ''}`;
  $('wear').textContent = 'put it on the figure';
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
  Object.assign(d, sanitize(h.g?.design)); part = PARTS[d.family][0];
  origin = { rail: st.rail.id, garment: h.g?.id ?? null, design: { ...d } };
  room.onFigure = h.g?.id ?? null;
  setMode('bench');
  make(true);
}
/** hang what's on the figure up: back on its own hanger if it's someone's, else on the rail in use (asking whose, if
 * nobody has a rail yet). Nothing's hung if it's unchanged and already someone's. */
function hangUp(): boolean {
  const own = origin ? rails().find((r) => r.id === origin!.rail && !r.workshop) : undefined;
  if (own && origin?.garment && JSON.stringify(origin.design) === JSON.stringify(d)) { toast(`it’s on ${railName(own)} already`); return false; }
  let id = own?.id ?? (rails().find((r) => r.id === activeRail() && !r.workshop) ?? rails().find((r) => !r.workshop))?.id;
  if (!id) { const n = prompt('Hang it on whose rail? (a name)'); if (!n || !n.trim()) return false; id = addRail(n).id; }
  const g = hang(id, d, own ? origin?.garment ?? undefined : undefined);
  if (!g) return false;
  origin = { rail: id, garment: g.id, design: { ...d } };
  room.refresh(); room.onFigure = g.id;
  toast(`hung on ${railName(rails().find((r) => r.id === id)!)}`);
  return true;
}
function backToRails() {
  if (!origin || JSON.stringify(origin.design) !== JSON.stringify(d)) hangUp();
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
  if (m === 'rails') {
    if (sheetOn) toggleSheet();
    if (!preview) { const u = new URL(location.href); for (const [, q] of PARAMS) u.searchParams.delete(q); history.replaceState(null, '', u); }
    railUI();
  } else ui();
}
$('wear').addEventListener('click', () => wear(room.front()));
$('torails').addEventListener('click', backToRails);
$('hang').addEventListener('click', () => hangUp());

// ─── turning round it, and along the rails ─────────────────────────────────────────────────────
const BENCH_VIEW = { az: Number(qs.get('az') ?? 0.55), el: Number(qs.get('el') ?? 0.1), dist: Number(qs.get('dist') ?? 200), target: [0, Number(qs.get('ty') ?? 52), 0] as [number, number, number] };
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
      if (stt.rail.workshop) { toast('the workshop’s things stay: put one on the figure, and hang up your own'); return; }
      drag = false;
      if (confirm(`Take ${describe(h.g.design)} off ${railName(stt.rail)}? It’ll be gone.`)) { takeOff(stt.rail.id, h.g.id); room.refresh(); railInfo(); }
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
  view.az -= dx * 0.008; view.el = Math.max(-0.2, Math.min(1.2, view.el + dy * 0.004));
});
canvas.addEventListener('pointerup', (e) => {
  drag = false; clearTimeout(press);
  if (mode !== 'rails') return;
  if (room.dragging) { room.dragging = false; if (performance.now() - lastMove > 90) room.states[room.active].vel = 0; return; }
  if (axis === 'y') { const dy = e.clientY - sy; if (Math.abs(dy) > 40) showRail(room.active + (dy < 0 ? 1 : -1)); return; }
  if (!axis && performance.now() - st0 < 600 && lastVP) {
    const [px, py] = local(e), i = room.pick(px, py, lastVP, canvas.clientWidth, canvas.clientHeight);
    if (i < 0) return;
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

// ─── the frame ─────────────────────────────────────────────────────────────────────────────────
let frames = 0, last = performance.now(), stepMs = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // (the camera: at the rails it rests in front of the one in use; crossing the room, it eases from one to the other)
  if (flying > 0) {
    const goal = mode === 'rails' ? room.viewOf(room.active, aspect()) : BENCH_VIEW, p = Math.min(1, (now - flyT0) / 1200), e = p * p * (3 - 2 * p);
    // (up and over a little as it crosses, as a walk across a room would look)
    view.az = flyFrom.az + (goal.az - flyFrom.az) * e; view.el = flyFrom.el + (goal.el - flyFrom.el) * e + Math.sin(Math.PI * p) * 0.08; view.dist = flyFrom.dist + (goal.dist - flyFrom.dist) * e + Math.sin(Math.PI * p) * 60;
    for (let c = 0; c < 3; c++) view.target[c] = flyFrom.target[c] + (goal.target[c] - flyFrom.target[c]) * e;
    if (p >= 1) flying = 0;
  } else if (mode === 'rails') {
    const goal = room.viewOf(room.active, aspect()), k = 1 - Math.exp(-dt * 5);
    view.az += (goal.az - view.az) * k; view.el += (goal.el - view.el) * k; view.dist += (goal.dist - view.dist) * k;
    for (let c = 0; c < 3; c++) view.target[c] += (goal.target[c] - view.target[c]) * k;
  } else {
    // (looking at what's made: a skirt's or trousers' middle, a top's chest)
    const ty = qs.has('ty') ? BENCH_VIEW.target[1] : { skirt: 52, top: 80, dress: 68, trousers: 42, jumpsuit: 62 }[d.family];
    view.target[1] += (ty - view.target[1]) * (1 - Math.exp(-dt * 4));
    if (!drag) { idle += dt; if (preview || idle > 8) view.az += dt * 0.1; }
  }
  if (mode === 'rails') { room.update(dt, 7); if (room.front() !== lastFront) railInfo(); }
  if (cloth && mode === 'bench') {
    // (a twirl: the figure spun up on its stand, held, and let run down)
    const want = now < twirlUntil ? Math.PI * 2 * 0.9 : 0, acc = now < twirlUntil ? 7 : 3.5;
    cloth.omega += Math.max(-acc * dt, Math.min(acc * dt, want - cloth.omega));
    const t0 = performance.now(); cloth.step(1 / 60); stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
  }
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const items: Item[] = room.items();
  if (cloth) items.push({ cloth, look: { fabric: fabricById(d.fabric), print: makePrint(d.print, d.colour) } });
  lastVP = R.frame(view, items, w, h, cloth?.spin ?? 0, room.fittings()).vp;
  frames++;
  requestAnimationFrame(frame);
}
if (preview) document.body.classList.add('preview');
document.body.classList.toggle('rails', mode === 'rails');
if (mode === 'bench') make();
else { Object.assign(view, room.viewOf(room.active, aspect()), { target: [...room.viewOf(room.active, aspect()).target] }); if (qs.has('warm')) for (let k = 0; k < 4; k++) room.update(1 / 60, 1e9); railUI(); }
if (qs.has('sheet')) toggleSheet();
for (let i = 0, n = Math.min(900, Number(qs.get('settle')) || 0); i < n; i++) (cloth as Cloth | null)?.step(1 / 60);
if (qs.has('twirl')) twirlUntil = performance.now() + 3200;
(window as unknown as { __fab: unknown }).__fab = {
  probe: () => ({ mode, frames, family: d.family, what: describe(d), particles: cloth?.n ?? 0, stepMs: +stepMs.toFixed(2), notes: g.notes, checks: g.checks.map((c) => `${c.ok ? 'ok' : 'BAD'} ${c.name}: ${c.detail}`), strain: cloth?.strain(), seams: cloth?.seams(), rail: room.states[room.active]?.rail.name, front: room.front(), onRail: room.states[room.active]?.hung.length }),
  view, room, wear, backToRails, hangUp, twirl: () => { twirlUntil = performance.now() + 3200; },
};
addEventListener('resize', () => (mode === 'bench' ? ui() : railUI()));
requestAnimationFrame(frame);
