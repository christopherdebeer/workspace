/**
 * THE SIGNING ENVIRONMENT, WITH ABSENCE SPELLED AS ABSENCE.
 *
 * The first `Drive native release` run died on macOS with a message that names
 * the project directory and mentions no certificate at all:
 *
 *     ⨯ /Users/runner/work/workspace/workspace/cells/drive/native not a file
 *
 * It reads like a packaging bug. It is not. electron-builder takes the code
 * signing certificate from CSC_LINK and — deliberately; the comment in its own
 * `platformPackager.getCscLink` reads "allow to specify as empty string" —
 * treats an EMPTY value as a value rather than as absence. GitHub Actions
 * writes every `secrets.*` reference into a step's environment whether or not
 * that secret exists, so an unconfigured signing secret arrives as "". From
 * there electron-builder resolves the empty path against the project directory
 * (`path.resolve(projectDir, "")` IS the project directory), stats it, finds a
 * directory where it wanted a .p12, and gives up with the line above.
 *
 * Windows reaches the same code — `getCscLink("WIN_CSC_LINK")` falls back to
 * CSC_LINK — so it would have failed identically as soon as the step ahead of
 * it stopped failing first. Linux never signs, which is the whole reason only
 * Linux went green and the failure looked macOS-specific.
 *
 * So the rule this module enforces is: an empty signing variable means the
 * secret is not configured, and a variable that is not configured must not
 * exist. Deleting it is what makes an unsigned CI build unsigned instead of
 * broken, and it costs a signed build nothing — a real certificate is never
 * the empty string.
 */

/**
 * Every variable electron-builder reads to decide whether and how to sign.
 * The list is deliberately wider than the workflow sets today: the trap is not
 * any one name, it is the shape `FOO: ${{ secrets.FOO }}` with no secret
 * behind it, and the next signing secret someone adds will have that shape too.
 */
export const SIGNING_ENV = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'CSC_KEYCHAIN',
  'CSC_INSTALLER_LINK',
  'CSC_INSTALLER_KEY_PASSWORD',
  'CSC_IDENTITY_AUTO_DISCOVERY',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
];

/**
 * Copy `env` with every blank signing variable removed.
 *
 * When nothing is left that could name an identity, identity auto-discovery is
 * turned off explicitly. Without that, a macOS runner that happens to carry
 * some unrelated certificate in its keychain would sign with it, and the build
 * would differ between two runners for reasons nobody can see from the log.
 * An unsigned build should be unsigned because we said so, not because the
 * keychain happened to be empty.
 */
export function signingEnv(env) {
  const out = { ...env };
  for (const name of SIGNING_ENV) {
    if (typeof out[name] === 'string' && out[name].trim() === '') delete out[name];
  }
  if (out.CSC_IDENTITY_AUTO_DISCOVERY === undefined
    && !out.CSC_LINK && !out.CSC_NAME && !out.CSC_KEYCHAIN) {
    out.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  return out;
}
