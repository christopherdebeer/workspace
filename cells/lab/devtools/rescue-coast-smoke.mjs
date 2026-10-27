// Rescue · Rocky Coast in a browser, played by hand (node cells/lab/devtools/rescue-coast-smoke.mjs): the title and its panels
// (a boat, a level, the weather), Play (the Rescue Service) and the count, the Rally from its own button, the joystick held up (the boat goes ahead), held right (it turns to the screen's right),
// let go (it eases to a stop), the arrow keys, pause, the page saying what it should, no errors; the end's places.
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
  ok('the title first', s?.ui === 'title', s?.ui);
  ok('Play, Rally, Boats, Weather, Settings', (await p.evaluate(() => ['play', 'rally', 'open-boats', 'open-weather', 'open-settings'].every((id) => !!document.getElementById(id)))));
  ok('the tagline: all boats home', /all boats home/i.test(await p.evaluate(() => document.querySelector('#logo .tagline')?.textContent ?? '')));
  await p.click('#open-boats');
  ok('five boats to choose from', (await p.evaluate(() => document.querySelectorAll('#boats-list button').length)) === 5);
  await p.click('#boats-list button[data-boat="2"]');
  await p.click('#boats-panel [data-close]');
  await p.click('#open-settings');
  await p.click('#levels button[data-level="medium"]');
  await p.click('#settings-panel [data-close]');
  s = await until(p, (x) => x.mine === 2 && x.level === 'medium', 60000);
  ok('a boat chosen (Turtle), a level (medium)', s.mine === 2 && s.level === 'medium', [s.mine, s.level]);
  ok('no joystick on the title', !(await p.isVisible('#stick .base')));
  await p.click('#play');
  s = await until(p, (x) => x.ui === 'race', 60000);
  ok('play: the count, in the Rescue Service', s.ui === 'race' && s.mode === 'service' && (s.phase === 'countdown' || s.phase === 'racing'), [s.ui, s.mode, s.phase]);
  s = await until(p, (x) => x.phase === 'racing');
  ok('and the race is on', s.phase === 'racing', [s.phase, s.frameMs]);
  // (the joystick: where it is, and that it stays put out of the way, in the bottom corner)
  const base = await p.locator('#stick .base').boundingBox(), vw = await p.evaluate(() => [innerWidth, innerHeight]);
  ok('the joystick in the bottom-right corner (the default)', base && base.x > vw[0] * 0.55 && base.y > vw[1] * 0.7, base);
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
  const words = await p.evaluate(() => ({ places: document.querySelectorAll('#ladder div').length, me: !!document.querySelector('#ladder div.me'), count: document.getElementById('count').textContent, map: document.getElementById('map').getBoundingClientRect().width > 80 }));
  ok('the five crews under the map, yours marked; everyone rescued so far of everyone out there; the map', words.places === 5 && words.me && /^\d+\/\d+$/.test(words.count) && words.map, words);
  await p.click('#pause');
  s = await until(p, (x) => x.paused, 30000);
  const t0 = s.t; await p.waitForTimeout(4000); s = await state(p);
  ok('pause: the race holds still', s.paused && s.t === t0, [s.paused, t0, s.t]);
  await p.click('#resume');
  s = await until(p, (x) => !x.paused && x.t > t0, 60000);
  ok('and goes on', !s.paused && s.t > t0);
  ok('no errors', !errors.length, errors.slice(0, 3));
  await p.close();
  // (left-handed: the stick in the other corner)
  const q0 = await lab.open('seed=2&hand=left&t=5&auto&boat=0');
  await q0.waitForTimeout(1500);
  const rb = await q0.locator('#stick .base').boundingBox();
  ok('hand=left: the joystick in the bottom-left corner', rb && rb.x < vw[0] * 0.4, rb);
  // (the weather: picked on the line-up)
  const w0 = await lab.open('seed=2');
  await w0.click('#open-weather');
  await w0.click('#weather-list button[data-weather="stormy"]');
  const ws = await until(w0, (x) => x.weather === 'stormy', 60000);
  ok('the weather, chosen on the title (stormy)', ws.weather === 'stormy', ws.weather);
  await w0.close();
  await q0.close();
  // (the Rally: from its own button on the title)
  const r0 = await lab.open('seed=2');
  await r0.click('#rally');
  const rs = await until(r0, (x) => x.ui === 'race', 60000);
  ok('Rally: Lily’s race, from its own button', rs.mode === 'rally', rs.mode);
  await r0.close();
  for (const [mode, want] of [['', /everyone home/i], ['&mode=rally', /wins|won|came/i]]) {
    const q = await lab.open(`seed=2&auto${mode}&view=podium&still`);
    await q.waitForTimeout(2500);
    const end = await q.evaluate(() => ({ ui: window.__rescue.ui, rows: [...document.querySelectorAll('#ranks li')].map((li) => li.querySelector('b').textContent + ' ' + li.querySelector('strong').textContent), title: document.getElementById('result').textContent }));
    ok(`the end${mode ? ' of the Rally' : ' of the Service'}: ${mode ? '' : 'everyone home, then '}five places, 1st to 5th`, end.ui === 'podium' && want.test(end.title) && end.rows.length === 5 && end.rows[0].startsWith('1st') && end.rows[4].startsWith('5th'), end);
    console.log(`  ${end.title} · ${end.rows.join(' · ')}`);
    await q.close();
  }
}, { width: 390, height: 844 });
console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
