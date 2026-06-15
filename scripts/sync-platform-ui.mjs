#!/usr/bin/env node
/**
 * sync-platform-ui — vend `platform/ui` to cells as SOURCE (build-time, not a
 * runtime URL). A cell bundles its own copy with its own React on both the
 * server (renderToString) and client (hydrateRoot), so the kit is isomorphic
 * with no react-peering — the robust delivery until forge gains a library-build
 * mode that can emit bare-external React for true runtime vending (see
 * docs/trajectory). The canonical source is `platform/ui/index.tsx`; this copies
 * it into each consuming cell's `shared/ui.tsx`. Edit platform/ui, then re-run.
 *
 *   node scripts/sync-platform-ui.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'platform/ui/index.tsx';
// Cells that bundle platform/ui as source. Add a cell's `shared/ui.tsx` here.
const TARGETS = ['cells/starter/shared/ui.tsx'];

const header =
  `/* GENERATED — synced from ${SRC} by scripts/sync-platform-ui.mjs.\n` +
  ` * Do NOT edit here; edit platform/ui and re-run the sync. Source-bundled so\n` +
  ` * the cell renders platform/ui isomorphically with its own React. */\n`;
const body = readFileSync(SRC, 'utf8');

for (const t of TARGETS) {
  mkdirSync(dirname(t), { recursive: true });
  writeFileSync(t, header + body);
  console.log('synced', SRC, '→', t);
}
