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
  inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] };
}

/**
 * Invoke a capability through the gateway's MCP endpoint, exactly as an agent
 * would: `tools/call` with name=read|act and `{ target, input }`. Returns the
 * tool's JSON result (or its error text). This is the one call the whole console
 * is built on — the human drives read/act the same way the agent does.
 */
async function mcpCall(verb: string, target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
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

/** A starter JSON argument object from a capability's input schema. */
function argSkeleton(schema?: Capability['inputSchema']): string {
  const props = schema?.properties ?? {};
  const keys = schema?.required?.length ? schema.required : Object.keys(props);
  if (keys.length === 0) return '{}';
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const t = props[k]?.type;
    obj[k] = t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
  }
  return JSON.stringify(obj, null, 2);
}

/** One capability: expand to give JSON args, invoke read/act, and see the result. */
function CapabilityRow({ cap }: { cap: Capability }): React.JSX.Element {
  const verb = cap.target.slice(cap.target.lastIndexOf('.') + 1);
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState(() => argSkeleton(cap.inputSchema));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; value: unknown } | null>(null);

  const run = async (): Promise<void> => {
    let input: unknown;
    try {
      input = args.trim() ? JSON.parse(args) : {};
    } catch {
      setOut({ ok: false, value: 'Invalid JSON in arguments' });
      return;
    }
    setBusy(true);
    try {
      setOut(await mcpCall(cap.kind, cap.target, input));
    } catch (e) {
      setOut({ ok: false, value: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '0.3rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: 'none', border: 'none', color: theme.text, cursor: 'pointer', fontFamily: theme.mono, padding: 0, fontSize: '0.85rem' }}
        >
          {open ? '▾' : '▸'} <code>{verb}</code>
        </button>
        <Badge tone={cap.kind === 'read' ? 'dim' : 'accent'}>{cap.kind}</Badge>
        {cap.scope ? <Badge tone="dim">{cap.scope}</Badge> : null}
        <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{cap.description}</span>
      </div>
      {open ? (
        <div style={{ display: 'grid', gap: '0.4rem', marginLeft: '1.1rem' }}>
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={Math.min(10, Math.max(2, args.split('\n').length))}
            spellCheck={false}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem', background: '#0d0d0d', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, fontFamily: theme.mono, fontSize: '0.8rem' }}
          />
          <div>
            <Button onClick={run} disabled={busy}>
              {busy ? 'Running…' : `${cap.kind}("${cap.target}")`}
            </Button>
          </div>
          {out ? (
            <div>
              <Badge tone={out.ok ? 'accent' : 'danger'}>{out.ok ? 'ok' : 'error'}</Badge>
              <div style={{ marginTop: '0.3rem' }}>
                <CodeBlock>{typeof out.value === 'string' ? out.value : JSON.stringify(out.value, null, 2)}</CodeBlock>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The live read/act **console** — `read("$catalog")` lists every capability the
 * caller can use, grouped by cell; each row invokes read/act and shows the result.
 * Home is now a read/act client: the human drives the same vocabulary the agent
 * does. (Home redesign; see docs/home-cell.md.)
 */
function Capabilities({ authed }: { authed: boolean }): React.JSX.Element {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    mcpCall('read', '$catalog')
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          setErr(typeof r.value === 'string' ? r.value : 'error');
          return;
        }
        setCaps((r.value as { capabilities?: Capability[] }).capabilities ?? []);
      })
      .catch((e) => {
        if (live) setErr(String(e));
      });
    return () => {
      live = false;
    };
  }, [authed]);

  const groups: Record<string, Capability[]> = {};
  for (const c of caps ?? []) {
    const dot = c.target.lastIndexOf('.');
    const ns = dot > 0 ? c.target.slice(0, dot) : c.target;
    (groups[ns] ??= []).push(c);
  }

  return (
    <Card>
      <Heading sub='Invoke any read/act capability and see the result — the same vocabulary your agent sees via read("$catalog").'>
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
            <div key={ns} style={{ display: 'grid', gap: '0.4rem' }}>
              <strong>{ns}</strong>
              {groups[ns].map((c) => (
                <CapabilityRow key={c.target} cap={c} />
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
