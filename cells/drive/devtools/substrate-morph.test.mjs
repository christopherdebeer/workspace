/**
 * ── DOES THE GEOMORPHIC FIELD SAY WHAT IT CLAIMS? ──
 *
 *   node cells/drive/devtools/substrate-morph.test.mjs
 *
 * The substrate's whole case is that its features are CAUSALLY CORRELATED —
 * a shoulder sheds soil and shows rock, what breaks off it collects downslope
 * as scree, fines and water gather in hollows, grass exploits the soil. Every
 * one of those is a claim about a SIGN, and a sign is exactly what a test can
 * hold. Pure node over authored heightfields: no browser, no tiles, no
 * network, a second to run.
 *
 * THE ONE THAT MATTERS IS THE TALUS CASE. Debris must be high BELOW a cliff
 * and low ABOVE it — that asymmetry is the difference between a geological
 * story and a noise field, and it is the only assertion here that fails if the
 * uphill walk is written downhill (which is a sign error no frame would make
 * obvious: a scree apron above a cliff still looks like scree).
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// esbuild to a cache bundle and import that, the route every other pure test
// here takes — so this runs under plain `node` rather than depending on a
// TypeScript-stripping flag that changes between node versions.
const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/substrate-morph');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'substrate-field.mjs');
execSync(`npx esbuild ${join(CELL, 'client/substrate-field.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const { buildSubstrateCells, sampleSubstrate, SUB_CH, SUB_FIELD_N, rockFamilyOf,
  subExpressOf, subGrainOf } = await import(BUNDLE);

const TILE = 2150;                                  // metres, a z14 tile at 28N

// ── THE SELF-CONTAINMENT CHECK, FIRST, BECAUSE EVERYTHING ELSE RESTS ON IT ──
//
// The terrain kernel is stringified into a Blob worker, so this function is
// shipped there as TEXT rather than copied by hand. Re-evaluating it through
// `new Function` gives it no scope at all: if it has reached for a module-level
// helper or constant, this throws a ReferenceError here, in a second, instead
// of in the worker on its first job — where the symptom is no terrain anywhere
// and nothing in the console of the machine that has it.
const viaText = new Function(`return (${buildSubstrateCells.toString()})`)();
{
  const data = new Float32Array(256 * 256);
  for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) data[v * 256 + u] = 1000 + v * 3 + Math.sin(u / 9) * 12;
  const inp = { data, xs: 0, zs: 0, w: TILE, h: TILE, n: SUB_FIELD_N, cover: () => 30 };
  const direct = buildSubstrateCells(inp), text = viaText(inp);
  const same = direct.a.every((v, i) => v === text.a[i]) && direct.b.every((v, i) => v === text.b[i]);
  console.log(`self-contained: the function re-evaluated with no scope agrees ${same ? 'byte for byte' : 'NOT AT ALL'}`);
  // AND IT TRAVELS INSIDE A TEMPLATE LITERAL. terrainWorkerSource interpolates
  // this function's text into one, so a backtick or a ${'$'}{ in its body would end
  // the literal and produce a worker that does not parse — the same trap this
  // repo has recorded four times for GLSL comments, one layer over.
  const src = buildSubstrateCells.toString();
  const tmpl = !src.includes('`') && !src.includes('${'.replace('$', '$'));
  console.log(`  …and carries nothing that would end a template literal: ${tmpl ? 'yes' : 'NO'}`);
  if (!tmpl) { console.log('  FAIL the worker source would not parse'); process.exitCode = 1; }
  if (!same) { console.log('  FAIL the worker copy would not match the main thread'); process.exitCode = 1; }
}
/** An authored tile: h(u, v) in raster indices, metres. */
function field(h, cover = () => 30) {
  const data = new Float32Array(256 * 256);
  for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) data[v * 256 + u] = h(u, v);
  const { a, b } = buildSubstrateCells({ data, xs: 0, zs: 0, w: TILE, h: TILE, n: SUB_FIELD_N, cover });
  return { n: SUB_FIELD_N, xs: 0, zs: 0, w: TILE, h: TILE, a, b };
}
const at = (f, u, v, ch) => sampleSubstrate(f, (u / 256) * TILE, (v / 256) * TILE, ch);
let fails = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── A PLAIN ── nothing sheds, nothing collects, grass everywhere.
{
  const f = field(() => 1000);
  const e = at(f, 128, 128, SUB_CH.exposure), d = at(f, 128, 128, SUB_CH.debris);
  const g = at(f, 128, 128, SUB_CH.grassPot), s = at(f, 128, 128, SUB_CH.soilDepth);
  console.log(`a plain: exposure ${e.toFixed(2)} debris ${d.toFixed(2)} soil ${s.toFixed(2)} grass ${g.toFixed(2)}`);
  ok('a plain shows no bedrock', e < 0.15, `exposure ${e.toFixed(2)}`);
  ok('a plain sheds no debris', d < 0.35, `debris ${d.toFixed(2)}`);
  ok('a plain grows grass', g > 0.45, `grassPot ${g.toFixed(2)}`);
}

