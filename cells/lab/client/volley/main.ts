/**
 * Volley: a ball thrown up into fractured sheets and caught again, with no paddle: the screen is the pane you're
 * behind, and the ball is returned by a hand on it.
 *
 * The game is in sim.ts (the way, the sheets and their shards, the ball, what a hand does to it); the picture in
 * draw.ts. Here are the fingers (each one a hand on the pane, with where it is, how it's moving and how long it's
 * been down), what the picture is given each frame (the sheets as they stand, the pieces in the air, the ball's
 * wake, the dust), the marks drawn on the pane (a ring under each hand, a ring where the ball will come back), the
 * sound, and the words.
 *
 * Flags: seed, hand (all | pad | swipe | catch: what a finger is), auto (a stand-in plays), t (run on this many
 * seconds first), still (and hold there), guide=0 (no ring where the ball will come back), mute, preview.
 */
import { H, R, HAND_R, SHEET_T, FULL, MODES, RULES, COURSE, FIRING, FRESH, SETTLED, STAND, THROUGH, sheetZ, firingOf, actOf, create, advance, serve, grab, release, restart, speed, POWER_MAX, crossing, type Sim, type Ev, type Mode, type Rules, type Hand } from './sim';
import { createRenderer, prism, seat, matOf, paletteOf, PALETTES, STRIDE, SPRITE, EYE_BACK, type Frame } from './draw';
import { seeded, seedFrom } from '../kit/rng';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), auto = preview || qs.has('auto'), still = qs.has('still'), guide = qs.get('guide') !== '0';
const seed = seedFrom(qs.get('seed')) ?? 1;
let mute = preview || qs.has('mute');
const asked = qs.get('hand') as Mode | null, askedRules = qs.get('rules') as Rules | null;

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
const sim: Sim = create(seed, aspect(), asked && MODES.includes(asked) ? asked : 'all', askedRules && RULES.includes(askedRules) ? askedRules : 'lives');
/** the palette sheet `i` is fired in */
const palOf = (i: number) => paletteOf(seed, firingOf(i));
if (preview) document.body.classList.add('preview');

// ─── the pieces in the air ───────────────────────────────────────────────────────────────────────────────────────────
interface Frag {
  /** its outline about its own middle (x, y pairs) */
  pts: number[];
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** what it's turning about, how far it's turned, how fast */
  ax: number; ay: number; az: number; turn: number; w: number;
  tone: number; mat: number;
  /** it hangs where it was for this long first (a sheet gives way outward from where it was struck) */
  wait: number; life: number;
}
const frags: Frag[] = [], MAX_FRAGS = 420;
const fragBuf = new Float32Array(MAX_FRAGS * 8 * 15 * STRIDE);
interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; life: number; all: number }
const puffs: Puff[] = [];
const wake: { x: number; y: number; z: number; t: number }[] = [];
const spriteBuf = new Float32Array(SPRITE * 6 * 600);
const vr = seeded(seed ^ 0x5bd1);
let shake = 0;

