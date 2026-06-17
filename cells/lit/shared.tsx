/* ---------------------------------------------------------------------------
 * lit/shared — the isomorphic surface.
 *
 * One React tree, rendered to a string on the server (renderToString) and
 * hydrated on the client (hydrateRoot). Because both sides import THIS module,
 * the markup is byte-identical — so hydration attaches instead of discarding,
 * which is what kills the first-paint flash at the source (no more anonymous-SSR
 * then authed-client rebuild).
 *
 * These components are presentational and read-only: they render exactly what the
 * server emits. Interactivity (editing, the change feed, fence enhancement) is
 * layered on the client AFTER hydration — see client/main.tsx. Keeping the first
 * render identical to the server is the whole contract.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { marked } from 'marked';

export interface BlockRef { key: string; fold?: boolean }
/** A document is a *view* over cell-facts: thin metadata; membership + order live
 *  in substrate-native `_doc/<id>/<cellKey>={seq,fold}` decorations. `blocks`/
 *  `cells` are the legacy embedded array, read only for migration. `cellCount`
 *  is a denormalised count for the doc list; `projection` is the default lens. */
export interface DocValue {
  title: string;
  summary?: string;
  blocks?: BlockRef[];
  cells?: BlockRef[];
  cellCount?: number;
  projection?: 'narrative' | 'salience';
}
/** A block resolved for render: its markdown (or a fold title) + identity. */
export interface BlockData { key: string; md: string; fold?: boolean }
export interface ListItem { id: string; title: string; summary?: string; blocks: number; updated: string }

/** The serialized first-paint state the server hands the client to hydrate. */
export type ViewModel =
  | { kind: 'list'; owner: string; isOwner: boolean; docs: ListItem[] }
  | { kind: 'doc'; owner: string; isOwner: boolean; id: string; title: string; summary?: string; blocks: BlockData[] };

/* ── markdown → HTML (deterministic; identical on both sides) ──────────────
 * `marked` is the single source of truth, declared once in `client/imports.json`
 * so the server bundle (esm.sh node target) and the browser bundle land on the
 * SAME pinned version — its output is byte-for-byte identical wherever this module
 * runs, which is the hydration contract. (lit hand-rolled a minimal renderer
 * during the SSR cutover purely to guarantee that parity; the npm-for-cells path
 * now gives it for free, restoring richer markdown — tables, nested lists, etc.)
 * Options are fixed here for determinism; fenced code keeps marked's default
 * `language-<lang>` class so the client can later swap a fence for a live embed
 * (board/view/cell/json/csv/mermaid). */
marked.setOptions({ gfm: true, breaks: false });
// Fence meta-grammar (dotlit lineage): marked drops everything past the first
// word of a fence info-string, but the declaration lives there (viewer=, repl=,
// !directive, #tag, < in, > out). Preserve the FULL info-string on the <pre> as
// `data-fence` so the client can parse it. Deterministic and identical on both
// sides — the SSR/hydration parity contract is preserved.
const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
marked.use({
  renderer: {
    // marked@12 passes positional args; guard for the token-object form too.
    code(code: unknown, infostring?: string, escaped?: boolean): string {
      if (code && typeof code === 'object') {
        const tok = code as { lang?: string; escaped?: boolean; text?: string };
        infostring = tok.lang; escaped = tok.escaped; code = tok.text;
      }
      const info = (infostring || '').trim();
      const lang = info.split(/\s+/)[0] || '';
      const text = escaped ? (code as string) : escHtml(code as string);
      const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
      const meta = info ? ` data-fence="${escAttr(info)}"` : '';
      return `<pre${meta}><code${cls}>${text}\n</code></pre>\n`;
    },
  },
});
export function renderMarkdown(md: string): string {
  return marked.parse(md.replace(/\r\n/g, '\n'), { async: false }) as string;
}

/* ── document ⇄ cells (the substrate-native decomposition) ─────────────────
 * A document is authored as one markdown text; on save it decomposes into
 * cell-facts (dotlit's sections+cells, simplified): a heading opens a prose
 * cell that accretes following prose; a fenced code block is its own cell.
 * Each cell keeps its own source (incl. the fence info-string), so a cell is
 * the unit of authoring, execution, linking, and reuse — and the SAME cell-fact
 * can appear in many documents/boards via per-surface ordering decorations. */
export function splitCells(md: string): string[] {
  const toks = (marked.lexer(md || '') as Array<{ type: string; raw: string }>);
  const cells: string[] = [];
  let cur = '';
  const flush = (): void => { const s = cur.replace(/\s+$/, ''); if (s.trim()) cells.push(s); cur = ''; };
  for (const t of toks) {
    if (t.type === 'heading') { flush(); cur = t.raw; }
    else if (t.type === 'code') { flush(); const s = t.raw.replace(/\s+$/, ''); if (s.trim()) cells.push(s); }
    else cur += t.raw;
  }
  flush();
  return cells;
}

/** Fractional ordering — placing a split-off fragment or moving a cell is a
 *  single decoration write (no renumbering). Identity is inherent: you edit a
 *  known cell-fact; only `splitCells` on its own new source can mint new cells. */
export function seqBetween(a: number | null, b: number | null): number {
  if (a == null && b == null) return 1;
  if (a == null) return (b as number) - 1;
  if (b == null) return (a as number) + 1;
  return (a + b) / 2;
}

/* ── presentational components (read-only first paint) ─────────────────── */

/** A document block: its markdown body. The client re-renders the SAME element
 *  (dangerouslySetInnerHTML over the shared renderer), then enhances fences in
 *  place via an effect — so server HTML and client first render match exactly. */
export function Block({ data }: { data: BlockData }): React.JSX.Element {
  return (
    <article className="block" data-key={data.key}>
      <div className="block-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.md) }} />
    </article>
  );
}

export function ListView({ vm }: { vm: Extract<ViewModel, { kind: 'list' }> }): React.JSX.Element {
  const lead = vm.isOwner
    ? 'your documents — ordered paths through the substrate'
    : 'public documents — ordered paths through the substrate';
  return (
    <>
      <header>
        <h1>lit</h1>
        <p className="summary">{lead}</p>
      </header>
      <main className="doc-list">
        {vm.docs.length === 0 ? (
          <p className="boot">no documents yet</p>
        ) : (
          vm.docs.map((d) => (
            <a className="doc-card" href={`?doc=${encodeURIComponent(d.id)}`} key={d.id}>
              <h2>{d.title || d.id}</h2>
              {d.summary ? <p>{d.summary}</p> : null}
              <span className="doc-meta">{d.blocks} blocks · {(d.updated || '').slice(0, 10)}</span>
            </a>
          ))
        )}
      </main>
    </>
  );
}

export function DocView({ vm }: { vm: Extract<ViewModel, { kind: 'doc' }> }): React.JSX.Element {
  return (
    <>
      <header>
        <a className="back" href={`/@${vm.owner}/lit`}>← documents</a>
        <h1>{vm.title || vm.id}</h1>
        {vm.summary ? <p className="summary">{vm.summary}</p> : null}
      </header>
      <main>
        {vm.blocks.length === 0 ? (
          <p className="boot">empty document</p>
        ) : (
          vm.blocks.map((b) => <Block data={b} key={b.key} />)
        )}
      </main>
    </>
  );
}

/** The read-only surface — the exact tree the server renders and the client
 *  hydrates. Interactive chrome is added by the client after hydration. */
export function Surface({ vm }: { vm: ViewModel }): React.JSX.Element {
  return vm.kind === 'list' ? <ListView vm={vm} /> : <DocView vm={vm} />;
}
