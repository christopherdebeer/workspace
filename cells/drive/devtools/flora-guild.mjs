/**
 * ── LOOKING AT WHAT THE GUILD GROWS, PLACE BY PLACE ──
 *
 * The flora lab, driven across its resolved places, three frames apiece: the
 * stand as the game would draw it, the same stand with the guild withheld
 * (`?guild=0`'s exact A/B), and the same stand with the skeletons off (the
 * archetypes, which is what the lab could show before this).
 *
 * It exists because the guild's numbers have only ever been READ — `__stand`
 * counts kinds, `guild-ab.mjs` compares populations — and every complaint
 * about the vegetation has been about how it LOOKS. Thirty seconds a place
 * against eight and a half minutes for one live A/B pair, and no network at
 * all: the lab needs no tiles.
 *
 *   node devtools/flora-guild.mjs [--places=CAPE,SERENGETI] [--patch=90] [--count=220]
 *     [--representation="AUTO LOD|FULL 3D|MID LOD|IMPOSTOR"] [--fullpx=58] [--cardpx=26]
 */
import { openDrive, report, WORK } from './harness.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const WANT = arg('places', 'CAPE PENINSULA,SERENGETI,SUNDARBANS,YOSEMITE,SONORAN DESERT,SAHARA,AMAZON,SIBERIAN TAIGA,PATAGONIAN STEPPE,PARIS').split(',');
const PATCH = arg('patch', '90');
const COUNT = arg('count', '260');
const AB = process.argv.includes('--ab');

const errors = [];
const d = await openDrive({
  pagePath: '/lab/flora', tag: 'flora-guild',
  viewport: { width: 1180, height: 900 }, dpr: 2,
  settle: 0, bootTimeout: 60000,
});
d.page.on('pageerror', (e) => errors.push(String(e)));

/** Set dials by their DOM ids — `createDials` names each input after its id —
 *  and let the panel's own change handler redraw, so nothing here reaches past
 *  the lab into its internals. */
const setDials = (vals) => d.page.evaluate((v) => {
  for (const [id, value] of Object.entries(v)) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no dial "${id}"`);
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, vals);
const readStatus = () => d.page.evaluate(() => document.getElementById('status')?.textContent ?? '');

// A still frame, because an orbiting stand photographed twice is two different
// pictures and the whole point is comparing them.
const BASE = {
  orbit: false, patch: PATCH, count: COUNT, seed: arg('seed', '7'),
  dist: arg('dist', '78'), eye: arg('eye', '16'), turn: arg('turn', '0.6'),
  species: arg('species', 'mix'),
  representation: arg('representation', 'AUTO LOD'),
  fullPx: arg('fullpx', '58'), cardPx: arg('cardpx', '26'),
  impInk: arg('impink', '0'),
};

await d.page.waitForTimeout(2500);
for (const label of WANT) {
  await setDials({ ...BASE, place: label, guild: true, ez: true });
  await d.page.waitForTimeout(900);
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${arg('suffix', '')}`;
  await d.shot(`flora-${slug}`);
  console.log(`\n══ ${label} ══\n${await readStatus()}`);
  if (AB) {
    await setDials({ guild: false });
    await d.page.waitForTimeout(700);
    await d.shot(`flora-${slug}-noguild`);
    console.log(`── no guild ──\n${await readStatus()}`);
    await setDials({ guild: true, ez: false });
    await d.page.waitForTimeout(700);
    await d.shot(`flora-${slug}-archetype`);
    await setDials({ ez: true });
  }
}

console.log(`\nframes in ${WORK}`);
await d.close();
report(errors);
