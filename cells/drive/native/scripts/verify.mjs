import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const native = resolve(import.meta.dirname, '..');
const html = await readFile(join(native, 'dist/web/index.html'), 'utf8');
const js = await readFile(join(native, 'dist/web/app.js'), 'utf8');

const checks = [
  ['local app bundle', html.includes('src="./app.js"')],
  ['packaged CSP', html.includes('Content-Security-Policy')],
  ['worker CSP', html.includes("worker-src blob:")],
  ['live cell endpoint', js.includes('c15r-drive.on.parc.land')],
  ['Three.js bundled', !js.includes('https://esm.sh/three')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`verification failed: ${name}`);
  console.log(`ok: ${name}`);
}