// ── A CLIFF WITH A TALUS BELOW IT ── the causal case. Height falls steeply
// over a band in the middle of the tile and lies flat either side, so "above"
// and "below" are unambiguous and the only difference between the two is
// which side of the face they are on.
{
  // v < 100: high bench. 100..120: the face. v > 120: the apron, gently down.
  // The apron falls at about 28% — talus rests near thirty degrees, and the
  // first cut of this fixture gave it 7%, which is a valley floor rather
  // than a scree slope and tested the wrong landform.
  const f = field((u, v) => (v < 100 ? 1400 : v < 120 ? 1400 - (v - 100) * 14 : 1120 - (v - 120) * 2.4));
  // Read as a PROFILE down the fall line rather than at one point: what makes
  // this geology is the shape of the apron, and a single sample can be right
  // for the wrong reason.
  const prof = [60, 80, 105, 124, 130, 140, 170, 240].map((v) => ({
    v, e: at(f, 128, v, SUB_CH.exposure), d: at(f, 128, v, SUB_CH.debris), g: at(f, 128, v, SUB_CH.grassPot),
  }));
  console.log('a cliff, down the fall line:');
  for (const r of prof) {
    console.log(`   v${String(r.v).padStart(4)} ${(r.v < 100 ? 'above' : r.v < 120 ? 'ON THE FACE' : `+${((r.v - 120) * 2.4).toFixed(0)}m below`).padStart(13)}`
      + `  exposure ${r.e.toFixed(2)} debris ${r.d.toFixed(2)} grass ${r.g.toFixed(2)}`);
  }
  const P = (v) => prof.find((r) => r.v === v);
  ok('the face shows bedrock', P(105).e > 0.55, `exposure ${P(105).e.toFixed(2)}`);
  ok('the bench above it does not', P(60).e < 0.25 && P(80).e < 0.25);
  ok('NOTHING IS SHED ABOVE THE FACE', P(60).d < 0.05 && P(80).d < 0.05,
    `${P(60).d.toFixed(2)} / ${P(80).d.toFixed(2)}`);
  ok('THE APRON IS DIRECTLY BELOW IT', P(124).d > 0.35 && P(130).d > 0.3,
    `+10m ${P(124).d.toFixed(2)} · +24m ${P(130).d.toFixed(2)}`);
  ok('…and thins with distance from the face', P(130).d > P(140).d && P(140).d > P(170).d,
    `${P(130).d.toFixed(2)} > ${P(140).d.toFixed(2)} > ${P(170).d.toFixed(2)}`);
  ok('grass does not grow on the face', P(105).g < 0.2, `grassPot ${P(105).g.toFixed(2)}`);
  ok('…and returns down the apron', P(130).g > 0.5, `grassPot ${P(130).g.toFixed(2)}`);
}

// ── A HOLLOW AND A SHOULDER ── the same slope, opposite curvature.
{
  const f = field((u, v) => 1000 + ((v - 128) ** 2) * 0.02);      // a valley along u
  const floor = at(f, 128, 128, SUB_CH.moisture), flank = at(f, 128, 40, SUB_CH.moisture);
  const floorS = at(f, 128, 128, SUB_CH.soilDepth), flankE = at(f, 128, 40, SUB_CH.exposure);
  console.log(`a valley: moisture floor ${floor.toFixed(2)} flank ${flank.toFixed(2)}`
    + ` · soil on the floor ${floorS.toFixed(2)} · exposure on the flank ${flankE.toFixed(2)}`);
  ok('the floor is wetter than the flank', floor > flank + 0.1, `${floor.toFixed(2)} vs ${flank.toFixed(2)}`);
  ok('the floor holds soil', floorS > 0.35, `soil ${floorS.toFixed(2)}`);
}

