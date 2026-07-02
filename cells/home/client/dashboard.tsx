/**
 * ADR-0044 Inc 5: the two faces' chrome, split from app.tsx (moved verbatim) —
 * the painted scenery, the signed-out trailhead (Landing), and the dashboard
 * shell (greeting header, stat cards + activity sparkline, recent writes,
 * quick capture).
 */
import * as React from 'react';
import { Card, Heading, Badge, Button, theme } from '@parc/ui';
import { localize, heroUrl, stripUrl, mcpCall, type Session } from './lib';
import { primeViews, type ViewDef } from './views';

const { useState, useEffect } = React;

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

export function Wordmark({ light }: { light?: boolean }): React.JSX.Element {
  return (
    <span style={{ fontFamily: theme.mono, fontWeight: 700, letterSpacing: '0.02em', color: light ? theme.cream : theme.text }}>
      parc.land
    </span>
  );
}

// ─── face 1: the trailhead (landing) ───────────────────────────────

export function Landing({ session }: { session: Session & { signIn: () => void } }): React.JSX.Element {
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: '0.8rem' }}>
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

function greetingFor(hour: number | null): string {
  if (hour === null) return 'Welcome'; // time-of-day is client-local — neutral until mounted (SSR-safe)
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardHeader({ session }: { session: Session & { signOut: () => void } }): React.JSX.Element {
  // The greeting depends on the viewer's local hour, which the server can't know.
  // Render a neutral greeting on the server AND the first client render (so
  // hydration matches), then refine to the time-of-day greeting after mount.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
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
            {greetingFor(hour)}, {session.user}.
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

export interface ChangeEvent {
  op: string;
  key: string | null;
  at: string;
  seq: number;
}

export interface DashboardData {
  facts: number;
  cells: number;
  views: number;
  edges: number;
  /** Write events bucketed across their ACTUAL time span (oldest → newest) —
   *  honest write-activity, not facts-over-time. Empty when there's too little. */
  activity: number[];
  /** Milliseconds the activity series covers (first → last write), for the label. */
  activitySpanMs: number;
  /** Latest write-ish events, newest first. */
  recent: ChangeEvent[];
}

const ACTIVITY_BUCKETS = 16;

export async function loadDashboard(): Promise<DashboardData> {
  // ADR-0048 shaped reads: the edge stat wants a COUNT ({limit:0} → `total`),
  // and the activity chart wants the NEWEST window (`last` folds the old
  // head-then-window two-step into one call).
  const [q, c, v, l, ch] = await Promise.all([
    mcpCall('read', 'workspace.query', { limit: 1, shape: 'refs' }),
    mcpCall('read', 'cells.list'),
    mcpCall('read', 'workspace.views'),
    mcpCall('read', 'workspace.links', { limit: 0 }),
    mcpCall('read', 'workspace.changes', { last: 1000 }),
  ]);
  // The dashboard already fetched the view list (for the stat count) — feed the
  // shared cache so the "All views" card + Add-section picker don't refetch.
  if (v.ok) primeViews((v.value as { views?: ViewDef[] }).views ?? []);
  const events = ch.ok ? (((ch.value as { events?: ChangeEvent[] }).events ?? []) as ChangeEvent[]) : [];
  const writes = events.filter((e) => e.op !== 'read');
  // Adaptive bucketing: the substrate is young and bursty, so a fixed 14-day
  // chart is mostly empty and reads as "unchanging". Instead split the writes'
  // real time span (first → last) into N buckets, so the line always shows a
  // meaningful shape over whatever period the fetched window actually covers.
  const times = writes
    .map((e) => Date.parse(e.at))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  let activity: number[] = [];
  let activitySpanMs = 0;
  if (times.length >= 2) {
    const lo = times[0];
    const hi = times[times.length - 1];
    activitySpanMs = hi - lo;
    const span = Math.max(1, hi - lo);
    const buckets = new Array(ACTIVITY_BUCKETS).fill(0);
    for (const t of times) buckets[Math.min(ACTIVITY_BUCKETS - 1, Math.floor(((t - lo) / span) * ACTIVITY_BUCKETS))]++;
    activity = buckets;
  }
  return {
    facts: q.ok ? ((q.value as { total?: number }).total ?? 0) : 0,
    cells: c.ok ? (((c.value as { cells?: unknown[] }).cells ?? []).length) : 0,
    views: v.ok ? (((v.value as { views?: unknown[] }).views ?? []).length) : 0,
    edges: l.ok ? ((l.value as { total?: number; edges?: unknown[] }).total ?? ((l.value as { edges?: unknown[] }).edges ?? []).length) : 0,
    activity,
    activitySpanMs,
    recent: writes.slice(-8).reverse(),
  };
}

/** Human-readable duration for the activity caption ("past 3h", "past 2d"). */
function humanSpan(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `past ${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `past ${h}h`;
  return `past ${Math.round(h / 24)}d`;
}

export function StatCards({ data }: { data: DashboardData | null }): React.JSX.Element {
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
  const showSpark = !!data && data.activity.length >= 2;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: '0.7rem' }}>
        {cell('Facts', data ? data.facts : null)}
        {cell('Links', data ? data.edges : null)}
        {cell('Views', data ? data.views : null)}
        {cell('Cells', data ? data.cells : null)}
      </div>
      {showSpark ? (
        // Honest label: this is write activity over the window we actually
        // fetched, not facts-over-time — every op (writes, links, deploys) counts.
        <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 10, boxShadow: theme.shadow, padding: '0.6rem 0.85rem', display: 'grid', gap: '0.3rem' }}>
          <span style={{ color: theme.dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Write activity · {humanSpan(data!.activitySpanMs)}
          </span>
          <Sparkline points={data!.activity} />
        </div>
      ) : null}
    </div>
  );
}

const OP_LABEL: Record<string, string> = {
  write: 'remembered',
  supersede: 'retired',
  link: 'linked',
  unlink: 'unlinked',
};

export function RecentActivity({ data }: { data: DashboardData | null }): React.JSX.Element {
  return (
    <Card>
      <Heading sub="The change feed — the land's own record of what happened (reads excluded).">Recent activity</Heading>
      {!data ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : data.recent.length === 0 ? (
        <p style={{ color: theme.dim, margin: 0, fontSize: '0.85rem' }}>Nothing yet.</p>
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
export function QuickCapture(): React.JSX.Element {
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
