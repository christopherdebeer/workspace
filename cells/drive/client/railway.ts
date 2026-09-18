import type { Rng } from './rng';

/**
 * ── A RAILWAY IS BALLAST, SLEEPERS AND TWO RAILS ──
 *
 * Reported from the seat at Glencairn, on the Southern Line between the
 * mountain and the beach: "the ribbon is not at all railway-like, visually it
 * should have visible tracks and sleepers/gravel."
 *
 * What it was: `ribbon(pts, 3.4, MAT.minor, 0.035, false, 'none', false, name)`
 * — and `MAT.minor` is `pathTex`, the FOOTPATH canvas: `#847d6c` warm dirt
 * with moss and hairline cracks, at 0.85 opacity. So a 3,000-volt electrified
 * main line was drawn as a semi-transparent forest path three and a half
 * metres wide. That is the whole railway implementation, and it explains the
 * report exactly.
 *
 * ── AND THE TAGS ARE THERE, WHICH IS NOT WHAT BUILDINGS TAUGHT ──
 *
 * The building work's headline is that you must synthesise from what is always
 * present, because `height` is on 0.05% of footprints and `building:levels` on
 * 5%. A railway is the OPPOSITE case, and it was measured before this module
 * was written rather than assumed: over 113 railway ways in the z16 tiles
 * under Glencairn, Suresnes, Vélizy and Clapham Junction —
 *
 *     gauge 96%   electrified 99%   voltage 99%   operator 99%
 *     name 72%    maxspeed 64%      usage 55%     tracks 37%   service 35%
 *
 * — so the gauge a track is drawn at, whether it carries wires, and whether it
 * is a main line or a siding can all be READ. (That sample is Europe-weighted
 * and small: four of the ten tiles asked for timed out cold, so it says
 * nothing about Asia or the Americas. Widen it before quoting a global
 * figure.) Where a tag is absent the defaults below are standard gauge and a
 * main line, which is what the commonest `railway=rail` with nothing else on
 * it actually is.
 *
 * PURE, and that is the point: `railSpec` turns tags into numbers with no DOM
 * and no THREE, so `devtools/railway.test.mjs` can assert the gauge parse, the
 * formation width and the draw filter in node in milliseconds. Only
 * `drawRailTexture` needs a canvas, and it takes the context rather than
 * making one — the same split `wall-tex.ts` uses.
 */

/** What sort of track this is. `none` draws nothing at all. */
export type RailKind = 'rail' | 'light' | 'tram' | 'narrow' | 'heritage' | 'miniature' | 'funicular' | 'none';

export interface RailSpec {
  kind: RailKind;
  /** Whether anything is drawn on the surface here. */
  draw: boolean;
  /** Between the rail heads, metres. */
  gaugeM: number;
  /** The formation's full width — the top of the ballast, shoulder to
   *  shoulder, or a tram's paved strip. This is the ribbon's width. */
  widthM: number;
  /** Sleeper pitch in metres, and how many the canvas draws in one wrap. The
   *  two together set the texture's v repeat, so the pitch is a real number of
   *  metres rather than whatever a 20 m wrap happened to divide into. */
  sleeperM: number;
  sleepers: number;
  /** Sleeper length: what the ballast has to be wider than. */
  sleeperLenM: number;
  /** Stone under a railway, none under a tram in a street. */
  ballast: 'stone' | 'slag' | 'none';
  /** How far the formation stands over the ground it is laid on. */
  liftM: number;
  /** A siding, a yard road or a goods loop: rustier, weedier, thinner stone. */
  minor: boolean;
  /** Out of use, rails still down: the weeds take it. */
  disused: boolean;
  /** Whether this track sits on an ENGINEERED FORMATION — a solved longitudinal
   *  profile, a corridor cut into the terrain and a batter either side — rather
   *  than being draped over whatever ground it crosses. True of every railway
   *  laid on its own alignment; false of a tram, whose rails are set into a
   *  street that already has its own profile and whose corridor would be the
   *  road's. See the ruling grade below for why the two cannot share a rule. */
  graded: boolean;
  /** THE RULING GRADE, as a rise per metre. This is the number that makes a
   *  railway a railway and not a narrow road: steel on steel has about a tenth
   *  of the adhesion of rubber on tarmac, so where a road climbs a hillside at
   *  ten or fifteen per cent a main line will not exceed two — which is why a
   *  railway cuts through what a road goes over, embanks across what a road
   *  dips into, and bridges what a road fords. The profile solver already
   *  takes a `maxGrade`; it had simply never been given one for a railway,
   *  because a railway was never solved at all. */
  gradeMax: number;
  /** Carries wires — for the masts, when they are built. */
  electrified: boolean;
  /** The material cache's key. */
  key: string;
}

