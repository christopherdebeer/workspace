// Regression for the drafted kit stretching from the ribs to the wrist on extension.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const root = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: "export * from './look/athlete'; export * from './bout'; export * from './weapons'; export * from './intent'; export * from './replay';", resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildAthlete, boneFrames, skinMatrices, SKIN_STRIDE, BONES, Bout, EPEE, idle, cloneBout } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const draft = JSON.parse(readFileSync(new URL('../static/piste/jacket-draft.json', import.meta.url), 'utf8'));
const athlete = buildAthlete({ draft });
const panels = athlete.pieces.filter(p => !p.closed);
const base = panels[0].base;
const matrices = new Float32Array(BONES * 16);
function edgeLength(x, i, j) {
  return Math.hypot(x[3*i] - x[3*j], x[3*i+1] - x[3*j+1], x[3*i+2] - x[3*j+2]);
}
function checkPose(fencer) {
  skinMatrices(boneFrames(fencer), athlete.bind, matrices);
  const x = new Float64Array(draft.x.length);
  for (let i = 0; i < x.length / 3; i++) {
    const v = (base + i) * SKIN_STRIDE;
    for (let j = 0; j < 4; j++) {
      const m = athlete.verts[v + 12 + j] * 16, w = athlete.verts[v + 16 + j];
      for (let k = 0; k < 3; k++) x[i*3+k] += w * (matrices[m+k] * draft.x[i*3] + matrices[m+4+k] * draft.x[i*3+1] + matrices[m+8+k] * draft.x[i*3+2] + matrices[m+12+k]);
    }
  }
  for (const panel of panels) {
    // Adjacent cloth anchors cannot separate by a forearm's length. Allow local elbow stretch.
    const limit = panel.kind === 'jacket' ? 0.025 : 0.05;
    for (let r = 0; r < panel.R; r++) for (let c = 0; c < panel.J; c++) {
      const i = panel.base - base + r * panel.J + c;
      for (const j of [c+1 < panel.J ? i+1 : i, r+1 < panel.R ? i+panel.J : i]) {
        const growth = edgeLength(x, i, j) - edgeLength(draft.x, i, j);
        assert.ok(growth < limit, `${panel.kind} row ${r} column ${c} pulled apart by ${Math.round(1000*growth)} mm`);
      }
    }
  }
}
// Along each sleeve the cloth must progress from shoulder to elbow to cuff.
for (const panel of panels.filter(p => p.kind.startsWith('sleeve'))) {
  const fore = panel.kind === 'sleeveW' ? 4 : 7;
  const elbow = athlete.bind[fore].o, wrist = athlete.bind[fore+1].o;
  const axis = wrist.map((v,k) => v-elbow[k]), length = Math.hypot(...axis);
  let furthest = -Infinity;
  for (let r = Math.ceil(panel.R * 0.55); r < panel.R; r++) {
    let along = 0;
    for (let c = 0; c < panel.J-1; c++) for (let k = 0; k < 3; k++) {
      const i = panel.base - base + r*panel.J+c;
      along += (draft.x[i*3+k] - elbow[k]) * axis[k] / (length * (panel.J-1));
    }
    assert.ok(along > furthest - 0.02, `${panel.kind} folded back along forearm at row ${r}`);
    furthest = Math.max(furthest, along);
  }
}
let bout = new Bout({ weapon: EPEE, to: 5, referee: false });
bout.place(1.82);
for (let frame = 0; frame < 100; frame++) {
  const reaching = frame >= 10 && frame < 65;
  for (const f of bout.fencers) f.intent = { ...idle(), extend: +reaching, lunge: reaching, hand: [f.facing * 0.1, 0.06] };
  bout.advance(1/60);
  if (frame === 40) bout = cloneBout(bout);
  if (frame % 5 === 0) bout.fencers.forEach(checkPose);
}
console.log('Drafted jacket holds together through extension, replay and recovery.');
