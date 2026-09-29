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

export interface EngineFingerprint {
  version: string;
  mechanics: Record<string, string>;
  core: string;
}

const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

function hashObject(o: Record<string, unknown>): string {
  const parts = Object.keys(o)
    .sort()
    .map((k) => {
      const v = o[k];
      if (typeof v === 'function') return `${k}=${v.toString()}`;
      if (v && typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
      return `${k}=${String(v)}`;
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
  cached = { version, mechanics, core };
  return cached;
}

/** Mechanics whose code differs between two fingerprints (added/removed included). */
export function changedMechanics(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}
