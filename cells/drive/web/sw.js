/**
 * THE APP SHELL, SO THE WEB BUILD CAN START WITH THE NETWORK OFF.
 *
 * Both native shells carry `dist/web` inside the application and serve it from
 * a local origin, so they have always started offline. The browser had nothing:
 * an installed PWA with no service worker is a bookmark, and with the radio off
 * it gets the browser's error page before a line of this game runs. That is the
 * one thing only a service worker can fix, and it is the ONLY thing this one
 * is for.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ──
 *
 * Every world fetch — `/~/osm`, `/~/cover`, `/~/campaign`, and the heights from
 * the two elevation hosts — passes straight through to the network. Those are
 * already cached, in IndexedDB, by the code that knows what a tile IS: it can
 * prune by bytes, it can throw away a tile whose stored form will not decode,
 * and it works identically in Electron and Capacitor, where a service worker
 * on a custom scheme is at best unreliable. Answering them here as well would
 * mean two copies of every tile under two eviction policies that disagree.
 * `/state`, `/tape` and `/probe/` are live by definition and must fail honestly
 * rather than answer from yesterday.
 *
 * ── WHY ONE CACHE PER BUILD, AND WHY IT MAY SKIP WAITING ──
 *
 * The page and the bundle have to move together: an old shell with a new
 * `app.js` is a combination nobody tested. So the cache is named for the
 * deployed bundle — the cell stamps BUILD below with a hash of the `app.js` it
 * is serving — and a new deploy is a new cache, filled completely before it
 * replaces the old one. There is no half-swapped state to be in.
 *
 * `skipWaiting` is normally a mistake, because it swaps the cache under a page
 * that is still lazily loading chunks out of it. Drive has no chunks: one
 * `app.js`, fully loaded before the menu appears, and every later request is
 * world data this worker does not answer. So the update can land on the next
 * reload instead of waiting for every tab to close. IF THAT EVER STOPS BEING
 * TRUE — the day the bundle is split, or a lab is loaded on demand — this line
 * has to go with it.
 */
const BUILD = '__DRIVE_SW_BUILD__';
const CACHE = `drive-shell-${BUILD}`;

/**
 * Everything needed to reach the menu with no network. `/` is the page: the
 * cell serves the SAME shell for every path it does not recognise, which is
 * what lets one cached entry answer `/`, `/lab/hydro` and a spawn URL alike.
 */
const SHELL = [
  '/',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/drive-32.png',
  '/icons/drive-180.png',
  '/icons/drive-192.png',
  '/icons/drive-512.png',
  '/icons/drive-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // `addAll` is atomic on purpose: a shell that is missing its bundle is worse
  // than no shell, because the browser would then have a cached page that
  // cannot start and no reason to ask for a better one.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('drive-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Is this request part of the app shell, rather than part of the world? */
function isShell(request, url) {
  if (request.mode === 'navigate') return true;
  return SHELL.includes(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isShell(request, url)) return;
  event.respondWith(shellResponse(request, url));
});

async function shellResponse(request, url) {
  const cache = await caches.open(CACHE);
  // A navigation is answered by the one shell entry whatever its path or query
  // — the spawn coordinates, `?fixture=`, a lab route. The client reads
  // `location` for itself; the HTML is the same bytes either way.
  const key = request.mode === 'navigate' ? '/' : url.pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // `basic` means same-origin and readable. An opaque or errored response
    // stored here would be served back as a broken page forever.
    if (res.ok && res.type === 'basic') await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const shell = await cache.match('/');
    if (shell && request.mode === 'navigate') return shell;
    throw err;
  }
}
