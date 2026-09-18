/**
 * ── IS THE VEGETATION A FACT ABOUT THE EARTH, OR ABOUT WHERE THE SESSION
 *    HAPPENED TO START? ──
 *
 *   node cells/drive/devtools/veg-anchor.test.mjs
 *
 * Pure node, no browser, about a second. It extracts the SHIPPED lattice
 * helpers out of main.ts and drives them under several different origins.
 *
 * THE FAULT THIS HOLDS SHUT. `origin` is set to whatever place is being loaded
 * and the truck is put at local (0, 0). The vegetation lattice, its candidate
 * hashes and its density field were all read in LOCAL metres, so the whole
 * stochastic domain moved with the spawn — and the density field is
 * `fract(sin(px * 12.9898 + pz * 78.233) * 43758.5453)`, whose value at (0, 0)
 * is EXACTLY ZERO because `sin(0)` is. Every spawn on Earth therefore landed in
 * a guaranteed hole in its own vegetation, and the same geography grew
 * different trees depending on how you arrived at it.
 *
 * THE OLD RULE IS THE CONTROL, which is the bar `clip.test.mjs` set: each claim
 * is checked against `floor(localX / VEG_CELL)` beside the shipped one, and the
 * control must FAIL where the fix passes. A regression test that does not fail
 * on the fault it names is decoration.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] || path.join(HERE, '../client/main.ts'));
let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the shipped helpers, lifted out of main.ts ───────────────────────────
// Both `const NAME = …;` and `function NAME(…)` forms, sliced at the first
// line that closes them at depth zero. Extracting rather than restating is the
// whole point: a second copy of the frame in a devtool is a copy that drifts.
const source = fs.readFileSync(SRC, 'utf8');
function decl(name) {
  for (const head of [`const ${name} = `, `function ${name}(`]) {
    const at = source.indexOf(head);
    if (at < 0) continue;
    let depth = 0, seen = false;
    for (let i = at; i < source.length; i++) {
      const ch = source[i];
      if (ch === '(' || ch === '{' || ch === '[') { depth++; seen = true; }
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === ';' && depth === 0 && seen) return source.slice(at, i + 1);
      if (seen && depth === 0 && ch === '}' && head.startsWith('function')) return source.slice(at, i + 1);
    }
  }
  throw new Error(`not found: ${name}`);
}
const NAMES = ['toLocal', 'localToLatLon', 'vegAbsOf', 'vegLocalOf', 'vegCellOf', 'vegCellPos', 'vegKey'];
const tmp = mkdtempSync(path.join(tmpdir(), 'veganchor-'));
const built = path.join(tmp, 'cul.mjs');
execFileSync('npx', ['esbuild', path.join(HERE, '../client/culture.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`, '--log-level=error'], { cwd: path.join(HERE, '../../..'), stdio: 'inherit' });
const { absMetres } = await import(built);
const vf = path.join(tmp, 'vf.mjs');
execFileSync('npx', ['esbuild', path.join(HERE, '../client/vegetation-field.ts'), '--bundle', '--format=esm',
  `--outfile=${vf}`, '--log-level=error'], { cwd: path.join(HERE, '../../..'), stdio: 'inherit' });
const VF = await import(vf);

const M_LAT = 111320;
const VEG_CELL = 220;
const ctx = { Math, absMetres, M_LAT, VEG_CELL, origin: { lat: 0, lon: 0, mLon: M_LAT } };
vm.createContext(ctx);
// Transpiled by esbuild rather than by a regex over the types: stripping
// annotations by hand is restating the language, and it silently produced a
// `toLocal` that was not a function at all on the first run.
const esbuild = await import('esbuild');
// AND THEY ARE PUBLISHED ONTO THE CONTEXT BY HAND. A `const` inside a vm
// script lives in that script's lexical scope and never becomes a property of
// the context — only a `function` declaration does — so the first run extracted
// all seven helpers correctly and then could not call any of the five that are
// arrows. The sibling globe test never met this because it extracts functions.
vm.runInContext(esbuild.transformSync(
  `${NAMES.map(decl).join('\n')}\n${NAMES.map((n) => `globalThis.${n} = ${n};`).join('\n')}`,
  { loader: 'ts', target: 'es2022' }).code, ctx);
const setOrigin = (lat, lon) => {
  ctx.origin = { lat, lon, mLon: M_LAT * Math.cos((lat * Math.PI) / 180) };
};

// ── the places, and the origins each is visited from ─────────────────────
const PLACES = [
  ['Nagato', 34.4084, 137.0936],
  ['Camps Bay', -33.955, 18.378],
  ['Yosemite', 37.73606, -119.63732],
  ['Sundarbans', 21.95, 89.18],
  ['Tromso', 69.649, 18.955],
];
// The report's own invariant: drive in, teleport in, load at it, hop to it.
const ORIGINS = (lat, lon) => [
  ['loaded here', lat, lon],
  ['2 km away', lat + 0.018, lon],
  ['50 km away', lat - 0.45, lon + 0.45],
  ['another continent', -12.5, -58.2],
];

// ── 1. the cell a place falls in is the same under every origin ──────────
let cellBad = 0, cellCtlBad = 0;
for (const [, lat, lon] of PLACES) {
  const want = [], ctl = [];
  for (const [, olat, olon] of ORIGINS(lat, lon)) {
    setOrigin(olat, olon);
    const [x, z] = ctx.toLocal(lat, lon);
    want.push(ctx.vegCellOf(x, z).join(','));
    ctl.push(`${Math.floor(x / VEG_CELL)},${Math.floor(z / VEG_CELL)}`);   // the rule it replaced
  }
  if (new Set(want).size !== 1) cellBad++;
  if (new Set(ctl).size !== 1) cellCtlBad++;
}
ok('a place falls in the same vegetation cell under every origin', cellBad === 0, { cellBad });
ok('…and the rule it replaced does NOT (the control)', cellCtlBad === PLACES.length,
  { failedUnderOldRule: cellCtlBad, of: PLACES.length });

// ── 2. a cell proposes the same candidates, in the same GEOGRAPHY ────────
// Positions are generated in the absolute frame and converted back, so the
// round trip has to land on the same lat/lon whatever the local frame is.
let candBad = 0, worst = 0;
for (const [, lat, lon] of PLACES) {
  const runs = [];
  for (const [, olat, olon] of ORIGINS(lat, lon)) {
    setOrigin(olat, olon);
    const [x, z] = ctx.toLocal(lat, lon);
    const [gx, gz] = ctx.vegCellOf(x, z);
    const here = [];
    for (let i = 0; i < VF.VEGETATION_DISTRIBUTION.clumpCandidates; i++) {
      const c = VF.vegetationCandidate(gx, gz, i, VF.VEGETATION_DISTRIBUTION.clumpCandidates, 0x2a1f4d31);
      const [px, pz] = ctx.vegCellPos(gx, gz, c.u, c.v);
      here.push(ctx.localToLatLon(px, pz));
    }
    runs.push(here);
  }
  for (let r = 1; r < runs.length; r++) {
    for (let i = 0; i < runs[0].length; i++) {
      const dLat = Math.abs(runs[0][i][0] - runs[r][i][0]);
      const dLon = Math.abs(runs[0][i][1] - runs[r][i][1]);
      worst = Math.max(worst, dLat * M_LAT, dLon * M_LAT * Math.cos(lat * Math.PI / 180));
      if (dLat > 1e-9 || dLon > 1e-9) candBad++;
    }
  }
}
ok('a cell proposes the same candidates at the same lat/lon under every origin',
  candBad === 0, { candBad, worstMetres: worst });
ok('…and the round trip is exact to under a millimetre', worst < 1e-3, { worstMetres: worst });

// ── 3. the density at a place is the place's, not the session's ──────────
// NOT BIT-IDENTICAL, AND IT CANNOT BE. The place is carried local -> lat/lon ->
// absolute through two divisions and a cosine, so two origins agree to float
// round-trip and no further. The field's lattice is 909 m, so its slope is
// about 0.0011 per metre: the bound below is 1e-9 of density, which is about a
// MICRON of position. Stated as a measured number rather than a loosened one —
// the first cut asked for 1e-12 and failed at 2 of 5 places on rounding alone.
const DENS_TOL = 1e-9;
let densBad = 0, densCtlSpread = 0, densSpread = 0;
for (const [, lat, lon] of PLACES) {
  const got = [], ctl = [];
  for (const [, olat, olon] of ORIGINS(lat, lon)) {
    setOrigin(olat, olon);
    const [x, z] = ctx.toLocal(lat, lon);
    const [ax, az] = ctx.vegAbsOf(x, z);
    got.push(VF.vegetationDensity(ax, az));
    ctl.push(VF.vegetationDensity(x, z));
  }
  densSpread = Math.max(densSpread, Math.max(...got) - Math.min(...got));
  if (Math.max(...got) - Math.min(...got) > DENS_TOL) densBad++;
  densCtlSpread = Math.max(densCtlSpread, Math.max(...ctl) - Math.min(...ctl));
}
ok('the density at a place is identical under every origin (to float round-trip)',
  densBad === 0, { densBad, worstSpread: densSpread });
ok('…and that round-trip is under a micron of ground',
  densSpread * 909 < 1e-5, { worstSpread: densSpread, asMetres: densSpread * 909 });
ok('…and under the old rule it was not (the control)', densCtlSpread > 0.1,
  { worstSpreadUnderOldRule: densCtlSpread.toFixed(3) });

// ── 4. NO SPAWN IS A GUARANTEED HOLE ─────────────────────────────────────
// The headline. Under the old rule the answer was exactly 0 at every spawn on
// Earth; under the new one a spawn is an ordinary sample of the field.
const spawns = [];
for (let i = 0; i < 400; i++) {
  const lat = -60 + (i * 37) % 120, lon = -180 + (i * 97) % 360;
  setOrigin(lat, lon);
  const [ax, az] = ctx.vegAbsOf(0, 0);          // the truck, at the moment of loading
  spawns.push(VF.vegetationDensity(ax, az));
}
const mean = spawns.reduce((a, b) => a + b, 0) / spawns.length;
const zeros = spawns.filter((d) => d < 0.02).length;
ok('a spawn is an ordinary sample of the field, not a zero',
  mean > 0.35 && mean < 0.65, { meanAtSpawn: mean.toFixed(4) });
ok('…and almost none of them land in a hole', zeros <= spawns.length * 0.05,
  { nearZero: zeros, of: spawns.length });
ok('…where the rule it replaced gave EXACTLY zero at every one (the control)',
  VF.vegetationDensity(0, 0) === 0, { oldRuleAtSpawn: VF.vegetationDensity(0, 0) });

// ── 5. and the thicket rate at a spawn is the world's ────────────────────
// Replays seedCell's own accept logic with the cover ceiling held constant, so
// the unit is GROUPS — which is what a driver sees and what a density cannot say.
function groupsAt(gx, gz) {
  let n = 0;
  for (let i = 0; i < VF.VEGETATION_DISTRIBUTION.clumpCandidates; i++) {
    const c = VF.vegetationCandidate(gx, gz, i, VF.VEGETATION_DISTRIBUTION.clumpCandidates, 0x2a1f4d31);
    const d = Math.min(1, Math.max(0, VF.vegetationDensity((gx + c.u) * VEG_CELL, (gz + c.v) * VEG_CELL)));
    if (c.accept >= VF.vegetationClumpChance(1, d)) continue;
    if (!VF.vegetationClumpRole(d, c.role)) continue;
    n++;
  }
  return n;
}
let atSpawn = 0, far = 0, nS = 0, nF = 0;
for (let i = 0; i < 300; i++) {
  const lat = -55 + (i * 31) % 110, lon = -175 + (i * 89) % 350;
  setOrigin(lat, lon);
  const [ax, az] = ctx.vegAbsOf(0, 0);
  atSpawn += groupsAt(Math.floor(ax / VEG_CELL), Math.floor(az / VEG_CELL)); nS++;
  far += groupsAt(Math.floor(ax / VEG_CELL) + 23, Math.floor(az / VEG_CELL) + 29); nF++;
}
const spawnRate = atSpawn / nS, farRate = far / nF;
ok('the thicket rate at a spawn matches the rate a few kilometres away',
  Math.abs(spawnRate - farRate) < 0.25 * farRate,
  { atSpawn: spawnRate.toFixed(2), farAway: farRate.toFixed(2) });
console.log(`\n  groups per cell: at the spawn ${spawnRate.toFixed(2)} · 5 km out ${farRate.toFixed(2)}`);
console.log(`  the old rule gave 0.00 at the spawn and ${farRate.toFixed(2)} out there.`);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
