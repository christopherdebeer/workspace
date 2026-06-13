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
import { Page, Card, Heading, Badge, Button, Anchor, CodeBlock, theme } from '../../../platform/ui';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, getTokens } from './auth';
// Painted assets (data URIs via the dataurl loader): the dusk-valley hero,
// the dawn panorama strip, and the field computer.
import heroUrl from './assets/hero.jpg';
import stripUrl from './assets/strip.jpg';
import computerUrl from './assets/computer.webp';

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

/** Type vocabulary loaded from the substrate (`_types/<type>` facts): the
 *  presentation/routing table is data now, not hardcoded. Conventions below
 *  remain as the fallback for types without a declaration. */
interface TypeDecl { icon?: string; titlePath?: string; href?: string }
let typeDecls: Record<string, TypeDecl> = {};
export async function loadTypeDecls(): Promise<void> {
  try {
    const r = await mcpCall('read', 'workspace.query', { prefix: '_types/', limit: 100 });
    if (r.ok) {
      const entries = (r.value as { entries?: Array<{ key: string; value: TypeDecl }> }).entries ?? [];
      typeDecls = Object.fromEntries(entries.map((e) => [e.key.slice('_types/'.length), e.value ?? {}]));
    }
  } catch {
    /* conventions still apply */
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
  return typeDecls[e._meta?.type ?? '']?.icon ?? '';
}

/** A fact's one-line presentation: title from its value, not its key. */
function factTitle(e: ListEntry): string {
  const decl = typeDecls[e._meta?.type ?? ''];
  if (decl?.titlePath) {
    const v = pathInto(e.value, decl.titlePath);
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

/** Where a fact lives — its home surface, from `_types` href template or convention. */
function factHref(e: ListEntry): string | null {
  const t = e._meta?.type ?? null;
  const v = (e.value ?? {}) as Record<string, unknown>;
  const tags = e._meta?.tags ?? [];
  const decl = typeDecls[t ?? ''];
  if (decl?.href) {
    const id = e.key.includes(':') ? e.key.slice(e.key.indexOf(':') + 1) : e.key.includes('/') ? e.key.slice(e.key.indexOf('/') + 1) : e.key;
    return decl.href
      .replace(/\$\{key\}/g, encodeURIComponent(e.key))
      .replace(/\$\{id\}/g, encodeURIComponent(id))
      .replace(/\$\{value\.([A-Za-z0-9_.]+)\}/g, (_m, p: string) => String(pathInto(e.value, p) ?? ''));
  }
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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    (async () => {
      try {
        await loadTypeDecls();
        const [a, q] = await Promise.all([
          mcpCall('read', 'workspace.attention', { limit: 5 }),
          mcpCall('read', 'workspace.query', { limit: 10 }),
        ]);
        if (!live) return;
        if (a.ok) setAtt(a.value as AttentionData);
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
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
          {facts.map((e) => {
            const to = factHref(e);
            const icon = typeIcon(e);
            const title = `${icon ? icon + ' ' : ''}${factTitle(e)}`;
            const date = e._meta?.updatedAt ? e._meta.updatedAt.slice(0, 10) : null;
            const sub = [e._meta?.type, e.key, date].filter(Boolean).join(' · ');
            return (
              <li key={e.key} style={{ lineHeight: 1.35 }}>
                {to ? (
                  <a href={to} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600 }}>{title}</a>
                ) : (
                  <span>{title}</span>
                )}
                <div style={{ color: theme.dim, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sub}
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
          <strong style={{ fontFamily: theme.serif }}>🌲 {label}</strong>
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

/** One owned cell: address, status, and on-demand recent logs. */
function CellConsoleRow({ cell }: { cell: CellRow }): React.JSX.Element {
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
    <div style={{ display: 'grid', gap: '0.3rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <a href={cell.address} style={{ color: theme.accent, textDecoration: 'none', fontFamily: theme.mono, fontSize: '0.85rem', fontWeight: 600 }}>
          {cell.address}
        </a>
        <Badge tone={cell.status === 'ACTIVE' ? 'accent' : 'dim'}>{cell.status}</Badge>
        {cell.public ? <Badge tone="dim">public</Badge> : null}
        <InlineButton onClick={() => void tailLogs()}>{busy ? '…' : logs ? 'Hide logs' : 'Logs (1h)'}</InlineButton>
        {cell.description ? <span style={{ color: theme.dim, fontSize: '0.8rem' }}>{cell.description}</span> : null}
      </div>
      {logs ? (
        logs.length === 0 ? (
          <span style={{ color: theme.dim, fontSize: '0.8rem', marginLeft: '0.2rem' }}>No log events in the last hour.</span>
        ) : (
          <CodeBlock>{logs.map((l) => `${l.time.slice(11, 19)}  ${l.message.trim()}`).join('\n')}</CodeBlock>
        )
      ) : null}
    </div>
  );
}

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
    <Card>
      <Heading sub="Your outposts — deployed cells with their own addresses and logs. Author and ship through cells.* on the field computer.">
        Cells
      </Heading>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {cells === null ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.4rem' }}>
          {cells.map((c) => (
            <CellConsoleRow key={c.cellId} cell={c} />
          ))}
        </div>
      )}
    </Card>
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
          style={{ background: 'none', border: 'none', color: machine.text, cursor: 'pointer', fontFamily: theme.mono, padding: 0, fontSize: '0.85rem' }}
        >
          {open ? '▾' : '▸'} <code>{verb}</code>
        </button>
        <span style={{ color: cap.kind === 'read' ? machine.dim : machine.green, fontFamily: theme.mono, fontSize: '0.7rem', border: `1px solid ${machine.border}`, borderRadius: 999, padding: '0 0.45rem' }}>
          {cap.kind}
        </span>
        {cap.scope ? (
          <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.7rem', border: `1px solid ${machine.border}`, borderRadius: 999, padding: '0 0.45rem' }}>
            {cap.scope}
          </span>
        ) : null}
        <span style={{ color: machine.dim, fontSize: '0.8rem' }}>{cap.description}</span>
      </div>
      {open ? (
        <div style={{ display: 'grid', gap: '0.4rem', marginLeft: '1.1rem' }}>
          <textarea
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            rows={Math.min(10, Math.max(2, args.split('\n').length))}
            spellCheck={false}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem', background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, color: machine.text, fontFamily: theme.mono, fontSize: '0.8rem' }}
          />
          <div>
            <button
              onClick={() => void run()}
              disabled={busy}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: 6,
                border: `1px solid ${machine.green}`,
                background: 'transparent',
                color: machine.green,
                fontFamily: theme.mono,
                fontSize: '0.8rem',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Running…' : `${cap.kind}("${cap.target}")`}
            </button>
          </div>
          {out ? (
            <div>
              <span style={{ color: out.ok ? machine.green : '#e08c7a', fontFamily: theme.mono, fontSize: '0.75rem' }}>
                {out.ok ? 'ok' : 'error'}
              </span>
              <pre
                style={{
                  background: machine.screen,
                  border: `1px solid ${machine.border}`,
                  borderRadius: 6,
                  padding: '0.6rem',
                  margin: '0.3rem 0 0',
                  overflowX: 'auto',
                  fontFamily: theme.mono,
                  fontSize: '0.78rem',
                  color: machine.text,
                }}
              >
                <code>{typeof out.value === 'string' ? out.value : JSON.stringify(out.value, null, 2)}</code>
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The live read/act console — `read("$catalog")` lists every capability the
 * caller can use, grouped by cell; each row invokes read/act and shows the
 * result. The human drives the same vocabulary the agent does.
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
    <div>
      {err ? <span style={{ color: '#e08c7a', fontFamily: theme.mono, fontSize: '0.8rem' }}>{err}</span> : null}
      {authed && !caps && !err ? <p style={{ color: machine.dim, margin: 0 }}>Loading…</p> : null}
      {authed && caps && caps.length === 0 ? (
        <p style={{ color: machine.dim, margin: 0 }}>No capabilities — your token may lack scopes.</p>
      ) : null}
      <div style={{ display: 'grid', gap: '0.9rem' }}>
        {Object.keys(groups)
          .sort()
          .map((ns) => (
            <div key={ns} style={{ display: 'grid', gap: '0.4rem' }}>
              <strong style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.85rem' }}>{ns}</strong>
              {groups[ns].map((c) => (
                <CapabilityRow key={c.target} cap={c} />
              ))}
            </div>
          ))}
      </div>
    </div>
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
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <strong style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.85rem' }}>oauth discovery</strong>
      {err ? <span style={{ color: '#e08c7a', fontFamily: theme.mono, fontSize: '0.8rem' }}>{err}</span> : null}
      {meta ? (
        <pre style={{ background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.6rem', margin: 0, overflowX: 'auto', fontFamily: theme.mono, fontSize: '0.75rem', color: machine.text }}>
          <code>
            {JSON.stringify(
              { issuer: meta.issuer, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, registration_endpoint: meta.registration_endpoint },
              null,
              2,
            )}
          </code>
        </pre>
      ) : !err ? (
        <span style={{ color: machine.dim, fontSize: '0.8rem' }}>Loading…</span>
      ) : null}
    </div>
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
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <strong style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.85rem' }}>probe · GET /mcp/whoami</strong>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token (optional — empty shows the 401 challenge)"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.5rem',
          background: machine.screen,
          border: `1px solid ${machine.border}`,
          borderRadius: 6,
          color: machine.text,
          fontFamily: theme.mono,
          fontSize: '0.8rem',
        }}
      />
      <div>
        <button
          onClick={() => void probe()}
          disabled={busy}
          style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: `1px solid ${machine.green}`, background: 'transparent', color: machine.green, fontFamily: theme.mono, fontSize: '0.8rem', cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Calling…' : 'Call'}
        </button>
      </div>
      {result ? (
        <pre style={{ background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.6rem', margin: 0, overflowX: 'auto', fontFamily: theme.mono, fontSize: '0.75rem', color: result.status === 200 ? machine.text : '#e08c7a' }}>
          <code>HTTP {result.status}{'\n'}{JSON.stringify(result.body, null, 2)}</code>
        </pre>
      ) : null}
    </div>
  );
}

/** The housing: a collapsed machine that opens into the full console. */
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
        <div style={{ padding: '0 1.1rem 1.1rem', display: 'grid', gap: '1.2rem', borderTop: `1px solid ${machine.border}`, paddingTop: '1rem' }}>
          <Capabilities authed={authed} />
          <Discovery />
          <ResourceProbe />
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

function App(): React.JSX.Element {
  const session = useAuth();
  const authed = !!session.user;
  const [dash, setDash] = useState<DashboardData | null>(null);

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

  return (
    <Page>
      {!session.ready ? null : !authed ? (
        <Landing session={session} />
      ) : (
        <>
          <DashboardHeader session={session} />
          <StatCards data={dash} />
          <QuickCapture />
          <WorkspaceWindow authed={authed} />
          <RecentActivity data={dash} />
          <IdentityShell authed={authed} user={session.user} scopes={session.scopes} />
          <Views authed={authed} />
          <CellsConsole authed={authed} />
          <FieldComputer authed={authed} />
        </>
      )}
      <p style={{ margin: 0, textAlign: 'center', color: theme.dim, fontSize: '0.75rem' }}>
        <Wordmark /> · a personal substrate · <Anchor href="/mcp">agents start here</Anchor>
      </p>
    </Page>
  );
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
