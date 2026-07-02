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
// ADR-0044 Inc 5: app.tsx is now the composition seam — the per-surface modules
// (lib/federated/dashboard/identity/facts/views/console) hold the code, moved
// verbatim; app.tsx composes the layout/page and re-exports everything index.ts
// (SSR) and main.tsx (hydration) import, so paths outside client/ are unchanged.
import * as React from 'react';
import { Page, Card, Heading, Button, Anchor, theme, type TypeDecl } from '@parc/ui';
import { useAuth, mcpCall, type Session } from './lib';
import { Landing, Wordmark, DashboardHeader, StatCards, RecentActivity, QuickCapture, loadDashboard, type DashboardData } from './dashboard';
import { FullGraph } from './graph';
import { Palette } from './palette';
import { setTypeDecls, loadTypeDecls, typeIcon, factTitle, factHref, FactBody, EditLink, FactDetailHost, WorkspaceWindow, type WorkspaceSeed, type ListEntry } from './facts';
import { IdentityShell, type IdentityData } from './identity';
import { Views, ViewSurface, viewIcon, loadViews, CellsConsole, type CellRow, type ViewDef } from './views';
import { FieldComputer } from './console';

// The public surface index.ts / main.tsx (and any future consumer) import from
// './client/app' — re-exported from the modules that now define them.
export type { Session } from './lib';
export type { ChangeEvent, DashboardData } from './dashboard';
export type { WorkspaceSeed } from './facts';
export { typeDeclsFrom, setTypeDecls, loadTypeDecls, typeIcon } from './facts';
export { primeViews, loadViews } from './views';

const { useState, useEffect } = React;

/**
 * The graph shell's parachute. A render error anywhere under the graph/palette
 * would otherwise rethrow inside react-dom's cross-origin (esm.sh) frames and
 * reach window.onerror as a masked "Script error." with no detail — a boundary
 * receives the REAL error in-JS, so we can show it and keep the page usable
 * (the legacy dashboard stays one state-flip away via the caller's fallback).
 */
class GraphBoundary extends React.Component<
  { fallback: (err: Error) => React.ReactNode; children: React.ReactNode },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err };
  }
  componentDidCatch(err: Error): void {
    console.error('[home graph]', err);
  }
  render(): React.ReactNode {
    return this.state.err ? this.props.fallback(this.state.err) : this.props.children;
  }
}

/**
 * The server's first-paint seed: the resolved session plus the substrate-backed
 * data the cell read directly (LeadingKeys-scoped STATE#/TRAJ# — see index.ts).
 * Seeding these makes the dashboard render with REAL content server-side and the
 * client trust it (no refetch), so stats/activity and the saved layout don't
 * flash/reflow in after hydration. Sections that need salience or cross-cell
 * commands (workspace window, identity, cells) still hydrate client-side.
 */
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
  // ADR-0047: the graph IS the authed home; the section dashboard stays one
  // toggle away (state, not a route — SSR always renders the graph shell, so
  // server and first client paint agree by construction).
  const [legacy, setLegacy] = useState(false);
  // App owns selection BY KEY (not node object): the palette's neighbour chips
  // and the graph's taps both funnel here, and the graph pans to any selection
  // it didn't originate (ADR-0047 v2).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
      ) : !legacy ? (
        <GraphBoundary
          fallback={(err) => (
            <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#241f18', color: '#efe9dc', padding: '1rem' }}>
              <div style={{ maxWidth: 640 }}>
                <p style={{ fontFamily: theme.mono }}>the graph hit an error:</p>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: '#e8a0a0', maxHeight: '40vh', overflowY: 'auto' }}>{err.message}{'\n'}{err.stack?.split('\n').slice(0, 8).join('\n')}</pre>
                <button onClick={() => setLegacy(true)} style={{ background: 'none', color: '#f5c453', border: '1px solid #3d362b', borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}>
                  open the dashboard instead
                </button>
              </div>
            </div>
          )}
        >
          <FullGraph selectedKey={selectedKey} onSelect={(n) => setSelectedKey(n?.key ?? null)} />
          <Palette authed={authed} selectedKey={selectedKey} onSelectKey={setSelectedKey} onClear={() => setSelectedKey(null)} />
          <div style={{ position: 'fixed', top: 10, left: 12, right: 12, zIndex: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
            <span style={{ pointerEvents: 'auto', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))' }}><Wordmark /></span>
            <button
              onClick={() => setLegacy(true)}
              style={{ pointerEvents: 'auto', background: 'rgba(24,21,17,0.8)', color: '#efe9dc', border: '1px solid #3d362b', borderRadius: 8, fontSize: '0.75rem', fontFamily: theme.mono, padding: '0.3rem 0.7rem', cursor: 'pointer' }}
            >
              dashboard
            </button>
          </div>
        </GraphBoundary>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', alignItems: 'center' }}>
            <button
              onClick={() => setLegacy(false)}
              style={{ background: 'none', color: theme.dim, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: '0.78rem', padding: '0.25rem 0.7rem', cursor: 'pointer' }}
            >
              ⊹ graph
            </button>
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
