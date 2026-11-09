/**
 * A drawing policy: a decision above deposition, at the level of groups. For each group of a composed scene (a seam
 * with its wedge, a cornice with its underside, a culm's sides), from the view, a policy chooses a treatment:
 * - **extent** (0..1): how much of the group survives, heart first (by its marks' ranks): 0 none, a little the heart
 *   only (a seam's hook, a wash close to its anchor), 1 all of it;
 * - **strength**: how strong its marks are (a multiple of their opacity).
 * The brushes still make every mark; a treatment only says which of a group's marks show and how strongly, so marks keep
 * their identities, anchors and editability, and an edit is unaffected.
 *
 * Its inputs, per group and view (`features`): its role, whether it's structural or an alternative, its object's
 * emphasis, its projected size, how far it faces the eye, how much of it a nearer object hides, how many other
 * objects' groups compete with it on the screen, the detail asked, and the previous decision.
 *
 * Policies (compared at the same mark budget, `matchBudget`):
 * - `ranks`: no control; the global detail against each mark's rank (what the scene did before);
 * - `rules`: hand-written rules over those inputs (the baseline a learned policy has to beat);
 * - `learned`: a small model scoring treatments (`policynet.ts`, trained from judged pairs by
 *   devtools/splats-policy-train.mjs); each group's treatment the best-scoring at the budget's price.
 */
import { add, dot, len, mul, norm, sub, type Dep, type Element, type Group, type V } from './brush';

export type Role = 'line' | 'edge' | 'contact' | 'tone' | 'ground';
export const ROLES: Role[] = ['line', 'edge', 'contact', 'tone', 'ground'];
/** what a policy knows about a group, fixed for the scene (until an edit changes its marks) */
export interface GroupInfo {
  index: number; key: string; object: number; emphasis: number; role: Role; structural: boolean; alt: boolean;
  facing?: V; centre: V; radius: number; samples: V[];
  /** its marks' ranks, sorted, and their range */
  ranks: Float32Array; lo: number; hi: number;
}
/** a stand-in for an object's shape, to tell whether it hides a point (a sphere, or an upright capsule from y 0 to h) */
export interface Proxy { object: number; c: V; r: number; h?: number }
export interface ViewIn { eye: V; fwd: V; focalPx: number; detail: number }

export function groupInfo(g: Group, index: number, members: Element[], deps: (e: Element) => Dep[], emphasis: number): GroupInfo {
  const all = members.flatMap(deps), first = g.principal ?? members[0];
  const ranks = Float32Array.from(all.map((d) => d.rank)).sort();
  const centre = all.reduce((s, d) => add(s, mul(d.p, 1 / Math.max(1, all.length))), [0, 0, 0] as V);
  let radius = 0; for (const d of all) radius = Math.max(radius, len(sub(d.p, centre)));
  const step = Math.max(1, Math.floor(all.length / 6)), samples = all.filter((_, i) => i % step === 0).slice(0, 6).map((d) => d.p);
  const role: Role = first.object === 6 ? 'ground' : first.mark === 5 ? 'contact' : first.kind === 'wash' ? 'tone' : first.mark === 4 ? 'edge' : 'line';
  const facing = members.find((e) => e.facing)?.facing;
  return { index, key: g.key, object: first.object ?? 0, emphasis, role, structural: members.some((e) => e.structural), alt: members.some((e) => e.alt), facing, centre, radius, samples, ranks, lo: ranks[0] ?? 0, hi: ranks[ranks.length - 1] ?? 1 };
}

/** the rank a group's marks must reach for a given extent */
export const thresholdOf = (g: GroupInfo, e: number) => (e <= 0 ? 2 : g.hi - Math.min(1, e) * (g.hi - g.lo + 0.03) + 0.0001);
/** how many of a group's marks a threshold keeps */
export function keptAt(g: GroupInfo, thr: number): number { let lo = 0, hi = g.ranks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (g.ranks[m] < thr) lo = m + 1; else hi = m; } return g.ranks.length - lo; }

