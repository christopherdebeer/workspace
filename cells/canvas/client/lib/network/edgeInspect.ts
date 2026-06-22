/* ---------------------------------------------------------------------------
 *  edgeInspect.ts — edges are selectable + editable (ADR-0016, phase 1b).
 *
 *  Tap an edge (its wide invisible hit line) → select it (highlight) and open a
 *  bottom-sheet inspector that edits, independently:
 *    - rel    : the substrate relation (TYPE) — re-links on change
 *    - label  : the display annotation — never touches rel
 *    - style  : color / width / dash
 *  …plus delete. Replaces the flaky "inline edit." Additive + best-effort: a
 *  capture-phase click handler + a DOM sheet; no gesture-FSM surgery.
 *
 *  Editing a BARE reference (a `lnk:` edge) promotes it to a persisted decoration
 *  (it gains style/label) — the "on gaining content" rule, decoration tier.
 * ------------------------------------------------------------------------- */
import { act } from './substrate.ts';
import { saveCanvas } from './storage.ts';
import { showInspector, clearInspector, inspectorHeader } from './inspectorPanel.ts';

const cc = (): any => (window as { CC?: any }).CC;
const elId = (k: string): string => (k.startsWith('el:') ? k.slice(3) : k);
const relOf = (e: any): string => (e?.rel ?? e?.label ?? 'relates');

function findEdge(id: string): any {
  return cc()?.canvasState?.edges?.find((e: any) => e.id === id);
}

function selectEdge(id: string): void {
  const c = cc();
  if (!c) return;
  c.selectedElementIds?.clear?.();
  c.selectedEdgeIds = new Set([id]);
  c.requestRender?.();
}

function clearSelection(): void {
  const c = cc();
  if (c?.selectedEdgeIds?.size) { c.selectedEdgeIds.clear(); c.requestRender?.(); }
  clearInspector('edge');
}

/** Re-key a bare `lnk:` edge to a decoration id so its style/label persist. */
function promoteIfBare(c: any, edge: any): void {
  if (!String(edge.id).startsWith('lnk:')) return;
  for (const m of ['edgeNodesMap', 'edgeHitNodesMap', 'edgeLabelNodesMap']) {
    c[m]?.[edge.id]?.remove?.();
    if (c[m]) delete c[m][edge.id];
  }
  edge.id = `edge-${Date.now().toString(36)}`;
}

function applyEdit(edge: any, patch: { rel?: string; label?: string; style?: Record<string, string> }): void {
  const c = cc();
  if (!c || !edge) return;
  const oldRel = relOf(edge);
  promoteIfBare(c, edge);
  if (patch.rel !== undefined) edge.rel = patch.rel.trim() || 'relates';
  if (patch.label !== undefined) edge.label = patch.label;
  if (patch.style) edge.style = { ...(edge.style ?? {}), ...patch.style };
  // A rel change is a re-link: drop the old relation (the save links the new).
  const newRel = relOf(edge);
  if (newRel !== oldRel && typeof edge.source === 'string' && typeof edge.target === 'string') {
    void act('workspace.unlink', { from: `el:${elId(edge.source)}`, rel: oldRel, to: `el:${elId(edge.target)}` }).catch(() => undefined);
  }
  saveCanvas(c.canvasState);
  c.requestRender?.();
}

function deleteEdge(edge: any): void {
  const c = cc();
  if (!c || !edge) return;
  c.canvasState.edges = c.canvasState.edges.filter((e: any) => e.id !== edge.id);
  saveCanvas(c.canvasState); // _saveCanvas unlinks removed edges
  clearSelection();
  c.requestRender?.();
}

function field(label: string, input: string): string {
  return `<label><span style="color:#8a8a82;font-size:11px">${label}</span>${input}</label>`;
}

function openInspector(edge: any): void {
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;gap:9px';
  body.appendChild(inspectorHeader('Edge', clearSelection));
  const grid = document.createElement('div');
  grid.className = 'ctx-row';
  grid.innerHTML = `
    ${field('Relation (type)', `<input data-f="rel" value="${(relOf(edge)).replace(/"/g, '&quot;')}"/>`)}
    ${field('Label (display)', `<input data-f="label" placeholder="(optional)" value="${(edge.label ?? '').replace(/"/g, '&quot;')}"/>`)}
    ${field('Colour', `<input data-f="color" type="color" value="${edge.style?.color || '#cccccc'}"/>`)}
    ${field('Width', `<input data-f="thickness" type="number" min="1" max="12" value="${parseFloat(edge.style?.thickness) || 2}"/>`)}
    ${field('Dash', `<select data-f="dash"><option value="">solid</option><option value="6,4" ${edge.style?.dash === '6,4' ? 'selected' : ''}>dashed</option><option value="2,4" ${edge.style?.dash === '2,4' ? 'selected' : ''}>dotted</option></select>`)}
    <div style="display:flex;align-items:flex-end"><button data-act="delete" style="border:1px solid #7a1f1f;background:transparent;color:#7a1f1f;border-radius:7px;padding:6px 12px;font:inherit;cursor:pointer">Delete</button></div>`;
  body.appendChild(grid);

  const get = (f: string): string => (grid.querySelector(`[data-f="${f}"]`) as HTMLInputElement | null)?.value ?? '';
  const commit = (): void => applyEdit(edge, {
    rel: get('rel'), label: get('label'),
    style: { color: get('color'), thickness: get('thickness'), dash: get('dash') },
  });
  grid.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', commit));
  grid.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteEdge(edge));
  showInspector(body, 'edge');
}

/** Install edge selection + the inspector. Selection is canvas-native: the
 *  gesture FSM detects a tap on an edge's hit line and emits `parc:edge-tap`
 *  ({ id }); a tap on empty space / an element emits `parc:canvas-deselect`. A
 *  document `click` listener cannot be used — the pointer adapter calls
 *  preventDefault() on pointerdown, which suppresses synthetic canvas clicks. */
export function installEdgeInspector(): void {
  window.addEventListener('parc:edge-tap', (ev) => {
    const id = (ev as CustomEvent<{ id: string }>).detail?.id;
    const edge = id ? findEdge(id) : null;
    if (edge) { selectEdge(id as string); openInspector(edge); }
  });
  window.addEventListener('parc:canvas-deselect', () => clearSelection());
  console.info('[canvas] edge inspector installed');
}
