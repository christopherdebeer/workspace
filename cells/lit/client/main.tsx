/* ---------------------------------------------------------------------------
 * lit — the narrative surface (docs/narrative-surface.md), now isomorphic.
 *
 * The server renders the read-only tree (cells/lit/shared.tsx) to a string; this
 * client hydrates that SAME tree (hydrateRoot) instead of rebuilding it — so the
 * authed first paint stays put with no flash. After hydration it progressively
 * enhances: fences become live embeds, and the owner gets the editing surface.
 *
 * A document is an ordered path through the SAME facts the canvas places:
 *   doc:<id>            — { title, summary? } — thin metadata; a doc is a view
 *   _doc/<id>/<factKey> — { seq, fold? } — membership + order (any fact key)
 *   blocks are plain facts; removal from a doc never deletes the fact.
 * Editing is ephemera until saved; saves go through workspace.remember via:'lit'.
 * ------------------------------------------------------------------------- */
import './main.css';
(window as any).__lit_module = true; // watchdog marker: the module executed
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { ensureAuth, isAuthed, authFetch } from './lib/auth.ts';
import { loadTypes, cellAddress, cellUrl } from 'https://parc.land/@c15r/kernel/app.js';
import { read, act } from './lib/substrate.ts';
import { outbox } from './lib/outbox.ts';
import { mountSandboxedRenderer, SANDBOX_HOST_HTML, bodyText, fieldsToHtml } from '@parc/ui';
import {
  Surface, FactView, DocRow, TypeView, renderMarkdown, splitCells, seqBetween, extractWikiTargets, factRoute,
  parseFenceMeta, fenceTagsOf, type FenceMeta,
  type ViewModel, type BlockData, type DocValue, type LinkRef, type ListItem, type TypeItem,
} from '../shared';

const { useState, useEffect, useRef, useCallback } = React;

interface Meta { type?: string | null; tags?: string[]; updatedAt?: string; superseded?: boolean }
interface Entry { key: string; value: any; _meta?: Meta }

const appRoot = document.getElementById('app')!;
const cellOwner = (): string => (cellAddress() as { owner?: string } | null)?.owner ?? 'c15r';
let typeDecls: Record<string, { viewer?: string }> = {};

// The shared @c15r/viewers `repl` view reaches the run organ (@c15r/run.exec /
// .fetch) and persists outputs through these globals — reference, not copy, the
// same seam canvas uses. Set once so a ```run/js/repl fence in a doc is live.
(window as any).__parcAct = act;
(window as any).__parcRead = read;

/* ── substrate helpers ─────────────────────────────────────────────────── */

async function fetchFact(key: string): Promise<Entry | null> {
  const res = await read<{ entries: Entry[] }>('workspace.query', { prefix: key, limit: 8 });
  return (res.entries ?? []).find((e) => e.key === key) ?? null;
}

/* ── red links: entities waiting to exist (ADR-0061 §1b) ─────────────────
 * A wiki edge to a nonexistent key is a dangling edge — visible to attention,
 * and here to the reader: stub styling + tap-to-create. Existence checks are
 * cached per session; a network failure counts as existing (no false stubs). */
const factExistsCache = new Map<string, Promise<boolean>>();
function factExists(key: string): Promise<boolean> {
  let p = factExistsCache.get(key);
  if (!p) { p = fetchFact(key).then((f) => !!f).catch(() => true); factExistsCache.set(key, p); }
  return p;
}
/** Mint a doc for a red link — seeded with its title and a provenance line
 *  naming where it was wanted (the mention IS the first content). */
async function createDocFromKey(key: string, title: string, wantedBy?: string): Promise<void> {
  const slug = key.slice(4);
  await saveDocMeta(slug, { title });
  const k = mintCell();
  await saveCell(slug, k, `# ${title}\n${wantedBy ? `\n_wanted by [[${wantedBy}]]_\n` : ''}`);
  await writeOrder(slug, k, 1, false);
  await outbox.flushNow(); // navigation follows — the debounce must not eat the mint
  factExistsCache.delete(key);
  location.href = factRoute(key);
}
async function markRedLinks(root: HTMLElement): Promise<void> {
  if (!isAuthed()) return;
  const anchors = [...root.querySelectorAll('a.wikilink[data-wiki-key]')] as HTMLAnchorElement[];
  await Promise.all(anchors.slice(0, 30).map(async (a) => {
    const key = a.dataset.wikiKey || '';
    if (!key || a.classList.contains('wikilink-stub')) return;
    if (await factExists(key)) return;
    a.classList.add('wikilink-stub');
    a.title = 'waiting to exist — tap to create';
    if (!key.startsWith('doc:')) return; // non-doc keys: the stub styling alone
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const title = (a.textContent || key.slice(4)).trim();
      if (!confirm(`Create "${title}"?`)) return;
      const here = location.pathname.startsWith('/r/') ? decodeURIComponent(location.pathname.slice(3)) : '';
      void createDocFromKey(key, title, here || undefined);
    });
  }));
}
function contentOf(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value.content === 'string') return value.content;
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}
/** A fact's id: the part after a `prefix:` or `prefix/` in its key — mirrors
 *  `index.ts`'s server-side `deriveId` (kept duplicated, not imported: this
 *  module has no DOM-free server counterpart to share it with). */
function deriveId(key: string): string {
  const ci = key.indexOf(':'); const si = key.indexOf('/');
  const i = ci >= 0 && (si < 0 || ci < si) ? ci : si;
  return i >= 0 ? key.slice(i + 1) : key;
}
const mintCell = (): string => `cell:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type LoadedCell = { key: string; content: string; fold: boolean; seq: number; score: number };

/** A document is a *view*: load its cell-facts via substrate-native ordering
 *  decorations (`_doc/<id>/<key>` = {seq, fold}) — membership is any fact key the
 *  decorations point at. `projection` re-sorts the SAME membership — narrative by
 *  seq, salience by the cell's score. */
async function loadDoc(docId: string, projection: 'narrative' | 'salience'): Promise<{ meta: DocValue; cells: LoadedCell[]; backlinks: LinkRef[] } | null> {
  const docFact = await fetchFact(`doc:${docId}`);
  if (!docFact) return null;
  const meta = docFact.value as DocValue;
  // Membership + order + content + presentation in ONE read (workspace.members,
  // ADR-0005/0014 row 2): each extensional member carries its placing decoration's
  // {seq, fold}, so lit no longer re-scans `_doc/<id>/` + fetches each fact itself.
  const res = await read<{ members: Array<{ key: string; value: unknown; _meta?: { score?: number }; placement?: { seq?: number; fold?: boolean } }> }>(
    'workspace.members',
    { key: `doc:${docId}` },
  );
  const cells: LoadedCell[] = (res.members ?? []).map((m) => ({
    key: m.key,
    fold: !!m.placement?.fold,
    seq: Number(m.placement?.seq ?? 0),
    content: contentOf(m.value),
    score: Number(m._meta?.score) || 0,
  }));
  // members returns narrative (seq) order; the salience projection re-sorts by score.
  cells.sort((a, b) => (projection === 'salience' ? b.score - a.score : a.seq - b.seq));
  // Backlinks: every inbound edge to this doc, by WHATEVER fact authored it —
  // not just another doc (ADR-0040: lit reads the whole substrate, not only
  // its own `doc:` namespace). Collapsed to distinct sources.
  const backlinks: LinkRef[] = [];
  try {
    const nb = await read<{ inbound: Array<{ from: string; rel: string }>; entries: Record<string, Entry> }>('workspace.neighbors', { key: `doc:${docId}` });
    const seen = new Set<string>();
    for (const e of nb.inbound ?? []) {
      if (e.from === `doc:${docId}` || seen.has(e.from)) continue;
      seen.add(e.from);
      const ent = nb.entries?.[e.from];
      const ev = ent?.value as Record<string, unknown> | undefined;
      const label = (typeof ev?.title === 'string' && ev.title) || (typeof ev?.name === 'string' && ev.name) || deriveId(e.from);
      backlinks.push({ key: e.from, rel: e.rel, label: label as string, type: ent?._meta?.type ?? null });
    }
  } catch { /* best-effort */ }
  return { meta, cells, backlinks };
}
async function saveCell(docId: string, key: string, content: string): Promise<void> {
  // ADR-0059: the declared vocabulary wins — prose is `doc-block` (types.json;
  // 'cell' was the code drifting, and collides with deployable cells). Fence
  // `#tags` reconcile into the fact's tags on every save: the fence line is
  // the declaration, the substrate indexes what the text declares. The write
  // rides the kernel outbox (Inc 2) — dedupe, retry, echo window for live-sync.
  const tags = [`doc:${docId}`, ...fenceTagsOf(content)];
  outbox.stage(key, { content }, { type: 'doc-block', tags });
  await syncCellLinks(key, content);
}
/** Reconcile a cell's [[wiki-links]] into substrate edges (rel `related`): link
 *  newly-referenced targets, unlink ones the edit removed. Best-effort. */
