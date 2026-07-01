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
import { Page, Card, Heading, Badge, Button, Anchor, CodeBlock, Modal, theme, resolve, declFor, type TypeDecl, mountSandboxedRenderer, SANDBOX_HOST_HTML, SchemaForm, isFormable, type FormFieldSchema, type FormPalette } from '@parc/ui';
import { marked } from 'marked';
import { DEFAULT_TYPE_DECLS } from './type-decls';
import { login, logout, completeLoginIfReturning, authFetch, isAuthed, cellUrl } from './bridge';

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

export interface Session {
  ready: boolean;
  user: string | null;
  scopes: string[];
  error: string | null;
}

/**
 * The server's first-paint seed: the resolved session plus the substrate-backed
 * data the cell read directly (LeadingKeys-scoped STATE#/TRAJ# — see index.ts).
 * Seeding these makes the dashboard render with REAL content server-side and the
 * client trust it (no refetch), so stats/activity and the saved layout don't
 * flash/reflow in after hydration. Sections that need salience or cross-cell
 * commands (workspace window, identity, cells) still hydrate client-side.
 */
/** The workspace window's seed (salience-ranked facts + attention + edges). */
export interface WorkspaceSeed {
  attention: AttentionData | null;
  facts: ListEntry[];
  total: number;
  edges: Edge[];
}

export interface Boot {
  session: Session;
  layout?: LayoutSection[];
  dash?: DashboardData;
  /** The canonical type vocabulary ($types/describeTypes), seeded so the viewer
   *  (render hints) and routing paint server-side identically to the client. */
  types?: Record<string, TypeDecl>;
  workspace?: WorkspaceSeed;
  cells?: CellRow[];
  views?: ViewDef[];
  identity?: IdentityData;
}

/**
 * First-party sign-in state. Seeds from the server's auth-aware SSR view model
 * (`initial`) so the first client render matches the server markup (clean
 * hydration, no flash), then on mount completes an OAuth redirect if returning
 * and re-resolves identity from the same `whoami` an agent sees — the human and
 * the agent reading one identity. Returns helpers so the header can offer sign
 * in / sign out.
 */
function useAuth(initial?: Session): Session & { signIn: () => void; signOut: () => void } {
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

/** Resolve a `ui://` resource (a cell-authored renderer script) over the SAME
 *  authenticated `/mcp` endpoint `mcpCall` uses — the JSON-RPC `resources/read`
 *  method, the gateway's federation provider hop (ADR-0039). Returns its text
 *  content, or null. NEVER execute this text in home's own document — it is
 *  potentially third-party cell code; see `FederatedRendererFrame`, which runs
 *  it inside an isolated sandbox iframe instead (ADR-0041). */
async function mcpResourceRead(uri: string): Promise<string | null> {
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

/**
 * Run a cell-authored `ui://` renderer for a fact or tool result, isolated in a
 * sandboxed iframe (ADR-0041) — never injected into home's own document, since
 * the renderer may be authored by another tenant's cell. `placeholder` shows
 * until the sandbox confirms a successful render; on any failure (offline, CSP,
 * cell down, no renderer registered) it stays up — the same graceful-degrade
 * contract the conversation card uses (ADR-0039).
 */
function FederatedRendererFrame({
  uri,
  type,
  value,
  factKey,
  placeholder,
}: {
  uri: string;
  type: string;
  value: unknown;
  factKey?: string;
  placeholder?: React.ReactNode;
}): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(0);
  const [settled, setSettled] = useState<boolean | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let handle: ReturnType<typeof mountSandboxedRenderer> | null = null;
    const onLoad = (): void => {
      if (disposed) return;
      handle = mountSandboxedRenderer(iframe, {
        call: (kind, target, input) => mcpCall(kind, target, input).then((r) => (r.ok ? r.value : Promise.reject(new Error(String(r.value))))),
        onResize: setHeight,
        onSettled: setSettled,
      });
      void mcpResourceRead(uri).then((src) => {
        if (!disposed) handle?.render(src, type, value, factKey);
      });
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      handle?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, type, factKey]);

  return (
    <div style={{ position: 'relative' }}>
      {settled !== true ? placeholder ?? null : null}
      <iframe
        ref={iframeRef}
        srcDoc={SANDBOX_HOST_HTML}
        sandbox="allow-scripts"
        title="federated renderer"
        style={{ display: settled === true ? 'block' : 'none', width: '100%', border: 'none', height: Math.max(24, height) }}
      />
    </div>
  );
}

/**
 * Run a cell-authored argument FORM (ADR-0041 Inc 3) — the input twin of
 * `FederatedRendererFrame`, same sandbox. Mounted ONCE with the schema +
 * starting value (not on every keystroke — re-mounting on every parent
 * re-render would rebuild the sandboxed form's DOM and drop focus/cursor
 * mid-edit); from then on the sandbox owns its own field state and reports
 * edits up via `onChange`. `placeholder` (the schema-form floor, ADR-0041
 * Inc 2) shows until the federated form confirms it mounted, and stays up
 * forever if it never does — the same graceful degrade as output renderers.
 */
function FederatedFormFrame({
  uri,
  type,
  schema,
  initialValue,
  onChange,
  placeholder,
}: {
  uri: string;
  type: string;
  schema: unknown;
  initialValue: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  placeholder?: React.ReactNode;
}): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(0);
  const [settled, setSettled] = useState<boolean | null>(null);
  const initialValueRef = React.useRef(initialValue);
  const schemaRef = React.useRef(schema);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    let handle: ReturnType<typeof mountSandboxedRenderer> | null = null;
    const onLoad = (): void => {
      if (disposed) return;
      handle = mountSandboxedRenderer(iframe, {
        call: (kind, target, input) => mcpCall(kind, target, input).then((r) => (r.ok ? r.value : Promise.reject(new Error(String(r.value))))),
        onResize: setHeight,
        onSettled: setSettled,
        onFormChange: (v) => onChangeRef.current(v),
      });
      void mcpResourceRead(uri).then((src) => {
        if (!disposed) handle?.mountForm(src, type, schemaRef.current, initialValueRef.current);
      });
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      handle?.dispose();
    };
    // Deliberately NOT depending on schema/initialValue/onChange — see the doc
    // comment above. A genuinely new form (a different command) gets a fresh
    // `uri`/`type` and so a fresh mount; the SAME form's value changes flow
    // through the live `onChangeRef`, never a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, type]);

  return (
    <div style={{ position: 'relative' }}>
      {settled !== true ? placeholder ?? null : null}
      <iframe
        ref={iframeRef}
        srcDoc={SANDBOX_HOST_HTML}
        sandbox="allow-scripts"
        title="federated form"
        style={{ display: settled === true ? 'block' : 'none', width: '100%', border: 'none', height: Math.max(24, height) }}
      />
    </div>
  );
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

