// Roof Jumps' frames (node cells/lab/devtools/roofjumps-shot.mjs [query…]): moments of the runner's own wandering run,
// run on to and held (`auto&t=…&still`), at a phone's size and a landscape one. Writes devtools/out/roofjumps-*.png and
// roofjumps-board.png, and says what the page reports at each.
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
process.env.MISTWOOD_OUT ??= new URL('./out', import.meta.url).pathname;
const { withWood } = await import('./harness.mjs');
const shots = process.argv.slice(2).length ? process.argv.slice(2) : ['auto&t=5&still&preview', 'auto&t=7.5&still&preview', 'auto&seed=7&t=16&still&preview&look=wire', 'auto&seed=7&t=16&still&preview&look=tags'];
await withWood(async (lab) => {
  const paths = [];
  for (const [i, q] of shots.entries()) {
    for (const [w, h, tag] of [[836, 470, 'wide'], [390, 844, 'phone']]) {
      const page = await lab.open(q, { width: w, height: h });
      for (let n = 0; n < 80 && (await page.evaluate(() => window.__roofjumps.probe().pending)) > 0; n++) await page.waitForTimeout(250);
      await page.waitForTimeout(600);
      console.log(q, tag, JSON.stringify(await page.evaluate(() => window.__roofjumps.probe())));
      paths.push(await lab.shot(page, `roofjumps-${i}-${tag}`));
      await page.close();
    }
  }
  await lab.montage(paths, 'roofjumps-board', { height: 420, labels: shots.flatMap((q) => [q + ' wide', q + ' phone']) });
});
