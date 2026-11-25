// Piste's study (node cells/lab/devtools/piste-study.mjs): the five seconds in the daylight room, frame by frame at
// phone size: a contact strip of the whole (can you feel how much distance closed?) and a strip of the hand before and
// after the roll, cropped (can you see what your hand did?). Writes devtools/out/study-*.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const times = [0.5, 1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 4.5];
await withWood(async (lab) => {
  const shots = [], crops = [], labels = [];
  for (const t of times) {
    const page = await lab.open(`study&t=${t}&still`, { width: 390, height: 844, dpr: 2 });
    await page.waitForTimeout(1200);
    shots.push(await lab.shot(page, `study-${t}`));
    const path = `${lab.base ? '' : ''}${process.cwd()}/devtools/out/study-hand-${t}.png`;
    await page.screenshot({ path, clip: { x: 150, y: 470, width: 240, height: 374 } });
    crops.push(path); labels.push(`t ${t}s`);
    await page.close();
  }
  console.log(await lab.montage(shots, 'study-strip', { height: 640, labels }));
  console.log(await lab.montage(crops, 'study-hand', { height: 480, labels }));
});
