import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const native = resolve(import.meta.dirname, '..');
const out = join(native, 'dist/test/sync.mjs');
await mkdir(join(native, 'dist/test'), { recursive: true });
await build({
  entryPoints: [resolve(native, '../client/sync.ts')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  logLevel: 'silent',
});

class Store {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

globalThis.location = {
  host: 'localhost',
  pathname: '/',
  origin: 'capacitor://localhost',
  href: 'capacitor://localhost/',
  search: '',
};
globalThis.history = { replaceState() {} };
globalThis.localStorage = new Store();
globalThis.sessionStorage = new Store();

const calls = [];
globalThis.fetch = async (raw, init = {}) => {
  const url = String(raw);
  calls.push({ url, init });
  if (url.endsWith('/auth/device')) {
    return Response.json({
      device_code: 'device-1',
      user_code: 'ABCD-1234',
      verification_uri_complete: 'https://parc.land/auth/device?user_code=ABCD-1234',
      expires_in: 30,
      interval: 0,
    });
  }
  if (url.endsWith('/oauth/token')) {
    return Response.json({ access_token: 'access-1', refresh_token: 'refresh-1' });
  }
  if (url.endsWith('/state')) {
    return Response.json({
      user: 'alice',
      roads: {},
      missions: {},
      stations: {},
      odo: 0,
      tapes: [],
    });
  }
  return Response.json({ error: 'unexpected request' }, { status: 500 });
};

const { openSync } = await import(`${out}?${Date.now()}`);
let opened = '';
let closed = 0;
const sync = openSync({
  dump: () => ({}),
  merge: () => 0,
  marks: () => ({ missions: {}, stations: {} }),
  mergeMarks: () => 0,
  odo: () => 0,
  setOdo: () => undefined,
}, {
  base: 'https://cell.test',
  apex: 'https://auth.test',
  authMode: 'device',
  openExternal: async (url) => { opened = url; },
  closeExternal: async () => { closed++; },
});

await sync.signIn();
assert.equal(opened, 'https://parc.land/auth/device?user_code=ABCD-1234');
assert.equal(closed, 1);
assert.equal(localStorage.getItem('drive.sync.token'), 'access-1');
assert.equal(localStorage.getItem('drive.sync.refresh'), 'refresh-1');
assert.equal(sync.status().phase, 'on');
assert.equal(sync.status().user, 'alice');
assert.deepEqual(calls.map((call) => call.url), [
  'https://auth.test/auth/device',
  'https://auth.test/oauth/token',
  'https://cell.test/state',
]);
console.log('ok: native device authorization');
