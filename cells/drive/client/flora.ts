import * as THREE from 'three';
import { AltBand, BIOME_ORDER, climPick } from './climate';

/**
 * ── FLORA: WHAT A PLANT IS, SEPARATED FROM WHERE ONE GOES ──
 *
 * Two different jobs used to live in one region of main.ts. WHERE a plant goes
 * is the world's business — the cover raster, the density field, the road and
 * building vetoes, the site grid — and it stays there. WHAT a plant IS is not:
 * the archetype geometry, the baked facet tone, the size bands, the biome
 * mixes, the bedrock families and the tint-and-shape lottery are a closed
 * system that needs nothing from the world but a climate and a die.
 *
 * They are split because the second one is the one that gets ITERATED. "Tree
 * detail and diversity" is entirely this file, and judging a change to it by
 * driving somewhere green and looking out of a windscreen is the loop the labs
 * exist to kill. Everything here is pure, so /lab/flora can grow a stand from
 * it directly — the same geometry, the same tone, the same lottery — and the
 * thing on screen in the lab is the thing that ships.
 */

/** A plant, as an instance: what kind, how big, which way up, what colour. */
export type VegKind = 'broadleaf' | 'conifer' | 'palm' | 'snag' | 'bush' | 'rock' | 'grass'
  | 'acacia' | 'cactus' | 'fern' | 'log' | 'spire';
export interface VegSite { x: number; z: number; k: VegKind; s: number; rot: number; h: number; c: THREE.Color;
  /** NON-UNIFORM SCALE, and the cheapest diversity in the file: one rock mesh
   *  stretched flat is a slab, squeezed tall is a standing stone, squashed is
   *  a pebble — no extra geometry, no extra draw call, no extra memory beyond
   *  two numbers. `sy` is the vertical stretch, `sw` the width on one axis. */
  sy?: number; sw?: number;
  /** Lean, radians. Nothing in a landscape sits perfectly plumb: boulders
   *  settle, snags lean out of the wind, a fallen log lies across a slope. */
  tl?: number;
  /** Last time the truck struck this (rocks) — one hit, not a machine gun. */
  hit?: number }

// Archetypes. Each is a squat, flat-shaded silhouette that survives the pixel
// grid; variety comes from shape as much as tint.
export function conifer(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 2.6, 6);
  g.translate(0, 1.3, 0);
  return g;
}
export function broadleaf(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.82, 1);
  g.translate(0, 1, 0);
  return g;
}
export function palm(): THREE.BufferGeometry {
  // A flattened star of fronds — reads as a palm crown in silhouette.
  const g = new THREE.ConeGeometry(1.5, 0.5, 5, 1, true);
  g.rotateX(Math.PI);
  g.translate(0, 1.1, 0);
  return g;
}
export function snag(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.1, 0.22, 2.4, 5);
  g.translate(0, 1.2, 0);
  return g;
}
export function bushGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.1, 0.7, 1.1);
  g.translate(0, 0.6, 0);
  return g;
}
/** THE SWARD'S SHRUB: knee-high, two blobs leaning on each other, the thing
 *  that stands between the flowers and the trees. Sized to one metre so the
 *  sward can scale it from ankle scrub to a small bush. */
export function shrubGeo(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(0.5, 0);
  a.scale(1.15, 0.8, 1.0);
  a.translate(-0.12, 0.42, 0.05);
  const b = new THREE.IcosahedronGeometry(0.36, 0);
  b.scale(1.0, 0.85, 1.1);
  b.translate(0.3, 0.34, -0.14);
  return mergeGeos([a, b]);
}
export function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.2, 0.6, 0.95);
  g.translate(0, 0.35, 0);
  return g;
}
/** Non-indexed concat — enough to build one plant out of several primitives
 *  without pulling in BufferGeometryUtils for four call sites. Flat shading
 *  wants non-indexed anyway, which is what everything here already is. */
