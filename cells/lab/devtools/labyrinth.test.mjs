// The labyrinth's model on its own (node cells/lab/devtools/labyrinth.test.mjs): built piece by piece at random, with
// every piece in the palette and auto, many times over, everything stands on something (the stone, or a block's, an
// arch's or a bridge's top); every bridge spans from stone to stone level with it; nothing's taken away from under
// something; undo undoes; and what's written down makes the same stone again.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { Labyrinth, replay, decide, N, LEVELS, DIRS } = await load('../client/labyrinth/model.ts');
const { demo } = await load('../client/labyrinth/demo.ts');

let fails = 0, checks = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; if (fails < 30) console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };

function sound(m, tag) {
  for (const p of m.pieces) {
    const where = `${tag} ${p.kind} ${p.k}.${p.i}.${p.j}`;
    if (p.kind === 'pool') { ok(`${where}: a pool's in the stone`, p.k === 0); continue; }
    if (p.kind === 'bridge') {
      const [di, dj] = DIRS[p.a];
      ok(`${where}: a bridge spans from stone to stone`, m.solid(p.k, p.i - di, p.j - dj) && m.solid(p.k, p.i + p.n * di, p.j + p.n * dj));
      continue;
    }
    ok(`${where}: stands on something`, p.k === 0 ? !m.pool(p.i, p.j) : ['block', 'arch', 'bridge'].includes(m.kindAt(p.k - 1, p.i, p.j)), m.kindAt(p.k - 1, p.i, p.j));
  }
}

const HANDS = ['auto', 'auto', 'auto', 'block', 'block', 'arch', 'stair', 'bridge', 'cypress', 'pool'];
const made = {};
for (let s = 1; s <= 80; s++) {
  const m = new Labyrinth(s);
  let r = s * 7919;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  for (let t = 0; t < 120; t++) {
    const hand = HANDS[Math.floor(rnd() * HANDS.length)];
    // (a touch somewhere: on the stone, on a top, or on a side, as a hand would strike it)
    const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N);
    let k = 0; while (k < LEVELS && m.at(k, i, j)) k++;
    const side = rnd() < 0.4 && k > 0, d = DIRS[Math.floor(rnd() * 4)], kk = side ? Math.floor(rnd() * k) : k;
    const hit = side ? [kk, i, j] : [k - 1, i, j], to = side ? [kk, i + d[0], j + d[1]] : [k, i, j];
    if (side && !m.at(kk, i, j)) continue;
    const want = decide(m, hand, hit, to, Math.floor(rnd() * 4));
    const p = want && m.place(want.kind, want.k, want.i, want.j, want.a, want.n, t);
    if (p) made[p.kind] = (made[p.kind] ?? 0) + 1;
    // (now and then, one taken away)
    if (rnd() < 0.08 && m.pieces.length) {
      const q = m.pieces[Math.floor(rnd() * m.pieces.length)], carried = m.carries(q), before = m.pieces.length;
      ok(`seed ${s}: what's carried isn't taken away`, m.remove(q) === !carried && m.pieces.length === before - (carried ? 0 : 1));
    }
  }
  sound(m, `seed ${s}`);
  const again = replay(m.encode());
  ok(`seed ${s}: what's written makes the same stone`, again.encode() === m.encode(), [m.pieces.length, again.pieces.length]);
  const n = m.pieces.length, enc = m.encode(), last = m.undo();
  ok(`seed ${s}: undo takes the last piece back`, !last || (m.pieces.length === n - 1 && enc.startsWith(m.encode())));
}
const d = demo();
sound(d, 'the demo');
ok('the demo is all there', d.pieces.length >= 55, d.pieces.length);
for (const k of ['block', 'arch', 'stair', 'bridge', 'cypress', 'pool']) ok(`every kind gets built: ${k}`, (made[k] ?? 0) > 20, made);
console.log(`${checks - fails} of ${checks} checks hold · built ${JSON.stringify(made)}`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
