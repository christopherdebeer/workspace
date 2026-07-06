/**
 * Content hash — the proof-of-read `version` token (ADR-0066).
 *
 * A fact's `version` is a content hash of its value: an **unforgeable proof-of-read**
 * for `ifVersion` conditional writes. Unlike a `revision` counter (guessable — you can
 * supply `N+1` blind), a content hash cannot be produced without having read the value,
 * so requiring it as a write precondition makes the read a precondition of the write.
 * Restores the substrate ancestor's mechanic (`sync` — see `docs/ancestor/sync/`).
 *
 * 16 hex chars (8 bytes of SHA-256) — matching the ancestor. The hash is *persisted*
 * and compared persisted-to-supplied, so canonical serialization is not required for
 * correctness (the same stored value always hashes the same).
 */
import { createHash } from 'node:crypto';

export function contentHash(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}
