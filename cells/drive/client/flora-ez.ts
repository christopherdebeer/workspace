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
import { EZ_BAKE, type EzBakedVariant, type EzForm } from './flora-ez-baked';
export type { EzForm };
import { faceTone, mergeGeos } from './flora';

export type EzFamily = keyof typeof EZ_BAKE.families;

/**
 * THE FAMILIES WITH A BAKED SKELETON.
 *
 * `acacia` and `palm` joined the three because the guild asks for both and the
 * atlas had neither: every savanna and dry-forest row wants an umbrella crown
 * and every mangrove and tropical row a palm, and both were still 20-triangle
 * archetypes while an oak two hundred metres away had real branching.
 *
 * THE LIST AND THE HEIGHTS LIVE HERE, NOT IN THE WORLD. main.ts owns where a
 * tree stands; the atlas owns what the families are and how tall one grows per
 * unit of a site's scale draw. They were module state of main.ts, which meant
 * the flora lab — the surface whose entire job is judging how the vegetation
 * looks — could not draw a single one of the skeletons the game actually
 * draws, and would have had to retype both to try. A lab that retypes what it
 * is inspecting proves something about itself and nothing about what ships.
 */
export const EZ_FAMILIES: EzFamily[] = ['broadleaf', 'conifer', 'acacia', 'palm', 'snag'];
/** A record over every EZ family, built from the list rather than typed out.
 *  Six literals used to name the three families by hand, which is six places
 *  to forget when a fourth arrives — and TypeScript would have caught only the
 *  ones whose type is `Record<EzFamily, …>`. */
export const ezRecord = <T>(fill: (f: EzFamily) => T): Record<EzFamily, T> =>
  Object.fromEntries(EZ_FAMILIES.map((f) => [f, fill(f)])) as Record<EzFamily, T>;
/**
 * HOW TALL A TREE IS, IN METRES. The archetypes stood three to nine metres —
 * a crown on a short post, sized for twenty triangles. A skeleton with real
 * branching wants a real height: a site's scale draw (VEG_SIZE, 1.4–3.6 for
 * a broadleaf, krummholz and the tuning already in it) becomes metres at a
 * rate per family, so an oak stands 8–21 m, a pine 10–26, a snag 4–11, and a
 * treeline spruce is still the short one. The crown's reach rides on top.
 */
export const EZ_M_PER_SCALE: Record<EzFamily, number> = {
  broadleaf: 5.7, conifer: 7.2, snag: 3.6,
  // An umbrella thorn is a SMALL tree — six to twelve metres, and it reads as
  // wide rather than tall, which is most of what makes a savanna look like
  // one. A coconut palm is the opposite: eight to twenty metres of trunk with
  // a tuft on it, so it stands above everything around it and is mostly bare.
  acacia: 3.6, palm: 5.4,
};

