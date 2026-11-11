/**
 * Volley: a brick-breaker down a tunnel without end, with no paddle: the screen is the glass you're behind, and the
 * ball is returned by a hand on it.
 *
 * The game is in sim.ts (the tunnel, the slabs, the ball, what a hand does to it); the picture in draw.ts. Here are
 * the fingers (each one a hand on the glass, with where it is and how it's moving), the marks drawn on the glass (a
 * ring under each hand, and a ring where the ball will come back through), the sound, and the words.
 *
 * Flags: seed, hand (pad | swipe | catch: what a finger is), auto (a stand-in plays), t (run on this many seconds
 * first), still (and hold there), guide=0 (no ring where the ball will come back), mute, preview (the index's card).
 */
import { H, ROWS, CELL, BRICK_T, R, HAND_R, FULL, MODES, SWIPE_MIN, create, advance, serve, grab, release, restart, speed, POWER_MAX, crossing, colsFor, cellX, cellY, type Sim, type Ev, type Mode, type Hand } from './sim';
import { createRenderer, KIND, STRIDE, type Frame } from './draw';
import { seeded, seedFrom } from '../kit/rng';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), auto = preview || qs.has('auto'), still = qs.has('still'), guide = qs.get('guide') !== '0';
const seed = seedFrom(qs.get('seed')) ?? 1;
let mute = preview || qs.has('mute');
const asked = qs.get('hand') as Mode | null;

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
const FOG: [number, number, number] = [0.03, 0.045, 0.07];
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const GLAZE = ['#2f6fb0', '#2aa39a', '#e0a23a', '#d9603c', '#8f6ad0', '#6fb04a'].map(hex);
const HARD = hex('#3a3440'), PANEL = hex('#6d7a8c'), WAKE = hex('#ff7a3a');
// (the lamps' colour, by how far down you are)
const TINTS = ['#ffd9a0', '#a8d8ff', '#ffb3a0', '#b8f0c8', '#d8c0ff'].map(hex);

const sim: Sim = create(seed, aspect(), asked && MODES.includes(asked) ? asked : 'pad');
if (preview) document.body.classList.add('preview');

// ─── what's drawn ────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX = 1400, boxes = new Float32Array(STRIDE * MAX);
let count = 0;
function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number[], kind = 0, glow = 0) {
  if (count >= MAX) return;
  boxes.set([x, y, z, sx, sy, sz, c[0], c[1], c[2], kind, glow], count++ * STRIDE);
}
interface Bit { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; life: number; c: number[]; wake?: boolean }
const bits: Bit[] = [];
const vr = seeded(seed ^ 0x5bd1);
/** bricks just struck and still standing (the ones that take two): slab, cell, how long ago */
const struck: { z: number; x: number; y: number; t: number }[] = [];
let shake = 0;
const brickColour = (hue: number, row: number) => GLAZE[hue].map((v) => v + (1 - v) * (row / ROWS) * 0.32);

function scene(): Frame {
  count = 0;
  const SEG = 2 * CELL, T = 6, z0 = Math.floor((sim.z - 1) / SEG) * SEG;
  for (let z = z0; z < sim.z + 118; z += SEG) {
    const zc = z + SEG / 2;
    box(-sim.W / 2 - T / 2, 0, zc, T, H + 2 * T, SEG, PANEL, KIND.tunnel);
    box(sim.W / 2 + T / 2, 0, zc, T, H + 2 * T, SEG, PANEL, KIND.tunnel);
    box(0, -H / 2 - T / 2, zc, sim.W, T, SEG, PANEL, KIND.tunnel);
    box(0, H / 2 + T / 2, zc, sim.W, T, SEG, PANEL, KIND.tunnel);
  }
  const cw = sim.W / sim.cols;
  for (const sl of sim.slabs) {
    if (!sl.left) continue;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < sim.cols; c++) {
      const hp = sl.cells[r * sim.cols + c];
      if (!hp) continue;
      const x = cellX(sim, c), y = cellY(r), hit = struck.find((k) => k.z === sl.z && k.x === x && k.y === y);
      box(x, y, sl.z, cw - 0.08, CELL - 0.08, BRICK_T, hp > 1 ? HARD : brickColour(sl.hue, r), KIND.brick, hit ? 0.6 * Math.max(0, 1 - hit.t * 5) : 0);
    }
  }
  for (const b of bits) box(b.x, b.y, b.z, b.s, b.s, b.s, b.c, b.wake ? KIND.plain : KIND.brick, b.wake ? 0.9 : 0.1);
  // (the tunnel winds as you go: the picture's bend, from where you are)
  const bend: [number, number] = [0.0052 * Math.sin(sim.z * 0.013 + seed) + 0.0026 * Math.sin(sim.z * 0.031 + 1), 0.003 * Math.sin(sim.z * 0.017 + seed * 2 + 2)];
  const d = sim.z / 120, i = Math.floor(d), f = d - i, u = f * f * (3 - 2 * f), a = TINTS[i % TINTS.length], b2 = TINTS[(i + 1) % TINTS.length];
  const tint: [number, number, number] = [a[0] + (b2[0] - a[0]) * u, a[1] + (b2[1] - a[1]) * u, a[2] + (b2[2] - a[2]) * u];
  return { z: sim.z, shake: [shake * Math.sin(sim.t * 61) * 0.12, shake * Math.cos(sim.t * 53) * 0.1], bend, tint, ball: [sim.ball.x, sim.ball.y, sim.ball.z], ballOn: sim.phase !== 'over', boxes, count };
}