/** A shard, as pieces: whole, in a few (a chip), or in many (a burst). They go the way `push` says, and out from (ix, iy). */
function breakUp(e: { sheet: number; shard: number }, how: 'whole' | 'chip' | 'burst', ix: number, iy: number, push: [number, number, number], wait = 0) {
  const sh = sim.sheets.find((k) => k.i === e.sheet), d = sh?.shards[e.shard];
  if (!sh || !d) return;
  const { tone } = seat(sh.i, e.shard), mat = matOf(d.kind, 1, palOf(sh.i)), n = d.poly.length / 2, pieces: number[][] = [];
  if (how === 'whole') pieces.push(d.poly);
  else {
    const mids: number[] = [];
    for (let k = 0; k < n; k++) { const t = 0.4 + vr() * 0.25; mids.push(d.cx + (d.poly[k * 2] - d.cx) * t, d.cy + (d.poly[k * 2 + 1] - d.cy) * t); }
    for (let k = 0; k < n;) {
      const span = how === 'chip' ? 2 + Math.floor(vr() * 2) : 1, to = Math.min(n, k + span);
      if (how === 'chip') { const p = [d.cx, d.cy]; for (let j = k; j <= to; j++) p.push(d.poly[(j % n) * 2], d.poly[(j % n) * 2 + 1]); pieces.push(p); }
      else {
        const a = k, b = (k + 1) % n;
        pieces.push([d.cx, d.cy, mids[a * 2], mids[a * 2 + 1], mids[b * 2], mids[b * 2 + 1]]);
        pieces.push([mids[a * 2], mids[a * 2 + 1], d.poly[a * 2], d.poly[a * 2 + 1], d.poly[b * 2], d.poly[b * 2 + 1], mids[b * 2], mids[b * 2 + 1]]);
      }
      k = to;
    }
  }
  for (const p of pieces) {
    if (frags.length >= MAX_FRAGS) frags.shift();
    let cx = 0, cy = 0;
    for (let k = 0; k < p.length; k += 2) { cx += p[k]; cy += p[k + 1]; }
    cx /= p.length / 2; cy /= p.length / 2;
    const ox = cx - ix, oy = cy - iy, ol = Math.hypot(ox, oy) || 1, out = how === 'whole' ? 0.6 + vr() * 1.2 : 2 + vr() * 4;
    let ax = vr() - 0.5, ay = vr() - 0.5, az = (vr() - 0.5) * 0.6;
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    frags.push({
      pts: p.map((v, k) => v - (k % 2 ? cy : cx)), x: cx, y: cy, z: sh.z,
      vx: push[0] + (ox / ol) * out + (vr() - 0.5) * 2, vy: push[1] + (oy / ol) * out + (vr() - 0.5) * 2, vz: push[2] + (vr() - 0.5) * 3,
      ax, ay, az, turn: 0, w: (how === 'whole' ? 1.5 : 4) + vr() * (how === 'whole' ? 3 : 9), tone, mat, wait, life: 1.5 + vr() * 0.8,
    });
  }
}
function dust(x: number, y: number, z: number, n: number, hard: number) {
  for (let i = 0; i < n && puffs.length < 90; i++) puffs.push({ x: x + (vr() - 0.5) * 0.5, y: y + (vr() - 0.5) * 0.5, z: z - 0.3, vx: (vr() - 0.5) * 3, vy: (vr() - 0.5) * 3, vz: -vr() * (1 + hard * 0.12), s: 0.35 + vr() * 0.5, life: 0, all: 0.5 + vr() * 0.5 });
}

