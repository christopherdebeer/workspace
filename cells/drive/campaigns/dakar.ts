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
export interface CampaignDrive {
  name: string;
  sub: string;
  lat: number;
  lon: number;
  h: number;
  note?: string;
  mission?: CampaignMission;
}
export interface Campaign {
  v: number;
  id: string;
  title: string;
  note: string;
  drives: CampaignDrive[];
}

export const CAMPAIGN: Campaign = {
    v: 1,
    id: "dakar",
    title: "PARIS - DAKAR",
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
  };
