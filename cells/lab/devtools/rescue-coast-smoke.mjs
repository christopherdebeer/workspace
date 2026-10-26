// Rescue · Rocky Coast in a browser, played by hand (node cells/lab/devtools/rescue-coast-smoke.mjs): the line-up (a boat,
// a level), Go and the count, the joystick held up (the boat goes ahead), held right (it turns to the screen's right),
// let go (it eases to a stop), the arrow keys, the page saying what it should, no errors; the end's places.
process.env.EXPERIMENT = 'rescue-coast'; process.env.READY = '__rescue';
const { withWood } = await import('./harness.mjs');
let n = 0, bad = 0;
const ok = (name, cond, saw) => { n++; if (!cond) { bad++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } else console.log(`ok    ${name}`); };
const state = (p) => p.evaluate(() => window.__rescue);
// (software rendering draws a frame every second or so, and the race moves a frame's worth at a time: wait on what's
// wanted, not on the clock)
const until = async (p, f, ms = 240000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await state(p); if (f(s)) return s; await p.waitForTimeout(500); } return s; };
await withWood(async (lab) => {
  const p = await lab.open('seed=2');
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await p.waitForTimeout(2000);
  let s = await state(p);
  ok('the line-up first', s?.ui === 'lineup', s?.ui);
  ok('five boat cards', (await p.evaluate(() => document.querySelectorAll('#boats button').length)) === 5);
  await p.click('#boats button[data-boat="2"]');
  await p.click('#levels button[data-level="medium"]');
  s = await until(p, (x) => x.mine === 2 && x.level === 'medium', 60000);
  ok('a boat chosen (Gannet), a level (medium)', s.mine === 2 && s.level === 'medium', [s.mine, s.level]);
  ok('no joystick on the line-up', !(await p.isVisible('#stick .base')));
  await p.click('#go');
  s = await until(p, (x) => x.ui === 'race', 60000);
  ok('go: the count', s.ui === 'race' && (s.phase === 'countdown' || s.phase === 'racing'), [s.ui, s.phase]);
  s = await until(p, (x) => x.phase === 'racing');
  ok('and the race is on', s.phase === 'racing', [s.phase, s.frameMs]);
  // (the joystick: where it is, and that it stays put out of the way, in the bottom corner)
  const base = await p.locator('#stick .base').boundingBox(), vw = await p.evaluate(() => [innerWidth, innerHeight]);
  ok('the joystick in the bottom-left corner', base && base.x < vw[0] * 0.4 && base.y > vw[1] * 0.7, base);
  const cx = base.x + base.width / 2, cy = base.y + base.height / 2;
  const b0 = (await state(p)).boats[2];
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy - 60, { steps: 4 });
  s = await until(p, (x) => x.boats[2].z - b0.z > 5);
  ok('stick up: under way, ahead', s.stick.held && s.boats[2].v > 2 && s.boats[2].z - b0.z > 5, [s.stick, s.boats[2], b0]);
  const h0 = s.boats[2].h;
  await p.mouse.move(cx + 60, cy - 20, { steps: 4 });
  s = await until(p, (x) => x.boats[2].h < h0 - 0.3);
  ok('stick right: it turns to the screen\'s right (its heading falls)', s.boats[2].h < h0 - 0.3, [h0, s.boats[2].h]);
  await p.mouse.up();
  s = await until(p, (x) => !x.stick.held && Math.abs(x.boats[2].v) < 1);
  ok('let go: the knob springs home and the boat eases to a stop', !s.stick.held && s.stick.x === 0 && Math.abs(s.boats[2].v) < 1, [s.stick, s.boats[2].v]);
  const k0 = s.boats[2];
  await p.keyboard.down('ArrowUp');
  s = await until(p, (x) => Math.hypot(x.boats[2].x - k0.x, x.boats[2].z - k0.z) > 4);
  await p.keyboard.up('ArrowUp');
  ok('the up arrow: away again', Math.hypot(s.boats[2].x - k0.x, s.boats[2].z - k0.z) > 4, [k0, s.boats[2]]);
  const words = await p.evaluate(() => ({ places: document.querySelectorAll('#places .chip').length, me: !!document.querySelector('#places .chip.me'), count: document.getElementById('count').textContent, track: document.querySelectorAll('#track i').length }));
  ok('the places along the top, yours marked; your count; the five on the track', words.places === 5 && words.me && words.count !== '' && words.track === 5, words);
  ok('no errors', !errors.length, errors.slice(0, 3));
  await p.close();
  // (left-handed: the stick in the other corner)
  const q0 = await lab.open('seed=2&hand=right&t=5&auto&boat=0');
  await q0.waitForTimeout(1500);
  const rb = await q0.locator('#stick .base').boundingBox();
  ok('hand=right: the joystick in the bottom-right corner', rb && rb.x > vw[0] * 0.55, rb);
  await q0.close();
  const q = await lab.open('seed=2&auto&view=podium&still');
  await q.waitForTimeout(2500);
  const end = await q.evaluate(() => ({ ui: window.__rescue.ui, rows: [...document.querySelectorAll('#ranks li')].map((li) => li.querySelector('b').textContent + ' ' + li.querySelector('strong').textContent), title: document.getElementById('result').textContent }));
  ok('the end: five places, 1st to 5th', end.ui === 'podium' && end.rows.length === 5 && end.rows[0].startsWith('1st') && end.rows[4].startsWith('5th'), end);
  console.log(`  ${end.title} · ${end.rows.join(' · ')}`);
  await q.close();
}, { width: 390, height: 844 });
console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