/**
 * ── WHAT DOES NOT GET DRAWN, AND WHY IT MATTERED ──
 *
 * The old branch was `} else if (tags.railway) {` with no filter at all, so
 * EVERY value of the tag put a surface ribbon on the ground: `subway` drew a
 * tube line across the city at street level, `abandoned` and `razed` drew
 * track that was lifted decades ago, `platform` drew a station platform as a
 * footpath, and `construction` and `proposed` drew track that does not exist.
 *
 * A subway is the interesting one: most of it is `tunnel=yes` and belongs
 * underground, but elevated and open sections are real and are tagged the same
 * way — so the gate is the TUNNEL tag, not the kind.
 */
const NEVER = new Set(['abandoned', 'razed', 'dismantled', 'demolished', 'removed',
  'construction', 'proposed', 'platform', 'platform_edge', 'turntable', 'traverser',
  'roundhouse', 'engine_shed', 'wash', 'fuel', 'workshop', 'yard', 'monorail']);

/** `gauge` is millimetres and may be a list ("1435;1000" on mixed-gauge
 *  track). The first number is the one the rails are drawn at; a second gauge
 *  would be a third rail and is not modelled. */
function parseGauge(v: string | undefined): number | null {
  if (!v) return null;
  const m = /(\d{3,4})/.exec(v);
  if (!m) return null;
  const mm = Number(m[1]);
  return mm >= 300 && mm <= 3000 ? mm / 1000 : null;
}

export function railSpec(tags: Record<string, string>): RailSpec {
  const raw = tags.railway ?? '';
  const service = tags.service ?? '';
  const tunnel = !!tags.tunnel && tags.tunnel !== 'no';
  let kind: RailKind = 'none';
  if (raw === 'rail') kind = 'rail';
  else if (raw === 'light_rail') kind = 'light';
  else if (raw === 'tram') kind = 'tram';
  else if (raw === 'narrow_gauge') kind = 'narrow';
  else if (raw === 'preserved') kind = 'heritage';
  else if (raw === 'miniature') kind = 'miniature';
  else if (raw === 'funicular') kind = 'funicular';
  // A subway is drawn only where it is NOT in a tunnel — elevated and open
  // sections are real, and the tag alone cannot tell them apart.
  else if (raw === 'subway') kind = tunnel ? 'none' : 'light';
  else if (raw === 'disused') kind = 'rail';
  const disused = raw === 'disused' || tags.disused === 'yes';
  const draw = kind !== 'none' && !NEVER.has(raw);
  // The gauge: stated where OSM has it, else the kind's own convention.
  const stated = parseGauge(tags.gauge);
  const byKind = kind === 'narrow' ? 1.0 : kind === 'miniature' ? 0.381
    : kind === 'tram' || kind === 'light' ? 1.435 : 1.435;
  const gaugeM = stated ?? byKind;
  // A SIDING IS NOT A MAIN LINE. `service` says which — siding, spur, yard,
  // crossover — and `usage` says main, branch, industrial or tourism. Either
  // one demotes the dressing: thinner stone, rustier rail, weeds between.
  const minor = !!service || tags.usage === 'industrial' || tags.usage === 'tourism' || kind === 'heritage';
  // ── THE FORMATION ──
  // A sleeper is about 1.75 gauges plus a third of a metre of overhang, and
  // the ballast carries about 0.55 m of shoulder each side of it: Cape gauge
  // (1.067) comes to 3.3 m and standard (1.435) to 4.0, which is what those
  // formations measure in life. The old 3.4 was accidentally right for the
  // Cape and half a metre narrow everywhere else.
  //
  // AND IT MUST NOT BE WIDER THAN THAT, because OSM maps double track as two
  // PARALLEL WAYS about four metres apart: a formation drawn much over four
  // metres would have each way's ballast overlapping its neighbour's, and two
  // polygon-offset ribbons sharing ground z-fight the length of the line.
  const sleeperLenM = kind === 'tram' ? gaugeM + 0.4 : gaugeM * 1.75 + 0.35;
  const shoulder = kind === 'tram' ? 0.25 : minor ? 0.42 : 0.55;
  const widthM = sleeperLenM + 2 * shoulder;
  // Main line sleepers sit at about 0.65 m; a siding is laid sparser. Eight to
  // a wrap is enough for the pattern to read and few enough that the canvas
  // keeps ~25 pixels per metre along the track.
  const sleeperM = kind === 'miniature' ? 0.3 : kind === 'tram' ? 0.75 : minor ? 0.72 : 0.65;
  // ── THE ALIGNMENT ──
  // A tram is the one kind that is NOT on a formation of its own: it is laid in
  // a carriageway that was graded for road traffic, and giving it a corridor
  // would carve a railway cutting down a city street.
  const graded = kind !== 'tram';
  // Real ruling grades, and they differ by an order of magnitude across the
  // vocabulary: a freight main line is built to 1-1.5% and a passenger one
  // rarely over 2.5; a branch or an industrial spur will take 3-4; light rail
  // and metro stock climbs 4; a narrow-gauge mountain line 5; and a funicular
  // is a cable hauling a car up something no adhesion railway could attempt at
  // all, so it is given a number that effectively lets the ground decide.
  const gradeMax = kind === 'funicular' ? 0.5
    : kind === 'tram' ? 0.08
    : kind === 'narrow' || kind === 'miniature' ? 0.05
    : kind === 'light' || kind === 'heritage' ? 0.04
    : minor ? 0.035 : 0.022;
  return {
    kind, draw, gaugeM, widthM, sleeperM, sleepers: 8, sleeperLenM,
    ballast: kind === 'tram' ? 'none' : minor ? 'slag' : 'stone',
    // Ballasted track stands proud; a tram's rails are flush in the roadway.
    liftM: kind === 'tram' ? 0.015 : minor ? 0.08 : 0.12,
    minor, disused, electrified: !!tags.electrified && tags.electrified !== 'no',
    graded, gradeMax,
    key: `${kind}|${gaugeM.toFixed(3)}|${minor ? 'm' : 'M'}|${disused ? 'd' : 'l'}`,
  };
}

