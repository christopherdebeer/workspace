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

/**
 * ── THE SILHOUETTE VOCABULARY ──
 *
 * Every variant declares what SHAPE it is, and the bake measures the geometry
 * to check the claim. This exists because the atlas had no vocabulary at all:
 * fourteen variants named `Oak Medium #387` and `Pine Small #84`, a recipe and
 * a seed, with nothing a caller could ask in. A guild that knows this ground
 * grows umbrella-crowned trees over a bare trunk had no way to say so, so the
 * world picked a silhouette by hashing the tree's own coordinates — which is
 * why two trees in one wood came out an oak and an aspen.
 *
 * THE FORM IS GEOMETRY, NOT BIOLOGY, and the split matters. This file says
 * what a shape IS; `client/guild.ts` says which shapes a place WANTS. Putting
 * a climate affinity on a variant here would scatter the ecology across two
 * files and make the atlas un-reusable — the same umbrella crown is an acacia
 * in the Sahel, a paperbark in Kakadu and a monkey-puzzle nowhere at all.
 *
 *   round     a broad crown over most of the upper tree — oak, ash
 *   columnar  narrow and tall — aspen, poplar, cypress
 *   conic     widest at the crown's base and tapering up — pine, spruce
 *   umbrella  a wide crown confined to the top, over a clear trunk — acacia
 *   palm      a narrow tuft at the very top, over a long clear trunk
 *   bare      no crown at all — a snag
 */
const FORMS = ['round', 'columnar', 'conic', 'umbrella', 'palm', 'bare'];

/**
 * WHAT THE GEOMETRY ACTUALLY SAYS, from the normalised crown (y in 0..1).
 *
 *   clear  the height below which no crown mass exists — the bare trunk
 *   width  the crown's widest radius, as a fraction of the tree's height
 *   taper  how the radius changes with height through the crown: negative is
 *          a cone (wide at the bottom), positive a mushroom, near zero a
 *          column or a ball
 *
 * Measured from the crown points the world will actually DRAW — the card
 * vertices for a card crown, the anchors for a blob crown — so a recipe that
 * changes `leafAs` cannot silently change what the shape is called.
 */
