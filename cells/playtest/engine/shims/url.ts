/* Every vendored module lives at /pt/src/<dir>/_ as far as path maths goes, so
 * PROJECT_ROOT = /pt, GAMES_DIR = /pt/games, MECHANICS_DIR = /pt/mechanics.
 * (All engine callers are in src/core, two levels below the root.) */
export function fileURLToPath(_url: string): string {
  return '/pt/src/core/_.js';
}
export default { fileURLToPath };