/**
 * How many times the canvas repeats over the ribbon's own 20 m uv wrap, so
 * that one canvas height is exactly `sleepers × sleeperM` of track. The
 * ribbon's v is `along / 20` and nothing about that is negotiable from here;
 * the repeat is the one lever, and it need not be an integer — the canvas
 * tiles seamlessly because the sleepers are drawn at (k + ½)/n, so no sleeper
 * straddles the join.
 */
export const railRepeatY = (spec: RailSpec): number => 20 / (spec.sleepers * spec.sleeperM);

/**
 * THE FORMATION, DRAWN. `u` runs across the width (0 at one shoulder, 1 at the
 * other — the ribbon's own convention) and `v` along the track.
 *
 * Sized against the quantiser rather than against realism: at the survey's
 * twelve pixels to the metre a rail head is 0.07 m and would be under one
 * pixel, so it is drawn at the width it needs to SURVIVE — a rail reads as a
 * line or it reads as nothing, and a line that dithers out is worse than one a
 * centimetre too wide. The same argument the road markings' note makes.
 */
export function drawRailTexture(c: CanvasRenderingContext2D, s: number, r: Rng, spec: RailSpec): void {
  const px = s / spec.widthM;                       // canvas pixels per metre across
  const py = s / (spec.sleepers * spec.sleeperM);   // …and along
  const mid = s / 2;
  if (spec.ballast === 'none') {
    // A tram in a street: the roadway runs on between the rails, with a
    // paved strip either side of each rail where the setts were relaid.
    c.fillStyle = '#4a4c50'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)';
      c.fillRect(r() * s, r() * s, 2 + r() * 3, 2 + r() * 3);
    }
  } else {
    // ── BALLAST: PALE STONE, AND IT HAS TO BE PALE ──
    //
    // The first cut laid a mid-grey bed (#6b6862, luma 104) and put CONCRETE
    // sleepers on it at (118,114,106) — eleven values apart, where one palette
    // step in this renderer is about eighteen. So the sleepers were there,
    // were drawn every frame, and were INSIDE THE QUANTISER: the frame came
    // back as a uniform grey band and the report would have been the same one
    // the seat had already made. Photographed at Glencairn before this line
    // was changed.
    //
    // Clean ballast really is pale — it is crushed granite, and an aerial
    // photograph of a railway is a light band with dark rungs across it. So
    // the bed is the LIGHT tone and everything laid on it is darker, which
    // buys three palette steps for the rhythm instead of half of one.
    const base = spec.ballast === 'slag' ? '#6d655b' : '#8a8681';
    c.fillStyle = base; c.fillRect(0, 0, s, s);
    const stones = spec.ballast === 'slag' ? 220 : 300;
    for (let i = 0; i < stones; i++) {
      const t = r();
      c.fillStyle = t < 0.34 ? 'rgba(236,233,226,0.34)' : t < 0.68 ? 'rgba(28,25,22,0.32)' : 'rgba(126,118,106,0.28)';
      const w = 2 + r() * 3.5;
      c.fillRect(r() * s, r() * s, w, w * (0.6 + r() * 0.8));
    }
    // The shoulders are the ballast's own slope: they catch the sky along one
    // edge and lie in their own shade along the other, which is what makes a
    // line read as a raised formation from above rather than as a stripe.
    const sh = Math.max(2, 0.5 * px);
    c.fillStyle = 'rgba(255,250,238,0.16)'; c.fillRect(0, 0, sh, s);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(s - sh, 0, sh, s);
  }
  // ── THE SLEEPERS, AND HOW MUCH BALLAST HAS TO SHOW BETWEEN THEM ──
  //
  // Reported from the seat: "sleeper gaps can be 4x." They can, and it is this
  // line. The first cut drew a 0.34 m sleeper and gave it a 0.17 m shadow, so
  // 0.51 m of a 0.65 m pitch was dark and the pale ballast between was 3.4 of
  // 16 canvas pixels — TWENTY-TWO PER CENT. A feature that thin on that pitch
  // beats against the screen's own grid under minification, and what survives
  // is every second or every fourth gap. The eye reads that as sleepers laid
  // four times too far apart, which is exactly the report.
  //
  // A real sleeper is 0.25 m on a 0.65 m pitch — the GAP is the majority of a
  // railway, about sixty per cent of it, and drawing the bars fat inverts the
  // thing that makes track read as track. 0.24 m with a 0.05 m shadow leaves
  // 55% pale, and a 8.9-pixel gap has room to survive a mip level.
  const slW = Math.max(2, 0.24 * py);
  const slX0 = mid - (spec.sleeperLenM / 2) * px, slX1 = mid + (spec.sleeperLenM / 2) * px;
  for (let k = 0; k < spec.sleepers; k++) {
    const y = ((k + 0.5) / spec.sleepers) * s - slW / 2;
    // Creosoted timber on a siding or a heritage line, concrete on a main line
    // — which is what the world has been laying since the sixties. BOTH are
    // well below the ballast: a concrete sleeper is only a little darker than
    // clean stone in life, and a little darker is nothing at all here.
    const tone = spec.minor || spec.kind === 'heritage'
      ? `rgba(${40 + r() * 14 | 0},${30 + r() * 11 | 0},${23 + r() * 9 | 0},0.95)`
      : `rgba(${84 + r() * 16 | 0},${80 + r() * 14 | 0},${74 + r() * 12 | 0},0.95)`;
    c.fillStyle = tone;
    c.fillRect(slX0, y, slX1 - slX0, slW);
    // …and a hairline of its own shadow into the stone on the far side. A
    // LINE, not a band: this used to be half the sleeper's width again and it
    // is what ate the gap.
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(slX0, y + slW, slX1 - slX0, Math.max(1, 0.05 * py));
  }
  // ── THE RAILS ──
  // Two of them, at the gauge, running the full length. Steel that is polished
  // on top and rusted on the web; on a disused line the head goes to rust too,
  // which is the single thing that says a railway is out of use.
  // Drawn at 0.14 m rather than a rail's true 0.07: at the survey's twelve
  // pixels to the metre the true head is under one pixel and dithers out, and
  // the doctrine's own rule for the road markings applies unchanged — a line
  // reads as a line or it reads as nothing.
  const railW = Math.max(2, 0.14 * px);
  // ── DARK OXIDISED STEEL, NOT POLISHED ──
  //
  // The first cut drew the head as near-white (214) on the reasoning that a
  // running rail is burnished by the wheels and catches the sky. From the seat:
  // "tracks need to be darker steel/metal/oxidised." They are right, and the
  // reason is the scale — the burnished strip is the 7 cm crown of the rail
  // and at twelve pixels to the metre you are not looking at the crown, you
  // are looking at a rail, which from any distance is dark oxidised iron
  // against pale stone. Bright rails also put the brightest thing in the frame
  // on a line two pixels wide, which is exactly the white contour diagram the
  // rendering doctrine forbids.
  //
  // Still two and a half palette steps under the ballast (138 against 97), so
  // the pair of lines reads as darkness on light rather than the reverse.
  const head = spec.disused ? 'rgba(120,72,46,0.96)' : 'rgba(104,96,88,0.96)';
  const web = spec.disused ? 'rgba(58,36,24,0.95)' : 'rgba(52,44,38,0.94)';
  for (const sgn of [-1, 1]) {
    const x = mid + sgn * (spec.gaugeM / 2) * px - railW / 2;
    c.fillStyle = web; c.fillRect(x - railW * 0.5, 0, railW * 2, s);
    c.fillStyle = head; c.fillRect(x, 0, railW, s);
  }
  // ── WHAT GROWS IN IT ──
  // Nothing on a main line: the whole purpose of ballast is that nothing does.
  // A siding is weeds between the sleepers, and a disused line is weeds over
  // the rails — the difference between a railway that is used and one that is
  // not, at the only scale this can be seen from.
  if (spec.ballast !== 'none' && (spec.minor || spec.disused)) {
    const n = spec.disused ? 90 : 30;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? 'rgba(74,96,44,0.5)' : 'rgba(48,70,34,0.45)';
      c.fillRect(slX0 + r() * (slX1 - slX0), r() * s, 2 + r() * 3, 2 + r() * 4);
    }
  }
}
