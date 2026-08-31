import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const native = resolve(import.meta.dirname, '..');
const html = await readFile(join(native, 'dist/web/index.html'), 'utf8');
const js = await readFile(join(native, 'dist/web/app.js'), 'utf8');
const manifest = JSON.parse(await readFile(join(native, 'dist/web/manifest.webmanifest'), 'utf8'));

const pngSize = async (path) => {
  const png = await readFile(join(native, 'dist/web', path));
  if (png.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

const checks = [
  ['local app bundle', html.includes('src="./app.js"')],
  ['packaged CSP', html.includes('Content-Security-Policy')],
  ['worker CSP', html.includes("worker-src blob:")],
  ['web manifest', html.includes('rel="manifest" href="/manifest.webmanifest"')],
  ['Apple touch icon', html.includes('rel="apple-touch-icon"')],
  ['safe-area menu', js.includes('safe-area-inset-top')],
  ['maskable icon', manifest.icons.some((icon) => icon.purpose === 'maskable')],
  ['live cell endpoint', js.includes('c15r-drive.on.parc.land')],
  ['Three.js bundled', !js.includes('https://esm.sh/three')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`verification failed: ${name}`);
  console.log(`ok: ${name}`);
}

for (const [path, expected] of [
  ['icons/drive-32.png', 32],
  ['icons/drive-180.png', 180],
  ['icons/drive-192.png', 192],
  ['icons/drive-512.png', 512],
  ['icons/drive-maskable-512.png', 512],
]) {
  const [width, height] = await pngSize(path);
  if (width !== expected || height !== expected) {
    throw new Error(`verification failed: ${path} is ${width}x${height}`);
  }
  console.log(`ok: ${path} (${width}x${height})`);
}
