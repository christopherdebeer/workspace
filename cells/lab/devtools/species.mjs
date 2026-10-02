// Runs species.ts (bundled for Node); see there.
import { bundleNode } from './harness.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = await bundleNode(join(dirname(fileURLToPath(import.meta.url)), 'species.ts'));
process.argv = [process.argv[0], out, ...process.argv.slice(2)];
await import(out);
