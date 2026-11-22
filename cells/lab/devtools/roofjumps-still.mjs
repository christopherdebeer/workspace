// A still of the page as it runs (a look, a seed, auto): node cells/lab/devtools/roofjumps-still.mjs "<query>" <out.png> [wait ms]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
const { withWood } = await import('./harness.mjs');
const [q, out, wait = '6000'] = process.argv.slice(2);
await withWood(async (wd) => {
  const p = await wd.open(q, { width: 1280, height: 800, dpr: 1 });
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
  await p.waitForTimeout(+wait); await p.screenshot({ path: out }); await p.close();
});
