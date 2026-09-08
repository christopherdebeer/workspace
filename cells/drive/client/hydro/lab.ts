import * as THREE from 'three';
import { createDials } from '../lab-dials';
import {
  analyseHydroTile,
  FLOWING_NOMINAL_DEPTH_M,
  type HydroTileAnalysis,
} from './build-tile';
import { nearestSegment } from './geometry';
import { createHydroSystem, type HydroSystem } from './system';
import type {
  CoverageGrid, ElevationGrid, HydroDebugView, HydroFeature, HydroKind,
  HydroSample, HydroTileInput, HydroTuning, WorldBounds,
} from './types';

interface Fixture {
  id: string;
  label: string;
  note: string;
  originY: number;
  oceanLevelM: number;
  height(x: number, z: number): number;
  ocean?: (x: number, z: number) => number;
  features: readonly HydroFeature[];
  /** Lab-only authored boulders: x, z, horizontal radius, vertical radius. */
  rocks?: readonly (readonly [number, number, number, number])[];
}

const BOUNDS: WorldBounds = { minX: -300, minZ: -300, maxX: 300, maxZ: 300 };
const pts = (...v: number[]): Float64Array => new Float64Array(v);

function area(
  id: string, kind: HydroKind, level: number, outer: number[], holes: number[][] = [],
  tuning: Partial<Pick<HydroFeature, 'roughness' | 'turbidity' | 'intermittent' | 'tidal'>> = {},
): HydroFeature {
  return {
    id, source: 'authored', kind, taggedLevelM: level,
    intermittent: tuning.intermittent ?? false,
    tidal: tuning.tidal ?? false,
    roughness: tuning.roughness, turbidity: tuning.turbidity,
    geometry: { type: 'area', polygons: [{ outer: pts(...outer), holes: holes.map((h) => pts(...h)) }] },
  };
}

function channel(
  id: string, kind: 'river' | 'stream' | 'canal', widthM: number, points: number[],
  tuning: Partial<Pick<HydroFeature, 'roughness' | 'turbidity' | 'taggedLevelM'>> = {},
): HydroFeature {
  return {
    id, source: 'authored', kind, intermittent: false, tidal: false, ...tuning,
    geometry: { type: 'line', widthM, points: pts(...points) },
  };
}

