// Rescue · Rocky Coast in a browser, played by hand (node cells/lab/devtools/rescue-coast-smoke.mjs): the title and its panels
// (a boat, a level, the weather), Play (the Rescue Service: moored at the pier in the harbour, the first calls in) and
// the count, the Rally from its own button (on its own coast), steering from wherever you touch (a ring low down until
// you have; a touch on the sea away from the boat, dragged up: it goes ahead; to the right: it turns to the screen's
// right; let go: it eases to a stop), with the game steering a touch takes your boat back, the arrow keys, the stick in
// either corner when asked, pause, the page saying what it should, no errors; the end's places.
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
  ok('five crews to choose from, and three kinds of boat', (await p.evaluate(() => [document.querySelectorAll('#boats-list button').length, document.querySelectorAll('#kinds-list button').length])).join() === '5,3');
  await p.click('#boats-list button[data-boat="2"]');
  await p.click('#kinds-list button[data-kind="inshore"]');
  ok('the card says which: the inshore boat, its speed and steadiness', await p.evaluate(() => /inshore boat/i.test(document.getElementById('boat-show').textContent) && document.querySelectorAll('#boat-show .pips b.on').length === 6));
  await p.click('#boats-panel [data-close]');
  await p.click('#open-settings');
  await p.click('#levels button[data-level="medium"]');
  await p.click('#settings-panel [data-close]');
  s = await until(p, (x) => x.crew === 2 && x.kind === 'inshore' && x.level === 'medium', 60000);
  ok('a crew chosen (Turtle), a boat (the inshore boat), a level (medium)', s.crew === 2 && s.kind === 'inshore' && s.level === 'medium', [s.crew, s.kind, s.level]);
  ok('no joystick on the title', !(await p.isVisible('#stick .base')));
  await p.click('#play');
  s = await until(p, (x) => x.ui === 'race', 60000);
  ok('play: the count, in the Rescue Service, on its own coast', s.ui === 'race' && s.mode === 'service' && s.coast === 'service' && (s.phase === 'countdown' || s.phase === 'racing'), [s.ui, s.mode, s.coast, s.phase]);
  ok('three crews: Turtle in the inshore boat at your harbour, two neighbours in the other kinds down the coast; a call in by each', s.boats.length === 3 && s.mine === 0 && s.boats[0].crew === 2 && s.boats[0].kind === 'inshore' && s.boats[0].z > 860 && s.boats.slice(1).every((b) => b.z < 600 && b.crew !== 2 && b.kind !== 'inshore') && s.boats[1].kind !== s.boats[2].kind && s.called === 3, [s.boats.map((b) => [b.crew, b.kind, b.z.toFixed(0)]), s.called]);
  s = await until(p, (x) => x.phase === 'racing');
  ok('and the race is on', s.phase === 'racing', [s.phase, s.frameMs]);
  // (steering from wherever you touch: no stick in the corner; until you've steered, a ring low down says how; a touch
  // anywhere on the sea is the stick's middle while it's down)
  const vw = await p.evaluate(() => [innerWidth, innerHeight]);
  ok('steering from anywhere (the default): no stick in the corner', s.steer === 'touch' && !(await p.isVisible('#stick .base')), [s.steer]);
  ok('until you\'ve steered, a ring low down shows how', await p.evaluate(() => document.getElementById('ghost').classList.contains('hint')) && await p.isVisible('#ghost'));
  const b0 = s.boats[s.mine], [gx, gy] = [Math.round(vw[0] * 0.3), Math.round(vw[1] * 0.62)];
  await p.mouse.move(gx, gy); await p.mouse.down(); await p.mouse.move(gx, gy - 60, { steps: 4 });
  const ahead = (x) => (x.boats[x.mine].x - b0.x) * Math.sin(b0.h) + (x.boats[x.mine].z - b0.z) * Math.cos(b0.h);
  s = await until(p, (x) => ahead(x) > 5);
  ok('a touch on the sea away from your boat, dragged up: under way, ahead', s.stick.held && s.boats[s.mine].v > 2 && ahead(s) > 5, [s.stick, s.boats[s.mine], b0]);
  const ring = await p.evaluate(() => { const g = document.getElementById('ghost'); return { on: g.classList.contains('on'), hint: g.classList.contains('hint'), at: g.style.transform }; });
  ok('a faint ring where you put your finger (the hint gone)', ring.on && !ring.hint && ring.at.includes(`${gx}px, ${gy}px`), ring);
  const h0 = s.boats[s.mine].h;
  await p.mouse.move(gx + 60, gy - 20, { steps: 4 });
  s = await until(p, (x) => x.boats[x.mine].h < h0 - 0.3);
  ok('drag to the right: it turns to the screen\'s right (its heading falls)', s.boats[s.mine].h < h0 - 0.3, [h0, s.boats[s.mine].h]);
  await p.mouse.up();
  s = await until(p, (x) => !x.stick.held && Math.abs(x.boats[x.mine].v) < 1);
  ok('let go: the boat eases to a stop', !s.stick.held && s.stick.x === 0 && Math.abs(s.boats[s.mine].v) < 1 && !(await p.isVisible('#ghost')), [s.stick, s.boats[s.mine].v]);
  const k0 = s.boats[s.mine];
  await p.keyboard.down('ArrowUp');
  s = await until(p, (x) => Math.hypot(x.boats[x.mine].x - k0.x, x.boats[x.mine].z - k0.z) > 4);
  await p.keyboard.up('ArrowUp');
  ok('the up arrow: away again', Math.hypot(s.boats[s.mine].x - k0.x, s.boats[s.mine].z - k0.z) > 4, [k0, s.boats[s.mine]]);
  const words = await p.evaluate(() => ({ places: document.querySelectorAll('#ladder div').length, me: !!document.querySelector('#ladder div.me'), count: document.getElementById('count').textContent, crew: document.getElementById('place').textContent, map: document.getElementById('map').getBoundingClientRect().width > 80 }));
  ok('the three crews under the map, yours marked; everyone rescued so far of everyone called; your crew\'s count; the map', words.places === 3 && words.me && /^\d+\/\d+$/.test(words.count) && /^\d+$/.test(words.crew) && words.map, words);
  await p.click('#pause');
  s = await until(p, (x) => x.paused, 30000);
  const t0 = s.t; await p.waitForTimeout(4000); s = await state(p);
  ok('pause: the race holds still', s.paused && s.t === t0, [s.paused, t0, s.t]);
  await p.click('#resume');
  s = await until(p, (x) => !x.paused && x.t > t0, 60000);
  ok('and goes on', !s.paused && s.t > t0);
  ok('no errors', !errors.length, errors.slice(0, 3));
  await p.close();
  // (the game steering every boat: a touch takes yours back)
  const qa = await lab.open('seed=2&auto&boat=1&t=4');
  let ra = await until(qa, (x) => x.phase === 'racing' && x.t > 5);
  const a0 = ra.boats[ra.mine];
  await qa.mouse.move(vw[0] / 2, vw[1] * 0.7); await qa.mouse.down(); await qa.mouse.move(vw[0] / 2 + 64, vw[1] * 0.7, { steps: 4 });
  ra = await until(qa, (x) => !x.auto && Math.abs(x.boats[x.mine].h - a0.h) > 0.5, 60000);
  await qa.mouse.up();
  ok('?auto: a touch takes your boat back from the game (held hard right, it turns)', !ra.auto && Math.abs(ra.boats[ra.mine].h - a0.h) > 0.5, [ra.auto, a0.h, ra.boats[ra.mine].h]);
  await qa.close();
  // (the stick in a corner, when asked: the right, and for the left-handed the left; held up, the boat goes ahead)
  const q1 = await lab.open('seed=2&hand=right&t=1');
  await q1.waitForTimeout(1500);
  const base = await q1.locator('#stick .base').boundingBox();
  ok('hand=right: the stick in the bottom-right corner', base && base.x > vw[0] * 0.55 && base.y > vw[1] * 0.7, base);
  let r1 = await until(q1, (x) => x.phase === 'racing');
  const c0 = r1.boats[r1.mine], cx = base.x + base.width / 2, cy = base.y + base.height / 2;
  await q1.mouse.move(cx, cy); await q1.mouse.down(); await q1.mouse.move(cx, cy - 60, { steps: 4 });
  r1 = await until(q1, (x) => Math.hypot(x.boats[x.mine].x - c0.x, x.boats[x.mine].z - c0.z) > 5);
  await q1.mouse.up();
  ok('the stick held up: under way', Math.hypot(r1.boats[r1.mine].x - c0.x, r1.boats[r1.mine].z - c0.z) > 5, [c0, r1.boats[r1.mine]]);
  await q1.close();
  const q0 = await lab.open('seed=2&hand=left&t=5&auto&boat=0');
  await q0.waitForTimeout(1500);
  const rb = await q0.locator('#stick .base').boundingBox();
  ok('hand=left: the stick in the bottom-left corner', rb && rb.x < vw[0] * 0.4, rb);
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
  ok('Rally: Lily’s race, from its own button, on the Rally’s coast', rs.mode === 'rally' && rs.coast === 'rally', [rs.mode, rs.coast]);
  await r0.close();
  for (const [mode, want, rows] of [['', /everyone home/i, 3], ['&mode=rally', /wins|won|came/i, 5]]) {
    const q = await lab.open(`seed=2&auto${mode}&view=podium&still`);
    await q.waitForTimeout(2500);
    const end = await q.evaluate(() => ({ ui: window.__rescue.ui, rows: [...document.querySelectorAll('#ranks li')].map((li) => li.querySelector('b').textContent + ' ' + li.querySelector('strong').textContent), title: document.getElementById('result').textContent }));
    ok(`the end${mode ? ' of the Rally' : ' of the Service'}: ${mode ? 'five places, 1st to 5th' : 'everyone home, then the three crews, 1st to 3rd'}`, end.ui === 'podium' && want.test(end.title) && end.rows.length === rows && end.rows[0].startsWith('1st') && end.rows[rows - 1].startsWith(rows === 5 ? '5th' : '3rd'), end);
    console.log(`  ${end.title} · ${end.rows.join(' · ')}`);
    await q.close();
  }
}, { width: 390, height: 844 });
console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
