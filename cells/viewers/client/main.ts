/**
 * The pure viewers — transformers of the deterministic, free, secretless
 * kind: content in, presentation out, no model, no key, no side effects.
 *
 * Each export is a canvas ElementView ({mount, update, unmount}) so a
 * `_renderers/<type>` fact can adopt it with a one-line re-export; and
 * `renderFence(host, lang, code)` serves lit's fenced blocks from the
 * same implementations. dotlit lineage: viewer=style was its most-used
 * organic viewer; graph (mermaid) and meta (json) close behind.
 */

/* ── shared chrome ──────────────────────────────────────────────── */

let cssInjected = false;
function injectCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const s = document.createElement('style');
  s.id = 'viewers-css';
  s.textContent = `
.vw { font: 12px/1.5 ui-monospace, Menlo, monospace; overflow: auto; padding: 0.5em 0.7em; background: #fff; border-radius: 8px; box-sizing: border-box; width: 100%; height: 100%; }
.vw-json details { padding-left: 1em; }
.vw-json summary { cursor: pointer; color: #555; list-style: none; }
.vw-json summary::before { content: '▸ '; color: #aaa; }
.vw-json details[open] > summary::before { content: '▾ '; }
.vw-json .k { color: #2f6f4f; }
.vw-json .s { color: #8a4f2f; }
.vw-json .n { color: #2f4f8a; }
.vw-json .b { color: #8a2f6f; }
.vw-json .z { color: #999; }
.vw-csv table { border-collapse: collapse; font-size: 11px; width: max-content; min-width: 100%; }
.vw-csv th { position: sticky; top: 0; background: #f4f4ee; text-align: left; }
.vw-csv th, .vw-csv td { border: 1px solid #e4e4dc; padding: 2px 8px; white-space: nowrap; }
.vw-csv tr:nth-child(even) td { background: #fafaf7; }
.vw-style { display: flex; align-items: center; gap: 0.5em; color: #8a8a82; font: 11px system-ui, sans-serif; padding: 0.5em 0.7em; }
.vw-style code { color: #2f6f4f; }
.vw-mermaid { display: flex; align-items: center; justify-content: center; background: #fff; }
.vw-mermaid svg { max-width: 100%; max-height: 100%; }
.vw-err { color: #7a1f1f; font: 11px ui-monospace, monospace; padding: 0.5em 0.7em; white-space: pre-wrap; }
`;
  document.head.appendChild(s);
}

const contentOf = (el: { content?: unknown }): string => (typeof el.content === 'string' ? el.content : '');

/* ── json: collapsible tree ─────────────────────────────────────── */

function jsonNode(value: unknown, key?: string): HTMLElement {
  const keySpan = key !== undefined ? `<span class="k">${escapeHtml(key)}</span>: ` : '';
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
    const d = document.createElement('details');
    if (entries.length <= 8) d.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = `${keySpan}${Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}`;
    d.appendChild(sum);
    for (const [k, v] of entries) d.appendChild(jsonNode(v, k));
    return d;
  }
  const div = document.createElement('div');
  const cls = typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 'z';
  const text = typeof value === 'string' ? `"${escapeHtml(value.length > 200 ? value.slice(0, 200) + '…' : value)}"` : String(value);
  div.innerHTML = `${keySpan}<span class="${cls}">${text}</span>`;
  return div;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderJson(host: HTMLElement, code: string): void {
  injectCss();
  host.classList.add('vw', 'vw-json');
  host.textContent = '';
  try {
    host.appendChild(jsonNode(JSON.parse(code)));
  } catch (err) {
    host.innerHTML = `<div class="vw-err">invalid JSON: ${escapeHtml((err as Error).message)}</div><pre>${escapeHtml(code.slice(0, 800))}</pre>`;
  }
}

