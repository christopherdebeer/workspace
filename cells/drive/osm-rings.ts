/**
 * ── A RELATION'S RINGS, ASSEMBLED ONCE, AT THE PROXY ──
 *
 * Anything in OSM larger than a pond is a `type=multipolygon` relation —
 * `natural=water` with `water=river` for a wide river, `water=lagoon` for an
 * estuary — and the tile query fetched ways only, so those outlines never
 * reached the client: hydro was left with the `waterway=river` centreline
 * and buffered it by a class default. Overpass answers `out geom` on a
 * relation with every member way's geometry inline; this joins those ways
 * end to end into closed rings, sorts inner rings into the outer that
 * contains them, and hands back polygons the client can use as-is.
 *
 * Done here rather than on the phone because a tile is fetched once and
 * cached for a week, and because the answer is the same for everyone.
 *
 * A relation past `maxPoints` is dropped, not truncated: a lake with a
 * hundred kilometres of shore would land in every tile along it, and the
 * cover raster already gives hydro those giants (see client/inland-water).
 */

export interface RelationMember {
  type?: string;
  ref?: number;
  role?: string;
  geometry?: Array<{ lat: number; lon: number }>;
}

export type LatLon = [number, number];

export interface RelationRing {
  outer: LatLon[];
  holes: LatLon[][];
}

const key = (p: LatLon): string => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/** Join open ways end to end into closed rings; an unclosable chain is dropped. */
export function joinWays(ways: LatLon[][]): LatLon[][] {
  const used = new Uint8Array(ways.length);
  const rings: LatLon[][] = [];
  for (let i = 0; i < ways.length; i++) {
    if (used[i] || ways[i].length < 2) continue;
    used[i] = 1;
    const chain = ways[i].slice();
    let guard = 0;
    while (key(chain[0]) !== key(chain[chain.length - 1]) && guard++ < ways.length) {
      const end = key(chain[chain.length - 1]);
      let joined = false;
      for (let j = 0; j < ways.length; j++) {
        if (used[j] || ways[j].length < 2) continue;
        const w = ways[j];
        if (key(w[0]) === end) { chain.push(...w.slice(1)); used[j] = 1; joined = true; break; }
        if (key(w[w.length - 1]) === end) { chain.push(...w.slice(0, -1).reverse()); used[j] = 1; joined = true; break; }
      }
      if (!joined) break;
    }
    if (key(chain[0]) === key(chain[chain.length - 1]) && chain.length >= 4) rings.push(chain);
  }
  return rings;
}

export function pointInRing(lat: number, lon: number, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i], [aj, bj] = ring[j];
    if ((bi > lon) !== (bj > lon) && lat < ((aj - ai) * (lon - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

/** The relation's polygons, or null when it has no closed outer ring or is
 *  larger than `maxPoints` in total. Coordinates are rounded to 1e-6 like
 *  every other tile geometry. */
export function assembleRelationRings(members: RelationMember[], maxPoints = 6000): RelationRing[] | null {
  const outers: LatLon[][] = [], inners: LatLon[][] = [];
  let total = 0;
  for (const m of members) {
    if (m.type !== 'way' || !m.geometry?.length) continue;
    total += m.geometry.length;
    if (total > maxPoints) return null;
    const pts: LatLon[] = m.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)]);
    (m.role === 'inner' ? inners : outers).push(pts);
  }
  const outerRings = joinWays(outers);
  if (!outerRings.length) return null;
  const rings: RelationRing[] = outerRings.map((outer) => ({ outer, holes: [] }));
  for (const hole of joinWays(inners)) {
    const [lat, lon] = hole[0];
    const host = rings.find((r) => pointInRing(lat, lon, r.outer));
    if (host) host.holes.push(hole);
  }
  return rings;
}
