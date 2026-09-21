/**
 * SIGNING IN, AND WHAT IT BUYS.
 *
 * Progress lives on the device. This makes a durable copy of it for a player
 * who signs in, and nothing else — the game never waits on it, never blocks on
 * it, and plays exactly the same without it. Anonymous play is unchanged, which
 * is the owner's first decision in `docs/drive-persistence.md`.
 *
 * WHAT SIGNING IN COSTS THE PLAYER: their username, and nothing more.
 *
 * That is not a hope, it is arithmetic. `cellCeiling()` in
 * `services/auth/oauth.ts` caps a token minted for a cell host to
 * `workspace:read`, `workspace:write` and `cell:<owner>/<name>:*` — but the
 * ceiling is an INTERSECTION with what was asked for:
 *
 *     effectiveScope = intersectScopes(requested, ceiling)
 *
 * So this asks for `cell:c15r/drive:*` ALONE and receives exactly that. It never
 * asks for `workspace:read`, never asks for `workspace:write`, and cannot be
 * handed either by a consent screen someone clicks through. On the other side,
 * `services/cells/service.ts` gives the cell `x-cell-caller` — a validated
 * identity string — and never the token itself. A driving game therefore learns
 * who you are and holds no authority over your workspace at all.
 *
 * **If a future change here needs `workspace:*`, the game's isolation has been
 * abandoned and `docs/drive-persistence.md` is wrong.** That is the line.
 *
 * WHAT IS MIRRORED: claimed roads and their counts. Not the crumbs. The 20,000
 * checkpoint keys are a local working detail that regenerates by driving; what
 * a player would grieve is a claimed road, and that is one small row. Merging
 * is a union and a max in both directions, because progress only ever goes up —
 * so two devices converge with no clock, no vector, and no conflict to resolve.
 *
 * ORIGIN TOPOLOGY (`docs/cell-origin-isolation.md`): the page runs on the cell's
 * own host, `c15r-drive.on.parc.land`. `/state` is same-origin, so `'self'`
 * covers it. Only the OAuth endpoints live on the apex, which is the one thing
 * the CSP's `connect-src` needs `https://parc.land` for.
 */

const APEX = 'https://parc.land';
const CELL_DOMAIN = 'on.parc.land';
const K = {
  tok: 'drive.sync.token',
  ref: 'drive.sync.refresh',
  client: 'drive.sync.client',
  pkce: 'drive.sync.pkce',
  state: 'drive.sync.state',
  ret: 'drive.sync.ret',
  at: 'drive.sync.at',
};

export interface SyncStatus {
  /** `off` — not signed in · `busy` — a round trip is in flight · `on` — synced
   *  · `blocked` — signed in, but this account may not write here · `error`. */
  phase: 'off' | 'busy' | 'on' | 'blocked' | 'error';
  user: string | null;
  /** Wall clock of the last successful sync, 0 if never. */
  at: number;
  /** One line for the menu — what just happened, in words. */
  note: string;
  roads: number;
}
/** Rows on the wire: counts and claims, never crumbs. */
export type SyncRows = Record<string, { g: number; t: number; c?: number }>;
/** Latched events on the wire — missions completed, stations woken. Each is an
 *  id and the wall-clock moment it FIRST happened; the merge is union-and-min
 *  on both sides, so the earliest truth wins from any order. */
export interface SyncMarks { missions: Record<string, number>; stations: Record<string, number> }
export interface SyncPorts {
  /** Everything worth mirroring that changed since `since`. */
  dump(since: number): SyncRows;
  /** Fold the durable copy back in. Returns how many records it changed. */
  merge(rows: SyncRows): number;
  marks(since: number): SyncMarks;
  mergeMarks(rows: Partial<SyncMarks>): number;
  /** Total distance, the other monotonic number. */
  odo(): number;
  setOdo(m: number): void;
}

const rand = (n: number): string =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const local = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string): void => { try { localStorage.removeItem(k); } catch { /* */ } },
};
const sess = {
  get: (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { sessionStorage.setItem(k, v); } catch { /* */ } },
  del: (k: string): void => { try { sessionStorage.removeItem(k); } catch { /* */ } },
};

/** The authorization code this load came back with, if any. */
let returned: { code: string; state: string | null } | null = null;

