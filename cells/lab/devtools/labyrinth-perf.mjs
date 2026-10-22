// Where the labyrinth's frames go, interaction by interaction (node cells/lab/devtools/labyrinth-perf.mjs): the page
// opened in Chromium, a few things done to it as a hand would (left alone, turned, a stroke drawn, a tap, zoomed, a cat
// followed), and for each, perf.ts's account: frame intervals, what each phase and part spent, what was counted, and
// the heavy frames with their causes. Headless Chromium draws in software, so the absolute times are slow; what the
// harness is for is where the time goes, and how that changes as the code does.
//   --q='story=12'   --only=NAME   --json (the whole report per interaction)   --w=390 --h=844
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const { withWood } = await import('./harness.mjs');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=').slice(1).join('=') || true]));
const query = `${opt.q ?? 'story=12'}&zoom=0.5&perf`;

/** each interaction: how it's done, by mouse and the page's own hooks */
const SCENES = [
  ['idle', async () => { /* (left alone: the cats and the frame) */ }],
  ['turn', async (p, L) => { await L((L) => L.setBrush('hand')); await p.mouse.move(195, 300); await p.mouse.down(); for (let q = 1; q <= 10; q++) { await p.mouse.move(195 + q * 14, 300); await p.waitForTimeout(40); } await p.mouse.up(); }],
  ['stroke', async (p, L) => {
    const a = await L((L) => L.screenOf(4, 9, 1)), b = await L((L) => L.screenOf(9, 9, 1));
    await L((L) => L.setBrush('auto'));
    await p.mouse.move(a[0], a[1]); await p.mouse.down();
    for (let q = 1; q <= 12; q++) { await p.mouse.move(a[0] + ((b[0] - a[0]) * q) / 12, a[1] + ((b[1] - a[1]) * q) / 12); await p.waitForTimeout(60); }
    await p.mouse.up();
  }],
  ['tap', async (p, L) => { await L((L) => L.setBrush('auto')); const a = await L((L) => L.screenOf(10, 4, 0)); await p.mouse.click(a[0], a[1]); }],
  ['zoom', async (p) => { await p.mouse.move(195, 400); for (let q = 0; q < 8; q++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(40); } }],
  ['follow', async (p, L) => { const c = (await L((L) => L.cats()))[0]; if (!c) return; await L((L, n) => L.meet(n), c.name); await L((L) => L.follow()); }],
];

await withWood(async (lab) => {
  const p = await lab.open(query);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const L = (f, a) => p.evaluate(([s, a]) => eval(s)(window.__labyrinth, a), [f.toString(), a]);
  await p.waitForTimeout(1500);
  for (const [name, act] of SCENES) {
    if (opt.only && !name.includes(opt.only)) continue;
    await L((L) => L.perfReset());
    await act(p, L);
    await p.waitForTimeout(1500);
    const r = await L((L) => L.perf());
    if (opt.json) { console.log(JSON.stringify({ name, ...r }, null, 1)); continue; }
    const top = Object.entries(r.spans).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([k, v]) => `${k} ${v.total}ms/${v.framesWith}f (max ${v.max})`);
    console.log(`\n${name}: ${r.frames} frames · interval p50 ${r.interval.p50} p95 ${r.interval.p95} max ${r.interval.max} · cpu p95 ${r.cpu.p95}`);
    console.log(`  spent: ${top.join(' · ')}`);
    console.log(`  counted: ${Object.entries(r.counts).filter(([k]) => k !== 'mesh.vertices').map(([k, v]) => `${k} ${v.total}`).join(' · ') || 'nothing'}`);
    console.log(`  heavy: ${Object.entries(r.heavyCauses).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}`);
    for (const h of r.heavy.slice(-3)) console.log(`    ${h.interval} ms — ${h.why}`);
  }
  if (errs.length) console.log('page errors:', errs);
}, { width: Number(opt.w ?? 390), height: Number(opt.h ?? 844) });
