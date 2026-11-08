/**
 * Brushes: the same three operations (brush.ts: a stroke along a path, a wash in a region, a group that simplifies
 * together) applied to different subjects, side by side, to test whether they're a shared medium or a bespoke one:
 *
 * - **a stone** (stone.ts's cut stone): its seam a stroke on the surface, its heart the hook, with a wash wedge beside
 *   it; its lip a stroke with the underside's wash and the crevice; its shadowed faces' washes on their terminators; its
 *   profile, strokes that show only edge-on; its foot, contact accents and a cast shadow wash.
 * - **a bamboo culm**: its silhouette, profile strokes up the facets of a cylinder; its nodes, strokes round it; its
 *   shaded body, a wash on the cylinder anchored on the terminator, withdrawing first, so the culm keeps silhouette and
 *   nodes while its body drops away.
 * - **an architectural corner**: a wall block under a projecting cornice, with a niche: the corner arris and the
 *   cornice's lip as strokes, the shade under the cornice as a wash anchored on the lip (the same relationship as the
 *   stone's ledge), the niche's edges and its shadow, the shadowed wall's wash on the corner.
 * - **a written gesture**: one curve with a hand's pressure, drawn twice by the same stroke: once in open space (round,
 *   the same from every side) and once wrapped over the corner's wall (lying flat on it).
 *
 * Nothing here makes a mark itself: each subject only supplies paths, regions and anchors, and chooses the brush.
 */
import { add, cross, deposit, dot, group, len, mul, norm, sub, wash, stroke, planeRegion, cylinderRegion, scope, toSplats, pieces, pathFrom, groupsOf, INK, type Drawing, type Element, type Group, type Gesture, type Path, type Region, type Stroke, type V, type Wash } from './brush';
import { Editor, deformItem, type EditItem } from './edit';
import { groupInfo, type GroupInfo, type Proxy } from './policy';
import { LIGHT, RECESS, SOFFIT, arrisLines, faceSampler, planeOf, stoneShape, toneOf, CROWN_A, CROWN_B, BROKEN, type Look } from './stone';

export type BrushDrawing = Drawing;
export interface BrushScene { drawing: BrushDrawing; occluder: Float32Array; elements: Element[]; centres: Record<string, V> }

const UP: V = [0, 1, 0];
const away = norm([-LIGHT[0], 0, -LIGHT[2]]);
const F = { seam: 1, ledge: 2, stoneFoot: 3, stoneFaces: 4, culm: 5, culmBody: 6, cornice: 7, niche: 8, wall: 9, gesture: 10, wrapped: 11, crown: 12 };

/**
 * A cast shadow's own shape on the ground, kept with its wash so a composed scene can merge every object's shadow into
 * one field (subjects.ts `composedScene`), the same whatever order the objects were made in.
 */
const shadowOf = new WeakMap<Element, { inside: (x: number, z: number) => boolean; inFoot: (x: number, z: number) => boolean; anchor: V[]; reach: number; depth: number }>();
/** a cast shadow on the ground from a footprint (points round it): its region, the anchor on its far side, and its
 * shape (inside the shadow; inside the footprint) */
