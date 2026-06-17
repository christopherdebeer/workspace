/* ---------------------------------------------------------------------------
 * lit — the narrative surface (docs/narrative-surface.md), now isomorphic.
 *
 * The server renders the read-only tree (cells/lit/shared.tsx) to a string; this
 * client hydrates that SAME tree (hydrateRoot) instead of rebuilding it — so the
 * authed first paint stays put with no flash. After hydration it progressively
 * enhances: fences become live embeds, and the owner gets the editing surface.
 *
 * A document is an ordered path through the SAME facts the canvas places:
 *   doc:<id>   — { title, summary?, blocks: [{ key, fold? }] }
 *   blocks     — plain markdown facts; removal from a doc never deletes the fact.
 * Editing is ephemera until saved; saves go through workspace.remember via:'lit'.
 * ------------------------------------------------------------------------- */
import './main.css';
(window as any).__lit_module = true; // watchdog marker: the module executed
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { ensureAuth, isAuthed } from './lib/auth.ts';
import { loadTypes, cellAddress, cellUrl } from 'https://parc.land/@c15r/kernel/app.js';
import { read, act } from './lib/substrate.ts';
import { Surface, renderMarkdown, splitCells, seqBetween, type ViewModel, type BlockData, type DocValue } from '../shared';

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
function contentOf(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value.content === 'string') return value.content;
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}
const mintCell = (): string => `cell:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
type LoadedCell = { key: string; content: string; fold: boolean; seq: number; score: number };

/** A document is a *view*: load its cell-facts via substrate-native ordering
 *  decorations (`_doc/<id>/<key>` = {seq, fold}), migrating from the legacy
 *  embedded array when no decorations exist. `projection` re-sorts the SAME
 *  membership — narrative by seq, salience by the cell's score. */
async function loadDoc(docId: string, projection: 'narrative' | 'salience'): Promise<{ meta: DocValue; cells: LoadedCell[] } | null> {
  const docFact = await fetchFact(`doc:${docId}`);
  if (!docFact) return null;
  const meta = docFact.value as DocValue;
  const prefix = `_doc/${docId}/`;
  const deco = await read<{ entries: Entry[] }>('workspace.query', { prefix, limit: 500 });
  let order = (deco.entries ?? []).map((e) => ({ key: e.key.slice(prefix.length), seq: Number((e.value as any)?.seq ?? 0), fold: !!(e.value as any)?.fold }));
  if (!order.length) order = ((meta.cells ?? meta.blocks ?? []) as Array<{ key: string; fold?: boolean }>).map((r, i) => ({ key: r.key, seq: i + 1, fold: !!r.fold }));
  const facts = await Promise.all(order.map((o) => fetchFact(o.key)));
  const cells: LoadedCell[] = order.map((o, i) => ({
    key: o.key, fold: o.fold, seq: o.seq,
    content: facts[i] ? contentOf(facts[i]!.value) : `*missing fact — ${o.key}*`,
    score: Number((facts[i]?._meta as any)?.score) || 0,
  }));
  cells.sort((a, b) => (projection === 'salience' ? b.score - a.score : a.seq - b.seq));
  return { meta, cells };
}
async function saveCell(docId: string, key: string, content: string): Promise<void> {
  await act('workspace.remember', { key, value: { content }, via: 'lit', type: 'cell', tags: [`doc:${docId}`] });
}
async function writeOrder(docId: string, key: string, seq: number, fold: boolean): Promise<void> {
  await act('workspace.remember', { key: `_doc/${docId}/${key}`, value: { seq, fold }, via: 'lit', type: 'doc-order', tags: [`doc:${docId}`] });
}
async function saveDocMeta(docId: string, meta: DocValue): Promise<void> {
  await act('workspace.remember', { key: `doc:${docId}`, value: meta, via: 'lit', type: 'doc', tags: ['doc'] });
}
/** Save an edited cell, splitting only if the edit introduced structure (a
 *  heading or a code fence): the first part keeps the fact's key (links/seq),
 *  the rest become new facts placed with fractional seq between this cell and
 *  the next — identity is inherent, never a whole-document reparse. */
async function saveCellSplit(docId: string, cell: LoadedCell, nextSeq: number | null, source: string): Promise<void> {
  const parts = splitCells(source);
  if (parts.length <= 1) { await saveCell(docId, cell.key, (parts[0] ?? source).trim()); return; }
  await saveCell(docId, cell.key, parts[0]);
  let lo = cell.seq;
  for (const part of parts.slice(1)) {
    const seq = seqBetween(lo, nextSeq);
    const k = mintCell();
    await saveCell(docId, k, part);
    await writeOrder(docId, k, seq, false);
    lo = seq;
  }
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
interface Fence { lang: string; arg: string; file?: string; directives: Set<string>; attrs: Record<string, string>; tags: string[]; in?: string; out?: string }
/** Parse a dotlit-style fence info-string: `lang [file|uri] !dir attr=val #tag < in > out`.
 *  `arg` resolves the bare file/uri token, else the fence body — so both
 *  `view open-claims` (id in the info-string) and the legacy `view\nopen-claims`
 *  (id in the body) work. The metadata (viewer=, repl=, !dir, #tag, in/out) is
 *  what turns a fence into a declaration — the seam to plugins/viewers/actions. */
function parseFence(info: string, body: string): Fence {
  const toks = info.trim().split(/\s+/).filter(Boolean);
  const lang = toks.shift() ?? '';
  const directives = new Set<string>();
  const attrs: Record<string, string> = {};
  const tags: string[] = [];
  let file: string | undefined, inp: string | undefined, out: string | undefined;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '<') inp = toks[++i];
    else if (t === '>') out = toks[++i];
    else if (t.startsWith('!')) directives.add(t.slice(1));
    else if (t.startsWith('#')) tags.push(t.slice(1));
    else if (t.includes('=')) attrs[t.slice(0, t.indexOf('='))] = t.slice(t.indexOf('=') + 1);
    else if (file === undefined) file = t;
  }
  return { lang, arg: file ?? body, file, directives, attrs, tags, in: inp, out };
}

