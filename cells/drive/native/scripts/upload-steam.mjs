import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./write-steam-config.mjs');

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = join(NATIVE, 'dist/steam/config/app_build.vdf');
const user = process.env.STEAM_USER;
if (!user) throw new Error('STEAM_USER is required');

const args = ['+login', user];
if (process.env.STEAM_PASSWORD) args.push(process.env.STEAM_PASSWORD);
args.push('+run_app_build', config, '+quit');

const child = spawn(process.env.STEAMCMD ?? 'steamcmd', args, {
  stdio: 'inherit',
  shell: false,
});
const code = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', done);
});
if (code !== 0) process.exit(code ?? 1);
