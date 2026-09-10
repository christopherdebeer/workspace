/**
 * ── PACKAGES THE CELL TAKES FROM ESM.SH, STOOD IN FOR OFFLINE ──
 *
 * `client/imports.json` is the platform's import map: the browser fetches
 * those packages from esm.sh at the pin, and the deploy transpile bundles
 * them into the Lambda the same way. The repo's own bundlers — the harness,
 * the shell server, the native build — run esbuild against node_modules with
 * no network, and esbuild without code splitting hoists a lazily imported
 * module's externals into static imports at the top of the bundle, so a
 * package only a lab reaches would still break EVERY page load if it were
 * merely marked external. `three` is installed. Anything else in the map is
 * aliased here to a stand-in that fails when it is USED, with the reason,
 * not when the bundle links. A session that installs the real package
 * (`npm i --no-save`) gets the real thing: the alias is only for an absent one.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const STAND_INS = {
  '@dgreenheck/ez-tree': join(HERE, 'stubs/ez-tree.mjs'),
};

/** A package that IS installed (an `npm i --no-save` for a session that
 *  wants the real thing in the harness) is bundled as itself; only an absent
 *  one gets its stand-in. */
function installed(name) {
  try { require.resolve(name); return true; } catch { return false; }
}

export const OFFLINE_ALIASES = Object.fromEntries(
  Object.entries(STAND_INS).filter(([name]) => !installed(name)),
);

/** The `--alias:` flags for an esbuild command line. */
export function offlineAliasFlags() {
  return Object.entries(OFFLINE_ALIASES).map(([name, path]) => `--alias:${name}=${path}`).join(' ');
}
