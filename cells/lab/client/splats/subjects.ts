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
import { add, cross, deposit, dot, group, len, mul, norm, sub, wash, stroke, planeRegion, cylinderRegion, scope, toSplats, INK, type Drawing, type Element, type Path, type Region, type V } from './brush';
import { LIGHT, RECESS, SOFFIT, arrisLines, faceSampler, planeOf, stoneShape, toneOf, CROWN_A, CROWN_B, BROKEN, type Look } from './stone';

export type BrushDrawing = Drawing;
export interface BrushScene { drawing: BrushDrawing; occluder: Float32Array; elements: Element[]; centres: Record<string, V> }

const UP: V = [0, 1, 0];
const away = norm([-LIGHT[0], 0, -LIGHT[2]]);
const F = { seam: 1, ledge: 2, stoneFoot: 3, stoneFaces: 4, culm: 5, culmBody: 6, cornice: 7, niche: 8, wall: 9, gesture: 10, wrapped: 11, crown: 12 };

/**
 * The ground shared by a composed scene's objects: each object's footprint, and each cast shadow in the order made.
 * When it's set, a cast shadow is kept off every other object's footprint (no shadow drawn under a thing) and off the
 * shadows made before it (where two fall together the ground is one shadow, not two layered).
 */
interface Ground { solids: Array<(x: number, z: number) => boolean>; shadows: Array<(x: number, z: number) => boolean> }
let ground: Ground | null = null;
/** a cast shadow on the ground from a footprint (points round it), as a region and the anchor on its far side */
function castShadow(foot: V[], height: number): { region: Region; anchor: V[] } {
  const shift = mul(LIGHT, -height / LIGHT[1]);
  const pts2 = foot.flatMap((p) => [[p[0], p[2]], [p[0] + shift[0], p[2] + shift[2]]] as Array<[number, number]>);
  const H = hull(pts2), inside = (x: number, z: number) => { let c = false; for (let i = 0, j = H.length - 1; i < H.length; j = i++) { const [xi, zi] = H[i], [xj, zj] = H[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const F2 = hull(foot.map((p) => [p[0], p[2]] as [number, number])), inFoot = (x: number, z: number) => { let c = false; for (let i = 0, j = F2.length - 1; i < F2.length; j = i++) { const [xi, zi] = F2[i], [xj, zj] = F2[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const c = foot.reduce((s, p) => add(s, mul(p, 1 / foot.length)), [0, 0, 0] as V);
  const g = ground, before = g ? g.shadows.slice() : [];
  const mine = (x: number, z: number) => inside(x, z) && !inFoot(x, z);
  if (g) { g.solids.push(inFoot); g.shadows.push(mine); }
  const region = planeRegion(UP, [c[0], 0.001, c[2]], (p) => mine(p[0], p[2]) && (!g || (!g.solids.some((f) => f !== inFoot && f(p[0], p[2])) && !before.some((f) => f(p[0], p[2])))), 2.6);
  const anchor = foot.filter((p) => dot(norm(sub(p, c)), away) > 0.25).map((p) => [p[0], 0.001, p[2]] as V);
  anchor.sort((a, b) => Math.atan2(a[2] - c[2], a[0] - c[0]) - Math.atan2(b[2] - c[2], b[0] - c[0]));
  return { region, anchor };
}
/** short dark accents where a thing meets the ground */
function contact(p: V, along: V, feature: number): Element {
  const pts: V[] = [add(p, mul(along, -0.05)), add(p, mul(along, 0.05))].map((q) => [q[0], 0.0015, q[2]] as V);
  return stroke({ pts, normals: [UP, UP] }, { width: 0.008, taper: [0.3, 0.3] }, { mark: 5, feature, alpha: 0.9 });
}
/** a profile stroke along an edge between two faces (it shows only where they turn opposite ways from the eye) */
function profile(pts: V[], n1: V, n2: V, feature: number): Element {
  const nm = norm(add(n1, n2));
  return stroke({ pts: pts.map((p) => add(p, mul(nm, 0.003))), normals: pts.map(() => n1) }, { width: 0.005, taper: [0.15, 0.15], breaks: [[0.42, 0.5]] }, { mark: 4, feature, profile: n2, alpha: 0.8 });
}

// ─── the stone ───
function stoneElements(look: Look, off: V): { els: Element[]; tris: number[] } {
  const S = stoneShape(), at = (p: V): V => add(p, off), dry = look === 'dry';
  let rs = 5; const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
  const faceRegion = (reg: number): Region => {
    const { n, h } = planeOf(reg), fs = faceSampler(reg, rnd), C = S.centre;
    return {
      area: fs.area, sample: (r) => ({ p: at(fs.at(r)), n }), on: (p) => fs.on(sub(p, off)),
      project: (p) => { const q = sub(p, off), pq = sub(q, mul(n, dot(sub(q, C), n) - h)); return fs.on(pq) ? { p: at(pq), n } : null; },
    };
  };
  const normalAt = (p: V) => S.ray(S.centre, norm(sub(p, S.centre)))?.n ?? UP;
  const els: Element[] = [];
  // (the seam: principal, its heart the hook; a wedge of wash beside it on the shadowed side; its branch an accent)
  const seamPath: Path = { pts: S.seam.map(at), normals: S.seam.map(normalAt) };
  const seam = stroke(seamPath, { width: dry ? 0.009 : 0.008, pressure: (u) => 0.65 + 0.35 * Math.sin(u * 23) ** 2 + 0.5 * Math.max(0, 0.14 - u) / 0.14, taper: [0.06, 0.18], breaks: [[0.4, 0.42], [0.66, 0.675]] }, { material: dry ? 'dry' : 'ink', heart: 0, feature: F.seam });
  const hookPts = S.seam.slice(0, Math.floor(S.seam.length * 0.45));
  const wedgeRegion: Region = {
    area: 0.04,
    sample: (r) => { const i = Math.floor(r() * hookPts.length), p = hookPts[i], n = normalAt(p), t = norm(sub(hookPts[Math.min(hookPts.length - 1, i + 2)], hookPts[Math.max(0, i - 2)])); let d = norm(cross(n, t)); if (dot(d, LIGHT) > 0) d = mul(d, -1); const q = S.ray(S.centre, norm(sub(add(p, mul(d, r() * 0.06)), S.centre))); return { p: at(q?.p ?? p), n: q?.n ?? n }; },
    on: (p) => { const q = sub(p, off); return hookPts.some((h) => len(sub(h, q)) < 0.08); },
    project: (p) => { const q = S.ray(S.centre, norm(sub(sub(p, off), S.centre))); return q ? { p: at(q.p), n: q.n } : null; },
  };
  els.push(...group(0.99, seam, [wash(wedgeRegion, hookPts.map(at), { reach: 0.06, material: dry ? 'dry' : 'wash', depth: 0.9, feature: F.seam, direction: (p, n) => norm(cross(n, UP)) })]));
  // (the ledge: the lip principal; the soffit's and recess's wash under it; the crevice an accent)
  const lip = stroke({ pts: S.lip.map(at), normals: S.lip.map(() => UP) }, { width: 0.008, taper: [0.15, 0.15] }, { heart: 'middle', feature: F.ledge });
  const crevice = stroke({ pts: S.crevice.map(at), normals: S.crevice.map(() => norm(add(planeOf(RECESS).n, [0, -1, 0]))) }, { width: 0.008, taper: [0.2, 0.2] }, { heart: 'middle', feature: F.ledge, mark: 5, alpha: 0.95 });
  els.push(...group(0.98, lip, [wash(faceRegion(SOFFIT), S.lip.map(at), { reach: 0.55, material: dry ? 'dry' : 'wash', depth: 1, feature: F.ledge, direction: () => norm(cross([0, -1, 0], planeOf(RECESS).n)) }), wash(faceRegion(RECESS), S.crevice.map(at), { reach: 0.4, material: dry ? 'dry' : 'wash', depth: 0.9, feature: F.ledge, direction: () => [0, -1, 0] })], [crevice]));
  // (the crown: one turn of it)
  const top = S.crown.reduce((b, p, i) => (p[1] > S.crown[b][1] ? i : b), 0), crownPts = S.crown.slice(Math.max(0, top - 24), top + 24);
  if (crownPts.length > 2) els.push(...group(0.92, stroke({ pts: crownPts.map(at), normals: crownPts.map(() => norm(add(planeOf(CROWN_A).n, planeOf(CROWN_B).n))) }, { width: 0.008, taper: [0.3, 0.3] }, { heart: 'middle', feature: F.crown })));
  // (the shadowed faces: each a wash anchored on its terminator)
  const lines = arrisLines(0.01);
  for (let reg = 0; reg < 11; reg++) {
    const n0 = planeOf(reg).n, tone = toneOf(n0, reg); if (tone === 0) continue;
    let anchor: V[] = [], best = Infinity;
    for (const ln of lines) { if (ln.i !== reg && ln.j !== reg) continue; const o = ln.i === reg ? ln.j : ln.i, on = planeOf(o).n; if (toneOf(on, o) < tone && -dot(on, LIGHT) < best) { best = -dot(on, LIGHT); anchor = ln.pts; } }
    if (anchor.length < 2) continue;
    const shelf = n0[1] > 0.55;
    els.push(...group(tone === 2 ? 0.84 : 0.62, null, [wash(faceRegion(reg), anchor.map(at), { reach: tone === 2 ? 0.5 : 0.32, material: dry ? 'dry' : 'wash', depth: tone === 2 ? 0.8 : 0.5, feature: F.stoneFaces, direction: (p, n) => (shelf ? norm(cross(UP, n)) : norm(sub([0, -1, 0], mul(n, -n[1])))) })]));
  }
  // (the profile: the arrises, each showing only edge-on)
  for (const ln of lines) { if ((ln.i === CROWN_A && ln.j === CROWN_B) || ln.i === BROKEN || ln.j === BROKEN) continue; const e = profile(ln.pts.map(at), planeOf(ln.i).n, planeOf(ln.j).n, 0); e.rank = 0.62 + 0.12 * rnd(); e.span = 0.4; els.push(e); }
  // (the foot: contacts, and the cast shadow)
  const foot: V[] = [];
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2, h = S.ray([0, 0.004, 0], [Math.cos(a), 0, Math.sin(a)]); if (h) foot.push(at([h.p[0], 0, h.p[2]])); }
  const cs = castShadow(foot, 0.9);
  const contacts = [planeOf(RECESS).n, planeOf(6).n, planeOf(8).n].map((n) => { const d = norm([n[0], 0, n[2]]), h = S.ray([0, 0.004, 0], d); return h ? contact(at([h.p[0] + d[0] * 0.004, 0, h.p[2] + d[2] * 0.004]), norm(cross(UP, d)), F.stoneFoot) : null; }).filter((e): e is Element => !!e);
  els.push(...group(0.96, contacts[0], [wash(cs.region, cs.anchor, { reach: 0.45, material: dry ? 'dry' : 'wash', depth: 0.7, feature: F.stoneFoot, direction: () => away })], contacts.slice(1)));
  // (its mesh, for the occluder, shrunk a little toward its middle)
  const tris: number[] = []; for (let i = 0; i < S.tris.length; i++) for (let a = 0; a < 3; a++) tris.push(off[a] + S.centre[a] + (S.pos[S.tris[i] * 3 + a] - S.centre[a]) * 0.99);
  return { els, tris };
}

// ─── the bamboo culm ───
function culmElements(look: Look, base: V, r = 0.1, h = 1.7): { els: Element[]; tris: number[] } {
  const dry = look === 'dry', x = base[0], z = base[2], SIDES = 20, els: Element[] = [];
  // (its nodes, spaced to its height)
  const nodes = [0.3, 0.62, 0.95, 1.27, 1.56, 1.85, 2.14].map((y) => (y * h) / 1.7).filter((y) => y < h - 0.08);
  // (the terminator: the angle round it where it turns from the light; its shadowed side from there)
  const la = Math.atan2(LIGHT[2], LIGHT[0]), term = la + Math.PI / 2, shadeFrom = term, shadeTo = term + Math.PI;
  // (silhouette: profile strokes up the edges between facets; principal of the culm with the nodes)
  const prof: Element[] = [];
  for (let k = 0; k < SIDES; k++) {
    const a = (k / SIDES) * Math.PI * 2, d = (Math.PI * 2) / SIDES, n1: V = [Math.cos(a - d / 2), 0, Math.sin(a - d / 2)], n2: V = [Math.cos(a + d / 2), 0, Math.sin(a + d / 2)];
    const pts: V[] = []; for (let y = 0.01; y <= h; y += 0.03) pts.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
    const e = profile(pts, n1, n2, F.culm) as ReturnType<typeof stroke>; e.gesture.breaks = nodes.map((ny) => [ny / h - 0.008, ny / h + 0.008]); e.gesture.width = 0.006;
    prof.push(e);
  }
  // (nodes: strokes round it, each a little ridge; heart toward the light's side of the front)
  const rings: Element[] = nodes.map((ny) => {
    const pts: V[] = [], ns: V[] = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push([x + Math.cos(a) * (r + 0.004), ny, z + Math.sin(a) * (r + 0.004)]); ns.push([Math.cos(a), 0, Math.sin(a)]); }
    return stroke({ pts, normals: ns }, { width: 0.007, taper: [0, 0], breaks: [[0.1, 0.16], [0.55, 0.6]] }, { feature: F.culm, heart: 'middle' });
  });
  els.push(...group(0.95, prof[0], prof.slice(1).map((p) => { p.rank = 0.95; return p; }), []));
  for (const p of prof.slice(1)) { p.rank = 0.93; p.span = 0.3; }
  els.push(...group(0.9, rings[0], [], rings.slice(1)));
  for (const rg of rings.slice(1)) { rg.rank = 0.88; rg.span = 0.3; }
  // (the shaded body: a wash on each internode, anchored on the terminator, the first to go)
  const ys = [0, ...nodes, h];
  for (let i = 0; i + 1 < ys.length; i++) {
    const reg = cylinderRegion(x, z, r + 0.002, ys[i] + 0.012, ys[i + 1] - 0.012, shadeFrom, shadeTo);
    const anchor: V[] = []; for (let y = ys[i] + 0.012; y <= ys[i + 1] - 0.012; y += 0.015) anchor.push([x + Math.cos(term) * (r + 0.002), y, z + Math.sin(term) * (r + 0.002)]);
    els.push(...group(0.6, null, [wash(reg, anchor, { reach: 0.2, material: dry ? 'dry' : 'wash', depth: 0.7, feature: F.culmBody, direction: () => UP, uneven: 0.25 })]));
  }
  // (its foot: a contact, and its cast shadow)
  const foot: V[] = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; foot.push([x + Math.cos(a) * r, 0, z + Math.sin(a) * r]); }
  const cs = castShadow(foot, h);
  els.push(...group(0.9, contact([x + away[0] * r, 0, z + away[2] * r], norm(cross(UP, away)), F.culm), [wash(cs.region, cs.anchor, { reach: 0.9, material: dry ? 'dry' : 'wash', depth: 0.45, feature: F.culmBody, direction: () => away, uneven: 0.2 })]));
  // (its cylinder for the occluder)
  const tris: number[] = [];
  for (let k = 0; k < SIDES; k++) { const a0 = (k / SIDES) * Math.PI * 2, a1 = ((k + 1) / SIDES) * Math.PI * 2, rr = r * 0.97; const A: V = [x + Math.cos(a0) * rr, 0, z + Math.sin(a0) * rr], B: V = [x + Math.cos(a1) * rr, 0, z + Math.sin(a1) * rr]; tris.push(...A, ...B, B[0], h, B[2], ...A, B[0], h, B[2], A[0], h, A[2]); }
  return { els, tris };
}

// ─── the architectural corner ───
function cornerElements(look: Look, base: V, turn: number): { els: Element[]; tris: number[]; front: { o: V; u: V; v: V; n: V } } {
  const dry = look === 'dry', els: Element[] = [], c = Math.cos(turn), s = Math.sin(turn);
  const W = (lx: number, ly: number, lz: number): V => [base[0] + lx * c - lz * s, ly, base[2] + lx * s + lz * c], R = (n: V): V => [n[0] * c - n[2] * s, n[1], n[0] * s + n[2] * c];
  const hx = 0.5, hz = 0.38, top = 1.05, ch = 0.11, ov = 0.08;
  const faces = [{ n: R([0, 0, 1]), o: W(0, 0, hz), u: R([1, 0, 0]), ext: hx }, { n: R([1, 0, 0]), o: W(hx, 0, 0), u: R([0, 0, -1]), ext: hz }, { n: R([0, 0, -1]), o: W(0, 0, -hz), u: R([-1, 0, 0]), ext: hx }, { n: R([-1, 0, 0]), o: W(-hx, 0, 0), u: R([0, 0, 1]), ext: hz }];
  const wallRegion = (f: typeof faces[number], open?: (p: V) => boolean) => planeRegion(f.n, add(f.o, [0, top / 2, 0]), (p) => { const q = sub(p, f.o); return Math.abs(dot(q, f.u)) <= f.ext && q[1] >= 0 && q[1] <= top; }, 1.2, open);
  // (the vertical arrises: profile strokes; the one nearest the light's terminator also a fixed principal accent)
  const corners = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
  for (const [i, j] of corners) {
    const fi = faces[i], fj = faces[j], p0 = add(fi.o, mul(fi.u, fi.ext)), pts: V[] = []; for (let y = 0.01; y <= top; y += 0.03) pts.push([p0[0], y, p0[2]]);
    const e = profile(pts, fi.n, fj.n, F.wall); e.rank = 0.8; e.span = 0.35; els.push(e);
  }
  // (the cornice: its lip a principal stroke on each side; under it a wash on the wall, firm at the lip; the
  // cornice's own profile)
  for (const f of faces) {
    const lit = dot(f.n, LIGHT) > 0.2;
    const a = add(add(f.o, mul(f.u, -f.ext - ov)), mul(f.n, ov)), b = add(add(f.o, mul(f.u, f.ext + ov)), mul(f.n, ov)), lipPts: V[] = [];
    for (let t = 0; t <= 1.0001; t += 0.02) { const p = add(a, mul(sub(b, a), t)); lipPts.push([p[0], top, p[2]]); }
    const lipS = stroke({ pts: lipPts, normals: lipPts.map(() => norm(add(f.n, [0, -1, 0]))) }, { width: 0.008, taper: [0.1, 0.1] }, { feature: F.cornice, heart: 'middle' });
    const under: V[] = []; for (let t = -f.ext; t <= f.ext; t += 0.02) { const p = add(f.o, mul(f.u, t)); under.push([p[0], top - 0.004, p[2]]); }
    els.push(...group(lit ? 0.9 : 0.96, lipS, [wash(wallRegion(f), under, { reach: lit ? 0.1 : 0.16, material: dry ? 'dry' : 'wash', depth: lit ? 0.6 : 1, feature: F.cornice, direction: () => f.u, uneven: 0.5 })]));
    const topPts: V[] = lipPts.map((p) => [p[0], top + ch, p[2]]); const e = profile(topPts, f.n, UP, F.cornice); e.rank = 0.7; els.push(e);
  }
  // (the shadowed walls: a wash anchored on the corner they share with a lit wall)
  for (let i = 0; i < 4; i++) {
    const f = faces[i]; if (dot(f.n, LIGHT) > 0.2) continue;
    for (const j of [(i + 1) % 4, (i + 3) % 4]) {
      const g = faces[j]; if (dot(g.n, LIGHT) <= 0.2) continue;
      const edgeT = j === (i + 1) % 4 ? f.ext : -f.ext, p0 = add(f.o, mul(f.u, edgeT)), anchor: V[] = []; for (let y = 0.02; y < top - 0.02; y += 0.02) anchor.push([p0[0], y, p0[2]]);
      els.push(...group(0.84, null, [wash(wallRegion(f), anchor, { reach: 0.55, material: dry ? 'dry' : 'wash', depth: 0.75, feature: F.wall, direction: () => [0, -1, 0] })]));
    }
  }
  // (a niche in the front wall: its edges strokes, heavier along the top and the shadowed side; its shadow a wash
  // anchored along its top)
  const fr = faces[0], nw = 0.17, n0 = 0.22, n1 = 0.72, nb = (lx: number, ly: number) => add(add(fr.o, mul(fr.u, lx)), [0, ly, 0]);
  const nicheOn = (p: V) => { const q = sub(p, fr.o), lx = dot(q, fr.u); return Math.abs(lx) <= nw && q[1] >= n0 && q[1] <= n1; };
  const edge = (a: V, b: V, w: number) => { const pts: V[] = []; for (let t = 0; t <= 1.0001; t += 0.05) pts.push(add(a, mul(sub(b, a), t))); return stroke({ pts, normals: pts.map(() => fr.n) }, { width: w, taper: [0.1, 0.1] }, { feature: F.niche, heart: 'middle' }); };
  const nicheTop: V[] = []; for (let t = -nw; t <= nw; t += 0.015) nicheTop.push(nb(t, n1 - 0.004));
  const nicheRegion = planeRegion(fr.n, nb(0, (n0 + n1) / 2), nicheOn, 0.5);
  els.push(...group(0.93, edge(nb(-nw, n1), nb(nw, n1), 0.009), [wash(nicheRegion, nicheTop, { reach: 0.28, material: dry ? 'dry' : 'wash', depth: 1, feature: F.niche, direction: () => fr.u })], [edge(nb(-nw, n0), nb(-nw, n1), 0.006), edge(nb(nw, n0), nb(nw, n1), 0.004), edge(nb(-nw, n0), nb(nw, n0), 0.004)]));
  // (contacts and a cast shadow)
  const footPts: V[] = [W(-hx, 0, -hz), W(hx, 0, -hz), W(hx, 0, hz), W(-hx, 0, hz)];
  const foot: V[] = []; for (let k = 0; k < 4; k++) for (let t = 0; t < 1; t += 0.1) foot.push(add(footPts[k], mul(sub(footPts[(k + 1) % 4], footPts[k]), t)));
  const cs = castShadow(foot, top + ch);
  const cn = footPts.filter((p) => dot(norm(sub(p, base)), away) > -0.2).slice(0, 2).map((p) => contact(p, norm(cross(UP, away)), F.wall));
  els.push(...group(0.95, cn[0] ?? null, [wash(cs.region, cs.anchor, { reach: 0.7, material: dry ? 'dry' : 'wash', depth: 0.6, feature: F.wall, direction: () => away })], cn.slice(1)));
  // (its boxes for the occluder: the wall and the cornice)
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
 * behind to the right, in the stone's cast shadow; one in front, across the stone's right side), all drawn with the
 * same brushes (the far culm stands in the back culm's shadow, and casts its own along it). With `compose` (the default) the relationships a scene needs and isolated specimens avoid:
 * - **importance**: the stone leads; the others' washes lighter and their lines thinner and fainter, and they go earlier
 *   as the detail falls, so the sparse state is the stone and the few lines that place the rest;
 * - **one ground**: cast shadows kept off other objects' footprints and off each other (render.ts can't know this);
 * - **halo** (render.ts, view by view): a mark breaks where a nearer, different object's silhouette passes just in front
 *   of it, so lines don't run into each other and paper is left along every overlap. Each element carries its object.
 * Without it (`compose = false`): the same objects in the same places, each drawn as if alone.
 */
export interface ComposedScene extends BrushScene { objects: Float32Array; importance: Record<string, number> }
export function composedScene(look: Look = 'wash', compose = true): ComposedScene {
  ground = compose ? { solids: [], shadows: [] } : null;
  try {
    const layout = [
      { name: 'stone', obj: 1, w: 1, make: () => stoneElements(look, [0, 0, 0]) },
      { name: 'culm-front', obj: 3, w: 0.75, make: () => culmElements(look, [1.35, 0, 0.95], 0.065, 1.6) },
      { name: 'culm-back', obj: 4, w: 0.6, make: () => culmElements(look, [1.55, 0, -0.95], 0.085, 2.3) },
      { name: 'culm-far', obj: 5, w: 0.5, make: () => culmElements(look, [2.1, 0, -1.3], 0.075, 1.95) },
      { name: 'corner', obj: 2, w: 0.65, make: () => cornerElements(look, [-1.65, 0, -1.55], 0.45) },
    ];
    const els: Element[] = [], tris: number[] = [], objs: number[] = [], importance: Record<string, number> = {};
    for (const L of layout) {
      const made = scope(L.name, L.make), w = compose ? L.w : 1;
      importance[L.name] = w;
      for (const e of made.els) {
        e.object = L.obj;
        if (e.feature) e.feature = L.obj * 256 + e.feature;
        if (w < 1) {
          // (lesser objects: lighter, thinner, and they go first)
          e.rank *= 0.72 + 0.28 * w;
          if (e.kind === 'stroke') { e.alpha *= 0.5 + 0.5 * w; e.gesture = { ...e.gesture, width: e.gesture.width * (0.65 + 0.35 * w) }; }
          else e.depth *= 0.4 + 0.6 * w;
        }
        els.push(e);
      }
      tris.push(...made.tris); for (let k = 0; k < made.tris.length / 3; k++) objs.push(L.obj);
    }
    const s = toSplats(els.flatMap((e) => deposit(e)));
    return { drawing: s, occluder: new Float32Array(tris), objects: new Float32Array(objs), elements: els, importance, centres: { all: [0.3, 0.75, -0.45], stone: [0, 0.45, 0], overlap: [0.9, 0.6, 0.55], corner: [-1.65, 0.6, -1.55], grove: [1.7, 1.0, -0.6] } };
  } finally { ground = null; }
}

function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], hi: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
void INK;
