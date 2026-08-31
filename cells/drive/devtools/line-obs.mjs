/**
 * WHAT THE SATELLITE SAID, AND WHAT IS ACTUALLY THERE.
 *
 *   node cells/drive/devtools/line-obs.mjs line-01
 *
 * An observation is not a story the game tells you. It is a DISAGREEMENT
 * between two sources the game already carries, and both of them are real.
 *
 * The orbital layer is ESA WorldCover — the same 10m raster the renderer
 * paints the ground from, served through the cell at ~/cover/v1 as a grey PNG
 * whose pixel value IS the class code. The ground is OSM: a substation, a
 * water tower, a memorial, a covered reservoir. Where the raster says TREE
 * COVER over a substation, or CROPLAND over a covered reservoir, that is a
 * fact about the data and not an invention — and it is exactly the shape the
 * docket's categories fail to hold.
 *
 * MOST OF THESE ARE FALSE POSITIVES, and that is the design rather than an
 * apology for it. A 10m classifier puts a substation in a clearing under the
 * trees around it; a solar farm reads as bare ground; a covered reservoir is
 * literally under a field. Those are documented confusions of a real sensor.
 * The ranger drives out, looks, and the mismatch resolves into nothing.
 *
 * A few will not resolve. The game never says which, and this tool does not
 * know either: it emits the disagreement and its plausible sensor explanation,
 * and whether an observation is more than that is authored afterwards, one at
 * a time, by a person.
 *
 * Reads the corridor survey (docs/line/leg1-candidates.txt) for the ground and
 * the cell for the sky. Writes docs/line/obs-<leg>.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const HOST = 'https://c15r-drive.on.parc.land';
/**
 * ASK AT THE SENSOR'S OWN RESOLUTION, NOT THE RENDERER'S.
 *
 * The game paints ground from z12, where one cover pixel is 38m — fine for a
 * palette, dishonest for this. At 38m a substation in a lane of plane trees is
 * a mismatch because of OUR sampling, not the satellite's: the pixel is four
 * times the size of the thing and the trees win it by area. WorldCover is a
 * 10m product and z14 is 9.5m/px, so this is the finest question the data can
 * actually answer, and a disagreement at z14 is the sensor's own.
 */
const COVER_Z = Number(process.env.OBS_Z ?? 14), COVER_PX = 256;
const rad = Math.PI / 180;

/** The eleven classes, in the product's own words. */
const WC = {
  10: 'TREE COVER', 20: 'SHRUBLAND', 30: 'GRASSLAND', 40: 'CROPLAND',
  50: 'BUILT-UP', 60: 'BARE / SPARSE', 70: 'SNOW AND ICE', 80: 'PERMANENT WATER',
  90: 'HERBACEOUS WETLAND', 95: 'MANGROVES', 100: 'MOSS AND LICHEN',
};
/**
 * WHAT THE GROUND OUGHT TO READ AS, and the sensor's own excuse when it does
 * not. `expect` is the class a correct classification would give; `alibi` is
 * the documented reason a 10m product gets it wrong, which is what makes most
 * of these resolve into nothing when a ranger actually looks.
 */
