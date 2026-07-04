/* ---------------------------------------------------------------------------
 *  selectionInspector.ts — element + group context in the consolidated sheet.
 *
 *  The cmd-context panel is one surface at three heights (the detented-sheet
 *  model). For elements/groups:
 *    - peek : identity + the two affordances the palette DOESN'T duplicate —
 *             Edit (the rich editor) and More (the full action list). The common
 *             commands (frame/duplicate/delete/group) are shown only as a muted
 *             hint row, since they're already first-class palette commands.
 *    - half : the full element action list + Appearance (what used to be the
 *             floating context menu), hosted inline. Reached via More or a
 *             long-press / type-handle (which now route here, retiring the
 *             floating menu — Phase 1 of the unified sheet).
 *
 *  Selection arrives via parc:selection-changed (deduped by id-set). Panel
 *  ownership ('selection') keeps edge/frame editors from being stomped.
 * ------------------------------------------------------------------------- */
import { showInspector, clearInspector, inspectorOwner } from './inspectorPanel.ts';
import { buildElementActions } from '../context-menu.ts';
import { duplicateEl, deleteSelection, inlineEdit, groupSelection } from '../cmd-palette/menu-item-helpers.ts';
import { createFrame } from './frameNav.ts';

const cc = (): any => (window as { CC?: any }).CC;

type Detent = 'peek' | 'half';
let lastSig = '';
let detent: Detent = 'peek';
let currentIds: string[] = [];

function identity(el: any): { icon: string; title: string } {
  const icon = (el?._factIcon as string) ?? '';
  const title = (el?._factTitle as string)
    ?? (typeof el?.content === 'string' && el.content.trim() ? el.content.split('\n')[0].slice(0, 40) : (el?.type ?? 'element'));
  return { icon, title };
}

/** A header bar: optional ‹ Back (collapse a detent) + a right-aligned Deselect
 *  (the close action is really a deselect — user feedback). */
function headerBar(title: string, onDeselect: () => void, onBack?: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  if (onBack) {
    const back = document.createElement('button');
    back.innerHTML = '‹';
    back.title = 'Back';
    back.style.cssText = 'border:0;background:transparent;color:#85795f;font:600 18px/1 inherit;cursor:pointer;padding:0 4px';
    back.addEventListener('click', onBack);
    bar.appendChild(back);
  }
  const t = document.createElement('strong');
  t.textContent = title;
  t.style.cssText = 'font-family:Georgia,serif;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  bar.appendChild(t);
  const x = document.createElement('button');
  x.textContent = 'Deselect';
  x.style.cssText = 'border:0;background:transparent;color:#85795f;font:inherit;cursor:pointer;padding:4px 6px';
  x.addEventListener('click', onDeselect);
  bar.appendChild(x);
  return bar;
}

function primaryBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = 'pc-btn';
  b.addEventListener('click', onClick);
  return b;
}

/** A ghost (outline) action — tappable but lower-emphasis than the primary. The
 *  bottom sheet is the TOUCH action surface (palette commands are keyboard-first),
 *  so these are real buttons, not muted hints pointing back at the palette. */
function ghostBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = 'pc-btn-ghost';
  b.addEventListener('click', onClick);
  return b;
}

/** A wrapping row of action buttons — the sheet's toolbar. */
function toolbar(buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  buttons.forEach((b) => row.appendChild(b));
  return row;
}

function openEdit(c: any, id: string): void {
  const el = c.findElementById?.(id);
  if (el) void c.openEditModal?.(el);
}

function renderPeekSingle(c: any, id: string): void {
  const el = c.findElementById?.(id);
  if (!el) { clearInspector('selection'); return; }
  const { icon, title } = identity(el);
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;gap:10px';
  body.appendChild(headerBar(`${icon ? icon + ' ' : ''}${title}`, () => c.clearSelection?.()));
  body.appendChild(toolbar([
    primaryBtn('Edit', () => openEdit(c, id)),
    ghostBtn('Frame', () => void createFrame(c)),
    ghostBtn('Duplicate', () => duplicateEl(c, id)),
    ghostBtn('Delete', () => deleteSelection(c)),
    ghostBtn('More ⌄', () => { detent = 'half'; render(); }),
  ]));
  showInspector(body, 'selection');
}

function renderPeekGroup(c: any, count: number): void {
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;gap:10px';
  body.appendChild(headerBar(`${count} selected`, () => c.clearSelection?.()));
  body.appendChild(toolbar([
    primaryBtn('Group', () => groupSelection(c)),
    ghostBtn('Frame', () => void createFrame(c)),
    ghostBtn('Delete', () => deleteSelection(c)),
    ghostBtn('More ⌄', () => { detent = 'half'; render(); }),
  ]));
  showInspector(body, 'selection');
}

function renderHalf(c: any, id: string): void {
  const el = c.findElementById?.(id);
  if (!el) { detent = 'peek'; render(); return; }
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;gap:4px';
  body.appendChild(headerBar('Actions', () => c.clearSelection?.(), () => { detent = 'peek'; render(); }));
  body.appendChild(buildElementActions(el, c, () => { detent = 'peek'; render(); }));
  showInspector(body, 'selection');
}

function render(): void {
  const c = cc();
  if (!c) return;
  const ids = currentIds;
  if (!ids.length) { clearInspector('selection'); return; }
  if (ids.length === 1) {
    detent === 'half' ? renderHalf(c, ids[0]) : renderPeekSingle(c, ids[0]);
  } else {
    detent === 'half' ? renderHalf(c, ids[0]) : renderPeekGroup(c, ids.length);
  }
}

/** Install the element/group inspector: re-render on selection change (deduped),
 *  and open the actions (half) detent on long-press / type-handle. */
export function installSelectionInspector(): void {
  window.addEventListener('parc:selection-changed', (ev) => {
    const ids: string[] = (ev as CustomEvent<{ ids: string[] }>).detail?.ids ?? [];
    const sig = ids.slice().sort().join(',');
    if (sig === lastSig) return; // unchanged selection (e.g. a pan/render) — skip
    lastSig = sig;
    currentIds = ids;
    detent = 'peek'; // a new selection always opens at peek
    render();
  });

  // Long-press / type-handle now open the full actions inline (retiring the
  // floating context menu) — select if needed, then go straight to half.
  window.addEventListener('parc:element-actions', (ev) => {
    const id = (ev as CustomEvent<{ id: string }>).detail?.id;
    if (!id) return;
    const c = cc();
    if (!c) return;
    if (!c.selectedElementIds?.has?.(id)) c.selectElement?.(id);
    currentIds = [...(c.selectedElementIds ?? [id])];
    lastSig = currentIds.slice().sort().join(',');
    detent = 'half';
    render();
  });

  // When the full-detent editor closes, re-render the strip behind it (at peek).
  window.addEventListener('parc:editor-closed', () => { detent = 'peek'; render(); });

  // If an edge/frame editor takes over, drop our memo so re-selecting the same
  // element re-renders rather than being deduped away.
  for (const e of ['parc:edge-tap', 'parc:frame-tap'] as const) {
    window.addEventListener(e, () => { if (inspectorOwner() !== 'selection') lastSig = ' '; });
  }
  console.info('[canvas] selection inspector installed');
}
