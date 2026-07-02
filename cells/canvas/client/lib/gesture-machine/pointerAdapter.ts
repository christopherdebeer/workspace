// ----------------------------------------------------------------------------
// Thin DOM ⇆ FSM bridge.
// Converts native pointer / wheel events into *pure* FSM events.
// ----------------------------------------------------------------------------
export function installPointerAdapter(
  rootEl: HTMLElement,
  service: any,
  getViewState: () => any,
  selected: () => Set<string> = () => new Set()
): () => void {

  const active = new Map<number, { x: number; y: number }>(); // pointerId → {x,y}
  const capturedTargets = new Map<number, Element>(); // pointerId → element that we called setPointerCapture on

  let lastTap: { t: number; x: number; y: number } = { t: 0, x: 0, y: 0 };
  const TAP_MS = 300;
  const TAP_DIST = 10;

  const classifyHandle = (node: Element | null): string | null => {
    if (!node) return null;
    if (node.id === 'group-box') return null;         // click on the bbox itself
    if (node.closest('#group-box')) {
      if (node.classList.contains('resize-handle')) return 'resize';
      if (node.classList.contains('rotate-handle')) return 'rotate';
      if (node.classList.contains('scale-handle')) return 'scale';
    }
    if (node.classList.contains('resize-handle')) return 'resize';
    if (node.classList.contains('scale-handle')) return 'scale';
    if (node.classList.contains('rotate-handle')) return 'rotate';
    if (node.classList.contains('reorder-handle')) return 'reorder';
    if (node.classList.contains('edge-handle')) return 'edge';
    if (node.classList.contains('create-handle')) return 'createNode';
    if (node.classList.contains('type-handle')) return 'type';

    return null;
  };

  const send = (type: string, ev: PointerEvent | WheelEvent | KeyboardEvent, extra: Record<string, any> = {}): void => {
    const xy = { x: (ev as any).clientX || 0, y: (ev as any).clientY || 0 };
    const elementNode = (ev.target as Element)?.closest('.canvas-element');
    const handleNode = (ev.target as Element)?.closest('.element-handle');
    const edgeLabelNode = (ev.target as Element)?.closest('text[data-id]');
    // An edge's wide hit line / visible line (ADR-0016) — the canvas-native tap
    // target for edge selection. data-id carries the edge id.
    const edgeLineNode = (ev.target as Element)?.closest?.('.edge-hit, .edge-line');
    const edgeId = (edgeLabelNode as HTMLElement | null)?.dataset?.id
      ?? edgeLineNode?.getAttribute?.('data-id') ?? null;
    // A frame's header chip (ADR-0015) — the canvas-native tap target for frame
    // selection; data-frame carries the frame id.
    const frameChipNode = (ev.target as Element)?.closest?.('.frame-chip');
    const frameId = frameChipNode?.getAttribute?.('data-frame') ?? null;

    const payload = {
      type,
      xy,
      active: Object.fromEntries(active),
      hitElement: !!elementNode,
      elementId: elementNode ? (elementNode as HTMLElement).dataset.elId : null,
      handle: classifyHandle(handleNode),
      edgeLabel: !!edgeLabelNode,
      edgeLine: !!edgeLineNode,
      edgeId,
      frameId,
      selected: selected(),
      view: getViewState(),
      ev, // raw DOM event
      ...extra
    };
    // Scalars only — the full payload carries the raw event + view + selection,
    // which the sticky on-device console would retain per pointer event.
    if (payload.type !== 'POINTER_MOVE') console.log('[FSM] send', payload.type, { pointers: active.size, id: (ev as PointerEvent).pointerId, el: payload.elementId, handle: payload.handle });
    service.send(payload);
  };

  const onPointerDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const handleNode = (ev.target as Element)?.closest('.element-handle');
    const edgeLabelNode = (ev.target as Element)?.closest('text[data-id]');
    const elementNode = (ev.target as Element)?.closest('.canvas-element');
    const captureNode = (handleNode
      || edgeLabelNode
      || elementNode
      || rootEl) as Element;

    // 3) capture on that node and store it. setPointerCapture THROWS
    // (NotFoundError) when the pointer is already gone — iOS Safari does this
    // mid-handler when a system gesture claims the touch. Uncaught, it aborts
    // this listener and leaves a PHANTOM entry in `active`, after which every
    // one-finger drag reads as a two-pointer pinch against a stale coordinate.
    try {
      captureNode.setPointerCapture(ev.pointerId);
      capturedTargets.set(ev.pointerId, captureNode);
      (ev.target as Element).setPointerCapture(ev.pointerId);
    } catch { /* pointer already inactive — proceed uncaptured */ }
    send('POINTER_DOWN', ev);
    startLongPress(ev);

  };

  /* — LONG-PRESS helper — */
  let lpTimer: ReturnType<typeof setTimeout> | null = null;
  const LP_DELAY = 600;                     // ms
  function startLongPress(ev: PointerEvent): void {
    // Never two timers: a second finger used to ORPHAN the first one
    // (overwritten, uncancelable — it fired mid-pinch and opened the
    // context menu). And a pinch is not a press: two active pointers
    // means zoom intent, so no long-press at all.
    cancelLongPress();
    if (active.size > 1) return;
    lpTimer = setTimeout(() => {
      send('LONG_PRESS', ev);                // new pure FSM event
      lpTimer = null;
    }, LP_DELAY);
  }
  function cancelLongPress(): void { if (lpTimer) clearTimeout(lpTimer); lpTimer = null; }

  const onPointerMove = (ev: PointerEvent): void => {
    if (!active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    cancelLongPress();
    send('POINTER_MOVE', ev);
  };
  const finishPointer = (ev: PointerEvent): void => {
    ev.preventDefault();
    cancelLongPress();
    active.delete(ev.pointerId);
    // release capture on whichever node we grabbed (throws if the capture
    // never took or the node left the DOM — either way there's nothing to do)
    const capNode = capturedTargets.get(ev.pointerId) || rootEl;
    try { capNode.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    capturedTargets.delete(ev.pointerId);

    send('POINTER_UP', ev);

    /*  tap / double-tap detection  */
    if (ev.button === 0) {
      const dt = ev.timeStamp - lastTap.t;
      const dist = Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y);
      if (dt < TAP_MS && dist < TAP_DIST) {
        send('DOUBLE_TAP', ev);
        lastTap.t = 0; // reset
      } else {
        lastTap = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
      }
    }
  };
  const onWheel = (ev: WheelEvent): void => send('WHEEL', ev, { deltaY: ev.deltaY });
  const onKeyup = (ev: KeyboardEvent): void => {
    console.log("[PointerAdapter] keyup", ev)
    send('KEYUP', ev, { key: ev.key });
  }
  const onKeydown = (ev: KeyboardEvent): void => {
    console.log("[PointerAdapter] keydown", ev)
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) service.state.context.controller.redo();
      else service.state.context.controller.undo();
      return;           // don’t forward to FSM
    }

    send('KEYDOWN', ev, { key: ev.key });
  }


  /* Phantom-pointer reset: iOS Safari can swallow the pointerup/pointercancel
     for a touch that ends while the app backgrounds or a system gesture takes
     over. The stranded `active` entry then makes every later one-finger drag
     look like a pinch against a stale coordinate — the intermittent "pinch out
     of nowhere" that runs the scale math on garbage. Losing focus/visibility
     ends every gesture. */
  const resetPointers = (): void => {
    if (!active.size && !capturedTargets.size) return;
    cancelLongPress();
    for (const [id, node] of capturedTargets) {
      try { node.releasePointerCapture(id); } catch { /* already gone */ }
    }
    capturedTargets.clear();
    active.clear();
    service.send({ type: 'POINTER_UP', xy: { x: 0, y: 0 }, active: {}, hitElement: false, elementId: null, handle: null, edgeLabel: false, edgeLine: false, edgeId: null, frameId: null, selected: selected(), view: getViewState(), ev: null });
  };
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') resetPointers(); };
  window.addEventListener('blur', resetPointers);
  document.addEventListener('visibilitychange', onVisibility);

  /* listeners — bound to the canvas AND the static layer (a sibling, so
     stuck-to-screen elements stay selectable / un-stickable). */
  const roots: HTMLElement[] = [rootEl];
  const staticEl = document.getElementById('static-container');
  if (staticEl) roots.push(staticEl);
  for (const r of roots) {
    r.addEventListener('pointerdown', onPointerDown, { passive: false });
    r.addEventListener('pointermove', onPointerMove, { passive: true });
    r.addEventListener('pointerup', finishPointer, { passive: false });
    r.addEventListener('pointercancel', finishPointer, { passive: true });
  }
  rootEl.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKeydown, { passive: true });
  window.addEventListener('keyup', onKeyup, { passive: true });

  /* teardown helper */
  return () => {
    rootEl.removeEventListener('pointerdown', onPointerDown);
    rootEl.removeEventListener('pointermove', onPointerMove);
    rootEl.removeEventListener('pointerup', finishPointer);
    rootEl.removeEventListener('pointercancel', finishPointer);
    rootEl.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('keyup', onKeyup);
    window.removeEventListener('blur', resetPointers);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
