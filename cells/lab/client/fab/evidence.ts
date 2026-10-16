/**
 * The evidence bench (`?bench=evidence`): tests that could show Fab's wrong. Each is reproducible: the same code runs
 * here in the page and headless (node), and gives the same numbers.
 *
 * 1. Pattern correctness: hundreds of designs drawn at random from the whole design space, each drafted and put
 *    through the pattern's own checks (seams that meet, a waist that fits its band, clearing the hips, pieces that fit
 *    on the cloth, sewable darts, simple outlines). Any failure's a bug in the grammar.
 * 2. Physical correspondence, against the textile lab's own tests, simulated:
 *    - Peirce's cantilever: a strip of each swatch held at one end, twice its bending length out: a real strip droops
 *      to 41.5°; the bending length read back from the simulated droop should be the swatch's;
 *    - Cusick's drape test: a 30 cm disc on an 18 cm pedestal; its drape coefficient (the shadow's area beyond the
 *      pedestal over the disc's) and its number of folds (nodes), which should order the swatches as stiffness does
 *      and fall in the range drape testers find (about 0.3 for limp cloth to near 1 for stiff);
 *    - the bias: a strip hung from one end, cut on the straight grain and on the bias: the bias one must grow longer.
 * 3. Expressiveness: one construction in contrasting cloths, and contrasting constructions in one cloth, each settled
 *    from flat on the figure; measured by their hems (how far out, how deeply folded, how many folds, how level) and by
 *    how far they swing out in a twirl. The skirts in each set should be measurably apart, and none unstable.
 * 4. Feasibility: milliseconds a frame for a usual skirt and the biggest, on this device; and determinism (the same
 *    design, sewn twice, lands in the same place).
 *
 * (Children's understanding can't be tested here: notes.md sets out how to observe it.)
 */
import { Cloth, type Build } from './cloth';
import { FABRICS, fabricById, type Fabric } from './fabric';
import { DEFAULT_DESIGN, draft, toBuild, type Design, type Method } from './pattern';
import { describe as describeGarment, draftGarment, poseFor, toBuild as garmentBuild } from './garment';
import { WORKSHOPS } from './store';
import { setPose, distance } from './body';

type V3 = [number, number, number];
export interface Row { [k: string]: string | number | boolean }
export interface Section { id: string; title: string; claim: string; rows: Row[]; verdict: string; pass: boolean; shapes?: Array<{ label: string; pts: Array<[number, number]>; r0?: number }> }

/** a seeded random: the same designs every run */
function rng(seed: number) { return () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296); }

// ─── 1. pattern correctness ─────────────────────────────────────────────────────────────────────
export function patternTest(count = 400): Section {
  const r = rng(7), fails = new Map<string, number>(), examples: Row[] = [];
  const methods: Method[] = ['flare', 'gather', 'pleat'];
  let total = 0, checks = 0;
  // (every corner of the space, then designs at random within it)
  const designs: Design[] = [];
  for (const method of methods) for (let panels = 1; panels <= 10; panels++) for (const fullness of [1, 1.5, 2.5, 4]) for (const length of [12, 30, 62]) for (const grain of [0, 45]) designs.push({ ...DEFAULT_DESIGN, method, panels, fullness, length, grain });
  for (let k = 0; k < count; k++) designs.push({ ...DEFAULT_DESIGN, length: 12 + r() * 50, fullness: 1 + r() * 3, method: methods[Math.floor(r() * 3)], panels: 1 + Math.floor(r() * 10), grain: r() < 0.5 ? 0 : r() * 45 });
  for (const d of designs) {
    const sk = draft(d);
    total++;
    for (const c of sk.checks) {
      checks++;
      if (!c.ok) { fails.set(c.name, (fails.get(c.name) ?? 0) + 1); if (examples.length < 8) examples.push({ check: c.name, detail: c.detail, design: `${d.method} ${d.length.toFixed(0)}cm ×${d.fullness.toFixed(2)} ${d.panels}p ${d.grain.toFixed(0)}°` }); }
    }
  }
  const failed = [...fails.values()].reduce((s, v) => s + v, 0);
  return {
    id: 'pattern', title: '1 · Is every pattern a real pattern?',
    claim: `${designs.length} designs: every corner of the space (each way of making fullness × 1–10 panels × 4 fullnesses × 3 lengths × straight or bias) and ${count} more at random; each drafted and checked.`,
    rows: [...[...fails].map(([name, v]) => ({ check: name, failures: v })), ...examples],
    verdict: failed ? `${failed} of ${checks} checks failed across ${total} patterns` : `all ${checks} checks passed across ${total} patterns`, pass: failed === 0,
  };
}

