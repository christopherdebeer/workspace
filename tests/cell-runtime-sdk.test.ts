/**
 * Platform SDK for cells (ADR-0042 Inc 1a) — the forge bundler must resolve a
 * cell's `@parc/runtime/cell` import to the pre-bundled read/present pipeline,
 * inlining the reader while leaving the v3 AWS SDK external (the cell's Node 20
 * runtime provides it). Driven with the REAL esbuild via the `__setEsbuild` seam
 * so the resolve/load plugin is exercised end-to-end, not stubbed.
 */
import * as esbuild from 'esbuild';
import { bundleFiles, __setEsbuild } from '../services/cells/transpile';

beforeAll(() => {
  // Plain esbuild shares the build API with esbuild-wasm; the bundler skips
  // `initialize` when an impl is injected.
  __setEsbuild(esbuild as unknown as typeof import('esbuild-wasm'));
});

describe('@parc/runtime/cell resolution in the forge bundler', () => {
  it('inlines the reader pipeline and keeps the v3 AWS SDK external (no v2)', async () => {
    const files = {
      'index.ts': `import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
export const handler = async () => {
  const read = createCellReader(createDynamoStateStore('T'), 'c15r');
  return read.peek('doc:welcome');
};`,
    };
    const js = await bundleFiles(files);
    // The SDK is bundled IN (a cell doesn't hand-roll it).
    expect(js).toMatch(/createCellReader/);
    expect(js).toMatch(/createObservedState/);
    // The v3 client stays a runtime require (external), never inlined; v2 never appears.
    expect(js).toMatch(/require\("@aws-sdk\/client-dynamodb"\)/);
    expect(js).toMatch(/require\("@aws-sdk\/lib-dynamodb"\)/);
    expect(js).not.toMatch(/require\("aws-sdk"\)/);
    // Curation held: no vector machinery dragged along.
    expect(js).not.toMatch(/cosineSimilarity|HashingEmbedder/);
  });

  it('a cell that does NOT import the SDK is unaffected (external fallback intact)', async () => {
    const files = { 'index.ts': `export const handler = async () => ({ ok: true });` };
    const js = await bundleFiles(files);
    expect(js).toMatch(/ok:\s*true/);
    expect(js).not.toMatch(/createCellReader/);
  });
});
