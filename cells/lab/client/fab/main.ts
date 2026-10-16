/**
 * Fab: a dressmaker's workbench for children. A little wooden figure on its stand; for each slot (a skirt, a top, a
 * cape) six dials (shape, silhouette, drape, pieces, fabric, print) that don't pick a garment but make one: they
 * draft its pattern (pattern.ts), which is cut, sewn round the figure and falls as that cloth would (cloth.ts). The
 * dials meet in the cloth: a full circle in felt stands out like a bell where silk falls in folds; gathered at the
 * waist it ripples; more gores, more seams, and a stripe chevrons at each one.
 *
 * Drag the figure to turn round it, pinch to come close. Tap a slot to dress it; tap it again to take it off. The
 * pattern button shows the pieces flat, as they're cut. `?skirt=` `?top=` `?cape=` six hex pairs (one per dial) or
 * `off` · `?settle=N`
 * (frames of cloth before the first's drawn) · `?preview`.
 */
import { Cloth } from './cloth';
import { fabricAt, printAt } from './fabric';
import { DIALS, draft, words, type Dials, type SlotId } from './pattern';
import { createRenderer, type Look } from './render';
import { drawSheet } from './sheet';

const qs = new URLSearchParams(location.search), preview = qs.has('preview');
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL2 needed');
const R = createRenderer(gl);

const SLOTS: SlotId[] = ['skirt', 'top', 'cape'];
const NAMES: Record<SlotId, string> = { skirt: 'skirt', top: 'top', cape: 'cape' };
const DEFAULT: Record<SlotId, { on: boolean; d: Dials }> = {
  skirt: { on: true, d: { shape: 0.42, silhouette: 0.55, drape: 0.3, pieces: 0.38, fabric: 0.45, print: 0.36 } },
  top: { on: true, d: { shape: 0.3, silhouette: 0.2, drape: 0.25, pieces: 0.45, fabric: 0.45, print: 0.02 } },
  cape: { on: false, d: { shape: 0.5, silhouette: 0.6, drape: 0.3, pieces: 0.2, fabric: 0.85, print: 0.79 } },
};
const state = structuredClone(DEFAULT);
// (?skirt=6b8c4d6173 5c… : each dial a hex pair; or "off")
for (const s of SLOTS) {
  const v = qs.get(s);
  if (v === 'off') state[s].on = false;
  else if (v && /^[0-9a-f]{12}$/i.test(v)) { state[s].on = true; DIALS.forEach((k, i) => { state[s].d[k] = parseInt(v.slice(i * 2, i * 2 + 2), 16) / 255; }); }
}
const enc = (d: Dials) => DIALS.map((k) => Math.round(d[k] * 255).toString(16).padStart(2, '0')).join('');

// ─── making it ─────────────────────────────────────────────────────────────────────────────────
let cloth: Cloth | null = null, looks: Look[] = [], active: SlotId = (qs.get('slot') as SlotId) ?? 'skirt';
function make() {
  const worn = SLOTS.filter((s) => state[s].on), list = worn.map((s) => ({ garment: draft(s, state[s].d), fabric: fabricAt(state[s].d.fabric) }));
  looks = worn.map((s) => ({ fabric: fabricAt(state[s].d.fabric), print: printAt(state[s].d.print) }));
  cloth = list.length ? new Cloth(list, cloth ?? undefined) : null;
  R.setCloth(cloth);
  if (!preview) { const u = new URL(location.href); for (const s of SLOTS) u.searchParams.set(s, state[s].on ? enc(state[s].d) : 'off'); history.replaceState(null, '', u); }
  ui();
}
let pending = 0;
function remake() { if (pending) return; pending = window.setTimeout(() => { pending = 0; make(); }, 90); }

