/**
 * Bundle the home cell client for local iteration.
 * Stubs the kernel bridge so it runs standalone (optionally with live data via
 * a PARC_TOKEN stored in localStorage).
 *
 * Usage:
 *   node build.mjs          one-shot build
 *   node build.mjs --watch  rebuild on change
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..'); // cells/home/devtools → repo root

const watching = process.argv.includes('--watch');

// Redirect the auth module (imported by main.tsx) to our stub, resolve
// @parc/ui to the real platform source, and patch the vendor import.
const homeDevStub = {
  name: 'home-dev-stub',
  setup(b) {
    // main.tsx imports from './auth' — redirect to our kernel stub
    b.onResolve({ filter: /\.\/auth$/ }, (args) => {
      if (args.importer.includes('cells/home/client/main.tsx')) {
        return { path: join(here, 'kernel-stub.js') };
      }
      return undefined;
    });
    // @parc/ui → real source
    b.onResolve({ filter: /^@parc\/ui$/ }, () => ({
      path: join(repo, 'platform/ui/parc-ui.ts'),
    }));
    // ../vendor/command-core.js → the kernel static file
    b.onResolve({ filter: /command-core\.js$/ }, () => ({
      path: join(repo, 'cells/kernel/static/command-core.js'),
    }));
  },
};

const opts = {
  entryPoints: [join(repo, 'cells/home/client/main.tsx')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(here, 'public/app.js'),
  plugins: [homeDevStub],
  loader: { '.css': 'css', '.json': 'json', '.tsx': 'tsx', '.ts': 'ts' },
  logLevel: 'info',
  sourcemap: 'inline',
  // three.js and addons are loaded at runtime via dynamic import from esm.sh;
  // they are NOT bundled. Only React + the cell code ends up here.
  external: [],
  nodePaths: [join(repo, 'node_modules')],
  tsconfig: join(here, 'tsconfig.json'),
  define: {
    'process.env.NODE_ENV': '"development"',
  },
};

if (watching) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('watching for changes…');
} else {
  await build(opts);
  console.log('built public/app.js');
}
