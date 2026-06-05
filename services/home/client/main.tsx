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

const { useState, useEffect } = React;

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
  const [token, setToken] = useState('');
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

function App(): React.JSX.Element {
  return (
    <Page>
      <Heading sub="A personal productivity workspace — serverless, AWS-native, MCP-native cells behind one CloudFront router.">
        workspace <span style={{ color: theme.dim, fontWeight: 400 }}>· platform</span>
      </Heading>

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
