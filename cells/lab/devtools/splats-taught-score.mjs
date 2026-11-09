// The composed scene drawn by each policy from the wireframes' right view, for scoring against the drawn teachers
// (node cells/lab/devtools/splats-taught-score.mjs, then python3 devtools/splats-field-score.py): by its ranks
// (resolved and sparse), by the rules, by the policy learned from judged pairs, and taught by each sumi teacher's
// decisions (its table leaving the right view out). Each is read back as darkness into devtools/out/field/dump-*.json,
// the same form the fields' held-out renders take, and shot for a board (devtools/out/taught-board.png).
import { withWood } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/field/', import.meta.url).pathname, cam = JSON.parse(readFileSync(`${dir}wires.json`)).find((w) => w.name === 'right');
const TEACH = ['sumi', 'sumi-bold', 'sumi-light'];
const runs = [['ranks-resolved', 'policy=ranks&detail=1', TEACH], ['ranks-sparse', 'policy=ranks&detail=0.25', TEACH], ['rules-sparse', 'policy=rules&detail=0.25', TEACH], ['learned-sparse', 'policy=learned&detail=0.25', TEACH], ...TEACH.map((t) => [`taught-${t}`, `policy=taught&teacher=${t}-minus-right&detail=1`, [t]])];
await withWood(async (wood) => {
  const sh = [], lb = [];
  for (const [name, q, teachers] of runs) {
    const page = await wood.open(`scene=composed&res=1&clean&look=wash&${q}`);
    page.on('pageerror', (e) => console.log('page error', name, e.message));
    await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 180000 });
    await page.evaluate((c) => window.__splats.camera({ yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target, fov: c.fov }), cam);
    await page.waitForTimeout(4000);
    const g = await page.evaluate(() => window.__splats.grab());
    const C = g.L.map((L) => +Math.max(0, Math.min(1, (0.906 - L) / (0.906 - 0.12))).toFixed(3));
    for (const t of teachers) writeFileSync(`${dir}dump-composed-${name}-${t}-right.json`, JSON.stringify({ w: g.w, h: g.h, style: t, view: 'right', C }));
    sh.push(await wood.shot(page, `taught-${name}`)); lb.push(name.replace(/-/g, ' '));
    await page.close();
  }
  for (const t of TEACH) { sh.push(new URL(`./field-teachers/${t}/right.jpg`, import.meta.url).pathname); lb.push(`the teacher: ${t} (held out)`); }
  await wood.montage(sh, 'taught-board', { height: 300, labels: lb, columns: 4 });
}, { width: 1024, height: 683 });