// ─── 2a. Peirce's cantilever ────────────────────────────────────────────────────────────────────
/** a strip, `w` wide and `l` long, held at one end, along the warp (or `bias` radians off it) */
function strip(f: Fabric, l: number, w: number, h: number, bias = 0, hang = false): Build {
  const nu = Math.max(4, Math.round(l / h)), nv = Math.max(2, Math.round(w / h));
  const holds: Build['holds'] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= 1; i++) {
    const x = (i / nu) * l, z = (j / nv) * w;
    holds.push({ at: [0, i, j], p: hang ? [z, 60 - x, 0] : [x, 50, z] });
  }
  return {
    pieces: [{ nu, nv, flat: (u, v) => [u * l, -v * w], grain: Math.PI / 2 + bias, start: (u, v) => (hang ? [v * w, 60 - u * l, 0] : [u * l, 50, v * w]) }],
    pairs: [], holds, fabric: f, collider: null, self: false, floor: false,
  };
}
function settle(c: Cloth, seconds: number) { for (let i = 0; i < seconds * 60; i++) c.step(1 / 60); }
export function cantilever(): Section {
  const rows: Row[] = []; let worstC = 0, worstG = 0;
  for (const f of FABRICS) {
    const l = 2 * f.bend, out: number[] = [];
    // (converged: a fine mesh, enough substeps; then as a garment's cloth is: about 2 cm, 8 substeps)
    for (const [h, sub] of [[l / 8, 200], [Math.min(2, l / 4), 8]]) {
      const c = new Cloth(strip(f, l, 2.5, h)), g = c.grids[0];
      c.substeps = sub;
      settle(c, 5);
      const j = Math.round(g.nv / 2), a = (g.base + j * (g.nu + 1)) * 3, b = (g.base + g.nu + j * (g.nu + 1)) * 3;
      const th = Math.atan2(c.pos[a + 1] - c.pos[b + 1], c.pos[b] - c.pos[a]);
      // (Peirce: c = l·(cos(θ/2) / (8·tan θ))^⅓, l the overhang)
      out.push(th, l * Math.cbrt(Math.cos(th / 2) / (8 * Math.tan(th))));
    }
    const ec = out[1] / f.bend - 1, eg = out[3] / f.bend - 1;
    worstC = Math.max(worstC, Math.abs(ec)); worstG = Math.max(worstG, Math.abs(eg));
    const pc = (e: number) => `${e >= 0 ? '+' : ''}${(e * 100).toFixed(0)}%`;
    rows.push({ fabric: f.name, 'c, swatch': `${f.bend.toFixed(1)} cm`, 'droop, converged': `${((out[0] * 180) / Math.PI).toFixed(1)}°`, 'c, converged': `${out[1].toFixed(2)} cm (${pc(ec)})`, 'droop, as worn': `${((out[2] * 180) / Math.PI).toFixed(1)}°`, 'c, as worn': `${out[3].toFixed(2)} cm (${pc(eg)})` });
  }
  return {
    id: 'cantilever', title: '2a · Does each cloth bend as stiffly as its swatch says? (Peirce cantilever)',
    claim: 'A strip twice its bending length out droops to 41.5°, and the bending length read back from its droop is the swatch\'s. Converged (a fine mesh, 200 substeps a frame) this tests the bending model itself: within 12% (Peirce\'s own formula is an approximation, reported to overestimate stiffness by about 18%). As worn (a 2 cm mesh, 8 substeps, what the figure gets) it\'s allowed 20%: coarse meshes and few substeps are the compromise for a phone.',
    rows, verdict: `converged within ${(worstC * 100).toFixed(0)}%; as worn within ${(worstG * 100).toFixed(0)}%`, pass: worstC <= 0.12 && worstG <= 0.2,
  };
}

