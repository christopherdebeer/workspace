/**
 * "STREAMING" IS NOT AN ANSWER.
 *
 *   node cells/drive/devtools/world-word.test.mjs
 *
 * Reported from the seat: the red "NO WORLD DATA" is too coarse, and so is
 * "STREAMING" — the current tile? all tiles? tiles ahead? retrying? given up?
 * Five different situations, one word, and the word chosen by `osmPending > 0`,
 * which is a count of outstanding fetches with no idea where any of them are.
 *
 * THE PASS ALREADY KNEW ALL OF IT. streamWorld decides every tick what the
 * world needs and in what order, and threw that away one frame later; the HUD
 * then re-derived a boolean from a counter. So the fix is bookkeeping, not
 * invention: keep the ask, tag each tile AHEAD or not, and answer the four
 * questions separately — is the tile under the WHEELS in, how many AHEAD are
 * still coming, how many are mere periphery, and how many of those FAILED and
 * are sitting on a backoff.
 *
 * WHAT THIS ASSERTS, IN ORDER OF WHAT IT IS WORTH:
 *
 * (1) THE WORD AGREES WITH THE NUMBERS, in whatever state the world happens to
 *     be in when it is asked. This is the invariant that holds always and it is
 *     the whole bug class: a status line that has drifted from what it reports
 *     on is worse than no status line, because it is believed.
 *
 * (2) THE VOCABULARY IS ACTUALLY USED. Boot, then teleport somewhere the world
 *     has never been, and count the DISTINCT words. The old build cannot get
 *     past one — it has two strings and only one of them is reachable without
 *     an outage — and it is run here, from its own commit, with a shim that
 *     reconstructs exactly the expression the old HUD evaluated. A new
 *     vocabulary that is never spoken would pass every test written about it.
 *
 * (3) A TELEPORT PUTS IT BACK ON HERE. Proves the status is LIVE and not a
 *     boot-time one-shot: drive somewhere unloaded and the ground under the
 *     wheels goes missing again, which is the one state worth slowing down for.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const SPOT = 'lat=-34.09710&lon=18.37582&h=107&cam=chase&wx=clear&t=NOON';

/** Sample the status repeatedly, returning every distinct reading in order. */
const watch = async (page, secs, every = 1500) => {
  const seen = [];
  for (let i = 0; i < Math.ceil((secs * 1000) / every); i++) {
    const w = await page.evaluate(() => window.__world());
    if (!seen.length || seen[seen.length - 1].hud !== w.hud) seen.push(w);
    await page.waitForTimeout(every);
  }
  return seen;
};

const errors = [];
const d = await openDrive({ spot: SPOT, tag: 'world-word', settle: 8000 });
const page = d.page;

// ── the boot, watched from as early as the probe exists ──
const boot = await watch(page, 45);
for (const w of boot) {
  console.log(`      ${(w.hud || '(nothing)').padEnd(22)} rank ${w.rank}`
    + ` · here ${w.hereDone ? 'in' : 'PENDING'} · ${w.aheadAsked}/${w.ask} asked ahead`
    + ` · ${w.inFlight} in flight, ${w.queued} queued`);
}

// (1) THE INVARIANT. Checked on every reading taken, not just the last.
const wrong = boot.filter((w) => {
  // The outage line splits: NO WORLD DATA only when nothing has EVER arrived
  // (which is the only state that sentence honestly describes), RETRYING
  // WORLD DATA otherwise — because nothing here is ever given up.
  if (w.down) return !w.hud.includes('WORLD DATA');
  if (!w.hereDone) return !w.hud.includes('HERE');
  if (w.rank === 0) return w.hud !== '' || !w.vectors.startsWith('LOADED');
  return w.hud === '';
});
check(`the word agrees with the numbers in all ${boot.length} readings`, wrong.length === 0, wrong);

// A boot begins with the ground under the wheels missing — there is no other
// way for it to begin — so this state must be reachable and must say so.
check('a boot says the ground under the WHEELS is missing, not just "streaming"',
  boot.some((w) => w.hud.includes('HERE')), boot.map((w) => w.hud));

