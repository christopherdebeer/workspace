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
  kind: 'pyramid' | 'step-pyramid' | 'obelisk' | 'spire' | 'ring';
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
];
