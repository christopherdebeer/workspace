/**
 * LANDMARKS — the world the data cannot draw.
 *
 * The Great Pyramid renders as a sand dune: the DEM smooths a 139m limestone
 * polyhedron into a mound, and OSM's polygon for it — where one exists at all
 * — extrudes into a flat-roofed prism. Both sources are DOING THEIR JOB; a
 * pyramid is simply not expressible in either vocabulary. The fix is not
 * better data, it is a THIRD vocabulary: a small authored store of parametric
 * geometry for the places famous enough that a driver arrives already knowing
 * what they should see.
 *
 * A SIBLING OF THE STREAMED WORLD, NOT A PATCH ON IT. OSM and the DEM stream
 * by tile and answer for everywhere; this store is authored by hand and
 * answers for a handful of coordinates. It lives in git like the campaign
 * does, because at this size a file IS the right database: deterministic,
 * versioned, reviewed. If it ever grows past tens of entries the same records
 * can move behind a `~/landmarks/v1` route on the cell and stream like
 * everything else — the shape below is already the wire format.
 *
 * Each entry claims a PAD: a radius inside which the terrain is flattened to
 * the surveyed base elevation (the DEM's mound would otherwise poke through
 * the true geometry it approximates) and OSM buildings stand down (whatever
 * polygon OSM carries would double-render inside ours).
 */
import type { ArchPlace, BridgeForm, CablePattern, DeckKind, EndFeature, TowerStyle, TrussPlace } from './bridge-forms';

/**
 * ── BRIDGES ARE LANDMARKS ──
 *
 * A big bridge is architecture: its family, where its towers stand, the
 * shape of a tower, how the cables hang, what colour it was painted. The
 * generic painter (`bridge-forms.ts`) draws any bridge from its OSM tags;
 * an entry here is the dozen parameters that make a famous one read as
 * itself from a kilometre off. It claims the deck ways by NAME within
 * `reach` of its position, so the towers rise from the real deck at the
 * real height, wherever OSM split the ways. Stations are the towers'
 * positions; only their position along the bridge is used, so a coordinate
 * read off a map to a few tens of metres is good enough. `pad` is the
 * radius round each station inside which an OSM building stands down —
 * the pylons of the Normandie are in OSM as 214 m buildings.
 */
export interface BridgeLandmark {
  /** Names the deck ways carry (`bridge:name` or `name`), any one of which
   *  claims them; case-blind substrings. Empty claims any bridge in reach. */
  match: string[];
  /** Metres from the entry's position within which a matching bridge is this one. */
  reach: number;
  form: BridgeForm;
  tower?: TowerStyle;
  cables?: CablePattern;
  /** Tower height over the deck, metres; else `towerRatio` of the main span. */
  towerM?: number;
  towerRatio?: number;
  sag?: number;
  arch?: ArchPlace;
  rise?: number;
  truss?: TrussPlace;
  deck?: DeckKind;
  ends?: EndFeature;
  /** Tower positions, [lat, lon] each. */
  stations?: Array<[number, number]>;
  /** …or as fractions of the bridge's length, for the many-pylon viaducts. */
  fractions?: number[];
  towerCol?: number;
  cableCol?: number;
  steelCol?: number;
  stoneCol?: number;
  pad?: number;
}

export interface Landmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /**
   * The parametric vocabulary. Every kind earns its place by being (a) the
   * shape of something famous, (b) buildable from a handful of primitives at
   * a 148-pixel-wide render, and (c) wrong in both source datasets. A statue
   * is famous and wrong in the data but fails (b) — a blocky Liberty would be
   * worse than her absence, which is why there is no 'statue' kind.
   */
  kind: 'pyramid' | 'step-pyramid' | 'obelisk' | 'spire' | 'ring' | 'bridge';
  /** kind bridge: the parameters. A bridge entry flattens no pad and stands
   *  no group up of its own; `base` is its main span and `h` its tower
   *  height, for the record. */
  bridge?: BridgeLandmark;
  /** Base side length (pyramids, obelisk, spire legs) or outer diameter
   *  (ring), metres. */
  base: number;
  /** Apex height over the pad, metres. */
  h: number;
  /** Rotation of the base edges, radians clockwise from cardinal. */
  rot?: number;
  /** Flatten-and-clear radius, metres. Defaults to base * 1.1. */
  pad?: number;
  /**
   * Surveyed base elevation, metres above sea level. Optional but preferred:
   * without it the pad's height is the median of a ring of DEM samples
   * outside the pad, and at Giza that ring proved fragile twice in one round
   * — close in it lands on the monument's own smeared mound, far out it falls
   * off the plateau edge toward the Nile. These are surveyed monuments; the
   * number is in the literature, and an authored store is the place for it.
   */
  ele?: number;
  /** Albedo. Weathered core limestone unless the stone says otherwise. */
  col?: number;
  /** step-pyramid: number of tiers. */
  steps?: number;
}