/** does a different object's stand-in lie on the line from the eye to a point? */
function hidden(eye: V, p: V, obj: number, proxies: Proxy[]): boolean {
  const d = sub(p, eye), L = len(d), u = mul(d, 1 / L);
  for (const q of proxies) {
    if (q.object === obj) continue;
    // (a capsule: the nearest approach of the line to its axis, by sampling the line; a sphere: the closest point)
    if (q.h !== undefined) {
      for (let t = 0.05; t < 0.97; t += 0.06) { const x = add(eye, mul(d, t)); if (x[1] >= 0 && x[1] <= q.h && Math.hypot(x[0] - q.c[0], x[2] - q.c[2]) < q.r) return true; }
    } else { const t = Math.max(0, Math.min(L * 0.97, dot(sub(q.c, eye), u))); if (len(sub(add(eye, mul(u, t)), q.c)) < q.r) return true; }
  }
  return false;
}

export const N_FEATURES = ROLES.length + 9;
/** a group's inputs for a view: role (one-hot), structural, alternative, emphasis, size (log of its screen radius in
 * pixels), facing, hidden share, competition, detail asked, previous extent */
export function features(g: GroupInfo, v: ViewIn, proxies: Proxy[], competition: number, prev: number): number[] {
  const toEye = sub(v.eye, g.centre), dist = Math.max(0.1, len(toEye)), px = (g.radius / dist) * v.focalPx;
  const facing = g.facing ? dot(g.facing, mul(toEye, 1 / dist)) : 0.5;
  const hid = g.samples.length ? g.samples.filter((p) => hidden(v.eye, p, g.object, proxies)).length / g.samples.length : 0;
  return [...ROLES.map((r) => (r === g.role ? 1 : 0)), g.structural ? 1 : 0, g.alt ? 1 : 0, g.emphasis, Math.log(1 + px) / 5, facing, hid, Math.min(1, competition / 6), v.detail, prev];
}
/** how many other objects' groups overlap each group on the screen (weighted by their emphasis) */
export function competitionOf(groups: GroupInfo[], v: ViewIn): number[] {
  const scr = groups.map((g) => { const z = Math.max(0.1, dot(sub(g.centre, v.eye), v.fwd)); return { z, r: (g.radius / z) * v.focalPx }; });
  // (screen position: the direction off the forward axis, scaled; enough to compare overlaps)
  const pos = groups.map((g, i) => { const d = sub(g.centre, v.eye), z = scr[i].z, side = sub(d, mul(v.fwd, dot(d, v.fwd))); return mul(side, v.focalPx / z); });
  return groups.map((g, i) => { let c = 0; for (let j = 0; j < groups.length; j++) { if (j === i || groups[j].object === g.object) continue; if (len(sub(pos[i], pos[j])) < scr[i].r + scr[j].r) c += groups[j].emphasis; } return c; });
}

/** per group: how much of it is kept (extent, from its heart), how strong; and, for a taught drawing, how wide its marks
 * are (1 as made) and how much of an edge shows where it isn't on the outline (0: only there) */
