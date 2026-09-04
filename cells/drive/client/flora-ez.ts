/**
 * ── THE BAKED SKELETONS, STOOD UP ──
 *
 * flora-ez-baked.ts carries EZ-Tree skeletons the bake devtool generated:
 * the wood as quantised positions and indices, and the anchors where the
 * package would have hung its leaf cards. This module turns each variant into
 * the two geometries an InstancedMesh pair draws — the wood, and a crown made
 * of Drive's own blobs on those anchors (an icosahedron per anchor for a
 * broadleaf, a squat cone for a conifer, nothing for a snag) — with the same
 * faceTone bake every shipping plant gets. No package, no textures, no
 * generation at play time: decoding all fourteen variants is a few
 * milliseconds once.
 *
 * Units: a variant stands on y=0 with its top at y=1; the world scales it by
 * the site's height, so the crown radius is a fraction of that height too.
 */
import * as THREE from 'three';
import { EZ_BAKE, type EzBakedFamily, type EzBakedVariant } from './flora-ez-baked';
import { faceTone, mergeGeos } from './flora';

export type EzFamily = keyof typeof EZ_BAKE.families;

export interface EzVariant {
  name: string;
  wood: THREE.BufferGeometry;
  /** Empty for a snag. */
  crown: THREE.BufferGeometry;
  /** Wood + crown triangles, for the bill. */
  tris: number;
  anchors: number;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const int16 = (b64: string): Int16Array => { const u = bytes(b64); return new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1); };
const uint16 = (b64: string): Uint16Array => { const u = bytes(b64); return new Uint16Array(u.buffer, u.byteOffset, u.byteLength >> 1); };

function woodOf(v: EzBakedVariant, q: number): THREE.BufferGeometry {
  const P = int16(v.pos), I = uint16(v.idx);
  const pos = new Float32Array(P.length);
  for (let i = 0; i < P.length; i++) pos[i] = P[i] / q;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeVertexNormals();
  return faceTone(g, 0.16, 0.36);
}

function crownOf(v: EzBakedVariant, fam: EzBakedFamily, q: number): THREE.BufferGeometry {
  if (fam.shape === 'none' || v.anchors === 0) return new THREE.BufferGeometry();
  const A = int16(v.anc);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 3 <= A.length; i += 3) {
    const g = fam.shape === 'cone'
      ? new THREE.ConeGeometry(fam.crown, fam.crown * 1.6, 5)
      : new THREE.IcosahedronGeometry(fam.crown, 0);
    g.translate(A[i] / q, A[i + 1] / q, A[i + 2] / q);
    parts.push(g);
  }
  const crown = mergeGeos(parts);
  return fam.shape === 'cone' ? faceTone(crown, 0.16, 0.3) : faceTone(crown);
}

const cache = new Map<EzFamily, EzVariant[]>();

/** Every baked variant of a family, decoded once. */
export function ezVariants(family: EzFamily): EzVariant[] {
  let out = cache.get(family);
  if (out) return out;
  const fam = EZ_BAKE.families[family];
  out = fam.variants.map((v) => {
    const wood = woodOf(v, EZ_BAKE.q);
    const crown = crownOf(v, fam, EZ_BAKE.q);
    const crownTris = crown.getAttribute('position') ? (crown.getAttribute('position') as THREE.BufferAttribute).count / 3 : 0;
    return { name: v.name, wood, crown, tris: v.tris + crownTris, anchors: v.anchors };
  });
  cache.set(family, out);
  return out;
}

/** The crown's reach above the wood's top, as a fraction of height — what the
 *  world adds when it wants the whole tree under a given height. */
export function ezCrownReach(family: EzFamily): number {
  const fam = EZ_BAKE.families[family];
  return fam.shape === 'cone' ? fam.crown * 0.8 : fam.crown;
}

/** A stable variant index for a site, so a tree keeps its skeleton across
 *  refreshes and its neighbours differ. */
export function ezVariantFor(family: EzFamily, x: number, z: number): number {
  const n = EZ_BAKE.families[family].variants.length;
  const h = (Math.imul(Math.round(x * 8), 73856093) ^ Math.imul(Math.round(z * 8), 19349663)) >>> 0;
  return n ? h % n : 0;
}
