// A SHARED RUN OWNS ITS OWN ARRIVAL, and the ring can be cut to a known start.
// Staged with the owner's real banked run (Romsdalen, 182s, storm) so the
// wire under test is a real one, not a fixture that agrees with itself.
import { openDrive } from './harness.mjs';
const TAPE = new URL('./fixtures/run-c15r.json', import.meta.url).pathname;
const d = await openDrive({
  spot: 'run=c15r/1787567937361&wx=clear&time=NOON', tag: 'runlink',
  tape: TAPE, settle: 26000, menu: false });
const page = d.page;
let bad = 0;
const check = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };

const v = await page.evaluate(() => ({
  tab: window.__menutab(),
  menuShown: (() => { const m = document.getElementById('menu'); return !!m && getComputedStyle(m).display !== 'none'; })(),
  card: (() => {
    const b = [...document.querySelectorAll('button')].find((x) => /PLAY THE RUN|WAITING|ROLLING|READY/.test(x.textContent || ''));
    const t = [...document.querySelectorAll('div')].find((x) => /A BANKED RUN/.test(x.textContent || '') && x.children.length);
    return { btn: !!b, title: t ? t.textContent.slice(0, 40) : null };
  })(),
  origin: window.__origin(),
}));
console.log('arrival:', JSON.stringify(v));
// THE ASK: the link opens on the world with the card, not behind the hub.
check('the hub is NOT stacked over a run link', v.tab === null && !v.menuShown, v);
check('the run card is standing', v.card.btn, v.card);
check('and it names the run', /A BANKED RUN/.test(v.card.title || ''), v.card);
check('the world booted AT the run head (Romsdalen)',
  Math.abs(v.origin.lat - 62.55229) < 0.01 && Math.abs(v.origin.lon - 7.70793) < 0.01, v.origin);

// ── the ring, cut to a known start ──
await page.waitForTimeout(6000);
const before = await page.evaluate(() => window.__tape());
const cut = await page.evaluate(() => window.__recclear());
const after = await page.evaluate(() => window.__tape());
console.log('ring before:', before.steps, 'secs', before.secs, '| cut:', cut, '| after:', after.steps, 'secs', after.secs);
check('the ring had been turning', before.steps > 0, before);
// NOT "exactly zero": the ring is always turning, so a frame or two lands
// between the cut and the read. What CUT promises is a known START, which is
// a ring that just dropped to nothing and began again.
check('CUT drops the ring to a fresh start',
  after.steps < Math.max(3, before.steps) && after.secs < 0.3, { before, after });
check('and says so', /RING CUT/.test(cut), cut);
await page.screenshot({ path: '/tmp/claude-0/-home-user-workspace/25caadd4-ff4a-5978-ac89-16239de0017e/scratchpad/runlink.png' }).catch(() => {});
console.log('pageerrors:', d.errors.length, d.errors.slice(0, 3));
await d.close?.();
process.exit(bad || d.errors.length ? 1 : 0);
