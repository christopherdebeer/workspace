/**
 * Auth cell client — the passkey authorize + OAuth consent SPA.
 *
 * Replaces the old hand-rolled HTML page with a React app built from the shared
 * `platform/ui` kit. It drives WebAuthn sign-in/registration, then either:
 *   - OAuth (client_id present): shows a **scope picker** (only scopes the signed-in
 *     user may grant) and posts consent; or
 *   - Device grant (user_code present): approves the device code.
 *
 * Bundled to `app.js` by esbuild at deploy time (HttpServiceCell `clientEntry`)
 * and served by the auth cell at `/auth/app.js`.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Page, Card, Heading, Badge, Button, TextInput, Checkbox, theme } from '../../../platform/ui';
import { friendlyError, requesterIdentity } from './copy';

const { useState, useEffect, useCallback } = React;

interface Params {
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
  user_code?: string;
  /** `web_message` = we are embedded (sheet/popup): post the result to the
   *  embedder instead of navigating. Anything else keeps the redirect. */
  response_mode?: string;
}

/** Capability metadata for a scope (served by /auth/grantable; see oauth.ts). */
interface ScopeMeta {
  verb: 'read' | 'write' | 'admin';
  title: string;
  description: string;
}
/** The consent groups, in order, with the read/write/admin distinction surfaced. */
const VERB_GROUPS: Array<{ verb: ScopeMeta['verb']; heading: string; note: string }> = [
  { verb: 'read', heading: 'Reads', note: 'Sees your data — no changes.' },
  { verb: 'write', heading: 'Writes', note: 'Can change your data.' },
  { verb: 'admin', heading: 'Admin', note: 'Elevated control.' },
];

/** Grant-lifetime presets (seconds) offered when shorter than the server ceiling. */
const LIFETIME_PRESETS: Array<{ secs: number; label: string }> = [
  { secs: 3600, label: '1 hour' },
  { secs: 28800, label: '8 hours' },
  { secs: 86400, label: '1 day' },
  { secs: 604800, label: '7 days' },
  { secs: 2592000, label: '30 days' },
  { secs: 7776000, label: '90 days' },
];

function fmtDuration(secs: number): string {
  const d = secs / 86400;
  if (d >= 1) return Math.round(d) === 1 ? '1 day' : `${Math.round(d)} days`;
  const h = Math.max(1, Math.round(secs / 3600));
  return h === 1 ? '1 hour' : `${h} hours`;
}

function params(): Params {
  return Object.fromEntries(new URLSearchParams(location.search)) as Params;
}


/** Is this a granular (verb-first) scope, vs. a legacy coarse bucket? */
function isGranular(scope: string): boolean {
  return /^(read|write|act):/.test(scope) || scope === 'cells:create';
}

/**
 * Collapse coarse/granular aliases that render identically (same verb + title) —
 * e.g. `workspace:read` and `read:workspace` both read "Read your workspace".
 * Both stay *grantable* (legacy clients still request the coarse form), but the
 * picker should never show the same permission twice; we keep the granular alias.
 * Only the no-scope fallback surfaces aliases; an explicit request is already a
 * single vocabulary, so this is a no-op there.
 */
function dedupeAliases(scopes: string[], catalog: Record<string, ScopeMeta>): string[] {
  const chosen = new Map<string, string>(); // verb+title -> preferred scope
  for (const s of scopes) {
    const m = catalog[s];
    const key = m ? `${m.verb}::${m.title}` : s;
    const cur = chosen.get(key);
    if (!cur || (isGranular(s) && !isGranular(cur))) chosen.set(key, s);
  }
  const keep = new Set(chosen.values());
  return scopes.filter((s) => keep.has(s));
}

async function postJson<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

type Step = 'auth' | 'consent' | 'busy' | 'done' | 'error';