function castShadow(foot: V[], height: number): { region: Region; anchor: V[]; inside: (x: number, z: number) => boolean; inFoot: (x: number, z: number) => boolean } {
  const shift = mul(LIGHT, -height / LIGHT[1]);
  const pts2 = foot.flatMap((p) => [[p[0], p[2]], [p[0] + shift[0], p[2] + shift[2]]] as Array<[number, number]>);
  const inside = inPoly(hull(pts2)), inFoot = inPoly(hull(foot.map((p) => [p[0], p[2]] as [number, number])));
  const c = foot.reduce((s, p) => add(s, mul(p, 1 / foot.length)), [0, 0, 0] as V);
  const region = planeRegion(UP, [c[0], 0.001, c[2]], (p) => inside(p[0], p[2]) && !inFoot(p[0], p[2]), 2.6);
  const anchor = foot.filter((p) => dot(norm(sub(p, c)), away) > 0.25).map((p) => [p[0], 0.001, p[2]] as V);
  anchor.sort((a, b) => Math.atan2(a[2] - c[2], a[0] - c[0]) - Math.atan2(b[2] - c[2], b[0] - c[0]));
  return { region, anchor, inside, inFoot };
}
/** a cast shadow's wash, its shape remembered for merging */
function shadowWash(cs: ReturnType<typeof castShadow>, key: string, o: { reach: number; material: 'wash' | 'dry'; depth: number; feature: number; uneven?: number }): Element {
  const w = wash(cs.region, cs.anchor, { key, reach: o.reach, material: o.material, depth: o.depth, feature: o.feature, direction: () => away, uneven: o.uneven });
  shadowOf.set(w, { inside: cs.inside, inFoot: cs.inFoot, anchor: cs.anchor, reach: o.reach, depth: o.depth });
  return w;
}
const inPoly = (H: Array<[number, number]>) => (x: number, z: number) => { let c = false; for (let i = 0, j = H.length - 1; i < H.length; j = i++) { const [xi, zi] = H[i], [xj, zj] = H[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
/** short dark accents where a thing meets the ground (structural: contact stays strong) */
function contact(p: V, along: V, feature: number, key: string): Element {
  const pts: V[] = [add(p, mul(along, -0.05)), add(p, mul(along, 0.05))].map((q) => [q[0], 0.0015, q[2]] as V);
  const e: Element = stroke({ pts, normals: [UP, UP] }, { width: 0.008, taper: [0.3, 0.3] }, { key, mark: 5, feature, alpha: 0.9 });
  e.structural = true;
  return e;
}
/** a profile stroke along an edge between two faces (it shows only where they turn opposite ways from the eye) */
function profile(pts: V[], n1: V, n2: V, feature: number, key: string, g: Partial<Gesture> = {}): Element {
  const nm = norm(add(n1, n2));
  return stroke({ pts: pts.map((p) => add(p, mul(nm, 0.003))), normals: pts.map(() => n1) }, { width: 0.005, taper: [0.15, 0.15], breaks: [[0.42, 0.5]], ...g }, { key, mark: 4, feature, profile: n2, alpha: 0.8 });
}
/** what an editable stroke needs: how many handles, the surface it's on, and the washes anchored to it */
export interface EditSpec { name: string; stroke: Stroke; handles: number; onto: Region; deps: Array<{ wash: Wash; anchor: (pts: V[]) => V[] }> }

// ─── the stone ───
/**
 * The stone. Structural (its minimum description, which survives and goes together): the seam's hook with its wedge
 * of tone, a short turn of the crown, its foot's contacts, and a broken outline (the arrises, their middles first).
 * Material: the ledge, the faces' tone, the rest of the seam and outline. With `alts`, an alternative for views where
 * its shadowed faces are turned away: a little tone low on each lit side face, shown only then (`alt: 'lit'`).
 */
function stoneElements(look: Look, off: V, alts = false): { els: Element[]; tris: number[]; edits: EditSpec[]; surface: Region } {
  const S = stoneShape(), at = (p: V): V => add(p, off), dry = look === 'dry';
  let rs = 5; const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
  const faceRegion = (reg: number): Region & { fsArea: number } => {
    const { n, h } = planeOf(reg), fs = faceSampler(reg, rnd), C = S.centre;
    return {
      area: fs.area, fsArea: fs.area, sample: (r) => ({ p: at(fs.at(r)), n }), on: (p) => fs.on(sub(p, off)),
      project: (p) => { const q = sub(p, off), pq = sub(q, mul(n, dot(sub(q, C), n) - h)); return fs.on(pq) ? { p: at(pq), n } : null; },
    };
  };
  const normalAt = (p: V) => S.ray(S.centre, norm(sub(p, S.centre)))?.n ?? UP;
  // (the whole surface: a point taken onto it along the ray from the stone's middle)
  const surface: Region = { area: 1, sample: () => ({ p: at(S.centre), n: UP }), on: () => true, project: (p) => { const q = S.ray(S.centre, norm(sub(sub(p, off), S.centre))); return q ? { p: at(add(q.p, mul(q.n, 0.002))), n: q.n } : null; } };
  const els: Element[] = [], edits: EditSpec[] = [];
  // (the seam: principal, its heart the hook; a wedge of wash beside it on the shadowed side)
  const seamPath: Path = { pts: S.seam.map(at), normals: S.seam.map(normalAt) };
  const seam: Element = stroke(seamPath, { width: dry ? 0.009 : 0.008, pressure: (u) => 0.65 + 0.35 * Math.sin(u * 23) ** 2 + 0.5 * Math.max(0, 0.14 - u) / 0.14, taper: [0.06, 0.18], breaks: [[0.4, 0.42], [0.66, 0.675]] }, { key: 'seam', material: dry ? 'dry' : 'ink', heart: 0, feature: F.seam });
  const hookN = Math.floor(S.seam.length * 0.45), hookOf = (pts: V[]) => pts.slice(0, Math.max(2, Math.floor(pts.length * 0.45)));
  const hookPts = S.seam.slice(0, hookN);
  const wedgeRegion: Region = {
    area: 0.04,
    sample: (r) => { const H = hookOf(seam.kind === 'stroke' ? seam.path.pts : []).map((p) => sub(p, off)), i = Math.floor(r() * H.length), p = H[i], n = normalAt(p), t = norm(sub(H[Math.min(H.length - 1, i + 2)], H[Math.max(0, i - 2)])); let d = norm(cross(n, t)); if (dot(d, LIGHT) > 0) d = mul(d, -1); const q = S.ray(S.centre, norm(sub(add(p, mul(d, r() * 0.06)), S.centre))); return { p: at(q?.p ?? p), n: q?.n ?? n }; },
    on: (p) => { const q = sub(p, off), H = hookOf(seam.kind === 'stroke' ? seam.path.pts : []).map((h) => sub(h, off)); return H.some((h) => len(sub(h, q)) < 0.08); },
    project: (p) => { const q = S.ray(S.centre, norm(sub(sub(p, off), S.centre))); return q ? { p: at(q.p), n: q.n } : null; },
  };
  const wedge: Element = wash(wedgeRegion, hookPts.map(at), { key: 'seam/wedge', reach: 0.06, material: dry ? 'dry' : 'wash', depth: 0.9, feature: F.seam, direction: (p, n) => norm(cross(n, UP)) });
  seam.structural = true; wedge.structural = true;
  els.push(...group(0.99, seam, [wedge], [], 'seam'));
  edits.push({ name: 'seam', stroke: seam as Stroke, handles: 5, onto: surface, deps: [{ wash: wedge as Wash, anchor: hookOf }] });
  // (the ledge: the lip principal; the soffit's and recess's wash under it; the crevice an accent)
  const lip: Element = stroke({ pts: S.lip.map(at), normals: S.lip.map(() => UP) }, { width: 0.008, taper: [0.15, 0.15] }, { key: 'lip', heart: 'middle', feature: F.ledge });
  const crevice = stroke({ pts: S.crevice.map(at), normals: S.crevice.map(() => norm(add(planeOf(RECESS).n, [0, -1, 0]))) }, { width: 0.008, taper: [0.2, 0.2] }, { key: 'lip/crevice', heart: 'middle', feature: F.ledge, mark: 5, alpha: 0.95 });
  const soffit: Element = wash(faceRegion(SOFFIT), S.lip.map(at), { key: 'lip/soffit', reach: 0.55, material: dry ? 'dry' : 'wash', depth: 1, feature: F.ledge, direction: () => norm(cross([0, -1, 0], planeOf(RECESS).n)) });
  soffit.facing = planeOf(SOFFIT).n; soffit.toneArea = (soffit as Wash).region.area;
  const recess: Element = wash(faceRegion(RECESS), S.crevice.map(at), { key: 'lip/recess', reach: 0.4, material: dry ? 'dry' : 'wash', depth: 0.9, feature: F.ledge, direction: () => [0, -1, 0] });
  recess.facing = planeOf(RECESS).n; recess.toneArea = (recess as Wash).region.area;
  els.push(...group(0.98, lip, [soffit, recess], [crevice], 'lip'));
  edits.push({ name: 'lip', stroke: lip as Stroke, handles: 4, onto: surface, deps: [{ wash: soffit as Wash, anchor: (pts) => pts }] });
  // (the crown: the stone's top silhouette from most views (the arrises leave it out), its middle structural)
  const top = S.crown.reduce((b, p, i) => (p[1] > S.crown[b][1] ? i : b), 0), crownPts = S.crown.slice(Math.max(0, top - 70), top + 70);
  if (crownPts.length > 2) { const cr: Element = stroke({ pts: crownPts.map(at), normals: crownPts.map(() => norm(add(planeOf(CROWN_A).n, planeOf(CROWN_B).n))) }, { width: 0.008, taper: [0.3, 0.3] }, { key: 'crown', heart: 'middle', feature: F.crown }); cr.structural = true; els.push(...group(0.92, cr, [], [], 'crown')); }
  // (the shadowed faces: each a wash anchored on its terminator, carrying the stone's tone)
  const lines = arrisLines(0.01);
  for (let reg = 0; reg < 11; reg++) {
    const n0 = planeOf(reg).n, tone = toneOf(n0, reg);
    if (tone === 0) {
      // (a lit face: its alternative, a little tone low on it, for when the shadowed faces are out of sight)
      if (!alts || Math.abs(n0[1]) > 0.75) continue;
      let low: V[] = [], ly = Infinity;
      for (const ln of lines) { if (ln.i !== reg && ln.j !== reg) continue; const my = ln.pts.reduce((s, p) => s + p[1], 0) / ln.pts.length; if (my < ly && ln.pts.length > 3) { ly = my; low = ln.pts; } }
      if (low.length < 2) continue;
      const fr = faceRegion(reg), a: Element = wash(fr, low.map(at), { key: `lit/${reg}`, reach: 0.3, material: dry ? 'dry' : 'wash', depth: 0.4, feature: F.stoneFaces, direction: () => [0, -1, 0], uneven: 0.45 });
      a.alt = 'lit'; a.facing = n0; a.toneArea = fr.fsArea;
      els.push(...group(0.7, null, [a], [], `lit/${reg}`));
      continue;
    }
    let anchor: V[] = [], best = Infinity;
    for (const ln of lines) { if (ln.i !== reg && ln.j !== reg) continue; const o = ln.i === reg ? ln.j : ln.i, on = planeOf(o).n; if (toneOf(on, o) < tone && -dot(on, LIGHT) < best) { best = -dot(on, LIGHT); anchor = ln.pts; } }
    if (anchor.length < 2) continue;
    const shelf = n0[1] > 0.55, fr = faceRegion(reg);
    const w: Element = wash(fr, anchor.map(at), { key: `face/${reg}`, reach: tone === 2 ? 0.5 : 0.32, material: dry ? 'dry' : 'wash', depth: tone === 2 ? 0.8 : 0.5, feature: F.stoneFaces, direction: (p, n) => (shelf ? norm(cross(UP, n)) : norm(sub([0, -1, 0], mul(n, -n[1])))) });
    w.facing = n0; w.toneArea = fr.fsArea * (tone === 2 ? 0.8 : 0.5);
    els.push(...group(tone === 2 ? 0.84 : 0.62, null, [w], [], `face/${reg}`));
  }
  // (the outline: the arrises, each showing only edge-on; interrupted and a little angular, their middles structural)
  // (the crown ridge and the broken face's edges carry most of its silhouette, so they're profiles too: the broken
  // face's more broken)
  for (const ln of lines) {
    const broken = ln.i === BROKEN || ln.j === BROKEN, ph = (ln.i * 7 + ln.j * 3) % 5;
    const breaks: Array<[number, number]> = broken ? [[0.1 + ph * 0.03, 0.2 + ph * 0.03], [0.45, 0.52], [0.74 + ph * 0.02, 0.82 + ph * 0.02]] : [[0.18 + ph * 0.04, 0.24 + ph * 0.04], [0.62 + ph * 0.02, 0.66 + ph * 0.02]];
    const e = profile(ln.pts.map(at), planeOf(ln.i).n, planeOf(ln.j).n, 0, `arris/${ln.i}-${ln.j}`, { breaks, pressure: (u) => 0.7 + 0.3 * Math.abs(Math.sin(u * 9 + ph)) });
    e.rank = 0.62 + 0.12 * rnd(); e.span = 0.4; e.structural = true; els.push(e);
  }
  // (the foot: contacts, and the cast shadow)
  const foot: V[] = [];
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2, h = S.ray([0, 0.004, 0], [Math.cos(a), 0, Math.sin(a)]); if (h) foot.push(at([h.p[0], 0, h.p[2]])); }
  const cs = castShadow(foot, 0.9);
  const contacts = [planeOf(RECESS).n, planeOf(6).n, planeOf(8).n].map((n, k) => { const d = norm([n[0], 0, n[2]]), h = S.ray([0, 0.004, 0], d); return h ? contact(at([h.p[0] + d[0] * 0.004, 0, h.p[2] + d[2] * 0.004]), norm(cross(UP, d)), F.stoneFoot, `foot/contact${k}`) : null; }).filter((e): e is Element => !!e);
  els.push(...group(0.96, contacts[0], [shadowWash(cs, 'foot/shadow', { reach: 0.45, material: dry ? 'dry' : 'wash', depth: 0.7, feature: F.stoneFoot })], contacts.slice(1), 'foot'));
  const tris: number[] = []; for (let i = 0; i < S.tris.length; i++) for (let a = 0; a < 3; a++) tris.push(off[a] + S.centre[a] + (S.pos[S.tris[i] * 3 + a] - S.centre[a]) * 0.99);
  return { els, tris, edits, surface };
}

// ─── the bamboo culm ───
/**
 * A culm. Structural: its silhouette (profile strokes up the facets, continuous, so whichever side is edge-on reads as
 * one long line) and two of its nodes, and its contact. Material: the other nodes, the shaded body. Its gesture: each
 * side a long loaded pull, heavy at the foot and lifting toward the top; each node compressed, a short dense ring.
 */
function culmElements(look: Look, base: V, r = 0.1, h = 1.7): { els: Element[]; tris: number[] } {
  const dry = look === 'dry', x = base[0], z = base[2], SIDES = 20, els: Element[] = [];
  const nodes = [0.3, 0.62, 0.95, 1.27, 1.56, 1.85, 2.14].map((y) => (y * h) / 1.7).filter((y) => y < h - 0.08);
  const la = Math.atan2(LIGHT[2], LIGHT[0]), term = la + Math.PI / 2, shadeFrom = term, shadeTo = term + Math.PI;
  const prof: Element[] = [];
  for (let k = 0; k < SIDES; k++) {
    const a = (k / SIDES) * Math.PI * 2, d = (Math.PI * 2) / SIDES, n1: V = [Math.cos(a - d / 2), 0, Math.sin(a - d / 2)], n2: V = [Math.cos(a + d / 2), 0, Math.sin(a + d / 2)];
    const pts: V[] = []; for (let y = 0.01; y <= h; y += 0.03) pts.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    // (a loaded pull: full at the foot, lifting toward the top, a breath at each node)
    const e = profile(pts, n1, n2, F.culm, `side/${k}`, { width: 0.0065, taper: [0.02, 0.22], pressure: (u) => 1 - 0.45 * u ** 1.4, breaks: nodes.map((ny) => [ny / h - 0.006, ny / h + 0.006] as [number, number]) });
    e.structural = true; prof.push(e);
  }
  const rings: Element[] = nodes.map((ny, i) => {
    const pts: V[] = [], ns: V[] = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push([x + Math.cos(a) * (r + 0.004), ny, z + Math.sin(a) * (r + 0.004)]); ns.push([Math.cos(a), 0, Math.sin(a)]); }
    // (compressed: short, dense, a little heavier on the shaded side)
    const e: Element = stroke({ pts, normals: ns }, { width: 0.0085, taper: [0, 0], breaks: [[0.08, 0.2], [0.52, 0.64]], pressure: (u) => 0.75 + 0.25 * Math.cos((u * Math.PI * 2) - term) }, { key: `node/${i}`, feature: F.culm, heart: 'middle' });
    if (i === 1 || i === nodes.length - 2) e.structural = true;
    return e;
  });
  els.push(...group(0.95, prof[0], prof.slice(1).map((p) => { p.rank = 0.95; return p; }), [], 'sides'));
  for (const p of prof.slice(1)) { p.rank = 0.93; p.span = 0.3; }
  els.push(...group(0.9, rings[0], [], rings.slice(1), 'nodes'));
  for (const rg of rings.slice(1)) { rg.rank = 0.88; rg.span = 0.3; }
  const ys = [0, ...nodes, h];
  for (let i = 0; i + 1 < ys.length; i++) {
    const reg = cylinderRegion(x, z, r + 0.002, ys[i] + 0.012, ys[i + 1] - 0.012, shadeFrom, shadeTo);
    const anchor: V[] = []; for (let y = ys[i] + 0.012; y <= ys[i + 1] - 0.012; y += 0.015) anchor.push([x + Math.cos(term) * (r + 0.002), y, z + Math.sin(term) * (r + 0.002)]);
    const w: Element = wash(reg, anchor, { key: `body/${i}`, reach: 0.2, material: dry ? 'dry' : 'wash', depth: 0.7, feature: F.culmBody, direction: () => UP, uneven: 0.25 });
    w.facing = [Math.cos(term + Math.PI / 2), 0, Math.sin(term + Math.PI / 2)]; w.toneArea = Math.PI * r * (ys[i + 1] - ys[i]) * 0.7;
    els.push(...group(0.6, null, [w], [], `body/${i}`));
  }
  const foot: V[] = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; foot.push([x + Math.cos(a) * r, 0, z + Math.sin(a) * r]); }
  const cs = castShadow(foot, h);
  els.push(...group(0.9, contact([x + away[0] * r, 0, z + away[2] * r], norm(cross(UP, away)), F.culm, 'contact'), [shadowWash(cs, 'shadow', { reach: 0.9, material: dry ? 'dry' : 'wash', depth: 0.45, feature: F.culmBody, uneven: 0.2 })], [], 'foot'));
  const tris: number[] = [];
  for (let k = 0; k < SIDES; k++) { const a0 = (k / SIDES) * Math.PI * 2, a1 = ((k + 1) / SIDES) * Math.PI * 2, rr = r * 0.97; const A: V = [x + Math.cos(a0) * rr, 0, z + Math.sin(a0) * rr], B: V = [x + Math.cos(a1) * rr, 0, z + Math.sin(a1) * rr]; tris.push(...A, ...B, B[0], h, B[2], ...A, B[0], h, B[2], A[0], h, A[2]); }
  return { els, tris };
}

