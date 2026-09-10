/**
 * ── EVERY SWITCH THIS GAME HAS, DECLARED IN ONE PLACE ──
 *
 * Fifty-one query-string switches had grown up one at a time, each read where
 * it was needed with its own `new URLSearchParams(location.search).get(…)`.
 * Nothing listed them, so nothing could: a survey of main.ts found ten that
 * appear in no note, no test and no devtool — alive, shipped, and forgotten.
 * A switch nobody remembers is worse than no switch, because the legacy branch
 * it guards is kept alive by a flag that will never be turned on again.
 *
 * So the table is the source of truth and the READER IS TYPED: `qs` takes a
 * `SwitchId`, and an id that is not declared here does not compile. Adding a
 * switch means adding a row, and a row carries what it does — which is what
 * SETTINGS renders, so the list on the glass cannot drift from the list in the
 * code.
 *
 * WHAT THE MARKS MEAN, and `legacy` is the one that earns its keep:
 *
 *   legacy   the non-default value keeps a SUPERSEDED implementation alive.
 *            Every one of these is a retirement candidate: turning the switch
 *            off for good deletes code. They are listed as such so the
 *            question "what can we retire" is a filter and not an archaeology
 *            expedition.
 *   bench    a measurement or harness lever, not a thing a player would want.
 *   look     art direction: it changes what the world looks like on purpose.
 *   world    what to load and where — the address of the session.
 *   owned    the DRIVE rewrites this key as you move. Everything not marked
 *            `owned` is preserved verbatim on a rewrite — a rule that exists
 *            because rebuilding the query from scratch once deleted every
 *            art-direction and instrumentation flag about a second after boot,
 *            found while measuring species mixes with a world pinned to ARID
 *            that reported temperate ten seconds later.
 *
 * The table is PURE and the readers take the search string, so a test can ask
 * what a URL means without a browser.
 */

export type SwitchKind = 'toggle' | 'number' | 'choice' | 'text';
export type SwitchMark = 'legacy' | 'bench' | 'look' | 'world' | 'owned';

export interface SwitchDef {
  readonly id: string;
  readonly kind: SwitchKind;
  /** One line, in the imperative: what SETTING it does, not what it is. */
  readonly note: string;
  /** What the world does with the switch ABSENT — shown beside it. */
  readonly fallback: string;
  readonly marks: readonly SwitchMark[];
}

