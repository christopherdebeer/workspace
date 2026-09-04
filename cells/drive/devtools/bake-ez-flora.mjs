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

/**
 * THE RECIPES ARE THE LAB'S OWN JSON. Open /lab/flora-ez, turn the dials until
 * a tree reads, press COPY, paste the object here under its family, and bake.
 * `reduction.leafAs` decides what the crown is made of: 'card' takes the
 * package's own leaf quads (two triangles each, opaque, at leafScale); 'clump'
 * takes only their centres and the world stands a Drive blob on each —
 * 'icosa' (20 triangles), 'flat' (the same pressed to a pad) or 'cone' (an
 * open four-sided frond). `clumpM` is metres on the lab's 8 m tree.
 *
 * The world pays for every tree in VEG_RANGE at once, so the cost line the
 * bake prints per variant is the number to watch: main.ts scales the tree
 * caps to TREE_TRI_BUDGET, keeping the nearest, so a richer recipe means a
 * thinner far wood, never a slower frame.
 */
const LAB_HEIGHT_M = 8;
const RECIPES = {
  broadleaf: [
    { preset: 'Oak Medium', seed: 387, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Medium', seed: 91, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Small', seed: 387, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Aspen Small', seed: 387, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 0.6, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Ash Small', seed: 387, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 0.4, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Medium', seed: 12, reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
  ],
  // The pasted pine put a pad on every one of 672 anchors — 15k triangles a
  // tree — and its seven-sided wood was 1.9k on its own. Four-sided branches,
  // a third of the children and a fifth of the leaves keep the whorls and
  // the pads at a price the budget can carry.
  conifer: [
    { preset: 'Pine Small', seed: 387, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Small', seed: 84, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Small', seed: 7, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Medium', seed: 3, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.25, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
  ],
  snag: [
    { preset: 'Ash Small', seed: 12, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Aspen Small', seed: 71, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Ash Small', seed: 41, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Small', seed: 37, reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
  ],
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
  o.leaves.size *= r.leafScale;
  o.leaves.billboard = 'single';
  if (r.leafStart > 0) o.leaves.start = r.leafStart;
  tree.generate();
  const wood = tree.branchesMesh.geometry;
  const pos = wood.getAttribute('position');
  const idx = wood.index;
  const cardPos = tree.leavesMesh.geometry.getAttribute('position');
  const cardIdx = tree.leavesMesh.geometry.index;
  // Anchors: the centre of every card (four vertices a single billboard).
  const anchors = [];
  if (cardPos) for (let i = 0; i + 4 <= cardPos.count; i += 4) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) { x += cardPos.getX(i + k); y += cardPos.getY(i + k); z += cardPos.getZ(i + k); }
    anchors.push(x / 4, y / 4, z / 4);
  }
  // Normalise: wood on y=0, top of wood-or-crown at y=1.
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  if (r.leafAs === 'card' && cardPos) for (let i = 0; i < cardPos.count; i++) maxY = Math.max(maxY, cardPos.getY(i));
  else for (let i = 1; i < anchors.length; i += 3) maxY = Math.max(maxY, anchors[i]);
  const s = 1 / Math.max(1e-6, maxY - minY);
  const P = new Int16Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    P[i * 3] = q(pos.getX(i) * s); P[i * 3 + 1] = q((pos.getY(i) - minY) * s); P[i * 3 + 2] = q(pos.getZ(i) * s);
  }
  const I = new Uint16Array(idx.count);
  for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
  if (pos.count > 65535) throw new Error(`${preset}/${seed}: ${pos.count} vertices do not fit a Uint16 index`);
  // The crown: cards as quads (4 vertices, 2 triangles, the package's own
  // index tells the winding) or anchors for the world to stand blobs on.
  let C = new Int16Array(0), CI = new Uint16Array(0), A = new Int16Array(0);
  let crown = { shape: 'none', r: 0 };
  if (r.leafAs === 'card' && cardPos && cardIdx && r.leaves > 0) {
    C = new Int16Array(cardPos.count * 3);
    for (let i = 0; i < cardPos.count; i++) {
      C[i * 3] = q(cardPos.getX(i) * s); C[i * 3 + 1] = q((cardPos.getY(i) - minY) * s); C[i * 3 + 2] = q(cardPos.getZ(i) * s);
    }
    CI = new Uint16Array(cardIdx.count);
    for (let i = 0; i < cardIdx.count; i++) CI[i] = cardIdx.getX(i);
    if (cardPos.count > 65535) throw new Error(`${preset}/${seed}: ${cardPos.count} card vertices do not fit a Uint16 index`);
    crown = { shape: 'card', r: 0 };
  } else if (r.leaves > 0 && anchors.length) {
    A = new Int16Array(anchors.length);
    for (let i = 0; i < anchors.length; i += 3) {
      A[i] = q(anchors[i] * s); A[i + 1] = q((anchors[i + 1] - minY) * s); A[i + 2] = q(anchors[i + 2] * s);
    }
    crown = { shape: r.clumpShape, r: r.clumpM / LAB_HEIGHT_M };
  }
  const cardTris = CI.length / 3;
  const blobTris = { icosa: 20, flat: 8, cone: 4, none: 0, card: 0 }[crown.shape] * (A.length / 3);   // a pad is a pressed octahedron
  return { name: `${preset} #${seed}`, verts: pos.count, tris: idx.count / 3, cards: cardPos ? cardPos.count / 4 : 0,
    drawn: idx.count / 3 + cardTris + blobTris, crown, P, I, C, CI, A };
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
for (const [family, list] of Object.entries(RECIPES)) {
  const variants = list.map(({ preset, seed, reduction }) => {
    const v = generate(preset, seed, reduction);
    total += v.P.byteLength + v.I.byteLength + v.C.byteLength + v.CI.byteLength + v.A.byteLength;
    console.log(`${family.padEnd(10)} ${v.name.padEnd(18)} wood ${String(v.tris).padStart(5)}t  crown ${v.crown.shape.padEnd(5)} ${String(v.crown.shape === 'card' ? v.CI.length / 3 : v.A.length / 3).padStart(4)} → ${String(v.drawn).padStart(6)}t drawn`);
    return { name: v.name, verts: v.verts, tris: v.tris, drawn: v.drawn, crown: v.crown,
      pos: b64(v.P), idx: b64(v.I), cards: b64(v.C), cardIdx: b64(v.CI), anc: b64(v.A) };
  });
  families[family] = { variants, meanDrawn: Math.round(variants.reduce((n, v) => n + v.drawn, 0) / variants.length) };
}
const body = JSON.stringify({ q: Q, families }, null, 1).replace(/\n\s*/g, '\n ');
writeFileSync(OUT, `// GENERATED by devtools/bake-ez-flora.mjs — do not edit; re-bake.
// EZ-Tree skeletons per family: wood as Int16 positions (1/${Q} of the tree's
// height, standing on y=0 with its top at y=1) and Uint16 triangle indices;
// the crown as leaf cards (positions + indices) or as anchors for blobs;
// all base64 little-endian. drawn = the triangles the world draws per tree.
// ${Object.values(families).reduce((n, f) => n + f.variants.length, 0)} variants, ${(total / 1024).toFixed(0)} KB of arrays.
export interface EzBakedCrown { shape: 'card' | 'icosa' | 'flat' | 'cone' | 'none'; r: number }
export interface EzBakedVariant { name: string; verts: number; tris: number; drawn: number; crown: EzBakedCrown; pos: string; idx: string; cards: string; cardIdx: string; anc: string }
export interface EzBakedFamily { variants: EzBakedVariant[]; meanDrawn: number }
export const EZ_BAKE: { q: number; families: Record<'broadleaf' | 'conifer' | 'snag', EzBakedFamily> } = ${body};
`);
console.log(`wrote ${OUT}: ${(total / 1024).toFixed(0)} KB of arrays`);
