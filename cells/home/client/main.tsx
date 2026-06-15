/**
 * Home cell client — parc.land's two faces (docs/home-cell.md).
 *
 * Signed out: the trailhead — a painted dusk valley, the wordmark, and the
 * passkey door. Signed in: your corner of the substrate — greeting, live
 * stats over the change feed, recent activity, quick capture, the workspace
 * window, identity & grants, pinned views, cells — and the field computer:
 * the raw read/act console housed as the one deliberately-technical object
 * in the warm room. Everything is the same `mcpCall` vocabulary an agent
 * speaks; the park language lives in headings and copy, never in targets.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Page, Card, Heading, Badge, Button, Anchor, CodeBlock, theme } from '../shared/ui';
import { resolve, declFor, type TypeDecl } from '../shared/vocab';
import { DEFAULT_TYPE_DECLS } from './type-decls';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl } from './auth';

/**
 * Make an apex-style `/@owner/name<rest>` link origin-aware. Home now runs as a
 * cell on its own origin, where a bare `/@owner/name` path is re-prefixed by the
 * edge (→ 404); the kernel's `cellUrl` routes to the sibling subdomain instead.
 * Non-cell paths (already-absolute URLs, plain paths) pass through unchanged.
 */
function localize(href: string | null | undefined): string {
  if (!href) return href ?? '';
  const m = href.match(/^\/@([^/]+)\/([^/?#]+)(.*)$/);
  return m ? cellUrl(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3]) : href;
}
// Painted assets (data URIs via the dataurl loader): the dusk-valley hero,
// the dawn panorama strip, and the field computer.
const heroUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/hero.jpg';
const stripUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/strip.jpg';
const computerUrl = 'https://parc.land/@c15r/home/_data/c15r/public/assets/computer.webp';

const { useState, useEffect } = React;

// ─── auth/session ──────────────────────────────────────────────────

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

/**
 * Invoke a capability through the gateway's MCP endpoint, exactly as an agent
 * would: `tools/call` with name=read|act and `{ target, input }`. Returns the
 * tool's JSON result (or its error text). This is the one call the whole page
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

// ─── the scenery (the painted assets) ──────────────────────────────

/** The painted valley. `tall` = the landing hero; short = the dashboard strip. */
function DuskScene({ tall, children }: { tall?: boolean; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: theme.radius,
        overflow: 'hidden',
        boxShadow: theme.shadow,
        border: `1px solid ${theme.border}`,
        background: theme.dusk,
      }}
    >
      <img
        src={tall ? heroUrl : stripUrl}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: tall ? 'center bottom' : 'center 70%',
          display: 'block',
        }}
      />
      {tall ? (
        // Legibility veil for the overlaid text — quiet in the sky, gone by mid-frame.
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(150deg, rgba(8,29,36,0.62) 0%, rgba(8,29,36,0.28) 38%, rgba(8,29,36,0) 62%)',
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,29,36,0.30)' }} />
      )}
      <div style={{ position: 'relative', minHeight: tall ? 'min(56vh, 430px)' : 96, display: 'grid' }}>{children}</div>
    </div>
  );
}

function Wordmark({ light }: { light?: boolean }): React.JSX.Element {
  return (
    <span style={{ fontFamily: theme.mono, fontWeight: 700, letterSpacing: '0.02em', color: light ? theme.cream : theme.text }}>
      parc.land
    </span>
  );
}

// ─── face 1: the trailhead (landing) ───────────────────────────────

