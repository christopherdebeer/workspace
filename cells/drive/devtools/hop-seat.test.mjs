// THE PHANTOM TRENCH. A hop must leave NOTHING spatially keyed behind: both
// worlds seat the truck at local (0,0), so a surviving deck hint there is
// applied to the NEW road, the carve digs to meet a deck that is not present,
// and the rig spawns metres under the hillside (owner-caught, live).
//
// THE PRECONDITION IS WAITED FOR, NOT SLEPT THROUGH: the solver only banks
// hints once roads have actually streamed and chained, and a fixed settle that
// lands short reports "not buried" for the wrong reason — a zero-sample pass.
import { openDrive } from '/home/user/workspace/cells/drive/devtools/harness.mjs';
const REV = process.env.HOPSEAT_REV || '';
const SHIM = `
(window as unknown as { __seat?: object }).__seat = (): object => {
  const g = groundAt(state.x, state.z);
  return { bodyY: +bodyY.toFixed(2), ground: +g.toFixed(2), gap: +(bodyY - g).toFixed(2),
    hint: hintAt(state.x, state.z, 6), hints: solver.hints.size, juncs: solver.junctions.size };
};
`;
const d = await openDrive({
  spot: 'lat=-34.09710&lon=18.37582&h=107&cam=chase&wx=clear&time=NOON', tag: 'hopseat',
  settle: 25000, ...(REV ? { rev: REV, shim: SHIM } : {}) });
const page = d.page;
let bad = 0;
const check = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const seat = async () => {
  const v = await page.evaluate(() => window.__seat());
  return { sweeps: 0, swept: { hints: 0, juncs: 0 }, ...v };   // the old build lacks the counters
};
const until = async (fn, ms) => {
  for (let i = 0; i < ms / 2000; i++) { const v = await seat(); if (fn(v)) return v; await page.waitForTimeout(2000); }
  return null;
};
if (REV) console.log(`(CONTROL RUN on ${REV} — the pre-fix build)`);

// Noordhoek: a real road under the wheels, so the solver banks hints at (0,0).
const before = await until((v) => v.hints > 0 && v.hint !== null, 90000);
console.log('before hop:', JSON.stringify(before));
if (!before) {
  console.log('SKIPPED, NOT PASSED: no road ever reached the solver here — the');
  console.log('mirrors are cold, so the leak this test hunts cannot be staged.');
  console.log('pageerrors:', d.errors.length);
  await d.close?.();
  process.exit(2);
}
check('the first world banks a deck hint under the truck', before.hints > 0 && before.hint !== null, before);
check('and seats the truck on its ground', before.gap > -1.5, before);

const hop = await page.evaluate(() => window.__hop(29.57427, 35.41870, 204));
check('the hop resolves', hop === 'ok', hop);
// The sweep runs inside the hop, so the moment it resolves nothing may remain.
const justAfter = await seat();
console.log('just after hop:', JSON.stringify(justAfter));
// NOT "is it empty now" — the hop's awaits let the NEW world begin writing
// hints before __hop resolves, so that instant is unobservable. What the sweep
// DISCARDED is the honest measurement, and it is exactly the leak's size.
if (!REV) {
  check('the hop swept the solver exactly once', justAfter.sweeps === before.sweeps + 1,
    { before: before.sweeps, after: justAfter.sweeps });
  check('and it discarded the previous world\'s hints', justAfter.swept.hints >= before.hints * 0.9,
    { swept: justAfter.swept, had: before.hints });
  check('and its junctions', justAfter.swept.juncs > 0, justAfter.swept);
}
// THE DISCRIMINATOR, and it works on both builds: the old world's deck
// elevation must not be readable under the new spawn.
check('no stale deck hint sits under the new spawn', justAfter.hint === null, justAfter);

// Let the new country stream and carve, then read the seat that matters.
await until((v) => v.hints > 0, 90000);
await page.waitForTimeout(8000);
const after = await seat();
console.log('after hop:', JSON.stringify(after));
check('THE TRUCK IS NOT BURIED IN THE NEW WORLD', after.gap > -1.5, after);
check('the truck did not launch either', after.gap < 12, after);
await page.screenshot({ path: `${'/tmp/claude-0/-home-user-workspace/25caadd4-ff4a-5978-ac89-16239de0017e/scratchpad'}/hopseat${REV ? '-ctrl' : ''}.png` }).catch(() => {});
console.log('pageerrors:', d.errors.length, d.errors.slice(0, 3));
await d.close?.();
process.exit(bad || d.errors.length ? 1 : 0);
