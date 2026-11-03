/**
 * What can be measured of a sample: the features graphology reads (slant, baseline, connection, speed, pressure, size),
 * measured from the strokes and their timing rather than eyed. The measures are real. The readings beside them are
 * graphology's claims, given as claims: the evidence (in the notes) is that they don't hold.
 *
 * A sample is strokes of `x, y, t`: x and y in thousandths of the writing box's height (y down), t in hundredths of a
 * second from the first touch. That's the pad's own record, so a hand's samples and a person's are measured alike.
 */
import type { Sig } from '../switchback/sign';

export type Measures = {
  /** seconds from first touch to last lift, and of that with the pen down */
  duration: number; penDown: number;
  /** strokes, and lifts between them */
  strokes: number;
  /** the extent: width over height */
  aspect: number;
  /** the line's length, in heights of the writing */
  length: number;
  /** the pen's mean speed with it down, heights a second; and how much it varies (spread over mean) */
  speed: number; spread: number;
  /** how far the downstrokes lean from upright, degrees (right +) */
  slant: number;
  /** the baseline's rise across, degrees (up +) */
  baseline: number;
  /** letters to a stroke, when what it says is known */
  joined?: number;
  /** the ink's weight, as the pad's pen lays it (heavier where the hand is slow): 0.42 hairline to 1.3 */
  weight: number;
  /** (from session 2) the speed taken over every 3 hundredths of a second, however densely the pen was recorded: how
   * many times faster its quick moments are than its slow ones (the 90th percentile over the 10th), and how often it
   * all but stops (below a fifth of its mean speed), a second */
  range: number; stops: number;
};

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
/** a weighted median: the value at which half the weight lies either side */
function wmedian(v: [number, number][]) {
  const s = [...v].sort((a, b) => a[0] - b[0]), total = s.reduce((n, [, w]) => n + w, 0);
  let acc = 0;
  for (const [x, w] of s) { acc += w; if (acc >= total / 2) return x; }
  return 0;
}

export function measure(sig: Sig, text?: string): Measures {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0, penDown = 0;
  const speeds: [number, number][] = [], lean: [number, number][] = [], lows: [number, number][] = [];
  let ink = 0;
  for (const s of sig) {
    if (s.length >= 3) penDown += (s[s.length - 1] - s[2]) / 100;
    for (let i = 0; i < s.length; i += 3) {
      x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]);
      if (i < 3) continue;
      const dx = s[i] - s[i - 3], dy = s[i + 1] - s[i - 2], d = Math.hypot(dx, dy), dt = Math.max(1, s[i + 2] - s[i - 1]);
      L += d;
      speeds.push([d / dt, d]);
      ink += Math.max(0.42, Math.min(1.3, 1.35 - d / dt / 55)) * d;
      // (a downstroke, mostly downward: how far it leans; down and to the left is a letter leaning right)
      if (dy > 0 && dy > Math.abs(dx) * 0.6) lean.push([(Math.atan2(-dx, dy) * 180) / Math.PI, d]);
      // (the low points: where the pen turns from going down to coming up)
      if (i + 3 < s.length && dy > 0 && s[i + 4] - s[i + 1] < 0) lows.push([s[i], s[i + 1]]);
    }
  }
  const H = Math.max(1, y1 - y0), W = Math.max(1, x1 - x0);
  const meanV = L / Math.max(0.01, penDown * 100);
  const varV = speeds.reduce((n, [v, w]) => n + w * (v - meanV) ** 2, 0) / Math.max(1, L);
  // (the baseline: a line through the low points that the descenders can't drag about, the median of the slopes
  // between every pair)
  const slopes: number[] = [];
  for (let i = 0; i < lows.length; i++) for (let j = i + 1; j < lows.length; j++) {
    const dx = lows[j][0] - lows[i][0];
    if (Math.abs(dx) > H * 0.3) slopes.push((lows[j][1] - lows[i][1]) / dx);
  }
  const letters = text?.replace(/\s/g, '').length;
  // (where the pen is at every 3 hundredths: the last point recorded at or before each moment, then the distance
  // between, so a pen recorded densely and one recorded at 100 Hz measure alike)
  const win: number[] = [];
  for (const s of sig) {
    if (s.length < 6) continue;
    const at = (t: number) => { let j = 0; while (j + 3 < s.length && s[j + 5] <= t) j += 3; const k = Math.min(s.length - 3, j + 3), u = s[k + 2] > s[j + 2] ? Math.max(0, Math.min(1, (t - s[j + 2]) / (s[k + 2] - s[j + 2]))) : 1; return [s[j] + (s[k] - s[j]) * u, s[j + 1] + (s[k + 1] - s[j + 1]) * u]; };
    for (let t = s[2]; t + 3 <= s[s.length - 1]; t += 3) { const a = at(t), b = at(t + 3); win.push(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3); }
  }
  const sorted = [...win].sort((a, b) => a - b), pc = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const meanW = win.reduce((a, b) => a + b, 0) / Math.max(1, win.length);
  let stops = 0;
  for (let i = 0; i < win.length; i++) if (win[i] < meanW * 0.2 && (i === 0 || win[i - 1] >= meanW * 0.2)) stops++;
  return {
    duration: (Math.max(...sig.map((s) => s[s.length - 1] ?? 0)) - (sig[0]?.[2] ?? 0)) / 100,
    penDown, strokes: sig.length, aspect: W / H, length: L / H,
    speed: (meanV * 100) / H, spread: Math.sqrt(varV) / Math.max(1e-6, meanV),
    slant: wmedian(lean), baseline: (-Math.atan(median(slopes)) * 180) / Math.PI,
    joined: letters ? letters / sig.length : undefined,
    weight: ink / Math.max(1, L),
    range: pc(0.9) / Math.max(1e-3, pc(0.1)), stops: stops / Math.max(0.01, penDown),
  };
}

/** what a graphologist would say of each measure: the traditional readings, given as claims, not findings */
export function reading(m: Measures): string[] {
  const r: string[] = [];
  r.push(m.slant > 6 ? 'leans right: reaches out to others' : m.slant < -6 ? 'leans back: holds back, guarded' : 'upright: the head rules the heart');
  r.push(m.baseline > 2 ? 'a rising line: optimism' : m.baseline < -2 ? 'a falling line: weariness' : 'a level line: steadiness');
  if (m.joined !== undefined) r.push(m.joined >= 3 ? 'joined up: thinks in sequences, logically' : m.joined <= 1.3 ? 'letters apart: intuitive, in leaps' : 'joined in runs: logic with breaks for intuition');
  r.push(m.speed > 5 ? 'quick: a quick mind, impatient' : m.speed < 2 ? 'slow: deliberate, careful' : 'an even pace');
  r.push(m.weight > 1.05 ? 'heavy: vigour, intensity' : m.weight < 0.75 ? 'light: sensitivity' : 'a middling pressure');
  return r;
}
