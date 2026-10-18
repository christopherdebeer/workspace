// The labyrinth's model on its own (node cells/lab/devtools/labyrinth.test.mjs): touched at random, many times over,
// every level stays a perfect maze (its open rooms and passages a forest of trees, no loops), everything built stands on
// something (a vault's springing on solid stone), nothing's built over a stair, and the same touches make the same stone.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const M = await load('../client/labyrinth/model.ts');
const { Labyrinth, replay, N, LEVELS, EMPTY, SOLID, OPEN, PIER, DIRS, isRoom, isPost } = M;

let fails = 0, checks = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } };

function check(m, tag) {
  for (let k = 0; k < LEVELS; k++) {
    // (every built voxel stands on something: the stone, or what's built below it, not on a stair)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = m.kind(k, i, j);
      if (c === EMPTY) continue;
      // (a pier: on stone, or on the stone below; and only under something)
      if (c === PIER) { ok(`${tag} L${k} pier (${i},${j}) stands`, k === 0 || m.solid(k - 1, i, j)); ok(`${tag} L${k} pier (${i},${j}) carries`, m.built(k + 1, i, j)); continue; }
      // (anything else stands on what's below, or is a bridge: on an arch between piers or stone)
      if (k > 0 && !m.built(k - 1, i, j)) {
        if (isPost(k, i, j)) ok(`${tag} L${k} post (${i},${j}) over nothing`, false);
        else {
          const sup = isRoom(k, i, j) ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : isPost(k, i + 1, j) ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
          ok(`${tag} L${k} bridge (${i},${j}) on its arch's springing`, sup.every(([a, b]) => m.solid(k - 1, i + a, j + b)), sup.map(([a, b]) => m.kind(k - 1, i + a, j + b)));
        }
      }
      // (posts are solid; rooms are open)
      if (isPost(k, i, j)) ok(`${tag} L${k} post (${i},${j}) solid`, c === SOLID, c);
      if (isRoom(k, i, j)) ok(`${tag} L${k} room (${i},${j}) open`, c === OPEN, c);
      // (a vault's springing: an edge between its two posts, a room on its four corner posts)
      if (m.vaulted(k, i, j)) {
        if (isRoom(k, i, j)) ok(`${tag} L${k} vault (${i},${j}) on its corners`, [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => m.solid(k, i + a, j + b)));
        else { const across = isPost(k, i + 1, j) ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]; ok(`${tag} L${k} arch (${i},${j}) between posts`, across.every(([a, b]) => m.solid(k, i + a, j + b))); }
      }
      // (a stair: a dead end, nothing over it, the wall it climbs onto solid)
      if (m.stair(k, i, j) >= 0) {
        const [di, dj] = DIRS[m.stair(k, i, j)];
        ok(`${tag} L${k} stair (${i},${j}) not built over`, !m.built(k + 1, i, j));
        ok(`${tag} L${k} stair (${i},${j}) climbs onto a wall`, m.solid(k, i + di, j + dj));
        ok(`${tag} L${k} stair (${i},${j}) in a dead end`, DIRS.filter(([a, b]) => m.kind(k, i + a, j + b) === OPEN).length === 1);
      }
    }
    // (the level's maze: rooms joined by open passages, with no loops: as many joins as rooms less parts)
    const rooms = [], seen = new Set();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (isRoom(k, i, j) && m.built(k, i, j)) rooms.push([i, j]);
    let edges = 0, parts = 0;
    for (const [i, j] of rooms) for (const [di, dj] of [[1, 0], [0, 1]]) if (m.kind(k, i + di, j + dj) === OPEN && m.built(k, i + 2 * di, j + 2 * dj)) edges++;
    for (const [i, j] of rooms) {
      if (seen.has(i + j * N)) continue;
      parts++;
      const st = [[i, j]]; seen.add(i + j * N);
      while (st.length) { const [a, b] = st.pop(); for (const [di, dj] of DIRS) { const a2 = a + 2 * di, b2 = b + 2 * dj; if (m.kind(k, a + di, b + dj) === OPEN && m.built(k, a2, b2) && isRoom(k, a2, b2) && !seen.has(a2 + b2 * N)) { seen.add(a2 + b2 * N); st.push([a2, b2]); } } }
    }
    ok(`${tag} L${k} a perfect maze (rooms ${rooms.length}, passages ${edges}, parts ${parts})`, edges === rooms.length - parts);
  }
}

const levelsSeen = new Array(LEVELS).fill(0);
let stairs = 0, vaults = 0, arches = 0;
for (let s = 1; s <= 60; s++) {
  const m = new Labyrinth(s);
  let r = s * 7919;
  const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  for (let t = 0; t < 40; t++) {
    // (touches near the middle mostly, so it climbs)
    const i = Math.floor(N / 2 + (rnd() - 0.5) * (t < 6 ? N : N * 0.6)), j = Math.floor(N / 2 + (rnd() - 0.5) * (t < 6 ? N : N * 0.6));
    m.touch(Math.max(0, Math.min(N - 1, i)), Math.max(0, Math.min(N - 1, j)), t);
  }
  check(m, `seed ${s}`);
  for (let k = 0; k < LEVELS; k++) if (m.levels[k].kind.some((c) => c !== EMPTY)) levelsSeen[k]++;
  for (let k = 0; k < LEVELS; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (m.stair(k, i, j) >= 0) stairs++; if (m.vaulted(k, i, j)) vaults++; if (m.arched(k, i, j)) arches++; }
  const again = replay(s, m.taps);
  ok(`seed ${s}: the same touches make the same stone`, m.levels.every((l, k) => l.kind.every((c, v) => c === again.levels[k].kind[v])));
}
ok('it climbs: most labyrinths reach the fourth level', levelsSeen[3] > 40, levelsSeen);
ok('there are stairs, vaults and bridges', stairs > 20 && vaults > 500 && arches > 100, { stairs, vaults, arches });
console.log(`${checks - fails} of ${checks} checks hold · levels reached ${JSON.stringify(levelsSeen)} · ${stairs} stairs, ${vaults} vaults over 60 labyrinths`);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
