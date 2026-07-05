/* ---------------------------------------------------------------------------
 * sdk.ts — the board ctx (ADR-0056 Inc 1, api 1).
 *
 * ONE sanctioned surface for executable content on the board — renderer facts
 * AND content scripts — replacing reach-ins to the raw controller,
 * `window.CC`, and the `window.__parcRead` bridge (all deprecated, kept one
 * increment). The substrate half is the kernel's verbs; the board half is a
 * deliberate small contract shaped by its live consumers (minimap, style
 * script, repl). Anything they don't need waits.
 * ------------------------------------------------------------------------- */
import { act, read } from './network/substrate.ts';
import { loadTypes, titleOf, hrefOf } from 'https://parc.land/@c15r/kernel/app.js';
import { uid } from './uid.ts';

export interface BoardCamera { x: number; y: number; scale: number }

export type CtxEvent = 'select' | 'camera' | 'change';

export interface BoardSurface {
  /** The current board id (drill navigation changes it under one page). */
  readonly id: string;
  /** Snapshot of the scene — copies, so a script can't corrupt live state. */
  elements(): Array<Record<string, unknown>>;
  /** Selected element ids, in insertion order. */
  selection(): string[];
  camera: {
    get(): BoardCamera;
    set(cam: Partial<BoardCamera>): void;
    /** Center the viewport on an element. */
    fit(elId: string): void;
  };
  /** Mint an element on the board; returns its id. */
  place(opts: { x: number; y: number; type?: string; content?: string; data?: Record<string, unknown> }): string;
  /** Merge a patch into an element and persist through the outbox. */
  update(id: string, patch: Record<string, unknown>): boolean;
  remove(id: string): void;
  /** Subscribe to board happenings; returns an unsubscribe. */
  on(ev: CtxEvent, fn: (detail: unknown) => void): () => void;
}

export interface BoardCtx {
  /** Bumped on breaking changes; consumers should check it (ADR-0056). */
  api: 1;
  read: typeof read;
  act: typeof act;
  uid: typeof uid;
  titleOf: typeof titleOf;
  hrefOf: typeof hrefOf;
  /** The declared type vocabulary (cached by the kernel). */
  types(): Promise<Record<string, unknown>>;
  /** One scoped change-feed page (ADR-0055): this board's slice by default. */
  changes(opts?: { sinceSeq?: number | 'head'; prefixes?: string[]; ops?: string[] }): Promise<unknown>;
  board: BoardSurface;
}

/** Internal handle: the controller emits through this; scripts never see it typed. */
export interface BoardCtxInternal extends BoardCtx {
  _emit(ev: CtxEvent, detail?: unknown): void;
}

export function createBoardCtx(controller: any): BoardCtxInternal {
  const listeners = new Map<CtxEvent, Set<(detail: unknown) => void>>();

  const on = (ev: CtxEvent, fn: (detail: unknown) => void): (() => void) => {
    let set = listeners.get(ev);
    if (!set) { set = new Set(); listeners.set(ev, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  };

  const _emit = (ev: CtxEvent, detail?: unknown): void => {
    const set = listeners.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      // A script's listener must never take the board down with it.
      try { fn(detail); } catch (err) { console.warn('[ctx] listener failed', ev, err); }
    }
  };

  const board: BoardSurface = {
    get id(): string { return controller?.canvasState?.canvasId ?? ''; },
    elements: () => (controller?.canvasState?.elements ?? []).map((e: Record<string, unknown>) => ({ ...e })),
    selection: () => [...(controller?.selectedElementIds ?? [])],
    camera: {
      get: () => ({
        x: controller.viewState.translateX,
        y: controller.viewState.translateY,
        scale: controller.viewState.scale,
      }),
      set: (cam) => {
        const vs = controller.viewState;
        if (Number.isFinite(cam.x)) vs.translateX = cam.x;
        if (Number.isFinite(cam.y)) vs.translateY = cam.y;
        if (Number.isFinite(cam.scale) && (cam.scale as number) > 0) vs.scale = cam.scale;
        controller.updateCanvasTransform();
        controller.saveLocalViewState?.();
      },
      fit: (elId) => controller.recenterOnElement?.(elId),
    },
    place: ({ x, y, type, content, data }) => controller.createNewElement(x, y, type ?? 'markdown', content ?? '', false, data ?? {}),
    update: (id, patch) => {
      const el = controller.findElementById?.(id);
      if (!el) return false;
      Object.assign(el, patch);
      controller.crdt?.updateElement?.(id, el); // persists through the outbox shim
      controller.requestRender?.();
      return true;
    },
    remove: (id) => controller.deleteElementById?.(id),
    on,
  };

  return {
    api: 1,
    read,
    act,
    uid,
    titleOf,
    hrefOf,
    types: () => loadTypes(),
    changes: (opts) =>
      read('workspace.changes', {
        sinceSeq: opts?.sinceSeq ?? 'head',
        scope: {
          prefixes: opts?.prefixes ?? ['el:', `_canvas/${board.id}/`],
          ops: opts?.ops ?? ['write', 'supersede'],
        },
      }),
    board,
    _emit,
  };
}
