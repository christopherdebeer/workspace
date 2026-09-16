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
import { FLORA_REFINED } from './flora-refined-baked';
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

// Geometry quality is independent of the population allowance. These switches
// keep the same sites available for an on-device comparison; no distance swap.
const floraQuery = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const EZ_REFINED = floraQuery.get('ezdetail') !== '0';
export const EZ_GROWTH_FORMS = floraQuery.get('ezforms') !== '0';
/** How much a foliage cluster grows as the crown closes at distance. Shared:
 *  the decode insets the hull by exactly what this will add back, and the
 *  vertex shader interpolates toward it, so the far crown is the same SIZE as
 *  the near one and only solid. Two copies of this number is a tree that grows
 *  as you drive away from it. */
export const EZ_MERGE_GROW = 2.2;
type GrowthVariant = EzBakedVariant & { habit?: string; pads?: string };
const growthBake = new Map<EzFamily, GrowthVariant[]>();
const bakedVariants = (family: EzFamily): GrowthVariant[] => {
  let variants = growthBake.get(family);
  if (!variants) {
    variants = family === 'conifer' && EZ_GROWTH_FORMS
      ? [...EZ_BAKE.families.conifer.variants, ...FLORA_REFINED.conifers as GrowthVariant[]]
      : EZ_BAKE.families[family].variants;
    growthBake.set(family, variants);
  }
  return variants;
};
const habitOf = (v: GrowthVariant): string => v.habit ?? `${v.form}:${v.name.replace(/ #[0-9]+$/, '')}`;

