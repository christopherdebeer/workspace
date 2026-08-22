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
  kind: 'pyramid';
  /** Base side length, metres. */
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
];