async function syncCellLinks(cellKey: string, content: string): Promise<void> {
  try {
    const want = new Set(extractWikiTargets(content));
    const nb = await read<{ outbound: Array<{ to: string; rel: string }> }>('workspace.neighbors', { key: cellKey });
    const have = (nb.outbound ?? []).filter((e) => e.rel === 'related');
    const haveSet = new Set(have.map((e) => e.to));
    await Promise.all([
      ...[...want].filter((t) => !haveSet.has(t)).map((to) => act('workspace.link', { from: cellKey, to, rel: 'related' })),
      ...have.filter((e) => !want.has(e.to)).map((e) => act('workspace.unlink', { from: cellKey, to: e.to, rel: 'related' })),
    ]);
  } catch { /* links are best-effort, never block the save */ }
}
async function writeOrder(docId: string, key: string, seq: number, fold: boolean): Promise<void> {
  outbox.stage(`_doc/${docId}/${key}`, { seq, fold }, { type: 'doc-order', tags: [`doc:${docId}`] });
}
async function saveDocMeta(docId: string, meta: DocValue): Promise<void> {
  outbox.stage(`doc:${docId}`, meta as unknown as Record<string, unknown>, { type: 'doc', tags: ['doc'] });
}
/** Save an edited cell, splitting only if the edit introduced structure (a
 *  heading or a code fence): the first part keeps the fact's key (links/seq),
 *  the rest become new facts placed with fractional seq between this cell and
 *  the next — identity is inherent, never a whole-document reparse. */
async function saveCellSplit(docId: string, cell: LoadedCell, nextSeq: number | null, source: string): Promise<LoadedCell[]> {
  const parts = splitCells(source);
  if (parts.length <= 1) { const content = (parts[0] ?? source).trim(); await saveCell(docId, cell.key, content); return [{ ...cell, content }]; }
  await saveCell(docId, cell.key, parts[0]);
  const out: LoadedCell[] = [{ ...cell, content: parts[0] }];
  let lo = cell.seq;
  for (const part of parts.slice(1)) {
    const seq = seqBetween(lo, nextSeq);
    const k = mintCell();
    await saveCell(docId, k, part);
    await writeOrder(docId, k, seq, false);
    out.push({ key: k, content: part, fold: false, seq, score: 0 });
    lo = seq;
  }
  return out;
}
/** ADR-0059 Inc 3 (a scoped-feed consumer, ADR-0055): tail ONLY this doc's
 *  slice — its order decorations, its doc fact, and its current member keys
 *  (exact keys are valid prefixes) — state-changing ops only. An idle doc's
 *  tick is an empty page; our own flushes are echo-skipped via the outbox.
 *  Remote changes (an agent appending cells, a run landing) trigger a reload. */
function startDocLiveSync(docId: string, keysOf: () => string[], onRemote: () => void): () => void {
  let stopped = false;
  let cursor = 0;
  let lastActivity = Date.now();
  const bump = (): void => { lastActivity = Date.now(); };
  window.addEventListener('pointerdown', bump, { passive: true });
  window.addEventListener('keydown', bump, { passive: true });
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (!document.hidden && isAuthed()) {
      try {
        if (cursor === 0) {
          cursor = (await read<{ seq: number }>('workspace.changes', { sinceSeq: 'head' })).seq;
        } else {
          const res = await read<{ events: Array<{ op: string; key: string | null }>; seq: number }>('workspace.changes', {
            sinceSeq: cursor,
            scope: { prefixes: [`_doc/${docId}/`, `doc:${docId}`, ...keysOf()], ops: ['write', 'supersede'] },
          });
          cursor = res.seq;
          if ((res.events ?? []).some((ev) => ev.key && !outbox.wroteRecently(ev.key))) onRemote();
        }
      } catch { /* offline — retry next tick */ }
    }
    if (!stopped) setTimeout(() => void tick(), Date.now() - lastActivity < 120_000 ? 8_000 : 40_000);
  };
  setTimeout(() => void tick(), 8_000);
  return () => {
    stopped = true;
    window.removeEventListener('pointerdown', bump);
    window.removeEventListener('keydown', bump);
  };
}

/** The renderer ladder: a fact whose type declares a viewer renders through
 *  @c15r/viewers instead of as markdown (el:demo-json reads as a TREE here). */
function viewerFor(meta: Meta | undefined, value: any): string | null {
  for (const t of [meta?.type, value?.type].filter(Boolean) as string[]) {
    if (typeDecls[t]?.viewer) return typeDecls[t]!.viewer!;
  }
  return null;
}

/* ── plugins-as-content: author-defined viewers (dotlit lineage) ───────────
 * `_renderers/<type>` facts whose JS `source` mounts an ElementView — the SAME
 * contract canvas loads (one ecology: a viewer authored in a lit `!plugin` block
 * works on the board too). The source is executed via a data-URI module import
 * — author code runs in the reader's page, so rendered output carries an
 * attribution chip (the renderer fact's writer); this is the consent/disclosure
 * surface for the plugins-as-content trust posture. */
const litRenderers: Record<string, { view: any; writer?: string }> = {};
async function loadRenderers(): Promise<void> {
  try {
    const res = await read<{ entries: Array<{ key: string; value: any; _meta?: { writer?: string } }> }>('workspace.query', { prefix: '_renderers/', limit: 100 });
    for (const e of res.entries ?? []) {
      const def = e.value as { type?: string; source?: string };
      if (!def?.type || !def?.source) continue;
      try {
        const b64 = btoa(unescape(encodeURIComponent(def.source)));
        const mod: any = await import(/* @vite-ignore */ `data:text/javascript;base64,${b64}`);
        let view = mod.view ?? mod.default ?? (mod.mount ? { mount: mod.mount, update: mod.update, unmount: mod.unmount } : null);
        // dotlit-style `viewer({content, host, React})` is wrapped into an ElementView.
        if (!view && typeof mod.viewer === 'function') {
          view = {
            mount: (elx: any): HTMLElement => {
              const host = el('div', 'content');
              const r = mod.viewer({ content: elx.content, host, React });
              if (typeof r === 'string') host.innerHTML = r;
              else if (r instanceof Node) host.appendChild(r);
              return host;
            },
            update: () => {},
          };
        }
        if (view?.mount) litRenderers[def.type] = { view, writer: e._meta?.writer };
      } catch (err) { console.warn('[lit renderers] failed', e.key, err); }
    }
  } catch { /* offline or none declared */ }
}

/* ── fence enhancement (the transclusion ladder, post-hydration) ───────────
 * Runs imperatively over a block body the server rendered as markdown: a
 * ```board / view / cell / json / csv / mermaid``` fence becomes a live embed.
 * view/cell read the substrate, so they stay as code for an anonymous reader. */
function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
interface Fence extends Omit<FenceMeta, 'directives'> {
  /** Set view over the meta's directive list, for ergonomic `.has()` checks. */
  directives: Set<string>;
  /** The bare file/uri token, else the fence body — so both `view open-claims`
   *  (id in the info-string) and the legacy `view\nopen-claims` (id in the
   *  body) work. */
  arg: string;
}
/** The FULL dotlit grammar (ADR-0059) via the shared module — leading `>`
 *  output cells, recursive `< source` / `> output` metas, filename/uri,
 *  escaped spaces, unknowns; `fenceToString` round-trips. The metadata is
 *  what turns a fence into a declaration — the seam to plugins/viewers/actions. */
function parseFence(info: string, body: string): Fence {
  const m = parseFenceMeta(info);
  return { ...m, directives: new Set(m.directives), arg: m.file ?? body };
}

/** Resolve a `ui://` renderer script over the authenticated `/mcp`
 *  `resources/read` (the gateway provider hop, ADR-0039). The returned text is
 *  NEVER executed in lit's own document — it may be another tenant's cell code;
 *  it runs only inside the opaque-origin sandbox the board fence builds
 *  (ADR-0041's security correction / ADR-0043). */
async function mcpResourceRead(uri: string): Promise<string | null> {
  try {
    const res = await authFetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'resources/read', params: { uri } }),
    });
    if (!res.ok) return null;
    const rpc = (await res.json()) as { result?: { contents?: Array<{ text?: string }> } };
    const text = rpc.result?.contents?.[0]?.text;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

