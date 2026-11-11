/**
 * Volley: the brick-breaking game, seen from the paddle.
 *
 * The game is the plain one, in plan (sim.ts): a ball, a paddle, rows of bricks, three walls. Here it is laid flat as
 * the floor of a court and looked at from where the paddle is: your eye sits just behind and above it and goes
 * where it goes, the bricks stand at the far end in rising tiers (so every row shows over the one in front), and the
 * ball comes down the boards at you. The head turns a little to keep the ball in sight.
 *
 * Flags: seed, level, auto (a stand-in plays), t (run on this many seconds first), still (and hold there), plan (the
 * same game from above, in the corner), mute, preview (the index's card: a stand-in, no words).
 */
import { W, D, COLS, ROWS, BRICK_W, BRICK_D, R, PADDLE_Z, PADDLE_HALF, PADDLE_DEPTH, PADDLE_V, create, advance, serve, next, brickX, brickZ, type Sim, type Ev } from './sim';
import { createRenderer, fovFor, KIND, STRIDE, type Frame } from './draw';
import { seeded, seedFrom } from '../kit/rng';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), auto = preview || qs.has('auto'), still = qs.has('still');
const seed = seedFrom(qs.get('seed')) ?? 1;
const level = Math.max(1, Math.min(99, Number(qs.get('level')) || 1));
let plan = qs.has('plan'), mute = preview || qs.has('mute');

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
const FOG: [number, number, number] = [0.80, 0.83, 0.85];
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
// (near row to far: ink to straw; and the ones that take two)
const TIERS = ['#263a66', '#2e6189', '#3a8d9c', '#74b3a0', '#c3cf9c', '#efd086'].map(hex);
const HARD = hex('#4a3b33');
const PLASTER = hex('#e6e0d2'), BOARDS = hex('#d8c39c'), BAT = hex('#2b2a2c'), BAT_EDGE = hex('#e24a2c');
const tierHeight = (row: number) => 0.6 + 0.36 * row;
const EYE_UP = 1.15, EYE_BACK = 1.7;

const sim: Sim = create(seed, level);
if (preview) document.body.classList.add('preview');

// ─── what's drawn ────────────────────────────────────────────────────────────────────────────────────────────────────
const boxes = new Float32Array(STRIDE * 512);
let count = 0;
function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number[], kind = 0, glow = 0) {
  if (count >= 512) return;
  boxes.set([x, y, z, sx, sy, sz, c[0], c[1], c[2], kind, glow], count++ * STRIDE);
}
interface Bit { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; life: number; c: number[] }
const bits: Bit[] = [];
const vr = seeded(seed ^ 0x5bd1);
/** a brick that's just been hit: how long ago, for the flash (by row * COLS + col) */
const struck = new Float32Array(ROWS * COLS).fill(9);
const occ = new Uint8Array((COLS + 2) * (ROWS + 2));
let kick = 0, shake = 0, yaw = 0, eyeX = 0;

