// Piste in the headless browser: a few views of the same bout, and whether the page runs clean.
// (EXPERIMENT and READY are set here: node cells/lab/devtools/piste-shot.mjs [query …])
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['t=0.5&still', 'auto&t=6&still&readout', 'auto&view=side&t=6&still&readout', 'auto&view=over&t=6&still'];
await withWood(async (lab) => {
  const shots = [];
  for (const q of queries) {
    const page = await lab.open(q);
    await page.waitForTimeout(1500);
    const name = 'piste-' + q.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    shots.push(await lab.shot(page, name));
    console.log(name, JSON.stringify(await page.evaluate(() => { const p = window.__piste; return { t: p.t, phase: p.phase, score: p.score, gap: p.gap }; })), page.errors);
    await page.close();
  }
  console.log(await lab.montage(shots, 'piste-views', { height: 640, labels: queries }));
});