export interface Treatment { e: Float32Array; s: Float32Array; w?: Float32Array; inner?: Float32Array }
/** the hand-written rules: the baseline */
export function rules(groups: GroupInfo[], F: number[][], detail: number): Treatment {
  const e = new Float32Array(groups.length), s = new Float32Array(groups.length);
  groups.forEach((g, i) => {
    const f = F[i], size = f[ROLES.length + 3], facing = f[ROLES.length + 4], hid = f[ROLES.length + 5], comp = f[ROLES.length + 6];
    // (structure keeps a floor; detail follows the detail asked)
    let x = g.structural ? 0.45 + 0.55 * detail : detail;
    // (tone only as far as it's seen: a wash turned away goes; and, unless it's structure (a crack's wedge, an
    // overhang's underside), none at the sparse state: there tone is kept for the pairs that need it)
    if (g.role === 'tone') x *= Math.max(0, Math.min(1, (facing + 0.1) / 0.5));
    if (g.role === 'tone' && !g.structural) x *= Math.max(0, Math.min(1, (detail - 0.35) / 0.3));
    // (what's mostly hidden by a nearer object, or tiny on the screen, keeps less, unless it's structure)
    if (!g.structural && hid > 0.6) x *= 0.4;
    if (!g.structural && size < 0.25) x *= 0.5;
    // (lesser objects give way where they crowd another object)
    if (g.emphasis < 1 && comp > 0.5 && !g.structural) x *= 0.7;
    // (contact stays strong)
    if (g.role === 'contact') x = Math.max(x, 0.85);
    e[i] = Math.max(0, Math.min(1, x));
    s[i] = g.role === 'contact' ? 1.15 : g.structural ? 1 : 0.75 + 0.25 * g.emphasis;
  });
  return { e, s };
}
/** the marks a treatment keeps */
export const marksOf = (groups: GroupInfo[], t: Treatment) => groups.reduce((n, g, i) => n + keptAt(g, thresholdOf(g, t.e[i])), 0);
/** the marks the global detail keeps against the ranks (the budget a policy is held to) */
export const marksAtDetail = (groups: GroupInfo[], detail: number) => groups.reduce((n, g) => n + keptAt(g, 1 - detail), 0);
/** scale a treatment's extents (keeping structure's floor and contacts) until it keeps the budget's marks */
export function matchBudget(groups: GroupInfo[], t: Treatment, budget: number): Treatment {
  const at = (m: number): Treatment => ({ e: t.e.map((x, i) => (groups[i].role === 'contact' ? x : Math.max(0, Math.min(1, x * m)))), s: t.s });
  let lo = 0, hi = 4;
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (marksOf(groups, at(m)) > budget) hi = m; else lo = m; }
  return at((lo + hi) / 2);
}
/** the controls the renderer takes (four floats a group index): the rank to reach, the strength, on */
export function controls(groups: GroupInfo[], t: Treatment): Float32Array {
  const n = Math.max(...groups.map((g) => g.index)) + 1, out = new Float32Array(n * 4);
  groups.forEach((g, i) => { out[g.index * 4] = thresholdOf(g, t.e[i]); out[g.index * 4 + 1] = t.s[i]; out[g.index * 4 + 2] = Math.max(0.02, t.w ? t.w[i] : 1); out[g.index * 4 + 3] = t.inner ? t.inner[i] : 0; });
  return out;
}

