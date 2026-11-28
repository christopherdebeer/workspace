// The sleeve on trial, measured (node cells/lab/devtools/piste-sleeve-probe.mjs): the same extension (study=near), the
// weapon sleeve's cloth read back off the card at moments through it, in a few variants of its dials. For each: how much
// of the sleeve the fold rule is smoothing (its weight > 0), how far the cloth stands from where the skin carries it
// (mean, mm), how sharp its folds are beyond the skin's own curvature (p90 of each point's offset from its four
// neighbours' middle, less the skin's, mm), and how far it goes on moving against the arm once the hand has stopped
// (2.15 s to 2.6 s, mean, mm).
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
const { withWood } = await import('./harness.mjs');
const variants = process.argv.slice(2).length ? process.argv.slice(2).map((q) => [q, q]) : [
  ['as is', ''], ['thick ×0.3', '&sleevethick=0.3'], ['unfold ×0', '&sleeveunfold=0'], ['thick ×0.3, unfold ×0', '&sleevethick=0.3&sleeveunfold=0'],
];
const times = [1.5, 2.0, 2.15, 2.6, 4.4];
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
await withWood(async (lab) => {
  for (const [name, q] of variants) {
    const rel = {}; const rows = [];
    for (const t of times) {
      const page = await lab.open(`study=near&t=${t}&still${q}`, { width: 320, height: 320 });
      await page.waitForTimeout(800);
      const P = await page.evaluate(() => { const p = window.__piste.clothProbe(); return p && { x: Array.from(p.x), a: Array.from(p.a), m: Array.from(p.meta), pieces: p.pieces }; });
      await page.close();
      if (!P) { console.log(name, t, 'no cloth'); continue; }
      const pc = P.pieces.find((p) => p.kind === 'sleeveW');
      const X = (r, c) => { const i = (pc.off + r * pc.S + ((c + pc.S) % pc.S)) * 4; return [P.x[i], P.x[i + 1], P.x[i + 2], P.x[i + 3]]; };
      const A = (r, c) => { const i = (pc.off + r * pc.S + ((c + pc.S) % pc.S)) * 4; return [P.a[i], P.a[i + 1], P.a[i + 2]]; };
      let fired = 0, n = 0, dev = 0, atEase = 0; const sharp = [], off = [], devs = [], eases = [];
      for (let r = 0; r < pc.R; r++) for (let c = 0; c < pc.S; c++) {
        const x = X(r, c), a = A(r, c); n++; if (x[3] > 1.001) fired++;
        const d = [x[0] - a[0], x[1] - a[1], x[2] - a[2]], dl = Math.hypot(...d), sl = P.m[(pc.off + r * pc.S + c) * 4 + 3]; dev += dl; off.push(d); devs.push(dl); eases.push(sl); if (sl < 0.0005 || dl > sl * 0.97) atEase++;
        if (r > 0 && r < pc.R - 1) {
          const lap = (F) => { const m = [0, 1, 2].map((k) => (F(r + 1, c)[k] + F(r - 1, c)[k] + F(r, c + 1)[k] + F(r, c - 1)[k]) / 4); const p = F(r, c); return Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]); };
          sharp.push(lap(X) - lap(A));
        }
      }
      rel[t] = off;
      rows.push(`t ${t}: fold rule on ${(100 * fired / n).toFixed(1)}%, off the skin ${(1000 * dev / n).toFixed(1)} mm (p90 ${(1000 * pct(devs, 0.9)).toFixed(1)}, ease allowed mean ${(1000 * eases.reduce((s, e) => s + e, 0) / n).toFixed(1)}, ${(100 * atEase / n).toFixed(0)}% held at it), sharper than the skin p90 ${(1000 * pct(sharp, 0.9)).toFixed(2)} mm`);
    }
    let settle = 0; if (rel[2.15] && rel[2.6]) { for (let i = 0; i < rel[2.15].length; i++) settle += Math.hypot(...[0, 1, 2].map((k) => rel[2.6][i][k] - rel[2.15][i][k])); settle /= rel[2.15].length; }
    console.log(`\n${name}\n  ` + rows.join('\n  ') + `\n  moves on against the arm, 2.15→2.6 s: ${(1000 * settle).toFixed(1)} mm`);
  }
});
