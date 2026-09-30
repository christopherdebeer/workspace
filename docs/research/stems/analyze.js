/**
 * Stem-question selection statistics (pure; runs locally under node and is
 * inlined into @c15r/run.exec). Input: the pool and a matrix of per-item answer
 * distributions, `rows[i][qid] = number[]` in option order (noul → [no, yes]).
 *
 * Per question:
 *   bits      I(item; answer) = H(mean dist) − mean H(dist_i): how much the
 *             answer tells you about WHICH item this is. Zero if every item gets
 *             the same answer (no split) or every answer is a coin-flip (no
 *             decisiveness). The primary "is this a useful stem" signal.
 *   hMarg     entropy of the corpus-level answer mix (normalised 0–1): the split.
 *   conf      mean per-item decisiveness, 1 − H(dist_i)/log2 K.
 *   escape    mean mass on other/none/unclear: the question's vocabulary gap
 *             (the growth signal).
 *   na        mean mass on "does not apply" options: a high value means the
 *             question is conditional, i.e. a branch question, not a stem.
 * Pairs: soft-joint MI over the smaller informative bits (redundancy, 0–1). Selection: greedy on bits × (1 − max NMI
 * to already-chosen), i.e. keep informative, non-redundant questions.
 */
const ESCAPE = /^(other|none|unclear|neither)$/i;
const NA = /^(not about a piece of work|no physical place|nobody in particular|no particular time|no action|impersonal or no clear perspective|no particular audience)$/i;

const log2 = (x) => Math.log(x) / Math.LN2;
function H(p) {
  let h = 0;
  for (const v of p) if (v > 0) h -= v * log2(v);
  return h;
}
function labelsOf(q) {
  if (q.type === 'noul') return ['no', 'yes'];
  return q.type === 'choice' ? q.options : q.criteria;
}

/** I(item; answer) for one question over a subset of rows (per-segment bits). */
function bitsOf(q, id, rows) {
  const K = labelsOf(q).length;
  const mean = new Array(K).fill(0);
  let hSum = 0, m = 0;
  for (const r of rows) {
    const d = r[id];
    if (!d) continue;
    m++;
    for (let k = 0; k < K; k++) mean[k] += d[k] ?? 0;
    hSum += H(d);
  }
  if (!m) return null;
  return H(mean.map((v) => v / m)) - hSum / m;
}

function greedy(live, per, nmi, score, maxK, minGain, tag) {
  const chosen = [];
  const remaining = new Set(live.filter((id) => per[id].tier !== 'guard'));
  while (chosen.length < maxK && remaining.size) {
    let best = null;
    for (const id of remaining) {
      const red = chosen.reduce((mx, c) => Math.max(mx, nmi[`${id}|${c}`] ?? 0), 0);
      const gain = score(id) * (1 - red);
      if (!best || gain > best.gain) best = { id, gain, red };
    }
    if (!best || best.gain < minGain) break;
    chosen.push(best.id);
    remaining.delete(best.id);
    per[best.id][tag] = { rank: chosen.length, gain: +best.gain.toFixed(3), redundancy: +best.red.toFixed(2) };
  }
  return chosen;
}