async function enhanceFences(root: HTMLElement): Promise<void> {
  // Iterate <pre data-fence> (set by the shared renderer) so the full meta-grammar
  // — not just the first-word lang — drives routing.
  for (const pre of Array.from(root.querySelectorAll('pre[data-fence]')) as HTMLElement[]) {
    const body = (pre.querySelector('code')?.textContent || '').trim();
    const fence = parseFence(pre.dataset.fence || '', body);
    const lang = fence.lang;
    if (!lang) continue;
    const arg = fence.arg;
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
          });
          box.replaceWith(node);
        })
        .catch((err) => { box.textContent = `run: ${(err as Error).message}`; });
      continue;
    }
    if (lang === 'board') {
      const wrap = el('div', 'embed-board');
      const frame = document.createElement('iframe');
      const w = Math.round(Math.min(680, root.clientWidth || 680));
      frame.src = cellUrl(cellOwner(), 'canvas', `?view=${encodeURIComponent(arg)}&embed=1&w=${w}&h=340`);
      frame.loading = 'lazy';
      wrap.appendChild(frame);
      const open = el('a', 'embed-open', 'open board ↗') as HTMLAnchorElement;
      open.href = cellUrl(cellOwner(), 'canvas', `?view=${encodeURIComponent(arg)}`);
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
}
function CellView({ cellKey, content, fold, editable, onEdit, onFold, onMove, onAddAfter }: CellProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const md = content;

  // After the body mounts/changes, enhance fences (executable / viewer / plugin).
  useEffect(() => {
    const host = bodyRef.current;
    if (!host || fold || editing !== null) return;
    void enhanceFences(host);
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
  return (
    <article className={`block${fold ? ' is-folded' : ''}`} data-key={cellKey}>
      {editable ? (
        <div className="block-tools">
          <button className="tool" onClick={onFold}>{fold ? '▸' : '▾'}</button>
          <button className="tool" onClick={() => setEditing(md)}>✎</button>
          <button className="tool" onClick={() => onMove(-1)}>↑</button>
          <button className="tool" onClick={() => onMove(1)}>↓</button>
          <button className="tool" title="add a cell after" onClick={onAddAfter}>＋</button>
        </div>
      ) : null}
      {fold ? (
        <div className="block-body"><p className="folded">▸ {title.replace(/[#*_`]/g, '').trim()}</p></div>
      ) : (
        <div className="block-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      )}
    </article>
  );
}

/* ── doc editor ────────────────────────────────────────────────────────── */

function DocEditor({ docId, editable }: { docId: string; editable: boolean }): React.JSX.Element {
  const [meta, setMeta] = useState<DocValue | null>(null);
  const [cells, setCells] = useState<LoadedCell[]>([]);
  const [missing, setMissing] = useState(false);
  const [projection, setProjection] = useState<'narrative' | 'salience'>('narrative');

  const load = useCallback(async () => {
    const res = await loadDoc(docId, projection);
    if (!res) { setMissing(true); return; }
    setMeta(res.meta); setCells(res.cells);
  }, [docId, projection]);
  useEffect(() => { void load(); }, [load]);

  if (missing) return <ListEditor.MissingDoc docId={docId} />;
  if (!meta) return <p className="boot">loading {docId}…</p>;

  // A doc is a view: cells are facts ordered by `_doc/` decorations. Editing one
  // cell may split it (saveCellSplit); reorder/insert are one fractional-seq write.
  const nextSeq = (i: number): number | null => (i + 1 < cells.length ? cells[i + 1].seq : null);

  return (
    <>
      <header>
        <a className="back" href={`/@${cellOwner()}/lit`}>← documents</a>
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
            ? <button className="btn add-block" onClick={async () => { const k = mintCell(); await saveCell(docId, k, `# ${meta.title || docId}\n\nStart writing…`); await writeOrder(docId, k, 1, false); await load(); }}>＋ first cell</button>
            : <p className="boot">empty document</p>
        ) : cells.map((c, i) => (
          <CellView
            key={c.key}
            cellKey={c.key}
            content={c.content}
            fold={c.fold}
            editable={editable && projection === 'narrative'}
            onEdit={async (src) => { await saveCellSplit(docId, c, nextSeq(i), src); await load(); }}
            onFold={async () => { await writeOrder(docId, c.key, c.seq, !c.fold); setCells((cs) => cs.map((x) => (x.key === c.key ? { ...x, fold: !x.fold } : x))); }}
            onMove={async (dir) => {
              const j = i + dir; if (j < 0 || j >= cells.length) return;
              const lower = dir < 0 ? (i - 2 >= 0 ? cells[i - 2].seq : null) : cells[i + 1].seq;
              const upper = dir < 0 ? cells[i - 1].seq : (i + 2 < cells.length ? cells[i + 2].seq : null);
              await writeOrder(docId, c.key, seqBetween(lower, upper), c.fold); await load();
            }}
            onAddAfter={async () => { const k = mintCell(); await saveCell(docId, k, '_new cell_'); await writeOrder(docId, k, seqBetween(c.seq, nextSeq(i)), false); await load(); }}
          />
        ))}
        {editable ? <a className="add-block btn" href={cellUrl(cellOwner(), 'input')}>+ capture</a> : null}
      </main>
    </>
  );
}

/* ── list ──────────────────────────────────────────────────────────────── */

function ListEditor({ editable, seed }: { editable: boolean; seed?: ListSeed }): React.JSX.Element {
  // Seed from the SSR ViewModel (no "loading documents…" gap); the effect refreshes.
  const [docs, setDocs] = useState<Array<{ id: string; v: DocValue; updated: string }> | null>(seed ?? null);
  useEffect(() => {
    void (async () => {
      const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'doc', limit: 100 });
      const list = (res.entries ?? []).filter((e) => e.key.startsWith('doc:'))
        .sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'))
        .map((e) => ({ id: e.key.slice(4), v: e.value as DocValue, updated: e._meta?.updatedAt ?? '' }));
      setDocs(list);
    })();
  }, []);

  const today = new Date().toISOString().split('T')[0];
  return (
    <>
      <header>
        <h1>lit</h1>
        <p className="summary">documents — ordered paths through the substrate</p>
        {editable ? <a className="back" href={`?doc=log:${today}`}>📥 today's log →</a> : null}
      </header>
      <main className="doc-list">
        {docs === null ? <p className="boot">loading documents…</p> : docs.length === 0 ? <p className="boot">no documents yet</p> : docs.map((d) => (
          <a className="doc-card" href={`?doc=${encodeURIComponent(d.id)}`} key={d.id}>
            <h2>{d.v.title || d.id}</h2>
            {d.v.summary ? <p>{d.v.summary}</p> : null}
            <span className="doc-meta">{(d.updated || '').slice(0, 10)}</span>
          </a>
        ))}
      </main>
      {editable ? (
        <button className="btn add-block" onClick={async () => {
          const title = prompt('Title?'); if (!title) return;
          const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `d${Date.now().toString(36)}`;
          await saveDocMeta(id, { title });
          const k = mintCell();
          await saveCell(id, k, `# ${title}\n\nStart writing…`);
          await writeOrder(id, k, 1, false);
          location.search = `?doc=${encodeURIComponent(id)}`;
        }}>+ new document</button>
      ) : null}
    </>
  );
}
ListEditor.MissingDoc = function MissingDoc({ docId }: { docId: string }): React.JSX.Element {
  return (
    <>
      <header><a className="back" href={`/@${cellOwner()}/lit`}>← documents</a><h1>{docId}</h1></header>
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
  return <p className="summary">{links.map(([t, id]) => <a className="back" style={{ marginRight: '0.8rem' }} href={`?doc=log:${encodeURIComponent(id)}`} key={id}>{t}</a>)}</p>;
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
      <header><a className="back" href={location.pathname}>← documents</a><h1>📥 {label}</h1><LogNav label={label} /></header>
      <main>
        {groups === null ? <p className="boot">loading…</p> : groups.length === 0 || groups.every(([, e]) => !e.length)
          ? <p className="boot">{isDay ? 'nothing captured this day' : 'nothing captured in this period'}</p>
          : groups.map(([day, entries]) => (
            <React.Fragment key={day || 'day'}>
              {day ? <h2><a className="back" href={`?doc=log:${encodeURIComponent(day)}`}>🗓️ {day}</a></h2> : null}
              {entries.map((e) => <LogEntry e={e} key={e.key} />)}
            </React.Fragment>
          ))}
        <a className="add-block btn" href={cellUrl(cellOwner(), 'input')}>+ capture</a>
      </main>
    </>
  );
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
type DocSeed = { doc: DocValue; facts: Record<string, Entry | null> };
type ListSeed = Array<{ id: string; v: DocValue; updated: string }>;

function docSeed(vm: Extract<ViewModel, { kind: 'doc' }>): DocSeed {
  const facts: Record<string, Entry | null> = {};
  for (const b of vm.blocks) facts[b.key] = { key: b.key, value: { content: b.md } };
  return {
    doc: { title: vm.title, summary: vm.summary, blocks: vm.blocks.map((b) => ({ key: b.key, fold: b.fold })) },
    facts,
  };
}
function listSeed(vm: Extract<ViewModel, { kind: 'list' }>): ListSeed {
  // Only `.length`, title, summary and updated are read for the cards; the real
  // BlockRef contents arrive with the background refresh.
  return vm.docs.map((d) => ({
    id: d.id,
    v: { title: d.title, summary: d.summary, blocks: new Array(d.blocks).fill({ key: '' }) },
    updated: d.updated,
  }));
}

function Route({ editable, initialVm }: { editable: boolean; initialVm: ViewModel | null }): React.JSX.Element {
  const docId = new URLSearchParams(location.search).get('doc');
  if (docId && /^log:/.test(docId)) return <LogView docId={docId} />;
  if (docId) {
    return <DocEditor docId={docId} editable={editable} />;
  }
  const seed = initialVm && initialVm.kind === 'list' ? listSeed(initialVm) : undefined;
  return <ListEditor editable={editable} seed={seed} />;
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

const initialVm = readInitialVm();
if (appRoot.dataset.ssr === '1' && initialVm) hydrateRoot(appRoot, <App initialVm={initialVm} />);
else { appRoot.textContent = ''; createRoot(appRoot).render(<App initialVm={initialVm} />); }
