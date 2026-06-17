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
import { Surface, renderMarkdown, type ViewModel, type BlockData, type DocValue } from '../shared';

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
async function saveBlock(key: string, prior: any, content: string): Promise<void> {
  const value = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...prior, content } : { content };
  await act('workspace.remember', { key, value, via: 'lit' });
}
async function saveDoc(docId: string, doc: DocValue): Promise<void> {
  await act('workspace.remember', { key: `doc:${docId}`, value: doc, via: 'lit', type: 'doc', tags: ['doc'] });
}
/** The renderer ladder: a fact whose type declares a viewer renders through
 *  @c15r/viewers instead of as markdown (el:demo-json reads as a TREE here). */
function viewerFor(meta: Meta | undefined, value: any): string | null {
  for (const t of [meta?.type, value?.type].filter(Boolean) as string[]) {
    if (typeDecls[t]?.viewer) return typeDecls[t]!.viewer!;
  }
  return null;
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

interface BlockProps {
  ref0: { key: string; fold?: boolean };
  fact: Entry | null;
  editable: boolean;
  onEdit: (text: string) => void;
  onFold: () => void;
  onMove: (dir: -1 | 1) => void;
  onCut: () => void;
}
function BlockView({ ref0, fact, editable, onEdit, onFold, onMove, onCut }: BlockProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const md = fact ? contentOf(fact.value) : `*missing fact — ${ref0.key}*`;
  const viewer = fact ? viewerFor(fact._meta, fact.value) : null;
  const folded = !!ref0.fold;

  // Enhance fences (or apply the viewer ladder) after the body mounts/changes.
  useEffect(() => {
    const host = bodyRef.current;
    if (!host || folded || editingText !== null) return;
    if (viewer && fact) {
      host.textContent = '…';
      import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js')
        .then((m) => {
          host.textContent = '';
          const h = el('div'); host.appendChild(h);
          if (!m.renderFence(h, viewer, contentOf(fact.value), fact.key)) { host.innerHTML = renderMarkdown(md); void enhanceFences(host); }
        })
        .catch(() => { host.innerHTML = renderMarkdown(md); void enhanceFences(host); });
    } else {
      void enhanceFences(host);
    }
  }, [md, viewer, folded, editingText]);

  if (editingText !== null) {
    return (
      <article className="block" data-key={ref0.key}>
        <div className="editor">
          <textarea
            value={editingText}
            rows={Math.min(24, Math.max(4, editingText.split('\n').length + 1))}
            onChange={(e) => setEditingText(e.target.value)}
          />
          <div className="editor-bar">
            <button className="btn primary" onClick={() => { onEdit(editingText); setEditingText(null); }}>save</button>
            <button className="btn" onClick={() => setEditingText(null)}>cancel</button>
          </div>
        </div>
      </article>
    );
  }

  const title = (md.match(/^#+\s*(.+)$/m) || [])[1] ?? md.split('\n').find((l) => l.trim()) ?? ref0.key;
  return (
    <article className={`block${folded ? ' is-folded' : ''}`} data-key={ref0.key}>
      {editable ? (
        <div className="block-tools">
          <button className="tool" onClick={onFold}>{folded ? '▸' : '▾'}</button>
          <button className="tool" onClick={() => setEditingText(contentOf(fact?.value ?? ''))}>✎</button>
          <button className="tool" onClick={() => onMove(-1)}>↑</button>
          <button className="tool" onClick={() => onMove(1)}>↓</button>
          <button className="tool" onClick={onCut}>×</button>
        </div>
      ) : null}
      {folded ? (
        <div className="block-body"><p className="folded">▸ {title.replace(/[#*_`]/g, '').trim()}</p></div>
      ) : (
        <div className="block-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      )}
    </article>
  );
}

/* ── doc editor ────────────────────────────────────────────────────────── */

function DocEditor({ docId, editable, seed }: { docId: string; editable: boolean; seed?: DocSeed }): React.JSX.Element {
  // Seed from the SSR ViewModel so the first interactive render IS the server
  // content — no "loading…" gap while load() refetches. load() refreshes in place.
  const [doc, setDoc] = useState<DocValue | null>(seed?.doc ?? null);
  const [facts, setFacts] = useState<Record<string, Entry | null>>(seed?.facts ?? {});
  const [missing, setMissing] = useState(false);
  const editingRef = useRef(0);

  const load = useCallback(async () => {
    const docFact = await fetchFact(`doc:${docId}`);
    if (!docFact) { setMissing(true); return; }
    const dv = docFact.value as DocValue;
    const refs = Array.isArray(dv.blocks) ? dv.blocks : [];
    const got = await Promise.all(refs.map((r) => fetchFact(r.key)));
    const map: Record<string, Entry | null> = {};
    refs.forEach((r, i) => { map[r.key] = got[i]; });
    setFacts(map); setDoc(dv);
  }, [docId]);

  useEffect(() => { void load(); }, [load]);

  // Live refresh: refetch when a block in this doc changes (suspended while editing).
  useEffect(() => {
    if (!editable) return;
    let seq = 0; let stop = false;
    const tick = async (): Promise<void> => {
      try {
        if (seq === 0) seq = (await read<{ seq: number }>('workspace.changes', { sinceSeq: 0, limit: 0 })).seq;
        else {
          const res = await read<{ events: Array<{ key: string | null }>; seq: number }>('workspace.changes', { sinceSeq: seq });
          seq = res.seq;
          const mine = new Set([`doc:${docId}`, ...(doc?.blocks ?? []).map((b) => b.key)]);
          if (editingRef.current === 0 && (res.events ?? []).some((e) => e.key && mine.has(e.key))) await load();
        }
      } catch { /* offline */ }
      if (!stop) setTimeout(() => void tick(), 8000);
    };
    setTimeout(() => void tick(), 8000);
    return () => { stop = true; };
  }, [editable, docId, doc, load]);

  if (missing) return <ListEditor.MissingDoc docId={docId} />;
  if (!doc) return <p className="boot">loading {docId}…</p>;

  const refs = Array.isArray(doc.blocks) ? doc.blocks : [];
  const mutate = async (next: DocValue): Promise<void> => { setDoc(next); await saveDoc(docId, next); };

  return (
    <>
      <header>
        <a className="back" href={`/@${cellOwner()}/lit`}>← documents</a>
        <h1>{doc.title || docId}</h1>
        {doc.summary ? <p className="summary">{doc.summary}</p> : null}
      </header>
      <main>
        {refs.length === 0 ? <p className="boot">empty document</p> : refs.map((r, i) => (
          <BlockView
            key={r.key}
            ref0={r}
            fact={facts[r.key] ?? null}
            editable={editable}
            onEdit={async (text) => {
              const prior = facts[r.key]?.value;
              await saveBlock(r.key, prior, text);
              setFacts((f) => ({ ...f, [r.key]: { key: r.key, value: typeof prior === 'object' && prior ? { ...prior, content: text } : { content: text } } }));
            }}
            onFold={() => { const blocks = refs.map((b, j) => (j === i ? { ...b, fold: !b.fold } : b)); void mutate({ ...doc, blocks }); }}
            onMove={(dir) => { const j = i + dir; if (j < 0 || j >= refs.length) return; const blocks = refs.slice(); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; void mutate({ ...doc, blocks }); }}
            onCut={() => { if (!confirm('Remove this block from the document? (the fact itself survives)')) return; void mutate({ ...doc, blocks: refs.filter((_, j) => j !== i) }); }}
          />
        ))}
        {editable ? (
          <AddBlock onAdd={async (text) => {
            const key = `blk:${Date.now().toString(36)}`;
            await act('workspace.remember', { key, value: { content: text }, via: 'lit', type: 'doc-block', tags: [`doc:${docId}`] });
            await mutate({ ...doc, blocks: [...refs, { key }] });
            setFacts((f) => ({ ...f, [key]: { key, value: { content: text } } }));
          }} onOpen={(o) => { editingRef.current += o ? 1 : -1; }} />
        ) : null}
        {editable ? <a className="add-block btn" href={cellUrl(cellOwner(), 'input')}>+ capture</a> : null}
      </main>
    </>
  );
}

function AddBlock({ onAdd, onOpen }: { onAdd: (t: string) => void; onOpen: (open: boolean) => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  if (text === null) return <button className="btn add-block" onClick={() => { setText(''); onOpen(true); }}>+ block</button>;
  return (
    <div className="editor">
      <textarea value={text} rows={Math.min(24, Math.max(4, text.split('\n').length + 1))} onChange={(e) => setText(e.target.value)} />
      <div className="editor-bar">
        <button className="btn primary" onClick={() => { if (text.trim()) onAdd(text); setText(null); onOpen(false); }}>save</button>
        <button className="btn" onClick={() => { setText(null); onOpen(false); }}>cancel</button>
      </div>
    </div>
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
            <span className="doc-meta">{(d.v.blocks ?? []).length} blocks · {(d.updated || '').slice(0, 10)}</span>
          </a>
        ))}
      </main>
      {editable ? (
        <button className="btn add-block" onClick={async () => {
          const title = prompt('Title?'); if (!title) return;
          const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `d${Date.now().toString(36)}`;
          await saveDoc(id, { title, blocks: [] });
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
    const seed = initialVm && initialVm.kind === 'doc' && initialVm.id === docId ? docSeed(initialVm) : undefined;
    return <DocEditor docId={docId} editable={editable} seed={seed} />;
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
      try { await ensureAuth(); typeDecls = (await loadTypes().catch(() => ({}))) as Record<string, { viewer?: string }>; }
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
