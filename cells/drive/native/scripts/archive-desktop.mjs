import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const native = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electron = join(native, 'dist/electron');
const out = join(native, 'dist/artifacts');
const platform = process.argv[2];
const candidates = {
  windows: ['win-unpacked'],
  macos: ['mac-universal', 'mac-arm64', 'mac'],
  linux: ['linux-unpacked'],
};
if (!candidates[platform]) {
  throw new Error('platform must be windows, macos, or linux');
}
const sourceName = candidates[platform].find((name) => existsSync(join(electron, name)));
if (!sourceName) throw new Error(`no ${platform} package found under ${electron}`);

await mkdir(out, { recursive: true });
const archive = join(out, `drive-${platform}.tar.gz`);
const child = spawn('tar', ['-czf', archive, '-C', join(electron, sourceName), '.'], {
  stdio: 'inherit',
  shell: false,
});
const code = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', done);
});
if (code !== 0) throw new Error(`tar exited with ${code}`);
console.log(archive);