/* ── csv: table (quoted-field aware) ────────────────────────────── */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function renderCsv(host: HTMLElement, code: string): void {
  injectCss();
  host.classList.add('vw', 'vw-csv');
  host.textContent = '';
  const rows = parseCsv(code.trim());
  if (!rows.length) { host.textContent = '(empty)'; return; }
  const table = document.createElement('table');
  const [head, ...body] = rows;
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const h of head) { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); }
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of body.slice(0, 500)) {
    const trb = document.createElement('tr');
    for (let i = 0; i < head.length; i++) { const td = document.createElement('td'); td.textContent = r[i] ?? ''; trb.appendChild(td); }
    tbody.appendChild(trb);
  }
  table.appendChild(tbody);
  host.appendChild(table);
  if (body.length > 500) {
    const note = document.createElement('div');
    note.textContent = `… ${body.length - 500} more rows`;
    host.appendChild(note);
  }
}

/* ── mermaid: diagram via CDN (cached module) ───────────────────── */

let mermaidMod: Promise<{ render: (id: string, code: string) => Promise<{ svg: string }> }> | null = null;
function loadMermaid() {
  if (!mermaidMod) {
    mermaidMod = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      return m.default;
    });
  }
  return mermaidMod;
}

let mermaidSeq = 0;
function renderMermaid(host: HTMLElement, code: string): void {
  injectCss();
  host.classList.add('vw', 'vw-mermaid');
  host.textContent = '…';
  loadMermaid()
    .then((m) => m.render(`vwm${++mermaidSeq}`, code))
    .then(({ svg }) => { host.innerHTML = svg; })
    .catch((err) => { host.innerHTML = `<div class="vw-err">mermaid: ${escapeHtml((err as Error).message ?? String(err))}</div>`; });
}

/* ── style: CSS-as-content (board/document theming — global, like
      dotlit's viewer=style; unmount removes it) ──────────────────── */

function renderStyle(host: HTMLElement, code: string, ownerId: string): void {
  injectCss();
  host.classList.add('vw-style');
  const prev = document.querySelector(`style[data-vw-style="${ownerId}"]`);
  if (prev) prev.remove();
  const s = document.createElement('style');
  s.setAttribute('data-vw-style', ownerId);
  s.textContent = code;
  document.head.appendChild(s);
  host.innerHTML = `🎨 <code>style</code> · ${code.length}b applied`;
}

/* ── canvas ElementViews (the _renderers/<type> fact contract) ──── */

type El = { id: string; content?: string; scale?: number; width?: number; height?: number };

function sized(el: El, host: HTMLElement): HTMLElement {
  const s = el.scale || 1;
  if (typeof el.width === 'number') host.style.width = `${el.width * s}px`;
  if (typeof el.height === 'number') host.style.height = `${el.height * s}px`;
  return host;
}

function view(render: (host: HTMLElement, code: string, ownerId: string) => void) {
  return {
    mount(el: El): HTMLElement {
      const host = document.createElement('div');
      host.className = 'content';
      render(host, contentOf(el), el.id);
      return sized(el, host);
    },
    update(el: El, dom: HTMLElement): void {
      if (!dom) return;
      sized(el, dom);
      if (dom.dataset.vw !== contentOf(el)) {
        dom.dataset.vw = contentOf(el);
        render(dom, contentOf(el), el.id);
      }
    },
    unmount(dom: HTMLElement): void {
      const owner = dom?.querySelector?.('[data-vw-style]') ?? null;
      // style elements clean their global sheet up via ownerId on re-render;
      // remove any sheet this node owns outright on unmount.
      void owner;
    },
  };
}

export const json = view(renderJson);
export const csv = view(renderCsv);
export const mermaid = view(renderMermaid);
export const style = {
  ...view(renderStyle),
  unmount(_dom: HTMLElement): void {
    /* the sheet persists for the session; a content change replaces it */
  },
};

/* ── lit fences ─────────────────────────────────────────────────── */

const FENCES: Record<string, (host: HTMLElement, code: string, ownerId: string) => void> = {
  json: renderJson,
  csv: renderCsv,
  mermaid: renderMermaid,
  style: renderStyle,
};

export const fenceLangs = Object.keys(FENCES);

/** Render a fenced block (lit): returns true when the lang is handled. */
export function renderFence(host: HTMLElement, lang: string, code: string, ownerId = `fence-${++mermaidSeq}`): boolean {
  const fn = FENCES[lang];
  if (!fn) return false;
  fn(host, code, ownerId);
  return true;
}