export const SWITCHES = [
  // ── where and what: the address of a session ──
  { id: 'lat', kind: 'number', marks: ['world', 'owned'], fallback: 'El Capitan',
    note: 'spawn latitude; needs lon' },
  { id: 'lon', kind: 'number', marks: ['world', 'owned'], fallback: 'El Capitan',
    note: 'spawn longitude; needs lat' },
  { id: 'h', kind: 'number', marks: ['world', 'owned'], fallback: '145° at the default spawn',
    note: 'spawn heading in degrees' },
  { id: 'z', kind: 'number', marks: ['world', 'owned'], fallback: 'the remembered zoom',
    note: 'chart zoom at boot' },
  { id: 'cam', kind: 'choice', marks: ['world', 'owned'], fallback: 'the remembered view',
    note: 'open in chase, cab or top' },
  { id: 'random', kind: 'toggle', marks: ['world'], fallback: 'off',
    note: 'spawn somewhere on Earth that has roads' },
  { id: 'fixture', kind: 'choice', marks: ['world', 'bench'], fallback: 'the real planet',
    note: 'boot an authored or captured world instead of streaming one' },
  { id: 'ft', kind: 'text', marks: ['world', 'bench'], fallback: 'the fixture’s own tune',
    note: 'a fixture’s packed dial values' },
  { id: 'm', kind: 'text', marks: ['world', 'owned'], fallback: 'no task',
    note: 'the mission a shared link carries' },
  { id: 'run', kind: 'text', marks: ['world', 'owned'], fallback: 'no run',
    note: 'a banked run to hop to and roll, as user/id' },
  { id: 'line', kind: 'toggle', marks: ['world', 'owned'], fallback: 'off',
    note: 'open on the pipeline; also puts the clock on CYCLE' },
  { id: 'real', kind: 'toggle', marks: ['world'], fallback: 'off',
    note: 'arm real GPS drive, taken up at the splash gesture' },
  { id: 'probe', kind: 'text', marks: ['bench'], fallback: 'no channel',
    note: 'listen as a named probe channel for a driving harness' },
  // FOUND BY BUILDING THIS TABLE, which is the argument for it: these two are
  // read through a variable rather than a literal, so the survey's grep for
  // `.get('…')` never saw them and neither did anything else.
  { id: 'reelidle', kind: 'number', marks: ['bench'], fallback: '90 s',
    note: 'seconds of idle before the attract reel starts' },
  { id: 'reeldwell', kind: 'number', marks: ['bench'], fallback: '90 s',
    note: 'seconds the reel dwells on each postcard' },

  // ── the clock and the weather ──
  { id: 'time', kind: 'choice', marks: ['look'], fallback: 'the remembered clock',
    note: 'clock mode by name (NOON, DUSK, CYCLE…)' },
  { id: 't', kind: 'choice', marks: ['look'], fallback: 'the remembered clock',
    note: 'the same as time, kept because links carry it' },
  { id: 'sunalt', kind: 'number', marks: ['look', 'bench'], fallback: 'the clock’s own sun',
    note: 'pin the sun’s altitude in degrees, −20..89' },
  { id: 'wx', kind: 'choice', marks: ['look', 'bench'], fallback: 'the live weather',
    note: 'pin the sky: clear, haze, rain or storm' },
  { id: 'fog', kind: 'number', marks: ['look', 'bench'], fallback: 'the live mist',
    note: 'pin the regional mist, 0..1' },
  { id: 'wet', kind: 'number', marks: ['look', 'bench'], fallback: 'the live ground',
    note: 'flood the ground so a puddle shot need not wait out a storm, 0..1' },
  { id: 'wind', kind: 'number', marks: ['look', 'bench'], fallback: 'the live wind',
    note: 'force the wind in km/h — nothing wind-driven can be judged on a calm day' },
  { id: 'winddir', kind: 'number', marks: ['look', 'bench'], fallback: 'the live bearing',
    note: 'force the wind’s bearing in degrees' },
  { id: 'fixdt', kind: 'number', marks: ['bench'], fallback: 'the real frame clock',
    note: 'pin the frame step in seconds so a capture is reproducible' },

  // ── the look ──
  { id: 'biome', kind: 'choice', marks: ['look'], fallback: 'the climate field',
    note: 'force one biome’s palette over the whole world' },
  { id: 'mblur', kind: 'number', marks: ['look'], fallback: 'the remembered dial',
    note: 'the motion-blur dial, so a screenshot can state its own conditions' },
  { id: 'near', kind: 'number', marks: ['bench'], fallback: 'derived per frame',
    note: 'lock the near plane — see the note above it before believing this helps' },
  { id: 'nscale', kind: 'number', marks: ['look', 'bench'], fallback: '0.35',
    note: 'the terrain normal map’s strength' },
  { id: 'wash', kind: 'number', marks: ['look'], fallback: '0.1',
    note: 'how far a cut face washes toward the verge' },
  { id: 'slip', kind: 'number', marks: ['look'], fallback: '1',
    note: 'erosion paint strength on a cut face' },

  // ── how hard to work ──
  { id: 'shadows', kind: 'toggle', marks: [], fallback: 'on',
    note: 'the shadow pass — a phone that cannot afford it should be able to say so' },
  { id: 'aniso', kind: 'number', marks: ['bench'], fallback: 'min(8, the device’s max)',
    note: 'cap anisotropic filtering on the canvas textures' },
  { id: 'treetris', kind: 'number', marks: ['bench'], fallback: '2.4M',
    note: 'the baked-tree triangle budget, unsaved and exact' },
  { id: 'treerange', kind: 'number', marks: ['bench'], fallback: '700 m',
    note: 'tree draw range, unsaved and exact' },
  { id: 'treepop', kind: 'number', marks: ['bench'], fallback: '1×',
    note: 'tree population multiplier, unsaved and exact' },
  { id: 'refr', kind: 'number', marks: ['bench'], fallback: '1100 m',
    note: 'how far from the truck the terrain takes its road corridor' },

  // ── the A/Bs that keep an older path alive ──
  { id: 'wetdebug', kind: 'toggle', marks: ['legacy'], fallback: 'off',
    note: 'wetdebug=1 paints every input to the water decision on the ground around the truck — drawn water, water under the ground, the waterline band, channels, ocean, cover, decks over water' },
  { id: 'eruda', kind: 'toggle', marks: ['bench'], fallback: 'off',
    note: 'eruda=1 loads the eruda console onto the page at boot — console, network, elements and storage in a panel — and is the ONE load the cell serves with eval allowed, so its prompt runs code; SETTINGS → STORAGE → DEV CONSOLE loads it read-only on an ordinary page, RELOAD WITH CONSOLE reloads with this set' },
  { id: 'fling', kind: 'toggle', marks: ['look'], fallback: 'on',
    note: 'fling=0 stops a lifted finger throwing the planet; on, a drag on the globe carries its speed past the lift and coasts to rest (the gesture-rate tests run with it off, and __fling(true) turns it on for the throw test)' },
  { id: 'widedither', kind: 'toggle', marks: ['look'], fallback: 'on',
    note: 'widedither=0 keeps the PATTERN dial\'s threshold on the wide chart; on, the tiled weave gives way to interleaved gradient noise past the fine ring (60m a pixel), where a 4x4 tile spread over a smooth ramp reads as blobs' },
  { id: 'shore', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'shore=0 leaves the water its frame colour and the banks their hillside grass — the A/B for the shoreline pass' },
  { id: 'ez', kind: 'toggle', marks: ['legacy'], fallback: 'skeletons',
    note: 'ez=0 draws the 20-triangle archetypes instead of the baked skeletons' },
  { id: 'ezstand', kind: 'toggle', marks: ['legacy'], fallback: 'per stand',
    note: 'ezstand=0 picks a silhouette per POSITION — what every wood looked like before' },
  { id: 'guild', kind: 'toggle', marks: ['legacy'], fallback: 'the guild',
    note: 'guild=0 chooses plants by the five-biome climate path alone' },
  { id: 'refine', kind: 'toggle', marks: ['legacy'], fallback: 'the corridor',
    note: 'refine=0 builds the old lattice and carves it' },
  { id: 'tworker', kind: 'toggle', marks: ['legacy'], fallback: 'the worker',
    note: 'tworker=0 builds every terrain tile on the main thread' },
  { id: 'sward', kind: 'choice', marks: ['legacy'], fallback: 'the GPU field',
    note: 'sward=cpu goes back to the old CPU lattice' },
  { id: 'lumasync', kind: 'toggle', marks: ['legacy'], fallback: 'asynchronous',
    note: 'lumasync=1 reads the luma map synchronously, as it used to' },
  { id: 'hydroskip', kind: 'toggle', marks: ['legacy'], fallback: 'skip',
    note: 'hydroskip=0 rebuilds a water tile even when nothing it reads has moved' },
  { id: 'vegseed', kind: 'toggle', marks: ['legacy'], fallback: 'budgeted',
    note: 'vegseed=0 seeds a whole ring in one call, as it did at 95 ms' },
  { id: 'relief', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'relief=0 drops the carve’s relief pass' },
  { id: 'shfade', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'shfade=0 drops the shadow’s distance fade' },
  { id: 'shsnap', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'shsnap=0 stops the shadow map snapping to its own texels' },
  { id: 'shrub', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'shrub=0 removes the sward’s knee-high layer' },
  { id: 'treewind', kind: 'number', marks: ['legacy'], fallback: '0.085',
    note: 'treewind=0 holds every tree rigid in a gale' },
  { id: 'ezbark', kind: 'number', marks: ['legacy'], fallback: '0.55',
    note: 'ezbark=0 returns the wood to the flat prism it was' },
  { id: 'ezedge', kind: 'number', marks: ['legacy'], fallback: '0.62',
    note: 'ezedge=1 lets a leaf card seen edge-on draw its old bright line' },
  { id: 'imu', kind: 'toggle', marks: ['legacy'], fallback: 'on',
    note: 'imu=0 drives real GPS without the gyro' },
] as const satisfies readonly SwitchDef[];