function woodOf(v: EzBakedVariant, q: number): THREE.BufferGeometry {
  const reduced = (FLORA_REFINED.wood as Record<string, string>)[v.name];
  const P = int16(v.pos), I = uint16(EZ_REFINED && reduced ? reduced : v.idx);
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

/**
 * ── HOW MUCH FOLIAGE A WHORL CARRIES, AND WHY IT IS A CLIENT DIAL ──
 *
 * The control set (`devtools/tree-forms.mjs`) measured CLOSURE — the share of
 * a tree's own bounding box its silhouette fills — across all twenty-nine
 * variants, and the conifer family came back as two different bakes:
 *
 *   base `conic 1-4`   108-126 pads at r 0.075   22.0-24.9%   ~1,270 tris
 *   the growth forms    28-41 pads at r 0.06      5.1-9.6%    469-651 tris
 *
 * A quarter of the foliage, and the frames show it: a bare pole with a dozen
 * one-pixel dashes where the base recipe is an unmistakable spruce. The seat's
 * report — *our real trees are a little too skeleton like* — is that row.
 *
 * PASS 1 CLUSTERED AND IT WAS NOT ENOUGH. Three pads an anchor, jittered
 * within 0.9 of the pad radius, on the reasoning that a real branch carries a
 * CLUSTER and that scaling the pad instead would read as a bead on a stick.
 * Measured on the control set: closure 8.3 -> 10.8%, 9.6 -> 13.0%, 5.1 -> 6.9%,
 * at roughly double the triangles (469-651 -> 917-1307). A third more silhouette
 * for twice the cost, and still half the base recipe's 22-25%.
 *
 * THE LIMIT IS WHERE THE ANCHORS ARE, NOT HOW MANY PADS SIT ON EACH. Pads
 * clustered inside 0.9r of one anchor OVERLAP, so their projected area barely
 * adds; and the growth forms carry a quarter of the base recipe's anchors over
 * the same crown, so the gaps that are empty are the ones BETWEEN the whorls,
 * which no amount of clustering reaches.
 *
 * SO PASS 2 GROWS THE PAD ITSELF, on the physical argument the first pass
 * argued against: an open-whorled or high-crown conifer HAS fewer branches, and
 * a branch that is one of thirty carries a larger tuft than one of a hundred
 * and twenty. The gain applies to EVERY pad, the cluster drops to two, and the
 * spread widens past the gained radius so the pair reads as a lobed tuft rather
 * than one blob. Pad area goes as the square of the gain, so 1.75 is 3.1x the
 * area a pad drew and the pair is about five times the original crown — which
 * is the base recipe's own 4.8x, arrived at by making the few branches fat
 * instead of pretending there are more of them.
 *
 * NOTHING BUT A HABIT CONIFER IS TOUCHED. `crownFill` fires on `v.habit` with
 * form `conic`, so the four base conifers — which the control set says already
 * read at 22-25% — cannot be moved by tuning the eight that do not, and no
 * broadleaf, palm, umbrella or snag is in this pass at all.
 *
 * `?ezfill=` is the A/B and 0 is an exact control: gain 1 and one pad an anchor
 * is the k = 0 path with no jitter and no rescale, which decodes byte for byte
 * as the shipped crown does.
 */
const EZ_FILL = (() => {
  // THE ABSENT CASE IS CHECKED FIRST, and this file already records why: `get`
  // answers null for a switch nobody set, `Number(null)` is ZERO, and zero is
  // finite — so the obvious form silently reads "off" for every ordinary load.
  // It cost this pass a whole run: the first sheet came back with the numbers
  // unchanged to the decimal, which reads exactly like a change that does
  // nothing and was a change that never ran.
  const raw = floraQuery.get('ezfill');
  if (raw === null || raw === '') return 1;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(3, v) : 1;
})();
interface CrownFill { n: number; spread: number; scale: number; gain: number }
function crownFill(v: GrowthVariant): CrownFill {
  // Keyed on the HABIT, because that is what names a recipe rather than a
  // seed: two wind-shaped conifers are the same recipe twice and must fill
  // alike, or a district that draws both gets two different species.
  const habit = v.habit;
  if (habit && v.form === 'conic') {
    // EVERY NUMBER HERE RIDES `EZ_FILL`, so `?ezfill=0` is the shipped crown
    // byte for byte rather than an approximation of it: gain 1, one pad an
    // anchor, no jitter. That is what makes the A/B a control.
    const t = EZ_FILL;
    return {
      n: 1 + Math.round(t),               // 2 pads at the default
      spread: 1.15,                       // past the gained radius: a pair, not a blob
      scale: 0.78,                        // the second pad is the smaller one
      gain: 1 + 0.75 * Math.min(t, 2),    // 1.75 at the default: 3.1x the pad's area
    };
  }
  return { n: 1, spread: 0, scale: 1, gain: 1 };
}

/** A deterministic unit draw from two integers: the same tree every session,
 *  and no two pads of one anchor in the same place. */
function fillHash(a: number, b: number): number {
  let x = Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 2246822507);
  x = Math.imul(x ^ (x >>> 15), 2654435761);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

function crownOf(v: GrowthVariant, q: number): THREE.BufferGeometry | null {
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
    // A CARD IS ITS OWN CLUSTER, so the same occlusion runs over card centres.
    // `cardTone` already varies by card, which is the right unit here — what it
    // could not do is say which cards are INSIDE the crown, and that is the
    // half that makes a canopy read as a canopy rather than as a heap.
    const nc = pos.length / 12;
    const cen = new Float32Array(Math.max(1, nc) * 3);
    let rad = 0;
    for (let c = 0; c < nc; c++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) { cx += pos[(c * 4 + k) * 3]; cy += pos[(c * 4 + k) * 3 + 1]; cz += pos[(c * 4 + k) * 3 + 2]; }
      cen[c * 3] = cx / 4; cen[c * 3 + 1] = cy / 4; cen[c * 3 + 2] = cz / 4;
      rad += Math.hypot(pos[c * 12] - cen[c * 3], pos[c * 12 + 1] - cen[c * 3 + 1], pos[c * 12 + 2] - cen[c * 3 + 2]);
    }
    rad = nc ? rad / nc : 0.05;
    const cs = anchorSky(cen, rad);
    const sky = new Float32Array(pos.length / 3);
    for (let i = 0; i < sky.length; i++) {
      const c = Math.min(nc - 1, i >> 2);
      const nx = pos[i * 3] - cen[c * 3], ny = pos[i * 3 + 1] - cen[c * 3 + 1], nz = pos[i * 3 + 2] - cen[c * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      sky[i] = Math.min(1, Math.max(0.05, cs[c] * (0.55 + 0.45 * (0.5 + 0.5 * (ny / nl)))));
    }
    g.setAttribute('aSky', new THREE.BufferAttribute(sky, 1));
    g.setAttribute('aEnv', new THREE.BufferAttribute(crownEnv(g), 3));
    const padOf = new Float32Array(sky.length * 3);
    for (let i = 0; i < sky.length; i++) {
      const c = Math.min(nc - 1, i >> 2);
      padOf[i * 3] = cen[c * 3]; padOf[i * 3 + 1] = cen[c * 3 + 1]; padOf[i * 3 + 2] = cen[c * 3 + 2];
    }
    const hull = crownHull(g, padOf);
    g.setAttribute('aPad', new THREE.BufferAttribute(hull.pad, 3));
    g.setAttribute('aHull', new THREE.BufferAttribute(hull.hull, 3));
    return cardTone(g);
  }
  const A = int16(v.anc);
  if (!A.length) return null;
  const parts: THREE.BufferGeometry[] = [];
  /** Which anchor each part hangs on, and where its own centre landed — the
   *  two things the tone and the occlusion need and the merge throws away. */
  const partAnchor: number[] = [];
  const partCentre: number[] = [];
  const r = v.crown.r;
  const pads = v.pads ? int16(v.pads) : null;
  const fill = crownFill(v);
  const nAnc = Math.floor(A.length / 3);
  const ancPts = new Float32Array(nAnc * 3);
  for (let k = 0; k < nAnc * 3; k++) ancPts[k] = A[k] / q;
  const skyOf = anchorSky(ancPts, r * fill.gain);
  for (let i = 0; i + 3 <= A.length; i += 3) {
    const ax = A[i] / q, ay = A[i + 1] / q, az = A[i + 2] / q;
    for (let k = 0; k < fill.n; k++) {
      // k = 0 IS THE ORIGINAL: no jitter, no rescale, so a variant at fill 1
      // decodes exactly as it always did and the extras only ever add.
      const extra = k > 0;
      // THE GAIN IS ON EVERY PAD, the first one included — which is the whole
      // of pass 2, and why `sc` is no longer 1 on the k = 0 path.
      const sc = (extra ? fill.scale : 1) * fill.gain;
      let g: THREE.BufferGeometry;
      if (shape === 'cone') {
        // Open at its base: a frond seen from the road never shows its underside.
        g = new THREE.ConeGeometry(r * sc, r * sc * 1.6, 4, 1, true);
      } else {
        // A pad: an octahedron pressed flat, the way a spruce's foliage lies —
        // eight triangles, and at sixty centimetres no eye tells it from twenty.
        g = shape === 'flat' ? new THREE.OctahedronGeometry(r * sc, 0) : new THREE.IcosahedronGeometry(r * sc, 0);
        if (shape === 'flat') g.scale(1, 0.45, 1);
      }
      if (pads) {
        const p = i / 3 * 4;
        g.scale(pads[p] / q / r, pads[p + 1] / q / (r * 0.45), pads[p + 2] / q / r);
        g.rotateY(-pads[p + 3] / q * Math.PI * 2 + (extra ? fillHash(i, k + 31) * Math.PI : 0));
      } else if (extra) {
        g.rotateY(fillHash(i, k + 31) * Math.PI * 2);
      }
      if (extra) {
        // OUTWARD AND AROUND, not up: a whorl lies in a plane, so the cluster
        // spreads across it and barely at all in height. Scaled by the pad's
        // own radius so a small-padded recipe stays small.
        const a = fillHash(i, k) * Math.PI * 2;
        // MEASURED IN GAINED RADII, not in the baked one: a pad three times the
        // area needs its partner further off or the two are one blob again.
        const rg = r * fill.gain;
        const d = (0.55 + 0.45 * fillHash(i, k + 11)) * fill.spread * rg;
        const cxp = ax + Math.cos(a) * d;
        const cyp = ay + (fillHash(i, k + 19) - 0.5) * 0.5 * fill.spread * rg;
        const czp = az + Math.sin(a) * d;
        g.translate(cxp, cyp, czp);
        partCentre.push(cxp, cyp, czp);
      } else {
        g.translate(ax, ay, az);
        partCentre.push(ax, ay, az);
      }
      parts.push(g);
      partAnchor.push(i / 3);
    }
  }
  const crown = mergeGeos(parts);
  return crownShade(crown, parts, partAnchor, partCentre, skyOf, nAnc,
    shape === 'cone' ? 0.16 : 0.2);
}