function silhouette(crownPts) {
  if (!crownPts.length) return { form: 'bare', clear: 1, width: 0, taper: 0, crownR: 0, lean: 0 };
  let lo = Infinity, width = 0;
  for (let i = 0; i < crownPts.length; i += 3) {
    lo = Math.min(lo, crownPts[i + 1]);
    width = Math.max(width, Math.hypot(crownPts[i], crownPts[i + 2]));
  }
  // ── `width` IS MEASURED FROM THE TRUNK'S BASE, SO ON A LEANING TREE IT IS
  //    THE LEAN ──
  //
  // Every radius above is `hypot(x, z)` about x = z = 0, which is where the
  // trunk STARTS. That is the crown's own axis only for a tree that stands up
  // straight, and the atlas's leaniest recipe is the palm: measured, its crown
  // is a clump spanning x 0.168..0.238 and z -0.019..0.030, so `width` 0.238
  // is **0.209 of lean and 0.029 of crown** and the crown's true radius is
  // under an eighth of what the column reports.
  //
  // That matters because it is the number the palm was TUNED against. The
  // recipe's own note records `branch.force` taking "the crown from 0.10 of the
  // tree across to 0.22" and `length[1]` moving it "from 0.060 to 0.070 and no
  // further" — both readings of a quantity that is mostly the lean, so the
  // dial that appeared to work was tipping the tree over and the dial that
  // appeared dead was the frond length.
  //
  // `crownR` is the crown's radius about ITS OWN centroid and `lean` is how far
  // that centroid stands off the trunk's base. width ~= lean + crownR for a
  // leaning tree and crownR alone for an upright one, so the two columns say
  // which a recipe has. `width` is left exactly as it was: the form thresholds
  // were set against it, and a vocabulary that moves under its own tests is
  // worth less than a ruler that is honest about what it measures.
  let cx = 0, cy = 0, cz = 0;
  const n = crownPts.length / 3;
  for (let i = 0; i < crownPts.length; i += 3) { cx += crownPts[i]; cy += crownPts[i + 1]; cz += crownPts[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let crownR = 0;
  for (let i = 0; i < crownPts.length; i += 3) {
    crownR = Math.max(crownR, Math.hypot(crownPts[i] - cx, crownPts[i + 2] - cz));
  }
  const lean = Math.hypot(cx, cz);
  // The radius in the crown's lower and upper halves, so a cone and a mushroom
  // part company. Empty bands fall back to the whole, which reads as no taper.
  const mid = lo + (1 - lo) / 2;
  let rLo = 0, rHi = 0;
  for (let i = 0; i < crownPts.length; i += 3) {
    const r = Math.hypot(crownPts[i], crownPts[i + 2]);
    if (crownPts[i + 1] < mid) rLo = Math.max(rLo, r); else rHi = Math.max(rHi, r);
  }
  const taper = width > 1e-6 ? (rHi - rLo) / width : 0;
  // A BLOB CROWN'S WIDTH IS ITS ANCHOR SPREAD, NOT ITS DRAWN SILHOUETTE: the
  // blob's own radius stands outside these points and is not counted, so a
  // conifer measures ~0.075 narrower than it draws and a palm ~0.2. Left as it
  // is on purpose — the thresholds below were set against these numbers, and
  // adding the radius would reclassify the palms (0.24 + 0.2 is past the 0.30
  // the rule calls palm) for no gain. Read `width` as "how far the crown's
  // anchors reach", and compare a card crown with a card crown.

  // ── ORDER, AND TWO THRESHOLDS THE FIRST BAKE CORRECTED ──
  //
  // The trunk-clearance cases go first: a palm and a columnar tree can share a
  // width and are told apart by what is UNDER the crown, not by the crown.
  //
  // Then TAPER BEFORE WIDTH, because a narrow cone is still a cone. Checking
  // width first called `Pine Small #387` columnar at width 0.22 with a taper of
  // −0.31 — a small pine is a thin tree and unmistakably conical, and the rule
  // was reading its thinness as its shape.
  //
  // And an umbrella is measured against a REAL TREE, not against a recipe that
  // needs to pass. A mature Vachellia tortilis stands about 8 m with roughly
  // 3 m of clear trunk and a crown some 10 m across — so `clear` ≈ 0.38 and
  // `width` (a RADIUS over the height) ≈ 0.6. The first cut asked for clear
  // > 0.45, which no acacia on earth has, and no dial could satisfy it without
  // making the crown too narrow to be one: pushing the trunk up raises `clear`
  // and lowers `width` together, so the two demands fought. 0.38 / 0.45 is the
  // real tree, and it reclassifies none of the fourteen variants that already
  // existed — checked, because a threshold moved to fit a recipe is a
  // vocabulary that has stopped meaning anything.
  const form = lo > 0.62 && width < 0.30 ? 'palm'
    : lo > 0.38 && width >= 0.45 ? 'umbrella'
      : taper < -0.28 ? 'conic'
        : width < 0.26 ? 'columnar'
          : 'round';
  return { form, clear: lo, width, taper, crownR, lean };
}

/**
 * ── HOW BIG A LEAF CARD IS AGAINST THE CROWN IT HANGS IN ──
 *
 * The number that decides whether a crown reads as foliage or as a stack of
 * plates, and the bake could not see it: card size is set by `leafScale` on the
 * preset's own leaf, which is a fraction of the TREE, so a narrow crown gets
 * the same card a broad one does. Measured over the first bake: a round oak's
 * card is 0.11-0.15 of its crown's diameter — seven or eight cards across — and
 * a columnar aspen's is 0.49, so TWO cards span the whole crown. From the seat
 * at 30 m that aspen is a column of overlapping plates beside a conifer that
 * reads as a tree.
 *
 * Returned as a fraction of the crown's DIAMETER, because that is the ratio the
 * eye judges: a card must be small against the thing it is filling, whatever
 * size the thing is.
 */
function cardSpan(cardPts, width) {
  const n = cardPts.length / 3;
  if (n < 4 || width <= 1e-6) return 0;
  let sum = 0, cards = 0;
  for (let c = 0; c + 3 < n; c += 4) {
    let d = 0;
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const ax = cardPts[(c + a) * 3], ay = cardPts[(c + a) * 3 + 1], az = cardPts[(c + a) * 3 + 2];
        const bx = cardPts[(c + b) * 3], by = cardPts[(c + b) * 3 + 1], bz = cardPts[(c + b) * 3 + 2];
        d = Math.max(d, Math.hypot(ax - bx, ay - by, az - bz));
      }
    }
    sum += d; cards++;
  }
  return cards ? (sum / cards) / (2 * width) : 0;
}
/** Where a card stops reading as a leaf. The round broadleaves sit at 0.11-0.15
 *  and read as canopy; the columnar pair sat at 0.49 and read as plates. 0.25
 *  is the line, set between the two AND above every variant that already
 *  looked right, so it flags the failure and not the family. */
