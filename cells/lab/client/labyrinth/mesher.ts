/**
 * The mesh worked out off the page's thread: a copy of the world kept in a worker, made from the page's operations and
 * history each time it's asked (model.ts `mirror`: built the same as the page's), and meshed (mesh.ts). The page goes on
 * drawing, and answering the finger, while it works; what it built is sent back as it is, its ground and strokes only
 * when they're not what was sent last.
 *
 * The same bundle as the page's, loaded as a module worker with `?worker=labyrinth` (client/main.ts).
 */
import { World, type Op } from './model';
import { STRIDE, buildMesh, setBleed, type Mesh } from './mesh';
import { STROKE_STRIDE } from './strokes';

/** what the page asks: the world (as its operations and history), how it's drawn, and what's selected */
export interface Job {
  id: number; seed: number; landSeed: number; bay: number; ladder: boolean;
  ops: Op[]; hist: ReturnType<World['history']>; plain: boolean; sel: number[]; keepGround: boolean; bleed: boolean; plan: number;
  /** the page's settings the drawing reads (`?region=`, `?ladder=`, `?rung=`: regions.ts, ladder.ts) */
  globals: Record<string, unknown>;
}
/** what it answers: the mesh, its ground and strokes left out (null) when they're what it sent last */
export interface Done { id: number; data: Float32Array; count: number; ground: Float32Array | null | undefined; strokes: Float32Array | null; ms: number }

/** what's drawn squeezed in plan, its storeys as tall as they were (main.ts `plan`): a world on the half grid seen in
 * its own proportions. The ground and strokes squeezed once for each build of them, so a kept one is still the same */
const squeezed = new WeakMap<Float32Array, { plan: number; out: Float32Array }>();
export function squeeze(m: Mesh, planScale: number): Mesh {
  if (planScale === 1) return m;
  const mesh = (a: Float32Array, n: number) => { const o = a.slice(); for (let q = 0; q < n; q++) { const b = q * STRIDE; o[b] *= planScale; o[b + 2] *= planScale; const nx = o[b + 3] / planScale, nz = o[b + 5] / planScale, l = Math.hypot(nx, o[b + 4], nz) || 1; o[b + 3] = nx / l; o[b + 4] /= l; o[b + 5] = nz / l; } return o; };
  const once = (a: Float32Array, f: (a: Float32Array) => Float32Array) => { const had = squeezed.get(a); if (had && had.plan === planScale) return had.out; const out = f(a); squeezed.set(a, { plan: planScale, out }); return out; };
  const strokes = once(m.strokes, (s) => { const st = s.slice(); for (let q = 0; q < st.length; q += STROKE_STRIDE) { st[q] *= planScale; st[q + 2] *= planScale; st[q + 3] *= planScale; st[q + 5] *= planScale; } return st; });
  return { ...m, data: mesh(m.data, m.count), ground: m.ground ? once(m.ground, (g) => mesh(g, g.length / STRIDE)) : m.ground, strokes };
}

/** the worker's side: answer each job, the last asked first (the page asks again only once it's answered) */
export function serve() {
  let world: World | null = null, head = '', sentGround: Float32Array | undefined, sentStrokes: Float32Array | undefined;
  self.onmessage = (e: MessageEvent<Job>) => {
    const j = e.data, t0 = performance.now(), h = `${j.seed}|${j.landSeed}|${j.bay}|${j.ladder}`;
    if (!world || h !== head) { world = new World(j.seed, j.landSeed, j.bay); world.ladder = j.ladder; head = h; sentGround = sentStrokes = undefined; }
    Object.assign(globalThis, j.globals);
    world.mirror(j.ops, j.hist);
    setBleed(j.bleed);
    const m = squeeze(buildMesh(world, j.plain, new Set(j.sel), j.keepGround), j.plan);
    const ground = m.ground === sentGround ? null : m.ground, strokes = m.strokes === sentStrokes ? null : m.strokes;
    sentGround = m.ground; sentStrokes = m.strokes;
    const done: Done = { id: j.id, data: m.data, count: m.count, ground: ground ? ground.slice() : ground, strokes: strokes ? strokes.slice() : null, ms: performance.now() - t0 };
    // (the vertices handed over, not copied; the ground and strokes copied first, since they're kept here to be compared)
    const moved: Transferable[] = [done.data.buffer];
    if (done.ground) moved.push(done.ground.buffer);
    if (done.strokes) moved.push(done.strokes.buffer);
    (self as unknown as Worker).postMessage(done, moved);
  };
}
