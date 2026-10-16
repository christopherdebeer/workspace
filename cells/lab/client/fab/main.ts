/**
 * Fab: a dressmaking workbench for children. A little wooden figure on its stand, and a skirt: not chosen, made. The
 * bench holds what a dressmaker decides (how long; how full; whether that fullness is cut in as flare, gathered or
 * pleated; how many panels; where on the cloth's grain they're cut; which cloth, which print) and the pattern that
 * follows from it, drafted to the figure (pattern.ts), lies on the bench beside it. Every change re-cuts the pattern,
 * which is sewn up and falls as that cloth falls (cloth.ts): its silhouette, its folds and how it swings are never
 * set, only found.
 *
 * Drag the figure round, pinch to come close. **twirl** turns the figure on its stand; **sew** lays the pieces out
 * flat round it and sews them up again. The little pattern card opens the whole pattern.
 *
 * `?len=` `&full=` `&cut=flare|gather|pleat` `&panels=` `&grain=` (degrees) `&fabric=` `&print=` `&colour=` ·
 * `?settle=N` (frames of cloth before the first's drawn) · `?preview` · `?bench=evidence` (the evidence bench).
 */
import { Cloth } from './cloth';
import { FABRICS, COLOURWAYS, PRINTS, fabricById, makePrint } from './fabric';
import { DEFAULT_DESIGN, draft, toBuild, type Design, type Method, type Skirt } from './pattern';
import { createRenderer } from './render';
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

let sk: Skirt = draft(d), cloth: Cloth | null = null;
function make(fresh = false) {
  sk = draft(d);
  const next = new Cloth(toBuild(sk, fabricById(d.fabric)), fresh ? null : cloth);
  if (cloth && !fresh) { next.spin = cloth.spin; next.omega = cloth.omega; }
  cloth = next;
  R.setCloth(cloth);
  if (!preview) {
    const u = new URL(location.href);
    for (const [k, v] of [['len', d.length.toFixed(0)], ['full', d.fullness.toFixed(2)], ['cut', d.method], ['panels', String(d.panels)], ['grain', d.grain.toFixed(0)], ['fabric', d.fabric], ['print', String(d.print)], ['colour', String(d.colour)]]) u.searchParams.set(k, v);
    history.replaceState(null, '', u);
  }
  ui();
}
let pending = 0;
function remake() { if (pending) return; pending = window.setTimeout(() => { pending = 0; make(); }, 120); }

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
    if (v !== d[k.key]) { d[k.key] = v; knob(k); remake(); }
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
  b.addEventListener('click', () => { d.method = x.m; make(); });
  $('methods').appendChild(b);
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
  for (const k of KNOBS) knob(k);
  for (const b of Array.from($('methods').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.m === d.method);
  for (const b of Array.from($('fabrics').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.f === d.fabric);
  for (const b of Array.from($('prints').children) as HTMLElement[]) {
    const k = Number(b.dataset.k); b.classList.toggle('on', k === d.print);
    const cv = b.querySelector('canvas')!; cv.style.width = '28px'; cv.style.height = '20px';
    drawSwatch(cv, k, k === d.print ? d.colour : d.colour);
  }
  notes.textContent = sk.notes.join(' · ');
  const bad = sk.checks.filter((c) => !c.ok);
  if (bad.length) notes.textContent += ` · ✗ ${bad.map((c) => c.name).join(', ')}`;
  const pr = makePrint(d.print, d.colour);
  drawSheet(card, sk, pr, true);
  if (sheetOn) drawSheet(sheet, sk, pr);
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
let sheetOn = false;
const toggleSheet = () => { sheetOn = !sheetOn; document.body.classList.toggle('sheet', sheetOn); ui(); };
card.addEventListener('click', toggleSheet);
sheet.addEventListener('click', toggleSheet);
$('pattern').addEventListener('click', toggleSheet);
$('sew').addEventListener('click', () => make(true));
let twirlUntil = 0;
$('twirl').addEventListener('click', () => { twirlUntil = performance.now() + 3200; });
$('surprise').addEventListener('click', () => {
  d.length = 14 + Math.round(Math.random() * 44); d.fullness = Math.round((1 + Math.random() * 3) * 20) / 20;
  d.method = (['flare', 'gather', 'pleat'] as Method[])[Math.floor(Math.random() * 3)]; d.panels = 1 + Math.floor(Math.random() * 8);
  d.grain = Math.random() < 0.3 ? 45 : 0; d.fabric = FABRICS[Math.floor(Math.random() * FABRICS.length)].id;
  d.print = Math.floor(Math.random() * PRINTS.length); d.colour = Math.floor(Math.random() * COLOURWAYS.length);
  make();
});

// ─── turning round it ──────────────────────────────────────────────────────────────────────────
const view = { az: Number(qs.get('az') ?? 0.55), el: Number(qs.get('el') ?? 0.1), dist: Number(qs.get('dist') ?? 200), target: [0, Number(qs.get('ty') ?? 52), 0] as [number, number, number] };
let drag = false, lx = 0, ly = 0, pinch = 0, idle = 0;
canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); idle = 0; });
canvas.addEventListener('pointermove', (e) => { if (!drag || pinch) return; view.az -= (e.clientX - lx) * 0.008; view.el = Math.max(-0.2, Math.min(1.2, view.el + (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY; idle = 0; });
canvas.addEventListener('pointerup', () => { drag = false; });
canvas.addEventListener('wheel', (e) => { view.dist = Math.max(80, Math.min(360, view.dist * (1 + e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pinch) { const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); view.dist = Math.max(80, Math.min(360, view.dist * pinch / p)); pinch = p; } }, { passive: true });
canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = 0; });

// ─── the frame ─────────────────────────────────────────────────────────────────────────────────
let frames = 0, last = performance.now(), stepMs = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!drag) { idle += dt; if (preview || idle > 8) view.az += dt * 0.1; }
  if (cloth) {
    // (a twirl: the figure spun up on its stand, held, and let run down)
    const want = now < twirlUntil ? Math.PI * 2 * 0.9 : 0, acc = now < twirlUntil ? 7 : 3.5;
    cloth.omega += Math.max(-acc * dt, Math.min(acc * dt, want - cloth.omega));
    const t0 = performance.now(); cloth.step(1 / 60); stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
  }
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  R.frame(view, cloth ? { fabric: fabricById(d.fabric), print: makePrint(d.print, d.colour) } : null, w, h, cloth?.spin ?? 0);
  frames++;
  requestAnimationFrame(frame);
}
if (preview) document.body.classList.add('preview');
make();
if (qs.has('sheet')) toggleSheet();
for (let i = 0, n = Math.min(900, Number(qs.get('settle')) || 0); i < n; i++) (cloth as Cloth | null)?.step(1 / 60);
if (qs.has('twirl')) twirlUntil = performance.now() + 3200;
(window as unknown as { __fab: unknown }).__fab = { probe: () => ({ frames, particles: cloth?.n ?? 0, stepMs: +stepMs.toFixed(2), notes: sk.notes, checks: sk.checks.map((c) => `${c.ok ? 'ok' : 'BAD'} ${c.name}: ${c.detail}`), strain: cloth?.strain() }), view, twirl: () => { twirlUntil = performance.now() + 3200; } };
addEventListener('resize', () => ui());
requestAnimationFrame(frame);
