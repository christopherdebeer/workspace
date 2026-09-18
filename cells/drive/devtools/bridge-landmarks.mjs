/**
 * ── WHICH BRIDGE IS CLAIMED, BY WHAT, AND DID THE PAINTER BUILD IT? ──
 *
 *   node cells/drive/devtools/bridge-landmarks.mjs
 *   FIX=at-umgeni node .../bridge-landmarks.mjs
 *
 * A famous bridge can go wrong three ways and the frame looks the same for
 * two of them: the landmark entry never claims the assembly, the entry claims
 * it and the painter builds nothing, or an entry claims the WRONG assembly —
 * a suspension bridge's towers on the cable-stayed one beside it. None of the
 * three is legible from the form alone, because a `truss` that came out of a
 * roll is indistinguishable from a `truss` an entry asked for. So this reads
 * the AUTHORITY (`claim`: an entry's id, `tags` where OSM's own
 * `bridge:structure` decided, `recipe` where neither did) beside what was
 * actually built.
 *
 * THE FORTH IS THE CASE IT WAS WRITTEN FOR: three bridges in a row, each
 * claimed by a different path — the rail bridge BY POSITION (its ways are
 * named for the East Coast Main Line, not for the bridge), the Queensferry
 * Crossing by its own `bridge:structure`, and the Forth Road Bridge by
 * nothing at all. And they stand close enough together that a positional
 * claim can cross from one to the next, which is the third failure above.
 *
 * It REPORTS rather than asserting a form per bridge: what a famous bridge
 * should look like is a judgement in `landmarks.ts`, and a test that restated
 * it here would be the same table twice. What it fails on is structural — an
 * assembly whose spec names a form and whose painter built nothing, and a
 * long span nobody claimed, which is the gap rather than a defect and is
 * printed as one.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-forth';
const LONG_M = Number(process.env.LONG_M ?? 150);

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1`,
  tag: 'bridge-landmarks', settle: 0, bootTimeout: 420000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pb = -1, pw = -1, pc = -1;
for (let i = 0; i < 100; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.roadCells > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; pc = t.roadCells;
  if (i % 6 === 0) console.log(`  t+${i * 3}s dirty ${t.dirty} builds ${t.builds} ways ${t.seenWays} cells ${t.roadCells}`);
  if (quiet >= 3) break;
}
const settled = quiet >= 3;

const rows = await q(() => window.__bridges());

console.log(`\n${FIX} · ${settled ? 'SETTLED' : 'NOT SETTLED'} · ${rows.length} assemblies\n`);
const pad = (v, n) => String(v ?? '-').padEnd(n);
let bad = 0, unclaimed = 0;
for (const b of rows.sort((a, z) => (z.quads + z.panels + z.stays) - (a.quads + a.panels + a.stays))) {
  const built = b.quads + b.towers + b.stays + b.hangers + b.ribs + b.panels;
  // A spec that names a form and paints nothing is the fault this catches.
  // `girder` paints nothing BY DESIGN — a deck on piers is the ribbon's job —
  // so it is the one form exempt.
  const silent = b.form && b.form !== 'girder' && built === 0;
  if (silent) bad++;
  const longSpan = b.spanM ?? null;
  const gap = b.claim === 'recipe' && longSpan !== null && longSpan >= LONG_M;
  if (gap) unclaimed++;
  console.log(`${silent ? 'FAIL' : gap ? 'gap ' : 'ok  '}  ${b.key}`);
  console.log(`        name ${JSON.stringify(b.name)} · ${b.fragments} fragments`
    + (longSpan !== null ? ` · span ${longSpan.toFixed(0)} m` : ''));
  console.log(`        claim ${pad(b.claim, 18)} structure-tag ${pad(b.structureTag, 14)}`
    + `form ${pad(b.form, 13)} tower ${pad(b.tower, 14)} cables ${b.cables}`);
  console.log(`        built: ${b.towers} towers · ${b.stays} stays · ${b.hangers} hangers`
    + ` · ${b.ribs} ribs · ${b.panels} panels · ${b.quads} quads · deck ${JSON.stringify(b.deck)} m`);
  if (silent) console.log(`        ^ the spec names ${b.form} and the painter built nothing`);
  if (gap) console.log(`        ^ ${longSpan.toFixed(0)} m and claimed by nobody — no entry, no bridge:structure`);
}
console.log(`\npage/harness errors: ${d.errors.length}`);
console.log(`${unclaimed} long span(s) unclaimed — a gap in the store, not a defect`);
console.log(bad ? `\n${bad} FAILED` : '\nall good — every claimed form was actually painted');
await d.close();
process.exit(bad ? 1 : 0);
