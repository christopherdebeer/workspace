/**
 * TypeScript → JavaScript transpilation for dynamic cells.
 *
 * Cells are authored in TypeScript (platform tenet, and so a cell is written the
 * same way as a tier-1 cell — which makes promotion a copy, not a port). Lambda
 * runs JavaScript, so `forge` transpiles the submitted source with `esbuild-wasm`
 * (portable WASM, no native binary) before packaging it. v1 transpiles a single
 * self-contained module; bundling imported modules is a later enhancement.
 */
type Esbuild = typeof import('esbuild-wasm');

let esbuild: Esbuild | undefined;
let initPromise: Promise<void> | undefined;

/** Inject an esbuild implementation (tests, to avoid loading the WASM). */
export function __setEsbuild(stub: Esbuild | undefined): void {
  esbuild = stub;
  initPromise = undefined;
}

async function ensureEsbuild(): Promise<Esbuild> {
  if (!esbuild) {
    esbuild = require('esbuild-wasm') as Esbuild;
  }
  if (!initPromise) {
    // No-arg initialize works in Node: esbuild-wasm locates its own .wasm in the
    // installed package (shipped via the Lambda's node_modules, not bundled).
    initPromise = esbuild.initialize({});
  }
  await initPromise;
  return esbuild;
}

/** Transpile a TypeScript cell module to CommonJS JavaScript. */
export async function transpileCell(source: string): Promise<string> {
  const eb = await ensureEsbuild();
  const out = await eb.transform(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2020',
    platform: 'node',
  });
  return out.code;
}

/** Resolve a relative import (`./util.ts`) against the importer's directory. */
function resolveRelative(importer: string, spec: string): string {
  const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const stack: string[] = [];
  for (const seg of `${dir ? dir + '/' : ''}${spec}`.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg && seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

/** Pick the on-disk key for a resolved path, trying `.ts`/`.js`/`/index.ts`. */
function resolveKey(files: Record<string, string>, base: string): string | null {
  for (const cand of [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`]) {
    if (files[cand] !== undefined) return cand;
  }
  return null;
}

/**
 * Bundle a multi-file TypeScript cell (`files`: relative path → source) into one
 * CommonJS module, resolving relative imports against the in-memory tree via an
 * esbuild virtual-FS plugin. Bare/npm imports stay external (provided by the
 * Lambda runtime/layers), exactly as the single-module path leaves them.
 */
export async function bundleFiles(files: Record<string, string>, entry = 'index.ts'): Promise<string> {
  const eb = await ensureEsbuild();
  if (files[entry] === undefined) {
    const found = resolveKey(files, entry);
    if (!found) throw new Error(`entry "${entry}" not found in cell source`);
    entry = found;
  }
  const result = await eb.build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    target: 'es2020',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'cell-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') return { path: args.path, namespace: 'vfs' };
            if (args.path.startsWith('.')) {
              const key = resolveKey(files, resolveRelative(args.importer, args.path));
              if (!key) return { errors: [{ text: `cannot resolve "${args.path}" from "${args.importer}"` }] };
              return { path: key, namespace: 'vfs' };
            }
            return { path: args.path, external: true }; // npm / runtime-provided
          });
          build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => ({
            contents: files[args.path] ?? '',
            loader: args.path.endsWith('.js') ? 'js' : 'ts',
          }));
        },
      },
    ],
  });
  return result.outputFiles?.[0]?.text ?? '';
}
