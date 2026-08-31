/**
 * SCORING — at the scale the game cares about, and honest about what is truth.
 *
 * ── THE TWO QUESTIONS, WHICH ARE NOT THE SAME ──
 *
 * The solver never moves a road. It draws on the OSM centreline and only
 * chooses which lateral sample to take an ELEVATION from. So a chosen bench
 * offset of +30m is not a claim that the road is thirty metres to the right;
 * it is "the ground thirty metres right looks more like a road bench than the
 * ground under the line does".
 *
 * That splits scoring in two:
 *
 *   ON-LINE ERROR. How wrong is the elevation where the road is DRAWN — under
 *   the player's wheels. Truth is sampled along the OSM geometry, because that
 *   is where the game puts the road whether or not OSM has it in the right
 *   place. This is the number that corresponds to what is felt.
 *
 *   COMPENSATION. Does the chosen offset track the real misregistration? Truth
 *   here is the AUTHORITATIVE alignment, deliberately not the OSM line. This
 *   is the number that says whether the lateral DP is doing its job or
 *   wandering.
 *
 * Scoring only the second would let a solver win by matching the true road's
 * height at a place the player never drives. Scoring only the first would call
 * a lucky flat hillside a success. Both, separately, or neither means much.
 *
 * ── DATUM ──
 *
 * National height systems disagree, and so do their derived products. Absolute
 * elevation is reported only after a stated reconciliation; SHAPE — the
 * profile after removing one constant offset — is reported always, so a datum
 * disagreement is never mistaken for a bad road.
 */

/** Truth confidence, per station. Aggregate scores use A and B only. */
export const GRADE = {
  A: 'authoritative 3D road geometry, corroborated by surface points',
  B: 'robustly extracted from classified surface points',
  C: 'DTM/DSM-derived proxy — diagnostic only',
  U: 'no defensible metric truth; visual or semantic value only',
};
export const SCORED = new Set(['A', 'B']);

const pct = (v, f) => {
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(3);
};
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Arc length along a polyline of [x, z]. */
export function stations(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return s;
}

/** Grade of each span, and the change of grade between consecutive spans. */
export function profileShape(pts, y) {
  const s = stations(pts);
  const grade = [], kink = [];
  for (let i = 1; i < y.length; i++) {
    const d = Math.max(0.5, s[i] - s[i - 1]);
    grade.push((y[i] - y[i - 1]) / d);
  }
  for (let i = 1; i < grade.length; i++) kink.push(grade[i] - grade[i - 1]);
  return { grade, kink };
}

/**
 * The one constant offset that best reconciles two profiles. The MEDIAN
 * residual, not the mean: a bridge the reference removed (bare-earth DEMs
 * delete decks by specification) is a long run of large one-sided residuals,
 * and a mean would quietly slide the whole road down to meet the river.
 */
export function datumOffset(got, want, mask) {
  const r = [];
  for (let i = 0; i < got.length; i++) {
    if (mask && !mask[i]) continue;
    if (!Number.isFinite(got[i]) || !Number.isFinite(want[i])) continue;
    r.push(got[i] - want[i]);
  }
  if (!r.length) return 0;
  r.sort((a, b) => a - b);
  return r[r.length >> 1];
}

/**
 * Score one solved profile against truth sampled ALONG THE DRAWN LINE.
 *
 * `grades` is per-station truth confidence; anything outside SCORED is
 * excluded from the aggregate and counted separately, so a fixture can carry
 * a tunnel or a bridge whose interior nobody can honestly measure without
 * either dropping the fixture or inventing truth for it.
 */
export function scoreProfile({ pts, got, truth, grades, bridgeMask, ground }) {
  const use = got.map((_, i) => {
    const g = grades ? grades[i] : 'A';
    return SCORED.has(g) && Number.isFinite(got[i]) && Number.isFinite(truth[i]);
  });
  const n = use.filter(Boolean).length;
  if (!n) return { n: 0, unscored: got.length };

  const dz = datumOffset(got, truth, use);
  const absErr = [], shapeErr = [];
  for (let i = 0; i < got.length; i++) {
    if (!use[i]) continue;
    absErr.push(Math.abs(got[i] - truth[i]));
    shapeErr.push(Math.abs(got[i] - dz - truth[i]));
  }

  const a = profileShape(pts, got);
  const b = profileShape(pts, truth);
  const gErr = [], kErr = [];
  for (let i = 0; i < a.grade.length; i++) {
    if (!use[i] || !use[i + 1]) continue;
    gErr.push(Math.abs(a.grade[i] - b.grade[i]));
  }
  for (let i = 0; i < a.kink.length; i++) {
    if (!use[i] || !use[i + 2]) continue;
    kErr.push(Math.abs(a.kink[i] - b.kink[i]));
  }

  // CUT AND FILL, against the ground the road is drawn over. A smoother
  // profile is bought by spanning the dips, and a road that spans its dips
  // stands proud of them — reported here because "the roads look raised" is
  // otherwise a matter of impression, and because it is the direct cost of the
  // curvature term. Positive is fill (deck above ground), negative is cut.
  const fill = [];
  if (ground) {
    for (let i = 0; i < got.length; i++) {
      if (!use[i] || !Number.isFinite(ground[i])) continue;
      fill.push(got[i] - dz - ground[i]);
    }
  }
  const above = fill.filter((v) => v > 0);

  return {
    n,
    unscored: got.length - n,
    fillM: fill.length ? {
      p50: pct(fill, 0.5), p90: pct(fill, 0.9), max: pct(fill, 1),
      // How much of the road is standing on air rather than sitting in ground.
      aboveFrac: +(above.length / fill.length).toFixed(3),
      meanAbove: above.length ? +mean(above).toFixed(2) : 0,
    } : null,
    // Reported only after the offset is stated, never instead of shape.
    datumOffsetM: +dz.toFixed(3),
    absM: { p50: pct(absErr, 0.5), p90: pct(absErr, 0.9), max: pct(absErr, 1) },
    shapeM: { p50: pct(shapeErr, 0.5), p90: pct(shapeErr, 0.9), max: pct(shapeErr, 1) },
    // Grade and its change are what a driver feels; absolute height is not.
    gradeErr: { p50: pct(gErr, 0.5), p90: pct(gErr, 0.9), max: pct(gErr, 1) },
    kinkErr: { p50: pct(kErr, 0.5), p90: pct(kErr, 0.9), max: pct(kErr, 1) },
    // The rollercoaster, measured on OUR profile rather than as an error: a
    // road can track truth's height and still heave between the samples.
    ownKink: { p90: pct(a.kink.map(Math.abs), 0.9), max: pct(a.kink.map(Math.abs), 1) },
    bridgeStations: bridgeMask ? bridgeMask.filter(Boolean).length : 0,
  };
}