export interface EzVariant {
  name: string;
  /** The silhouette class — round, columnar, conic, umbrella, palm or bare —
   *  declared by the recipe and CHECKED against the baked geometry, so it is
   *  a measurement and not a label. See `silhouette` in the bake devtool. */
  form: EzForm;
  /**
   * WHAT TO CALL IT IN A READOUT, which is not what the recipe is called.
   *
   * `name` is the EZ-Tree preset the recipe STARTED from, and every acacia
   * began life as an Oak and every palm as a Pine — so a flora-lab line
   * reporting what the Sundarbans grows read "Pine Small #44 ×35" and a
   * savanna's acacias read "Oak Medium #3". That is a fabricated witness: it
   * looks exactly like the guild planting the wrong tree, and the geometry is
   * in fact correct (the form is MEASURED off the bake). The provenance is
   * still worth keeping — it is how a recipe is found again — so it stays in
   * `name` and the readouts use this.
   */
  label: string;
  /** Wood and crown in one, with `aWood` per vertex and faceTone in `color`. */
  geometry: THREE.BufferGeometry;
  tris: number;
  crown: string;
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

/** Per-card tone, not per-triangle: a card is one leaf and its two
 *  triangles must agree, or every leaf shows a diagonal. The same spread and
 *  foot-in-shadow the other plants get. */
function cardTone(g: THREE.BufferGeometry, spread = 0.2, foot = 0.22): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  g.computeBoundingBox();
  const bb = g.boundingBox as THREE.Box3;
  const y0 = bb.min.y, span = Math.max(1e-3, bb.max.y - y0);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const card = i >> 2;
    let x = Math.imul(card + 1, 2654435761);
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    x = (x ^ (x >>> 13)) >>> 0;
    const t = x / 4294967296;
    const up = (pos.getY(i) - y0) / span;
    const v = (1 + (t - 0.5) * spread) * (1 - foot * (1 - up) * (1 - up));
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function crownOf(v: EzBakedVariant, q: number): THREE.BufferGeometry | null {
  const shape = v.crown.shape;
  if (shape === 'none') return null;
  if (shape === 'card') {
    // The package's own leaf quads, opaque, as they stood on the skeleton.
    const C = int16(v.cards), CI = uint16(v.cardIdx);
    if (!C.length || !CI.length) return null;
    const pos = new Float32Array(C.length);
    for (let i = 0; i < C.length; i++) pos[i] = C[i] / q;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(CI, 1));
    return cardTone(g);
  }
  const A = int16(v.anc);
  if (!A.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  const r = v.crown.r;
  for (let i = 0; i + 3 <= A.length; i += 3) {
    let g: THREE.BufferGeometry;
    if (shape === 'cone') {
      // Open at its base: a frond seen from the road never shows its underside.
      g = new THREE.ConeGeometry(r, r * 1.6, 4, 1, true);
    } else {
      // A pad: an octahedron pressed flat, the way a spruce's foliage lies —
      // eight triangles, and at sixty centimetres no eye tells it from twenty.
      g = shape === 'flat' ? new THREE.OctahedronGeometry(r, 0) : new THREE.IcosahedronGeometry(r, 0);
      if (shape === 'flat') g.scale(1, 0.45, 1);
    }
    g.translate(A[i] / q, A[i + 1] / q, A[i + 2] / q);
    parts.push(g);
  }
  const crown = mergeGeos(parts);
  return shape === 'cone' ? faceTone(crown, 0.16, 0.3) : faceTone(crown);
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
  const ci = crown?.index as THREE.BufferAttribute | null | undefined;
  const nCI = ci ? ci.count : nC;
  const idx = new Uint16Array(wi.count + nCI);
  idx.set(wi.array as Uint16Array, 0);
  if (ci) for (let i = 0; i < nCI; i++) idx[wi.count + i] = nW + (ci.array as Uint16Array)[i];
  else for (let i = 0; i < nC; i++) idx[wi.count + i] = nW + i;
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
    const crown = crownOf(v, EZ_BAKE.q);
    const geometry = join(wood, crown);
    return { name: v.name, form: v.form, geometry,
      tris: (geometry.index as THREE.BufferAttribute).count / 3, crown: v.crown.shape,
      label: '' };
  });
  // Numbered WITHIN a form, so "columnar 2" is the second columnar tree of
  // this family rather than the second variant that happens to be one.
  const seen = new Map<string, number>();
  for (const v of out) {
    const n = (seen.get(v.form) ?? 0) + 1;
    seen.set(v.form, n);
    v.label = `${family} ${v.form} ${n}`;
  }
  cache.set(family, out);
  return out;
}

/** The crown's reach above the wood's top, as a fraction of height — what the
 *  world adds when it wants the whole tree under a given height. */
export function ezCrownReach(family: EzFamily): number {
  // Cards were normalised with the wood, so they add nothing; a blob adds its radius.
  const vs = EZ_BAKE.families[family].variants;
  let reach = 0;
  for (const v of vs) reach += v.crown.shape === 'cone' ? v.crown.r * 0.8 : v.crown.shape === 'card' || v.crown.shape === 'none' ? 0 : v.crown.r;
  return vs.length ? reach / vs.length : 0;
}

/** The triangles the world draws for one tree of a family, on average. */
export function ezMeanTris(family: EzFamily): number {
  return EZ_BAKE.families[family].meanDrawn;
}

/** A stable variant index for a site, so a tree keeps its skeleton across
 *  refreshes and its neighbours differ. `limit` is the SETTINGS instrument:
 *  ONE/TWO/FOUR can prove what the atlas buys without changing where a tree
 *  stands, while ALL remains the shipping answer. */
export function ezVariantFor(family: EzFamily, x: number, z: number, limit = Number.MAX_SAFE_INTEGER): number {
  const available = EZ_BAKE.families[family].variants.length;
  const n = Math.min(available, Math.max(1, Math.floor(limit)));
  const h = (Math.imul(Math.round(x * 8), 73856093) ^ Math.imul(Math.round(z * 8), 19349663)) >>> 0;
  return available ? h % n : 0;
}

