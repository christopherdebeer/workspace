/**
 * `@parc/ui` — the platform UI kit as a cell-importable module (ADR-0044 Inc 3).
 *
 * This entry is pre-bundled by `scripts/build-cell-runtime.mjs` into
 * `services/cells/cell-ui.generated.ts` and served by the forge bundler as a
 * VIRTUAL module (like `@parc/runtime/cell`) whenever a cell imports
 * `@parc/ui` — server bundle AND browser bundle, so an isomorphic cell renders
 * the same components on both sides. React is EXTERNAL in the pre-bundle: the
 * server side resolves it from forge's disk react (SERVER_BUNDLED — one React
 * instance per cell, or hooks break), the client side from esm.sh at the cell's
 * own `imports.json` pin — exactly the resolution the old source-copied files
 * got, minus the copies.
 *
 * This module REPLACES the `scripts/sync-platform-ui.mjs` committed copies
 * (cells/{home,starter}/shared/*, cells/lit/render-hints.ts,
 * cells/lit/federated-renderer.ts). One source, no drift.
 */
export * from './render-hints';
export * from './wiki-link';
export * from './fence';
export * from './safe-markdown';
export * from './code-editor';
export * from './vocab';
export * from './present';
export * from './federated-renderer';
export * from './form';
export * from './index';
