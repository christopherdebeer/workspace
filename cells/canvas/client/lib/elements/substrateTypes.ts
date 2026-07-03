/**
 * substrateTypes.ts — the renderer ladder (canvas-substrate-design.md §1).
 *
 * Tier 2 — 'view' elements: an item whose content is a registered view id;
 *          renders the view's evaluated value by its hint. The same
 *          declaration that is an MCP affordance and a home card becomes a
 *          live dashboard tile, placed spatially.
 * Tier 3 — 'surface' elements: an iframe onto any platform surface (an
 *          embedded board, a web-facing cell) — surface-in-canvas.
 * Tier 1 — renderer FACTS: `_renderers/<type>` facts whose source registers
 *          new element types at boot (dotlit's plugins-as-content, with the
 *          same trust posture as html-element scripts: your slice, your code).
 */
import { read } from '../network/substrate.ts';
import { elementRegistry } from './elementRegistry.ts';

const REFRESH_MS = 60_000;

/** An embed is inert: elements render once, no per-element refresh timers. */
const inertEmbed = (): boolean =>
  typeof document !== 'undefined' && document.body.classList.contains('embed');

interface ViewOut {
  id: string;
  render?: { type?: string; label?: string; href?: string } | null;
  value: unknown;
  count: number;
}

function renderViewValue(host: HTMLElement, out: ViewOut): void {
  host.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'vt-label';
  label.textContent = out.render?.label ?? out.id;
  host.appendChild(label);
  const hint = out.render?.type ?? 'json';
  if (hint === 'metric' || hint === 'count') {
    const m = document.createElement('div');
    m.className = 'vt-metric';
    m.textContent = String(out.value ?? '—');
    host.appendChild(m);
  } else if ((hint === 'list' || hint === 'feed' || hint === 'table') && Array.isArray(out.value)) {
    const ul = document.createElement('ul');
    ul.className = 'vt-list';
    for (const item of (out.value as Array<{ key?: string }>).slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = item?.key ?? JSON.stringify(item).slice(0, 48);
      ul.appendChild(li);
    }
    host.appendChild(ul);
  } else if (hint === 'canvas') {
    const a = document.createElement('a');
    a.href = out.render?.href ?? `/@c15r/canvas?view=${encodeURIComponent(out.id)}`;
    a.textContent = `${out.count} item${out.count === 1 ? '' : 's'} · open board →`;
    host.appendChild(a);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'vt-json';
    pre.textContent = JSON.stringify(out.value, null, 1)?.slice(0, 600) ?? '';
    host.appendChild(pre);
  }
}

async function hydrate(host: HTMLElement): Promise<void> {
  const id = host.dataset.viewId;
  if (!id) {
    host.textContent = '(set content to a view id)';
    return;
  }
  try {
    const out = await read<ViewOut>('workspace.view', { id });
    renderViewValue(host, out);
  } catch (err) {
    host.textContent = '⚠ ' + ((err as Error).message ?? String(err));
  }
}

function sizeToElement(el: { width?: number; height?: number; scale?: number }, dom: HTMLElement): void {
  const s = el.scale || 1;
  if (typeof el.width === 'number') dom.style.width = el.width * s + 'px';
  if (typeof el.height === 'number') dom.style.height = el.height * s + 'px';
}

