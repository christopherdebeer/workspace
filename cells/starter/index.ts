/* ---------------------------------------------------------------------------
 * starter — the canonical cell template (server half).
 *
 * Plain TS (no JSX) so it stays the `index.ts` entry forge resolves; JSX lives
 * in the .tsx modules it imports. renderToString's the shared `platform/ui` tree
 * into the shell (proving platform/ui is isomorphic — it renders server-side),
 * with a serialized ViewModel the client hydrates against.
 *
 * AUTHED SSR: a signed-in owner's `x-cell-caller` (dispatch-validated from the
 * session cookie on a navigation — unforgeable, the cell is reachable only via
 * cells.call) lets the server read the owner's `note:*` facts from the substrate
 * and render THEM server-side — no flash, no client round-trip for first paint.
 * The cell's IAM role grants `STATE#<owner>` reads only (the authority boundary;
 * no token). Anonymous visitors get the shell. The AWS SDK loads lazily so a
 * missing dep degrades to the anon shell rather than crashing import.
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Surface, type ViewModel, type Note } from './shared';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

interface Ddb {
  send(cmd: unknown): Promise<{ Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: unknown }>;
}
let doc: Ddb | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Query: any;
function ddb(): Ddb {
  if (!doc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('@aws-sdk/lib-dynamodb');
    Query = lib.QueryCommand;
    doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({})) as Ddb;
  }
  return doc;
}

interface Fact { key: string; value: unknown; superseded?: boolean }
const textOf = (v: unknown): string => (typeof v === 'string' ? v : ((v as { text?: string })?.text ?? ''));

/** The owner's `note:` facts, read directly (LeadingKeys-scoped). */
async function ownerNotes(): Promise<Note[]> {
  const out: Note[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const client = ddb();
  do {
    const r = await client.send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': 'KEY#note:' },
        ExclusiveStartKey,
      }),
    );
    for (const it of (r.Items ?? []) as Fact[]) {
      if (!it.superseded) out.push({ key: String(it.key).replace(/^KEY#/, ''), text: textOf(it.value) });
    }
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    // ACAO:* so a host-isolated sibling cell could import this module if it wanted.
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*' });
    if (path === '/' || path === '') {
      // The owner viewing their own cell gets their notes server-rendered; anyone
      // else gets the anon shell. `x-cell-caller` is dispatch-validated identity.
      const caller = event.headers?.['x-cell-caller'];
      const isOwner = !!caller && caller === OWNER;
      let vm: ViewModel = { authed: false, notes: [] };
      if (isOwner && TABLE) {
        try {
          vm = { authed: true, notes: await ownerNotes() };
        } catch (err) {
          console.warn('[starter ssr] substrate read failed, falling back to shell', (err as Error).message);
        }
      }
      const inner = renderToString(createElement(Surface, { vm }));
      const state = JSON.stringify(vm).replace(/</g, '\\u003c');
      const html = read('static/index.html')
        .replace('<div id="app"><p class="boot">loading…</p></div>', `<div id="app" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="starter-state" type="application/json">${state}</script>\n  <script type="module"`);
      return respond(200, 'text/html; charset=utf-8', html);
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