function shatter(e: { x: number; y: number; z: number; hue: number; row: number }, n: number, toward: number) {
  const c = brickColour(e.hue, e.row), cw = sim.W / sim.cols;
  for (let i = 0; i < n && bits.length < 260; i++) {
    bits.push({ x: e.x + (vr() - 0.5) * cw * 0.8, y: e.y + (vr() - 0.5) * CELL * 0.8, z: e.z + (vr() - 0.5) * BRICK_T, vx: (vr() - 0.5) * 6, vy: (vr() - 0.3) * 6, vz: toward + (vr() - 0.5) * 5, s: 0.12 + vr() * 0.26, life: 0.7 + vr() * 0.7, c });
  }
}

// ─── sound: where it is, by ear (left and right of you, nearer and further) ──────────────────────────────────────────
let ac: AudioContext | null = null;
function blip(freq: number, dur: number, x: number, z: number, gain = 0.2, type: OscillatorType = 'triangle', to = freq) {
  if (mute || !ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), p = ac.createStereoPanner(), now = ac.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
  g.gain.setValueAtTime(gain / (1 + Math.max(0, z - sim.z) * 0.035), now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  p.pan.value = Math.max(-1, Math.min(1, x / (sim.W / 2)));
  o.connect(g).connect(p).connect(ac.destination); o.start(now); o.stop(now + dur + 0.02);
}
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
function sound(e: Ev) {
  // (how hard it struck is how loud; a ball going through a brick is a lower, rougher note than one coming off it)
  if (e.kind === 'brick') blip(330 * 2 ** (SCALE[e.row] / 12) * (e.through ? 0.5 : 1), e.broke ? 0.24 : 0.08, e.x, e.z, 0.16 + 0.012 * e.hard, e.through ? 'sawtooth' : e.broke ? 'triangle' : 'square');
  else if (e.kind === 'wall') blip(120 + e.hard * 4, 0.06, e.x, e.z, Math.min(0.3, 0.02 * e.hard), 'sine', 90);
  else if (e.kind === 'hand') blip(80 + e.hard * 2.2, 0.14, e.x, e.z, 0.25 + 0.012 * e.hard, 'sine', 55);
  else if (e.kind === 'catch') blip(180, 0.08, e.x, e.z, 0.35, 'sine', 120);
  else if (e.kind === 'serve') blip(220, 0.1, e.x, e.z, 0.2);
  else if (e.kind === 'fall') blip(120 + vr() * 80, 0.3, e.x, e.z, 0.12, 'sawtooth', 50);
  else if (e.kind === 'miss') blip(196, 0.6, e.x, e.z, 0.35, 'sawtooth', 45);
  else if (e.kind === 'through') [0, 7, 12].forEach((s, i) => setTimeout(() => blip(523 * 2 ** (s / 12), 0.3, 0, sim.z, 0.2), i * 80));
}

// ─── the words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const say = $('say'), sub = $('sub'), depth = $('depth'), broke = $('broken'), whole = $('whole'), flash = $('flash'), handBtn = $('toHand'), muteBtn = $('toMute'), best = $('best');
const HOW: Record<Mode, string> = { pad: 'tap to send it · keep a finger where it comes back', swipe: 'tap to send it · swipe through it as it comes back, hard', catch: 'pick it up and throw it · catch it when it comes back' };
const bestKey = () => `volley.best.${sim.mode}`;
const readBest = () => { try { return Number(localStorage.getItem(bestKey())) || 0; } catch { return 0; } };
let shown = '';
function words() {
  const m = Math.floor(sim.z), key = `${sim.phase}|${m}|${sim.broken}|${sim.integrity}|${sim.mode}|${mute}`;
  if (key === shown) return;
  shown = key;
  depth.textContent = String(m);
  broke.textContent = `${sim.broken} broken`;
  whole.style.width = `${(sim.integrity / FULL) * 100}%`;
  whole.classList.toggle('low', sim.integrity <= FULL * 0.3);
  if (sim.phase === 'over' && !auto && m > readBest()) { try { localStorage.setItem(bestKey(), String(m)); } catch { /* not kept, then */ } }
  const b = readBest();
  best.textContent = b ? `best ${b} m` : '';
  const fresh = sim.phase === 'ready' && !sim.z;
  say.textContent = sim.phase === 'over' ? `${m} m` : fresh ? 'Volley' : '';
  sub.textContent = auto ? '' : sim.phase === 'over' ? 'tap to go again' : sim.phase === 'ready' ? HOW[sim.mode] : '';
  handBtn.textContent = `hand: ${sim.mode}`;
  muteBtn.setAttribute('aria-pressed', String(!mute));
  document.body.dataset.phase = sim.phase; document.body.dataset.hand = sim.mode;
}

// ─── the fingers: each a hand on the glass ───────────────────────────────────────────────────────────────────────────
interface Finger extends Hand { t: number; gone: number; mouse: boolean }
const fingers = new Map<number, Finger>();
/** a point on the screen, on the glass */
const onGlass = (e: { clientX: number; clientY: number }) => ({ x: (e.clientX / canvas.clientWidth - 0.5) * H * aspect(), y: (0.5 - e.clientY / canvas.clientHeight) * H });
/** a point on the glass, on the screen */
const onScreen = (x: number, y: number) => ({ x: (x / (H * aspect()) + 0.5) * canvas.clientWidth, y: (0.5 - y / H) * canvas.clientHeight });
function wake() {
  if (!ac && !mute) { try { ac = new AudioContext(); } catch { /* no sound, then */ } }
  void ac?.resume();
}
canvas.addEventListener('pointerdown', (e) => {
  if (auto) return;
  wake();
  if (e.pointerType !== 'mouse') canvas.setPointerCapture(e.pointerId);
  const p = onGlass(e);
  fingers.set(e.pointerId, { id: e.pointerId, ...p, vx: 0, vy: 0, t: e.timeStamp, gone: 0, mouse: e.pointerType === 'mouse' });
  // (a waiting ball: sent off toward the touch, or, for a catching hand, picked up to be thrown)
  if (sim.phase === 'ready') { if (sim.mode === 'catch') grab(sim, e.pointerId); else serve(sim, p.x / (sim.W / 2), p.y / (H / 2)); } else if (sim.phase === 'over') restart(sim);
});
canvas.addEventListener('pointermove', (e) => {
  if (auto) return;
  const p = onGlass(e);
  let f = fingers.get(e.pointerId);
  // (a mouse is a hand wherever it is, button or no)
  if (!f) { if (e.pointerType !== 'mouse') return; f = { id: e.pointerId, ...p, vx: 0, vy: 0, t: e.timeStamp, gone: 0, mouse: true }; fingers.set(e.pointerId, f); return; }
  const dt = Math.max(0.004, (e.timeStamp - f.t) / 1000);
  f.vx = f.vx * 0.5 + ((p.x - f.x) / dt) * 0.5; f.vy = f.vy * 0.5 + ((p.y - f.y) / dt) * 0.5;
  f.x = p.x; f.y = p.y; f.t = e.timeStamp; f.gone = 0;
});
const lift = (e: PointerEvent) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  release(sim, f.id, f.vx, f.vy);
  // (a mouse stays; a swipe carries on a moment past the finger's leaving)
  if (f.mouse && e.type !== 'pointerleave') return;
  if (sim.mode === 'swipe' && e.type === 'pointerup') f.gone = e.timeStamp; else fingers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift); canvas.addEventListener('pointerleave', lift);
addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !auto) { e.preventDefault(); wake(); if (sim.phase === 'ready') { sim.mode === 'catch' ? (grab(sim, -9), release(sim, -9, 0, 20)) : serve(sim); } else restart(sim); } });
handBtn.onclick = () => {
  if (sim.phase === 'held') release(sim, sim.heldBy);
  sim.mode = MODES[(MODES.indexOf(sim.mode) + 1) % MODES.length];
  const u = new URL(location.href); u.searchParams.set('hand', sim.mode); history.replaceState(null, '', u);
};
muteBtn.onclick = () => { mute = !mute; shown = ''; };

// (the marks on the glass: a ring under each hand, a ring where the ball will come back)
const rings: HTMLElement[] = [], glass = $('glass'), mark = $('mark');
function marks() {
  const live = preview ? [] : sim.hands;
  while (rings.length < live.length) { const r = document.createElement('i'); glass.appendChild(r); rings.push(r); }
  rings.forEach((r, i) => {
    const k = live[i], speed = k ? Math.hypot(k.vx, k.vy) : 0, on = !!k && (sim.mode !== 'swipe' || speed >= SWIPE_MIN);
    r.hidden = !on;
    if (!on) return;
    const p = onScreen(k.x, k.y), rad = ((sim.mode === 'swipe' ? HAND_R * 1.5 : HAND_R) / H) * canvas.clientHeight;
    r.style.transform = `translate(${p.x - rad}px,${p.y - rad}px)`; r.style.width = r.style.height = `${rad * 2}px`;
    r.classList.toggle('holding', sim.phase === 'held' && sim.heldBy === k.id);
  });
  const c = guide && !preview ? crossing(sim) : null;
  mark.hidden = !c || c.t > 1.3;
  if (c && c.t <= 1.3) {
    const p = onScreen(c.x, c.y), rad = ((R + c.t * 2.6) / H) * canvas.clientHeight;
    mark.style.transform = `translate(${p.x - rad}px,${p.y - rad}px)`; mark.style.width = mark.style.height = `${rad * 2}px`;
    mark.style.opacity = String(Math.min(1, 1.35 - c.t));
  }
}

