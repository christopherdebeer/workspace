// The sleeve on trial (node cells/lab/devtools/piste-sleeve.mjs [orbit]): the same extension (study=near: the arm goes
// out from guard over a second, holds, comes back), the drafted kit, the drawn creases off so only the cloth's own folds
// show, in a few variants of the sleeve's dials; frames as the arm extends, the instant it stops, held, and coming back.
// Writes devtools/out/sleeve-*.png and a montage, rows the variants, columns the moments.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const cam = process.argv[2] ?? '75,1.0';
const variants = [
  ['as is', ''],
  ['as is, unfold shown', '&unfold=show'],
  ['sleeve thick ×0.3', '&sleevethick=0.3'],
  ['thick ×0.3, unfold ×0', '&sleevethick=0.3&sleeveunfold=0'],
];
const times = [1.5, 2.0, 2.15, 2.6, 4.4];
await withWood(async (lab) => {
  const shots = [], labels = [];
  for (const [name, q] of variants) for (const t of times) {
    const page = await lab.open(`study=near&creases=off&t=${t}&still&armcam=${cam}${q}`, { width: 480, height: 480 });
    await page.waitForTimeout(1200);
    shots.push(await lab.shot(page, `sleeve-${name.replace(/[^a-z0-9]+/gi, '_')}-${t}`));
    labels.push(`${name} · t ${t}`);
    if (page.errors?.length) console.log(name, t, page.errors);
    await page.close();
  }
  console.log(await lab.montage(shots, 'sleeve-trial', { height: 1600, labels, columns: times.length }));
});
