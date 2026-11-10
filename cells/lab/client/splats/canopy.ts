/**
 * A willow's canopy as marks at two levels, one handing over to the other as it's approached.
 *
 * From far off a teacher draws a canopy as a wash: a pale patch with a soft edge (the sparse conservatory studies).
 * Close to, it's fronds: thin strands hanging, each with a spray of leaf dabs (the dense ones). Here both are
 * organisations of splats in the same volume:
 * - **the wash**: a few large, pale deposits filling the volume (marks.ts `blobMark`);
 * - **the fronds**: a strand and a spray of dabs for each (strokes in open space).
 * Each deposit is shown by how large things look where it is (marks.ts `lod`; render.ts): the wash fades between two
 * thresholds as the fronds come in between the same two, so at any depth the two are complementary. Their tone is
 * matched by fitting the wash to the fronds seen from far off (devtools/splats-walk.mjs), so the patch's darkness
 * carries through the hand-over.
 */
import { strokeMark, blobMark, SP, KN, type Mark, type V } from './marks';

export interface Patch { c: V; r: V; fronds: number; seed: number; reach?: number }
/** the hand-over: from where a scene unit looks 2^-2.7 of the screen's height (about 7 m off at 50°) to 2^-1.7 (3.5 m) */
export const HANDOVER: [number, number] = [-2.7, -1.7];
export const OLIVE: [number, number, number] = [87, 73, 35];
export type Level = 'both' | 'fronds' | 'wash';
/**
 * A frond's leaves, formed: each a few deposits along its own axis (marks.ts `leaf`). `len`, `width` (m); `taper`: how
 * far it narrows to its tip; `angle`: how far off the strand it comes (radians); `per`: leaves to a metre of strand;
 * `bunch`, `cluster`: how many to a bunch and how drawn together; `from`: how far down the strand they start;
 * `ink`, and `fade`: how much paler its tip. Read off the teacher's own leaves, leaf by leaf, where it drew fronds
 * (devtools/splats-leaves.py): not where its leaves are, which it made up.
 */
export interface LeafStyle { n: number; len: number; width: number; taper: number; angle: number; per: number; bunch: number; cluster: number; from: number; ink: number; fade: number; strand?: number }

/** a patch's marks: the wash first, then a strand and a spray for each frond */
export function canopyPatch(idBase: number, P: Patch, level: Level = 'both', lod: [number, number] = HANDOVER, washParams?: number[], key = 'canopy', leaf?: LeafStyle): Mark[] {
  let r = (P.seed * 2654435761) >>> 0 || 5; const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out: Mark[] = [];
  if (level !== 'fronds') {
    const w = blobMark(idBase, P.c, P.r, Math.max(12, Math.round(P.fronds / 3)), `${key}/wash`);
    // (its tones: fitted to its fronds seen from far off if they're given; else pale, paler at its edge)
    w.params = washParams?.length === 10 ? washParams.slice() : [-3.4, -2.9, -3.4, -2.6, -2.3, -2.9, -3.4, -3.0, -3.6, 0];
    if (level === 'both') w.lod = [lod[1], lod[0]];
    out.push(w);
  }
  if (level === 'wash') return out;
  for (let i = 0; i < P.fronds; i++) {
    // (where it hangs from: under a dome; how far it falls; a little lean and bow)
    const a = rnd() * Math.PI * 2, q = Math.sqrt(rnd()), x = P.c[0] + Math.cos(a) * q * P.r[0] * 0.92, z = P.c[2] + Math.sin(a) * q * P.r[2] * 0.92;
    const top = P.c[1] + P.r[1] * (0.95 - 0.55 * q * q), fall = P.r[1] * (0.9 + 0.8 * rnd()) * (P.reach ?? 1), lean = (rnd() - 0.5) * 0.25, la = rnd() * Math.PI * 2, bow = (rnd() - 0.5) * 0.12;
    const at = (u: number): V => [x + Math.cos(la) * (lean * u + bow * Math.sin(Math.PI * u)) * fall, top - fall * u, z + Math.sin(la) * (lean * u + bow * Math.sin(Math.PI * u)) * fall];
    const ctrl = [at(0), at(0.35), at(0.7), at(1)];
    const strand = strokeMark(idBase + 1 + i * 2, ctrl, undefined, 0.005, 12, 1, `${key}/strand ${i}`);
    for (let k = 0; k < KN.ink; k++) strand.params[SP.ink + k] = 0.2 - 0.25 * k;
    strand.sway = 0.05 + 0.05 * rnd();
    const dn = 8 + Math.floor(rnd() * 5);
    // (its leaves: formed, in a style read off the teacher's; or, without one, a dab a leaf)
    const dabs = strokeMark(idBase + 2 + i * 2, ctrl, undefined, leaf ? leaf.width : 0.02, leaf ? leaf.n * Math.max(2, Math.round(leaf.per * fall * (1 - leaf.from) * (0.8 + 0.4 * (dn - 8) / 4))) : dn, 1, `${key}/dabs ${i}`);
    if (leaf) {
      dabs.leaf = { n: leaf.n, len: leaf.len, taper: leaf.taper, fade: leaf.fade, bunch: leaf.bunch, cluster: leaf.cluster };
      for (let k = 0; k < KN.ink; k++) dabs.params[SP.ink + k] = leaf.ink; dabs.params[SP.splay] = leaf.angle; dabs.params[SP.u0] = leaf.from; dabs.params[SP.u1] = 1;
      if (leaf.strand !== undefined) for (let k = 0; k < KN.ink; k++) strand.params[SP.ink + k] = leaf.strand - 0.15 * k;
    } else {
      for (let k = 0; k < KN.ink; k++) dabs.params[SP.ink + k] = -0.3 + 0.3 * k;
      dabs.params[SP.along] = -0.35; dabs.params[SP.splay] = 0.45; dabs.params[SP.step] = 0.9; dabs.params[SP.u0] = 0.12;
    }
    // (formed leaves are ink, as the teacher's are; a dab a leaf was olive, from the first studies)
    if (!leaf) dabs.colour = OLIVE; dabs.sway = strand.sway;
    if (level === 'both') { strand.lod = [lod[0], lod[1]]; dabs.lod = [lod[0], lod[1]]; }
    out.push(strand, dabs);
  }
  return out;
}
/** the one patch walked into (`?scene=walk`): where it is, and the straight approach to it */
export const WALK = { patch: { c: [0, 2.3, 0] as V, r: [1.7, 1.0, 1.7] as V, fronds: 90, seed: 11 } as Patch, eyeY: 1.5, from: 12, to: 0.3, look: [0, 0.05, -0.99875] as V, fov: (50 * Math.PI) / 180 };
