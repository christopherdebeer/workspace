/**
 * ── BAKE EZ-TREE SKELETONS INTO THE CLIENT ──
 *
 * The flora-ez lab established that EZ-Tree's WOOD, cut down hard and wearing
 * Drive's own crowns, reads better than the 20-triangle archetypes — and that
 * the package itself (4 MB, twenty embedded textures) must never reach a
 * player. So the skeletons are generated here, in node, and written as a
 * generated module the game bundles: positions and indices of the wood, and
 * the anchors the crowns hang on, per variant, quantised to Int16.
 *
 * The recipes mirror the lab's dials (client/flora-ez-lab.ts): change a
 * number there, see it, change it here, bake. Run from the workspace root
 * with the package installed for the session:
 *
 *   npm i --no-save @dgreenheck/ez-tree@1.1.0
 *   node cells/drive/devtools/bake-ez-flora.mjs
 *
 * Every variant is normalised so the wood stands on y=0 and its top is y=1;
 * the world scales it by the site's height. The texture loader the package
 * runs at import touches only document.createElementNS, stubbed below.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };
globalThis.self = globalThis;
const require = createRequire(import.meta.url);
// The package's exports map hides its files; resolve the main and step over.
const pkgDir = dirname(dirname(require.resolve('@dgreenheck/ez-tree')));
const { Tree, TreePreset } = await import(join(pkgDir, 'build/ez-tree.es.js'));

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../client/flora-ez-baked.ts');

/** THE WHOLE-POPULATION RECIPE. Every broadleaf, conifer and snag in the
 *  plant range wears a skeleton — no archetype, no switching with distance —
 *  so the recipe is priced for sixteen hundred broadleaf and fourteen hundred
 *  conifers at once, not a hundred and twenty beside the truck: three-sided
 *  branches, a fifth of the children, four to six crowns. Judge a change in
 *  the lab first (/lab/flora-ez, the EZ REDUCTION dials are these numbers). */
const LEAN = { levels: 2, sections: 0.2, segments: 0.35, children: 0.2, leaves: 0.06, leafStart: -1 };
const RECIPES = {
  // Crown 2.4 m on an 8 m tree; a Drive icosahedron on every anchor.
  broadleaf: {
    crown: 0.3, shape: 'icosa',
    variants: [
      // Four crowns each: the leaf fraction is per preset because an aspen
      // carries twice the leaves an oak does and an ash three times.
      ['Oak Small', 37, LEAN], ['Oak Small', 118, LEAN], ['Aspen Small', 5, { ...LEAN, leaves: 0.03 }],
      ['Aspen Small', 71, { ...LEAN, leaves: 0.03 }], ['Ash Small', 12, { ...LEAN, leaves: 0.01 }], ['Oak Medium', 9, { ...LEAN, leaves: 0.015 }],
    ],
  },
  // One frond at each branch tip: a single leaf per branch, started at 0.9.
  conifer: {
    crown: 0.17, shape: 'cone',
    variants: [
      ['Pine Small', 37, { ...LEAN, children: 0.16, leaves: 0.05, leafStart: 0.9 }],
      ['Pine Small', 84, { ...LEAN, children: 0.16, leaves: 0.05, leafStart: 0.9 }],
      ['Pine Small', 7, { ...LEAN, children: 0.16, leaves: 0.05, leafStart: 0.9 }],
      ['Pine Medium', 3, { ...LEAN, children: 0.12, leaves: 0.05, leafStart: 0.9 }],
    ],
  },
  // Bare, and thinner still.
  snag: {
    crown: 0, shape: 'none',
    variants: [
      ['Ash Small', 12, { ...LEAN, children: 0.15, leaves: 0 }],
      ['Aspen Small', 71, { ...LEAN, children: 0.15, leaves: 0 }],
      ['Ash Small', 41, { ...LEAN, children: 0.15, leaves: 0 }],
      ['Oak Small', 37, { ...LEAN, children: 0.15, leaves: 0 }],
    ],
  },
};

