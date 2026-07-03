/* ──────────────────────────────────────────────────────────────────────────────
 *  menu item helper functions for parc.land            (2025-04-29)
 * ──────────────────────────────────────────────────────────────────────────── */
import { saveCanvas } from '../network/storage.ts';
import { generateContent } from '../network/generation.ts';
import { uid } from '../uid.ts';
import { fitRegion } from '../../../shared/frame.ts';
import type { CanvasElement } from '../../types';

/* internal clipboard — page-lifetime only */
const _clip: { elements: CanvasElement[] | null } = { elements: null };

/**
 * Add a fresh element centred on screen
 * @param c - Canvas controller
 * @param type - Element type
 * @param content - Initial content
 */
export function addEl(c: any, type: string, content = ''): void {
  const { innerWidth: W, innerHeight: H } = window;
  const pt = c.screenToCanvas(W / 2, H / 2);
  c.createNewElement(pt.x, pt.y, type, content);
}

/* ─── duplicate / delete ─────────────────────────────────────────────────── */

export function duplicateEl(c: any, id: string): void {
  const el = c.findElementById(id);
  if (!el) return;
  const dup: CanvasElement = { ...el, id: uid('el'), x: el.x + 20, y: el.y + 20 };
  // The copy is a NEW fact. Client transients — above all `_factKey` — must
  // not ride along: factKeyOf(dup) would resolve to the ORIGINAL's substrate
  // key, and the duplicate's writes would silently overwrite the source fact.
  for (const k of Object.keys(dup)) {
    if (k.startsWith('_')) delete (dup as Record<string, unknown>)[k];
  }
  c.canvasState.elements.push(dup);
  c.selectElement(dup.id);
  c.requestRender();
  saveCanvas(c.canvasState);
  c._pushHistorySnapshot?.('duplicate');
}

export function deleteSelection(c: any): void {
  if (!c.selectedElementIds.size) return;
  const count = c.selectedElementIds.size;
  const keep = (el: CanvasElement | { id: string }): boolean => !c.selectedElementIds.has(el.id);
  /* drop elements */
  c.canvasState.elements = c.canvasState.elements.filter(keep);
  /* drop edges referencing deleted elements */
  c.canvasState.edges =
    c.canvasState.edges.filter(e => keep({ id: e.source }) && keep({ id: e.target }));
  c.clearSelection();
  c.requestRender();
  saveCanvas(c.canvasState);
  // Delete is the one action users most need to take back — snapshot it
  // (it was the only mutation with NO undo path) and offer undo in place.
  c._pushHistorySnapshot?.('delete');
  undoToast(c, count === 1 ? 'Deleted 1 item' : `Deleted ${count} items`);
}