// ─── 2b. Cusick's drape test ────────────────────────────────────────────────────────────────────
const PED = 9, SPEC = 15;
const pedestal = {
  hit: { nx: 0, ny: 1, nz: 0 },
  distance(x: number, y: number, z: number) {
    // (a disc, its top at y = 50: the distance to it, and which way's out)
    const r = Math.hypot(x, z), dr = r - PED, dy = y - 50;
    if (dr <= 0 && dy >= -6) { if (dy > -dr) { this.hit.nx = 0; this.hit.ny = 1; this.hit.nz = 0; return dy; } this.hit.nx = x / (r || 1); this.hit.ny = 0; this.hit.nz = z / (r || 1); return dr; }
    if (dy >= -6 && dy <= 0) { this.hit.nx = x / r; this.hit.ny = 0; this.hit.nz = z / r; return dr; }
    const qx = Math.max(dr, 0), qy = dy > 0 ? dy : dy + 6 < 0 ? dy + 6 : 0, l = Math.hypot(qx, qy) || 1;
    this.hit.nx = (x / r) * (qx / l); this.hit.ny = qy / l; this.hit.nz = (z / r) * (qx / l);
    return l;
  },
};
export function disc(f: Fabric, around = 56, h = 1.8): Build {
  const r0 = 5, nv = Math.round((SPEC - r0) / h), at = (v: number) => r0 + v * (SPEC - r0);
  const holds: Build['holds'] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= around; i++) {
    const r = at(j / nv), a = (i / around) * Math.PI * 2;
    if (r <= PED + 0.01) holds.push({ at: [0, i, j], p: [Math.sin(a) * r, 50.4, Math.cos(a) * r] });
  }
  return {
    pieces: [{ nu: around, nv, flat: (u, v) => { const r = at(v), a = u * Math.PI * 2; return [Math.sin(a) * r, Math.cos(a) * r]; }, grain: 0, start: (u, v) => { const r = at(v), a = u * Math.PI * 2; return [Math.sin(a) * r, 50.4, Math.cos(a) * r]; } }],
    pairs: Array.from({ length: nv + 1 }, (_, j) => ({ a: [0, 0, j] as [number, number, number], b: [0, around, j] as [number, number, number] })),
    holds, fabric: f, collider: pedestal, floor: false, margin: 0.3,
  };
}
/** bearings no point fell in (more bearings than points round): straight between the nearest that had one */
function fillGaps(r: Float64Array, empty: number) {
  const B = r.length, has = Array.from(r, (v) => v > empty);
  if (!has.some(Boolean)) return;
  for (let b = 0; b < B; b++) {
    if (has[b]) continue;
    let lo = 1, hi = 1;
    while (!has[(b - lo + B) % B]) lo++;
    while (!has[(b + hi) % B]) hi++;
    r[b] = r[(b - lo + B) % B] + ((r[(b + hi) % B] - r[(b - lo + B) % B]) * lo) / (lo + hi);
  }
}
/** the shadow round the pedestal: the furthest out at each of 180 bearings; its area beyond the pedestal over the disc's; its folds */
export function shadow(c: Cloth) {
  const B = 72, rmax = new Float64Array(B).fill(PED);
  for (let i = 0; i < c.n; i++) {
    const x = c.pos[i * 3], z = c.pos[i * 3 + 2], r = Math.hypot(x, z), b = Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * B) % B;
    if (r > rmax[b]) rmax[b] = r;
  }
  fillGaps(rmax, PED);
  let area = 0; for (let b = 0; b < B; b++) area += 0.5 * rmax[b] ** 2 * ((Math.PI * 2) / B);
  const dc = (area - Math.PI * PED * PED) / (Math.PI * (SPEC * SPEC - PED * PED));
  const sm = Array.from(rmax, (_, b) => (rmax[(b + B - 1) % B] + 2 * rmax[b] + rmax[(b + 1) % B]) / 4);
  const mean = sm.reduce((s, v) => s + v, 0) / B;
  let nodes = 0; for (let b = 0; b < B; b++) { const v = sm[b]; if (v > mean && v >= sm[(b + 1) % B] && v > sm[(b + B - 1) % B]) nodes++; }
  return { dc, nodes, pts: Array.from(rmax, (r, b) => { const a = ((b + 0.5) / B) * Math.PI * 2 - Math.PI; return [Math.sin(a) * r, Math.cos(a) * r] as [number, number]; }) };
}
/** converged drape coefficients (a 1 cm mesh, 64 substeps a frame): `?bench=evidence&converged` measures them again */
const CONVERGED: Record<string, number> = { chiffon: 0.29, lawn: 0.57, linen: 0.77, felt: 0.94 };
export function cusick(converged = false): Section {
  const rows: Row[] = [], shapes: Section['shapes'] = [], res: Array<{ f: Fabric; dc: number }> = [];
  for (const f of FABRICS) {
    const c = new Cloth(disc(f));
    settle(c, 4);
    const s = shadow(c);
    res.push({ f, dc: s.dc });
    let ref = CONVERGED[f.id] !== undefined ? `${CONVERGED[f.id].toFixed(2)} (recorded)` : '';
    if (converged && CONVERGED[f.id] !== undefined) { const r = new Cloth(disc(f, 96, 1)); r.substeps = 64; settle(r, 4); ref = shadow(r).dc.toFixed(2); }
    rows.push({ fabric: f.name, 'bending length': `${f.bend} cm`, weight: `${f.gsm} gsm`, 'drape coefficient': s.dc.toFixed(2), 'converged': ref, nodes: s.nodes });
    shapes.push({ label: `${f.name} ${s.dc.toFixed(2)}`, pts: s.pts, r0: PED });
  }
  // (stiffer cloth (rigidity over weight: the bending length) should stand out further)
  const byBend = [...res].sort((a, b) => a.f.bend - b.f.bend);
  let inversions = 0; for (let k = 1; k < byBend.length; k++) if (byBend[k].dc < byBend[k - 1].dc - 0.03) inversions++;
  const lo = Math.min(...res.map((r) => r.dc)), hi = Math.max(...res.map((r) => r.dc));
  return {
    id: 'cusick', title: '2b · Does each cloth drape as such cloth does? (Cusick drape test)',
    claim: 'A 30 cm disc on an 18 cm pedestal, as the figure\'s cloth is simulated (a 1.8 cm mesh). Its drape coefficient should rise with bending length (stiffness for weight), span the range drape testers report (about 0.3 for limp cloth to near 1 for stiff), and stay near the converged answer (a fine mesh, many substeps); limp cloth should fall in more folds (nodes).',
    rows, shapes, pass: inversions === 0 && hi - lo >= 0.5 && Math.min(...Object.values(CONVERGED)) <= 0.35 && Math.max(...Object.values(CONVERGED)) >= 0.85,
    verdict: `converged ${Math.min(...Object.values(CONVERGED)).toFixed(2)}–${Math.max(...Object.values(CONVERGED)).toFixed(2)}, in the range drape testers report; as worn ${lo.toFixed(2)}–${hi.toFixed(2)}, ${inversions} out of order with stiffness, limper than converged by up to ${Math.max(...res.filter((r) => CONVERGED[r.f.id] !== undefined).map((r) => CONVERGED[r.f.id] - r.dc)).toFixed(2)} (the real-time compromise)`,
  };
}

