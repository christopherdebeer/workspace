/**
 * crdt.ts — the SubstrateAdapter, wearing the CrdtAdapter name for history.
 *
 * The original Yjs/WebRTC layer left exactly the right seam: a per-element
 * update adapter wired into every render (`updateElementNode →
 * crdt.updateElement`). The substrate version funnels those updates into the
 * debounced, deduplicating fact writer in storage.ts — elements become facts,
 * geometry becomes placement decorations. Remote merge is the change-feed
 * poller (storage.startLiveSync); the Yjs presence/update surface is gone.
 */
import type { CanvasElement, Edge } from '../../types.ts';
import { queueElementWrite, queueEdgeWrite } from './storage.ts';

export class CrdtAdapter {
  constructor(private canvasId: string) {}

  updateElement(_id: string, data: CanvasElement): void {
    queueElementWrite(this.canvasId, data as unknown as Record<string, unknown>);
  }

  updateEdge(_id: string, data: Edge): void {
    queueEdgeWrite(this.canvasId, data as unknown as Record<string, unknown>);
  }

  updateView(_data: unknown): void {
    /* camera is per-device (localStorage) — not substrate state */
  }

  updateSelection(_data: Set<string>): void {
    /* selection is ephemeral — presence returns with rooms */
  }
}