function scene(): Frame {
  count = 0;
  const wallH = 3.4, t = 0.4;
  box(0, -0.25, D / 2 - 2, W + 2 * t, 0.5, D + 4 + 2 * t, BOARDS, KIND.floor);
  box(-W / 2 - t / 2, wallH / 2, D / 2 - 2, t, wallH, D + 4, PLASTER, KIND.wall);
  box(W / 2 + t / 2, wallH / 2, D / 2 - 2, t, wallH, D + 4, PLASTER, KIND.wall);
  box(0, wallH / 2, D + t / 2, W + 2 * t, wallH, t, PLASTER, KIND.wall);
  occ.fill(0);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const hp = sim.bricks[r * COLS + c];
    if (!hp) continue;
    occ[(r + 1) * (COLS + 2) + c + 1] = 255;
    const h = tierHeight(r), flash = Math.max(0, 1 - struck[r * COLS + c] * 5);
    box(brickX(c), h / 2, brickZ(r), BRICK_W - 0.07, h, BRICK_D - 0.07, hp > 1 ? HARD : TIERS[r], KIND.brick, 0.5 * flash);
  }
  // the paddle: a bat on the boards in front of you, an edge of colour toward the ball
  box(sim.paddle, 0.13, PADDLE_Z - kick * 0.25, PADDLE_HALF * 2, 0.26, PADDLE_DEPTH, BAT, KIND.plain);
  box(sim.paddle, 0.13, PADDLE_Z + PADDLE_DEPTH / 2 - kick * 0.25, PADDLE_HALF * 2, 0.08, 0.03, BAT_EDGE, KIND.plain, 0.5 + 2 * kick);
  for (const b of bits) box(b.x, b.y, b.z, b.s, b.s, b.s, b.c, KIND.brick);
  const on = sim.phase !== 'over';
  // the eye: where the paddle is; the head turns part of the way to the ball
  eyeX = sim.paddle;
  const eye: [number, number, number] = [eyeX + shake * Math.sin(sim.t * 61) * 0.05, EYE_UP + shake * Math.cos(sim.t * 53) * 0.04, PADDLE_Z - EYE_BACK - kick * 0.12];
  const aspect = canvas.width / Math.max(1, canvas.height);
  // (the taller the screen, the more the eye looks down: the boards fill it, the far wall stays in the top third)
  const pitch = -0.07 - 0.3 * Math.max(0, fovFor(aspect) - 0.95);
  return { eye, yaw, pitch, roll: shake * Math.sin(sim.t * 47) * 0.03, ball: [sim.ball.x, R, sim.ball.z], ballOn: on, boxes, count, occ };
}

function shatter(e: Extract<Ev, { kind: 'brick' }>) {
  const h = tierHeight(e.row), c = TIERS[e.row];
  for (let i = 0; i < 14; i++) {
    bits.push({ x: e.x + (vr() - 0.5) * BRICK_W * 0.8, y: vr() * h, z: e.z + (vr() - 0.5) * BRICK_D * 0.8, vx: (vr() - 0.5) * 3, vy: 1.5 + vr() * 3, vz: (vr() - 0.5) * 3 - 0.6, s: 0.08 + vr() * 0.14, life: 0.7 + vr() * 0.6, c });
  }
}