async function enhanceFences(root: HTMLElement, ctx?: { onAgentOutput?: (srcKey: string, text: string, factKey?: string) => void | Promise<void>; placeOutput?: (srcKey: string, cellKey: string, content?: string) => void | Promise<void> }): Promise<void> {
  // Iterate <pre data-fence> (set by the shared renderer) so the full meta-grammar
  // — not just the first-word lang — drives routing.
  void markRedLinks(root); // ADR-0061 §1b — stubs style in as checks resolve
  for (const pre of Array.from(root.querySelectorAll('pre[data-fence]')) as HTMLElement[]) {
    const body = (pre.querySelector('code')?.textContent || '').trim();
    const fence = parseFence(pre.dataset.fence || '', body);
    const lang = fence.lang;
    if (!lang) continue;
    const arg = fence.arg;
    // 0. derived cells (ADR-0061): `>toc` renders the doc's own structure,
    // `>search` is a live query — the query IS the content, results are
    // ephemeral render. Both replace the fence like other embeds.
    if (fence.isOutput && lang === 'toc') {
      const nav = el('nav', 'toc');
      nav.appendChild(el('div', 'vw-attrib', 'contents'));
      const seen = new Set<HTMLElement>();
      for (const h of Array.from(document.querySelectorAll('.block-body h1, .block-body h2, .block-body h3')) as HTMLElement[]) {
        if (seen.has(h) || nav.contains(h)) continue;
        seen.add(h);
        const blockKey = (h.closest('[data-key]') as HTMLElement | null)?.dataset.key;
        if (!blockKey) continue;
        const a = document.createElement('a');
        a.href = `#${blockKey}`;
        a.className = `toc-${h.tagName.toLowerCase()}`;
        a.textContent = (h.textContent || '').trim();
        a.onclick = (e) => { e.preventDefault(); h.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        nav.appendChild(a);
      }
      pre.replaceWith(nav);
      continue;
    }
    if (fence.isOutput && lang === 'search') {
      const terms = [fence.file, ...fence.unknowns].filter(Boolean).join(' ') || body;
      const box = el('div', 'embed-search');
      box.appendChild(el('div', 'vw-attrib', `🔍 ${terms}${fence.attrs.type ? ` type:${fence.attrs.type}` : ''}${fence.attrs.tag ? ` tag:${fence.attrs.tag}` : ''}`));
      pre.replaceWith(box);
      if (!isAuthed()) continue;
      const q: Record<string, unknown> = { limit: Number(fence.attrs.limit) || 8 };
      if (terms) q.text = terms;
      if (fence.attrs.type) q.type = fence.attrs.type;
      if (fence.attrs.tag) q.tag = fence.attrs.tag;
      read<{ entries: Entry[]; total?: number }>('workspace.query', q)
        .then((r) => {
          for (const e of r.entries ?? []) {
            const row = el('div', 'search-hit');
            const a = document.createElement('a');
            a.href = factRoute(e.key);
            const v = e.value as Record<string, unknown> | undefined;
            a.textContent = (typeof v?.title === 'string' && v.title) || e.key;
            row.appendChild(a);
            if (e._meta?.type) row.appendChild(el('span', 'search-type', ` ${e._meta.type}`));
            box.appendChild(row);
          }
          if (r.total !== undefined) box.appendChild(el('div', 'vw-attrib', `${r.total} total`));
        })
        .catch((err) => box.appendChild(el('div', 'vw-attrib', `search failed: ${(err as Error).message}`)));
      continue;
    }
    // 0c. transclusion by reference (ADR-0061): `< factKey` renders THAT
    // fact's content in place — no copy exists to drift (dotlit's defining
    // bug class, structurally gone); editing routes to the source. Remote
    // uris stay windows (click-to-load, not persisted) — a later increment.
    const srcRef = fence.source?.filename;
    if (srcRef && /[:/]/.test(srcRef) && !/^https?:|^\/\//.test(srcRef)) {
      if (!isAuthed()) continue; // readers see the fence as-is
      const box = el('div', 'embed-transclude');
      pre.replaceWith(box);
      fetchFact(srcRef)
        .then((f) => {
          if (!f) {
            const a = document.createElement('a');
            a.className = 'wikilink wikilink-stub'; a.href = factRoute(srcRef); a.textContent = srcRef;
            box.appendChild(el('span', 'vw-attrib', '⟨ source missing: ')); box.appendChild(a);
            return;
          }
          const bodyDiv = el('div', 'transclude-body');
          bodyDiv.innerHTML = renderMarkdown(contentOf(f.value));
          box.appendChild(bodyDiv);
          const chip = el('div', 'vw-attrib');
          const a = document.createElement('a');
          a.href = factRoute(srcRef);
          a.textContent = `↳ ${srcRef} · rev ${(f._meta as { revision?: number } | undefined)?.revision ?? '?'}`;
          chip.appendChild(a);
          box.appendChild(chip);
          void enhanceFences(bodyDiv); // nested viewers render; outputs don't place (no ctx)
        })
        .catch((err) => { box.textContent = `transclude failed: ${(err as Error).message}`; });
      continue;
    }
    // 0a. plugin declaration: `js !plugin type=viewer of=foo` — the block's body
    // IS the viewer source. The owner registers it as a `_renderers/foo` fact
    // (available everywhere, canvas included); checked before the executable
    // branch so a plugin def is not run as a plain js cell.
    if (fence.directives.has('plugin') && fence.attrs.type === 'viewer' && fence.attrs.of) {
      const of = fence.attrs.of;
      const panel = el('div', 'plugin-panel');
      panel.appendChild(el('div', 'plugin-head', `⚙ viewer plugin · ${of}`));
      const src = el('pre', 'plugin-src'); src.textContent = body; panel.appendChild(src);
      if (isAuthed()) {
        const reg = el('button', 'btn', litRenderers[of] ? `update viewer “${of}”` : `register viewer “${of}”`) as HTMLButtonElement;
        reg.onclick = async () => {
          reg.textContent = '…';
          try {
            await act('workspace.remember', { key: `_renderers/${of}`, value: { type: of, source: body, kind: 'viewer' }, via: 'lit-plugin', type: 'renderer', tags: ['renderer'] });
            await loadRenderers();
            reg.textContent = `✓ registered ${of}`;
          } catch (err) { reg.textContent = `failed: ${(err as Error).message}`; }
        };
        panel.appendChild(reg);
      }
      pre.replaceWith(panel);
      continue;
    }
    // 0b. author-defined viewer (a registered `_renderers/<type>`), incl. via
    // `viewer=`. Author JS executes here; output carries an attribution chip.
    const customType = fence.attrs.viewer || lang;
    if (litRenderers[customType]) {
      const box = el('div', 'embed-custom'); pre.replaceWith(box);
      try {
        const { view, writer } = litRenderers[customType];
        box.appendChild(view.mount({ id: `litvw-${Date.now().toString(36)}`, content: body }));
        box.appendChild(el('div', 'vw-attrib', `⚙ ${customType}${writer && writer !== cellOwner() ? ` · by ${writer}` : ''}`));
      } catch (err) { box.textContent = `viewer ${customType}: ${(err as Error).message}`; }
      continue;
    }
    // 1. pure viewers (json/csv/mermaid/style) + any explicit `viewer=` — safe for anyone.
    const pureLang = fence.attrs.viewer || lang;
    if (['json', 'csv', 'mermaid', 'style'].includes(pureLang)) {
      const box = el('div', 'embed-view'); box.textContent = '…'; pre.replaceWith(box);
      import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js')
        .then((v) => v.renderFence(box, pureLang, body))
        .catch((err) => { box.textContent = `${pureLang}: ${(err as Error).message}`; });
      continue;
    }
    // 2. executable cells — dotlit's cornerstone on the substrate.
    //   run            → server execution via @c15r/run (outputs→facts)
    //   js | repl      → client execution, server-toggle available
    //   repl=server|run, !server → force the server organ
    // Reuses the @c15r/viewers `repl` view (the one canvas mounts) — one
    // validated implementation, not a copy. Anonymous readers just see the code.
    // An OUTPUT cell (`>lang …`) is something a run PRODUCED — it renders
    // (viewers above catch `>json`/`>csv`…) but must never re-execute, even
    // when its meta names a repl (provenance attrs ride the output fence).
    if (fence.isOutput) continue;
    if (['run', 'js', 'repl'].includes(lang) || fence.attrs.repl) {
      if (!isAuthed()) continue;
      const factKey = (pre.closest('[data-key]') as HTMLElement | null)?.dataset.key;
      const server = lang === 'run' || fence.directives.has('server') || ['server', 'run'].includes(fence.attrs.repl || '');
      const box = el('div', 'embed-repl'); box.textContent = '…'; pre.replaceWith(box);
      import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js')
        .then((v: any) => {
          const node = v.repl.mount({
            id: `litrepl-${factKey ?? Date.now().toString(36)}`,
            content: body,
            lang: 'js',
            server,
            _factKey: factKey,
            // ADR-0060: a fence-declared `> lang [key]` output target persists
            // every completed run as a fact (superseding the previous output
            // unless `!keep`); an explicit key (contains :/), writes THAT fact.
            autoPersist: fence.output ? {
              key: fence.output.file && /[:/]/.test(fence.output.file) ? fence.output.file : undefined,
              lang: fence.output.lang || undefined,
              keep: fence.directives.has('keep'),
            } : undefined,
            // "⤓ output→fact" (or the declared target) → place the output
            // fact as a cell in this doc, right after its source.
            onOutput: factKey ? (key: string, content: string) => { void ctx?.placeOutput?.(factKey, key, content); } : undefined,
          });
          box.replaceWith(node);
        })
        .catch((err) => { box.textContent = `run: ${(err as Error).message}`; });
      continue;
    }
    // 2b. agent cell — model-in-the-loop over the substrate (@c15r/models.agent),
    // the generative tier. Always async: submit → poll fetch → render the result
    // (persisted as an `agent-run` fact at factKey). `!write` grants substrate
    // writes (default read-only). Anonymous readers just see the prompt.
    if (lang === 'agent') {
      const panel = el('div', 'embed-agent');
      panel.appendChild(el('div', 'agent-head', '🤖 agent'));
      const promptEl = el('pre', 'agent-prompt'); promptEl.textContent = body; panel.appendChild(promptEl);
      pre.replaceWith(panel);
      const hostKey = (panel.closest('[data-key]') as HTMLElement | null)?.dataset.key;
      if (!isAuthed()) { panel.appendChild(el('div', 'vw-attrib', 'sign in to run')); continue; }
      const canWrite = fence.directives.has('write');
      const out = el('div', 'agent-out');
      const run = el('button', 'btn primary', `run agent${canWrite ? ' · writes enabled' : ''}`) as HTMLButtonElement;
      run.onclick = async () => {
        run.disabled = true; out.textContent = 'submitting…';
        try {
          const sub = await act<{ jobId: string; factKey?: string }>('@c15r/models.agent', { prompt: body, grants: { read: true, write: canWrite } });
          const deadline = Date.now() + 180_000;
          for (;;) {
            await new Promise((r) => setTimeout(r, 2500));
            const job = await read<{ status: string; text?: string; error?: string; factKey?: string; turns?: number; toolCalls?: number }>('@c15r/models.fetch', { jobId: sub.jobId });
            if (job.status === 'done') {
              const fk = job.factKey ?? sub.factKey;
              // Persist the output as a real cell in the doc (provenance-linked to
              // the agent-run fact) rather than an ephemeral inline render. Falls
              // back to inline when there's no doc context (log views, anon).
              if (ctx?.onAgentOutput && hostKey) {
                out.textContent = '✓ output added as a cell below';
                await ctx.onAgentOutput(hostKey, job.text || '', fk);
              } else {
                out.innerHTML = renderMarkdown(job.text || '*(no output)*'); void enhanceFences(out);
              }
              panel.appendChild(el('div', 'vw-attrib', `⚙ @c15r/models · agent · ${job.turns ?? '?'} turns · ${job.toolCalls ?? 0} tool calls${fk ? ` · ${fk}` : ''}`));
              break;
            }
            if (job.status === 'error') { out.textContent = `agent error: ${job.error ?? 'failed'}`; break; }
            if (Date.now() > deadline) { out.textContent = 'agent still running after 180s — it persists to its fact; reopen later'; break; }
            out.textContent = `running… turn ${job.turns ?? 0} · ${job.toolCalls ?? 0} tool calls`;
          }
        } catch (err) { out.textContent = `agent: ${(err as Error).message}`; }
        run.disabled = false;
      };
      panel.appendChild(run); panel.appendChild(out);
      continue;
    }
    if (lang === 'board') {
      const wrap = el('div', 'embed-board');
      const open = el('a', 'embed-open', 'open board ↗') as HTMLAnchorElement;
      open.href = cellUrl(cellOwner(), 'canvas', `?view=${encodeURIComponent(arg)}`);
      if (isAuthed()) {
        // ADR-0043 Inc 2: an authed reader gets canvas's federated ui:// renderer
        // inside lit's OWN opaque-origin sandbox (allow-scripts, no
        // allow-same-origin), with the renderer's reads proxied through lit's
        // session — so a PRIVATE board paints. The old origin-iframe to canvas's
        // `?embed=1` was a third-party context: no session → the sign-in shell.
        // (The discarded-on-rerender message listener is inert — it filters on
        // this iframe's contentWindow — matching the fence-enhancement model.)
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.srcdoc = SANDBOX_HOST_HTML;
        frame.title = `board ${arg}`;
        frame.style.cssText = 'width:100%;height:280px;border:0;display:block;background:#fff';
        frame.addEventListener('load', () => {
          const handle = mountSandboxedRenderer(frame, {
            call: (kind, target, input) => (kind === 'read' ? read(target, input) : act(target, input)),
            onResize: (h) => { frame.style.height = `${Math.max(120, Math.min(520, h))}px`; },
            onSettled: (ok) => { if (!ok) frame.replaceWith(el('div', 'embed-view', `board ${arg}: renderer unavailable`)); },
          });
          void mcpResourceRead(`ui://@${cellOwner()}/canvas/renderers/board.js`).then((src) => {
            handle.render(src, 'canvas', { viewId: arg }, arg);
          });
        });
        wrap.appendChild(frame);
      } else {
        // Anonymous reader → canvas's zero-JS public thumbnail (?embed=1). This
        // stays an origin iframe deliberately: a `_public/` board SSRs fine with
        // no session, and a private board shows an anon reader nothing they may
        // see anyway — the surface-B public fast path ADR-0043 keeps.
        const frame = document.createElement('iframe');
        const w = Math.round(Math.min(680, root.clientWidth || 680));
        frame.src = cellUrl(cellOwner(), 'canvas', `?view=${encodeURIComponent(arg)}&embed=1&w=${w}&h=340`);
        frame.loading = 'lazy';
        wrap.appendChild(frame);
      }
      wrap.appendChild(open);
      pre.replaceWith(wrap);
    } else if (!isAuthed()) {
      continue; // view/cell need a session — leave the SSR'd code block
    } else if (lang === 'view') {
      const box = el('div', 'embed-view'); box.textContent = '…'; pre.replaceWith(box);
      read<{ value: unknown; render: { label?: string } | null }>('workspace.view', { id: arg })
        .then((res) => {
          box.textContent = '';
          box.appendChild(el('span', 'embed-label', res.render?.label ?? arg));
          const v = res.value;
          if (typeof v === 'number') box.appendChild(el('strong', 'embed-metric', String(v)));
          else if (Array.isArray(v)) {
            const ul = el('ul');
            for (const item of v.slice(0, 8) as Entry[]) ul.appendChild(el('li', '', `${item.key}: ${contentOf(item.value).slice(0, 80)}`));
            box.appendChild(ul);
          } else if (v && typeof v === 'object') box.appendChild(el('pre', '', JSON.stringify((v as Entry).value ?? v, null, 2).slice(0, 600)));
          else box.appendChild(el('em', '', String(v)));
        })
        .catch((err) => { box.textContent = `view ${arg}: ${err.message}`; });
    } else if (lang === 'cell') {
      const box = el('div', 'embed-cell'); box.textContent = '…'; pre.replaceWith(box);
      fetchFact(`cells/${arg}`)
        .then((fact) => {
          if (!fact) { box.textContent = `cell ${arg}: no pointer fact`; return; }
          const v = fact.value; box.textContent = '';
          const head = el('div', 'cell-head');
          const a = el('a', 'cell-addr', v.address ?? arg) as HTMLAnchorElement;
          a.href = v.address ?? '#'; head.appendChild(a);
          head.appendChild(el('span', `cell-status s-${(v.status || '').toLowerCase()}`, v.status ?? '?'));
          if (v.dirty) head.appendChild(el('span', 'cell-dirty', 'edited since deploy'));
          box.appendChild(head);
          box.appendChild(el('div', 'cell-meta', `${(v.files ?? []).length} files · v${v.version ?? '?'}`));
        })
        .catch((err) => { box.textContent = `cell ${arg}: ${err.message}`; });
    }
  }
}

/* ── block (interactive) ───────────────────────────────────────────────── */

interface CellProps {
  cellKey: string;
  content: string;
  fold: boolean;
  editable: boolean;
  onEdit: (src: string) => void;
  onFold: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddAfter: () => void;
  fenceCtx?: FenceCtx;
  /** Selection summons the floating menu (ADR-0063 gem 8). */
  selected?: boolean;
  onSelect?: () => void;
  /** Place an EXISTING fact after this cell — membership only, no copy
   *  (ADR-0061 "insert existing", the same-fact-second-surface verb). */
  onInsertExisting?: (factKey: string) => void | Promise<void>;
}
type FenceCtx = {
  onAgentOutput?: (srcKey: string, text: string, factKey?: string) => void | Promise<void>;
  placeOutput?: (srcKey: string, cellKey: string, content?: string) => void | Promise<void>;
};
function CellView({ cellKey, content, fold, editable, onEdit, onFold, onMove, onAddAfter, fenceCtx, selected, onSelect, onInsertExisting }: CellProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pq, setPq] = useState('');
  const [hits, setHits] = useState<Entry[]>([]);
  useEffect(() => { if (!selected) { setMenuOpen(false); setPicker(false); } }, [selected]);
  // Debounced live search for the insert-existing picker (semantic when the
  // backend has vectors — the same query the palette rides).
  useEffect(() => {
    if (!picker || !pq.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      void read<{ entries: Entry[] }>('workspace.query', { text: pq.trim(), limit: 6, shape: 'card' })
        .then((r) => setHits(r.entries ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [picker, pq]);
  const md = content;
  const ctxRef = useRef(fenceCtx); ctxRef.current = fenceCtx;

  // After the body mounts/changes, enhance fences (executable / viewer / agent /
  // plugin). agent and run/js outputs persist as doc cells via the fence ctx.
  useEffect(() => {
    const host = bodyRef.current;
    if (!host || fold || editing !== null) return;
    void enhanceFences(host, {
      onAgentOutput: (a, b, c) => ctxRef.current?.onAgentOutput?.(a, b, c),
      placeOutput: (a, b, c) => ctxRef.current?.placeOutput?.(a, b, c),
    });
  }, [md, fold, editing]);

  if (editing !== null) {
    return (
      <article className="block" data-key={cellKey}>
        <div className="editor">
          <textarea
            value={editing}
            rows={Math.min(28, Math.max(3, editing.split('\n').length + 1))}
            spellCheck={false}
            onChange={(e) => setEditing(e.target.value)}
          />
          <div className="editor-bar">
            <button className="btn primary" onClick={() => { onEdit(editing); setEditing(null); }}>save</button>
            <button className="btn" onClick={() => setEditing(null)}>cancel</button>
            <span className="summary"> a heading or code fence splits this into new cells</span>
          </div>
        </div>
      </article>
    );
  }

  const title = (md.match(/^#+\s*(.+)$/m) || [])[1] ?? md.split('\n').find((l) => l.trim()) ?? cellKey;
  // ADR-0060: an `out:<src>:<ts>` member is an ATTACHED output — its key
  // encodes provenance (kin to the placement key rule). Render it as the
  // source's output band: dashed edge + a "⤷ output of" line that scrolls
  // to the producing cell when it's in this doc.
  const outSrc = cellKey.startsWith('out:') && cellKey.lastIndexOf(':') > 4 ? cellKey.slice(4, cellKey.lastIndexOf(':')) : null;
  const stop = (fn: () => void) => (e: React.MouseEvent): void => { e.stopPropagation(); fn(); };
  return (
    <article
      className={`block${fold ? ' is-folded' : ''}${outSrc ? ' block-output' : ''}${selected ? ' selected' : ''}`}
      data-key={cellKey}
      id={cellKey}
      onClick={editable && onSelect ? (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('a, button, textarea, input, select, iframe, .block-menu')) return;
        onSelect();
      } : undefined}
    >
      {outSrc ? (
        <div className="block-out-prov">
          ⤷ output of{' '}
          <a href={factRoute(outSrc)} onClick={(e) => {
            const el = document.querySelector(`[data-key="${(window as any).CSS?.escape?.(outSrc) ?? outSrc}"]`);
            if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
          }}>{outSrc}</a>
        </div>
      ) : null}
      {/* The floating menu (ADR-0063, dotlit's gem): an absolute pointer-
          transparent overlay whose round-button cluster is sticky at mid-
          viewport — the verbs ride your scroll within the selected block. */}
      {editable && selected ? (
        <div className="block-menu">
          <div className="bm-items">
            {menuOpen ? (
              <>
                <button title="edit" onClick={stop(() => setEditing(md))}>✎</button>
                <button title={fold ? 'unfold' : 'fold'} onClick={stop(onFold)}>{fold ? '▸' : '▾'}</button>
                <button title="move up" onClick={stop(() => onMove(-1))}>↑</button>
                <button title="move down" onClick={stop(() => onMove(1))}>↓</button>
                <button title="add a cell after" onClick={stop(onAddAfter)}>＋</button>
                <button title="insert an existing fact after" onClick={stop(() => setPicker((p) => !p))}>⧉</button>
                <button title="close" onClick={stop(() => setMenuOpen(false))}>✕</button>
              </>
            ) : (
              <button className="bm-primary" title="cell menu" onClick={stop(() => setMenuOpen(true))}>☰</button>
            )}
          </div>
        </div>
      ) : null}
      {fold ? (
        <div className="block-body"><p className="folded">▸ {title.replace(/[#*_`]/g, '').trim()}</p></div>
      ) : (
        <div className="block-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      )}
      {picker ? (
        <div className="insert-picker" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            placeholder="search facts to insert here…"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setPicker(false); setPq(''); } }}
          />
          {hits.map((h) => (
            <button key={h.key} className="picker-hit" onClick={() => { setPicker(false); setPq(''); void onInsertExisting?.(h.key); }}>
              <span className="picker-title">{(typeof (h.value as Record<string, unknown>)?.title === 'string' && (h.value as { title: string }).title) || h.key}</span>
              <span className="picker-meta">{h._meta?.type ?? ''} · {h.key}</span>
            </button>
          ))}
          {pq.trim() && !hits.length ? <div className="picker-meta">no matches</div> : null}
        </div>
      ) : null}
    </article>
  );
}

/* ── doc editor ────────────────────────────────────────────────────────── */

function DocEditor({ docId, editable, seed }: { docId: string; editable: boolean; seed?: DocSeed }): React.JSX.Element {
  // Seed from the SSR ViewModel so the first interactive render equals the
  // server paint — load() then refreshes in place (no "loading…" flash post-SSR).
  const [meta, setMeta] = useState<DocValue | null>(seed ? { title: seed.title, summary: seed.summary } : null);
  const [cells, setCells] = useState<LoadedCell[]>((seed?.blocks ?? []).map((b, i) => ({ key: b.key, content: b.md, fold: !!b.fold, seq: i + 1, score: 0 })));
  const [missing, setMissing] = useState(false);
  const [projection, setProjection] = useState<'narrative' | 'salience'>('narrative');
  const [backlinks, setBacklinks] = useState<LinkRef[]>([]);
  // One selected block at a time; tapping it again deselects (dotlit's model).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await loadDoc(docId, projection);
    if (!res) { setMissing(true); return; }
    setMeta(res.meta); setCells(res.cells); setBacklinks(res.backlinks);
    cacheSet(`doc:${docId}`, { kind: 'doc', owner: cellOwner(), isOwner: true, id: docId, title: res.meta.title || docId, summary: res.meta.summary, blocks: res.cells.map((c) => ({ key: c.key, md: c.content, fold: c.fold })) });
  }, [docId, projection]);
  useEffect(() => { void load(); }, [load]);
  // Live sync (ADR-0059 Inc 3): remote writes to this doc's slice reload it.
  useEffect(() => {
    if (!editable) return;
    return startDocLiveSync(docId, () => cellsRef.current.map((c) => c.key), () => void load());
  }, [docId, editable, load]);
  // Fragment navigation (ADR-0061): `#<memberKey>` scrolls to the block;
  // free-text fragments soft-resolve against member headings — no index.
  useEffect(() => {
    const frag = decodeURIComponent((location.hash || '').slice(1));
    if (!frag || !cells.length) return;
    const t = setTimeout(() => {
      let target: HTMLElement | null = document.getElementById(frag);
      if (!target) {
        const hs = Array.from(document.querySelectorAll('.block-body h1, .block-body h2, .block-body h3')) as HTMLElement[];
        target = hs.find((h) => (h.textContent || '').trim().toLowerCase().includes(frag.toLowerCase())) ?? null;
      }
      target?.scrollIntoView({ block: 'start' });
    }, 250);
    return () => clearTimeout(t);
  }, [cells.length]);

  // Live mirror of cells so the output callbacks can place a new cell without a
  // re-fetch (read-after-write lag was making outputs appear only on reload).
  const cellsRef = useRef(cells); cellsRef.current = cells;
  const seqAfter = (srcKey: string): number => {
    const arr = cellsRef.current;
    const i = arr.findIndex((c) => c.key === srcKey);
    const lo = i >= 0 ? arr[i].seq : (arr.at(-1)?.seq ?? 0);
    const hi = i >= 0 && i + 1 < arr.length ? arr[i + 1].seq : null;
    return seqBetween(lo, hi);
  };

  // An agent cell's output becomes a real cell placed right after it (fractional
  // seq), provenance-linked to the agent-run fact. Optimistic insert → no reload.
  const onAgentOutput = useCallback(async (srcKey: string, text: string, factKey?: string) => {
    const seq = seqAfter(srcKey);
    const k = mintCell();
    const content = text || '_(no output)_';
    await saveCell(docId, k, content);
    await writeOrder(docId, k, seq, false);
    if (factKey) await act('workspace.link', { from: factKey, to: k, rel: 'produces' }).catch(() => {});
    setCells((cs) => [...cs.filter((c) => c.key !== k), { key: k, content, fold: false, seq, score: 0 }].sort((a, b) => a.seq - b.seq));
  }, [docId]);

  // run/js "output→fact" already wrote an `out:` fact (produced-by the cell);
  // place THAT fact as a cell after the source (one decoration), no duplicate.
  const placeOutput = useCallback(async (srcKey: string, cellKey: string, content?: string) => {
    const seq = seqAfter(srcKey);
    await writeOrder(docId, cellKey, seq, false);
    setCells((cs) => [...cs.filter((c) => c.key !== cellKey), { key: cellKey, content: content ?? '', fold: false, seq, score: 0 }].sort((a, b) => a.seq - b.seq));
  }, [docId]);
  const fenceCtx = { onAgentOutput, placeOutput };

  if (missing) return <ListEditor.MissingDoc docId={docId} />;
  if (!meta) return <p className="boot">loading {docId}…</p>;

  // A doc is a view: cells are facts ordered by `_doc/` decorations. Editing one
  // cell may split it (saveCellSplit); reorder/insert are one fractional-seq write.
  const nextSeq = (i: number): number | null => (i + 1 < cells.length ? cells[i + 1].seq : null);

  return (
    <>
      <header>
        <a className="back" href="/">← documents</a>
        <h1>{meta.title || docId}</h1>
        {meta.summary ? <p className="summary">{meta.summary}</p> : null}
        <p className="doc-controls summary">
          <button className={`pill${projection === 'narrative' ? ' on' : ''}`} onClick={() => setProjection('narrative')}>narrative</button>{' '}
          <button className={`pill${projection === 'salience' ? ' on' : ''}`} onClick={() => setProjection('salience')}>salience</button>
        </p>
      </header>
      <main>
        {cells.length === 0 ? (
          editable
            ? <button className="btn add-block" onClick={async () => { const k = mintCell(); const content = `# ${meta.title || docId}\n\nStart writing…`; await saveCell(docId, k, content); await writeOrder(docId, k, 1, false); setCells([{ key: k, content, fold: false, seq: 1, score: 0 }]); }}>＋ first cell</button>
            : <p className="boot">empty document</p>
        ) : cells.map((c, i) => (
          <CellView
            key={c.key}
            cellKey={c.key}
            content={c.content}
            fold={c.fold}
            editable={editable && projection === 'narrative'}
            // Optimistic: apply the known result locally (substrate reads are
            // eventually consistent, so re-querying here would miss the write).
            onEdit={async (src) => { const res = await saveCellSplit(docId, c, nextSeq(i), src); setCells((cs) => [...cs.filter((x) => x.key !== c.key), ...res].sort((a, b) => a.seq - b.seq)); }}
            onFold={async () => { await writeOrder(docId, c.key, c.seq, !c.fold); setCells((cs) => cs.map((x) => (x.key === c.key ? { ...x, fold: !x.fold } : x))); }}
            onMove={async (dir) => {
              const j = i + dir; if (j < 0 || j >= cells.length) return;
              const lower = dir < 0 ? (i - 2 >= 0 ? cells[i - 2].seq : null) : cells[i + 1].seq;
              const upper = dir < 0 ? cells[i - 1].seq : (i + 2 < cells.length ? cells[i + 2].seq : null);
              const seq = seqBetween(lower, upper);
              await writeOrder(docId, c.key, seq, c.fold);
              setCells((cs) => cs.map((x) => (x.key === c.key ? { ...x, seq } : x)).sort((a, b) => a.seq - b.seq));
            }}
            onAddAfter={async () => { const k = mintCell(); const seq = seqBetween(c.seq, nextSeq(i)); await saveCell(docId, k, '_new cell_'); await writeOrder(docId, k, seq, false); setCells((cs) => [...cs, { key: k, content: '_new cell_', fold: false, seq, score: 0 }].sort((a, b) => a.seq - b.seq)); }}
            fenceCtx={fenceCtx}
            selected={selectedKey === c.key}
            onSelect={() => setSelectedKey((k) => (k === c.key ? null : c.key))}
            // Membership only: one decoration write places the SAME fact here
            // (the design's headline capability finally has its verb).
            onInsertExisting={async (factKey) => {
              const seq = seqBetween(c.seq, nextSeq(i));
              await writeOrder(docId, factKey, seq, false);
              const f = await fetchFact(factKey);
              setCells((cs) => [...cs.filter((x) => x.key !== factKey), { key: factKey, content: contentOf(f?.value ?? {}), fold: false, seq, score: 0 }].sort((a, b) => a.seq - b.seq));
            }}
          />
        ))}
        {editable ? <a className="add-block btn" href={cellUrl(cellOwner(), 'input')}>+ capture</a> : null}
        {backlinks.length ? (
          <section className="backlinks">
            <h3>Linked from</h3>
            <ul>{backlinks.map((b) => (
              <li key={b.key}>
                <a href={factRoute(b.key)}>[[{b.label}]]</a>
                {b.rel && b.rel !== 'related' ? <span className="rel"> · {b.rel}</span> : null}
              </li>
            ))}</ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

/* ── list ──────────────────────────────────────────────────────────────── */

function ListEditor({ editable, seed }: { editable: boolean; seed?: ListItem[] }): React.JSX.Element {
  // Seed from the SSR ViewModel (no "loading documents…" gap); the effect refreshes.
  // SSR omits `score` (true salience needs a trajectory+edges fold this cell's
  // lightweight direct-DDB SSR path doesn't carry) — this client refresh gets it
  // for free from the SAME `workspace.query` it's already making, so the salience
  // figure simply appears a moment after first paint, same pattern as everything
  // else here (fast SSR shell, richer live data once hydrated).
  const [docs, setDocs] = useState<ListItem[] | null>(seed ?? null);
  // ADR-0061 §1b: entities waiting to exist — dangling `related` edges (wiki
  // links whose target was never written), grouped by target, most-wanted
  // first. The want-list emerges from the writing; nothing is minted until
  // the owner says so.
  const [waiting, setWaiting] = useState<Array<{ key: string; count: number }>>([]);
  useEffect(() => {
    void (async () => {
      const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'doc', limit: 100 });
      const list: ListItem[] = (res.entries ?? []).filter((e) => e.key.startsWith('doc:'))
        .sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'))
        .map((e) => {
          const v = e.value as DocValue;
          const id = e.key.slice(4);
          return { id, title: v.title || id, summary: v.summary, blocks: 0, updated: e._meta?.updatedAt ?? '', score: (e._meta as { score?: number } | undefined)?.score };
        });
      setDocs(list);
      cacheSet('$docs', { kind: 'list', owner: cellOwner(), isOwner: true, docs: list });
      if (editable) {
        try {
          const att = await read<{ dangling: Array<{ to: string; rel?: string }> }>('workspace.attention', { limit: 100 });
          const counts = new Map<string, number>();
          for (const d of att.dangling ?? []) {
            if (d.rel && d.rel !== 'related') continue;
            counts.set(d.to, (counts.get(d.to) ?? 0) + 1);
          }
          setWaiting([...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 12));
        } catch { /* attention is a garnish here */ }
      }
    })();
  }, [editable]);

  const today = new Date().toISOString().split('T')[0];
  return (
    <>
      <header>
        <a className="back" href="/">← home</a>
        <h1>lit</h1>
        <p className="summary">documents — ordered paths through the substrate</p>
        {editable ? <a className="back" href={factRoute(`log:${today}`)}>📥 today's log →</a> : null}
      </header>
      <main className="doc-list">
        {docs === null ? <p className="boot">loading documents…</p> : docs.length === 0 ? <p className="boot">no documents yet</p> : docs.map((d) => <DocRow d={d} key={d.id} />)}
      </main>
      {waiting.length ? (
        <section className="backlinks waiting">
          <h3>waiting to exist</h3>
          <ul>
            {waiting.map((w) => (
              <li key={w.key}>
                <a className="wikilink wikilink-stub" href={factRoute(w.key)} onClick={(e) => {
                  if (!w.key.startsWith('doc:')) return;
                  e.preventDefault();
                  const title = w.key.slice(4).replace(/-/g, ' ');
                  if (confirm(`Create "${title}"?`)) void createDocFromKey(w.key, title);
                }}>{w.key}</a>
                <span className="rel"> wanted {w.count}×</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {editable ? (
        <button className="btn add-block" onClick={async () => {
          const title = prompt('Title?'); if (!title) return;
          const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `d${Date.now().toString(36)}`;
          await saveDocMeta(id, { title });
          const k = mintCell();
          await saveCell(id, k, `# ${title}\n\nStart writing…`);
          await writeOrder(id, k, 1, false);
          await outbox.flushNow(); // navigating next — the debounce must not eat the mint
          location.href = factRoute(`doc:${id}`);
        }}>+ new document</button>
      ) : null}
    </>
  );
}
ListEditor.MissingDoc = function MissingDoc({ docId }: { docId: string }): React.JSX.Element {
  return (
    <>
      <header><a className="back" href="/">← documents</a><h1>{docId}</h1></header>
      <main><p className="boot">no document “{docId}”</p></main>
    </>
  );
};

/* ── log views (day → week → month → year, all derived) ────────────────── */

const isoWeekOf = (d: string): string => {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const wd = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - wd + 3);
  const y = dt.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4));
  return `${y}-w${String(1 + Math.round(((+dt - +jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};
function LogNav({ label }: { label: string }): React.JSX.Element {
  const links: Array<[string, string]> = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) { links.push([`week ${isoWeekOf(label).slice(5)}`, isoWeekOf(label)], [`month ${label.slice(5, 7)}`, label.slice(0, 7)], [`year ${label.slice(0, 4)}`, label.slice(0, 4)]); }
  else if (/^\d{4}-w\d{2}$/.test(label) || /^\d{4}-\d{2}$/.test(label)) links.push([`year ${label.slice(0, 4)}`, label.slice(0, 4)]);
  return <p className="summary">{links.map(([t, id]) => <a className="back" style={{ marginRight: '0.8rem' }} href={factRoute(`log:${id}`)} key={id}>{t}</a>)}</p>;
}
function LogEntry({ e }: { e: Entry }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const md = contentOf(e.value);
  useEffect(() => { if (ref.current) void enhanceFences(ref.current); }, [md]);
  return <article className="block" data-key={e.key}><div className="block-body" ref={ref} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} /></article>;
}
function LogView({ docId }: { docId: string }): React.JSX.Element {
  const label = docId.slice(4);
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(label);
  const [groups, setGroups] = useState<Array<[string, Entry[]]> | null>(null);
  useEffect(() => {
    void (async () => {
      if (isDay) {
        const res = await read<{ entries: Entry[] }>('workspace.query', { tag: docId, limit: 200 });
        const items = (res.entries ?? []).filter((e) => !e.key.startsWith('log:'))
          .sort((a, b) => Date.parse(a._meta?.updatedAt ?? '0') - Date.parse(b._meta?.updatedAt ?? '0'));
        setGroups([['', items]]);
      } else {
        const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'capture', limit: 250 });
        const match = (d: string): boolean => /^\d{4}-w\d{2}$/.test(label) ? isoWeekOf(d) === label : d.startsWith(label);
        const byDay = new Map<string, Entry[]>();
        for (const e of res.entries ?? []) {
          const d = (e.value as { captured?: string } | undefined)?.captured;
          if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && match(d)) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(e); }
        }
        setGroups([...byDay.keys()].sort().map((d) => [d, byDay.get(d)!] as [string, Entry[]]));
      }
    })();
  }, [docId]);

  return (
    <>
      <header><a className="back" href="/">← documents</a><h1>📥 {label}</h1><LogNav label={label} /></header>
      <main>
        {groups === null ? <p className="boot">loading…</p> : groups.length === 0 || groups.every(([, e]) => !e.length)
          ? <p className="boot">{isDay ? 'nothing captured this day' : 'nothing captured in this period'}</p>
          : groups.map(([day, entries]) => (
            <React.Fragment key={day || 'day'}>
              {day ? <h2><a className="back" href={factRoute(`log:${day}`)}>🗓️ {day}</a></h2> : null}
              {entries.map((e) => <LogEntry e={e} key={e.key} />)}
            </React.Fragment>
          ))}
        <a className="add-block btn" href={cellUrl(cellOwner(), 'input')}>+ capture</a>
      </main>
    </>
  );
}

/* ── generic fact reader (ADR-0040: any fact, not just a lit-authored doc) ──
 * Mirrors `index.ts`'s `buildFactVM` exactly (same hint floor, same neighbour
 * shape) so the client's own load matches what SSR would have produced —
 * read-only: editing a foreign type stays in its own managing cell / the
 * field computer (home's FactEditor), not lit. */
async function loadFact(key: string): Promise<Extract<ViewModel, { kind: 'fact' }> | null> {
  const fact = await fetchFact(key);
  if (!fact) return null;
  const value = fact.value;
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const title = (typeof v.title === 'string' && v.title) || (typeof v.name === 'string' && v.name) || deriveId(key);
  const body = bodyText(value);
  const bodyHtml = body ? renderMarkdown(body) : '';
  const fieldsHtml = bodyHtml ? '' : fieldsToHtml(value);
  let links: LinkRef[] = [];
  let backlinks: LinkRef[] = [];
  try {
    const nb = await read<{ inbound: Array<{ from: string; rel: string }>; outbound: Array<{ to: string; rel: string }>; entries: Record<string, Entry> }>('workspace.neighbors', { key });
    const labelFor = (k: string): { label: string; type: string | null } => {
      const ent = nb.entries?.[k];
      const ev = ent?.value as Record<string, unknown> | undefined;
      const l = (typeof ev?.title === 'string' && ev.title) || (typeof ev?.name === 'string' && ev.name) || deriveId(k);
      return { label: l as string, type: ent?._meta?.type ?? null };
    };
    const dedupe = (refs: LinkRef[]): LinkRef[] => {
      const seen = new Set<string>();
      return refs.filter((r) => r.key !== key && !seen.has(r.key) && (seen.add(r.key), true)).slice(0, 24);
    };
    links = dedupe((nb.outbound ?? []).map((e) => ({ key: e.to, rel: e.rel, ...labelFor(e.to) })));
    backlinks = dedupe((nb.inbound ?? []).map((e) => ({ key: e.from, rel: e.rel, ...labelFor(e.from) })));
  } catch { /* best-effort */ }
  return { kind: 'fact', owner: cellOwner(), isOwner: true, key, type: fact._meta?.type ?? null, title, bodyHtml, fieldsHtml, links, backlinks };
}

function FactPage({ routeKey, seed }: { routeKey: string; seed?: Extract<ViewModel, { kind: 'fact' }> }): React.JSX.Element {
  const [vm, setVm] = useState<Extract<ViewModel, { kind: 'fact' }> | null>(seed ?? null);
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVm(seed ?? null); setMissing(false);
    void (async () => {
      const res = await loadFact(routeKey);
      if (!res) { setMissing(true); return; }
      setVm(res);
      cacheSet(routeKey, res);
    })();
  }, [routeKey]);

  // Body markdown may carry fences (the SAME enhancement docs get).
  useEffect(() => { if (ref.current) void enhanceFences(ref.current); }, [vm?.bodyHtml]);

  if (missing) return <ListEditor.MissingDoc docId={routeKey} />;
  if (!vm) return <p className="boot">loading {routeKey}…</p>;
  // ADR-0061 §5: every fact is a seed document. "appears in" lists the docs
  // holding this fact (the derived inDoc projection rides neighbors); the
  // annotate verb assembles a doc AROUND the fact — membership only, the
  // fact itself untouched.
  const appearsIn = vm.links.filter((l) => l.rel === 'inDoc' && l.key.startsWith('doc:'));
  const annotate = async (): Promise<void> => {
    const title = prompt('Title for the new document around this fact?', vm.title);
    if (!title) return;
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `d${Date.now().toString(36)}`;
    await saveDocMeta(id, { title, summary: `assembled around ${routeKey}` });
    await writeOrder(id, routeKey, 1, false); // the fact IS the first member
    const k = mintCell();
    await saveCell(id, k, '_notes…_');
    await writeOrder(id, k, 2, false);
    await outbox.flushNow();
    location.href = factRoute(`doc:${id}`);
  };
  return (
    <div ref={ref}>
      {appearsIn.length ? (
        <div className="appears-in">
          appears in {appearsIn.map((d, i) => (
            <span key={d.key}>{i > 0 ? ' · ' : ''}<a href={`${factRoute(d.key)}#${encodeURIComponent(routeKey)}`}>{d.label}</a></span>
          ))}
        </div>
      ) : null}
      <FactView vm={vm} />
      {isAuthed() ? (
        <div className="doc-controls">
          <button className="pill" onClick={() => void annotate()}>✎ start a doc around this fact</button>
        </div>
      ) : null}
    </div>
  );
}

/* ── type collections (a `[[type:project|Projects]]` wiki-link target) ──── */

async function loadTypeCollection(type: string): Promise<TypeItem[]> {
  const res = await read<{ entries: Entry[] }>('workspace.query', { type, limit: 100 });
  return (res.entries ?? [])
    .sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'))
    .map((e) => {
      const v = e.value && typeof e.value === 'object' && !Array.isArray(e.value) ? (e.value as Record<string, unknown>) : {};
      const title = (typeof v.title === 'string' && v.title) || (typeof v.name === 'string' && v.name) || deriveId(e.key);
      const summaryRaw = typeof v.summary === 'string' ? v.summary : typeof v.statement === 'string' ? v.statement : bodyText(e.value);
      return { key: e.key, title, summary: summaryRaw ? summaryRaw.slice(0, 160) : undefined, updated: e._meta?.updatedAt ?? '', score: (e._meta as { score?: number } | undefined)?.score };
    });
}

function TypeCollectionPage({ type, seed }: { type: string; seed?: Extract<ViewModel, { kind: 'type' }> }): React.JSX.Element {
  const [items, setItems] = useState<TypeItem[] | null>(seed?.items ?? null);
  useEffect(() => {
    setItems(seed?.items ?? null);
    void (async () => {
      const list = await loadTypeCollection(type);
      setItems(list);
      cacheSet(`type:${type}`, { kind: 'type', owner: cellOwner(), isOwner: true, type, items: list });
    })();
  }, [type]);
  if (items === null) return <p className="boot">loading {type}…</p>;
  return <TypeView vm={{ kind: 'type', owner: cellOwner(), isOwner: true, type, items }} />;
}

/* ── anonymous read-only ───────────────────────────────────────────────── */

function AnonView({ vm }: { vm: ViewModel }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) void enhanceFences(ref.current); }, []);
  return (
    <div ref={ref}>
      <Surface vm={vm} />
      <p className="summary">
        <a className="back" href="#" onClick={(e) => { e.preventDefault(); void ensureAuth().then(() => location.reload()); }}>sign in to edit →</a>
      </p>
    </div>
  );
}

/* ── routing + boot ────────────────────────────────────────────────────── */

/** Seeds reconstructed from the SSR ViewModel so an interactive view's first
 *  render equals the server paint (killing the post-hydration "loading…" flash). */
type DocSeed = Extract<ViewModel, { kind: 'doc' }>;

/** The route key for THIS page load — either the new path form (`/r/<key>`,
 *  found anywhere in `pathname` so it works whether lit is mounted at the
 *  apex `/@owner/lit` or a bare subdomain root) or the legacy `?doc=` query
 *  param (a bare value implies `doc:<value>`; an explicit `:`/`/`-bearing
 *  value, e.g. `log:2026-06-30`, is used as-is) — mirrors `index.ts`'s
 *  server-side normalization exactly, so both URL forms resolve identically. */
function currentRouteKey(): string | null {
  const m = location.pathname.match(/\/r\/(.+)$/);
  if (m) {
    const key = m[1].split('/').map((seg) => { try { return decodeURIComponent(seg); } catch { return seg; } }).join('/');
    return key || null;
  }
  const qd = new URLSearchParams(location.search).get('doc');
  if (qd == null) return null;
  return /[:/]/.test(qd) ? qd : `doc:${qd}`;
}

/** The root (`/`, no route key): a curated welcome page beats a flat list, so
 *  try `doc:welcome` first and fall back to the doc list when there isn't one
 *  — mirrors `index.ts`'s `buildRootVM` exactly, so SSR and a cold client-only
 *  load (no SSR seed at all, e.g. anonymous-without-public-content) agree. */
function RootRoute({ editable }: { editable: boolean }): React.JSX.Element {
  const [state, setState] = useState<'loading' | 'welcome' | 'list'>('loading');
  useEffect(() => {
    void (async () => { setState((await fetchFact('doc:welcome')) ? 'welcome' : 'list'); })();
  }, []);
  if (state === 'loading') return <p className="boot">loading…</p>;
  if (state === 'welcome') return <DocEditor docId="welcome" editable={editable} />;
  return <ListEditor editable={editable} />;
}

function Route({ editable, initialVm }: { editable: boolean; initialVm: ViewModel | null }): React.JSX.Element {
  const key = currentRouteKey();
  if (key && /^log:/.test(key)) return <LogView docId={key} />;
  if (key === '$docs') {
    const seed = initialVm && initialVm.kind === 'list' ? initialVm.docs : undefined;
    return <ListEditor editable={editable} seed={seed} />;
  }
  if (key && key.startsWith('doc:')) {
    const docId = key.slice(4);
    const seed = initialVm && initialVm.kind === 'doc' && initialVm.id === docId ? initialVm : undefined;
    return <DocEditor docId={docId} editable={editable} seed={seed} />;
  }
  if (key && key.startsWith('type:')) {
    const type = key.slice(5);
    const seed = initialVm && initialVm.kind === 'type' && initialVm.type === type ? initialVm : undefined;
    return <TypeCollectionPage type={type} seed={seed} />;
  }
  if (key) {
    const seed = initialVm && initialVm.kind === 'fact' && initialVm.key === key ? initialVm : undefined;
    return <FactPage routeKey={key} seed={seed} />;
  }
  // Root: the SSR seed already resolved welcome-vs-list (buildRootVM); a cold
  // client-only load (no seed) probes for the welcome doc itself.
  if (initialVm && initialVm.kind === 'doc' && initialVm.id === 'welcome') {
    return <DocEditor docId="welcome" editable={editable} seed={initialVm} />;
  }
  if (initialVm && initialVm.kind === 'list') {
    return <ListEditor editable={editable} seed={initialVm.docs} />;
  }
  return <RootRoute editable={editable} />;
}

function Workspace({ initialVm }: { initialVm: ViewModel | null }): React.JSX.Element {
  const returning = new URLSearchParams(location.search).has('code');
  const [phase, setPhase] = useState<'anon' | 'authing' | 'ready'>(
    () => (initialVm && !isAuthed() && !returning ? 'anon' : 'authing'),
  );
  useEffect(() => {
    if (phase !== 'authing') return;
    let live = true;
    void (async () => {
      try { await ensureAuth(); typeDecls = (await loadTypes().catch(() => ({}))) as Record<string, { viewer?: string }>; await loadRenderers().catch(() => {}); }
      catch (err) { const b = document.getElementById('err-banner'); if (b) { b.style.display = 'block'; b.textContent = `sign-in failed: ${(err as Error).message}`; } }
      if (live) setPhase('ready');
    })();
    return () => { live = false; };
  }, [phase]);

  if (phase === 'anon' && initialVm) return <AnonView vm={initialVm} />;
  if (phase === 'authing') return initialVm ? <Surface vm={initialVm} /> : <p className="boot">signing you in…</p>;
  return <Route editable={isAuthed()} initialVm={initialVm} />;
}

/** App: render the SSR tree verbatim for the very first paint (so hydrateRoot
 *  attaches cleanly), then flip to the live workspace on mount. */
function App({ initialVm }: { initialVm: ViewModel | null }): React.JSX.Element {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  if (!ready && initialVm) return <Surface vm={initialVm} />;
  return <Workspace initialVm={initialVm} />;
}

function readInitialVm(): ViewModel | null {
  const tag = document.getElementById('lit-state');
  if (!tag?.textContent) return null;
  try { return JSON.parse(tag.textContent) as ViewModel; } catch { return null; }
}

/* Client VM cache — SSR only embeds a ViewModel when the request proves owner
 * identity (bearer, or the dispatch tier's session-cookie → x-cell-caller). A
 * plain navigation that misses that gets the bare shell, so the client would
 * paint "loading…" before its first fetch. Caching the last-seen VM per route
 * lets a repeat open paint instantly from cache; load() then refreshes it. */
const VM_CACHE = 'parc.lit.vm.';
function cacheGet(id: string): ViewModel | null {
  try { const s = localStorage.getItem(VM_CACHE + id); return s ? (JSON.parse(s) as ViewModel) : null; } catch { return null; }
}
function cacheSet(id: string, vm: ViewModel): void {
  try { localStorage.setItem(VM_CACHE + id, JSON.stringify(vm)); } catch { /* storage full/blocked */ }
}
function cachedVmForLocation(): ViewModel | null {
  const key = currentRouteKey();
  if (!key) return cacheGet('doc:welcome') ?? cacheGet('$docs'); // root: welcome doc, else the list
  if (key.startsWith('log:')) return null; // logs are derived views, not cached
  return cacheGet(key);
}

const ssrVm = readInitialVm();
// Fall back to the cached VM only on a bare shell (no SSR paint to hydrate).
const initialVm = ssrVm ?? cachedVmForLocation();
if (appRoot.dataset.ssr === '1' && ssrVm) hydrateRoot(appRoot, <App initialVm={ssrVm} />);
else { appRoot.textContent = ''; createRoot(appRoot).render(<App initialVm={initialVm} />); }

// The save dot (ADR-0059 Inc 2): the outbox's honest state, bottom-right.
// saving = amber, failed = terracotta (stays until a flush succeeds), saved
// fades out. Same vocabulary as the canvas's parc:save-state indicator.
window.addEventListener('lit:save-state', (e) => {
  const state = (e as CustomEvent<{ state: string }>).detail?.state ?? '';
  let dot = document.getElementById('lit-save-dot');
  if (!dot) { dot = document.createElement('div'); dot.id = 'lit-save-dot'; document.body.appendChild(dot); }
  dot.dataset.state = state;
  dot.textContent = state === 'saving' ? 'saving…' : state === 'failed' ? 'retrying…' : 'saved';
  if (state === 'saved') { const d = dot; setTimeout(() => { if (d.dataset.state === 'saved') d.dataset.state = ''; }, 1500); }
});
