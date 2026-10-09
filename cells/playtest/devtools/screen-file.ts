// Free bot screen of a RULES.md file through the real engine (no Jev): measures with standard errors and the targets term.
//   node cells/playtest/devtools/out/pt-build.mjs cells/playtest/devtools/screen-file.ts /tmp/screen.mjs && node /tmp/screen.mjs <rules.md> [seeds=12]   (seeds × players 3 and 4; a 300 s deadline caps it)
import { readFileSync } from 'node:fs';
import { screen } from '../lib/screen';
declare const process: { argv: string[] };
const rules = readFileSync(process.argv[2], 'utf8');
const seeds = Array.from({ length: Number(process.argv[3] ?? 12) }, (_, i) => i + 1);
const r = await screen(rules, { seeds, players: [3, 4], maxSteps: 200, deadlineAt: Date.now() + 300_000, policy: 'greedy' });
const { sample, ...rest } = r as any;
console.log(JSON.stringify(rest, null, 1));
