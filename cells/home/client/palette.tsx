/**
 * Palette (ADR-0047, v2) — the field computer wearing the canvas palette's shell.
 *
 * A fixed bottom-center instrument over the graph (no scrim — the graph stays
 * live). The SEARCH INPUT is the always-visible bottom bar; the results sheet
 * expands above it and collapses without losing the query, the matches, or the
 * graph highlights (Console stays mounted). ⌘K expands; Esc collapses.
 *
 * v3 (use feedback): the context panel's EXPAND is the one fact detail —
 * tapping the title unfolds FactDetail (provenance, full body, edit/open)
 * in place; the separate peek sheet was a second, differently-styled copy of
 * the same content and is gone from this flow. Neighbour chips change the
 * selection, which pans the graph (App owns `selectedKey`); `open ↗` escalates
 * to the type's declared surface.
 */
import * as React from 'react';
import { Console } from './console';
import { typeIcon, factTitle, factHref, factEdit, FactDetail, InlineFactEditor, type ListEntry } from './facts';
import { localize, mcpCall } from './lib';
import { ink } from './ink';

const { useState, useEffect, useCallback } = React;

const chip: React.CSSProperties = {
  background: 'none', border: `1px solid ${ink.line}`, color: ink.text, borderRadius: 999,
  fontSize: '0.72rem', fontFamily: ink.mono, padding: '0.28rem 0.65rem', cursor: 'pointer', textDecoration: 'none',
  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  // In a scrolling row a flex child SHRINKS by default — chips were crushing
  // each other down to an icon and an ellipsis instead of scrolling (the
  // density noise in the owner's screenshot). They keep their size; the row scrolls.
  flexShrink: 0,
};

interface NeighborRef { key: string; rel: string; entry: ListEntry }

/** The selected fact's context: peeked content + its neighbourhood as chips +
 *  the verbs that can act on it (ADR-0049 — `$catalog {for}`; tapping one
 *  seeds the console). */