// ─── sound: where it is, by ear (left and right of you, nearer and further) ──────────────────────────────────────────
let ac: AudioContext | null = null;
function blip(freq: number, dur: number, x: number, z: number, gain = 0.2, type: OscillatorType = 'triangle', to = freq) {
  if (mute || !ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), p = ac.createStereoPanner(), now = ac.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
  g.gain.setValueAtTime(gain / (1 + Math.max(0, z) * 0.12), now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  p.pan.value = Math.max(-1, Math.min(1, ((x - sim.paddle) / W) * 2.2));
  o.connect(g).connect(p).connect(ac.destination); o.start(now); o.stop(now + dur + 0.02);
}
const SCALE = [0, 3, 5, 7, 10, 12];
function sound(e: Ev) {
  if (e.kind === 'brick') blip(392 * 2 ** (SCALE[e.row] / 12), e.broke ? 0.22 : 0.08, e.x, e.z, 0.26, e.broke ? 'triangle' : 'square');
  else if (e.kind === 'wall') blip(150, 0.05, e.x, e.z, 0.16, 'sine', 110);
  else if (e.kind === 'paddle') blip(98, 0.14, e.x, 0, 0.5, 'sine', 55);
  else if (e.kind === 'serve') blip(220, 0.1, e.x, 0, 0.2);
  else if (e.kind === 'miss') blip(196, 0.5, e.x, 0, 0.3, 'sawtooth', 49);
  else if (e.kind === 'clear') [0, 4, 7, 12].forEach((s, i) => setTimeout(() => blip(523 * 2 ** (s / 12), 0.3, sim.paddle, 2, 0.22), i * 90));
}

// ─── the words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const say = $('say'), sub = $('sub'), score = $('score'), lives = $('lives'), lv = $('level'), flash = $('flash'), mark = $('mark');
let shown = '';
function words() {
  const key = `${sim.phase}|${sim.score}|${sim.lives}|${sim.level}|${auto}`;
  if (key === shown) return;
  shown = key;
  score.textContent = String(sim.score);
  lives.textContent = '●'.repeat(Math.max(0, sim.lives - 1)) || '·';
  lv.textContent = `court ${sim.level}`;
  const m: Record<string, [string, string]> = {
    serve: [sim.lives === 3 && !sim.score ? 'Volley' : '', auto ? '' : 'tap to serve · drag to move'],
    play: ['', ''],
    clear: ['Cleared', auto ? '' : 'tap for the next court'],
    over: [`${sim.score}`, auto ? '' : 'tap to play again'],
  };
  [say.textContent, sub.textContent] = m[sim.phase];
  document.body.dataset.phase = sim.phase;
}

// ─── the same game from above ────────────────────────────────────────────────────────────────────────────────────────
const planEl = $('plan') as HTMLCanvasElement, pc = planEl.getContext('2d')!;
const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
function drawPlan() {
  planEl.hidden = !plan || preview;
  if (planEl.hidden) return;
  const k = 11 * devicePixelRatio, w = Math.round(W * k), h = Math.round((D + 1.2) * k);
  if (planEl.width !== w) { planEl.width = w; planEl.height = h; planEl.style.width = `${w / devicePixelRatio}px`; }
  const X = (x: number) => (x + W / 2) * k, Z = (z: number) => h - (z + 1.2) * k;
  pc.fillStyle = rgb(BOARDS); pc.fillRect(0, 0, w, h);
  // (what the eye takes in)
  const half = Math.atan(Math.tan(fovFor(canvas.width / canvas.height) / 2) * (canvas.width / canvas.height));
  pc.fillStyle = 'rgba(255,255,255,.35)'; pc.beginPath(); pc.moveTo(X(eyeX), Z(PADDLE_Z - EYE_BACK));
  for (const a of [yaw - half, yaw + half]) pc.lineTo(X(eyeX + Math.sin(a) * 40), Z(PADDLE_Z - EYE_BACK + Math.cos(a) * 40));
  pc.fill();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const hp = sim.bricks[r * COLS + c];
    if (!hp) continue;
    pc.fillStyle = rgb(hp > 1 ? HARD : TIERS[r]);
    pc.fillRect(X(brickX(c) - BRICK_W / 2) + 1, Z(brickZ(r) + BRICK_D / 2) + 1, BRICK_W * k - 2, BRICK_D * k - 2);
  }
  pc.fillStyle = rgb(BAT); pc.fillRect(X(sim.paddle - PADDLE_HALF), Z(PADDLE_Z + PADDLE_DEPTH / 2), PADDLE_HALF * 2 * k, Math.max(2, PADDLE_DEPTH * k));
  if (sim.phase !== 'over') { pc.fillStyle = rgb(BAT_EDGE); pc.beginPath(); pc.arc(X(sim.ball.x), Z(sim.ball.z), Math.max(2, R * k), 0, 7); pc.fill(); }
}

// ─── the hand ────────────────────────────────────────────────────────────────────────────────────────────────────────
function act() {
  if (auto) return;
  if (!ac && !mute) { try { ac = new AudioContext(); } catch { /* no sound, then */ } }
  void ac?.resume();
  if (sim.phase === 'serve') serve(sim); else if (sim.phase !== 'play') next(sim);
}
const down = new Map<number, { x: number; x0: number; t: number; moved: number }>();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); down.set(e.pointerId, { x: e.clientX, x0: e.clientX, t: e.timeStamp, moved: 0 }); });
canvas.addEventListener('pointermove', (e) => {
  const d = down.get(e.pointerId);
  // (a mouse with no button held steers too: there's nothing else for it to do here)
  if (!d) { if (e.pointerType === 'mouse' && !auto) sim.want = (e.clientX / canvas.clientWidth - 0.5) * W * 1.15; return; }
  const dx = e.clientX - d.x; d.x = e.clientX; d.moved += Math.abs(dx);
  // (a drag across four fifths of the screen is the whole court)
  if (!auto) sim.want = Math.max(-W / 2, Math.min(W / 2, sim.want + (dx / canvas.clientWidth) * W * 1.25));
});
const up = (e: PointerEvent) => { const d = down.get(e.pointerId); down.delete(e.pointerId); if (d && e.type === 'pointerup' && d.moved < 10 && e.timeStamp - d.t < 400) act(); };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.key); if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); act(); } });
addEventListener('keyup', (e) => keys.delete(e.key));
const planBtn = $('toPlan'), muteBtn = $('toMute');
const labels = () => { planBtn.setAttribute('aria-pressed', String(plan)); muteBtn.setAttribute('aria-pressed', String(!mute)); };
planBtn.onclick = () => { plan = !plan; labels(); };
muteBtn.onclick = () => { mute = !mute; labels(); };
labels();

