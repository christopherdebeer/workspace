/* ---------------------------------------------------------------------------
 *  url.ts — machine URLs are PATH-based (mirrors cells/canvas/client/lib/url.ts).
 *  A machine lives at `/@<owner>/machine/m/<slug>` and a run at
 *  `/@<owner>/machine/r/<runKey>` (the run key's `/`s become path segments), NOT
 *  in the hash. The win is structural: the kernel's OAuth round-trip uses
 *  `redirect_uri = origin + pathname`, so a deep link survives sign-in intact,
 *  and dispatch can SSR the path (the hash never reaches the server).
 *
 *  This module is the ONE place that reads/writes the route↔URL mapping. The
 *  mount prefix is derived from the live path, so it's correct on whichever host
 *  served us (apex `/@<owner>/machine`, or `''` on a cell host).
 * ------------------------------------------------------------------------- */

export interface Route {
  view: 'list' | 'machine' | 'run';
  /** machine slug (view === 'machine') */
  name?: string;
  /** full run key `machine/<m>/run/<run>` (view === 'run') */
  runKey?: string;
}

/** Fired after an in-app `navigate()` so the route hook re-reads (pushState,
 *  unlike back/forward, emits no popstate). */
export const NAV_EVENT = 'machine:nav';

const dec = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/** The cell mount prefix for the current origin: `/@<owner>/machine` on the apex,
 *  or `''` on a cell host. Empty during SSR (no `location`). */
export function machineBase(): string {
  if (typeof location === 'undefined') return '';
  const m = location.pathname.match(/^\/@[^/]+\/[^/]+/);
  return m ? m[0] : '';
}

/** Cell-relative path for the list / a machine / a run. */
export const restHome = (): string => '/';
export const restMachine = (name: string): string => `/m/${encodeURIComponent(name)}`;
export const restRun = (runKey: string): string => `/r/${runKey.split('/').map(encodeURIComponent).join('/')}`;

/** Parse a CELL-RELATIVE path (mount already stripped) into a route. Handles both
 *  per-segment-encoded run keys (`/r/machine/m/run/x`) and a wholesale-encoded one
 *  (`/r/machine%2Fm%2Frun%2Fx`, what the type handler's `${key}` produces). */
export function parseRoute(relPath: string): Route {
  const segs = relPath.split('/').filter(Boolean);
  if (segs[0] === 'm' && segs.length >= 2) return { view: 'machine', name: segs.slice(1).map(dec).join('/') };
  if (segs[0] === 'r' && segs.length >= 2) return { view: 'run', runKey: segs.slice(1).map(dec).join('/') };
  return { view: 'list' };
}

/** The current route from `location`, stripping the mount prefix (client only). */
export function currentRoute(): Route {
  if (typeof location === 'undefined') return { view: 'list' };
  return parseRoute(location.pathname.slice(machineBase().length));
}

/** SPA navigation to a cell-relative rest path: pushState under the live mount +
 *  notify the route hook. No-op during SSR. */
export function navigate(rest: string): void {
  if (typeof history === 'undefined') return;
  history.pushState({}, '', `${machineBase()}${rest}`);
  window.dispatchEvent(new Event(NAV_EVENT));
}
