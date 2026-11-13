// Where faces fight in depth: a held frame drawn with the depth (and only its depth) nudged a few steps every other frame, by an amount of its own (`zjit`); two consecutive
// frames read back and compared (off, on, off: what changes with no nudge isn't counted). On a held frame nothing should change, so what does is fighting. Writes the frame and
// a map of what changed to devtools/out/zfight-*.png. JIT=ejit instead moves the eye 1 cm every other frame (for the
// painted picture, `paint=1` in the query: what a small move of the eye does to its strokes). (node cells/lab/devtools/switchback-zfight.mjs [query …])
process.env.EXPERIMENT = 'switchback'; process.env.READY = '__switchback';
const { withWood } = await import('./harness.mjs');
const out = new URL('./out/', import.meta.url).pathname;
const qs = process.argv.slice(2).length ? process.argv.slice(2) : ['seed=1&t=9.5', 'seed=1&t=40', 'seed=3&t=60'];
await withWood(async (lab) => {
  for (const [i, q] of qs.entries()) {
    const p = await lab.open(`${q}&still&preview&fx=0&${process.env.JIT ?? 'zjit'}`, { width: 960, height: 540 });
    await p.waitForTimeout(Number(process.env.WAIT ?? 6000));
    const r = await p.evaluate(async () => {
      const c = document.getElementById('world'), grab = () => new Promise((res) => requestAnimationFrame(() => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); res(x.getImageData(0, 0, t.width, t.height)); }));
      // (three frames in a row: the nudge off, on, off; only what's the same in the two off and different in the on counts)
      const a = await grab(), b = await grab(), c2 = await grab(), w = a.width, h = a.height, m = document.createElement('canvas'); m.width = w; m.height = h;
      const mx = m.getContext('2d'), md = mx.createImageData(w, h); let n = 0;
      for (let k = 0; k < a.data.length; k += 4) {
        const d = Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]);
        const same = Math.abs(a.data[k] - c2.data[k]) + Math.abs(a.data[k + 1] - c2.data[k + 1]) + Math.abs(a.data[k + 2] - c2.data[k + 2]) < 6;
        const on = d > 24 && same; if (on) n++;
        md.data[k] = on ? 255 : a.data[k] * 0.35; md.data[k + 1] = on ? 0 : a.data[k + 1] * 0.35; md.data[k + 2] = on ? 0 : a.data[k + 2] * 0.35; md.data[k + 3] = 255;
      }
      mx.putImageData(md, 0, 0);
      return { n, share: n / (w * h), map: m.toDataURL('image/png') };
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${out}zfight-${i}.png`, Buffer.from(r.map.split(',')[1], 'base64'));
    console.log(`${q.padEnd(16)} ${r.n} pixels change under a depth nudge (${(r.share * 100).toFixed(3)}%)  devtools/out/zfight-${i}.png`);
    await p.close();
  }
});
