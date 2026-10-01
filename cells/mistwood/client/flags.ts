/**
 * The address's flags, all in one place: the only code that reads the query string.
 *
 * Every flag is declared here once — its kind, its range or values, what it does, its group, and
 * whether a change applies at once (`live`) or needs the wood made again (a reload). Code reads a
 * flag only through `flag('name')`, so a name that is not declared does not compile, and a value
 * outside its range or values is refused (with a warning) rather than half-used.
 *
 * The tuning overlay (`?tune`, tune.ts) is built from this list, so a new flag is in it as soon as
 * it is declared. `node cells/mistwood/check-flags.mjs` fails on a declared flag that nothing
 * reads, and on any other code reading the address directly; at run time, a parameter in the
 * address that is not declared is reported (console and overlay).
 */
import type { Species } from './tree';

interface Base {
  doc: string;
  group: 'wood' | 'stand' | 'sky' | 'deer' | 'render' | 'dev';
  /** read every frame: a change shows at once (otherwise the page reloads with it) */
  live?: boolean;
}
export type Spec =
  | (Base & { kind: 'number'; min: number; max: number; step: number; unit?: string })
  | (Base & { kind: 'enum'; values: readonly string[] })
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'text' });

const SPECIES: readonly Species[] = ['tall', 'leaner', 'birch', 'sapling', 'shrub'];

export const FLAGS = {
  // the wood
  seed: { kind: 'text', group: 'wood', doc: 'which wood (word-word-n); touch the name at the foot for another' },
  only: { kind: 'enum', values: SPECIES, group: 'wood', doc: 'every tree of one archetype (to study it)' },
  // where you stand
  at: { kind: 'number', min: -500, max: 500, step: 10, unit: 'm', group: 'stand', doc: 'start this far along (the nearest path there)' },
  look: { kind: 'number', min: -3.14, max: 3.14, step: 0.05, unit: 'rad', group: 'stand', doc: 'turn from the way you would face' },
  near: { kind: 'number', min: 0.5, max: 20, step: 0.5, unit: 'm', group: 'stand', doc: 'stand this far from the nearest tree, facing it' },
  find: { kind: 'enum', values: ['pond', 'log', 'veteran', 'glade'], group: 'stand', doc: 'stand by the nearest one, facing it' },
  off: { kind: 'number', min: 0, max: 40, step: 1, unit: 'm', group: 'stand', doc: 'how far off `find` stands you' },
  walk: { kind: 'bool', group: 'stand', live: true, doc: 'walk on by yourself' },
  // the light and the fog
  hour: { kind: 'number', min: 0, max: 24, step: 0.25, unit: 'h', group: 'sky', live: true, doc: 'time of day (default: your clock); it passes in real time' },
  moon: { kind: 'number', min: 0, max: 1, step: 0.01, group: 'sky', live: true, doc: "the moon's phase: 0 new, 0.5 full (default: tonight's)" },
  fog: { kind: 'number', min: 0.2, max: 3, step: 0.05, unit: '×', group: 'sky', live: true, doc: "fog thickness, times the wood's own" },
  warm: { kind: 'number', min: -1, max: 1, step: 0.05, group: 'sky', live: true, doc: 'tint the light cooler or warmer' },
  // deer
  deer: { kind: 'bool', group: 'deer', doc: 'a herd ahead of you at once' },
  deerAt: { kind: 'number', min: 5, max: 80, step: 1, unit: 'm', group: 'deer', doc: 'how far ahead `deer` puts them' },
  deerBed: { kind: 'bool', group: 'deer', doc: '`deer` lying up in cover rather than grazing' },
  deerCalm: { kind: 'bool', group: 'deer', live: true, doc: 'deer never take alarm (to watch them)' },
  // the drawing
  fixed: { kind: 'bool', group: 'render', doc: 'keep the resolution (no adapting to the frame rate)' },
  time: { kind: 'number', min: 0, max: 600, step: 1, unit: 's', group: 'render', doc: 'start the clock here (wind, mist, the deer)' },
  // development
  tune: { kind: 'bool', group: 'dev', doc: 'this panel' },
} as const satisfies Record<string, Spec>;

export type FlagName = keyof typeof FLAGS;
type ValueOf<S> = S extends { kind: 'number' } ? number : S extends { kind: 'bool' } ? boolean : S extends { values: readonly (infer V)[] } ? V : string;
export type FlagValue<N extends FlagName> = ValueOf<(typeof FLAGS)[N]>;

const query = new URLSearchParams(location.search);
const values = new Map<FlagName, unknown>();
const listeners = new Set<(name: FlagName) => void>();

function parse(name: FlagName, raw: string | null): unknown {
  const spec: Spec = FLAGS[name];
  if (raw === null) return spec.kind === 'bool' ? false : null;
  switch (spec.kind) {
    case 'bool':
      return raw !== '0' && raw !== 'false';
    case 'number': {
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) {
        console.warn(`mistwood: ?${name}=${raw} is not a number; ignored`);
        return null;
      }
      if (n < spec.min || n > spec.max) console.warn(`mistwood: ?${name}=${raw} is outside ${spec.min}…${spec.max}; held to it`);
      return Math.max(spec.min, Math.min(spec.max, n));
    }
    case 'enum':
      if (!spec.values.includes(raw)) {
        console.warn(`mistwood: ?${name}=${raw} is not one of ${spec.values.join(', ')}; ignored`);
        return null;
      }
      return raw;
    case 'text':
      return raw;
  }
}
for (const name of Object.keys(FLAGS) as FlagName[]) values.set(name, parse(name, query.get(name)));

/** A flag's value: a bool is false when absent; anything else is null when absent (or refused). */
export function flag<N extends FlagName>(name: N): (typeof FLAGS)[N] extends { kind: 'bool' } ? boolean : FlagValue<N> | null {
  return values.get(name) as never;
}

/** Set a flag (null clears it), keeping the address in step. Not live: the page is made again with it. */
export function setFlag<N extends FlagName>(name: N, value: FlagValue<N> | null, opts: { reload?: boolean } = {}) {
  const spec: Spec = FLAGS[name];
  const url = new URL(location.href);
  if (value === null || value === false) url.searchParams.delete(name);
  else url.searchParams.set(name, value === true ? '1' : String(value));
  values.set(name, parse(name, url.searchParams.get(name)));
  if (opts.reload ?? !spec.live) {
    location.href = url.toString();
    return;
  }
  history.replaceState(null, '', url);
  for (const l of listeners) l(name);
}

/** Hear of live changes (the overlay keeps itself in step). */
export function onFlag(l: (name: FlagName) => void) {
  listeners.add(l);
}

/** Parameters in the address that are not declared flags (orphans: a typo, or a flag since removed). */
export const unknownFlags: string[] = [...query.keys()].filter((k) => !(k in FLAGS));
if (unknownFlags.length) console.warn(`mistwood: unknown flag${unknownFlags.length > 1 ? 's' : ''} in the address: ${unknownFlags.join(', ')} (declared ones are in flags.ts)`);
