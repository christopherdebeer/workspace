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
// The platform SDK for cells (ADR-0042 Inc 1a): the SAME observed-state read
// pipeline the gateway runs, bound to this cell's IAM-scoped slice — so the
// template models the canonical way to read the substrate in SSR (the reader),
// NOT a hand-rolled raw-DDB scan. Delivered by the forge bundler as a virtual
// module; its v3 store resolves `@aws-sdk/*` from the Node 20 runtime.
import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
import { Surface, type ViewModel, type Note } from './shared';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

const textOf = (v: unknown): string => (typeof v === 'string' ? v : ((v as { text?: string })?.text ?? ''));

/** The owner's `note:` facts. One `createCellReader` query runs the real
 *  pipeline (select → score → shape; superseded already excluded) against the
 *  cell's LeadingKeys-scoped partition — no bespoke DynamoDB. The store
 *  lazy-loads the SDK, so a missing dep degrades to the anon shell (the caller
 *  catches), exactly as the old raw path did. */
async function ownerNotes(): Promise<Note[]> {
  const reader = createCellReader(createDynamoStateStore(TABLE), OWNER);
  const res = await reader.query({ prefix: 'note:' });
  return res.entries.map((e) => ({ key: e.key, text: textOf(e.value) }));
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  // Caller-write demo (Phase 4, docs/capability-consent.md): a signed-in visitor
  // adds a note. The cell holds NO token — it returns an `x-parc-writes` header
  // DECLARING the write; dispatch applies it AS THE CALLER, bounded by this cell's
  // declared `ssr.json` writes manifest AND the caller's own write scope, then
  // strips the header. A bare note lands in the caller's own slice (`note:`); an
  // explicit `owner` targets a slice they've granted write on (`shared/`, the
  // declared crossSlice prefix → workspace.requireWriteThrough enforces the grant).
  if (method === 'POST' && (path === '/note' || path === '/notes')) {
    const caller = event.headers?.['x-cell-caller'];
    if (!caller || caller === 'anonymous') return respond(401, 'application/json', JSON.stringify({ error: 'sign in to add a note' }));
    let text = '';
    let owner: string | undefined;
    try {
      const parsed = event.body ? (JSON.parse(event.body) as { text?: unknown; owner?: unknown }) : {};
      if (typeof parsed.text === 'string') text = parsed.text.trim();
      if (typeof parsed.owner === 'string' && parsed.owner) owner = parsed.owner;
    } catch {
      /* malformed body → caught by the validation below */
    }
    if (!text) return respond(400, 'application/json', JSON.stringify({ error: 'text is required' }));
    const crossSlice = !!owner && owner !== caller;
    const key = crossSlice ? `shared/${Date.now()}` : `note:${Date.now()}`;
    const write = { key, value: { text }, type: 'note', ...(crossSlice ? { owner } : {}) };
    // 202: dispatch performs the persistence after the cell returns.
    return respond(202, 'application/json', JSON.stringify({ accepted: true, key, ...(crossSlice ? { owner } : {}) }), {
      'x-parc-writes': JSON.stringify([write]),
    });
  }

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
