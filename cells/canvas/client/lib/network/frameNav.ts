/* ---------------------------------------------------------------------------
 *  frameNav.ts — interactive navigation over frames (ADR-0015).
 *
 *  Two Reference relations turn a board into a walkable space:
 *    - navNext : frame → frame   (a tour; renders ← / → controls)
 *    - navTo   : element → frame  (a hotspot; click the element to focus)
 *
 *  Both resolve through `focusFrame` (the shared region→camera resolver). This
 *  module is purely additive: it reads edges and installs a small overlay +
 *  a capture-phase click handler. Any failure is swallowed — navigation is a
 *  convenience, never load-bearing.
 * ------------------------------------------------------------------------- */
import { read, act } from './substrate.ts';
import { focusFrame } from './storage.ts';
import { frameFromPath, framePath } from '../url.ts';

interface Edge { from: string; rel: string; to: string }
interface FrameEntry { value?: { label?: string } }
interface Neighbors {
  outbound?: Edge[];
  inbound?: Edge[];
  entries?: Record<string, FrameEntry>;
}

const els = (): any[] => ((window as { CC?: any }).CC?.canvasState?.elements ?? []);
const boardId = (): string => (window as { CC?: any }).CC?.canvasState?.canvasId ?? 'parcland';

/** Move the camera to a frame; reflect it in the URL (shareable) unless it's the
 *  implicit default-on-open. */
export async function goToFrame(frameId: string, pushUrl = true): Promise<void> {
  const ok = await focusFrame(frameId, els());
  if (!ok) return;
  if (pushUrl) {
    // Frames are path-addressed now (`/<board>/<name>`), so the URL is shareable
    // and SSR can paint the frame on a cold load (see the cell server).
    try { history.replaceState(null, '', framePath(frameId) + location.search); } catch { /* ignore */ }
  }
  void renderTourBar(frameId);
}

/** Create a member-derived frame from the current selection (Phase 2 gesture) and
 *  focus it. The frame IS a collection: its members are the selected facts, so it
 *  follows them as they move. Returns the new frame id, or null. */