function scene(): Frame {
  // the pieces, each turned and placed
  let o = 0;
  const front: number[] = [], back: number[] = [], room = fragBuf.length - 8 * 15 * STRIDE;
  for (const f of frags) {
    if (o > room) break;
    const c = Math.cos(f.turn), s = Math.sin(f.turn), t = 1 - c, k = Math.min(1, f.life * 4);
    // (turning about (ax, ay, az) by `turn`)
    const m = [t * f.ax * f.ax + c, t * f.ax * f.ay - s * f.az, t * f.ax * f.az + s * f.ay, t * f.ax * f.ay + s * f.az, t * f.ay * f.ay + c, t * f.ay * f.az - s * f.ax, t * f.ax * f.az - s * f.ay, t * f.ay * f.az + s * f.ax, t * f.az * f.az + c];
    const at = (x: number, y: number, z: number, into: number[]) => into.push(f.x + (m[0] * x + m[1] * y + m[2] * z) * k, f.y + (m[3] * x + m[4] * y + m[5] * z) * k, f.z + (m[6] * x + m[7] * y + m[8] * z) * k);
    front.length = back.length = 0;
    for (let j = 0; j < f.pts.length; j += 2) { at(f.pts[j], f.pts[j + 1], -SHEET_T / 2, front); at(f.pts[j], f.pts[j + 1], SHEET_T / 2, back); }
    const cf: number[] = [], cb: number[] = [];
    at(0, 0, -SHEET_T / 2, cf); at(0, 0, SHEET_T / 2, cb);
    o = prism(fragBuf, o, front, back, cf, [-m[2], -m[5], -m[8]], cb, f.tone, f.mat);
  }
  // the ball's wake (a ribbon, widest at the ball) and the dust
  let q = 0;
  const eyeZ = sim.z - EYE_BACK;
  const put = (x: number, y: number, z: number, u: number, v: number, c: number[], a: number) => { spriteBuf.set([x, y, z, u, v, c[0], c[1], c[2], a], q); q += SPRITE; };
  const n = wake.length, WAKE = [1, 0.97, 0.9];
  for (let i = 0; i + 1 < n; i++) {
    const a = wake[i], b = wake[i + 1];
    // (across the ribbon: square to the way it's going on the screen)
    const ax = a.x / (a.z - eyeZ), ay = a.y / (a.z - eyeZ), bx = b.x / (b.z - eyeZ), by = b.y / (b.z - eyeZ), l = Math.hypot(bx - ax, by - ay) || 1e-6;
    const px = -(by - ay) / l, py = (bx - ax) / l, wa = R * 0.8 * (i / n), wb = R * 0.8 * ((i + 1) / n), fa = 0.6 * (i / n) ** 1.5, fb = 0.6 * ((i + 1) / n) ** 1.5;
    put(a.x - px * wa, a.y - py * wa, a.z, -1, 2, WAKE, fa); put(a.x + px * wa, a.y + py * wa, a.z, 1, 2, WAKE, fa); put(b.x + px * wb, b.y + py * wb, b.z, 1, 2, WAKE, fb);
    put(a.x - px * wa, a.y - py * wa, a.z, -1, 2, WAKE, fa); put(b.x + px * wb, b.y + py * wb, b.z, 1, 2, WAKE, fb); put(b.x - px * wb, b.y - py * wb, b.z, -1, 2, WAKE, fb);
  }
  const air = airNow();
  for (const p of puffs) {
    const s = p.s * (1 + (p.life / p.all) * 2.2), a = 0.34 * (1 - p.life / p.all), c = [0.97, 0.9, 0.8];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) put(p.x + u * s, p.y + v * s, p.z, u, v, c, a);
  }
  // (the way winds: the picture's bend, from where you are)
  const bend: [number, number] = [0.0022 * Math.sin(sim.z * 0.013 + seed) + 0.0011 * Math.sin(sim.z * 0.031 + 1), 0.0016 * Math.sin(sim.z * 0.017 + seed * 2 + 2)];
  return {
    z: sim.z, W: sim.W, shake: [shake * Math.sin(sim.t * 61) * 0.1, shake * Math.cos(sim.t * 53) * 0.08], bend, skyTop: air.top, skyLow: air.low, sun: air.sun,
    ball: [sim.ball.x, sim.ball.y, sim.ball.z], ballOn: sim.phase !== 'over' && sim.phase !== 'done', ballPal: air.pal, palOf, focus: air.focus, sheets: sim.sheets, frags: fragBuf, fragVerts: o / STRIDE, sprites: spriteBuf, spriteVerts: q / SPRITE,
  };
}
/** The air now, and where the lens is focused: the palette of the next sheet still standing, eased in from the
 * last one's over the way between them. */
function airNow() {
  const next = sim.sheets.find((k) => k.left > 0), n = next?.i ?? sim.nextSheet, a = PALETTES[palOf(Math.max(0, n - 1))], b = PALETTES[palOf(n)];
  const z0 = n > 0 ? sheetZ(seed, n - 1) : 0, z1 = sheetZ(seed, n) - STAND - 2, u0 = Math.min(1, Math.max(0, (sim.z - z0) / Math.max(1, z1 - z0))), u = u0 * u0 * (3 - 2 * u0);
  const mix = (p: number[], q: number[]) => p.map((v, k) => v + (q[k] - v) * u);
  const pal = u > 0.5 ? palOf(n) : palOf(Math.max(0, n - 1));
  return { top: mix(a.top, b.top), low: mix(a.low, b.low), sun: mix(a.sun, b.sun), pal, focus: (next ? next.z - SHEET_T / 2 : sim.z + 14) - (sim.z - EYE_BACK) + 1.5 };
}

