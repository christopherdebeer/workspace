/**
 * Palette (ADR-0047, v2) — the field computer wearing the canvas palette's shell.
 *
 * A fixed bottom-center floating bar over the graph (no scrim — the graph stays
 * live). Collapsed = one pill; ⌘K opens the detented sheet holding the Console
 * (the engine, reused whole); Esc closes. Positionable on desktop (drag the
 * handle; double-tap re-docks); a full-width bottom sheet on small screens.
 *
 * v2 (use feedback): the CONTEXT ROW grew into a context PANEL — selecting a
 * graph node peeks the fact and shows its CONTENT (FactBody, the shared render
 * floor) plus its NEIGHBOURHOOD as chips; tapping a neighbour chip changes the
 * selection, which pans the graph (App owns `selectedKey`; the graph eases its
 * camera to any external selection). Peek still opens the full progressive
 * detail modal; open follows the type's declared surface.
 */
import * as React from 'react';
import { Console } from './console';
import { openFact, typeIcon, factTitle, factHref, FactBody, type ListEntry } from './facts';
import { localize, mcpCall } from './lib';

const { useState, useEffect, useRef, useCallback } = React;

const ink = { bg: '#181511', panel: '#221d16', line: '#3d362b', text: '#efe9dc', dim: '#9a917f', accent: '#f5c453', mono: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const chip: React.CSSProperties = {
  background: 'none', border: `1px solid ${ink.line}`, color: ink.text, borderRadius: 999,
  fontSize: '0.72rem', fontFamily: ink.mono, padding: '0.15rem 0.6rem', cursor: 'pointer', textDecoration: 'none',
  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

interface NeighborRef { key: string; rel: string; entry: ListEntry }

/** The selected fact's context: peeked content + its neighbourhood as chips. */
function ContextPanel({ factKey, onSelectKey, onClear }: { factKey: string; onSelectKey: (k: string) => void; onClear: () => void }): React.JSX.Element {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborRef[]>([]);
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    let live = true;
    setEntry(null);
    setNeighbors([]);
    setShowBody(false);
    void mcpCall('read', 'workspace.peek', { key: factKey }).then((r) => {
      if (!live || !r.ok) return;
      const v = r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
      if (v) setEntry({ key: factKey, value: v.value, _meta: v._meta });
    });
    // Chips need icons + titles, not bodies — card tier (ADR-0048); the content
    // preview comes from the full `peek` above.
    void mcpCall('read', 'workspace.neighbors', { key: factKey, shape: 'card' }).then((r) => {
      if (!live || !r.ok) return;
      const v = r.value as { outbound?: Array<{ to: string; rel: string }>; inbound?: Array<{ from: string; rel: string }>; entries?: Record<string, ListEntry> } | null;
      const seen = new Set<string>([factKey]);
      const out: NeighborRef[] = [];
      // The `entries` map is keyed BY fact key — its values don't repeat it, so
      // stamp the key on (typeIcon/factTitle resolve off entry.key).
      const entryOf = (k: string): ListEntry => ({ ...(v?.entries?.[k] ?? {}), key: k }) as ListEntry;
      for (const e of v?.outbound ?? []) {
        if (!e.to || seen.has(e.to)) continue;
        seen.add(e.to);
        out.push({ key: e.to, rel: e.rel, entry: entryOf(e.to) });
      }
      for (const e of v?.inbound ?? []) {
        if (!e.from || seen.has(e.from)) continue;
        seen.add(e.from);
        out.push({ key: e.from, rel: `← ${e.rel}`, entry: entryOf(e.from) });
      }
      setNeighbors(out.slice(0, 12));
    });
    return () => {
      live = false;
    };
  }, [factKey]);

  const e = entry ?? ({ key: factKey } as ListEntry);
  const href = factHref(e);
  return (
    <div style={{ display: 'grid', gap: '0.35rem', padding: '0.45rem 0.7rem', borderBottom: `1px solid ${ink.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <span aria-hidden>{typeIcon(e)}</span>
        <button
          onClick={() => setShowBody((b) => !b)}
          title={factKey}
          style={{ background: 'none', border: 'none', color: ink.text, fontFamily: ink.mono, fontSize: '0.8rem', cursor: 'pointer', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}
        >
          {entry ? factTitle(e) : factKey} <span style={{ color: ink.dim }}>{showBody ? '▾' : '▸'}</span>
        </button>
        <button style={chip} onClick={() => openFact({ key: factKey } as ListEntry)}>peek</button>
        {href ? <a style={chip} href={localize(href)}>open ↗</a> : null}
        <button style={{ ...chip, border: 'none', color: ink.dim, maxWidth: 'none' }} onClick={onClear} aria-label="clear selection">×</button>
      </div>
      {showBody && entry ? (
        <div style={{ maxHeight: 180, overflowY: 'auto', overscrollBehavior: 'contain', background: ink.panel, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '0.82rem' }}>
          <FactBody e={entry} full />
        </div>
      ) : null}
      {neighbors.length ? (
        <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', overscrollBehavior: 'contain', paddingBottom: 2 }}>
          {neighbors.map((n) => (
            <button key={`${n.rel}:${n.key}`} style={chip} title={`${n.rel} · ${n.key}`} onClick={() => onSelectKey(n.key)}>
              {typeIcon(n.entry)} {factTitle(n.entry) || n.key}
              <span style={{ color: ink.dim }}> · {n.rel.replace('← ', '⭠')}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Palette({ authed, selectedKey, onSelectKey, onClear }: { authed: boolean; selectedKey: string | null; onSelectKey: (k: string) => void; onClear: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onHandleDown = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth < 700) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: pos?.x ?? 0, y: pos?.y ?? 0 };
  }, [pos]);
  const onHandleMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPos({ x: d.x + (e.clientX - d.px), y: Math.min(0, d.y + (e.clientY - d.py)) });
  }, []);
  const onHandleUp = useCallback(() => { drag.current = null; }, []);

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 10,
        transform: pos ? `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` : 'translateX(-50%)',
        width: 'min(720px, calc(100vw - 12px))',
        zIndex: 40,
        display: 'grid',
        background: ink.bg,
        border: `1px solid ${ink.line}`,
        borderRadius: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        color: ink.text,
      }}
    >
      {selectedKey ? <ContextPanel factKey={selectedKey} onSelectKey={onSelectKey} onClear={onClear} /> : null}
      {open ? (
        <div style={{ maxHeight: '56vh', overflowY: 'auto', overscrollBehavior: 'contain', background: ink.panel }}>
          <Console authed={authed} />
        </div>
      ) : null}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onDoubleClick={() => setPos(null)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.8rem', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: 'none', border: 'none', color: ink.text, fontFamily: ink.mono, fontSize: '0.85rem', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, textAlign: 'left' }}
        >
          <span style={{ color: ink.accent }}>{open ? '▾' : '▴'}</span>
          field computer
          <span style={{ color: ink.dim, fontSize: '0.72rem' }}>{open ? 'esc to close' : 'search or run a capability'}</span>
        </button>
        <kbd style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.7rem', border: `1px solid ${ink.line}`, borderRadius: 5, padding: '0.05rem 0.35rem' }}>⌘K</kbd>
      </div>
    </div>
  );
}
