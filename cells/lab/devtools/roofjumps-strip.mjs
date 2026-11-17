// Roof Jumps in motion, as a strip (node cells/lab/devtools/roofjumps-strip.mjs [from=4] [frames=24] [step=0.1] [seed=1]
// [side=0]): the runner's own wandering run, a frame every `step` seconds from `from`, each labelled with the move it's
// in: what the moves and the joins between them are criticised from. Writes devtools/out/roofjumps-strip.png.
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
process.env.MISTWOOD_OUT ??= new URL('./out', import.meta.url).pathname;
const { withWood, OUT } = await import('./harness.mjs');
const { join } = await import('node:path');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const from = Number(arg.from ?? 4), n = Number(arg.frames ?? 24), step = Number(arg.step ?? 0.1), W = 320, H = 240, COLS = 6;
await withWood(async (lab) => {
  const cells = [];
  for (let i = 0; i < n; i++) {
    const t = (from + i * step).toFixed(2);
    const page = await lab.open(`auto&seed=${arg.seed ?? 1}&t=${t}&still&preview&far=2${arg.side ? `&side=${arg.side}&zoom=${arg.zoom ?? 1.3}` : ''}`, { width: W, height: H });
    await page.waitForTimeout(350);
    const p = await page.evaluate(() => window.__roofjumps.probe());
    cells.push({ label: `${t} ${p.move} ${p.speed.toFixed(0)}m/s`, src: 'data:image/png;base64,' + (await page.screenshot()).toString('base64') });
    await page.close();
  }
  const sheet = await lab.browser.newPage({ viewport: { width: W * COLS, height: H * Math.ceil(n / COLS) } });
  await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${COLS},${W}px);font:11px monospace">${cells.map((c) => `<div style="position:relative;height:${H}px"><img src="${c.src}"><span style="position:absolute;left:6px;top:4px;background:#fffa">${c.label}</span></div>`).join('')}</body>`);
  await sheet.screenshot({ path: join(OUT, 'roofjumps-strip.png') });
  console.log(cells.map((c) => c.label).join(' | '));
});