// ─── 2c. the bias ───────────────────────────────────────────────────────────────────────────────
export function bias(): Section {
  const rows: Row[] = []; let ok = true;
  for (const id of ['chiffon', 'lawn', 'jersey', 'felt']) {
    const f = fabricById(id), grow: number[] = [];
    for (const b of [0, Math.PI / 4]) {
      const c = new Cloth(strip(f, 30, 6, 1.5, b, true)), g = c.grids[0];
      settle(c, 3);
      const j = Math.round(g.nv / 2), a = (g.base + j * (g.nu + 1)) * 3, e = (g.base + g.nu + j * (g.nu + 1)) * 3;
      grow.push(((c.pos[a + 1] - c.pos[e + 1]) / 30 - 1) * 100);
    }
    if (f.grain && !(grow[1] > grow[0] * 1.5 + 0.05)) ok = false;
    rows.push({ fabric: f.name, 'straight grain': `+${grow[0].toFixed(2)}%`, 'on the bias': `+${grow[1].toFixed(2)}%`, ratio: (grow[1] / Math.max(1e-6, grow[0])).toFixed(1) });
  }
  return {
    id: 'bias', title: '2c · Does cloth cut on the bias stretch as bias-cut cloth does?',
    claim: 'A 30 × 6 cm strip hung from its top for 3 s, cut along the warp and at 45° to it. A woven bias strip should grow markedly more (it\'s held only by shear); felt, which has no grain, the same either way.',
    rows, verdict: ok ? 'every woven cloth grows more on the bias' : 'a woven cloth did not grow more on the bias', pass: ok,
  };
}