/**
 * ── HOW MUCH SKY EACH FOLIAGE ANCHOR CAN SEE ──
 *
 * The material's crown shading was `smoothstep(length(vEzLocal.xz))` against
 * `smoothstep(vEzLocal.y)` — a RADIAL approximation that assumes a crown
 * centred on the trunk and knows nothing about where the foliage actually is.
 * It is right for a round oak and wrong for everything the atlas is about to
 * grow: an umbrella acacia, a one-sided wind-flagged conifer, a high crown, a
 * palm's fronds.
 *
 * So the occlusion is MEASURED, once per variant at decode, against the tree's
 * own anchors: nine rays over the upper hemisphere, blocked by any other
 * anchor's own foliage sphere. It costs anchors x 9 x anchors — about fourteen
 * thousand operations for a conifer, once, for the life of the page — and it
 * is what turns the crown's light and dark from an assumption into a fact
 * about the geometry. No runtime cost at all: it lands in an attribute.
 *
 * THIS IS THE BAKE'S JOB EVENTUALLY. Doing it at decode rather than in
 * `bake-ez-flora.mjs` means it needs no re-bake and no new tooling, and the
 * baked atlas stays exactly the bytes it is; when the bake learns to carry
 * branch order and cluster ids this moves there with them.
 */
function anchorSky(P: Float32Array, rad: number): Float32Array {
  const n = Math.floor(P.length / 3);
  const out = new Float32Array(n);
  // A card crown has hundreds of clusters and the occlusion is an ESTIMATE, so
  // the occluder set is strided rather than complete: the cost is n x 9 x 140
  // whatever the crown, and a tenth of the cards give the same answer to well
  // inside a palette step.
  const st = Math.max(1, Math.ceil(n / 140));
  // Nine directions: straight up, then two rings of four. Weighted to the
  // zenith, because that is where a canopy's light comes from.
  const dirs: Array<[number, number, number, number]> = [[0, 1, 0, 2]];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    dirs.push([Math.cos(a) * 0.5, 0.87, Math.sin(a) * 0.5, 1.4]);
    dirs.push([Math.cos(a + 0.78) * 0.87, 0.5, Math.sin(a + 0.78) * 0.87, 1]);
  }
  const wTot = dirs.reduce((t, d) => t + d[3], 0);
  const R2 = rad * rad;
  for (let j = 0; j < n; j++) {
    const jx = P[j * 3], jy = P[j * 3 + 1], jz = P[j * 3 + 2];
    let open = 0;
    for (const [dx, dy, dz, w] of dirs) {
      let hit = false;
      for (let k = 0; k < n && !hit; k += st) {
        if (k === j) continue;
        const ex = P[k * 3] - jx, ey = P[k * 3 + 1] - jy, ez = P[k * 3 + 2] - jz;
        const t = ex * dx + ey * dy + ez * dz;
        // Behind the ray, or so far along it that the foliage between would
        // have shaded this anchor anyway: neither is an occluder.
        if (t < rad * 0.4 || t > rad * 7) continue;
        const px = ex - dx * t, py = ey - dy * t, pz = ez - dz * t;
        if (px * px + py * py + pz * pz < R2) hit = true;
      }
      if (!hit) open += w;
    }
    out[j] = open / wTot;
  }
  return out;
}

/**
 * ── THE VARIATION UNIT IS THE CLUSTER, NOT THE FACE ──
 *
 * `faceTone` hashes every TRIANGLE independently. On a six-pixel pad under a
 * fourteen-level palette and an ordered dither that is high-frequency tonal
 * noise at exactly the dither's own frequency — the crown gets busier without
 * getting more detailed, which is the opposite of what a coarse palette wants.
 * Real foliage correlates: a sunlit outer branch is light AS A GROUP.
 *
 * So the hash moves up to the ANCHOR — one tone for a whole foliage cluster —
 * and the shading within the crown comes from the measured sky exposure above
 * rather than from a per-face draw. Fewer numbers, more form.
 */
