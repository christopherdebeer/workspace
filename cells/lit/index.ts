import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Surface, type ViewModel, type ListItem, type BlockData, type DocValue } from './shared';

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

const contentOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { content?: unknown }).content === 'string') return (value as { content: string }).content;
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
};

// ── SSR assembly ───────────────────────────────────────────────────
// One React tree (cells/lit/shared.tsx) rendered to a string here and hydrated
// by the client from the SAME module — identical markup, so no first-paint flash.
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

/** Inject the SSR'd tree + its serialized state into the shell. `data-ssr` flags a
 *  server first paint, telling the client to hydrate (don't rebuild). The
 *  `lit-state` script is the exact ViewModel the tree was rendered from — the client
 *  hydrates against it, guaranteeing markup parity. (`isOwner` rides along in that
 *  state; the obsolete `data-ssr-auth` attribute is gone — the client only reads
 *  `data-ssr`.) */
function ssrPage(inner: string, vm: ViewModel): string {
  // `<` is escaped so the JSON can't break out of the script element.
  const state = JSON.stringify(vm).replace(/</g, '\\u003c');
  return read('static/index.html')
    .replace('</head>', `<style id="ssr-critical">${CRITICAL_CSS}</style></head>`)
    .replace('<div id="app"><p class="boot">loading…</p></div>', `<div id="app" data-ssr="1">${inner}</div>`)
    .replace(
      '<script type="module"',
      `<script id="lit-state" type="application/json">${state}</script>\n  <script type="module"`,
    );
}

/** The doc ViewModel: header + each block's markdown (or fold/missing text). The
 *  client hydrates this, then enhances fences and enables editing in place. */
async function buildDocVM(id: string, patterns: string[], isOwner: boolean): Promise<ViewModel | null> {
  if (!isOwner && !covers0(patterns, `doc:${id}`)) return null;
  const docFact = await getFact(`doc:${id}`);
  if (!docFact) return null;
  const dv = docFact.value as DocValue;
  const refs = Array.isArray(dv.blocks) ? dv.blocks : [];
  const facts = await Promise.all(refs.map((r) => getFact(r.key)));
  const blocks: BlockData[] = refs.map((r, i) => ({
    key: r.key,
    fold: r.fold,
    md: facts[i] ? contentOf(facts[i]!.value) : `*missing fact — ${r.key}*`,
  }));
  return { kind: 'doc', owner: OWNER, isOwner, id, title: dv.title || id, summary: dv.summary, blocks };
}

/** The list ViewModel: one card per doc the caller may see (own slice, or what the
 *  `_public/` index covers for anyone else). */
async function buildListVM(patterns: string[], isOwner: boolean): Promise<ViewModel> {
  const docs = (await queryPrefix('doc:')).filter((f) => isOwner || covers0(patterns, f.key));
  docs.sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'));
  const items: ListItem[] = docs.map((f) => {
    const v = f.value as DocValue;
    return {
      id: f.key.slice('doc:'.length),
      title: v.title || f.key.slice('doc:'.length),
      summary: v.summary,
      blocks: (v.blocks ?? []).length,
      updated: f._meta?.updatedAt ?? '',
    };
  });
  return { kind: 'list', owner: OWNER, isOwner, docs: items };
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
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
      // `x-cell-caller` is the dispatch-validated identity (gateway sets it from
      // a bearer; the dispatch tier sets it from the session cookie on navigations).
      // The owner viewing their own lit gets every doc server-rendered; anyone
      // else gets only what the `_public/` index covers. Trustworthy: the cell is
      // reachable only via cells.call, never directly, so the header can't be forged.
      const caller = event.headers?.['x-cell-caller'];
      const isOwner = !!caller && caller === OWNER;
      // SSR first paint when there's public content OR the owner is signed in;
      // otherwise serve the bare interactive shell (the client renders with the session).
      try {
        const patterns = await publicPatterns();
        if (patterns.length || isOwner) {
          const vm = id ? await buildDocVM(id, patterns, isOwner) : await buildListVM(patterns, isOwner);
          if (vm) {
            const inner = renderToString(createElement(Surface, { vm }));
            return respond(200, 'text/html; charset=utf-8', ssrPage(inner, vm));
          }
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
