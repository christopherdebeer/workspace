import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json' };
createServer((req, res) => {
  let path = req.url.split('?')[0];
  if (path === '/parcland') path = '/pan.html'; // board id lives in the PATH (url.ts)
  const file = join(pub, path === '/' ? 'index.html' : path);
  if (!existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'text/plain' });
  res.end(readFileSync(file));
}).listen(8787, () => console.log('harness on http://127.0.0.1:8787'));