const GROUND = {
  'power=substation': { expect: [50, 60], kind: 'STRUCTURE',
    alibi: 'a switchyard is gravel and steel inside a fence; at 10m the trees or scrub around it win the pixel' },
  'man_made=water_tower': { expect: [50], kind: 'STRUCTURE',
    alibi: 'a tower is a few metres across and its footprint is whatever it stands in' },
  'man_made=reservoir_covered': { expect: [50, 60], kind: 'WATER',
    alibi: 'a covered reservoir is buried under grass or crop — the orbital layer is reading the lid' },
  'man_made=storage_tank': { expect: [50, 60], kind: 'STRUCTURE', alibi: 'small, round, and usually inside a works' },
  'man_made=chimney': { expect: [50], kind: 'STRUCTURE', alibi: 'a vertical object has almost no footprint from above' },
  'man_made=silo': { expect: [50], kind: 'STRUCTURE', alibi: 'a silo stands in the farmyard it serves' },
  'man_made=windmill': { expect: [50], kind: 'STRUCTURE', alibi: 'a mill on a rise reads as the rise' },
  'historic=memorial': { expect: [50, 30], kind: 'DISTURBANCE',
    alibi: 'a memorial is a stone in a verge; nothing this size survives a 10m pixel' },
  'historic=castle': { expect: [50], kind: 'STRUCTURE', alibi: 'masonry under its own woodland' },
  'historic=ruins': { expect: [50, 60], kind: 'SUCCESSION',
    alibi: 'ruins revert — scrub and tree cover over a wall is what succession looks like from orbit' },
  'historic=aqueduct': { expect: [50], kind: 'STRUCTURE', alibi: 'a line of piers, mostly gaps' },
  'landuse=quarry': { expect: [60, 50], kind: 'DISTURBANCE',
    alibi: 'a worked-out quarry floods or greens over within a decade of closing' },
  'waterway=weir': { expect: [80, 50], kind: 'WATER', alibi: 'a weir is narrower than the river it sits in' },
};

const legId = process.argv[2] ?? 'line-01';
const src = process.argv[3] ?? 'docs/line/leg1-candidates.txt';

// ── the ground: the corridor survey, as it was written ─────────────
const lines = readFileSync(src, 'utf8').split('\n');
const found = [];
for (let i = 0; i < lines.length; i++) {
  // "   12.4  1830m   power=substation         BERTRON" then "48.78095,2.2887"
  const m = lines[i].match(/^\s*([\d.]+)\s+(\d+)m\s+([a-z_]+=[a-z_]+)\s+(.*?)\s*$/);
  if (!m) continue;
  const at = lines[i + 1]?.match(/^\s*(-?[\d.]+),(-?[\d.]+)\s*$/);
  if (!at) continue;
  const name = m[4] === '(unnamed)' ? null : m[4];
  found.push({ km: +m[1], offM: +m[2], tag: m[3], name, lat: +at[1], lon: +at[2] });
}
console.error(`ground: ${found.length} features from ${src}`);

