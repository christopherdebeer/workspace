#!/usr/bin/env node
/**
 * build-cell-runtime — pre-bundle `@parc/runtime/cell` (the platform SDK for
 * forge cells, ADR-0042 Inc 1(a)) into ONE self-contained module and vend it to
 * the cells service as a committed source asset (`cell-runtime.generated.ts`).
 *
 * Why pre-bundle + commit (not resolve monorepo TS at deploy): the forge cell
 * bundler runs INSIDE the cells-service Lambda (esbuild-wasm, no node_modules
 * fs). It can't reach the monorepo's `platform/runtime/*.ts`. So we bundle the
 * cell SDK here — at monorepo build time, where the source lives — with the v3
 * AWS SDK (and node builtins) left EXTERNAL (the cell's Node 20 runtime provides
 * them ambiently). The result is a ~50KB flat CJS string the cells service
 * serves as a virtual module when a cell imports `@parc/runtime/cell`.
 *
 * Run after editing anything under `platform/runtime/cell-sdk.ts`'s import graph.
 * The generated file is committed (like the sync-platform-ui copies) so a fresh
 * checkout + `cdk deploy` needs no extra build wiring.
 *
 *   node scripts/build-cell-runtime.mjs
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'platform/runtime/cell-sdk.ts');
const out = join(root, 'services/cells/cell-runtime.generated.ts');

// ── @parc/ui (ADR-0044 Inc 3): platform/ui pre-bundled for BOTH cell bundles.
// ESM (the client bundle needs importable ESM; esbuild interops it into the CJS
// server bundle), react EXTERNAL (server resolves forge's disk react — one React
// per cell — client resolves esm.sh at the cell's own pin).
const uiEntry = join(root, 'platform/ui/parc-ui.ts');
const uiOut = join(root, 'services/cells/cell-ui.generated.ts');
const uiRes = await build({
  entryPoints: [uiEntry],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'neutral',
  jsx: 'automatic',
  write: false,
  external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  logLevel: 'warning',
});
const uiCode = uiRes.outputFiles?.[0]?.text ?? '';
if (!uiCode) throw new Error('empty @parc/ui bundle');
if (/@aws-sdk|aws-sdk/.test(uiCode)) throw new Error('AWS SDK leaked into the @parc/ui bundle');
writeFileSync(
  uiOut,
  `/* GENERATED — do NOT edit. Built from platform/ui/parc-ui.ts by\n` +
    ` * scripts/build-cell-runtime.mjs. The pre-bundled @parc/ui kit (ADR-0044\n` +
    ` * Inc 3), served to forge cells as a virtual module by transpile.ts for\n` +
    ` * BOTH the server and browser bundles. react/react-dom are external. */\n` +
    `export const CELL_UI_BUNDLE = ${JSON.stringify(uiCode)};\n`,
);
console.log(`wrote ${uiOut} (${(uiCode.length / 1024).toFixed(1)}kb bundle)`);

const res = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'node',
  write: false,
  // The cell's Node 20 runtime provides these; never bundle them into the cell.
  external: ['@aws-sdk/*', 'aws-sdk'],
  logLevel: 'warning',
});

const code = res.outputFiles?.[0]?.text ?? '';
if (!code) throw new Error('empty bundle');
// Guardrails: the curation must hold, or a cell would break at runtime.
if (/require\(["']aws-sdk["']\)/.test(code)) throw new Error('v2 aws-sdk leaked into the cell runtime bundle');
if (!/@aws-sdk\/client-dynamodb/.test(code)) throw new Error('expected v3 @aws-sdk/client-dynamodb external reference missing');

const banner =
  `/* GENERATED — do NOT edit. Built from platform/runtime/cell-sdk.ts by\n` +
  ` * scripts/build-cell-runtime.mjs. The pre-bundled @parc/runtime/cell SDK\n` +
  ` * (ADR-0042 Inc 1a), served to forge cells as a virtual module by transpile.ts.\n` +
  ` * @aws-sdk/* and node builtins are external (the cell's Node 20 runtime). */\n`;
writeFileSync(out, `${banner}export const CELL_RUNTIME_BUNDLE = ${JSON.stringify(code)};\n`);
console.log(`wrote ${out} (${(code.length / 1024).toFixed(1)}kb bundle)`);