function analyze(pool, rows, opts = {}) {
  const ids = Object.keys(pool.questions);
  const n = rows.length;
  const per = {};
  for (const id of ids) {
    const q = pool.questions[id];
    const labels = labelsOf(q);
    const K = labels.length;
    const mean = new Array(K).fill(0);
    let hSum = 0, m = 0;
    for (const r of rows) {
      const d = r[id];
      if (!d) continue;
      m++;
      for (let k = 0; k < K; k++) mean[k] += d[k] ?? 0;
      hSum += H(d);
    }
    if (!m) continue;
    for (let k = 0; k < K; k++) mean[k] /= m;
    const hM = H(mean), hC = hSum / m, logK = log2(K);
    const esc = labels.reduce((s, l, k) => s + (ESCAPE.test(l) ? mean[k] : 0), 0);
    const na = labels.reduce((s, l, k) => s + (NA.test(l) ? mean[k] : 0), 0);
    const top = labels
      .map((l, k) => [l, mean[k]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([l, v]) => `${l} ${(v * 100).toFixed(0)}%`);
    const tokens = Math.ceil(JSON.stringify(q).length / 4);
    per[id] = {
      facet: q.facet, tier: q.tier, was: q.was, type: q.type, n: m,
      bits: +(hM - hC).toFixed(3),
      hMarg: +(hM / logK).toFixed(2),
      conf: +(1 - hC / logK).toFixed(2),
      escape: +esc.toFixed(3),
      na: +na.toFixed(3),
      tokens,
      bitsPerKTok: +(((hM - hC) / tokens) * 1000).toFixed(1),
      top,
      _mean: mean,
    };
  }

  // Pairwise redundancy: normalised MI of the soft joint mean_i p_i ⊗ q_i.
  const live = ids.filter((id) => per[id]);
  const nmi = {};
  const pairs = [];
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const A = live[a], B = live[b];
      const Ka = per[A]._mean.length, Kb = per[B]._mean.length;
      const J = Array.from({ length: Ka }, () => new Array(Kb).fill(0));
      let m = 0;
      for (const r of rows) {
        const x = r[A], y = r[B];
        if (!x || !y) continue;
        m++;
        for (let i = 0; i < Ka; i++) for (let j = 0; j < Kb; j++) J[i][j] += (x[i] ?? 0) * (y[j] ?? 0);
      }
      if (!m) continue;
      const pa = new Array(Ka).fill(0), pb = new Array(Kb).fill(0);
      let hj = 0;
      for (let i = 0; i < Ka; i++) for (let j = 0; j < Kb; j++) {
        const v = J[i][j] / m;
        pa[i] += v; pb[j] += v;
        if (v > 0) hj -= v * log2(v);
      }
      const mi = H(pa) + H(pb) - hj;
      // Normalise by the smaller question's INFORMATIVE bits (not its marginal
      // entropy): within-item uncertainty leaks into the soft joint, so an exact
      // duplicate would otherwise read as only ~0.86 redundant.
      const denom = Math.min(per[A].bits, per[B].bits);
      const v = denom > 1e-6 ? Math.min(mi / denom, 1) : 0;
      nmi[`${A}|${B}`] = nmi[`${B}|${A}`] = v;
      pairs.push([A, B, +v.toFixed(3)]);
    }
  }
  pairs.sort((x, y) => y[2] - x[2]);

  // Greedy selection.
  const minGain = opts.minGain ?? 0.08;
  const maxK = opts.maxK ?? 24;
  const chosen = greedy(live, per, nmi, (id) => per[id].bits, maxK, minGain, 'pick');

  // Universality: bits within each segment; a stem must discriminate in all of them.
  let universal = null;
  if (opts.segments) {
    const segs = [...new Set(opts.segments)];
    for (const id of live) {
      per[id].bySeg = {};
      for (const sg of segs) {
        const b = bitsOf(pool.questions[id], id, rows.filter((_, i) => opts.segments[i] === sg));
        per[id].bySeg[sg] = b == null ? null : +b.toFixed(3);
      }
      const vals = Object.values(per[id].bySeg).filter((v) => v != null);
      per[id].minSeg = vals.length ? Math.min(...vals) : 0;
    }
    universal = greedy(live, per, nmi, (id) => per[id].minSeg, maxK, minGain, 'upick');
  }

  for (const id of live) delete per[id]._mean;
  const facets = {};
  for (const id of live) {
    const f = per[id].facet;
    (facets[f] ??= { questions: 0, chosen: 0, bestBits: 0 });
    facets[f].questions++;
    if (per[id].pick) facets[f].chosen++;
    facets[f].bestBits = Math.max(facets[f].bestBits, per[id].bits);
  }
  return {
    items: n,
    selected: chosen,
    selectedUniversal: universal,
    selectedTokens: chosen.reduce((s, id) => s + per[id].tokens, 0),
    poolTokens: live.reduce((s, id) => s + per[id].tokens, 0),
    facets,
    perQuestion: per,
    redundantPairs: pairs.slice(0, opts.topPairs ?? 25),
  };
}

if (typeof module !== 'undefined') module.exports = { analyze, H };
