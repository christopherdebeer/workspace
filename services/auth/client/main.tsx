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

function params(): Params {
  return Object.fromEntries(new URLSearchParams(location.search)) as Params;
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

  const [step, setStep] = useState<Step>('auth');
  const [error, setError] = useState<string>('');
  const [okMsg, setOkMsg] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [signedInUser, setSignedInUser] = useState<string>('');
  const [grantable, setGrantable] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, ScopeMeta>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fail = useCallback((msg: string) => {
    setError(msg);
    setStep('error');
  }, []);

  /** After a session is established, branch to device-approve or scope consent. */
  const afterAuth = useCallback(
    async (sessionId: string) => {
      if (deviceMode) {
        setStep('busy');
        const r = await postJson<{ approved?: boolean; error?: string }>('/auth/device/approve', {
          sessionId,
          user_code: p.user_code,
        });
        if (r.error) return fail(r.error);
        setOkMsg('Device approved. Return to your terminal.');
        setStep('done');
        return;
      }
      if (!oauthMode || !p.redirect_uri) return fail('Missing OAuth parameters');

      // Fetch the scopes this user is allowed to grant, then show the picker.
      const g = await postJson<{ username?: string; scopes?: string[]; catalog?: Record<string, ScopeMeta>; error?: string }>('/auth/grantable', {
        sessionId,
      });
      if (g.error || !g.scopes) return fail(g.error ?? 'Could not load scopes');
      setSignedInUser(g.username ?? '');
      setGrantable(g.scopes);
      setCatalog(g.catalog ?? {});
      const requested = new Set((p.scope ?? '').split(/\s+/).filter(Boolean));
      // Pre-check the requested scopes the user can actually grant.
      setSelected(new Set(g.scopes.filter((s) => requested.has(s))));
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

  const submitConsent = useCallback(async () => {
    setStep('busy');
    try {
      const sessionId = (window as unknown as { __sessionId: string }).__sessionId;
      const r = await postJson<{ redirect?: string; error?: string }>('/oauth/consent', {
        sessionId,
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        codeChallengeMethod: p.code_challenge_method || 'S256',
        scope: Array.from(selected).join(' '),
        state: p.state,
        resource: p.resource,
      });
      if (r.error || !r.redirect) throw new Error(r.error ?? 'Consent failed');
      setOkMsg('Redirecting…');
      setStep('done');
      setTimeout(() => {
        location.href = r.redirect as string;
      }, 350);
    } catch (e) {
      fail((e as Error).message);
    }
  }, [p, selected, fail]);

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
        <Heading sub={deviceMode ? 'Approve device access.' : 'Sign in or register to authorize access.'}>
          workspace <Badge tone="dim">auth</Badge>
        </Heading>

        {deviceMode && p.user_code ? (
          <p style={{ fontFamily: theme.mono, fontSize: '1.1rem', color: theme.accent, letterSpacing: '0.1em' }}>
            {p.user_code}
          </p>
        ) : null}

        {step === 'auth' ? (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Button onClick={doAuth}>Sign in with passkey</Button>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <TextInput
                value={username}
                onChange={setUsername}
                placeholder="username (to register a new passkey)"
                autoComplete="username webauthn"
                onEnter={doRegister}
              />
              <Button kind="secondary" onClick={doRegister}>
                Register new passkey
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'busy' ? <p style={{ color: theme.dim }}>🔐 Waiting…</p> : null}

        {step === 'consent' ? (
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
            <p style={{ color: theme.dim, fontSize: '0.85rem', margin: 0 }}>
              Signed in as <strong style={{ color: theme.text }}>{signedInUser || '…'}</strong>. Choose the
              permissions to grant <strong style={{ color: theme.text }}>{p.client_id}</strong>:
            </p>
            <div style={{ display: 'grid', gap: '0.9rem' }}>
              {VERB_GROUPS.map((g) => {
                const inGroup = grantable.filter((s) => (catalog[s]?.verb ?? 'read') === g.verb);
                if (!inGroup.length) return null;
                return (
                  <div key={g.verb} style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <strong style={{ fontFamily: theme.serif, fontSize: '0.95rem' }}>{g.heading}</strong>
                      <span style={{ color: theme.dim, fontSize: '0.75rem' }}>{g.note}</span>
                    </div>
                    {inGroup.map((s) => (
                      <Checkbox
                        key={s}
                        checked={selected.has(s)}
                        onChange={(on) => toggle(s, on)}
                        label={catalog[s]?.title ?? s}
                        hint={catalog[s]?.description || s}
                      />
                    ))}
                  </div>
                );
              })}
              {grantable.length === 0 ? <Badge tone="dim">No grantable scopes</Badge> : null}
            </div>
            <Button onClick={submitConsent} disabled={selected.size === 0}>
              Authorize{selected.size ? ` (${selected.size})` : ''}
            </Button>
          </div>
        ) : null}

        {step === 'done' ? (
          <p style={{ color: theme.accent }}>✓ {okMsg || 'Authorized'}</p>
        ) : null}

        {step === 'error' ? (
          <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.5rem' }}>
            <Badge tone="danger">Failed</Badge>
            <p style={{ color: theme.dim, fontSize: '0.85rem', margin: 0, wordBreak: 'break-word' }}>{error}</p>
            <Button kind="secondary" onClick={() => { setError(''); setStep('auth'); }}>
              Try again
            </Button>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
