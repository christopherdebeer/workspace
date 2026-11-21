// A flick right and straight back left, at eight moments through a stride, walking and jogging on a flat roof: what the
// feet do with a change of mind. For each footfall: how far it lands from where the drawn foot was heading a tenth of a
// second before (a late swerve the shoe couldn't make), and the drawn foot's jump in the frame it plants (a snap).
//   node cells/lab/devtools/roofjumps-flick.mjs
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './runner'; export * from './rig'; export * from './m4';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
const DT = 1 / 120;
for (const [gait, mag] of [['walk', 0.32], ['jog', 0.55]]) {
  let worstSnap = 0, worstLate = 0, n = 0, late = 0;
  for (let k = 0; k < 8; k++) {
    const at = 2 + k * 0.06, input = (t) => { const h = t >= at && t < at + 0.15 ? 1.05 : t >= at + 0.15 && t < at + 0.55 ? -1.05 : 0; return { x: Math.sin(h) * mag, z: Math.cos(h) * mag }; };
    const r = new M.Runner(flat), rig = new M.Rig(); rig.update(1, r);
    const hist = { L: [], R: [] }, was = { L: false, R: false }, prev = { L: null, R: null };
    for (let i = 0; i < 4 / DT; i++) {
      const t = i * DT; r.step(DT, input(t)); rig.update(DT, r); const b = rig.bones(r);
      for (const [s, key] of [['L', 'fl'], ['R', 'fr']]) {
        const m = b.find((o) => o.name === 'foot' + s).m, ball = M.point(m, 0, -rig.body.sole, rig.body.ball), on = !!r.reach[key] && rig.soles[s].w > 0.9;
        const sf = r.inStep(s === 'L' ? 1 : -1); hist[s].push(sf ? sf.to : null); if (hist[s].length > 13) hist[s].shift();
        if (on && !was[s] && t > at - 0.1 && t < at + 1.2) {
          n++; const aimed = hist[s][0], p = r.reach[key];
          if (aimed) { const d = Math.hypot(p[0] - aimed[0], p[2] - aimed[2]); late += d; worstLate = Math.max(worstLate, d); }
          if (prev[s]) worstSnap = Math.max(worstSnap, Math.hypot(ball[0] - prev[s][0], ball[2] - prev[s][2]) - r.speed * DT);
        }
        was[s] = on; prev[s] = ball;
      }
    }
  }
  console.log(`${gait}: ${n} footfalls after a flick; landing off where it was heading 0.1 s before: mean ${(late / n * 100).toFixed(1)} cm, worst ${(worstLate * 100).toFixed(1)} cm; worst snap at plant ${(worstSnap * 100).toFixed(1)} cm`);
}
