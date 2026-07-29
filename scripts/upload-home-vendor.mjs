#!/usr/bin/env node
/**
 * upload-home-vendor.mjs — push the graph's built 3D vendor bundle
 * (cells/home/devtools/dist/three-vendor-<hash>.js, built by
 * cells/home/devtools/build-vendor.mjs) to the home cell's PUBLIC data space:
 *
 *   blob key  public/vendor/three-vendor-<hash>.js
 *   served    https://parc.land/@c15r/home/_data/c15r/public/vendor/…
 *
 * The filename hash is the cache key (`_data` serves immutable, 1y): a new
 * build mints a new name, and cells/home/client/graph/scene.ts must reference
 * it (THREE_VENDOR_URL). Auth: PARC_TOKEN env or /tmp/parc-token.json, same
 * as cell-sync. Falls back to the presigned-PUT path if the inline body is
 * refused by the edge.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PARC_BASE ?? 'https://parc.land';
const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'cells', 'home', 'devtools', 'dist');

const token = () => {
  if (process.env.PARC_TOKEN) return process.env.PARC_TOKEN;
  try { return JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token; }
  catch { console.error('No PARC_TOKEN and no /tmp/parc-token.json'); process.exit(1); }
};

async function call(verb, target, input) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: verb, arguments: { target, input } } }),
  });
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
  const rpc = await res.json();
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value = text;
  try { value = JSON.parse(text); } catch { /* raw */ }
  if (rpc.error || rpc.result?.isError) throw new Error(`${target}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return value;
}

async function upload(key, body, contentType, encoding) {
  const base = { owner: 'c15r', name: 'home', key, contentType };
  try {
    const r = await call('act', 'cells.putData', { ...base, content: body, encoding });
    console.log(`uploaded ${key} (${(body.length / 1024).toFixed(0)}KB) → ${r.url ?? '(no public url?)'}`);
  } catch (err) {
    console.log(`inline upload failed (${err.message}) — trying presigned PUT`);
    const p = await call('act', 'cells.putData', { ...base, presign: true });
    const bytes = encoding === 'base64' ? Buffer.from(body, 'base64') : body;
    const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'content-type': p.contentType }, body: bytes });
    if (!put.ok) throw new Error(`presigned PUT: HTTP ${put.status}`);
    console.log(`uploaded ${key} via presign → ${p.url ?? '(no public url?)'}`);
  }
}

const file = readdirSync(distDir).find((f) => /^three-vendor-[0-9a-f]{8}\.js$/.test(f));
if (!file) { console.error('no dist/three-vendor-<hash>.js — run cells/home/devtools/build-vendor.mjs first'); process.exit(1); }
await upload(`public/vendor/${file}`, readFileSync(join(distDir, file), 'utf8'), 'text/javascript', 'utf8');

// Label fonts (mirrored by build-vendor.mjs): binary, versioned-path keys.
const fontsRoot = join(distDir, 'fonts');
let fontDirs = [];
try { fontDirs = readdirSync(fontsRoot); } catch { /* none mirrored */ }
for (const pkg of fontDirs) {
  for (const woff of readdirSync(join(fontsRoot, pkg))) {
    const b64 = readFileSync(join(fontsRoot, pkg, woff)).toString('base64');
    await upload(`public/vendor/fonts/${pkg}/${woff}`, b64, 'font/woff', 'base64');
  }
}
console.log(`verify: curl -sI ${BASE}/@c15r/home/_data/c15r/public/vendor/${file}`);