// ─── a learned policy: a small model scoring a group's treatment ───
/** the model: inputs are a group's features and a treatment (e, s, e², e·s); 2 hidden layers; one score */
export interface PolicyNet { inputs: number; hidden: number; w1: number[]; b1: number[]; w2: number[]; b2: number[]; w3: number[]; b3: number; trainedOn: number; agreement: number }
export const treatmentInputs = (f: number[], e: number, s: number) => [...f, e, s, e * e, e * s];
export function score(n: PolicyNet, x: number[]): number {
  const H = n.hidden, h1 = new Array(H), h2 = new Array(H);
  for (let j = 0; j < H; j++) { let a = n.b1[j]; for (let i = 0; i < n.inputs; i++) a += n.w1[j * n.inputs + i] * x[i]; h1[j] = Math.tanh(a); }
  for (let j = 0; j < H; j++) { let a = n.b2[j]; for (let i = 0; i < H; i++) a += n.w2[j * H + i] * h1[i]; h2[j] = Math.tanh(a); }
  let o = n.b3; for (let i = 0; i < H; i++) o += n.w3[i] * h2[i];
  return o;
}
export const E_GRID = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], S_GRID = [0.7, 0.85, 1, 1.15];
/** each group's best treatment by the model's score less a price per mark; the price found to meet the budget */
export function learned(n: PolicyNet, groups: GroupInfo[], F: number[][], budget: number): Treatment {
  const opts = groups.map((g, i) => E_GRID.flatMap((e) => S_GRID.map((s) => ({ e, s, u: score(n, treatmentInputs(F[i], e, s)), m: keptAt(g, thresholdOf(g, e)) }))));
  const pick = (price: number): Treatment => {
    const e = new Float32Array(groups.length), s = new Float32Array(groups.length);
    opts.forEach((o, i) => { let b = o[0], bv = -Infinity; for (const x of o) { const v = x.u - price * x.m; if (v > bv) { bv = v; b = x; } } e[i] = b.e; s[i] = b.s; });
    return { e, s };
  };
  let lo = 0, hi = 1;
  while (marksOf(groups, pick(hi)) > budget && hi < 1e3) hi *= 2;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (marksOf(groups, pick(m)) > budget) lo = m; else hi = m; }
  const t = pick(hi);
  // (the grid is coarse, so what's left of the budget goes, a step at a time, to whichever group's next extent gains
  // most score per mark)
  let left = budget - marksOf(groups, t);
  for (let guard = 0; guard < groups.length * E_GRID.length && left > 0; guard++) {
    let best = -1, bestRate = 0, bestE = 0, bestM = 0;
    groups.forEach((g, i) => {
      // (matched within a tolerance: the treatment's numbers have been through 32-bit floats)
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-4, k = E_GRID.findIndex((x) => near(x, t.e[i])); if (k < 0 || k === E_GRID.length - 1) return;
      const cur = opts[i].find((x) => near(x.e, t.e[i]) && near(x.s, t.s[i])), nxt = opts[i].find((x) => x.e === E_GRID[k + 1] && near(x.s, t.s[i]));
      if (!cur || !nxt) return;
      const dm = nxt.m - cur.m;
      if (dm <= 0 || dm > left) return;
      const rate = (nxt.u - cur.u) / dm; if (best < 0 || rate > bestRate) { best = i; bestRate = rate; bestE = nxt.e; bestM = dm; }
    });
    if (best < 0) break;
    t.e[best] = bestE; left -= bestM;
  }
  return t;
}
/** an alternative to judge against: a treatment's extents and strengths jittered per group, held to the same budget */
export function jitter(groups: GroupInfo[], t: Treatment, rnd: () => number, amount = 0.35): Treatment {
  return { e: t.e.map((x) => Math.max(0, Math.min(1, x + (rnd() * 2 - 1) * amount))), s: t.s.map((x) => Math.max(0.6, Math.min(1.25, x + (rnd() * 2 - 1) * 0.2))) };
}
/** ease a treatment toward a target (so decisions don't flicker as the view moves) */
export function ease(prev: Treatment | null, next: Treatment, k: number): Treatment {
  if (!prev || prev.e.length !== next.e.length) return next;
  const to = (a: Float32Array | undefined, b: Float32Array | undefined, d: number) => (b ? b.map((x, i) => { const p = a ? a[i] : d; return p + (x - p) * k; }) : undefined);
  return { e: next.e.map((x, i) => prev.e[i] + (x - prev.e[i]) * k), s: next.s.map((x, i) => prev.s[i] + (x - prev.s[i]) * k), w: to(prev.w, next.w, 1), inner: to(prev.inner, next.inner, 0) };
}
void norm;

/**
 * Taught by a drawn teacher (taught.ts, devtools/splats-decisions.py): each group given what the teacher decided for
 * the edge or face it draws.
 *
 * **The match** (`taughtMap`): a group to the teacher's entry of its own object and a kind it could be, the nearest in
 * the scene: a stroke to a crease, a silhouette or a line; a wash to a face. A wash on an object whose faces are too
 * small to have entries (a culm) goes with the object's body; a far match is no match (the object's average for that
 * kind instead). On the ground, shadows go with the teacher's ground tone, contacts with their object's strokes, and
 * the ground's lines with nothing (the teacher was shown no bank).
 *
 * **The treatment**: fitted where there's a fit (`taughtFit`: devtools/splats-taught-fit.mjs adjusts each group until
 * what the brush draws measures as the teacher's drawing does); else mapped by hand from the table (`taught`).
 */
