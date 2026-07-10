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
  const m = href.match(/^\/@([^/]+)\/([^/?#]+)(.*)$/);
  return m ? cellUrl(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3]) : href;
}
// Painted assets (data URIs via the dataurl loader): the dusk-valley hero,
// the dawn panorama strip, and the field computer.
export const heroUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/hero.jpg';
export const stripUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/strip.jpg';
export const computerUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/computer.webp';

const { useState, useEffect } = React;

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
          const res = await authFetch('/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
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
      // No client token, or whoami said 401/403: genuinely signed out.
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

/**
 * Invoke a capability through the gateway's MCP endpoint, exactly as an agent
 * would: `tools/call` with name=read|act and `{ target, input }`. Returns the
 * tool's JSON result (or its error text). This is the one call the whole page
 * is built on — the human drives read/act the same way the agent does.
 */
export async function mcpCall(verb: string, target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
  const res = await authFetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
    }),
  });
  if (!res.ok) return { ok: false, value: `HTTP ${res.status}` };
  const rpc = (await res.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (rpc.error) return { ok: false, value: rpc.error.message ?? 'error' };
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* not JSON — keep the raw text (e.g. an error message) */
  }
  return { ok: !rpc.result?.isError, value };
}

/** Resolve a `ui://` resource (a cell-authored renderer script) over the SAME
 *  authenticated `/mcp` endpoint `mcpCall` uses — the JSON-RPC `resources/read`
 *  method, the gateway's federation provider hop (ADR-0039). Returns its text
 *  content, or null. NEVER execute this text in home's own document — it is
 *  potentially third-party cell code; see `FederatedRendererFrame`, which runs
 *  it inside an isolated sandbox iframe instead (ADR-0041). */
export async function mcpResourceRead(uri: string): Promise<string | null> {
  try {
    const res = await authFetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'resources/read', params: { uri } }),
    });
    if (!res.ok) return null;
    const rpc = (await res.json()) as { result?: { contents?: Array<{ text?: string }> } };
    const text = rpc.result?.contents?.[0]?.text;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}
