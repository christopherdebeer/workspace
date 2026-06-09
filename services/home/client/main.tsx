/**
 * Home cell client — a small, self-documenting single-page app served at `/`.
 *
 * It introspects the live platform (OAuth discovery documents) and lets you
 * probe the protected resource server, so the page doubles as documentation
 * and a smoke test. Built from the shared `platform/ui` component kit.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Page, Card, Heading, Badge, Button, Anchor, CodeBlock, theme } from '../../../platform/ui';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, getTokens } from './auth';

const { useState, useEffect } = React;

interface Session {
  ready: boolean;
  user: string | null;
  scopes: string[];
  error: string | null;
}

/**
 * First-party sign-in state. On mount, completes an OAuth redirect if returning,
 * then resolves the signed-in identity from the same `/mcp/whoami` an agent sees
 * — the human and the agent reading one identity (the substrate's "UI and API
 * converge"). Returns helpers so the header can offer sign in / sign out.
 */
function useAuth(): Session & { signIn: () => void; signOut: () => void } {
  const [s, setS] = useState<Session>({ ready: false, user: null, scopes: [], error: null });

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
        try {
          const res = await authFetch('/mcp/whoami');
          if (res.ok) {
            const b = (await res.json()) as { user?: string; userId?: string; scopes?: string[] };
            if (live) setS({ ready: true, user: b.user ?? b.userId ?? 'signed in', scopes: b.scopes ?? [], error });
            return;
          }
        } catch (e) {
          error = error ?? (e as Error).message;
        }
      }
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

function Account({ session }: { session: Session & { signIn: () => void; signOut: () => void } }): React.JSX.Element {
  return (
    <Card>
      <Heading sub="Sign in with a passkey to drive the platform as yourself — the same identity an agent gets over MCP.">
        Account
      </Heading>
      {!session.ready ? (
        <p style={{ color: theme.dim }}>…</p>
      ) : session.user ? (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Badge tone="accent">signed in</Badge>
            <strong>{session.user}</strong>
          </div>
          {session.scopes.length ? (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {session.scopes.map((s) => (
                <Badge key={s} tone="dim">{s}</Badge>
              ))}
            </div>
          ) : null}
          <Button kind="secondary" onClick={session.signOut}>Sign out</Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {session.error ? <Badge tone="danger">{session.error}</Badge> : null}
          <Button onClick={session.signIn}>Sign in with passkey</Button>
        </div>
      )}
    </Card>
  );
}

interface Manifest {
  name: string;
  version?: string;
  routes: string[];
  commands: string[];
  events?: { emits?: string[] };
}

