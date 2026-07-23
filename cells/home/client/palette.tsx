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
import { typeIcon, factTitle, factHref, factEdit, FactDetail, FactReading, InlineFactEditor, type ListEntry } from './facts';
import { localize, mcpCall } from './lib';
import { ink } from './ink';
import { TUNE, TUNE_EVENT, TUNE_RESET_EVENT } from './graph/tune';

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
function ContextPanel({ factKey, bodyOpen, setBodyOpen, onSelectKey, onClear, onCommand }: { factKey: string; bodyOpen: boolean; setBodyOpen: (v: boolean | ((b: boolean) => boolean)) => void; onSelectKey: (k: string) => void; onClear: () => void; onCommand: (target: string) => void }): React.JSX.Element {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborRef[]>([]);
  const [verbs, setVerbs] = useState<Array<{ target: string; kind: string }>>([]);
  // `bodyOpen` (the peek's fact-body expansion) is LIFTED to Palette so the
  // drag handle can drive it as the first rung of the sheet ladder; the title
  // tap and the caret still toggle it locally through the passed setter.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    setEntry(null);
    setNeighbors([]);
    setVerbs([]);
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
    void mcpCall('read', 'workspace.edges', { around: factKey, shape: 'card' }).then((r) => {
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
    <div style={{ display: 'grid', gap: '0.45rem', padding: '0.6rem 0.7rem', borderBottom: `1px solid ${ink.line}` }}>
      {/* TITLE FIRST (owner feedback #5/#3): the fact's name owns the top line at
          full reading size and WRAPS — no more "The Substrate T…" ellipsis. The
          only control on this line is × (clear), pinned right; edit/open moved to
          their own quiet row below so nothing competes with the name for the eye.
          Tapping the name toggles the body (a div, not a button, so the
          reading's h2/meta nest legally). */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }}>
        {/* Caret on the LEFT (owner feedback) — the expand/collapse control sits
            away from the × (dismiss), so the two axes don't share an edge. It
            toggles the body too; the drag handle drives the same state. */}
        <button
          aria-label={bodyOpen ? 'collapse fact' : 'expand fact'}
          onClick={() => setBodyOpen((b) => !b)}
          style={{ background: 'none', border: 'none', color: ink.dim, flexShrink: 0, fontSize: '0.8rem', cursor: 'pointer', padding: '0.15rem 0.2rem', marginTop: '0.1rem' }}
        >
          {bodyOpen ? '▾' : '▸'}
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setBodyOpen((b) => !b)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setBodyOpen((b) => !b); } }}
          title={factKey}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
        >
          <FactReading e={e} tone="dark" />
        </div>
        <button style={{ ...chip, border: 'none', color: ink.dim, maxWidth: 'none', padding: '0.15rem 0.4rem' }} onClick={onClear} aria-label="clear selection">×</button>
      </div>
      {/* Actions on their OWN quiet row — the panel FRAME (where peek used to be),
          not inside the scrolling body, and no longer crowding the title. */}
      {editHref || canEditInline || href ? (
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {editHref ? <a style={chip} href={localize(editHref)}>edit ↗</a> : null}
          {canEditInline ? (
            <button
              style={{ ...chip, borderColor: editing ? ink.accent : ink.line, color: editing ? ink.accent : ink.text }}
              onClick={() => {
                setEditing((v) => !v);
                setBodyOpen(true);
              }}
            >
              edit
            </button>
          ) : null}
          {href ? <a style={chip} href={localize(href)}>open ↗</a> : null}
        </div>
      ) : null}
      {bodyOpen && entry ? (
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
          {/* Verbs QUIETED (owner feedback #5): they used to shout in gold and
              outrank the title. Now neutral like neighbour chips, marked as
              actions by a dim leading `›` (run-this) rather than by colour, so
              the title wins the hierarchy. */}
          {verbs.slice(0, 3).map((v) => (
            <button key={v.target} style={{ ...chip, maxWidth: 220, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} title={v.target} onClick={() => onCommand(v.target)}>
              <span aria-hidden style={{ color: ink.dim, flexShrink: 0 }}>›</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{v.target.slice(v.target.lastIndexOf('.') + 1)}</span>
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

export function Palette({ authed, selectedKey, onSelectKey, onClear, onExitPull, onExitCommit, exitProgress = 0 }: {
  authed: boolean;
  selectedKey: string | null;
  onSelectKey: (k: string) => void;
  onClear: () => void;
  /** MIRROR EXIT (gesture-tracked): live px of the upward grip drag while a fact
   *  is peeked — the app rewinds the enter transition by it. 0 cancels. */
  onExitPull?: (px: number) => void;
  /** Commit the exit (drag past threshold released, or keyboard/discrete). */
  onExitCommit?: () => void;
  /** The app's exit progress (0–1) — fades the palette away as the trailhead
   *  arrives, both during the gesture and through the settle beat. */
  exitProgress?: number;
}): React.JSX.Element {
  // `open` = the results sheet is expanded. The SEARCH INPUT is always visible
  // (it IS the bottom bar now — owner feedback: fix the input to the bottom and
  // let the sheet collapse while the query, selection, and graph highlights
  // persist, so a phone can see what a search lit up).
  const [open, setOpen] = useState(false);
  // The peek's fact-body expansion, LIFTED here (from ContextPanel) so the drag
  // handle can drive it as the FIRST rung of the sheet ladder. Reset whenever
  // the selection changes — a freshly-peeked fact opens collapsed (header only).
  const [bodyOpen, setBodyOpen] = useState(false);
  useEffect(() => { setBodyOpen(false); }, [selectedKey]);
  // ADR-0049: a context-panel verb chip opens the console pre-searched to that
  // target (nonce so the same chip re-seeds after manual edits).
  const [seed, setSeed] = useState<{ q: string; n: number } | null>(null);
  const onCommand = useCallback((target: string) => {
    setSeed((s) => ({ q: target, n: (s?.n ?? 0) + 1 }));
    setOpen(true);
  }, []);

  // The frosted-glass knobs (blur/opacity) are tunable (TUNE) — re-render when a
  // tuner change (or reset) fires, so dialling them updates the pane live.
  const [, bumpGlass] = useState(0);
  useEffect(() => {
    const onTune = (): void => bumpGlass((v) => v + 1);
    window.addEventListener(TUNE_EVENT, onTune);
    window.addEventListener(TUNE_RESET_EVENT, onTune);
    return () => {
      window.removeEventListener(TUNE_EVENT, onTune);
      window.removeEventListener(TUNE_RESET_EVENT, onTune);
    };
  }, []);

  // THE SHEET LADDER. Pull-UP on a PEEKED fact is a COMMIT to reading it: the
  // graph leaves and the fact opens FULL on the trailhead — expanding the peek
  // and leaving the graph are the SAME motion (owner). The drag TRACKS the exit
  // live (onExitPull, the mirror of pull-to-enter); keyboard/tap commits
  // discretely (onExitCommit). The console is NOT in the exit path; with
  // nothing peeked, pull-up just opens it (search). (The caret/title tap still
  // expands the peek body INLINE for a quick look without leaving.) Pull-DOWN
  // collapses the inline body, then the console.
  const expandStep = useCallback((): void => {
    if (selectedKey) { onExitCommit?.(); return; } // peeked → full fact view (leave the graph)
    if (!open) setOpen(true); //                      no peek → open the console
  }, [selectedKey, open, onExitCommit]);
  const collapseStep = useCallback((): void => {
    if (selectedKey && bodyOpen) setBodyOpen(false); // ① the peek's body, even if the console is open
    else if (open) setOpen(false); //                   ② the console
    // else: already at the collapsed peek — do NOT dismiss (× owns that).
  }, [selectedKey, bodyOpen, open]);

  // DRAG HANDLE: a touch-native way to walk the ladder. It lives on a dedicated
  // grip strip that OWNS the vertical gesture (touchAction:none), so dragging
  // the sheet never leaks through to the graph's enter/scroll — the phone
  // scroll-conflict the ▴/▾ tap couldn't solve. `drag` is the live pointer
  // delta in px; the container rubber-bands by it and snaps back on release.
  const [drag, setDrag] = useState(0);
  const dragStart = React.useRef<number | null>(null);
  const DRAG_THRESH = 44;
  // The exit gesture commits at the SAME distance as pull-to-enter (140px) —
  // the two transitions are mirrors, so their gestures weigh the same.
  const EXIT_COMMIT = 140;
  const onHandleDown = (e: React.PointerEvent): void => {
    dragStart.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no capture */ }
  };
  const onHandleMove = (e: React.PointerEvent): void => {
    if (dragStart.current == null) return;
    const dy = e.clientY - dragStart.current;
    if (dy < 0 && selectedKey && onExitPull) {
      // Upward with a fact peeked = the MIRROR EXIT, tracked live: the app
      // rewinds the enter transition by this pull. The palette itself doesn't
      // ride the finger — it dissolves/settles via exitProgress (the motion
      // belongs to the world, not the sheet); the token -1px drag just keeps
      // the CSS transition off so the fade tracks frame-for-frame.
      setDrag(-1);
      onExitPull(-dy);
      return;
    }
    if (onExitPull) onExitPull(0); // crossed back below the start — cancel the exit
    // Downward rubber-bands the whole sheet; upward gives a small lift hint
    // (expansion grows the sheet, it doesn't slide it).
    setDrag(dy > 0 ? Math.min(dy, 160) : Math.max(dy, -60));
  };
  const endDrag = (e: React.PointerEvent): void => {
    const dy = dragStart.current == null ? 0 : e.clientY - dragStart.current;
    dragStart.current = null;
    setDrag(0);
    if (dy < 0 && selectedKey && onExitPull) {
      // Release the exit gesture: past the commit → step back to the trailhead;
      // short → cancel, everything springs back to the graph.
      if (-dy >= EXIT_COMMIT) onExitCommit?.();
      else onExitPull(0);
      return;
    }
    if (dy <= -DRAG_THRESH) expandStep();
    else if (dy >= DRAG_THRESH) collapseStep();
  };

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
        // FROSTED GLASS over the live graph (owner exploration): one translucent
        // dark pane with a backdrop blur, so the field computer + the context
        // panel read as a SINGLE sheet of glass — the console's old lighter
        // `ink.panel` fill is gone, both sections now sit on this one surface —
        // and the graph stays faintly visible, blurred, behind it. ink.bg
        // (#181511) filled at TUNE.glassOpacity; the blur keeps text legible over
        // bright stars. Both dials are tunable (group 'glass', live on TUNE_EVENT).
        background: `rgba(24,21,17,${TUNE.glassOpacity})`,
        backdropFilter: `blur(${TUNE.glassBlur}px) saturate(1.4)`,
        WebkitBackdropFilter: `blur(${TUNE.glassBlur}px) saturate(1.4)`,
        border: `1px solid ${ink.line}`,
        borderRadius: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        color: ink.text,
        // MIRROR EXIT: the palette dissolves and settles downward as the
        // trailhead arrives (exitProgress 0→1) — tracked live during the
        // gesture (no transition while dragging), eased through the settle.
        opacity: 1 - exitProgress,
        pointerEvents: exitProgress >= 0.7 ? 'none' : undefined,
        transform: drag || exitProgress ? `translateY(${(drag + exitProgress * 24).toFixed(1)}px)` : undefined,
        transition: drag ? 'none' : 'transform 0.18s ease, opacity 0.45s ease',
      }}
    >
      {/* The grip: drag up to expand, down to collapse/dismiss (see onHandleDown).
          A wide, thumb-sized target — generous vertical padding gives it a ~44px
          hit strip across the full width, though the visible pill stays small. */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="button"
        tabIndex={0}
        aria-label="resize the palette (drag up to expand, down to collapse)"
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); expandStep(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); collapseStep(); }
        }}
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '1.25rem 0 1.1rem', cursor: 'grab', touchAction: 'none' }}
      >
        <span aria-hidden style={{ width: 34, height: 4, borderRadius: 999, background: ink.line }} />
      </div>
      {selectedKey ? <ContextPanel factKey={selectedKey} bodyOpen={bodyOpen} setBodyOpen={setBodyOpen} onSelectKey={onSelectKey} onClear={onClear} onCommand={onCommand} /> : null}
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
