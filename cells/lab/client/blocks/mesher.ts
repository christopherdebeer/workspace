/**
 * Shaping off the page's thread: a worker (the lab's own bundle, loaded again as one) is sent a cell's patch (the
 * reads round it) and sends back its mesh. The page names and keeps the meshes; the workers only make them.
 */
import { surface } from './shape';
import type { Read } from './rules';

export type Job = { id: number; reads: Read[]; floor: number };
export type Done = { id: number; v: Float32Array; i: Uint32Array };

export function serve() {
  const ctx = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage: (m: Done, t: Transferable[]) => void };
  ctx.onmessage = (e) => {
    const m = surface(e.data.reads, e.data.floor);
    ctx.postMessage({ id: e.data.id, v: m.v, i: m.i }, [m.v.buffer, m.i.buffer]);
  };
}