export interface TaughtTable { entries: Array<{ name: string; kind: string; obj: number; pts: number[][] }>; teachers: Record<string, number[]> }
export type TaughtClass = 'stroke' | 'wash' | 'body' | 'ground' | 'contact' | 'none';
export interface TaughtMatch { key: string; role: Role; object: number; cls: TaughtClass; entry: string | null; k: number }
export function taughtMap(groups: GroupInfo[], T: TaughtTable): TaughtMatch[] {
  const hasFaces = new Set(T.entries.filter((en) => en.kind === 'face').map((en) => en.obj));
  return groups.map((g) => {
    const out = (cls: TaughtClass, k = -1): TaughtMatch => ({ key: g.key, role: g.role, object: g.object, cls, entry: k >= 0 ? T.entries[k].name : null, k });
    if (g.role === 'ground') return out(g.key.endsWith('shadow') ? 'ground' : 'none');
    if (g.role === 'contact') return out('contact');
    const stroke = g.role === 'line' || g.role === 'edge';
    if (!stroke && !hasFaces.has(g.object)) return out('body');
    const ok = (k: string) => (stroke ? k === 'crease' || k === 'silhouette' || k.startsWith('line') : k === 'face');
    const pts = g.samples.length ? g.samples : [g.centre];
    let best = -1, bd = Infinity;
    T.entries.forEach((en, k) => {
      if (en.obj !== g.object || !ok(en.kind) || !en.pts.length) return;
      let sum = 0; for (const p of pts) { let m = Infinity; for (const q of en.pts) m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); sum += m; }
      if (sum < bd) { bd = sum; best = k; }
    });
    return out(stroke ? 'stroke' : 'wash', best >= 0 && bd / pts.length < 0.35 ? best : -1);
  });
}
/** mapped by hand from the table: the decision (ink along it, tone on it) as how much of the group is kept and how strongly */
export function taught(groups: GroupInfo[], T: TaughtTable, teacher: string): Treatment {
  const d = T.teachers[teacher] ?? Object.values(T.teachers)[0], e = new Float32Array(groups.length), s = new Float32Array(groups.length);
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const val = (k: number) => Math.max(0, d[k]), mean = (ks: number[]) => (ks.length ? ks.reduce((a, k) => a + val(k), 0) / ks.length : 0);
  const groundTone = mean(T.entries.map((en, k) => (en.kind.startsWith('ground') ? k : -1)).filter((k) => k >= 0));
  taughtMap(groups, T).forEach((m, i) => {
    const stroke = m.cls === 'stroke';
    const same = (kinds: (k: string) => boolean) => T.entries.map((en, k) => (en.obj === m.object && kinds(en.kind) && d[k] >= 0 ? k : -1)).filter((k) => k >= 0);
    const dec = m.cls === 'ground' ? groundTone * 2.2 : m.cls === 'contact' ? Math.min(1, groundTone * 3) : m.cls === 'none' || m.cls === 'body' ? 0
      : m.k >= 0 && d[m.k] >= 0 ? val(m.k) : mean(same(stroke ? (k) => k === 'crease' || k === 'silhouette' || k.startsWith('line') : (k) => k === 'face'));
    e[i] = stroke ? ss(0.1, 0.55, dec) : ss(0.02, 0.3, dec);
    s[i] = Math.max(0.7, Math.min(1.15, stroke ? 0.72 + 0.5 * dec : 0.72 + 1.1 * dec));
  });
  return { e, s };
}
/** a fitted treatment, by group key (taughtfit.ts): extent, strength, width, and how much interior edges show */
export interface TaughtFit { keys: string[]; e: number[]; s: number[]; w: number[]; inner: number[]; note?: string }
export function taughtFit(groups: GroupInfo[], fit: TaughtFit | undefined): Treatment | null {
  if (!fit) return null;
  const at = new Map(fit.keys.map((k, i) => [k, i]));
  const pick = (a: number[], d: number) => Float32Array.from(groups, (g) => { const i = at.get(g.key); return i === undefined ? d : a[i]; });
  return { e: pick(fit.e, 0), s: pick(fit.s, 1), w: pick(fit.w, 1), inner: pick(fit.inner, 0) };
}