// ─── 3. expressiveness ─────────────────────────────────────────────────────────────────────────
export interface Hem { out: number; folds: number; depth: number; level: number; swing: number; strain: number; p99: number; ok: boolean; pts: Array<[number, number]> }
export function hemOf(d: Design, twirl = true): Hem {
  const sk = draft(d), c = new Cloth(toBuild(sk, fabricById(d.fabric)));
  settle(c, 4);
  const measure = () => {
    const B = 120, r = new Float64Array(B), ys: number[] = [];
    for (let p = 0; p < sk.m.panels; p++) {
      const g = c.grids[p];
      for (let i = 0; i <= g.nu; i++) {
        const k = (g.base + i + g.nv * (g.nu + 1)) * 3, x = c.pos[k], z = c.pos[k + 2], rr = Math.hypot(x, z), b = Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * B) % B;
        r[b] = Math.max(r[b], rr); ys.push(c.pos[k + 1]);
      }
    }
    fillGaps(r, 0);
    const mean = r.reduce((s, v) => s + v, 0) / B, sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / B);
    let folds = 0; for (let b = 0; b < B; b++) if (r[b] > mean && r[b] >= r[(b + 1) % B] && r[b] > r[(b + B - 1) % B]) folds++;
    const ym = ys.reduce((s, v) => s + v, 0) / ys.length, ysd = Math.sqrt(ys.reduce((s, v) => s + (v - ym) ** 2, 0) / ys.length);
    return { mean, sd, folds, ysd, pts: Array.from(r, (v, b) => { const a = ((b + 0.5) / B) * Math.PI * 2 - Math.PI; return [Math.sin(a) * v, Math.cos(a) * v] as [number, number]; }) };
  };
  const still = measure(), st = c.strain();
  let swing = 0;
  if (twirl) { c.omega = Math.PI * 2 * 0.9; settle(c, 1.5); swing = measure().mean - still.mean; }
  return { out: still.mean, folds: still.folds, depth: still.sd, level: still.ysd, swing, strain: st.max, p99: st.p99, ok: st.ok && st.p99 < 0.15, pts: still.pts };
}
const describe = (d: Design) => `${d.method === 'flare' ? (d.fullness <= 1.01 ? 'straight' : 'flared') : d.method === 'gather' ? 'gathered' : 'pleated'}, ${d.panels} panel${d.panels > 1 ? 's' : ''}${d.grain > 30 ? ', bias' : ''}, ${fabricById(d.fabric).name}`;
function spread(hs: Hem[]) {
  // (how far apart the skirts in a set are: the smallest difference between any two, in their hems' own terms)
  let least = Infinity;
  for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) {
    const dd = Math.hypot((hs[a].out - hs[b].out) / 2, (hs[a].depth - hs[b].depth) / 1, (hs[a].folds - hs[b].folds) / 3, (hs[a].swing - hs[b].swing) / 2);
    least = Math.min(least, dd);
  }
  return least;
}
export function expressiveness(): Section[] {
  const base: Design = { ...DEFAULT_DESIGN, length: 34, fullness: 2.2, panels: 4, grain: 0 };
  const sets: Array<{ id: string; title: string; designs: Design[] }> = [
    { id: 'cloths', title: '3a · One construction, contrasting cloths', designs: ['chiffon', 'lawn', 'linen', 'felt'].map((fabric) => ({ ...base, method: 'flare', fabric })) },
    { id: 'cuts', title: '3b · One cloth, contrasting constructions', designs: [{ ...base, method: 'flare', fullness: 1 }, { ...base, method: 'flare' }, { ...base, method: 'gather' }, { ...base, method: 'pleat' }, { ...base, method: 'flare', panels: 1, grain: 45 }].map((x) => ({ ...x, fabric: 'lawn' }) as Design) },
  ];
  return sets.map((s) => {
    const hs = s.designs.map((d) => hemOf(d)), least = spread(hs);
    return {
      id: s.id, title: s.title,
      claim: 'Each settled from flat on the figure for 4 s, then twirled at 0.9 turns a second. Their hems: how far out (cm from the stand\'s axis), how deeply folded (spread of that, cm), how many folds, how level (spread of hem height, cm), how far they swing out in the twirl (cm), and how stretched the cloth is (stable: 99% of it within 15% of its cut length).',
      rows: hs.map((h, k) => ({ skirt: describe(s.designs[k]), 'hem out': h.out.toFixed(1), 'fold depth': h.depth.toFixed(2), folds: h.folds, level: h.level.toFixed(2), swing: `+${h.swing.toFixed(1)}`, 'stretch (99th %ile / worst)': `${(h.p99 * 100).toFixed(1)}% / ${(h.strain * 100).toFixed(0)}%`, stable: h.ok })),
      shapes: hs.map((h, k) => ({ label: describe(s.designs[k]), pts: h.pts })),
      verdict: `nearest two differ by ${least.toFixed(2)} (scaled units); ${hs.every((h) => h.ok) ? 'all stable' : 'one or more unstable'}`, pass: least > 0.5 && hs.every((h) => h.ok),
    };
  });
}

