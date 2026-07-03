/**
 * salience.ts — the presentation channel (canvas-substrate-design.md §4, revised).
 *
 * Salience is a **positive marker**, never a subtraction: a board shows every
 * fact its query includes, at full fidelity, and *badges* the most salient
 * ones. It never dims, never omits, never alters geometry. (Earlier this faded
 * the peripheral and collapsed the elided to title chips; that hid content the
 * query had chosen to include, so it's gone.) Board loads use `query` (no
 * per-key read logging), so rendering never inflates its own salience.
 */
import './salience.css';
import { read } from './substrate.ts';
import { salienceByKey } from './storage.ts';

const REFRESH_MS = 90_000;
const APPLY_MS = 5_000;
// "Highest salience" is relative to the board: badge items within this fraction
// of the board's top score (so a board's hot items stand out even when absolute
// scores cluster low), and only when something is meaningfully salient at all.
const TOP_FRACTION = 0.7;
const MIN_MAX = 0.05;

function apply(): void {
  const cc = (window as { CC?: any }).CC;
  if (!cc?.canvasState?.elements) return;
  const els = cc.canvasState.elements;
  // A fact's salience is keyed by its REAL key (_factKey) — imported facts
  // aren't `el:<id>`, and looking them up that way left them badge-less.
  const keyOf = (el: any): string => (typeof el._factKey === 'string' ? el._factKey : `el:${el.id}`);
  let max = 0;
  for (const el of els) max = Math.max(max, salienceByKey.get(keyOf(el)) ?? 0);
  const threshold = max * TOP_FRACTION;
  let dirty = false;
  for (const el of els) {
    const node: HTMLElement | undefined = cc.elementNodesMap?.[el.id];
    if (!node) continue;
    node.classList.toggle('synthesized', !!el._synthesized);
    // Undo any geometry the old elide model collapsed, so nothing the query
    // included stays omitted (a one-time migration on first render).
    if (el._origW !== undefined) {
      el.width = el._origW;
      el.height = el._origH;
      delete el._origW;
      delete el._origH;
      node.style.width = '';
      node.style.height = '';
      delete node.dataset.chip;
      dirty = true;
    }
    const score = salienceByKey.get(keyOf(el)) ?? 0;
    if (max > MIN_MAX && score > 0 && score >= threshold) node.dataset.salience = 'high';
    else delete node.dataset.salience;
  }
  if (dirty) {
    cc.requestRender();
    cc.requestEdgeUpdate();
  }
}

let started = false;

export function startSalience(canvasId: string): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Window resize moves the screen-space projection out from under the
  // canvas-space SVG edges — recompute transform + edges when it settles.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const cc = (window as { CC?: any }).CC;
      if (!cc) return;
      cc.updateCanvasTransform();
      cc.requestRender();
      cc.requestEdgeUpdate();
    }, 120);
  });

  const refresh = async (): Promise<void> => {
    try {
      const res = await read<{ entries: Array<{ key: string; _meta?: { score?: number } }> }>(
        'workspace.query',
        { tag: `canvas:${canvasId}` },
      );
      for (const e of res.entries ?? []) {
        if (typeof e._meta?.score === 'number') salienceByKey.set(e.key, e._meta.score);
      }
    } catch {
      /* offline — keep the last scores */
    }
    apply();
  };

  setTimeout(apply, 1500);
  setInterval(apply, APPLY_MS);
  setInterval(refresh, REFRESH_MS);
}
