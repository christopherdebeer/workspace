/* ---------------------------------------------------------------------------
 * Kernel boundary — why this exists.
 *
 * The component tree (`app.tsx`) is rendered on BOTH sides: server-side via
 * `renderToString` (the auth-aware first paint) and client-side via
 * `hydrateRoot`. The kernel (`@c15r/kernel/app.js`) touches `window`/`document`
 * at import time (it calls `moduleAlive()` at module top), and its deployed build
 * pulls React from esm.sh — so importing it into the SERVER bundle crashes and
 * doubles React. The fix: `app.tsx` calls the kernel ONLY through this bridge,
 * which has no static kernel import, so the server module graph stays kernel-free.
 *
 * The CLIENT entry installs the real kernel before mounting; the SERVER installs a
 * host-aware stub. Only `cellUrl` is used during render (link localization), so it
 * must produce identical output on both sides for a clean hydration — the server
 * install replicates the kernel's host logic from the request Host header.
 * ------------------------------------------------------------------------- */

export interface KernelBridge {
  login(): void | Promise<unknown>;
  logout(): Promise<void>;
  completeLoginIfReturning(): Promise<boolean>;
  authFetch(path: string, init?: RequestInit): Promise<Response>;
  isAuthed(): boolean;
  cellUrl(owner: string, name: string, rest?: string): string;
}

const notInstalled = (): never => {
  throw new Error('kernel bridge not installed');
};

let impl: KernelBridge = {
  login: notInstalled,
  logout: async () => notInstalled(),
  // Server-safe defaults: the effects/handlers that use these never run during
  // SSR (renderToString skips effects), so the stubs are only ever exercised if
  // someone forgets to install the real kernel on the client.
  completeLoginIfReturning: async () => false,
  authFetch: async () => notInstalled(),
  isAuthed: () => false,
  // Apex-form path by default; the server install overrides with the request
  // host, the client install with the kernel's `cellUrl`.
  cellUrl: (owner: string, name: string, rest = '') => `/@${owner}/${name}${rest}`,
};

/** Wire the kernel (client) or a host-aware stub (server) before render/mount. */
export function installBridge(b: Partial<KernelBridge>): void {
  impl = { ...impl, ...b };
}

export const login = (): void | Promise<unknown> => impl.login();
export const logout = (): Promise<void> => impl.logout();
export const completeLoginIfReturning = (): Promise<boolean> => impl.completeLoginIfReturning();
export const authFetch = (path: string, init?: RequestInit): Promise<Response> => impl.authFetch(path, init);
export const isAuthed = (): boolean => impl.isAuthed();
export const cellUrl = (owner: string, name: string, rest = ''): string => impl.cellUrl(owner, name, rest);
