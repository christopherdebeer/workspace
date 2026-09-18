/**
 * ── A WORLD YOU AUTHORED, THROUGH THE PIPELINE YOU SHIP ──
 *
 * The labs so far isolate SOLVERS — the bench search, the climate field, the
 * weather lattice — because a solver is a pure function and a lab can call it.
 * The things people actually complain about are further downstream: the batter
 * is a cliff, the junction hangs in the air, the kerb steps, the sward stops
 * at a seam. Those are MESHES, built by eighteen hundred lines wired into the
 * game's own module state, and no lab can call them.
 *
 * So this does not try. It replaces the WORLD instead.
 *
 * The world arrives through exactly three fetches — a terrarium height tile, a
 * WorldCover class tile, and a vector tile of OSM ways. Answer those three
 * from a fixture and the entire production pipeline runs unchanged: the same
 * terrain build, the same corridor carve, the same ribbon, batter, kerb and
 * junction code, the same vegetation, sward, façades and water. What comes out
 * is the REAL mesh, over ground you chose, with no network in the loop at all.
 *
 * That last part matters more than it sounds. Half this session's inspection
 * problems were an Overpass upstream that would not serve a town — a fixture
 * world cannot fail that way, and it is the same every time it is opened,
 * which is what makes a before-and-after screenshot mean anything.
 *
 * ── AND IT IS TUNABLE, BECAUSE A LAB THAT IS NOT IS A SCREENSHOT ──
 *
 * Every fixture is a function of a `FixtureTune`, not a constant: relief,
 * cross-slope, lift, road class, lanes, surface, storey count and ground
 * cover. The tune rides in the URL, so a fixture worth arguing about is a
 * link, and /lab/world puts the same numbers on dials that persist and copy.
 */

import { clipToBounds } from './clip';

/** Ground cover, by the WorldCover class the raster would have carried. */
export type FixtureCover =
  | 'mixed' | 'forest' | 'scrub' | 'grass' | 'farmland' | 'urban' | 'barren';

export interface FixtureTune {
  /** Multiplies every undulation. 0 is a billiard table. */
  relief: number;
  /** Multiplies the steady cross-slope or climb a fixture is built around. */
  slope: number;
  /** Added to every height — which biome and treeline you land in. */
  lift: number;
  /** `highway` on the fixture's principal road. */
  roadClass: string;
  lanes: number;
  surface: string;
  /** `building:levels` for the terraces, where a fixture has any. */
  levels: number;
  cover: FixtureCover;
  /** Which way the rig faces on arrival. −1 keeps the fixture's own. */
  heading: number;
}

export const DEFAULT_FIXTURE_TUNE: FixtureTune = {
  relief: 1,
  slope: 1,
  lift: 0,
  roadClass: 'secondary',
  lanes: 2,
  surface: 'asphalt',
  levels: 3,
  cover: 'mixed',
  heading: -1,
};

export const FIXTURE_ROAD_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'service', 'track',
] as const;
export const FIXTURE_SURFACES = ['asphalt', 'concrete', 'paved', 'gravel', 'dirt', 'sand'] as const;
export const FIXTURE_COVERS: readonly FixtureCover[] =
  ['mixed', 'forest', 'scrub', 'grass', 'farmland', 'urban', 'barren'];

/** WorldCover class ids, as the pixel actually stores them. */
const CLASS: Record<Exclude<FixtureCover, 'mixed'>, number> = {
  forest: 10, scrub: 20, grass: 30, farmland: 40, urban: 50, barren: 60,
};

export interface FixtureWay {
  id: number;
  tags: Record<string, string>;
  /** Metres east and south of the fixture's own origin — converted to lat/lon
   *  by the caller, so a fixture is authored in the units it is judged in. */
  pts: Array<[number, number]>;
}

export interface WorldFixture {
  id: string;
  label: string;
  note: string;
  /** Where the truck starts, and which way it faces by default. Every fixture
   *  puts a road THROUGH this point, so the rig lands on tarmac. */
  spawn: { lat: number; lon: number; heading: number };
  /** Ground height in metres, from metres east/south of the origin. */
  height(e: number, s: number, t: FixtureTune): number;
  /** The WorldCover class at a point — what vegetation, sward and biome read. */
  cover(e: number, s: number, t: FixtureTune): number;
  /** Everything OSM would have said about this place. */
  ways(t: FixtureTune): FixtureWay[];
  /**
   * HOW FAR THE EVIDENCE GOES, in metres from the origin — the streamer holds
   * its rings to this (see FIX_R in main.ts).
   *
   * Only a CAPTURE knows it, and only a capture needs it. An authored fixture
   * is a formula defined everywhere, so its ways are its extent; a captured one
   * has a height grid that stops, and past the edge `sample` clamps, which
   * means the ground out there is the last row of the evidence smeared to the
   * horizon. Worse, the way extent is not a usable stand-in for a capture:
   * `capture-world.mjs` keeps a way that merely COMES NEAR the box but keeps
   * its whole geometry, so one arterial passing through put the measured extent
   * at 2,562m for a 700m capture — nearly four times the ground that exists.
   */
  extent?: number;
  /**
   * THE ECOREGION THIS GROUND IS IN, so a fixture can exercise the guild.
   *
   * `ecoAt` refuses to fetch on a fixture — asking would pull the REAL ecology
   * of the authored crossroads' coordinates, which is the country above Geneva
   * (the same trap `loadOvTile` and `loadPeakTile` already wear a gate for).
   * That left the vegetation guilds untestable on the one worlds that are
   * deterministic and need no network: every fixture fell back to the climate
   * path, so the fast offline harness could say nothing about the rule that
   * decides what grows.
   *
   * So a fixture DECLARES its region instead of asking for it. One record, not
   * a tile: a capture's box is 700m to 1.4km and an ecoregion boundary is not
   * real to five kilometres, so a point answer for the whole box is not an
   * approximation worth apologising for. `devtools/capture-world.mjs` looks it
   * up and prints the line to paste; the six existing captures carry theirs
   * from the same lookup, recorded in CAPTURE_INDEX beside the coordinates it
   * was made at.
   *
   * Undeclared means null, which is exactly what the open sea returns — an
   * authored fixture is nowhere, and nowhere has no ecoregion.
   */
  eco?: { id: number; biome: number; name: string; realm: string };
}

/** A line of points along a bearing, so a fixture reads as intent rather than
 *  as a list of coordinates. */
function run(e0: number, s0: number, deg: number, len: number, step = 25): Array<[number, number]> {
  const r = deg * Math.PI / 180;
  const out: Array<[number, number]> = [];
  for (let m = 0; m <= len; m += step) out.push([e0 + Math.sin(r) * m, s0 - Math.cos(r) * m]);
  return out;
}

/** A line THROUGH a point on a bearing, centred on it — for an arm that passes
 *  a node rather than terminating at it. `run` starts AT its point, which is
 *  what a terminating arm wants; this is the other half. */