/**
 * Does the lateral bench actually compensate for misregistration?
 *
 * With the input displaced by a known (dx, dz), the ground that belongs to the
 * road sits at a known offset from the drawn line. A DP that is compensating
 * moves its bench that way; one that is merely wandering does not, and its
 * offsets correlate with nothing. Reported as the correlation between chosen
 * offset and the displacement's lateral component, plus the mean signed
 * offset, because a solver can score a fine correlation while sitting on the
 * wrong side.
 */
export function scoreCompensation({ pts, offsets, dx, dz }) {
  const want = [], got = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const tx = pts[i + 1][0] - pts[i - 1][0], tz = pts[i + 1][1] - pts[i - 1][1];
    const tl = Math.hypot(tx, tz) || 1;
    // THE OFFSET THAT WOULD EXACTLY COMPENSATE, which is the NEGATIVE of how
    // far the terrain moved. If the surface slid +15m across the road, the
    // ground belonging to the road is now 15m the OTHER way from the line, and
    // a DP that is doing its job samples there. A first cut of this compared
    // signs against the displacement itself and scored a perfect compensation
    // as a total failure.
    want.push(-(dx * -tz + dz * tx) / tl);
    got.push(offsets[i]);
  }
  if (want.length < 3) return { n: want.length };
  const mw = mean(want), mg = mean(got);
  let cov = 0, vw = 0, vg = 0;
  for (let i = 0; i < want.length; i++) {
    cov += (want[i] - mw) * (got[i] - mg);
    vw += (want[i] - mw) ** 2;
    vg += (got[i] - mg) ** 2;
  }
  // CORRELATION IS UNDEFINED WHEN THE DISPLACEMENT IS CONSTANT, which is what
  // a uniform misregistration is — the whole tile slid one way. With zero
  // variance in `want` there is nothing to correlate, and reporting r=0 reads
  // as "no compensation" when the answer may be exact. So the headline is the
  // RESIDUAL: how much of the shift the chosen bench actually took out.
  const varies = vw > 1e-6;
  const resid = [];
  for (let i = 0; i < want.length; i++) resid.push(Math.abs(want[i] - got[i]));
  const rms = Math.sqrt(mean(resid.map((v) => v * v)));
  return {
    n: want.length,
    wantM: +mw.toFixed(2),
    gotM: +mg.toFixed(2),
    // 1.0 = the shift was fully taken out; 0 = the bench never moved. Capped
    // because a solver that overshoots is not doing better than one that does
    // not, and a negative would read as a score rather than a fault.
    recovered: Math.abs(mw) < 0.5 ? null
      : +Math.max(0, Math.min(1, 1 - Math.abs(mw - mg) / Math.abs(mw))).toFixed(3),
    residRmsM: +rms.toFixed(2),
    corr: varies ? +(cov / Math.sqrt(vw * vg)).toFixed(3) : null,
  };
}

/** One line per variant, so a run reads as a contrast rather than a dump. */
export function row(name, s, comp) {
  const f = (v) => (v === null || v === undefined ? '   -  ' : String(v.toFixed ? v.toFixed(2) : v).padStart(6));
  return `${name.padEnd(26)} n=${String(s.n).padStart(4)}`
    + ` abs p50 ${f(s.absM?.p50)}`
    + ` shape p50 ${f(s.shapeM?.p50)}`
    + ` | fill p90 ${f(s.fillM?.p90)} up ${f(s.fillM?.aboveFrac)}`
    + ` | kink p90 ${f(s.ownKink?.p90)}`
    + (comp ? ` | shift want ${f(comp.wantM)} got ${f(comp.gotM)}`
      + ` recov ${comp.recovered === null ? '  -  ' : f(comp.recovered)}` : '');
}
