import { FAST, params, preview } from './env';

/**
 * Quality, by how long frames take: the resolution it's drawn at (a fraction of the screen's) and how many samples
 * its edges are smoothed with. Slow (under ~42 fps for a second), it steps down: fewer samples first (4 → 2), then
 * the resolution (to 0.85, 0.72, 0.6 of it), then no smoothing at all. Quick again (at or near the display's own rate
 * for 8 s), it steps back up one; and if a step up is taken back within ten seconds, it stays where it is.
 * `?scale=` and `?samples=` fix them; `?quality=fixed` keeps the best; `?perf` shows where it's got to.
 */
const QUALITY_STEPS: Array<{ scale: number; samples: number }> = [
  { scale: 1, samples: 4 }, { scale: 1, samples: 2 }, { scale: 0.85, samples: 2 }, { scale: 0.72, samples: 2 }, { scale: 0.6, samples: 2 }, { scale: 0.6, samples: 1 },
];
export const fixedQuality = FAST > 0 || params.has('scale') || params.has('samples') || params.get('quality') === 'fixed' || preview;
let qStep = 0;
export let renderScale = Number(params.get('scale')) || (FAST ? 0.5 : 1), samples = FAST ? 1 : 4;
if (params.has('samples')) samples = Math.max(1, Math.round(Number(params.get('samples')) || 1));
let qMs = 16.7, qVar = 0, qAt = 0, qSince = 0, qUpAt = -1e9, qProbe = -1;
export let qLocked = false;
export function quality(dtMs: number) {
  if (fixedQuality || document.hidden) return;
  qAt += dtMs;
  // (the first moments (shaders made, the level baked) aren't the frame rate; and a hitch counts as no worse than a
  // slow frame, so one doesn't drop it, and frames that are all slow still do)
  if (qAt < 2500) return;
  const m = Math.min(dtMs, 100);
  qMs += (m - qMs) * 0.08; qVar += ((m - qMs) ** 2 - qVar) * 0.08;
  qSince += dtMs;
  // (held at a steady 30 a second, to the frame, it's either too slow for 60 (and a step down may bring it back) or the
  // display's capped (an iPhone saving power): one step down is tried, and if it's still a steady 30 two seconds on,
  // it was the cap: back up, and left there)
  const steady30 = qMs > 31 && qMs < 35.5 && qVar < 4;
  const set = (k: number) => { qStep = k; renderScale = QUALITY_STEPS[k].scale; samples = QUALITY_STEPS[k].samples; qSince = 0; };
  if (qProbe >= 0) {
    if (qSince < 2000) return;
    if (steady30) { const k = qProbe; qProbe = -1; qLocked = true; set(k); return; }
    qProbe = -1;
  }
  if (steady30 && qSince > 1000) {
    if (qLocked || qStep >= QUALITY_STEPS.length - 1) { qSince = 0; return; }
    qProbe = qStep; set(qStep + 1); return;
  }
  if (qMs > 24 && qSince > 1000 && qStep < QUALITY_STEPS.length - 1) { if (qAt - qUpAt < 10000) qLocked = true; set(qStep + 1); }
  else if (qMs < 18 && qSince > 8000 && qStep > 0 && !qLocked) { qUpAt = qAt; set(qStep - 1); }
}