// ── THE COVER'S WORD, AND WHERE IT IS NOW ALLOWED TO SPEAK ──
//
// The same hillside, mapped bare and mapped wooded. This block used to assert
// the opposite of what it asserts now, and the change is the point: latent
// exposure is a statement about the SHAPE of the ground, so a grass-covered
// cliff is still a cliff and the two must come out IDENTICAL. What the wood
// decides is how much of that stone breaks through, which is subExpressOf's
// job and is measured here beside it rather than assumed.
{
  const hill = (u, v) => 1000 + v * 4;
  const bare = field(hill, () => 60), wood = field(hill, () => 10);
  const eb = at(bare, 128, 128, SUB_CH.exposure), ew = at(wood, 128, 128, SUB_CH.exposure);
  const gb = at(bare, 128, 128, SUB_CH.grassPot), gw = at(wood, 128, 128, SUB_CH.grassPot);
  const sb = at(bare, 128, 128, SUB_CH.soilDepth), sw = at(wood, 128, 128, SUB_CH.soilDepth);
  const db = at(bare, 128, 128, SUB_CH.debris), dw = at(wood, 128, 128, SUB_CH.debris);
  console.log(`one hillside: exposure bare ${eb.toFixed(2)} wooded ${ew.toFixed(2)}`
    + ` · soil ${sb.toFixed(2)}/${sw.toFixed(2)} · grassPot ${gb.toFixed(2)}/${gw.toFixed(2)}`);
  ok('the LATENT exposure is the landform\'s, whatever grows on it',
    Math.abs(eb - ew) < 0.02, `${eb.toFixed(3)} vs ${ew.toFixed(3)}`);
  ok('…and the debris it sheds is too', Math.abs(db - dw) < 0.02, `${db.toFixed(3)} vs ${dw.toFixed(3)}`);
  ok('a wood holds more soil than bare ground', sw > sb + 0.08, `${sb.toFixed(2)} vs ${sw.toFixed(2)}`);
  ok('…and more grass potential', gw > gb + 0.05, `${gb.toFixed(2)} vs ${gw.toFixed(2)}`);
  // …AND THE EXPRESSION IS WHERE THE WOOD WINS. veg here is the PALETTE's own
  // greenness, which this pure test has no palette for, so representative
  // values are passed and named: bare ground is not green, a wood is.
  const xb = subExpressOf(eb, db, sb, gb, 0.0, subGrainOf(60));
  const xw = subExpressOf(ew, dw, sw, gw, 0.35, subGrainOf(10));
  console.log(`  expressed rock: bare ${xb.rock.toFixed(3)} wooded ${xw.rock.toFixed(3)}`
    + ` · grass ${xb.grass.toFixed(2)}/${xw.grass.toFixed(2)}`);
  ok('far less of the stone breaks through a wood', xw.rock < xb.rock * 0.8,
    `${xb.rock.toFixed(3)} vs ${xw.rock.toFixed(3)}`);
  ok('…and it is never erased entirely — a wood on rock is still on rock', xw.rock > 0.0001,
    `${xw.rock.toFixed(4)}`);
}

// ── A CLIFF NARROWER THAN A CELL SURVIVES THE DOWNSAMPLE ──
//
// The lattice is a 33 m mean and this is the feature it destroys: a 25 m step
// over one 8 m raster pixel has an enormous NATIVE gradient and a mean-to-mean
// gradient of about a third, so before the block's own height range and its
// steepest adjacent step were carried beside the mean, the normal map drew the
// escarpment and the substrate simultaneously decided it was not rock.
{
  const flat = field(() => 1000);
  const rib = field((u, v) => 1000 + (v >= 128 ? 25 : 0));
  const ef = at(flat, 128, 100, SUB_CH.exposure);
  // SCANNED, NOT POINT-SAMPLED. `at` is bilinear over a 33 m lattice and the
  // step is one raster pixel wide, so a reading taken exactly on it is the
  // escarpment's cell averaged with the plain's — which is the right answer
  // for a point and the wrong instrument for "does the model see this at all".
  let er = 0, erAt = 0;
  for (let v = 96; v <= 160; v++) {
    const e = at(rib, 128, v, SUB_CH.exposure);
    if (e > er) { er = e; erAt = v; }
  }
  console.log(`a one-pixel escarpment: peak exposure ${er.toFixed(2)} at v=${erAt}`
    + ` (${at(rib, 128, 128, SUB_CH.exposure).toFixed(2)} sampled on the step itself)`
    + ` against flat ground ${ef.toFixed(2)}`);
  ok('the rib reads as exposed rock', er > 0.45, `exposure ${er.toFixed(2)}`);
  ok('…and the plain beside it does not', ef < 0.1, `exposure ${ef.toFixed(2)}`);
}

