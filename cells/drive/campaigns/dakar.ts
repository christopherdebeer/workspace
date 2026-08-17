/**
 * THE AUTHORED DESTINATIONS — data, kept out of the game.
 *
 * Served to the client from the cell's public namespace at `~/campaign/<v>`
 * (see `serveCampaign` in index.ts), never bundled into `client/main.ts`. Edit
 * here, bump `v` below AND `CAMPAIGN_V` on both sides, and deploy: the served
 * object is immutable at its version, so a stale one can never shadow a new
 * one.
 *
 * A TypeScript module rather than the .json it started as: the cell's own
 * bundler has no JSON loader and parsed the file as JavaScript
 * (`Expected ";" but found ":"`, on a deploy that failed before it shipped).
 * Being a module is the better answer anyway — the shape is checked at build
 * time, so a missing `lat` or a heading typed as a string cannot reach a
 * player.
 *
 * `note` fields carry the reasoning that used to live in code comments. They
 * are shipped to the client and cost a few hundred bytes; a campaign is
 * authored data, and the reason a number is what it is belongs with it.
 *
 * Deliberately NOT substrate facts: the game is isolated and reads no slice.
 * See `docs/drive-persistence.md`.
 */
export interface CampaignMission {
  id: string;
  giver: { name: string; lat: number; lon: number };
  title: string;
  brief: string;
  dest: { name: string; lat: number; lon: number };
  within: number;
  withinNote?: string;
  via?: { name: string; atLeast?: number };
  viaNote?: string;
}
/**
 * A STATION — the Service's fixed point on a line.
 *
 * In-game they are only ever "stations". Each one is an EXISTING real-world
 * feature, found in OSM and renamed: the Service does not build in the
 * recovering land, it adapts what is already standing — a toll plaza, a
 * lighthouse, a reservoir works — into a self-contained survey station. The
 * base is a SHIPPING CONTAINER (instruments raised on its roof: solar array,
 * uplink dish, monitoring mast), and the container's faded livery is the
 * game's first narrative surface: the paint says who SUPPLIED the box, which
 * is not always who runs the station now. `osm` is provenance, as prose:
 * which real feature the author renamed — a record for the authors, not a
 * lookup the game does.
 */
export interface CampaignStation {
  id: string;
  name: string;
  sub: string;
  lat: number;
  lon: number;
  /** Which operator's livery the container carries — a key into `ops`. */
  op?: string;
  /** The real OSM feature this station was built into, renamed. */
  osm?: string;
  note?: string;
}
/**
 * AN OPERATOR — corporate, state, or independent. Nothing in the game ever
 * explains these; they exist as paint. `mark` is the big letters on the box,
 * `name` the small print, `ghost` a PREVIOUS operator's mark still showing
 * through a repaint — which is the entire faction story, told the Gibson way:
 * through obsolete contractors' marks nobody stops to explain.
 */
export interface CampaignOp {
  name: string;
  mark: string;
  /** Container paint, as hex. Rendered faded — everything out here is. */
  color: string;
  /** A previous mark ghosting through the repaint. */
  ghost?: string;
  note?: string;
}
export interface CampaignDrive {
  name: string;
  sub: string;
  lat: number;
  lon: number;
  h: number;
  note?: string;
  mission?: CampaignMission;
}
/**
 * A COVER — one of the sealed metropolitan shells. Rendered as a single
 * monumental object that becomes landscape when near; the game NEVER builds
 * what is inside one (the client skips OSM under a Cover entirely, which is
 * the fiction and a serious streaming win saying the same thing: you may
 * never see inside).
 */
export interface CampaignCover {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Shell radius, metres. */
  r: number;
  note?: string;
}
export interface Campaign {
  v: number;
  id: string;
  title: string;
  note: string;
  /** Where THE LINE begins — the aperture spawn, at the Cover's foot. */
  start: { name: string; lat: number; lon: number; h: number };
  drives: CampaignDrive[];
  stations: CampaignStation[];
  /** The line's legs, in order — standalone missions the campaign arms one at
   *  a time. Ids are marks (`MISSION#<id>`), so a finished leg stays finished. */
  legs: CampaignMission[];
  covers: CampaignCover[];
  ops: Record<string, CampaignOp>;
}