// ─── the architectural corner ───
/**
 * The corner. Structural: its vertical arrises (one decisive edge wherever it's seen from) and the cornice's lips, and
 * its contacts. Material: the niche, the walls' tone, the cornice's shade. Its gesture: measured, even edges, with weight
 * only where a lit wall turns into a shaded one.
 */
function cornerElements(look: Look, base: V, turn: number): { els: Element[]; tris: number[]; front: { o: V; u: V; v: V; n: V } } {
  const dry = look === 'dry', els: Element[] = [], c = Math.cos(turn), s = Math.sin(turn);
  const W = (lx: number, ly: number, lz: number): V => [base[0] + lx * c - lz * s, ly, base[2] + lx * s + lz * c], R = (n: V): V => [n[0] * c - n[2] * s, n[1], n[0] * s + n[2] * c];
  const hx = 0.5, hz = 0.38, top = 1.05, ch = 0.11, ov = 0.08;
  const faces = [{ n: R([0, 0, 1]), o: W(0, 0, hz), u: R([1, 0, 0]), ext: hx }, { n: R([1, 0, 0]), o: W(hx, 0, 0), u: R([0, 0, -1]), ext: hz }, { n: R([0, 0, -1]), o: W(0, 0, -hz), u: R([-1, 0, 0]), ext: hx }, { n: R([-1, 0, 0]), o: W(-hx, 0, 0), u: R([0, 0, 1]), ext: hz }];
  const wallRegion = (f: typeof faces[number], open?: (p: V) => boolean) => planeRegion(f.n, add(f.o, [0, top / 2, 0]), (p) => { const q = sub(p, f.o); return Math.abs(dot(q, f.u)) <= f.ext && q[1] >= 0 && q[1] <= top; }, 1.2, open);
  const lit = (f: typeof faces[number]) => dot(f.n, LIGHT) > 0.2;
  const corners = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
  corners.forEach(([i, j], ci) => {
    const fi = faces[i], fj = faces[j], p0 = add(fi.o, mul(fi.u, fi.ext)), pts: V[] = []; for (let y = 0.01; y <= top; y += 0.03) pts.push([p0[0], y, p0[2]]);
    // (measured: even, without breaks; heavier where a lit wall turns into a shaded one)
    const turning = lit(fi) !== lit(fj);
    const e = profile(pts, fi.n, fj.n, F.wall, `arris/${ci}`, { width: turning ? 0.0075 : 0.0045, breaks: [], taper: [0.04, 0.04] });
    e.rank = 0.8; e.span = 0.35; e.structural = true; els.push(e);
  });
  faces.forEach((f, fi) => {
    const L = lit(f);
    const a = add(add(f.o, mul(f.u, -f.ext - ov)), mul(f.n, ov)), b = add(add(f.o, mul(f.u, f.ext + ov)), mul(f.n, ov)), lipPts: V[] = [];
    for (let t = 0; t <= 1.0001; t += 0.02) { const p = add(a, mul(sub(b, a), t)); lipPts.push([p[0], top, p[2]]); }
    const lipS: Element = stroke({ pts: lipPts, normals: lipPts.map(() => norm(add(f.n, [0, -1, 0]))) }, { width: L ? 0.006 : 0.008, taper: [0.06, 0.06] }, { key: `cornice/${fi}`, feature: F.cornice, heart: 'middle' });
    lipS.structural = true;
    const under: V[] = []; for (let t = -f.ext; t <= f.ext; t += 0.02) { const p = add(f.o, mul(f.u, t)); under.push([p[0], top - 0.004, p[2]]); }
    const uw: Element = wash(wallRegion(f), under, { key: `cornice/${fi}/under`, reach: L ? 0.1 : 0.16, material: dry ? 'dry' : 'wash', depth: L ? 0.6 : 1, feature: F.cornice, direction: () => f.u, uneven: 0.5 });
    uw.facing = f.n; uw.toneArea = f.ext * 2 * 0.13;
    els.push(...group(L ? 0.9 : 0.96, lipS, [uw], [], `cornice/${fi}`));
    const topPts: V[] = lipPts.map((p) => [p[0], top + ch, p[2]]); const e = profile(topPts, f.n, UP, F.cornice, `cornice/${fi}/top`, { breaks: [] }); e.rank = 0.7; els.push(e);
  });
  for (let i = 0; i < 4; i++) {
    const f = faces[i]; if (lit(f)) continue;
    for (const j of [(i + 1) % 4, (i + 3) % 4]) {
      const g = faces[j]; if (!lit(g)) continue;
      const edgeT = j === (i + 1) % 4 ? f.ext : -f.ext, p0 = add(f.o, mul(f.u, edgeT)), anchor: V[] = []; for (let y = 0.02; y < top - 0.02; y += 0.02) anchor.push([p0[0], y, p0[2]]);
      const w: Element = wash(wallRegion(f), anchor, { key: `wall/${i}-${j}`, reach: 0.55, material: dry ? 'dry' : 'wash', depth: 0.75, feature: F.wall, direction: () => [0, -1, 0] });
      w.facing = f.n; w.toneArea = f.ext * 2 * top * 0.75;
      els.push(...group(0.84, null, [w], [], `wall/${i}-${j}`));
    }
  }
  const fr = faces[0], nw = 0.17, n0 = 0.22, n1 = 0.72, nb = (lx: number, ly: number) => add(add(fr.o, mul(fr.u, lx)), [0, ly, 0]);
  const nicheOn = (p: V) => { const q = sub(p, fr.o), lx = dot(q, fr.u); return Math.abs(lx) <= nw && q[1] >= n0 && q[1] <= n1; };
  const edge = (a: V, b: V, w: number, key: string) => { const pts: V[] = []; for (let t = 0; t <= 1.0001; t += 0.05) pts.push(add(a, mul(sub(b, a), t))); return stroke({ pts, normals: pts.map(() => fr.n) }, { width: w, taper: [0.06, 0.06] }, { key, feature: F.niche, heart: 'middle' }); };
  const nicheTop: V[] = []; for (let t = -nw; t <= nw; t += 0.015) nicheTop.push(nb(t, n1 - 0.004));
  const nicheRegion = planeRegion(fr.n, nb(0, (n0 + n1) / 2), nicheOn, 0.5);
  const nw2: Element = wash(nicheRegion, nicheTop, { key: 'niche/shade', reach: 0.28, material: dry ? 'dry' : 'wash', depth: 1, feature: F.niche, direction: () => fr.u });
  nw2.facing = fr.n; nw2.toneArea = 2 * nw * (n1 - n0);
  els.push(...group(0.93, edge(nb(-nw, n1), nb(nw, n1), 0.009, 'niche/top'), [nw2], [edge(nb(-nw, n0), nb(-nw, n1), 0.006, 'niche/left'), edge(nb(nw, n0), nb(nw, n1), 0.004, 'niche/right'), edge(nb(-nw, n0), nb(nw, n0), 0.004, 'niche/sill')], 'niche'));
  const footPts: V[] = [W(-hx, 0, -hz), W(hx, 0, -hz), W(hx, 0, hz), W(-hx, 0, hz)];
  const foot: V[] = []; for (let k = 0; k < 4; k++) for (let t = 0; t < 1; t += 0.1) foot.push(add(footPts[k], mul(sub(footPts[(k + 1) % 4], footPts[k]), t)));
  const cs = castShadow(foot, top + ch);
  const cn = footPts.filter((p) => dot(norm(sub(p, base)), away) > -0.2).slice(0, 2).map((p, k) => contact(p, norm(cross(UP, away)), F.wall, `contact${k}`));
  els.push(...group(0.95, cn[0] ?? null, [shadowWash(cs, 'shadow', { reach: 0.7, material: dry ? 'dry' : 'wash', depth: 0.6, feature: F.wall })], cn.slice(1), 'foot'));
  const tris: number[] = [], box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const P = (lx: number, ly: number, lz: number) => W(lx, ly, lz);
    const q = (a: V, b: V, cc: V, d: V) => tris.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)); q(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0));
    q(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)); q(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0));
    q(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)); q(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
  };
  const k = 0.985; box(-hx * k, hx * k, 0, top * k, -hz * k, hz * k); box(-(hx + ov) * k, (hx + ov) * k, top + 0.002, top + ch * k, -(hz + ov) * k, (hz + ov) * k);
  return { els, tris, front: { o: fr.o, u: fr.u, v: UP, n: fr.n } };
}

