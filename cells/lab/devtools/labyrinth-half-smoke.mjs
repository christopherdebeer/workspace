// The half grid in the browser, as a hand uses it (node cells/lab/devtools/labyrinth-half-smoke.mjs): a new world on
// the half grid (the default for a new world); taps that raise a square at a time where they're aimed, through the drawing's squeeze;
// a thin wall traced on the ground; a terrace raised; a trace from the ground up to it (two squares to a level); a
// reload keeping the grid. And nothing thrown. A picture: devtools/out/labyrinth-half-smoke.png.
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const c = checks();
await withWood(async (lab) => {
  const p = await lab.open('zoom=0.55&flat&grid=half&brush=auto&cats=0');
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.waitForFunction(() => window.__labyrinth);
  await p.waitForTimeout(500);
  const W = (f, ...a) => p.evaluate(([src, args]) => new Function('w', 'a', `return (${src})(w, ...a)`)(window.__labyrinth.world, args), [f.toString(), a]);
  const at = (i, j, y) => p.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, y]);
  const tapAt = async (i, j, y) => { await p.waitForTimeout(700); const s = await at(i, j, y); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(200); };
  const finger = (moves, { down = false, up = false } = {}) => p.evaluate(({ moves, down, up }) => {
    const cv = document.getElementById('stone'), busy = (ms) => { const t = performance.now() + ms; while (performance.now() < t) { /* the hand moving */ } };
    cv.setPointerCapture = () => {};
    const ev = (type, [x, y]) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
    if (down) ev('pointerdown', moves[0]);
    for (const m of down ? moves.slice(1) : up ? [] : moves) { busy(25); ev('pointermove', m); }
    if (up) ev('pointerup', moves[moves.length - 1]);
  }, { moves, down, up });
  const drag = async (pts) => {
    await p.waitForTimeout(1200);
    const s = await Promise.all(pts.map(([i, j, y]) => at(i, j, y)));
    await finger([s[0]], { down: true });
    const moves = [];
    for (let q = 1; q < s.length; q++) for (let t = 1; t <= 6; t++) moves.push([s[q - 1][0] + ((s[q][0] - s[q - 1][0]) * t) / 6, s[q - 1][1] + ((s[q][1] - s[q - 1][1]) * t) / 6]);
    await finger(moves);
    await finger([moves.at(-1) ?? s[0]], { up: true }); await p.waitForTimeout(400);
  };
  c.ok('a new world on the half grid', (await W((w) => w.bay)) === 2);
  // (a tap on the ground raises the square aimed at, not its neighbour: the touch taken through the squeeze)
  await tapAt(12, 12, 0);
  c.ok('a tap raises the square it was aimed at', await W((w) => w.stone(0, 12, 12)), await W((w) => [...w.mass.keys()].length));
  // (a terrace: a block of squares raised twice)
  for (const [i, j] of [[18, 8], [19, 8], [18, 9], [19, 9]]) { await tapAt(i, j, 0); await tapAt(i, j, 1); }
  c.ok('a terrace two storeys high', await W((w) => [[18, 8], [19, 8], [18, 9], [19, 9]].every(([i, j]) => w.stone(1, i, j))));
  // (a thin wall traced on the ground, a square thick)
  await drag([[4, 16, 0], [14, 16, 0]]);
  c.ok('a wall traced, a square thick', await W((w) => { let n = 0; for (let i = 5; i <= 13; i++) if (w.stone(0, i, 16)) n++; return n >= 7 && !w.stone(0, 9, 15) && !w.stone(0, 9, 17); }));
  // (from the ground up to the terrace: four squares of steps, two to a level)
  await drag([[10, 8, 0], [17, 8, 0], [18, 8, 2]]);
  const st = await W((w) => [...w.stairs.keys()].length);
  c.ok('a trace up to it lays a flight two squares to a level', st === 4, st);
  await p.screenshot({ path: new URL('./out/labyrinth-half-smoke.png', import.meta.url).pathname });
  // (kept across a reload, on its grid)
  await p.reload(); await p.waitForFunction(() => window.__labyrinth); await p.waitForTimeout(500);
  c.ok('kept across a reload, on the half grid', (await W((w) => w.bay)) === 2 && (await W((w) => [...w.stairs.keys()].length)) === st);
  c.ok('nothing thrown', p.errors.length === 0, p.errors);
}, { width: 390, height: 760 });
c.done();
