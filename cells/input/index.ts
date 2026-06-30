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

/**
 * ADR-0041 Inc 3 — a cell-authored argument FORM for `capture` (the input twin
 * of ADR-0039 Inc 2's tool renderers). The generic schema-form floor already
 * covers `url`/`title`/`text`/`day` fine — four plain strings — so this form's
 * value-add is something the floor genuinely can't do: a LIVE preview of the
 * composed capture markdown (mirroring `capture()`'s exact compose logic
 * below) as the user types, so they see what will actually be written before
 * running it. Self-registers under `window.__parcForm['input.capture']`
 * (`as`, declared on the tool below) — fetched + run sandboxed by the field
 * computer / card (ADR-0041), never executed against the caller's own origin.
 * Backtick-free so it nests in this template literal.
 */
const CAPTURE_FORM_SRC = `
(function(){
  var reg = (window.__parcForm = window.__parcForm || {});
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function field(label, name, val, long){
    var tag = long ? 'textarea' : 'input';
    var attrs = long ? ' rows="2"' : ' type="text"';
    return '<label style="display:grid;gap:.25rem;font:12px ui-monospace,monospace">' + esc(label)
      + '<' + tag + ' data-f="' + esc(name) + '"' + attrs + ' style="padding:.5rem .6rem;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;font:13px -apple-system,sans-serif;width:100%;box-sizing:border-box">'
      + (long ? esc(val||'') : '') + '</' + tag + '>'
      + (!long ? '' : '') + '</label>';
  }
  function compose(v){
    var url = (v.url||'').trim(), title = (v.title||'').trim(), text = (v.text||'').trim();
    if(!url) return null;
    var content = '- [ ] [' + (title || url) + '](' + url + ')';
    if(text) content += '\\n\\n    > ' + text.replace(/\\n/g, '\\n    > ');
    return content;
  }
  reg['input.capture'] = function(host, schema, value, api){
    var v = Object.assign({ url: '', title: '', text: '', day: '' }, value || {});
    host.innerHTML =
      '<div style="display:grid;gap:.6rem">'
      + field('url *', 'url', v.url, false)
      + field('title', 'title', v.title, false)
      + field('text (clip / highlight)', 'text', v.text, true)
      + field('day (YYYY-MM-DD, defaults to today)', 'day', v.day, false)
      + '<div style="display:grid;gap:.25rem"><span style="font:12px ui-monospace,monospace;opacity:.7">preview</span>'
      + '<pre id="parc-capture-preview" style="white-space:pre-wrap;background:rgba(127,127,127,.12);border-radius:6px;padding:.55rem;margin:0;font:12.5px ui-monospace,monospace;min-height:1.4em"></pre></div>'
      + '</div>';
    function paint(){
      var c = compose(v);
      var pre = host.querySelector('#parc-capture-preview');
      pre.textContent = c || '(enter a url to preview)';
    }
    var inputs = host.querySelectorAll('[data-f]');
    for(var i=0;i<inputs.length;i++){
      (function(el){
        el.value = v[el.getAttribute('data-f')] || '';
        el.addEventListener('input', function(){
          v = Object.assign({}, v); v[el.getAttribute('data-f')] = el.value;
          paint();
          api.onChange(v);
        });
      })(inputs[i]);
    }
    paint();
  };
})();
`;

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
    // ADR-0041 Inc 3: a cell-authored argument form (a live compose preview the
    // generic schema-form floor can't offer). The gateway surfaces `form` on the
    // $catalog entry; the field computer/card fetch + run it sandboxed.
    ui: { form: 'ui://@c15r/input/forms/capture.js', as: 'input.capture' },
  },
];

const todayUTC = (): string => new Date().toISOString().split('T')[0];
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** A short, human-readable slug for a capture KEY (ADR-0040: keys are link targets,
 *  so a capture is addressable/linkable, not opaque). Kebab-case, ≤48 chars. */
const slugify = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
/** Pick the most meaningful slug: title → the URL's last path segment (or host) →
 *  the opening words of the body. Falls back to a base36 timestamp so a key always
 *  exists. `inbox/<date>/<slug>` keeps the day a prefix-query + the slug linkable. */
function captureSlug(parts: { title?: string; url?: string; content?: string }): string {
  const fromTitle = slugify(parts.title);
  if (fromTitle) return fromTitle;
  if (parts.url) {
    try {
      const u = new URL(parts.url);
      const last = u.pathname.split('/').filter(Boolean).pop();
      const s = slugify(last) || slugify(u.hostname);
      if (s) return s;
    } catch { /* not a URL */ }
  }
  const fromBody = slugify(parts.content);
  return fromBody || Date.now().toString(36);
}

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

  const key = `inbox/${day}/${captureSlug({ title, url, content })}`;
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
  // ADR-0041 Inc 3: the capture tool's bespoke argument form (a live compose
  // preview), fetched by the gateway provider hop over the host-mediated
  // resources/read call and run sandboxed — non-sensitive static UI code.
  if (method === 'GET' && path === '/forms/capture.js') {
    return respond(200, 'application/javascript; charset=utf-8', CAPTURE_FORM_SRC);
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
