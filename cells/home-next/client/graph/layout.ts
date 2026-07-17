/* ---------------------------------------------------------------------------
 * graph/layout.ts — the layout ALGORITHM: ranks, focus band, and place
 * clustering.
 *
 * The pure, Three-free maths the renderer drives: recompute rank/focus-band
 * over the live node set, and compute the constellation PLACE DESCRIPTORS
 * (salience hubs by farthest-point sampling, and membership containers). The
 * scene wiring — turning a descriptor into a Three group/label, animating its
 * approach fade — stays in graph.tsx, because it is inseparable from the live
 * scene. Extracted from the ThreeGraph closure (decomposition, 2026-07-17):
 * this is the part worth isolating (and, later, unit-testing) on its own.
 * ------------------------------------------------------------------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MEMBER_RELS, placeworthy } from './style';

/** A named region of the map, before it becomes a Three constellation. */
export interface PlaceDescriptor {
  name: string;
  x: number; y: number; z: number; r: number;
  authored: boolean;
  key?: string;
}

/**
 * Recompute rank / focus band / visibility over the LIVE node set — the
 * per-batch bookkeeping that used to be one-shot model assembly. Mutates the
 * passed-in `focusKeys` (cleared + refilled) and `byRank` (in place), sets each
 * node's `.rank`, and RETURNS the new visible-node count (the caller assigns it).
 */
export function recomputeRanks(
  nodes: any[],
  focusThreshold: number,
  focusKeys: Set<string>,
  byRank: any[],
  visFrac: number,
): number {
  const byScore = nodes.filter((n) => !n.deleted).sort((a, b) => b.score - a.score);
  byScore.forEach((n, i) => { n.rank = i; });
  const tierCount = byScore.filter((n) => n.score >= focusThreshold).length;
  const bandN = Math.min(byScore.length, Math.max(tierCount, Math.ceil(byScore.length * 0.12), Math.min(12, byScore.length)));
  focusKeys.clear();
  for (let i = 0; i < bandN; i++) focusKeys.add(byScore[i].id);
  byRank.length = 0;
  byRank.push(...byScore);
  return visFrac >= 0.999 ? byScore.length : Math.max(focusKeys.size, Math.round(byScore.length * visFrac));
}

/**
 * Computed places: spatially distributed salience hubs (farthest-point
 * sampling so the dense core doesn't name every territory), each named by a
 * truly dominant member type ("notes quarter") or its most salient
 * word-shaped member. Returns descriptors; the caller creates the labels.
 */
export function salienceHubPlaces(nodes: any[], byRank: any[], SPREAD: number): PlaceDescriptor[] {
  const out: PlaceDescriptor[] = [];
  const R_EX = SPREAD * 0.55, R_MEM = SPREAD * 0.45;
  const d2 = (a: any, b: any): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  const pool = byRank.slice(0, Math.min(byRank.length, 480));
  const hubs: any[] = pool.length ? [pool[0]] : [];
  while (hubs.length < 12 && hubs.length < pool.length) {
    let best: any = null, bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const n = pool[i];
      if (hubs.includes(n)) continue;
      const minD2 = Math.min(...hubs.map((h) => d2(h, n)));
      const salienceWeight = 0.42 + 0.58 * (1 - i / Math.max(1, pool.length - 1));
      const score = minD2 * salienceWeight;
      if (score > bestScore) { best = n; bestScore = score; }
    }
    if (!best || bestScore < R_EX * R_EX * 0.12) break;
    hubs.push(best);
  }
  for (const h of hubs) {
    const members = nodes.filter((n: any) => d2(n, h) < R_MEM * R_MEM);
    if (members.length < 6) continue; // a place needs a population
    const counts = new Map<string, number>();
    for (const m of members) if (m.type) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
    let topType: string | null = null, topN = 0;
    for (const [t, c] of counts) if (c > topN) { topType = t; topN = c; }
    // Name the region: a truly dominant type ("notes"), else the most salient
    // member whose title reads as WORDS — a region with only key-shaped names
    // (machine runs, dated logs) gets no caption at all rather than a plumbing
    // key in display caps.
    let name: string | null = null;
    if (topType && topN / members.length >= 0.5) {
      name = topType.endsWith('s') || topType === 'knowledge' ? topType : `${topType}s`;
    } else {
      const speaker = members
        .filter((m: any) => placeworthy(m.label))
        .sort((a: any, b: any) => (a.rank ?? nodes.length) - (b.rank ?? nodes.length))[0];
      if (speaker) name = String(speaker.label);
    }
    if (!name) continue;
    name = name.length > 24 ? name.slice(0, 23) + '…' : name;
    const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
    const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
    const cz = members.reduce((s: number, m: any) => s + m.z, 0) / members.length;
    const dists = members.map((m: any) => Math.hypot(m.x - cx, m.y - cy, m.z - cz)).sort((a: number, b: number) => a - b);
    const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
    out.push({ name, x: cx, y: cy, z: cz, r: cr, authored: false });
  }
  return out;
}

/**
 * Authored places — MEMBERSHIP CONTAINERS. Boards, docs, and views already
 * name their members through placement edges (onBoard/inDoc/inView); a
 * container enough members point at IS an authored place. Descriptors carry
 * the container's fact `key` so the caption can become a live door to it.
 */
export function membershipPlaces(
  links: any[],
  nodeById: Map<string, any>,
  idOf: (x: any) => string,
  SPREAD: number,
): PlaceDescriptor[] {
  const out: PlaceDescriptor[] = [];
  const memberOf = new Map<string, any[]>();
  for (const l of links) {
    if (!MEMBER_RELS.has(l.rel)) continue;
    const m = nodeById.get(idOf(l.source));
    const c = nodeById.get(idOf(l.target));
    if (!m || !c) continue;
    const arr = memberOf.get(c.id) ?? [];
    arr.push(m);
    memberOf.set(c.id, arr);
  }
  for (const [cid, members] of memberOf) {
    if (members.length < 4) continue; // a place needs a population
    const c = nodeById.get(cid);
    const rawName = String(c?.label ?? cid);
    if (!placeworthy(rawName)) continue;
    const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
    const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
    const cz = members.reduce((s: number, m: any) => s + m.z, 0) / members.length;
    const dists = members.map((m: any) => Math.hypot(m.x - cx, m.y - cy, m.z - cz)).sort((a: number, b: number) => a - b);
    const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
    out.push({ name: rawName.length > 24 ? rawName.slice(0, 23) + '…' : rawName, x: cx, y: cy, z: cz, r: cr, authored: true, key: cid });
  }
  return out;
}
