// The fox against its sheet (targets/07-fox.jpg): the sheet's strip of six (trot, gather, bound, contact, absorb, listen)
// above the same six held in the grove (`pose=…&still`, side on, close), into devtools/bamboo/gates/fox.jpg.
// node cells/lab/devtools/bamboo-fox.mjs [pose…]
process.env.EXPERIMENT = 'bamboo'; process.env.READY = '__bamboo';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
const { withWood, CELL } = await import('./harness.mjs');
const out = join(CELL, 'devtools/bamboo/gates');
mkdirSync(out, { recursive: true });
const POSES = ['trot', 'gather', 'bound', 'contact', 'absorb', 'listen'];
const only = process.argv.slice(2);
const poses = only.length ? POSES.filter((p) => only.includes(p)) : POSES;
const AT = 'seed=1&at=-16.29,-45.84,-1.6,-0.38&t=8&chase=fox&look=picture&mute&clean&posed=2.6';
// (where the fox is in each frame: a little higher for the two in the air; mirrored, to face as the sheet's do)
const TOP = { bound: 0.36, contact: 0.4 };

await withWood(async (lab) => {
  const shots = [];
  for (const pose of poses) {
    const p = await lab.open(`${AT}&pose=${pose}&still`, { width: 390, height: 844 });
    await p.waitForTimeout(3000);
    shots.push([pose, (await p.screenshot({ timeout: 180000 })).toString('base64'), TOP[pose] ?? 0.44]);
    await p.close();
    console.log('ok   ', pose);
  }
  const ref = readFileSync(join(CELL, 'devtools/bamboo/targets/07-fox.jpg')).toString('base64');
  const page = await lab.browser.newPage({ viewport: { width: 1560, height: 420 } });
  await page.setContent(`<style>body{margin:0;background:#efe6d2;font:600 13px Georgia;color:#443}
    .ref{width:1536px;height:230px;background:url(data:image/jpeg;base64,${ref}) 0 -430px/1536px auto;margin:8px 12px}
    .row{display:flex;gap:6px;margin:0 12px}.c{width:251px;height:160px;overflow:hidden;position:relative}
    .c i{position:absolute;inset:0;background-repeat:no-repeat;background-size:296px auto;transform:scaleX(-1)}.c b{position:absolute;bottom:4px;left:6px}</style>
    <div class="ref"></div><div class="row">${shots.map(([n, b, top]) => `<div class="c"><i style="background-image:url(data:image/png;base64,${b});background-position:0 ${-top * 844 * 0.76}px"></i><b>${n}</b></div>`).join('')}</div>`);
  await page.locator('body').screenshot({ path: join(out, 'fox.jpg'), type: 'jpeg', quality: 86 });
  console.log('ok   ', join(out, 'fox.jpg'));
});
