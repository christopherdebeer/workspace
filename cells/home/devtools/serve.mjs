import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), 'public');

// ── auth proxy: forward /mcp to parc.land with the device token ──
// Mint one: POST https://parc.land/auth/device, approve the user_code, then
// exchange at /oauth/token with the device_code grant → /tmp/parc-token.json
const TOKEN_FILE = '/tmp/parc-token.json';
const tokenJson = () => {
  try { return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
};
/** Device tokens live ~1h; refresh in place (mirrors cell-sync.mjs). */
async function refreshToken() {
  const t = tokenJson();
  if (!t?.refresh_token) return false;
  const res = await fetch('https://parc.land/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const j = await res.json();
  if (!j.access_token) return false;
  writeFileSync(TOKEN_FILE, JSON.stringify(j), { mode: 0o600 });
  return true;
}
async function proxyMcp(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = async () => fetch('https://parc.land/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenJson()?.access_token ?? ''}` },
    body,
  });
  let upstream = await send();
  if (upstream.status === 401 && (await refreshToken())) upstream = await send();
  res.writeHead(upstream.status, { 'content-type': 'application/json' });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

createServer((req, res) => {
  let path = req.url.split('?')[0];
  if (path === '/mcp' && req.method === 'POST') { void proxyMcp(req, res); return; }
  if (path === '/token-status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ authed: !!tokenJson()?.access_token }));
    return;
  }
  const file = join(pub, path === '/' ? 'index.html' : path);
  if (!existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'text/plain' });
  res.end(readFileSync(file));
}).listen(8788, () => console.log('home harness on http://127.0.0.1:8788'));
