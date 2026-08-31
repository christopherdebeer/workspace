import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = join(NATIVE, 'dist/electron');
const CONTENT = join(NATIVE, 'dist/steam/content');
const requested = process.argv[2] ?? 'all';

const platforms = {
  windows: {
    candidates: ['win-unpacked'],
    appIdFile: (dest) => join(dest, 'steam_appid.txt'),
  },
  linux: {
    candidates: ['linux-unpacked'],
    appIdFile: (dest) => join(dest, 'steam_appid.txt'),
  },
  macos: {
    candidates: ['mac-universal', 'mac-arm64', 'mac'],
    // Never add files inside Drive.app after signing; that invalidates the
    // bundle seal. Steam sets the App ID at launch, and this root file is only
    // for local runs from the staged directory.
    appIdFile: (dest) => join(dest, 'steam_appid.txt'),
  },
};

const names = requested === 'all' ? Object.keys(platforms) : [requested];
for (const name of names) {
  const spec = platforms[name];
  if (!spec) throw new Error(`unknown platform "${name}" (use windows, macos, linux, or all)`);
  const sourceName = spec.candidates.find((candidate) => existsSync(join(ELECTRON, candidate)));
  if (!sourceName) {
    if (requested === 'all') continue;
    throw new Error(`no ${name} package found under ${ELECTRON}`);
  }
  const source = join(ELECTRON, sourceName);
  const dest = join(CONTENT, name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true, preserveTimestamps: true });
  if (process.env.STEAM_APP_ID) {
    const appIdFile = await spec.appIdFile(dest);
    await writeFile(appIdFile, `${process.env.STEAM_APP_ID}\n`);
  }
  console.log(`${name}: ${source} -> ${dest}`);
}
