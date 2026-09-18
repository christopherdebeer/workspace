export type ProductionSubstrateModeName =
  | 'contact'
  | 'render'
  | 'shadow'
  | 'legacy'
  | 'off';

export interface ProductionSubstrateMode {
  name: ProductionSubstrateModeName;
  render: boolean;
  contact: boolean;
  shadow: boolean;
  rollback: boolean;
}

/**
 * Production cutover policy.
 *
 * Canonical vehicle contact is the ordinary path. Rendering remains guarded
 * until production-world visual review is complete. Legacy contact is retained
 * as an explicit rollback that keeps shadow diagnostics alive.
 */
export function resolveProductionSubstrateMode(
  requested: string | null | undefined,
): ProductionSubstrateMode {
  switch (requested) {
    case 'render':
      return { name: 'render', render: true, contact: true, shadow: true, rollback: false };
    case 'shadow':
      return { name: 'shadow', render: false, contact: false, shadow: true, rollback: false };
    case 'legacy':
      return { name: 'legacy', render: false, contact: false, shadow: true, rollback: true };
    case 'off':
      return { name: 'off', render: false, contact: false, shadow: false, rollback: true };
    case 'contact':
    default:
      return { name: 'contact', render: false, contact: true, shadow: true, rollback: false };
  }
}