function generate(preset, seed, r) {
  const tree = new Tree();
  tree.options.copy(TreePreset[preset]);
  const o = tree.options;
  o.seed = seed;
  o.bark.textured = false;
  o.branch.levels = Math.max(1, Math.min(o.branch.levels, r.levels));
  for (const l of [0, 1, 2, 3]) {
    o.branch.sections[l] = Math.max(2, Math.round(o.branch.sections[l] * r.sections));
    o.branch.segments[l] = Math.max(3, Math.round(o.branch.segments[l] * r.segments));
  }
  for (const l of [0, 1, 2]) o.branch.children[l] = Math.round(o.branch.children[l] * r.children);
  o.leaves.count = Math.max(0, Math.round(o.leaves.count * r.leaves));
  o.leaves.billboard = 'single';
  if (r.leafStart >= 0) o.leaves.start = r.leafStart;
  tree.generate();
  const wood = tree.branchesMesh.geometry;
  const pos = wood.getAttribute('position');
  const idx = wood.index;
  const cards = tree.leavesMesh.geometry.getAttribute('position');
  const anchors = [];
  if (cards) for (let i = 0; i + 4 <= cards.count; i += 4) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) { x += cards.getX(i + k); y += cards.getY(i + k); z += cards.getZ(i + k); }
    anchors.push(x / 4, y / 4, z / 4);
  }
  // Normalise: wood on y=0, top of wood-or-anchors at y=1.
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  for (let i = 1; i < anchors.length; i += 3) maxY = Math.max(maxY, anchors[i]);
  const s = 1 / Math.max(1e-6, maxY - minY);
  const P = new Int16Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    P[i * 3] = q(pos.getX(i) * s); P[i * 3 + 1] = q((pos.getY(i) - minY) * s); P[i * 3 + 2] = q(pos.getZ(i) * s);
  }
  const I = new Uint16Array(idx.count);
  for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
  const A = new Int16Array(anchors.length);
  for (let i = 0; i < anchors.length; i += 3) {
    A[i] = q(anchors[i] * s); A[i + 1] = q((anchors[i + 1] - minY) * s); A[i + 2] = q(anchors[i + 2] * s);
  }
  if (pos.count > 65535) throw new Error(`${preset}/${seed}: ${pos.count} vertices do not fit a Uint16 index`);
  return { name: `${preset} #${seed}`, verts: pos.count, tris: idx.count / 3, anchors: anchors.length / 3, P, I, A };
}
const Q = 10000;
function q(v) {
  const n = Math.round(v * Q);
  if (n > 32767 || n < -32768) throw new Error(`value ${v} does not fit Int16 at 1/${Q}`);
  return n;
}
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

const families = {};
let total = 0;
for (const [family, recipe] of Object.entries(RECIPES)) {
  const variants = recipe.variants.map(([preset, seed, r]) => {
    const v = generate(preset, seed, r);
    total += v.P.byteLength + v.I.byteLength + v.A.byteLength;
    const crownTris = recipe.shape === 'icosa' ? 20 : recipe.shape === 'cone' ? 4 : 0;   // an open four-sided frond
    console.log(`${family.padEnd(10)} ${v.name.padEnd(18)} verts ${String(v.verts).padStart(5)} wood ${String(v.tris).padStart(5)}t anchors ${String(v.anchors).padStart(3)} → ${String(v.tris + v.anchors * crownTris).padStart(5)}t drawn`);
    return { name: v.name, verts: v.verts, tris: v.tris, anchors: v.anchors, pos: b64(v.P), idx: b64(v.I), anc: b64(v.A) };
  });
  families[family] = { crown: recipe.crown, shape: recipe.shape, variants };
}
const body = JSON.stringify({ q: Q, families }, null, 1).replace(/\n\s*/g, '\n ');
writeFileSync(OUT, `// GENERATED by devtools/bake-ez-flora.mjs — do not edit; re-bake.
// EZ-Tree skeletons per family: wood as Int16 positions (1/${Q} of the tree's
// height, standing on y=0 with its top at y=1) and Uint16 triangle indices,
// plus the leaf anchors the crowns hang on, all base64 little-endian.
// ${Object.values(families).reduce((n, f) => n + f.variants.length, 0)} variants, ${(total / 1024).toFixed(0)} KB of arrays.
export interface EzBakedVariant { name: string; verts: number; tris: number; anchors: number; pos: string; idx: string; anc: string }
export interface EzBakedFamily { crown: number; shape: 'icosa' | 'cone' | 'none'; variants: EzBakedVariant[] }
export const EZ_BAKE: { q: number; families: Record<'broadleaf' | 'conifer' | 'snag', EzBakedFamily> } = ${body};
`);
console.log(`wrote ${OUT}: ${(total / 1024).toFixed(0)} KB of arrays`);