function through(e: number, s: number, deg: number, len: number, step = 20): Array<[number, number]> {
  const r = deg * Math.PI / 180;
  return run(e - Math.sin(r) * len / 2, s + Math.cos(r) * len / 2, deg, len, step);
}

/**
 * A SLIP ROAD: parallel to its host for a while, then closing on it over a
 * taper. Real merges are not a node with an angle at it — they are two
 * carriageways side by side whose gore narrows to nothing, which is a
 * completely different thing to crop and the reason `run`/`through` cannot
 * express one.
 *
 * `side` is the offset it starts at (negative = the other side), `taperLen`
 * how long it takes to close. The last point lands exactly on the host line, so
 * the node is where the centrelines finally meet rather than where they first
 * come near.
 */
function slip(
  e0: number, s0: number, deg: number, side: number, runLen: number, taperLen: number, step = 12,
): Array<[number, number]> {
  const r = deg * Math.PI / 180;
  const fx = Math.sin(r), fz = -Math.cos(r);      // along the host
  const nx = Math.cos(r), nz = Math.sin(r);       // to its right
  const out: Array<[number, number]> = [];
  const total = runLen + taperLen;
  for (let m = 0; m <= total; m += step) {
    // Cosine ease, so the taper has no corner at either end — a straight
    // chamfer puts a kink in the kerb exactly where the crop is looking.
    const t = m <= runLen ? 0 : (m - runLen) / taperLen;
    const off = side * (1 - (1 - Math.cos(Math.PI * (1 - t))) / 2);
    out.push([e0 + fx * m + nx * off, s0 + fz * m + nz * off]);
  }
  return out;
}

/**
 * A smooth 0..1 window around one node, so each junction can stand on its own
 * landform without the next one feeling it. Cosine, not a Gaussian: a Gaussian
 * never quite reaches zero, and at 420m spacing nine tails add up to a tilt
 * nobody authored — which is exactly the kind of thing that makes a fixture
 * lie about what it is testing.
 */
function near(e: number, s: number, ce: number, cs: number, r = 230): number {
  const d = Math.hypot(e - ce, s - cs) / r;
  return d >= 1 ? 0 : (Math.cos(d * Math.PI) + 1) / 2;
}

/** The principal road's tags, from the tune — one place, so every fixture's
 *  main road answers the dials the same way. */
const mainTags = (t: FixtureTune, name: string): Record<string, string> => ({
  highway: t.roadClass,
  name,
  surface: t.surface,
  lanes: String(Math.max(1, Math.round(t.lanes))),
});

/**
 * DEFAULT COVER. A single class everywhere is the honest answer for most
 * dials — you asked for forest, you get forest to the horizon. `mixed` is the
 * one that has to be authored, and it is authored the way cover actually
 * varies: by height band, with a soft boundary so the sward has a gradient to
 * cross rather than a straight line at a threshold.
 */
function mixedCover(e: number, s: number, y: number): number {
  const wob = Math.sin(e / 190) * 34 + Math.cos(s / 165) * 28 + Math.sin((e + s) / 95) * 16;
  const band = y + wob;
  if (band > 1180) return CLASS.barren;
  if (band > 980) return CLASS.scrub;
  if (band > 520) return CLASS.forest;
  if (band > 300) return CLASS.grass;
  return CLASS.farmland;
}

const coverFor = (e: number, s: number, t: FixtureTune, y: number): number =>
  (t.cover === 'mixed' ? mixedCover(e, s, y) : CLASS[t.cover]);


/**
 * ── A CAPTURED PLACE, PLAYED AS A FIXTURE ──
 *
 * `devtools/capture-world.mjs` pulls the three fetches for a real box — the
 * terrarium heights, the WorldCover classes and the OSM ways — and writes them
 * as one JSON. This turns that back into a `WorldFixture`, so somewhere that
 * actually goes wrong can be opened in forty seconds and looked at, instead of
 * six minutes of streaming that comes out different every run.
 *
 * The dials still work, and mean what they can mean for a real place: `relief`
 * scales the ground's DEVIATION from its own mean rather than its absolute
 * height, so relief 0 flattens the terrain to a plane at the site's average
 * elevation and leaves the roads where they are. That is the comparison worth
 * having — the same junctions, with and without the ground — and it is not
 * available anywhere else. `lift` still shifts the whole thing, and `cover`
 * overrides the captured classes only when it is not `mixed`, because on a
 * capture the classes are evidence rather than a preference.
 *
 * The ROAD dials do nothing here on purpose. A capture's classes and widths are
 * the thing under test; rewriting them with `roadClass` would replace the case
 * with a different one that happens to be in the same place.
 */
interface CapturedWorld {
  name: string;
  origin: { lat: number; lon: number };
  r: number;
  /** Base64 Int16 centimetres above `base` — see capture-world.mjs on why the
   *  grid is not written out as JSON numbers (it is most of the file). */
  height: { n: number; step: number; base: number; b64: string };
  cover: { n: number; step: number; px: number[] };
  ways: Array<{ id: number; tags: Record<string, string>; pts: Array<[number, number]> }>;
}

