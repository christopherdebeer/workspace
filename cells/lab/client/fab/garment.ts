/**
 * Every garment Fab makes, from one design: which family it is, then the components it's made of (GarmentCode's
 * meta-garment: an upper, a waistband, a lower), each drafted to the figure and sewn to the next.
 *
 * - **skirt**: panels and a waistband (pattern.ts); with tiers, each a ring of straight panels gathered onto the hem of
 *   the one above;
 * - **top**: a bodice (bodice.ts): front, back, neckline, sleeves, collar;
 * - **dress**: a bodice to the waist, a skirt sewn to its hem (the skirt's darts, pleats or gathers closed into it);
 * - **trousers** (trousers.ts): four panels and an elastic waistband;
 * - **jumpsuit**: a bodice to the waist, trousers gathered onto its hem.
 *
 * Whatever's made comes out the same shape (the pieces, what's sewn, what's held on the figure and on a hanger, what
 * each piece hangs from) and gets the same checks as well as its own.
 */
import { WAIST_Y, setPose, type Pose, type V3 } from './body';
import { bodice, bodiceHemRound } from './bodice';
import { Cut, SHOULDER_TOP, TAU, clipAt, commonChecks } from './shared';
import { fractions, outline, patch, line, type At, type Check, type Mark, type Pair, type Piece } from './edges';
import { FABRICS, COLOURWAYS, PRINTS, type Fabric } from './fabric';
import { ribAt } from './cut';
import { DEFAULT_DESIGN, HIP_DEPTH, bandAt, describe as describeSkirt, draftRecipe, fromDesign, type Design, type Family, type Recipe, type Skirt } from './pattern';
import { trousers } from './trousers';
import type { Seam } from './edges';

export interface Garment {
  design: Design;
  pieces: Piece[]; pairs: Pair[]; seams: Seam[];
  holds: Array<{ at: At; p: V3 }>;
  /** held on its hanger, in the hanger's frame: clips hold a waistband at y = 0, a coat hanger a pair of shoulders */
  hanger: Array<{ at: At; p: V3 }>; hangerKind: 'clips' | 'shoulders';
  anchors: At[];
  notes: string[]; checks: Check[];
  /** how the figure stands to wear it */
  pose: Pose;
  /** its skirt, as drafted, if it has one (a skirt, a dress): its paper, what each move made */
  skirt?: Skirt;
  m: { hang: number; area: number };
}

export const FAMILIES: Array<{ f: Family; label: string }> = [
  { f: 'skirt', label: 'skirt' }, { f: 'top', label: 'top' }, { f: 'dress', label: 'dress' }, { f: 'trousers', label: 'trousers' }, { f: 'jumpsuit', label: 'jumpsuit' },
];
const ENUMS: Partial<Record<keyof Design, string[]>> = {
  family: ['skirt', 'top', 'dress', 'trousers', 'jumpsuit'], method: ['flare', 'gather', 'pleat'], neck: ['round', 'v', 'square', 'boat', 'scoop'],
  sleeve: ['plain', 'puff', 'bell'], collar: ['none', 'peterpan', 'band', 'frill'],
};
/** a design as it can be trusted: anything missing (a skirt saved before there were tops) or out of range is the
 * default's; numbers kept to what the bench's dials can turn to */
export function sanitize(x: Partial<Design> | null | undefined): Design {
  const d: Design = { ...DEFAULT_DESIGN };
  if (!x || typeof x !== 'object') return d;
  for (const k of Object.keys(DEFAULT_DESIGN) as Array<keyof Design>) {
    const v = (x as Record<string, unknown>)[k], def = DEFAULT_DESIGN[k];
    if (ENUMS[k]) { if (typeof v === 'string' && ENUMS[k]!.includes(v)) (d as unknown as Record<string, unknown>)[k] = v; }
    else if (typeof def === 'number') { if (typeof v === 'number' && Number.isFinite(v)) (d as unknown as Record<string, unknown>)[k] = v; }
    else if (k === 'fabric') { if (typeof v === 'string' && FABRICS.some((f) => f.id === v)) d.fabric = v; }
  }
  const c = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  d.collarWidth = c(d.collarWidth, 1.5, 8); d.sleeveFullness = c(d.sleeveFullness, 1.03, 1.8); d.tierRatio = c(d.tierRatio, 1.05, 2);
  d.print = Math.round(c(d.print, 0, PRINTS.length - 1)); d.colour = Math.round(c(d.colour, 0, COLOURWAYS.length - 1));
  d.tiers = Math.round(c(d.tiers, 1, 3)); d.panels = Math.round(c(d.panels, 1, 12));
  return d;
}
const poseOf = (f: Family): Pose => (f === 'skirt' || f === 'trousers' ? 'twirl' : 'dress');

