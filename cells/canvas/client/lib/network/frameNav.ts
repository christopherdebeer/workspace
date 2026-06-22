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
import { read } from './substrate.ts';
import { focusFrame } from './storage.ts';

interface Edge { from: string; rel: string; to: string }

const els = (): any[] => ((window as { CC?: any }).CC?.canvasState?.elements ?? []);

/** Move the camera to a frame and reflect it in the URL (shareable, back-able). */
async function goToFrame(frameId: string): Promise<void> {
  const ok = await focusFrame(frameId, els());
  if (!ok) return;
  try {
    const u = new URL(location.href);
    u.searchParams.set('frame', frameId);
    history.replaceState(null, '', u.toString());
  } catch { /* ignore */ }
  void renderTourBar(frameId);
}

/** The tour controls for a frame: prev = inbound navNext, next = outbound. */
async function renderTourBar(frameId: string): Promise<void> {
  let prev: string | null = null, next: string | null = null, label = frameId;
  try {
    const nb = await read<{ edges?: Edge[]; entries?: Array<{ key: string; value?: { label?: string } }> }>(
      'workspace.neighbors',
      { key: `frame:${frameId}`, rel: 'navNext' },
    );
    for (const e of nb.edges ?? []) {
      if (e.rel !== 'navNext') continue;
      if (e.from === `frame:${frameId}` && e.to.startsWith('frame:')) next = e.to.slice('frame:'.length);
      if (e.to === `frame:${frameId}` && e.from.startsWith('frame:')) prev = e.from.slice('frame:'.length);
    }
    const self = (nb.entries ?? []).find((x) => x.key === `frame:${frameId}`);
    if (self?.value?.label) label = self.value.label;
  } catch { /* no tour edges — show just the label */ }

  let bar = document.getElementById('frame-tour');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'frame-tour';
    bar.setAttribute('style', 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:9000;display:flex;gap:8px;align-items:center;background:rgba(28,28,26,.92);color:#fbfbf8;font:13px/1.2 -apple-system,system-ui,sans-serif;padding:7px 10px;border-radius:999px;box-shadow:0 2px 12px rgba(0,0,0,.25)');
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

/** Install frame navigation: the tour bar (if opened on a ?frame) + navTo hotspots. */
export function installFrameNav(): void {
  try {
    const frameId = new URLSearchParams(location.search).get('frame');
    if (frameId) void renderTourBar(frameId);
    void installNavTo();
  } catch { /* navigation is best-effort */ }
}