export const LANDMARKS: Landmark[] = [
  // Giza: the trio, surveyed sides and heights, all three aligned to true
  // north within a twentieth of a degree — the rot field exists for the rest
  // of the world, not for these.
  // The pad is the EXACT apron — landmarkFlatten runs a skirt out to two pads
  // that clamps the DEM's mound smear down without filling real low ground,
  // so the pad itself stays as tight as the monument's footprint allows.
  { id: 'giza-khufu', name: 'GREAT PYRAMID', lat: 29.97925, lon: 31.13422,
    kind: 'pyramid', base: 230, h: 139, pad: 200, ele: 60 },
  { id: 'giza-khafre', name: 'PYRAMID OF KHAFRE', lat: 29.97603, lon: 31.13080,
    kind: 'pyramid', base: 215, h: 136, pad: 190, ele: 70 },
  { id: 'giza-menkaure', name: 'PYRAMID OF MENKAURE', lat: 29.97245, lon: 31.12817,
    kind: 'pyramid', base: 103, h: 65, pad: 120, ele: 69 },

  // ── the rest of the Memphite necropolis, one drive south of Giza ──
  // No authored ele: open desert, where the ring-median fallback is at its
  // best. (Giza needed the survey because its ring falls off a plateau edge.)
  { id: 'saqqara-djoser', name: 'PYRAMID OF DJOSER', lat: 29.87126, lon: 31.21633,
    kind: 'step-pyramid', base: 118, h: 62, steps: 6, pad: 140 },
  { id: 'dahshur-red', name: 'RED PYRAMID', lat: 29.80867, lon: 31.20616,
    kind: 'pyramid', base: 220, h: 105, pad: 200, col: 0xa88c6a },
  { id: 'dahshur-bent', name: 'BENT PYRAMID', lat: 29.79025, lon: 31.20925,
    kind: 'pyramid', base: 189, h: 101, pad: 180 },

  // ── Teotihuacan: the other great pyramid field ──
  { id: 'teo-sun', name: 'PYRAMID OF THE SUN', lat: 19.69247, lon: -98.84353,
    kind: 'step-pyramid', base: 225, h: 65, steps: 5, pad: 220, col: 0x8f7a5e },
  { id: 'teo-moon', name: 'PYRAMID OF THE MOON', lat: 19.69984, lon: -98.84429,
    kind: 'step-pyramid', base: 140, h: 43, steps: 4, pad: 150, col: 0x8f7a5e },

  // ── singular verticals the DEM cannot even see ──
  // A 17m-wide, 169m-tall obelisk is NOTHING in a 30m elevation raster, and
  // OSM extrudes it as a stub. The National Mall is flat, so the tiny pad is
  // only there to stand OSM's own polygon down.
  { id: 'dc-washington', name: 'WASHINGTON MONUMENT', lat: 38.88946, lon: -77.03524,
    kind: 'obelisk', base: 16.8, h: 169, pad: 60, ele: 9, col: 0xd8d4c8 },
  { id: 'paris-eiffel', name: 'EIFFEL TOWER', lat: 48.85837, lon: 2.29448,
    kind: 'spire', base: 125, h: 312, pad: 110, ele: 33, col: 0x4a3f36 },

  // ── and one that is nearly invisible until you are standing in it ──
  // Four-metre sarsens are sub-pixel past a few hundred metres, which is
  // true to life: Stonehenge is a landmark you arrive at, not one you steer
  // by. It is here because OSM draws it as a flat ring on the grass.
  { id: 'stonehenge', name: 'STONEHENGE', lat: 51.17882, lon: -1.82577,
    kind: 'ring', base: 33, h: 4.1, pad: 45, ele: 102, col: 0x8a8578 },
  // ── BRIDGES ──
  //
  // The table these came from is in CLAUDE.md ("Bridges are landmarks").
  // Tower positions are read off the map to a few tens of metres; the
  // painter takes only their position along the bridge. Colours are the
  // paint the bridge actually wears.
  { id: 'pont-de-normandie', name: 'PONT DE NORMANDIE', lat: 49.4322, lon: 0.2738, kind: 'bridge', base: 856, h: 160,
    bridge: { match: ['normandie'], reach: 2600, form: 'cable-stayed', tower: 'inverted-y', cables: 'semi-fan', towerM: 160,
      stations: [[49.42842, 0.27453], [49.43609, 0.27315]], towerCol: 0xe8e6e0, cableCol: 0xf2f2f2, pad: 70 } },
  { id: 'golden-gate', name: 'GOLDEN GATE BRIDGE', lat: 37.8199, lon: -122.4783, kind: 'bridge', base: 1280, h: 152,
    bridge: { match: ['golden gate'], reach: 2600, form: 'suspension', tower: 'deco-portal', cables: 'suspension', towerM: 152, sag: 0.11,
      deck: 'truss', stations: [[37.8141, -122.4776], [37.8257, -122.4790]], towerCol: 0xf04a00, cableCol: 0xf04a00, steelCol: 0xf04a00, pad: 45 } },
  { id: 'sydney-harbour', name: 'SYDNEY HARBOUR BRIDGE', lat: -33.8523, lon: 151.2108, kind: 'bridge', base: 503, h: 134,
    bridge: { match: ['harbour bridge', 'sydney harbour'], reach: 1600, form: 'arch', arch: 'through', rise: 0.27, ends: 'pylons',
      stations: [[-33.8551, 151.2116], [-33.8496, 151.2101]], towerCol: 0x5f6468, cableCol: 0x6a6f74, stoneCol: 0xb7ab94, pad: 40 } },
  { id: 'tower-bridge', name: 'TOWER BRIDGE', lat: 51.5055, lon: -0.0754, kind: 'bridge', base: 61, h: 55,
    bridge: { match: ['tower bridge'], reach: 500, form: 'bascule', tower: 'gothic', towerM: 55,
      stations: [[51.5060, -0.0751], [51.5049, -0.0756]], towerCol: 0xd6cdbd, stoneCol: 0xd6cdbd, steelCol: 0x4a6fa5, pad: 30 } },
  { id: 'brooklyn-bridge', name: 'BROOKLYN BRIDGE', lat: 40.7061, lon: -73.9969, kind: 'bridge', base: 486, h: 48,
    bridge: { match: ['brooklyn bridge'], reach: 1300, form: 'suspension', tower: 'gothic', cables: 'suspension', towerM: 48, sag: 0.08,
      deck: 'truss', stations: [[40.7072, -73.9993], [40.7050, -73.9943]], towerCol: 0xb9a98c, stoneCol: 0xb9a98c, cableCol: 0x9a9a9a, pad: 35 } },
  { id: 'forth-bridge', name: 'FORTH BRIDGE', lat: 56.0003, lon: -3.3886, kind: 'bridge', base: 521, h: 100,
    bridge: { match: ['forth bridge', 'forth rail'], reach: 1600, form: 'truss', tower: 'cantilever', truss: 'through', towerM: 100,
      stations: [[56.0050, -3.3862], [56.0003, -3.3886], [55.9956, -3.3910]], towerCol: 0x9b3b2c, steelCol: 0x9b3b2c, cableCol: 0x9b3b2c, pad: 30 } },
  { id: 'millau', name: 'VIADUC DE MILLAU', lat: 44.0778, lon: 3.0224, kind: 'bridge', base: 342, h: 87,
    bridge: { match: ['millau'], reach: 2200, form: 'cable-stayed', tower: 'a-frame', cables: 'fan', towerM: 87,
      fractions: [0.083, 0.222, 0.361, 0.5, 0.639, 0.778, 0.917], towerCol: 0xe8e6e1, cableCol: 0xf0f0ee, pad: 0 } },
  { id: 'oresund', name: 'ØRESUND BRIDGE', lat: 55.5712, lon: 12.8493, kind: 'bridge', base: 490, h: 145,
    bridge: { match: ['øresund', 'oresund', 'öresund'], reach: 2400, form: 'cable-stayed', tower: 'h-frame', cables: 'harp', towerM: 145,
      deck: 'double', stations: [[55.5726, 12.8462], [55.5698, 12.8524]], towerCol: 0xd8d8d5, cableCol: 0xe4e4e2, pad: 45 } },
  { id: 'akashi-kaikyo', name: 'AKASHI KAIKYŌ BRIDGE', lat: 34.6170, lon: 135.0210, kind: 'bridge', base: 1991, h: 200,
    bridge: { match: ['akashi', '明石'], reach: 3200, form: 'suspension', tower: 'braced-portal', cables: 'suspension', towerM: 200, sag: 0.1,
      deck: 'truss', stations: [[34.6260, 135.0194], [34.6080, 135.0226]], towerCol: 0x8fa39a, cableCol: 0x9fb0a8, pad: 45 } },
  { id: 'humber', name: 'HUMBER BRIDGE', lat: 53.7076, lon: -0.4503, kind: 'bridge', base: 1410, h: 125,
    bridge: { match: ['humber'], reach: 2600, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 125, sag: 0.1,
      stations: [[53.7139, -0.4490], [53.7012, -0.4516]], towerCol: 0xcfcfca, cableCol: 0x6e6e6e, pad: 40 } },
  { id: 'tsing-ma', name: 'TSING MA BRIDGE', lat: 22.3517, lon: 114.0725, kind: 'bridge', base: 1377, h: 144,
    bridge: { match: ['tsing ma', '青馬'], reach: 2600, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 144, sag: 0.1,
      deck: 'double', stations: [[22.3517, 114.0658], [22.3517, 114.0792]], towerCol: 0x9a9ea3, cableCol: 0x7d8186, pad: 45 } },
  { id: 'rio-antirrio', name: 'RIO–ANTIRRIO BRIDGE', lat: 38.3208, lon: 21.7727, kind: 'bridge', base: 560, h: 113,
    bridge: { match: ['antirrio', 'antirio', 'rio', 'charilaos', 'trikoupis'], reach: 2000, form: 'cable-stayed', tower: 'a-frame', cables: 'fan', towerM: 113,
      fractions: [0.2, 0.4, 0.6, 0.8], towerCol: 0xe9e7e2, cableCol: 0xf0f0ee, pad: 0 } },
  { id: 'erasmus', name: 'ERASMUSBRUG', lat: 51.9090, lon: 4.4870, kind: 'bridge', base: 284, h: 127,
    bridge: { match: ['erasmus'], reach: 900, form: 'cable-stayed', tower: 'mast', cables: 'harp', towerM: 127,
      stations: [[51.9096, 4.4862]], towerCol: 0xc9d6e0, cableCol: 0xd8e2ea, pad: 30 } },
  { id: 'verrazzano', name: 'VERRAZZANO-NARROWS BRIDGE', lat: 40.6066, lon: -74.0447, kind: 'bridge', base: 1298, h: 141,
    bridge: { match: ['verrazzano', 'verrazano'], reach: 2600, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 141, sag: 0.1,
      deck: 'double', stations: [[40.6081, -74.0521], [40.6051, -74.0373]], towerCol: 0x9a9ea3, cableCol: 0x7d8186, pad: 45 } },
  { id: '25-de-abril', name: 'PONTE 25 DE ABRIL', lat: 38.6892, lon: -9.1774, kind: 'bridge', base: 1013, h: 120,
    bridge: { match: ['25 de abril', 'abril'], reach: 2600, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 120, sag: 0.1,
      deck: 'double', stations: [[38.6935, -9.1760], [38.6849, -9.1790]], towerCol: 0xc4472f, cableCol: 0xc4472f, steelCol: 0xc4472f, pad: 40 } },
  { id: 'bosphorus', name: '15 JULY MARTYRS BRIDGE', lat: 41.0455, lon: 29.0344, kind: 'bridge', base: 1074, h: 101,
    bridge: { match: ['bosphorus', 'boğaziçi', 'bogazici', '15 temmuz', 'martyrs'], reach: 2200, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 101, sag: 0.1,
      stations: [[41.0453, 29.0281], [41.0457, 29.0407]], towerCol: 0x8f9397, cableCol: 0x6e7276, pad: 40 } },
  { id: 'hell-gate', name: 'HELL GATE BRIDGE', lat: 40.7822, lon: -73.9217, kind: 'bridge', base: 298, h: 60,
    bridge: { match: ['hell gate'], reach: 1100, form: 'arch', arch: 'through', rise: 0.2, ends: 'pylons',
      towerCol: 0x6b5a4c, cableCol: 0x6b5a4c, stoneCol: 0x8c8378, pad: 0 } },
  { id: 'severn', name: 'SEVERN BRIDGE', lat: 51.6096, lon: -2.6379, kind: 'bridge', base: 988, h: 100,
    bridge: { match: ['severn bridge'], reach: 1600, form: 'suspension', tower: 'portal', cables: 'suspension', towerM: 100, sag: 0.1,
      stations: [[51.6074, -2.6317], [51.6118, -2.6441]], towerCol: 0xdcdcd8, cableCol: 0xbfbfbc, pad: 35 } },
  { id: 'alamillo', name: 'PUENTE DEL ALAMILLO', lat: 37.4137, lon: -5.9950, kind: 'bridge', base: 200, h: 142,
    bridge: { match: ['alamillo'], reach: 700, form: 'cable-stayed', tower: 'mast', cables: 'harp', towerM: 142,
      stations: [[37.4128, -5.9958]], towerCol: 0xe9e9e6, cableCol: 0xf0f0ee, pad: 30 } },
];
