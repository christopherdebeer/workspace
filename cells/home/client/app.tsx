/**
 * Home cell client — parc.land's two faces, stripped to the essentials
 * (owner direction, 2026-07-10).
 *
 * Signed out: the trailhead — a painted dusk valley, the wordmark, and the
 * passkey door. Signed in: TWO objects, nothing else — the 3D/2D substrate
 * GRAPH (the whole slice as a full-viewport map; the graph IS the workspace)
 * and the FIELD COMPUTER (the read/act console in its floating palette,
 * ⌘K at hand). The legacy section dashboard is gone; refinement effort goes
 * into making these two excellent rather than many things adequate.
 *
 * Everything still speaks the same `mcpCall` vocabulary an agent does; the
 * park language lives in copy, never in targets.
 */
import * as React from 'react';
import { Page, theme, type TypeDecl } from '@parc/ui';
import { useAuth, type Session } from './lib';
import { Landing, Wordmark } from './dashboard';
import { FullGraph } from './graph';
import { Palette } from './palette';
import { setTypeDecls, FactDetailHost } from './facts';

// The public surface: index.ts (SSR) and main.tsx (hydration) import from here.
export type { Session } from './lib';
export { typeDeclsFrom, setTypeDecls, loadTypeDecls, typeIcon } from './facts';

const { useState } = React;

/**
 * The graph shell's parachute. A render error anywhere under the graph/palette
 * would otherwise rethrow inside react-dom's cross-origin (esm.sh) frames and
 * reach window.onerror as a masked "Script error." with no detail — a boundary
 * receives the REAL error in-JS, so we can show it and keep the page usable.
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
 * The server's first-paint seed: the resolved session plus the canonical type
 * vocabulary ($types/describeTypes), seeded so icons/titles/routing paint
 * server-side identically to the client. The graph and the field computer load
 * their own data live (they are the interactive surface, not a snapshot).
 */
export interface Boot {
  session: Session;
  types?: Record<string, TypeDecl>;
}

export function App({ initial }: { initial?: Boot } = {}): React.JSX.Element {
  // Install the SSR-seeded type vocabulary before any fact renders, so the viewer
  // (render hints) and routing paint identically on server and first client render.
  if (initial?.types) setTypeDecls(initial.types);
  const session = useAuth(initial?.session);
  const authed = !!session.user;
  // App owns selection BY KEY (not node object): the palette's neighbour chips
  // and the graph's taps both funnel here, and the graph pans to any selection
  // it didn't originate (ADR-0047 v2).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (!session.ready) return <Page>{null}</Page>;

  if (!authed) {
    return (
      <Page>
        <Landing session={session} />
        <p style={{ margin: 0, textAlign: 'center', color: theme.dim, fontSize: '0.75rem' }}>
          <Wordmark /> · a personal substrate · <a href="https://parc.land/mcp" style={{ color: theme.accent }}>agents start here</a>
        </p>
      </Page>
    );
  }

  return (
    <>
      <GraphBoundary
        fallback={(err) => (
          <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#241f18', color: '#efe9dc', padding: '1rem' }}>
            <div style={{ maxWidth: 640 }}>
              <p style={{ fontFamily: theme.mono }}>the graph hit an error:</p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: '#e8a0a0', maxHeight: '40vh', overflowY: 'auto' }}>{err.message}{'\n'}{err.stack?.split('\n').slice(0, 8).join('\n')}</pre>
              <button
                onClick={() => window.location.reload()}
                style={{ background: 'none', color: '#f5c453', border: '1px solid #3d362b', borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}
              >
                reload
              </button>
            </div>
          </div>
        )}
      >
        <FullGraph selectedKey={selectedKey} onSelect={(n) => setSelectedKey(n?.key ?? null)} />
        <Palette authed={authed} selectedKey={selectedKey} onSelectKey={setSelectedKey} onClear={() => setSelectedKey(null)} />
        <div style={{ position: 'fixed', top: 10, left: 12, zIndex: 30, pointerEvents: 'none' }}>
          <span style={{ pointerEvents: 'auto', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))' }}><Wordmark /></span>
        </div>
      </GraphBoundary>
      <FactDetailHost />
    </>
  );
}