/** Built-ins of the ladder, registered through the same registry as plugins. */
export function registerSubstrateTypes(): void {
  elementRegistry.register('view', {
    mount(el: any) {
      const host = document.createElement('div');
      host.className = 'content view-tile';
      host.dataset.viewId = String(el.content || '');
      sizeToElement(el, host);
      void hydrate(host);
      if (!inertEmbed()) (host as any)._timer = setInterval(() => {
        // No refetch while culled off-screen — the timer outlives the paint.
        if ((host.closest('.canvas-element') as HTMLElement | null)?.style.contentVisibility === 'hidden') return;
        void hydrate(host);
      }, REFRESH_MS);
      return host;
    },
    update(el: any, dom: HTMLElement) {
      if (!dom) return;
      sizeToElement(el, dom);
      if (dom.dataset.viewId !== String(el.content || '')) {
        dom.dataset.viewId = String(el.content || '');
        void hydrate(dom);
      }
    },
    unmount(dom: HTMLElement) {
      clearInterval((dom as any)?._timer);
    },
  });


  // The ladder's floor: ANY fact with no specific renderer becomes a card —
  // icon + title + meta + open-link, computed at load into _fact* transients
  // (underscore fields never persist; the fact's value is never polluted).
  elementRegistry.register('fact', {
    mount(el: any) {
      const host = document.createElement('div');
      host.className = 'content fact-card';
      renderFactCard(el, host);
      sizeToElement(el, host);
      return host;
    },
    update(el: any, dom: HTMLElement) {
      if (!dom) return;
      sizeToElement(el, dom);
      if (dom.dataset.fc !== String(el._factTitle ?? el.id)) renderFactCard(el, dom);
    },
  });

  // A minimap IS just an element (drag it, stick it to screen, it persists
  // as a fact like anything else): scaled overview + viewport box; tap to jump.
  elementRegistry.register('minimap', {
    mount(el: any) {
      const host = document.createElement('div');
      host.className = 'content minimap-tile';
      const cv = document.createElement('canvas');
      host.appendChild(cv);
      sizeToElement(el, host);
      const draw = (): void => {
        const cc = (window as { CC?: any }).CC;
        if (!cc || !host.isConnected) return;
        // Mid-gesture the compositor is busy with the pan — skip this beat
        // (the interval brings the next one 800ms later). Same while culled
        // off-screen: content-visibility skips the PAINT, not our timer.
        if (document.body.classList.contains('gesturing')) return;
        if ((host.closest('.canvas-element') as HTMLElement | null)?.style.contentVisibility === 'hidden') return;
        const w = (cv.width = host.clientWidth || 200);
        const h = (cv.height = host.clientHeight || 140);
        const g = cv.getContext('2d');
        if (!g) return;
        g.clearRect(0, 0, w, h);
        const els2 = (cc.canvasState.elements as any[]).filter((e) => e.type !== 'minimap' && !e.static);
        if (!els2.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const e of els2) {
          minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
          maxX = Math.max(maxX, e.x + (e.width || 200)); maxY = Math.max(maxY, e.y + (e.height || 100));
        }
        const pad = 200;
        minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        const k = Math.min(w / (maxX - minX), h / (maxY - minY));
        const ox = (w - (maxX - minX) * k) / 2 - minX * k;
        const oy = (h - (maxY - minY) * k) / 2 - minY * k;
        (host as any)._map = { k, ox, oy };
        g.fillStyle = '#c9c9bd';
        for (const e of els2) g.fillRect(e.x * k + ox, e.y * k + oy, Math.max(2, (e.width || 200) * k), Math.max(2, (e.height || 100) * k));
        // The viewport box.
        const vs = cc.viewState;
        const vx = (-vs.translateX / vs.scale) * k + ox;
        const vy = (-vs.translateY / vs.scale) * k + oy;
        g.strokeStyle = '#2f6f4f';
        g.lineWidth = 1.5;
        g.strokeRect(vx, vy, (window.innerWidth / vs.scale) * k, (window.innerHeight / vs.scale) * k);
      };
      draw();
      if (!inertEmbed()) (host as any)._timer = setInterval(draw, 800);
      cv.addEventListener('pointerup', (ev) => {
        const cc = (window as { CC?: any }).CC;
        const map = (host as any)._map;
        if (!cc || !map) return;
        ev.stopPropagation();
        const r = cv.getBoundingClientRect();
        const cxCanvas = (ev.clientX - r.left) * (cv.width / r.width);
        const cyCanvas = (ev.clientY - r.top) * (cv.height / r.height);
        const tx = (cxCanvas - map.ox) / map.k;
        const ty = (cyCanvas - map.oy) / map.k;
        cc.viewState.translateX = window.innerWidth / 2 - cc.viewState.scale * tx;
        cc.viewState.translateY = window.innerHeight / 2 - cc.viewState.scale * ty;
        cc.updateCanvasTransform();
        cc.requestRender();
        cc.requestEdgeUpdate();
      });
      return host;
    },
    update(el: any, dom: HTMLElement) {
      sizeToElement(el, dom);
    },
    unmount(dom: HTMLElement) {
      clearInterval((dom as any)?._timer);
    },
  });

  elementRegistry.register('surface', {
    mount(el: any) {
      const host = document.createElement('div');
      host.className = 'content surface-tile';
      const src = safeEmbedSrc(String(el.content || ''));
      if (!src) {
        // Not a URL, self-referencing, or too deep — a flat card, never a frame.
        host.classList.add('surface-blocked');
        host.textContent = '🪞 ' + (String(el.content || '(empty)').slice(0, 60)) + ' — not embeddable';
        sizeToElement(el, host);
        return host;
      }
      const frame = document.createElement('iframe');
      frame.src = withEmbedSize(src, el);
      frame.loading = 'lazy';
      host.appendChild(frame);
      sizeToElement(el, host);
      return host;
    },
    update(el: any, dom: HTMLElement) {
      if (!dom) return;
      sizeToElement(el, dom);
      const frame = dom.querySelector('iframe');
      const next = safeEmbedSrc(String(el.content || ''));
      const want = next ? withEmbedSize(next, el) : 'about:blank';
      if (frame && frame.getAttribute('src') !== want) frame.src = want;
    },
  });
}