// ─── the written gesture: one curve, drawn in open space and wrapped over a wall ───
function gestureCurve(): Array<[number, number, number]> {
  // (a loose written line: loops and a flourish; x across, y up, and a pressure that follows its speed)
  const out: Array<[number, number, number]> = [];
  for (let k = 0; k <= 260; k++) {
    const t = k / 260, x = t * 0.9 + 0.05 * Math.sin(t * 31), y = 0.11 * Math.sin(t * 13) * (0.6 + 0.4 * Math.sin(t * 3)) + 0.04 * Math.cos(t * 37);
    const speed = Math.hypot(0.9 + 0.05 * 31 * Math.cos(t * 31), 0.11 * 13 * Math.cos(t * 13));
    out.push([x, y, Math.min(1, 1.4 / speed + 0.25)]);
  }
  return out;
}
function gestureElements(front: { o: V; u: V; n: V }, free: V): Element[] {
  const C = gestureCurve(), pressure = (u: number) => C[Math.min(C.length - 1, Math.round(u * (C.length - 1)))][2];
  const g = { width: 0.012, pressure, taper: [0.05, 0.12] as [number, number], tremor: 0.2 };
  // (in open space: in a vertical plane facing the light's side, round in section)
  const freePts: V[] = C.map(([x, y]) => [free[0] + x - 0.45, free[1] + y, free[2]]);
  const freeS = stroke({ pts: freePts }, g, { feature: F.gesture, heart: 0.1 });
  // (wrapped: the same curve laid on the wall, lying flat on it)
  const wrapPts: V[] = C.map(([x, y]) => add(add(front.o, mul(front.u, (x - 0.45) * 0.7)), [0, 0.86 + y * 0.6, 0]));
  const wrapS = stroke({ pts: wrapPts.map((p) => add(p, mul(front.n, 0.002))), normals: wrapPts.map(() => front.n) }, { ...g, width: 0.009 }, { feature: F.wrapped, heart: 0.1 });
  return [...group(0.9, freeS), ...group(0.9, wrapS)];
}

