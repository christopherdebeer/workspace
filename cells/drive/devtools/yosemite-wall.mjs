// COUNTER-CHECK for the depth-eye column sampling: at the user's Yosemite
// valley spot the granite walls must still swallow summits behind them —
// a real wall fills the whole 3x4 sampled column, so nothing un-hides.
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=37.70564&lon=-119.67737&h=64&cam=chase&sunalt=45&wx=clear', tag: 'yose' });
await d.page.waitForTimeout(35000);
const peaks = await d.page.evaluate(() => {
  const p = window.__peaks ? window.__peaks() : null;
  return p ? { gates: p.gates, drawn: p.drawn, top: (p.top || []).slice(0, 6).map(t => ({ name: t.name, km: t.km, blocked: t.blocked })) } : null;
});
console.log('peaks probe:', JSON.stringify(peaks));
const dv = await d.page.evaluate(() => window.__dvis ? window.__dvis('Old Inspiration Point') : null);
console.log('dvis OIP:', JSON.stringify(dv));
await d.shot('yose-wall');
console.log(`-> ${join(WORK, 'yose-wall.png')}`);
report(d.errors);
await d.close();
