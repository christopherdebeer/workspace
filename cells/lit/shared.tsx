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

export interface BlockRef { key: string; fold?: boolean }
export interface DocValue { title: string; summary?: string; blocks?: BlockRef[] }
/** A block resolved for render: its markdown (or a fold title) + identity. */
export interface BlockData { key: string; md: string; fold?: boolean }
export interface ListItem { id: string; title: string; summary?: string; blocks: number; updated: string }

/** The serialized first-paint state the server hands the client to hydrate. */
export type ViewModel =
  | { kind: 'list'; owner: string; isOwner: boolean; docs: ListItem[] }
  | { kind: 'doc'; owner: string; isOwner: boolean; id: string; title: string; summary?: string; blocks: BlockData[] };

/* ── markdown → HTML (deterministic; identical on both sides) ──────────────
 * Ported from the old server renderer and now the single source of truth, so a
 * block's HTML is the same byte-for-byte whether the server or the client built
 * it. Fenced code keeps its `language-<lang>` class so the client can later swap
 * a fence for a live embed (board/view/cell/json/csv/mermaid). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, h) => `<a href="${escAttr(h)}" rel="noopener">${t}</a>`);
}
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = (): void => {
    if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
  };
  const flushList = (): void => {
    if (list) { html.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush(); flushList();
      const lang = line.slice(3).trim();
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { bodyLines.push(lines[i]); i++; }
      i++;
      html.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(bodyLines.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); flushList(); const n = h[1].length; html.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flush(); (list ??= []).push(li[1]); i++; continue; }
    if (/^\s*>\s?/.test(line)) { flush(); flushList(); html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); flushList(); html.push('<hr />'); i++; continue; }
    if (!line.trim()) { flush(); flushList(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush(); flushList();
  return html.join('\n');
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
