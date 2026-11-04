import { FAST, params, preview } from './env';

/**
 * Quality, by how long frames take: the resolution it's drawn at (a fraction of the screen's) and how many samples
 * its edges are smoothed with. Short of the display's 60 (under ~52 fps, for a second and a half), it steps down:
 * fewer samples first (4 → 2), then the resolution (to 0.85, 0.72, 0.6 of it), then no smoothing at all. Each step
 * down is a try: if over its next two seconds its frames aren't some 7% quicker than before it, what held them back wasn't the drawing (the
 * game's own work, or a display that won't go past 30, an iPhone saving power), so it goes back, stays there, and
 * doesn't try again unless frames get slower still. Quick again (at the display's rate for 8 s), it steps back up
 * one; and if a step up is taken back within ten seconds, it stays where it is. A level's first moments (its bake)
 * aren't counted. `?scale=` and `?samples=` fix them; `?quality=fixed` keeps the best; `?perf` shows where it's got to.
 */
const QUALITY_STEPS: Array<{ scale: number; samples: number }> = [
  { scale: 1, samples: 4 }, { scale: 1, samples: 2 }, { scale: 0.85, samples: 2 }, { scale: 0.72, samples: 2 }, { scale: 0.6, samples: 2 }, { scale: 0.6, samples: 1 },
];
export const fixedQuality = FAST > 0 || params.has('scale') || params.has('samples') || params.get('quality') === 'fixed' || preview;
export let qStep = 0;
export let renderScale = Number(params.get('scale')) || (FAST ? 0.5 : 1), samples = FAST ? 1 : 4;
if (params.has('samples')) samples = Math.max(1, Math.round(Number(params.get('samples')) || 1));
/** how long a frame takes (ms, smoothed) */
let qMs = 16.7;
let qAt = 0, qSince = 0, qOver = 0, qOverSum = 0, qOverN = 0, qUnder = 0, qUpAt = -1e9, qHold = 2500, qStuck = 0;
/** (a step down being tried: from which, how long frames took before it (their mean), and since) */
let qTry: { from: number; ms: number; sum: number; n: number } | null = null;
/** (stepped up and straight back: it stays where it is) */
export let qLocked = false;
/** (a level's being laid, or the page has just opened: the next moments aren't the frame rate) */
export function holdQuality(ms = 1500) { qHold = Math.max(qHold, ms); qOver = qOverSum = qOverN = qUnder = 0; }
export function quality(dtMs: number) {
  if (fixedQuality || document.hidden) return;
  qAt += dtMs;
  if (qHold > 0) { qHold -= dtMs; return; }
  // (a hitch counts as no worse than a slow frame, so one doesn't drop it, and frames that are all slow still do)
  const m = Math.min(dtMs, 100);
  qMs += (m - qMs) * 0.08;
  qSince += dtMs;
  const set = (k: number) => { qStep = k; renderScale = QUALITY_STEPS[k].scale; samples = QUALITY_STEPS[k].samples; qSince = 0; qOver = qOverSum = qOverN = qUnder = 0; };
  if (qTry) {
    // (the frames of its last second and a half: the first moments are the new targets being made)
    if (qSince > 500) { qTry.sum += m; qTry.n++; }
    if (qSince < 2000) return;
    const t = qTry, ms = t.sum / Math.max(1, t.n);
    qTry = null;
    // (no quicker for drawing less: back, and no more tries till it's slower than this)
    if (ms > t.ms * 0.93) { qStuck = ms; set(t.from); return; }
  }
  if (qMs > Math.max(19.2, qStuck * 1.15)) { qOver += dtMs; qOverSum += m; qOverN++; } else qOver = qOverSum = qOverN = 0;
  qUnder = qMs < 17.6 ? qUnder + dtMs : 0;
  if (qOver > 1500 && qStep < QUALITY_STEPS.length - 1) { if (qAt - qUpAt < 10000) qLocked = true; qTry = { from: qStep, ms: qOverSum / qOverN, sum: 0, n: 0 }; set(qStep + 1); }
  else if (qUnder > 8000 && qStep > 0 && !qLocked) { qUpAt = qAt; qStuck = 0; set(qStep - 1); }
}