// ─── sound: fired clay, placed by ear (left and right of you, nearer and further) ────────────────────────────────────
let ac: AudioContext | null = null, hiss: AudioBuffer | null = null;
const out = (x: number, z: number, gain: number, dur: number) => {
  const g = ac!.createGain(), p = ac!.createStereoPanner(), now = ac!.currentTime;
  g.gain.setValueAtTime(gain / (1 + Math.max(0, z - sim.z) * 0.035), now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  p.pan.value = Math.max(-1, Math.min(1, x / (sim.W / 2)));
  g.connect(p).connect(ac!.destination);
  return g;
};
function tone(freq: number, dur: number, x: number, z: number, gain = 0.2, type: OscillatorType = 'sine', to = freq, after = 0) {
  if (mute || !ac) return;
  const o = ac.createOscillator(), now = ac.currentTime + after;
  o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
  o.connect(out(x, z, gain, dur + after)); o.start(now); o.stop(now + dur + 0.02);
}
/** a burst of noise through a band: a crack (high, short), a clatter, a rumble (low, long) */
function crack(freq: number, dur: number, x: number, z: number, gain: number, q = 1.4) {
  if (mute || !ac) return;
  if (!hiss) { hiss = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = hiss.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ac.createBufferSource(), f = ac.createBiquadFilter();
  s.buffer = hiss; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  s.connect(f).connect(out(x, z, gain, dur)); s.start(ac.currentTime, Math.random() * 0.5, dur + 0.05);
}
let fell = 0;
function sound(e: Ev) {
  if (e.kind === 'shard') {
    if (e.chain) { if (fell++ < 4) crack(2600 + vr() * 1800, 0.1, e.x, e.z, 0.18); return; }
    const k = Math.min(1, e.hard / POWER_MAX);
    if (!e.broke) { tone(2100 + vr() * 300, 0.3, e.x, e.z, 0.14 + 0.1 * k); tone(3170, 0.18, e.x, e.z, 0.05); return; } // (a glazed one, rung)
    crack(e.through ? 1400 : 2800 + vr() * 1200, e.through ? 0.22 : 0.1, e.x, e.z, 0.25 + 0.4 * k);
    tone(1150 + vr() * 500, 0.07, e.x, e.z, 0.08 + 0.1 * k, 'triangle');
    if (e.through) tone(120, 0.16, e.x, e.z, 0.3, 'sine', 60);
  } else if (e.kind === 'fall') { if (fell++ < 7) crack(1800 + vr() * 2400, 0.12, e.x, e.z, 0.14); }
  else if (e.kind === 'through') { crack(420, 0.9, 0, e.z, 0.7, 0.7); [0, 7, 12].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.5, 0, sim.z, 0.07, 'sine', 392 * 2 ** (s / 12), i * 0.07)); }
  else if (e.kind === 'wall') tone(150 + e.hard * 3, 0.05, e.x, e.z, Math.min(0.2, 0.012 * e.hard), 'sine', 100);
  else if (e.kind === 'hand') { tone(84 + e.hard * 2, 0.15, e.x, e.z, 0.25 + 0.012 * e.hard, 'sine', 52); crack(700, 0.05, e.x, e.z, 0.05 + 0.004 * e.hard); }
  else if (e.kind === 'catch') tone(170, 0.09, e.x, e.z, 0.3, 'sine', 110);
  else if (e.kind === 'serve') tone(220, 0.1, e.x, e.z, 0.2);
  else if (e.kind === 'miss') tone(196, 0.6, e.x, e.z, 0.3, 'triangle', 45);
}