const CARD_MAX = 0.25;

const RECIPES = {
  broadleaf: [
    { preset: 'Oak Medium', seed: 387, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Medium', seed: 91, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Small', seed: 387, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    // NOT COLUMNAR, though an aspen is the tree that ought to be: at width 0.34
    // over a half-bare trunk this is a leggy round tree, and the measurement
    // said so. THE ATLAS HAS NO COLUMNAR VARIANT AT ALL — every broadleaf here
    // is 0.34 to 0.57 wide — which is a real gap in the vocabulary and worth
    // more than a label that hides it.
    { preset: 'Aspen Small', seed: 387, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1.5, leafScale: 1.7, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Ash Small', seed: 387, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 0.4, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Medium', seed: 12, form: 'round', reduction: { levels: 3, sections: 0.7, segments: 0.7, children: 0.35, leaves: 1, leafScale: 3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0 } },
    // ── THE COLUMN ──
    //
    // The vocabulary's own gap: before these, every broadleaf in the atlas
    // measured 0.34 to 0.57 wide and the word `columnar` described nothing.
    // A Lombardy poplar on a French roadside and a cypress in Tuscany are
    // among the most recognisable trees there are, and the game had no way to
    // draw either.
    //
    // Branches from NEAR THE BASE (start 0.06), swept steeply up (angle 20)
    // and held there by an upward `force` — the same dial the palm uses,
    // pointed the other way. The first attempt kept the preset's high branch
    // start and produced a `palm`: a narrow crown on a bare pole is a palm by
    // this vocabulary's own definition, and correctly so. A poplar carries its
    // foliage almost to the ground, and `leaves.start` 0.05 is what says it.
    //
    // AND THE CARD IS SIZED AGAINST THE CROWN, NOT THE TREE. The first cut of
    // these two measured `columnar` correctly and drew as a stack of plates:
    // `leafScale` acts on the preset's leaf, which is a fraction of the TREE,
    // so a crown a fifth as wide as an oak's got the same card and TWO of them
    // spanned it (`card` 0.49 against a round oak's 0.13). The fix is both
    // halves of that ratio — a slightly wider crown (longer, less steeply
    // swept level-1 branches; still under the 0.26 the vocabulary calls
    // columnar) and a card under half the size, with the leaf count raised so
    // the crown still closes. `card` is measured and flagged at bake time now,
    // so the next recipe cannot reintroduce it quietly.
    { preset: 'Aspen Small', seed: 29, form: 'columnar',
      opts: { branchStart: { 1: 0.06, 2: 0.1 }, branchAngle: { 1: 34, 2: 26 }, leavesStart: 0.05,
        length: { 0: 40, 1: 24, 2: 11 }, force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.05 } },
      reduction: { levels: 2, sections: 0.7, segments: 0.7, children: 0.5, leaves: 3, leafScale: 1.3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0.05 } },
    { preset: 'Aspen Small', seed: 11, form: 'columnar',
      opts: { branchStart: { 1: 0.06, 2: 0.1 }, branchAngle: { 1: 34, 2: 26 }, leavesStart: 0.05,
        length: { 0: 40, 1: 24, 2: 11 }, force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.05 } },
      reduction: { levels: 2, sections: 0.7, segments: 0.7, children: 0.5, leaves: 3, leafScale: 1.3, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'icosa', leafStart: 0.05 } },
  ],
  // The pasted pine put a pad on every one of 672 anchors — 15k triangles a
  // tree — and its seven-sided wood was 1.9k on its own. Four-sided branches,
  // a third of the children and a fifth of the leaves keep the whorls and
  // the pads at a price the budget can carry.
  conifer: [
    { preset: 'Pine Small', seed: 387, form: 'conic', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Small', seed: 84, form: 'conic', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Small', seed: 7, form: 'conic', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.3, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
    { preset: 'Pine Medium', seed: 3, form: 'conic', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.25, leaves: 0.2, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 0.6, clumpShape: 'flat', leafStart: 0.9 } },
  ],
  // ── THE UMBRELLA ──
  //
  // An acacia is a clear trunk with a wide flat crown balanced on it. Four
  // dials get there from an oak, and the order they were found in matters:
  //
  //   branchStart[1] 0.84 and branchStart[2] 0.55 — branches begin high and
  //     their own children begin high on THEM. The second is not optional: at
  //     start[1] alone the clear trunk stalled at 0.23 of the height, because
  //     level-2 branches hung back down through it.
  //   length[0] 45 against length[1] 20 — a long trunk and short arms. This is
  //     the lever that actually sets the ratio, and it is a TRADE: lengthening
  //     the trunk raises `clear` and narrows `width` in the same move, so
  //     there is a frontier and the acacia sits on it.
  //   branchAngle[1] 58, NOT near-horizontal. Eighty degrees looks like the
  //     right answer for a flat crown and is not: the arms go out, their
  //     children droop off them, and the clear trunk fell from 0.45 to 0.30.
  //
  // Three seeds off one preset rather than three presets, because the shape is
  // the dials' doing and the seed is what makes each tree its own.
  acacia: [
    { preset: 'Oak Medium', seed: 17, form: 'umbrella',
      opts: { branchStart: { 1: 0.84, 2: 0.55 }, branchAngle: { 1: 58, 2: 30 }, leavesStart: 0.6,
        length: { 0: 45, 1: 20, 2: 12 } },
      reduction: { levels: 2, sections: 0.6, segments: 0.6, children: 0.45, leaves: 0.8, leafScale: 3.4, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'flat', leafStart: 0.6 } },
    { preset: 'Oak Medium', seed: 23, form: 'umbrella',
      opts: { branchStart: { 1: 0.84, 2: 0.55 }, branchAngle: { 1: 58, 2: 30 }, leavesStart: 0.6,
        length: { 0: 45, 1: 20, 2: 12 } },
      reduction: { levels: 2, sections: 0.6, segments: 0.6, children: 0.45, leaves: 0.8, leafScale: 3.4, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'flat', leafStart: 0.6 } },
    { preset: 'Oak Medium', seed: 3, form: 'umbrella',
      opts: { branchStart: { 1: 0.84, 2: 0.55 }, branchAngle: { 1: 58, 2: 30 }, leavesStart: 0.6,
        length: { 0: 45, 1: 26, 2: 16 } },
      reduction: { levels: 2, sections: 0.6, segments: 0.6, children: 0.45, leaves: 0.8, leafScale: 3.4, billboard: 'single', leafAs: 'card', clumpM: 2.6, clumpShape: 'flat', leafStart: 0.6 } },
  ],
  // ── THE PALM ──
  //
  // A bare vertical trunk with a tuft of arching fronds on top.
  //
  //   levels 1. EZ counts the trunk as level 0, so ONE level is a trunk and
  //     its fronds — exactly a palm — and level 2 would put twigs on the
  //     fronds. Setting levels 2 with children[1] = 0 produces NO LEAVES at
  //     all, because foliage hangs on the deepest level that exists.
  //   branchStart[1] 0.92 — every frond leaves the trunk at the top.
  //   length[1] 200 and force at 0.02 — see below. These were 30 and 0.05 and
  //     both were wrong, in opposite directions, for one reason.
  //
  // ── WHAT THE OLD NUMBERS DREW, AND WHY NOBODY COULD SEE IT ──
  //
  // The recipe shipped for months producing a palm whose CROWN RADIUS was
  // **0.045 of its height** — a tuft 9% of the tree across, wearing a decode
  // element of 0.2, so every leaflet was four times the whole crown and the
  // control sheet photographed a leaning pole with a solid green cone on top.
  //
  // It survived because `silhouette`'s `width` is `hypot(x, z)` about the
  // trunk's BASE, and this is the atlas's leaniest recipe: of the 0.238 that
  // column reported, **0.209 was lean and 0.029 was crown**. So the two dials
  // were tuned against a number that was mostly the tree falling over, and the
  // note that stood here recorded exactly the inversion that produces:
  //
  //   "force ... took the crown from 0.10 of the tree across to 0.22, while
  //    length[1] — the obvious lever — moved it from 0.060 to 0.070"
  //
  // Measured again against `crownR`, the crown's radius about its OWN centroid:
  // `force` is not the droop, it is the LEAN — it acts on the trunk as well as
  // on the fronds, and 0.05 was bending the whole tree over (lean 0.209 at
  // 0.05, **0.076 at 0.02**) while the crown it was credited with widening
  // barely moved. And `length[1]`, recorded as dead, is the frond dial after
  // all: 30 → 90 → 200 takes crownR **0.045 → 0.077 → 0.147**.
  //
  // 200 / 0.92 / 0.02 is a real coconut palm to two decimals — crownR 0.147
  // against a real ~0.15, clear 0.67 against a real ~0.7 — where the shipped
  // recipe was 0.045 and 0.83. The trade is genuine and is why `clear` fell:
  // fronds long enough to make a crown hang down past the top of the trunk.
  //
  // The crown is an open CONE per anchor in the bake's terms; `crownOf` draws
  // each one as a FROND — a tapered blade from the crown's heart out to its own
  // anchor — because the anchors are frond tips on a shell and a ball at each
  // one is a ball. `?ezpalm=0` is that A/B.
  palm: [
    { preset: 'Pine Small', seed: 44, form: 'palm',
      opts: { levels: 1, branchStart: { 1: 0.92 }, branchAngle: { 1: 72 }, children: { 0: 10 },
        length: { 0: 26, 1: 200 }, radius: { 0: 1.0 }, gnarliness: { 0: 0.01 }, twist: { 0: 0 },
        force: { direction: { x: 0, y: -1, z: 0 }, strength: 0.02 }, leavesStart: 0.5 },
      reduction: { levels: 1, sections: 0.6, segments: 0.5, children: 1, leaves: 0.35, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 1.6, clumpShape: 'cone', leafStart: 0.5 } },
    { preset: 'Pine Small', seed: 17, form: 'palm',
      opts: { levels: 1, branchStart: { 1: 0.92 }, branchAngle: { 1: 76 }, children: { 0: 9 },
        length: { 0: 30, 1: 200 }, radius: { 0: 0.9 }, gnarliness: { 0: 0.03 }, twist: { 0: 0 },
        force: { direction: { x: 0, y: -1, z: 0 }, strength: 0.02 }, leavesStart: 0.5 },
      reduction: { levels: 1, sections: 0.6, segments: 0.5, children: 1, leaves: 0.35, leafScale: 3, billboard: 'single', leafAs: 'clump', clumpM: 1.6, clumpShape: 'cone', leafStart: 0.5 } },
  ],
  snag: [
    { preset: 'Ash Small', seed: 12, form: 'bare', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Aspen Small', seed: 71, form: 'bare', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Ash Small', seed: 41, form: 'bare', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
    { preset: 'Oak Small', seed: 37, form: 'bare', reduction: { levels: 3, sections: 0.5, segments: 0.5, children: 0.2, leaves: 0, leafScale: 1, billboard: 'single', leafAs: 'clump', clumpM: 0, clumpShape: 'icosa', leafStart: 0 } },
  ],
};

