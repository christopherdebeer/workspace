// Bundle the real canvas client with the remote kernel stubbed out, for the
// headless gesture repro (see README.md).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..'); // cells/canvas/devtools/headless-repro → repo root

const kernelStub = {
  name: 'kernel-stub',
  setup(b) {
    b.onResolve({ filter: /^https:\/\/parc\.land\// }, () => ({
      path: join(here, 'kernel-stub.js'),
    }));
  },
};

await build({
  entryPoints: [join(repo, 'cells/canvas/client/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(here, 'public/app.js'),
  plugins: [kernelStub],
  loader: { '.css': 'css' },
  logLevel: 'warning',
  sourcemap: 'inline',
  nodePaths: [join(here, 'node_modules')],
});
console.log('built public/app.js');