/**
 * ── A LANDSCAPE HAS A FEW SPECIES, NOT ALL OF THEM ──
 *
 * `ezVariantFor` above hashes the tree's OWN COORDINATES, at an eighth of a
 * metre. Every silhouette in the family is therefore equally likely at every
 * point, and two trees standing together in one thicket come out a broad oak
 * and a leggy aspen because their positions happened to hash differently. That
 * is the species confetti: it is not variety, it is noise, and it is why a
 * wood in this game has never read as a wood.
 *
 * Real vegetation is coherent at two scales at once. A LANDSCAPE grows a
 * handful of species — a Cape hillside is not a global sample of trees — and a
 * STAND within it is usually one of them, because a thicket is a clone patch,
 * a seed fall, or one age class after a fire. So:
 *
 *   ezPalette(family, districtSeed)  which few silhouettes this country uses
 *   ezPickVariant(palette, standSeed)  which of those this thicket is
 *
 * The seeds come from `culture.ts`'s own scopes — district 6km, stand 32m —
 * which are jittered Voronoi cells keyed on lat/lon, so a palette survives a
 * world rebase and a stand does not reroll when you drive past it. That
 * machinery already existed for bedrock; this is the second thing to use it.
 */
export const EZ_PALETTE_N = 2;
export function ezPalette(
  family: EzFamily, districtSeed: number, limit = Number.MAX_SAFE_INTEGER, forms?: readonly string[],
): number[] {
  const all = EZ_BAKE.families[family].variants;
  const n = Math.min(all.length, Math.max(1, Math.floor(limit)));
  if (n <= 1) return [0];
  // THE FORM FILTER IS A HOOK, AND TODAY IT IS A NO-OP BY CONSTRUCTION: every
  // family in the bake carries exactly one form (broadleaf all `round`,
  // conifer all `conic`, acacia all `umbrella`, palm all `palm`, snag all
  // `bare`), so asking for a form can only return everything or nothing. It is
  // wired now because the moment a family gains a second form — a columnar
  // broadleaf, a sclerophyll one for the Mediterranean rows — this is where a
  // guild's preference has to arrive, and a caller that has to be rewritten to
  // pass it is a caller that will not. An empty filter is IGNORED rather than
  // obeyed: a landscape with no matching silhouette must still grow trees.
  const pool: number[] = [];
  for (let i = 0; i < n; i++) if (!forms?.length || forms.includes(all[i].form)) pool.push(i);
  const from = pool.length ? pool : Array.from({ length: n }, (_, i) => i);
  // Draw PALETTE_N distinct silhouettes, by walking the pool from a
  // seed-derived offset at a seed-derived stride. A stride coprime with the
  // pool size visits every entry, so the draw cannot repeat and cannot fail —
  // which a rejection loop over a two-entry pool very much can.
  const want = Math.min(EZ_PALETTE_N, from.length);
  const off = (districtSeed >>> 3) % from.length;
  const stride = 1 + ((districtSeed >>> 11) % Math.max(1, from.length - 1));
  const out: number[] = [];
  for (let k = 0, at = off; k < want; k++, at = (at + stride) % from.length) {
    if (!out.includes(from[at])) out.push(from[at]);
    else k--, at = (at + 1) % from.length;      // stride shared a factor; step on
    if (out.length >= want) break;
  }
  return out.length ? out : [from[0]];
}

/** Which of the landscape's silhouettes THIS stand is. */
export function ezPickVariant(palette: number[], standSeed: number): number {
  if (!palette.length) return 0;
  return palette[(standSeed >>> 5) % palette.length];
}

/** The one material for every skeleton: the crown wears the instance's
 *  colour, the wood a bark colour, both under the faceTone in colour. Built
 *  on the leaf material's terms (white, flat, vertex colours) so a caller can
 *  add the same grain it gives the other plants.
 *
 *  BEND IS INSTANCE-DERIVED, NOT ANOTHER GEOMETRY. EZ supplied genuinely
 *  different skeletons; the bake necessarily made that infinity a small atlas.
 *  A stable hash of the instance position bows each normalised tree in its own
 *  direction as it rises. That recovers a continuous layer of growth form for
 *  one uniform and no extra vertices, variants or draws. Zero is an exact A/B.
 */