/**
 * SHAPING A TREE EZ-TREE HAS NO PRESET FOR.
 *
 * The package ships sixteen presets and they are all temperate northern: Ash,
 * Aspen, Oak, Pine, three Bushes and a Trellis. The guild asks for an ACACIA in
 * every savanna and dry forest row and a PALM in every mangrove and tropical
 * one — the two most recognisable silhouettes on earth — and the atlas had
 * neither, so the Sahel got oaks and a mangrove got a 20-triangle archetype.
 *
 * They are not new geometry, they are the same generator under different
 * dials. `opts` patches the option tree after the preset is copied and before
 * the reduction, so a recipe can move the things that actually make a shape:
 *
 *   branchStart[l]  where level-l branches begin along their parent, 0..1 —
 *                   the ONE lever that produces a clear trunk, and therefore
 *                   the whole difference between a round tree and an umbrella
 *   branchAngle[l]  degrees off the parent; ~80 is horizontal, which is what
 *                   makes an acacia's crown flat and a palm's fronds arch
 *   levels          1 for a palm: a trunk and its fronds, and nothing else
 *   children[l]     how many at each level — a palm has a handful of fronds
 *   length/radius   [l] as the preset holds them
 *   leavesStart     where foliage begins, so a bare trunk stays bare
 */
