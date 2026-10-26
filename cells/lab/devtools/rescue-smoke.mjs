// The rescue race in a browser, played by hand (node cells/lab/devtools/rescue-smoke.mjs): the line-up (choose a boat,
// a level), Go and the count of three, a finger held on the sea (the boat heads for it), the arrow keys (it turns the way
// they say on the screen), the page saying what it should (places, your count, the track), no errors; the end's places.
process.env.EXPERIMENT = 'rescue'; process.env.READY = '__rescue';
const { withWood } = await import('./harness.mjs');
let n = 0, bad = 0;
const ok = (name, cond, saw) => { n++; if (!cond) { bad++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)}` : ''}`); } else console.log(`ok    ${name}`); };
const state = (p) => p.evaluate(() => window.__rescue);
await withWood(async (lab) => {
  const p = await lab.open('seed=5');
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  // (a missing file is named, not just counted: the favicon the harness doesn't serve is no error of the page's)
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await p.waitForTimeout(2500);
  let s = await state(p);
  ok('the line-up first', s?.ui === 'lineup', s?.ui);
  await p.click('#boats button[data-boat="3"]');
  await p.click('#levels button[data-level="medium"]');
  await p.waitForTimeout(500);
  s = await state(p);
  ok('a boat chosen (Sunfish), a level (medium)', s.mine === 3 && s.level === 'medium', [s.mine, s.level]);
  await p.click('#go');
  await p.waitForTimeout(300);
  s = await state(p);
  ok('go: the count of three', s.ui === 'race' && (s.phase === 'countdown' || s.phase === 'racing'), [s.ui, s.phase]);
  for (let k = 0; k < 40 && (await state(p)).phase !== 'racing'; k++) await p.waitForTimeout(250);
  s = await state(p);
  ok('and the race is on', s.phase === 'racing', s.phase);
  // (a finger held up and to the left of the screen's middle: the boat goes that way on the screen)
  const me0 = s.boats[3];
  const box = await p.evaluate(() => [innerWidth, innerHeight]);
  await p.mouse.move(box[0] * 0.2, box[1] * 0.3);
  await p.mouse.down();
  await p.waitForTimeout(3500);
  s = await state(p);
  await p.mouse.up();
  const me1 = s.boats[3];
  ok('a finger held: under way', Math.hypot(me1.x - me0.x, me1.z - me0.z) > 6, [me0, me1]);
  ok('a finger up and to the left: the boat goes north and toward +x (the screen\'s left)', me1.z > me0.z && me1.x > me0.x, [me0, me1]);
  // (the right arrow: a turn toward the screen's right, -x)
  const k0 = (await state(p)).boats[3];
  await p.keyboard.down('ArrowRight');
  await p.waitForTimeout(3000);
  await p.keyboard.up('ArrowRight');
  const k1 = (await state(p)).boats[3];
  ok('the right arrow turns it to the screen\'s right', k1.x < k0.x + 1, [k0, k1]);
  const words = await p.evaluate(() => ({ places: document.querySelectorAll('#places .chip').length, me: document.querySelector('#places .chip.me') !== null, count: document.getElementById('count').textContent, track: document.querySelectorAll('#track i').length }));
  ok('the places along the top, yours marked; your count; the five on the track', words.places === 5 && words.me && words.count !== '' && words.track === 5, words);
  ok('no errors', !errors.length, errors.slice(0, 3));
  await p.close();
  // (the end)
  const q = await lab.open('seed=5&view=podium');
  await q.waitForTimeout(2500);
  const end = await q.evaluate(() => ({ ui: window.__rescue.ui, rows: [...document.querySelectorAll('#ranks li')].map((li) => li.querySelector('b').textContent + ' ' + li.querySelector('span').textContent.trim() + ' ' + li.querySelector('strong').textContent), title: document.getElementById('result').textContent }));
  ok('the end: five places, 1st to 5th', end.ui === 'podium' && end.rows.length === 5 && end.rows[0].startsWith('1st') && end.rows[4].startsWith('5th'), end);
  console.log(`  ${end.title} · ${end.rows.join(' · ')}`);
  await q.close();
}, { width: 390, height: 844 });
console.log(`${n - bad} of ${n} checks hold`);
if (bad) process.exit(1);
