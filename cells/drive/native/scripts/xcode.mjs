import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function xcodeContainer() {
  const workspace = join(NATIVE, 'ios/App/App.xcworkspace');
  if (existsSync(workspace)) return ['-workspace', workspace];
  const project = join(NATIVE, 'ios/App/App.xcodeproj');
  if (existsSync(project)) return ['-project', project];
  throw new Error('iOS project is missing; run npm run ios:add first');
}

export async function run(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: NATIVE,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  });
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  if (code !== 0) throw new Error(`${command} exited with ${code}`);
}
