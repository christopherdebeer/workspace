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
  for (const cand of [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`,
  ]) {
    if (files[cand] !== undefined) return cand;
  }
  return null;
}

function loaderFor(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.js')) return 'js';
  return 'ts';
}

/** A CSS import becomes a JS module that injects a <style> tag at load. */
function cssAsJs(css: string): string {
  return `const css = ${JSON.stringify(css)};
const el = document.createElement('style');
el.textContent = css;
document.head.appendChild(el);
export default css;`;
}

/**
 * Resolve a bare (npm) import for the **browser** bundle to an esm.sh URL —
 * the Val Town model: dependencies are fetched as native ES modules at load
 * time, so the cloud build never needs node_modules. An optional import map
 * (`client/imports.json`) pins versions or overrides URLs:
 *
 *   { "yjs": "13.6.27", "xstate": "https://esm.sh/xstate@4.38.3" }
 */
export function resolveBareImport(spec: string, imports?: Record<string, string>): string {
  if (/^https?:\/\//.test(spec)) return spec;
  // Package name = first segment ("@scope/name" counts as one); rest is a subpath.
  const segs = spec.split('/');
  const pkgLen = spec.startsWith('@') ? 2 : 1;
  const pkg = segs.slice(0, pkgLen).join('/');
  const sub = segs.slice(pkgLen).join('/');
  const mapped = imports?.[pkg];
  let base: string;
  if (mapped && /^https?:\/\//.test(mapped)) base = mapped.replace(/\/$/, '');
  else if (mapped) base = `https://esm.sh/${pkg}@${mapped}`;
  else base = `https://esm.sh/${pkg}`;
  return sub ? `${base}/${sub}` : base;
}

/**
 * Bundle a cell's **browser** client (the tier-2 mirror of home's
 * `clientEntry`): relative imports resolve against the src tree, bare imports
 * become esm.sh externals (the browser fetches them as native ES modules), and
 * the output is one ESM `app.js` the cell's handler serves from its package.
 */
export async function bundleClientFiles(
  files: Record<string, string>,
  entry: string,
  imports?: Record<string, string>,
): Promise<string> {
  const eb = await ensureEsbuild();
  if (files[entry] === undefined) {
    const found = resolveKey(files, entry);
    if (!found) throw new Error(`client entry "${entry}" not found in cell source`);
    entry = found;
  }
  const result = await eb.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    plugins: [
      {
        name: 'cell-client-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') return { path: args.path, namespace: 'vfs' };
            if (args.path.startsWith('.')) {
              const key = resolveKey(files, resolveRelative(args.importer, args.path));
              if (!key) return { errors: [{ text: `cannot resolve "${args.path}" from "${args.importer}"` }] };
              return { path: key, namespace: 'vfs' };
            }
            return { path: resolveBareImport(args.path, imports), external: true };
          });
          build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
            const contents = files[args.path] ?? '';
            // `import './x.css'` injects the styles at load time.
            if (args.path.endsWith('.css')) return { contents: cssAsJs(contents), loader: 'js' };
            return { contents, loader: loaderFor(args.path) };
          });
        },
      },
    ],
  });
  return result.outputFiles?.[0]?.text ?? '';
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
