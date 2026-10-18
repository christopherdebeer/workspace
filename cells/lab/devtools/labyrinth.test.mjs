// The labyrinth's model on its own (node cells/lab/devtools/labyrinth.test.mjs): many worlds built by random gestures
// (taps, traces between surfaces, carving), through the same reading of a gesture the page uses (gesture.ts), and the
// rules' promises checked after every one: whatever the hand built stands (on what's below it, on an arch whose two
// sides are stone, or on a pier that itself stands); every arch's air is clear; nothing's resolved differently twice;
// undo undoes; what's written down makes the same world again. And the storyboard is what it says.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { World, replay, N, LEVELS, DIRS } = await load('../client/labyrinth/model.ts');
const G = await load('../client/labyrinth/gesture.ts');
const { story } = await load('../client/labyrinth/demo.ts');

let fails = 0, checks = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; if (fails < 25) console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };

function stands(w, tag) {
  for (let k = 0; k < LEVELS; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const mine = w.stone(k, i, j) || w.stair(k, i, j) >= 0, pier = w.pier(k, i, j);
    if (!mine && !pier) continue;
    const where = `${tag} ${k}.${i}.${j}`;
    if (pier) { ok(`${where}: a pier stands on something`, k === 0 || w.occupied(k - 1, i, j)); ok(`${where}: and carries something`, w.occupied(k + 1, i, j)); continue; }
    if (k === 0 || w.occupied(k - 1, i, j)) continue;
    const sp = w.span(k, i, j);
    ok(`${where}: with nothing under it, it's carried on an arch`, !!sp);
    if (!sp) continue;
    const [di, dj] = DIRS[sp.a];
    ok(`${where}: its arch springs from stone either side`, w.occupied(k, sp.i - di, sp.j - dj) && w.occupied(k, sp.i + sp.n * di, sp.j + sp.n * dj) && sp.n <= 3);
    for (let s = 0; s < sp.n; s++) for (let kk = sp.low; kk < k; kk++) ok(`${where}: its air is clear`, !w.occupied(kk, sp.i + s * di, sp.j + s * dj));
  }
}

const made = {};
for (let s = 1; s <= 60; s++) {
  const w = new World(s);
  let r = s * 7919;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  const pickAt = (i, j) => { let k = -1; while (k + 1 < LEVELS && w.occupied(k + 1, i, j)) k++; return k < 0 ? { face: 'ground', hit: [-1, i, j], to: [0, i, j] } : { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  for (let t = 0; t < 60; t++) {
    const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N), what = rnd();
    let op = null;
    if (what < 0.45) {
      const p = rnd() < 0.3 && w.occupied(0, i, j) ? (() => { const d = DIRS[Math.floor(rnd() * 4)], k = Math.floor(rnd() * w.topFrom(0, i, j)); return { face: 'side', hit: [k, i, j], to: [k, i + d[0], j + d[1]] }; })() : pickAt(i, j);
      op = G.tap(w, p, t);
    } else if (what < 0.85) {
      // (a stroke: wandering from here a few cells, ending on whatever's there)
      const cells = [[i, j]]; let [x, z] = [i, j], d = Math.floor(rnd() * 4);
      for (let q = 0, L = 2 + Math.floor(rnd() * 6); q < L; q++) { if (rnd() < 0.25) d = (d + (rnd() < 0.5 ? 1 : 3)) % 4; x = Math.max(0, Math.min(N - 1, x + DIRS[d][0])); z = Math.max(0, Math.min(N - 1, z + DIRS[d][1])); cells.push([x, z]); }
      const [ex, ez] = cells[cells.length - 1];
      op = G.trace(w, pickAt(i, j), cells, pickAt(ex, ez), () => t);
    } else {
      const k = Math.floor(rnd() * Math.max(1, w.topFrom(0, i, j)));
      const c = G.carve(w, { face: 'side', hit: [k, i, j], to: [k, i, j] });
      if (c) op = { cut: [c], why: 'carve' };
    }
    if (op) { w.apply(op, t); made[op.why] = (made[op.why] ?? 0) + 1; }
  }
  stands(w, `seed ${s}`);
  const again = replay(w.encode());
  ok(`seed ${s}: what's written makes the same world`, again.encode() === w.encode() && again.mass.size === w.mass.size && again.piers.size === w.piers.size && again.spans.length === w.spans.length);
  const before = w.encode(), n = w.ops.length, last = w.ops[n - 1];
  w.undo(); ok(`seed ${s}: undo takes the last back`, w.ops.length === n - 1);
  if (last) { w.apply(last); ok(`seed ${s}: and doing it again is the same`, w.encode() === before); }
}
for (const why of ['raise', 'course', 'extend', 'wall', 'walkway', 'stairs', 'carve']) ok(`gestures read every way: ${why}`, (made[why] ?? 0) > 10, made);
// (the storyboard: what each stage says it is)
const s1 = story(1), s2 = story(2), s3 = story(3), s4 = story(4);
ok('story 1: a small raised platform', s1.topFrom(0, 3, 7) === 2 && s1.topFrom(0, 4, 7) === 2);
ok('story 2: a wall traced from it', [5, 6, 7, 8, 9].every((i) => s2.stone(0, i, 7)));
ok('story 3: a connection up to the higher terrace, with steps', s3.stairs.size >= 1 && s3.stone(1, 6, 7));
ok('story 4: a passage beneath the walkway, on an arch', !s4.stone(0, 6, 7) && !!s4.span(1, 6, 7));
ok('story 4: the court closed, with something growing in it', s4.courts.size > 0 && s4.decor.length > 0);
ok('story 4: the tower bridged to the terrace on an arch', s4.spans.some((sp) => sp.k === 2 && sp.n === 3));
stands(s4, 'story 4');
console.log(`${checks - fails} of ${checks} checks hold · gestures read as ${JSON.stringify(made)}`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
