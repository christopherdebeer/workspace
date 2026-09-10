/**
 * ── THE ATTRACT REEL, AS PLACES RATHER THAN RECORDINGS ──
 *
 * A tape (client/tapes.ts) is recorded INPUT — four bytes a step of steer,
 * throttle and brake, replayed through the sim. It is the right thing for a
 * player's own banked run, because a run is a performance and the point is
 * that it was theirs. It is the wrong thing for the house programme, and the
 * arithmetic says why: the two authored tapes ran 21.25 and 18.9 seconds, so
 * forty seconds of driving was the WHOLE show, and every extra minute of it
 * would have to be driven by hand and pasted into the bundle as base64.
 *
 * A drive is the same reel entry expressed as data instead: WHERE TO BOOT and
 * WHERE TO GO. The autopilot — the same `goal` and Dijkstra route the DRIVE TO
 * action already uses — does the driving, live, on the player's own hour and
 * weather, for as long as the slot lasts. A new postcard costs two coordinate
 * pairs and a name.
 *
 * IT IS NOT A ROUTE, IT IS A DIRECTION. The slot ends on a time cap far more
 * often than on arrival, and that is the design rather than a shortfall: the
 * goal exists to give the router something to aim at so the truck takes the
 * scenic road rather than the first turning, and a goal an hour away is a
 * better postcard than one just up the lane. Arrival, the cap and a stall all
 * end the slot (see `attractDriveDone` in main.ts).
 *
 * CHOSEN TO SHOW THE GROUND, not just the road. Between them these five stand
 * in five different guilds — fynbos, chaparral, alpine conifer, boreal, and a
 * savanna with actual acacias in it — so the reel is also the standing survey
 * of the ecology work that nobody would otherwise look at.
 */
export interface ReelDrive {
  id: string;
  /** What the carousel calls it. */
  name: string;
  /** Where to boot: the road the postcard starts on. */
  lat: number; lon: number; h: number;
  /** Where to point the autopilot. Reaching it is a bonus, not the plan. */
  goal: { name: string; lat: number; lon: number };
  /** Seconds of driving before the slot gives up its turn. Absent takes
   *  `ATTRACT_DRIVE_S`. A long road earns a longer slot. */
  cap?: number;
  /** One line for the place card, and for whoever edits this file next. */
  note: string;
}

/**
 * EVERY START IS ON A ROAD, AND IT IS CHECKED.
 *
 * `devtools/reel-roads.mjs` reads the same OSM tiles the game streams and
 * reports the nearest drivable way to each start and goal. It exists because
 * the first cut of this list put Chapman's Peak at -34.0745,18.3590 — a
 * coordinate this very session had already established sits in Hout Bay, on
 * the water — and the failure was silent in exactly the way that costs an
 * afternoon: the reel armed, the goal was set, 1009 road cells streamed, the
 * autopilot engaged, and the rig sat perfectly still for ninety seconds with
 * `src: none`, because there was no road under it to take.
 *
 * A START must be within 25m of a drivable way. A GOAL need not be on one at
 * all — the router aims for the closest it can get, and a goal in the middle
 * of a bay is a perfectly good direction to drive in.
 */
export const REEL_DRIVES: ReelDrive[] = [
  {
    id: 'chapmans', name: "CHAPMAN'S PEAK",
    lat: -34.09578, lon: 18.36022, h: 140,
    goal: { name: 'NOORDHOEK', lat: -34.11897, lon: 18.37405 },
    cap: 150,
    note: 'The Cape peninsula road cut into the cliff above the Atlantic. '
      + 'Fynbos shrubland (RESOLVE 12, Afrotropic): dense low scrub with the '
      + 'odd broadleaf standing out of it, and no palms — which is the guild '
      + 'doing its job, since the climate model alone calls this temperate.',
  },
  {
    id: 'bigsur', name: 'BIG SUR',
    lat: 36.37519, lon: -121.90482, h: 356,
    goal: { name: 'CARMEL', lat: 36.5553, lon: -121.9230 },
    cap: 150,
    note: 'Highway 1 north over Bixby Creek. Santa Lucia montane chaparral '
      + '(12, Nearctic) — the same guild as the Cape on the other side of the '
      + 'world, which is the honest answer: the two really are alike, and the '
      + 'realm parts them only where a cactus is involved.',
  },
  {
    id: 'romsdalen', name: 'ROMSDALEN',
    lat: 62.5511, lon: 7.7112, h: 322,
    goal: { name: 'ÅNDALSNES', lat: 62.5675, lon: 7.6870 },
    cap: 120,
    note: 'The valley floor under Trollveggen. Boreal and temperate conifer '
      + 'against a wall of rock, and far enough north that the treeline is '
      + 'in frame rather than theoretical.',
  },
  {
    id: 'stelvio', name: 'STELVIO',
    lat: 46.5285, lon: 10.4530, h: 200,
    goal: { name: 'BORMIO', lat: 46.4676, lon: 10.3728 },
    cap: 180,
    note: 'Forty-eight hairpins off the Alpine pass. The suspension and the '
      + 'chain planner have both been measured here, and it is the one drive '
      + 'in the programme that climbs THROUGH the treeline rather than under '
      + 'it — krummholz to scree in a couple of minutes.',
  },
  {
    id: 'kruger', name: 'KRUGER',
    lat: -24.99172, lon: 31.60472, h: 97,
    goal: { name: 'LOWER SABIE', lat: -25.1200, lon: 31.9200 },
    cap: 150,
    note: 'The Sabie river road. Tropical savanna (7, Afrotropic): open '
      + 'ground at a quarter the density of a forest with umbrella-crowned '
      + 'acacias standing in it — the silhouette the atlas had no way to draw '
      + 'until the bake learned the word.',
  },
];
