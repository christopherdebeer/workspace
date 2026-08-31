// Size and shape the overview tiles BEFORE they exist anywhere: build the
// cell handler, shim fetch through curl (node fetch ignores the agent proxy),
// and invoke it at contrasting spots.
import { execSync, execFile } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/drive-tools/ov-handler.cjs';
execSync(`npx esbuild ${join(HERE, '../index.ts')} --bundle --platform=node --format=cjs --external:@aws-sdk/* --outfile=${OUT}`,
  { stdio: 'pipe', cwd: join(HERE, '../../..') });

globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
  const args = ['-sS', '--compressed', '--max-time', '55', '--cacert', '/root/.ccr/ca-bundle.crt',
    '-w', '\n%{http_code}', '-X', opts.method ?? 'GET'];
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push('-H', `${k}: ${v}`);
  if (opts.body) args.push('--data-binary', opts.body);
  args.push(url);
  const child = execFile('curl', args, { encoding: 'buffer', maxBuffer: 128e6 }, (e, out) => {
    if (e) return reject(Object.assign(new Error(aborted ? 'aborted (attempt budget)' : String(e.message).slice(0, 80)), { name: aborted ? 'AbortError' : 'Error' }));
    const nl = out.lastIndexOf(0x0a);
    const status = Number(out.slice(nl + 1).toString());
    const body = out.slice(0, nl);
    resolve({
      ok: status >= 200 && status < 300, status,
      json: async () => JSON.parse(body.toString()),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    });
  });
  // Honour the handler's own AbortController, or every measurement reads as
  // curl's 55s instead of the budget the Lambda actually has.
  let aborted = false;
  if (opts.signal) opts.signal.addEventListener('abort', () => { aborted = true; child.kill(); });
});

const { handler } = await import(OUT);
const t2 = (lat, lon, z) => {
  const n = 2 ** z;
  return [Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)];
};

const SPOTS = [
  ['Isterdalen (rural Norway)', 62.4498, 7.6684],
  ['central London (worst case)', 51.5074, -0.1278],
  ['mid-Atlantic (empty)', 40, -35],
  ['Cape Town coast', -34.0672, 18.3702],
];
for (const z of [10, 11, 12]) {
  for (const [name, lat, lon] of SPOTS) {
    const [x, y] = t2(lat, lon, z);
    const t0 = Date.now();
    const res = await handler({ rawPath: `/~/osm/ov1/${z}/${x}/${y}` });
    const ms = Date.now() - t0;
    if (res.statusCode !== 200) {
      console.log(`z${z} ${name}: HTTP ${res.statusCode} ${res.body.slice(0, 90)} (${ms}ms)`);
      continue;
    }
    const gz = Buffer.from(res.body, 'base64');
    const data = JSON.parse(gunzipSync(gz).toString());
    const kinds = {};
    let pts = 0;
    for (const w of data.ways) {
      const t = w.tags;
      const k = t.highway ? `hw:${t.highway}` : t.railway ? 'rail' : t.waterway ? 'water'
        : t.place ? `place:${t.place}` : t.natural ?? '?';
      kinds[k] = (kinds[k] ?? 0) + 1;
      pts += w.geometry.length;
    }
    console.log(`z${z} ${name}: ${(gz.length / 1024).toFixed(1)}KB gz, ${data.ways.length} ways, ${pts} pts (${ms}ms)`);
    console.log('   ', JSON.stringify(kinds));
  }
}