/** draft a garment: first coarsely to learn how much cloth it is, then at the spacing that brings it to `budget` points.
 * `recipe`: its skirt's paper as worked (moves and all), if it has a skirt; else the skirt's written from the design */
export function draftGarment(d0: Partial<Design>, budget = 1600, recipe?: Recipe): Garment {
  const d = sanitize(d0);
  const first = build(d, 3.4, budget, recipe);
  const h = Math.max(1.9, Math.sqrt(first.m.area * 1e4 / budget));
  return build(d, h, budget, recipe);
}

function build(d: Design, h: number, budget: number, recipe?: Recipe): Garment {
  const cut = new Cut(), knit = d.fabric === 'jersey';
  let skirtOf: Skirt | undefined;
  let hangerKind: Garment['hangerKind'] = 'clips', hang = 0;
  if (d.family === 'skirt') { skirtOf = skirt(cut, d, h, budget, null, recipe); hang = recipe?.length ?? d.length; }
  else if (d.family === 'top') { bodice(cut, d, h, { toWaist: false, knit }); hangerKind = 'shoulders'; hang = SHOULDER_TOP - WAIST_Y + d.bodyLen; }
  else if (d.family === 'dress') {
    const b = bodice(cut, d, h, { toWaist: true, knit });
    skirtOf = skirt(cut, d, h, budget, { hem: b.hem, round: b.hemRound }, recipe);
    hangerKind = 'shoulders'; hang = SHOULDER_TOP - WAIST_Y + d.length;
  } else if (d.family === 'trousers') { trousers(cut, d, h, { joined: false }); hang = WAIST_Y - (41 - d.legLen); }
  else {
    const b = bodice(cut, d, h, { toWaist: true, knit });
    const t = trousers(cut, d, h, { joined: true });
    cut.sew(t.waist, b.hem, 'waist seam, gathered', { tol: Infinity });
    cut.anchors.push(...t.waist);
    cut.notes.push(`the trousers gathered into the bodice at the waist (${(t.waistRound / b.hemRound).toFixed(1)}×)`);
    hangerKind = 'shoulders'; hang = SHOULDER_TOP - (41 - d.legLen);
  }
  const checks = [...commonChecks(cut), ...cut.checks];
  return {
    design: d, pieces: cut.pieces, pairs: cut.pairs, seams: cut.seams, holds: cut.holds, hanger: cut.hanger, hangerKind, anchors: cut.anchors,
    notes: cut.notes, checks, pose: poseOf(d.family), skirt: skirtOf, m: { hang, area: cut.area() / 1e4 },
  };
}