function Landing({ session }: { session: Session & { signIn: () => void } }): React.JSX.Element {
  const signCard: React.CSSProperties = {
    background: 'rgba(253,249,239,0.94)',
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: '0.8rem 0.95rem',
    boxShadow: theme.shadow,
    display: 'grid',
    gap: '0.25rem',
  };
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <DuskScene tall>
        <div style={{ padding: 'clamp(1.2rem, 4vw, 2.2rem)', display: 'grid', alignContent: 'start', gap: '0.6rem' }}>
          <div style={{ fontSize: '1.5rem' }}>
            <Wordmark light />
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: theme.serif,
              fontWeight: 600,
              fontSize: 'clamp(1.5rem, 4.5vw, 2.2rem)',
              color: theme.cream,
              maxWidth: '18ch',
              lineHeight: 1.2,
              textShadow: '0 1px 12px rgba(8,29,36,0.6)',
            }}
          >
            a personal substrate for exploring the world
          </h1>
          <p style={{ margin: 0, color: theme.cream, opacity: 0.85, maxWidth: '44ch', fontSize: '0.95rem', textShadow: '0 1px 8px rgba(8,29,36,0.6)' }}>
            Your home for notes, plans, and discoveries. Remember what matters, share what helps,
            and grow the tools as you go.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
            <div style={{ width: 'min(260px, 100%)' }}>
              <Button onClick={session.signIn}>Sign in with passkey</Button>
            </div>
          </div>
          <span style={{ color: theme.cream, opacity: 0.7, fontSize: '0.78rem' }}>
            New here? The same button registers a passkey.
          </span>
          {session.error ? <Badge tone="danger">{session.error}</Badge> : null}
        </div>
      </DuskScene>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.8rem' }}>
        <div style={signCard}>
          <strong style={{ fontFamily: theme.serif }}>🌲 A workspace that remembers</strong>
          <span style={{ color: theme.dim, fontSize: '0.85rem' }}>
            Facts with provenance and history — nothing is lost, the important rises. What you save
            today is still legible in ten years.
          </span>
        </div>
        <div style={signCard}>
          <strong style={{ fontFamily: theme.serif }}>🏕 Tools you can grow</strong>
          <span style={{ color: theme.dim, fontSize: '0.85rem' }}>
            Cells are small programs you deploy into the land — a tracker, a board, a feed — each
            with its own address and its own logs.
          </span>
        </div>
        <div style={signCard}>
          <strong style={{ fontFamily: theme.serif }}>✨ Agents welcome</strong>
          <span style={{ color: theme.dim, fontSize: '0.85rem' }}>
            One vocabulary for people and AI: <code style={{ fontFamily: theme.mono }}>whoami · read · act</code> over
            MCP at <code style={{ fontFamily: theme.mono }}>parc.land/mcp</code>. This page is the same client, rendered.
          </span>
        </div>
      </div>

      <div style={{ ...signCard, gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
        <div style={{ display: 'grid', gap: '0.2rem' }}>
          <strong style={{ fontFamily: theme.serif }}>📖 Public documentation</strong>
          <span style={{ color: theme.dim, fontSize: '0.85rem' }}>
            Read the parc.land substrate docs — server-rendered, no sign-in needed.
          </span>
        </div>
        <a
          href={localize('/@c15r/lit')}
          style={{
            display: 'inline-block',
            background: theme.pine,
            color: theme.cream,
            borderRadius: 8,
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Read the docs →
        </a>
      </div>

      <p style={{ margin: 0, textAlign: 'center', color: theme.dim, fontSize: '0.8rem', fontStyle: 'italic' }}>
        “A digital communal green space.” — the Visitor Centre, est. v1 🏛
      </p>
    </div>
  );
}

// ─── face 2: the dashboard ─────────────────────────────────────────

function greetingFor(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function DashboardHeader({ session }: { session: Session & { signOut: () => void } }): React.JSX.Element {
  return (
    <DuskScene>
      <div
        style={{
          padding: '0.9rem 1.1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: '0.1rem' }}>
          <strong style={{ fontFamily: theme.serif, fontSize: '1.25rem', color: theme.cream, textShadow: '0 1px 8px rgba(8,29,36,0.7)' }}>
            {greetingFor(new Date().getHours())}, {session.user}.
          </strong>
          <span style={{ color: theme.cream, opacity: 0.8, fontSize: '0.82rem', textShadow: '0 1px 6px rgba(8,29,36,0.7)' }}>
            Here’s what’s true in your corner of the substrate.
          </span>
        </div>
        <button
          onClick={session.signOut}
          style={{
            background: 'rgba(253,246,216,0.14)',
            border: `1px solid rgba(253,246,216,0.4)`,
            color: theme.cream,
            borderRadius: 8,
            padding: '0.35rem 0.8rem',
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </DuskScene>
  );
}

function Sparkline({ points }: { points: number[] }): React.JSX.Element | null {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const pts = points.map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(1)},${(28 - (v / max) * 24).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" style={{ width: '100%', height: 30, display: 'block' }} aria-hidden>
      <polyline points={pts} fill="none" stroke={theme.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface ChangeEvent {
  op: string;
  key: string | null;
  at: string;
  seq: number;
}

interface DashboardData {
  facts: number;
  cells: number;
  views: number;
  edges: number;
  /** Write-ish events per day, oldest → newest (the sparkline). */
  activity: number[];
  /** Latest write-ish events, newest first. */
  recent: ChangeEvent[];
}

async function loadDashboard(): Promise<DashboardData> {
  const head = await mcpCall('read', 'workspace.changes', { sinceSeq: 'head' });
  const seq = head.ok ? ((head.value as { seq?: number }).seq ?? 0) : 0;
  const [q, c, v, l, ch] = await Promise.all([
    mcpCall('read', 'workspace.query', { limit: 1 }),
    mcpCall('read', 'cells.list'),
    mcpCall('read', 'workspace.views'),
    mcpCall('read', 'workspace.links'),
    mcpCall('read', 'workspace.changes', { sinceSeq: Math.max(0, seq - 300), limit: 300 }),
  ]);
  const events = ch.ok ? (((ch.value as { events?: ChangeEvent[] }).events ?? []) as ChangeEvent[]) : [];
  const writes = events.filter((e) => e.op !== 'read');
  // Bucket the last 14 days, oldest first.
  const days: number[] = new Array(14).fill(0);
  const now = Date.now();
  for (const e of writes) {
    const age = Math.floor((now - Date.parse(e.at)) / 86400000);
    if (age >= 0 && age < 14) days[13 - age]++;
  }
  return {
    facts: q.ok ? ((q.value as { total?: number }).total ?? 0) : 0,
    cells: c.ok ? (((c.value as { cells?: unknown[] }).cells ?? []).length) : 0,
    views: v.ok ? (((v.value as { views?: unknown[] }).views ?? []).length) : 0,
    edges: l.ok ? (((l.value as { edges?: unknown[] }).edges ?? []).length) : 0,
    activity: days,
    recent: writes.slice(-8).reverse(),
  };
}

function StatCards({ data }: { data: DashboardData | null }): React.JSX.Element {
  const cell = (label: string, value: number | null, foot?: React.ReactNode): React.JSX.Element => (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        boxShadow: theme.shadow,
        padding: '0.7rem 0.85rem',
        display: 'grid',
        gap: '0.15rem',
        alignContent: 'start',
      }}
    >
      <span style={{ color: theme.dim, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <strong style={{ fontFamily: theme.serif, fontSize: '1.5rem' }}>{value === null ? '…' : value}</strong>
      {foot}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.7rem' }}>
      {cell('Facts', data ? data.facts : null, data ? <Sparkline points={data.activity} /> : undefined)}
      {cell('Links', data ? data.edges : null)}
      {cell('Views', data ? data.views : null)}
      {cell('Cells', data ? data.cells : null)}
    </div>
  );
}

const OP_LABEL: Record<string, string> = {
  write: 'remembered',
  supersede: 'retired',
  link: 'linked',
  unlink: 'unlinked',
};

function RecentActivity({ data }: { data: DashboardData | null }): React.JSX.Element | null {
  if (data && data.recent.length === 0) return null;
  return (
    <Card>
      <Heading sub="The change feed — the land's own record of what happened (reads excluded).">Recent activity</Heading>
      {!data ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
          {data.recent.map((e) => (
            <li key={e.seq} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem', flexWrap: 'wrap' }}>
              <Badge tone="dim">{OP_LABEL[e.op] ?? e.op}</Badge>
              <code style={{ fontFamily: theme.mono, fontSize: '0.78rem' }}>{e.key}</code>
              <span style={{ color: theme.dim, fontSize: '0.72rem' }}>{e.at.slice(5, 16).replace('T', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One-box capture: a thought lands as an inbox fact in one act. */
function QuickCapture(): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const capture = async (): Promise<void> => {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      const key = `inbox/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
      const r = await mcpCall('act', 'workspace.remember', {
        key,
        value: { content },
        type: 'capture',
        tags: ['inbox'],
        via: 'home:quick-capture',
      });
      if (r.ok) {
        setText('');
        setDone(key);
        setTimeout(() => setDone(null), 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading sub="Drop a thought — it lands in your inbox as a fact, provenance stamped.">Quick capture</Heading>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="What's on your mind?"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.6rem',
            background: '#fffef9',
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            color: theme.text,
            fontFamily: 'inherit',
            fontSize: '0.9rem',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div style={{ width: 160 }}>
            <Button onClick={() => void capture()} disabled={busy || !text.trim()}>
              {busy ? 'Remembering…' : 'Remember'}
            </Button>
          </div>
          {done ? (
            <span style={{ color: theme.accent, fontSize: '0.8rem' }}>
              ✓ remembered at <code style={{ fontFamily: theme.mono }}>{done}</code>
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ─── identity & grants shell (phase 2a; docs/scope-grants.md §6) ───

interface TokenRow {
  id: string;
  scope: string;
  label: string | null;
  clientId: string | null;
  revoked: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface GrantRow {
  owner: string;
  grantee: string;
  key: string;
  mode?: 'read' | 'write';
  createdAt: string;
}

interface RequestRow {
  key: string;
  requester: string;
  resource: string;
  note?: string;
  requestedAt: string;
}

interface AnswerRow {
  key: string;
  resource: string;
  status: 'approved' | 'denied';
  by: string;
  at: string;
  reason?: string;
}

interface IdentityData {
  tokens: TokenRow[];
  shared: GrantRow[];
  receiving: GrantRow[];
  incoming: RequestRow[];
  answers: AnswerRow[];
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  fontSize: '0.85rem',
};

function InlineButton({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        color: danger ? theme.danger : theme.accent,
        cursor: 'pointer',
        fontSize: '0.75rem',
        padding: '0.15rem 0.5rem',
      }}
    >
      {children}
    </button>
  );
}

/**
 * The identity & grants shell: the human projection of the grants vocabulary —
 * who am I, what credentials exist (revoke), what I've shared and what's
 * shared with me (revoke), and the grant-request inbox (approve/deny). Every
 * row is the same `mcpCall` an agent makes; this surface is a rendering, not
 * new plumbing.
 */
function IdentityShell({ authed, user, scopes }: { authed: boolean; user: string | null; scopes: string[] }): React.JSX.Element | null {
  const [data, setData] = useState<IdentityData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [tokens, shared, requests] = await Promise.all([
        mcpCall('read', 'auth.tokens'),
        mcpCall('read', 'workspace.shared'),
        mcpCall('read', 'workspace.grantRequests'),
      ]);
      const t = tokens.ok ? ((tokens.value as { tokens?: TokenRow[] }).tokens ?? []) : [];
      const s = shared.ok ? (shared.value as { shared?: GrantRow[]; receiving?: GrantRow[] }) : {};
      const r = requests.ok ? (requests.value as { incoming?: RequestRow[]; answers?: AnswerRow[] }) : {};
      setData({
        tokens: t.filter((x) => !x.revoked),
        shared: s.shared ?? [],
        receiving: s.receiving ?? [],
        incoming: r.incoming ?? [],
        answers: r.answers ?? [],
      });
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    if (!authed) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  if (!authed) return null;

  const act = async (label: string, verb: string, target: string, input: unknown): Promise<void> => {
    setBusy(label);
    try {
      const r = await mcpCall(verb, target, input);
      if (!r.ok) setErr(typeof r.value === 'string' ? r.value : 'error');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const section: React.CSSProperties = { display: 'grid', gap: '0.4rem' };

  return (
    <Card>
      <Heading sub="Day passes & permits — credentials, grants, and the request inbox, over the same auth.* / workspace.* targets agents use.">
        Identity &amp; grants
      </Heading>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <Badge>{user}</Badge>
        {scopes.map((s) => (
          <Badge key={s} tone="dim">
            {s}
          </Badge>
        ))}
      </div>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {!data ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {data.incoming.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Grant requests</strong>
              {data.incoming.map((r) => (
                <div key={r.key} style={rowStyle}>
                  <Badge tone="accent">{r.requester}</Badge>
                  <code style={{ fontSize: '0.78rem', fontFamily: theme.mono }}>{r.resource}</code>
                  {r.note ? <span style={{ color: theme.dim }}>“{r.note}”</span> : null}
                  <InlineButton onClick={() => void act(r.key, 'act', 'workspace.approveGrant', { key: r.key })}>
                    {busy === r.key ? '…' : 'Approve'}
                  </InlineButton>
                  <InlineButton danger onClick={() => void act(r.key, 'act', 'workspace.denyGrant', { key: r.key })}>
                    Deny
                  </InlineButton>
                </div>
              ))}
            </div>
          ) : null}

          <div style={section}>
            <strong style={{ fontFamily: theme.serif }}>Credentials</strong>
            {data.tokens.length === 0 ? (
              <span style={{ color: theme.dim, fontSize: '0.85rem' }}>No active tokens.</span>
            ) : (
              data.tokens.map((t) => (
                <div key={t.id} style={rowStyle}>
                  <span>{t.label ?? t.clientId ?? t.id.slice(0, 8)}</span>
                  <Badge tone="dim">{t.scope}</Badge>
                  <span style={{ color: theme.dim, fontSize: '0.75rem' }}>
                    {t.expiresAt ? `expires ${t.expiresAt.slice(0, 10)}` : 'non-expiring'}
                  </span>
                  <InlineButton danger onClick={() => void act(t.id, 'act', 'auth.revokeToken', { tokenId: t.id })}>
                    {busy === t.id ? '…' : 'Revoke'}
                  </InlineButton>
                </div>
              ))
            )}
          </div>

          <div style={section}>
            <strong style={{ fontFamily: theme.serif }}>Shared by you</strong>
            {data.shared.length === 0 ? (
              <span style={{ color: theme.dim, fontSize: '0.85rem' }}>Nothing shared.</span>
            ) : (
              data.shared.map((g) => (
                <div key={`${g.grantee}|${g.key}`} style={rowStyle}>
                  <Badge tone="dim">{g.grantee}</Badge>
                  <code style={{ fontSize: '0.78rem', fontFamily: theme.mono }}>{g.key}</code>
                  <Badge tone={g.mode === 'write' ? 'accent' : 'dim'}>{g.mode ?? 'read'}</Badge>
                  <InlineButton
                    danger
                    onClick={() => void act(`${g.grantee}|${g.key}`, 'act', 'workspace.unshare', { to: g.grantee, key: g.key })}
                  >
                    {busy === `${g.grantee}|${g.key}` ? '…' : 'Revoke'}
                  </InlineButton>
                </div>
              ))
            )}
          </div>

          {data.receiving.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Shared with you</strong>
              {data.receiving.map((g) => (
                <div key={`${g.owner}|${g.key}`} style={rowStyle}>
                  <Badge tone="dim">{g.owner}</Badge>
                  <code style={{ fontSize: '0.78rem', fontFamily: theme.mono }}>{g.key}</code>
                  <Badge tone={g.mode === 'write' ? 'accent' : 'dim'}>{g.mode ?? 'read'}</Badge>
                </div>
              ))}
            </div>
          ) : null}

          {data.answers.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Your requests</strong>
              {data.answers.map((a) => (
                <div key={a.key} style={rowStyle}>
                  <Badge tone={a.status === 'approved' ? 'accent' : 'danger'}>{a.status}</Badge>
                  <code style={{ fontSize: '0.78rem', fontFamily: theme.mono }}>{a.resource}</code>
                  <span style={{ color: theme.dim, fontSize: '0.75rem' }}>
                    by {a.by === user ? 'you' : a.by}
                    {a.reason ? ` — “${a.reason}”` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// ─── the type vocabulary (presentation/routing as data) ────────────

interface ListEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string };
}

/**
 * Type vocabulary (docs/type-vocabulary.md): the fact→cell open/edit/render
 * table is *data*, resolved by the shared `resolve()` — no hardcoded routing.
 * The defaults encode parc's conventions; substrate `_types/<type>` facts
 * override them per-type (old-shape `{icon,titlePath,href}` facts are
 * normalised so existing declarations keep working).
 */
let typeDecls: Record<string, TypeDecl> = { ...DEFAULT_TYPE_DECLS };

interface LegacyTypeDecl { icon?: string; titlePath?: string; href?: string; manager?: string; label?: string; handlers?: TypeDecl['handlers'] }
function normalizeDecl(d: LegacyTypeDecl): TypeDecl {
  if (d.handlers || !d.href) return d as TypeDecl; // already new-shape
  return { icon: d.icon, manager: d.manager, label: d.label ?? d.titlePath, handlers: { open: [{ surface: d.href }] } };
}

export async function loadTypeDecls(): Promise<void> {
  try {
    // $types is the global vocabulary (the cell registry's canonical declarations
    // merged under this user's _types overrides), so home resolves the same way
    // for any signed-in user — not just the cells' owner.
    const r = await mcpCall('read', '$types');
    if (r.ok) {
      const raw = (r.value as { types?: Record<string, LegacyTypeDecl> }).types ?? {};
      const norm = Object.fromEntries(Object.entries(raw).map(([t, d]) => [t, normalizeDecl(d)]));
      typeDecls = { ...DEFAULT_TYPE_DECLS, ...norm }; // canonical + overrides win over the built-in fallback
    }
  } catch {
    /* defaults still apply */
  }
}
function pathInto(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function typeIcon(e: ListEntry): string {
  return declFor(e, typeDecls)?.icon ?? '';
}

/** A fact's one-line presentation: title from its value (its declared label path), not its key. */
function factTitle(e: ListEntry): string {
  const label = declFor(e, typeDecls)?.label;
  if (label) {
    const v = pathInto(e.value, label);
    if (typeof v === 'string' && v) return v.slice(0, 80);
  }
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

/** Where a fact opens — resolved from the type vocabulary, no hardcoded cells. */
function factHref(e: ListEntry): string | null {
  const s = resolve(e, 'open', typeDecls)?.surface;
  return s ? localize(s) : null;
}

/** Where a fact edits — its type's `edit` handler, if it declares one. */
function factEdit(e: ListEntry): string | null {
  const s = resolve(e, 'edit', typeDecls)?.surface;
  return s ? localize(s) : null;
}

/** A small "✎ edit" link, shown only when the fact's type declares an edit surface. */
function EditLink({ e }: { e: ListEntry }): React.JSX.Element | null {
  const to = factEdit(e);
  if (!to) return null;
  return (
    <a href={to} title="Edit" style={{ color: theme.dim, fontSize: '0.72rem', textDecoration: 'none', fontFamily: theme.mono }}>
      ✎ edit
    </a>
  );
}

/** A content snippet beyond the title — the *substance* of a fact, for exploration. */
function factPreview(e: ListEntry): string {
  const v = e.value;
  if (v == null || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  const text =
    typeof o.content === 'string' ? o.content
    : typeof o.body === 'string' ? o.body
    : typeof o.text === 'string' ? o.text
    : typeof o.description === 'string' ? o.description
    : typeof o.note === 'string' ? o.note
    : '';
  if (text) {
    // Drop the first line (it usually became the title), then flatten.
    const lines = text.split('\n').filter((l) => l.trim());
    const body = lines.length > 1 ? lines.slice(1).join(' ') : lines[0] ?? '';
    return body.replace(/[#*_`>[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  // Structured value: a few scalar fields.
  const parts: string[] = [];
  for (const [k, val] of Object.entries(o)) {
    if (['content', 'title', 'name', 'id', 'src'].includes(k) || val == null || typeof val === 'object') continue;
    parts.push(`${k}: ${String(val).slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

interface Edge {
  from: string;
  rel: string;
  to: string;
}

// ─── the workspace window (phase 2c) ───────────────────────────────

interface AttentionData {
  stale: Array<{ key: string; updatedAt: string; type: string | null }>;
  unlinked: string[];
  dangling: Array<{ from: string; rel: string; to: string; reason: string }>;
}

/**
 * The signed-in window over the substrate: an attention strip (the
 * just-in-time cron, read at a glance) above the most salient facts of the
 * slice — `query` ranked by salience, titled and routed by the `_types`
 * vocabulary, exactly the shaping agents get from the same read.
 */
function WorkspaceWindow({ authed }: { authed: boolean }): React.JSX.Element | null {
  const [att, setAtt] = useState<AttentionData | null>(null);
  const [facts, setFacts] = useState<ListEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [edges, setEdges] = useState<Map<string, Edge[]>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    (async () => {
      try {
        await loadTypeDecls();
        const [a, q, l] = await Promise.all([
          mcpCall('read', 'workspace.attention', { limit: 5 }),
          mcpCall('read', 'workspace.query', { limit: 10 }),
          mcpCall('read', 'workspace.links'),
        ]);
        if (!live) return;
        if (a.ok) setAtt(a.value as AttentionData);
        if (l.ok) {
          // Group edges by source so each fact can show its relationships.
          const all = ((l.value as { edges?: Edge[] }).edges ?? []).filter((x) => !x.from.startsWith('_'));
          const m = new Map<string, Edge[]>();
          for (const ed of all) {
            const list = m.get(ed.from) ?? [];
            list.push(ed);
            m.set(ed.from, list);
          }
          setEdges(m);
        }
        if (q.ok) {
          const v = q.value as { entries?: ListEntry[]; total?: number };
          setFacts(v.entries ?? []);
          setTotal(v.total ?? 0);
        } else {
          setErr(typeof q.value === 'string' ? q.value : 'error');
        }
      } catch (e) {
        if (live) setErr(String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [authed]);

  if (!authed) return null;

  const attTotal = att ? att.stale.length + att.unlinked.length + att.dangling.length : 0;

  return (
    <Card>
      <Heading sub="Your slice, salience-ranked — the same query an agent makes, rendered. The strip is the ranger's notebook.">
        Workspace
      </Heading>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {att ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.3rem 0 0.6rem' }}>
          <Badge tone={attTotal ? 'accent' : 'dim'}>
            {attTotal ? `needs attention: ${attTotal}` : 'all trails clear'}
          </Badge>
          {att.stale.length ? <Badge tone="dim">{att.stale.length} stale</Badge> : null}
          {att.unlinked.length ? <Badge tone="dim">{att.unlinked.length} unlinked</Badge> : null}
          {att.dangling.length ? <Badge tone="dim">{att.dangling.length} dangling edges</Badge> : null}
        </div>
      ) : null}
      {facts === null ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : facts.length === 0 ? (
        <p style={{ color: theme.dim }}>An empty slice — remember something.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.7rem' }}>
          {facts.map((e) => {
            const to = factHref(e);
            const icon = typeIcon(e);
            const title = `${icon ? icon + ' ' : ''}${factTitle(e)}`;
            const preview = factPreview(e);
            const out = edges.get(e.key) ?? [];
            return (
              <li key={e.key} style={{ lineHeight: 1.4, display: 'grid', gap: '0.15rem' }}>
                {to ? (
                  <a href={to} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600 }}>{title}</a>
                ) : (
                  <strong style={{ fontWeight: 600 }}>{title}</strong>
                )}
                {preview ? (
                  <span style={{ color: theme.text, fontSize: '0.8rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {preview}
                  </span>
                ) : null}
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: theme.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>
                    {[e._meta?.type, e.key].filter(Boolean).join(' · ')}
                  </span>
                  <EditLink e={e} />
                  {out.slice(0, 5).map((ed, i) => (
                    <span
                      key={i}
                      title={`${ed.rel} → ${ed.to}`}
                      style={{ fontSize: '0.66rem', color: theme.accent, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '0 0.4rem', fontFamily: theme.mono, whiteSpace: 'nowrap' }}
                    >
                      {ed.rel}→{ed.to.length > 14 ? ed.to.slice(0, 13) + '…' : ed.to}
                    </span>
                  ))}
                  {out.length > 5 ? <span style={{ color: theme.dim, fontSize: '0.66rem' }}>+{out.length - 5}</span> : null}
                </div>
              </li>
            );
          })}
          {total > facts.length ? (
            <li style={{ color: theme.dim, fontSize: '0.8rem' }}>… {total - facts.length} more (query/recall for the rest)</li>
          ) : null}
        </ul>
      )}
    </Card>
  );
}

// ─── pinned views (registered views rendered by hint) ──────────────

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
    background: theme.panel,
    borderRadius: 10,
    padding: '0.7rem 0.9rem',
    display: 'grid',
    gap: '0.25rem',
  };

  if (err) {
    return (
      <div style={box}>
        <strong style={{ fontFamily: theme.serif }}>{label}</strong>
        <Badge tone="danger">{err}</Badge>
      </div>
    );
  }

  // A canvas view IS a board. The embed is now the cell's zero-JS static SSR
  // thumbnail (?embed=1): server-rendered, edge-cached, no app mounted — so
  // many pinned boards show real previews inline without the crash. Lazy-loaded
  // and click-through to the interactive board.
  if (type === 'canvas') {
    // Address the board by its VIEW id so SSR honours the view's declared
    // viewport (the "look here") instead of fitting the whole board.
    const href = localize(hint?.href ?? `/@c15r/canvas?view=${encodeURIComponent(def.id)}`);
    const embedSrc = localize(`/@c15r/canvas?view=${encodeURIComponent(def.id)}&embed=1&w=620&h=240`);
    return (
      <div style={{ ...box, padding: 0, overflow: 'hidden' }}>
        {/* The iframe is purely visual (pointer-events:none); a transparent
            overlay link captures the tap so page scroll passes straight through
            — iframes otherwise swallow touch on iOS even when inert. */}
        <div style={{ position: 'relative', height: 240 }}>
          <iframe
            src={embedSrc}
            title={label}
            loading="lazy"
            scrolling="no"
            tabIndex={-1}
            aria-hidden
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block', background: '#fff', pointerEvents: 'none' }}
          />
          <a
            href={href}
            title={`Open ${label}`}
            aria-label={`Open ${label}`}
            style={{ position: 'absolute', inset: 0, display: 'block' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0.9rem', gap: '0.5rem' }}>
          <strong style={{ fontFamily: theme.serif }}>🌲 {label}</strong>
          <a href={href} style={{ color: theme.accent, fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}>
            {out ? `${out.count} item${out.count === 1 ? '' : 's'} · ` : ''}Open board →
          </a>
        </div>
      </div>
    );
  }

  if (type === 'metric' || type === 'count') {
    return (
      <div style={box}>
        <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{label}</span>
        <strong style={{ fontSize: '1.6rem', fontFamily: theme.serif }}>{out ? String(out.value ?? '—') : '…'}</strong>
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
            <strong style={{ fontFamily: theme.serif }}>{label} →</strong>
          </a>
        ) : (
          <strong style={{ fontFamily: theme.serif }}>{label}</strong>
        )}
        {out === null ? (
          <span style={{ color: theme.dim }}>Loading…</span>
        ) : entries.length === 0 ? (
          <span style={{ color: theme.dim }}>Empty.</span>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
            {entries.slice(0, 8).map((e) => {
              const to = factHref(e);
              const icon = typeIcon(e);
              const title = `${icon ? icon + ' ' : ''}${factTitle(e)}`;
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
      <strong style={{ fontFamily: theme.serif }}>{label}</strong>
      {out === null ? <span style={{ color: theme.dim }}>Loading…</span> : <CodeBlock>{JSON.stringify(out.value, null, 2)}</CodeBlock>}
    </div>
  );
}

/**
 * Registered views, rendered as surfaces (home redesign phase 3 seed: the UI
 * comes from the registry, not code).
 */
function Views({ authed }: { authed: boolean }): React.JSX.Element | null {
  const [views, setViews] = useState<ViewDef[] | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    // Load the type vocabulary first so list surfaces show icons + route by it.
    loadTypeDecls().then(() => {
      if (!live) return;
      return mcpCall('read', 'workspace.views').then((r) => {
        if (!live) return;
        setViews(r.ok ? ((r.value as { views?: ViewDef[] }).views ?? []) : []);
      });
    }).catch(() => {
      if (live) setViews([]);
    });
    return () => {
      live = false;
    };
  }, [authed]);

  if (!authed || views === null || views.length === 0) return null;
  return (
    <Card>
      <Heading sub="Registered views rendered by their hints — one declaration, a surface for you and an affordance for agents.">
        Pinned views
      </Heading>
      <div style={{ display: 'grid', gap: '0.7rem', marginTop: '0.5rem' }}>
        {views.map((v) => (
          <ViewSurface key={v.id} def={v} />
        ))}
      </div>
    </Card>
  );
}

// ─── the cells console (phase 2c) ──────────────────────────────────

interface CellRow {
  cellId: string;
  name: string;
  status: string;
  public: boolean;
  description: string | null;
  address: string;
}

/** One owned cell as its own card: address, status, description, on-demand logs. */
function CellCard({ cell }: { cell: CellRow }): React.JSX.Element {
  const [logs, setLogs] = useState<Array<{ time: string; message: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  const tailLogs = async (): Promise<void> => {
    if (logs) {
      setLogs(null);
      return;
    }
    setBusy(true);
    try {
      const r = await mcpCall('read', 'cells.logs', { cellId: cell.cellId, since: '1h', limit: 15 });
      setLogs(r.ok ? ((r.value as { events?: Array<{ time: string; message: string }> }).events ?? []) : []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: '0.9rem 1rem', display: 'grid', gap: '0.45rem', alignContent: 'start' }}>
      <a
        href={localize(cell.address)}
        style={{ color: theme.accent, textDecoration: 'none', fontFamily: theme.mono, fontSize: '0.9rem', fontWeight: 600, wordBreak: 'break-word' }}
      >
        {cell.address}
      </a>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
        <Badge tone={cell.status === 'ACTIVE' ? 'accent' : 'dim'}>{cell.status}</Badge>
        {cell.public ? <Badge tone="dim">public</Badge> : null}
      </div>
      {cell.description ? (
        <span style={{ color: theme.dim, fontSize: '0.8rem', lineHeight: 1.35 }}>{cell.description}</span>
      ) : null}
      <div>
        <InlineButton onClick={() => void tailLogs()}>{busy ? '…' : logs ? 'Hide logs' : 'Logs (1h)'}</InlineButton>
      </div>
      {logs ? (
        logs.length === 0 ? (
          <span style={{ color: theme.dim, fontSize: '0.78rem' }}>No log events in the last hour.</span>
        ) : (
          <CodeBlock>{logs.map((l) => `${l.time.slice(11, 19)}  ${l.message.trim()}`).join('\n')}</CodeBlock>
        )
      ) : null}
    </Card>
  );
}

/** The cells section: framing text (no card), each cell its own card in a grid. */
function CellsConsole({ authed }: { authed: boolean }): React.JSX.Element | null {
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    mcpCall('read', 'cells.list')
      .then((r) => {
        if (!live) return;
        if (r.ok) setCells(((r.value as { cells?: CellRow[] }).cells ?? []));
        else setErr(typeof r.value === 'string' ? r.value : 'error');
      })
      .catch((e) => {
        if (live) setErr(String(e));
      });
    return () => {
      live = false;
    };
  }, [authed]);

  if (!authed || (cells !== null && cells.length === 0)) return null;
  return (
    <section style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ padding: '0 0.25rem' }}>
        <h2 style={{ margin: 0, fontFamily: theme.serif, fontWeight: 600, fontSize: '1.2rem' }}>Cells</h2>
        <p style={{ margin: '0.2rem 0 0', color: theme.dim, fontSize: '0.88rem' }}>
          Your outposts — deployed cells with their own addresses and logs. Author and ship through{' '}
          <code style={{ fontFamily: theme.mono }}>cells.*</code> on the field computer.
        </p>
      </div>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {cells === null ? (
        <p style={{ color: theme.dim, padding: '0 0.25rem' }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.7rem', alignItems: 'start' }}>
          {cells.map((c) => (
            <CellCard key={c.cellId} cell={c} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── the field computer (the console, housed) ──────────────────────
//
// The one deliberately-technical object in the warm room: the raw read/act
// console, OAuth discovery, and the resource probe live inside a dark
// machine housing — green phosphor on deep pine, like the radio at the
// ranger station. Power users open the lid; everyone else never needs to.

const machine = {
  housing: '#13241f',
  bezel: '#0b1a16',
  screen: '#0a1f1a',
  text: '#cfe3c0',
  dim: '#7f9a82',
  green: '#7fc97f',
  border: '#2c4a3c',
} as const;

interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  scope: string | null;
  inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] };
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

// A unified palette command: every capability from $catalog plus a couple of
// built-in probes (whoami, oauth discovery). One model, one output stack.
interface Cmd {
  id: string;
  ns: string;
  verb: string;
  label: string;
  kind: 'read' | 'act' | 'probe';
  scope: string | null;
  description: string;
  schema?: Capability['inputSchema'];
  needsArgs: boolean;
  run: (input: unknown) => Promise<{ ok: boolean; value: unknown }>;
  search: string;
}

interface Output {
  n: number;
  label: string;
  kind: Cmd['kind'];
  ok: boolean;
  value: unknown;
  at: number;
}

/** Subsequence fuzzy match (canvas palette's model): all query chars in order. */
function fuzzy(text: string, q: string): boolean {
  let ti = 0;
  let qi = 0;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) qi++;
    ti++;
  }
  return qi === q.length;
}

const PROBE_CMDS: Cmd[] = [
  {
    id: 'probe:whoami',
    ns: 'probe',
    verb: 'whoami',
    label: 'whoami',
    kind: 'probe',
    scope: null,
    description: 'Who the session is — GET /mcp/whoami.',
    needsArgs: false,
    search: 'probe whoami identity who am i',
    run: async () => {
      const r = await getJson('/mcp/whoami');
      return { ok: r.status === 200, value: r.body };
    },
  },
  {
    id: 'probe:oauth',
    ns: 'probe',
    verb: 'oauth discovery',
    label: 'oauth discovery',
    kind: 'probe',
    scope: null,
    description: 'The RFC 8414 authorization-server metadata.',
    needsArgs: false,
    search: 'probe oauth discovery metadata well-known issuer',
    run: async () => {
      const r = await getJson('/.well-known/oauth-authorization-server');
      const m = (r.body ?? {}) as Record<string, unknown>;
      return {
        ok: r.status === 200,
        value: r.status === 200 ? { issuer: m.issuer, authorization_endpoint: m.authorization_endpoint, token_endpoint: m.token_endpoint, registration_endpoint: m.registration_endpoint } : m,
      };
    },
  },
];

function capToCmd(cap: Capability): Cmd {
  const dot = cap.target.lastIndexOf('.');
  const ns = dot > 0 ? cap.target.slice(0, dot) : cap.target;
  const verb = cap.target.slice(dot + 1);
  const needsArgs = Object.keys(cap.inputSchema?.properties ?? {}).length > 0;
  return {
    id: cap.target,
    ns,
    verb,
    label: cap.target,
    kind: cap.kind,
    scope: cap.scope,
    description: cap.description,
    schema: cap.inputSchema,
    needsArgs,
    search: `${cap.target} ${cap.description} ${cap.scope ?? ''}`.toLowerCase(),
    run: (input) => mcpCall(cap.kind === 'read' ? 'read' : 'act', cap.target, input),
  };
}

const kindColor = (k: Cmd['kind']): string => (k === 'act' ? machine.green : machine.dim);

/** A pill in the machine's voice (kind / scope / namespace). */
function MonoPill({ children, color }: { children: React.ReactNode; color?: string }): React.JSX.Element {
  return (
    <span style={{ color: color ?? machine.dim, fontFamily: theme.mono, fontSize: '0.7rem', border: `1px solid ${machine.border}`, borderRadius: 999, padding: '0 0.45rem', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/**
 * The console as a command palette (interaction modelled on @c15r/canvas):
 * type to fuzzy-filter every capability; empty shows recents + namespace
 * chips for progressive disclosure; pick a command to reveal its args (or run
 * straight away); results stack below, newest first. The human drives the same
 * read/act wire an agent does.
 */
function Console({ authed }: { authed: boolean }): React.JSX.Element {
  const [cmds, setCmds] = useState<Cmd[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState<Cmd | null>(null);
  const [args, setArgs] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const counter = React.useRef(0);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    mcpCall('read', '$catalog')
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          setErr(typeof r.value === 'string' ? r.value : 'error');
          setCmds([...PROBE_CMDS]);
          return;
        }
        const caps = (r.value as { capabilities?: Capability[] }).capabilities ?? [];
        setCmds([...caps.map(capToCmd), ...PROBE_CMDS]);
      })
      .catch((e) => {
        if (live) {
          setErr(String(e));
          setCmds([...PROBE_CMDS]);
        }
      });
    return () => {
      live = false;
    };
  }, [authed]);

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const all = cmds ?? [];
    if (!q) return [];
    return all
      .filter((c) => fuzzy(c.search, q) || c.search.includes(q))
      .sort((a, b) => {
        const ae = a.search.includes(q);
        const be = b.search.includes(q);
        if (ae !== be) return ae ? -1 : 1;
        return a.label.length - b.label.length;
      })
      .slice(0, 12);
  }, [cmds, q]);

  // Namespaces with counts — the "what's available" overview when idle.
  const namespaces = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cmds ?? []) m.set(c.ns, (m.get(c.ns) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cmds]);

  const select = (cmd: Cmd): void => {
    if (cmd.needsArgs) {
      setFocused(cmd);
      setArgs(argSkeleton(cmd.schema));
    } else {
      void invoke(cmd, {});
    }
  };

  const invoke = async (cmd: Cmd, input: unknown): Promise<void> => {
    setBusy(true);
    try {
      const r = await cmd.run(input);
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: r.ok, value: r.value, at: Date.now() }, ...prev].slice(0, 40));
    } catch (e) {
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: false, value: String(e), at: Date.now() }, ...prev]);
    } finally {
      setBusy(false);
      setFocused(null);
      setQuery('');
      setSel(0);
    }
  };

  const runFocused = (): void => {
    if (!focused) return;
    let input: unknown;
    try {
      input = args.trim() ? JSON.parse(args) : {};
    } catch {
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: focused.label, kind: focused.kind, ok: false, value: 'Invalid JSON in arguments', at: Date.now() }, ...prev]);
      return;
    }
    void invoke(focused, input);
  };

  const inputColor = machine.text;
  const screen: React.CSSProperties = { background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, color: machine.text, fontFamily: theme.mono };

  // ── focused: one command's arg entry ──
  if (focused) {
    return (
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setFocused(null)}
              style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
            >
              ‹ back
            </button>
            <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.9rem' }}>{focused.label}</code>
            <MonoPill color={kindColor(focused.kind)}>{focused.kind}</MonoPill>
            {focused.scope ? <MonoPill>{focused.scope}</MonoPill> : null}
          </div>
          {focused.description ? <span style={{ color: machine.dim, fontSize: '0.8rem' }}>{focused.description}</span> : null}
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={Math.min(12, Math.max(2, args.split('\n').length))}
            spellCheck={false}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                runFocused();
              }
            }}
            style={{ ...screen, width: '100%', boxSizing: 'border-box', padding: '0.55rem', fontSize: '0.8rem' }}
          />
          <div>
            <button
              onClick={runFocused}
              disabled={busy}
              style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: `1px solid ${machine.green}`, background: 'transparent', color: machine.green, fontFamily: theme.mono, fontSize: '0.8rem', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Running…' : `run · ${focused.kind}("${focused.label}")  ⌘↵`}
            </button>
          </div>
        </div>
        <OutputStack outputs={outputs} onClear={() => setOutputs([])} />
      </div>
    );
  }

  // ── browse: search + (recents-less) namespace overview or filtered list ──
  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      <div style={{ ...screen, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem' }}>
        <span style={{ color: machine.green, fontFamily: theme.mono }}>›</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => (filtered.length ? (s + 1) % filtered.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0));
            } else if (e.key === 'Enter' && filtered[sel]) {
              e.preventDefault();
              select(filtered[sel]);
            } else if (e.key === 'Escape') {
              setQuery('');
            }
          }}
          placeholder="Type a command — workspace.query, cells.list, whoami…"
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: inputColor, fontFamily: theme.mono, fontSize: '0.85rem' }}
        />
        {query ? (
          <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: machine.dim, cursor: 'pointer', fontSize: '1rem' }}>
            ×
          </button>
        ) : null}
      </div>

      {err && !cmds?.length ? <span style={{ color: '#e08c7a', fontFamily: theme.mono, fontSize: '0.8rem' }}>{err}</span> : null}
      {!cmds && !err ? <p style={{ color: machine.dim, margin: 0 }}>Loading capabilities…</p> : null}

      {q ? (
        filtered.length === 0 ? (
          <p style={{ color: machine.dim, margin: 0, fontSize: '0.82rem' }}>No command matches “{query}”.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.15rem' }}>
            {filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  onClick={() => select(c)}
                  onMouseEnter={() => setSel(i)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    padding: '0.4rem 0.55rem',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: i === sel ? 'rgba(127,201,127,0.10)' : 'transparent',
                    borderColor: i === sel ? machine.border : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.82rem' }}>{c.label}</code>
                  <MonoPill color={kindColor(c.kind)}>{c.kind}</MonoPill>
                  {c.needsArgs ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>args</span> : null}
                  <span style={{ color: machine.dim, fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {c.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        // idle: the overview — namespaces as chips (progressive disclosure)
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {cmds ? `${cmds.length} commands` : '…'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {namespaces.map(([ns, n]) => (
              <button
                key={ns}
                onClick={() => {
                  setQuery(ns + '.');
                  setSel(0);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.6rem', borderRadius: 999, border: `1px solid ${machine.border}`, background: 'transparent', color: machine.text, fontFamily: theme.mono, fontSize: '0.78rem', cursor: 'pointer' }}
              >
                {ns}
                <span style={{ color: machine.dim }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <OutputStack outputs={outputs} onClear={() => setOutputs([])} />
    </div>
  );
}

/** Results stack, newest first — the machine's running tape. */
function OutputStack({ outputs, onClear }: { outputs: Output[]; onClear: () => void }): React.JSX.Element | null {
  if (outputs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: '0.5rem', borderTop: `1px solid ${machine.border}`, paddingTop: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          output · newest first
        </span>
        <button onClick={onClear} style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', cursor: 'pointer' }}>
          clear
        </button>
      </div>
      {outputs.map((o) => (
        <div key={o.n} style={{ display: 'grid', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: o.ok ? machine.green : '#e08c7a', fontFamily: theme.mono, fontSize: '0.72rem' }}>{o.ok ? '✓' : '✕'}</span>
            <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.78rem' }}>{o.label}</code>
            <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>
              {new Date(o.at).toLocaleTimeString()}
            </span>
          </div>
          <pre style={{ background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.55rem', margin: 0, overflowX: 'auto', fontFamily: theme.mono, fontSize: '0.76rem', color: o.ok ? machine.text : '#e08c7a', maxHeight: 320 }}>
          <code>{typeof o.value === 'string' ? o.value : JSON.stringify(o.value, null, 2)}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}

/** The housing: a collapsed machine that opens into the command palette. */
function FieldComputer({ authed }: { authed: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section
      style={{
        background: machine.housing,
        border: `1px solid ${machine.border}`,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.6rem',
          padding: '0.9rem 1.1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <img src={computerUrl} alt="" aria-hidden style={{ width: 54, height: 'auto', flexShrink: 0 }} />
          <span style={{ display: 'grid', gap: '0.1rem' }}>
            <span style={{ color: machine.green, fontFamily: theme.mono, fontSize: '0.9rem', letterSpacing: '0.08em' }}>
              ▮ FIELD COMPUTER
            </span>
            <span style={{ color: machine.dim, fontSize: '0.78rem' }}>
              The raw read/act console — every capability, the same wire an agent uses.
            </span>
          </span>
        </span>
        <span style={{ color: machine.dim, fontFamily: theme.mono }}>{open ? '–' : '+'}</span>
      </button>
      {open ? (
        <div style={{ padding: '0 1.1rem 1.1rem', display: 'grid', gap: '1rem', borderTop: `1px solid ${machine.border}`, paddingTop: '1rem' }}>
          <Console authed={authed} />
          <p style={{ color: machine.dim, fontSize: '0.75rem', margin: 0 }}>
            Tokens come from OAuth: clients register (DCR), redirect to /oauth/authorize, you approve
            with a passkey. Agents connect at parc.land/mcp — whoami · read · act.
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ─── the page ──────────────────────────────────────────────────────

// ─── the home layout (phase 3: the UI comes from the registry, not code) ──
//
// Home renders from a `_home/layout` fact in the signed-in slice — an ordered
// list of sections — falling back to the default order when absent. Sections
// are the built-in surfaces plus custom ones (a pinned view/board, a single
// fact, an ad-hoc query). Customising = writing the fact; "make your own home
// over time" is data, not a fork. (docs/home-cell.md phase 3.)

interface LayoutSection {
  type: string;
  id?: string; // view id (type 'view')
  key?: string; // fact key (type 'fact')
  query?: Record<string, unknown>; // (type 'query')
  title?: string;
  hidden?: boolean;
}

const DEFAULT_LAYOUT: LayoutSection[] = [
  { type: 'greeting' },
  { type: 'stats' },
  { type: 'capture' },
  { type: 'workspace' },
  { type: 'activity' },
  { type: 'identity' },
  { type: 'views' },
  { type: 'cells' },
  { type: 'console' },
];

const SECTION_LABELS: Record<string, string> = {
  greeting: 'Greeting', stats: 'Stats', capture: 'Quick capture', workspace: 'Workspace',
  activity: 'Recent activity', identity: 'Identity & grants', views: 'Pinned views',
  cells: 'Cells', console: 'Field computer',
};
function sectionLabel(s: LayoutSection): string {
  if (s.type === 'view') return `Board · ${s.id}`;
  if (s.type === 'fact') return `Fact · ${s.key}`;
  if (s.type === 'query') return `Query · ${s.title ?? '…'}`;
  return SECTION_LABELS[s.type] ?? s.type;
}

function useLayout(authed: boolean): { sections: LayoutSection[]; save: (next: LayoutSection[]) => void } {
  const [sections, setSections] = useState<LayoutSection[]>(DEFAULT_LAYOUT);
  useEffect(() => {
    if (!authed) return;
    let live = true;
    mcpCall('read', 'workspace.peek', { key: '_home/layout' })
      .then((r) => {
        if (!live) return;
        const secs = (r.ok ? (r.value as { value?: { sections?: LayoutSection[] } } | null)?.value?.sections : null) ?? null;
        if (Array.isArray(secs) && secs.length) setSections(secs);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [authed]);
  const save = (next: LayoutSection[]): void => {
    setSections(next);
    void mcpCall('act', 'workspace.remember', {
      key: '_home/layout',
      value: { sections: next },
      type: 'home-layout',
      via: 'home:customize',
    });
  };
  return { sections, save };
}

/** A single pinned fact, rendered as a card with its content + open path (via the type vocabulary). */
function PinnedFact({ factKey }: { factKey: string }): React.JSX.Element | null {
  const [entry, setEntry] = useState<{ value?: unknown; _meta?: ListEntry['_meta'] } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadTypeDecls()
      .then(() => mcpCall('read', 'workspace.peek', { key: factKey }))
      .then((r) => {
        if (live) setEntry(r.ok ? ((r.value as { value?: unknown; _meta?: ListEntry['_meta'] }) ?? null) : null);
      })
      .catch(() => setEntry(null));
    return () => {
      live = false;
    };
  }, [factKey]);
  if (entry === undefined) return <Card><p style={{ color: theme.dim }}>Loading…</p></Card>;
  if (entry === null) return null;
  const e: ListEntry = { key: factKey, value: entry.value, _meta: entry._meta };
  const to = factHref(e);
  const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
  const preview = factPreview(e);
  return (
    <Card style={{ display: 'grid', gap: '0.3rem' }}>
      {to ? (
        <a href={to} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600, fontFamily: theme.serif, fontSize: '1.05rem' }}>{title}</a>
      ) : (
        <strong style={{ fontFamily: theme.serif, fontSize: '1.05rem' }}>{title}</strong>
      )}
      {preview ? <span style={{ color: theme.text, fontSize: '0.85rem' }}>{preview}</span> : null}
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <span style={{ color: theme.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>{factKey}</span>
        <EditLink e={e} />
      </div>
    </Card>
  );
}

/** An ad-hoc query, rendered as a titled list. */
function PinnedQuery({ query, title }: { query: Record<string, unknown>; title?: string }): React.JSX.Element {
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const qs = JSON.stringify(query);
  useEffect(() => {
    let live = true;
    loadTypeDecls()
      .then(() => mcpCall('read', 'workspace.query', { limit: 8, ...query }))
      .then((r) => {
        if (live) setEntries(r.ok ? ((r.value as { entries?: ListEntry[] }).entries ?? []) : []);
      })
      .catch(() => setEntries([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  return (
    <Card>
      <Heading sub="A pinned query over your slice.">{title ?? 'Query'}</Heading>
      {entries === null ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: theme.dim }}>Nothing matches.</p>
      ) : (
        <ul style={{ margin: '0.4rem 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
          {entries.map((e) => {
            const to = factHref(e);
            const t = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
            return (
              <li key={e.key} style={{ lineHeight: 1.35 }}>
                {to ? <a href={to} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600 }}>{t}</a> : <span>{t}</span>}
                <div style={{ color: theme.dim, fontSize: '0.7rem', fontFamily: theme.mono }}>{e.key}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface SectionCtx {
  session: Session & { signIn: () => void; signOut: () => void };
  authed: boolean;
  dash: DashboardData | null;
}

function SectionView({ s, ctx }: { s: LayoutSection; ctx: SectionCtx }): React.JSX.Element | null {
  switch (s.type) {
    case 'greeting': return <DashboardHeader session={ctx.session} />;
    case 'stats': return <StatCards data={ctx.dash} />;
    case 'capture': return <QuickCapture />;
    case 'workspace': return <WorkspaceWindow authed={ctx.authed} />;
    case 'activity': return <RecentActivity data={ctx.dash} />;
    case 'identity': return <IdentityShell authed={ctx.authed} user={ctx.session.user} scopes={ctx.session.scopes} />;
    case 'views': return <Views authed={ctx.authed} />;
    case 'cells': return <CellsConsole authed={ctx.authed} />;
    case 'console': return <FieldComputer authed={ctx.authed} />;
    case 'view': return s.id ? <ViewSurface def={{ id: s.id }} /> : null;
    case 'fact': return s.key ? <PinnedFact factKey={s.key} /> : null;
    case 'query': return <PinnedQuery query={s.query ?? {}} title={s.title} />;
    default: return null;
  }
}

/** Customise mode: per-section reorder + hide/remove, persisted to `_home/layout`. */
function SectionControls({
  index,
  total,
  hidden,
  onMove,
  onToggle,
  onRemove,
}: {
  index: number;
  total: number;
  hidden: boolean;
  onMove: (dir: -1 | 1) => void;
  onToggle: () => void;
  onRemove?: () => void;
}): React.JSX.Element {
  const btn: React.CSSProperties = {
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    color: theme.accent,
    cursor: 'pointer',
    fontSize: '0.75rem',
    padding: '0.1rem 0.45rem',
  };
  return (
    <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', margin: '0 0.25rem' }}>
      <button style={btn} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
      <button style={btn} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
      {onRemove ? (
        <button style={{ ...btn, color: theme.danger }} onClick={onRemove}>remove</button>
      ) : (
        <button style={{ ...btn, color: hidden ? theme.accent : theme.danger }} onClick={onToggle}>
          {hidden ? 'show' : 'hide'}
        </button>
      )}
    </div>
  );
}

/** Add a custom section to the layout — a board, a fact, or an ad-hoc query. */
function AddSection({ onAdd }: { onAdd: (s: LayoutSection) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'view' | 'fact' | 'query' | null>(null);
  const [boards, setBoards] = useState<Array<{ id: string; label: string }> | null>(null);
  const [factKey, setFactKey] = useState('');
  const [q, setQ] = useState({ type: '', tag: '', prefix: '', title: '' });

  useEffect(() => {
    if (mode !== 'view' || boards) return;
    mcpCall('read', 'workspace.views')
      .then((r) => {
        const views = r.ok ? ((r.value as { views?: Array<{ id: string; render?: { type?: string; label?: string } }> }).views ?? []) : [];
        setBoards(views.filter((v) => v.render?.type === 'canvas').map((v) => ({ id: v.id, label: v.render?.label ?? v.id })));
      })
      .catch(() => setBoards([]));
  }, [mode, boards]);

  const field: React.CSSProperties = {
    padding: '0.4rem 0.5rem', background: '#fffef9', border: `1px solid ${theme.border}`,
    borderRadius: 6, color: theme.text, fontSize: '0.82rem', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const tab = (m: 'view' | 'fact' | 'query', label: string): React.JSX.Element => (
    <button
      onClick={() => setMode(mode === m ? null : m)}
      style={{ background: mode === m ? theme.accent : theme.panel, color: mode === m ? theme.cream : theme.accent, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '0.2rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer' }}
    >
      {label}
    </button>
  );

  return (
    <Card style={{ display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: theme.serif }}>Add a section</strong>
        {tab('view', '🌲 Board')}
        {tab('fact', '📄 Fact')}
        {tab('query', '🔎 Query')}
      </div>
      {mode === 'view' ? (
        boards === null ? (
          <span style={{ color: theme.dim, fontSize: '0.82rem' }}>Loading boards…</span>
        ) : boards.length === 0 ? (
          <span style={{ color: theme.dim, fontSize: '0.82rem' }}>No boards registered.</span>
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {boards.map((b) => (
              <button key={b.id} onClick={() => { onAdd({ type: 'view', id: b.id }); setMode(null); }} style={{ ...field, cursor: 'pointer', width: 'auto' }}>
                {b.label} +
              </button>
            ))}
          </div>
        )
      ) : null}
      {mode === 'fact' ? (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input value={factKey} onChange={(e) => setFactKey(e.target.value)} placeholder="fact key (e.g. doc:welcome)" style={{ ...field, flex: 1 }} />
          <div style={{ width: 90 }}><Button onClick={() => { if (factKey.trim()) { onAdd({ type: 'fact', key: factKey.trim() }); setFactKey(''); setMode(null); } }}>Pin</Button></div>
        </div>
      ) : null}
      {mode === 'query' ? (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <input value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} placeholder="title" style={field} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
            <input value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })} placeholder="type" style={field} />
            <input value={q.tag} onChange={(e) => setQ({ ...q, tag: e.target.value })} placeholder="tag" style={field} />
            <input value={q.prefix} onChange={(e) => setQ({ ...q, prefix: e.target.value })} placeholder="key prefix" style={field} />
          </div>
          <div style={{ width: 110 }}>
            <Button
              onClick={() => {
                const query: Record<string, unknown> = {};
                if (q.type.trim()) query.type = q.type.trim();
                if (q.tag.trim()) query.tag = q.tag.trim();
                if (q.prefix.trim()) query.prefix = q.prefix.trim();
                if (Object.keys(query).length) { onAdd({ type: 'query', query, title: q.title.trim() || undefined }); setQ({ type: '', tag: '', prefix: '', title: '' }); setMode(null); }
              }}
            >
              Add query
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function App(): React.JSX.Element {
  const session = useAuth();
  const authed = !!session.user;
  const [dash, setDash] = useState<DashboardData | null>(null);
  const { sections, save } = useLayout(authed);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    loadDashboard()
      .then((d) => {
        if (live) setDash(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [authed]);

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const toggle = (i: number): void => save(sections.map((s, k) => (k === i ? { ...s, hidden: !s.hidden } : s)));
  const remove = (i: number): void => save(sections.filter((_s, k) => k !== i));
  const add = (s: LayoutSection): void => save([...sections, s]);

  const ctx: SectionCtx = { session, authed, dash };
  const isCustom = (t: string): boolean => t === 'view' || t === 'fact' || t === 'query';

  return (
    <Page>
      {!session.ready ? null : !authed ? (
        <Landing session={session} />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', alignItems: 'center' }}>
            <button
              onClick={() => setCustomizing((c) => !c)}
              style={{ background: customizing ? theme.accent : 'none', color: customizing ? theme.cream : theme.dim, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: '0.78rem', padding: '0.25rem 0.7rem', cursor: 'pointer' }}
            >
              {customizing ? 'Done' : 'Customise'}
            </button>
          </div>
          {sections.map((s, i) => {
            if (s.hidden && !customizing) return null;
            const body = <SectionView s={s} ctx={ctx} />;
            const k = `${s.type}:${s.id ?? s.key ?? i}`;
            if (!customizing) return <React.Fragment key={k}>{body}</React.Fragment>;
            return (
              <div key={k} style={{ opacity: s.hidden ? 0.5 : 1, display: 'grid', gap: '0.3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span style={{ color: theme.dim, fontSize: '0.74rem', fontFamily: theme.mono }}>{sectionLabel(s)}</span>
                  <SectionControls
                    index={i}
                    total={sections.length}
                    hidden={!!s.hidden}
                    onMove={(d) => move(i, d)}
                    onToggle={() => toggle(i)}
                    onRemove={isCustom(s.type) ? () => remove(i) : undefined}
                  />
                </div>
                {body}
              </div>
            );
          })}
          {customizing ? (
            <>
              <AddSection onAdd={add} />
              <p style={{ margin: 0, color: theme.dim, fontSize: '0.75rem', textAlign: 'center' }}>
                Your home, as data — order, visibility, and pinned sections save to{' '}
                <code style={{ fontFamily: theme.mono }}>_home/layout</code> in your slice.
              </p>
            </>
          ) : null}
        </>
      )}
      <p style={{ margin: 0, textAlign: 'center', color: theme.dim, fontSize: '0.75rem' }}>
        <Wordmark /> · a personal substrate · <Anchor href="https://parc.land/mcp">agents start here</Anchor>
      </p>
    </Page>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
