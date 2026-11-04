/**
 * Switchback's signatures. A new best is yours to sign: an autograph, not a name typed in. A pad takes the gesture as
 * it's made (a finger, a pen, a mouse), its strokes and their timing, and it's kept with the run on the board. The board
 * draws each one back as it was written.
 *
 * The ink is a pen's: heavier where the hand went slowly, finer where it was quick.
 */

/** a signature: its strokes, each a flat run of `x, y, t, x, y, t, …`. x and y are in thousandths of the pad's height,
 * so its shape holds whatever box draws it; t is in hundredths of a second from the first touch */
export type Sig = number[][];

/** the pad's height, in the signature's units */
const U = 1000;
/** the pen's width (at its heaviest, near enough), in the same units */
const PEN = 30;

/** the ink's width at each point of a stroke, by how fast the hand was going there, eased so it doesn't flicker */
function widths(s: number[]) {
  const out = [1];
  let w = 1;
  for (let i = 3; i < s.length; i += 3) {
    const v = Math.hypot(s[i] - s[i - 3], s[i + 1] - s[i - 2]) / Math.max(1, s[i + 2] - s[i - 1]);
    w += (Math.max(0.42, Math.min(1.3, 1.35 - v / 55)) - w) * 0.35;
    out.push(w);
  }
  return out;
}

/** the signature inked, each point placed by `at`, as far as `upTo` into its writing: smooth through the midpoints of
 * what the pad caught, each piece as wide as the hand was slow */
function ink(g: CanvasRenderingContext2D, sig: Sig, at: (x: number, y: number) => [number, number], pen: number, upTo = Infinity) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of sig) {
    let m = 0;
    while (m * 3 < s.length && s[m * 3 + 2] <= upTo) m++;
    if (!m) continue;
    const w = widths(s), p = (i: number) => at(s[i * 3], s[i * 3 + 1]);
    if (m === 1) { const [x, y] = p(0); g.beginPath(); g.arc(x, y, pen * 0.55, 0, Math.PI * 2); g.fill(); continue; }
    let [ax, ay] = p(0);
    for (let i = 1; i < m; i++) {
      const [px, py] = p(i), [qx, qy] = i < m - 1 ? p(i + 1) : [px, py], mx = (px + qx) / 2, my = (py + qy) / 2;
      g.lineWidth = pen * w[i];
      g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(px, py, mx, my); g.stroke();
      ax = mx; ay = my;
    }
  }
}

/** a canvas made ready to draw on: its store sized to how big it shows (and the screen's density), cleared. Null while
 * it isn't showing */
function ready(cv: HTMLCanvasElement) {
  // (its own layout size, not its box on screen: a canvas turned on the page is still its own shape)
  const r = { width: cv.clientWidth, height: cv.clientHeight }, dpr = Math.min(3, devicePixelRatio || 1);
  if (!r.width || !r.height) return null;
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  return { g, w: r.width, h: r.height };
}

/** when the signature's writing ended */
export const written = (sig: Sig) => sig.reduce((t, s) => Math.max(t, s[s.length - 1] ?? 0), 0);

/** the signature drawn into a canvas, fitted to it (all of it, kept in proportion, centred), as far as `upTo`, the pen
 * `weight` times its usual */
export function show(cv: HTMLCanvasElement, sig: Sig, colour = '#fff', upTo = Infinity, weight = 1) {
  const c = ready(cv);
  if (!c || !sig.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sig) for (let i = 0; i < s.length; i += 3) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); }
  const edge = Math.max(3, c.h * 0.1), k = Math.min((c.w - edge * 2) / Math.max(1, x1 - x0), (c.h - edge * 2) / Math.max(1, y1 - y0), (c.h * 1.4) / U);
  const ox = (c.w - (x1 - x0) * k) / 2 - x0 * k, oy = (c.h - (y1 - y0) * k) / 2 - y0 * k;
  c.g.fillStyle = c.g.strokeStyle = colour;
  ink(c.g, sig, (x, y) => [ox + x * k, oy + y * k], Math.max(1.1, PEN * k) * weight, upTo);
}

/** the signature written again as it was, at a lick (never much over `span` hundredths of a second), after `delay` ms */
export function replay(cv: HTMLCanvasElement, sig: Sig, colour = '#fff', delay = 0, span = 150, weight = 1) {
  const end = written(sig), rate = Math.max(1.6, end / span), t0 = performance.now() + delay;
  const frame = (now: number) => {
    if (!cv.isConnected) return;
    const t = ((now - t0) / 10) * rate;
    if (t >= 0) show(cv, sig, colour, t, weight);
    if (t < end) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** the pad: a canvas the gesture's inked on as it's made. `changed` after each stroke, and on a clear */
export class Pad {
  strokes: Sig = [];
  private t0 = 0; private live: number[] | null = null; private id = -1;
  constructor(readonly cv: HTMLCanvasElement, private changed: (sig: Sig) => void, private colour = '#fff') {
    cv.addEventListener('pointerdown', (e) => {
      if (this.live) return;
      e.preventDefault(); cv.setPointerCapture(e.pointerId); this.id = e.pointerId;
      if (!this.strokes.length) this.t0 = e.timeStamp;
      this.live = []; this.strokes.push(this.live); this.add(e); this.paint();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.live || e.pointerId !== this.id) return;
      const all = 'getCoalescedEvents' in e ? e.getCoalescedEvents() : [];
      for (const c of all.length ? all : [e]) this.add(c);
      this.paint();
    });
    const up = (e: PointerEvent) => { if (!this.live || e.pointerId !== this.id) return; this.live = null; this.changed(this.strokes); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  /** a point of the stroke being made (not one too close to the last: the pad's only so fine) */
  private add(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect(), k = U / r.height, s = this.live!, n = s.length;
    const x = Math.round((e.clientX - r.left) * k), y = Math.round((e.clientY - r.top) * k), t = Math.round((e.timeStamp - this.t0) / 10);
    if (n && Math.hypot(x - s[n - 3], y - s[n - 2]) < 8) return;
    s.push(x, y, Math.max(n ? s[n - 1] : 0, t));
  }
  /** wiped, and said so */
  clear() { this.reset(); this.changed(this.strokes); }
  /** wiped, for a new signature */
  reset() { this.strokes = []; this.live = null; this.paint(); }
  /** the strokes so far, at the pad's own scale */
  paint() {
    const c = ready(this.cv);
    if (!c) return;
    const k = c.h / U;
    c.g.fillStyle = c.g.strokeStyle = this.colour;
    ink(c.g, this.strokes, (x, y) => [x * k, y * k], PEN * k);
  }
}