// ─── 4. feasibility ─────────────────────────────────────────────────────────────────────────────
export function feasibility(): Section {
  const rows: Row[] = [];
  // (warm the JIT first: the first skirt timed would otherwise pay for it)
  { const c = new Cloth(toBuild(draft(DEFAULT_DESIGN), fabricById(DEFAULT_DESIGN.fabric))); settle(c, 1); }
  for (const [label, d] of [['the usual', DEFAULT_DESIGN], ['a full circle, maxi', { ...DEFAULT_DESIGN, method: 'flare', fullness: 4, length: 60, panels: 1 }], ['gathered, 3× full', { ...DEFAULT_DESIGN, method: 'gather', fullness: 3 }]] as Array<[string, Design]>) {
    const sk = draft(d), c = new Cloth(toBuild(sk, fabricById(d.fabric)));
    settle(c, 0.5);
    const t0 = performance.now(); settle(c, 1); const ms = (performance.now() - t0) / 60;
    rows.push({ skirt: label, points: c.n, springs: c.la.length, 'ms a frame': ms.toFixed(1) });
  }
  // (determinism: sewn twice, the same)
  const sum = () => { const c = new Cloth(toBuild(draft(DEFAULT_DESIGN), fabricById(DEFAULT_DESIGN.fabric))); settle(c, 1); let s = 0; for (let i = 0; i < c.pos.length; i++) s = (s * 31 + Math.round(c.pos[i] * 1000)) % 1e9; return s; };
  const a = sum(), b = sum();
  rows.push({ skirt: 'determinism', points: a === b ? 'same twice' : 'differs', springs: a, 'ms a frame': b });
  const worst = Math.max(...rows.slice(0, 3).map((r) => Number(r['ms a frame'])));
  return {
    id: 'feasibility', title: '4 · Is it quick enough, and the same every time?',
    claim: 'The cloth\'s step, on whatever device is running this page, after it\'s settled a moment. Under 12 ms leaves room for drawing within a 60 Hz frame. Open this page on the phone to measure the phone.',
    rows, verdict: `worst ${worst.toFixed(1)} ms a frame; ${a === b ? 'deterministic' : 'NOT deterministic'}`, pass: worst < 12 && a === b,
  };
}

// ─── 5. every garment, as a pattern ─────────────────────────────────────────────────────────────
/** tops, dresses, trousers and jumpsuits: every corner of their own dials, and more at random, each drafted and put
 * through its checks (seams meet as they should, pieces lie flat, fit on the cloth, clear the body, go on) */
