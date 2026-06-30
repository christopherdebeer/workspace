#!/usr/bin/env node
/**
 * sync-platform-ui — vend `platform/ui` (and its vocab) to cells as SOURCE
 * (build-time, not a runtime URL). A cell bundles its own copy with its own React
 * on the server (renderToString) and client (hydrateRoot), so the kit is
 * isomorphic with no react-peering — the robust delivery until forge gains a
 * library-build mode that can emit bare-external React (see docs/trajectory).
 * Canonical source is `platform/ui/*`; this copies it into each consuming cell.
 * Edit platform/ui, then re-run.
 *
 *   node scripts/sync-platform-ui.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// src file → [cell target paths]
const MAP = {
  'platform/ui/index.tsx': ['cells/starter/shared/ui.tsx', 'cells/home/shared/ui.tsx'],
  'platform/ui/vocab.ts': ['cells/home/shared/vocab.ts'],
  'platform/ui/federated-renderer.ts': ['cells/home/shared/federated-renderer.ts'],
};

for (const [src, targets] of Object.entries(MAP)) {
  const header =
    `/* GENERATED — synced from ${src} by scripts/sync-platform-ui.mjs.\n` +
    ` * Do NOT edit here; edit ${src} and re-run the sync. Source-bundled so the\n` +
    ` * cell renders platform/ui isomorphically with its own React. */\n`;
  const body = readFileSync(src, 'utf8');
  for (const t of targets) {
    mkdirSync(dirname(t), { recursive: true });
    writeFileSync(t, header + body);
    console.log('synced', src, '→', t);
  }
}
