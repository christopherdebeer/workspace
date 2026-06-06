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
