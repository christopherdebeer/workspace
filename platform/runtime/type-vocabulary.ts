/**
 * buildTypeVocabulary (ADR-0044 Inc 2, closing ADR-0042 Inc 2) — the PURE core
 * of `$types`, extracted from the gateway so it stops being wire-only.
 *
 * The vocabulary is: canonical cell-declared types (each cell's `types.json`,
 * federated by `cells.describeTypes` onto the registry) merged per-facet under
 * the caller's `_types/<type>` slice overrides (ADR-0002/0010 — an override
 * that sets only `icon` must not drop the canonical handlers/schema), then each
 * type resolved once (`resolveType`) so consumers get `fields` + the normalised
 * `present` facet instead of re-deriving them.
 *
 * The WIRE half stays with each caller: the gateway assembles inputs from its
 * service clients; a cell's SSR assembles them from its own reads (the registry
 * types arrive via the cells service or a cached fact; slice overrides via
 * `createCellReader.list('_types/')`). This function is the single merge — one
 * resolver, N transports — so a cell no longer needs a gateway hop to resolve
 * how a fact of type T opens/renders (the last wire-only forcing function
 * ADR-0042 found behind hardcoded per-cell routing).
 */
import { mergeTypeDecl, resolveType } from './type-schema';

export interface SliceTypeOverride {
  /** The full fact key (`_types/<type>`) or the bare type name. */
  key: string;
  value: unknown;
}

export function buildTypeVocabulary(
  globalTypes: Record<string, unknown> | undefined,
  sliceOverrides: SliceTypeOverride[] | undefined,
): Record<string, unknown> {
  const types: Record<string, unknown> = { ...(globalTypes ?? {}) };
  for (const e of sliceOverrides ?? []) {
    if (!e?.key) continue;
    const t = e.key.startsWith('_types/') ? e.key.slice('_types/'.length) : e.key;
    if (!t) continue;
    types[t] = mergeTypeDecl(types[t], e.value);
  }
  // Additively attach the resolved `shape.fields` (ADR-0002) and `present` facet
  // (ADR-0012 — legacy `{icon,titlePath,href}` normalised once, here) so every
  // consumer gets one resolved shape. Flat keys retained (ADR-0014 row 3).
  for (const [t, decl] of Object.entries(types)) {
    const resolved = resolveType(decl, t);
    const extra: Record<string, unknown> = {};
    if (resolved.shape.fields) extra.fields = resolved.shape.fields;
    if (resolved.present.icon !== undefined || resolved.present.label !== undefined || resolved.present.render !== undefined) {
      extra.present = resolved.present;
    }
    if (Object.keys(extra).length) types[t] = { ...(decl as Record<string, unknown>), ...extra };
  }
  return types;
}