const FIXTURES: readonly Fixture[] = [
  {
    id: 'coast', label: 'COAST / OCEAN MASK', originY: 0, oceanLevelM: 0,
    note: 'Depth-derived shoaling turns waves toward the coast, raises them before the break and leaves irregular crest foam through the surf zone. The lagoon remains a separate body.',
    height: (x, z) => x < -20
      ? -9 + Math.sin(z * .035) * .7
      : (x + 20) * .095 + Math.sin(z * .021) * 2.2 + Math.sin(x * .045) * .8,
    ocean: (x, z) => x < -12 + Math.sin(z * .018) * 24 ? 1 : 0,
    features: [
      area('lab:lagoon', 'lagoon', .35,
        [55,-130, 150,-150, 205,-85, 175,-20, 85,-35, 45,-82], [],
        { roughness: .22, turbidity: .48 }),
    ],
  },
  {
    id: 'polder', label: 'NETHERLANDS / POLDER', originY: -2, oceanLevelM: 0,
    note: 'Dry ground and inland water lie below the adjacent sea. Classification, not elevation, keeps the polder dry.',
    height: (x, z) => x < -205 ? -7 + Math.sin(z * .04) * .25
      : -4.4 + Math.exp(-Math.pow((x + 178) / 16, 2)) * 7
        + Math.sin(x * .025) * .35 + Math.cos(z * .019) * .25,
    ocean: (x) => x < -205 ? 1 : 0,
    features: [
      channel('lab:canal', 'canal', 12,
        [-145,-260, -120,-160, -138,-55, -90,45, -105,155, -62,260],
        { taggedLevelM: -2.7, roughness: .12, turbidity: .45 }),
      area('lab:reservoir', 'reservoir', -3,
        [35,-85, 145,-92, 184,-22, 145,62, 42,78, 8,-8], [],
        { roughness: .15, turbidity: .38 }),
    ],
  },
  {
    id: 'death', label: 'DEATH VALLEY / TINY POND', originY: -85, oceanLevelM: 0,
    note: 'A tiny pond at -84.7 m remains water while the surrounding -86 m basin remains dry.',
    height: (x, z) => -86.1 + Math.sin(x * .025) * .45 + Math.cos(z * .019) * .35
      + Math.hypot(x, z) * .0025,
    features: [
      area('lab:badwater', 'pond', -84.7,
        [-18,-11, 18,-10, 24,1, 15,13, -17,11, -25,0], [],
        { roughness: .08, turbidity: .67 }),
    ],
  },
  {
    id: 'lake', label: 'MOUNTAIN LAKE / ISLAND', originY: 425, oceanLevelM: 0,
    note: 'A flat +426 m lake with a true dry inner ring. The lake never influences the ocean datum.',
    height: (x, z) => {
      const r = Math.hypot(x, z);
      return 421.5 + Math.max(0, r - 120) * .085 + Math.sin(x * .025) * 1.1
        + (r < 42 ? (1 - r / 42) * 14 : 0);
    },
    features: [
      area('lab:alpine', 'lake', 426,
        [-175,-70, -115,-150, 5,-177, 130,-128, 190,-20, 152,105, 45,168, -85,145, -180,55],
        [[-32,-23, 24,-31, 39,11, 11,38, -35,24]],
        { roughness: .27, turbidity: .18 }),
    ],
  },
  {
    id: 'river', label: 'RIVER / GRADED PROFILE', originY: 38, oceanLevelM: 0,
    note: 'DEM samples become a monotone downstream profile. Surface energy now responds to grade and bends; FLOW view warms from direction colour toward orange where whitewater is generated.',
    height: (x, z) => 64 - (z + 300) * .09 + Math.sin(x * .025) * 3.5
      + Math.cos(z * .031) * 1.4 + Math.abs(x - Math.sin(z * .014) * 72) * .018,
    features: [
      channel('lab:river', 'river', 15,
        [-28,-285, 35,-225, 68,-150, 50,-75, -18,0, -76,85, -62,165, 4,238, 38,285],
        { roughness: .72, turbidity: .42 }),
    ],
  },
  {
    id: 'shallows', label: 'RIVER / SHALLOWS & EDDIES', originY: 43, oceanLevelM: 0,
    note: 'Clear broad shallows expose the pebble bed and wet gravel margins. Repeated bends exercise slow inside-bank eddies separately from faster outer-bank turbulence.',
    height: (x, z) => {
      const centre = Math.sin(z * .0135) * 82 + Math.sin(z * .029) * 16;
      const profile = 56 - (z + 300) * .038;
      return profile + Math.min(10, Math.abs(x - centre) * .032)
        + Math.sin(x * .033 - z * .017) * .28;
    },
    features: [
      channel('lab:shallows', 'river', 26,
        [54,-285, -10,-230, -72,-165, -88,-95, -42,-25,
          48,45, 94,110, 62,175, -18,235, -70,285],
        { roughness: .48, turbidity: .12 }),
    ],
    rocks: [
      [-74,-151,2.2,1.2], [-82,-127,1.5,.9], [75,91,1.8,1.0],
      [85,118,2.4,1.35], [49,169,1.4,.8],
    ],
  },
  {
    id: 'rapids', label: 'RIVER / POOL–RAPID', originY: 62, oceanLevelM: 0,
    note: 'Alternating gentle reaches and two sharp profile drops exercise rapid crests, downstream froth and bend turbulence. FLOW view shows the derived energy field without authored rapid markers.',
    height: (x, z) => {
      const centre = Math.sin(z * .012) * 58 + Math.sin(z * .032) * 14;
      const profile = 79 - (z + 300) * .032
        - 4.8 * (.5 + .5 * Math.tanh((z + 130) / 12))
        - 6.2 * (.5 + .5 * Math.tanh((z - 75) / 10));
      return profile + Math.min(12, Math.abs(x - centre) * .055)
        + Math.sin(x * .041 + z * .019) * .22;
    },
    features: [
      channel('lab:rapids', 'river', 18,
        [12,-285, -36,-225, -41,-165, -46,-130, -54,-95, -31,-30,
          40,40, 54,70, 53,100, 42,150, 38,220, -12,285],
        { roughness: .92, turbidity: .35 }),
    ],
    rocks: [
      [-49,-145,3.8,2.5], [-41,-126,2.5,1.7], [-55,-111,1.8,1.25],
      [47,61,2.1,1.4], [55,78,4.2,2.8], [48,96,2.6,1.8],
    ],
  },
  {
    id: 'micro', label: 'TWO-LEVEL MICROBODIES', originY: 30, oceanLevelM: 0,
    note: 'Two tiny ponds share one coarse mesh tile but retain levels thirty metres apart.',
    height: (x, z) => x < 0 ? 14 + Math.sin(z * .03) * .35 : 44 + Math.cos(z * .027) * .4,
    features: [
      area('lab:low', 'pond', 15, [-165,-20, -130,-25, -118,3, -139,27, -174,16, -180,-4]),
      area('lab:high', 'pond', 45, [116,-15, 149,-24, 176,-3, 164,25, 126,29, 105,7]),
    ],
  },
];

function elevationGrid(f: Fixture, n = 129): ElevationGrid {
  const data = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    data[z * n + x] = f.height(
      BOUNDS.minX + x / (n - 1) * (BOUNDS.maxX - BOUNDS.minX),
      BOUNDS.minZ + z / (n - 1) * (BOUNDS.maxZ - BOUNDS.minZ),
    );
  }
  return { width: n, height: n, data, verticalDatum: 'hydro-lab' };
}

function coverageGrid(f: Fixture, n = 129): CoverageGrid | undefined {
  if (!f.ocean) return undefined;
  const data = new Uint8Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const wx = BOUNDS.minX + x / (n - 1) * (BOUNDS.maxX - BOUNDS.minX);
    const wz = BOUNDS.minZ + z / (n - 1) * (BOUNDS.maxZ - BOUNDS.minZ);
    data[z * n + x] = Math.round(Math.max(0, Math.min(1, f.ocean(wx, wz))) * 255);
  }
  return { width: n, height: n, data };
}

function tileInput(f: Fixture, revision: number): HydroTileInput {
  const ocean = coverageGrid(f);
  return {
    key: 'lab/' + f.id, revision, bounds: BOUNDS,
    elevation: elevationGrid(f), features: f.features,
    oceanCoverage: ocean ? { status: 'ready', grid: ocean } : { status: 'unavailable' },
  };
}

