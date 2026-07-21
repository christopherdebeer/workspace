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
import { App, type Boot } from './app';
import { installBridge } from './bridge';
import { setGuestToken } from './lib';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl, refreshSessionCookie } from './auth';

installBridge({ login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl, refreshSessionCookie });

/** The server's first-paint seed (session + layout + dashboard), if it SSR'd. */
function ssrSeed(): Boot | undefined {
  const tag = document.getElementById('home-state');
  if (!tag?.textContent) return undefined;
  try {
    return JSON.parse(tag.textContent) as Boot;
  } catch {
    return undefined;
  }
}

const el = document.getElementById('root');

if (el) {
  const initial = ssrSeed();
  // The signed-out read credential (public @guest token), if the server injected
  // it — used by data reads while anonymous; a no-op for signed-in visitors.
  setGuestToken(initial?.guestToken);
  // NOTE: the trailhead's dusk-sky is a GRADIENT, and it lives in the landing
  // (dashboard.tsx SkyGradient), not here — bootstrap shouldn't own visual
  // theme, and the sky must dissolve to the night graph on enter (a color
  // transition, not just an opacity pop), which this bootstrap can't drive.
  if (el.dataset.ssr === '1') hydrateRoot(el, <App initial={initial} />);
  else {
    el.textContent = '';
    createRoot(el).render(<App initial={initial} />);
  }
}