// ─── the words ───────────────────────────────────────────────────────────────────────────────────────────────────────
const say = $('say'), sub = $('sub'), depth = $('depth'), left = $('left'), flash = $('flash'), edge = $('edge'), handBtn = $('toHand'), muteBtn = $('toMute'), best = $('best');
const HOW: Record<Mode, string> = { all: 'pick it up and throw it · touch late to catch, hold to bat, swipe to hit', pad: 'tap to send it · keep a finger where it comes back', swipe: 'tap to send it · swipe through it as it comes back, hard', catch: 'pick it up and throw it · catch it when it comes back' };
const cardEl = $('card'), bigEl = $('big'), linesEl = $('lines'), againBtn = $('again'), fromBtn = $('fromCk'), modesEl = $('modes'), bannerEl = $('banner');
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const firingName = (f: number) => (f < ORD.length ? `the ${ORD[f]} firing` : `firing ${f}`);
const clockText = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
// (bests, in this browser: the furthest with five lives, by hand; a course's time and its splits, by seed and hand)
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not kept, then */ } } };
const livesKey = () => `volley.best.${sim.mode}`, runKey = () => `volley.run.${seed}.${sim.mode}`;
const runBest = (): { time: number; splits: number[] } | null => { try { return JSON.parse(store.get(runKey()) ?? 'null'); } catch { return null; } };
let shown = '', kept = '';
function words() {
  const m = Math.floor(sim.z), f = sim.from / FIRING, key = `${sim.phase}|${m}|${sim.integrity}|${sim.mode}|${sim.rules}|${mute}|${f}|${sim.rules === 'run' ? sim.clock.toFixed(1) : ''}`;
  if (key === shown) return;
  shown = key;
  const fresh = sim.phase !== 'play' && !sim.started && !sim.continued;
  depth.textContent = sim.rules === 'run' ? clockText(sim.clock) : String(m);
  left.innerHTML = sim.rules === 'lives' ? Array.from({ length: FULL }, (_, i) => `<i${i < sim.integrity ? '' : ' class="gone"'}></i>`).join('')
    : sim.rules === 'run' ? Array.from({ length: COURSE }, (_, i) => `<b${i < f ? ' class="done"' : ''}></b>`).join('') : `<span>${ORD[f + 1] ?? f + 1}</span>`;
  left.setAttribute('aria-label', sim.rules === 'lives' ? `${sim.integrity} of ${FULL} left` : sim.rules === 'run' ? `${f} of ${COURSE} firings` : `firing ${f + 1}`);
  const lb = Number(store.get(livesKey())) || 0, rb = runBest();
  best.textContent = sim.rules === 'lives' && lb ? `best ${lb}` : sim.rules === 'run' && rb ? `best ${clockText(rb.time)}` : '';
  say.textContent = fresh ? 'Volley' : '';
  sub.textContent = auto ? '' : sim.phase === 'ready' || (fresh && sim.phase === 'held') ? (sim.rules === 'run' && fresh ? `${COURSE} firings against the clock · a miss costs time · ${HOW[sim.mode]}` : HOW[sim.mode]) : '';
  modesEl.hidden = !fresh || auto || sim.phase !== 'ready';
  modesEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rules === sim.rules)));
  // the card at the end
  const end = (sim.phase === 'over' || sim.phase === 'done') && !auto;
  cardEl.hidden = !end;
  if (end && kept !== `${sim.phase}${sim.t}`) {
    kept = `${sim.phase}${sim.t}`;
    const lines: string[] = [];
    if (sim.phase === 'over') {
      const isBest = !sim.continued && m > lb;
      if (isBest) store.set(livesKey(), String(m));
      bigEl.textContent = String(m);
      lines.push(isBest ? 'a new best' : sim.continued ? 'gone on from a firing: not kept' : lb ? `best ${lb}` : '');
      lines.push(`${sim.broken} shards · ${f} firing${f === 1 ? '' : 's'}`);
      fromBtn.hidden = !sim.from;
      fromBtn.textContent = `again from ${firingName(f + 1)}`;
    } else {
      const was = rb, isBest = !was || sim.clock < was.time;
      if (isBest) store.set(runKey(), JSON.stringify({ time: sim.clock, splits: sim.splits }));
      bigEl.textContent = clockText(sim.clock);
      lines.push(isBest ? (was ? `a new best, by ${(was.time - sim.clock).toFixed(1)}` : 'a first time') : `best ${clockText(was!.time)}`);
      lines.push(sim.splits.map((t, i) => { const d = was?.splits[i]; return `${ORD[i + 1]} ${clockText(t)}${d !== undefined ? ` <em>${t <= d ? '−' : '+'}${Math.abs(t - d).toFixed(1)}</em>` : ''}`; }).join(' · '));
      lines.push(`${sim.misses} miss${sim.misses === 1 ? '' : 'es'}`);
      fromBtn.hidden = true;
    }
    linesEl.innerHTML = lines.filter(Boolean).map((l) => `<p>${l}</p>`).join('');
  }
  handBtn.textContent = `hand: ${sim.mode}`;
  muteBtn.setAttribute('aria-pressed', String(!mute));
  document.body.dataset.phase = sim.phase; document.body.dataset.hand = sim.mode; document.body.dataset.rules = sim.rules;
}
let ink = -1;
/** the page's ink is the firing's */
function inkNow(pal: number) {
  if (pal === ink) return;
  ink = pal;
  document.documentElement.style.setProperty('--ink', PALETTES[pal].ink);
  document.documentElement.style.setProperty('--ring', PALETTES[pal].ring);
}
function banner(title: string, line = '') {
  if (preview) return;
  bannerEl.innerHTML = `<b>${title}</b>${line ? `<span>${line}</span>` : ''}`;
  pulse(bannerEl, 'on');
}