/** the whole scene: the stone in the middle, the corner to its left, the culm to its right, the gesture in front */
export function brushScene(look: Look = 'wash'): BrushScene {
  // (each subject in its own scope, so its elements are keyed by the subject and their place in it: the same drawing
  // whatever was built before; and its features its own (the object's number in the high bits), so developing one
  // object's seam doesn't develop another's)
  const own = (obj: number, els: Element[]) => { for (const e of els) if (e.feature) e.feature = obj * 256 + e.feature; return els; };
  const stone = scope('stone', () => stoneElements(look, [0, 0, 0]));
  const corner = scope('corner', () => cornerElements(look, [-2.4, 0, 0.2], 0.45));
  const culm = scope('culm', () => culmElements(look, [2.2, 0, 0.1]));
  const gesture = scope('gesture', () => gestureElements(corner.front, [0, 1.75, 0.9]));
  const els = [...own(1, stone.els), ...own(2, corner.els), ...own(3, culm.els), ...own(4, gesture)];
  const s = toSplats(els.flatMap((e) => deposit(e)));
  return { drawing: s, occluder: new Float32Array([...stone.tris, ...corner.tris, ...culm.tris]), elements: els, centres: { stone: [0, 0.45, 0], corner: [-2.4, 0.6, 0.2], culm: [2.2, 0.85, 0.1], gesture: [-0.5, 1.4, 0.6] } };
}


