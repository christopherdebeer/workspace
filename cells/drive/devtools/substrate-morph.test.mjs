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
const { buildSubstrateCells, sampleSubstrate, SUB_CH, SUB_FIELD_N, rockFamilyOf } = await import(BUNDLE);

const TILE = 2150;                                  // metres, a z14 tile at 28N
/** An authored tile: h(u, v) in raster indices, metres. */
function field(h, cover = () => 30) {
  const data = new Float32Array(256 * 256);
  for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) data[v * 256 + u] = h(u, v);
  const { a, b } = buildSubstrateCells({ data, xs: 0, zs: 0, w: TILE, h: TILE, cover });
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

// ── THE COVER'S WORD ── the same hillside, mapped bare and mapped wooded.
{
  const hill = (u, v) => 1000 + v * 4;
  const bare = field(hill, () => 60), wood = field(hill, () => 10);
  const eb = at(bare, 128, 128, SUB_CH.exposure), ew = at(wood, 128, 128, SUB_CH.exposure);
  const gb = at(bare, 128, 128, SUB_CH.grassPot), gw = at(wood, 128, 128, SUB_CH.grassPot);
  console.log(`one hillside: exposure bare ${eb.toFixed(2)} wooded ${ew.toFixed(2)}`
    + ` · grassPot bare ${gb.toFixed(2)} wooded ${gw.toFixed(2)}`);
  ok('bare ground reads as more exposed than a wood', eb > ew + 0.2, `${eb.toFixed(2)} vs ${ew.toFixed(2)}`);
  ok('a wood is not bedrock', ew < 0.3, `exposure ${ew.toFixed(2)}`);
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