function captured(cap: CapturedWorld, label: string, note: string, heading = 0,
  eco?: { id: number; biome: number; name: string; realm: string }): WorldFixture {
  const { n, step, base, b64 } = cap.height;
  // atob, not Buffer: this runs in the browser. The Int16Array is built by copy
  // rather than as a view, because a view onto a byte string's buffer inherits
  // its offset and the first sample lands wherever the decode happened to
  // start.
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const cm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  let sum = 0;
  for (let i = 0; i < cm.length; i++) sum += cm[i];
  const mean = base + sum / (cm.length || 1) / 100;
  /** Bilinear, because the grid is the DEM's own ~8m and nearest-neighbour
   *  would put 8m stair-steps under a road whose whole difficulty is that its
   *  profile is solved over this ground. */
  const sample = (e: number, s: number): number => {
    const fx = clampF((e + cap.r) / step, 0, n - 1.001);
    const fy = clampF((s + cap.r) / step, 0, n - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (x: number, y: number): number => base + cm[y * n + x] / 100;
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty)
      + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  return {
    id: `at-${cap.name}`,
    label,
    note,
    spawn: { lat: cap.origin.lat, lon: cap.origin.lon, heading },
    height: (e, s, t) => t.lift + mean + (sample(e, s) - mean) * t.relief,
    cover(e, s, t) {
      if (t.cover !== 'mixed') return CLASS[t.cover];
      const c = cap.cover;
      const x = Math.round(clampF((e + cap.r) / c.step, 0, c.n - 1));
      const y = Math.round(clampF((s + cap.r) / c.step, 0, c.n - 1));
      return c.px[y * c.n + x] ?? CLASS.grass;
    },
    ways: () => capturedWays(cap),
    extent: cap.r,
    eco,
  };
}
const clampF = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * ── A CAPTURED WAY STOPS WHERE THE CAPTURED GROUND STOPS ──
 *
 * capture-world keeps a way that merely comes NEAR the box, and keeps its whole
 * geometry: OSM returns a way's complete line, so one arterial passing through
 * a 700m capture arrives 2,262m long. Measured on Camps Bay, 279 of 9,386 way
 * points lay outside the box.
 *
 * That was harmless only while the streamer built ten kilometres of ground
 * around every fixture. Now that it builds the fixture's own extent, those
 * points stand over nothing: `hasHeight` refuses them, the way counts as
 * unbuilt, and `loadOsmTile` re-renders that tile every three seconds for ever
 * — which re-dirties the terrain under it, so the carve queue never drains.
 * The world is then permanently mid-build, which is the one state that makes
 * every measurement taken from it worthless.
 *
 * So the ways are clipped to the captured box. The height grid clamps to its
 * edge row beyond `cap.r`, so a road out there was being drawn over invented
 * ground in any case; cutting it is the honest line rather than a concession.
 * If a junction you care about sits at the edge, that is a capture with too
 * small an `r`, and the fix is to capture it again wider.
 *
 * THROUGH THE SHIPPING CLIPPER, not a second implementation of it. `clipToBounds`
 * is Liang-Barsky per segment, and it exists because the obvious vertex walk
 * silently drops the segment that crosses the box with neither endpoint inside
 * (client/clip.ts carries that whole story). Its box is named in lat/lon and a
 * fixture is authored in metres, but the arithmetic is affine and cares only
 * about the shape: north is -s and east is e, and the clipper never divides one
 * by the other.
 */
function capturedWays(cap: CapturedWorld): FixtureWay[] {
  const R = cap.r;
  const box = { latN: R, latS: -R, lonW: -R, lonE: R };
  const out: FixtureWay[] = [];
  for (const w of cap.ways) {
    const runs = clipToBounds(w.pts.map(([e, s]) => ({ lat: -s, lon: e })), box);
    for (let i = 0; i < runs.length; i++) {
      // A run of one point is a way that grazed a corner: no length, no normal
      // to build a ribbon from.
      if (runs[i].length < 2) continue;
      // ONE WAY CAN CLIP INTO SEVERAL RUNS, and renderWays dedupes by id — so
      // two runs sharing an id would delete each other. Derived rather than
      // raw: OSM ids are ~1.3e9, and 16x that is still nowhere near the integer
      // limit. The name and the tags are what identify a way when reading a
      // probe anyway.
      out.push({ id: w.id * 16 + i, tags: w.tags, pts: runs[i].map((p) => [p.lon, -p.lat]) });
    }
  }
  return out;
}

/** 46°N: temperate, which is where most of the world's road stock is and the
 *  climate the building and road cultures were tuned against. */
const HOME = { lat: 46.2, lon: 6.1 };

export const WORLD_FIXTURES: readonly WorldFixture[] = [
  {
    id: 'crossroads',
    label: 'CROSSROADS',
    note: 'Two roads of different class meeting at ninety degrees on gently rolling ground — the junction crop, the bellmouth and the kerb return, with nothing else in the frame.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 0 },
    height: (e, s, t) => t.lift + 320 + (Math.sin(e / 220) * 6 + Math.cos(s / 260) * 5) * t.relief,
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => [
      { id: 1, tags: mainTags(t, 'Fixture Way'), pts: run(0, 500, 0, 1000) },
      { id: 2, tags: { highway: 'residential', name: 'Cross Street', surface: 'asphalt' },
        pts: run(-500, 0, 90, 1000) },
    ],
  },
  {
    id: 'tee',
    label: 'T ON A SLOPE',
    note: 'A minor road joining a major one across a cross-slope: the case where the joiner has to reach the host deck, and where a batter on the low side becomes visible.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 20 },
    // A steady cross-slope, so the two roads sit at genuinely different heights.
    height: (e, s, t) => t.lift + 300 + e * 0.11 * t.slope + Math.sin(s / 180) * 4 * t.relief,
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => [
      { id: 1, tags: mainTags(t, 'Ridge Road'), pts: run(0, 480, 0, 960) },
      { id: 2, tags: { highway: 'unclassified', name: 'Farm Lane', surface: 'gravel' },
        pts: run(0, 0, 90, 420) },
    ],
  },
  {
    id: 'hairpin',
    label: 'HAIRPIN CLIMB',
    note: 'Switchbacks up a steep hillside — the grade solver against its cap, with cut on the inside of every bend and fill on the outside. The batter case.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 90 },
    height: (e, s, t) => t.lift + 280 + s * 0.22 * t.slope + Math.sin(e / 90) * 9 * t.relief,
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => {
      const pts: Array<[number, number]> = [];
      // Five legs climbing, each reversing across the slope. Leg zero runs
      // through the origin, so the rig spawns on the road rather than beside it.
      for (let leg = 0; leg < 5; leg++) {
        const dir = leg % 2 === 0 ? 1 : -1;
        const s0 = leg * 150;
        for (let m = 0; m <= 300; m += 20) pts.push([dir > 0 ? -150 + m : 150 - m, s0]);
        for (let m = 20; m <= 130; m += 20) pts.push([dir > 0 ? 150 : -150, s0 + m]);
      }
      return [{ id: 1, tags: { ...mainTags(t, 'Hairpin Road'), maxspeed: '40' }, pts }];
    },
  },
  {
    id: 'village',
    label: 'VILLAGE STREET',
    note: 'A street with buildings down both sides: façades, openings and the wall marks, over ground flat enough that nothing else is in the way.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 0 },
    height: (e, s, t) => t.lift + 210 + (Math.sin(e / 400) * 2 + Math.cos(s / 380) * 2) * t.relief,
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => {
      const out: FixtureWay[] = [
        { id: 1, tags: mainTags(t, 'Fixture Street'), pts: run(0, 420, 0, 840) },
        { id: 2, tags: { highway: 'service', name: 'Back Lane', surface: 'asphalt' },
          pts: run(-260, 120, 90, 520) },
      ];
      // A terrace either side, set back from the carriageway, in a range of
      // heights — so the façade has floors to put windows on and blank gable
      // for the marks.
      const lv = Math.max(1, Math.round(t.levels));
      let id = 100;
      for (let i = 0; i < 14; i++) {
        const s = -300 + i * 46;
        for (const side of [-1, 1]) {
          const e0 = side * 13, w = 11 * side, d = 34;
          out.push({
            id: id++,
            tags: { building: 'residential', 'building:levels': String(lv + (i % 3)) },
            pts: [[e0, s], [e0 + w, s], [e0 + w, s + d], [e0, s + d], [e0, s]],
          });
        }
      }
      return out;
    },
  },
  {
    id: 'ridgeline',
    label: 'RIDGE AND FOREST',
    note: 'A road over a ridge through mixed cover: vegetation, sward and the treeline against terrain the road has to cut through rather than follow.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 68 },
    height: (e, s, t) => t.lift + 900
      + (Math.exp(-((e / 260) ** 2)) * 260 + Math.sin(s / 300) * 40 + Math.sin(e / 47) * 6) * t.relief,
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => [
      // Bearing 68° through the origin: the col is crossed, not skirted.
      { id: 1, tags: mainTags(t, 'Col Road'), pts: run(-603, 244, 68, 1400) },
      { id: 2, tags: { highway: 'track', name: 'Forest Track', surface: 'dirt', tracktype: 'grade3' },
        pts: run(0, 900, 0, 700) },
    ],
  },
  {
    id: 'structures',
    label: 'HOSTILE STRUCTURE CROSSINGS',
    note: 'A tagged arch bridge whose nominal pier rhythm lands on three roads, a bored tunnel under a live surface crossing, an explicit stream conduit under a cutting, and a tagged causeway that must not acquire a second conduit. The geometry is intentionally hostile: every decorative support has a tempting but illegal place to stand. Clearance counters should report refusals while all carriageways remain open.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 90 },
    height: (e, s, t) => {
      const base = t.lift + 320;
      // Valley under the bridge at e=0.
      const valley = -20 * Math.exp(-((s / 105) ** 2)) * Math.exp(-((e / 180) ** 2));
      // Ridge over the tunnel at e=420.
      const ridge = 24 * Math.exp(-((s / 82) ** 2)) * Math.exp(-(((e - 420) / 150) ** 2));
      // A shallow cutting over the conduit at e=-420.
      const bank = 5 * Math.exp(-((s / 65) ** 2)) * Math.exp(-(((e + 420) / 130) ** 2));
      return base + (valley + ridge + bank) * t.relief;
    },
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t): FixtureWay[] => [
      { id: 1, tags: { ...mainTags(t, 'Arch Test'), bridge: 'yes', layer: '1',
          'bridge:structure': 'arch', 'bridge:material': 'stone', start_date: '1887' },
        pts: through(0, 0, 0, 520) },
      // Three under-roads deliberately near a nominal support cadence.
      { id: 2, tags: { highway: 'secondary', name: 'Under Centre', surface: t.surface },
        pts: through(0, 0, 90, 620) },
      { id: 3, tags: { highway: 'residential', name: 'Under North', surface: t.surface },
        pts: through(0, -78, 90, 620) },
      { id: 4, tags: { highway: 'residential', name: 'Under South', surface: t.surface },
        pts: through(0, 78, 90, 620) },
      { id: 5, tags: { ...mainTags(t, 'Bored Test'), tunnel: 'yes', layer: '-1',
          'tunnel:type': 'bored', 'tunnel:lining': 'shotcrete' },
        pts: through(420, 0, 0, 560) },
      { id: 6, tags: { highway: 'tertiary', name: 'Tunnel Roof Road', surface: t.surface },
        pts: through(420, 0, 90, 480) },
      { id: 7, tags: { highway: 'secondary', name: 'Conduit Road', surface: t.surface },
        pts: through(-420, 0, 90, 520) },
      { id: 8, tags: { waterway: 'stream', name: 'Conduit Stream', width: '4',
          tunnel: 'culvert' },
        pts: through(-420, 0, 0, 480) },
      { id: 9, tags: { highway: 'secondary', name: 'Causeway Road', surface: t.surface,
          embankment: 'yes' },
        pts: through(650, 260, 90, 360) },
      { id: 10, tags: { waterway: 'stream', name: 'Causeway Stream', width: '4' },
        pts: through(650, 260, 0, 300) },
    ],
  },
  {
    id: 'sidehill',
    label: 'SIDE HILL AND BORE',
    note: 'Three roads the carve gets wrong in three different ways: a traverse whose bench sits below its mapped line, a ridge crossed untagged, and the same ridge crossed with tunnel=yes. Authored so the burial cases can be measured in seconds instead of the twelve minutes a real coastal spot takes to stream.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 0 },
    /**
     * ── GROUND SHAPED TO PRODUCE BURIAL, NOT TO LOOK LIKE ANYWHERE ──
     *
     * Three features, each isolated in its own band of `e` so a probe reading
     * one road cannot be answered by another. Every constant here was chosen
     * against the arithmetic of the code it exercises, and the comments say
     * which, because a fixture whose numbers are taste teaches nothing when it
     * fails.
     *
     * THE TRAVERSE (e ≈ −800). A cliff face at 110%, with a flat shelf 30m to
     * the seaward side sitting `SHELF` below the mapped centreline's ground.
     * This is Chapman's Peak's documented failure in miniature: the mapped
     * line and the DEM disagree laterally, the bench EXISTS in the raster a
     * couple of pixels over, and `benchFlat` finds it — so the deck solves to
     * the shelf and the centreline ground stands SHELF metres above the road.
     *
     * The face has to be steeper than about 92% for this fixture to do its
     * job, and that is not an aesthetic choice. `elevMin` samples half-width
     * plus 1.2m either side; for the width-minimum to read UNBURIED while the
     * centreline reads buried, the downhill drop across that reach must exceed
     * SHELF − 5.6. At hw+1.2 ≈ 3.7m for a 5m road that needs a slope past
     * (9 − 5.6) / 3.7 ≈ 0.92. At 110% the drop is 4.1m, the minimum reads 4.9m
     * of cover and the centreline 9m — one side of the threshold each, which
     * is exactly the disagreement 18 of the 22 unfixed segments at Fish Hoek
     * turned out to be.
     *
     * THE RIDGE (e ≈ 0 and e ≈ +800). A transverse ridge 22m high and about
     * 110m wide. The width matters more than the height: the grade line
     * averages the profile over ±8 stations twice, and at ~12m densified
     * spacing that is a ±100m window applied twice, so a ridge this narrow is
     * averaged away and the deck stays down in the valley while the ridge
     * stands over it. A broader hill would simply be climbed.
     */
    height: (e, s, t) => {
      const base = t.lift + 300;
      // Local to the traverse band, so the ridge roads stand on level ground.
      const face = Math.exp(-(((e + 800) / 300) ** 2));
      const G = 1.1 * t.slope;              // 110% — see the note above on why
      // The face itself, zero at the foot and climbing east.
      const ramp = (e + 860) * G;
      // THE BENCH THE SEARCH HAS TO FIND, and every number in it is forced.
      // It sits 12m WEST of the mapped line rather than 30m, because it has to
      // stand at a candidate the fan actually samples and be flat across three
      // of them: BENCH_OFFS is …−20, −12, −6, 0… so a bench ~20m wide centred
      // on −12 puts three consecutive candidates at the same height, which is
      // what `benchFlat` looks for — a minimum GRADIENT, not a minimum height.
      // It is SHELF below the mapped line's ground, and it must also stand
      // clear of the fan's lowest candidate by more than 8m or `benchFlat`
      // discards it as the sea: at ±45m and 110% the fan spans 99m, so a bench
      // 9m down from the middle sits ~40m above the bottom and survives.
      const SHELF = 9;
      const flat = Math.exp(-(((e + 812) / 11) ** 4));   // super-Gaussian: a flat top
      const benchY = (-812 + 860) * G - SHELF;
      const traverse = (ramp * (1 - flat) + benchY * flat) * face;
      const ridgeAt = Math.exp(-((e / 220) ** 2)) + Math.exp(-(((e - 800) / 220) ** 2));
      const ridge = Math.exp(-((s / 55) ** 2)) * 22 * t.relief * Math.min(1, ridgeAt);
      return base + traverse + ridge;
    },
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => [
      // Along the face, so the cross-section is the whole story and the
      // along-way profile is flat — no knoll for the run detector to find.
      { id: 1, tags: mainTags(t, 'Traverse Road'), pts: run(-800, -700, 180, 1400) },
      // Straight over the ridge, untagged: burial with no surveyed tunnel, so
      // the carve must stand down and NO bore may be drawn.
      { id: 2, tags: mainTags(t, 'Duck Road'), pts: run(0, -700, 180, 1400) },
      // The same crossing, tagged. This one has earned its tube.
      { id: 3, tags: { ...mainTags(t, 'Bore Road'), tunnel: 'yes', layer: '-1' },
        pts: run(800, -700, 180, 1400) },
    ],
  },
  {
    id: 'junctions',
    label: 'JUNCTIONS, THE AWKWARD ONES',
    note: 'Nine cases the tidy fixtures do not have — six nodes and three slip roads: equal classes crossing, a five-way star, an acute Y, a stagger, a link shorter than the crop reach, and six arms of mixed class; then an on/off slip pair, a shallow merge of equals, and a slip that forks. A merge is not an angle at a point — it is two carriageways whose gore narrows to nothing — which is why the node cases cannot stand in for it. Every node stands on its own landform — side slope, crown, cutting, embankment, grade change, bowl, hillside bench, valley and spur — so each mouth has a real cut face and a real batter rather than a table. RELIEF 0 flattens it back when the geometry alone is the question.',
    spawn: { lat: HOME.lat, lon: HOME.lon, heading: 0 },
    /**
     * DELIBERATELY ALMOST FLAT, with the cross-fall on the SLOPE dial.
     *
     * At slope 0 the only variable is the junction geometry, so anything wrong
     * in the picture is the crop, the bellmouth or the gore and nothing else.
     * Turn slope up and the same six nodes acquire a cross-fall, which is what
     * puts a batter on the low side of every mouth — the second half of the
     * question, on the same ground, without a second fixture to keep in step.
     *
     * The gentle undulation is not decoration: a dead-flat world lets a wrong
     * deck height hide, because everything is at the same height anyway.
     */
    /**
     * ── NINE LANDFORMS, ONE PER NODE ──
     *
     * A junction on flat ground exercises the crop and nothing else. What
     * actually goes wrong in the world is the CUT FACE on the arm that climbs
     * and the BATTER on the arm that falls, and neither exists if the ground is
     * a table. So every case stands on its own landform, chosen for what it
     * makes the mouth do, and `near()` keeps each one local to its node.
     *
     * The amounts are bounded on purpose. A bank steeper than about 6m over the
     * road's own width would cross the burial threshold (TUNNEL_H + 0.6) and
     * the stretch would be exempted from the carve as a tunnel — which is
     * correct behaviour and completely useless here, because then there is no
     * cutting to look at. These sit under that deliberately; `sidehill` is the
     * fixture for burial.
     *
     * relief 0 flattens all of it back to a table, so the geometry can still be
     * isolated when that is the question. slope multiplies the cross-falls.
     */
    height: (e, s, t) => {
      const W = 420;
      const R = t.relief, S = t.slope;
      let y = t.lift + 300;
      // Gentle everywhere, so nothing sits on a perfectly level plane — a wrong
      // deck height hides on ground that has no height of its own.
      y += (Math.sin(e / 240) * 2.5 + Math.cos(s / 205) * 2) * R;
      // 1 SIDE SLOPE. One arm traverses it, the other climbs it: a cut face on
      // the uphill kerb and a batter on the downhill one, at the same mouth.
      y += near(e, s, 0, 0) * (e - 0) * 0.22 * R * S;
      // 2 CROWN. Five arms all falling away from the node — batter on every
      // one of them, and no uphill side anywhere to hide a mistake.
      y += near(e, s, W, 0) * 16 * R;
      // 3 CUTTING. A bank across the Y's throat that the roads cut through.
      // 4.5m: a cutting, deliberately short of the burial threshold.
      y += near(e, s, 2 * W, 0) * Math.exp(-(((s - 0) / 55) ** 2)) * 4.5 * R;
      // 4 EMBANKMENT. A hollow the through road crosses on fill, so both
      // staggered mouths sit on a bank with nothing under them.
      y -= near(e, s, 0, W) * Math.exp(-(((s - W) / 60) ** 2)) * 9 * R;
      // 5 GRADE CHANGE. A step across the short link, so its two nodes sit at
      // different heights and the link itself is the ramp between them.
      y += near(e, s, W, W) * Math.tanh((e - W) / 45) * 5 * R * S;
      // 6 BOWL. Six arms climbing out in six directions.
      y += near(e, s, 2 * W, W) * (Math.hypot(e - 2 * W, s - W) / 90 - 1) * 7 * R;
      // 7 HILLSIDE TRAVERSE. The slip road runs on a bench below the motorway,
      // so the gore between them is cut on one side and filled on the other —
      // the thing a flat merge cannot show at all.
      y += near(e, s, 0, 2 * W, 300) * (e - 0) * 0.30 * R * S;
      // 8 VALLEY. Both carriageways of the merge on fill, converging.
      y -= near(e, s, W, 2 * W, 300) * Math.exp(-(((e - W) / 80) ** 2)) * 11 * R;
      // 9 SPUR. Ground falling away either side of the fork, so the gore point
      // between the diverging kerbs has air under it.
      y -= near(e, s, 2 * W, 2 * W, 300) * (Math.abs(e - 2 * W) / 70) * 6 * R;
      return y;
    },
    cover(e, s, t) { return coverFor(e, s, t, this.height(e, s, t)); },
    ways: (t) => {
      const W = 420;                       // between node centres
      const w: FixtureWay[] = [];
      let id = 0;
      const add = (name: string, hw: string, pts: Array<[number, number]>): void => {
        w.push({ id: ++id, tags: { ...mainTags(t, name), highway: hw }, pts });
      };

      // ── 1 (0,0) EQUAL CLASSES CROSSING ──
      // The crop runs down the hierarchy, and a tie defers to whichever built
      // first — "arbitrary but consistent". Two identical secondaries crossing
      // is the case that rule was written for; this is where it gets looked at.
      add('Equal North', t.roadClass, through(0, 0, 0, 300));
      add('Equal East', t.roadClass, through(0, 0, 90, 300));

      // ── 2 (W,0) FIVE-WAY STAR ──
      // Every arm TERMINATES at the node — none passes through — so no arm's
      // carriageway covers the middle. The crop finds ONE host per end, so four
      // of these defer to one arm and the gore between the other four is
      // nobody's. If a junction has no mesh in its centre anywhere, it is here.
      for (let k = 0; k < 5; k++) {
        add(`Star ${k + 1}`, t.roadClass, run(W, 0, k * 72, 150));
      }

      // ── 3 (2W,0) ACUTE Y ──
      // Two arms 25 degrees apart. The crop asks whether an end stands ON the
      // host's tarmac and gives up past 1m out (`tooFarOut`); at a shallow
      // angle the kerbs cross far from the node, so the end that should crop
      // can be metres away from the arm it is joining.
      add('Y Stem', t.roadClass, run(2 * W, 0, 180, 200));
      add('Y Left', t.roadClass, run(2 * W, 0, 12, 200));
      add('Y Right', t.roadClass, run(2 * W, 0, 37, 200));

      // ── 4 (0,W) STAGGERED TEES ──
      // Two side roads meeting a through road 18m apart on opposite sides —
      // closer together than a mouth is wide, so the two bellmouths overlap on
      // the host and each crop is cutting into ground the other just claimed.
      add('Stagger Main', t.roadClass, through(0, W, 90, 320));
      add('Stagger North', 'residential', run(-30, W, 0, 140));
      add('Stagger South', 'residential', run(-12, W, 180, 140));

      // ── 5 (W,W) A LINK SHORTER THAN THE CROP ──
      // 22m between two nodes, and both ends of the link crop. If the two crops
      // together eat more than its length there is nothing left to draw, which
      // is a hole exactly where two junctions are closest together.
      add('Link Main A', t.roadClass, through(W - 60, W, 0, 260));
      add('Link Main B', t.roadClass, through(W + 60, W, 0, 260));
      add('Short Link', 'unclassified', run(W - 60, W, 90, 120));

      // ── 6 (2W,W) SIX ARMS, MIXED CLASS ──
      // A trunk through, a primary through at 40 degrees, and four minor arms
      // terminating between them. Widths from 12m to 4.5m at one node: whoever
      // is chosen as host, four of the others are answering to a plane fitted
      // from a road of a very different size.
      add('Mixed Trunk', 'trunk', through(2 * W, W, 0, 320));
      add('Mixed Primary', 'primary', through(2 * W, W, 40, 320));
      add('Mixed Tertiary', 'tertiary', run(2 * W, W, 105, 150));
      add('Mixed Residential', 'residential', run(2 * W, W, 160, 150));
      add('Mixed Service', 'service', run(2 * W, W, 250, 150));
      add('Mixed Track', 'unclassified', run(2 * W, W, 305, 150));

      // ── 7 (0,2W) ON-SLIP AND OFF-SLIP ──
      // The case a node fixture cannot express. A merge is not an angle at a
      // point — it is two carriageways running side by side whose gore narrows
      // to nothing over a hundred metres. The crop asks where this way's kerb
      // crosses the host's kerb line, and along a taper that crossing is both
      // far from the node and very sensitive to a metre of geometry. The
      // off-slip is the mirror, diverging, where the gore OPENS instead.
      add('Slip Motorway', 'motorway', through(0, 2 * W, 0, 620));
      w.push({ id: ++id, tags: { highway: 'motorway_link', name: 'On Slip', surface: t.surface },
        pts: slip(0, 2 * W + 240, 0, 26, 90, 130) });
      w.push({ id: ++id, tags: { highway: 'motorway_link', name: 'Off Slip', surface: t.surface },
        pts: slip(0, 2 * W - 60, 180, 26, 90, 130) });

      // ── 8 (W,2W) A SHALLOW MERGE OF EQUALS ──
      // Two trunks converging at about six degrees, neither outranking the
      // other. The tie rule defers to whichever built first, and here that
      // choice is made along a hundred metres of near-parallel kerb rather
      // than at a node — so if it is going to look arbitrary, it looks
      // arbitrary for a long way.
      add('Merge Main', 'trunk', through(W, 2 * W, 0, 520));
      w.push({ id: ++id, tags: { highway: 'trunk', name: 'Merge Other', surface: t.surface },
        pts: slip(W, 2 * W + 200, 0, 30, 60, 170) });

      // ── 9 (2W,2W) A SLIP THAT FORKS ──
      // One link splitting into two, so the gore point sits between two
      // DIVERGING kerbs with nothing to host it — the shape at the top of
      // every motorway exit, and the one most likely to leave a hole where
      // the two mouths should meet.
      add('Fork Trunk', 'trunk', through(2 * W, 2 * W, 0, 480));
      w.push({ id: ++id, tags: { highway: 'trunk_link', name: 'Fork Stem', surface: t.surface },
        pts: slip(2 * W, 2 * W - 40, 180, 24, 70, 120) });
      w.push({ id: ++id, tags: { highway: 'trunk_link', name: 'Fork Branch', surface: t.surface },
        pts: run(2 * W + 24, 2 * W + 150, 150, 170) });
      return w;
    },
  },
];