function patch(o, opts) {
  if (!opts) return;
  for (const [l, v] of Object.entries(opts.branchStart ?? {})) o.branch.start[l] = v;
  for (const [l, v] of Object.entries(opts.branchAngle ?? {})) o.branch.angle[l] = v;
  for (const [l, v] of Object.entries(opts.length ?? {})) o.branch.length[l] = v;
  for (const [l, v] of Object.entries(opts.radius ?? {})) o.branch.radius[l] = v;
  for (const [l, v] of Object.entries(opts.children ?? {})) o.branch.children[l] = v;
  for (const [l, v] of Object.entries(opts.gnarliness ?? {})) o.branch.gnarliness[l] = v;
  for (const [l, v] of Object.entries(opts.twist ?? {})) o.branch.twist[l] = v;
  // ── `force` IS THE DROOP, AND IT IS WHAT MAKES A PALM A PALM ──
  //
  // It defaults to {0, +1, 0} at 0.01 — every branch is pulled gently UPWARD,
  // which is right for a temperate tree reaching for light and exactly wrong
  // for a frond. Pointed DOWN it arches the level-1 branches out and over, and
  // it moved the palm's crown from 0.10 of its height across to 0.22 while
  // `length[1]`, the obvious lever, moved it from 0.060 to 0.070 and no
  // further. Measured before it was believed: `length[1]` 11 → 30 changed the
  // spread by half a per cent of the tree's height.
  if (opts.force !== undefined) o.branch.force = opts.force;
  if (opts.levels !== undefined) o.branch.levels = opts.levels;
  if (opts.leavesStart !== undefined) o.leaves.start = opts.leavesStart;
  if (opts.leavesAngle !== undefined) o.leaves.angle = opts.leavesAngle;
}

