// A blow that doesn't break: a ball thrown at a hard glazed tile of the nearest sheet, too softly to break it, shot just
// after (the flash, the chips, the ripple, the ball squashed) and later (the crack it leaves). (node cells/lab/devtools/volley-hit.mjs;
// SEED=, T= the moment; shots in devtools/out/hit-*.png)
process.env.EXPERIMENT = 'volley'; process.env.READY = '__volley';
const { withWood } = await import('./harness.mjs');
const out = new URL('./out/', import.meta.url).pathname;
await withWood(async (lab) => {
  const p = await lab.open(`seed=${process.env.SEED ?? 1}&auto&t=${process.env.T ?? 28}&mute`, { width: 390, height: 844, dpr: 2 });
  await p.waitForTimeout(800);
  const set = await p.evaluate(() => {
    const v = window.__volley, s = v.sim, sh = s.sheets.find((k) => k.left > 0);
    const k = sh.shards.findIndex((d) => d.hp === 2 && !d.frame && Math.abs(d.cx) < s.W / 2 - 0.6 && Math.abs(d.cy) < 4);
    if (k < 0) return null;
    const d = sh.shards[k];
    // (the stand-in stops; the ball set going at it)
    location.hash = '';
    Object.assign(s.ball, { x: d.cx, y: d.cy, z: sh.z - 0.375 - 1.2, vx: 0, vy: 0, vz: 15, sx: 0, sy: 0 }); s.phase = 'play'; s.flight++;
    return { k, i: sh.i };
  });
  console.log('target', set);
  for (const [ms, name] of [[70, 'hit-a'], [140, 'hit-b'], [900, 'hit-c']]) { await p.waitForTimeout(ms === 70 ? 70 : ms - (ms === 140 ? 70 : 140)); await p.screenshot({ path: out + name + '.png' }); }
  console.log(await p.evaluate(() => { const s = window.__volley.sim, sh = s.sheets.find((k) => k.left > 0); return sh.shards.filter((d) => d.hp === 1 && !Number.isNaN(d.hx)).length; }), 'struck and holding', p.errors);
});
