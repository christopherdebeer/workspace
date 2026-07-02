/**
 * ADR-0044 Inc 5: pinned/registered views and the cells console, split from
 * app.tsx (moved verbatim) — the shared views cache (primeViews/loadViews),
 * ViewSurface render-hint routing, and the owned-cells cards.
 */
import * as React from 'react';
import { Card, Heading, Badge, CodeBlock, theme } from '@parc/ui';
import { localize, mcpCall } from './lib';
import { loadTypeDecls, typeIcon, factTitle, factHref } from './facts';
import { FederatedRendererFrame } from './federated';
import { InlineButton } from './identity';

const { useState, useEffect } = React;

// ─── pinned views (registered views rendered by hint) ──────────────

interface RenderHint {
  type?: string;
  label?: string;
  href?: string;
}

export interface ViewDef {
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
export const viewIcon = (t?: string): string => (t && VIEW_ICON[t]) || '🔎';

export function ViewSurface({ def }: { def: ViewDef }): React.JSX.Element {
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
export function Views({ authed, seed }: { authed: boolean; seed?: ViewDef[] }): React.JSX.Element | null {
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

export interface CellRow {
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
export function CellsConsole({ authed, seed }: { authed: boolean; seed?: CellRow[] }): React.JSX.Element | null {
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