/** A transient bottom toast with an Undo affordance — touch users have no ⌘Z. */
function undoToast(c: any, message: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById('undo-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'undo-toast';
  t.setAttribute('style',
    'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:9600;' +
    'display:flex;gap:12px;align-items:center;background:rgba(28,28,26,.94);color:#fbfbf8;' +
    'font:13px/1.2 -apple-system,system-ui,sans-serif;padding:9px 12px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.3)');
  const msg = document.createElement('span');
  msg.textContent = message;
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.setAttribute('style', 'border:0;background:transparent;color:#8fd0a9;font:600 13px/1 inherit;cursor:pointer;padding:2px 4px');
  undo.addEventListener('click', () => { c.undo?.(); t.remove(); });
  t.appendChild(msg);
  t.appendChild(undo);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

/* ─── clipboard helpers ──────────────────────────────────────────────────── */

export function copySelection(c: any): void {
  if (!c.selectedElementIds.size) return;
  const els: CanvasElement[] = c.canvasState.elements
    .filter((el: CanvasElement) => c.selectedElementIds.has(el.id))
    .map((el: CanvasElement) => ({ ...el }));                               // deepish clone
  try { navigator.clipboard?.writeText(JSON.stringify(els)); } catch { }
  _clip.elements = els;
}

export function clipboardHasContent(): boolean {
  return Array.isArray(_clip.elements) && _clip.elements.length > 0;
}

export async function pasteClipboard(c: any): Promise<void> {
  if (!clipboardHasContent()) return;
  /* offset new items a bit */
  const pastedEls: CanvasElement[] = _clip.elements!.map((el: CanvasElement) => {
    const nu: CanvasElement = { ...el, id: uid('el'), x: el.x + 30, y: el.y + 30 };
    // New facts, not aliases of the copied ones (see duplicateEl).
    for (const k of Object.keys(nu)) {
      if (k.startsWith('_')) delete (nu as Record<string, unknown>)[k];
    }
    return nu;
  });
  c.canvasState.elements.push(...pastedEls);
  // Select through the controller's path, not a raw Set assignment — the
  // group box, CRDT selection and the sheet all hang off it.
  c.selectedElementIds.clear();
  pastedEls.forEach((e: CanvasElement) => c.selectedElementIds.add(e.id));
  c.crdt?.updateSelection?.(c.selectedElementIds);
  c.updateGroupBox?.();
  c.requestRender();
  saveCanvas(c.canvasState);
  c._pushHistorySnapshot?.('paste');
}

/* ─── AI regenerate (non-image elements only) ─────────────────────────────── */

export async function generateNew(c: any): Promise<void> {
  if (c.selectedElementIds.size !== 1) return;
  const id = [...c.selectedElementIds][0];
  const el = c.findElementById(id);
  if (!el || el.type === 'img') return;
  const newContent = await generateContent(el.content, el, c);
  if (newContent) {
    el.content = newContent;
    c.updateElementNode(c.elementNodesMap[id], el, true);
    saveCanvas(c.canvasState);
  }
  // Transformer discipline: the output is linked to its source.
  try {
    const src = [...c.selectedElementIds][0];
    const ids = c.canvasState.elements.map((e: any) => e.id);
    const newest = ids[ids.length - 1];
    if (src && newest && newest !== src) {
      const { act } = await import('../network/substrate.ts');
      void act('workspace.link', { from: `el:${newest}`, rel: 'derived-from', to: `el:${src}` }).catch(() => undefined);
    }
  } catch { /* provenance is best-effort */ }
}

/* ─── quick inline edit using the existing modal ‐ one element only ───────── */

export function inlineEdit(c: any): void {
  if (c.selectedElementIds.size !== 1) return;
  const el = c.findElementById([...c.selectedElementIds][0]);
  console.log("opening edit modal for element:", el);
  c.openEditModal(el);
}

/* ─── re-order in Z space ─────────────────────────────────────────────────── */

export function reorder(c: any, dir: 'front' | 'back'): void {
  const delta = dir === 'front' ? +10 : -10;
  c.selectedElementIds.forEach((id: string) => {
    const el = c.findElementById(id);
    if (el) el.zIndex = (el.zIndex || 1) + delta;
  });
  c.requestRender();
  saveCanvas(c.canvasState);
}

/* ─── group / ungroup - minimalist implementation ‐───────────────────────── */
/* We emulate grouping by giving every element an optional `group` string.    */

function _nextGroupId(): string { return 'grp-' + Date.now().toString(36); }

export function groupSelection(c: any): void {
  if (c.selectedElementIds.size < 2) return;
  const gid = _nextGroupId();
  c.selectedElementIds.forEach((id: string) => {
    const el = c.findElementById(id);
    if (el) el.group = gid;
  });
  saveCanvas(c.canvasState);
}

export function canUngroup(c: any): boolean {
  return [...c.selectedElementIds].some((id: string) => {
    const el = c.findElementById(id);
    return el?.group;
  });
}

export function ungroupSelection(c: any): void {
  c.selectedElementIds.forEach((id: string) => {
    const el = c.findElementById(id);
    if (el && el.group) delete el.group;
  });
  saveCanvas(c.canvasState);
}

/* ─── viewport helpers ───────────────────────────────────────────────────── */

export function zoom(c: any, factor: number): void {
  c.viewState.scale = Math.min(
    Math.max(c.viewState.scale * factor, c.MIN_SCALE), c.MAX_SCALE);
  c.updateCanvasTransform();
  c.saveLocalViewState?.();
}

export function zoomToFit(c: any): void {
  /* fit all elements' bounding box into the visible canvas — through the ONE
     shared camera resolver (ADR-0015) instead of a fourth local fit. */
  if (!c.canvasState.elements.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  c.canvasState.elements.forEach((el: CanvasElement) => {
    const s = el.scale || 1;
    minX = Math.min(minX, el.x - el.width * s / 2);
    minY = Math.min(minY, el.y - el.height * s / 2);
    maxX = Math.max(maxX, el.x + el.width * s / 2);
    maxY = Math.max(maxY, el.y + el.height * s / 2);
  });
  const cam = fitRegion({ minX, minY, maxX, maxY }, c.canvas.clientWidth, c.canvas.clientHeight, 0.08, c.MAX_SCALE);
  c.viewState.scale = cam.scale;
  c.viewState.translateX = cam.tx;
  c.viewState.translateY = cam.ty;
  c.updateCanvasTransform();
  c.saveLocalViewState?.();
}

/* ─── export (openHistory is gone: it showed versionHistory, which the
 *      persister strips — always [] — and window.open crashes when iOS
 *      blocks the popup) ─────────────────────────────────────────────────── */

export function exportJSON(c: any): void {
  const data = JSON.stringify(c.canvasState, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${c.canvasState.canvasId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* Convert selection to a different element type */
export function changeType(c: any, newType: string): void {
  if (!c.selectedElementIds.size) return;
  Array.from(c.selectedElementIds).forEach((id: string) => {
    const el = c.findElementById(id);
    if (!el || el.type === newType) return;
    /* 1 . mutate */
    el.type = newType;
    /* 2 . refresh DOM */
    c.updateElementNode(c.elementNodesMap[id], el, true);
  });
  /* 3 . redraw & persist */
  c.requestRender();
  saveCanvas(c.canvasState);
  c._pushHistorySnapshot('type change');
}
