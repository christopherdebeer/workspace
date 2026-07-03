/**
 * CanvasController-aware helpers that *mutate model objects* but never touch
 * the DOM outside controller methods.  They are injected into gestureMachine
 * as XState actions.
 */
import { saveCanvas } from '../network/storage.ts';
import { generateContent } from '../network/generation.ts';
import { clampElementScale, pinchFactor, maxScaleFor, MIN_EL_SCALE } from '../geometry.ts';
import type { CanvasController } from '../../types.ts';

// XState context and event types
interface GestureContext {
  controller: CanvasController;
  draft: {
    start?: { x: number; y: number };
    view?: { translateX: number; translateY: number; scale: number };
    startDist?: number;
    initialScale?: number;
    center?: { x: number; y: number };
    origin?: { x: number; y: number };
    startPos?: { x: number; y: number };
    resize?: {
      startX: number;
      startY: number;
      startW: number;
      startH: number;
      cx?: number;
      cy?: number;
    };
    rotate?: {
      center: { x: number; y: number };
      startScreen: { x: number; y: number };
      startRotation: number;
    };
    startScale?: number;
    startPositions?: Map<string, { x: number; y: number; offsetX?: number; offsetY?: number; rotation?: number; scale?: number }>;
    startAngle?: number;
    bboxCenter?: { cx: number; cy: number };
    tempLine?: SVGLineElement;
    sourceId?: string;
    id?: string;
    startCx?: number;
    startCy?: number;
  };
  pointers?: Record<string, { x: number; y: number }>;
}

interface GestureEvent {
  xy: { x: number; y: number };
  elementId?: string;
  edgeId?: string;
  ev?: any;
  deltaY?: number;
  active?: Record<string, { x: number; y: number }>;
}

