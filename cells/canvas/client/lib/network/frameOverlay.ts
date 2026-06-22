/* ---------------------------------------------------------------------------
 *  frameOverlay.ts — frames are VISIBLE + editable on the canvas (ADR-0015).
 *
 *  A frame is a member-derived region (a Collection + render:{board, region}).
 *  Until now it existed only as a fact + a camera move, so there was nothing on
 *  the board to see or tap — "how could one edit them?" (user). This draws each
 *  frame's resolved bbox as a labelled dashed rectangle into an SVG overlay that
 *  shares the edges-layer world coordinates (its viewBox is kept in sync by
 *  updateCanvasTransform), so frames pan/zoom with the content they enclose.
 *
 *  Tapping a frame's header chip focuses it (goToFrame) and opens an editor:
 *    - label    : rename the viewpoint
 *    - default  : the frame focused on a bare open of this board
 *    - re-frame : set the region to the current selection (it follows them)
 *    - delete   : retire the frame fact (supersede)
 *
 *  Additive + best-effort: an SVG layer + a MutationObserver that redraws when
 *  member elements move. Any failure is swallowed — frames are a convenience.
 * ------------------------------------------------------------------------- */
import { read, act } from './substrate.ts';
import { placedOf } from './storage.ts';
import { goToFrame } from './frameNav.ts';
import { showInspector, clearInspector, inspectorHeader } from './inspectorPanel.ts';
import { regionBBox, type Region } from '../../../shared/frame.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
const cc = (): any => (window as { CC?: any }).CC;
const els = (): any[] => cc()?.canvasState?.elements ?? [];
const board = (): string => cc()?.canvasState?.canvasId ?? 'parcland';

interface FrameValue { label?: string; board?: string; default?: boolean; region?: Region }
interface FrameFact { key: string; value?: FrameValue }

let frames: FrameFact[] = [];
let installed = false;
let rafPending = false;

/** The frames SVG overlay: a sibling *below* #edges-layer, sharing its viewBox so
 *  world coordinates line up. Created lazily; viewBox is synced by the controller's
 *  updateCanvasTransform (guarded there, so this can install at any time). */
function ensureLayer(): SVGSVGElement | null {
  const edges = document.getElementById('edges-layer');
  if (!edges?.parentElement) return null;
  let layer = document.getElementById('frames-layer') as SVGSVGElement | null;
  if (!layer) {
    layer = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    layer.id = 'frames-layer';
    layer.setAttribute('viewBox', edges.getAttribute('viewBox') ?? '0 0 1000 1000');
    layer.setAttribute(
      'style',
      'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:4',
    );
    edges.parentElement.insertBefore(layer, edges); // below the edges
  }
  return layer;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** Redraw all frame rectangles + header chips for the current board. Cheap (a
 *  handful of rects); safe to call often. */
export function drawFrameOverlay(): void {
  const layer = ensureLayer();
  if (!layer) return;
  layer.innerHTML = '';
  const placed = placedOf(els());
  for (const f of frames) {
    const region = f.value?.region;
    if (!region) continue;
    const bb = regionBBox(region, placed);
    if (!bb) continue;
    const frameId = f.key.slice('frame:'.length);
    const label = f.value?.label || frameId;
    const w = Math.max(1, bb.maxX - bb.minX), h = Math.max(1, bb.maxY - bb.minY);

    const g = svg('g', {});
    g.appendChild(svg('rect', {
      x: String(bb.minX), y: String(bb.minY), width: String(w), height: String(h), rx: '12',
      fill: f.value?.default ? 'rgba(47,111,79,0.05)' : 'rgba(47,111,79,0.025)',
      stroke: '#2f6f4f', 'stroke-width': '2', 'stroke-dasharray': '9,7',
      'vector-effect': 'non-scaling-stroke', style: 'pointer-events:none',
    }));
    // A header chip pinned to the top-left corner — the tap target (everything
    // else stays click-through so enclosed elements keep working).
    const text = (f.value?.default ? '◉ ' : '') + label;
    // Selection is canvas-native: the gesture FSM reads .frame-chip / data-frame
    // on tap and emits parc:frame-tap (a click handler can't — the pointer
    // adapter preventDefaults pointerdown, killing synthetic clicks).
    const chip = svg('g', { class: 'frame-chip', 'data-frame': frameId, style: 'pointer-events:all;cursor:pointer' });
    const padX = 8, fs = 15, chW = text.length * fs * 0.6 + padX * 2, chH = fs + 10;
    chip.appendChild(svg('rect', {
      x: String(bb.minX), y: String(bb.minY - chH), width: String(chW), height: String(chH),
      rx: '7', fill: '#2f6f4f', 'vector-effect': 'non-scaling-stroke',
    }));
    const t = svg('text', {
      x: String(bb.minX + padX), y: String(bb.minY - chH / 2),
      'dominant-baseline': 'central', fill: '#fbfbf8',
      style: `font:600 ${fs}px -apple-system,system-ui,sans-serif;pointer-events:none;user-select:none`,
    });
    t.textContent = text;
    chip.appendChild(t);
    g.appendChild(chip);
    layer.appendChild(g);
  }
}

/** Re-fetch this board's frames from the substrate, then redraw. */
export async function refreshFrameOverlay(): Promise<void> {
  try {
    const r = await read<{ entries?: FrameFact[] }>('workspace.query', { type: 'frame', limit: 100 });
    frames = (r.entries ?? []).filter((f) => f.value?.board === board());
  } catch { frames = []; }
  drawFrameOverlay();
}

function scheduleDraw(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; drawFrameOverlay(); });
}