/**
 * CAPTURED PLACES, appended so they sort after the authored ones in the lab.
 *
 * SIZE. Each capture is a couple of hundred KB of JSON in the bundle, which is
 * fine for one and would not be for twenty. When there are enough to matter the
 * answer is `static/` — it ships verbatim and the cell can serve it, which only
 * became true when binary assets did — and a fetch at boot rather than an
 * import. Written down here so the next person does not discover the ceiling by
 * hitting it.
 */
/**
 * ── THE CARD IS BUNDLED; THE WORLD IS FETCHED ──
 *
 * These were `import world-bixby.json` and so on, which esbuild inlines into
 * app.js. Measured when the sixth capture landed: the live bundle is 1.51MB and
 * the captures came to 2.37MB, so bundling them would have taken app.js to
 * ~3.9MB — sixty per cent of it captured fixtures — on a game whose first tenet
 * is mobile first. Every player would download Cape Town and Suresnes to drive
 * in Scotland.
 *
 * So what stays in the bundle is the CARD: an id, a label, a note and a
 * heading, which is what /lab/world needs to list a fixture and build its link.
 * A few hundred bytes each. The world itself lives in `static/fixtures/` — which
 * ships verbatim now that binary assets work — and is fetched only when someone
 * actually opens that fixture.
 */