/**
 * ── THE WIND REACHES THE WOOD ──
 *
 * The sward has leaned on the world's wind since the grass got its gust back,
 * and every tree in the same field stood dead still — so a stiff breeze laid a
 * meadow over between a hundred lampposts. This is the same wind, the same
 * `uGust` (direction × amplitude) and the same `uTime`, reaching the only
 * things in the landscape that were still refusing it.
 *
 * FOUR THINGS THE GRASS DOES NOT NEED:
 *
 *   THE SQUARE OF THE RISE. A blade leans linearly because it is uniform all
 *   the way up; a trunk is stiff at the ground and limber at the tip. The
 *   weight arrives baked (`swayWeight`, or `y*y` for the unit-height bake).
 *
 *   THE OFFSET IS A WORLD DIRECTION. Instances carry a Y rotation, so adding
 *   the gust in the instance's LOCAL frame would have sent every tree in a
 *   stand a different way and a wood would have milled about instead of
 *   leaning downwind. The gust is projected onto the instance's own axes and
 *   divided by their length, which puts the same world metres on every tree
 *   whichever way it happens to be turned.
 *
 *   BIG TREES ARE SLOW. A cantilever's period grows with its height, and it is
 *   most of what separates a poplar from a sapling at a glance: the frequency
 *   goes as 1/sqrt(height), so a 20m conifer takes about 2.3s a cycle and a 5m
 *   one about 1.2s. The instance's own Y scale is the height, free.
 *
 *   LEAVES FLUTTER FASTER THAN TIMBER BENDS. `aWood` already separates crown
 *   from wood for the colour, so the crown takes a second, quicker, smaller
 *   term on top of the bend — the difference between a branch moving and the
 *   leaves on it moving.
 *
 * The phase runs along the wind's own bearing so gust fronts sweep downwind
 * (the sward's fix, at a forest's wavelength — ~100m rather than ~15m), and a
 * per-instance hash keeps a stand from pulsing as one animal.
 */
export const FOLIAGE_WIND_UNIFORMS = 'uniform float uTime; uniform vec2 uGust; uniform float uWindK;';
/** `wRise` is how much of the lean this vertex takes (0 planted, 1 at the tip)
 *  and `wFlut` how much of the flutter (crown 1, wood 0). Both are supplied by
 *  the caller, because the two materials know them by different routes. */
export const foliageWind = (wRise: string, wFlut: string): string => [
  '#ifdef USE_INSTANCING',
  `float wR = ${wRise};`,
  'if (uWindK > 0.0 && wR > 0.0) {',
  '  vec3 iX = instanceMatrix[0].xyz, iZ = instanceMatrix[2].xyz;',
  '  float iH = max(1.0, length(instanceMatrix[1].xyz));',
  '  float gM = length(uGust);',
  '  vec2 gD = gM > 1e-4 ? uGust / gM : vec2(0.0, 1.0);',
  '  float wPh = dot(instanceMatrix[3].xz, gD) * 0.06',
  '    + fract(sin(dot(instanceMatrix[3].xz, vec2(45.23, 91.17))) * 19341.7) * 6.2832;',
  '  float wW = 12.0 / sqrt(iH);',
  '  vec3 wG = vec3(uGust.x, 0.0, uGust.y) * uWindK',
  '    * (wR * (0.55 + 0.45 * sin(uTime * wW + wPh))',
  `       + ${wFlut} * 0.22 * sin(uTime * wW * 3.4 + wPh * 2.7));`,
  '  transformed.x += dot(wG, iX) / dot(iX, iX);',
  '  transformed.z += dot(wG, iZ) / dot(iZ, iZ);',
  '}',
  '#endif',
].join('\n');

export function ezMaterial(
  bark: THREE.ColorRepresentation,
  tuning: { bend?: { value: number }; wind?: { uTime: { value: number }; uGust: { value: THREE.Vector2 }; uWindK: { value: number } } } = {},
): THREE.MeshLambertMaterial {
  // Double-sided for the leaf cards: a quad has no back to cull.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true, side: THREE.DoubleSide });
  const uWood = { value: new THREE.Color(bark) };
  const uEzBend = tuning.bend ?? { value: 0 };
  const wind = tuning.wind ?? { uTime: { value: 0 }, uGust: { value: new THREE.Vector2() }, uWindK: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWood = uWood;
    sh.uniforms.uEzBend = uEzBend;
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uGust = wind.uGust;
    sh.uniforms.uWindK = wind.uWindK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aWood; uniform vec3 uWood; uniform float uEzBend;\n${FOLIAGE_WIND_UNIFORMS}`)
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        'float ezBx = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
        'float ezBz = fract(sin(dot(instanceMatrix[3].zx, vec2(39.3468, 11.135))) * 24634.6345) - 0.5;',
        'float ezRise = max(0.0, transformed.y);',
        'transformed.xz += vec2(ezBx, ezBz) * uEzBend * ezRise * ezRise;',
        '#endif',
        // The bake stands every skeleton on y=0 with its top at y=1, so the
        // rise IS the normalised height and the square of it is the bend.
        // `aWood` is 1 in the timber and 0 in the crown, which is exactly the
        // flutter's weight the other way round.
        foliageWind('ezRise * ezRise', '(1.0 - aWood)'),
      ].join('\n'))
      .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex
        .replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(instanceColor.xyz, uWood, aWood);'));
  };
  return mat;
}