export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of list) {
    const a = g.index ? g.toNonIndexed() : g;
    const p = a.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count * 3; i++) pos.push((p.array as ArrayLike<number>)[i]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
/** THE UMBRELLA. Flat on top, tapering underneath — the one silhouette that
 *  says dry savanna from a kilometre away, and the shape a cone makes when
 *  you stand it on its point. */
export function acaciaGeo(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1.7, 0.95, 7);
  g.rotateX(Math.PI);
  g.scale(1, 1, 0.88);
  g.translate(0, 1.5, 0);
  return g;
}
/** A COLUMN WITH ARMS. The desert's vertical, and the only plant here whose
 *  reading depends on the arms being at different heights — symmetry makes it
 *  a candelabra, which is a different (and sillier) plant. */
export function cactusGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.24, 0.3, 2.4, 7);
  trunk.translate(0, 1.2, 0);
  parts.push(trunk);
  for (const [dx, h, base] of [[0.42, 1.05, 1.15], [-0.38, 0.72, 1.55]] as Array<[number, number, number]>) {
    const arm = new THREE.CylinderGeometry(0.16, 0.19, h, 6);
    arm.translate(dx, base + h / 2, 0);
    parts.push(arm);
    const elbow = new THREE.CylinderGeometry(0.15, 0.15, Math.abs(dx), 6);
    elbow.rotateZ(Math.PI / 2);
    elbow.translate(dx / 2, base, 0);
    parts.push(elbow);
  }
  return mergeGeos(parts);
}
/** THE UNDERSTOREY. Fronds radiating from a crown, knee high — what a wet
 *  forest floor and a tropical verge are actually made of, and the layer
 *  between the sward and the bushes that was simply missing. */
export function fernGeo(): THREE.BufferGeometry {
  const v: number[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + 0.4;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.13, len = 0.62 + (b % 2) * 0.22, rise = 0.42;
    v.push(dz * w, 0.06, -dx * w, -dz * w, 0.06, dx * w, dx * len, rise, dz * len);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
/** DEADFALL. A trunk lying where it came down — the horizontal in a world of
 *  verticals, which is most of why it reads. Off-centre in its own cell so a
 *  clump of them does not look stacked. */
export function logGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.26, 0.34, 2.8, 6);
  g.rotateZ(Math.PI / 2);
  g.translate(0.2, 0.3, 0);
  return g;
}
/** THE SHARD. Where rock comes through as a tooth rather than a lump: five
 *  sides, hard edges, taller than it is wide. Alpine and bare ground. */
export function spireGeo(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.52, 2.1, 5);
  g.scale(1, 1, 0.72);
  g.translate(0, 1.0, 0);
  return g;
}
export const VEG_CAP: Record<VegKind, number> = { broadleaf: 1600, conifer: 1400, palm: 600, snag: 450,
  bush: 2600, rock: 900, grass: 26000,
  // The new archetypes are BIOME-LOCAL — a cactus field and a fern floor are
  // never the same drive — so their caps are what one landscape needs, not
  // what every landscape might. An empty kind costs an instanced draw of zero.
  acacia: 700, cactus: 500, fern: 1800, log: 500, spire: 700 };

/**
 * ── HOW HIGH A TRUNK HAS TO REACH ──
 *
 * A crown is drawn at the site's trunk height `h`; the trunk is a cylinder
 * scaled to some multiple of the plant's scale. That multiple used to be a
 * flat 0.30 — which is right for a conifer (its cone starts at zero) and
 * within two thousandths for a broadleaf, and WRONG for the two archetypes
 * added later: a palm's fronds begin at 0.85 of its own height and an acacia's
 * umbrella at 1.025, so both have been floating a metre above their trunks
 * since the day they were drawn. Found in the first hour the flora lab
 * existed, which is the whole argument for the lab.
 *
 * Measured from the geometry rather than written down, because the next
 * archetype will have its own foot and nobody will remember this list.
 */
