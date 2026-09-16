/**
 * IS A WOOD ONE WOOD, OR SIX SPECIES OF CONFETTI?
 *
 *   node cells/drive/devtools/tree-stand.test.mjs
 *
 * Two halves, and the first needs no browser at all.
 *
 * THE COMPLAINT this answers is that a silhouette was chosen by hashing the
 * TREE'S OWN COORDINATES at an eighth of a metre, so every variant in a family
 * was equally likely at every point and two trees standing together came out a
 * broad oak and a leggy aspen. The fix is two scales — a district picks a few
 * silhouettes, a stand picks one of them — and the number that says whether it
 * worked is `perStand`: the mean count of DISTINCT silhouettes inside one 32 m
 * culture stand. One species a thicket reads 1.0.
 *
 * The second half is a FIXTURE, so it needs no network and settles in seconds:
 * Camps Bay, which is a real hillside with real woods on it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDrive } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the palette, in node ─────────────────────────────────────────────────
// flora-ez pulls in three.js, so this bundles rather than importing raw.
const tmp = mkdtempSync(join(tmpdir(), 'ezpal-'));
const built = join(tmp, 'ez.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/flora-ez.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`, '--log-level=error'], { cwd: join(HERE, '../../..'), stdio: 'inherit' });
const { ezPalette, ezPickVariant, ezVariants, ezHabitOf, EZ_PALETTE_N } = await import(pathToFileURL(built).href);

const FAMS = ['broadleaf', 'conifer', 'acacia', 'palm', 'snag'];
console.log('\nthe atlas:');
for (const f of FAMS) {
  const vs = ezVariants(f);
  console.log(`  ${f.padEnd(10)} ${vs.length} variants · ${[...new Set(vs.map((v) => v.form))].join('/')}`
    + ` · ${vs.map((v) => v.tris).join(',')}t`);
}
ok('every family has a baked skeleton', FAMS.every((f) => ezVariants(f).length > 0), FAMS);
ok('acacia is an umbrella', ezVariants('acacia').every((v) => v.form === 'umbrella'),
  ezVariants('acacia').map((v) => v.form));
ok('palm is a palm', ezVariants('palm').every((v) => v.form === 'palm'),
  ezVariants('palm').map((v) => v.form));
ok('a snag has no crown', ezVariants('snag').every((v) => v.form === 'bare'),
  ezVariants('snag').map((v) => v.form));

// A palette is small, distinct, in range, and the SAME for the same district.
let allSame = true, everSeen = new Set();
for (let seed = 1; seed < 4000; seed += 7) {
  const p = ezPalette('broadleaf', seed);
  if (p.length !== Math.min(EZ_PALETTE_N, ezVariants('broadleaf').length)) {
    ok(`palette size at seed ${seed}`, false, p); break;
  }
  if (new Set(p).size !== p.length) { ok(`palette distinct at seed ${seed}`, false, p); break; }
  if (p.some((i) => i < 0 || i >= ezVariants('broadleaf').length)) { ok(`palette in range ${seed}`, false, p); break; }
  if (String(ezPalette('broadleaf', seed)) !== String(p)) allSame = false;
  for (const i of p) everSeen.add(i);
}
ok(`a palette is ${EZ_PALETTE_N} distinct silhouettes, always`, true);
ok('…and is the same every time it is asked', allSame);

// ── COVERAGE IS A CLAIM ABOUT THE WHOLE CHAIN, NOT ABOUT THE PALETTE ─────
//
// THIS ASSERTION USED TO READ `everSeen.size === ezVariants('broadleaf').length`
// AND FAILED FOR A YEAR ON A DESIGN THAT IS WORKING. It was written before the
// palette learned to draw over HABITS rather than over variants, and it can
// never pass again: `Oak Medium #387`, `#91` and `#12` are one recipe under
// three seeds, a district picks at most one of them on purpose (a two-species
// vocabulary must not be spent twice on one oak), and so the palette alone
// covers 5 of 8 BY CONSTRUCTION. Read as a fault it said three baked
// silhouettes were "drawn nowhere on Earth", which was recorded in the doctrine
// and is false — the fixture half of this very file draws `Aspen Small #11`,
// one of the three, twenty-four times.
//
// The honest contract is the two claims the chain actually makes, and it needs
// BOTH or neither means anything: a palette that covered every habit while the
// pick ignored the siblings would still bury a third of the atlas, and a chain
// that reached every variant through a palette missing a habit would be drawing
// them as accidents rather than as species.
const blAll = ezVariants('broadleaf');
const habitsIn = (idx) => new Set(idx.map((i) => ezHabitOf(blAll[i])));
const allHabits = habitsIn(blAll.map((_, i) => i));
ok('a palette covers every HABIT across districts',
  habitsIn([...everSeen]).size === allHabits.size,
  { seen: [...habitsIn([...everSeen])], want: [...allHabits] });
// …and the district → stand → individual chain reaches every VARIANT of every
// family. The individual seed is main.ts's own construction (a hash of the
// tree's lat/lon), so this walks the same three scopes the world walks.
for (const fam of FAMS) {
  const all = ezVariants(fam);
  const chain = new Set();
  for (let d = 1; d < 40000; d += 7) {
    const p = ezPalette(fam, d);
    for (let st = 0; st < 4; st++) {
      const standSeed = (d * 2654435761 + st * 40503) >>> 0;
      for (let k = 0; k < 6; k++) {
        chain.add(ezPickVariant(p, standSeed, fam, (standSeed ^ (k * 2246822519)) >>> 0));
      }
    }
  }
  ok(`…and the chain reaches every ${fam} variant`, chain.size === all.length,
    { reached: [...chain].sort((a, b) => a - b), of: all.length });
}
// A one-variant family cannot fail.
ok('a family with one variant still answers', ezPalette('palm', 12345).length >= 1, ezPalette('palm', 12345));
ok('a limit of 1 collapses the palette', ezPalette('broadleaf', 999, 1).length === 1, ezPalette('broadleaf', 999, 1));
// ── THE FORM FILTER, NOW THAT IT DISCRIMINATES ───────────────────────────
// Broadleaf carries six `round` and two `columnar`, so this is the first
// filter in the atlas that can return a proper subset. A guild that does not
// want poplars must not get them.
const bl = ezVariants('broadleaf');
const formsIn = (pal) => pal.map((i) => bl[i].form);
let sawColumnar = false, roundOnlyLeaked = false;
for (let seed = 1; seed < 4000; seed += 3) {
  if (formsIn(ezPalette('broadleaf', seed, 99, ['round'])).includes('columnar')) roundOnlyLeaked = true;
  if (formsIn(ezPalette('broadleaf', seed, 99, ['round', 'columnar'])).includes('columnar')) sawColumnar = true;
}
ok('a guild that asks for round only never gets a column', !roundOnlyLeaked);
ok('…and one that allows columnar does get them somewhere', sawColumnar);
ok('the atlas has columnar broadleaf at all',
  bl.some((v) => v.form === 'columnar'), bl.map((v) => v.form));
// The form filter is ignored rather than obeyed when it matches nothing.
ok('an impossible form filter still grows trees',
  ezPalette('broadleaf', 42, 99, ['palm']).length >= 1, ezPalette('broadleaf', 42, 99, ['palm']));
ok('…and an unsatisfiable one does not empty the conifers',
  ezPalette('conifer', 42, 99, ['round', 'columnar']).length >= 1,
  ezPalette('conifer', 42, 99, ['round', 'columnar']));
// A stand picks from its palette and nowhere else.
const pal = ezPalette('broadleaf', 77);
let outside = 0;
for (let s = 0; s < 500; s++) if (!pal.includes(ezPickVariant(pal, s * 2654435761 % 4294967296))) outside++;
ok('a stand only ever picks from its landscape\'s palette', outside === 0, outside);

// ── and in a world ───────────────────────────────────────────────────────
async function stand(ezstand) {
  const d = await openDrive({
    spot: `fixture=at-campsbay&cam=chase&time=NOON&nodraw=1&ezstand=${ezstand}`,
    tag: `treestand-${ezstand}`, settle: 0, bootTimeout: 120000,
  });
  await d.page.evaluate(() => new Promise((r) => {
    let f = 0, quiet = 0, last = -1;
    const w = () => {
      const n = window.__stand(400).trees;
      if (f > 120 && n === last && n > 0) quiet++; else quiet = 0;
      last = n;
      if (quiet > 60 || ++f > 1500) return r();
      requestAnimationFrame(w);
    };
    requestAnimationFrame(w);
  }));
  const out = await d.page.evaluate(() => window.__stand(400));
  const ez = await d.page.evaluate(() => window.__ez());
  const errs = d.errors.slice();
  await d.close();
  return { out, ez, errs };
}

const on = await stand('1');
const off = await stand('0');
const show = (t, r) => {
  console.log(`\n${t}: ${r.out.trees} skeletons in ${r.out.stands} stands · `
    + `${r.out.perStand} silhouettes a stand`);
  console.log(`  forms    ${JSON.stringify(r.out.forms)}`);
  console.log(`  variants ${JSON.stringify(r.out.variants)}`);
};
show('PER STAND (shipping)', on);
show('PER POSITION (?ezstand=0)', off);

ok('the fixture actually grew skeletons', on.out.trees > 20, on.out.trees);
ok('a thicket is one or two silhouettes, not six',
  on.out.perStand <= EZ_PALETTE_N + 0.01, on.out.perStand);
ok('…which the per-position hash was not',
  off.out.perStand > on.out.perStand, [off.out.perStand, on.out.perStand]);
ok('…and the landscape is still not a monoculture',
  Object.keys(on.out.variants).length >= 2, on.out.variants);
ok('no page errors', on.errs.length === 0 && off.errs.length === 0,
  [...on.errs, ...off.errs].slice(0, 3));

// ── AND WHAT THE ATLAS COSTS TO HOLD ─────────────────────────────────────
// Each tier used to be born holding its family's whole cap, so the boot
// allocation was the cap times the variant count — and every variant added to
// the atlas cost that again whether or not anything stood in it. Tiers are
// seeded small and grown from the measured per-variant need instead, which is
// what makes a vocabulary worth extending.
console.log(`\ninstance slots: ${on.ez.slots} allocated · ${on.ez.slotsIfCapped} under the old`
  + ` per-family cap (${(100 - on.ez.slots / on.ez.slotsIfCapped * 100).toFixed(0)}% less)`);
ok('the atlas is not allocated at the sum of its caps',
  on.ez.slots < on.ez.slotsIfCapped * 0.5, [on.ez.slots, on.ez.slotsIfCapped]);
ok('…and still holds every tree it placed',
  on.ez.slots >= on.out.trees, [on.ez.slots, on.out.trees]);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
