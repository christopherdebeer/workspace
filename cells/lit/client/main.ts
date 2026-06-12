/* ---------------------------------------------------------------------------
 * lit — the narrative surface (docs/narrative-surface.md).
 *
 * A document is an ordered path through the SAME facts the canvas places:
 *   doc:<id>   — the document fact { title, blocks: [{ key, fold? }] }
 *   blocks     — plain facts (markdown content); removal from a doc never
 *                deletes the fact (no graduation — the dotlit lesson)
 *
 * Transclusion by fence (the renderer ladder, prose edition):
 *   ```view <id>```    — a registered view, evaluated live
 *   ```board <view>``` — a canvas view embedded (iframe, readonly)
 *   ```cell <cellId>``` — the cell's substrate pointer fact as a card
 *
 * Editing is ephemera until saved; saves go through workspace.remember with
 * via:'lit'. Salience never restructures — folding is explicit (consent).
 * ------------------------------------------------------------------------- */
import './main.css';
(window as any).__lit_module = true; // watchdog marker: the module executed
import { marked } from 'marked';
import { ensureAuth } from './lib/auth.ts';
import { read, act } from './lib/substrate.ts';

interface Meta { type?: string | null; tags?: string[]; updatedAt?: string; superseded?: boolean }
interface Entry { key: string; value: any; _meta?: Meta }
interface BlockRef { key: string; fold?: boolean }
interface DocValue { title: string; summary?: string; blocks: BlockRef[] }

const app = document.getElementById('app')!;
let currentDoc: string | null = null;
let editing = 0; // open editors — suspend live refresh while > 0
let lastSeq = 0;

