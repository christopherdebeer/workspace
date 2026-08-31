import { build } from 'esbuild';
import { cp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CELL = resolve(NATIVE, '..');
const OUT = join(NATIVE, 'dist/web');
const development = process.env.DRIVE_BUILD_MODE === 'development';
const pkg = JSON.parse(await readFile(join(NATIVE, 'package.json'), 'utf8'));
const buildId = process.env.DRIVE_BUILD_ID
  ?? process.env.GITHUB_SHA?.slice(0, 12)
  ?? pkg.version;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(CELL, 'web'), OUT, { recursive: true });

const result = await build({
  absWorkingDir: NATIVE,
  entryPoints: [join(NATIVE, 'client-entry.ts')],
  outfile: join(OUT, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'safari15'],
  minify: !development,
  sourcemap: development ? 'external' : false,
  sourcesContent: development,
  legalComments: 'none',
  metafile: true,
  alias: {
    three: join(NATIVE, 'node_modules/three/build/three.module.js'),
  },
  define: {
    __DRIVE_PACKAGED__: 'true',
    __DRIVE_BUILD__: JSON.stringify(buildId),
  },
  logLevel: 'info',
});

const source = await readFile(join(CELL, 'index.ts'), 'utf8');
const shell = source.match(/<head>[\s\S]*?<\/body>/)?.[0];
if (!shell) throw new Error('could not extract the page shell from index.ts');

const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  [
    "connect-src 'self'",
    'https://c15r-drive.on.parc.land',
    'https://parc.land',
    'https://overpass-api.de',
    'https://overpass.kumi.systems',
    'https://overpass.osm.jp',
    'https://overpass.private.coffee',
    'https://s3.amazonaws.com',
    'https://nominatim.openstreetmap.org',
    'https://api.open-meteo.com',
    'https://tiles.mapterhorn.com',
  ].join(' '),
  "img-src 'self' data: blob:",
  'font-src data:',
  'worker-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const html = `<!doctype html><html>${shell}</html>`
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('src="/app.js"', 'src="./app.js"');

await writeFile(join(OUT, 'index.html'), html);
await writeFile(join(OUT, 'build-meta.json'), JSON.stringify({
  build: buildId,
  generatedAt: new Date().toISOString(),
  outputs: Object.fromEntries(Object.entries(result.metafile.outputs).map(([name, value]) => [
    name,
    { bytes: value.bytes },
  ])),
}, null, 2) + '\n');