const STYLE = [
  ':root{color-scheme:dark;font-family:Silkscreen,ui-monospace,monospace}',
  '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f;color:#dce8d5}',
  'button,select,input{font:inherit}#hydro-canvas{position:fixed;inset:0;width:100%;height:100%;touch-action:none;image-rendering:pixelated}',
  '.head{position:fixed;left:16px;top:14px;z-index:4;display:flex;align-items:center;gap:10px;text-shadow:0 2px #07100f}',
  '.title{color:#f1ca62;letter-spacing:.18em;font-size:13px}.badge{color:#73d2af;border:1px solid #397e69;padding:4px 7px;font-size:9px;background:#0b1816dd}',
  '.back{color:#93aaa0;text-decoration:none;font-size:10px}.hint{position:fixed;left:16px;top:43px;z-index:4;color:#789188;font:9px ui-monospace,monospace;background:#07100faa;padding:5px 7px}',
  '.panel{position:fixed;right:12px;top:50px;bottom:12px;z-index:5;width:min(310px,calc(100vw - 24px));overflow:auto;padding:12px;border:1px solid #31534b;background:#081311ef;box-shadow:7px 7px #02070699}',
  'h2{margin:0 0 8px;color:#72d2ae;font-size:11px;letter-spacing:.13em}.note{min-height:48px;color:#9fb1a6;font:10px/1.5 ui-monospace,monospace;margin-bottom:10px}',
  '.section{border-top:1px solid #203c35;padding-top:9px;margin-top:10px}.st{display:block;color:#efc968;font-size:9px;letter-spacing:.15em;margin-bottom:7px;cursor:pointer;user-select:none;list-style:none}',
  '.st::-webkit-details-marker{display:none}.st::before{content:"▾";display:inline-block;width:14px;color:#67bea0}.section:not([open])>.st::before{content:"▸"}.section:not([open])>.st{margin-bottom:0}',
  '.row{display:grid;grid-template-columns:105px 1fr 42px;gap:7px;align-items:center;min-height:27px}.row.wide{grid-template-columns:105px 1fr}.row label{color:#aabcb2;font-size:9px}',
  '.row output{text-align:right;color:#e6d694;font:9px ui-monospace,monospace}.row input[type=range]{width:100%;accent-color:#67bea0}',
  '.row input[type=number],.row select{width:100%;min-width:0;color:#dce8d5;background:#0c211c;border:1px solid #31534b;padding:5px;font-size:9px}',
  '.check{display:flex;gap:8px;align-items:center;color:#aabcb2;font-size:9px;min-height:27px}.check input{accent-color:#67bea0}',
  '.status{position:fixed;left:16px;bottom:14px;z-index:4;max-width:min(540px,calc(100vw - 350px));background:#07100fdd;border-left:3px solid #5ca78f;padding:8px 10px;color:#b8c8bf;font:10px/1.45 ui-monospace,monospace;white-space:pre-wrap}',
  // The chrome eats 43vh on a phone, which is most of the thing you came to
  // look at. `bare` takes all of it away; the toggle itself never hides, or
  // there would be no way back.
  '.uibtn{position:fixed;right:12px;top:12px;z-index:9;min-width:34px;height:30px;padding:0 8px;display:flex;align-items:center;justify-content:center;'
    + 'color:#9fd8c2;background:#07100fee;border:1px solid #31534b;font:9px/1 ui-monospace,monospace;letter-spacing:.1em;cursor:pointer;user-select:none;-webkit-user-select:none}',
  '.uibtn:active{background:#0f2a24}',
  'body.bare .head,body.bare .hint,body.bare .panel,body.bare .status{display:none}',
  '@media(max-width:700px){.panel{top:auto;height:43vh;width:calc(100vw - 24px)}.status{bottom:calc(43vh + 22px);max-width:calc(100vw - 32px)}.hint{display:none}}',
].join('');

function range(id: string, label: string, min: number, max: number, step: number, value: number): string {
  return '<div class="row"><label for="' + id + '">' + label + '</label><input id="' + id
    + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value
    + '"><output>' + value + '</output></div>';
}