/** a skirt into the cut: on its own waistband, or sewn round a bodice's hem; and its tiers */
function skirt(cut: Cut, d: Design, h: number, budget: number, onto: { hem: At[]; round: number } | null, recipe?: Recipe): Skirt {
  const tiers = d.tiers, total = recipe?.length ?? d.length;
  // (with tiers, the first comes past the hips and the rest share what's left)
  const first = tiers > 1 ? Math.max(HIP_DEPTH + 3, total * 0.42) : total, rest = tiers > 1 ? Math.max(6, (total - first) / (tiers - 1)) : 0;
  const sd: Design = { ...d, length: first };
  // (its budget: as dense as the rest of the garment)
  // (its paper: as worked, if it was (its first tier's length, if it's tiered), else written from the dials)
  const o = onto ? { band: onto.round } : {}, rec: Recipe = recipe ? { ...recipe, length: tiers > 1 ? first : recipe.length, ...(onto ? { band: onto.round } : {}) } : fromDesign(sd, o.band);
  const sk0 = draftRecipe(rec, budget, o);
  const sk = draftRecipe(rec, Math.max(200, (sk0.m.area * 1e4) / (h * h)), o);
  const base = cut.pieces.length, n = sk.m.panels;
  sk.pieces.forEach((p, k) => {
    // (a dress's skirt has no band of its own: it's sewn to the bodice. The band's the last piece: nothing shifts)
    if (onto && p.kind === 'band') return;
    const panel = p.kind === 'panel';
    cut.add({
      ...p, drawn: panel ? k === 0 : true, cut: panel ? n : 1, ruled: panel,
      label: panel ? (n === 1 ? 'skirt · cut 1' : n === 2 ? 'front & back · cut 2' : `panel · cut ${n}`) : 'waistband · cut 1',
      marks: panel && k === 0 ? stripMarks(sk) : undefined,
      spans: undefined,
    });
  });
  const off = (a: At): At => [a[0] + base, a[1], a[2]];
  cut.pairs.push(...sk.pairs.map((q) => ({ a: off(q.a), b: off(q.b), why: q.why })));
  if (!onto) {
    for (const hd of sk.holds) { cut.holds.push({ at: off(hd.at), p: bandAt(hd.s, hd.y, sk.band) }); cut.hanger.push({ at: off(hd.at), p: clipAt(hd.s, hd.y - WAIST_Y, sk.band) }); }
  } else {
    // (its waist, folds closed, sewn round the bodice's hem: each point at its own place round it)
    const pts = sk.holds.filter((hd) => hd.at[0] < n && hd.at[2] === 0).map((hd) => ({ at: off(hd.at), f: ((((hd.s / sk.band) % 1) + 1) % 1) }));
    pts.sort((a, b) => a.f - b.f);
    cut.sew(pts.map((p) => p.at), onto.hem, d.method === 'gather' ? 'waist seam, gathered' : 'waist seam', { map: pts.map((p) => p.f), tol: Infinity });
    cut.anchors.push(...pts.map((p) => p.at));
  }
  // (the skirt's own checks, but not the cloth's width: every piece's is checked once for the whole garment)
  for (const c of sk.checks) if (c.name !== 'fits on the cloth') cut.checks.push(onto && c.name === 'waist fits the band' ? { ...c, name: 'skirt fits the bodice' } : c);
  cut.notes.push(...sk.notes.map((x) => (onto ? x.replace('the band, gathered in', 'the bodice, gathered into it') : x)));
  if (tiers < 2) return sk;
  // ─── tiers: each a ring of straight panels, 1.5 times the round of the hem above, gathered onto it ───
  let prev: At[] = [];
  // (round the hem: every panel's whole edge in turn; where two meet they're sewn, so that step has no length)
  for (let p = 0; p < n; p++) for (let i = 0; i <= sk.pieces[p].nu; i++) prev.push([base + p, i, sk.pieces[p].nv]);
  prev.push([base, 0, sk.pieces[0].nv]);
  // (each tier's as wide as the hem above it as cut, measured round its edge)
  let prevRound = fractions(cut.pieces, prev).len, y0 = sk.pieces[0].start(0.5, 1)[1], a0 = -Math.PI / n;
  for (let t = 1; t < tiers; t++) {
    const round = prevRound * d.tierRatio, nt = Math.max(2, Math.ceil(round / 120)), w = round / nt, L = rest;
    const first = cut.pieces.length;
    for (let p = 0; p < nt; p++) {
      const yTop = y0;
      cut.add(patch({
        name: `tier ${t + 1}, ${p + 1}`, top: [line([-w / 2, 0], [w / 2, 0], 'top')], foot: [line([-w / 2, -L], [w / 2, -L], 'hem')],
        left: [line([-w / 2, 0], [-w / 2, -L], 'side a')], right: [line([w / 2, 0], [w / 2, -L], 'side b')], h, grain: (d.grain * Math.PI) / 180,
        label: p === 0 ? `tier ${t + 1} · cut ${nt}` : '', cut: nt, drawn: p === 0,
        marks: p === 0 ? [{ kind: 'gather', pts: [[-w / 2 + 1, -0.6], [w / 2 - 1, -0.6]] }] : undefined,
        start: (u, v) => { const a = a0 + (TAU * (p + u)) / nt, r = round / TAU + 0.8; return [Math.sin(a) * r, yTop - 0.6 - v * L * 0.92, Math.cos(a) * r]; },
      }));
    }
    for (let p = 0; p < nt; p++) cut.sew(cut.pts(first + p, 'side b'), cut.pts(first + ((p + 1) % nt), 'side a'), 'tier seam');
    const top: At[] = [];
    for (let p = 0; p < nt; p++) top.push(...cut.pts(first + p, 'top'));
    top.push(cut.pts(first, 'top')[0]);
    cut.sew(top, prev, 'tier, gathered', { want: d.tierRatio, tol: 0.03 });
    for (let p = 0; p < nt; p++) cut.anchors.push(...cut.pts(first + p, 'top'));
    prev = [];
    for (let p = 0; p < nt; p++) prev.push(...cut.pts(first + p, 'hem'));
    prev.push(cut.pts(first, 'hem')[0]);
    prevRound = fractions(cut.pieces, prev).len; y0 = y0 - L * 0.92;
  }
  cut.notes.push(`${tiers} tiers, each gathered ${d.tierRatio.toFixed(2)}× onto the one above`);
  return sk;
}

/** a skirt panel's marks, from the strips of its paper: darts to their points, pleats stitched a little way, slashes
 * spread open, gathers along the waist */
