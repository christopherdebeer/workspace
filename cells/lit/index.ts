import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType },
  body,
});

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

// ── server-side substrate read (the canvas pattern) ────────────────
// The cell's IAM role grants `STATE#<owner>` reads only (LeadingKeys), so the
// database is the authority boundary — no token. SSR is a faithful first paint;
// the client hydrates. The AWS SDK ships in the runtime but loads LAZILY so a
// missing module degrades SSR to the static shell instead of crashing import.
interface Ddb {
  send(cmd: unknown): Promise<{ Items?: Array<Record<string, unknown>>; Item?: Record<string, unknown>; LastEvaluatedKey?: unknown }>;
}
let doc: Ddb | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Query: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Get: any;
function ddb(): Ddb {
  if (!doc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('@aws-sdk/lib-dynamodb');
    Query = lib.QueryCommand;
    Get = lib.GetCommand;
    doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({})) as Ddb;
  }
  return doc;
}

interface Fact { key: string; value: unknown; superseded?: boolean; _meta?: { updatedAt?: string } }

async function getFact(key: string): Promise<Fact | null> {
  const r = await ddb().send(new Get({ TableName: TABLE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#${key}` } }));
  const it = r.Item as Fact | undefined;
  return it && !it.superseded ? it : null;
}

async function queryPrefix(prefix: string): Promise<Fact[]> {
  const out: Fact[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const client = ddb();
  do {
    const r = await client.send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': `KEY#${prefix}` },
        ExclusiveStartKey,
      }),
    );
    for (const it of (r.Items ?? []) as Fact[]) if (!it.superseded) out.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/** Does a `_public/<pattern>` cover this key? (`*` = whole slice, trailing `*` = prefix, else exact.) */
function covers(pattern: string, key: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}
const covers0 = (patterns: string[], key: string): boolean => patterns.some((p) => covers(p, key));

/** The public patterns the owner has shared — `_public/<pattern>` facts. A
 *  token-less SSR may only emit content these cover. */
async function publicPatterns(): Promise<string[]> {
  if (!TABLE) return [];
  const facts = await queryPrefix('_public/');
  return facts.map((f) => (f.value as { pattern?: string } | undefined)?.pattern ?? f.key.slice('_public/'.length));
}

// ── minimal markdown → HTML (server first paint; client re-renders with marked) ──
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
function renderMarkdown(md: string): string {
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

const contentOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { content?: unknown }).content === 'string') return (value as { content: string }).content;
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
};

interface DocValue { title: string; summary?: string; blocks?: Array<{ key: string; fold?: boolean }> }

// ── SSR assembly ───────────────────────────────────────────────────
const CRITICAL_CSS = `:root{--ink:#1c1c1a;--faint:#8a8a82;--paper:#fbfbf8;--line:#e4e4dc;--accent:#2f6f4f}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#app{max-width:720px;margin:0 auto;padding:1rem 1.1rem 4rem}.boot{color:var(--faint)}
header{margin:.6rem 0 1.4rem}header h1{margin:.2rem 0 0;font-size:1.6rem;line-height:1.25}header .summary{margin:.3rem 0 0;color:var(--faint)}
.back{color:var(--accent);text-decoration:none;font-size:.85rem}
.doc-list{display:grid;gap:.7rem}.doc-card{display:block;border:1px solid var(--line);border-radius:12px;background:#fff;padding:.8rem 1rem;text-decoration:none;color:inherit}
.doc-card h2{margin:0;font-size:1.05rem}.doc-card p{margin:.25rem 0 0;color:var(--faint);font-size:.9rem}.doc-meta{display:block;margin-top:.4rem;color:var(--faint);font-size:.75rem}
.block{padding:.2rem 0 .4rem}.block+.block{border-top:1px solid var(--line)}.block-body :first-child{margin-top:0}
pre{background:#f4f4ee;border:1px solid var(--line);border-radius:8px;padding:.7rem .8rem;overflow:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
img{max-width:100%}a{color:var(--accent)}`;

/** Inject SSR markup into the shell's #app, with a data-ssr flag the client reads to hydrate read-only. */
function ssrPage(inner: string): string {
  return read('static/index.html')
    .replace('</head>', `<style id="ssr-critical">${CRITICAL_CSS}</style></head>`)
    .replace('<div id="app"><p class="boot">loading…</p></div>', `<div id="app" data-ssr="1">${inner}</div>`);
}

async function renderDocSSR(id: string, patterns: string[]): Promise<string | null> {
  if (!covers0(patterns, `doc:${id}`)) return null;
  const docFact = await getFact(`doc:${id}`);
  if (!docFact) return null;
  const dv = docFact.value as DocValue;
  const refs = Array.isArray(dv.blocks) ? dv.blocks : [];
  const blocks = await Promise.all(refs.map((r) => getFact(r.key)));
  const body = refs
    .map((r, i) => {
      const f = blocks[i];
      const md = f ? contentOf(f.value) : `*missing fact — ${r.key}*`;
      return `<article class="block"><div class="block-body">${renderMarkdown(md)}</div></article>`;
    })
    .join('\n');
  return (
    `<header><a class="back" href="${escAttr(`/@${OWNER}/lit`)}">← documents</a>` +
    `<h1>${esc(dv.title || id)}</h1>${dv.summary ? `<p class="summary">${esc(dv.summary)}</p>` : ''}</header>` +
    `<main>${body || '<p class="boot">empty document</p>'}</main>`
  );
}

async function renderListSSR(patterns: string[]): Promise<string> {
  const docs = (await queryPrefix('doc:')).filter((f) => covers0(patterns, f.key));
  docs.sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'));
  const cards = docs
    .map((f) => {
      const id = f.key.slice('doc:'.length);
      const v = f.value as DocValue;
      return (
        `<a class="doc-card" href="${escAttr(`?doc=${encodeURIComponent(id)}`)}">` +
        `<h2>${esc(v.title || id)}</h2>${v.summary ? `<p>${esc(v.summary)}</p>` : ''}` +
        `<span class="doc-meta">${(v.blocks ?? []).length} blocks · ${(f._meta?.updatedAt ?? '').slice(0, 10)}</span></a>`
      );
    })
    .join('\n');
  return (
    `<header><h1>lit</h1><p class="summary">public documents — ordered paths through the substrate</p></header>` +
    `<main class="doc-list">${cards || '<p class="boot">no public documents yet</p>'}</main>`
  );
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string> | null;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'));
    if (path === '/' || path === '') {
      // The cell event carries rawQueryString (the parsed map isn't reliably
      // populated through the dispatch path) — parse it like the canvas cell.
      const qs = new URLSearchParams(event.rawQueryString || '');
      const id = qs.get('doc') ?? event.queryStringParameters?.doc ?? undefined;
      // SSR first paint when the requested content is public; otherwise serve the
      // bare interactive shell (the signed-in client renders it with the session).
      try {
        const patterns = await publicPatterns();
        if (patterns.length) {
          const inner = id ? await renderDocSSR(id, patterns) : await renderListSSR(patterns);
          if (inner) return respond(200, 'text/html; charset=utf-8', ssrPage(inner));
        }
      } catch (err) {
        console.warn('[lit ssr] fell back to shell', (err as Error).message);
      }
      return respond(200, 'text/html; charset=utf-8', read('static/index.html'));
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
