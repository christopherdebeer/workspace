/* ---------------------------------------------------------------------------
 * home — client entry (the mount).
 *
 * The ONE module that pulls the kernel and react-dom/client (so the server bundle
 * never sees them). It installs the real kernel into the bridge, reads the
 * server's auth-aware SSR view model, and hydrates the markup the server painted
 * (`data-ssr`) — or cold-mounts when there's no SSR. `App` renders the same tree
 * on both sides; here we just attach it to the DOM and go interactive.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { App, type Session } from './app';
import { installBridge } from './bridge';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl } from './auth';

installBridge({ login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl });

/** The server's first-paint view model (the resolved session), if it SSR'd. */
function ssrSeed(): Session | undefined {
  const tag = document.getElementById('home-state');
  if (!tag?.textContent) return undefined;
  try {
    return JSON.parse(tag.textContent) as Session;
  } catch {
    return undefined;
  }
}

const el = document.getElementById('root');
if (el) {
  const initial = ssrSeed();
  if (el.dataset.ssr === '1') hydrateRoot(el, <App initial={initial} />);
  else {
    el.textContent = '';
    createRoot(el).render(<App initial={initial} />);
  }
}