function ContextPanel({ factKey, onSelectKey, onClear, onCommand }: { factKey: string; onSelectKey: (k: string) => void; onClear: () => void; onCommand: (target: string) => void }): React.JSX.Element {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborRef[]>([]);
  const [verbs, setVerbs] = useState<Array<{ target: string; kind: string }>>([]);
  const [showBody, setShowBody] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    setEntry(null);
    setNeighbors([]);
    setVerbs([]);
    setShowBody(false);
    setEditing(false);
    // The contextual capability menu — what can ACT on this fact, inferred
    // from its type signals (ADR-0049). Type-specific tools lead; the
    // always-applicable workspace verbs stay in the console's full list.
    void mcpCall('read', '$catalog', { for: factKey }).then((r) => {
      if (!live || !r.ok) return;
      const v = r.value as { capabilities?: Array<{ target: string; kind: string }> } | null;
      setVerbs((v?.capabilities ?? []).slice(0, 6));
    });
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
  const editHref = entry ? factEdit(e) : null;
  const canEditInline = !!entry && !editHref && !factKey.startsWith('_');
  // A chip whose label is an icon and an ellipsis says nothing — only
  // neighbours with a resolvable TITLE earn a chip.
  const namedNeighbors = neighbors.filter((n) => !!factTitle(n.entry));
  return (
    <div style={{ display: 'grid', gap: '0.4rem', padding: '0.55rem 0.7rem', borderBottom: `1px solid ${ink.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <span aria-hidden>{typeIcon(e)}</span>
        <button
          onClick={() => setShowBody((b) => !b)}
          title={factKey}
          style={{ background: 'none', border: 'none', color: ink.text, fontFamily: ink.mono, fontSize: '0.8rem', cursor: 'pointer', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}
        >
          {entry ? factTitle(e) : factKey} <span style={{ color: ink.dim }}>{showBody ? '▾' : '▸'}</span>
        </button>
        {/* Actions live on the panel FRAME (where peek used to be), not inside
            the scrolling body — owner feedback. */}
        {editHref ? <a style={chip} href={localize(editHref)}>edit ↗</a> : null}
        {canEditInline ? (
          <button
            style={{ ...chip, borderColor: editing ? ink.accent : ink.line, color: editing ? ink.accent : ink.text }}
            onClick={() => {
              setEditing((v) => !v);
              setShowBody(true);
            }}
          >
            edit
          </button>
        ) : null}
        {href ? <a style={chip} href={localize(href)}>open ↗</a> : null}
        <button style={{ ...chip, border: 'none', color: ink.dim, maxWidth: 'none' }} onClick={onClear} aria-label="clear selection">×</button>
      </div>
      {showBody && entry ? (
        <div style={{ maxHeight: 'min(42dvh, 340px)', overflowY: 'auto', overscrollBehavior: 'contain', background: ink.panel, border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.6rem 0.7rem', fontSize: '0.82rem' }}>
          {editing ? (
            <InlineFactEditor
              e={entry}
              onCancel={() => setEditing(false)}
              onSaved={(savedEntry) => {
                setEntry(savedEntry);
                setEditing(false);
              }}
            />
          ) : (
            <FactDetail e={entry} compact />
          )}
        </div>
      ) : null}
      {/* ONE row of context, not three (the stacked verb + icon-chip rows read
          as dense noise on a phone — owner feedback): a few readable verbs,
          then the neighbours that actually HAVE a name. Horizontal scroll. */}
      {verbs.length || namedNeighbors.length ? (
        <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', overscrollBehavior: 'contain', paddingBottom: 5, alignItems: 'center', scrollbarWidth: 'thin', scrollbarColor: `${ink.line} transparent` }}>
          {verbs.slice(0, 3).map((v) => (
            <button key={v.target} style={{ ...chip, borderColor: ink.accent, color: ink.accent, maxWidth: 220 }} title={v.target} onClick={() => onCommand(v.target)}>
              {v.target.slice(v.target.lastIndexOf('.') + 1)}
            </button>
          ))}
          {verbs.length && namedNeighbors.length ? <span aria-hidden style={{ color: ink.line, flexShrink: 0 }}>·</span> : null}
          {namedNeighbors.slice(0, 8).map((n) => {
            // The REL and DIRECTION are what make a neighbour chip mean
            // something ("what even is this?") — kept secondary: dim, after
            // the title. `rel ›` points out of this fact; `‹ rel` into it.
            // The rel NEVER truncates (flexShrink 0) — the title ellipsizes.
            const inbound = n.rel.startsWith('← ');
            const rel = n.rel.replace('← ', '');
            return (
              <button
                key={`${n.rel}:${n.key}`}
                style={{ ...chip, maxWidth: 250, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                title={`${inbound ? `${rel} from` : `${rel} to`} ${n.key}`}
                onClick={() => onSelectKey(n.key)}
              >
                <span aria-hidden style={{ flexShrink: 0 }}>{typeIcon(n.entry)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{factTitle(n.entry)}</span>
                <span style={{ color: ink.dim, flexShrink: 0 }}>{inbound ? `‹ ${rel}` : `${rel} ›`}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Palette({ authed, selectedKey, onSelectKey, onClear }: { authed: boolean; selectedKey: string | null; onSelectKey: (k: string) => void; onClear: () => void }): React.JSX.Element {
  // `open` = the results sheet is expanded. The SEARCH INPUT is always visible
  // (it IS the bottom bar now — owner feedback: fix the input to the bottom and
  // let the sheet collapse while the query, selection, and graph highlights
  // persist, so a phone can see what a search lit up).
  const [open, setOpen] = useState(false);
  // ADR-0049: a context-panel verb chip opens the console pre-searched to that
  // target (nonce so the same chip re-seeds after manual edits).
  const [seed, setSeed] = useState<{ q: string; n: number } | null>(null);
  const onCommand = useCallback((target: string) => {
    setSeed((s) => ({ q: target, n: (s?.n ?? 0) + 1 }));
    setOpen(true);
  }, []);

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

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        marginInline: 'auto',
        bottom: 'max(10px, env(safe-area-inset-bottom))',
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
      {selectedKey ? <ContextPanel factKey={selectedKey} onSelectKey={onSelectKey} onClear={onClear} onCommand={onCommand} /> : null}
      {/* The Console stays MOUNTED whether or not its sheet shows — collapsing
          must not cost the query, the matches, or the graph highlights. */}
      <Console
        authed={authed}
        seed={seed}
        collapsed={!open}
        onCollapse={(c) => setOpen(!c)}
        onSelectKey={(k) => {
          onSelectKey(k);
          setOpen(false); // reveal the graph focus the selection just drove
        }}
      />
    </div>
  );
}
