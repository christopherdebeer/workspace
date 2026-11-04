// What's inside, read off what's built (node cells/lab/devtools/labyrinth-plans.mjs [--stories=13,16,17,19]
// [--tradition=persian] [--rooms]): each building's floor plan (plans.ts), what it's good for (uses.ts), and where the
// settlement stands on the ladder (ladder.ts): what it can build, what the next rung would take and add, what's built
// ahead of it. `--rooms` lists every room.
import { build } from 'esbuild';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { story } = await load('../client/labyrinth/demo.ts');
const RG = await load('../client/labyrinth/regions.ts');
const LD = await load('../client/labyrinth/ladder.ts');
RG.setRegions(opt.tradition ?? 'mediterranean');
const m2 = (a) => `${Math.round(a)} m²`;
for (const s of String(opt.stories ?? '13,15,16,17,19').split(',').map(Number)) {
  const w = story(s), r = LD.reckon(w), st = r.settlement;
  console.log(`\n━━ story ${s} (${opt.tradition ?? 'mediterranean'}${w.bay === 2 ? ', half grid' : ''}): ${st.buildings.length} buildings, ${st.households} households, ${m2(st.storage)} stored`);
  for (const u of st.buildings) {
    const p = u.plan, b = p.b;
    const exits = Object.entries(p.exits.reduce((t, e) => ({ ...t, [e.to]: (t[e.to] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
    console.log(`  #${b.id} ${b.cols.length} squares × ${p.storeys.length} storeys, ${m2(p.area)}, ${Math.round(p.lit * 100)}% lit · ${p.rooms.length} rooms${p.rooms.some((q) => q.hall) ? ' (a hall)' : ''} · stair ${p.stair ?? 'none'} · ways out: ${exits}${p.court ? ' · on a court' : ''}${p.outdoor.top ? ' · top walked' : ''}${p.outdoor.balconies ? ` · ${p.outdoor.balconies} balconies` : ''}${p.outdoor.loggias ? ` · ${p.outdoor.loggias} loggia bays` : ''}`);
    console.log(`     → ${u.uses.join(', ') || 'nothing yet'}${u.households ? ` (${u.households} households)` : ''}`);
    if (opt.rooms) for (const q of p.rooms) console.log(`       storey ${q.k} room ${q.id}: ${q.long.toFixed(1)}×${q.short.toFixed(1)} m, ${Math.round(q.lit * 100)}% lit, ${q.windows} windows, ${q.doors} doors${q.open.length ? `, opens on ${q.open.join('/')}` : ''}${q.hall ? ', hall' : ''}${q.stair ? ', stair' : ''} · beside ${q.next.join(',') || '—'}`);
  }
  console.log(`  uses: ${Object.entries(st.count).filter(([, n]) => n).map(([u, n]) => `${n} ${u}`).join(', ')}`);
  console.log(`  ladder: rung ${r.rung.n} (${r.rung.name}); knows ${[...r.known].join(', ')}`);
  if (r.next) console.log(`  next: ${r.next.rung.name} wants ${r.next.short.join('; ')}; would add ${r.next.adds.join(', ')}`);
  console.log(`  built ahead of it: ${r.ahead.join(', ') || 'nothing'}`);
}
