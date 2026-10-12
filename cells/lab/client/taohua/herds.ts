/**
 * Taohua: where deer are. Now and then, not often, a few sika deer (梅花鹿, the plum-blossom deer,
 * their coats spotted white) stand somewhere off a way: grazing in the open, or drinking at a pool's
 * edge. Never on a way nor close by one: a little way off, where they're seen as the print sees its
 * figures, in the middle distance.
 *
 * Laid out from the seed and the ways alone, a stretch of the hill at a time (so the trees can keep
 * clear of them): in each stretch, most often one place, or none; at it, one to three deer, a stag,
 * a doe, a fawn.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { inStation, stationsNear } from './compose';
import { Ways } from './ways';

export type DeerKind = 'stag' | 'doe' | 'fawn';
export interface DeerAt { kind: DeerKind; x: number; z: number; yaw: number }
export interface DeerSite { k: number; x: number; z: number; drink: boolean; deer: DeerAt[] }

/** how long a stretch of the hill is (m), up it; in each, at most one place */
const STRETCH = 320;
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

const memo = new Map<string, DeerSite | null>();
/** The places deer are, from z0 to z1 up the hill. */
export function deerNear(ways: Ways, seed: number, z0: number, z1: number): DeerSite[] {
  const out: DeerSite[] = [];
  for (let b = Math.max(0, Math.floor((z0 - 40) / STRETCH)); b <= Math.floor((z1 + 40) / STRETCH); b++) {
    const key = `${seed}:${b}`;
    if (!memo.has(key)) memo.set(key, siteOf(ways, seed, b));
    const s = memo.get(key);
    if (s && s.z > z0 - 40 && s.z < z1 + 40) out.push(s);
  }
  return out;
}
/** whether (x, z) is clear of the deer, by so much (for trees and rocks to keep off them) */
export function clearOfDeer(sites: DeerSite[], x: number, z: number, m: number): boolean {
  for (const s of sites) for (const d of s.deer) if (Math.hypot(x - d.x, z - d.z) < m) return false;
  return true;
}

/** a place, fit for deer: off the ways, but not far; on dry ground; clear of terraces and casts */
function fits(ways: Ways, seed: number, x: number, z: number, near = false, dry = 0.8): boolean {
  const d = ways.nearest(x, z).d;
  if (d < (near ? 3.8 : 4.5) || d > 11) return false;
  if (ways.dryOf(x, z) < dry) return false;
  for (const j of ways.junctionsNear(z - 14, z + 14)) if (Math.hypot(j.x - x, j.z - z) < (j.reach ? j.reach + 7 : 4)) return false;
  return !inStation(stationsNear(ways, seed, z - 12, z + 12), x, z, 2);
}

function siteOf(ways: Ways, seed: number, b: number): DeerSite | null {
  const r = seeded(hash(seed, b, 0xdee7));
  // (most stretches have a place; some none)
  if (b === 0 || r() < 0.3) return null;
  const za = b * STRETCH + 30, zb = (b + 1) * STRETCH - 30;
  // (at a pool's edge, if there's one here and it's fitting: drinking)
  const pools = ways.water.streamsNear(za, zb).flatMap((s) => s.pools).filter((p) => p.z > za && p.z < zb && p.kind !== 'spring');
  for (let t = 0; t < 24 && pools.length && r() < 0.95; t++) {
    const p = pools[Math.floor(r() * pools.length)], a = r() * Math.PI * 2;
    const e = 1 + ramp(r, 0.35, 0.8) / Math.min(p.rx, p.rz);
    const x = p.x + Math.cos(a) * p.rx * e, z = p.z + Math.sin(a) * p.rz * e;
    if (!fits(ways, seed, x, z, false, 0.05)) continue;
    const yaw = Math.atan2(p.x - x, p.z - z);
    return group(ways, seed, b, r, x, z, yaw, true);
  }
  // (else out in the open, a little off a way)
  for (let t = 0; t < 40; t++) {
    const z = ramp(r, za, zb), ws = ways.waysNear(z - 3, z + 3);
    if (!ws.length) continue;
    const w = ws[Math.floor(r() * ws.length)], u = ramp(r, 0, w.len), at = ways.at(w, u, true);
    const side = r() < 0.5 ? -1 : 1, d = ramp(r, 4.5, 8);
    const x = at.p[0] + at.dir[1] * d * side, zz = at.p[2] - at.dir[0] * d * side;
    if (!fits(ways, seed, x, zz) || ways.dryOf(x, zz) < 2.5) continue;
    return group(ways, seed, b, r, x, zz, r() * Math.PI * 2, false);
  }
  return null;
}

/** one to three deer about a place, each turned its own way (drinking, all toward the water) */
function group(ways: Ways, seed: number, k: number, r: Rand, x: number, z: number, yaw: number, drink: boolean): DeerSite {
  const n = r() < 0.35 ? 1 : r() < 0.65 ? 2 : 3;
  const kinds: DeerKind[] = n === 1 ? [r() < 0.5 ? 'stag' : 'doe'] : n === 2 ? (r() < 0.5 ? ['stag', 'doe'] : ['doe', 'fawn']) : ['stag', 'doe', 'fawn'];
  const deer: DeerAt[] = [{ kind: kinds[0], x, z, yaw: yaw + ramp(r, -0.3, 0.3) }];
  for (const kind of kinds.slice(1)) {
    for (let t = 0; t < 12; t++) {
      const a = r() * Math.PI * 2, d = kind === 'fawn' ? ramp(r, 0.9, 1.6) : ramp(r, 1.6, 2.6);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!fits(ways, seed, px, pz, true, drink ? 0.05 : 0.8) || deer.some((o) => Math.hypot(o.x - px, o.z - pz) < 0.9)) continue;
      deer.push({ kind, x: px, z: pz, yaw: drink ? yaw + ramp(r, -0.4, 0.4) : r() * Math.PI * 2 });
      break;
    }
  }
  return { k, x, z, drink, deer };
}