function stripMarks(sk: Skirt): Mark[] {
  const P = sk.cut, L = sk.m.length, R = (k: number, f: number) => ribAt(P.ribs[k], f), out: Mark[] = [];
  P.strips.forEach((st, k) => {
    if (st.kind === 'dart') out.push({ kind: 'dart', pts: [P.ribs[k].top, P.ribs[k].knee, P.ribs[k + 1].top] });
    if (st.kind === 'pleat') { const s1 = Math.min(1, (st.stitch ?? 0) / L); out.push({ kind: 'pleat', pts: [R(k, 0), R(k, s1), R(k + 1, s1), R(k + 1, 0)] }); }
    if (st.kind === 'wedge') out.push({ kind: 'wedge', pts: [...Array.from({ length: 9 }, (_, i) => R(k, i / 8)), ...Array.from({ length: 9 }, (_, i) => R(k + 1, 1 - i / 8))] });
    if (st.kind === 'ease') out.push({ kind: 'gather', pts: [[R(k, 0.02)[0], R(k, 0.02)[1] - 0.6], [R(k + 1, 0.02)[0], R(k + 1, 0.02)[1] - 0.6]] });
  });
  return out;
}

/** what the cloth needs: its pieces, what's sewn, held, and hung from (a dress's skirt's unused band left out) */
export function toBuild(g: Garment, fabric: Fabric) {
  // (a little further off the figure under a bodice: its shoulder joints are round under a coarse cloth's grid)
  return { pieces: g.pieces, pairs: g.pairs, holds: g.holds, anchors: g.anchors, fabric, margin: g.pose === 'dress' ? 0.8 : 0.5 };
}
/** a garment on its hanger: everything moved so what it hangs from is at y = 0 */
export function toHangerBuild(g: Garment, fabric: Fabric) {
  const dy = g.hangerKind === 'clips' ? WAIST_Y : SHOULDER_TOP;
  return {
    pieces: g.pieces.map((p) => ({ ...p, start: (u: number, v: number): V3 => { const q = p.start(u, v); return [q[0], q[1] - dy, q[2]]; } })),
    pairs: g.pairs, holds: g.hanger, anchors: g.anchors, fabric, collider: null, floor: false,
  };
}
/** pose the figure for it, before its cloth is made */
export function poseFor(g: Garment) { setPose(g.pose); }
/** a skirt's recipe as its garment cuts it: a dress's to its bodice's hem, a skirt's to its own band */
export const recipeFor = (d: Design, r?: Recipe): Recipe => {
  const band = d.family === 'dress' ? bodiceHemRound(d) : undefined;
  if (!r) return fromDesign(d, band);
  const { band: _, ...rest } = r; void _;
  return band ? { ...rest, band } : rest;
};

/** a garment in plain words: "a knee-length flared skirt", "a short-sleeved round-neck top" */
export function describe(d0: Partial<Design>): string {
  const d = sanitize(d0);
  const sleeves = d.sleeveLen < 2 ? 'sleeveless' : `${d.sleeve === 'puff' ? 'puff' : d.sleeve === 'bell' ? 'bell' : d.sleeveLen < 6 ? 'cap' : d.sleeveLen < 14 ? 'short' : d.sleeveLen < 24 ? 'elbow' : 'long'}-sleeved`;
  const neck = d.neck === 'v' ? 'V-neck' : `${d.neck}-neck`;
  const collar = d.collar === 'peterpan' ? ' with a Peter Pan collar' : d.collar === 'band' ? ' with a band collar' : d.collar === 'frill' ? ' with a frilled collar' : '';
  const legs = d.legLen < 8 ? (d.legWidth >= 1.6 ? 'culotte shorts' : 'shorts') : d.legLen < 22 ? (d.legWidth >= 1.6 ? 'culottes' : 'cropped trousers') : d.flare >= 1.3 ? 'flares' : d.legWidth >= 1.6 ? 'wide-leg trousers' : 'trousers';
  const skirtWord = describeSkirt(d).replace(/^a /, '').replace(/ skirt$/, '');
  const tiers = d.tiers > 1 ? `, ${d.tiers === 2 ? 'two' : 'three'}-tiered` : '';
  switch (d.family) {
    case 'top': {
      const what = d.bodyLen < 0 ? 'crop top' : d.bodyLen > 18 ? 'tunic' : d.swing >= 1.4 ? 'swing top' : d.collar !== 'none' ? 'blouse' : d.fabric === 'jersey' ? 'T-shirt' : 'top';
      return `a ${sleeves} ${neck} ${what}${collar}`;
    }
    case 'dress': return `a ${sleeves} ${neck} ${skirtWord}${tiers} dress${collar}`;
    case 'trousers': return `${legs}`.replace(/^(?=[a-z])/, '');
    case 'jumpsuit': return d.legLen < 8 ? `a ${sleeves} playsuit${collar}` : `a ${sleeves} ${neck} jumpsuit${collar}`;
    default: return `${describeSkirt(d).replace(/ skirt$/, '')}${tiers} skirt`;
  }
}
export { outline };