/** Every declared id, as a type. An undeclared read does not compile, which is
 *  the whole mechanism: the table cannot fall behind the code. */
export type SwitchId = typeof SWITCHES[number]['id'];

const BY_ID = new Map<string, SwitchDef>(SWITCHES.map((s) => [s.id, s]));
export const switchDef = (id: SwitchId): SwitchDef => BY_ID.get(id) as SwitchDef;

/** The raw value, or null when absent. `search` is an argument so a test can
 *  ask what a URL means without a browser; in the game it is the page's. */
export const qs = (id: SwitchId, search?: string): string | null =>
  new URLSearchParams(search ?? (typeof location === 'undefined' ? '' : location.search)).get(id);
export const qsHas = (id: SwitchId, search?: string): boolean => qs(id, search) !== null;
/** `?x=0` and `?x=off` are false; anything else present is true; absent is the
 *  caller's default, because "not set" is not the same as "set to the default". */
export const qsOn = (id: SwitchId, whenAbsent: boolean, search?: string): boolean => {
  const v = qs(id, search);
  return v === null ? whenAbsent : v !== '0' && v !== 'off';
};
export const qsNum = (id: SwitchId, whenAbsent: number, search?: string): number => {
  const v = Number(qs(id, search));
  return Number.isFinite(v) ? v : whenAbsent;
};

/** The keys the drive rewrites as the truck moves. Derived, so adding an
 *  `owned` switch cannot forget to update a second list. */
export const URL_OWNED: ReadonlySet<string> =
  new Set(SWITCHES.filter((s) => (s.marks as readonly string[]).includes('owned')).map((s) => s.id));

/** What SETTINGS shows: the table, with what this session is actually running.
 *  A switch the URL sets is marked, so the panel answers both "what exists"
 *  and "what is on right now". */
export function switchRows(search?: string): Array<{
  id: string; note: string; value: string; set: boolean; marks: readonly SwitchMark[];
}> {
  return SWITCHES.map((s) => {
    const v = qs(s.id, search);
    return { id: s.id, note: s.note, marks: s.marks, set: v !== null,
      value: v === null ? s.fallback : (v === '' ? 'on' : v) };
  });
}
