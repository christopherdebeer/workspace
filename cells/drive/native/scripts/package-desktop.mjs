/**
 * Package the desktop shell for one platform.
 *
 * This exists so that the three `desktop:*` scripts share one place to fix
 * anything that is true of all of them. Today that is two things:
 *
 *  - the signing environment is cleaned before electron-builder reads it (see
 *    `signing-env.mjs`, which carries the failure that motivated it), and
 *  - publishing is refused explicitly. electron-builder detects CI and turns
 *    publishing ON by itself, warning that the behaviour goes away in v27. We
 *    ship through SteamPipe and the App Store, never through a GitHub release,
 *    so the only surprise that default can produce is an unwanted one.
 *
 * electron-builder is spawned as a script under this Node rather than through
 * its shim in `node_modules/.bin`, because that shim is a shell script on one
 * runner and a .cmd on another and the Windows leg of the release matrix is
 * exactly where the difference bites.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signingEnv } from './signing-env.mjs';

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Steam receives unpacked applications, not installers, so every target is
// `--dir`. macOS is universal because a Steam depot serves one binary to both
// architectures; Windows and Linux are x64 because that is what Steam ships.
const TARGETS = {
  // `current` is the local-development target: whatever this machine is.
  current: ['--dir'],
  mac: ['--mac', '--dir', '--universal'],
  win: ['--win', '--dir', '--x64'],
  linux: ['--linux', '--dir', '--x64'],
};

const target = process.argv[2];
if (!TARGETS[target]) {
  throw new Error(`target must be one of ${Object.keys(TARGETS).join(', ')}`);
}

const require = createRequire(import.meta.url);
let cli;
try {
  cli = require.resolve('electron-builder/cli.js');
} catch {
  cli = join(NATIVE, 'node_modules/electron-builder/cli.js');
}

const child = spawn(process.execPath, [cli, ...TARGETS[target], '--publish', 'never'], {
  cwd: NATIVE,
  env: signingEnv(process.env),
  stdio: 'inherit',
  shell: false,
});
const code = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', done);
});
if (code !== 0) throw new Error(`electron-builder exited with ${code}`);