function crownShade(crown: THREE.BufferGeometry, parts: THREE.BufferGeometry[],
  partAnchor: number[], partCentre: number[], skyOf: Float32Array, nAnc: number,
  spread: number): THREE.BufferGeometry {
  const pos = crown.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const sky = new Float32Array(n);
  const padOf = new Float32Array(n * 3);
  const env = crownEnv(crown);
  const tone = new Float32Array(Math.max(1, nAnc));
  for (let j = 0; j < tone.length; j++) {
    let x = Math.imul(j + 1, 2654435761);
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    tone[j] = 1 + (((x ^ (x >>> 13)) >>> 0) / 4294967296 - 0.5) * spread;
  }
  let o = 0;
  for (let k = 0; k < parts.length; k++) {
    const g = parts[k];
    const pc = g.index ? g.index.count : (g.getAttribute('position') as THREE.BufferAttribute).count;
    const aj = partAnchor[k];
    const t = tone[Math.min(tone.length - 1, aj)];
    const s0 = skyOf.length ? skyOf[Math.min(skyOf.length - 1, aj)] : 1;
    const cxp = partCentre[k * 3], cyp = partCentre[k * 3 + 1], czp = partCentre[k * 3 + 2];
    for (let i = 0; i < pc; i++) {
      const vi = o + i;
      col[vi * 3] = t; col[vi * 3 + 1] = t; col[vi * 3 + 2] = t;
      // Within a cluster the top and the outward face see more sky than the
      // underside and the side facing the trunk. The pad's own centre gives
      // that direction without needing a normal the merge has not built yet.
      padOf[vi * 3] = cxp; padOf[vi * 3 + 1] = cyp; padOf[vi * 3 + 2] = czp;
      const nx = pos.getX(vi) - cxp, ny = pos.getY(vi) - cyp, nz = pos.getZ(vi) - czp;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const up = 0.5 + 0.5 * (ny / nl);
      const rl = Math.hypot(pos.getX(vi), pos.getZ(vi)) || 1;
      const out2 = 0.5 + 0.5 * ((pos.getX(vi) * nx + pos.getZ(vi) * nz) / (rl * nl));
      sky[vi] = Math.min(1, Math.max(0.05, s0 * (0.40 + 0.38 * up + 0.22 * out2)));
    }
    o += pc;
  }
  crown.setAttribute('color', new THREE.BufferAttribute(col, 3));
  crown.setAttribute('aSky', new THREE.BufferAttribute(sky, 1));
  crown.setAttribute('aEnv', new THREE.BufferAttribute(env, 3));
  const hull = crownHull(crown, padOf);
  crown.setAttribute('aPad', new THREE.BufferAttribute(hull.pad, 3));
  crown.setAttribute('aHull', new THREE.BufferAttribute(hull.hull, 3));
  return crown;
}

/**
 * ── AND THE CROWN CLOSES AS IT SHRINKS ──
 *
 * The control set at 200 m says the conifers are four to thirteen SEPARATE
 * pieces of foliage with up to a third of their lit pixels touching at most one
 * neighbour. With no MSAA and a nearest magnify, a pad near a pixel does not
 * get smaller as the tree recedes — it gets INTERMITTENT, covering a pixel or
 * not by sub-pixel phase, and the phase changes every frame the truck moves.
 * The ordered dither then amplifies it. That is the crawling stipple, and no
 * amount of shading reaches it: phase 2 moved `parts` and `stipple` by nothing
 * at all, to the digit.
 *
 * Both reviews of the atlas want crown POROSITY — real holes between foliage
 * masses — and they are right at thirty to a hundred metres and wrong past two
 * hundred, where a hole is one pixel. The seat's own target for the far field
 * is that a biome be unmistakable AS A BLACK SILHOUETTE, which is a solid
 * shape. Both are satisfiable at once only by a crown that is open near and
 * closed far.
 *
 * So each foliage cluster carries where it would sit on the crown's own
 * SILHOUETTE HULL — a surface of revolution measured off the crown's radius at
 * each height, so a conifer's hull is a cone, a round tree's a dome, an
 * umbrella's a plate and a column's a column — and the vertex shader slides the
 * cluster onto that hull, and grows it, as the tree's projected height falls.
 * An LOD with no second geometry, no popping (the blend is continuous in the
 * instance's own distance), no re-upload, and nothing for the refresh to do:
 * `refreshVeg` writes exactly the matrices it wrote before, which is what keeps
 * `perf-check` byte-identical.
 *
 * MEASURED AT A PERCENTILE, NOT AT THE MAXIMUM. One stray card thrown wide by
 * the reduction would otherwise set the hull's radius for its whole height band
 * and inflate the far silhouette by however far it was thrown.
 */