/** Tier 1: load `_renderers/<type>` facts and register them like built-ins. */
export async function loadRendererFacts(): Promise<void> {
  try {
    const res = await read<{ entries: Array<{ key: string; value: unknown }> }>('workspace.query', {
      prefix: '_renderers/',
    });
    for (const e of res.entries ?? []) {
      const def = e.value as { type?: string; source?: string };
      if (!def?.type || !def?.source) continue;
      try {
        const b64 = btoa(unescape(encodeURIComponent(def.source)));
        const mod: any = await import(/* @vite-ignore */ `data:text/javascript;base64,${b64}`);
        const view = mod.view ?? mod.default ?? (mod.mount ? { mount: mod.mount, update: mod.update, unmount: mod.unmount } : null);
        if (view?.mount) {
          elementRegistry.register(def.type, view);
          console.log('[renderers] registered', def.type, 'from', e.key);
        } else {
          console.warn('[renderers] no mount export in', e.key);
        }
      } catch (err) {
        console.warn('[renderers] failed to load', e.key, err);
      }
    }
  } catch (err) {
    console.warn('[renderers] unavailable', err);
  }
}

function renderFactCard(el: any, host: HTMLElement): void {
  host.dataset.fc = String(el._factTitle ?? el.id);
  host.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'fc-title';
  title.textContent = `${el._factIcon ?? '•'} ${el._factTitle ?? el.id}`;
  const meta = document.createElement('div');
  meta.className = 'fc-meta';
  meta.textContent = String(el._factMeta ?? '');
  host.append(title, meta);
  if (el._factHref) {
    const a = document.createElement('a');
    a.className = 'fc-open';
    a.href = String(el._factHref);
    a.textContent = 'open →';
    host.appendChild(a);
  }
  // Expand the fact's neighbourhood onto the board (its elided captures,
  // its links) — handled by the storage seam via a DOM event (no cycle).
  const ex = document.createElement('button');
  ex.className = 'fc-expand';
  ex.textContent = '⊕';
  ex.title = 'expand links onto the board';
  ex.onpointerdown = (e) => e.stopPropagation();
  ex.onclick = (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('parc:expand', { detail: { key: String(el._factKey ?? ('el:' + el.id)), id: el.id } }));
  };
  host.appendChild(ex);
}

/**
 * Embed safety: only real URLs become iframes; a fragment or junk string
 * resolves to THE CURRENT PAGE (a board iframing itself — infinite
 * recursion, the tab-kill crash). Self-references are refused outright and
 * nesting is depth-capped via a _d param threaded through embed URLs.
 */
function safeEmbedSrc(raw: string): string | null {
  if (!/^(https?:\/\/|\/)/.test(raw)) return null; // fragments, markdown, junk
  let u: URL;
  try {
    u = new URL(raw, location.origin);
  } catch {
    return null;
  }
  const here = new URL(location.href);
  const depth = Number(here.searchParams.get('_d') ?? '0');
  if (depth >= 2) return null; // deep enough — no more nesting
  if (u.origin === here.origin && u.pathname === here.pathname) {
    const sameBoard =
      (u.searchParams.get('view') ?? '') === (here.searchParams.get('view') ?? '') &&
      (u.searchParams.get('canvas') ?? '') === (here.searchParams.get('canvas') ?? '');
    if (sameBoard) return null; // a board may not contain itself
  }
  u.searchParams.set('_d', String(depth + 1));
  return u.pathname + u.search;
}

/**
 * A canvas `?embed=1` is a zero-JS SSR with no app.js left to re-fit, so it
 * fits the board to the `w`/`h` it is given (default 1200×800). A nested embed
 * sized to its element must pass its own pixel box, or the board lands off-view.
 * Adds w/h (from the element's geometry) to canvas embed iframes that lack them.
 */
function withEmbedSize(src: string, el: { width?: number; height?: number; scale?: number }): string {
  try {
    const u = new URL(src, location.origin);
    if (u.searchParams.get('embed') === '1' && !u.searchParams.has('w')) {
      const s = el.scale || 1;
      if (typeof el.width === 'number') u.searchParams.set('w', String(Math.max(1, Math.round(el.width * s))));
      if (typeof el.height === 'number') u.searchParams.set('h', String(Math.max(1, Math.round(el.height * s))));
    }
    return u.pathname + u.search;
  } catch {
    return src;
  }
}
