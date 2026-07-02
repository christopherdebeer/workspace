/**
 * TypeScript → JavaScript transpilation for dynamic cells.
 *
 * Cells are authored in TypeScript (platform tenet, and so a cell is written the
 * same way as a tier-1 cell — which makes promotion a copy, not a port). Lambda
 * runs JavaScript, so `forge` transpiles the submitted source with `esbuild-wasm`
 * (portable WASM, no native binary) before packaging it. v1 transpiles a single
 * self-contained module; bundling imported modules is a later enhancement.
 */
import { CELL_RUNTIME_BUNDLE } from './cell-runtime.generated';
import { CELL_UI_BUNDLE } from './cell-ui.generated';

type Esbuild = typeof import('esbuild-wasm');

let esbuild: Esbuild | undefined;
let initPromise: Promise<void> | undefined;

/** The platform SDK for cells (ADR-0042 Inc 1a): a cell's `@parc/runtime/cell`
 *  import resolves to the pre-bundled `CELL_RUNTIME_BUNDLE` (the read/present
 *  pipeline + v3 store), served as a virtual module. Its own `@aws-sdk/*`
 *  requires stay external (the cell's Node 20 runtime provides v3). This is how
 *  a cell runs the SAME core the gateway does without importing the monorepo
 *  (which the in-Lambda bundler can't reach) or hand-rolling raw DDB. */
const PARC_SDK_PKG = '@parc/runtime';
const PARC_SDK_NS = 'parc-sdk';
// ADR-0044 Inc 3: `@parc/ui` — the platform UI kit as a virtual module, served
// to BOTH bundles (server SSR + browser app.js) so an isomorphic cell imports
// one kit instead of carrying synced source copies.
const PARC_UI_PKG = '@parc/ui';
const PARC_UI_NS = 'parc-ui';

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
            // `@parc/ui` → the pre-bundled platform UI kit; its own bare imports
            // (react, react/jsx-runtime) fall through to the esm.sh external
            // branch below — the same resolution cell source gets.
            if (barePackage(args.path) === PARC_UI_PKG) return { path: args.path, namespace: PARC_UI_NS };
            return { path: resolveBareImport(args.path, imports), external: true };
          });
          build.onLoad({ filter: /.*/, namespace: PARC_UI_NS }, () => ({ contents: CELL_UI_BUNDLE, loader: 'js' }));
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
 * Server-bundleable npm packages: the few we ship in forge's own `node_modules`
 * (via the cells service `bundlingNodeModules`) so a cell's server can do real
 * isomorphic SSR. These are NOT externalized — esbuild resolves them from disk
 * and inlines them into the cell's `index.js`. `react`/`react-dom` give a cell
 * `renderToString` + the automatic-JSX runtime, matching the client's React (which
 * the browser bundle pulls from esm.sh) so server markup hydrates without a flash.
 * Everything else bare stays external (provided by the Lambda runtime).
 */
const SERVER_BUNDLED = new Set(['react', 'react-dom', 'scheduler']);

/** The package name of a bare specifier (`react-dom/server` → `react-dom`). */
function barePackage(spec: string): string {
  const segs = spec.split('/');
  return spec.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
}

/** esbuild namespace for modules fetched from a CDN (esm.sh) at bundle time. */
const HTTP_NS = 'cell-http';

/** The CDN URL a declared server dep resolves to — the node build of the package,
 *  so it bundles into the cell's Lambda. Honours an `imports.json` override (a
 *  pinned version or a full URL), exactly like the client bundler — one import map
 *  drives both sides, which is what keeps an isomorphic cell's server and client on
 *  the byte-identical dependency (no hydration skew). */
function serverDepUrl(spec: string, imports?: Record<string, string>): string {
  const url = resolveBareImport(spec, imports);
  if (/^https?:\/\//.test(url) && url.includes('esm.sh') && !url.includes('?')) return `${url}?target=node`;
  return url;
}

/** Fetch a CDN module (with a /tmp cache that survives warm Lambda invocations).
 *  esm.sh serves transpiled ESM with no install scripts and no native binaries, so
 *  this is the portable, supply-chain-narrower alternative to `npm install` (which
 *  the read-only Lambda fs can't do anyway). */
function fetchCached(url: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto');
  const dir = path.join(os.tmpdir(), 'cell-dep-cache');
  const key = path.join(dir, createHash('sha1').update(url).digest('hex'));
  try {
    return Promise.resolve(fs.readFileSync(key, 'utf8') as string);
  } catch {
    /* cache miss */
  }
  return fetch(url).then(async (res: Response) => {
    if (!res.ok) throw new Error(`dependency fetch ${url} → ${res.status}`);
    const body = await res.text();
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(key, body); } catch { /* /tmp full — skip cache */ }
    return body;
  });
}