function crownHull(crown: THREE.BufferGeometry, padOf: Float32Array): {
  pad: Float32Array; hull: Float32Array;
} {
  const pos = crown.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  crown.computeBoundingBox();
  const bb = crown.boundingBox as THREE.Box3;
  const y0 = bb.min.y, span = Math.max(1e-4, bb.max.y - y0);
  const BINS = 12;
  const prof = (radius: (i: number) => number, height: (i: number) => number): Float32Array => {
    const bins: number[][] = Array.from({ length: BINS }, () => []);
    for (let i = 0; i < n; i++) {
      const b = Math.min(BINS - 1, Math.max(0, Math.floor(((height(i) - y0) / span) * BINS)));
      bins[b].push(radius(i));
    }
    const out = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const a = bins[b];
      if (!a.length) { out[b] = 0; continue; }
      a.sort((x, y) => x - y);
      out[b] = a[Math.min(a.length - 1, Math.floor(a.length * 0.86))];
    }
    // One smoothing pass, so a band that happened to catch few clusters does
    // not pinch the hull into a waist.
    const sm = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const l = out[Math.max(0, b - 1)], r = out[Math.min(BINS - 1, b + 1)];
      sm[b] = Math.max(out[b], (l + 2 * out[b] + r) * 0.25);
    }
    return sm;
  };
  // ── THE HULL IS INSET BY WHAT THE GROWTH WILL ADD ──
  //
  // The first cut put the clusters ON the silhouette and THEN grew them, so a
  // merged crown stood about twice as wide as the tree it was baked as — and
  // in the world that is a tree that GROWS as you drive away from it, which is
  // a worse fault than the stipple it fixes. The control sheet showed it at
  // once: every round broadleaf clipped its own cell.
  //
  // So two profiles are measured, the silhouette's (every vertex) and the
  // clusters' own (their centres), and the difference between them at a given
  // height IS the pad's radius there. The hull is then set where a pad grown by
  // EZ_MERGE_GROW lands exactly on the original silhouette. The far crown is
  // the same size as the near crown and merely solid.
  const vert = prof((i) => Math.hypot(pos.getX(i), pos.getZ(i)), (i) => pos.getY(i));
  const cent = prof((i) => Math.hypot(padOf[i * 3], padOf[i * 3 + 2]), (i) => padOf[i * 3 + 1]);
  const sm = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    sm[b] = Math.max(0, vert[b] - Math.max(0, vert[b] - cent[b]) * EZ_MERGE_GROW);
  }
  // The same argument in the vertical: a top cluster grows upward too, so the
  // hull's heights are compressed toward the crown's centre by whatever the
  // growth will add back.
  let topV = -1e9, topC = -1e9, botV = 1e9, botC = 1e9;
  for (let i = 0; i < n; i++) {
    topV = Math.max(topV, pos.getY(i)); botV = Math.min(botV, pos.getY(i));
    topC = Math.max(topC, padOf[i * 3 + 1]); botC = Math.min(botC, padOf[i * 3 + 1]);
  }
  const cy = (topV + botV) * 0.5;
  const yk = (h: number, c: number): number => {
    const halfPad = Math.max(0, h - c), reach = c - cy;
    return Math.abs(reach) < 1e-4 ? 1
      : Math.min(1, Math.max(0, (h - halfPad * EZ_MERGE_GROW - cy) / reach));
  };
  const kUp = yk(topV, topC), kDn = yk(-botV, -botC);
  const pad = new Float32Array(n * 3);
  const hull = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const px = padOf[i * 3], py = padOf[i * 3 + 1], pz = padOf[i * 3 + 2];
    pad[i * 3] = px; pad[i * 3 + 1] = py; pad[i * 3 + 2] = pz;
    const t = Math.min(BINS - 1, Math.max(0, ((py - y0) / span) * BINS - 0.5));
    const b0 = Math.floor(t), b1 = Math.min(BINS - 1, b0 + 1), f = t - b0;
    const r = sm[b0] * (1 - f) + sm[b1] * f;
    const rho = Math.hypot(px, pz);
    // A cluster already on the axis has no direction to be pushed along, and
    // the axis is inside the hull in any case, so it stays where it is.
    const k = rho > 1e-4 ? r / rho : 1;
    hull[i * 3] = px * k;
    hull[i * 3 + 1] = cy + (py - cy) * (py >= cy ? kUp : kDn);
    hull[i * 3 + 2] = pz * k;
  }
  return { pad, hull };
}

/**
 * ── THE CROWN LIGHTS AS ONE ENVELOPE, NOT AS A HEAP OF FACETS ──
 *
 * A crown built from pads or cards presents facets pointing every way, so
 * Lambert's dot product is a different number on every triangle and the crown
 * gets a random tone per facet instead of a LIT SIDE. At three to six pixels a
 * pad, under fourteen levels and an ordered dither, that is the foliage noise
 * both reviews of the atlas named — and it is why a tree reads as a texture
 * rather than as a solid object standing in the sun.
 *
 * So every crown vertex carries the direction from the crown's own CENTRE,
 * normalised by the crown's own extent so the envelope is the ellipsoid the
 * foliage actually occupies rather than a sphere. The surface pass then turns
 * the shading normal toward it, and the whole crown lights as one mass: one
 * sunlit flank, one shaded flank, coherent across every cluster in it.
 *
 * It costs three floats a crown vertex at decode and nothing at runtime, and
 * it is the attribute phase 3's bough merge will want anyway.
 */
function crownEnv(crown: THREE.BufferGeometry): Float32Array {
  const pos = crown.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const env = new Float32Array(n * 3);
  crown.computeBoundingBox();
  const bb = crown.boundingBox as THREE.Box3;
  const cx = (bb.min.x + bb.max.x) * 0.5, cy = (bb.min.y + bb.max.y) * 0.5, cz = (bb.min.z + bb.max.z) * 0.5;
  const ex = Math.max(1e-4, (bb.max.x - bb.min.x) * 0.5);
  const ey = Math.max(1e-4, (bb.max.y - bb.min.y) * 0.5);
  const ez = Math.max(1e-4, (bb.max.z - bb.min.z) * 0.5);
  for (let i = 0; i < n; i++) {
    let dx = (pos.getX(i) - cx) / ex, dy = (pos.getY(i) - cy) / ey, dz = (pos.getZ(i) - cz) / ez;
    // A vertex AT the centre has no direction; up is the honest default, since
    // the one thing every interior point of a canopy agrees on is where the
    // sky is.
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-5) { dx = 0; dy = 1; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
    env[i * 3] = dx; env[i * 3 + 1] = dy; env[i * 3 + 2] = dz;
  }
  return env;
}