function generate(preset, seed, r, opts) {
  const tree = new Tree();
  tree.options.copy(TreePreset[preset]);
  const o = tree.options;
  o.seed = seed;
  o.bark.textured = false;
  patch(o, opts);
  o.branch.levels = Math.max(1, Math.min(o.branch.levels, r.levels));
  for (const l of [0, 1, 2, 3]) {
    o.branch.sections[l] = Math.max(2, Math.round(o.branch.sections[l] * r.sections));
    o.branch.segments[l] = Math.max(3, Math.round(o.branch.segments[l] * r.segments));
  }
  // A RECIPE'S OWN `children` SURVIVES THE REDUCTION. The reduction exists to
  // cut a preset's cost; a palm that asked for nine fronds means nine, and
  // multiplying them by 0.3 would leave it with three and no crown at all.
  for (const l of [0, 1, 2]) {
    if (opts?.children?.[l] !== undefined) continue;
    o.branch.children[l] = Math.round(o.branch.children[l] * r.children);
  }
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
  // THE SHAPE IS READ OFF THE POINTS THE WORLD DRAWS, not off the recipe —
  // see `silhouette`. Card crowns are measured from their quad vertices and
  // blob crowns from their anchors, both already normalised and quantised, so
  // what is measured is exactly what stands in the world.
  const crownPts = crown.shape === 'card'
    ? Array.from(C, (v) => v / Q)
    : Array.from(A, (v) => v / Q);
  const sil = silhouette(crownPts);
  sil.card = crown.shape === 'card' ? cardSpan(crownPts, sil.width) : 0;
  return { name: `${preset} #${seed}`, verts: pos.count, tris: idx.count / 3, cards: cardPos ? cardPos.count / 4 : 0,
    drawn: idx.count / 3 + cardTris + blobTris, crown, sil, P, I, C, CI, A };
}
const Q = 10000;
function q(v) {
  const n = Math.round(v * Q);
  if (n > 32767 || n < -32768) throw new Error(`value ${v} does not fit Int16 at 1/${Q}`);
  return n;
}
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

