// The stroke look's cost on the running page (stamps drawn, ms a pass), and a still: node cells/lab/devtools/roofjumps-cost.mjs "<query with &cost>" [out.png]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
const { withWood } = await import('./harness.mjs');
const [q, out] = process.argv.slice(2);
await withWood(async (wd) => {
  const p = await wd.open(q, { width: 1280, height: 800, dpr: 1 });
  for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
  await p.waitForTimeout(9000); console.log(JSON.stringify(await p.evaluate(() => window.__roofjumps.cost())));
  if (out) await p.screenshot({ path: out }); await p.close();
});