function App(): React.JSX.Element {
  const p = params();
  const deviceMode = !!p.user_code;
  const oauthMode = !!p.client_id;
  // This document IS the authorization server, so our own origin is the anchor.
  const apexOrigin = typeof location === 'undefined' ? undefined : location.origin;

  const [step, setStep] = useState<Step>('auth');
  const [error, setError] = useState<string>('');
  const [okMsg, setOkMsg] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [signedInUser, setSignedInUser] = useState<string>('');
  const [grantable, setGrantable] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, ScopeMeta>>({});
  const [clientName, setClientName] = useState<string>('');
  const [resourceAddr, setResourceAddr] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Grant lifetime: 0 = the server default (full ceiling); >0 = a user-chosen, shorter horizon.
  const [maxGrantSecs, setMaxGrantSecs] = useState<number>(0);
  const [grantSecs, setGrantSecs] = useState<number>(0);
  // Registration is the rare path — a returning reader should see one button,
  // not a form asking for a username they already have.
  const [registering, setRegistering] = useState<boolean>(false);

  const fail = useCallback((msg: string) => {
    setError(msg);
    setStep('error');
  }, []);

  /** After a session is established, branch to device-approve or scope consent. */
  const afterAuth = useCallback(
    async (sessionId: string) => {
      if (deviceMode) {
        // Disclose the requested scopes BEFORE approving (informed consent —
        // kb/device-flow-consent-disclosure). The device grant is all-or-nothing,
        // so this is a read-only disclosure + an explicit Approve; denial is the
        // safe default (the user must act to approve).
        const info = await postJson<{ scopes?: string[]; catalog?: Record<string, ScopeMeta>; error?: string }>(
          '/auth/device/info',
          { sessionId, user_code: p.user_code },
        );
        if (info.error || !info.scopes) return fail(info.error ?? 'Could not load the device request');
        setCatalog(info.catalog ?? {});
        setGrantable(info.scopes);
        (window as unknown as { __sessionId: string }).__sessionId = sessionId;
        setStep('consent');
        return;
      }
      if (!oauthMode || !p.redirect_uri) return fail('Missing OAuth parameters');

      // Fetch the scopes this user is allowed to grant, then show the picker.
      const g = await postJson<{ username?: string; scopes?: string[]; catalog?: Record<string, ScopeMeta>; clientName?: string; resource?: { kind: string; address: string }; maxGrantSecs?: number; error?: string }>('/auth/grantable', {
        sessionId,
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        // Send the requested scope so the server can surface any per-type scopes
        // (read:type:<T> / write:type:<T>) the owner may self-grant (ADR-0023).
        scope: p.scope,
      });
      if (g.error || !g.scopes) return fail(g.error ?? 'Could not load scopes');
      setSignedInUser(g.username ?? '');
      setCatalog(g.catalog ?? {});
      setClientName(g.clientName ?? '');
      setResourceAddr(g.resource?.address ?? '');
      setMaxGrantSecs(g.maxGrantSecs ?? 0);
      // Show only what the client actually REQUESTED (∩ what the user may grant) —
      // don't prompt for permissions the client never asked for. Pre-checked; the
      // user can deselect to grant a subset.
      const requested = (p.scope ?? '').split(/\s+/).filter(Boolean);
      const grant = new Set(g.scopes);
      const shown = dedupeAliases(requested.length ? requested.filter((s) => grant.has(s)) : g.scopes, g.catalog ?? {});
      setGrantable(shown);
      setSelected(new Set(requested.length ? shown : []));
      (window as unknown as { __sessionId: string }).__sessionId = sessionId;
      setStep('consent');
    },
    [deviceMode, oauthMode, p.redirect_uri, p.scope, p.user_code, fail],
  );

  const doAuth = useCallback(async () => {
    setStep('busy');
    try {
      const opts = await postJson<{ options?: unknown; challengeId?: string; error?: string }>(
        '/webauthn/authenticate/options',
        {},
      );
      if (opts.error || !opts.options) throw new Error(opts.error ?? 'Could not start sign-in');
      const resp = await startAuthentication({ optionsJSON: opts.options as never });
      const v = await postJson<{ verified?: boolean; sessionId?: string; error?: string }>(
        '/webauthn/authenticate/verify',
        { challengeId: opts.challengeId, response: resp },
      );
      if (!v.verified || !v.sessionId) throw new Error(v.error ?? 'Verification failed');
      await afterAuth(v.sessionId);
    } catch (e) {
      fail((e as Error).message);
    }
  }, [afterAuth, fail]);

  const doRegister = useCallback(async () => {
    if (!username.trim()) {
      setError('Username required');
      return;
    }
    setStep('busy');
    try {
      const opts = await postJson<{ options?: unknown; challengeId?: string; userId?: string; username?: string; error?: string }>(
        '/webauthn/register/options',
        { username: username.trim() },
      );
      if (opts.error || !opts.options) throw new Error(opts.error ?? 'Could not start registration');
      const resp = await startRegistration({ optionsJSON: opts.options as never });
      const v = await postJson<{ verified?: boolean; sessionId?: string; error?: string }>(
        '/webauthn/register/verify',
        { challengeId: opts.challengeId, userId: opts.userId, username: opts.username, response: resp },
      );
      if (!v.verified || !v.sessionId) throw new Error(v.error ?? 'Registration failed');
      await afterAuth(v.sessionId);
    } catch (e) {
      fail((e as Error).message);
    }
  }, [username, afterAuth, fail]);

  /**
   * Hand the result to the embedder rather than navigating.
   *
   * The target origin is the redirect_uri's, never `'*'` — an auth code posted
   * to a wildcard is readable by any frame that can reach this document. That
   * origin is trustworthy because `/oauth/consent` refuses a redirect_uri the
   * client never registered, so it is the same bound the redirect itself has.
   */
  const postToEmbedder = useCallback((payload: Record<string, string>): boolean => {
    const target = window.opener ?? (window.parent !== window ? window.parent : null);
    if (!target || !p.redirect_uri) return false;
    let origin: string;
    try {
      origin = new URL(p.redirect_uri).origin;
    } catch {
      return false;
    }
    target.postMessage({ type: 'parc.auth', ...payload }, origin);
    return true;
  }, [p.redirect_uri]);

  const submitConsent = useCallback(async () => {
    setStep('busy');
    try {
      const sessionId = (window as unknown as { __sessionId: string }).__sessionId;
      // Device grant: approve the disclosed scopes (all-or-nothing). The scopes
      // were shown on the consent step; clicking Approve is the explicit consent.
      if (deviceMode) {
        const r = await postJson<{ approved?: boolean; error?: string }>('/auth/device/approve', {
          sessionId,
          user_code: p.user_code,
        });
        if (r.error) throw new Error(r.error);
        setOkMsg('Device approved. Return to your terminal.');
        setStep('done');
        return;
      }
      const r = await postJson<{ redirect?: string; error?: string }>('/oauth/consent', {
        sessionId,
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        codeChallengeMethod: p.code_challenge_method || 'S256',
        scope: Array.from(selected).join(' '),
        state: p.state,
        resource: p.resource,
        ...(grantSecs > 0 ? { expiresInSec: grantSecs } : {}),
      });
      if (r.error || !r.redirect) throw new Error(r.error ?? 'Consent failed');
      // Embedded: the code rides a postMessage and the embedder keeps its page.
      // The whole redirect goes over, not just the code, so the embedder parses
      // exactly what a returning navigation would have carried.
      if (p.response_mode === 'web_message' && postToEmbedder({ redirect: r.redirect })) {
        setOkMsg('Done — you can close this.');
        setStep('done');
        return;
      }
      setOkMsg('Redirecting…');
      setStep('done');
      setTimeout(() => {
        location.href = r.redirect as string;
      }, 350);
    } catch (e) {
      fail((e as Error).message);
    }
  }, [p, selected, grantSecs, deviceMode, fail, postToEmbedder]);

  /**
   * Is the whole ask just "know who I am"? A `cell:<owner>/<name>:*` scope
   * grants no workspace authority at all (a cell call is authorised by the
   * registry, and the cell is handed `x-cell-caller`, never the token), so
   * when that is the ONLY thing offered there is nothing to decide. Rendering
   * a checkbox, a "Reads" heading and a grant-lifetime picker over a plain
   * yes/no is what made this read as a developer console.
   */
  const identityOnly = !deviceMode && grantable.length > 0 && grantable.every((sc) => sc.startsWith('cell:'));

  // Who is asking, split by what we can actually vouch for. `clientName` comes
  // from open registration, so it never leads.
  const who = requesterIdentity(p.redirect_uri, apexOrigin, clientName || null);
  const requester = who?.kind === 'cell' ? who.name : null;
  // What the sentence leads with. A cell we serve gets its name; everything
  // else is introduced by the origin the code will actually land on, which is
  // the one property /oauth/consent pins.
  const subject = who
    ? who.kind === 'cell' ? who.name : who.origin
    : resourceAddr || clientName || p.client_id || 'An application';

  const toggle = (scope: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  return (
    <Page>
      <Card>
        <Heading
          sub={
            deviceMode
              ? 'Approve device access.'
              : step === 'auth'
                ? 'parc.land keeps your sign-in, so you only do this once.'
                : undefined
          }
        >
          {deviceMode ? <>workspace <Badge tone="dim">auth</Badge></>
            : requester ? <>Sign in to {requester}</>
            : <>Sign in</>}
        </Heading>

        {deviceMode && p.user_code ? (
          <p style={{ fontFamily: theme.mono, fontSize: '1.1rem', color: theme.accent, letterSpacing: '0.1em' }}>
            {p.user_code}
          </p>
        ) : null}

        {step === 'auth' ? (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Button onClick={doAuth}>Sign in with passkey</Button>
            {registering ? (
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                <TextInput
                  value={username}
                  onChange={setUsername}
                  placeholder="Pick a username"
                  autoComplete="username webauthn"
                  onEnter={doRegister}
                />
                <Button kind="secondary" onClick={doRegister}>
                  Create account
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRegistering(true)}
                style={{
                  background: 'none', border: 0, padding: 0, cursor: 'pointer',
                  color: theme.dim, fontSize: '0.8rem', textAlign: 'center',
                  textDecoration: 'underline',
                }}
              >
                First time here? Create an account
              </button>
            )}
          </div>
        ) : null}

        {step === 'busy' ? <p style={{ color: theme.dim }}>Waiting for your passkey…</p> : null}

        {step === 'consent' ? (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
            <p style={{ color: theme.dim, fontSize: '0.85rem', margin: 0 }}>
              {deviceMode ? (
                <>
                  Signed in as <strong style={{ color: theme.text }}>{signedInUser || '…'}</strong>.{' '}
                  This device is requesting the access below.{' '}
                  <strong style={{ color: theme.text }}>Only approve if you started this sign-in.</strong>
                </>
              ) : (
                identityOnly ? (
                  // The one sentence that is actually true of an identity-only
                  // grant. The old copy said "is requesting access to your
                  // workspace" above a checkbox reading "nothing in your
                  // workspace" — flatly contradicting itself, and the more
                  // alarming half was the false one.
                  <>
                    <strong style={{ color: theme.text }}>{subject}</strong> will know you are{' '}
                    <strong style={{ color: theme.text }}>{signedInUser || '…'}</strong>. It gets nothing else — no
                    books, notes or files from your workspace.
                  </>
                ) : (
                  <>
                    Signed in as <strong style={{ color: theme.text }}>{signedInUser || '…'}</strong>.{' '}
                    <strong style={{ color: theme.text }}>{subject}</strong> is asking for access to your workspace:
                  </>
                )
              )}
            </p>
            {who?.kind === 'external' && who.claimed ? (
              // Registration is open, so this string is whatever the registrant
              // typed — including "parc.land". Showing it without saying so is
              // how a screen lends its own credibility to a stranger's label.
              <p style={{ color: theme.dim, fontSize: '0.75rem', margin: 0 }}>
                It calls itself “{who.claimed}”. Only the address above is verified.
              </p>
            ) : null}
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              {identityOnly ? null : VERB_GROUPS.map((g) => {
                const inGroup = grantable.filter((s) => (catalog[s]?.verb ?? 'read') === g.verb);
                if (!inGroup.length) return null;
                return (
                  <div key={g.verb} style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <strong style={{ fontFamily: theme.serif, fontSize: '0.95rem' }}>{g.heading}</strong>
                      <span style={{ color: theme.dim, fontSize: '0.75rem' }}>{g.note}</span>
                    </div>
                    {inGroup.map((s) =>
                      deviceMode ? (
                        // Device grant is all-or-nothing: disclose, don't pick.
                        <div key={s} style={{ display: 'grid', gap: '0.1rem' }}>
                          <span style={{ fontSize: '0.9rem', color: theme.text }}>• {catalog[s]?.title ?? s}</span>
                          {catalog[s]?.description ? (
                            <span style={{ color: theme.dim, fontSize: '0.75rem', paddingLeft: '0.9rem' }}>
                              {catalog[s]?.description}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <Checkbox
                          key={s}
                          checked={selected.has(s)}
                          onChange={(on) => toggle(s, on)}
                          label={catalog[s]?.title ?? s}
                          hint={catalog[s]?.description || s}
                        />
                      ),
                    )}
                  </div>
                );
              })}
              {grantable.length === 0 ? (
                <Badge tone="dim">{deviceMode ? 'This device requested no scopes' : 'No grantable scopes'}</Badge>
              ) : null}
            </div>
            {maxGrantSecs > 0 && !identityOnly ? (
              <label style={{ display: 'grid', gap: '0.3rem' }}>
                <span style={{ color: theme.dim, fontSize: '0.75rem' }}>This access lasts</span>
                <select
                  value={String(grantSecs)}
                  onChange={(e) => setGrantSecs(Number((e.target as HTMLSelectElement).value))}
                  style={{
                    fontFamily: theme.mono,
                    fontSize: '0.85rem',
                    padding: '0.4rem 0.5rem',
                    background: theme.bg,
                    color: theme.text,
                    border: `1px solid ${theme.dim}`,
                    borderRadius: '6px',
                  }}
                >
                  <option value="0">Until it expires ({fmtDuration(maxGrantSecs)} — default)</option>
                  {LIFETIME_PRESETS.filter((o) => o.secs < maxGrantSecs).map((o) => (
                    <option key={o.secs} value={String(o.secs)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button onClick={submitConsent} disabled={!deviceMode && selected.size === 0}>
              {deviceMode
                ? 'Approve device access'
                : identityOnly
                  // Nothing was picked, so there is no count to report and
                  // "Authorize (1)" only asks the reader to wonder what the 1 is.
                  ? `Continue${requester ? ` to ${requester}` : ''}`
                  : `Authorize${selected.size ? ` (${selected.size})` : ''}`}
            </Button>
          </div>
        ) : null}

        {step === 'done' ? (
          <p style={{ color: theme.accent }}>✓ {okMsg || "You're signed in"}</p>
        ) : null}

        {step === 'error' ? (() => {
          const friendly = friendlyError(error);
          return (
            <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.5rem' }}>
              <p style={{ color: theme.text, fontSize: '0.9rem', margin: 0, wordBreak: 'break-word' }}>
                {friendly.message}
              </p>
              {friendly.detail ? (
                <details style={{ color: theme.dim, fontSize: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer' }}>Details</summary>
                  <p style={{ margin: '0.4rem 0 0', wordBreak: 'break-word' }}>{friendly.detail}</p>
                </details>
              ) : null}
              <Button kind="secondary" onClick={() => { setError(''); setStep('auth'); }}>
                Try again
              </Button>
            </div>
          );
        })() : null}
      </Card>
    </Page>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