export interface CaptureCard {
  id: string;
  label: string;
  note: string;
  /** The file under `static/fixtures/`. */
  file: string;
  heading: number;
  /** THE ECOREGION AT THE CAPTURE'S OWN COORDINATES, so the guild rules can be
   *  exercised on a world that needs no network and settles in seconds. Looked
   *  up once through `~/eco/v1/` at the lat/lon named in each note below;
   *  `devtools/capture-world.mjs` prints the line for a new capture. A box of
   *  700m to 1.4km sits inside one ecoregion, so a point answer for the whole
   *  fixture is not an approximation worth apologising for. */
  eco?: { id: number; biome: number; name: string; realm: string };
}

export const CAPTURE_INDEX: readonly CaptureCard[] = [
  {
    id: 'at-bixby', file: 'world-bixby.json', heading: 100,
    eco: { id: 425, biome: 12, name: 'Santa Lucia Montane Chaparral & Woodlands', realm: 'Nearctic' },
    label: 'BIG SUR — COAST ROAD',
    note: 'Captured from the live world at 36.3753,-121.8974: the Highway 1 approach above Bixby, where three separate OSM ways all called Coast Road meet at near-equal classes on a cliff the DEM resolves at 8m. Reported twice from the seat. NOTE its r is 700m and its road runs well past that, so most of what it draws stands on ground extrapolated from the edge of the evidence — re-capture it wider before quoting a number off it.',
  },
  {
    id: 'at-carmel-a', file: 'world-carmel-a.json', heading: 100,
    eco: { id: 425, biome: 12, name: 'Santa Lucia Montane Chaparral & Woodlands', realm: 'Nearctic' },
    label: 'CARMEL HIGHLANDS — SOUTH',
    note: 'Captured at 36.5665,-121.9130. A dense hillside street network rather than one cliff road, which is a different kind of hard: many short ways of near-equal class meeting each other on a slope.',
  },
  {
    id: 'at-carmel-b', file: 'world-carmel-b.json', heading: 100,
    eco: { id: 425, biome: 12, name: 'Santa Lucia Montane Chaparral & Woodlands', realm: 'Nearctic' },
    label: 'CARMEL HIGHLANDS — NORTH',
    note: 'Captured at 36.5753,-121.9128, a kilometre north of the other. More road and fewer buildings, so the junctions are less obscured while the terrain is the same.',
  },
  {
    id: 'at-campsbay', file: 'world-campsbay.json', heading: 122,
    eco: { id: 89, biome: 12, name: 'Fynbos shrubland', realm: 'Afrotropic' },
    label: 'CAMPS BAY — THE TWELVE APOSTLES',
    note: 'Reported from the seat at -33.94533,18.38296 heading 122. The western flank of Table Mountain: 325 METRES of relief across a 1.4km box and 314 highways of every class on it. Victoria Road runs the contour while Camps Bay Drive, Geneva Drive and Kloof Road climb across it, so nearly every junction is a joiner meeting a host at a different height on a cross-slope. Settled, it reports 38 pairs of overlapping carriageway and node steps up to 2.18m — and it takes about four minutes to finish building, so do not read anything off it early.',
  },
  {
    id: 'at-paris-west', file: 'world-paris-west.json', heading: 203,
    eco: { id: 664, biome: 4, name: 'European Atlantic mixed forests', realm: 'Palearctic' },
    label: 'SURESNES — THE BOULEVARDS',
    note: 'Reported from the seat at 48.86919,2.21523 heading 203. A dense European suburb rather than a hillside: 1,453 highways of which 762 are footway and 69 are steps, so nearly every carriageway is flanked by a pavement solving its own profile a couple of metres away — the geometry that produces a lengthwise seam rather than a bad junction. 29 ways carry three or four lanes. One vector tile of the twenty (16/33171/22541) exceeds the cell Overpass budget and has never built; that corner has no roads in it.',
  },
  {
    id: 'at-paris-south', file: 'world-paris-south.json', heading: 281,
    eco: { id: 664, biome: 4, name: 'European Atlantic mixed forests', realm: 'Palearctic' },
    label: 'VÉLIZY — THE A 86 INTERCHANGE',
    note: 'Reported from the seat at 48.77736,2.22332 heading 281. The A 86 / N 118 interchange: 1,078 highways, 49 trunk_link and 20 motorway_link slip roads, lanes tags up to 5. THE LEVELS CASE. OSM says exactly where the flyovers are — 14 ways carry layer=1 or 2 with bridge=yes, 13 carry layer=-1 — and the game keeps the layer tag and never reads it: a tagged bridge is a chord between its two portals, not a deck above the road it crosses. Counted offline: 44 genuine grade-separated crossings in the box, 10 of them with a station of the flyover inside the 3m junction-pin radius of the road beneath, where the planner will weld the two decks together. Flat (44m of relief), so nothing here is terrain.',
  },
  {
    id: 'at-senqu-top', file: 'world-senqu-top.json', heading: 4,
    eco: { id: 41, biome: 7, name: 'Drakensberg grasslands', realm: 'Afrotropic' },
    label: 'SENQU — FROM ABOVE',
    note: 'Asked for from the seat at -30.70685,27.75090 heading 4, in the top-down chart at 0.8 zoom: the broad Senqu (WorldCover class 80 in the box) and its banks, for judging the shoreline pass from above and the chart’s own water against it.',
  },
  {
    id: 'at-senqu-ford', file: 'world-senqu-ford.json', heading: 66,
    eco: { id: 41, biome: 7, name: 'Drakensberg grasslands', realm: 'Afrotropic' },
    label: 'SENQU — THE CROSSING',
    note: 'Reported from the seat at -30.72068,27.75659 heading 66: the shallows are a colour that does not match the bank around them and the water still meets the ground on a hard edge, and driving the road across the river raises no splash and no wash. Six highways and the Senqu in a 1.4km box of Drakensberg grassland at 1,800m.',
  },
  {
    id: 'at-simonstown', file: 'world-simonstown.json', heading: 246,
    eco: { id: 89, biome: 12, name: 'Fynbos shrubland', realm: 'Afrotropic' },
    label: 'SIMON\'S TOWN — THE JOINS',
    note: 'Reported from the seat at -34.19511,18.44192 heading 246: at the junctions the batter stops short of the join and leaves a gap, the arms do not meet on one closed plane, the batter is a picture the truck drives into rather than ground it stands on, and a mis-joined arm can put a guard rail across the carriageway. A steep peninsula suburb — 181 highways over 437m of relief in a 1.4km box — so nearly every junction is a joiner meeting a host on a cross-slope, which is where all four live.',
  },
  {
    id: 'at-glencairn', file: 'world-glencairn.json', heading: 20,
    eco: { id: 89, biome: 12, name: 'Fynbos shrubland', realm: 'Afrotropic' },
    label: 'GLENCAIRN — THE SOUTHERN LINE',
    note: 'Reported from the seat at -34.15905,18.43142: the railway ribbon is not railway-like. THE FIRST FIXTURE IN THIS REPO THAT CONTAINS A RAILWAY AT ALL — `railway` was missing from capture-world\'s own KEEP_TAGS as well as the game\'s, so all nine captures before this one held ZERO railway ways, Simon\'s Town included, and nothing deterministic could see one. Four ways of the PRASA Southern Line in a 700m box between the mountain and the beach, all `railway=rail usage=main gauge=1067 electrified=contact_line passenger_lines=1`, one of them a `bridge=yes layer=1` — so the gauge, the electrification and the bridge case are all in one capture. 103 highways beside them, and the M4 runs parallel for the whole length, which is the comparison a railway look has to survive.',
  },
  {
    id: 'at-yosemite', file: 'world-yosemite.json', heading: 90,
    eco: { id: 366, biome: 5, name: 'Sierra Nevada forests', realm: 'Nearctic' },
    label: 'YOSEMITE — THE VALLEY FLOOR',
    note: 'Captured at 37.73606,-119.63732 r=1400m because a device dump named hydroBuild at 94.6 ms a build there — 30% of every slow frame — and nothing deterministic in this repo held the Merced. Cover classes 10/30/60/80 in the box, so the valley carries WorldCover water as well as the OSM waterway, which is the pair the flowing-area path is expensive on; 1,202-2,417 m of granite around it. The spot is the one the substrate work already measures at, so a hydro number and a substrate number here are about the same ground.',
  },
  {
    id: 'at-umgeni', file: 'world-umgeni.json', heading: 0,
    label: 'uMNGENI MOUTH — TWO BRIDGES',
    note: 'Probed from the seat at -29.81016,31.03845. Two tagged bridges 580 m apart over the uMngeni a kilometre from the Indian Ocean: the M4 Ellis Brown Viaduct (two 471 m carriageways, bridge:name, motorway) and the Athlone Bridge upriver (412 m on TWO POINTS, bridge:name, secondary). Neither carries bridge:structure and neither is in the landmark store, so both take the generic recipe; neither publisher carries their decks, so the chord is the only thing that can hold them over the water. THE FIXTURE THE BRIDGE CHORD REGRESSION WAS FOUND ON. No terrestrial ecoregion — the box is mostly estuary and sea, so `eco` is deliberately absent and the guild falls back to the climate path.',
  },
  {
    id: 'at-forth', file: 'world-forth.json', heading: 0,
    label: 'THE FORTH — THREE BRIDGES, THREE CLAIMS',
    note: 'Asked for from the seat at 56.00636,-3.39091 as the landmark test case, and it is the best one there is: three famous bridges in a row over the Firth of Forth, each reaching the painter by a DIFFERENT path. The 1890 Forth Bridge is four `rail` ways named for the East Coast (Northern) Line with no bridge:name at all, so its entry can only claim it BY POSITION; the Queensferry Crossing carries its own `bridge:structure=cable-stayed` and needs no entry; the Forth Road Bridge is named exactly that, carries no structure tag and matches no entry, so it is claimed by nobody. They also stand ~250 m apart at their nearest, which is inside BRIDGE_ON_R — so this is the fixture where a positional claim can cross from one bridge to the next.',
  },
];

