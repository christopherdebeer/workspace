/**
 * ── THE BAKED SKELETONS, STOOD UP ──
 *
 * flora-ez-baked.ts carries EZ-Tree skeletons the bake devtool generated:
 * the wood as quantised positions and indices, and the anchors where the
 * package would have hung its leaf cards. This module turns each variant into
 * ONE geometry an InstancedMesh draws — the wood, and a crown made of Drive's
 * own blobs on those anchors (an icosahedron per anchor for a broadleaf, an
 * open four-sided frond for a conifer, nothing for a snag) — with the same
 * faceTone bake every shipping plant gets. Wood and crown share the draw
 * because a vertex knows which it is (`aWood`), and the material colours the
 * two apart: the crown takes the instance's colour, the wood a bark colour.
 * No package, no textures, no generation at play time: decoding all the
 * variants is a few milliseconds once.
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
  /** Wood and crown in one, with `aWood` per vertex and faceTone in `color`. */
  geometry: THREE.BufferGeometry;
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
  return faceTone(g, 0.16, 0.36);
}

function crownOf(v: EzBakedVariant, fam: EzBakedFamily, q: number): THREE.BufferGeometry | null {
  if (fam.shape === 'none' || v.anchors === 0) return null;
  const A = int16(v.anc);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 3 <= A.length; i += 3) {
    // The frond is open at its base: a cone seen from the road never shows
    // its underside, and four triangles is what fifteen of them a tree can
    // afford across a thousand trees.
    const g = fam.shape === 'cone'
      ? new THREE.ConeGeometry(fam.crown, fam.crown * 1.6, 4, 1, true)
      : new THREE.IcosahedronGeometry(fam.crown, 0);
    g.translate(A[i] / q, A[i + 1] / q, A[i + 2] / q);
    parts.push(g);
  }
  const crown = mergeGeos(parts);
  return fam.shape === 'cone' ? faceTone(crown, 0.16, 0.3) : faceTone(crown);
}

/** Wood (indexed) and crown (soup) into one indexed geometry with `aWood`. */
function join(wood: THREE.BufferGeometry, crown: THREE.BufferGeometry | null): THREE.BufferGeometry {
  const wp = wood.getAttribute('position') as THREE.BufferAttribute;
  const wc = wood.getAttribute('color') as THREE.BufferAttribute;
  const wi = wood.index as THREE.BufferAttribute;
  const cp = crown?.getAttribute('position') as THREE.BufferAttribute | undefined;
  const cc = crown?.getAttribute('color') as THREE.BufferAttribute | undefined;
  const nW = wp.count, nC = cp ? cp.count : 0;
  const pos = new Float32Array((nW + nC) * 3);
  const col = new Float32Array((nW + nC) * 3);
  const wdF = new Float32Array(nW + nC);
  pos.set(wp.array as Float32Array, 0);
  col.set(wc.array as Float32Array, 0);
  wdF.fill(1, 0, nW);
  if (cp && cc) {
    pos.set(cp.array as Float32Array, nW * 3);
    col.set(cc.array as Float32Array, nW * 3);
  }
  const idx = new Uint16Array(wi.count + nC);
  idx.set(wi.array as Uint16Array, 0);
  for (let i = 0; i < nC; i++) idx[wi.count + i] = nW + i;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWood', new THREE.BufferAttribute(wdF, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
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
    const geometry = join(wood, crown);
    return { name: v.name, geometry, tris: (geometry.index as THREE.BufferAttribute).count / 3, anchors: v.anchors };
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

/** The one material for every skeleton: the crown wears the instance's
 *  colour, the wood a bark colour, both under the faceTone in `color`. Built
 *  on the leaf material's terms (white, flat, vertex colours) so a caller can
 *  add the same grain it gives the other plants. */
export function ezMaterial(bark: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  const uWood = { value: new THREE.Color(bark) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWood = uWood;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWood; uniform vec3 uWood;')
      .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex
        .replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(instanceColor.xyz, uWood, aWood);'));
  };
  return mat;
}