async function getJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(path, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

function Catalog(): React.JSX.Element {
  const [services, setServices] = useState<Manifest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson('/_catalog')
      .then((r) =>
        r.status === 200
          ? setServices((r.body as { services: Manifest[] }).services)
          : setErr(`HTTP ${r.status}`),
      )
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <Card>
      <Heading sub="Live cell manifests, injected at deploy time from the platform wiring.">
        Service cells
      </Heading>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {!services && !err ? <p style={{ color: theme.dim }}>Loading…</p> : null}
      <div style={{ display: 'grid', gap: '0.9rem', marginTop: '0.5rem' }}>
        {(services ?? []).map((s) => (
          <div key={s.name} style={{ display: 'grid', gap: '0.3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>{s.name}</strong>
              {s.version ? <Badge tone="dim">v{s.version}</Badge> : null}
            </div>
            {s.routes.length ? (
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {s.routes.map((r) => (
                  <Badge key={r} tone="accent">{r}</Badge>
                ))}
              </div>
            ) : (
              <Badge tone="dim">/ (default)</Badge>
            )}
            {s.commands.length ? (
              <span style={{ color: theme.dim, fontSize: '0.8rem' }}>
                commands: {s.commands.join(', ')}
              </span>
            ) : null}
            {s.events?.emits?.length ? (
              <span style={{ color: theme.dim, fontSize: '0.8rem' }}>
                emits: {s.events.emits.join(', ')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

interface CatalogCell {
  name: string;
  owner: string;
  address: string;
  status: string;
  description: string | null;
  shared: boolean;
}

function statusTone(status: string): 'accent' | 'dim' | 'danger' {
  if (status === 'ACTIVE') return 'accent';
  if (status === 'FAILED') return 'danger';
  return 'dim';
}

/**
 * The signed-in user's tier-2 cells, merged into `/_catalog` by the home cell
 * from forge. Loads from the session bearer once signed in — the human seeing
 * exactly the cells their agent would, through the same endpoint.
 */
function MyCells({ authed }: { authed: boolean }): React.JSX.Element {
  const [cells, setCells] = useState<CatalogCell[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) {
      setCells(null);
      setErr(null);
      return;
    }
    authFetch('/_catalog')
      .then(async (r) =>
        r.status === 200
          ? setCells(((await r.json()) as { cells?: CatalogCell[] }).cells ?? [])
          : setErr(`HTTP ${r.status}`),
      )
      .catch((e) => setErr(String(e)));
  }, [authed]);

  return (
    <Card>
      <Heading sub="Cells you own or were granted, provisioned at runtime through forge — the human view of what your agent sees.">
        Your dynamic cells
      </Heading>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {!authed ? (
        <p style={{ color: theme.dim }}>Sign in above to load the cells you can reach.</p>
      ) : null}
      {authed && !cells && !err ? <p style={{ color: theme.dim }}>Loading…</p> : null}
      {authed && cells && cells.length === 0 ? (
        <p style={{ color: theme.dim }}>No dynamic cells yet — create one via the forge MCP tools.</p>
      ) : null}
      <div style={{ display: 'grid', gap: '0.9rem', marginTop: '0.5rem' }}>
        {(cells ?? []).map((c) => (
          <div key={c.address} style={{ display: 'grid', gap: '0.3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>{c.name}</strong>
              <Badge tone={statusTone(c.status)}>{c.status}</Badge>
              {c.shared ? <Badge tone="dim">shared</Badge> : null}
            </div>
            <Badge tone="accent">{c.address}</Badge>
            {c.description ? (
              <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{c.description}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Discovery(): React.JSX.Element {
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson('/.well-known/oauth-authorization-server')
      .then((r) => (r.status === 200 ? setMeta(r.body as Record<string, unknown>) : setErr(`HTTP ${r.status}`)))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <Card>
      <Heading sub="Fetched live from the auth cell's RFC 8414 document.">OAuth discovery</Heading>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {meta ? (
        <CodeBlock>{JSON.stringify({ issuer: meta.issuer, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, registration_endpoint: meta.registration_endpoint }, null, 2)}</CodeBlock>
      ) : (
        !err && <p style={{ color: theme.dim }}>Loading…</p>
      )}
    </Card>
  );
}

function ResourceProbe(): React.JSX.Element {
  // Defaults to the signed-in session token; still editable as a debug tool.
  const [token, setToken] = useState(() => getTokens()?.access_token ?? '');
  const [result, setResult] = useState<{ status: number; body: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await getJson('/mcp/whoami', token ? { headers: { authorization: `Bearer ${token}` } } : undefined));
    } catch (e) {
      setResult({ status: 0, body: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading sub="GET /mcp/whoami — paste an access token, or run it empty to see the 401 challenge.">
        Probe the resource server
      </Heading>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token (optional)"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.6rem',
          marginBottom: '0.5rem',
          background: '#0d0d0d',
          border: `1px solid ${theme.border}`,
          borderRadius: 6,
          color: theme.text,
          fontFamily: theme.mono,
        }}
      />
      <Button onClick={probe} disabled={busy}>
        {busy ? 'Calling…' : 'Call /mcp/whoami'}
      </Button>
      {result ? (
        <div style={{ marginTop: '0.75rem' }}>
          <Badge tone={result.status === 200 ? 'accent' : 'danger'}>HTTP {result.status}</Badge>
          <div style={{ marginTop: '0.5rem' }}>
            <CodeBlock>{JSON.stringify(result.body, null, 2)}</CodeBlock>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  scope: string | null;
}

/**
 * The live capability palette — exactly what `read("$catalog")` returns to an
 * agent, grouped by cell. This is home as a **read/act client**: the human reads
 * the same vocabulary (read/act targets) the agent does, through the same `/mcp`.
 * Phase 0 of the home redesign (see docs/home-cell.md); the `/_catalog` cell
 * directory below is being subsumed by this — a "cell" is just a namespace here.
 */
function Capabilities({ authed }: { authed: boolean }): React.JSX.Element {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    authFetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'read', arguments: { target: '$catalog' } },
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          if (live) setErr(`HTTP ${res.status}`);
          return;
        }
        const rpc = (await res.json()) as {
          result?: { content?: Array<{ text?: string }> };
          error?: { message?: string };
        };
        if (rpc.error) {
          if (live) setErr(rpc.error.message ?? 'error');
          return;
        }
        const parsed = JSON.parse(rpc.result?.content?.[0]?.text ?? '{}') as { capabilities?: Capability[] };
        if (live) setCaps(parsed.capabilities ?? []);
      })
      .catch((e) => {
        if (live) setErr(String(e));
      });
    return () => {
      live = false;
    };
  }, [authed]);

  // Group by namespace (everything before the last dot): workspace.recall → "workspace".
  const groups: Record<string, Capability[]> = {};
  for (const c of caps ?? []) {
    const dot = c.target.lastIndexOf('.');
    const ns = dot > 0 ? c.target.slice(0, dot) : c.target;
    (groups[ns] ??= []).push(c);
  }

  return (
    <Card>
      <Heading sub='What you can do, grouped by cell — the read/act vocabulary your agent sees via read("$catalog").'>
        Capabilities
      </Heading>
      {!authed ? <p style={{ color: theme.dim }}>Sign in above to load your capabilities.</p> : null}
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {authed && !caps && !err ? <p style={{ color: theme.dim }}>Loading…</p> : null}
      {authed && caps && caps.length === 0 ? (
        <p style={{ color: theme.dim }}>No capabilities — your token may lack scopes.</p>
      ) : null}
      <div style={{ display: 'grid', gap: '0.9rem', marginTop: '0.5rem' }}>
        {Object.keys(groups)
          .sort()
          .map((ns) => (
            <div key={ns} style={{ display: 'grid', gap: '0.3rem' }}>
              <strong>{ns}</strong>
              {groups[ns].map((c) => (
                <div key={c.target} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <code>{c.target.slice(c.target.lastIndexOf('.') + 1)}</code>
                  <Badge tone={c.kind === 'read' ? 'dim' : 'accent'}>{c.kind}</Badge>
                  {c.scope ? <Badge tone="dim">{c.scope}</Badge> : null}
                  <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{c.description}</span>
                </div>
              ))}
            </div>
          ))}
      </div>
    </Card>
  );
}

function App(): React.JSX.Element {
  const session = useAuth();
  return (
    <Page>
      <Heading sub="A personal productivity workspace — serverless, AWS-native, MCP-native cells behind one CloudFront router.">
        workspace <span style={{ color: theme.dim, fontWeight: 400 }}>· platform</span>
      </Heading>

      <Account session={session} />
      <Capabilities authed={!!session.user} />
      <MyCells authed={!!session.user} />
      <Catalog />
      <Discovery />
      <ResourceProbe />

      <Card>
        <Heading>Get a token</Heading>
        <p style={{ color: theme.dim, fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
          Tokens come from the OAuth flow. An MCP client performs Dynamic Client Registration and
          redirects to <code>/oauth/authorize</code> with its <code>client_id</code> and{' '}
          <code>redirect_uri</code>; you approve with a passkey. Opening{' '}
          <Anchor href="/oauth/authorize">/oauth/authorize</Anchor> directly has no client context,
          so it can only register a passkey.
        </p>
      </Card>
    </Page>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