const families = {};
const mismatches = [];
let total = 0;
for (const [family, list] of Object.entries(RECIPES)) {
  const variants = list.map(({ preset, seed, form, reduction, opts }) => {
    const v = generate(preset, seed, reduction, opts);
    total += v.P.byteLength + v.I.byteLength + v.C.byteLength + v.CI.byteLength + v.A.byteLength;
    if (!FORMS.includes(form)) throw new Error(`${v.name}: unknown form '${form}' (${FORMS.join('/')})`);
    // ── THE DECLARATION IS CHECKED, NOT TRUSTED ──
    //
    // A recipe says what it is trying to be and the geometry says what it
    // became, and the whole value of the vocabulary is that those two agree.
    // A silent disagreement would be worse than no vocabulary at all: the
    // guild would ask for an umbrella crown and get whatever the dials
    // happened to produce, and nothing downstream could ever tell.
    //
    // It is a WARNING and not a throw, because the boundaries between round
    // and columnar are a judgement and the measurement is a proxy for an eye.
    // A mismatch means look at the tree in the lab, then move the dials or
    // move the declaration — but never leave it unexplained.
    const agrees = v.sil.form === form;
    if (!agrees) mismatches.push(`${family}/${v.name}: declared ${form}, measured ${v.sil.form}`);
    // A CARD TOO BIG FOR ITS CROWN IS A DEFECT THE FORM CHECK CANNOT SEE. The
    // columnar pair measured `columnar` correctly and still drew as plates.
    const cardOk = v.sil.card <= CARD_MAX;
    if (!cardOk) mismatches.push(`${family}/${v.name}: leaf card is ${v.sil.card.toFixed(2)} of the crown's diameter (max ${CARD_MAX})`);
    console.log(`${family.padEnd(10)} ${v.name.padEnd(18)} wood ${String(v.tris).padStart(5)}t  crown ${v.crown.shape.padEnd(5)} ${String(v.crown.shape === 'card' ? v.CI.length / 3 : v.A.length / 3).padStart(4)} → ${String(v.drawn).padStart(6)}t drawn`
      + `  ${agrees ? ' ' : '!'}${form.padEnd(9)} clear ${v.sil.clear.toFixed(2)} width ${v.sil.width.toFixed(2)} taper ${v.sil.taper >= 0 ? '+' : ''}${v.sil.taper.toFixed(2)}`
      + `  card ${v.sil.card.toFixed(2)}${cardOk ? '' : ' !'}`
      + `  crownR ${(v.sil.crownR ?? 0).toFixed(3)} lean ${(v.sil.lean ?? 0).toFixed(3)}`
      + (agrees ? '' : `  ← MEASURED ${v.sil.form}`));
    return { name: v.name, form, verts: v.verts, tris: v.tris, drawn: v.drawn, crown: v.crown,
      sil: { clear: +v.sil.clear.toFixed(3), width: +v.sil.width.toFixed(3), taper: +v.sil.taper.toFixed(3),
        card: +v.sil.card.toFixed(3) },
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
/** What SHAPE this skeleton is, checked at bake time against the geometry —
 *  see \`silhouette\` in the devtool. Geometry, not biology: guild.ts decides
 *  which forms a place wants. */
export type EzForm = ${FORMS.map((f) => `'${f}'`).join(' | ')};
/** The measurement behind the form: the bare trunk below the crown, the
 *  crown's widest radius, and whether it widens or narrows going up — all as
 *  fractions of the tree's own height — plus \`card\`, the mean leaf card as a
 *  fraction of the crown's DIAMETER, which is what decides whether a crown
 *  reads as foliage or as a stack of plates. */
export interface EzBakedSil { clear: number; width: number; taper: number; card: number }
export interface EzBakedVariant { name: string; form: EzForm; verts: number; tris: number; drawn: number; crown: EzBakedCrown; sil: EzBakedSil; pos: string; idx: string; cards: string; cardIdx: string; anc: string }
export interface EzBakedFamily { variants: EzBakedVariant[]; meanDrawn: number }
export const EZ_BAKE: { q: number; families: Record<${Object.keys(families).map((f) => `'${f}'`).join(' | ')}, EzBakedFamily> } = ${body};
`);
console.log(`wrote ${OUT}: ${(total / 1024).toFixed(0)} KB of arrays`);
if (mismatches.length) {
  console.log(`\n** ${mismatches.length} DECLARED FORM(S) THE GEOMETRY DOES NOT AGREE WITH **`);
  for (const m of mismatches) console.log(`   ${m}`);
  console.log('   Look at the tree in /lab/flora-ez, then move the dials or move the');
  console.log('   declaration. A form nothing checks is a label, not a vocabulary.');
}
