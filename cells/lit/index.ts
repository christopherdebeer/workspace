import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Surface, renderMarkdown, type ViewModel, type ListItem, type BlockData, type DocValue, type LinkRef, type TypeItem } from './shared';
import { bodyText, fieldsToHtml } from '@parc/ui';

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

interface Fact { key: string; value: unknown; superseded?: boolean; _meta?: { updatedAt?: string; type?: string | null } }

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

interface EdgeItem { from: string; rel: string; to: string }

/** Outbound edges FROM a key (`platform/infra/substrate-table.ts`'s key layout:
 *  `sk=EDGE#<from>|<rel>|<to>`, a contiguous prefix scan). Server-side mirror of
 *  `workspace.neighbors`'s `outbound` — direct DDB, same table the cell already
 *  reads facts from, no MCP round trip needed for SSR. */
async function edgesFrom(from: string): Promise<EdgeItem[]> {
  const r = await ddb().send(
    new Query({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': `EDGE#${from}|` },
    }),
  );
  return (r.Items ?? []) as EdgeItem[];
}

/** Inbound edges TO a key, via the `gsi-in` index (`gsi1pk=IN#<scope>#<to>`) —
 *  the substrate's one inbound-edge index, same one `workspace.neighbors` reads. */
async function edgesTo(to: string): Promise<EdgeItem[]> {
  const r = await ddb().send(
    new Query({
      TableName: TABLE,
      IndexName: 'gsi-in',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': `IN#${OWNER}#${to}` },
    }),
  );
  return (r.Items ?? []) as EdgeItem[];
}

/** Every fact of one type, via the `gsi-type` index (`gsi2pk=TYPE#<scope>#<type>`,
 *  `gsi2sk=<updatedAt>`) — already indexed for exactly this, so a `type:<type>`
 *  collection (ADR-0040 hub view) is a single cheap query, unlike salience
 *  (which needs a trajectory+edges fold — see `buildListVM`'s comment). Most
 *  recently updated first; `Limit` applies before the superseded-filter, so a
 *  superseded item can shrink the visible count below it — acceptable, same as
 *  `queryPrefix`'s own pagination elsewhere in this file. */