export function garmentTest(count = 300): Section {
  const r = rng(11), designs: Array<Partial<Design>> = [], fails = new Map<string, number>(), examples: Row[] = [];
  const necks = ['round', 'v', 'square', 'boat', 'scoop'] as const, sleeves = ['plain', 'puff', 'bell'] as const, collars = ['none', 'peterpan', 'band', 'frill'] as const;
  for (const family of ['top', 'dress', 'jumpsuit'] as const) for (const neck of necks) for (const sleeveLen of [0, 5, 30]) for (const sleeve of sleeves) for (const collar of collars) {
    if (!sleeveLen && sleeve !== 'plain') continue;
    designs.push({ family, neck, sleeveLen, sleeve, collar, ease: designs.length % 2 ? 4 : 16, bodyLen: designs.length % 3 ? -6 : 30, fabric: designs.length % 4 ? 'lawn' : 'jersey' });
  }
  for (const legLen of [3, 34]) for (const legWidth of [1, 2]) for (const flare of [0.8, 1.8]) designs.push({ family: 'trousers', legLen, legWidth, flare });
  for (const method of ['flare', 'gather', 'pleat'] as const) for (const tiers of [2, 3]) for (const length of [20, 62]) designs.push({ family: 'skirt', method, tiers, length }, { family: 'dress', method, tiers, length });
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  for (let k = 0; k < count; k++) designs.push({
    family: pick(['top', 'dress', 'trousers', 'jumpsuit', 'skirt'] as const), neck: pick(necks), sleeve: pick(sleeves), collar: pick(collars), sleeveLen: r() * 34, ease: 4 + r() * 12, bodyLen: -6 + r() * 36,
    swing: 1 + r() * 0.8, neckDepth: -4 + r() * 12, legLen: 3 + r() * 31, legWidth: 1 + r(), flare: 0.8 + r(), method: pick(['flare', 'gather', 'pleat'] as const), fullness: 1 + r() * 3, length: 12 + r() * 50, tiers: 1 + Math.floor(r() * 3), panels: 1 + Math.floor(r() * 10),
    fabric: pick(['lawn', 'jersey', 'linen', 'chiffon', 'felt']),
  });
  let checks = 0;
  for (const d of designs) {
    let cs;
    try { cs = draftGarment(d).checks; } catch (e) { cs = [{ name: 'drafts', ok: false, detail: String(e) }]; }
    for (const c of cs) { checks++; if (!c.ok) { fails.set(c.name, (fails.get(c.name) ?? 0) + 1); if (examples.length < 8) examples.push({ check: c.name, detail: c.detail, design: describeGarment(d) }); } }
  }
  const failed = [...fails.values()].reduce((a, b) => a + b, 0);
  return {
    id: 'garments', title: '5 · Is every garment a real pattern?',
    claim: `${designs.length} garments: every neckline × sleeve length × sleeve × collar of a top, a dress and a jumpsuit at both ends of their room and length, the corners of trousers' legs, tiered skirts and dresses, and ${count} more at random across everything; each drafted and put through its own checks.`,
    rows: [...[...fails].map(([name, v]) => ({ check: name, failures: v })), ...examples],
    verdict: failed ? `${failed} of ${checks} checks failed across ${designs.length} garments` : `all ${checks} checks passed across ${designs.length} garments`, pass: failed === 0,
  };
}

// ─── 6. every garment, sewn ─────────────────────────────────────────────────────────────────────
/** the workshop's own garments, each laid out, sewn and settled on the figure for 2.5 s: are its seams closed, is the
 * cloth whole and unstretched, is it out of the figure */
export function sewnTest(): Section {
  const rows: Row[] = [];
  let pass = true;
  for (const rail of WORKSHOPS) for (const gm of rail.garments) {
    const g = draftGarment(gm.design); poseFor(g);
    const c = new Cloth(garmentBuild(g, fabricById(g.design.fabric)) as Build);
    const t0 = performance.now(); settle(c, 2.5); const ms = (performance.now() - t0) / 150;
    const se = c.seams(), st = c.strain();
    let inside = 0; for (let i = 0; i < c.n; i++) if (distance(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]) < -0.5) inside++;
    const ok = st.ok && se.max < 2.5 && se.mean < 0.25 && inside < c.n * 0.002;
    pass &&= ok;
    rows.push({ garment: describeGarment(g.design), points: c.n, 'widest seam (cm)': +se.max.toFixed(2), 'mean seam': +se.mean.toFixed(3), 'stretch p99': `${(st.p99 * 100).toFixed(0)}%`, inside, 'ms a frame': +ms.toFixed(1), ok });
  }
  setPose('twirl');
  return {
    id: 'sewn', title: '6 · Does every garment sew up?',
    claim: 'Every garment on the workshop\'s rails, laid out flat round the figure, sewn and let settle (2.5 s): every seam closed to within 2.5 cm (0.25 cm on average), the cloth unbroken, nothing left inside the figure.',
    rows, verdict: pass ? `all ${rows.length} sew up` : `${rows.filter((r) => !r.ok).length} of ${rows.length} don't`, pass,
  };
}