/**
 * One small composed scene: the stone (the subject), an architectural corner behind it to the left, three culms (two
 * behind to the right, the far one standing in the back one's shadow; one in front, across the stone's right side), a
 * bank passing between them, all drawn with the same brushes.
 *
 * With `compose` (the default), three decisions are made separately for every element, where before one "importance"
 * scaled them all together:
 * - **structure** (what must survive to explain shape, contact and overlap): each object's minimum description, its
 *   structural members, ranked to survive the sparse state and to go together. The stone keeps its seam's hook with its
 *   wedge of tone, a short turn of its crown, its contacts and a broken outline; a culm keeps one continuous silhouette
 *   and two nodes; the corner its arrises and cornice; the ground its bank. A background object keeps its decisive
 *   edge at full strength;
 * - **emphasis** (where the strongest contrasts belong): only the contrast of material marks, lighter washes and lines
 *   on lesser objects;
 * - **material detail** (what can go freely): everything else, ranked below all structure, lesser objects' first.
 *
 * And the relationships between objects:
 * - **one ground**: every object's cast shadow merged into one wash, its region the union of their shadows less every
 *   footprint, its anchor every shadow's far side. It's the same whatever order the objects are made in;
 * - **views** (main.ts, each frame, smoothed): the stone's lit-side alternative appears as its shadowed faces turn away,
 *   and no other object's wash may carry more than a share of the tone the stone shows from here (each judged by its
 *   apparent weight: area × darkness × how far it faces the eye ÷ distance²), so the subject keeps the strongest tone
 *   from every side. Both are gates (render.ts): values set from the view, not marks rebuilt;
 * - **the halo** (render.ts): only on lines, where two contours compete.
 *
 * Editable (edit.ts): the stone's seam (its wedge follows), its lip (its soffit's shade follows), the bank (its slope
 * follows).
 *
 * Without `compose`: the same objects in the same places, each drawn as if alone (their own ranks, their own shadows, no
 * alternatives, no bank).
 */