// ─── the loop ────────────────────────────────────────────────────────────────────────────────────────────────────────
const renderer = createRenderer(canvas, FOG);
let frames = 0, last = 0;
function run(dt: number) {
  const dir = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
  if (dir && !auto) sim.want = Math.max(-W / 2, Math.min(W / 2, sim.paddle + dir * PADDLE_V * 0.12));
  advance(sim, dt, auto);
  for (const e of sim.events) {
    sound(e);
    if (e.kind === 'brick') { struck[e.row * COLS + e.col] = 0; if (e.broke) shatter(e); }
    else if (e.kind === 'paddle') kick = 1;
    else if (e.kind === 'miss') { shake = 1; flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); }
  }
  for (let i = 0; i < struck.length; i++) struck[i] += dt;
  kick = Math.max(0, kick - dt * 6); shake = Math.max(0, shake - dt * 2.2);
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt; b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < b.s / 2) { b.y = b.s / 2; b.vy = -b.vy * 0.35; b.vx *= 0.7; b.vz *= 0.7; }
    if (b.life < 0.25) b.s *= 0.86;
    if (b.life <= 0) bits.splice(i, 1);
  }
  // the head: part of the way toward the ball, no further than a glance, and easily
  const want = sim.phase === 'play' ? Math.max(-0.42, Math.min(0.42, Math.atan2(sim.ball.x - sim.paddle, Math.max(0.6, sim.ball.z - (PADDLE_Z - EYE_BACK))) * 0.55)) : 0;
  yaw += (want - yaw) * Math.min(1, dt * 7);
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
  if (!document.hidden) {
    if (!still) run(dt);
    const dpr = Math.min(preview ? 1 : 2, devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const f = scene();
    renderer!.render(f);
    // (should the ball be out of sight to one side, say which)
    const p = renderer!.project(f.ball), off = f.ballOn && sim.phase === 'play' && (Math.abs(p.x) > 1 || !p.front);
    mark.hidden = !off;
    if (off) { mark.style.left = p.x < 0 ? '10px' : ''; mark.style.right = p.x < 0 ? '' : '10px'; mark.textContent = p.x < 0 ? '‹' : '›'; }
    words(); drawPlan(); frames++;
  }
  requestAnimationFrame(frame);
}

if (!renderer) { say.textContent = 'Volley'; sub.textContent = 'This needs WebGL 2.'; } else {
  // (run on first, if asked: a stand-in plays those seconds)
  const t0 = Math.max(0, Math.min(600, Number(qs.get('t')) || 0));
  for (let i = 0; i < t0 * 60; i++) advance(sim, 1 / 60, true);
  sim.events.length = 0; sim.want = sim.paddle;
  yaw = sim.phase === 'play' ? Math.max(-0.42, Math.min(0.42, Math.atan2(sim.ball.x - sim.paddle, Math.max(0.6, sim.ball.z - (PADDLE_Z - EYE_BACK))) * 0.55)) : 0;
  requestAnimationFrame(frame);
}
(window as unknown as Record<string, unknown>).__volley = {
  sim,
  probe: () => ({ phase: sim.phase, score: sim.score, lives: sim.lives, level: sim.level, left: sim.left, rally: sim.rally, t: sim.t, ball: { ...sim.ball }, paddle: sim.paddle, yaw, frames, bits: bits.length, boxes: count, error: renderer?.gl.getError() ?? -1 }),
};
export {};
