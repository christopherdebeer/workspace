/**
 * The lab's server-side probes, in one place: each a deterministic trial on Squishy's own generator and
 * physics (no second model), run on request and answered as JSON. They're how an agent that works only
 * through the cell measures something, since `devtools/` never reaches the cell.
 *
 * One route serves them all: `/_probe` lists them; `/_probe/<name>/<arg>/<arg>…` runs one. To add a probe,
 * add an entry here (its arguments parsed and capped in `run`), not a route in index.ts.
 */
import { studyOne, studyVariants } from './spatial';
import { validateFork } from './physics-study';
import { jarStrainProbe } from './jar-strain';
import { bodyRegression } from './body-regress';
import { bench, buildLevel } from '../squishy/course';
import { levelMesh, VSTRIDE } from '../squishy/mesh';
import { MAT } from '../squishy/level';

type Variant = 'parallel' | 'convergent' | 'offset';
const VARIANTS: Variant[] = ['parallel', 'convergent', 'offset'];
const int = (v: string | undefined, lo: number, hi: number, dflt: number) => Math.max(lo, Math.min(hi, Number(v) || dflt));

export interface Probe { args: string; about: string; run: (a: string[]) => unknown }

export const PROBES: Record<string, Probe> = {
  spatial: {
    args: '<level 1–30> <seed> [parallel|convergent|offset]',
    about: 'the generator\'s spatial study of a level: its composition variants, or one',
    run: (a) => {
      const level = int(a[0], 1, 30, 6), seed = int(a[1], 0, 100000, 0), v = a[2] as Variant;
      return VARIANTS.includes(v) ? studyOne(level, seed, v) : studyVariants(level, seed);
    },
  },
  fork: {
    args: '<level 1–30> <seed> [variant] [exit index]',
    about: 'a generated fork, checked by simulation from each of its exits',
    run: (a) => validateFork(int(a[0], 1, 30, 7), int(a[1], 0, 100000, 0), VARIANTS.includes(a[2] as Variant) ? a[2] as Variant : 'parallel', a[3] !== undefined ? Number(a[3]) : -1),
  },
  'jar-strain': {
    args: '<hang|glance> [frames ≤140] [nostrain]',
    about: 'dough against the still life\'s honey jar: how far it stretches, how it holds',
    run: (a) => { const t0 = Date.now(); return { ...jarStrainProbe(a[0] === 'glance' ? 'glance' : 'hang', a[1] ? int(a[1], 1, 140, 1) : undefined, a[2] !== 'nostrain'), elapsedMs: Date.now() - t0 }; },
  },
  body: {
    args: '<edge|free> [frames ≤100] [nostrain] [jelly]',
    about: 'a body flicked off a plate\'s edge, or through the air: its edges\' stretch, its volume',
    run: (a) => bodyRegression(a[0] === 'edge' ? 'edge' : 'free', int(a[1], 1, 100, 40), a[2] !== 'nostrain', a[3] === 'jelly' ? 'jelly' : 'dough'),
  },
  optics: {
    args: '<look|coats|level 1–30> [seed]',
    about: 'a level\'s drawn layers (solid, glass, films, jar honey, bubbles): all finite, and what\'s in each',
    run: (a) => {
      const scene = a[0] === 'coats' || a[0] === 'look' ? a[0] : '';
      const lv = scene ? bench(scene) : buildLevel(int(a[0], 1, 30, 13), int(a[1], 0, 100000, 0));
      const mesh = levelMesh(lv);
      const layers = { solid: mesh.solid, glass: mesh.glass, liquid: mesh.liquids, fill: mesh.honeyBodies.flatMap((h) => h.verts), bubbles: mesh.bubbles.flatMap((b) => b.verts) };
      const checks = Object.entries(layers).map(([name, data]) => {
        let invalid = 0, first = -1, smear = 0, honey = 0;
        for (let i = 0; i < data.length; i++) {
          if (!Number.isFinite(data[i])) { invalid++; if (first < 0) first = i; }
          if (i % VSTRIDE === 6) { if (Math.round(data[i]) === MAT.smear) smear++; if (Math.round(data[i]) === MAT.honey) honey++; }
        }
        return { name, vertices: data.length / VSTRIDE, invalid, first, smearVertices: smear, honeyVertices: honey };
      });
      return { scene: scene || lv.n, stops: lv.towers.length, jars: mesh.honeyBodies.map((h) => ({ radius: h.radius, bottom: h.bottom, top: h.top })), checks, finite: checks.every((k) => k.invalid === 0) };
    },
  },
};

/** `/_probe` and `/_probe/<name>/…`: the list, or one run; null for any other path. */
export function probe(path: string): { status: number; body: unknown } | null {
  if (path !== '/_probe' && !path.startsWith('/_probe/')) return null;
  const [, , name, ...args] = path.split('/');
  if (!name) return { status: 200, body: Object.fromEntries(Object.entries(PROBES).map(([k, p]) => [k, `/_probe/${k}/${p.args} — ${p.about}`])) };
  const p = PROBES[name];
  if (!p) return { status: 404, body: { error: `no probe ${name}`, probes: Object.keys(PROBES) } };
  return { status: 200, body: p.run(args) };
}
