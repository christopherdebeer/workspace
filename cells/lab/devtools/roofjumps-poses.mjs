// Roof Jumps' pose sheet (node cells/lab/devtools/roofjumps-poses.mjs [move…]): every move's pose held at five points
// through it, from the side and from behind and to one side, on one sheet: what the rig is criticised from. Writes
// devtools/out/roofjumps-poses-<view>.png.
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
process.env.MISTWOOD_OUT ??= new URL('./out', import.meta.url).pathname;
const { withWood, OUT } = await import('./harness.mjs');
const { join } = await import('node:path');
const ALL = ['stand', 'run', 'dash', 'ledge', 'land', 'roll', 'hop', 'bound', 'flip', 'spring', 'dive', 'glide', 'climb', 'wallrun'];
const moves = process.argv.slice(2).length ? process.argv.slice(2) : ALL, MUS = [0.05, 0.28, 0.5, 0.72, 0.95], S = 300;
await withWood(async (lab) => {
  const page = await lab.open('study=stand&preview&zoom=2.1&far=1&look=clay', { width: S, height: S });
  for (const [view, deg] of [['side', 90], ['rear', 28]]) {
    await page.evaluate((d) => window.__roofjumps.view(d), deg);
    const cells = [];
    for (const m of moves) for (const mu of MUS) {
      await page.evaluate(([m, mu]) => window.__roofjumps.pose(m, mu), [m, mu]);
      await page.waitForTimeout(120);
      cells.push({ label: `${m} ${mu}`, src: 'data:image/png;base64,' + (await page.screenshot()).toString('base64') });
    }
    const sheet = await lab.browser.newPage({ viewport: { width: S * MUS.length, height: S * moves.length } });
    await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${MUS.length},${S}px);font:11px monospace">${cells.map((c) => `<div style="position:relative;height:${S}px"><img src="${c.src}"><span style="position:absolute;left:6px;top:4px">${c.label}</span></div>`).join('')}</body>`);
    await sheet.screenshot({ path: join(OUT, `roofjumps-poses-${view}.png`) });
    await sheet.close();
    console.log(join(OUT, `roofjumps-poses-${view}.png`));
  }
});
