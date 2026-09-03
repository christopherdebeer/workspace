/**
 * Cut a polyline down to the runs that lie inside a lat/lon box.
 *
 * This is what makes the terrain gate mean anything. Overpass `out geom`
 * returns a way's COMPLETE geometry, never clipped to the bbox that asked for
 * it — Badwater Road comes back as one way spanning 34km — so "gate the tile on
 * the terrain under it" was gating a 600m tile and then building 34km of road,
 * 72% of it over ground where sampleHeight has no data and answers 0.
 *
 * ── WHY THIS IS LIANG-BARSKY AND NOT A WALK OVER THE VERTICES ──
 *
 * The first version stepped the vertices and emitted a run whenever a vertex
 * was INSIDE, adding the crossing point where it entered or left. That covers
 * three of the four cases and silently drops the fourth: a segment whose two
 * endpoints are both outside but which passes THROUGH the box. No vertex is
 * ever inside, so the walk never opens a run, and the tile draws nothing at all
 * where a road plainly crosses it.
 *
 * Reported from the seat driving Edge Hill to Ben Nevis at Senqu: short
 * segments missing, every one of them where a road clips the CORNER of a tile
 * between two nodes — metres of gap, in a road that is unbroken on the
 * overview layer (which does not clip) and unbroken in the tile's own data
 * (measured: every way crossing a tile is present in that tile's response).
 * The data was never the problem; this function was.
 *
 * Per-segment parametric clipping has no such case split. Each segment yields
 * the interval [t0,t1] of itself that is inside the box, or nothing, and the
 * four cases — wholly in, entering, leaving, passing through — all fall out of
 * the same arithmetic.
 *
 * ADJACENT TILES STILL MEET EXACTLY. Both sides solve the same edge line
 * against the same endpoints, so the crossing point is the same double; the
 * pieces abut with neither a gap nor doubled geometry.
 */
export interface LatLon { lat: number; lon: number }
export interface LatLonBox { latN: number; latS: number; lonW: number; lonE: number }

export function clipToBounds(geom: LatLon[], b: LatLonBox): LatLon[][] {
  const runs: LatLon[][] = [];
  let cur: LatLon[] = [];
  const close = (): void => {
    if (cur.length > 1) runs.push(cur);
    cur = [];
  };
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1], c = geom[i];
    const dLat = c.lat - a.lat, dLon = c.lon - a.lon;
    let t0 = 0, t1 = 1;
    // p·t <= q for each of the four half-planes; a zero denominator is a
    // segment parallel to that edge, which is inside iff q >= 0.
    const edge = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    const hit = edge(-dLat, a.lat - b.latS) && edge(dLat, b.latN - a.lat)
      && edge(-dLon, a.lon - b.lonW) && edge(dLon, b.lonE - a.lon);
    // A segment that merely GRAZES a corner has t0 === t1: no interior extent
    // at all. The vertex walk could not produce one of these because it never
    // looked at such a segment; this arithmetic can, and a two-point run whose
    // points are identical is a zero-length ribbon with no direction to build
    // a normal from. It contributes nothing, so it contributes nothing.
    if (!hit || t1 <= t0) { close(); continue; }
    const at = (t: number): LatLon => ({ lat: a.lat + dLat * t, lon: a.lon + dLon * t });
    const p0 = t0 === 0 ? a : at(t0);
    const p1 = t1 === 1 ? c : at(t1);
    // A run continues only where this segment's entry is the previous one's
    // exit — otherwise the polyline left the box in between and this is a new
    // piece. Compared exactly: both came off the same arithmetic on the same
    // shared vertex, so an epsilon here would only ever join two runs that
    // should not be joined.
    const last = cur[cur.length - 1];
    if (!last || last.lat !== p0.lat || last.lon !== p0.lon) {
      close();
      cur = [p0];
    }
    cur.push(p1);
    // Left the box before the segment ended: whatever comes next starts a new
    // run, if it comes back at all.
    if (t1 < 1) close();
  }
  close();
  return runs;
}
