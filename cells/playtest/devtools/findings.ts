// Print a definition's classification findings in full (no Jev): node findings.mjs <RULES.md>
import { readFileSync } from 'node:fs';
import { classify } from '../lib/runner';
declare const process: { argv: string[] };
const c = await classify(readFileSync(process.argv[2], 'utf8'), null);
for (const f of c.findings) console.log(`${f.severity} ${f.kind} ${f.subject}: ${f.detail}`);
console.log('schema', JSON.stringify(c.schema, null, 1));
