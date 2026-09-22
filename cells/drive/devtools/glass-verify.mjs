/**
 * THE GLASS SPEC'S VERIFICATION CAPTURES (§12) — the states the redesign
 * must stay readable in, shot from one boot so only the state differs:
 *
 *   noon      bright day over pale ground — the contrast gate for the
 *             one-pixel keyline treatment (finding 2's worst case)
 *   night     headlights, the HUD over near-black
 *   wpt-on    WPT active (amber) vs the dim default
 *   auto-on   AUTO engaged with its status line
 *   paused    the transport held via the deck's DRIVE sheet
 *
 * Rig-warning and rough-surface states need a damaged rig / a track under
 * the wheels and are captured in play rather than staged here.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({
  spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&wx=clear&wet=0&fog=0',
  tag: 'glassv', settle: 16000,
});
const snap = async (name) => { await d.page.waitForTimeout(1400); await d.shot(name); console.log(`-> ${join(WORK, `${name}.png`)}`); };
const setByLabel = async (key, label) => {
  await d.page.evaluate(([k, l]) => {
    for (let i = 0; i < 10; i++) { const r = window.__dial(k, i); if (r[k] === l) return; }
  }, [key, label]);
};

await setByLabel('time', 'NOON');
await snap('glass-noon');
await setByLabel('time', 'NIGHT');
await snap('glass-night');
await setByLabel('time', 'NOON');

await d.page.evaluate(() => window.__dial('poi', 2));
await snap('glass-wpt-on');
await d.page.evaluate(() => window.__dial('poi', 0));

await d.page.evaluate(() => window.__dial('auto', 1));
// AUTO and HOLD live in the deck's DRIVE sheet now (client/hud-deck.ts): a
// second tap on DRIVE opens it, and the buttons are clicked where a thumb
// would land on them, so a control covered by something else fails here.
const tapDeck = async (id) => {
  if ((await d.page.evaluate(() => window.__deck().open)) !== 'drive') {
    await d.page.evaluate(() => window.__deck('drive'));
    await d.page.waitForTimeout(1500);
  }
  await d.page.evaluate((i) => {
    const r = window.__deckrect(i);
    document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2)?.closest('[data-deck-item]')?.click();
  }, id);
};
await tapDeck('auto');
await snap('glass-auto-on');
await tapDeck('hold');
await snap('glass-paused');

report(d.errors);
await d.close();
