import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType },
  body,
});
const json = (statusCode: number, body: unknown) => respond(statusCode, 'application/json', JSON.stringify(body));

/* — the capture tool (ADR-0039 lineage): the agent-native form of the input
 * organ. The frontend PWA writes captures from the browser as the signed-in
 * user; this exposes the SAME capture as an MCP tool (`@c15r/input.capture`) so
 * an agent can file a source into the daily log without the UI. Writes flow the
 * organ path (`substrate.write.requested` → the owner's slice, cell-attested),
 * so the tool needs no token. Mirrors `cells/input/client/main.ts` `capture()`. */

const TOOLS = [
  {
    name: 'capture',
    description:
      "Capture a source URL (with an optional highlight/clip) into the daily log — the agent-native form of the input organ. Writes a `capture` fact under inbox/<ts>, tagged `log:<day>` and linked `on` that day's `log:<day>` fact (created if absent), so it lands in the daily-log view and the graph. Requires url; optional title and text (a clip/quote/highlight from the source). Defaults to today (UTC); pass day=YYYY-MM-DD to file under a specific day.",
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The source URL (required).' },
        title: { type: 'string', description: 'Optional title for the source.' },
        text: { type: 'string', description: 'Optional highlight / clip / quote from the source.' },
        day: { type: 'string', description: 'Optional YYYY-MM-DD to file under; defaults to today (UTC).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    scope: null,
  },
];

const todayUTC = (): string => new Date().toISOString().split('T')[0];
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** ISO week label `YYYY-wWW` — copied verbatim from the input PWA so day facts
 *  this tool writes match the ones the browser writes. */
const isoWeekOf = (d: string): string => {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd + 3);
  const y = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return `${y}-w${String(1 + Math.round(((+dt - +jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

/** Emit substrate write-requests (the organ path). Batched PutEvents; the cell's
 *  IAM role pins `events:source` to this cell, so it can only speak as itself. */
async function emitWrites(facts: Array<Record<string, unknown>>): Promise<void> {
  const client = new EventBridgeClient({});
  await client.send(
    new PutEventsCommand({
      Entries: facts.map((f) => ({
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: process.env.SERVICE_NAME,
        DetailType: 'substrate.write.requested',
        Detail: JSON.stringify(f),
      })),
    }),
  );
}

async function capture(args: { url?: string; title?: string; text?: string; day?: string }): Promise<unknown> {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (!url) return json(400, { error: 'url is required' });
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
  const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : undefined;
  const day = isDay(args.day) ? args.day : todayUTC();
  const logKey = `log:${day}`;

  // Compose the markdown body exactly as the PWA does: a checkbox link + an
  // optional blockquoted clip (indented so it nests under the checkbox item).
  let content = `- [ ] [${title ?? url}](${url})`;
  if (text) content += `\n\n    > ${text.replace(/\n/g, '\n    > ')}`;

  const key = `inbox/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await emitWrites([
    // The capture fact: tagged `log:<day>` (drives the daily-log view) and carrying
    // `day` (a ref → the `on` edge into the day fact; ADR-0003 derived edge — the
    // organ path can't call the caller-authority `link`, so the edge is declared).
    {
      key,
      value: { content, url, ...(title ? { title } : {}), captured: day, day: logKey },
      type: 'capture',
      tags: ['inbox', logKey],
      via: 'input.capture',
    },
    // The day fact (idempotent — same value each capture), so the ref target exists.
    {
      key: logKey,
      value: { date: day, week: isoWeekOf(day), month: day.slice(0, 7), year: day.slice(0, 4), title: day },
      type: 'log',
      tags: ['log'],
      via: 'input.capture',
    },
  ]);
  return json(200, { captured: true, key, day, log: logKey, url, ...(text ? { clipped: true } : {}) });
}

export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  // — the capture tool (the only mutating route) —
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path === '/_tools/capture') {
    try {
      return await capture(event.body ? JSON.parse(event.body) : {});
    } catch (err) {
      return json(500, { error: (err as Error).message });
    }
  }

  // — the capture PWA (static, read-only) —
  if (method !== 'GET') return json(405, { error: 'read-only' });
  try {
    if (path === '/' || path === '') return respond(200, 'text/html; charset=utf-8', read('static/index.html'));
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'));
    if (path === '/manifest.webmanifest') return respond(200, 'application/manifest+json', read('static/manifest.webmanifest'));
    if (path === '/icon.svg') return respond(200, 'image/svg+xml', read('static/icon.svg'));
  } catch (err) {
    return json(404, { error: (err as Error).message });
  }
  return json(404, { error: `no route for ${path}` });
};