/**
 * THE PAYLOAD, SYNCHRONOUSLY, AND ON PURPOSE.
 *
 * `main.ts` resolves its fixture at module scope — `const FIXTURE = ...` on line
 * 213, with the projection, the extent and the streamed tile sets all derived
 * from it immediately — so the data has to be in hand before the module body
 * runs. Three ways to do that and only one is small:
 *
 *   · top-level await. The platform bundles every cell's client at
 *     `target: 'es2020'` (services/cells/transpile.ts) and top-level await is
 *     ES2022, so esbuild refuses it. Raising that target is a tier-1 platform
 *     change on behalf of a dev-only lab path.
 *   · make FIXTURE a mutable filled by an async pre-boot step. That means every
 *     module-level constant derived from it becomes lazy, in a 36,000-line file
 *     wired to module state. A wide refactor for a fixture loader.
 *   · this.
 *
 * Synchronous XHR blocks the main thread, which is exactly why it is normally
 * wrong and exactly why it is right here: nothing else has started, there is no
 * frame to drop, and this code path CANNOT run for a player — it is reached only
 * when the URL carries `?fixture=at-…`. The world it loads then takes minutes to
 * build; a few hundred milliseconds of blocked boot is not the cost anyone will
 * notice. If this ever needs to be async, do the pre-boot-fetch version rather
 * than raising the platform's target.
 */
