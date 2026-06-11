/**
 * crdt.ts — the SubstrateAdapter, wearing the CrdtAdapter interface.
 *
 * The original Yjs/WebRTC layer left exactly the right seam: a per-element
 * update adapter wired into every render (`updateElementNode →
 * crdt.updateElement`). The substrate version funnels those updates into the
 * debounced, deduplicating fact writer in storage.ts — elements become facts,
 * geometry becomes placement decorations.
 *
 * The `provider.awareness` SHIM below is load-bearing: main.ts contains a
 * dangling `if ((this.crdt as any).provider?.awareness?.getStates?.())`
 * (a commented-out body made the NEXT statement — the handle-building block
 * — its body), so element handles only render when that chain is truthy.
 * We emulate the shape (empty presence) to keep the original control flow.
 */
import type { CanvasElement, Edge } from '../../types.ts';
import { queueElementWrite, queueEdgeWrite } from './storage.ts';

interface AwarenessShim {
  clientID: number;
  getStates: () => Map<number, unknown>;
  setLocalStateField: (field: string, value: unknown) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

export class CrdtAdapter {
  clientInfo: { clientId: number; user: string };
  /** Shape-compatible stand-in for the Yjs WebrtcProvider (no peers). */
  provider: { awareness: AwarenessShim };

  constructor(private canvasId: string) {
    this.clientInfo = { clientId: 1, user: 'local' };
    this.provider = {
      awareness: {
        clientID: 1,
        getStates: () => new Map(),
        setLocalStateField: () => undefined,
        on: () => undefined,
      },
    };
  }

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

  onPresenceChange(_callback: (presence: unknown[]) => void): void {
    /* no peers without a presence channel */
  }

  onUpdate(_callback: (event: unknown) => void): void {
    /* remote merge lands with the change-feed poller (changes(sinceSeq)) */
  }
}