function page(): string {
  const fixtureOptions = FIXTURES.map((f) => '<option value="' + f.id + '">' + f.label + '</option>').join('');
  const debugOptions = ['surface','coverage','shore','depth','flow','class']
    .map((v) => '<option value="' + v + '">' + v.toUpperCase() + '</option>').join('');
  return '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">'
    + '<style>' + STYLE + '</style></head><body><canvas id="hydro-canvas"></canvas>'
    + '<div class="head"><span class="title">HYDROGRAPH</span><span class="badge">ISOLATED LAB</span><a class="back" href="/">← DRIVE</a></div>'
    + '<div class="hint">drag orbit · shift-drag or two-finger pan · wheel or pinch zoom · tap to inspect · double-tap recentres · H hides the panels</div>'
    + '<div class="uibtn" id="uibtn" title="hide the panels (H)">HIDE</div>'
    + '<aside class="panel"><h2>WATER FIELD / GPU SURFACE</h2><div class="note" id="note"></div>'
    + '<div class="row wide"><label>FIXTURE</label><select id="fixture">' + fixtureOptions + '</select></div>'
    + '<div class="row wide"><label>CAMERA</label><select id="cameraMode"><option>OVERVIEW</option><option>DETAIL</option></select></div>'
    + '<div class="row wide"><label>VIEW</label><select id="debug">' + debugOptions + '</select></div>'
    + '<details class="section" data-section="weather" open><summary class="st">WEATHER</summary>'
    + range('wind','WIND m/s',0,22,.1,5) + range('direction','WIND °',0,359,1,35) + range('rain','RAIN',0,1,.01,.1)
    + '<div class="row"><label>OCEAN m</label><input id="ocean" type="number" step=".1" value="0"><output></output></div></details>'
    + '<details class="section" data-section="surface" open><summary class="st">SURFACE</summary>'
    + range('amplitude','WAVE AMP',0,3,.01,1) + range('length','WAVE LENGTH',.2,3,.01,1)
    + range('ripple','RIPPLE',0,3,.01,1) + range('foam','FOAM',0,3,.01,1) + range('shore','SHORE FADE',.2,3,.01,1)
    + '</details><details class="section" data-section="river" open><summary class="st">RIVER DETAIL</summary>'
    + '<div class="row wide"><label>ISOLATE</label><select id="detailPreset">'
    + '<option>ALL</option><option>BED / SHALLOWS</option><option>BANK EDGES</option>'
    + '<option>EDDIES</option><option>RAPIDS</option><option>WAKE</option><option>CUSTOM</option></select></div>'
    + range('bed','BED DETAIL',0,3,.01,1) + range('edge','BANK EDGE',0,3,.01,1)
    + range('turbulence','TURBULENCE',0,3,.01,1) + range('eddies','EDDIES',0,3,.01,1)
    + '<label class="check"><input id="wakeDemo" type="checkbox"> vehicle wake demo</label>'
    + range('wakeSpeed','WAKE m/s',1,12,.1,5)
    + '</details><details class="section" data-section="sampling" open><summary class="st">SAMPLING</summary>'
    // The 600m lab at 32/8 has the same physical sampling as a production
    // 2.4km tile at 128/32: 18.75m field texels and 75m ocean mesh cells.
    // Default to that honest view; higher settings remain useful microscopes.
    + '<div class="row wide"><label>FIELD px</label><select id="field"><option selected value="32">32 · PROD SCALE</option><option>64</option><option>128</option><option>256</option></select></div>'
    + '<div class="row wide"><label>MESH seg</label><select id="mesh"><option selected value="8">8 · PROD SCALE</option><option>16</option><option>32</option><option>64</option></select></div>'
    + '<label class="check"><input id="wire" type="checkbox"> water wireframe</label>'
    + '<label class="check"><input id="ground" type="checkbox" checked> terrain visible</label></details></aside>'
    + '<div class="status" id="status">building hydro fixture…</div></body>';
}

/**
 * The production terrain has already carved a watercourse to the same invert
 * hydro profiles from. The lab used to show the raw fixture DEM instead, so a
 * monotone river surface disappeared under every local ground hump and broke
 * into islands in close views. Carve only the display mesh from the analysed
 * profile; hydro still receives the raw elevation and therefore builds the
 * exact profile this carve is based on.
 */
function makeTerrain(f: Fixture, analysis: HydroTileAnalysis): THREE.Mesh {
  const channels: Array<{ profile: Float32Array; halfW: number }> = [];
  for (let i = 0; i < f.features.length; i++) {
    const feature = f.features[i];
    if (feature.geometry.type !== 'line') continue;
    const profile = analysis.profiles.get(`${feature.id}#${i}`)
      ?? analysis.profiles.get(feature.id);
    if (profile) channels.push({ profile, halfW: feature.geometry.widthM * 0.5 });
  }
  const carvedHeight = (x: number, z: number): number => {
    let ground = f.height(x, z);
    for (const channel of channels) {
      const hit = nearestSegment(x, z, channel.profile, 3);
      if (hit.segment < 0) continue;
      const shoulder = Math.max(3, channel.halfW * 0.45);
      if (hit.distanceM > channel.halfW + shoulder) continue;
      const a = hit.segment * 3, b = (hit.segment + 1) * 3;
      const surface = channel.profile[a + 2] * (1 - hit.t)
        + channel.profile[b + 2] * hit.t;
      const bed = surface - FLOWING_NOMINAL_DEPTH_M;
      const bank = THREE.MathUtils.smoothstep(
        hit.distanceM, channel.halfW, channel.halfW + shoulder,
      );
      ground = Math.min(ground, bed + (ground - bed) * bank);
    }
    return ground;
  };
  // Shore inspection needs a finer display terrain than the broad water mesh:
  // coarse, flat-shaded bank triangles otherwise masquerade as a hydro edge
  // defect when the camera comes down for pebble/eddy work.
  const geometry = new THREE.PlaneGeometry(600, 600, 192, 192);
  geometry.rotateX(-Math.PI / 2);
  const p = geometry.attributes.position as THREE.BufferAttribute;
  const colour = new Float32Array(p.count * 3);
  const low = new THREE.Color(0x506352), high = new THREE.Color(0x967c55), scratch = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const h = carvedHeight(p.getX(i), p.getZ(i));
    p.setY(i, h - f.originY);
    scratch.copy(low).lerp(high, Math.max(0, Math.min(1, .45 + (h - f.originY) / 70)));
    colour[i*3] = scratch.r; colour[i*3+1] = scratch.g; colour[i*3+2] = scratch.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .94, metalness: 0, flatShading: true,
  }));
}

/** Protruding lab rocks use the analysed water profile for their waterline.
 * Production boulders remain terrain-generated; these are an inspection aid
 * so the rapid and shallow fixtures exercise rock/water contact visually. */