const cellOwner = (): string => (location.pathname.match(/^\/@([^/]+)\//) || [])[1] ?? 'c15r';

async function fetchFact(key: string): Promise<Entry | null> {
  const res = await read<{ entries: Entry[] }>('workspace.query', { prefix: key, limit: 8 });
  return (res.entries ?? []).find((e) => e.key === key) ?? null;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function contentOf(value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value.content === 'string') return value.content;
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

/* — transclusion — */

async function hydrateFences(root: HTMLElement): Promise<void> {
  for (const code of Array.from(root.querySelectorAll('pre > code'))) {
    const lang = (code.className.match(/language-(\w+)/) || [])[1];
    const arg = (code.textContent || '').trim();
    if (!lang || !arg) continue;
    const pre = code.parentElement as HTMLElement;
    // Pure viewers (json tree / csv table / mermaid / style) — one shared
    // module, same implementations the canvas renderer facts use.
    if (['json', 'csv', 'mermaid', 'style'].includes(lang)) {
      const box = el('div', 'embed-view');
      box.textContent = '…';
      pre.replaceWith(box);
      import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js')
        .then((v) => v.renderFence(box, lang, arg))
        .catch((err) => { box.textContent = `${lang}: ${(err as Error).message}`; });
      continue;
    }
    if (lang === 'board') {
      const wrap = el('div', 'embed-board');
      const frame = document.createElement('iframe');
      frame.src = `/@${cellOwner()}/canvas?view=${encodeURIComponent(arg)}&embed=1`;
      frame.loading = 'lazy';
      wrap.appendChild(frame);
      const open = el('a', 'embed-open', 'open board ↗') as HTMLAnchorElement;
      open.href = `/@${cellOwner()}/canvas?view=${encodeURIComponent(arg)}`;
      wrap.appendChild(open);
      pre.replaceWith(wrap);
    } else if (lang === 'view') {
      const box = el('div', 'embed-view');
      box.textContent = '…';
      pre.replaceWith(box);
      read<{ value: unknown; count: number; render: { label?: string } | null }>('workspace.view', { id: arg })
        .then((res) => {
          box.textContent = '';
          box.appendChild(el('span', 'embed-label', res.render?.label ?? arg));
          const v = res.value;
          if (typeof v === 'number') box.appendChild(el('strong', 'embed-metric', String(v)));
          else if (Array.isArray(v)) {
            const ul = el('ul');
            for (const item of v.slice(0, 8) as Entry[]) ul.appendChild(el('li', '', `${item.key}: ${contentOf(item.value).slice(0, 80)}`));
            box.appendChild(ul);
          } else if (v && typeof v === 'object') {
            box.appendChild(el('pre', '', JSON.stringify((v as Entry).value ?? v, null, 2).slice(0, 600)));
          } else box.appendChild(el('em', '', String(v)));
        })
        .catch((err) => { box.textContent = `view ${arg}: ${err.message}`; });
    } else if (lang === 'cell') {
      const box = el('div', 'embed-cell');
      box.textContent = '…';
      pre.replaceWith(box);
      fetchFact(`cells/${arg}`)
        .then((fact) => {
          if (!fact) { box.textContent = `cell ${arg}: no pointer fact`; return; }
          const v = fact.value;
          box.textContent = '';
          const head = el('div', 'cell-head');
          const a = el('a', 'cell-addr', v.address ?? arg) as HTMLAnchorElement;
          a.href = v.address ?? '#';
          head.appendChild(a);
          head.appendChild(el('span', `cell-status s-${(v.status || '').toLowerCase()}`, v.status ?? '?'));
          if (v.dirty) head.appendChild(el('span', 'cell-dirty', 'edited since deploy'));
          box.appendChild(head);
          box.appendChild(el('div', 'cell-meta', `${(v.files ?? []).length} files · v${v.version ?? '?'}`));
        })
        .catch((err) => { box.textContent = `cell ${arg}: ${err.message}`; });
    }
  }
}

/* — doc view — */

async function saveBlock(key: string, prior: any, content: string): Promise<void> {
  const value = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...prior, content } : { content };
  await act('workspace.remember', { key, value, via: 'lit' });
}

async function saveDoc(docId: string, doc: DocValue): Promise<void> {
  await act('workspace.remember', { key: `doc:${docId}`, value: doc, via: 'lit', type: 'doc', tags: ['doc'] });
}

function blockEditor(initial: string, onDone: (text: string | null) => void): HTMLElement {
  const wrap = el('div', 'editor');
  const ta = document.createElement('textarea');
  ta.value = initial;
  ta.rows = Math.min(24, Math.max(4, initial.split('\n').length + 1));
  const bar = el('div', 'editor-bar');
  const save = el('button', 'btn primary', 'save');
  const cancel = el('button', 'btn', 'cancel');
  bar.append(save, cancel);
  wrap.append(ta, bar);
  save.onclick = () => onDone(ta.value);
  cancel.onclick = () => onDone(null);
  return wrap;
}

async function renderDoc(docId: string): Promise<void> {
  currentDoc = docId;
  app.textContent = '';
  const docFact = await fetchFact(`doc:${docId}`);
  if (!docFact) {
    // Virtual log docs: ?doc=log:<date> is a VIEW over the day tag — the
    // daily log is a query, not a file (the Input Buffer lesson, fixed).
    if (/^log:/.test(docId)) {
      await renderLogDoc(docId);
      return;
    }
    app.appendChild(el('p', 'boot', `no document “${docId}”`));
    return;
  }
  const doc = docFact.value as DocValue;
  const header = el('header');
  const back = el('a', 'back', '← documents') as HTMLAnchorElement;
  back.href = location.pathname;
  header.appendChild(back);
  header.appendChild(el('h1', '', doc.title || docId));
  if (doc.summary) header.appendChild(el('p', 'summary', doc.summary));
  app.appendChild(header);

  const main = el('main');
  app.appendChild(main);

  const refs = Array.isArray(doc.blocks) ? doc.blocks : [];
  const facts = await Promise.all(refs.map((r) => fetchFact(r.key)));

  refs.forEach((ref, i) => {
    const fact = facts[i];
    const art = el('article', 'block');
    art.dataset.key = ref.key;
    const tools = el('div', 'block-tools');
    const foldBtn = el('button', 'tool', ref.fold ? '▸' : '▾');
    const editBtn = el('button', 'tool', '✎');
    const upBtn = el('button', 'tool', '↑');
    const downBtn = el('button', 'tool', '↓');
    const cutBtn = el('button', 'tool', '×');
    tools.append(foldBtn, editBtn, upBtn, downBtn, cutBtn);
    art.appendChild(tools);

    const body = el('div', 'block-body');
    art.appendChild(body);
    const md = fact ? contentOf(fact.value) : `*missing fact — ${ref.key}*`;
    const renderBody = (text: string, folded: boolean): void => {
      if (folded) {
        const title = (text.match(/^#+\s*(.+)$/m) || [])[1] ?? text.split('\n').find((l) => l.trim()) ?? ref.key;
        body.innerHTML = '';
        body.appendChild(el('p', 'folded', `▸ ${title.replace(/[#*_`]/g, '').trim()}`));
        art.classList.add('is-folded');
      } else {
        body.innerHTML = marked.parse(text) as string;
        art.classList.remove('is-folded');
        void hydrateFences(body);
      }
    };
    renderBody(md, !!ref.fold);

    foldBtn.onclick = async () => {
      ref.fold = !ref.fold;
      foldBtn.textContent = ref.fold ? '▸' : '▾';
      renderBody(fact ? contentOf(fact.value) : md, !!ref.fold);
      await saveDoc(docId, doc);
    };
    editBtn.onclick = () => {
      if (art.querySelector('.editor')) return;
      editing++;
      const ed = blockEditor(fact ? contentOf(fact.value) : '', async (text) => {
        editing--;
        ed.remove();
        body.style.display = '';
        if (text !== null && fact) {
          fact.value = typeof fact.value === 'object' && fact.value ? { ...fact.value, content: text } : { content: text };
          await saveBlock(ref.key, fact.value, text);
          renderBody(text, false);
        }
      });
      body.style.display = 'none';
      art.appendChild(ed);
    };
    const swap = async (j: number): Promise<void> => {
      if (j < 0 || j >= refs.length) return;
      [doc.blocks[i], doc.blocks[j]] = [doc.blocks[j], doc.blocks[i]];
      await saveDoc(docId, doc);
      void renderDoc(docId);
    };
    upBtn.onclick = () => void swap(i - 1);
    downBtn.onclick = () => void swap(i + 1);
    cutBtn.onclick = async () => {
      if (!confirm('Remove this block from the document? (the fact itself survives)')) return;
      doc.blocks.splice(i, 1);
      await saveDoc(docId, doc);
      void renderDoc(docId);
    };

    main.appendChild(art);
  });

  const addBtn = el('button', 'btn add-block', '+ block');
  addBtn.onclick = () => {
    if (main.querySelector(':scope > .editor')) return;
    editing++;
    const ed = blockEditor('', async (text) => {
      editing--;
      ed.remove();
      if (text === null || !text.trim()) return;
      const key = `blk:${Date.now().toString(36)}`;
      await act('workspace.remember', {
        key,
        value: { content: text },
        via: 'lit',
        type: 'doc-block',
        tags: [`doc:${docId}`],
      });
      doc.blocks.push({ key });
      await saveDoc(docId, doc);
      void renderDoc(docId);
    });
    main.appendChild(ed);
  };
  app.appendChild(addBtn);
}

/* — doc list — */

/** Log surfaces, dotlit-shaped: day → week → month → year, all VIEWS.
 *  log:YYYY-MM-DD = the day (tag query); log:YYYY-Www / log:YYYY-MM /
 *  log:YYYY = rollups grouped by day, derived from each capture's
 *  \`captured\` field — no rollup files, no copies. */
const isoWeekOf = (d: string): string => {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd + 3);
  const y = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return `${y}-w${String(1 + Math.round(((+dt - +jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

function logNav(label: string): HTMLElement {
  const p = el('p', 'summary');
  const add = (txt: string, id: string): void => {
    const a = el('a', 'back', txt) as HTMLAnchorElement;
    a.href = `?doc=log:${encodeURIComponent(id)}`;
    a.style.marginRight = '0.8rem';
    p.appendChild(a);
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    add(`week ${isoWeekOf(label).slice(5)}`, isoWeekOf(label));
    add(`month ${label.slice(5, 7)}`, label.slice(0, 7));
    add(`year ${label.slice(0, 4)}`, label.slice(0, 4));
  } else if (/^\d{4}-w\d{2}$/.test(label)) {
    add(`year ${label.slice(0, 4)}`, label.slice(0, 4));
  } else if (/^\d{4}-\d{2}$/.test(label)) {
    add(`year ${label.slice(0, 4)}`, label.slice(0, 4));
  }
  return p;
}

function logBlock(e: Entry): HTMLElement {
  const art = el('article', 'block');
  art.dataset.key = e.key;
  const body = el('div', 'block-body');
  body.innerHTML = marked.parse(contentOf(e.value)) as string;
  art.appendChild(body);
  void hydrateFences(body);
  return art;
}

async function renderLogDoc(docId: string): Promise<void> {
  const label = docId.slice(4);
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(label);
  const header = el('header');
  const back = el('a', 'back', '← documents') as HTMLAnchorElement;
  back.href = location.pathname;
  header.appendChild(back);
  header.appendChild(el('h1', '', `📥 ${label}`));
  header.appendChild(logNav(label));
  app.appendChild(header);
  const main = el('main');
  app.appendChild(main);

  if (isDay) {
    const res = await read<{ entries: Entry[] }>('workspace.query', { tag: docId, limit: 200 });
    const items = (res.entries ?? [])
      .filter((e) => !e.key.startsWith('log:'))
      .sort((a, b) => Date.parse(a._meta?.updatedAt ?? '0') - Date.parse(b._meta?.updatedAt ?? '0'));
    if (!items.length) main.appendChild(el('p', 'boot', 'nothing captured this day'));
    for (const e of items) main.appendChild(logBlock(e));
  } else {
    // Rollup: group this period's captures by day (derived, not stored).
    const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'capture', limit: 250 });
    const match = (d: string): boolean =>
      /^\d{4}-w\d{2}$/.test(label) ? isoWeekOf(d) === label : d.startsWith(label);
    const byDay = new Map<string, Entry[]>();
    for (const e of res.entries ?? []) {
      const d = (e.value as { captured?: string } | undefined)?.captured;
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && match(d)) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(e);
      }
    }
    const days = [...byDay.keys()].sort();
    if (!days.length) main.appendChild(el('p', 'boot', 'nothing captured in this period'));
    for (const d of days) {
      const h = el('h2');
      const a = el('a', 'back', `🗓️ ${d}`) as HTMLAnchorElement;
      a.href = `?doc=log:${encodeURIComponent(d)}`;
      h.appendChild(a);
      main.appendChild(h);
      for (const e of byDay.get(d)!) main.appendChild(logBlock(e));
    }
  }
  const cap = el('a', 'add-block btn', '+ capture') as HTMLAnchorElement;
  cap.href = `/@${cellOwner()}/input`;
  app.appendChild(cap);
}

async function renderList(): Promise<void> {
  currentDoc = null;
  app.textContent = '';
  const header = el('header');
  header.appendChild(el('h1', '', 'lit'));
  header.appendChild(el('p', 'summary', 'documents — ordered paths through the substrate'));
  const todayLink = el('a', 'back', `📥 today's log →`) as HTMLAnchorElement;
  todayLink.href = `?doc=log:${new Date().toISOString().split('T')[0]}`;
  header.appendChild(todayLink);
  app.appendChild(header);
  const list = el('main', 'doc-list');
  app.appendChild(list);
  const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'doc', limit: 100 });
  const docs = (res.entries ?? []).filter((e) => e.key.startsWith('doc:'));
  docs.sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'));
  for (const d of docs) {
    const id = d.key.slice(4);
    const v = d.value as DocValue;
    const card = el('a', 'doc-card') as HTMLAnchorElement;
    card.href = `?doc=${encodeURIComponent(id)}`;
    card.appendChild(el('h2', '', v.title || id));
    if (v.summary) card.appendChild(el('p', '', v.summary));
    card.appendChild(el('span', 'doc-meta', `${(v.blocks ?? []).length} blocks · ${(d._meta?.updatedAt ?? '').slice(0, 10)}`));
    list.appendChild(card);
  }
  if (!docs.length) list.appendChild(el('p', 'boot', 'no documents yet'));
  const newBtn = el('button', 'btn add-block', '+ new document');
  newBtn.onclick = async () => {
    const title = prompt('Title?');
    if (!title) return;
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `d${Date.now().toString(36)}`;
    await saveDoc(id, { title, blocks: [] });
    location.search = `?doc=${encodeURIComponent(id)}`;
  };
  app.appendChild(newBtn);
}

/* — live refresh (the change feed; suspended while editing) — */

function startLive(): void {
  const tick = async (): Promise<void> => {
    try {
      if (lastSeq === 0) {
        lastSeq = (await read<{ seq: number }>('workspace.changes', { sinceSeq: 0, limit: 0 })).seq;
      } else {
        const res = await read<{ events: Array<{ key: string | null }>; seq: number }>('workspace.changes', { sinceSeq: lastSeq });
        lastSeq = res.seq;
        if (!editing && currentDoc) {
          const mine = new Set([`doc:${currentDoc}`]);
          for (const a of Array.from(document.querySelectorAll('article.block'))) mine.add((a as HTMLElement).dataset.key!);
          if ((res.events ?? []).some((e) => e.key && mine.has(e.key))) void renderDoc(currentDoc);
        }
      }
    } catch { /* offline — next tick */ }
    setTimeout(() => void tick(), 8000);
  };
  setTimeout(() => void tick(), 8000);
}

/* — boot — */

/** Live boot narration: the shell's "loading…" line tells you which step. */
function bootStatus(msg: string): void {
  const b = document.querySelector('#app .boot');
  if (b) b.textContent = msg;
}

function bootFail(err: Error): void {
  const banner = document.getElementById('err-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = `boot failed: ${err.message}`;
  }
  bootStatus(`failed — ${err.message}`);
}

async function boot(): Promise<void> {
  document.addEventListener('lit:auth-warn', (e) =>
    bootStatus(`sign-in return failed (${(e as CustomEvent).detail}) — retrying…`),
  );
  bootStatus('signing in…');
  await ensureAuth();
  const doc = new URLSearchParams(location.search).get('doc');
  bootStatus(doc ? `loading ${doc}…` : 'loading documents…');
  if (doc) await renderDoc(doc);
  else await renderList();
  startLive();
}

void boot().catch(bootFail);