export const CROWN_FOOT: Record<string, number> = (() => {
  const foot = (g: THREE.BufferGeometry): number => {
    g.computeBoundingBox();
    const y = g.boundingBox!.min.y;
    g.dispose();
    return y;
  };
  return {
    broadleaf: foot(broadleaf()), conifer: foot(conifer()),
    palm: foot(palm()), acacia: foot(acaciaGeo()),
  };
})();

/** The trunk's height for a site, in world metres. A whisker of overlap so a
 *  flat-shaded join never shows a seam of sky between wood and leaf. */
export function trunkReach(kind: VegKind, h: number, scale: number): number {
  return h + scale * ((CROWN_FOOT[kind] ?? 0.3) + 0.08);
}

// ── grass ──────────────────────────────────────────────────────────
// Sward was the one cover class the world could not draw. WorldCover calls it
// grass, the palette painted it green, and then nothing grew there: the
// thicket rate for class 30 is four per cell, which is the odd bush in an
// otherwise bare field. This is the missing ground layer.
//
// Deliberately NOT the usual alpha-tested sprite recipe. That recipe exists to
// carve a wispy blade out of a photographic texture, and it pays for it in
// overdraw — the thing that actually hurts a phone, since a thousand mostly
// transparent quads shade the same pixels over and over. Nothing else in this
// world is textured; the trees are solid flat-shaded cones. So a tuft is three
// solid tapered blades, NINE vertices, no texture, no alpha test, no blending
// and therefore no overdraw at all. It is both cheaper than the sprite and a
// better match for the art.
export function grassGeo(): THREE.BufferGeometry {
  const v: number[] = [];
  // WHICH OF THE THREE CARDS a vertex belongs to. Grass never reads it; the
  // GPU sward's FLOWER branch does, and cannot do its job without it. A
  // flower is not a differently-coloured tuft, it is a STEM WITH A HEAD ON
  // IT — so card 0 becomes the stem and cards 1 and 2 are lifted to its top
  // and splayed into petals. Deriving that from position alone is not
  // possible: the three cards differ only by a rotation the shader cannot
  // invert, so the index travels with the vertex.
  const blade: number[] = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + 0.7;
    const dx = Math.cos(a), dz = Math.sin(a);
    // THINNER AND LONGER, reported from the seat. 0.05 wide against 0.26 tall
    // is a spike; grass is a ribbon. The width came down by nearly half and the
    // height went up by half again, which also gives the blade something to
    // bend — a stub cannot lean convincingly however good the wind term is.
    const w = 0.028, h = 0.40 + (b % 2) * 0.22, lean = 0.14;
    // A base edge across the blade, tapering to a tip that leans outward.
    v.push(dz * w, 0, -dx * w, -dz * w, 0, dx * w, dx * lean, h, dz * lean);
    blade.push(b, b, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 1));
  g.computeVertexNormals();
  return g;
}
/**
 * TONE BAKED INTO THE ARCHETYPE — the cheapest texture in the file.
 *
 * Every kind is ONE shared geometry uploaded once, so an extra colour
 * attribute costs nothing per instance and nothing per frame; three multiplies
 * it with instanceColor, so the per-clump tint still lands on top. What it
 * buys is INTERNAL structure: a boulder whose faces differ instead of reading
 * as one lump, a crown darker where the light does not reach, a trunk that
 * goes to shadow at its foot.
 *
 * Per FACE where the geometry is non-indexed (the icosahedra and the merged
 * cactus): every triangle its own tone, which is what makes stone look
 * faceted. Per VERTEX where it is indexed (the cones and cylinders), which
 * gradients across a facet instead — softer, and it keeps the vertex sharing,
 * because converting to non-indexed to win crisper facets would multiply the
 * vertex count of the single most instanced geometry in the world.
 */
