// A DOUBLE TAP ON THE FPS READOUT COPIES THE TELEMETRY AND DROPS NO FIX.
//
//   node cells/drive/devtools/fps-tap.test.mjs
//
// Reported from the seat: the double tap copied the telemetry AND dropped a
// fix under the readout, whose record was then written to the clipboard over
// the telemetry. The instrument swallowed the pointerdown and the chart's tap
// logic ran on the pointerup regardless (see hudPtrs in main.ts). The control
// — a double tap on open chart still drops a fix — is what makes the first
// assertion mean anything. Drawn, not `nodraw`: the readout's rectangle only
// exists once the HUD has painted it.
import { openDrive } from './harness.mjs';

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { page, close } = await openDrive({ spot: 'fixture=crossroads&cam=top', tag: 'fpstap', menu: true, settle: 0, bootTimeout: 120000 });
let f0 = null;
for (let i = 0; i < 120; i++) { f0 = await page.evaluate(() => window.__fpsTap()); if (f0.w > 0) break; await sleep(500); }
check(f0 && f0.w > 0, `the FPS readout has been drawn (${JSON.stringify(f0)})`);
const doubleTap = async (x, y) => { await page.mouse.click(x, y); await sleep(120); await page.mouse.click(x, y); await sleep(900); };

await doubleTap(f0.x, f0.y);
const f1 = await page.evaluate(() => window.__fpsTap());
check(f1.copies === f0.copies + 1, `a double tap on the readout copies the telemetry once (${f0.copies} → ${f1.copies})`);
check(f1.fixes === f0.fixes, `and drops no fix (${f0.fixes} → ${f1.fixes})`);

// The control: open chart, clear of the readout and of the rig's stick zone.
const [W, H] = await page.evaluate(() => [innerWidth, innerHeight]);
await doubleTap(W * 0.5 - 120, H * 0.5 - 90);
const f2 = await page.evaluate(() => window.__fpsTap());
check(f2.fixes === f1.fixes + 1, `a double tap on open chart still drops a fix (${f1.fixes} → ${f2.fixes})`);
check(f2.copies === f1.copies, `and copies nothing (${f1.copies} → ${f2.copies})`);

const errs = await page.evaluate(() => window.__pageErrors ?? []);
check(errs.length === 0, `no page errors ${JSON.stringify(errs.slice(0, 2))}`);
await close();
console.log(failures ? `\n${failures} FAILURES` : '\nfps-tap: all ok');
process.exit(failures ? 1 : 0);