/** a value set from the view each frame: which way its wash faces, where it is, and how much tone it carries */
export interface Gate { index: number; kind: 'lit' | 'cap'; facing: V; object: string; centre: V; weight: number }
export interface ComposedScene extends BrushScene {
  objects: Float32Array; importance: Record<string, number>; editor: Editor; gates: Gate[]; gateBase: number;
  /** the stone's tone washes (which way each faces, how much) for working out how much of its tone is in sight */
  tone: Array<{ facing: V; weight: number }>; stoneCentre: V; groups: Group[];
  /** what a drawing policy knows about each group (worked out again after an edit), and the objects' stand-ins */
  infos: () => GroupInfo[]; proxies: Proxy[];
}
export const GATE_BASE = 4096;
export const LAYOUT = ['stone', 'culm-front', 'culm-back', 'culm-far', 'corner'];
export function composedScene(look: Look = 'wash', compose = true, order: string[] = LAYOUT): ComposedScene {
  const specs: Record<string, { obj: number; w: number; make: () => { els: Element[]; tris: number[]; edits?: EditSpec[] } }> = {
    stone: { obj: 1, w: 1, make: () => stoneElements(look, [0, 0, 0], compose) },
    'culm-front': { obj: 3, w: 0.75, make: () => culmElements(look, [1.35, 0, 0.95], 0.065, 1.6) },
    'culm-back': { obj: 4, w: 0.6, make: () => culmElements(look, [1.55, 0, -0.95], 0.085, 2.3) },
    'culm-far': { obj: 5, w: 0.5, make: () => culmElements(look, [2.1, 0, -1.3], 0.075, 1.95) },
    corner: { obj: 2, w: 0.65, make: () => cornerElements(look, [-1.65, 0, -1.55], 0.45) },
  };
  const dry = look === 'dry';
  let els: Element[] = [];
  const tris: number[] = [], objs: number[] = [], importance: Record<string, number> = {}, edits: EditSpec[] = [];
  for (const name of order) {
    const L = specs[name], made = scope(name, L.make), w = compose ? L.w : 1;
    importance[name] = w;
    for (const e of made.els) {
      e.object = L.obj;
      if (e.feature) e.feature = L.obj * 256 + e.feature;
      if (compose) decide(e, name, w);
      els.push(e);
    }
    if (made.edits) edits.push(...made.edits);
    tris.push(...made.tris); for (let k = 0; k < made.tris.length / 3; k++) objs.push(L.obj);
  }
  if (compose) {
    // ─── one ground: every cast shadow merged, the same whatever the order ───
    const shadows = els.filter((e) => shadowOf.has(e)).sort((a, b) => (a.key < b.key ? -1 : 1));
    const info = shadows.map((e) => shadowOf.get(e)!), feet = info.map((i) => i.inFoot);
    els = els.filter((e) => !shadowOf.has(e));
    for (const e of shadows) if (e.group) e.group.supports = e.group.supports.filter((m) => m !== e);
    const maxReach = Math.max(...info.map((i) => i.reach)), P = pieces(info.map((i) => ({ pts: i.anchor, reach: i.reach / maxReach })));
    const region = planeRegion(UP, [0.3, 0.001, -0.7], (p) => info.some((i) => i.inside(p[0], p[2])) && !feet.some((f) => f(p[0], p[2])), 3.6);
    const g: Element = scope('ground', () => wash(region, P.anchor, { key: 'shadow', reach: maxReach, material: dry ? 'dry' : 'wash', depth: info.reduce((s, i) => s + i.depth, 0) / info.length, feature: 0, direction: () => away, uneven: 0.3 }));
    Object.assign(g, { cuts: P.cuts, reachAt: P.reachAt, object: 6 });
    group(0.85, null, [g], [], 'ground/shadow');
    decide(g, 'ground', 0.8);
    els.push(g);
    // ─── the bank: one connective gesture between the objects, its slope falling toward the stone ───
    const off = (p: V) => feet.some((f) => f(p[0], p[2]));
    const groundR = planeRegion(UP, [0, 0, 0], (p) => !off(p), 4.5);
    const ctrl: V[] = [[-2.9, 0.002, 0.55], [-1.05, 0.002, -0.45], [0.35, 0.002, -1.2], [1.85, 0.002, -1.08], [3.0, 0.002, -0.45]];
    const made = scope('ground', () => {
      const bank: Element = stroke(pathFrom(ctrl, groundR), { width: 0.007, taper: [0.08, 0.12], tremor: 0.25, pressure: (u) => 0.6 + 0.4 * Math.abs(Math.sin(u * 7.3 + 0.4)), breaks: [[0.31, 0.335], [0.71, 0.73]] }, { key: 'bank', heart: 'middle', alpha: 0.85 });
      // (the slope: the ground on the stone's side of the bank, within reach of it)
      // (against the bank's path every few points: close enough, and an edit to it deposits in milliseconds)
      let src: V[] | null = null, cp: V[] = [];
      const coarse = () => { const P = (bank as Stroke).path.pts; if (P !== src) { src = P; cp = P.filter((_, i, a) => i % 6 === 0 || i === a.length - 1); } return cp; };
      const side = (p: V) => {
        const pts = coarse(); let d = Infinity, sgn = 0;
        for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], e = sub(pts[i + 1], a), t = Math.max(0, Math.min(1, dot(sub(p, a), e) / (dot(e, e) || 1))), q = add(a, mul(e, t)), dd = len(sub(p, q)); if (dd < d) { d = dd; sgn = cross(e, sub(p, q))[1]; } }
        return { d, front: sgn < 0 };
      };
      const downhill = (p: V): V => { const pts = coarse(); let d = Infinity, t: V = [1, 0, 0]; for (let i = 0; i < pts.length - 1; i++) { const dd = len(sub(p, pts[i])); if (dd < d) { d = dd; t = norm(sub(pts[i + 1], pts[i])); } } return norm(cross(UP, t)); };
      const slopeR = planeRegion(UP, [0, 0.001, -0.6], (p) => { const s = side(p); return s.front && s.d < 0.5 && !off(p); }, 3.6);
      const slope: Element = wash(slopeR, (bank as Stroke).path.pts, { key: 'bank/slope', reach: 0.32, material: dry ? 'dry' : 'wash', depth: 0.45, direction: (p) => downhill(p), uneven: 0.45 });
      return { bank, slope };
    });
    made.bank.object = 6; made.slope.object = 6;
    made.bank.structural = true;
    group(0.88, made.bank, [made.slope], [], 'ground/bank');
    decide(made.bank, 'ground', 0.8); decide(made.slope, 'ground', 0.8);
    els.push(made.slope, made.bank);
    edits.push({ name: 'bank', stroke: made.bank as Stroke, handles: 5, onto: groundR, deps: [{ wash: made.slope as Wash, anchor: (pts) => pts }] });
  }
  // ─── gates: the stone's lit-side alternative, and the other objects' tone ───
  const gates: Gate[] = [], tone: Array<{ facing: V; weight: number }> = [];
  const centreOf = (w: Wash): V => w.anchor.reduce((s, p) => add(s, mul(p, 1 / w.anchor.length)), [0, 0, 0] as V);
  if (compose) for (const e of els) {
    const objName = order.find((n) => specs[n].obj === e.object) ?? 'ground';
    const gateFor = (kind: 'lit' | 'cap') => { e.gate = gates.length; gates.push({ index: GATE_BASE + gates.length, kind, facing: e.facing!, object: objName, centre: centreOf(e as Wash), weight: (e.toneArea ?? 0.1) * (e as Wash).depth }); e.feature = (0x80000000 | (GATE_BASE + e.gate)) >>> 0; };
    if (e.alt === 'lit' && e.facing) gateFor('lit');
    else if (e.facing && e.kind === 'wash' && objName !== 'stone') gateFor('cap');
    else if (e.facing && objName === 'stone' && !e.alt) tone.push({ facing: e.facing, weight: e.toneArea ?? 0.1 });
  }
  // ─── groups for a drawing policy: every element in one (a lone element its own), each numbered, the number on its
  // marks ───
  for (const e of els) if (!e.group) { const m = [e]; e.group = { key: e.key, rank: e.rank, principal: e, supports: [], accents: [], get minimum() { return m.filter((x) => x.structural); } }; }
  const groups = groupsOf(els), membersOf = new Map<Group, Element[]>();
  for (const e of els) { const g = e.group!; if (!membersOf.has(g)) membersOf.set(g, []); membersOf.get(g)!.push(e); }
  groups.forEach((g, i) => { for (const e of membersOf.get(g)!) e.gi = i + 1; });
  const items: EditItem[] = edits.map((e) => deformItem(e.name, e.stroke, e.handles, e.onto, e.deps));
  const editor = new Editor(els, items);
  const emphasisOf = (obj: number) => { const n = order.find((k) => specs[k].obj === obj); return n ? importance[n] : 0.8; };
  const infos = () => groups.map((g, i) => groupInfo(g, i + 1, membersOf.get(g)!, (e) => editor.deps(e.id), emphasisOf(membersOf.get(g)![0].object ?? 0)));
  // (each object's stand-in, for telling whether it hides a group: the stone a sphere, a culm a capsule, the corner a sphere)
  const proxies: Proxy[] = [{ object: 1, c: [0.1, 0.4, 0], r: 0.75 }, { object: 3, c: [1.35, 0, 0.95], r: 0.065, h: 1.6 }, { object: 4, c: [1.55, 0, -0.95], r: 0.085, h: 2.3 }, { object: 5, c: [2.1, 0, -1.3], r: 0.075, h: 1.95 }, { object: 2, c: [-1.65, 0.6, -1.55], r: 0.62 }];
  return { drawing: editor.drawing(-1), occluder: new Float32Array(tris), objects: new Float32Array(objs), elements: els, importance, editor, gates, gateBase: GATE_BASE, tone, stoneCentre: [0, 0.45, 0], groups, infos, proxies, centres: { all: [0.3, 0.75, -0.45], stone: [0, 0.45, 0], overlap: [0.9, 0.6, 0.55], corner: [-1.65, 0.6, -1.55], grove: [1.7, 1.0, -0.6] } };
}
/**
 * One element's three decisions in a composed scene (`w` its object's emphasis, 1 the subject):
 * - structural: ranked to survive the sparse state (the subject's highest); its strength kept, a lesser object's a
 *   little thinner; a culm's silhouette continuous (no fall from its heart), the stone's outline broken (middles first);
 * - an alternative: ranked to show whole when its gate opens;
 * - material: ranked below all structure, lesser objects' first; its contrast set by emphasis.
 */
function decide(e: Element, name: string, w: number) {
  const subject = name === 'stone';
  if (e.alt) { e.rank = 0.8; e.span = 0.3; return; }
  if (e.structural) {
    if (subject) { if (e.mark === 4) { e.rank = 0.92; e.span = 0.3; } else e.rank = 0.97; }
    else { e.rank = 0.9; if (e.mark === 4 || /node/.test(e.key)) e.span = 0.04; }
    // (a structural wash falls only gently from its anchor, so it survives nearly whole with its stroke)
    if (e.kind === 'wash') e.span = Math.min(e.span, 0.25);
    if (!subject && e.kind === 'stroke') e.gesture = { ...e.gesture, width: e.gesture.width * (0.85 + 0.15 * w) };
    return;
  }
  e.rank = 0.25 + 0.55 * e.rank * (0.7 + 0.3 * w);
  if (e.kind === 'wash') e.depth *= 0.5 + 0.5 * w;
  else { e.alpha *= 0.65 + 0.35 * w; e.gesture = { ...e.gesture, width: e.gesture.width * (0.8 + 0.2 * w) }; }
}

function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], hi: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
void INK;