// ─── the fingers: each a hand on the pane ────────────────────────────────────────────────────────────────────────────
interface Finger extends Hand { t: number; gone: number; mouse: boolean; /** when it touched down (a mouse with no button: long ago) */ t0: number }
const fingers = new Map<number, Finger>();
/** a point on the screen, on the pane */
const onPane = (e: { clientX: number; clientY: number }) => ({ x: (e.clientX / canvas.clientWidth - 0.5) * sim.W, y: (0.5 - e.clientY / canvas.clientHeight) * H });
/** a point on the pane, on the screen */
const onScreen = (x: number, y: number) => ({ x: (x / sim.W + 0.5) * canvas.clientWidth, y: (0.5 - y / H) * canvas.clientHeight });
function wakeSound() {
  if (!ac && !mute) { try { ac = new AudioContext(); } catch { /* no sound, then */ } }
  void ac?.resume();
}
canvas.addEventListener('pointerdown', (e) => {
  if (auto) return;
  wakeSound();
  if (e.pointerType !== 'mouse') canvas.setPointerCapture(e.pointerId);
  const p = onPane(e);
  fingers.set(e.pointerId, { id: e.pointerId, ...p, vx: 0, vy: 0, t: e.timeStamp, gone: 0, mouse: e.pointerType === 'mouse', t0: e.timeStamp });
  // (a waiting ball: picked up to be thrown, or, for a hand that can't hold, sent off toward the touch)
  if (sim.phase === 'ready') { if (sim.mode === 'catch' || sim.mode === 'all') grab(sim, e.pointerId); else serve(sim, p.x / (sim.W / 2), p.y / (H / 2)); }
});
canvas.addEventListener('pointermove', (e) => {
  if (auto) return;
  const p = onPane(e);
  let f = fingers.get(e.pointerId);
  // (a mouse is a hand wherever it is, button or no)
  if (!f) { if (e.pointerType !== 'mouse') return; f = { id: e.pointerId, ...p, vx: 0, vy: 0, t: e.timeStamp, gone: 0, mouse: true, t0: -1e9 }; fingers.set(e.pointerId, f); return; }
  const dt = Math.max(0.004, (e.timeStamp - f.t) / 1000);
  f.vx = f.vx * 0.5 + ((p.x - f.x) / dt) * 0.5; f.vy = f.vy * 0.5 + ((p.y - f.y) / dt) * 0.5;
  f.x = p.x; f.y = p.y; f.t = e.timeStamp; f.gone = 0;
});
const lift = (e: PointerEvent) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  release(sim, f.id, f.vx, f.vy);
  // (a mouse stays; a swipe carries on a moment past the finger's leaving)
  if (f.mouse && e.type !== 'pointerleave') { f.t0 = -1e9; return; }
  if ((sim.mode === 'swipe' || sim.mode === 'all') && e.type === 'pointerup') f.gone = e.timeStamp; else fingers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift); canvas.addEventListener('pointerleave', lift);
addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !auto) { e.preventDefault(); wakeSound(); if (sim.phase === 'ready') { sim.mode === 'catch' || sim.mode === 'all' ? (grab(sim, -9), release(sim, -9, 0, 12)) : serve(sim); } else restart(sim); } });
handBtn.onclick = () => {
  if (sim.phase === 'held') release(sim, sim.heldBy);
  sim.mode = MODES[(MODES.indexOf(sim.mode) + 1) % MODES.length];
  const u = new URL(location.href); u.searchParams.set('hand', sim.mode); history.replaceState(null, '', u);
};
muteBtn.onclick = () => { mute = !mute; shown = ''; };
againBtn.onclick = () => { wakeSound(); restart(sim); };
fromBtn.onclick = () => { wakeSound(); restart(sim, true); };
modesEl.querySelectorAll('button').forEach((b) => { b.onclick = () => {
  if (sim.started) return;
  sim.rules = b.dataset.rules as Rules; shown = '';
  const u = new URL(location.href); u.searchParams.set('rules', sim.rules); history.replaceState(null, '', u);
}; });

