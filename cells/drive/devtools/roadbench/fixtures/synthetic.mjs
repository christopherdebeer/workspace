/**
 * SYNTHETIC CANONICAL FIXTURES — archetypes with a KNOWN answer.
 *
 * These are not stand-ins for real ground and are not meant to be. They exist
 * because a real fixture's truth is only ever as good as the survey behind it,
 * and while the machinery itself is under construction you want cases where
 * the right answer is not in question at all. A shelf cut into a constant
 * side-slope HAS an exact profile; no LiDAR is needed to know it.
 *
 * They also cover an archetype the real list is thin on: the same road under a
 * side-slope steep enough that the bench and the centreline genuinely
 * disagree, which is where the lateral DP either earns its keep or does not.
 *
 * Real fixtures — the Swiss trio, Flevoland/Afsluitdijk, New River Gorge —
 * drop into the same shape: a truth profile, a reference patch, OSM geometry,
 * per-station truth grades, and an attribution line.
 */

const line = (n, step, bend = 0) => {
  const pts = [];
  let x = 0, z = 0, th = 0;
  for (let i = 0; i < n; i++) {
    pts.push([x, z]);
    th += bend;
    x += Math.cos(th) * step;
    z += Math.sin(th) * step;
  }
  return pts;
};

/**
 * A SHELF CUT INTO A SIDE-SLOPE. The road holds a designed grade; the hillside
 * falls across it at a constant angle. The bench is a real feature of the
 * ground — the cut is flat where the road is — so a solver that finds it is
 * right and one that averages the hillside is wrong, and the difference is
 * arithmetic rather than opinion.
 */
export function shelf({ n = 120, step = 12, cut = 0.85, fill = 0.22, grade = 0.05, benchW = 9 } = {}) {
  const drawn = line(n, step);
  const truthOnLine = drawn.map((_, i) => 100 + i * step * grade);
  // The surface: the hillside, flattened to the road's own height across the
  // bench. `z` is lateral here because the road runs along +x.
  //
  // THE TWO SIDES MUST NOT MATCH. A first cut had the ground rise on one side
  // at exactly the rate it fell on the other, which made the hillside
  // antisymmetric about the road — so a block-mean downsample averaged the two
  // and returned the road's exact height. A 30m grid "recovered" a 9m bench
  // perfectly, every degradation scored 0.00, and the fixture asked nothing.
  // A real shelf is a steep CUT on the uphill side and a shallow FILL on the
  // other, and nothing about that cancels.
  // …AND THE CROSS-SECTION MUST VARY ALONG THE ROAD. With a constant one, a
  // lateral displacement moves every station onto ground that is wrong by the
  // SAME amount — a constant vertical error, which the datum reconciliation
  // removes by design. The shape score then reads 0.00 for a solver that never
  // compensated at all, which is exactly what a first cut of this measured: a
  // perfect score from a DP sitting on the centreline. A real hillside steepens
  // and eases along its length, and that is what makes misregistration show up
  // as a profile fault rather than a datum one.
  const steep = (s) => 1 + 0.75 * Math.sin(s / 190);
  const reference = (x, z) => {
    const s = Math.max(0, Math.min((n - 1) * step, x));
    const road = 100 + s * grade;
    if (Math.abs(z) <= benchW / 2) return road;              // the cut itself
    const off = Math.abs(z) - benchW / 2;
    const k = steep(s);
    return road + (z < 0 ? off * cut * k : -off * fill * k); // cut uphill, fill downhill
  };
  return {
    id: 'shelf',
    name: 'shelf road cut into a constant side-slope',
    truthGrade: 'A (analytic)',
    attribution: 'synthetic',
    drawn,
    truthOnLine,
    stations: n,
    maxGrade: 0.12,
    grades: drawn.map(() => 'A'),
    box: { x0: -400, z0: -900, span: 2600 },
    reference,
  };
}

/**
 * THE SAME SHELF, WITH THE ROAD NOT WHERE OSM SAYS. The ground belonging to
 * the road sits `off` metres to one side of the drawn line — the ordinary
 * disagreement between an imagery-digitised centreline and a national DEM.
 *
 * Truth on the drawn line is still the road's own height: the game draws
 * there, so that is where the wheels are, whatever the survey says. What
 * changes is that the ground under the line is no longer the bench.
 */
export function shelfOffset(opts = {}) {
  const f = shelf(opts);
  const off = opts.off ?? 18;
  const base = f.reference;
  return {
    ...f,
    id: 'shelf-misreg',
    name: `shelf road, bench ${off}m off the drawn line`,
    reference: (x, z) => base(x, z - off),
  };
}

