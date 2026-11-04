// Switchback's frames (node cells/lab/devtools/switchback-shot.mjs [query…]): pinned moments of a run, ridden there by the
// auto rider and held (`t=…&still`), at a phone's size and a landscape one, each beside the style target
// (static/switchback/target.jpg). Writes devtools/out/switchback-*.png and switchback-board.png.
process.env.EXPERIMENT = 'switchback'; process.env.READY = '__switchback';
process.env.MISTWOOD_OUT ??= new URL('./out', import.meta.url).pathname;
const { withWood } = await import('./harness.mjs');
const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['seed=1&t=6&still', 'seed=1&t=14.5&still', 'seed=2&t=40&still'];
await withWood(async (lab) => {
  const paths = [];
  for (const [i, q] of shots.entries()) {
    for (const [w, h, tag] of [[1672 / 2, 941 / 2, 'wide'], [390, 844, 'phone']]) {
      const page = await lab.open(q, { width: Math.round(w), height: Math.round(h) });
      await page.waitForTimeout(2500);
      const p = await lab.state(page); console.log(q, tag, JSON.stringify(p.probe ? await page.evaluate(() => window.__switchback.probe()) : {}));
      paths.push(await lab.shot(page, `switchback-${i}-${tag}`));
      await page.close();
    }
  }
  const tgt = join(new URL('..', import.meta.url).pathname, 'static/switchback/target.jpg');
  await lab.montage([tgt, ...paths], 'switchback-board', { height: 420, labels: ['target', ...shots.flatMap((q) => [q + ' wide', q + ' phone'])] });
});
