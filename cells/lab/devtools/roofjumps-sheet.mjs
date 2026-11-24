// A contact sheet of a scene: its run laid out frame by frame, from one side, at the page's own drawing (strip=), so a
// whole wander or course can be looked over at a glance. Footfall marks hidden.
//   node cells/lab/devtools/roofjumps-sheet.mjs <scene> <from s> <frames> <every s> <cols> <out.png> ["&side=180&zoom=1.6"] [width] [height] [pixel density]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
const { withWood } = await import('./harness.mjs');
const [scene, t, frames, every, cols, out, extra = '', w = '1600', h = '1600', dpr = '1'] = process.argv.slice(2);
await withWood(async (wd) => {
  const p = await wd.open(`scene=${scene}&strip=${t}&frames=${frames}&every=${every}&cols=${cols}&holds=0&marks=0&look=clay${extra}`, { width: +w, height: +h, dpr: +dpr });
  for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
  await p.waitForTimeout(600); await p.screenshot({ path: out }); await p.close();
});