export function faceTone(geo: THREE.BufferGeometry, spread = 0.2, foot = 0.22): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const y0 = bb.min.y, span = Math.max(1e-3, bb.max.y - y0);
  const indexed = !!geo.index;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const key = indexed
      ? (Math.round(pos.getX(i) * 64) * 73856093)
        ^ (Math.round(pos.getY(i) * 64) * 19349663) ^ (Math.round(pos.getZ(i) * 64) * 83492791)
      : Math.imul(Math.floor(i / 3) + 1, 2654435761);
    let x = Math.imul(key ^ (key >>> 15), 2246822507);
    x = (x ^ (x >>> 13)) >>> 0;
    const t = x / 4294967296;
    // Facet tone, then the foot in shadow: an ambient-occlusion the geometry
    // is too coarse to earn honestly and the eye reads instantly.
    const up = (pos.getY(i) - y0) / span;
    const v = (1 + (t - 0.5) * spread) * (1 - foot * (1 - up) * (1 - up));
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
// Kinds that stand on a drawn trunk. A cactus is its own column, a fern has
// none, and a fallen log is all trunk already.
export const TRUNKED: VegKind[] = ['broadleaf', 'conifer', 'palm', 'acacia'];
/** Size band per kind: [floor, span] of the uniform scale. Split out of
 *  pushSite's old two-way big/small guess, because a fern and a boulder and a
 *  standing stone are three different questions. */
export const VEG_SIZE: Record<VegKind, [number, number]> = {
  broadleaf: [1.4, 2.2], conifer: [1.4, 2.2], palm: [1.5, 1.7], snag: [1.2, 1.8],
  bush: [0.6, 0.9], rock: [0.55, 0.95], grass: [1, 0],
  acacia: [1.5, 1.9], cactus: [0.85, 1.5], fern: [0.55, 0.6], log: [0.9, 1.5], spire: [0.75, 1.3],
};

// What grows where. Weights per biome, so a palm never appears in Tromsø and
// the desert gets snags and rock instead of canopy.
export const VEG_MIX: Record<string, Array<[VegKind, number]>> = {
  arid: [['bush', 5], ['rock', 4], ['cactus', 3], ['acacia', 3], ['snag', 2], ['spire', 2], ['palm', 1]],
  tropical: [['broadleaf', 5], ['palm', 4], ['bush', 3], ['fern', 4], ['acacia', 1], ['log', 1], ['rock', 1]],
  temperate: [['broadleaf', 5], ['conifer', 3], ['bush', 4], ['fern', 2], ['rock', 1], ['snag', 1], ['log', 1]],
  boreal: [['conifer', 7], ['bush', 3], ['rock', 2], ['snag', 2], ['log', 2], ['fern', 1]],
  alpine: [['conifer', 4], ['rock', 5], ['spire', 3], ['bush', 2], ['snag', 2], ['log', 1]],
};
/**
 * WHAT THE GROUND IS MADE OF.
 *
 * Rock was one colour with a little jitter — hue 0.09, barely saturated,
 * always the same mid-brown-grey — so every boulder on Earth was the same
 * boulder. Real stone is granite grey, chalk white, sandstone red, basalt
 * nearly black, ochre, greenstone, and WHICH of those it is barely varies
 * within a place: geology is a fact about a PLACE, not about a pebble. So a
 * family is drawn once per clump and every stone in that clump shares it,
 * varying only inside the family. That coherence is what makes it read as
 * country rather than confetti.
 *
 * [hue, hueSpan, sat, satSpan, lit, litSpan]
 */
export const STONE: Array<[number, number, number, number, number, number]> = [
  [0.075, 0.02, 0.02, 0.05, 0.30, 0.15],   // granite    — grey, the world's default
  [0.11, 0.02, 0.06, 0.07, 0.55, 0.14],    // limestone  — pale, chalky, catches the sun
  [0.035, 0.025, 0.30, 0.16, 0.28, 0.13],  // sandstone  — the red country
  [0.60, 0.08, 0.03, 0.05, 0.11, 0.07],    // basalt     — near black, cold cast
  [0.09, 0.02, 0.34, 0.16, 0.40, 0.11],    // ochre      — iron-stained
  [0.29, 0.07, 0.07, 0.07, 0.24, 0.11],    // greenstone — slate and serpentine
];
/** Which stone a landscape is likely to be standing on. */
export const STONE_MIX: Record<string, number[]> = {
  arid: [2, 3, 6, 1, 5, 0],
  tropical: [2, 1, 1, 4, 2, 2],
  temperate: [4, 3, 1, 1, 1, 2],
  boreal: [5, 1, 0, 3, 1, 2],
  alpine: [6, 3, 1, 2, 0, 3],
};
/** The same table as rows in BIOME_ORDER, which is the shape `bedrockAt`
 *  wants. Derived rather than re-typed: two hand-maintained copies of one
 *  table is a divergence waiting to happen. */
