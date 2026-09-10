/**
 * ── WHAT GROWS HERE THAT THE CLIMATE CANNOT PREDICT ──
 *
 * `climate.ts` answers the physics: heat, water, when the water arrives, how
 * far the sea is, what the slope faces. Two sites with the same answers grow
 * the same thing — except that they demonstrably do not. The Cape is an
 * ordinary Mediterranean climate, indistinguishable from coastal California or
 * the Algarve on every number the sampler produces, and it grows fynbos: a
 * fine-leaved sclerophyll shrubland with no trees in it, structurally unlike
 * chaparral and completely unlike a cork oak wood. The difference is not
 * climatic. It is four hundred million years of separate history, and no
 * refinement of a temperature and a rainfall will ever reach it.
 *
 * So it is looked up, not computed. RESOLVE Ecoregions 2017 — 846 regions in
 * 14 biomes, the standard terrestrial partition — served through the cell's
 * read-through tile cache at `~/eco/v1/{z}/{x}/{y}`, one coarse zoom.
 *
 * THIS MODULE IS PURE, and that is the point: the tile decode and the point
 * test have no THREE, no DOM, no fetch and no module state of the world in
 * them, so `devtools/eco.test.mjs` drives the SHIPPING functions over real
 * payloads in node in about a second. The wiring — which tile to ask for, when
 * to ask, where to put the answer — is main.ts's business and lives there.
 */

/** One region as the cell trims it. `g` is GeoJSON in lon/lat. */
export interface EcoRaw {
  id: number;
  biome: number;
  name: string;
  realm: string;
  g: { type: string; coordinates: unknown } | null;
}

export interface EcoTilePayload {
  v?: number;
  regions?: EcoRaw[];
}

/** A ring is a flat run of lon,lat pairs — flat because a region is up to a
 *  few thousand points and the point test walks it per query, and an array of
 *  two-element arrays is a pointer chase per vertex for no benefit. */
type Ring = Float64Array;

/** One polygon: the outer ring, then any holes. */
interface Poly {
  outer: Ring;
  holes: Ring[];
  /** lonW, latS, lonE, latN — the reject that stops most queries dead. */
  bb: [number, number, number, number];
}

export interface EcoRegion {
  id: number;
  /** RESOLVE's biome number, 1–14. The coarse fallback where a name means
   *  nothing to the guild rules yet. */
  biome: number;
  name: string;
  realm: string;
  polys: Poly[];
  bb: [number, number, number, number];
}

/** What a lookup answers with. `null` is "no terrestrial ecoregion here",
 *  which over most of the planet is the true answer and not a miss. */
export interface EcoHit {
  id: number;
  biome: number;
  name: string;
  realm: string;
}

const ringOf = (pts: unknown): Ring | null => {
  if (!Array.isArray(pts) || pts.length < 4) return null;
  const r = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    if (!Array.isArray(p) || p.length < 2) return null;
    const lon = Number(p[0]), lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    r[i * 2] = lon;
    r[i * 2 + 1] = lat;
  }
  return r;
};

function bboxOf(r: Ring): [number, number, number, number] {
  let lonW = Infinity, latS = Infinity, lonE = -Infinity, latN = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < lonW) lonW = r[i];
    if (r[i] > lonE) lonE = r[i];
    if (r[i + 1] < latS) latS = r[i + 1];
    if (r[i + 1] > latN) latN = r[i + 1];
  }
  return [lonW, latS, lonE, latN];
}

function polyOf(rings: unknown): Poly | null {
  if (!Array.isArray(rings) || !rings.length) return null;
  const outer = ringOf(rings[0]);
  if (!outer) return null;
  const holes: Ring[] = [];
  for (let i = 1; i < rings.length; i++) {
    const h = ringOf(rings[i]);
    if (h) holes.push(h);
  }
  return { outer, holes, bb: bboxOf(outer) };
}

/**
 * Decode one tile's payload into regions ready to be asked about.
 *
 * FORGIVING BY DESIGN. A region whose geometry will not parse is dropped and
 * the rest of the tile is kept: the alternative is that one malformed feature
 * anywhere on a 1250km tile takes the whole continent's ecology with it, and
 * the failure mode of a missing region — the climate's own guess — is far
 * milder than the failure mode of a missing tile.
 */