// ── the sky: the cell's cover tiles, decoded ───────────────────────
const tiles = new Map();
const tileOf = (la, lo, z) => {
  const n = 2 ** z;
  return [Math.floor(((lo + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(la * rad) + 1 / Math.cos(la * rad)) / Math.PI) / 2) * n)];
};
/** 8-bit grey, filter 0, one filter byte a scanline — see greyPng in index.ts. */
function decodeGrey(buf) {
  let p = 8, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(COVER_PX * COVER_PX);
  for (let y = 0; y < COVER_PX; y++) {
    raw.copy(Buffer.from(out.buffer, y * COVER_PX, COVER_PX), 0, y * (COVER_PX + 1) + 1, y * (COVER_PX + 1) + 1 + COVER_PX);
  }
  return out;
}
async function coverAt(lat, lon) {
  const [x, y] = tileOf(lat, lon, COVER_Z);
  const k = `${x}/${y}`;
  if (!tiles.has(k)) {
    tiles.set(k, fetch(`${HOST}/~/cover/v1/${COVER_Z}/${x}/${y}`)
      .then(async (r) => (r.ok ? decodeGrey(Buffer.from(await r.arrayBuffer())) : null))
      .catch(() => null));
  }
  const px = await tiles.get(k);
  if (!px) return null;
  const n = 2 ** COVER_Z;
  const fx = ((lon + 180) / 360) * n - x;
  const fy = (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n - y;
  const i = Math.min(COVER_PX - 1, Math.max(0, Math.floor(fy * COVER_PX))) * COVER_PX
    + Math.min(COVER_PX - 1, Math.max(0, Math.floor(fx * COVER_PX)));
  return px[i] || null;
}

/**
 * HOW FAR OFF THE ROAD STILL COUNTS AS PASSING IT.
 *
 * The corridor survey ran a 2km band, which is the right width for asking what
 * is NEAR the line; it is far too wide for asking what you can SEE from it.
 * The median candidate sits 879m off the route — across fields, behind a wood,
 * on the far side of a village — and the first cut shipped six of those. The
 * test caught it standing on the course at the observation's own kilometre
 * with the thing 815m away, which is not an observation, it is a rumour.
 */
const OFF_MAX = 200;

const obs = [];
let asked = 0, agreed = 0, unknown = 0, far = 0;
for (const f of found) {
  const g = GROUND[f.tag];
  if (!g) continue;
  if (f.offM > OFF_MAX) { far++; continue; }
  const sat = await coverAt(f.lat, f.lon);
  asked++;
  if (sat === null) { unknown++; continue; }
  if (g.expect.includes(sat)) { agreed++; continue; }
  obs.push({ km: f.km, lat: f.lat, lon: f.lon, tag: f.tag, name: f.name,
    kind: g.kind, sat, satName: WC[sat] ?? `CLASS ${sat}`, alibi: g.alibi });
}
console.error(`ground: ${far} dropped as too far off the road (over ${OFF_MAX}m)`);
console.error(`sky: ${asked} sampled — ${agreed} agree, ${unknown} unreadable, ${obs.length} DISAGREE`);

// ── space them along the leg ───────────────────────────────────────
// Scarcity is the whole mechanic. Three hundred mismatches is a landscape of
// alerts nobody reads; eight is a drive with something to look at every few
// kilometres. Kept: the ones furthest apart, preferring a spread of KINDS
// over a run of the commonest one.
obs.sort((a, b) => a.km - b.km);
// Closer together than the first cut, because the offset filter thins the
// pool hard: at 4km apart over a 29km surveyed stretch there were six left.
const SPACING = 2.5;          // km — no two observations closer than this
/**
 * ONE PER WINDOW, and within a window the rarest kind wins.
 *
 * The first cut picked greedily by distance and then swapped in a rarer kind
 * when one sat nearby — which quietly broke the spacing it had just enforced:
 * leg 1 came out with observations at km 0.0, 0.3, 7.7, 8.7 and 9.2. Walking
 * fixed WINDOWS instead makes the two rules independent. The window decides
 * WHERE (one each, so they cannot bunch); the kind tally decides WHICH.
 */
const kept = [];
const byKind = new Map();
let clear = -Infinity;        // no pick may land before this
for (let i = 0; i < obs.length;) {
  if (obs[i].km < clear) { i++; continue; }
  const window = [];
  let j = i;
  while (j < obs.length && obs[j].km - obs[i].km < SPACING) window.push(obs[j++]);
  // Rarest kind so far; ties go to whichever the survey found first, which is
  // the one nearest the start of the window.
  window.sort((a, b) => (byKind.get(a.kind) ?? 0) - (byKind.get(b.kind) ?? 0));
  const pick = window[0];
  kept.push(pick);
  byKind.set(pick.kind, (byKind.get(pick.kind) ?? 0) + 1);
  // MEASURED FROM THE PICK, not from the window. Anchoring the next window to
  // the next CANDIDATE let a pick late in one window sit beside a pick early
  // in the next: leg 1 came out with observations 0.9km apart across a window
  // seam, having just been told they would be four.
  clear = pick.km + SPACING;
  i = j;
}
mkdirSync('docs/line', { recursive: true });
const file = `docs/line/obs-${legId}.json`;
writeFileSync(file, JSON.stringify(kept.map((o, i) => ({
  id: `${legId.replace('line-', 'obs-')}-${String(i + 1).padStart(2, '0')}`,
  ...o, km: +o.km.toFixed(1),
})), null, 1));
console.error(`\nkept ${kept.length} of ${obs.length}, ${SPACING}km apart:`);
for (const o of kept) {
  console.error(`  km ${String(o.km.toFixed(1)).padStart(5)}  ${o.kind.padEnd(11)} `
    + `sky says ${o.satName.padEnd(15)} ground says ${o.tag}${o.name ? ` "${o.name}"` : ''}`);
}
console.error(`\nby kind: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.error(`wrote ${file}`);
