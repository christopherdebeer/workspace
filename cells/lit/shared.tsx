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
import { bodyText, fieldsToHtml } from '@parc/ui';

/** A document is a *view* over facts: thin metadata only. Membership + order live
 *  entirely in substrate-native `_doc/<id>/<factKey>={seq,fold}` decorations — any
 *  fact key (a doc-block, a canvas `el:`, a `cell:`) can be a member. (The legacy
 *  inline `blocks`/`cells` array was migrated out and removed.) `projection` is the
 *  default lens. */
export interface DocValue {
  title: string;
  summary?: string;
  projection?: 'narrative' | 'salience';
}
/** A block resolved for render: its markdown (or a fold title) + identity. */
export interface BlockData { key: string; md: string; fold?: boolean }
export interface ListItem { id: string; title: string; summary?: string; blocks: number; updated: string; score?: number }
/** A neighbour edge, resolved to a human label for display (its title/name/key). */
export interface LinkRef { key: string; label: string; rel: string; type?: string | null }
/** One member of a `type:<type>` collection — a generic-key sibling of `ListItem`
 *  (no `doc:` prefix assumed, no block count: a collection spans every type). */
export interface TypeItem { key: string; title: string; summary?: string; updated: string; score?: number }

/** The serialized first-paint state the server hands the client to hydrate. */
export type ViewModel =
  | { kind: 'list'; owner: string; isOwner: boolean; docs: ListItem[] }
  | { kind: 'doc'; owner: string; isOwner: boolean; id: string; title: string; summary?: string; blocks: BlockData[] }
  // The substrate-native generic reader (ADR-0040 wiki): ANY fact, not just a
  // lit-authored `doc:` — read-only here (editing a foreign type stays in its
  // own managing cell / the field computer); shown via the hint floor
  // (render-hints.ts) with both directions of links, symmetric.
  | { kind: 'fact'; owner: string; isOwner: boolean; key: string; type?: string | null; title: string; bodyHtml: string; fieldsHtml: string; backlinks: LinkRef[]; links: LinkRef[] }
  // `type:<type>` — a hub view: every fact of one type, a jumping-off point a
  // `[[type:project|Projects]]` wiki-link can target (see the welcome doc).
  | { kind: 'type'; owner: string; isOwner: boolean; type: string; items: TypeItem[] };

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
      // A markdown fence names the markdown renderer: render its body as markdown
      // (nested), so ```md / ```markdown is respected on both SSR and client.
      if (lang === 'md' || lang === 'markdown') {
        return `<div class="md-fence">${marked.parse(code as string, { async: false }) as string}</div>\n`;
      }
      const text = escaped ? (code as string) : escHtml(code as string);
      const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
      const meta = info ? ` data-fence="${escAttr(info)}"` : '';
      return `<pre${meta}><code${cls}>${text}\n</code></pre>\n`;
    },
  },
});
/** A fact key as a URL PATH (ADR-0040 wiki: the URL *is* the key, the stable
 *  shareable address) — `/` and `:` are the substrate's own key separators
 *  (`reading/foo`, `doc:foo`, `log:2026-06-30`) and stay literal; everything
 *  else is percent-encoded. Inverse of decoding a `/r/<key>` route param. */
export function encodeKeyPath(key: string): string {
  return encodeURIComponent(key).replace(/%2F/g, '/').replace(/%3A/g, ':');
}

/** The path-based route for a fact key — `/r/<key>`, lit's one generic reader
 *  route (doc/log/any-other-type all resolve through it; see `client/main.tsx`
 *  `Route()` and `index.ts`'s SSR handler) — a stable, shareable address: the
 *  URL IS the key. Deliberately a BARE absolute path, no `/@owner/lit` prefix:
 *  a tier-2 cell like lit is reached ONLY on its own subdomain
 *  (`<owner>-lit.on.parc.land`) — see `cells/home/index.ts`'s
 *  `installServerBridge` comment ("no user cells on the apex") — so a
 *  same-cell link just needs to be absolute from THIS domain's root. */