// (the marks on the pane: a ring under each hand, a ring where the ball will come back)
const rings: HTMLElement[] = [], pane = $('pane'), mark = $('mark');
function marks() {
  const live = preview ? [] : sim.hands;
  while (rings.length < live.length) { const r = document.createElement('i'); r.innerHTML = '<svg viewBox="-64 -64 128 128"><circle r="60" pathLength="100"/></svg>'; pane.appendChild(r); rings.push(r); }
  rings.forEach((r, i) => {
    // (the ring is what the hand would be to a ball landing now: a pad, a hit (dashed, wider), a catch (close, dotted round))
    const k = live[i], act = k ? actOf(sim.mode, k) : null, holding = !!k && sim.phase === 'held' && sim.heldBy === k.id;
    r.hidden = !act;
    if (!k || !act) return;
    const p = onScreen(k.x, k.y), rad = ((act === 'hit' && !holding ? HAND_R * 1.5 : HAND_R) / H) * canvas.clientHeight;
    r.style.transform = `translate(${p.x - rad}px,${p.y - rad}px)`; r.style.width = r.style.height = `${rad * 2}px`;
    r.className = holding ? 'holding' : act;
    // (round it, an arc of dashes growing as the touch settles: empty, it's a catch; full, a bat)
    const u = Math.max(0, Math.min(1, ((k.age ?? 9) - FRESH) / (SETTLED - FRESH))), n = Math.round(u * 26), parts: number[] = [];
    for (let j = 0; j < n; j++) { const d = 0.35 + (j / 26) * 2.3; parts.push(d, 100 / 26 - d); }
    r.querySelector('circle')!.setAttribute('stroke-dasharray', n ? `${parts.join(' ')} 0 100` : '0 100');
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
const renderer = createRenderer(canvas);
let frames = 0, last = 0, slow = 0, fine = 1;
function pulse(el: HTMLElement, cls: string) { el.className = ''; void el.offsetWidth; el.className = cls; }
function run(dt: number, now: number, standIn = auto) {
  if (!standIn) {
    for (const [id, f] of fingers) {
      if (f.gone && now - f.gone > 130) { fingers.delete(id); continue; }
      if (!f.gone && now - f.t > 70) { f.vx *= 0.6; f.vy *= 0.6; }
      f.age = (now - f.t0) / 1000;
    }
    sim.hands = [...fingers.values()];
  }
  const b = sim.ball, was: [number, number, number] = [b.vx, b.vy, b.vz];
  advance(sim, dt, standIn);
  fell = 0;
  let from: { x: number; y: number } | null = null;
  for (const e of sim.events) {
    sound(e);
    if (e.kind === 'shard') {
      if (!e.chain) from = { x: b.x, y: b.y };
      if (!e.broke) continue;
      // (struck through: it bursts, and goes on with the ball; struck and turned: it chips, and drops)
      const through = e.through || e.chain, k = through ? 0.22 : -0.08;
      breakUp(e, through && !e.chain ? 'burst' : 'chip', from?.x ?? e.x, from?.y ?? e.y, [was[0] * 0.15, was[1] * 0.15, was[2] * k]);
      if (!e.chain) { dust(b.x, b.y, e.z, through ? 7 : 4, e.hard); if (e.through) shake = Math.max(shake, 0.25 + (e.hard - THROUGH) * 0.02); }
    } else if (e.kind === 'fall') {
      // (the sheet gives way: outward from where it was last struck, each shard whole, falling toward you)
      const d = Math.hypot(e.x - (from?.x ?? 0), e.y - (from?.y ?? 0));
      breakUp(e, vr() < 0.75 ? 'chip' : 'whole', from?.x ?? 0, from?.y ?? 0, [0, 0, 0.5 - vr() * 1.5], d * 0.045);
    } else if (e.kind === 'through') { shake = Math.max(shake, 0.5); pulse(flash, 'through'); }
    else if (e.kind === 'checkpoint') {
      const best = runBest()?.splits[e.firing - 1], name = PALETTES[palOf(e.firing * FIRING)].name;
      banner(firingName(e.firing + 1), sim.rules === 'run' ? `${clockText(e.clock)}${best !== undefined ? ` · ${e.clock <= best ? '−' : '+'}${Math.abs(e.clock - best).toFixed(1)}` : ''}` : sim.rules === 'lives' ? `${name} · a chance back` : name);
    } else if (e.kind === 'done') banner('fired', clockText(e.clock));
    else if (e.kind === 'miss') { shake = 1; pulse(flash, 'miss'); }
    else if (e.kind === 'wall' && !preview) {
      const p = onScreen(e.x, e.y);
      edge.style.left = `${p.x}px`; edge.style.top = `${p.y}px`; edge.style.setProperty('--k', String(Math.min(1, e.hard / 14)));
      pulse(edge, 'on');
    }
  }
  shake = Math.max(0, shake - dt * 2.2);
  for (let i = frags.length - 1; i >= 0; i--) {
    const f = frags[i];
    if (f.wait > 0) { f.wait -= dt; continue; }
    f.life -= dt; f.vz -= 9 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.turn += f.w * dt;
    // (a piece that reaches the pane is let go of: it doesn't come through at you)
    if (f.z < sim.z + 0.6) f.life = Math.min(f.life, 0.2);
    if (f.life <= 0) frags.splice(i, 1);
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.96; p.vy *= 0.96;
    if (p.life >= p.all) puffs.splice(i, 1);
  }
  // (the ball's wake: what it's been through in the last third of a second, or less if it's going slowly)
  const t = sim.t, keep = 0.12 + 0.24 * Math.min(1, speed(b) / POWER_MAX);
  if (sim.phase === 'play') wake.push({ x: b.x, y: b.y, z: b.z, t }); else wake.length = 0;
  while (wake.length && t - wake[0].t > keep) wake.shift();
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
  if (!document.hidden) {
    // (the way is the screen's shape: a little change is taken as it comes, a real one is another way)
    if (Math.abs(H * aspect() - sim.W) / sim.W > 0.22) { const mode = sim.mode; Object.assign(sim, create(seed, aspect(), mode, sim.rules)); frags.length = puffs.length = wake.length = 0; }
    if (!still) run(dt, now);
    // (a device that can't keep up is given fewer pixels to fill, in steps, and keeps them)
    if (frames > 30 && dt > 0.03) slow++; else slow = Math.max(0, slow - 1);
    if (slow > 40 && fine > 0.55) { fine *= 0.8; slow = 0; }
    const dpr = Math.min(preview ? 1 : 2, devicePixelRatio || 1) * fine, w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const sc = scene();
    inkNow(sc.ballPal);
    renderer!.render(sc);
    marks(); words(); frames++;
  }
  requestAnimationFrame(frame);
}

if (!renderer) { say.textContent = 'Volley'; sub.textContent = 'This needs WebGL 2.'; } else {
  // (run on first, if asked: a stand-in plays those seconds, the last two of them with the picture's own pieces, so
  // there's whatever was in the air)
  const t0 = Math.max(0, Math.min(900, Number(qs.get('t')) || 0)), m = mute;
  for (let i = 0; i < Math.max(0, t0 - 2) * 60; i++) advance(sim, 1 / 60, true);
  mute = true;
  for (let i = 0; i < Math.min(t0, 2) * 60; i++) run(1 / 60, 0, true);
  mute = m; sim.events.length = 0; if (!auto) sim.hands = [];
  requestAnimationFrame(frame);
}
(window as unknown as Record<string, unknown>).__volley = {
  sim, onScreen,
  probe: () => ({ phase: sim.phase, mode: sim.mode, z: sim.z, integrity: sim.integrity, broken: sim.broken, passed: sim.passed, returns: sim.returns, t: sim.t, W: sim.W, ball: { ...sim.ball }, speed: speed(sim.ball), hands: sim.hands.length, sheets: sim.sheets.length, frames, frags: frags.length, ...(renderer?.stats() ?? {}), error: renderer?.gl.getError() ?? -1 }),
};
export {};