function DashboardHeader({ session }: { session: Session & { signOut: () => void } }): React.JSX.Element {
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

async function loadDashboard(): Promise<DashboardData> {
  const head = await mcpCall('read', 'workspace.changes', { sinceSeq: 'head' });
  const seq = head.ok ? ((head.value as { seq?: number }).seq ?? 0) : 0;
  const [q, c, v, l, ch] = await Promise.all([
    mcpCall('read', 'workspace.query', { limit: 1 }),
    mcpCall('read', 'cells.list'),
    mcpCall('read', 'workspace.views'),
    mcpCall('read', 'workspace.links'),
    mcpCall('read', 'workspace.changes', { sinceSeq: Math.max(0, seq - 1000), limit: 1000 }),
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
    edges: l.ok ? (((l.value as { edges?: unknown[] }).edges ?? []).length) : 0,
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

function RecentActivity({ data }: { data: DashboardData | null }): React.JSX.Element {
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

/** Long mono identifiers (OAuth client ids, fact keys, resources) must wrap, not
 *  stretch the page. `minWidth:0` lets them shrink inside a flex row. */
const monoKey: React.CSSProperties = {
  fontSize: '0.78rem',
  fontFamily: theme.mono,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  minWidth: 0,
};

/** Scopes as individual wrapping chips: a token's `scope` is a space-joined
 *  string ("workspace:read workspace:write platform/cells:create") that, as one
 *  nowrap badge, runs wider than a phone. Split it so each scope is its own chip. */
function ScopeBadges({ scope }: { scope?: string | null }): React.JSX.Element | null {
  const parts = (scope ?? '').split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', minWidth: 0 }}>
      {parts.map((p) => (
        <Badge key={p} tone="dim">{p}</Badge>
      ))}
    </div>
  );
}

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
function IdentityShell({ authed, user, scopes, seed }: { authed: boolean; user: string | null; scopes: string[]; seed?: IdentityData }): React.JSX.Element | null {
  const [data, setData] = useState<IdentityData | null>(seed ?? null);
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
    if (!authed || seed) return; // SSR-seeded → trust it (action handlers still reload)
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
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: scopes.length ? '0.45rem' : '0.6rem' }}>
        <Badge>{user}</Badge>
      </div>
      {scopes.length ? (
        // One scope per line: legible, and a long scope (e.g. a resource-qualified
        // grant) wraps within the line instead of forcing the page wider than the
        // viewport (the old inline nowrap pills broke mobile layout).
        <ul style={{ listStyle: 'none', margin: '0 0 0.6rem', padding: 0, display: 'grid', gap: '0.2rem' }}>
          {scopes.map((s) => (
            <li key={s} style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline', minWidth: 0 }}>
              <span style={{ color: theme.accent, fontSize: '0.7rem', flexShrink: 0 }}>▸</span>
              <code style={{ fontFamily: theme.mono, fontSize: '0.76rem', color: theme.dim, wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>
                {s}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
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
                  <code style={monoKey}>{r.resource}</code>
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
              data.tokens.map((t, i) => (
                <div
                  key={t.id}
                  style={{
                    display: 'grid',
                    gap: '0.35rem',
                    ...(i < data.tokens.length - 1 ? { paddingBottom: '0.5rem', borderBottom: `1px solid ${theme.border}` } : {}),
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <code style={{ ...monoKey, flex: '1 1 12rem' }}>{t.label ?? t.clientId ?? t.id.slice(0, 8)}</code>
                    <InlineButton danger onClick={() => void act(t.id, 'act', 'auth.revokeToken', { tokenId: t.id })}>
                      {busy === t.id ? '…' : 'Revoke'}
                    </InlineButton>
                  </div>
                  <ScopeBadges scope={t.scope} />
                  <span style={{ color: theme.dim, fontSize: '0.75rem' }}>
                    {t.expiresAt ? `expires ${t.expiresAt.slice(0, 10)}` : 'non-expiring'}
                  </span>
                  {/* Steward this credential as a principal (auth.updateToken): rename,
                      re-scope (upgrade/downgrade, clamped to your standing), re-horizon. */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <InlineButton onClick={() => {
                      const label = typeof window !== 'undefined' ? window.prompt('Rename this credential', t.label ?? '') : null;
                      if (label != null) void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, label });
                    }}>Rename</InlineButton>
                    <InlineButton onClick={() => {
                      const scope = typeof window !== 'undefined' ? window.prompt('Scope (space-separated; clamped to your own standing)', t.scope ?? '') : null;
                      if (scope != null && scope.trim()) void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, scope: scope.trim() });
                    }}>Edit scope</InlineButton>
                    <InlineButton onClick={() => void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, expiresInSec: 30 * 24 * 3600 })}>Extend 30d</InlineButton>
                    <InlineButton onClick={() => void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, expiresInSec: 0 })}>Never expires</InlineButton>
                  </div>
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
                  <code style={monoKey}>{g.key}</code>
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
                  <code style={monoKey}>{g.key}</code>
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
                  <code style={monoKey}>{a.resource}</code>
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

interface LegacyTypeDecl { icon?: string; titlePath?: string; href?: string; manager?: string; label?: string; handlers?: TypeDecl['handlers']; present?: { icon?: string; label?: string; render?: unknown } }
function normalizeDecl(d: LegacyTypeDecl): TypeDecl {
  // Prefer the gateway-resolved `present` facet (ADR-0012/0014 row 3): the legacy
  // {icon,titlePath} → {icon,label} normalisation now happens once, server-side via
  // resolveType, so home consumes it instead of re-deriving. (The per-fact label is still
  // applied client-side by `pathInto` — Present runs where the fact's value is.)
  const icon = d.present?.icon ?? d.icon;
  const label = d.present?.label ?? d.label ?? d.titlePath;
  if (d.handlers || !d.href) return { ...(d as TypeDecl), icon, label }; // new-shape (+ served present)
  return { icon, manager: d.manager, label, handlers: { open: [{ surface: d.href }] } };
}

/** Build the type vocabulary from a raw `$types`/`describeTypes` map: normalise
 *  legacy-shape decls and layer them over the built-in bootstrap fallback. The
 *  one place the vocab is assembled — used by both the SSR seed (index.ts) and
 *  the client `loadTypeDecls`, so server and client resolve identically. */
export function typeDeclsFrom(raw: Record<string, unknown> | undefined): Record<string, TypeDecl> {
  const norm = Object.fromEntries(Object.entries(raw ?? {}).map(([t, d]) => [t, normalizeDecl(d as LegacyTypeDecl)]));
  return { ...DEFAULT_TYPE_DECLS, ...norm };
}

/** Replace the module's type vocabulary (SSR seed install / client refresh). */
export function setTypeDecls(decls: Record<string, TypeDecl>): void {
  typeDecls = decls;
}

export async function loadTypeDecls(): Promise<void> {
  try {
    // $types is the global vocabulary (the cell registry's canonical declarations
    // merged under this user's _types overrides), so home resolves the same way
    // for any signed-in user — not just the cells' owner.
    const r = await mcpCall('read', '$types');
    if (r.ok) typeDecls = typeDeclsFrom((r.value as { types?: Record<string, LegacyTypeDecl> }).types);
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

/**
 * The concrete URL for a resolved handler. A `path` handler names a cell
 * (`cellRef`) and a path within it → the kernel's origin-aware `cellUrl` builds
 * the right URL (subdomain on a cell host, apex path on the apex). A `surface`
 * handler is a value-derived full path (e.g. a cell's stored `${value.address}`)
 * → localized as-is. So no apex URLs are baked into the type vocabulary.
 */
function handlerUrl(r: ReturnType<typeof resolve>): string | null {
  if (!r) return null;
  if (r.cellRef && r.path !== undefined) return cellUrl(r.cellRef.owner, r.cellRef.name, r.path);
  return r.surface ? localize(r.surface) : null;
}

/** Where a fact opens — resolved from the type vocabulary, no hardcoded cells. */
function factHref(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'open', typeDecls));
}

/** Where a fact edits — its type's `edit` handler, if it declares one. */
function factEdit(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'edit', typeDecls));
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

// ─── default viewers (the type's `render`/`embed` handler) ─────────
//
// A managing cell declares HOW its type renders inline (docs/type-vocabulary):
// a built-in `hint` kind that home draws (SSR-safe, no foreign code), or an
// `embed` surface the cell SSRs as a zero-JS thumbnail in an origin-isolated
// iframe. Neither runs the cell's code in home — the isolation the subdomains
// enforce. `marked` is isomorphic (same pin server+client, like starter), so
// markdown bodies hydrate without a flash.

marked.setOptions({ gfm: true, breaks: false });

/** First present string field among `keys` of an object value. */
function strField(v: unknown, keys: string[]): string | undefined {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  return undefined;
}
/** The markdown/text body of a fact value (string, or its content-ish field). */
function bodyText(v: unknown): string {
  if (typeof v === 'string') return v;
  return strField(v, ['content', 'body', 'text', 'description', 'note', 'md', 'markdown']) ?? '';
}

/** Render a fact body by a built-in `hint` kind. SSR-safe: deterministic, no
 *  browser globals. Returns null when there's nothing to draw (caller falls back). */
function HintBody({ kind, e }: { kind: string; e: ListEntry }): React.JSX.Element | null {
  const v = e.value;
  switch (kind) {
    case 'md':
    case 'markdown': {
      const md = bodyText(v);
      if (!md) return null;
      const html = marked.parse(md.replace(/\r\n/g, '\n'), { async: false }) as string;
      return <div className="fact-md" style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'image': {
      const src = strField(v, ['src', 'url', 'href', 'image']);
      return src ? <img src={src} alt={factTitle(e)} loading="lazy" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} /> : null;
    }
    case 'code': {
      const code = bodyText(v);
      return code ? <CodeBlock>{code.slice(0, 2000)}</CodeBlock> : null;
    }
    case 'metric': {
      const n = typeof v === 'number' ? String(v) : (strField(v, ['value', 'count', 'n', 'total']) ?? bodyText(v));
      return n ? <strong style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>{n}</strong> : null;
    }
    case 'fields':
      return <FieldsBody value={v} />;
    default:
      return null;
  }
}

/** A few scalar fields of a structured value, as a compact definition list. */
function FieldsBody({ value }: { value: unknown }): React.JSX.Element | null {
  if (!value || typeof value !== 'object') return null;
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(([k, val]) => val != null && typeof val !== 'object' && !['content', 'title', 'name', 'id', 'src'].includes(k))
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <dl style={{ margin: 0, display: 'grid', gap: '0.15rem', fontSize: '0.8rem' }}>
      {rows.map(([k, val]) => (
        <div key={k} style={{ display: 'flex', gap: '0.45rem', minWidth: 0 }}>
          <dt style={{ color: theme.dim, fontFamily: theme.mono, fontSize: '0.72rem', flexShrink: 0 }}>{k}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere', minWidth: 0 }}>{String(val).slice(0, 120)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A cell-SSR'd embed: the managing cell renders a zero-JS thumbnail on its own
 *  origin; home shows it in a pointer-inert iframe (origin-isolated — the cell's
 *  code never touches home). Lazy-loaded; a transparent overlay link opens it. */
function FactEmbed({ src, href, title }: { src: string; href: string | null; title: string }): React.JSX.Element {
  return (
    <div style={{ position: 'relative', height: 200, borderRadius: 8, overflow: 'hidden', border: `1px solid ${theme.border}`, background: '#fff' }}>
      <iframe src={src} title={title} loading="lazy" scrolling="no" tabIndex={-1} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: 'none' }} />
      {href ? <a href={href} title={`Open ${title}`} aria-label={`Open ${title}`} style={{ position: 'absolute', inset: 0, display: 'block' }} /> : null}
    </div>
  );
}

/** Hints whose bodies can run long — clamped in a card, shown whole in the modal. */
const LONGFORM_HINTS = new Set(['md', 'markdown', 'code', 'fields']);

/** Truncate a rendered body to a few lines with a fade — the card preview. The
 *  modal (full) shows it untruncated, which is what the peek escalates to. */
function ClampedBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ position: 'relative', maxHeight: '4.5em', overflow: 'hidden' }}>
      {children}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '1.6em', background: `linear-gradient(transparent, ${theme.panel})` }} />
    </div>
  );
}

/**
 * A fact's inline body, from the type's declared default viewer: a built-in
 * `render` hint, or (when `embed` is allowed, e.g. a pinned single fact) the
 * cell's `embed` thumbnail — falling back to the heuristic text preview. Pure
 * presentation over `typeDecls`, so it renders identically server + client.
 *
 * `full` is the modal read: long-form bodies render whole. Without it (the list
 * card) a long-form body is clamped to a few lines — the card is a preview now
 * that the peek modal carries the full content.
 */
function FactBody({ e, embed = false, full = false }: { e: ListEntry; embed?: boolean; full?: boolean }): React.JSX.Element | null {
  const resolved = resolve(e, 'render', typeDecls);
  // A cell-authored `ui://` renderer (ADR-0039) federates this type's render —
  // run it sandboxed (ADR-0041), the FieldsBody hint as the degrade-to placeholder
  // (mirroring the conversation card's hint-then-swap pattern). Not clamped: a
  // renderer's content (a graph, a diagram) isn't a clampable text body.
  if (resolved?.renderer && resolved.renderer.startsWith('ui://')) {
    return (
      <FederatedRendererFrame
        uri={resolved.renderer}
        type={e._meta?.type ?? ''}
        value={e.value}
        factKey={e.key}
        placeholder={<FieldsBody value={e.value} />}
      />
    );
  }
  const hint = resolved?.hint;
  if (hint) {
    const el = HintBody({ kind: hint, e });
    if (el) return !full && LONGFORM_HINTS.has(hint) ? <ClampedBody>{el}</ClampedBody> : el;
  }
  if (embed) {
    const src = handlerUrl(resolve(e, 'embed', typeDecls));
    if (src) return <FactEmbed src={src} href={factHref(e)} title={factTitle(e)} />;
  }
  // The modal read of a fact with no declared viewer: show the whole body
  // (markdown), or the raw value, rather than the clamped heuristic preview.
  if (full) {
    const body = bodyText(e.value);
    if (body) {
      const html = marked.parse(body.replace(/\r\n/g, '\n'), { async: false }) as string;
      return <div className="fact-md" style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (typeof e.value === 'string') return <span style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.value}</span>;
    if (e.value != null && typeof e.value === 'object') return <CodeBlock>{JSON.stringify(e.value, null, 2)}</CodeBlock>;
  }
  const preview = factPreview(e);
  return preview ? (
    <span style={{ color: theme.text, fontSize: '0.8rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview}</span>
  ) : null;
}

interface Edge {
  from: string;
  rel: string;
  to: string;
  derived?: boolean;
}

// ─── progressive fact detail (peek modal → edit / escalate) ─────────
//
// Every fact opens a peek modal first (so the long tail — orphaned/undeclared
// types with no `open` surface — finally has a detail view). A type's declared
// `open`/`edit` handlers become escalation links inside it; the generic editor
// is the fallback so any fact is editable, gated by the write succeeding.

const FACT_DETAIL_EVENT = 'home:fact-detail';

/** Open the progressive detail modal for a fact (or a bare {key}; hydrated by peek). */
function openFact(e: ListEntry): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ListEntry>(FACT_DETAIL_EVENT, { detail: e }));
}

const shortKey = (k: string): string => (k.length > 22 ? k.slice(0, 21) + '…' : k);

/** A fact's one-hop neighbourhood — authored edges plus the derived backbone
 *  (instanceOf → its type, managedBy → its cell, inView → views). Derived edges
 *  render dashed/dim; every chip is itself a peek into that neighbour. */
function Neighbourhood({ keyName }: { keyName: string }): React.JSX.Element {
  const [n, setN] = useState<{ outbound: Edge[]; inbound: Edge[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    mcpCall('read', 'workspace.neighbors', { key: keyName })
      .then((r) => {
        if (!live) return;
        if (r.ok) setN(r.value as { outbound: Edge[]; inbound: Edge[] });
        else setErr(true);
      })
      .catch(() => live && setErr(true));
    return () => {
      live = false;
    };
  }, [keyName]);
  if (err) return <span style={{ color: theme.dim, fontSize: '0.72rem' }}>No neighbourhood.</span>;
  if (!n) return <span style={{ color: theme.dim, fontSize: '0.72rem' }}>Loading neighbourhood…</span>;
  const chip = (ed: Edge, other: string, label: string): React.JSX.Element => (
    <button
      key={`${ed.from}-${ed.rel}-${ed.to}`}
      onClick={() => openFact({ key: other })}
      title={`${ed.from} ${ed.rel} ${ed.to}`}
      style={{
        fontSize: '0.66rem',
        color: ed.derived ? theme.dim : theme.accent,
        border: `1px ${ed.derived ? 'dashed' : 'solid'} ${theme.border}`,
        borderRadius: 999,
        padding: '0.05rem 0.45rem',
        fontFamily: theme.mono,
        cursor: 'pointer',
        background: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
  const chips = [
    ...n.outbound.map((ed) => chip(ed, ed.to, `${ed.rel}→${shortKey(ed.to)}`)),
    ...n.inbound.map((ed) => chip(ed, ed.from, `${shortKey(ed.from)}→${ed.rel}`)),
  ];
  return chips.length ? (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{chips}</div>
  ) : (
    <span style={{ color: theme.dim, fontSize: '0.72rem' }}>No edges yet.</span>
  );
}

/** Generic editor: a string value edits as text; any other value edits as its
 *  JSON. Saved with `workspace.remember` (preserving the fact's type). A type's
 *  own `edit` surface, when declared, takes precedence over this (see FactDetail). */
/** A type's schema field (from `$types[type].fields`, ADR-0002 `shape.fields`). */
interface FormField {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
}

const editInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  background: theme.panel,
  color: theme.text,
};

/** A `$types[type].fields` entry's `type` (a loose vocabulary: string/number/
 *  boolean/markdown/ref/array/object) isn't JSON-Schema — adapt it to the
 *  `FormFieldSchema` shape `SchemaForm` (ADR-0041 Inc 2) already walks, so the
 *  field computer's form floor and a fact's own editor are ONE renderer, not
 *  two (Inc 4). `ref`/`array`/`object` map to no JSON-Schema scalar type, so
 *  `SchemaForm` degrades them to its per-field raw-JSON box — the same
 *  fallback `isJsonField` hand-rolled here before.
 */
function fieldsToFormSchema(fields: FormField[]): FormFieldSchema {
  const properties: Record<string, FormFieldSchema> = {};
  const required: string[] = [];
  for (const f of fields) {
    const type = f.type === 'markdown' ? 'string' : f.type === 'string' || f.type === 'boolean' || f.type === 'number' ? f.type : undefined;
    properties[f.name] = { type, description: f.description };
    if (f.required) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

/**
 * Generic editor (ADR-0002). When the type declares `fields`, render a **form**
 * via the shared `SchemaForm` floor (ADR-0041 Inc 2/4) — one form renderer for
 * tool args, type-create, and fact-edit alike. Otherwise fall back to text
 * (string value) / raw JSON. `workspace.remember`'s advisory `hints` flow back
 * via `onSaved`.
 */
function FactEditor({
  e,
  fields,
  onSaved,
  onCancel,
}: {
  e: ListEntry;
  fields?: FormField[];
  onSaved: (v: unknown, hints?: string[]) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const isStr = typeof e.value === 'string';
  const base = e.value && typeof e.value === 'object' && !Array.isArray(e.value) ? (e.value as Record<string, unknown>) : {};
  const schema = Array.isArray(fields) && fields.length > 0 ? fieldsToFormSchema(fields) : undefined;
  const useForm = !isStr && isFormable(schema);

  const [form, setForm] = useState<Record<string, unknown>>(base);
  const [text, setText] = useState(isStr ? (e.value as string) : JSON.stringify(e.value ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    let value: unknown;
    if (useForm) {
      value = form;
    } else if (isStr) {
      value = text;
    } else {
      try {
        value = JSON.parse(text);
      } catch {
        setErr('Invalid JSON');
        return;
      }
    }
    setBusy(true);
    setErr(null);
    const r = await mcpCall('act', 'workspace.remember', { key: e.key, value, ...(e._meta?.type ? { type: e._meta.type } : {}) });
    setBusy(false);
    if (!r.ok) {
      setErr(typeof r.value === 'string' ? r.value : 'Save failed');
      return;
    }
    const hints = (r.value as { hints?: string[] })?.hints;
    onSaved(value, Array.isArray(hints) ? hints : undefined);
  };

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {useForm ? (
        <SchemaForm schema={schema} value={form} onChange={setForm} />
      ) : (
        <>
          <textarea
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            rows={Math.min(18, Math.max(4, text.split('\n').length + 1))}
            spellCheck={false}
            style={{ ...editInput, padding: '0.55rem', fontFamily: theme.mono }}
          />
          {!isStr ? <span style={{ color: theme.dim, fontSize: '0.68rem' }}>No schema — editing the raw JSON value.</span> : null}
        </>
      )}
      {err ? <Badge tone="danger">{err}</Badge> : null}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.dim, padding: '0.3rem 0.8rem', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

/** The peek body: the fact rendered by its viewer (full, not clamped), its
 *  provenance line, its neighbourhood, and the actions — escalate to the type's
 *  page/editor when declared, else edit generically in place. */
function FactDetail({ e }: { e: ListEntry }): React.JSX.Element {
  const [entry, setEntry] = useState<ListEntry>(e);
  const [editing, setEditing] = useState(false);
  const [hints, setHints] = useState<string[] | null>(null);
  useEffect(() => {
    setEntry(e);
    setEditing(false);
    setHints(null);
  }, [e]);
  const open = factHref(entry);
  const edit = factEdit(entry);
  const meta = entry._meta;
  const system = entry.key.startsWith('_');
  // The type's declared fields (ADR-0002 shape.fields), additively on $types.
  const fields = (declFor(entry, typeDecls) as { fields?: FormField[] } | undefined)?.fields;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ color: theme.dim, fontSize: '0.68rem', fontFamily: theme.mono, wordBreak: 'break-all' }}>
        {[meta?.type, entry.key].filter(Boolean).join(' · ')}
        {meta?.tags?.length ? '  ·  ' + meta.tags.map((t) => '#' + t).join(' ') : ''}
      </div>
      {editing ? (
        <FactEditor
          e={entry}
          fields={fields}
          onCancel={() => setEditing(false)}
          onSaved={(v, h) => {
            setEntry({ ...entry, value: v });
            setHints(h ?? null);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            <FactBody e={entry} full />
          </div>
          {hints?.length ? (
            <div style={{ display: 'grid', gap: '0.2rem', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '0.5rem 0.6rem', background: theme.panel }}>
              <span style={{ color: theme.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>suggestions</span>
              {hints.map((h, i) => (
                <span key={i} style={{ fontSize: '0.76rem', color: theme.text }}>· {h}</span>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            <span style={{ color: theme.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>neighbourhood</span>
            <Neighbourhood keyName={entry.key} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {open ? <Anchor href={open}>Open ↗</Anchor> : null}
            {edit ? <Anchor href={edit}>Edit in cell ↗</Anchor> : !system ? <Button onClick={() => setEditing(true)}>Edit</Button> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Mounted once at the app root: listens for `openFact`, hydrates a bare {key}
 *  via peek, and renders the modal. Returns null when nothing is open. */
function FactDetailHost(): React.JSX.Element | null {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<ListEntry>).detail;
      if (!detail?.key) return;
      setEntry(detail);
      if (detail.value === undefined) {
        mcpCall('read', 'workspace.peek', { key: detail.key })
          .then((r) => {
            const f = r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
            if (r.ok && f) setEntry({ key: detail.key, value: f.value, _meta: f._meta });
          })
          .catch(() => undefined);
      }
    };
    window.addEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
  }, []);
  if (!entry) return null;
  const title = `${typeIcon(entry) ? typeIcon(entry) + ' ' : ''}${factTitle(entry)}`;
  return (
    <Modal open onClose={() => setEntry(null)} title={title}>
      <FactDetail e={entry} />
    </Modal>
  );
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
/** Group edges by source key so each fact can show its outbound relationships. */
function edgeMap(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const ed of edges.filter((x) => !x.from.startsWith('_'))) {
    const list = m.get(ed.from) ?? [];
    list.push(ed);
    m.set(ed.from, list);
  }
  return m;
}

/** The salience lenses (platform/runtime/state LENS_PRESETS) as a UI choice —
 *  per-read biases over the tuned default ranking. */
const LENSES: Array<{ id: string; label: string }> = [
  { id: 'salience', label: 'Salient' },
  { id: 'recent', label: 'Recent' },
  { id: 'connected', label: 'Connected' },
  { id: 'durable', label: 'Durable' },
  { id: 'active', label: 'Active' },
];

function WorkspaceWindow({ authed, seed }: { authed: boolean; seed?: WorkspaceSeed }): React.JSX.Element | null {
  const [att, setAtt] = useState<AttentionData | null>(seed?.attention ?? null);
  const [facts, setFacts] = useState<ListEntry[] | null>(seed ? seed.facts : null);
  const [total, setTotal] = useState(seed?.total ?? 0);
  const [edges, setEdges] = useState<Map<string, Edge[]>>(seed ? edgeMap(seed.edges) : new Map());
  const [err, setErr] = useState<string | null>(null);
  const [lens, setLens] = useState('salience');
  const [busy, setBusy] = useState(false);
  const firstLens = React.useRef(true);

  // Re-rank on a lens change — a per-read salience bias, the same `lens` an agent
  // passes to workspace.query. The first run is skipped (the seeded/default view
  // already stands); switching lens re-queries client-side.
  useEffect(() => {
    if (!authed) return;
    if (firstLens.current) {
      firstLens.current = false;
      return;
    }
    let live = true;
    setBusy(true);
    mcpCall('read', 'workspace.query', { limit: 10, ...(lens !== 'salience' ? { lens } : {}) })
      .then((r) => {
        if (!live || !r.ok) return;
        const v = r.value as { entries?: ListEntry[]; total?: number };
        setFacts(v.entries ?? []);
        setTotal(v.total ?? 0);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [lens, authed]);

  useEffect(() => {
    // SSR seeded this snapshot (salience-ranked facts + attention + edges) — trust
    // it (no refetch flash). typeDecls is seeded too, so titles/viewers resolve.
    if (!authed || seed) return;
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
        if (l.ok) setEdges(edgeMap((l.value as { edges?: Edge[] }).edges ?? []));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  if (!authed) return null;

  const attTotal = att ? att.stale.length + att.unlinked.length + att.dangling.length : 0;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Heading sub="Your slice, salience-ranked — the same query an agent makes, rendered. The strip is the ranger's notebook.">
          Workspace
        </Heading>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: theme.dim, fontSize: '0.72rem', flexShrink: 0 }}>
          <span style={{ fontFamily: theme.mono }}>{busy ? '…' : 'lens'}</span>
          <select
            value={lens}
            onChange={(e) => setLens(e.target.value)}
            style={{ fontFamily: 'inherit', fontSize: '0.78rem', color: theme.text, background: '#fffef9', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '0.15rem 0.35rem' }}
          >
            {LENSES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>
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
            const out = edges.get(e.key) ?? [];
            return (
              <li key={e.key} style={{ lineHeight: 1.4, display: 'grid', gap: '0.25rem' }}>
                {/* Peek every fact in the modal first; cmd/ctrl-click still deep-links
                    to the type's own surface when it has one. */}
                <a
                  href={to ?? undefined}
                  onClick={(ev) => {
                    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                    ev.preventDefault();
                    openFact(e);
                  }}
                  style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}
                >
                  {title}
                </a>
                {/* The type's declared default viewer (hint), else a text preview. */}
                <FactBody e={e} />
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

/** One memoized `workspace.views` fetch shared by every surface that needs the
 *  registered-view list (the "All views" card, the Add-section picker, and the
 *  stats count) — was fetched 3–4× per load. SSR seeds it via `primeViews`. */
let viewsCache: ViewDef[] | null = null;
export function primeViews(seed?: ViewDef[]): void { if (seed && (viewsCache === null || viewsCache.length === 0)) viewsCache = seed; }
export async function loadViews(force = false): Promise<ViewDef[]> {
  if (viewsCache && !force) return viewsCache;
  try {
    const r = await mcpCall('read', 'workspace.views');
    if (r.ok) viewsCache = (r.value as { views?: ViewDef[] }).views ?? [];
  } catch { /* keep prior cache / empty */ }
  return viewsCache ?? [];
}

/** A small glyph for a view's render type — so the picker and cards read at a
 *  glance which kind of surface a view is (not just canvas). */
const VIEW_ICON: Record<string, string> = { canvas: '🌲', metric: '📊', count: '📊', list: '📋', table: '🗂️', feed: '🗞️', markdown: '📝' };
const viewIcon = (t?: string): string => (t && VIEW_ICON[t]) || '🔎';

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

  // A canvas view IS a board. ADR-0043: render it through canvas's federated
  // `ui://` renderer inside home's OWN opaque-origin sandbox (the harness home
  // already runs for machine-run et al.), NOT an origin-iframe to canvas's
  // session-less `?embed=1` origin. The old embed severed the viewer's session,
  // so a PRIVATE board fell to canvas's anon sign-in shell ("pointless"); here
  // home holds the session and proxies the renderer's board reads under the
  // viewer's identity, so private boards paint. Degrades to the label placeholder
  // if the renderer can't run (offline, CSP, cell down).
  if (type === 'canvas') {
    const href = localize(hint?.href ?? `/@c15r/canvas?view=${encodeURIComponent(def.id)}`);
    return (
      <div style={{ ...box, padding: 0, overflow: 'hidden' }}>
        <FederatedRendererFrame
          uri="ui://@c15r/canvas/renderers/board.js"
          type="canvas"
          value={{ viewId: def.id }}
          factKey={def.id}
          placeholder={
            <div style={{ height: 240, display: 'grid', placeItems: 'center', color: theme.dim, fontSize: '0.85rem', fontFamily: theme.serif }}>
              🌲 {label}…
            </div>
          }
        />
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
function Views({ authed, seed }: { authed: boolean; seed?: ViewDef[] }): React.JSX.Element | null {
  if (seed) primeViews(seed);
  const [views, setViews] = useState<ViewDef[] | null>(seed ?? viewsCache ?? null);

  useEffect(() => {
    if (!authed || seed) return; // SSR-seeded (typeDecls seeded too) → no refetch
    let live = true;
    // Load the type vocabulary first so list surfaces show icons + route by it,
    // then the shared (memoized) view list — also used by the Add-section picker.
    loadTypeDecls().then(() => loadViews()).then((vs) => {
      if (live) setViews(vs);
    }).catch(() => {
      if (live) setViews([]);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  if (!authed) return null;
  return (
    <Card>
      <Heading sub="Every registered view, rendered by its hint — one declaration, a surface for you and an affordance for agents. Pin any to your home from “Add a section”.">
        All views
      </Heading>
      {views === null ? (
        <p style={{ color: theme.dim, margin: '0.5rem 0 0', fontSize: '0.85rem' }}>Loading…</p>
      ) : views.length === 0 ? (
        <p style={{ color: theme.dim, margin: '0.5rem 0 0', fontSize: '0.85rem' }}>No views registered yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.7rem', marginTop: '0.5rem' }}>
          {views.map((v) => (
            <ViewSurface key={v.id} def={v} />
          ))}
        </div>
      )}
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
function CellsConsole({ authed, seed }: { authed: boolean; seed?: CellRow[] }): React.JSX.Element | null {
  const [cells, setCells] = useState<CellRow[] | null>(seed ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed || seed) return; // SSR-seeded → no refetch
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: '0.7rem', alignItems: 'start' }}>
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

/** The schema-form floor (ADR-0041 Inc 2), in the machine's own dark palette —
 *  so a generated form looks native inside the housing, not pasted from the
 *  light park theme the rest of home uses. */
const machineFormPalette: FormPalette = {
  text: machine.text,
  dim: machine.dim,
  border: machine.border,
  inputBg: machine.screen,
  accent: machine.green,
  danger: '#e08c7a',
  mono: theme.mono,
  sans: theme.mono, // the machine's voice stays monospace even for prose fields
};

interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  scope: string | null;
  inputSchema?: FormFieldSchema;
  /** ADR-0041 Inc 3: a cell-authored argument form for this capability. */
  ui?: { form?: string; as?: string };
}

/** A starter argument object from a capability's input schema — required keys
 *  (or, lacking any, every declared key) pre-seeded with a type-appropriate
 *  empty value. Shared by the JSON-textarea view (stringified) and the
 *  schema-form view (used as-is); both views edit the SAME underlying shape. */
function argSkeletonObject(schema?: Capability['inputSchema']): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const keys = schema?.required?.length ? schema.required : Object.keys(props);
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const t = props[k]?.type;
    obj[k] = t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
  }
  return obj;
}
/** A starter JSON argument object from a capability's input schema. */
function argSkeleton(schema?: Capability['inputSchema']): string {
  return JSON.stringify(argSkeletonObject(schema), null, 2);
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
  /** ADR-0041 Inc 3: a cell-authored argument form, if this capability declares one. */
  ui?: Capability['ui'];
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
  /** The `key` arg the command was called with, if any — a fallback identity for
   *  a fact-shaped result whose value omits its own key (e.g. `workspace.peek`
   *  returns `{value,_meta}` only; the caller already knows the key it asked for). */
  argsKey?: string;
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
      // `/mcp/whoami` requires the session bearer — use authFetch (not the bare
      // getJson the public oauth probe uses), or the gateway returns invalid_token.
      const res = await authFetch('/mcp/whoami');
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text(); }
      return { ok: res.status === 200, value: body };
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
  // A bespoke form (ADR-0041 Inc 3) may cover args the declared schema doesn't
  // even list (a minimal/empty inputSchema, fully driven by the custom UI) —
  // such a target still needs the focused arg-entry view, not an immediate
  // zero-arg call.
  const needsArgs = Object.keys(cap.inputSchema?.properties ?? {}).length > 0 || !!cap.ui?.form;
  return {
    id: cap.target,
    ns,
    verb,
    label: cap.target,
    kind: cap.kind,
    scope: cap.scope,
    description: cap.description,
    schema: cap.inputSchema,
    ui: cap.ui,
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
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  // 'form' when the schema supports it (the default — ADR-0041 Inc 2); 'json' is
  // the raw-JSON fallback/power-user escape hatch, always available via toggle.
  const [rawJson, setRawJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const counter = React.useRef(0);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    // `{detail:'full'}` returns the flat { capabilities:[…] } the console maps; a
    // bare $catalog returns the ADR-0033 grouped summary ({ cells:[{capabilities}] })
    // with no top-level .capabilities — which silently emptied the console. Request
    // full, and flatten the grouped shape too so a future default change can't
    // re-break it.
    mcpCall('read', '$catalog', { detail: 'full' })
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          setErr(typeof r.value === 'string' ? r.value : 'error');
          setCmds([...PROBE_CMDS]);
          return;
        }
        const v = r.value as { capabilities?: Capability[]; cells?: Array<{ capabilities?: Capability[] }> };
        const caps = v.capabilities ?? (v.cells ?? []).flatMap((c) => c.capabilities ?? []);
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
      const skeleton = argSkeletonObject(cmd.schema);
      setFormValue(skeleton);
      setArgs(JSON.stringify(skeleton, null, 2));
      // A schema the form floor can't walk at all (no object/properties — rare,
      // but some targets accept a bare scalar or an open `additionalProperties`
      // bag) starts in raw JSON UNLESS a cell-authored form (ADR-0041 Inc 3)
      // covers it regardless of the declared schema's shape.
      setRawJson(!cmd.ui?.form && !isFormable(cmd.schema));
    } else {
      void invoke(cmd, {});
    }
  };

  const invoke = async (cmd: Cmd, input: unknown): Promise<void> => {
    setBusy(true);
    const argsKey = input && typeof input === 'object' && typeof (input as { key?: unknown }).key === 'string' ? (input as { key: string }).key : undefined;
    try {
      const r = await cmd.run(input);
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: r.ok, value: r.value, at: Date.now(), argsKey }, ...prev].slice(0, 40));
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
    if (!rawJson) {
      void invoke(focused, formValue);
      return;
    }
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

  /** Toggle form ↔ raw-JSON, carrying the same value across (best-effort: a hand
   *  edited JSON view that doesn't parse just stays in JSON mode rather than
   *  losing the user's in-progress edit). */
  const toggleRawJson = (): void => {
    if (rawJson) {
      try {
        const parsed = args.trim() ? JSON.parse(args) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setFormValue(parsed as Record<string, unknown>);
          setRawJson(false);
        }
      } catch {
        /* invalid JSON — stay in raw mode, the textarea keeps the user's edit */
      }
    } else {
      setArgs(JSON.stringify(formValue, null, 2));
      setRawJson(true);
    }
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
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                runFocused();
              }
            }}
            style={{ display: 'grid', gap: '0.5rem' }}
          >
            {!rawJson && focused.ui?.form ? (
              <FederatedFormFrame
                uri={focused.ui.form}
                type={focused.ui.as || focused.id}
                schema={focused.schema}
                initialValue={formValue}
                onChange={setFormValue}
                placeholder={
                  <div style={{ ...screen, padding: '0.65rem' }}>
                    {isFormable(focused.schema) ? (
                      <SchemaForm schema={focused.schema} value={formValue} onChange={setFormValue} palette={machineFormPalette} />
                    ) : (
                      <span style={{ color: machine.dim, fontSize: '0.78rem' }}>loading form…</span>
                    )}
                  </div>
                }
              />
            ) : !rawJson && isFormable(focused.schema) ? (
              <div style={{ ...screen, padding: '0.65rem' }}>
                <SchemaForm schema={focused.schema} value={formValue} onChange={setFormValue} palette={machineFormPalette} />
              </div>
            ) : (
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                rows={Math.min(12, Math.max(2, args.split('\n').length))}
                spellCheck={false}
                autoFocus
                style={{ ...screen, width: '100%', boxSizing: 'border-box', padding: '0.55rem', fontSize: '0.8rem' }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                onClick={runFocused}
                disabled={busy}
                style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: `1px solid ${machine.green}`, background: 'transparent', color: machine.green, fontFamily: theme.mono, fontSize: '0.8rem', cursor: busy ? 'wait' : 'pointer' }}
              >
                {busy ? 'Running…' : `run · ${focused.kind}("${focused.label}")  ⌘↵`}
              </button>
              {focused.ui?.form || isFormable(focused.schema) ? (
                <button
                  onClick={toggleRawJson}
                  style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  {rawJson ? 'form' : 'raw json'}
                </button>
              ) : null}
            </div>
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

/** A tool result's federation directive (ADR-0039 Inc 2): `_render:{renderer,as}`. */
function renderDirective(v: unknown): { renderer: string; as: string } | null {
  if (!v || typeof v !== 'object') return null;
  const r = (v as { _render?: { renderer?: string; as?: string } })._render;
  return r && typeof r.renderer === 'string' && r.renderer.indexOf('ui://') === 0 ? { renderer: r.renderer, as: r.as || r.renderer } : null;
}
/** A single-fact-shaped result — `workspace.peek`'s `{value,_meta}` (ENTRY_SCHEMA). */
function isFactShaped(v: unknown): v is { key?: string; value: unknown; _meta?: ListEntry['_meta'] } {
  return !!v && typeof v === 'object' && 'value' in (v as object) && '_meta' in (v as object);
}
/** Normalize a `{entries: {...}|[...]}` result (query/search/list shapes) to a keyed list. */
function entriesOf(v: unknown): ListEntry[] {
  const e = v && typeof v === 'object' ? (v as { entries?: unknown }).entries : undefined;
  if (Array.isArray(e)) return e.map((it, i) => ({ key: (it as ListEntry)?.key || String(i), value: (it as ListEntry)?.value, _meta: (it as ListEntry)?._meta }));
  if (e && typeof e === 'object') return Object.entries(e as Record<string, ListEntry>).map(([k, it]) => ({ key: k, value: it?.value, _meta: it?._meta }));
  return [];
}

/**
 * A tool result rendered by what it IS — a federated `ui://` renderer (a tool's
 * `_render` directive), a single typed fact, or a list of typed facts — instead
 * of always `JSON.stringify` (ADR-0041 Inc 1: the field computer joins the
 * federated render surface the conversation card already uses, ADR-0039).
 * Errors and the two HTTP probes (raw JSON, not substrate facts) keep the JSON
 * view; any shape this doesn't recognise falls back to it too.
 */
function ResultBody({ o }: { o: Output }): React.JSX.Element {
  const fallback = (
    <pre style={{ background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.55rem', margin: 0, overflowX: 'auto', fontFamily: theme.mono, fontSize: '0.76rem', color: o.ok ? machine.text : '#e08c7a', maxHeight: 320 }}>
      <code>{typeof o.value === 'string' ? o.value : JSON.stringify(o.value, null, 2)}</code>
    </pre>
  );
  if (!o.ok || o.kind === 'probe') return fallback;
  const rd = renderDirective(o.value);
  if (rd) return <FederatedRendererFrame uri={rd.renderer} type={rd.as} value={o.value} factKey={o.argsKey} placeholder={fallback} />;
  const screen = { background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.55rem', color: machine.text } as const;
  if (isFactShaped(o.value)) {
    const e: ListEntry = { key: (o.value as { key?: string }).key || o.argsKey || '', value: (o.value as { value: unknown }).value, _meta: (o.value as { _meta?: ListEntry['_meta'] })._meta };
    const to = factHref(e);
    const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          {to ? <a href={to} style={{ color: machine.green, fontFamily: theme.serif, fontWeight: 600, textDecoration: 'none' }}>{title}</a> : <strong style={{ fontFamily: theme.serif }}>{title}</strong>}
          {e.key ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>{e.key}</span> : null}
        </div>
        <FactBody e={e} full />
      </div>
    );
  }
  const list = entriesOf(o.value);
  if (list.length) {
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.4rem', maxHeight: 420, overflowY: 'auto' }}>
        {list.slice(0, 12).map((e) => {
          const to = factHref(e);
          const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
          return (
            <div key={e.key} style={{ display: 'grid', gap: '0.15rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${machine.border}` }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                {to ? <a href={to} style={{ color: machine.green, textDecoration: 'none', fontWeight: 600, fontSize: '0.82rem' }}>{title}</a> : <span style={{ fontSize: '0.82rem' }}>{title}</span>}
                <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.65rem' }}>{e.key}</span>
              </div>
              <FactBody e={e} />
            </div>
          );
        })}
        {list.length > 12 ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.7rem' }}>+{list.length - 12} more</span> : null}
      </div>
    );
  }
  return fallback;
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
          <ResultBody o={o} />
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

export interface LayoutSection {
  type: string;
  id?: string; // view id (type 'view')
  key?: string; // fact key (type 'fact')
  query?: Record<string, unknown>; // (type 'query')
  title?: string;
  hidden?: boolean; // removed from the normal view (toggled in customise)
  collapsed?: boolean; // folded to its header in the normal view (persisted)
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
  activity: 'Recent activity', identity: 'Identity & grants', views: 'All views',
  cells: 'Cells', console: 'Field computer',
};
function sectionLabel(s: LayoutSection): string {
  if (s.type === 'view') return `View · ${s.id}`;
  if (s.type === 'fact') return `Fact · ${s.key}`;
  if (s.type === 'query') return `Query · ${s.title ?? '…'}`;
  return SECTION_LABELS[s.type] ?? s.type;
}

function useLayout(authed: boolean, seed?: LayoutSection[]): { sections: LayoutSection[]; save: (next: LayoutSection[]) => void } {
  const [sections, setSections] = useState<LayoutSection[]>(seed && seed.length ? seed : DEFAULT_LAYOUT);
  useEffect(() => {
    // SSR seeded the saved layout → trust it (no reorder/collapse reflow). Only
    // the unseeded path loads it.
    if (!authed || (seed && seed.length)) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  return (
    <Card style={{ display: 'grid', gap: '0.4rem' }}>
      {to ? (
        <a href={to} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600, fontFamily: theme.serif, fontSize: '1.05rem' }}>{title}</a>
      ) : (
        <strong style={{ fontFamily: theme.serif, fontSize: '1.05rem' }}>{title}</strong>
      )}
      {/* A pinned single fact may use its type's richer `embed` viewer. */}
      <FactBody e={e} embed />
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
  /** Server-seeded section data (authed SSR); sections trust it and skip the fetch. */
  boot?: Boot;
}

function SectionView({ s, ctx }: { s: LayoutSection; ctx: SectionCtx }): React.JSX.Element | null {
  switch (s.type) {
    case 'greeting': return <DashboardHeader session={ctx.session} />;
    case 'stats': return <StatCards data={ctx.dash} />;
    case 'capture': return <QuickCapture />;
    case 'workspace': return <WorkspaceWindow authed={ctx.authed} seed={ctx.boot?.workspace} />;
    case 'activity': return <RecentActivity data={ctx.dash} />;
    case 'identity': return <IdentityShell authed={ctx.authed} user={ctx.session.user} scopes={ctx.session.scopes} seed={ctx.boot?.identity} />;
    case 'views': return <Views authed={ctx.authed} seed={ctx.boot?.views} />;
    case 'cells': return <CellsConsole authed={ctx.authed} seed={ctx.boot?.cells} />;
    case 'console': return <FieldComputer authed={ctx.authed} />;
    case 'view': return s.id ? <ViewSurface def={{ id: s.id }} /> : null;
    case 'fact': return s.key ? <PinnedFact factKey={s.key} /> : null;
    case 'query': return <PinnedQuery query={s.query ?? {}} title={s.title} />;
    default: return null;
  }
}

/**
 * Normal-view section frame with a persisted collapse toggle. The affordance is a
 * flat caret that reads as the start of the section's own title (no separate
 * chip): when expanded it sits in the card's left padding, just before the
 * heading; when collapsed the section folds to a slim `▸ Label` row (and its body
 * — and any async load it would trigger — is skipped). Collapsed state lives in
 * `_home/layout`, so it survives reloads and follows you across devices.
 */
function CollapsibleSection({
  label,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const caret: React.CSSProperties = {
    position: 'absolute',
    top: '1.3rem',
    left: '0.5rem',
    zIndex: 3,
    border: 'none',
    background: 'none',
    padding: '0.2rem',
    margin: 0,
    color: theme.dim,
    cursor: 'pointer',
    fontSize: '0.8rem',
    lineHeight: 1,
  };
  if (collapsed) {
    return (
      <Card style={{ padding: '0.6rem 1rem' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          title={`Expand ${label}`}
          style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', width: '100%', border: 'none', background: 'none', padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ color: theme.dim, fontSize: '0.8rem' }}>▸</span>
          <span style={{ fontFamily: theme.serif, color: theme.dim, fontSize: '1.05rem' }}>{label}</span>
        </button>
      </Card>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        aria-label={`Collapse ${label}`}
        title={`Collapse ${label}`}
        style={caret}
      >
        ▾
      </button>
      {children}
    </div>
  );
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
  const [pins, setPins] = useState<Array<{ id: string; label: string; type?: string }> | null>(null);
  const [factKey, setFactKey] = useState('');
  const [q, setQ] = useState({ type: '', tag: '', prefix: '', title: '' });

  useEffect(() => {
    if (mode !== 'view' || pins) return;
    // ANY registered view is pinnable now (not just canvas boards) — ViewSurface
    // renders every render type. Reuses the shared (memoized) view list.
    loadViews()
      .then((views) => setPins(views.map((v) => ({ id: v.id, label: v.render?.label ?? v.description ?? v.id, type: v.render?.type }))))
      .catch(() => setPins([]));
  }, [mode, pins]);

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
        {tab('view', '📌 View')}
        {tab('fact', '📄 Fact')}
        {tab('query', '🔎 Query')}
      </div>
      {mode === 'view' ? (
        pins === null ? (
          <span style={{ color: theme.dim, fontSize: '0.82rem' }}>Loading views…</span>
        ) : pins.length === 0 ? (
          <span style={{ color: theme.dim, fontSize: '0.82rem' }}>No views registered.</span>
        ) : (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {pins.map((b) => (
              <button key={b.id} onClick={() => { onAdd({ type: 'view', id: b.id }); setMode(null); }} style={{ ...field, cursor: 'pointer', width: 'auto' }}>
                {viewIcon(b.type)} {b.label} +
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

export function App({ initial }: { initial?: Boot } = {}): React.JSX.Element {
  // Install the SSR-seeded type vocabulary before any fact renders, so the viewer
  // (render hints) and routing paint identically on server and first client render.
  if (initial?.types) setTypeDecls(initial.types);
  const session = useAuth(initial?.session);
  const authed = !!session.user;
  const [dash, setDash] = useState<DashboardData | null>(initial?.dash ?? null);
  const { sections, save } = useLayout(authed, initial?.layout);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    // SSR already seeded the snapshot — trust it (no refetch flash). Only the
    // cold-mount / anon→client-auth path (no seed) loads it here.
    if (!authed || dash) return;
    let live = true;
    loadDashboard()
      .then((d) => {
        if (live) setDash(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const toggle = (i: number): void => save(sections.map((s, k) => (k === i ? { ...s, hidden: !s.hidden } : s)));
  const setCollapsed = (i: number): void => save(sections.map((s, k) => (k === i ? { ...s, collapsed: !s.collapsed } : s)));
  const remove = (i: number): void => save(sections.filter((_s, k) => k !== i));
  const add = (s: LayoutSection): void => save([...sections, s]);

  const ctx: SectionCtx = { session, authed, dash, boot: initial };
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
            if (!customizing) {
              // The greeting is the banner; the field computer is the always-at-hand
              // console — neither folds. Everything else is collapsible.
              if (s.type === 'greeting' || s.type === 'console') return <React.Fragment key={k}>{body}</React.Fragment>;
              return (
                <CollapsibleSection key={k} label={sectionLabel(s)} collapsed={!!s.collapsed} onToggle={() => setCollapsed(i)}>
                  {body}
                </CollapsibleSection>
              );
            }
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
      <FactDetailHost />
    </Page>
  );
}

