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
      (host as any)._timer = setInterval(() => void hydrate(host), REFRESH_MS);
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

  elementRegistry.register('surface', {
    mount(el: any) {
      const host = document.createElement('div');
      host.className = 'content surface-tile';
      const frame = document.createElement('iframe');
      frame.src = String(el.content || 'about:blank');
      frame.loading = 'lazy';
      host.appendChild(frame);
      sizeToElement(el, host);
      return host;
    },
    update(el: any, dom: HTMLElement) {
      if (!dom) return;
      sizeToElement(el, dom);
      const frame = dom.querySelector('iframe');
      if (frame && frame.getAttribute('src') !== el.content) frame.src = String(el.content || 'about:blank');
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
