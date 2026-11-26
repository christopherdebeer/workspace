// Piste's figure in layers (node cells/lab/devtools/piste-layers.mjs [t]): one frozen moment of the opponent's retreat
// (`study=retreat`), from the gameplay camera (through your mask) and from the side, each as: the body the blades meet
// (its capsules over a plain figure), the posed kit in plain grey, the simulated kit in plain grey, and dressed. Which
// layer a proportion goes wrong in says where to fix it: the body, the garment's cut, or the simulation.
// Writes devtools/out/layers.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const t = Number(process.argv[2] ?? 1.08);
const LAYERS = [['bodies&clay', 'body (capsules)'], ['clay', 'posed kit'], ['clay&cloth=sim', 'simulated kit'], ['cloth=sim', 'dressed']];
const VIEWS = [['view=mask', 'gameplay', { width: 390, height: 844 }, { x: 90, y: 250, width: 210, height: 420 }],
  ['view=side', 'side', { width: 844, height: 390 }, null]];
await withWood(async (lab) => {
  const ps = [], labels = [];
  for (const [v, vn, size, clip] of VIEWS) for (const [l, ln] of LAYERS) {
    const p = await lab.open(`study=retreat&${v}&${l}&t=${t}&still&mask=0`, { ...size, dpr: 2 }); await p.waitForTimeout(1200);
    const path = `${process.cwd()}/devtools/out/layers-${ps.length}.png`;
    // (the side view cropped to the opponent: the right-hand fencer)
    await p.screenshot({ path, clip: clip ?? { x: 470, y: 30, width: 300, height: 360 } }); ps.push(path); labels.push(`${vn}: ${ln}`); await p.close();
  }
  console.log(await lab.montage(ps, 'layers', { height: 700, labels, columns: 4 }));
});
