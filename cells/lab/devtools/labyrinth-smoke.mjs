// The labyrinth in the browser, as a hand uses it (node cells/lab/devtools/labyrinth-smoke.mjs): the brief's first
// test, with no instruction but the gestures. A small raised platform (taps); a wall traced from it across the stone; a
// terrace higher up; a trace from the platform's top along the wall and up to the terrace (steps and landings); a
// passage cut beneath the walkway (hold, then carve: an arch carries what's over it). And undo, a turn from the
// background, print, what's built kept across a reload, and nothing thrown.
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const c = checks();
await withWood(async (lab) => {
  const p = await lab.open('zoom=0.55&flat&intent=mass');
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.waitForFunction(() => window.__labyrinth);
  await p.waitForTimeout(500);
  const probe = () => p.evaluate(() => window.__labyrinth.probe());
  const W = (f, ...a) => p.evaluate(([src, args]) => new Function('w', 'a', `return (${src})(w, ...a)`)(window.__labyrinth.world, args), [f.toString(), a]);
  const at = (i, j, y) => p.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, y]);
  const tapAt = async (i, j, y) => { await p.waitForTimeout(900); const s = await at(i, j, y); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(200); };
  const drag = async (pts, hold = 0, peek = null) => {
    await p.waitForTimeout(1500);
    const s = await Promise.all(pts.map(([i, j, y]) => at(i, j, y)));
    await p.mouse.move(s[0][0], s[0][1]); await p.mouse.down();
    if (hold) await p.waitForTimeout(hold);
    for (let q = 1; q < s.length; q++) for (let t = 1; t <= 6; t++) { await p.mouse.move(s[q - 1][0] + ((s[q][0] - s[q - 1][0]) * t) / 6, s[q - 1][1] + ((s[q][1] - s[q - 1][1]) * t) / 6); await p.waitForTimeout(25); }
    if (peek) await peek();
    await p.mouse.up(); await p.waitForTimeout(300);
  };
  c.ok('opens on a bare stone, saying what a hand can do', (await probe()).ops === 0 && (await p.textContent('#hint')).includes('trace'));
  // (a small raised platform: the stone tapped, its top tapped)
  await tapAt(3, 7, 0); await tapAt(3, 7, 1);
  c.ok('tap: the stone raises a plinth, its top another course', await W((w) => w.stone(0, 3, 7) && w.stone(1, 3, 7)), await probe());
  // (a wall traced across the stone, from beside it)
  await drag([[4, 7, 0], [6, 7, 0], [8, 7, 0]]);
  { const wall = await W((w) => [4, 5, 6, 7, 8].every((i) => w.stone(0, i, 7))), pr = await probe(); c.ok('trace on the stone: a wall along it', wall && pr.whys[pr.whys.length - 1] === 'wall', { wall, pr }); }
  // (and the other ways it could be read, offered after it: a touch reads it as a thin wall, and back)
  {
    const alts = await p.evaluate(() => window.__labyrinth.alts()), n = await probe();
    c.ok('after a gesture, the other ways it could be read', alts && alts.labels.length === 4 && alts.at === 0 && await p.isVisible('#alts'), alts);
    const thin = alts.labels.indexOf('a thin wall');
    await p.click(`#alts [data-alt="${thin}"]`);
    c.ok('a touch reads it so instead, in place of what it built', (await probe()).ops === n.ops && await W((w) => [4, 5, 6, 7, 8].every((i) => w.wall(0, i, 7) >= 0)));
    await p.click('#alts [data-alt="0"]');
    c.ok('and back', await W((w) => [4, 5, 6, 7, 8].every((i) => w.wall(0, i, 7) < 0 && w.stone(0, i, 7))));
  }
  // (a terrace higher up: tapped up three courses)
  for (const y of [0, 1, 2]) await tapAt(9, 4, y);
  c.ok('tap, tap, tap: a terrace three high', await W((w) => w.topFrom(0, 9, 4) === 3));
  // (from the platform's top, along the wall's top, up to the terrace)
  let shown = '';
  await drag([[3, 7, 2], [5, 7, 2], [7, 7, 2], [8, 6, 2.4], [9, 4, 3]], 0, async () => { shown = await p.evaluate(() => window.__labyrinth.world.encode()); });
  { const after = await p.evaluate(() => window.__labyrinth.world.encode()); c.ok('what the trace showed under the finger is what was built', shown === after, { shown: shown.slice(-300), after: after.slice(-300) }); }
  const pr = await probe();
  c.ok('trace from a top up to a higher top: steps and landings', pr.whys.at(-1) === 'stairs' && pr.stairs >= 1, pr);
  c.ok('and the landings along the wall rest on it', await W((w) => w.stone(1, 5, 7) && w.stone(1, 6, 7)));
  // (too steep for a flight along the stroke: a stair tower instead, beside the terrace, climbing inside; undone after)
  { const n0 = (await probe()).ops;
    await drag([[9, 6, 0], [9, 5, 0], [9, 4, 3]]);
    const pr = await probe();
    c.ok('a climb too steep for a flight: a stair tower, and it can be climbed', pr.ops === n0 + 1 && pr.whys.at(-1) === 'tower' && await W((w) => w.stone(2, 9, 5)), { n0, pr, last: await W((w) => JSON.stringify(w.ops.at(-1))) });
    await p.evaluate(() => { const w = window.__labyrinth.world; w.undo(0); }); }
  // (the take brush: a stroke over the wall under the walkway carves it)
  await p.evaluate(() => window.__labyrinth.setBrush('take'));
  await drag([[5.8, 7, 0.5], [6.3, 7, 0.5]]);
  c.ok('take, traced: the wall carved through beneath the walkway', await W((w) => !w.stone(0, 6, 7) && w.stone(1, 6, 7)), await probe());
  await p.evaluate(() => window.__labyrinth.setBrush('auto'));
  c.ok('and what\'s over the cut stands on an arch', await W((w) => !!w.span(1, 6, 7)), await probe());
  const n = (await probe()).ops;
  await p.click('#undo'); await p.waitForTimeout(200);
  { const pr = await probe(), back = await W((w) => w.stone(0, 6, 7)); c.ok('undo takes the carving back', pr.ops === n - 1 && back, { n, pr, back }); }
  // (a drag from the background turns it)
  const az0 = await p.evaluate(() => window.__labyrinth.view.az);
  await p.mouse.move(40, 140); await p.mouse.down();
  for (let k = 1; k <= 10; k++) { await p.mouse.move(40 + 19.6 * k, 140); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(600);
  await p.waitForFunction(() => { const a = window.__labyrinth.view.az, q = (a - Math.PI / 4) / (Math.PI / 2); return Math.abs(q - Math.round(q)) < 1e-3; }, null, { timeout: 8000 }).catch(() => {});
  const az = await p.evaluate(() => window.__labyrinth.view.az), q = (az - Math.PI / 4) / (Math.PI / 2);
  c.ok('a drag from the background turns it, and it settles on a corner', Math.abs(az - az0) > 1 && Math.abs(q - Math.round(q)) < 1e-3, { az0, az });
  c.ok('and builds nothing', (await probe()).ops === n - 1);
  await p.click('#print'); await p.waitForTimeout(300);
  c.ok('print draws it as a print', await p.evaluate(() => window.__labyrinth.R.print));
  const kept = await p.evaluate(() => window.__labyrinth.world.encode());
  await p.reload(); await p.waitForFunction(() => window.__labyrinth); await p.waitForTimeout(500);
  c.ok('what\'s built is kept across a reload', (await p.evaluate(() => window.__labyrinth.world.encode())) === kept && (await probe()).ops === n - 1);
  p.on('dialog', (d) => d.accept());
  await p.click('#again'); await p.waitForTimeout(300);
  c.ok('clear clears the stone', (await probe()).ops === 0);
  c.ok('nothing thrown', !p.errors.length, p.errors);
  await p.close();
  {
    // (on the land, as a way: a stroke from the low ground up to the shelf, drawn with the pointer: the land says how)
    const q = await lab.open('zoom=1&land=6&intent=way');
    await q.waitForTimeout(1200);
    const at2 = (i, j) => q.evaluate(([a, b]) => { const L = window.__labyrinth; return L.screenOf(a, b, L.world.ground(a, b)); }, [i, j]);
    const pts = await Promise.all([[1, 11], [1, 10], [1, 9], [1, 8], [1, 7], [1, 6], [1, 5]].map(([i, j]) => at2(i, j)));
    await q.mouse.move(pts[0][0], pts[0][1]); await q.mouse.down();
    for (let n = 1; n < pts.length; n++) for (let t = 1; t <= 6; t++) { await q.mouse.move(pts[n - 1][0] + ((pts[n][0] - pts[n - 1][0]) * t) / 6, pts[n - 1][1] + ((pts[n][1] - pts[n - 1][1]) * t) / 6); await q.waitForTimeout(20); }
    await q.mouse.up(); await q.waitForTimeout(500);
    const got = await q.evaluate(() => { const w = window.__labyrinth.world, o = w.ops.at(-1); return o && { why: o.why, follow: !!o.connect?.follow, reached: w.reached.get(o)?.reached, stairs: w.stairs.size, intent: window.__labyrinth.intent }; });
    c.ok('on the land, as a way: a stroke up the land, paved and climbing as it rises, reaching', got?.why === 'way' && got.follow && got.reached && got.stairs >= 2, got);
    await q.close();
  }
  {
    // (the palette, on a fresh stone: each piece put where it's touched, on the same stone the gestures build)
    const q = await lab.open('zoom=0.55&ops=[]');
    await q.waitForTimeout(800);
    const W2 = (f, ...a) => q.evaluate(([src, args]) => new Function('w', 'a', `return (${src})(w, ...a)`)(window.__labyrinth.world, args), [f.toString(), a]);
    const piece = async (h, i, j, y) => { await q.evaluate((hh) => window.__labyrinth.setHand(hh), h); await q.waitForTimeout(700); const s = await q.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, y]); await q.mouse.click(s[0], s[1]); await q.waitForTimeout(200); };
    await piece('block', 4, 4, 0);
    c.ok('block: on the stone where it\'s touched', await W2((w) => w.block(0, 4, 4)));
    await piece('arch', 4, 5, 0);
    c.ok('arch: stone with a way through it', await W2((w) => w.archway(0, 4, 5) >= 0));
    await piece('arch', 4, 5, 1);
    c.ok('arch on an arch: one tall arch, the same way', await W2((w) => w.archway(1, 4, 5) === w.archway(0, 4, 5)));
    await piece('stair', 4.55, 4, 0.4);
    c.ok('stair: against the block, climbing onto it', await W2((w) => w.stair(0, 5, 4) === 2));
    for (const y of [0, 1]) { await piece('block', 7, 2, y); await piece('block', 7, 6, y); }
    await piece('bridge', 7, 2.55, 1.5);
    c.ok('bridge: across the gap, the whole span, on one arch', await W2((w) => [3, 4, 5].every((j) => w.stone(1, 7, j)) && w.span(1, 7, 4)?.n === 3), await W2((w) => JSON.stringify(w.spans)));
    await piece('cypress', 9, 8, 0); await piece('pool', 8, 8, 0);
    c.ok('cypress and pool where they\'re touched', await W2((w) => w.tree(0, 9, 8) && w.pool(8, 8)));
    await piece('take', 4, 4, 1);
    c.ok('take: the piece touched, gone', await W2((w) => !w.stone(0, 4, 4)));
    // (the slab grows: a block on its last cell, and it reaches two cells past it)
    const e0 = await W2((w) => w.extent());
    await piece('block', e0.i1, 5, 0);
    const e1 = await W2((w) => w.extent());
    c.ok('built at the slab\'s edge, the slab grows past it', e1.i1 === e0.i1 + 2, { e0, e1 });
    await piece('block', e1.i1, 5, 0);
    c.ok('and on its new edge, again', (await W2((w) => w.extent())).i1 === e1.i1 + 2);
    c.ok('the palette: nothing thrown', !q.errors.length, q.errors);
    await q.close();
  }
  {
    // (the brushes, on the storyboard's motifs and dressing)
    const q = await lab.open('zoom=0.55&story=6');
    await q.waitForTimeout(900);
    const L = (f, ...a) => q.evaluate(([src, args]) => new Function('L', 'a', `return (${src})(L, ...a)`)(window.__labyrinth, args), [f.toString(), a]);
    const tap = async (i, j, y) => { await q.waitForTimeout(400); const s = await L((L, a, b, d) => L.screenOf(a, b, d), i, j, y); await q.mouse.click(s[0], s[1]); await q.waitForTimeout(250); };
    const stroke = async (pts) => {
      await q.waitForTimeout(400);
      const s = await Promise.all(pts.map(([i, j, y]) => L((L, a, b, d) => L.screenOf(a, b, d), i, j, y)));
      await q.mouse.move(s[0][0], s[0][1]); await q.mouse.down();
      for (let n = 1; n < s.length; n++) for (let t = 1; t <= 6; t++) { await q.mouse.move(s[n - 1][0] + ((s[n][0] - s[n - 1][0]) * t) / 6, s[n - 1][1] + ((s[n][1] - s[n - 1][1]) * t) / 6); await q.waitForTimeout(25); }
      await q.mouse.up(); await q.waitForTimeout(300);
    };
    const ms = await L((L) => L.motifs());
    c.ok('motifs found: an arcade, a flight, a court, a tower', ['arcade', 'flight', 'court', 'tower'].every((k) => ms.some((m) => m.kind === k)), ms);
    // (hand: a tap asks what it is)
    await q.click('[data-brush="hand"]');
    await tap(10, 7, 3);
    c.ok('hand: a tap says what it is, and what it\'s part of', /arch/.test(await q.textContent('#hint')) && /arcade/.test(await q.textContent('#hint')), await q.textContent('#hint'));
    // (select: the arch, then the whole arcade; its readings switched, and back)
    await q.click('[data-brush="select"]');
    await tap(10, 7, 3);
    const s1 = await L((L) => L.selection());
    c.ok('select: a tap takes up the piece', s1 && /arch/.test(s1.title) && await q.isVisible('#card'), s1);
    await tap(10, 7, 3);
    const s2 = await L((L) => L.selection());
    c.ok('and again, the whole it\'s part of', s2 && /arcade/.test(s2.title) && s2.cells > s1.cells, s2);
    const n0 = await L((L) => L.world.ops.length);
    c.ok('the card shows every reading at once, the current one marked', await q.locator('#readings button').count() === s2.readings.length && await q.locator('#readings button.on').count() === 1);
    await q.click('#readings button:nth-child(2)');
    c.ok('switched: the arcade read as lintels', await L((L) => L.world.spans.filter((sp) => sp.k === 2 && sp.i === 10).every((sp) => sp.flat)) && await L((L) => L.world.ops.length) === n0 + 1);
    await q.click('#readings button:nth-child(3)');
    await q.click('#readings button:nth-child(1)');
    c.ok('and on to another, then back to arches, leaving nothing behind', await L((L) => L.world.spans.filter((sp) => sp.k === 2 && sp.i === 10).every((sp) => !sp.flat)) && await L((L) => L.world.ops.length) === n0, await L((L) => L.selection()));
    await q.click('#scope button:last-child');
    const s3 = await L((L) => L.selection());
    c.ok('scope: the whole structure it\'s joined to', /structure/.test(s3?.title) && s3.cells > s2.cells, s3);
    await q.click('#dressrow [data-dress="marble"]');
    c.ok('dressed whole, straight from the card', await L((L) => L.world.dressed(2, 10, 7)?.mat === 2));
    await q.click('#close');
    // (the piece brush: touched again, the sheet; brick from it, a stone dressed)
    await q.click('[data-brush="piece"]'); await q.click('[data-brush="piece"]');
    c.ok('the piece brush, touched again, opens its sheet', await q.isVisible('#sheet.on'));
    await q.click('#sheet [data-held="brick"]');
    c.ok('a dressing from the sheet is held, and shown on the brush', await L((L) => L.held) === 'brick' && /brick/.test(await q.getAttribute('[data-brush="piece"]', 'aria-label')) && /piece/.test(await q.textContent('[data-brush="piece"]')));
    await tap(9, 4, 3);
    c.ok('a tap dresses the stone touched', await L((L) => L.world.dressed(2, 9, 4)?.mat === 1));
    // (a run: blocks traced across the stone, a wall)
    await L((L) => L.setBrush('block'));
    await stroke([[13, 12, 0], [13, 13, 0], [13, 14, 0]]);
    c.ok('the block brush, traced: a run of blocks', await L((L) => [12, 13, 14].every((j) => L.world.block(0, 13, j))), await L((L) => L.world.ops.at(-1)));
    // (the wall piece, traced: a thin wall)
    await L((L) => L.setBrush('wall'));
    await stroke([[15, 12, 0], [15, 13, 0], [15, 14, 0]]);
    c.ok('the wall piece, traced: a thin wall along it', await L((L) => [12, 13, 14].every((j) => L.world.wall(0, 15, j) >= 0)), await L((L) => L.world.ops.at(-1)));
    // (take: a tap takes the piece away)
    await q.click('[data-brush="take"]');
    await tap(13, 14, 1);
    c.ok('take: a tap takes it away', await L((L) => !L.world.stone(0, 13, 14)));
    c.ok('the brushes: nothing thrown', !q.errors.length, q.errors);
    await q.close();
  }
});
c.done?.();
