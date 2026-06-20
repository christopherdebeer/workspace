/**
 * Resolution (ADR-0010) — the layered per-facet merge, named once.
 *
 * The read side has two mechanisms: **Projection** (facts + rules → the derived view)
 * and **Resolution** (an ordered stack of partial layers → one effective value, facet
 * by facet, most-specific wins). Resolution shows up wherever a value is "defaults,
 * then overrides": the Type vocabulary (canonical ← slice `_types/<T>`), the Reference
 * rules (canonical `typeRules` ← slice rules), and salience parameters (defaults ←
 * `_config/salience` ← lens ← per-call). The first two are *object* merges and share
 * this resolver; the salience one is a numeric merge (it clamps + re-derives) and the
 * grant one is a *union* — both documented as Resolution, not forced through here.
 *
 * `undefined` means "this layer is silent about that facet" — it never clobbers an
 * earlier layer's value. (That is precisely the bug ADR-0002 fixed: a wholesale merge
 * let a slice that overrode only `icon` drop the canonical `handlers`.)
 */
export function layer<T extends object>(...parts: Array<Partial<T> | undefined | null>): T {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) {
      if (v !== undefined) out[k] = v; // a silent facet (undefined) does not override
    }
  }
  return out as T;
}