export const factRoute = (key: string): string => `/r/${encodeKeyPath(key)}`;

// [[wiki-links]] — a link is a first-class substrate edge, not a bolted-on index.
// `[[target]]` / `[[target|label]]`: a bare target resolves to `doc:<slug>`, an
// explicit key (`doc:x`, `reading/y`) is used as-is. The inline extension runs in
// the shared marked instance, so SSR and client render identically.
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** A target with no spaces and a `:`/`/` separator (or the substrate's own
 *  `$`-reserved-name convention, e.g. `$docs`) IS a real key/route — used as-is,
 *  addressing any fact or pseudo-view directly. Anything else (plain prose,
 *  possibly containing a literal `/`) is a doc title and gets slugified. */
const looksLikeKey = (s: string): boolean => !/\s/.test(s) && (s.includes(':') || s.includes('/') || s.startsWith('$'));
export function resolveWikiTarget(raw: string): { key: string; href: string; label: string } {
  const [t, l] = raw.split('|');
  const target = (t || '').trim();
  const key = looksLikeKey(target) ? target : `doc:${slug(target)}`;
  return { key, href: factRoute(key), label: (l ?? target).trim() || target };
}
/** Resolved fact-keys a cell links to — used to sync edges on save. */
export function extractWikiTargets(md: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g; let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.add(resolveWikiTarget(m[1]).key);
  return [...out];
}
marked.use({
  extensions: [{
    name: 'wikilink',
    level: 'inline',
    start(src: string) { return src.indexOf('[['); },
    tokenizer(src: string) {
      const m = /^\[\[([^\]]+)\]\]/.exec(src);
      return m ? { type: 'wikilink', raw: m[0], text: m[1] } : undefined;
    },
    renderer(tok: { text: string }) {
      const { href, label } = resolveWikiTarget(tok.text);
      return `<a class="wikilink" href="${escAttr(href)}">${escHtml(label)}</a>`;
    },
  }],
} as Parameters<typeof marked.use>[0]);

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

/** One row in the doc list — title prominent, an optional summary, and a
 *  TERTIARY meta line (updated date, salience score once loaded, block count)
 *  kept small/faint. A list, not a card grid: chrome should stay out of the
 *  way of scanning many docs at once. Shared by `ListView` (SSR) and
 *  `ListEditor` (the client's interactive version) so the two never drift. */
