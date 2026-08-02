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
import { bodyText, fieldsToHtml, wikiLinkExtension, parseFenceMeta } from '@parc/ui';

// The fence meta-grammar (ADR-0059) — one grammar, parsed AND serialized,
// shared by SSR, client, and tests (tests/lit-fence.test.ts pins it). It now
// lives in @parc/ui (docs/home-hosts-lit.md step 1) so home's reader classifies
// fences identically; these re-exports keep lit's own import surface stable.
export { parseFenceMeta, fenceToString, fenceTagsOf, type FenceMeta } from '@parc/ui';

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
/** dotlit's admonition directives (verified: styling_and_themes.lit §dir-*):
 *  an `md` fence carrying one renders as a colored callout, not code. */
const ADMONITIONS = ['warn', 'info', 'success', 'error', 'note', 'box'];
marked.use({
  renderer: {
    // marked@12 passes positional args; guard for the token-object form too.
    code(code: unknown, infostring?: string, escaped?: boolean): string {
      if (code && typeof code === 'object') {
        const tok = code as { lang?: string; escaped?: boolean; text?: string };
        infostring = tok.lang; escaped = tok.escaped; code = tok.text;
      }
      const info = (infostring || '').trim();
      // The FULL grammar on both sides (ADR-0059): `>lang` output cells parse
      // to their real lang, directives select admonitions — SSR and client
      // classify identically. Classification only: nothing executes here.
      const meta = parseFenceMeta(info);
      const lang = meta.lang;
      const outCls = meta.isOutput ? ' fence-output' : '';
      // A markdown fence names the markdown renderer: render its body as markdown
      // (nested), so ```md / ```markdown (and dotlit's `>md !warn` admonition
      // form) is respected on both SSR and client. A fence with a `< source`
      // is a TRANSCLUSION (ADR-0061) — it must stay a pre[data-fence] so the
      // client can resolve the reference; its body is a placeholder, not content.
      if ((lang === 'md' || lang === 'markdown') && !meta.source) {
        const dirs = meta.directives.filter((d) => ADMONITIONS.includes(d)).map((d) => ` dir-${d}`).join('');
        return `<div class="md-fence${dirs}${outCls}">${marked.parse(code as string, { async: false }) as string}</div>\n`;
      }
      const text = escaped ? (code as string) : escHtml(code as string);
      const cls = lang ? ` class="language-${escAttr(lang)}${outCls}"` : outCls ? ` class="${outCls.trim()}"` : '';
      const metaAttr = info ? ` data-fence="${escAttr(info)}"` : '';
      // Output cells (leading `>`) carry provenance chips the client can dress;
      // as plain HTML they degrade to a labelled band via CSS.
      const outAttr = meta.isOutput ? ` data-output-lang="${escAttr(lang)}"` : '';
      return `<pre${metaAttr}${outAttr}${outCls ? ` class="fence-output"` : ''}><code${cls}>${text}\n</code></pre>\n`;
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
// [[wiki-links]] — the ONE resolver lives in platform/ui/wiki-link (ADR-0044
// Inc 4); lit only chooses the anchor (an href into its own routes). SSR and
// client share the marked instance, so both render identically.
export { extractWikiTargets, resolveWikiTarget } from '@parc/ui';
marked.use({
  extensions: [wikiLinkExtension(({ key, label, fragment }) => {
    // Fragments (ADR-0061): a member key or heading text within the target.
    // Key '' = the current document ([[#frag]]) — a bare hash anchor. The
    // client soft-resolves free-text fragments against member headings.
    const frag = fragment ? `#${encodeURIComponent(fragment)}` : '';
    const href = key ? `${factRoute(key)}${frag}` : frag || '#';
    return `<a class="wikilink" data-wiki-key="${escAttr(key)}" href="${escAttr(href)}">${escHtml(label)}</a>`;
  })],
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
 * can appear in many documents/boards via per-surface ordering decorations.
 * The functions themselves live in `./blocks` (no DOM/JSX) so server-side
 * code (decompose.ts) and jest can import them without a JSX bundler;
 * re-exported here so existing `from '../shared'` imports (main.tsx) don't
 * need to change. */
export { splitCells, seqBetween } from './blocks';

/* ── presentational components (read-only first paint) ─────────────────── */

/** A document block: its markdown body. The client re-renders the SAME element
 *  (dangerouslySetInnerHTML over the shared renderer), then enhances fences in
 *  place via an effect — so server HTML and client first render match exactly. */
export function Block({ data }: { data: BlockData }): React.JSX.Element {
  // ADR-0060: an `out:<src>:<ts>` member is an ATTACHED output — its key
  // encodes provenance. Rendered identically on both halves (parity contract);
  // the client's editor view adds scroll-to-source on top.
  const k = data.key;
  const outSrc = k.startsWith('out:') && k.lastIndexOf(':') > 4 ? k.slice(4, k.lastIndexOf(':')) : null;
  return (
    <article className={`block${outSrc ? ' block-output' : ''}`} data-key={data.key} id={data.key}>
      {outSrc ? (
        <div className="block-out-prov">⤷ output of <a href={factRoute(outSrc)}>{outSrc}</a></div>
      ) : null}
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
