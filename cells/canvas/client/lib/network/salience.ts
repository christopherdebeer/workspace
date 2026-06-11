/**
 * salience.ts — the presentation channel (canvas-substrate-design.md §4).
 *
 * Salience modulates presentation, never position: focus renders fully,
 * peripheral fades, elided collapses to a title chip at its pinned spot.
 * Tapping an elided chip is a deliberate `peek` — attention raises salience,
 * which un-elides it: looking at a thing brings it back into focus.
 * Board loads use `query` (no per-key read logging), so rendering never
 * inflates its own salience.
 */
import './salience.css';
import { read } from './substrate.ts';
import { salienceByKey } from './storage.ts';

const FOCUS = 0.5;
const ELIDE = 0.1;
const REFRESH_MS = 90_000;
const APPLY_MS = 5_000;

function titleOf(el: { content?: unknown }): string {
  const c = typeof el.content === 'string' ? el.content : '';
  const heading = c.match(/^#+\s*(.+)$/m)?.[1];
  const line = heading ?? c.split('\n').find((l) => l.trim()) ?? 'untitled';
  return line.replace(/[#*_`]/g, '').trim().slice(0, 36);
}

function apply(): void {
  const cc = (window as { CC?: any }).CC;
  if (!cc?.canvasState?.elements) return;
  const CHIP_W = 180;
  const CHIP_H = 44;
  let dirty = false;
  for (const el of cc.canvasState.elements) {
    const node: HTMLElement | undefined = cc.elementNodesMap?.[el.id];
    if (!node) continue;
    node.classList.toggle('synthesized', !!el._synthesized);
    const score = salienceByKey.get(`el:${el.id}`);
    if (score === undefined) continue;
    const expanded = node.dataset.expanded === 'true';
    const tier = expanded || score >= FOCUS ? 'focus' : score >= ELIDE ? 'peripheral' : 'elided';
    // Collapse is consensual: only the board's own proposals (synthesized,
    // unpinned) or explicitly flagged elements (elide:true) may chip. A
    // human-placed element is the human's pin — salience still shows (the
    // `faded` tier), but geometry is never altered without intent.
    const mayCollapse = !!el._synthesized || el.elide === true;
    if (tier === 'elided' && !mayCollapse) {
      if (el._origW !== undefined) {
        el.width = el._origW;
        el.height = el._origH;
        delete el._origW;
        delete el._origH;
        node.style.width = '';
        node.style.height = '';
        dirty = true;
      }
      node.dataset.salience = 'faded';
      continue;
    }
    if (tier === 'elided') {
      if (node.dataset.salience !== 'elided') node.dataset.chip = titleOf(el);
      // Edges must anchor on the CHIP, not the phantom full box: swap in
      // transient display dims (underscore fields never persist; the
      // persistence layer translates back to the true geometry).
      if (el._origW === undefined) {
        el._origW = el.width;
        el._origH = el.height;
        el.width = CHIP_W;
        el.height = CHIP_H;
        dirty = true;
      }
      // The node box collapses when .content hides (parcland sizes nodes by
      // content) — give it the chip's box explicitly so chip, box, and edge
      // anchors coincide.
      node.style.width = `${CHIP_W * (el.scale || 1)}px`;
      node.style.height = `${CHIP_H * (el.scale || 1)}px`;
    } else if (el._origW !== undefined) {
      el.width = el._origW;
      el.height = el._origH;
      delete el._origW;
      delete el._origH;
      node.style.width = '';
      node.style.height = '';
      dirty = true;
    }
    node.dataset.salience = tier;
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

  // Tapping an elided chip = deliberate attention: expand locally, peek to
  // log the read (raising real salience for every future observer).
  document.addEventListener(
    'pointerup',
    (ev) => {
      const node = (ev.target as Element | null)?.closest?.('.canvas-element[data-salience="elided"]') as HTMLElement | null;
      if (!node?.dataset.elId) return;
      node.dataset.expanded = 'true';
      node.dataset.salience = 'focus';
      const key = `el:${node.dataset.elId}`;
      salienceByKey.set(key, FOCUS);
      // Restore the true geometry right away so edges snap back with the value.
      const cc = (window as { CC?: any }).CC;
      const el = cc?.canvasState?.elements?.find((e: any) => e.id === node.dataset.elId);
      if (el && el._origW !== undefined) {
        el.width = el._origW;
        el.height = el._origH;
        delete el._origW;
        delete el._origH;
        node.style.width = '';
        node.style.height = '';
        cc.requestRender();
        cc.requestEdgeUpdate();
      }
      read('workspace.peek', { key }).catch(() => undefined);
    },
    true,
  );

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
