// Piste's athlete in motion (node cells/lab/devtools/piste-lunge.mjs [t0] [t1]): a lunge and its recovery from the side,
// frame by frame (each frame's page runs the bout and its secondary motion on to that moment), cropped to the lunging fencer, to
// see the jacket swing and settle. Writes devtools/out/lunge-strip.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const t0 = Number(process.argv[2] ?? 3.5), t1 = Number(process.argv[3] ?? 5.0), n = 9;
await withWood(async (lab) => {
  const ps = [], labels = [];
  for (let i = 0; i < n; i++) {
    const t = +(t0 + (t1 - t0) * i / (n - 1)).toFixed(2);
    const p = await lab.open(`auto&view=side&t=${t}&still&mask=0`, { width: 844, height: 390, dpr: 2 }); await p.waitForTimeout(1000);
    const path = `${process.cwd()}/devtools/out/lunge-${i}.png`;
    await p.screenshot({ path, clip: { x: Number(process.env.CX ?? 0), y: 40, width: 440, height: 330 } }); ps.push(path); labels.push(`t ${t}s`); await p.close();
  }
  console.log(await lab.montage(ps, 'lunge-strip', { height: 330, labels, columns: 3 }));
});