function loadCapture(card: CaptureCard): CapturedWorld | null {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', `/fixtures/${card.file}`, false);
    x.send();
    if (x.status !== 200) throw new Error(`HTTP ${x.status}`);
    return JSON.parse(x.responseText) as CapturedWorld;
  } catch (err) {
    // Loud, because the alternative is a fixture that silently becomes an empty
    // planet and reads as "the renderer built nothing".
    console.error(`fixture ${card.id}: could not load /fixtures/${card.file}`, err);
    return null;
  }
}

export const fixtureById = (id: string | null | undefined): WorldFixture | null => {
  if (!id) return null;
  const authored = WORLD_FIXTURES.find((f) => f.id === id);
  if (authored) return authored;
  const card = CAPTURE_INDEX.find((c) => c.id === id);
  if (!card) return null;
  const cap = loadCapture(card);
  return cap ? captured(cap, card.label, card.note, card.heading, card.eco) : null;
};

/**
 * ── THE TUNE, AS A LINK ──
 *
 * `relief:1.4,slope:0,cover:forest` — short enough to read in an address bar
 * and to paste into a message, and only the keys that differ from the default
 * are written, so a link says what was changed rather than restating the whole
 * table. Decoding is deliberately forgiving: an unknown key or an unparseable
 * number falls back to the default rather than failing the whole world.
 */
export function encodeTune(t: FixtureTune): string {
  const out: string[] = [];
  for (const k of Object.keys(DEFAULT_FIXTURE_TUNE) as Array<keyof FixtureTune>) {
    if (t[k] !== DEFAULT_FIXTURE_TUNE[k]) out.push(`${k}:${t[k]}`);
  }
  return out.join(',');
}

export function decodeTune(s: string | null | undefined): FixtureTune {
  const t: FixtureTune = { ...DEFAULT_FIXTURE_TUNE };
  for (const part of (s ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim() as keyof FixtureTune;
    const v = part.slice(i + 1).trim();
    if (!(k in DEFAULT_FIXTURE_TUNE)) continue;
    if (typeof DEFAULT_FIXTURE_TUNE[k] === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) (t[k] as number) = n;
    } else if (v) (t[k] as string) = v;
  }
  return t;
}