/* ── editor ──────────────────────────────────────────────────────────────── */

function field(label: string, inner: string): string {
  return `<label><span style="color:#8a8a82;font-size:11px">${label}</span>${inner}</label>`;
}

async function saveFrame(f: FrameFact, patch: Partial<FrameValue>): Promise<void> {
  const value = { ...(f.value ?? {}), ...patch };
  f.value = value;
  try {
    await act('workspace.remember', {
      key: f.key, type: 'frame', tags: ['frame', `tour:${value.board ?? board()}`], value,
    });
  } catch (e) { console.warn('[canvas] saveFrame failed', f.key, e); }
  void refreshFrameOverlay();
}

export function openFrameEditor(f: FrameFact): void {
  const frameId = f.key.slice('frame:'.length);
  const memberCount = f.value?.region?.kind === 'members' ? (f.value.region.members?.length ?? 0) : 0;
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;gap:9px';
  body.appendChild(inspectorHeader('Frame', clearInspector));
  const rest = document.createElement('div');
  rest.style.cssText = 'display:grid;gap:9px';
  rest.innerHTML = `
    ${field('Label', `<input data-f="label" value="${(f.value?.label ?? frameId).replace(/"/g, '&quot;')}"/>`)}
    <label style="display:flex;gap:8px;align-items:center;color:#1c1c1a">
      <input data-f="default" type="checkbox" ${f.value?.default ? 'checked' : ''}/>
      <span>Default view (focused when this board opens)</span>
    </label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button data-act="reframe" style="border:1px solid #2f6f4f;background:transparent;color:#2f6f4f;border-radius:7px;padding:6px 12px;font:inherit;cursor:pointer">Set region to selection</button>
      <button data-act="delete" style="border:1px solid #7a1f1f;background:transparent;color:#7a1f1f;border-radius:7px;padding:6px 12px;font:inherit;cursor:pointer">Delete</button>
      <span style="margin-left:auto;align-self:center;color:#8a8a82;font-size:11px">${memberCount} member${memberCount === 1 ? '' : 's'}</span>
    </div>`;
  body.appendChild(rest);

  const labelInput = rest.querySelector('[data-f="label"]') as HTMLInputElement | null;
  const defInput = rest.querySelector('[data-f="default"]') as HTMLInputElement | null;
  labelInput?.addEventListener('change', () => void saveFrame(f, { label: labelInput.value.trim() || frameId }));
  defInput?.addEventListener('change', () => void saveFrame(f, { default: defInput.checked }));
  rest.querySelector('[data-act="reframe"]')?.addEventListener('click', () => {
    const sel = [...(cc()?.selectedElementIds ?? [])].map((id: string) => `el:${id}`);
    if (!sel.length) { console.warn('[canvas] re-frame: nothing selected'); return; }
    void saveFrame(f, { region: { kind: 'members', members: sel } });
  });
  rest.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    act('workspace.supersede', { key: f.key }).catch(() => undefined);
    frames = frames.filter((x) => x.key !== f.key);
    clearInspector();
    drawFrameOverlay();
  });
  showInspector(body, 'frame');
}

/** Install the frame overlay: fetch + draw, then redraw when member elements move
 *  (a MutationObserver on the transformed container's subtree, throttled to a
 *  frame). Idempotent. */
export function installFrameOverlay(): void {
  if (installed) { void refreshFrameOverlay(); return; }
  installed = true;
  void refreshFrameOverlay();
  const container = document.getElementById('canvas-container');
  if (container) {
    new MutationObserver(scheduleDraw).observe(container, {
      attributes: true, attributeFilter: ['style'], childList: true, subtree: true,
    });
  }
  // A new/edited frame fact doesn't touch the DOM, so the observer can't see it —
  // createFrame fires this when the frame set changes.
  window.addEventListener('parc:frames-changed', () => void refreshFrameOverlay());
  // Canvas-native frame selection: the FSM emits parc:frame-tap on a chip tap —
  // focus the frame and open its editor in the consolidated panel.
  window.addEventListener('parc:frame-tap', (ev) => {
    const id = (ev as CustomEvent<{ id: string }>).detail?.id;
    const f = id ? frames.find((x) => x.key === `frame:${id}`) : null;
    if (!f) return;
    const c = cc();
    if (c?.selectedEdgeIds?.size) { c.selectedEdgeIds.clear(); c.requestRender?.(); } // drop any edge selection
    void goToFrame(id as string);
    openFrameEditor(f);
  });
  // Tapping empty space / an element closes a frame editor (the FSM emits this).
  window.addEventListener('parc:canvas-deselect', () => clearInspector('frame'));
  console.info('[canvas] frame overlay installed');
}