/**
 * PUT THE PLAYER'S URL BACK, BEFORE ANYTHING READS IT.
 *
 * The redirect lands on `?code=…&state=…`, which has replaced a URL that says
 * where the truck is, which way it is facing, what the weather is doing and
 * which job is armed. Every one of those is read straight off `location.search`
 * — some of it while this module's siblings are still initialising — so the
 * restore cannot wait for the token exchange. It is synchronous, it is the
 * first thing the game does, and the code is kept in memory to be spent later.
 *
 * Call it before any other module reads the query string.
 */
export function restoreUrl(): void {
  let q: URLSearchParams;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const code = q.get('code');
  if (!code) return;
  returned = { code, state: q.get('state') };
  const back = sess.get(K.ret);
  sess.del(K.ret);
  try {
    history.replaceState({}, '', back && back.startsWith(location.origin) ? back : location.pathname);
  } catch { /* a URL we cannot rewrite is cosmetic, not fatal */ }
}

export interface Sync {
  status(): SyncStatus;
  /** Is this load carrying an authorization code back from the apex? */
  returning(): boolean;
  /** Signed in, as far as this boot can tell WITHOUT the network: a stored
   *  token, or a sign-in finishing on this very load. Optimistic — a stale
   *  token still answers true here and is found out on the first sync — which
   *  is the right bias for anything gated on it: the gate opens, the game
   *  plays, and the player is asked to sign in again rather than locked out
   *  offline. */
  signedIn(): boolean;
  signIn(): Promise<void>;
  signOut(): void;
  /** Finish a sign-in if one is in flight, then mirror once. Safe to call on
   *  every boot; does nothing at all when signed out. */
  start(): Promise<void>;
  /** Mirror now — push what changed, take back what the other device knew. */
  sync(reason?: string): Promise<void>;
  /** Something worth keeping just happened. Mirrors soon, not now. */
  nudge(): void;
  /** The campaign reset's durable half: DELETE the mirrored marks (missions
   *  and stations — roads and the odometer stay). Resolves true only when the
   *  server actually confirmed, so the caller can say honestly whether a
   *  later sync might restore what was just cleared locally. */
  reset(): Promise<boolean>;
  /** Bank a kept tape durably (and shareably — the URL is public). */
  bank(tape: unknown): Promise<{ ok: boolean; url?: string; kept?: number; why?: string }>;
  /** The shelf of banked runs, as of the last sync. Empty until one lands. */
  tapes(): TapeShelfRow[];
  /** File an authored entry for one z16 tile (an empty list retracts it).
   *  The cell's own grant decides who may: owner or shared principal. */
  author(entry: { tile: string; ways?: unknown[]; patch?: Record<string, Record<string, string>>; dems?: Array<[number, number, number]> }): Promise<{ ok: boolean; rev?: number; n?: number; url?: string; why?: string }>;
}

export interface TapeShelfRow {
  id: string; at: number; secs: number; steps: number; lat: number; lon: number;
}

