/* ---------------------------------------------------------------------------
 * build-vendor.mjs — bundle the graph's 3D deps (three + addons + troika)
 * into ONE minified ESM file, content-hashed for the immutable blob cache.
 *
 *   node build-vendor.mjs            → dist/three-vendor-<hash8>.js
 *
 * Upload (scripts/upload-home-vendor.mjs) pushes it to the home cell's public
 * data space via cells.putData; scene.ts imports it by the hashed URL. The
 * hash IS the cache key — `_data` serves with max-age=31536000, immutable, so
 * a new build must mint a new filename (and scene.ts must name it).
 * ------------------------------------------------------------------------- */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist');
mkdirSync(outDir, { recursive: true });

const tmp = join(outDir, 'three-vendor.tmp.js');
await build({
  entryPoints: [join(here, 'vendor-entry.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  outfile: tmp,
  logLevel: 'warning',
});

const body = readFileSync(tmp);
const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
const name = `three-vendor-${hash}.js`;
for (const f of readdirSync(outDir)) if (f.startsWith('three-vendor-') && f !== name) unlinkSync(join(outDir, f));
writeFileSync(join(outDir, name), body);
unlinkSync(tmp);
console.log(`built dist/${name} (${(body.length / 1024).toFixed(0)}KB)`);
console.log(`blob key: public/vendor/${name}`);

// ── the label fonts (troika SDF needs real .woff URLs) ─────────────────────
// Mirrored from the pinned @fontsource packages so the graph's typography is
// first-party too (same jsdelivr flap exposure as esm.sh). Versioned paths →
// immutable keys; style.ts names them under public/vendor/fonts/.
const FONTS = [
  'ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-600-normal.woff',
  'ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-500-normal.woff',
  'ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-400-italic.woff',
  'source-serif-4@5.1.0/files/source-serif-4-latin-400-italic.woff',
  'source-serif-4@5.1.0/files/source-serif-4-latin-400-normal.woff',
  'ibm-plex-mono@5.1.0/files/ibm-plex-mono-latin-500-normal.woff',
];
for (const path of FONTS) {
  const [pkg, , file] = path.split('/');
  // Blob path segments allow only [A-Za-z0-9._-] — encode `pkg@ver` as `pkg-ver`.
  const destDir = join(outDir, 'fonts', pkg.replace('@', '-'));
  const dest = join(destDir, file);
  try { readFileSync(dest); continue; } catch { /* not mirrored yet */ }
  const res = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${path}`);
  if (!res.ok) throw new Error(`font fetch failed: ${path} HTTP ${res.status}`);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`mirrored fonts/${pkg}/${file}`);
}