export function decodeEcoTile(data: EcoTilePayload | null | undefined): EcoRegion[] {
  const out: EcoRegion[] = [];
  for (const r of data?.regions ?? []) {
    const g = r?.g;
    if (!g || !g.coordinates) continue;
    const polys: Poly[] = [];
    if (g.type === 'Polygon') {
      const p = polyOf(g.coordinates);
      if (p) polys.push(p);
    } else if (g.type === 'MultiPolygon') {
      for (const rings of g.coordinates as unknown[]) {
        const p = polyOf(rings);
        if (p) polys.push(p);
      }
    }
    if (!polys.length) continue;
    let lonW = Infinity, latS = Infinity, lonE = -Infinity, latN = -Infinity;
    for (const p of polys) {
      if (p.bb[0] < lonW) lonW = p.bb[0];
      if (p.bb[1] < latS) latS = p.bb[1];
      if (p.bb[2] > lonE) lonE = p.bb[2];
      if (p.bb[3] > latN) latN = p.bb[3];
    }
    out.push({
      id: Number(r.id), biome: Number(r.biome),
      name: String(r.name ?? ''), realm: String(r.realm ?? ''),
      polys, bb: [lonW, latS, lonE, latN],
    });
  }
  return out;
}

/**
 * EVEN-ODD RAY CASTING, eastward.
 *
 * The half-open comparison (`>` on one end, `<=` on the other) is what makes a
 * vertex exactly on the ray count once rather than twice or never — the
 * classic failure of this test, and it fires constantly here because the
 * server simplifies to 0.05° and leaves long runs of vertices on the same
 * parallel.
 */
function inRing(r: Ring, lon: number, lat: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = r[i * 2 + 1], yj = r[j * 2 + 1];
    if ((yi > lat) === (yj > lat)) continue;
    const xi = r[i * 2], xj = r[j * 2];
    if (lon < xi + ((lat - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
  }
  return inside;
}

/**
 * Which region holds this point, or null.
 *
 * REGIONS OVERLAP AT THEIR EDGES once the geometry has been simplified to five
 * kilometres, so the first hit wins and the order the cell sent them in is the
 * order they are tried. That is arbitrary and it is fine: the two candidates
 * at a five-kilometre seam are the two regions that genuinely meet there, and
 * a coastline's worth of ambiguity about which side of a boundary a stand of
 * trees sits on is not a defect this dataset can settle.
 */
export function ecoLookup(regions: EcoRegion[], lon: number, lat: number): EcoHit | null {
  for (const reg of regions) {
    if (lon < reg.bb[0] || lon > reg.bb[2] || lat < reg.bb[1] || lat > reg.bb[3]) continue;
    for (const p of reg.polys) {
      if (lon < p.bb[0] || lon > p.bb[2] || lat < p.bb[1] || lat > p.bb[3]) continue;
      if (!inRing(p.outer, lon, lat)) continue;
      let holed = false;
      for (const h of p.holes) { if (inRing(h, lon, lat)) { holed = true; break; } }
      if (holed) continue;
      return { id: reg.id, biome: reg.biome, name: reg.name, realm: reg.realm };
    }
  }
  return null;
}

/**
 * RESOLVE's fourteen biomes, by number. Kept here rather than derived, because
 * the guild rules want a coarse structural class wherever a region NAME means
 * nothing to them yet — 846 names is a lookup table nobody should have to
 * write before the first tree changes shape.
 */
export const ECO_BIOMES: Record<number, string> = {
  1: 'Tropical moist broadleaf forest',
  2: 'Tropical dry broadleaf forest',
  3: 'Tropical conifer forest',
  4: 'Temperate broadleaf and mixed forest',
  5: 'Temperate conifer forest',
  6: 'Boreal forest / taiga',
  7: 'Tropical grassland and savanna',
  8: 'Temperate grassland and savanna',
  9: 'Flooded grassland and savanna',
  10: 'Montane grassland and shrubland',
  11: 'Tundra',
  12: 'Mediterranean forest, woodland and scrub',
  13: 'Desert and xeric shrubland',
  14: 'Mangrove',
};

export const ecoBiomeName = (n: number): string => ECO_BIOMES[n] ?? 'unclassified';

/** The z5 tile holding a point. One zoom, so the level is not a parameter —
 *  see the cell route, which refuses anything else. */
export const ECO_Z = 5;
export function ecoTileOf(lat: number, lon: number): [number, number] {
  const n = 2 ** ECO_Z;
  const la = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const x = Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * n);
  const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}