export function openSync(ports: SyncPorts, opts: {
  base?: string;
  apex?: string;
  authMode?: 'redirect' | 'device';
  openExternal?: (url: string) => Promise<void>;
  closeExternal?: () => Promise<void>;
} = {}): Sync {
  const base = opts.base ?? '';               // same origin as the page
  const apex = opts.apex ?? APEX;
  const authMode = opts.authMode ?? 'redirect';
  /** The scope, and the whole of it. See the head of this file. */
  const scopeFor = (): string => {
    const host = location.host;
    if (host.endsWith('.' + CELL_DOMAIN)) {
      const label = host.slice(0, -(CELL_DOMAIN.length + 1));
      const i = label.indexOf('-');                  // owners are hyphen-free
      if (i > 0) return `cell:${label.slice(0, i)}/${label.slice(i + 1)}:*`;
    }
    const m = location.pathname.match(/^\/@([^/]+)\/([^/]+)/);
    return m ? `cell:${m[1]}/${m[2]}:*` : 'cell:c15r/drive:*';
  };
  const redirect = (): string => `${location.origin}${location.pathname.replace(/\/+$/, '')}`;

  let token = local.get(K.tok);
  let user: string | null = null;
  let phase: SyncStatus['phase'] = token ? 'busy' : 'off';
  let note = token ? 'signed in' : 'progress stays on this device';
  let roads = 0;
  let shelf: TapeShelfRow[] = [];
  let at = Number(local.get(K.at)) || 0;
  let inFlight: Promise<void> | null = null;
  let soon: ReturnType<typeof setTimeout> | null = null;

  const set = (p: SyncStatus['phase'], n: string): void => { phase = p; note = n; };

  async function ensureClient(): Promise<string> {
    const cached = local.get(K.client);
    if (cached) return cached;
    const res = await fetch(`${apex}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [location.origin, redirect()],
        client_name: 'drive',
        token_endpoint_auth_method: 'none',
      }),
    });
    const j = (await res.json()) as { client_id?: string; error?: string };
    if (!j.client_id) throw new Error(j.error ?? 'registration refused');
    local.set(K.client, j.client_id);
    return j.client_id;
  }

  async function redirectSignIn(): Promise<void> {
    const clientId = await ensureClient();
    const verifier = rand(32);
    const state = rand(16);
    sess.set(K.pkce, verifier);
    sess.set(K.state, state);
    sess.set(K.ret, location.href);          // …restored by `restoreUrl` on the way back
    const u = new URL('/oauth/authorize', apex);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirect());
    u.searchParams.set('code_challenge', await sha256(verifier));
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('scope', scopeFor());
    u.searchParams.set('state', state);
    location.assign(u.toString());
  }

  /**
   * Native shells cannot safely receive an HTTPS redirect and a custom scheme
   * would no longer identify this cell to the scope ceiling. RFC 8628 is the
   * right native shape: approve in the system browser, then poll from the app.
   */
  async function deviceSignIn(): Promise<void> {
    if (!opts.openExternal) throw new Error('this build cannot open the approval page');
    set('busy', 'starting sign-in…');
    const init = await fetch(`${apex}/auth/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: scopeFor() }),
    });
    const d = (await init.json().catch(() => ({}))) as {
      device_code?: string;
      user_code?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
    };
    if (!init.ok || !d.device_code || !d.user_code || !d.verification_uri_complete) {
      throw new Error(d.error ?? `sign-in failed (${init.status})`);
    }

    set('busy', `approve ${d.user_code} in the browser`);
    await opts.openExternal(d.verification_uri_complete);
    const expiresAt = Date.now() + Math.max(30, d.expires_in ?? 600) * 1000;
    const every = Math.max(2, d.interval ?? 5) * 1000;
    try {
      while (Date.now() < expiresAt) {
        await new Promise<void>((resolve) => setTimeout(resolve, every));
        let res: Response;
        try {
          res = await fetch(`${apex}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              device_code: d.device_code,
            }),
          });
        } catch {
          set('busy', `waiting for ${d.user_code}…`);
          continue;
        }
        const j = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          refresh_token?: string;
          error?: string;
          error_description?: string;
        };
        if (j.error === 'authorization_pending') continue;
        if (!res.ok || !j.access_token) {
          throw new Error(j.error_description ?? j.error ?? `sign-in failed (${res.status})`);
        }
        token = j.access_token;
        local.set(K.tok, token);
        if (j.refresh_token) local.set(K.ref, j.refresh_token); else local.del(K.ref);
        await once('syncing…');
        return;
      }
    } finally {
      await opts.closeExternal?.().catch(() => undefined);
    }
    throw new Error('sign-in approval expired');
  }

  async function signIn(): Promise<void> {
    try {
      if (authMode === 'device') await deviceSignIn();
      else await redirectSignIn();
    } catch (err) {
      set('error', (err as Error).message);
    }
  }

  /** Spend the code `restoreUrl` caught. */
  async function finish(): Promise<void> {
    const got = returned;
    returned = null;
    if (!got) return;
    const expect = sess.get(K.state), verifier = sess.get(K.pkce);
    sess.del(K.state); sess.del(K.pkce);
    // A code that came back with the wrong state, or with no verifier waiting
    // for it, is not this game's sign-in. Drop it rather than spend it.
    if (!expect || got.state !== expect || !verifier) { set('error', 'sign-in did not match'); return; }
    const res = await fetch(`${apex}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: got.code,
        redirect_uri: redirect(),
        code_verifier: verifier,
        client_id: local.get(K.client),
      }),
    });
    const j = (await res.json()) as {
      access_token?: string; refresh_token?: string; error?: string; error_description?: string;
    };
    if (!j.access_token) throw new Error(j.error_description ?? j.error ?? 'sign-in refused');
    token = j.access_token;
    local.set(K.tok, token);
    // THE REFRESH TOKEN IS THE SIGN-IN. The access token lives about an hour;
    // the refresh credential carries the grant the player actually chose (30
    // days by default). This line used to be missing, and its absence WAS the
    // \"I keep getting signed out\" report: the first sync after the hour got a
    // 401 and the session was wiped, refresh token thrown away unspent.
    if (j.refresh_token) local.set(K.ref, j.refresh_token); else local.del(K.ref);
  }

  /** Everything a signed-out state means, in one place — so no failure path
   *  can half-forget a session (wipe the access token, strand the refresh). */
  function dropSession(): void {
    token = null; user = null;
    local.del(K.tok); local.del(K.ref);
  }

  /**
   * Re-mint the access token from the stored refresh credential.
   * SINGLE-FLIGHT: a burst of syncs that all 401 at once must share one round
   * trip, not race the token endpoint. Three honest outcomes:
   *   'ok'   — refreshed, `token` is fresh, retry the call.
   *   'dead' — the SERVER rejected the refresh token (HTTP 400/401,
   *            invalid_grant): the session is over, sign out.
   *   'soft' — the attempt could not be judged (offline, a 429/5xx at the
   *            token endpoint): KEEP the session and let the caller's normal
   *            error/backoff path retry later. A transient wobble at the auth
   *            service must never cost a 30-day grant.
   */
  let refreshing: Promise<'ok' | 'dead' | 'soft'> | null = null;
  function refreshTok(): Promise<'ok' | 'dead' | 'soft'> {
    refreshing ??= (async (): Promise<'ok' | 'dead' | 'soft'> => {
      const rt = local.get(K.ref);
      if (!rt) return 'dead';                  // nothing to refresh with
      let res: Response;
      try {
        res = await fetch(`${apex}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt, client_id: local.get(K.client) }),
        });
      } catch { return 'soft'; }
      const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
      if (!j.access_token) return res.status === 400 || res.status === 401 ? 'dead' : 'soft';
      token = j.access_token;
      local.set(K.tok, token);
      // The refresh credential is STABLE server-side (ADR-0080), but store
      // whatever came back so a future rotation change costs nothing here.
      if (j.refresh_token) local.set(K.ref, j.refresh_token);
      return 'ok';
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<{
    user?: string; roads?: SyncRows; odo?: number; error?: string;
    missions?: Record<string, number>; stations?: Record<string, number>;
    tapes?: TapeShelfRow[];
  }> {
    const hit = (): Promise<Response> => fetch(`${base}/state`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let res = await hit();
    // A 401 is the access token AGING OUT an hour after the last mint, not the
    // player signing out — refresh and retry once before believing otherwise.
    // Only a refresh the SERVER rejects (or a 401 that survives a fresh token,
    // which means the grant itself no longer covers this) ends the session;
    // an unjudgeable attempt stays signed in and rides the normal backoff.
    if (res.status === 401) {
      const r = await refreshTok();
      if (r === 'soft') throw new Error('token refresh unavailable — will retry');
      if (r === 'ok') res = await hit();
    }
    const j = (await res.json().catch(() => ({}))) as { user?: string; roads?: SyncRows; odo?: number; error?: string };
    if (res.status === 401) { throw Object.assign(new Error(j.error ?? 'signed out'), { stale: true }); }
    // A signed-in player who is not the cell's owner and holds no grant cannot
    // write here — that is the platform's own sharing model, not a rule this
    // game invents, and it is a dead end rather than a failure to retry.
    if (res.status === 403) { throw Object.assign(new Error(j.error ?? 'no room for this account'), { blocked: true }); }
    if (!res.ok) throw new Error(j.error ?? `sync failed (${res.status})`);
    return j;
  }

  async function once(reason: string): Promise<void> {
    if (!token) return;
    set('busy', reason);
    try {
      // One round trip does both halves: everything this device has learned
      // since the last sync goes up, and the merged whole comes back — which is
      // how a second device's progress arrives.
      const out = await call('POST', { roads: ports.dump(at), ...ports.marks(at), odo: ports.odo() });
      user = out.user ?? user;
      if (out.roads) roads = Object.keys(out.roads).length;
      const changed = (out.roads ? ports.merge(out.roads) : 0)
        + ports.mergeMarks({ missions: out.missions, stations: out.stations });
      if (typeof out.odo === 'number') ports.setOdo(out.odo);
      // The banked-run shelf rides the same round trip. Kept whole — it is the
      // server's truth, not a merge.
      if (Array.isArray(out.tapes)) shelf = out.tapes;
      at = Date.now();
      local.set(K.at, String(at));
      set('on', changed ? `${roads} roads · ${changed} restored` : `${roads} roads`);
    } catch (err) {
      const e = err as Error & { stale?: boolean; blocked?: boolean };
      if (e.stale) {
        // The token expired or was revoked. Forget it rather than retry with
        // it — the game keeps playing, the player signs in again when they
        // feel like it.
        dropSession();
        set('off', 'signed out — progress stays on this device');
      } else if (e.blocked) {
        set('blocked', e.message);
      } else {
        // Offline is the common case and it is not an error worth shouting
        // about: the local copy is authoritative and this will try again.
        set('error', e.message);
      }
    }
  }

  const run = (reason: string): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = once(reason).finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    status: (): SyncStatus => ({ phase, user, at, note, roads }),
    returning: (): boolean => !!returned,
    signedIn: (): boolean => !!token || !!returned,
    signIn,
    signOut(): void {
      dropSession();
      at = 0;
      local.del(K.at);
      set('off', 'progress stays on this device');
    },
    async start(): Promise<void> {
      if (returned) {
        set('busy', 'finishing sign-in…');
        try { await finish(); } catch (err) { set('error', (err as Error).message); return; }
      }
      if (token) await run('syncing…');
    },
    sync: (reason = 'syncing…'): Promise<void> => run(reason),
    tapes: (): TapeShelfRow[] => shelf,
    async author(entry): Promise<{ ok: boolean; rev?: number; n?: number; url?: string; why?: string }> {
      if (!token) return { ok: false, why: 'SIGN IN TO AUTHOR THE WORLD' };
      const hit = (): Promise<Response> => fetch(`${base}/authored`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(entry),
      });
      try {
        let res = await hit();
        if (res.status === 401) {
          const r = await refreshTok();
          if (r === 'ok') res = await hit();
          else return { ok: false, why: r === 'dead' ? 'SIGNED OUT — SIGN IN AGAIN' : 'SYNC UNREACHABLE — TRY AGAIN' };
        }
        // A 403 is the tier above: signed in, but this account holds no grant
        // on the drive cell. Said plainly, because it is the one answer here
        // that no retry will change.
        if (res.status === 403) return { ok: false, why: 'THIS ACCOUNT MAY NOT AUTHOR HERE' };
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; rev?: number; n?: number; url?: string; error?: string };
        if (!res.ok || !j.ok) return { ok: false, why: (j.error ?? `author failed (${res.status})`).toUpperCase() };
        return { ok: true, rev: j.rev, n: j.n, url: j.url };
      } catch {
        return { ok: false, why: 'OFFLINE — NOTHING WAS FILED' };
      }
    },
    async bank(tape: unknown): Promise<{ ok: boolean; url?: string; kept?: number; why?: string }> {
      if (!token) return { ok: false, why: 'SIGN IN TO BANK A TAPE' };
      const hit = (): Promise<Response> => fetch(`${base}/tape`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(tape),
      });
      try {
        let res = await hit();
        // The same courtesy /state gets: an aged access token refreshes once
        // before anyone is told they are signed out.
        if (res.status === 401) {
          const r = await refreshTok();
          if (r === 'ok') res = await hit();
          else return { ok: false, why: r === 'dead' ? 'SIGNED OUT — SIGN IN AGAIN' : 'SYNC UNREACHABLE — TRY AGAIN' };
        }
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; kept?: number; error?: string };
        if (!res.ok || !j.ok) return { ok: false, why: (j.error ?? `bank failed (${res.status})`).toUpperCase() };
        return { ok: true, url: j.url, kept: j.kept };
      } catch {
        return { ok: false, why: 'OFFLINE — THE TAPE STAYS ON THIS DEVICE' };
      }
    },
    async reset(): Promise<boolean> {
      if (!token) return false;
      try {
        await call('DELETE');
        return true;
      } catch (err) {
        const e = err as Error & { stale?: boolean };
        if (e.stale) { dropSession(); set('off', 'signed out — progress stays on this device'); }
        return false;
      }
    },
    nudge(): void {
      if (!token || soon) return;
      // A claim is worth keeping, and it is also the moment a player is most
      // likely to close the tab. Soon, not now: a run of claims down one road
      // is one round trip.
      soon = setTimeout(() => { soon = null; void run('syncing…'); }, 8000);
    },
  };
}
