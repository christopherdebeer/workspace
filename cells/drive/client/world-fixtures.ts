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
}

/** A line of points along a bearing, so a fixture reads as intent rather than
 *  as a list of coordinates. */
function run(e0: number, s0: number, deg: number, len: number, step = 25): Array<[number, number]> {
  const r = deg * Math.PI / 180;
  const out: Array<[number, number]> = [];
  for (let m = 0; m <= len; m += step) out.push([e0 + Math.sin(r) * m, s0 - Math.cos(r) * m]);
  return out;
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
];

export const fixtureById = (id: string | null | undefined): WorldFixture | null =>
  (id ? WORLD_FIXTURES.find((f) => f.id === id) ?? null : null);

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