export const STONE_MIX_ROWS: number[][] = BIOME_ORDER.map((n) => STONE_MIX[n] ?? []);
/** Kinds that draw as stone, and kinds that draw as dead wood — the two
 *  families whose tint comes from geology and weathering rather than from the
 *  biome's living green. */
export const STONY: VegKind[] = ['rock', 'spire'];
export const DEADWOOD: VegKind[] = ['snag', 'log'];
/** What a STAND has in common. */
export interface VegTone { h: number; s: number; l: number; stone: number }
const cl01 = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));


/**
 * ── THE NUMBERS THE LOTTERY IS ARGUED ABOUT WITH ──
 *
 * The same bargain every lab owes (see lab-dials.ts): the constants that
 * decide how varied a stand looks are named, live in one object, and can be
 * turned. `/lab/flora` puts each on a slider and COPY writes this literal back
 * out — so "the crowns are too uniform" becomes a number you can paste into
 * this file instead of an argument about a screenshot.
 *
 * Defaults ARE the shipped values. Changing one here changes the world.
 */
export interface FloraTuning {
  /** Multiplies every plant's uniform scale. */
  sizeMul: number;
  /** One crown in this many goes to autumn — the warm outlier. */
  oddAutumn: number;
  /** …and below this cumulative gate, the silver-blue one (olive, spruce). */
  oddSilver: number;
  /** How short the wind is allowed to make a tree at the treeline. */
  krummFloor: number;
  /** Chance a stone is an erratic, and how much bigger it gets. */
  erraticP: number;
  erraticMul: number;
  /** Scales every lean. 0 stands the whole landscape perfectly plumb. */
  leanMul: number;
  /** Scales how far the non-uniform stretch departs from 1. 0 makes every
   *  rock the same rock, which is the fastest way to see what it buys. */
  stretchMul: number;
  /** Scales the hue/lightness spread a stand's tone shifts by. */
  toneMul: number;
}

export const FLORA_TUNING: FloraTuning = {
  sizeMul: 1,
  oddAutumn: 0.045,
  oddSilver: 0.085,
  krummFloor: 0.18,
  erraticP: 0.04,
  erraticMul: 1.9,
  leanMul: 1,
  stretchMul: 1,
  toneMul: 1,
};

export function setFloraTuning(t: Partial<FloraTuning>): void {
  Object.assign(FLORA_TUNING, t);
}

/** Pull a stretch toward 1 by `stretchMul` — 1 keeps it, 0 removes it. */
const str = (v: number): number => 1 + (v - 1) * FLORA_TUNING.stretchMul;

/**
 * ── THE LOTTERY: EVERY PLANT DIFFERENT, EVERY STAND COHERENT ──
 *
 * One archetype geometry per kind is the whole budget — twelve meshes for a
 * continent — so all of the variety a landscape has has to come out of the
 * numbers attached to an instance: a tint, a scale, a non-uniform stretch, a
 * lean. This is that draw, and it is where the diversity lives.
 *
 * THE STAND IS THE UNIT, NOT THE PLANT. `tone` is rolled once per clump and
 * handed to every member, which is why a wood is one wood and a scree slope is
 * one mountain's rock. Break that and a hillside reads as confetti.
 *
 * The two callbacks are lazy on purpose: only the living-green branch needs
 * the biome weights and only a trunked kind needs the treeline, and this runs
 * tens of thousands of times per drive.
 */
