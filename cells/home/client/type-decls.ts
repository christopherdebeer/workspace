/**
 * Bootstrap type vocabulary — a last-resort fallback only.
 *
 * The CANONICAL type vocabulary lives in the registry: each managing cell
 * declares its types in `types.json` (doc→lit, note→starter, capture→input,
 * canvas→canvas, …), aggregated via `cells.describeTypes` → `$types`. Home reads
 * that — seeded server-side for SSR (see index.ts `buildBoot`/`types`) and via
 * `loadTypeDecls` on the client — and it WINS over this table. So cell-managed
 * types are NOT listed here; only `cell` (the platform pointer facts, owned by no
 * deployable cell) is. Surfaces stay apex-form (`/@owner/name…`); the consumer
 * localizes them per-origin via the kernel's `cellUrl` (home's `localize`).
 */
import type { TypeDecl } from '../shared/vocab';

export const DEFAULT_TYPE_DECLS: Record<string, TypeDecl> = {
  cell: {
    icon: '🧩',
    manager: 'platform',
    handlers: { open: [{ surface: '${value.address}' }], render: [{ hint: 'fields' }] },
  },
};
