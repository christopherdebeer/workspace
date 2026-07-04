/* ---------------------------------------------------------------------------
 * elementRegistry.ts                (2025-05-04)
 * Simple plug-in registry for canvas element types.
 * ------------------------------------------------------------------------- */

import type { CanvasElement } from '../../types';

/* View API v1 (ADR-0056): `ctx` is the sanctioned surface — the substrate
 * verbs + the board contract. `controller` is the legacy reach-in, still
 * passed for one increment so existing renderers keep working; new views
 * should take (el, _controller, ctx) and use only ctx. */
interface ElementView {
  mount: (el: CanvasElement, controller: any, ctx?: any) => HTMLElement;
  update?: (el: CanvasElement, dom: HTMLElement, controller: any, ctx?: any) => void;
  unmount?: (dom: HTMLElement) => void;
}

export function createRegistry() {
  const _views: Record<string, ElementView> = {};

  /** Register (or overwrite) a type */
  function register(type: string, view: ElementView): void {
    if (typeof type !== 'string' || !view || typeof view.mount !== 'function') {
      throw new Error('register(type, view) – type string & view.mount() required');
    }
    _views[type] = view;
  }

  /** Return the view object for a type, or undefined */
  function viewFor(type: string): ElementView | undefined {
    return _views[type];
  }

  /** Shallow copy of the currently known set */
  function listTypes(): string[] {
    return Object.keys(_views);
  }

  return { register, viewFor, listTypes };
}

/* single shared instance -------------------------------------------------- */
export const elementRegistry = createRegistry();

/* make dynamic registration trivial for inline <script>                     */
if (typeof window !== 'undefined') {
  (window as any).registerElementType = elementRegistry.register;
}

/* -- Typing hint -----------------------------------------------------------
 * An ElementView is just a plain object with three lifecycle hooks:
 *   mount(el, controller)  -> HTMLElement   (called once)
 *   update(el, dom, controller)             (called each change)
 *   unmount?(dom)                           (called when removed)           */