export interface PlantEnv {
  tone: VegTone;
  /** Blended biome weights here, in BIOME_ORDER. Living green only. */
  biomeW: () => readonly number[];
  /** Krummholz factor from the treeline, 1 well below it. Trunked kinds only. */
  krummK: () => number;
}

/** Per-biome foliage bands, in BIOME_ORDER — the blend `biomeW` weights. */
export interface FoliageBand { vegHue: readonly [number, number]; vegLit: readonly [number, number] }

/**
 * THE GREEN OF EACH BIOME: [hue, hueSpan] and [lightness, lightnessSpan].
 *
 * The one piece of the biome art direction that belongs to the plants rather
 * than to the ground, so it lives here — and main spreads it back into its own
 * BIOMES table, which keeps ONE definition while letting a lab colour a stand
 * exactly the way the world does.
 */
export const FOLIAGE_BANDS: Record<string, FoliageBand> = {
  arid: { vegHue: [0.18, 0.06], vegLit: [0.18, 0.14] },
  tropical: { vegHue: [0.26, 0.08], vegLit: [0.14, 0.16] },
  temperate: { vegHue: [0.24, 0.07], vegLit: [0.16, 0.16] },
  boreal: { vegHue: [0.30, 0.06], vegLit: [0.12, 0.13] },
  alpine: { vegHue: [0.29, 0.05], vegLit: [0.13, 0.12] },
};
/** The same, as rows in BIOME_ORDER — the shape `plantLook` blends. */
export const FOLIAGE_ROWS: FoliageBand[] = BIOME_ORDER.map((n) => FOLIAGE_BANDS[n]);

const plantTint = new THREE.Color();

