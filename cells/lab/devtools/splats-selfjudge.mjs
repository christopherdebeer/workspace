// Judged pairs made headless, for a judge who looks at boards rather than a phone
// (node cells/lab/devtools/splats-selfjudge.mjs make <n> [look]  then  ... save <choices>):
// - make: n pairs from the judging page (?judge), exactly as a person would see them; each pair's two images and its
//   data kept in devtools/out/selfjudge/, and boards of four pairs (each row: pair k, left A, right B) to look at;
// - save "ABsAB…" (one letter a pair, in order: A, B, s for about the same, - to skip): the judged pairs appended to
//   devtools/judgements/self-<date>.json, the same format the page exports, for splats-policy-train.mjs.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/selfjudge/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const [cmd, arg, look = 'wash'] = process.argv.slice(2);
if (cmd === 'save') {
  const pairs = JSON.parse(readFileSync(dir + 'pairs.json', 'utf8')), out = [];
  [...arg].forEach((c, k) => { if (!pairs[k] || c === '-') return; out.push({ ...pairs[k], choice: c === 's' ? 'same' : c, at: new Date().toISOString(), judge: 'claude' }); });
  const f = new URL(`./judgements/self-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url).pathname;
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  writeFileSync(f, JSON.stringify([...prev, ...out])); console.log(`${out.length} judged pairs added to ${f} (${prev.length + out.length} in it)`);
  process.exit(0);
}
const n = Number(arg ?? 8);
await withWood(async (wood) => {
  const pairs = [], shots = [];
  let page = null;
  for (let k = 0; k < n; k++) {
    // (a fresh page every eight pairs: long software-GL sessions exhaust headless Chrome)
    if (k % 8 === 0) {
      if (page) await page.close();
      page = await wood.open(`scene=composed&judge&look=${look}&seed=${Date.now() % 100000 + k}`);
      page.on('pageerror', (e) => console.log('page error', e.message));
      await page.waitForFunction(() => window.__splats.composed?.judge?.stage === 'shown', null, { timeout: 240000 });
    } else {
      await page.evaluate(() => window.__splats.composed.judge.choose('skip'));
      await page.waitForFunction(() => window.__splats.composed.judge.stage === 'shown', null, { timeout: 240000 });
    }
    await page.waitForTimeout(300);
    const { a, b, pair } = await page.evaluate(() => ({ a: document.getElementById('j-a').src, b: document.getElementById('j-b').src, pair: window.__splats.composed.judge.pair }));
    const fa = `${dir}p${k}-A.jpg`, fb = `${dir}p${k}-B.jpg`;
    writeFileSync(fa, Buffer.from(a.split(',')[1], 'base64')); writeFileSync(fb, Buffer.from(b.split(',')[1], 'base64'));
    pairs.push(pair); shots.push(fa, fb);
  }
  if (page) await page.close();
  writeFileSync(dir + 'pairs.json', JSON.stringify(pairs));
  for (let s = 0; s < n; s += 4) {
    const files = shots.slice(s * 2, s * 2 + 8), labels = files.map((_, i) => `pair ${s + (i >> 1)} · ${i % 2 ? 'B' : 'A'}`);
    await wood.montage(files, `selfjudge-${s / 4}`, { height: 300, labels, columns: 2 });
  }
  console.log(`${n} pairs in ${dir}; boards devtools/out/selfjudge-0…${Math.ceil(n / 4) - 1}.png`);
}, { width: 720, height: 520 });
