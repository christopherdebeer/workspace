/**
 * stats — the little the aggregate needs: mean, sd, and a seeded bootstrap
 * interval for a difference of means. Seeded so a re-aggregate of the same
 * trials gives the same interval (the data is committed; the analysis should be
 * reproducible from it).
 */
'use strict';

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** mulberry32: a small seeded PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resample(xs, r) {
  const out = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = xs[(r() * xs.length) | 0];
  return out;
}

/**
 * Bootstrap percentile interval for mean(a) − mean(b), resampling each group
 * independently. Returns {delta, lo, hi, n: [a.length, b.length]}.
 */
function bootstrapDelta(a, b, { iterations = 2000, seed = 7, level = 0.95 } = {}) {
  if (!a.length || !b.length) return { delta: NaN, lo: NaN, hi: NaN, n: [a.length, b.length] };
  const r = rng(seed);
  const deltas = new Array(iterations);
  for (let i = 0; i < iterations; i++) deltas[i] = mean(resample(a, r)) - mean(resample(b, r));
  deltas.sort((x, y) => x - y);
  const tail = (1 - level) / 2;
  const at = (q) => deltas[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))];
  return { delta: round(mean(a) - mean(b)), lo: round(at(tail)), hi: round(at(1 - tail)), n: [a.length, b.length] };
}

function round(x, places = 3) {
  if (!Number.isFinite(x)) return x;
  const k = 10 ** places;
  return Math.round(x * k) / k;
}

module.exports = { mean, sd, bootstrapDelta, round, rng };