export function plantLook(
  x: number, z: number, kind: VegKind, r: () => number,
  env: PlantEnv, bands: readonly FoliageBand[],
): VegSite {
  const tn = env.tone;
  if (STONY.includes(kind)) {
    const [hu, hv, sa, sv, li, lv] = STONE[tn.stone];
    plantTint.setHSL(hu + r() * hv, cl01(sa + r() * sv),
      cl01(li + r() * lv + tn.l * 0.35, 0.04, 0.86));
  } else if (DEADWOOD.includes(kind)) {
    // Dead wood is not a dark leaf. It bleaches: a snag that went last winter
    // is still brown, one that has stood a decade is bone.
    plantTint.setHSL(0.075 + r() * 0.035, 0.04 + r() * 0.18, 0.17 + r() * 0.3);
  } else if (kind === 'cactus') {
    plantTint.setHSL(0.28 + r() * 0.06, 0.22 + r() * 0.2, 0.26 + r() * 0.16);
  } else {
    // LIVING GREEN, and not all of it green. The biome band gives the region
    // its character, the stand's tone shifts the whole clump together, and
    // then one plant in fourteen breaks rank — a crown gone to autumn, a
    // dead-standing individual, or the silver-blue of an olive or a spruce.
    // Those outliers are most of what makes a hillside look observed.
    const odd = r();
    if (odd < FLORA_TUNING.oddAutumn) plantTint.setHSL(0.055 + r() * 0.07, 0.4 + r() * 0.25, 0.34 + r() * 0.16);
    else if (odd < FLORA_TUNING.oddSilver) plantTint.setHSL(0.36 + r() * 0.09, 0.07 + r() * 0.13, 0.44 + r() * 0.16);
    else {
      // THE GREEN BAND IS A PLACE'S, NOT A SESSION'S. vegHue/vegLit blend
      // across the archetypes present here, so foliage shifts hue along a
      // drive the way the ground under it now does.
      const w = env.biomeW();
      let hue0 = 0, hue1 = 0, lit0 = 0, lit1 = 0;
      for (let bi = 0; bi < bands.length; bi++) {
        const wi = w[bi] ?? 0, b = bands[bi];
        hue0 += b.vegHue[0] * wi; hue1 += b.vegHue[1] * wi;
        lit0 += b.vegLit[0] * wi; lit1 += b.vegLit[1] * wi;
      }
      plantTint.setHSL(
        hue0 + r() * hue1 + tn.h,
        cl01(0.3 + r() * 0.3 + tn.s * 0.5, 0.05, 0.95),
        cl01(lit0 + r() * lit1 + tn.l * 0.5, 0.05, 0.88),
      );
    }
  }
  const [s0, span] = VEG_SIZE[kind];
  let sc = (s0 + r() * span) * FLORA_TUNING.sizeMul;
  // KRUMMHOLZ. A spruce at the treeline is the same spruce, a century of wind
  // shorter — a deformation of what is already there rather than a new
  // archetype, which is the cheapest honest way to draw the band and the same
  // move the sward's flowers make with their shared card.
  if (TRUNKED.includes(kind)) {
    const k = env.krummK();
    if (k < 1) sc *= Math.max(FLORA_TUNING.krummFloor, k);
  }
  // THE ERRATIC. One stone in twenty-five is far bigger than its neighbours —
  // a boulder the last ice age left, a tor the hill wore down to. A landscape
  // of uniformly-sized rocks reads as gravel at any scale; one outsized block
  // gives the eye something to judge the rest against, and gives the truck
  // something it genuinely must drive around.
  if (STONY.includes(kind) && r() < FLORA_TUNING.erraticP) {
    sc *= FLORA_TUNING.erraticMul * (1 + r());
  }
  const site: VegSite = {
    x, z, k: kind,
    s: sc,
    rot: r() * Math.PI * 2,
    h: TRUNKED.includes(kind) ? 1.1 + r() * 2.2 : 0,
    c: plantTint.clone(),
  };
  // The shape lottery. A slab, a dome, a standing stone and a pebble are one
  // mesh and two numbers apart; a slender fir and a spreading oak likewise.
  if (kind === 'rock') {
    site.sy = str(0.4 + r() * 1.35); site.sw = str(0.72 + r() * 0.95);
    site.tl = (r() - 0.5) * 0.5 * FLORA_TUNING.leanMul;
  } else if (kind === 'spire') {
    site.sy = str(1.0 + r() * 1.5); site.sw = str(0.7 + r() * 0.5);
    site.tl = (r() - 0.5) * 0.34 * FLORA_TUNING.leanMul;
  } else if (kind === 'log') {
    site.tl = (r() - 0.5) * 0.3 * FLORA_TUNING.leanMul;
  } else if (kind === 'bush' || kind === 'fern') {
    site.sy = str(0.7 + r() * 0.7); site.sw = str(0.8 + r() * 0.6);
  } else if (site.h > 0 || kind === 'snag') {
    // Crowns: slender or spreading, and never the same tree twice.
    site.sy = str(0.82 + r() * 0.55); site.sw = str(0.85 + r() * 0.4);
    if (kind !== 'palm') site.tl = (r() - 0.5) * 0.12 * FLORA_TUNING.leanMul;
  }
  return site;
}

/**
 * A trunked plant at a stand edge is usually younger than the canopy behind
 * it. Distribution decides that this site is fringe; flora decides how the
 * same archetype reads as a sapling, with no new geometry or instance data.
 */
export function makeSapling(site: VegSite): void {
  if (!TRUNKED.includes(site.k)) return;
  site.s *= 0.68;
  site.h *= 0.72;
  site.sy = 0.9 + ((site.sy ?? 1) - 1) * 0.65;
  site.sw = 0.88 + ((site.sw ?? 1) - 1) * 0.65;
}

/**
 * Promote an accepted living site into a rare mature survivor. The caller owns
 * rarity and habitat validity; this function only spends the attributes the
 * instance already carries on scale, crown breadth, height and wind-shaped lean.
 */
