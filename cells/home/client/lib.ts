/**
 * ADR-0044 Inc 5: shared client plumbing, split from app.tsx (moved verbatim) —
 * the auth/session bridge (useAuth), the mcp wire (mcpCall/mcpResourceRead/getJson),
 * origin-aware link localisation, and the painted-asset URLs.
 */
import * as React from 'react';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, refreshSessionCookie, cellUrl } from './bridge';

/**
 * Make an apex-style `/@owner/name<rest>` link origin-aware. Home now runs as a
 * cell on its own origin, where a bare `/@owner/name` path is re-prefixed by the
 * edge (→ 404); the kernel's `cellUrl` routes to the sibling subdomain instead.
 * Non-cell paths (already-absolute URLs, plain paths) pass through unchanged.
 */
export function localize(href: string | null | undefined): string {
  if (!href) return href ?? '';
  // `/r/<key>` is an APEX route (the ADR-0090 fact address; dispatch serves
  // it) — it does not exist on a cell's own `*.on.parc.land` origin, where a
  // relative href would 404 against the cell Lambda. Emit it apex-ABSOLUTE:
  // origin-independent, so the SAME markup is navigable at the apex and on a
  // cell subdomain, and server/client renders agree byte-for-byte (the server
  // can't always know which host it's being viewed from).
  if (href.startsWith('/r/')) return `https://parc.land${href}`;
  const m = href.match(/^\/@([^/]+)\/([^/?#]+)(.*)$/);
  return m ? cellUrl(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3]) : href;
}
// Painted assets (data URIs via the dataurl loader): the dusk-valley hero,
// the dawn panorama strip, and the field computer.
export const heroUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/hero.jpg';
// The chroma-keyed trailhead plate: a full-frame valley with a TRANSPARENT sky
// (real alpha, cut from a green-screen render), so the live graph shows through
// the exact painted silhouette. The dusk-sky gradient sits behind it.
export const heroCutUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/hero-cut.png';
export const stripUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/strip.jpg';
export const computerUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/computer.webp';

const { useState, useEffect } = React;

let rpcSequence = 0;
function nextRpcId(): string {
  rpcSequence += 1;
  return `home-${Date.now().toString(36)}-${rpcSequence.toString(36)}`;
}

async function timedAuthFetch(path: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await authFetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── the signed-out read credential (the @guest token) ──────────────────────
// A long-lived, READ-ONLY token for the `@guest` system user, injected into the
// anonymous boot by the server (home reads `_config/guest-token` over its own
// IAM slice-read). `@guest` holds no private grants, so its view is EXACTLY the
// owner's public slice — the token is public-safe by construction (a leak only
// ever exposes what's already shared to `public`). We attach it ONLY to data
// reads (mcpFetch below), never to identity resolution: whoami stays on
// `authFetch`, so a signed-out visitor is still reported signed-out and the
// landing/dashboard fork is unchanged — the guest token just makes the graph,
// search, and doc-reads return live public content instead of 401.
const MCP_ENDPOINT = 'https://parc.land/mcp';
let guestToken: string | null = null;
export function setGuestToken(token: string | null | undefined): void {
  guestToken = token && typeof token === 'string' ? token : null;
}
/** The kernel session has been DISPROVEN this page-life: its token drew a
 *  definitive 401/403 from /mcp. `isAuthed()` is presence-of-token, not
 *  validity — a stored access token whose refresh is gone/expired 401s forever
 *  and the kernel never clears it (the daily "normal tab broken, incognito
 *  fine" state: the dead credential shadows the injected guest token). Once
 *  disproven, data reads go straight to the guest path; a real sign-in
 *  navigates/reloads, which resets this. */
let sessionDisproven = false;

async function guestFetch(init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(MCP_ENDPOINT, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${guestToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The `/mcp` transport for DATA reads/acts: the session token when signed in,
 *  else the public `@guest` bearer if present, else the (token-less) authFetch
 *  path that 401s exactly as before. A definitive 401/403 on the session path
 *  RETRIES ONCE as `@guest` and marks the session disproven — degrading to the
 *  public view (guest reads are public-only by construction) instead of a page
 *  of dead-token 401s. */
async function mcpFetch(init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const authedPath = isAuthed() && !sessionDisproven;
  if (!authedPath && guestToken) return guestFetch(init, timeoutMs);
  const res = await timedAuthFetch('/mcp', init, timeoutMs);
  if ((res.status === 401 || res.status === 403) && guestToken) {
    // Degrade THIS PAGE-LIFE to the guest path — but keep the stored session.
    // This used to call localSignOut() here, which deleted the 30-day refresh
    // token over any 401/403 that survived authFetch's single retry — and that
    // retry can fail for reasons that are not the session's fault (a transient
    // error at the token endpoint, a momentary network wobble mid-refresh). A
    // 403 is not even a dead session: it is a live account that may not read
    // this, which guest covers. The durable tokens stay; the next boot (or the
    // next successful refresh) heals the session instead of finding it erased.
    sessionDisproven = true;
    return guestFetch(init, timeoutMs);
  }
  return res;
}

function decodeContent(content: Array<{ type?: string; text?: string; [key: string]: unknown }> | undefined): unknown {
  if (!content?.length) return null;
  const decoded = content.map((part) => {
    if (part.type !== 'text' || typeof part.text !== 'string') return part;
    try { return JSON.parse(part.text) as unknown; } catch { return part.text; }
  });
  return decoded.length === 1 ? decoded[0] : decoded;
}

// ─── auth/session ──────────────────────────────────────────────────

export interface Session {
  ready: boolean;
  user: string | null;
  scopes: string[];
  error: string | null;
}

/**
 * First-party sign-in state. Seeds from the server's auth-aware SSR view model
 * (`initial`) so the first client render matches the server markup (clean
 * hydration, no flash), then on mount completes an OAuth redirect if returning
 * and re-resolves identity from the same `whoami` an agent sees — the human and
 * the agent reading one identity. Returns helpers so the header can offer sign
 * in / sign out.
 *
 * The SSR verdict is AUTHORITATIVE, not a hint (owner direction 2026-07-10):
 * dispatch already validated the session cookie server-side, so the client only
 * *corrects* it on definitive evidence — a 401/403 from whoami (token truly
 * dead) or no client token at all. A transient failure (network, 5xx) keeps
 * the seeded state instead of bouncing a signed-in visitor to the landing.
 * The mount also re-mirrors the session cookie, so the SSR fork stays right on
 * the NEXT navigation even after the cookie's 1h Max-Age lapses.
 */
export function useAuth(initial?: Session): Session & { signIn: () => void; signOut: () => void } {
  const [s, setS] = useState<Session>(initial ?? { ready: false, user: null, scopes: [], error: null });

  useEffect(() => {
    let live = true;
    (async () => {
      let error: string | null = null;
      try {
        await completeLoginIfReturning();
      } catch (e) {
        error = (e as Error).message;
      }
      if (isAuthed()) {
        refreshSessionCookie();
        try {
          // Identity via the `whoami` MCP tool over POST /mcp — the CORS-enabled
          // endpoint (the bare GET /mcp/whoami isn't CORS'd for cell origins, so
          // it fails cross-origin now that home is a cell, not same-origin).
          const res = await timedAuthFetch('/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId(), method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
          });
          if (res.ok) {
            const rpc = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
            let b: { user?: string; userId?: string; scopes?: string[] } = {};
            try {
              b = JSON.parse(rpc.result?.content?.[0]?.text ?? '{}');
            } catch {
              /* non-JSON */
            }
            if (live) setS({ ready: true, user: b.user ?? b.userId ?? 'signed in', scopes: b.scopes ?? [], error });
            return;
          }
          if (res.status !== 401 && res.status !== 403) {
            // Transient (5xx, gateway hiccup): the token isn't disproven — keep
            // the SSR-seeded identity rather than flashing the landing.
            if (live) setS((prev) => ({ ...prev, ready: true, error: error ?? `whoami HTTP ${res.status}` }));
            return;
          }
        } catch (e) {
          // Network failure: same judgement — keep the seed.
          error = error ?? (e as Error).message;
          if (live) setS((prev) => ({ ...prev, ready: true, error }));
          return;
        }
      }
      // No client token, or whoami said 401/403: show this page as signed out
      // — but do NOT wipe the stored session here. The kernel's refresh path
      // owns that call now: it clears the tokens itself when the token
      // endpoint DEFINITIVELY rejects the refresh credential (invalid_grant),
      // and keeps them through anything transient. A 401 that reaches this
      // line can be either — and wiping on the transient half is how a
      // momentary auth-service wobble used to delete a 30-day grant. If the
      // session is truly dead, isAuthed() goes false on its own and every
      // read falls to @guest; if it was a wobble, the next authFetch heals it.
      if (live) setS({ ready: true, user: null, scopes: [], error });
    })();
    return () => {
      live = false;
    };
  }, []);

  return {
    ...s,
    signIn: () => {
      void login();
    },
    signOut: () => {
      void logout().then(() => window.location.reload());
    },
  };
}

export async function getJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(path, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

// ── transient-fault retry (reads only) ─────────────────────────────────────
// DynamoDB throttling (the single-partition ceiling), gateway 5xx, and edge
// hiccups all present as ONE-SHOT failures that the page then renders as
// absence: the layout read dies → positions default; an entry page dies → the
// graph looks empty or stalls. Reads are idempotent, so retry them with
// jittered backoff — the same TRANSIENT discipline the kernel gateway-client
// applies. Acts stay one-shot: a retried mutation could double-apply.
const TRANSIENT = [/HTTP 5\d\d/, /HTTP 429/, /throughput/i, /throttl/i, /rate ?limit/i, /timed out/i, /failed to fetch|networkerror|load failed/i];
const isTransientFailure = (value: unknown): boolean =>
  typeof value === 'string' && TRANSIENT.some((re) => re.test(value));
// Four attempts spread over ~7s of full-jitter backoff: a DynamoDB throttle
// window is seconds long, so a 300ms-base retry burns its attempts inside the
// same window and still fails. Matches the kernel gateway-client's pacing.
const READ_RETRIES = 4;
const retryDelayMs = (attempt: number): number => Math.round(500 * 2 ** attempt * (0.5 + Math.random() * 0.5));

/**
 * Invoke a capability through the gateway's MCP endpoint, exactly as an agent
 * would: `tools/call` with name=read|act and `{ target, input }`. Returns the
 * tool's JSON result (or its error text). This is the one call the whole page
 * is built on — the human drives read/act the same way the agent does.
 * Reads retry transient failures (throttling, 5xx) before reporting them.
 */
export async function mcpCall(verb: 'read' | 'act', target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
  let out = await mcpCallOnce(verb, target, input);
  for (let attempt = 0; verb === 'read' && !out.ok && isTransientFailure(out.value) && attempt < READ_RETRIES; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    out = await mcpCallOnce(verb, target, input);
  }
  return out;
}

async function mcpCallOnce(verb: 'read' | 'act', target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
  const requestId = nextRpcId();
  if (!target || target.length > 256) return { ok: false, value: 'invalid capability target' };
  try {
    const res = await mcpFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
      }),
    });
    if (!res.ok) return { ok: false, value: `HTTP ${res.status} (request ${requestId})` };
    const rpc = (await res.json()) as {
      result?: {
        structuredContent?: unknown;
        content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
        isError?: boolean;
      };
      error?: { message?: string; code?: number };
    };
    if (rpc.error) return { ok: false, value: `${rpc.error.message ?? 'RPC error'} (request ${requestId})` };
    const value = rpc.result && Object.prototype.hasOwnProperty.call(rpc.result, 'structuredContent')
      ? rpc.result.structuredContent
      : decodeContent(rpc.result?.content);
    return { ok: !rpc.result?.isError, value };
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'request timed out'
      : String((error as Error)?.message ?? error);
    return { ok: false, value: `${message} (request ${requestId})` };
  }
}

/** Resolve a `ui://` resource (a cell-authored renderer script) over the SAME
 *  authenticated `/mcp` endpoint `mcpCall` uses — the JSON-RPC `resources/read`
 *  method, the gateway's federation provider hop (ADR-0039). Returns its text
 *  content, or null. NEVER execute this text in home's own document — it is
 *  potentially third-party cell code; see `FederatedRendererFrame`, which runs
 *  it inside an isolated sandbox iframe instead (ADR-0041). */
export async function mcpResourceRead(uri: string): Promise<string | null> {
  if (!uri.startsWith('ui://') || uri.length > 1024 || /[\u0000-\u0020]/.test(uri)) return null;
  try {
    const res = await mcpFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId(), method: 'resources/read', params: { uri } }),
    }, 15000);
    if (!res.ok) return null;
    const rpc = (await res.json()) as { result?: { contents?: Array<{ text?: string }> }; error?: unknown };
    if (rpc.error) return null;
    const text = rpc.result?.contents?.[0]?.text;
    return typeof text === 'string' && text.length <= 1000000 ? text : null;
  } catch {
    return null;
  }
}
