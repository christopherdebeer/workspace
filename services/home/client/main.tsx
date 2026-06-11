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

interface RenderHint {
  type?: string;
  label?: string;
  href?: string;
}

interface ViewDef {
  id: string;
  description?: string;
  reduce?: string;
  render?: RenderHint | null;
}

interface ViewEval {
  id: string;
  render: RenderHint | null;
  value: unknown;
  count: number;
}

/** One registered view, rendered by its hint — the dashboard is a view query. */
interface ListEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string };
}

/** A fact's one-line presentation: title from its value, not its key. */
function factTitle(e: ListEntry): string {
  const v = e.value;
  if (typeof v === 'string') return v.slice(0, 80) || e.key;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string' && o.title) return o.title.slice(0, 80);
    if (typeof o.name === 'string' && o.name) return o.name.slice(0, 80);
    if (typeof o.content === 'string' && o.content) {
      const line = o.content.match(/^#+\s*(.+)$/m)?.[1] ?? o.content.split('\n').find((l) => l.trim()) ?? '';
      const clean = line.replace(/^[-*]\s*\[[ x]\]\s*/, '').replace(/[#*_`>\\[\]()]/g, '').trim();
      if (clean) return clean.slice(0, 80);
    }
  }
  return e.key;
}

/** Where a fact lives — its home surface, by type/key convention. */
function factHref(e: ListEntry): string | null {
  const t = e._meta?.type ?? null;
  const v = (e.value ?? {}) as Record<string, unknown>;
  const tags = e._meta?.tags ?? [];
  if (e.key.startsWith('doc:')) return `/@c15r/lit?doc=${encodeURIComponent(e.key.slice(4))}`;
  if (t === 'capture' || e.key.startsWith('inbox/')) {
    return typeof v.captured === 'string' ? `/@c15r/lit?doc=${encodeURIComponent(`log:${v.captured}`)}` : '/@c15r/input';
  }
  if (t === 'cell' && typeof v.address === 'string') return v.address;
  const docTag = tags.find((x) => x.startsWith('doc:'));
  if (docTag) return `/@c15r/lit?doc=${encodeURIComponent(docTag.slice(4))}`;
  const boardTag = tags.find((x) => x.startsWith('canvas:'));
  if (boardTag) return `/@c15r/canvas?canvas=${encodeURIComponent(boardTag.slice(7))}`;
  return null;
}

function ViewSurface({ def }: { def: ViewDef }): React.JSX.Element {
  const [out, setOut] = useState<ViewEval | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    mcpCall('read', 'workspace.view', { id: def.id })
      .then((r) => {
        if (!live) return;
        if (r.ok) setOut(r.value as ViewEval);
        else setErr(typeof r.value === 'string' ? r.value : 'error');
      })
      .catch((e) => {
        if (live) setErr(String(e));
      });
    return () => {
      live = false;
    };
  }, [def.id]);

  const hint = out?.render ?? def.render ?? null;
  const label = hint?.label ?? def.description ?? def.id;
  const type = hint?.type ?? 'json';
  const box: React.CSSProperties = {
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: '0.7rem 0.9rem',
    display: 'grid',
    gap: '0.25rem',
  };

  if (err) {
    return (
      <div style={box}>
        <strong>{label}</strong>
        <Badge tone="danger">{err}</Badge>
      </div>
    );
  }

  // A canvas view IS a board: a live, pinned-viewport embed of the actual
  // region (the same declaration agents read), linking into the full board.
  if (type === 'canvas') {
    const board = def.id.startsWith('canvas:') ? def.id.slice('canvas:'.length) : def.id;
    const href = hint?.href ?? `/@c15r/canvas?canvas=${encodeURIComponent(board)}`;
    const embedSrc = `/@c15r/canvas?view=${encodeURIComponent(def.id)}&embed=1`;
    return (
      <a href={href} style={{ ...box, textDecoration: 'none', color: 'inherit', padding: 0, overflow: 'hidden' }}>
        <iframe
          src={embedSrc}
          title={label}
          loading="lazy"
          style={{ width: '100%', height: 230, border: 0, pointerEvents: 'none', display: 'block', background: '#fff' }}
        />
        <span style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0.9rem' }}>
          <strong>🌲 {label}</strong>
          <span style={{ color: theme.accent, fontSize: '0.85rem' }}>
            {out ? `${out.count} item${out.count === 1 ? '' : 's'} · ` : ''}Open board →
          </span>
        </span>
      </a>
    );
  }

  if (type === 'metric' || type === 'count') {
    return (
      <div style={box}>
        <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{label}</span>
        <strong style={{ fontSize: '1.6rem' }}>{out ? String(out.value ?? '—') : '…'}</strong>
      </div>
    );
  }

  if (type === 'list' || type === 'table' || type === 'feed') {
    const entries = Array.isArray(out?.value)
      ? (out?.value as Array<{ key: string; value?: unknown; _meta?: { type?: string | null; tags?: string[]; updatedAt?: string } }>)
      : [];
    const href = typeof hint?.href === 'string' ? hint.href : null;
    return (
      <div style={box}>
        {href ? (
          <a href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
            <strong>{label} →</strong>
          </a>
        ) : (
          <strong>{label}</strong>
        )}
        {out === null ? (
          <span style={{ color: theme.dim }}>Loading…</span>
        ) : entries.length === 0 ? (
          <span style={{ color: theme.dim }}>Empty.</span>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
            {entries.slice(0, 8).map((e) => {
              const to = factHref(e);
              const title = factTitle(e);
              const date = e._meta?.updatedAt ? e._meta.updatedAt.slice(0, 10) : null;
              const sub = [e._meta?.type, e.key, date].filter(Boolean).join(' · ');
              return (
                <li key={e.key} style={{ lineHeight: 1.35 }}>
                  {to ? (
                    <a href={to} style={{ color: theme.accent, textDecoration: 'none' }}>
                      {title}
                    </a>
                  ) : (
                    <span>{title}</span>
                  )}
                  <div style={{ color: theme.dim, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub}
                  </div>
                </li>
              );
            })}
            {entries.length > 8 ? <li style={{ color: theme.dim, fontSize: '0.8rem' }}>… {entries.length - 8} more</li> : null}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div style={box}>
      <strong>{label}</strong>
      {out === null ? <span style={{ color: theme.dim }}>Loading…</span> : <CodeBlock>{JSON.stringify(out.value, null, 2)}</CodeBlock>}
    </div>
  );
}

/**
 * Registered views, rendered as surfaces (home redesign phase 3: the UI comes
 * from the registry, not code — `render: {type: 'canvas'}` links out to the
 * spatial projection at /@<owner>/canvas).
 */
function Views({ authed }: { authed: boolean }): React.JSX.Element | null {
  const [views, setViews] = useState<ViewDef[] | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    mcpCall('read', 'workspace.views')
      .then((r) => {
        if (!live) return;
        setViews(r.ok ? ((r.value as { views?: ViewDef[] }).views ?? []) : []);
      })
      .catch(() => {
        if (live) setViews([]);
      });
    return () => {
      live = false;
    };
  }, [authed]);

  if (!authed || views === null || views.length === 0) return null;
  return (
    <Card>
      <Heading sub="Registered views rendered by their hints — one declaration, a dashboard for you and an affordance for agents.">
        Surfaces
      </Heading>
      <div style={{ display: 'grid', gap: '0.7rem', marginTop: '0.5rem' }}>
        {views.map((v) => (
          <ViewSurface key={v.id} def={v} />
        ))}
      </div>
    </Card>
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
      <Views authed={!!session.user} />
      <Capabilities authed={!!session.user} />
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
