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
 * THE SUBSTRATE OWNS THE PICTURE ON AN ORDINARY URL. It has been the contact
 * authority for some time — `surfaceAt`, `waterInfoAt`, `splashWet` and
 * `tyreHeight` all read it — and the render half stayed behind a flag pending
 * a visual review. That review is what the gates below are: every terrain,
 * carriageway, structure, batter and hydro packet has to be COMMITTED by the
 * tile that owns it before anything of it is drawn, so a tile's picture
 * changes in one atomic revision rather than piece by piece, which is the
 * whole reason the render path exists. The four render suites are green on
 * the default now (`substrate-render`, `hydro-render-cutover`,
 * `substrate-batter-render`, and `substrate-structure-render` bar one failure
 * that `MODE=contact` reproduces to the digit and is therefore the world's
 * terrain rather than this path's).
 *
 * WHAT A HARNESS CANNOT REVIEW IS WHAT IT LOOKS LIKE FROM THE SEAT, and that
 * is stated rather than implied: these suites assert ownership, commitment and
 * identity, and the frames they take are of fixtures. `?substrate=contact` is
 * the rollback and keeps the legacy owners drawing with the substrate still
 * answering the wheels; `legacy` goes further back, to the pre-substrate
 * contact with shadow diagnostics alive.
 */
export function resolveProductionSubstrateMode(
  requested: string | null | undefined,
): ProductionSubstrateMode {
  switch (requested) {
    case 'shadow':
      return { name: 'shadow', render: false, contact: false, shadow: true, rollback: false };
    case 'legacy':
      return { name: 'legacy', render: false, contact: false, shadow: true, rollback: true };
    case 'off':
      return { name: 'off', render: false, contact: false, shadow: false, rollback: true };
    case 'contact':
      return { name: 'contact', render: false, contact: true, shadow: true, rollback: false };
    case 'render':
    default:
      return { name: 'render', render: true, contact: true, shadow: true, rollback: false };
  }
}
