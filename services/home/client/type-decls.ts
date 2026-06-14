/**
 * Default type vocabulary — parc.land's conventions, as data.
 *
 * These encode the cell↔type couplings that were hardcoded in home's
 * `factHref` (doc→lit, capture→input/lit, cell→its address, canvas→canvas) as
 * declarations the resolver reads. Substrate `_types/<type>` facts override
 * any of these per-type (and a cell can declare canonical ones on deploy — see
 * docs/type-vocabulary.md). The hardcoded routing becomes a small, overridable
 * table; the imperative branching is gone.
 */
import type { TypeDecl } from '../../../platform/ui/vocab';

export const DEFAULT_TYPE_DECLS: Record<string, TypeDecl> = {
  doc: {
    icon: '📄',
    manager: '@c15r/lit',
    handlers: { open: [{ surface: '/@c15r/lit?doc=${match}' }] },
  },
  // Captures (type) and the inbox/ key-prefix both open the day-log in lit
  // when they carry a capture date, else the input cell.
  capture: {
    icon: '📥',
    manager: '@c15r/input',
    handlers: {
      open: [{ surface: '/@c15r/lit?doc=log:${value.captured}' }, { surface: '/@c15r/input' }],
    },
  },
  inbox: {
    icon: '📥',
    manager: '@c15r/input',
    handlers: {
      open: [{ surface: '/@c15r/lit?doc=log:${value.captured}' }, { surface: '/@c15r/input' }],
    },
  },
  cell: {
    icon: '🧩',
    manager: 'platform',
    handlers: { open: [{ surface: '${value.address}' }] },
  },
  canvas: {
    icon: '🌲',
    manager: '@c15r/canvas',
    handlers: { open: [{ surface: '/@c15r/canvas?canvas=${match}' }] },
  },
};