/**
 * A CAUSEWAY OVER WATER. The flattest thing in reach is the surface of the
 * lake, which is exactly what a bench search is looking for — and the road
 * sits above it on fill. This is the Afsluitdijk failure in miniature: the
 * solver must not take the water as its bench, and must not treat a causeway
 * as a bridge.
 */
export function causeway({ n = 100, step = 12, deck = 8, level = 0 } = {}) {
  const drawn = line(n, step);
  const truthOnLine = drawn.map(() => deck);
  const reference = (x, z) => {
    const w = Math.abs(z);
    if (w <= 7) return deck;                    // the embankment top
    if (w <= 22) return deck - (w - 7) * 0.55;  // its batter
    return level;                               // open water
  };
  return {
    id: 'causeway',
    name: 'road on fill across open water',
    truthGrade: 'A (analytic)',
    attribution: 'synthetic',
    drawn,
    truthOnLine,
    stations: n,
    maxGrade: 0.06,
    grades: drawn.map(() => 'A'),
    box: { x0: -400, z0: -900, span: 2400 },
    reference,
    waterAt: { inside: (x, z) => Math.abs(z) > 22, level },
  };
}

/**
 * A ROAD UNDER CANOPY. The DTM has the road; the DSM has the trees. The
 * failure to provoke is a solver inventing vertical structure out of foliage —
 * and the canopy is deliberately ASYMMETRIC, because a bench search that
 * averages both shoulders survives trees on both sides and fails on trees down
 * one.
 */
export function canopyRoad({ n = 110, step = 12 } = {}) {
  const drawn = line(n, step);
  const truthOnLine = drawn.map((_, i) => 60 + Math.sin(i * 0.06) * 4);
  const reference = (x, z) => {
    const s = Math.max(0, Math.min((n - 1) * step, x));
    return 60 + Math.sin((s / step) * 0.06) * 4 + Math.abs(z) * 0.02;
  };
  return {
    id: 'canopy',
    name: 'road under one-sided canopy (DTM vs DSM)',
    truthGrade: 'A (analytic)',
    attribution: 'synthetic',
    drawn,
    truthOnLine,
    stations: n,
    maxGrade: 0.10,
    grades: drawn.map(() => 'A'),
    box: { x0: -400, z0: -900, span: 2400 },
    reference,
    canopy: (x, z) => (z > 12 && z < 90 ? 1 : 0),
  };
}

/**
 * ROLLING GROUND, WITH THE ROAD ON IT. No misregistration, no resolution loss
 * — the only question is what the profile does with dips and crests it could
 * simply follow.
 *
 * This is the fixture that prices the curvature term. Smoothing a profile is
 * bought by SPANNING the undulations rather than following them, and a road
 * that spans its dips stands proud of them: "the roads look raised" is the
 * direct, visible cost of the same weight that stops them heaving. Truth here
 * is the ground itself, because a minor road over gentle rolling country is
 * built on the ground — there is no cutting to find and nothing to bridge.
 */
export function rolling({ n = 140, step = 12, amp = 2.2, wave = 46 } = {}) {
  const drawn = line(n, step);
  // SHORT WAVELENGTH ON PURPOSE. A first cut undulated 3.2m over 150m — a 2%
  // grade the DP simply follows, so nothing was ever asked and every curvature
  // weight scored an identical zero. What prices smoothing is ground whose own
  // grade CHANGES fast: at 46m the road crests and dips inside four stations,
  // which is where following the ground and holding a vertical curve are
  // genuinely different roads.
  const h = (s) => 80 + Math.sin(s / wave) * amp + Math.sin(s / (wave * 0.41)) * amp * 0.55;
  const truthOnLine = drawn.map((_, i) => h(i * step));
  const reference = (x, z) => h(Math.max(0, Math.min((n - 1) * step, x))) + Math.abs(z) * 0.03;
  return {
    id: 'rolling',
    name: 'minor road following gentle rolling ground',
    truthGrade: 'A (analytic)',
    attribution: 'synthetic',
    drawn,
    truthOnLine,
    stations: n,
    maxGrade: 0.10,
    grades: drawn.map(() => 'A'),
    box: { x0: -400, z0: -900, span: 2800 },
    reference,
  };
}

export const ALL = { shelf, shelfOffset, causeway, canopy: canopyRoad, rolling };
