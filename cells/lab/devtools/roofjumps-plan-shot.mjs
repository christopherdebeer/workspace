// Roof Jumps' plan and dials, as pictures (node cells/lab/devtools/roofjumps-plan-shot.mjs [t…]): the runner's own run
// held at a few moments with the plan drawn and said, from the chase eye and from high above; and the palette open on
// a phone. Writes devtools/out/roofjumps-plan-*.png.
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
process.env.MISTWOOD_OUT ??= new URL('./out', import.meta.url).pathname;
const { withWood } = await import('./harness.mjs');
const ts = process.argv.slice(2).length ? process.argv.slice(2) : ['6', '13'];
await withWood(async (lab) => {
  const ready = async (page) => { for (let n = 0; n < 80 && (await page.evaluate(() => window.__roofjumps.probe().pending)) > 0; n++) await page.waitForTimeout(250); await page.waitForTimeout(700); };
  for (const t of ts) {
    for (const [name, extra, size] of [['chase', '', { width: 836, height: 470 }], ['above', '&eyeDist=38&eyePitch=62', { width: 836, height: 470 }]]) {
      const page = await lab.open(`auto&t=${t}&still&plan&readout${extra}`, size);
      await ready(page);
      console.log(t, name, JSON.stringify((await page.evaluate(() => window.__roofjumps.probe())).plan));
      await lab.shot(page, `roofjumps-plan-${t}-${name}`);
      await page.close();
    }
  }
  const page = await lab.open('auto&t=6&still&plan&readout', { width: 390, height: 844 });
  await ready(page);
  await page.click('#dialsbtn'); await page.waitForTimeout(300);
  await lab.shot(page, 'roofjumps-plan-dials');
  await page.close();
});