export function createGestureHelpers(controller: CanvasController) {

  const dpi = () => controller.viewState.scale || 1;     // "device-pixels" ⇄ canvas

  function commitElementMutation() {
    controller.requestRender();
    saveCanvas(controller.canvasState);
    controller._pushHistorySnapshot('Element change');
  }
  function persistViewState() {
    controller.saveLocalViewState();
    // controller._pushHistorySnapshot('View change');
  }

  function applyCanvasPan(ctx: GestureContext, ev: GestureEvent) {
    if (!ctx.draft.start || !ctx.draft.view) return;
    const dx = ev.xy.x - ctx.draft.start.x;
    const dy = ev.xy.y - ctx.draft.start.y;
    controller.viewState.translateX = ctx.draft.view.translateX + dx;
    controller.viewState.translateY = ctx.draft.view.translateY + dy;
    controller.updateCanvasTransform();
  }

  function applyCanvasPinch(ctx: GestureContext, ev: GestureEvent) {
    const pts = Object.values(ev.active || {});
    if (pts.length !== 2 || !ctx.draft.startDist) return;
    const [p1, p2] = pts;
    const newDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const factor = newDist / ctx.draft.startDist;

    const newScale = Math.min(
      Math.max(ctx.draft.initialScale * factor, controller.MIN_SCALE),
      controller.MAX_SCALE
    );

    // Calculate the current center point in canvas coordinates
    const currentCenter = controller.screenToCanvas(
      ctx.draft.center.x,
      ctx.draft.center.y
    );

    // Apply the zoom transformation centered on this point
    const delta = newScale - controller.viewState.scale;
    controller.viewState.scale = newScale;

    // Adjust translation to keep the pinch center fixed in canvas space
    controller.viewState.translateX -= currentCenter.x * delta;
    controller.viewState.translateY -= currentCenter.y * delta;

    controller.updateCanvasTransform();
  }

  function applyWheelZoom(_ctx: GestureContext, ev: GestureEvent) {
    const { ev: wheelEv, deltaY } = ev;
    const delta = -(deltaY ?? wheelEv.deltaY);
    const zoomSpeed = 0.001;
    const prevScale = controller.viewState.scale;
    const scale = Math.min(
      Math.max(prevScale * (1 + delta * zoomSpeed), controller.MIN_SCALE),
      controller.MAX_SCALE
    );
    const scaleDelta = scale - prevScale;
    const zoomCenter = controller.screenToCanvas(wheelEv.clientX, wheelEv.clientY);

    controller.viewState.scale = scale;
    controller.viewState.translateX -= zoomCenter.x * scaleDelta;
    controller.viewState.translateY -= zoomCenter.y * scaleDelta;
    controller.updateCanvasTransform();
  }

  function applyResizeElement(ctx: GestureContext, ev: GestureEvent) {
    const el = controller.findElementById(ev.elementId!);
    if (!el || el.static) return;
    const dx = (ev.xy.x - ctx.draft.resize!.startX) / dpi();
    const dy = (ev.xy.y - ctx.draft.resize!.startY) / dpi();
    el.width = Math.max(20, ctx.draft.resize!.startW + dx);
    el.height = Math.max(20, ctx.draft.resize!.startH + dy);
    const node = controller.elementNodesMap[el.id];
    controller.updateElementNode(
      node,
      el,
      controller.isElementSelected(el.id),
      true
    );
    // --- keep model dimensions in sync with flowed DOM height --------------
    requestAnimationFrame(() => {          // run after the browser paints
      const contentBox = node.querySelector('.content') || node;
      if (!contentBox) return;
      el.height = contentBox.clientHeight / (el.scale || 1);
    });
  }

  function applyRotateElement(ctx: GestureContext, ev: GestureEvent) {
    const el = controller.findElementById(ev.elementId);
    if (!el) return;
    const { center, startScreen, startRotation } = ctx.draft.rotate;
    const p0 = controller.screenToCanvas(startScreen.x, startScreen.y);
    const p1 = controller.screenToCanvas(ev.xy.x, ev.xy.y);

    const a0 = Math.atan2(p0.y - center.y, p0.x - center.x);
    const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
    const deg = ((a1 - a0) * 180) / Math.PI;

    el.rotation = startRotation + deg;
    controller.updateElementNode(
      controller.elementNodesMap[el.id],
      el,
      controller.isElementSelected(el.id),
      true
    );
  }

  function applyScaleElement(ctx: GestureContext, ev: GestureEvent) {
    const el = controller.findElementById(ev.elementId!);
    if (!el) return;
    const sensitivity = 0.01;
    const dx = (ev.xy.x - ctx.draft.origin!.x) / dpi();
    const dy = (ev.xy.y - ctx.draft.origin!.y) / dpi();
    // Calculate a scale factor based on the distance moved
    const scaleFactor = 1 + (dx + dy) * sensitivity;
    // Apply the scale factor to the initial scale, inside the paint-safe bounds
    el.scale = clampElementScale(ctx.draft.startScale! * scaleFactor, el, ctx.draft.startScale!);
    controller.updateElementNode(
      controller.elementNodesMap[el.id],
      el,
      controller.isElementSelected(el.id),
      true
    );
  }

  function applyReorderElement(ctx: GestureContext, ev: GestureEvent) {
    const el = controller.findElementById(ev.elementId!);
    if (!el) return;
    const dx = (ev.xy.x - ctx.draft.origin!.x) / dpi();
    const dy = (ev.xy.y - ctx.draft.origin!.y) / dpi();
    const len = Math.hypot(dx, dy);
    el.zIndex = len * 0.1;
    controller.updateElementNode(
      controller.elementNodesMap[el.id],
      el,
      controller.isElementSelected(el.id),
      true
    );
  }

  function applyGroupMove(ctx: GestureContext, ev: GestureEvent) {
    const dx = (ev.xy.x - ctx.draft.origin.x) / dpi();
    const dy = (ev.xy.y - ctx.draft.origin.y) / dpi();
    controller.selectedElementIds.forEach(id => {
      const el = controller.findElementById(id);
      const start = ctx.draft.startPositions.get(id);
      el.x = start.x + dx;
      el.y = start.y + dy;
      // Update each element individually for better performance
      controller.updateElementNode(
        controller.elementNodesMap[el.id],
        el,
        controller.isElementSelected(el.id),
        true
      );
    });
    controller.updateGroupBox();
    controller.requestEdgeUpdate();
  }

  function applyGroupPinch(ctx: GestureContext, ev: GestureEvent) {
    const pts = Object.values(ev.active || {});
    if (pts.length !== 2) return;

    /* scale & rotate factors relative to start. pinchFactor floors the start
       distance: fingers landing (nearly) together otherwise make the ratio
       explode — the reproduced iOS compositor tab-kill. One factor for the
       whole group, capped so no member leaves its paint-safe scale range. */
    const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    let scale = pinchFactor(newDist, ctx.draft.startDist);
    controller.selectedElementIds.forEach(id => {
      const el = controller.findElementById(id);
      const start = ctx.draft.startPositions?.get(id);
      if (!el || !start) return;
      const s0 = start.scale || 1;
      scale = Math.min(Math.max(scale, MIN_EL_SCALE / s0), maxScaleFor(el) / s0);
    });

    const a1 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    const dAng = a1 - ctx.draft.startAngle;          // radians

    const { cx, cy } = ctx.draft.bboxCenter;

    controller.selectedElementIds.forEach(id => {
      const el = controller.findElementById(id);
      const start = ctx.draft.startPositions.get(id);
      if (!el || !start) return;

      /* rotate + scale the centre point */
      const ox = start.offsetX * scale;
      const oy = start.offsetY * scale;
      const rotX = ox * Math.cos(dAng) - oy * Math.sin(dAng);
      const rotY = ox * Math.sin(dAng) + oy * Math.cos(dAng);

      el.x = cx + rotX;
      el.y = cy + rotY;
      el.scale = clampElementScale(start.scale * scale, el, start.scale);  // ➋  group-wide factor, bounded
      /* keep *internal* scale intact, only update global rotation */
      el.rotation = start.rotation + dAng * 180 / Math.PI;
    });

    controller.requestRender();
  }

  function applyLassoUpdate(ctx: GestureContext, ev: GestureEvent) {
    controller.updateSelectionBox(
      ctx.draft.start!.x, ctx.draft.start!.y,
      ev.xy.x, ev.xy.y
    );
  }
  function commitLassoSelection(ctx: GestureContext, ev: GestureEvent) {
    const { start } = ctx.draft;
    const { x: sx, y: sy } = start!;
    const { x: ex, y: ey } = ev.xy;
    const tl = controller.screenToCanvas(Math.min(sx, ex), Math.min(sy, ey));
    const br = controller.screenToCanvas(Math.max(sx, ex), Math.max(sy, ey));

    controller.selectedElementIds.clear();
    controller.canvasState.elements.forEach(el => {
      const halfW = (el.width * (el.scale || 1)) / 2;
      const halfH = (el.height * (el.scale || 1)) / 2;
      const inX = (el.x + halfW) >= tl.x && (el.x - halfW) <= br.x;
      const inY = (el.y + halfH) >= tl.y && (el.y - halfH) <= br.y;
      if (inX && inY) controller.selectedElementIds.add(el.id);
    });

    controller.removeSelectionBox();
    controller.requestRender();

    if (controller.selectedElementIds.size === 0 &&
      controller.mode === 'direct') {
      controller.switchMode!('navigate');
    }
  }

  /** ONE selection policy: tap replaces, a modifier key adds (HCI review
   *  §1.2 — the FSM path used to hardcode additive-toggle while the palette
   *  replaced, so the same tap meant different things by input path). The
   *  controller's selectElement is the single implementation — group
   *  expansion, group box, CRDT selection and the sheet all hang off it. */
  function selectElement(_ctx: GestureContext, ev: GestureEvent) {
    if (!ev.elementId) return;
    const raw = ev.ev as (PointerEvent | undefined);
    const additive = !!(raw && (raw.shiftKey || raw.metaKey || raw.ctrlKey));
    controller.selectElement(ev.elementId, additive);
    // Selecting an element dismisses any open edge/frame inspector. The FSM's
    // inline action did this via emitDeselect, but withConfig replaces it
    // with THIS helper — so the dismissal must live here too.
    try { window.dispatchEvent(new CustomEvent('parc:canvas-deselect')); } catch { /* non-DOM */ }
  }

  function clearSelection() {
    controller.clearSelection();
    try { window.dispatchEvent(new CustomEvent('parc:canvas-deselect')); } catch { /* non-DOM */ }
  }

  function spawnNewElementAtTap(_ctx: GestureContext, evt: GestureEvent) {
    const { x, y } = controller.screenToCanvas(evt.xy.x, evt.xy.y);
    controller.createNewElement(x, y, 'markdown', '');
  }

  function startTempLine(ctx: GestureContext, ev: GestureEvent) {

    const sourceEl = controller.findElementById(ev.elementId!);
    if (!sourceEl) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#888');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-dasharray', '5 5');
    line.setAttribute('x1', String(sourceEl.x));
    line.setAttribute('y1', String(sourceEl.y));
    line.setAttribute('x2', String(sourceEl.x));
    line.setAttribute('y2', String(sourceEl.y));
    controller.edgesLayer.appendChild(line);
    ctx.draft.tempLine = line;
    ctx.draft.sourceId = ev.elementId;
    ctx.draft.start = ev.xy;
  }

  function applyEdgeDrag(ctx: GestureContext, ev: GestureEvent) {
    if (!ctx.draft.tempLine) return;
    const pt = controller.screenToCanvas(ev.xy.x, ev.xy.y);
    ctx.draft.tempLine.setAttribute('x2', String(pt.x));
    ctx.draft.tempLine.setAttribute('y2', String(pt.y));
  }

  /** The id of the topmost existing element under a drop point, ignoring the
   *  source and any overlays (edge hit-lines, frame chips, handles). Uses the
   *  full hit stack — `elementFromPoint` (singular) returns whatever sits on top,
   *  which since the edge-selectability fix can be an edge line above the node. */
  function dropTargetId(ev: GestureEvent, excludeId?: string): string | null {
    const stack = (document.elementsFromPoint?.(ev.xy.x, ev.xy.y) ?? []) as Element[];
    for (const node of stack) {
      const el = node.closest?.('.canvas-element') as HTMLElement | null;
      const id = el?.dataset?.elId;
      if (id && id !== excludeId) return id;
    }
    return null;
  }

  function linkExisting(ctx: GestureContext, tgtId: string) {
    controller.createNewEdge!(ctx.draft.sourceId!, tgtId, '');
    controller.requestRender();
    saveCanvas(controller.canvasState);
    controller._pushHistorySnapshot('Add edge');
  }

  function commitEdgeCreation(ctx: GestureContext, ev: GestureEvent) {
    if (!ctx.draft.tempLine) return;
    ctx.draft.tempLine.remove();
    const tgtId = dropTargetId(ev, ctx.draft.sourceId);
    if (tgtId) linkExisting(ctx, tgtId);
  }

  async function commitNodeCreation(ctx: GestureContext, ev: GestureEvent) {
    if (!ctx.draft.tempLine) return;
    ctx.draft.tempLine.remove();
    // Dropped ON an existing node → link the two (the common intent). Only an
    // empty-canvas drop creates a brand-new connected element.
    const tgtId = dropTargetId(ev, ctx.draft.sourceId);
    if (tgtId) { linkExisting(ctx, tgtId); return; }
    const pt = controller.screenToCanvas(ev.xy.x, ev.xy.y);
    const text = prompt('Enter label for the new element', '');
    if (!text) return;
    const elId = controller.createNewElement(pt.x, pt.y, 'markdown', 'generating…');
    controller.createNewEdge!(ctx.draft.sourceId!, elId, text);
    controller.requestRender();
    await generateContent?.(text, controller.findElementById(elId)!, controller);
  }

  function editEdgeLabel(_ctx: GestureContext, ev: GestureEvent) {
    const edgeId = ev.edgeId!;
    const edge = controller.findEdgeElementById!(edgeId);
    if (!edge) return;

    // Calculate the midpoint of the edge for better positioning
    const sourceEl = controller.findElementById(edge.source);
    const targetEl = controller.findElementById(edge.target);

    let pt;
    if (sourceEl && targetEl) {
      // Position the edit-prompt at the midpoint between source and target
      const sourceCenterX = sourceEl.x + (sourceEl.width * (sourceEl.scale || 1)) / 2;
      const sourceCenterY = sourceEl.y + (sourceEl.height * (sourceEl.scale || 1)) / 2;
      const targetCenterX = targetEl.x + (targetEl.width * (targetEl.scale || 1)) / 2;
      const targetCenterY = targetEl.y + (targetEl.height * (targetEl.scale || 1)) / 2;

      pt = {
        x: (sourceCenterX + targetCenterX) / 2,
        y: (sourceCenterY + targetCenterY) / 2
      };
    } else {
      // Fallback to click position if elements not found
      pt = controller.screenToCanvas(ev.xy.x, ev.xy.y);
    }

    const editId = controller.createNewElement(
      pt.x, pt.y, 'edit-prompt',
      edge.label || '',
      false,
      { target: edge.id, property: 'label' }
    );
    controller.createNewEdge!(editId, edge.id, 'Editing…', { meta: true });
    controller.requestRender();
  }

  function buildContextMenu(_ctx: GestureContext, ev: any) {
    if (ev.hitElement) {
      controller.buildContextMenu!(ev.elementId);
    } else {
      controller.buildContextMenu!();
    }
  }

  function showContextMenu(_c: GestureContext, e: GestureEvent) {
    controller.showContextMenu!(e.xy.x, e.xy.y)
  }
  function hideContextMenu(_c: GestureContext, _e: GestureEvent) {
    controller.hideContextMenu()
  }

  function openEditModal(_c: GestureContext, e: GestureEvent) {
    controller.openEditModal(controller.findElementById(e.elementId!)!)
  }

  return {
    editEdgeLabel,
    spawnNewElementAtTap,
    buildContextMenu,
    showContextMenu,
    hideContextMenu,
    openEditModal,

    /* canvas */
    applyCanvasPan,
    applyCanvasPinch,
    applyWheelZoom,
    persistViewState,

    /* single element */
    applyResizeElement,
    applyRotateElement,
    applyScaleElement,
    applyReorderElement,

    /* edges */
    startTempLine,
    applyEdgeDrag,
    commitEdgeCreation,
    commitNodeCreation,

    /* groups */
    applyGroupMove,
    applyGroupPinch,

    /* selection */
    selectElement,
    clearSelection,

    /* lasso */
    applyLassoUpdate,
    commitLassoSelection,

    /* generic */
    commitElementMutation
  };
}
