/**
 * Palette (ADR-0047) — the field computer wearing the canvas palette's shell.
 *
 * The deep review of both surfaces decided the fusion: the field computer has
 * the ENGINE a capability palette needs (live `$catalog` discovery, the
 * three-tier arg collection — ui:// form / SchemaForm / raw JSON — and rich
 * result rendering with an output tape), and the canvas palette has the SHELL
 * (a persistent floating bottom bar with no scrim, ⌘K summon, detents, and
 * context sensitivity from what's selected on the surface behind it).
 *
 * So: a fixed bottom-center bar over the graph. Collapsed = one pill. Expanded
 * = a detented sheet holding the Console (the engine, reused whole). When a
 * graph node is selected, a CONTEXT ROW appears above the pill — icon, title,
 * and the fact's affordances (peek / open) — the canvas `visible(controller)`
 * idea, driven by declared type handlers instead of hardcoded verbs.
 * Positionable on desktop (drag the handle; double-tap the handle to re-dock);
 * on small screens it stays a full-width bottom sheet.
 */
import * as React from 'react';
import { Console } from './console';
import { openFact, typeIcon, factTitle, factHref, type ListEntry } from './facts';
import { localize } from './lib';
import type { GraphNode } from './graph';

const { useState, useEffect, useRef, useCallback } = React;

const ink = { bg: '#181511', panel: '#221d16', line: '#3d362b', text: '#efe9dc', dim: '#9a917f', accent: '#f5c453', mono: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

function ContextRow({ node, onClear }: { node: GraphNode; onClear: () => void }): React.JSX.Element {
  const entry = { key: node.key, value: {}, _meta: { type: node.type ?? undefined } } as unknown as ListEntry;
  const href = factHref(entry);
  const chip: React.CSSProperties = {
    background: 'none', border: `1px solid ${ink.line}`, color: ink.text, borderRadius: 999,
    fontSize: '0.72rem', fontFamily: ink.mono, padding: '0.15rem 0.6rem', cursor: 'pointer', textDecoration: 'none',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.7rem', borderBottom: `1px solid ${ink.line}`, minWidth: 0 }}>
      <span aria-hidden>{typeIcon(entry)}</span>
      <button
        onClick={() => openFact({ key: node.key } as ListEntry)}
        title={node.key}
        style={{ background: 'none', border: 'none', color: ink.text, fontFamily: ink.mono, fontSize: '0.8rem', cursor: 'pointer', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}
      >
        {node.label || node.key}
      </button>
      <button style={chip} onClick={() => openFact({ key: node.key } as ListEntry)}>peek</button>
      {href ? <a style={chip} href={localize(href)}>open ↗</a> : null}
      <button style={{ ...chip, border: 'none', color: ink.dim }} onClick={onClear} aria-label="clear selection">×</button>
    </div>
  );
}

export function Palette({ authed, selected, onClear }: { authed: boolean; selected: GraphNode | null; onClear: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Desktop repositioning: a drag offset from the bottom-center dock. Small
  // screens ignore it (full-width sheet). Double-tap the handle re-docks.
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
    if (window.innerWidth < 700) return; // bottom sheet on small screens — not draggable
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
      {selected ? <ContextRow node={selected} onClear={onClear} /> : null}
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