// ─── the bench's controls ──────────────────────────────────────────────────────────────────────
const tabs = document.getElementById('slots')!, dials = document.getElementById('dials')!, sheet = document.getElementById('sheet') as HTMLCanvasElement;
const knobs = new Map<keyof Dials, { el: HTMLElement; arc: SVGPathElement; dot: SVGCircleElement; word: HTMLElement }>();
const ICON: Record<keyof Dials, string> = { shape: '↕', silhouette: '◭', drape: '〰', pieces: '✂', fabric: '▦', print: '✿' };
for (const k of DIALS) {
  const el = document.createElement('div'); el.className = 'knob';
  el.innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" class="face"/><path class="track" d=""/><path class="arc" d=""/><circle class="dot" r="4.5"/><text x="32" y="38" text-anchor="middle">${ICON[k]}</text></svg><b>${k}</b><i></i>`;
  dials.appendChild(el);
  const arc = el.querySelector('.arc') as SVGPathElement, dot = el.querySelector('.dot') as SVGCircleElement, word = el.querySelector('i') as HTMLElement;
  (el.querySelector('.track') as SVGPathElement).setAttribute('d', arcPath(1));
  knobs.set(k, { el, arc, dot, word });
  // (turn it: drag round it, or up and down, or across)
  let last = 0, startA = 0;
  const angle = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); return Math.atan2(ev.clientX - (r.left + r.width / 2), -(ev.clientY - (r.top + r.width / 2))); };
  el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); last = ev.clientY - ev.clientX; startA = angle(ev); el.classList.add('turning'); ev.preventDefault(); });
  el.addEventListener('pointermove', (ev) => {
    if (!el.hasPointerCapture(ev.pointerId)) return;
    const a = angle(ev); let da = a - startA; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2; startA = a;
    const lin = ev.clientY - ev.clientX, dl = (last - lin) / 260; last = lin;
    const d = state[active].d;
    d[k] = Math.max(0, Math.min(1, d[k] + Math.max(-0.2, Math.min(0.2, da / 4.7 + dl))));
    if (!state[active].on) state[active].on = true;
    knob(k); remake();
  });
  el.addEventListener('pointerup', () => el.classList.remove('turning'));
}
function arcPath(t: number) {
  const a0 = -2.36, a1 = a0 + 4.71 * Math.max(0.001, t), p = (a: number) => `${32 + Math.sin(a) * 25} ${32 - Math.cos(a) * 25}`;
  return `M ${p(a0)} A 25 25 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
}
function knob(k: keyof Dials) {
  const kb = knobs.get(k)!, t = state[active].d[k], a = -2.36 + 4.71 * t;
  kb.arc.setAttribute('d', arcPath(t));
  kb.dot.setAttribute('cx', `${32 + Math.sin(a) * 25}`); kb.dot.setAttribute('cy', `${32 - Math.cos(a) * 25}`);
}
for (const s of SLOTS) {
  const b = document.createElement('button'); b.dataset.slot = s; b.innerHTML = `<span>${NAMES[s]}</span><em></em>`;
  b.addEventListener('click', () => { if (active === s) state[s].on = !state[s].on; else { active = s; if (!state[s].on) state[s].on = true; } make(); });
  tabs.appendChild(b);
}
function ui() {
  for (const b of Array.from(tabs.children) as HTMLElement[]) {
    const s = b.dataset.slot as SlotId; b.classList.toggle('active', s === active); b.classList.toggle('off', !state[s].on);
    b.querySelector('em')!.textContent = state[s].on ? 'wearing' : 'tap to add';
  }
  const w = words(active, state[active].d, draft(active, state[active].d));
  for (const k of DIALS) { knob(k); knobs.get(k)!.word.textContent = w[k]; }
  dials.classList.toggle('off', !state[active].on);
  if (sheetOn) drawSheet(sheet, state[active].on ? draft(active, state[active].d) : null, printAt(state[active].d.print), state[active].on ? `${NAMES[active]} · ${w.pieces} · ${w.fabric} · cut 1 of each` : `${NAMES[active]}: not wearing it`);
}
let sheetOn = false;
document.getElementById('pattern')!.addEventListener('click', () => { sheetOn = !sheetOn; document.body.classList.toggle('sheet', sheetOn); ui(); });
document.getElementById('surprise')!.addEventListener('click', () => {
  for (const k of DIALS) state[active].d[k] = Math.random();
  state[active].on = true; make();
});

// ─── turning round it ──────────────────────────────────────────────────────────────────────────
const view = { az: Number(qs.get('az') ?? 0.55), el: Number(qs.get('el') ?? 0.12), dist: Number(qs.get('dist') ?? 230), target: [0, Number(qs.get('ty') ?? 64), 0] as [number, number, number] };
let drag = false, lx = 0, ly = 0, pinch = 0, idle = 0;
canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); idle = 0; });
canvas.addEventListener('pointermove', (e) => { if (!drag || pinch) return; view.az -= (e.clientX - lx) * 0.008; view.el = Math.max(-0.2, Math.min(1, view.el + (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY; idle = 0; });
canvas.addEventListener('pointerup', () => { drag = false; });
canvas.addEventListener('wheel', (e) => { view.dist = Math.max(90, Math.min(360, view.dist * (1 + e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && pinch) { const p = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); view.dist = Math.max(90, Math.min(360, view.dist * pinch / p)); pinch = p; } }, { passive: true });
canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = 0; });

// ─── the frame ─────────────────────────────────────────────────────────────────────────────────
let frames = 0, last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!drag) { idle += dt; if (preview || idle > 6) view.az += dt * 0.12; }
  if (cloth) cloth.step(1 / 60);
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  R.frame(view, looks, w, h);
  frames++;
  requestAnimationFrame(frame);
}
if (preview) document.body.classList.add('preview');
make();
// (?settle=N: N frames of the cloth before the first's drawn, as it'd be after a moment)
for (let i = 0, n = Math.min(600, Number(qs.get("settle")) || 0); i < n; i++) (cloth as Cloth | null)?.step(1 / 60);
(window as unknown as { __fab: unknown }).__fab = { probe: () => ({ frames, particles: cloth?.n ?? 0, worn: SLOTS.filter((s) => state[s].on), active }), view };
requestAnimationFrame(frame);