/** Wood (indexed) and crown (soup) into one indexed geometry with `aWood`. */
function join(wood: THREE.BufferGeometry, crown: THREE.BufferGeometry | null): THREE.BufferGeometry {
  const wp = wood.getAttribute('position') as THREE.BufferAttribute;
  const wc = wood.getAttribute('color') as THREE.BufferAttribute;
  const wi = wood.index as THREE.BufferAttribute;
  const cp = crown?.getAttribute('position') as THREE.BufferAttribute | undefined;
  const cc = crown?.getAttribute('color') as THREE.BufferAttribute | undefined;
  const csk = crown?.getAttribute('aSky') as THREE.BufferAttribute | undefined;
  const cev = crown?.getAttribute('aEnv') as THREE.BufferAttribute | undefined;
  const cpd = crown?.getAttribute('aPad') as THREE.BufferAttribute | undefined;
  const chl = crown?.getAttribute('aHull') as THREE.BufferAttribute | undefined;
  const nW = wp.count, nC = cp ? cp.count : 0;
  const pos = new Float32Array((nW + nC) * 3);
  const col = new Float32Array((nW + nC) * 3);
  const wdF = new Float32Array(nW + nC);
  // THE WOOD IS FULLY EXPOSED BY CONVENTION. It is never read — the surface
  // pass branches on `aWood` first — and a zero here would be a black trunk
  // the day someone moves that branch.
  const skF = new Float32Array(nW + nC).fill(1);
  const evF = new Float32Array((nW + nC) * 3);
  // THE WOOD IS ITS OWN HULL. The merge lerps toward `aHull` about `aPad`, so
  // writing the vertex into both leaves the timber exactly where it is at any
  // distance — a trunk that slid onto the crown's cone would be a catastrophe
  // wearing a continuous blend.
  const pdF = new Float32Array((nW + nC) * 3);
  const hlF = new Float32Array((nW + nC) * 3);
  pdF.set(wp.array as Float32Array, 0);
  hlF.set(wp.array as Float32Array, 0);
  pos.set(wp.array as Float32Array, 0);
  col.set(wc.array as Float32Array, 0);
  wdF.fill(1, 0, nW);
  if (cp && cc) {
    pos.set(cp.array as Float32Array, nW * 3);
    col.set(cc.array as Float32Array, nW * 3);
    if (csk) skF.set(csk.array as Float32Array, nW);
    if (cev) evF.set(cev.array as Float32Array, nW * 3);
    if (cpd) pdF.set(cpd.array as Float32Array, nW * 3);
    else pdF.set(cp.array as Float32Array, nW * 3);
    if (chl) hlF.set(chl.array as Float32Array, nW * 3);
    else hlF.set(cp.array as Float32Array, nW * 3);
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
  g.setAttribute('aSky', new THREE.BufferAttribute(skF, 1));
  g.setAttribute('aEnv', new THREE.BufferAttribute(evF, 3));
  g.setAttribute('aPad', new THREE.BufferAttribute(pdF, 3));
  g.setAttribute('aHull', new THREE.BufferAttribute(hlF, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

const cache = new Map<EzFamily, EzVariant[]>();

/** Every baked variant of a family, decoded once. */
export function ezVariants(family: EzFamily): EzVariant[] {
  let out = cache.get(family);
  if (out) return out;
  out = bakedVariants(family).map((v) => {
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
    const baked = bakedVariants(family)[out.indexOf(v)];
    v.label = baked.habit ? `${family} ${baked.habit} ${n}` : `${family} ${v.form} ${n}`;
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

/** Historical admission price, intentionally unchanged by geometry refinement.
 * Otherwise reducing geometry admits more trees and hides the triangle saving.
 * Actual submitted triangles come from each decoded variant's index count. */
export function ezMeanTris(family: EzFamily): number {
  return EZ_BAKE.families[family].meanDrawn;
}

/** A stable variant index for a site, so a tree keeps its skeleton across
 *  refreshes and its neighbours differ. `limit` is the SETTINGS instrument:
 *  ONE/TWO/FOUR can prove what the atlas buys without changing where a tree
 *  stands, while ALL remains the shipping answer. */
export function ezVariantFor(family: EzFamily, x: number, z: number, limit = Number.MAX_SAFE_INTEGER): number {
  const available = bakedVariants(family).length;
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
  const all = bakedVariants(family);
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
  for (let i = 0; i < n; i++) if (!forms?.length || forms.includes(all[i].form)) {
    // Districts choose growth habits, not seeds. Two individuals of the same
    // habit must not exhaust the district's two-species vocabulary.
    if (!EZ_GROWTH_FORMS || !pool.some(j => habitOf(all[j]) === habitOf(all[i]))) pool.push(i);
  }
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
const habitPeers = new Map<string, number[]>();
export function ezPickVariant(palette: number[], standSeed: number,
  family?: EzFamily, individualSeed = 0, limit = Number.MAX_SAFE_INTEGER): number {
  if (!palette.length) return 0;
  const chosen = palette[(standSeed >>> 5) % palette.length];
  if (!family || !EZ_GROWTH_FORMS) return chosen;
  const all = bakedVariants(family), habit = habitOf(all[chosen]);
  const key = `${family}:${chosen}:${limit}`;
  let peers = habitPeers.get(key);
  if (!peers) {
    peers = all.map((v,i) => ({v,i})).filter(({v,i}) => i < limit && habitOf(v) === habit).map(({i}) => i);
    habitPeers.set(key, peers);
  }
  return peers.length ? peers[(individualSeed >>> 0) % peers.length] : chosen;
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

/**
 * ── TWO NUMBERS THE SKELETONS' SURFACE NEEDS, SHARED BY EVERY MATERIAL ──
 *
 * `uEzBark` is how hard the wood's own vertical grain bites; `uEzEdge` is how
 * far a leaf card seen edge-on is pulled toward its neighbours. Live handles,
 * so a device can A/B them (`?ezbark=`, `?ezedge=`) and a lab can put them on
 * dials, exactly as the wind and the growth bend already are.
 */
export const ezLookU = {
  uEzBark: { value: 0.55 }, uEzEdge: { value: 0.62 },
  /** How much of the crown's shading comes from the MEASURED sky exposure
   *  rather than from the radial approximation it replaced. `?ezsky=0` is the
   *  exact A/B and restores the old term to the bit. */
  uEzSky: { value: floraQuery.get('ezsky') === '0' ? 0 : 1 },
  /** How hard the far crown closes onto its own silhouette hull. 0 is the
   *  crown exactly as baked at every distance — the A/B — and above 1 it
   *  overshoots, which is a way to see the mechanism rather than a setting. */
  uEzMerge: { value: (() => {
    const raw = floraQuery.get('ezmerge');
    if (raw === null || raw === '') return 1;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.min(3, v) : 1;
  })() },
  /** The art-grid height, so the shader can turn a distance into art pixels.
   *  main.ts keeps it at `pixSize.y`; 320 is the design value. */
  uEzPxH: { value: 320 },
  /** A control sheet frames its cell by construction and has no distance to
   *  read, so it states the size outright. 0 means read the camera. */
  uEzPxFix: { value: 0 },
};
/** A hash and a value noise of our own. `grain.ts` has the same pair under
 *  different names and IS chained onto this material — declaring `grNoise`
 *  twice is a redefinition, and a shader that fails to link logs to the
 *  console and throws nothing, which in this engine means a wood that simply
 *  does not draw. */
const EZ_NOISE_GLSL = `
  float ezHash(vec3 p){ return fract(sin(dot(p, vec3(113.5, 271.9, 124.6))) * 43758.5453); }
  float ezNoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(ezHash(i), ezHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(ezHash(i + vec3(0.0, 1.0, 0.0)), ezHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(ezHash(i + vec3(0.0, 0.0, 1.0)), ezHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(ezHash(i + vec3(0.0, 1.0, 1.0)), ezHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }`;

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
    sh.uniforms.uEzBark = ezLookU.uEzBark;
    sh.uniforms.uEzSky = ezLookU.uEzSky;
    sh.uniforms.uEzMerge = ezLookU.uEzMerge;
    sh.uniforms.uEzPxH = ezLookU.uEzPxH;
    sh.uniforms.uEzPxFix = ezLookU.uEzPxFix;
    sh.uniforms.uEzEdge = ezLookU.uEzEdge;
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uGust = wind.uGust;
    sh.uniforms.uWindK = wind.uWindK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aWood; attribute float aSky; attribute vec3 aEnv; attribute vec3 aPad; attribute vec3 aHull;\nuniform vec3 uWood; uniform float uEzBend; uniform float uEzMerge; uniform float uEzPxH; uniform float uEzPxFix;\nvarying float vEzWood; varying vec3 vEzLocal; varying float vEzJit; varying float vEzSky; varying vec3 vEzEnv;\n${FOLIAGE_WIND_UNIFORMS}`)
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        // ── THE CROWN CLOSES AS THE TREE SHRINKS ──
        //
        // Each foliage cluster slides onto the crown's own silhouette hull and
        // grows, over a band read from the INSTANCE's projected height in art
        // pixels — so it is per tree, continuous, and costs the refresh
        // nothing. Above 58 px (about 110 m for a 20 m conifer) the tree is
        // exactly what it was baked as, holes and all; below 26 px (about 250
        // m) it is one closed mass, which is what a biome read as a black
        // silhouette needs and what stops a 2 px pad flickering on and off by
        // sub-pixel phase with no MSAA under it.
        //
        // The scale comes from projectionMatrix, so it is right in the chase
        // lens, right through the speed kick and right on the chart; uEzPxFix
        // is the control sheet's way in, since a sheet frames its cell by
        // construction and has no distance to read.
        '#ifdef USE_INSTANCING',
        'if (uEzMerge > 0.001 && aWood < 0.5) {',
        '  float ezPx = uEzPxFix;',
        '  if (ezPx <= 0.0) {',
        '    vec3 ezAt = (modelMatrix * instanceMatrix[3]).xyz;',
        '    float ezTall = length(instanceMatrix[1].xyz);',
        '    ezPx = ezTall * uEzPxH * projectionMatrix[1][1] * 0.5 / max(1.0, distance(cameraPosition, ezAt));',
        '  }',
        '  float ezM = (1.0 - smoothstep(26.0, 58.0, ezPx)) * uEzMerge;',
        `  vec3 ezFar = aHull + (transformed - aPad) * mix(1.0, ${EZ_MERGE_GROW.toFixed(2)}, ezM);`,
        '  transformed = mix(transformed, ezFar, ezM);',
        '}',
        '#endif',
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
        // ── WHAT THE SURFACE PASS NEEDS ──
        // The wood flag, the vertex in the SKELETON's own frame (the bake is
        // unit-height, so this is a stable frame at any tree size and the bark
        // scales with the trunk for free), and a per-instance jitter so a
        // hundred trees of one variant do not all wear the same knot.
        'vEzWood = aWood;',
        'vEzSky = aSky;',
        // The envelope direction into the frame the lighting reads. The
        // instance's non-uniform width and height skew it a little and that is
        // accepted: a crown is a soft shape and its light is a soft claim.
        'vEzEnv = normalMatrix * aEnv;',
        'vEzLocal = position;',
        '#ifdef USE_INSTANCING',
        'vEzJit = fract(sin(dot(instanceMatrix[3].xz, vec2(21.7, 47.3))) * 7351.3);',
        '#else',
        'vEzJit = 0.0;',
        '#endif',
      ].join('\n'))
      .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex
        .replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(instanceColor.xyz, uWood, aWood);'));
    /**
     * ── THE SURFACE PASS: BARK ON THE WOOD, AND NO BRIGHT EDGE ON A CARD ──
     *
     * Both were reported from the flora lab at windscreen height, and both are
     * about what a skeleton looks like at ten to thirty metres — the range the
     * game is actually played at and the one the atlas had never been judged
     * from.
     *
     * BARK. The wood carried `uWood` and the baked facet tone and nothing else,
     * so an Amazon trunk at ten metres was an untextured brown prism.
     * `grain.ts` IS chained onto this material, but its noise is isotropic at
     * about half a metre and a trunk is half a metre wide — one blob across the
     * whole trunk, which tints it and does not texture it. Bark is VERTICAL:
     * fast around the trunk and slow up it, which is what the 150/14 ratio
     * says. IN THE SKELETON'S OWN UNIT-HEIGHT FRAME, so the bark scales with
     * the tree for free — and that frame is why the first numbers were an
     * order out: a trunk's radius there is about 0.02, not half a metre, so
     * 34 put barely one light-to-dark transition across the whole trunk.
     *
     * THE CARD EDGE. Cards are double-sided and lit, so one turned edge-on to
     * the eye is a one-pixel line at whatever the sun gives it — and this
     * engine quantises to fourteen levels and magnifies with nearest
     * neighbour, which turns exactly that into the white contour diagram the
     * rendering doctrine forbids. A card is pulled toward a darker tone as it
     * turns away, so it fades into the crown instead of drawing a line; its
     * projected area there is nearly nothing, so nothing is lost.
     *
     * AT `normal_fragment_begin`, WHICH NOTHING ELSE HOOKS — `grain.ts` owns
     * `color_fragment`, `terrainFx` owns `worldpos_vertex`,
     * `lights_fragment_begin` and `dithering_fragment`, and this file's own
     * wind owns `begin_vertex`. `vNormal` does NOT exist here: the material is
     * flat-shaded and three declares that varying only `#ifndef FLAT_SHADED`.
     * `normal` has just been derived and `vViewPosition` is declared by the
     * Lambert shader itself.
     */
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vEzWood; varying vec3 vEzLocal; varying float vEzJit; varying float vEzSky;
        varying vec3 vEzEnv;
        uniform float uEzBark; uniform float uEzEdge; uniform float uEzSky;
        ${EZ_NOISE_GLSL}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        if (vEzWood > 0.5) {
          if (uEzBark > 0.001) {
            float ezB = ezNoise(vec3(vEzLocal.x * 150.0, vEzLocal.y * 14.0 + vEzJit * 37.0, vEzLocal.z * 150.0));
            diffuseColor.rgb *= 1.0 + (ezB - 0.5) * uEzBark;
          }
        } else {
          // ── THE CROWN'S OWN LIGHT AND DARK ──
          //
          // The radial pair below was the whole of it: outer foliage keeps its
          // colour, the sheltered interior loses some. It is cheap, it needs no
          // attribute, and it is an APPROXIMATION OF A CENTRED CROWN — it reads
          // length(vEzLocal.xz) and vEzLocal.y and knows nothing about
          // where this tree's foliage actually is. Right for a round oak;
          // wrong for an umbrella acacia, a one-sided wind-flagged conifer, a
          // high crown, a palm's fronds — which is most of what the atlas is
          // about to grow.
          //
          // aSky is the MEASURED version: nine rays over the upper
          // hemisphere per foliage cluster at decode, blocked by the tree's own
          // other clusters (anchorSky). It costs nothing at runtime — it is
          // an attribute — and it quantises into large coherent masses rather
          // than a smooth radial ramp, which is what fourteen levels want.
          //
          // The range is wider than the radial term's 0.74..1.0 on purpose:
          // both reviews of the atlas said the same thing, that the crowns
          // carry no light at all. 1.06 at the top is still well under the
          // bloom cut for a crown colour around 0.3-0.42.
          float ezOuter = smoothstep(0.06, 0.42, length(vEzLocal.xz));
          float ezUpper = smoothstep(0.30, 1.0, vEzLocal.y);
          float ezRad = mix(0.74, 1.0, max(ezOuter, ezUpper));
          //
          // THE LIT FLANK CARRIES THE LIFT, NOT THE WHOLE CROWN. Reported from
          // the seat the moment the crown closed: every tree reads as a black
          // silhouette. Measured on the control sheet, the foliage's mean luma
          // at 200 m went 59 to 40 of 255 for a conifer — a full palette step —
          // and the cause is the merge doing its job: the bright sky between
          // the whorls became foliage. A blanket lift would undo that and give
          // back the haze-coloured mush; opening the TOP of the window instead
          // leaves the shaded flank where it is and lets the sunlit one climb,
          // which is the light the crown was said to be missing in the first
          // place. 1.30 on a crown around 0.42 green is 0.55, under the 0.62
          // bloom cut with room to spare.
          diffuseColor.rgb *= mix(ezRad, mix(0.62, 1.30, vEzSky), uEzSky);
          // ── AND THE WHOLE CROWN LIGHTS AS ONE MASS ──
          // A pad heap presents facets pointing every way, so Lambert answers a
          // different number on each and the crown gets a random tone per facet
          // rather than a sunlit side. Turning the shading normal toward the
          // crown's own envelope (aEnv, measured at decode) is what gives it
          // one lit flank and one shaded flank — coherent over every cluster,
          // which is the only kind of light fourteen levels can carry.
          // Not all the way: a little of the facet keeps the crown from
          // reading as a painted ball.
          if (uEzSky > 0.001 && dot(vEzEnv, vEzEnv) > 1e-6) {
            normal = normalize(mix(normal, normalize(vEzEnv), 0.78 * uEzSky));
          }
          if (uEzEdge < 0.999) {
          float ezNdv = abs(dot(normalize(normal), normalize(vViewPosition)));
          diffuseColor.rgb *= mix(uEzEdge, 1.0, smoothstep(0.0, 0.35, ezNdv));
          }
        }`);
  };
  return mat;
}