export function promoteAnchor(site: VegSite, r: () => number): void {
  const mature = 1.35 + r() * 0.2;
  site.s *= mature;
  site.sw = (site.sw ?? 1) * (1.12 + r() * 0.18);
  site.sy = (site.sy ?? 1) * (1.04 + r() * 0.12);
  if (site.h > 0) site.h *= 1.12 + r() * 0.12;
  site.tl = (site.tl ?? 0) + (r() - 0.5) * 0.14 * FLORA_TUNING.leanMul;
}

/** What a STAND has in common: one shifted green and one bedrock, so a wood is
 *  a wood and a scree slope is one mountain's worth of rock. The bedrock index
 *  is decided by the CALLER — it is a fact about a district, and only the
 *  world knows which district this is. */
export function standTone(r: () => number, stone: number): VegTone {
  const m = FLORA_TUNING.toneMul;
  return { h: (r() - 0.5) * 0.055 * m, s: (r() - 0.5) * 0.26 * m,
    l: (r() - 0.5) * 0.17 * m, stone };
}

/** VEG_MIX with everything that is not a tree removed. */
export const VEG_TREES: Record<string, Array<[VegKind, number]>> = Object.fromEntries(
  Object.entries(VEG_MIX).map(([k, row]) => [k, row.filter(([v]) =>
    v === 'broadleaf' || v === 'conifer' || v === 'palm' || v === 'acacia')]),
);

/**
 * ── WHAT THE DOMINANT SPECIES OF A STAND IS ──
 *
 * Cover class and the biome blend, and nothing else — the world's own reading
 * of altitude band, slope and habitat happens upstream and arrives as a
 * decision already made. Pure, so a lab can turn COVER CLASS and watch a
 * conifer wood become a boulder field for exactly the reason the world does.
 */
export function coverKind(cover: number | null, w: readonly number[], r: () => number): VegKind {
  const any = (): VegKind => (climPick(VEG_MIX, w as number[], r) as VegKind) ?? VEG_MIX.temperate[0][0];
  if (cover === 95) return r() < 0.75 ? 'palm' : 'broadleaf';   // mangrove
  if (cover === 10) {
    // Drop bushes and rocks: this pixel says CANOPY, so pick a tree — but from
    // the CLIMATE'S blend of every archetype's mix, so a boreal-temperate
    // margin grows both conifers and broadleaves in proportion instead of
    // flipping between two pure stands at an invisible line.
    const t = climPick(VEG_TREES, w as number[], r) as VegKind | null;
    if (t) return t;
  }
  if (cover === 20 || cover === 30 || cover === 40) return r() < 0.82 ? 'bush' : any();
  // WET GROUND GROWS THE UNDERSTOREY. Fern and bush where a swamp used to
  // deposit whatever the biome roll said, which in a boreal marsh was pines.
  if (cover === 90) return r() < 0.5 ? 'fern' : r() < 0.8 ? 'bush' : any();
  // BARE AND FROZEN GROUND IS GEOLOGY. Nothing else is standing up out there,
  // and a shard reads as country where a lone shrub reads as a mistake.
  if (cover === 60 || cover === 70) return r() < 0.62 ? 'rock' : 'spire';
  return any();
}

/**
 * …and above the treeline, altitude overrules the raster: a cover tile at 38m
 * says "forest" on a pixel whose upper half is scree, and below the treeline
 * that is a fine guess — above it, it is the difference between a mountain and
 * a hillside with a lawn on it. Null below krummholz, where cover decides.
 *
 * Taken from the AltBand ENUM rather than written as numbers. Written as
 * numbers once, off by one, and a scree slope grew bushes — the enum is five
 * bands with names and there is no version of this worth hand-indexing.
 */
export function bandKind(band: AltBand, r: () => number): VegKind | null {
  if (band >= AltBand.Scree) return r() < 0.68 ? 'rock' : 'spire';
  if (band === AltBand.Meadow) return r() < 0.5 ? 'rock' : r() < 0.8 ? 'bush' : 'spire';
  if (band === AltBand.Krummholz) return r() < 0.62 ? 'conifer' : r() < 0.85 ? 'bush' : 'rock';
  return null;
}