async function queryByType(type: string, limit = 100): Promise<Fact[]> {
  const r = await ddb().send(
    new Query({
      TableName: TABLE,
      IndexName: 'gsi-type',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: { ':pk': `TYPE#${OWNER}#${type}` },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return ((r.Items ?? []) as Fact[]).filter((f) => !f.superseded);
}

/** A fact's id: the part after a `prefix:` or `prefix/` in its key — mirrors
 *  `platform/ui/vocab.ts`'s `deriveId` (kept tiny + duplicated rather than wired
 *  cross-module; index.ts is the no-DOM server half, vocab.ts assumes the
 *  client's `$types` aggregation, a dependency this SSR path doesn't carry). */
function deriveId(key: string): string {
  const ci = key.indexOf(':');
  const si = key.indexOf('/');
  const i = ci >= 0 && (si < 0 || ci < si) ? ci : si;
  return i >= 0 ? key.slice(i + 1) : key;
}

/** A neighbour key resolved to a `LinkRef` — its title/name as the label (else
 *  the key itself) plus its type, fetched alongside so a link reads as a name,
 *  not an opaque key. Best-effort: a missing/foreign-scope fact just labels
 *  itself by key with no type. */
async function linkRefOf(key: string, rel: string): Promise<LinkRef> {
  const f = await getFact(key).catch(() => null);
  const v = f?.value as Record<string, unknown> | undefined;
  const t = typeof v?.title === 'string' ? (v.title as string) : typeof v?.name === 'string' ? (v.name as string) : undefined;
  return { key, rel, label: t || deriveId(key), type: f?._meta?.type ?? null };
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
.doc-list{display:grid}.doc-row{display:grid;gap:.15rem;padding:.6rem .1rem;border-top:1px solid var(--line);text-decoration:none;color:inherit}
.doc-list .doc-row:first-child{border-top:0}.doc-row-title{font-size:1rem;font-weight:600}.doc-row-summary{color:var(--faint);font-size:.88rem}.doc-row-meta{color:var(--faint);font-size:.74rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.block{padding:.2rem 0 .4rem}.block+.block{border-top:1px solid var(--line)}.block-body :first-child{margin-top:0}
pre{background:#f4f4ee;border:1px solid var(--line);border-radius:8px;padding:.7rem .8rem;overflow:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
img{max-width:100%}a{color:var(--accent)}
.doc-controls{display:flex;gap:.4rem;margin-top:.5rem}.pill{border:1px solid var(--line);background:transparent;color:var(--faint);border-radius:999px;padding:.12rem .7rem;font-size:.8rem;cursor:pointer}.pill.on{color:var(--paper);background:var(--accent);border-color:var(--accent)}
.wikilink{border-bottom:1px dotted var(--accent);text-decoration:none}.backlinks{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line)}.backlinks+.backlinks{margin-top:1.4rem}.backlinks h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin:0 0 .5rem}.backlinks ul{list-style:none;padding:0;margin:0;display:grid;gap:.3rem}.backlinks .rel{color:var(--faint);font-size:.78rem}
.fact-meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;word-break:break-all}.block-body dl.f{margin:0;display:grid;gap:.35rem}.block-body dl.f div{display:flex;gap:.5rem}.block-body dl.f dt{color:var(--faint);font-size:.8rem;min-width:7rem}.block-body dl.f dd{margin:0}
.md-fence{border-left:2px solid var(--line);padding-left:.9rem;margin:.6rem 0}
.md-fence[class*=dir-]{border-radius:8px;border:1px solid var(--line);border-left-width:4px;padding:.55rem .9rem}
.dir-warn{border-left-color:#c78a1d;background:#fdf7ea}.dir-error{border-left-color:#b5523c;background:#fbf0ed}.dir-info{border-left-color:#3b6ea5;background:#eef3f9}.dir-success,.dir-note{border-left-color:var(--accent);background:#eef5f0}.dir-box{border-left-color:var(--line)}
pre.fence-output{background:#fbfbf6;border-style:dashed;position:relative;margin-top:-.35rem}
pre.fence-output::before{content:'⤷ output ' attr(data-output-lang);display:block;font:600 .68rem ui-monospace,Menlo,monospace;color:var(--faint);letter-spacing:.04em;margin-bottom:.35rem}
.block-output{border-left:2px dashed var(--line);padding-left:.8rem;margin-top:-.3rem}.block-out-prov{font:600 .68rem ui-monospace,Menlo,monospace;color:var(--faint);letter-spacing:.04em}.block-out-prov a{color:var(--faint)}
.wikilink-stub{border-bottom-style:dashed;border-bottom-color:#b5523c;color:#8a4a3a}.toc{display:grid;gap:.15rem;margin:.6rem 0;padding:.5rem .8rem;border:1px solid var(--line);border-radius:8px}.toc a{text-decoration:none}.toc-h2{padding-left:.9rem}.toc-h3{padding-left:1.8rem}.embed-search{border:1px solid var(--line);border-radius:8px;padding:.5rem .8rem;margin:.6rem 0;display:grid;gap:.25rem}.search-hit a{text-decoration:none}.search-type{color:var(--faint);font-size:.78rem}.embed-transclude{border-left:2px solid var(--accent);padding-left:.9rem;margin:.6rem 0}.waiting .wikilink-stub{text-decoration:none}
.appears-in{font-size:.78rem;color:var(--faint);margin:.3rem 0 .6rem}
.block{position:relative}.block.selected{outline:1.5px solid var(--line);outline-offset:4px;border-radius:6px}.block-menu{position:absolute;top:.2rem;bottom:.2rem;left:0;right:0;display:flex;align-items:flex-end;pointer-events:none;z-index:40}.bm-items{position:sticky;bottom:45%;display:flex;justify-content:flex-end;width:100%;gap:.35rem;padding-right:.1rem;pointer-events:none}.block-menu button{pointer-events:all;width:2.15em;height:2.15em;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--ink,#1c1c1a);font-size:.9rem;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(51,46,35,.18);cursor:pointer;padding:0}.block-menu button.bm-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.insert-picker{display:grid;gap:.3rem;margin:.4rem 0;padding:.55rem;border:1px solid var(--line);border-radius:8px;background:#fff}.insert-picker input{border:1px solid var(--line);border-radius:6px;padding:.45rem .6rem;font:inherit;width:100%;box-sizing:border-box}.picker-hit{display:grid;gap:.05rem;text-align:left;border:0;background:none;padding:.35rem .3rem;border-radius:6px;cursor:pointer;font:inherit}.picker-hit:hover{background:var(--paper,#fbfbf8)}.picker-title{font-weight:600;font-size:.9rem}.picker-meta{color:var(--faint);font-size:.72rem;font-family:ui-monospace,Menlo,monospace}
.fence-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin:.5rem 0 0;font:600 .68rem ui-monospace,Menlo,monospace}.fence-chips+pre{margin-top:.25rem}.fchip{border:1px solid var(--line);border-left-width:3px;border-radius:5px;padding:.08rem .4rem;color:var(--faint);background:#fff}.fchip.fc-lang{color:var(--ink,#1c1c1a)}.fchip.fc-error{border-left-color:#b5523c!important;color:#b5523c}.fchip.fc-link{cursor:pointer;text-decoration:underline dotted}
#lit-save-dot{position:fixed;right:.8rem;bottom:.8rem;z-index:60;font:600 .7rem ui-monospace,Menlo,monospace;padding:.2rem .55rem;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--faint);opacity:0;transition:opacity .2s;pointer-events:none}
#lit-save-dot[data-state="saving"]{opacity:1;color:#8a6d1a;border-color:#e3d3a1}
#lit-save-dot[data-state="failed"]{opacity:1;color:#b5523c;border-color:#e0b4a8}
#lit-save-dot[data-state="saved"]{opacity:1;color:var(--accent)}
.embed-agent{border:1px solid var(--line);border-radius:10px;padding:.7rem .8rem;margin:.6rem 0;background:#fff}.agent-head{font-size:.8rem;color:var(--faint);margin-bottom:.4rem}.agent-prompt{background:#f4f4ee;margin:0 0 .5rem;white-space:pre-wrap}.agent-out{margin-top:.5rem}.agent-out:empty{display:none}.vw-attrib{font-size:.72rem;color:var(--faint);margin-top:.5rem}`;

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
  // Membership + order are substrate-native `_doc/<id>/<key>` = {seq, fold}
  // decorations — a doc is a *view over facts*, any fact key (a doc-block, a
  // canvas `el:`, a `cell:`) placed by a decoration. (The legacy inline `blocks`
  // array is gone — every doc was migrated to decorations.)
  const prefix = `_doc/${id}/`;
  const deco = await queryPrefix(prefix);
  const order = deco
    .map((f) => ({ key: f.key.slice(prefix.length), seq: Number((f.value as { seq?: number })?.seq ?? 0), fold: !!(f.value as { fold?: boolean })?.fold }))
    .sort((a, b) => a.seq - b.seq);
  const facts = await Promise.all(order.map((o) => getFact(o.key)));
  const blocks: BlockData[] = order.map((o, i) => ({
    key: o.key,
    fold: o.fold,
    md: facts[i] ? contentOf(facts[i]!.value) : `*missing fact — ${o.key}*`,
  }));
  return { kind: 'doc', owner: OWNER, isOwner, id, title: dv.title || id, summary: dv.summary, blocks };
}

/** The generic fact ViewModel (ADR-0040 wiki): ANY fact lit doesn't own a
 *  bespoke view for — rendered through the same hint floor every surface
 *  shares (`render-hints.ts`), with both edge directions resolved to labelled
 *  links. The substrate-native reader: the URL is the key, the page is
 *  whatever that key actually holds. */
async function buildFactVM(key: string, patterns: string[], isOwner: boolean): Promise<ViewModel | null> {
  if (!isOwner && !covers0(patterns, key)) return null;
  const fact = await getFact(key);
  if (!fact) return null;
  const value = fact.value;
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const title = (typeof v.title === 'string' && v.title) || (typeof v.name === 'string' && v.name) || deriveId(key);
  const body = bodyText(value);
  const bodyHtml = body ? renderMarkdown(body) : '';
  const fieldsHtml = bodyHtml ? '' : fieldsToHtml(value);
  const [out, inb] = await Promise.all([edgesFrom(key), edgesTo(key)]);
  const byTarget = <T extends { key: string }>(refs: T[]): T[] => {
    const seen = new Set<string>();
    return refs.filter((r) => (r.key === key || seen.has(r.key) ? false : (seen.add(r.key), true))).slice(0, 24);
  };
  const links = byTarget(await Promise.all(out.map((e) => linkRefOf(e.to, e.rel))));
  const backlinks = byTarget(await Promise.all(inb.map((e) => linkRefOf(e.from, e.rel))));
  return { kind: 'fact', owner: OWNER, isOwner, key, type: fact._meta?.type ?? null, title, bodyHtml, fieldsHtml, links, backlinks };
}

/** The `type:<type>` hub-view ViewModel: every fact of one kind — a
 *  `[[type:project|Projects]]` wiki-link target. Gated per-item like the doc
 *  list (an anonymous reader only sees what `_public/` covers). */
async function buildTypeVM(type: string, patterns: string[], isOwner: boolean): Promise<ViewModel> {
  const facts = (await queryByType(type)).filter((f) => isOwner || covers0(patterns, f.key));
  const items: TypeItem[] = facts.map((f) => {
    const v = f.value && typeof f.value === 'object' ? (f.value as Record<string, unknown>) : {};
    const title = (typeof v.title === 'string' && v.title) || (typeof v.name === 'string' && v.name) || deriveId(f.key);
    const summaryRaw = typeof v.summary === 'string' ? v.summary : typeof v.statement === 'string' ? v.statement : bodyText(f.value);
    return { key: f.key, title, summary: summaryRaw ? summaryRaw.slice(0, 160) : undefined, updated: f._meta?.updatedAt ?? '' };
  });
  return { kind: 'type', owner: OWNER, isOwner, type, items };
}

/** Dispatch a route key (from `/r/<key>` or the legacy `?doc=` query param,
 *  already normalized to a full key by the caller) to the right ViewModel
 *  builder — `$docs` is the reserved escape hatch to the flat doc list (moved
 *  off `/` once a welcome doc exists, see `buildRootVM`); `doc:` keeps its
 *  bespoke ordered-cells view; `log:` stays client-only (derived/grouped, not
 *  worth a second SSR path yet); `type:<type>` is the hub-collection view;
 *  anything else is the generic reader. */
async function buildKeyVM(key: string, patterns: string[], isOwner: boolean): Promise<ViewModel | null> {
  if (key === '$docs') return buildListVM(patterns, isOwner);
  if (key.startsWith('doc:')) return buildDocVM(key.slice(4), patterns, isOwner);
  if (key.startsWith('log:')) return null;
  if (key.startsWith('type:')) return buildTypeVM(key.slice(5), patterns, isOwner);
  return buildFactVM(key, patterns, isOwner);
}

/** The root (`/`, no key): a curated landing page is better than a flat list,
 *  so try the welcome doc first — falling back to the doc list when there
 *  isn't one (a fresh substrate with no welcome doc authored yet still gets a
 *  working root, never a 404). */
async function buildRootVM(patterns: string[], isOwner: boolean): Promise<ViewModel> {
  const welcome = await buildDocVM('welcome', patterns, isOwner);
  return welcome ?? (await buildListVM(patterns, isOwner));
}

/** The list ViewModel: one card per doc the caller may see (own slice, or what the
 *  `_public/` index covers for anyone else). */
async function buildListVM(patterns: string[], isOwner: boolean): Promise<ViewModel> {
  const docs = (await queryPrefix('doc:')).filter((f) => isOwner || covers0(patterns, f.key));
  docs.sort((a, b) => Date.parse(b._meta?.updatedAt ?? '0') - Date.parse(a._meta?.updatedAt ?? '0'));
  // Block count = the doc's membership decorations (one `_doc/` scan for all docs),
  // not the retired inline array. `_doc/<id>/<key>` → bump the count for `<id>`.
  const counts = new Map<string, number>();
  for (const d of await queryPrefix('_doc/')) {
    const rest = d.key.slice('_doc/'.length);
    const slash = rest.lastIndexOf('/');
    if (slash > 0) counts.set(rest.slice(0, slash), (counts.get(rest.slice(0, slash)) ?? 0) + 1);
  }
  // `score` (true salience) is deliberately left undefined here — it needs a
  // trajectory+edges fold (`platform/runtime/state.ts` `computeScore`), too
  // costly to do per-doc on every list SSR over this cell's lightweight direct-
  // DDB path. The client's live refresh (`ListEditor`) gets it for free from
  // its own `workspace.query`, which already computes it — same "fast SSR
  // shell, richer live data after hydration" pattern as the rest of lit.
  const items: ListItem[] = docs.map((f) => {
    const v = f.value as DocValue;
    const id = f.key.slice('doc:'.length);
    return {
      id,
      title: v.title || id,
      summary: v.summary,
      blocks: counts.get(id) ?? 0,
      updated: f._meta?.updatedAt ?? '',
    };
  });
  return { kind: 'list', owner: OWNER, isOwner, docs: items };
}

/** Render the root (no key — the welcome doc, falling back to the list) or a
 *  fact/doc/collection at `key`, server-side, when there's public content or
 *  the caller is the owner — else the bare interactive shell (the client
 *  renders with its own session). Shared by both URL forms: the new path
 *  route and the legacy `?doc=` query param. */
async function renderRoute(key: string | undefined, isOwner: boolean) {
  try {
    const patterns = await publicPatterns();
    if (patterns.length || isOwner) {
      const vm = key ? await buildKeyVM(key, patterns, isOwner) : await buildRootVM(patterns, isOwner);
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
    // `x-cell-caller` is the dispatch-validated identity (gateway sets it from a
    // bearer; the dispatch tier sets it from the session cookie on navigations).
    // The owner viewing their own lit gets every fact server-rendered; anyone
    // else gets only what the `_public/` index covers. Trustworthy: the cell is
    // reachable only via cells.call, never directly, so the header can't be forged.
    const caller = event.headers?.['x-cell-caller'];
    const isOwner = !!caller && caller === OWNER;
    // The path-based reader route (ADR-0040: the URL IS the key) — `/r/<key>`,
    // any fact key verbatim (`/` and `:` literal, the substrate's own
    // separators; everything else percent-decoded per segment).
    if (path === '/r' || path.startsWith('/r/')) {
      const tail = path === '/r' ? '' : path.slice('/r/'.length);
      const key = tail
        .split('/')
        .map((seg) => { try { return decodeURIComponent(seg); } catch { return seg; } })
        .join('/');
      return await renderRoute(key || undefined, isOwner);
    }
    if (path === '/' || path === '') {
      // The cell event carries rawQueryString (the parsed map isn't reliably
      // populated through the dispatch path) — parse it like the canvas cell.
      const qs = new URLSearchParams(event.rawQueryString || '');
      const rawDoc = qs.get('doc') ?? event.queryStringParameters?.doc ?? undefined;
      // Legacy convenience (pre-dates the `/r/` route, kept for old links and
      // other cells' `?doc=` open handlers): a bare id means `doc:<id>`; a
      // value already carrying `:`/`/` (e.g. `log:2026-06-30`) is a full key.
      const key = rawDoc === undefined ? undefined : /[:/]/.test(rawDoc) ? rawDoc : `doc:${rawDoc}`;
      return await renderRoute(key, isOwner);
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
