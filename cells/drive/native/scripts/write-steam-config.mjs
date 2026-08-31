import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STEAM = join(NATIVE, 'dist/steam');
const CONFIG = join(STEAM, 'config');
const CONTENT = join(STEAM, 'content');
const LOGS = join(STEAM, 'logs');

const steamId = (name) => {
  const value = process.env[name];
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} must be a numeric Steam ID`);
  return value;
};
const appId = steamId('STEAM_APP_ID');

const depotEnv = {
  windows: 'STEAM_DEPOT_WINDOWS',
  macos: 'STEAM_DEPOT_MACOS',
  linux: 'STEAM_DEPOT_LINUX',
};
const depots = Object.entries(depotEnv)
  .map(([platform, env]) => ({ platform, id: process.env[env] ? steamId(env) : undefined }))
  .filter((entry) => entry.id);
if (!depots.length) {
  throw new Error(`set at least one of ${Object.values(depotEnv).join(', ')}`);
}

const q = (value) => `"${String(value).replace(/[\r\n\t]+/g, ' ')
  .replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
const block = (name, rows) => `${q(name)}\n{\n${rows.map(([k, v]) => `  ${q(k)} ${q(v)}`).join('\n')}\n}\n`;

await mkdir(CONFIG, { recursive: true });
await mkdir(LOGS, { recursive: true });

for (const depot of depots) {
  const body = block('DepotBuildConfig', [
    ['DepotID', depot.id],
    ['ContentRoot', CONTENT],
    ['FileMapping', ''],
  ]).replace(
    `  "FileMapping" ""`,
    [
      '  "FileMapping"',
      '  {',
      `    "LocalPath" ${q(`${depot.platform}/*`)}`,
      '    "DepotPath" "."',
      '    "recursive" "1"',
      '  }',
      '  "FileExclusion" "*.pdb"',
      '  "FileExclusion" "*.dSYM/*"',
    ].join('\n'),
  );
  await writeFile(join(CONFIG, `depot_${depot.id}.vdf`), body);
}

const depotRows = depots.map((depot) =>
  `    ${q(depot.id)} ${q(join(CONFIG, `depot_${depot.id}.vdf`))}`).join('\n');
const setLive = process.env.STEAM_SET_LIVE
  ? `  "setlive" ${q(process.env.STEAM_SET_LIVE)}\n`
  : '';
const app = [
  '"AppBuild"',
  '{',
  `  "AppID" ${q(appId)}`,
  `  "Desc" ${q(process.env.STEAM_BUILD_DESCRIPTION || `Drive ${new Date().toISOString()}`)}`,
  `  "BuildOutput" ${q(LOGS)}`,
  `  "Preview" ${q(process.env.STEAM_PREVIEW === '1' ? '1' : '0')}`,
  setLive.trimEnd(),
  '  "Depots"',
  '  {',
  depotRows,
  '  }',
  '}',
  '',
].filter((line) => line !== '').join('\n');
const appPath = join(CONFIG, 'app_build.vdf');
await writeFile(appPath, app + '\n');
console.log(appPath);
