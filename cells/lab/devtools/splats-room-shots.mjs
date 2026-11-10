// The room, the walk and the marks in the headless browser (node cells/lab/devtools/splats-room-shots.mjs [what…]):
// screenshots into devtools/out/room/, and what each scene reports. what: room (its views), walk, marks.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const what = process.argv.slice(2).length ? process.argv.slice(2) : ['room'], dir = new URL('./out/room/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 640);
await withWood(async (wood) => {
  const shot = async (page, name) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${dir}${name}.png` }); };
  if (what.includes('room')) {
    const page = await wood.open(`scene=room&res=1&clean${process.env.Q ?? ''}`);
    page.on('pageerror', (e) => console.log('page error', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
    await page.waitForFunction(() => window.__splats.scene?.name === 'room' && window.__splats.drawn > 0, null, { timeout: 240000 });
    const st = await page.evaluate(() => window.__splats.room.state); console.log('room', st.n, 'deposits', JSON.stringify(st.regions));
    for (const v of Object.keys(st.views)) { if (process.env.VIEWS && !process.env.VIEWS.split(',').includes(v)) continue; await page.evaluate((v) => window.__splats.room.view(v), v); await shot(page, `room-${v.replace(/ /g, '-')}${process.env.TAG ?? ''}`); }
    await page.close();
  }
  if (what.includes('walk')) {
    const page = await wood.open('scene=walk&res=1&clean');
    await page.waitForFunction(() => window.__splats.scene?.name === 'walk' && window.__splats.drawn > 0, null, { timeout: 240000 });
    for (const d of [12, 5.6, 3.2, 0.8]) { await page.evaluate((d) => window.__splats.walk.set(d), d); await shot(page, `walk-${d}`); }
    await page.close();
  }
  if (what.includes('marks')) {
    const page = await wood.open('scene=marks&res=1&clean');
    page.on('pageerror', (e) => console.log('page error', e.message));
    await page.waitForFunction(() => window.__splats.scene?.name === 'marks' && window.__splats.drawn > 0, null, { timeout: 240000 });
    for (const w of ['organised', 'independent', 'style', 'brush']) { await page.evaluate((w) => window.__splats.marks.setWay(w), w); await shot(page, `marks-${w}`); }
    // (a mark picked up and bent: its first stroke's middle point moved; its deposits should come with it)
    await page.evaluate(() => window.__splats.marks.setWay('organised'));
    const before = await page.evaluate(() => { const m = window.__splats.marks; m.select(0); const c = m.state.marks[0].ctrl[3]; m.drag(3, [c[0], c[1] + 0.06, c[2]]); return c; });
    await shot(page, 'marks-bent'); console.log('bent from', JSON.stringify(before), 'to', JSON.stringify(await page.evaluate(() => window.__splats.marks.state.marks[0].ctrl[3])));
    await page.close();
  }
}, { width: W, height: H });