function makeRiverDetails(f: Fixture, analysis: HydroTileAnalysis): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hydro-lab-river-details';
  if (!f.rocks?.length) return group;
  const profiles = [...analysis.profiles.entries()]
    .filter(([key]) => key.includes('#'))
    .map(([, profile]) => profile);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x64675b, roughness: .98, metalness: 0, flatShading: true,
  });
  for (const [x, z, radius, height] of f.rocks) {
    let surface = f.height(x, z) + FLOWING_NOMINAL_DEPTH_M;
    let nearest = Infinity;
    for (const profile of profiles) {
      const hit = nearestSegment(x, z, profile, 3);
      if (hit.segment < 0 || hit.distanceM >= nearest) continue;
      const a = hit.segment * 3, b = (hit.segment + 1) * 3;
      surface = profile[a + 2] * (1 - hit.t) + profile[b + 2] * hit.t;
      nearest = hit.distanceM;
    }
    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(x, surface - f.originY - height * .42, z);
    rock.scale.set(radius, height, radius * .82);
    rock.rotation.y = ((x * 17.13 + z * 3.71) % 6.283 + 6.283) % 6.283;
    rock.rotation.z = Math.sin(x * 2.1 + z) * .08;
    rock.castShadow = rock.receiveShadow = true;
    group.add(rock);
  }
  group.userData.dispose = (): void => {
    geometry.dispose();
    material.dispose();
  };
  return group;
}

function wakeRigAt(
  f: Fixture,
  analysis: HydroTileAnalysis,
  travelledM: number,
  speedMps: number,
): { x: number; z: number; vx: number; vz: number; levelM: number } | undefined {
  for (let i = 0; i < f.features.length; i++) {
    const feature = f.features[i];
    if (feature.geometry.type !== 'line') continue;
    const profile = analysis.profiles.get(`${feature.id}#${i}`)
      ?? analysis.profiles.get(feature.id);
    if (!profile || profile.length < 6) continue;
    let total = 0;
    for (let p = 3; p < profile.length; p += 3) {
      total += Math.hypot(profile[p] - profile[p - 3], profile[p + 1] - profile[p - 2]);
    }
    let remaining = ((travelledM % total) + total) % total;
    for (let p = 3; p < profile.length; p += 3) {
      const dx = profile[p] - profile[p - 3], dz = profile[p + 1] - profile[p - 2];
      const length = Math.hypot(dx, dz);
      if (remaining > length) { remaining -= length; continue; }
      const t = length > 0 ? remaining / length : 0;
      return {
        x: profile[p - 3] + dx * t,
        z: profile[p - 2] + dz * t,
        vx: dx / Math.max(length, .001) * speedMps,
        vz: dz / Math.max(length, .001) * speedMps,
        levelM: profile[p - 1] * (1 - t) + profile[p + 2] * t,
      };
    }
  }
  return undefined;
}

function sampleText(s: HydroSample | undefined, x: number, z: number): string {
  if (!s) return 'x ' + x.toFixed(1) + '  z ' + z.toFixed(1) + '  · DRY';
  return 'x ' + x.toFixed(1) + '  z ' + z.toFixed(1) + '  · ' + s.kind.toUpperCase()
    + '\nlevel ' + s.restingLevelM.toFixed(2) + 'm  depth ' + s.depthM.toFixed(2)
    + 'm  shore ' + s.shoreDistanceM.toFixed(1) + 'm'
    + '\nflow ' + s.flow[0].toFixed(2) + ',' + s.flow[1].toFixed(2)
    + '  fetch ' + s.fetchM.toFixed(0) + 'm';
}

