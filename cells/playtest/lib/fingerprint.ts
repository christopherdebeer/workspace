/* ---------------------------------------------------------------------------
 * Engine fingerprint — which engine produced a run, computed from the code
 * itself, so improving a mechanic changes the version with no manual bump.
 *
 * Every registered mechanic's hook functions are stringified (the deployed,
 * bundled source) and hashed per mechanic; the engine version is the hash of
 * those plus the core entry points. Two evals on different fingerprints can
 * then be diffed down to the mechanics that changed between them.
 * ------------------------------------------------------------------------- */
import { createHash } from 'node:crypto';
import { mechanicRegistry } from '../engine/mechanics/index';
import { initGame, startGame, getAvailableActions, validateAction, executeAction, advanceTurn, checkAllWinConditions } from '../engine/core/game';

/** Bump when HOW the fingerprint is computed changes: every hash moves with no mechanic edited,
 *  and the change log says so instead of listing every mechanic as changed.
 *  1: raw bundled source · 2: bundler digit-suffix renames stripped. */
export const FP_METHOD = 2;

export interface EngineFingerprint {
  version: string;
  method: number;
  mechanics: Record<string, string>;
  core: string;
}

/* The source is read from the deployed bundle, where the bundler renames an identifier
 * that collides with another module's by appending digits (readFileSync → readFileSync2).
 * Any unrelated module added to the cell can shift those suffixes, so they are dropped
 * before hashing — otherwise a deploy that touches no engine code orphans every baseline. */
const normalize = (src: string) => src.replace(/\b([A-Za-z_$][A-Za-z_$]*?)\d+\b/g, '$1');
const h = (s: string) => createHash('sha256').update(normalize(s)).digest('hex').slice(0, 12);

/* Only code and static declarations: a mechanic object may also carry state it
 * mutates during play, which would make the fingerprint drift between warm Lambdas. */
const STATIC_KEYS = new Set(['slug', 'name', 'alwaysEnabled', 'requires', 'dependencies', 'conflicts', 'defines', 'configSchema']);
function hashObject(o: Record<string, unknown>): string {
  const parts = Object.keys(o)
    .sort()
    .filter((k) => typeof o[k] === 'function' || STATIC_KEYS.has(k))
    .map((k) => {
      const v = o[k];
      if (typeof v === 'function') return `${k}=${v.toString()}`;
      return `${k}=${JSON.stringify(v)}`;
    });
  return h(parts.join('\n'));
}

let cached: EngineFingerprint | null = null;

export function engineFingerprint(): EngineFingerprint {
  if (cached) return cached;
  const mechanics: Record<string, string> = {};
  for (const slug of mechanicRegistry.getRegisteredSlugs().sort()) {
    const m = mechanicRegistry.getMechanic(slug);
    if (m) mechanics[slug] = hashObject(m as unknown as Record<string, unknown>);
  }
  const core = h([initGame, startGame, getAvailableActions, validateAction, executeAction, advanceTurn, checkAllWinConditions].map((f) => f.toString()).join('\n'));
  const version = h(core + JSON.stringify(mechanics));
  cached = { version, method: FP_METHOD, mechanics, core };
  return cached;
}

/** Mechanics whose code differs between two fingerprints (added/removed included). */
export function changedMechanics(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}
