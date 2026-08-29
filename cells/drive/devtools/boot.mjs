/**
 * DID IT BOOT, AND IF NOT WHY — in twenty seconds rather than two minutes.
 *
 *   node devtools/boot.mjs [spot-query]
 *
 * The suites all pay a 120s boot timeout before telling you anything. When
 * the question is only "does the world still come up", this asks it directly
 * with a short fuse and prints whatever the page complained about.
 */
import { openDrive, report } from './harness.mjs';
const spot = process.argv[2] ?? 'lat=36.2884&lon=-121.8272&h=99&cam=cab&wx=clear&t=NOON';
const t0 = Date.now();
try {
  const d = await openDrive({ spot, tag: 'boot', bootTimeout: 45000 });
  console.log(`BOOTED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('probes:', await d.page.evaluate(() =>
    ['__climate', '__culture', '__sward', '__vegkind', '__swardctx'].filter((k) => typeof window[k] === 'function').join(' ')));
  report(d.errors);
  await d.close();
} catch (e) {
  console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(e.message);
  process.exitCode = 1;
}