// ── settled ──
for (let i = 0; i < 30; i++) {
  if (await page.evaluate(() => window.__world().rank) === 0) break;
  await page.waitForTimeout(2000);
}
const calm = await page.evaluate(() => window.__world());
console.log(`      settled: VECTORS "${calm.vectors}" · WORLD "${calm.world}"`);
check('a settled world reports what it HAS, not silence',
  calm.rank === 0 && /^LOADED · \d+ TILES/.test(calm.vectors), calm);

// (3) …AND IT IS LIVE. 30km away is country the stream has never touched.
await page.evaluate(() => window.__jump(0, -30000));
await page.waitForTimeout(1200);
const jumped = await page.evaluate(() => window.__world());
console.log(`      after a 30km jump: "${jumped.hud}" · here ${jumped.here} ${jumped.hereDone ? 'in' : 'PENDING'}`);
check('a jump into unloaded country puts it back on HERE',
  jumped.hereDone === false && jumped.hud.includes('HERE'), jumped);

// ── (4) AND THE OUTAGE, WHICH IS THE HALF THAT WAS MOST WRONG ──
// Cut the tile routes and jump somewhere that needs new ones. Every fetch now
// throws, osmDown latches, and the question is what the HUD says about it.
// It said NO WORLD DATA, which reads as "given up" — and NOTHING HERE IS EVER
// GIVEN UP: every failure clears its key on a backoff and the next pass asks
// again. So the sentence is reserved for the one case that earns it (nothing
// has ever arrived) and everything else says RETRYING out loud.
await page.route(/overpass|\/~\/osm\//, (r) => r.abort());
await page.evaluate(() => window.__jump(0, -60000));
let outage = null;
for (let i = 0; i < 30; i++) {
  outage = await page.evaluate(() => window.__world());
  if (outage.down) break;
  await page.waitForTimeout(2000);
}
console.log(`      with the routes cut: "${outage.hud}" · VECTORS "${outage.vectors}"`
  + ` · ${outage.fails} consecutive fails, ${outage.done} tiles already in`);
check('an outage with a world already loaded says RETRYING, not "no data"',
  outage.down === true && outage.hud === 'RETRYING WORLD DATA', outage);
check('…and the panel gives the count and the fact that it is still asking',
  /RETRYING/.test(outage.vectors) && /\d+ FAILS/.test(outage.vectors), outage);
await page.unroute(/overpass|\/~\/osm\//);

const after = await watch(page, 30);
const words = new Set([...boot, ...after, jumped, calm, outage].map((w) => w.hud).filter(Boolean));
console.log(`      vocabulary actually spoken: ${[...words].map((w) => `"${w}"`).join(', ')}`);
errors.push(...d.errors);
await d.close();

// (2) THE SAME COURSE ON THE BUILD THAT WAS REPORTED. The shim is the old
// HUD's own expression, evaluated in the old module where `streaming` and
// `osmDown` live — not a reconstruction from the outside.
const OLD = 'a88c848';
const old = await openDrive({
  spot: SPOT, tag: 'world-word-old', settle: 8000, rev: OLD,
  shim: `\n(window).__world = () => ({ hud: osmDown ? 'NO WORLD DATA' : streaming ? 'STREAMING' : '',`
    + ` rank: 0, hereDone: true, ask: 0, aheadAsked: 0, ask: 0, down: osmDown,`
    + ` inFlight: osmInFlight, queued: osmQueue.length, vectors: '', world: '' });\n`,
});
const oldBoot = await watch(old.page, 45);
await old.page.evaluate(() => window.__jump(0, -30000));
await old.page.waitForTimeout(1200);
const oldAfter = await watch(old.page, 20);
const oldWords = new Set([...oldBoot, ...oldAfter].map((w) => w.hud).filter(Boolean));
console.log(`      ${OLD} said: ${[...oldWords].map((w) => `"${w}"`).join(', ') || '(nothing)'}`);
errors.push(...old.errors);
await old.close();

check(`the old build had one word for the whole course, the new one has more`
  + ` (${oldWords.size} -> ${words.size})`,
  oldWords.size <= 1 && words.size >= 2, { old: [...oldWords], now: [...words] });

console.log(bad ? `\n${bad} FAILED` : '\nall good — the HUD says WHICH world is missing');
report(errors);
if (bad) process.exitCode = 1;
