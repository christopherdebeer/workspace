/**
 * EYE CHECK for audit round 2: bracket marks on the rail chips and DOM
 * buttons, and the mission card standing on the canvas message rail's
 * vertical (--msg-y). The card is force-shown with dummy text — this shot
 * judges GEOMETRY and chrome, which is CSS, not the mission logic.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.06719&lon=18.37021&h=27&cam=cab&sunalt=55', tag: 'hud2' });
await d.page.waitForTimeout(25000);
await d.page.evaluate(() => {
  const m = document.getElementById('ov-mission');
  if (m) {
    m.style.display = 'block';
    m.querySelector('.kicker').textContent = 'TASK OFFER';
    m.querySelector('.head').textContent = 'SURVEY: SILVERMINE GATE';
    m.querySelector('.body').textContent = 'Reach the gate on the saddle road.';
    const ok = m.querySelector('.ok'); if (ok) ok.style.display = 'block';
    const x = m.querySelector('.x'); if (x) x.style.display = 'block';
  }
  const c = document.getElementById('ov-task');
  if (c) { c.style.display = 'block'; c.lastChild.textContent = 'SILVERMINE GATE'; }
  const g = document.getElementById('ov-term-go');
  if (g) { g.style.display = 'block'; g.lastChild.textContent = 'PD-02 TERMINAL'; }
});
await d.page.waitForTimeout(1500);
await d.shot('hud-round2', { timeout: 90000 });
console.log(`-> ${join(WORK, 'hud-round2.png')}`);
report(d.errors);
await d.close();