export const CAMPAIGN: Campaign = {
    v: 5,
    id: "dakar",
    title: "PARIS - DAKAR",
    start: {
      name: "PARIS SOUTH · THE APERTURE",
      // ON the D920's western carriageway through Bourg-la-Reine — placed from
      // the way's actual vertices, read back out of the cell's own tile cache
      // after the first live boot (the first guess sat 70m west, in the
      // houses, facing a wall). You spawn on the avenue looking south, down
      // the line; the shell stands at your back, and PD-01 is beside you.
      lat: 48.77855,
      lon: 2.31341,
      h: 182,
    },
    note: "The authored destinations, served to the client from the cell's public namespace at ~/campaign/<v> rather than compiled into the bundle. Edit here, bump `v` in BOTH this file and CAMPAIGN_V (client + server), and deploy: the served object is immutable at its version, so a stale one can never shadow a new one. `note` fields carry the reasoning that used to live in code comments — a campaign is authored data, and the reason a number is what it is belongs with it.",
    drives: [
      {
        name: "PARIS",
        sub: "TROCADERO · THE START",
        lat: 48.8617,
        lon: 2.289,
        h: 135,
      },
      {
        name: "LAC ROSE",
        sub: "SENEGAL · THE FINISH",
        lat: 14.839,
        lon: -17.235,
        h: 90,
      },
      {
        name: "GIZA",
        sub: "EGYPT · THE PYRAMIDS",
        lat: 29.9765,
        lon: 31.132,
        h: 45,
      },
      {
        name: "WADI RUM",
        sub: "JORDAN · VALLEY OF THE MOON",
        lat: 29.5765,
        lon: 35.42,
        h: 90,
      },
      {
        name: "SOSSUSVLEI",
        sub: "NAMIBIA · THE RED DUNES",
        lat: -24.728,
        lon: 15.345,
        h: 90,
      },
      {
        name: "UYUNI",
        sub: "BOLIVIA · THE SALT FLAT",
        lat: -20.2,
        lon: -67.5,
        h: 270,
      },
      {
        name: "DEATH VALLEY",
        sub: "BADWATER BASIN",
        lat: 36.2296,
        lon: -116.7665,
        h: 0,
      },
      {
        name: "MONUMENT VALLEY",
        sub: "UTAH · US 163",
        lat: 37.103,
        lon: -109.993,
        h: 200,
      },
      {
        name: "BIG SUR",
        sub: "CALIFORNIA · HIGHWAY 1",
        lat: 36.3731,
        lon: -121.90433,
        h: 127,
      },
      {
        name: "STELVIO",
        sub: "ITALY · 48 HAIRPINS",
        lat: 46.5285,
        lon: 10.4541,
        h: 200,
      },
      {
        name: "TROLLSTIGEN",
        sub: "NORWAY · THE TROLL LADDER",
        lat: 62.4558,
        lon: 7.671,
        h: 180,
      },
      {
        name: "TRANSFAGARASAN",
        sub: "ROMANIA · THE RIDGE ROAD",
        lat: 45.6017,
        lon: 24.6172,
        h: 180,
      },
      {
        name: "NORDSCHLEIFE",
        sub: "EIFEL · THE GREEN HELL",
        lat: 50.3356,
        lon: 6.9475,
        h: 200,
      },
      {
        name: "ICEFIELDS",
        sub: "ALBERTA · THE PARKWAY",
        lat: 52.22,
        lon: -117.225,
        h: 160,
      },
      {
        name: "CHAPMANS PEAK",
        sub: "CAPE TOWN · THE RUN OUT WEST",
        lat: -34.08716,
        lon: 18.42083,
        h: 290,
        note: "Starts at the reserve's admin office on Ou Kaapse Weg, not on the pass itself: a drive should begin somewhere you are GIVEN a reason to go, and end at the thing worth arriving at. The old spawn (-34.079, 18.362) is now the destination.",
        mission: {
          id: "chapmans-run",
          giver: {
            name: "ADMIN OFFICE",
            lat: -34.08716,
            lon: 18.42083,
          },
          title: "THE RUN OUT WEST",
          brief: "TAKE THE PASS TO THE HEADLAND",
          dest: {
            name: "CHAPMANS PEAK",
            lat: -34.079,
            lon: 18.362,
          },
          within: 120,
          withinNote: "120, not 90: the pass passes no nearer than 104m to the headland, so a 90m radius could only be reached by leaving the road at the end.",
          via: {
            name: "Chapman's Peak Drive",
            atLeast: 6,
          },
          viaNote: "The brief says TAKE THE PASS. Without `via` it was a suggestion — the headland is reachable by pointing the truck at it and climbing. SIX, and a count rather than a majority, because the headland sits at the MIDDLE of the pass: 4496m of road, 18 checkpoints, closest approach to the destination at 48% along it. Driving in from either end collects 9 — exactly half, never a majority — so requiring one would have shipped a mission that cannot be completed. Six is about 1.5km of pass: enough that you have to have driven it, low enough to survive joining part way along.",
        },
      },
      {
        name: "JOKULSARLON",
        sub: "ICELAND · THE RING ROAD",
        lat: 64.048,
        lon: -16.18,
        h: 270,
      },
    ],
    // The first stations. The P-D line proper is seventeen of these and wants
    // an authoring pass with real POI research; these three prove the SYSTEM —
    // one at each end of the line, and one on the Cape test line where every
    // instrument in devtools/ already drives.
    stations: [
      {
        id: "pd-01",
        name: "PD-01",
        sub: "PARIS SOUTH · THE APERTURE · KM 0",
        lat: 48.7784,
        lon: 2.31318,
        op: "crc",
        osm: "The D920 (old N20) through Bourg-la-Reine — Avenue du General Leclerc, placed against the way's own vertices from the tile cache. The station stands at the kerb of the western carriageway, at the Cover's foot where the line leaves it.",
        note: "Kilometre zero. A Compact box at the aperture — the institutional end of the line looks institutional. Moved here from Trocadero when the Cover went up: the old spot is inside the shell now, which is the point of the shell.",
      },
      {
        id: "pd-02",
        name: "PD-02",
        sub: "ETAMPES · OLD N20 · KM 44",
        lat: 48.4372,
        lon: 2.1725,
        op: "crc",
        osm: "The N20 dual carriageway east of Etampes — the old Paris-Orleans road the line follows out of the basin.",
        note: "The first station out. The narrative's first anomaly lives here eventually — the pruned clearing the terminal calls natural — but the paint says nothing yet.",
      },
      {
        id: "pd-03",
        name: "PD-03",
        sub: "ORLEANS RING · KM 95",
        lat: 47.945,
        lon: 1.904,
        op: "tms",
        osm: "The D2060 tangential north of Orleans — verified through the cell's own tile cache (primary, D 2060). A corporate box on a state line, and nobody has repainted it.",
      },
      {
        id: "pd-04",
        name: "PD-04",
        sub: "VIERZON · ROUTE DE PARIS · KM 173",
        lat: 47.25004,
        lon: 2.06019,
        op: "sv",
        osm: "The D2020 (old N20) north of Vierzon — literally named Route de Paris here. Station placed against the way's own vertex (47.25004, 2.06036), on the west verge, from the OSM API when the tile cache's upstream was saturated.",
        note: "The far side of the Sologne — eighty kilometres of forest and ponds between here and Orleans, the longest gap on the line so far. A Compact box repainted by whoever actually keeps this stretch: the inverse of the Cape's story, and nobody explains that either.",
      },
      {
        id: "pd-05",
        name: "PD-05",
        sub: "CHATEAUROUX-DEOLS · THE OLD AIRFIELD · KM 223",
        lat: 46.86219,
        lon: 1.71594,
        op: "tms",
        osm: "The D920's Avenue Marcel Dassault past Chateauroux-Deols airport — the old US air base turned freight field, runway and Marcel Bloch works beside the road. Station at the way's own vertex (46.86215, 1.71611).",
        note: "A logistics giant's box at a freight airfield, still in its own livery — the one place on the line where TRANSMERIDIAN paint looks like it belongs. What the docket thinks of the airfield is in the leg brief, which is to say: it forbids it.",
      },
      {
        id: "pd-06",
        name: "PD-06",
        sub: "ARGENTON · AVENUE ROLLINAT · KM 257",
        lat: 46.58899,
        lon: 1.51902,
        op: "crc",
        osm: "The D920 (old N20) through Argenton-sur-Creuse — Avenue Rollinat, named for the poet of the Creuse. Station at the way's own vertex (46.58890, 1.51914).",
        note: "The line drops into the Creuse valley here — bridges, gorges, the first terrain since Paris that argues back. A plain Compact box, because the state still holds the bridges. It says so in the brief.",
      },
      {
        id: "pd-17",
        name: "PD-17",
        sub: "LAC ROSE · P-D LINE · TERMINUS",
        lat: 14.8391,
        lon: -17.2352,
        op: "tms",
        osm: "The shore of Lac Retba (Lac Rose), Senegal — the historic Paris-Dakar finish, already the campaign's LAC ROSE drive.",
        note: "A corporate box at the far terminus, and nobody has repainted it. Whether TRANSMERIDIAN still exists is not a question the terminal answers.",
      },
      {
        id: "ct-01",
        name: "CT-01",
        sub: "SILVERMINE · CAPE TEST LINE",
        lat: -34.0874,
        lon: 18.4214,
        op: "smw",
        osm: "The Silvermine reserve admin buildings on Ou Kaapse Weg — the same real place Chapman's Run uses as its giver.",
        note: "The development station, and the repaint: an independent watch's stencil over a corporate ghost — the whole faction story in one coat of paint.",
      },
    ],
    // THE LINE'S LEGS — the campaign's missions, armed one at a time in order.
    // The register is the docket's: terse, imperative, mundane. Nothing here
    // explains the world.
    legs: [
      {
        id: "line-01",
        giver: { name: "PD-01 · THE APERTURE", lat: 48.7784, lon: 2.31318 },
        title: "THE LINE · LEG 1",
        brief: "TRAVERSE TO PD-02. ACTIVATE THE STATION. DO NOT IMPROVE THE ROAD",
        dest: { name: "PD-02", lat: 48.4372, lon: 2.1725 },
        within: 260,
        withinNote: "Generous on purpose: the station stands beside a dual carriageway, and arriving on either carriageway must count as arriving.",
      },
      {
        id: "line-02",
        giver: { name: "PD-02", lat: 48.4372, lon: 2.1725 },
        title: "THE LINE · LEG 2",
        brief: "TRAVERSE TO PD-03. ACTIVATE THE STATION. RECORD WHAT YOU PASS",
        dest: { name: "PD-03", lat: 47.945, lon: 1.904 },
        within: 260,
      },
      {
        id: "line-03",
        giver: { name: "PD-03", lat: 47.945, lon: 1.904 },
        title: "THE LINE · LEG 3",
        brief: "TRAVERSE TO PD-04. ACTIVATE THE STATION. THE SOLOGNE CROSSING IS UNVERIFIED — RECORD STANDING WATER",
        dest: { name: "PD-04", lat: 47.25004, lon: 2.06019 },
        within: 260,
        viaNote: "Seventy-eight kilometres, the longest leg yet — the Sologne is forest and ponds with no station in it, on purpose: the docket calls the crossing unverified, and the leg IS the verification.",
      },
      {
        id: "line-04",
        giver: { name: "PD-04", lat: 47.25004, lon: 2.06019 },
        title: "THE LINE · LEG 4",
        brief: "TRAVERSE TO PD-05. ACTIVATE THE STATION. DO NOT ENTER THE AIRFIELD",
        dest: { name: "PD-05", lat: 46.86219, lon: 1.71594 },
        within: 260,
        viaNote: "The docket forbids exactly one thing on this leg, and it is the only interesting thing on it. Nothing in the game explains why. That is the register working.",
      },
      {
        id: "line-05",
        giver: { name: "PD-05", lat: 46.86219, lon: 1.71594 },
        title: "THE LINE · LEG 5",
        brief: "TRAVERSE TO PD-06. ACTIVATE THE STATION. THE CREUSE BRIDGES ARE COMPACT PROPERTY — REPORT THEIR CONDITION",
        dest: { name: "PD-06", lat: 46.58899, lon: 1.51902 },
        within: 260,
      },
    ],
    // THE COVERS. One monumental object each; the game never builds inside.
    covers: [
      {
        id: "paris",
        name: "PARIS COVER",
        lat: 48.8566,
        lon: 2.3333,
        r: 8600,
        note: "Sized so the shell's southern foot lands at the aperture on the D920 — and so the whole dense petite couronne sits inside it, which is the fiction and the streaming budget agreeing: the city is never fetched.",
      },
      {
        id: "dakar",
        name: "DAKAR COVER",
        lat: 14.7167,
        lon: -17.4677,
        r: 5200,
      },
    ],
    // The operators exist as PAINT and nowhere else. No screen names them, no
    // codex explains them; a player who notices that two boxes on one line
    // wear different colours has read the story exactly as intended.
    ops: {
      crc: {
        name: "CONTINENTAL RECOVERY COMPACT",
        mark: "CRC",
        color: "#3d5a52",
        note: "The Compact's own service containers — the state, insofar as one remains.",
      },
      tms: {
        name: "TRANSMERIDIAN SYSTEMS",
        mark: "TMS",
        color: "#8a4a2a",
        note: "A pre-Leaving logistics giant. Its boxes are everywhere; the company may not be.",
      },
      smw: {
        name: "SILVERMINE WATCH",
        mark: "SMW",
        color: "#46586c",
        ghost: "TMS",
        note: "Independent custodians. A repainted TRANSMERIDIAN box, the old mark still ghosting through — who supplied a station and who runs it are different questions.",
      },
      sv: {
        name: "SOLOGNE VEILLE",
        mark: "SV",
        color: "#4d5a44",
        ghost: "CRC",
        note: "Whoever keeps the forest stretch. A COMPACT box under the repaint this time — the inverse of the Cape's story: there the independents took a corporate cast-off, here they took over from the state. No screen says any of this.",
      },
    },
  };