// ─── the loop ────────────────────────────────────────────────────────────────────────────────────────────────────────
const renderer = createRenderer(canvas, FOG);
let frames = 0, last = 0;
function pulse(cls: string) { flash.className = ''; void flash.offsetWidth; flash.className = cls; }
function run(dt: number, now: number) {
  if (!auto) {
    for (const [id, f] of fingers) {
      if (f.gone && now - f.gone > 130) { fingers.delete(id); continue; }
      if (!f.gone && now - f.t > 70) { f.vx *= 0.6; f.vy *= 0.6; }
    }
    sim.hands = [...fingers.values()];
  }
  advance(sim, dt, auto);
  for (const e of sim.events) {
    sound(e);
    if (e.kind === 'brick') { if (e.broke) shatter(e, e.through ? 16 : 12, e.through ? 6 : -2); else struck.push({ z: e.z, x: e.x, y: e.y, t: 0 }); if (e.through) shake = Math.max(shake, 0.3); }
    else if (e.kind === 'fall') shatter(e, 8, -1);
    else if (e.kind === 'through') { shake = Math.max(shake, 0.35); pulse('crash'); }
    else if (e.kind === 'miss') { shake = 1; pulse('miss'); }
  }
  // (the ball's wake: longer and brighter the faster it's going)
  if (sim.phase === 'play') {
    const b = sim.ball, sp = speed(b), k = Math.min(1, sp / POWER_MAX);
    if (bits.length < 300) bits.push({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, s: 0.42 * (0.4 + 0.6 * k), life: 0.1 + 0.22 * k, c: WAKE, wake: true });
  }
  for (let i = struck.length - 1; i >= 0; i--) if ((struck[i].t += dt) > 0.3) struck.splice(i, 1);
  shake = Math.max(0, shake - dt * 2.2);
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt;
    if (b.wake) { b.s *= 0.9; if (b.life <= 0) bits.splice(i, 1); continue; }
    b.vy -= 15 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < -H / 2 + b.s / 2) { b.y = -H / 2 + b.s / 2; b.vy = -b.vy * 0.35; b.vx *= 0.7; b.vz *= 0.7; }
    if (b.life < 0.25) b.s *= 0.86;
    if (b.life <= 0 || b.z < sim.z) bits.splice(i, 1);
  }
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
  if (!document.hidden) {
    // (the tunnel is the screen's shape: a little change is taken as it comes, a real one is another tunnel)
    if (colsFor(aspect()) === sim.cols) sim.W = H * aspect(); else { const mode = sim.mode; Object.assign(sim, create(seed, aspect(), mode)); bits.length = 0; }
    if (!still) run(dt, now);
    const dpr = Math.min(preview ? 1 : 2, devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    renderer!.render(scene());
    marks(); words(); frames++;
  }
  requestAnimationFrame(frame);
}

if (!renderer) { say.textContent = 'Volley'; sub.textContent = 'This needs WebGL 2.'; } else {
  // (run on first, if asked: a stand-in plays those seconds)
  const t0 = Math.max(0, Math.min(900, Number(qs.get('t')) || 0));
  for (let i = 0; i < t0 * 60; i++) advance(sim, 1 / 60, true);
  sim.events.length = 0; if (!auto) sim.hands = [];
  requestAnimationFrame(frame);
}
(window as unknown as Record<string, unknown>).__volley = {
  sim, onScreen,
  probe: () => ({ phase: sim.phase, mode: sim.mode, z: sim.z, integrity: sim.integrity, broken: sim.broken, passed: sim.passed, returns: sim.returns, t: sim.t, W: sim.W, cols: sim.cols, ball: { ...sim.ball }, speed: speed(sim.ball), hands: sim.hands.length, slabs: sim.slabs.length, frames, bits: bits.length, boxes: count, error: renderer?.gl.getError() ?? -1 }),
};
export {};