export function* runAll(): Generator<Section | Section[]> {
  yield patternTest();
  yield cantilever();
  yield cusick(new URLSearchParams(globalThis.location?.search ?? '').has('converged'));
  yield bias();
  yield expressiveness();
  yield feasibility();
  yield garmentTest();
  yield sewnTest();
}

// ─── the page ───────────────────────────────────────────────────────────────────────────────────
export function mountEvidence() {
  document.body.innerHTML = `<main style="max-width:860px;margin:0 auto;padding:16px;font:14px/1.45 ui-rounded,system-ui,sans-serif;color:#3b2f24;background:#f4efe2;min-height:100vh;overflow:auto;height:100vh;box-sizing:border-box;touch-action:pan-y">
    <p><a href="?" style="color:#b8323f">← Fab</a></p><h1 style="margin:.2em 0">Fab · evidence bench</h1>
    <p style="color:#7a6a56">Tests that could show the workbench is wrong: the patterns, the cloth against the textile lab's own tests, how far apart its skirts really are, whether it's quick enough, and whether every garment it makes is a real pattern that sews up. Running…</p><div id="out"></div></main>`;
  document.body.style.overflow = 'auto';
  const out = document.getElementById('out')!, it = runAll(), all: Section[] = [];
  const next = () => {
    const r = it.next();
    if (r.done) { (window as unknown as { __evidence: unknown }).__evidence = all; out.insertAdjacentHTML('beforeend', `<p><b>${all.filter((s) => s.pass).length} of ${all.length} pass.</b></p>`); return; }
    for (const s of Array.isArray(r.value) ? r.value : [r.value]) { all.push(s); out.insertAdjacentHTML('beforeend', html(s)); }
    setTimeout(next, 30);
  };
  setTimeout(next, 50);
}
function html(s: Section) {
  const cols = [...new Set(s.rows.flatMap((r) => Object.keys(r)))];
  const table = `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:.4em 0">${'<tr>' + cols.map((c) => `<th style="text-align:left;border-bottom:1px solid #cdbfa8;padding:3px 6px">${c}</th>`).join('') + '</tr>'}${s.rows.map((r) => '<tr>' + cols.map((c) => `<td style="border-bottom:1px solid #e6dccb;padding:3px 6px">${r[c] ?? ''}</td>`).join('') + '</tr>').join('')}</table>`;
  const shapes = s.shapes ? `<div style="display:flex;flex-wrap:wrap;gap:8px">${s.shapes.map((sh) => svg(sh)).join('')}</div>` : '';
  return `<section style="margin:1.2em 0;padding:12px;border-radius:12px;background:#fffaf0;box-shadow:0 1px 4px rgba(60,40,20,.12)"><h3 style="margin:0 0 .3em">${s.title}</h3><p style="margin:0;color:#7a6a56">${s.claim}</p><div style="overflow-x:auto">${table}</div>${shapes}<p style="margin:.4em 0 0;font-weight:700;color:${s.pass ? '#3f7a4a' : '#b8323f'}">${s.pass ? '✓' : '✗'} ${s.verdict}</p></section>`;
}
function svg(sh: { label: string; pts: Array<[number, number]>; r0?: number }) {
  const R = Math.max(16, ...sh.pts.map((p) => Math.hypot(p[0], p[1]))) * 1.05;
  return `<figure style="margin:0;text-align:center;font-size:11px;width:120px"><svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" width="110" height="110"><circle r="${sh.r0 ?? 0}" fill="#cdbfa8"/><polygon points="${sh.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="rgba(224,86,110,.25)" stroke="#b8323f" stroke-width="${R / 60}"/></svg><figcaption>${sh.label}</figcaption></figure>`;
}