/**
 * Bundle a multi-file TypeScript cell (`files`: relative path → source) into one
 * CommonJS module, resolving relative imports against the in-memory tree via an
 * esbuild virtual-FS plugin. Bare imports stay external (provided by the Lambda
 * runtime — node builtins, the bundled @aws-sdk) UNLESS they are (a) in the small
 * `SERVER_BUNDLED` allowlist (react et al., inlined from forge's node_modules) or
 * (b) declared in the cell's `imports.json`, in which case they are fetched from
 * esm.sh (node target) and bundled in — arbitrary npm, server-side, no install.
 */
export async function bundleFiles(
  files: Record<string, string>,
  entry = 'index.ts',
  imports?: Record<string, string>,
): Promise<string> {
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
    jsx: 'automatic', // cells may author server views in TSX; harmless for the rest
    // React (and any lib gated on it) ships its production build in the cell —
    // no dev-only warnings/work in the Lambda, and `renderToString` stays fast.
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    plugins: [
      {
        name: 'cell-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') return { path: args.path, namespace: 'vfs' };
            // A transitive import from a CDN module: resolve against its URL.
            if (args.namespace === HTTP_NS) return { path: new URL(args.path, args.importer).href, namespace: HTTP_NS };
            // Inside the pre-bundled platform SDK: it is flat (no relative imports),
            // and its only bare imports are the runtime-provided v3 AWS SDK (+ node
            // builtins) — externalize them, never try to resolve from the wasm fs.
            if (args.namespace === PARC_SDK_NS) return { path: args.path, external: true };
            // Inside the pre-bundled @parc/ui kit: its only bare imports are react
            // (+ react/jsx-runtime) — resolve them from forge's DISK react (the
            // SERVER_BUNDLED set) so the cell holds ONE React instance; anything
            // else is runtime-provided.
            if (args.namespace === PARC_UI_NS) {
              if (SERVER_BUNDLED.has(barePackage(args.path))) {
                try {
                  return { path: require.resolve(args.path) };
                } catch {
                  /* fall through */
                }
              }
              return { path: args.path, external: true };
            }
            // Imports from a bundled npm file (real fs, e.g. react-dom pulling in
            // scheduler) use esbuild's default node_modules resolution.
            if (args.namespace !== 'vfs') return undefined;
            // The platform SDK for cells: `@parc/runtime/cell` → the virtual module
            // holding the pre-bundled read/present pipeline (any subpath resolves to
            // the one bundle; the entry IS `cell-sdk`).
            if (barePackage(args.path) === PARC_SDK_PKG) return { path: args.path, namespace: PARC_SDK_NS };
            if (barePackage(args.path) === PARC_UI_PKG) return { path: args.path, namespace: PARC_UI_NS };
            if (args.path.startsWith('.')) {
              const key = resolveKey(files, resolveRelative(args.importer, args.path));
              if (!key) return { errors: [{ text: `cannot resolve "${args.path}" from "${args.importer}"` }] };
              return { path: key, namespace: 'vfs' };
            }
            // A cell may import a CDN module by URL directly — bundle it in.
            if (/^https?:\/\//.test(args.path)) return { path: args.path, namespace: HTTP_NS };
            // Allowlisted packages resolve to their real path in forge's
            // node_modules and bundle in (react — pinned, exact, reliable).
            if (SERVER_BUNDLED.has(barePackage(args.path))) {
              try {
                return { path: require.resolve(args.path) };
              } catch {
                /* not installed in this runtime — fall through */
              }
            }
            // Declared in imports.json → fetched from esm.sh (node) and bundled.
            if (imports && imports[barePackage(args.path)] !== undefined) {
              return { path: serverDepUrl(args.path, imports), namespace: HTTP_NS };
            }
            return { path: args.path, external: true }; // runtime-provided (node builtins, @aws-sdk)
          });
          build.onLoad({ filter: /.*/, namespace: HTTP_NS }, async (args) => {
            const contents = await fetchCached(args.path);
            const loader = /\.css(\?|$)/.test(args.path) ? 'css' : /\.json(\?|$)/.test(args.path) ? 'json' : 'js';
            return { contents, loader };
          });
          // The platform SDK for cells — one pre-bundled module, served verbatim.
          build.onLoad({ filter: /.*/, namespace: PARC_SDK_NS }, () => ({ contents: CELL_RUNTIME_BUNDLE, loader: 'js' }));
          build.onLoad({ filter: /.*/, namespace: PARC_UI_NS }, () => ({ contents: CELL_UI_BUNDLE, loader: 'js' }));
          build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => ({
            contents: files[args.path] ?? '',
            loader: loaderFor(args.path),
          }));
        },
      },
    ],
  });
  return result.outputFiles?.[0]?.text ?? '';
}
