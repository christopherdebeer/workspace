import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./write-steam-config.mjs');

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = join(NATIVE, 'dist/steam/config/app_build.vdf');
const user = process.env.STEAM_USER;
if (!user) throw new Error('STEAM_USER is required');

/**
 * A BUILD ACCOUNT WITH STEAM GUARD CANNOT LOG IN ON A PASSWORD ALONE.
 *
 * SteamCMD authorises a machine once and then remembers it in its own
 * `config.vdf`. A CI runner is a new machine every time, so `+login user pass`
 * on a guarded account stops for a code that nobody is there to type, and the
 * job hangs or fails with a two-factor mismatch. The supported way through is
 * to authorise the account once by hand, base64 that `config.vdf`, and hand it
 * back to every run — which is what STEAM_CONFIG_VDF is.
 *
 * It goes in before SteamCMD starts, because SteamCMD reads it at login and
 * rewrites it afterwards. `STEAM_HOME` overrides where, for a runner that
 * keeps its Steam root somewhere other than the home directory.
 */
const encoded = process.env.STEAM_CONFIG_VDF?.trim();
if (encoded) {
  const dir = join(process.env.STEAM_HOME || join(homedir(), 'Steam'), 'config');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.vdf'), Buffer.from(encoded, 'base64'));
  console.log(`restored Steam login state to ${dir}/config.vdf`);
}

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