// ── THE MORPHOLOGY CROSSES A TILE EDGE ──
//
// Slope over 33 m, curvature over 100, a relief window over 200 and a debris
// walk over 200 are all processes at a scale where a terrain tile's boundary
// is an arbitrary line — and the field used to see a PLATEAU past it: `at`
// clamped and the walk `break`ed, so an apron whose cliff stood in the next
// tile had no cliff above it and the scree stopped dead on the seam.
//
// The world here is flat up to the boundary and then rises 80 m over a hundred
// metres just INSIDE the eastern neighbour. Tile A's own raster never sees that
// face. With a height sampler it now walks into it; without one it cannot, and
// the pair is the control — an assertion that does not fail on the behaviour it
// names is decoration.
{
  // World metres: flat, then a face starting 40 m past tile A's eastern edge.
  const W = (x) => {
    const d = x - (TILE + 40);
    return 1000 + (d <= 0 ? 0 : d >= 100 ? 80 : d * 0.8);
  };
  const tileAt = (xs, withSampler) => {
    const data = new Float32Array(256 * 256);
    for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) data[v * 256 + u] = W(xs + (u / 255) * TILE);
    const inp = { data, xs, zs: 0, w: TILE, h: TILE, n: SUB_FIELD_N, cover: () => 30 };
    if (withSampler) inp.height = (x) => W(x);
    const { a: fa, b: fb } = buildSubstrateCells(inp);
    return { n: SUB_FIELD_N, xs, zs: 0, w: TILE, h: TILE, a: fa, b: fb };
  };
  // The easternmost interior cell of tile A, in world metres.
  const eastX = TILE - (TILE / SUB_FIELD_N) * 0.5, midZ = TILE * 0.5;
  const blind = tileAt(0, false), seeing = tileAt(0, true);
  const dBlind = sampleSubstrate(blind, eastX, midZ, SUB_CH.debris);
  const dSee = sampleSubstrate(seeing, eastX, midZ, SUB_CH.debris);
  const eBlind = sampleSubstrate(blind, eastX, midZ, SUB_CH.exposure);
  const eSee = sampleSubstrate(seeing, eastX, midZ, SUB_CH.exposure);
  console.log(`across a tile edge: debris under a cliff in the NEXT tile`
    + ` — blind ${dBlind.toFixed(2)}, with the neighbour ${dSee.toFixed(2)}`
    + ` (exposure ${eBlind.toFixed(2)} -> ${eSee.toFixed(2)})`);
  ok('the apron finds the face across the boundary', dSee > dBlind + 0.15,
    `${dBlind.toFixed(2)} vs ${dSee.toFixed(2)}`);
  ok('…and the control is blind to it, which is what makes that a measurement',
    dBlind < 0.2, `blind debris ${dBlind.toFixed(2)}`);
  // …AND THE TWO TILES AGREE ON THE SEAM. Both see the same neighbourhood now,
  // so the shared edge is one landform read twice rather than two plateaux.
  const east = tileAt(TILE, true);
  const seamA = sampleSubstrate(seeing, TILE - 1, midZ, SUB_CH.exposure);
  const seamB = sampleSubstrate(east, TILE + 1, midZ, SUB_CH.exposure);
  const seamAb = sampleSubstrate(blind, TILE - 1, midZ, SUB_CH.exposure);
  const seamBb = sampleSubstrate(tileAt(TILE, false), TILE + 1, midZ, SUB_CH.exposure);
  console.log(`  the seam itself: ${seamA.toFixed(2)} | ${seamB.toFixed(2)}`
    + ` (blind: ${seamAb.toFixed(2)} | ${seamBb.toFixed(2)})`);
  ok('the two tiles agree across the seam', Math.abs(seamA - seamB) < 0.12,
    `${seamA.toFixed(2)} vs ${seamB.toFixed(2)}`);
}

// ── FLOW POINTS DOWNHILL ── the axis every anisotropic warp downstream reads.
{
  const f = field((u, v) => 1000 + v * 4);                       // rises with +z
  const fz = at(f, 128, 128, SUB_CH.flowZ), fx = at(f, 128, 128, SUB_CH.flowX);
  console.log(`flow on a north-facing ramp: (${fx.toFixed(2)}, ${fz.toFixed(2)})`);
  ok('flow runs down the slope', fz < -0.7, `flowZ ${fz.toFixed(2)}`);
  ok('…and not across it', Math.abs(fx) < 0.3, `flowX ${fx.toFixed(2)}`);
}

// ── THE FAMILY NAMES ARE A TABLE, NOT A GUESS ──
ok('rock families round to their own names',
  rockFamilyOf(0) === 'massive' && rockFamilyOf(0.34) === 'bedded'
  && rockFamilyOf(0.67) === 'fractured' && rockFamilyOf(1) === 'loose');

console.log(fails ? `\n${fails} FAILED` : '\nall ok — the field says what it claims');
process.exit(fails ? 1 : 0);