export async function createFrame(controller: any, label?: string): Promise<string | null> {
  const sel: string[] = [...(controller?.selectedElementIds ?? [])].map((id: string) => `el:${id}`);
  if (!sel.length) { console.warn('[canvas] Frame selection: nothing selected'); return null; }
  const board = controller.canvasState?.canvasId ?? boardId();
  const name = (label || 'frame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'frame';
  const frameId = `${board}/${name}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await act('workspace.remember', {
      key: `frame:${frameId}`,
      type: 'frame',
      tags: ['frame', `tour:${board}`],
      value: { board, label: label || name, region: { kind: 'members', members: sel } },
    });
    console.info('[canvas] created frame', { frameId, members: sel.length });
    // Let the on-canvas overlay pick up the new frame (avoids a circular import).
    try { window.dispatchEvent(new CustomEvent('parc:frames-changed')); } catch { /* ignore */ }
    await goToFrame(frameId);
    return frameId;
  } catch (e) {
    console.warn('[canvas] createFrame failed', e);
    return null;
  }
}

/** On a bare open (no ?frame), focus the board's `default` frame if one exists
 *  (ADR-0015 precedence). Non-blocking; best-effort. */
async function focusDefaultFrame(): Promise<void> {
  try {
    const board = boardId();
    const r = await read<{ entries?: Array<{ key: string; value?: { board?: string; default?: boolean } }> }>(
      'workspace.query',
      { type: 'frame', limit: 100 },
    );
    const def = (r.entries ?? []).find((e) => e.value?.board === board && e.value?.default);
    if (def) await goToFrame(def.key.slice('frame:'.length), false);
  } catch { /* no default frame */ }
}

/** The tour controls for a frame: prev = inbound navNext, next = outbound.
 *  `workspace.neighbors` returns { outbound[], inbound[], entries:{key→fact} } —
 *  the neighbour map carries only the *other* ends, so the current frame's own
 *  label is read separately (peek). */
async function renderTourBar(frameId: string): Promise<void> {
  const selfKey = `frame:${frameId}`;
  let prev: string | null = null, next: string | null = null, label = frameId;
  try {
    const nb = await read<Neighbors>('workspace.neighbors', { key: selfKey, rel: 'navNext' });
    for (const e of nb.outbound ?? []) {
      if (e.rel === 'navNext' && e.to.startsWith('frame:')) { next = e.to.slice('frame:'.length); break; }
    }
    for (const e of nb.inbound ?? []) {
      if (e.rel === 'navNext' && e.from.startsWith('frame:')) { prev = e.from.slice('frame:'.length); break; }
    }
  } catch { /* no tour edges — show just the label */ }
  try {
    const self = await read<FrameEntry | null>('workspace.peek', { key: selfKey });
    if (self?.value?.label) label = self.value.label;
  } catch { /* fall back to the id */ }

  let bar = document.getElementById('frame-tour');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'frame-tour';
    // Top-centre: clears the command palette (bottom-centre) so the two never
    // overlap, and reads as a breadcrumb of where you are in the board.
    bar.setAttribute('style', 'position:fixed;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:9000;display:flex;gap:8px;align-items:center;background:rgba(28,28,26,.92);color:#fbfbf8;font:13px/1.2 -apple-system,system-ui,sans-serif;padding:7px 10px;border-radius:999px;box-shadow:0 2px 12px rgba(0,0,0,.25)');
    document.body.appendChild(bar);
  }
  const btn = (txt: string, target: string | null): string =>
    `<button data-frame="${target ?? ''}" ${target ? '' : 'disabled'} style="border:0;border-radius:999px;padding:4px 10px;font:inherit;cursor:${target ? 'pointer' : 'default'};background:${target ? '#2f6f4f' : '#3a3a36'};color:#fff;opacity:${target ? 1 : 0.4}">${txt}</button>`;
  bar.innerHTML = `${btn('‹ Prev', prev)}<span style="padding:0 6px;max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>${btn('Next ›', next)}<button data-exit="1" title="Exit tour" style="border:0;background:transparent;color:#8a8a82;cursor:pointer;font:inherit;padding:4px 6px">✕</button>`;
  bar.querySelectorAll('button[data-frame]').forEach((b) => {
    const t = (b as HTMLElement).dataset.frame;
    if (t) b.addEventListener('click', () => void goToFrame(t));
  });
  bar.querySelector('[data-exit]')?.addEventListener('click', () => bar?.remove());
}

/** navTo hotspots: build a map (element → frame) once, then a capture-phase
 *  click handler focuses the target. Prefetched so a normal click pays nothing. */
async function installNavTo(): Promise<void> {
  const map = new Map<string, string>();
  try {
    const r = await read<{ edges?: Edge[] }>('workspace.links', {});
    for (const e of r.edges ?? []) {
      if (e.rel === 'navTo' && e.from.startsWith('el:') && e.to.startsWith('frame:')) {
        map.set(e.from.slice('el:'.length), e.to.slice('frame:'.length));
      }
    }
  } catch { /* no nav edges */ }
  if (!map.size) return;
  document.addEventListener(
    'click',
    (ev) => {
      const node = (ev.target as HTMLElement)?.closest?.('.canvas-element') as HTMLElement | null;
      const id = node?.dataset?.id;
      const target = id && map.get(id);
      if (target) { ev.preventDefault(); ev.stopPropagation(); void goToFrame(target); }
    },
    true,
  );
  console.info('[canvas] navTo hotspots installed', { count: map.size });
}

/** Install frame navigation: the tour bar (if opened on a ?frame, else the
 *  board's default frame) + navTo hotspots. */
export function installFrameNav(): void {
  try {
    // Frame from the path (`/<board>/<name>`), falling back to the legacy ?frame=.
    const frameId = frameFromPath() ?? new URLSearchParams(location.search).get('frame');
    // Focus it (no URL re-push — it's already the address) so the frame is applied
    // client-side on a non-SSR load, and re-fit to the exact device viewport on an
    // SSR/hydrate one. No frame in the URL → the board's default viewpoint.
    if (frameId) void goToFrame(frameId, false);
    else void focusDefaultFrame();
    void installNavTo();
  } catch { /* navigation is best-effort */ }
}