export async function startHydroLab(): Promise<void> {
  document.documentElement.innerHTML = page();
  document.title = 'Hydrograph — isolated water laboratory';
  const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const number = (id: string): number => Number(get<HTMLInputElement>(id).value);
  // The native panel predates the shared lab dials, but should fold on the
  // same terms: each section remembers its state across the refresh loop used
  // while tuning shaders.
  const sectionKey = 'drive:hydro:sections';
  let foldedSections: Record<string, boolean> = {};
  try {
    foldedSections = JSON.parse(localStorage.getItem(sectionKey) ?? '{}') as Record<string, boolean>;
  } catch { /* private mode / stale storage */ }
  document.querySelectorAll<HTMLDetailsElement>('details.section').forEach((section) => {
    const name = section.dataset.section ?? '';
    if (name in foldedSections) section.open = foldedSections[name];
    section.addEventListener('toggle', () => {
      foldedSections[name] = section.open;
      try { localStorage.setItem(sectionKey, JSON.stringify(foldedSections)); } catch { /* private mode */ }
    });
  });
  const canvas = get<HTMLCanvasElement>('hydro-canvas');
  const contextAttributes: WebGLContextAttributes = { antialias: false, powerPreference: 'high-performance' };
  const context = canvas.getContext('webgl2', contextAttributes) ?? canvas.getContext('webgl', contextAttributes);
  if (!context) {
    get('note').textContent = 'The isolated lab loaded, but this browser has WebGL disabled.';
    get('status').textContent = 'WEBGL UNAVAILABLE\nOpen /hydro in a WebGL-capable browser to render and tune the water surface.';
    return;
  }
  const renderer = new THREE.WebGLRenderer({
    canvas, context: context as WebGLRenderingContext, antialias: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1715);
  scene.fog = new THREE.Fog(0x0b1715, 480, 1100);
  scene.add(new THREE.HemisphereLight(0xbad8cf, 0x332d25, 1.55));
  const sun = new THREE.DirectionalLight(0xffd48b, 2.25);
  sun.position.set(260, 430, 180); scene.add(sun);

  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, .5, 2200);
  const target = new THREE.Vector3();
  const HOME = { yaw: -.75, pitch: .78, distance: 650 };
  let yaw = HOME.yaw, pitch = HOME.pitch, distance = HOME.distance;
  const placeCamera = (): void => {
    const cp = Math.cos(pitch);
    camera.position.set(target.x + Math.sin(yaw) * cp * distance,
      target.y + Math.sin(pitch) * distance, target.z + Math.cos(yaw) * cp * distance);
    camera.lookAt(target);
  };
  /**
   * PAN, in metres, from a drag in pixels.
   *
   * The rig always had a `target` and never moved it, so the camera could only
   * ever swing around the fixture's centre — fine for a 600m square seen whole,
   * useless for putting your eye on one shoreline.
   *
   * The scale is the honest one: the vertical extent of the view frustum AT THE
   * TARGET, divided by the viewport height, so a grabbed point stays under the
   * finger at any zoom instead of sliding at a fixed pixel rate.
   */
  const panBy = (dxPx: number, dyPx: number): void => {
    const mPerPx = (2 * Math.tan(camera.fov * Math.PI / 360) * distance) / innerHeight;
    // Camera right and forward, flattened into the ground plane: panning is a
    // move over the water, not a climb.
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // Negative on both, so the WORLD follows the finger rather than fleeing it.
    target.x += (-dxPx * rx - dyPx * fx) * mPerPx;
    target.z += (-dxPx * rz - dyPx * fz) * mPerPx;
    // A fixture is 600m across. Past a kilometre out you are looking at nothing
    // and cannot tell which way is back.
    const LIM = 900;
    target.x = Math.max(-LIM, Math.min(LIM, target.x));
    target.z = Math.max(-LIM, Math.min(LIM, target.z));
    placeCamera();
  };
  const zoomBy = (factor: number): void => {
    distance = Math.max(40, Math.min(1600, distance * factor));
    placeCamera();
  };
  const resetView = (): void => {
    target.set(0, 0, 0);
    yaw = HOME.yaw; pitch = HOME.pitch; distance = HOME.distance;
    placeCamera();
  };
  const setCameraMode = (mode: string): void => {
    target.set(0, 0, 0);
    yaw = HOME.yaw;
    if (mode === 'DETAIL') {
      pitch = .72;
      distance = 245;
    } else {
      pitch = HOME.pitch;
      distance = HOME.distance;
    }
    placeCamera();
  };
  placeCamera();

  let hydro: HydroSystem | undefined;
  let terrain: THREE.Mesh | undefined;
  let riverDetails: THREE.Group | undefined;
  let analysis: HydroTileAnalysis | undefined;
  let fixture = FIXTURES[0];
  let revision = 0;
  let rebuilding = false;
  let inspected = '';
  const probe = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.4, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf2cf67, side: THREE.DoubleSide, depthTest: false }));
  probe.visible = false; probe.renderOrder = 20; scene.add(probe);
  const rigMarker = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.15, 5.4),
    new THREE.MeshStandardMaterial({ color: 0xc8873b, roughness: .82, metalness: 0 }),
  );
  rigMarker.visible = false;
  rigMarker.castShadow = true;
  scene.add(rigMarker);

  const tune = (): HydroTuning => ({
    waveAmplitude: number('amplitude'), waveLength: number('length'),
    rippleStrength: number('ripple'), foamStrength: number('foam'), shoreFade: number('shore'),
    shallowBedStrength: number('bed'), riverEdgeStrength: number('edge'),
    turbulenceStrength: number('turbulence'), eddyStrength: number('eddies'),
  });
  const apply = (): void => {
    if (!hydro) return;
    hydro.setDebugView(get<HTMLSelectElement>('debug').value as HydroDebugView);
    hydro.setTuning(tune());
    hydro.object3d.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material instanceof THREE.ShaderMaterial) m.material.wireframe = get<HTMLInputElement>('wire').checked;
    });
  };

  const rebuild = async (): Promise<void> => {
    if (rebuilding) return;
    rebuilding = true;
    fixture = FIXTURES.find((f) => f.id === get<HTMLSelectElement>('fixture').value) ?? FIXTURES[0];
    get('note').textContent = fixture.note;
    get<HTMLInputElement>('ocean').value = String(fixture.oceanLevelM);
    hydro?.dispose();
    if (terrain) {
      terrain.removeFromParent(); terrain.geometry.dispose(); (terrain.material as THREE.Material).dispose();
    }
    if (riverDetails) {
      riverDetails.removeFromParent();
      (riverDetails.userData.dispose as (() => void) | undefined)?.();
    }
    const input = tileInput(fixture, ++revision);
    analysis = analyseHydroTile(input);
    terrain = makeTerrain(fixture, analysis);
    terrain.visible = get<HTMLInputElement>('ground').checked;
    scene.add(terrain);
    riverDetails = makeRiverDetails(fixture, analysis);
    scene.add(riverDetails);
    hydro = createHydroSystem({
      fieldResolution: Number(get<HTMLSelectElement>('field').value),
      meshResolution: Number(get<HTMLSelectElement>('mesh').value),
      oceanLevelM: fixture.oceanLevelM,
    });
    scene.add(hydro.object3d);
    await hydro.upsertTile(input);
    apply(); inspected = ''; probe.visible = false; rebuilding = false;
  };

  document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) => {
    const output = input.parentElement?.querySelector('output');
    input.addEventListener('input', () => {
      if (output) output.textContent = Number(input.value).toFixed(Number(input.step) < 1 ? 2 : 0);
      if (['bed','edge','turbulence','eddies'].includes(input.id)) {
        get<HTMLSelectElement>('detailPreset').value = 'CUSTOM';
      }
      apply();
    });
  });
  const setDial = (id: string, value: number): void => {
    const input = get<HTMLInputElement>(id);
    input.value = String(value);
    const output = input.parentElement?.querySelector('output');
    if (output) output.textContent = value.toFixed(Number(input.step) < 1 ? 2 : 0);
  };
  get<HTMLSelectElement>('detailPreset').addEventListener('change', () => {
    const preset = get<HTMLSelectElement>('detailPreset').value;
    const settings: Record<string, [number, number, number, number, number]> = {
      'ALL': [1, 1, 1, 1, 1],
      'BED / SHALLOWS': [2, .45, 0, 0, .08],
      'BANK EDGES': [.35, 2.2, 0, 0, .05],
      'EDDIES': [.45, .55, .25, 2.3, .08],
      'RAPIDS': [.25, .65, 1.8, .3, 1.35],
      'WAKE': [.6, .8, .25, .5, .3],
    };
    const values = settings[preset];
    if (!values) return;
    setDial('bed', values[0]); setDial('edge', values[1]);
    setDial('turbulence', values[2]); setDial('eddies', values[3]);
    setDial('foam', values[4]);
    const surface: Record<string, [number, number]> = {
      'ALL': [1, 1],
      'BED / SHALLOWS': [.18, .12],
      'BANK EDGES': [.22, .16],
      'EDDIES': [.20, .14],
      'RAPIDS': [.72, .75],
      'WAKE': [.24, .20],
    };
    setDial('amplitude', surface[preset][0]);
    setDial('ripple', surface[preset][1]);
    const wantedFixture = preset === 'RAPIDS' ? 'rapids'
      : (preset === 'BED / SHALLOWS' || preset === 'BANK EDGES'
        || preset === 'EDDIES' || preset === 'WAKE')
        ? 'shallows' : undefined;
    get<HTMLInputElement>('wakeDemo').checked = preset === 'WAKE';
    get<HTMLSelectElement>('cameraMode').value = 'DETAIL';
    setCameraMode('DETAIL');
    if (wantedFixture && get<HTMLSelectElement>('fixture').value !== wantedFixture) {
      get<HTMLSelectElement>('fixture').value = wantedFixture;
      void rebuild();
    } else apply();
  });
  get<HTMLSelectElement>('debug').addEventListener('change', apply);
  get<HTMLSelectElement>('cameraMode').addEventListener('change', () => {
    setCameraMode(get<HTMLSelectElement>('cameraMode').value);
  });
  get<HTMLInputElement>('wire').addEventListener('change', apply);
  get<HTMLInputElement>('wakeDemo').addEventListener('change', () => {
    if (!get<HTMLInputElement>('wakeDemo').checked) rigMarker.visible = false;
  });
  get<HTMLInputElement>('ground').addEventListener('change', () => { if (terrain) terrain.visible = get<HTMLInputElement>('ground').checked; });
  get<HTMLInputElement>('ocean').addEventListener('input', () => hydro?.setOceanLevelM(number('ocean')));
  for (const id of ['fixture','field','mesh']) get<HTMLSelectElement>(id).addEventListener('change', () => { void rebuild(); });

  // ── ONE POINTER ORBITS, TWO PINCH AND PAN ──
  //
  // The first cut tracked a single pointer, so on a phone — which is where
  // this thing is actually looked at — there was no pan and no zoom at all,
  // and a fixture could only be viewed from wherever it opened.
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const live = new Map<number, { x: number; y: number }>();
  let moved = false, gesture: 'none' | 'orbit' | 'pan' | 'pinch' = 'none';
  let pinchGap = 0, midX = 0, midY = 0, lastTap = 0;

  /** Where the two-finger gesture currently is: centroid and separation. */
  const centroid = (): { x: number; y: number; gap: number } => {
    const ps = [...live.values()];
    const x = (ps[0].x + ps[1].x) / 2, y = (ps[0].y + ps[1].y) / 2;
    return { x, y, gap: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
  };

  /** The CPU hydro sample under a screen point — the thing the status line
   *  invites you to go and get. */
  const inspectAt = (cx: number, cy: number): void => {
    const r = canvas.getBoundingClientRect();
    pointer.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = terrain ? ray.intersectObject(terrain, false)[0] : undefined;
    if (!hit) { probe.visible = false; inspected = ''; return; }
    const s = hydro?.sampleRestingSurface(hit.point.x, hit.point.z);
    inspected = sampleText(s, hit.point.x, hit.point.z);
    probe.position.set(hit.point.x, hit.point.y + .6, hit.point.z); probe.visible = true;
  };

  canvas.addEventListener('pointerdown', (e) => {
    live.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (live.size === 2) {
      const c = centroid(); pinchGap = c.gap; midX = c.x; midY = c.y; gesture = 'pinch';
    } else if (live.size === 1) {
      moved = false;
      // Shift, middle button or right button all mean pan on a desktop, where
      // there is no second finger to offer.
      gesture = (e.shiftKey || e.button === 1 || e.button === 2) ? 'pan' : 'orbit';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = live.get(e.pointerId);
    if (!prev) { if (!live.size) inspectAt(e.clientX, e.clientY); return; }   // hover, mouse only
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    moved ||= Math.abs(dx) + Math.abs(dy) > 2;

    if (live.size >= 2) {
      const c = centroid();
      if (pinchGap > 0) zoomBy(pinchGap / Math.max(1, c.gap));
      // The centroid drifting IS the pan, so a pinch that also slides does
      // both at once, which is what a hand actually does.
      panBy(c.x - midX, c.y - midY);
      pinchGap = c.gap; midX = c.x; midY = c.y;
      return;
    }
    if (gesture === 'pan') { panBy(dx, dy); return; }
    yaw -= dx * .006; pitch = Math.max(.16, Math.min(1.42, pitch + dy * .005));
    placeCamera();
  });

  const endPointer = (e: PointerEvent): void => {
    const had = live.size;
    live.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (live.size < 2) { pinchGap = 0; }
    if (live.size === 0) {
      // A TAP INSPECTS. There is no hover on a touch screen, so without this
      // the status line's "point at the terrain to inspect" was an instruction
      // that could not be followed on the device this is mostly used from.
      if (had === 1 && !moved) {
        const now = performance.now();
        if (now - lastTap < 320) resetView(); else inspectAt(e.clientX, e.clientY);
        lastTap = now;
      }
      gesture = 'none';
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => zoomBy(Math.exp(e.deltaY * .001)), { passive: true });
  // ── THE PANELS COME OFF ──
  //
  // On a phone the rack is 43vh and the status line sits above it, so more
  // than half the screen is chrome over the one thing worth looking at. The
  // button never hides — a toggle you cannot find again is a trapdoor.
  const uibtn = get('uibtn');
  const setBare = (on: boolean): void => {
    document.body.classList.toggle('bare', on);
    uibtn.textContent = on ? 'SHOW' : 'HIDE';
    uibtn.title = on ? 'show the panels (H)' : 'hide the panels (H)';
  };
  uibtn.addEventListener('click', () => setBare(!document.body.classList.contains('bare')));
  addEventListener('keydown', (e) => {
    // Never while typing a number into the ocean-level box.
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'h' || e.key === 'H') setBare(!document.body.classList.contains('bare'));
    if (e.key === 'r' || e.key === 'R') resetView();
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false);
  });

  // ── THE SAME BARGAIN AS EVERY OTHER LAB ──
  // This lab built its own controls long before there was a shared panel, so
  // rather than rewriting them it ADOPTS them by id: the existing markup keeps
  // working and gains persistence across reloads, a COPY of the whole set, and
  // a PASTE to put one back. Nothing here had to move.
  createDials({
    slug: 'hydro',
    adopt: ['fixture', 'debug', 'ocean', 'field', 'mesh', 'wire', 'ground',
      'wind', 'direction', 'rain', 'amplitude', 'length', 'ripple', 'foam', 'shore',
      'cameraMode', 'detailPreset', 'bed', 'edge', 'turbulence', 'eddies',
      'wakeDemo', 'wakeSpeed'],
  });

  await rebuild();
  const started = performance.now();
  let lastStatus = 0;
  const frame = (now: number): void => {
    const angle = number('direction') * Math.PI / 180;
    const elapsed = (now - started) / 1000;
    const wakeDemo = get<HTMLInputElement>('wakeDemo').checked;
    const demoRig = wakeDemo && analysis
      // Start near the fixture's central inspection bend, not 300m upstream
      // beyond the detail camera. The offset is distance, so speed still
      // controls only motion and the retained trail remains physically timed.
      ? wakeRigAt(fixture, analysis, 300 + elapsed * number('wakeSpeed'), number('wakeSpeed'))
      : undefined;
    if (demoRig) {
      rigMarker.visible = true;
      rigMarker.position.set(demoRig.x, demoRig.levelM - fixture.originY + .25, demoRig.z);
      rigMarker.rotation.y = Math.atan2(demoRig.vx, demoRig.vz);
    } else rigMarker.visible = false;
    hydro?.update({
      timeSeconds: elapsed,
      worldOrigin: { x: 0, y: fixture.originY, z: 0 },
      wind: { x: Math.cos(angle), z: Math.sin(angle), speedMps: number('wind') },
      rain: number('rain'),
      sunDirection: { x: sun.position.x, y: sun.position.y, z: sun.position.z },
      terrainColour: { r: .12, g: .16, b: .11 },
      rig: demoRig ? {
        x: demoRig.x, z: demoRig.z, vx: demoRig.vx, vz: demoRig.vz, wadeM: .48,
      } : undefined,
    });
    renderer.render(scene, camera);
    if (now - lastStatus > 180) {
      lastStatus = now;
      const stats = hydro?.stats();
      get('status').textContent = fixture.label + ' · FIELD ' + get<HTMLSelectElement>('field').value
        + '² · MESH ' + get<HTMLSelectElement>('mesh').value + '²\n'
        + (stats?.visibleTiles ?? 0) + ' WATER TILE · ' + renderer.info.render.triangles.toLocaleString()
        + ' TRIANGLES · ' + get<HTMLSelectElement>('debug').value.toUpperCase() + '\n'
        + (inspected || 'point at the terrain to inspect the CPU hydro sample');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('beforeunload', () => {
    hydro?.dispose();
    terrain?.geometry.dispose();
    (terrain?.material as THREE.Material | undefined)?.dispose();
    (riverDetails?.userData.dispose as (() => void) | undefined)?.();
    rigMarker.geometry.dispose();
    (rigMarker.material as THREE.Material).dispose();
    renderer.dispose();
  }, { once: true });
}