export function DocRow({ d }: { d: ListItem }): React.JSX.Element {
  const meta = [
    (d.updated || '').slice(0, 10),
    d.score != null ? `salience ${d.score.toFixed(2)}` : null,
    `${d.blocks} block${d.blocks === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
  return (
    <a className="doc-row" href={factRoute(`doc:${d.id}`)}>
      <span className="doc-row-title">{d.title || d.id}</span>
      {d.summary ? <span className="doc-row-summary">{d.summary}</span> : null}
      <span className="doc-row-meta">{meta}</span>
    </a>
  );
}

export function ListView({ vm }: { vm: Extract<ViewModel, { kind: 'list' }> }): React.JSX.Element {
  const lead = vm.isOwner
    ? 'your documents — ordered paths through the substrate'
    : 'public documents — ordered paths through the substrate';
  return (
    <>
      <header>
        <a className="back" href="/">← home</a>
        <h1>lit</h1>
        <p className="summary">{lead}</p>
      </header>
      <main className="doc-list">
        {vm.docs.length === 0 ? (
          <p className="boot">no documents yet</p>
        ) : (
          vm.docs.map((d) => <DocRow d={d} key={d.id} />)
        )}
      </main>
    </>
  );
}

/** One row in a `type:<type>` collection — `DocRow`'s sibling for a generic
 *  key (no `doc:` prefix assumed, no block count). */
export function FactRow({ d }: { d: TypeItem }): React.JSX.Element {
  const meta = [(d.updated || '').slice(0, 10), d.score != null ? `salience ${d.score.toFixed(2)}` : null].filter(Boolean).join(' · ');
  return (
    <a className="doc-row" href={factRoute(d.key)}>
      <span className="doc-row-title">{d.title}</span>
      {d.summary ? <span className="doc-row-summary">{d.summary}</span> : null}
      <span className="doc-row-meta">{meta}</span>
    </a>
  );
}

/** The `type:<type>` hub view — every fact of one kind, a wiki-link target
 *  (`[[type:project|Projects]]`) for the welcome doc to point at. */
export function TypeView({ vm }: { vm: Extract<ViewModel, { kind: 'type' }> }): React.JSX.Element {
  return (
    <>
      <header>
        <a className="back" href="/">← home</a>
        <h1>{vm.type}</h1>
        <p className="summary">{vm.items.length} {vm.type} fact{vm.items.length === 1 ? '' : 's'}</p>
      </header>
      <main className="doc-list">
        {vm.items.length === 0 ? <p className="boot">no {vm.type} facts yet</p> : vm.items.map((d) => <FactRow d={d} key={d.key} />)}
      </main>
    </>
  );
}

export function DocView({ vm }: { vm: Extract<ViewModel, { kind: 'doc' }> }): React.JSX.Element {
  return (
    <>
      <header>
        <a className="back" href="/">← documents</a>
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

/** `LinkRef[]` → a `<ul>` of `[[wiki-style]]` anchors, the same shape for both
 *  directions (a fact "links to" its outbound edges; is "linked from" its
 *  inbound ones) — symmetry is the point (ADR-0040: a reader for the WHOLE
 *  substrate, not just lit-authored docs). */
function LinkList({ refs }: { refs: LinkRef[] }): React.JSX.Element | null {
  if (!refs.length) return null;
  return (
    <ul>
      {refs.map((r) => (
        <li key={r.key}>
          <a className="wikilink" href={factRoute(r.key)}>[[{r.label}]]</a>
          {r.rel && r.rel !== 'related' ? <span className="rel"> · {r.rel}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The substrate-native generic reader (ADR-0040): any fact, rendered through
 *  the SAME hint floor every other surface shares (`render-hints.ts`), with
 *  both link directions shown — the part that was doc-only before. */
export function FactView({ vm }: { vm: Extract<ViewModel, { kind: 'fact' }> }): React.JSX.Element {
  return (
    <>
      <header>
        <a className="back" href="/">← documents</a>
        <h1>{vm.title}</h1>
        <p className="summary fact-meta">{[vm.type, vm.key].filter(Boolean).join(' · ')}</p>
      </header>
      <main>
        {vm.bodyHtml ? (
          <article className="block"><div className="block-body" dangerouslySetInnerHTML={{ __html: vm.bodyHtml }} /></article>
        ) : vm.fieldsHtml ? (
          <article className="block"><div className="block-body" dangerouslySetInnerHTML={{ __html: vm.fieldsHtml }} /></article>
        ) : (
          <p className="boot">(no readable content for this fact)</p>
        )}
        {vm.links.length ? (
          <section className="backlinks">
            <h3>Links to</h3>
            <LinkList refs={vm.links} />
          </section>
        ) : null}
        {vm.backlinks.length ? (
          <section className="backlinks">
            <h3>Linked from</h3>
            <LinkList refs={vm.backlinks} />
          </section>
        ) : null}
      </main>
    </>
  );
}

/** The read-only surface — the exact tree the server renders and the client
 *  hydrates. Interactive chrome is added by the client after hydration. */
export function Surface({ vm }: { vm: ViewModel }): React.JSX.Element {
  if (vm.kind === 'list') return <ListView vm={vm} />;
  if (vm.kind === 'fact') return <FactView vm={vm} />;
  if (vm.kind === 'type') return <TypeView vm={vm} />;
  return <DocView vm={vm} />;
}
