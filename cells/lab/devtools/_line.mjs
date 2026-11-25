import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './ai'; export * from './fencer'; export * from './intent'; export * from './v3';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Bout, EPEE, Opponent, LEVELS, aimAt, idle, add } = M;
const chest = (f) => add(f.capsules[0].b, [0, -0.06, 0]);
// the line bot, and the user's way: line, bend back, re-extend as they advance
// (each sees the opponent as it was a human reaction time ago: 0.22 s)
// (and aims as a thumb does: a few centimetres off, wandering)
let R = 12345; const rnd = () => ((R = (R * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const seen = (st, op) => {
  (st.h ??= []).push({ c: chest(op), adv: op.act?.kind === 'advance' }); if (st.h.length > 15) st.h.shift();
  st.k = (st.k ?? 0) + 1; if (st.k % 30 === 1) st.off = [0, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08];
  const v = st.h[0]; return { ...v, c: add(v.c, st.off) };
};
const bots = {
  line: (me, op, st) => { const v = seen(st, op); return { ...idle(), extend: 1, ...aimAt(me, v.c, 1) }; },
  timed: (me, op, st) => { const v = seen(st, op); st.t = v.adv ? 0 : (st.t ?? 0) + 1 / 60; const out = v.adv || st.t < 0.6 || st.t % 3 > 1.2; return { ...idle(), extend: out ? 1 : 0.2, ...aimAt(me, v.c, out ? 1 : 0.2) }; },
};
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const [name, bot] of Object.entries(bots)) for (const L of LEVELS) { if (only && !only.includes(L.name)) continue;
  let b0 = [], won = 0, single = [0, 0], dbl = 0, tact = {}, fat = 0, n = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const b = new Bout({ weapon: EPEE, to: 5, seed }), them = new Opponent(b, 1, L.style, seed), st = {};
    for (let i = 0; i < 60 * 260 && b.phase !== 'over'; i++) {
      b.fencers[0].intent = bot(b.fencers[0], b.fencers[1], st); b.fencers[1].intent = { ...them.intent(1 / 60) };
      b.advance(1 / 60); fat += b.fencers[0].fatigue; n++;
      for (const e of b.drain()) {
        if (e.type === 'light') { const k = (e.who ? 'T:' : 'Y:') + them.tactic; tact[k] = (tact[k] ?? 0) + 1; }
        if (e.type === 'halt') { const [a, c] = e.points; if (e.call.startsWith('coup double')) dbl++; else if (a) single[0]++; else if (c) single[1]++; }
      }
    }
    if (b.score[0] > b.score[1]) won++; b0.push(b.score.join('-'));
  }
  console.log(name.padEnd(6), L.name.padEnd(11), `won ${won}/5 (${b0})  singles you ${single[0]} them ${single[1]}  doubles ${dbl}  mean fatigue ${(fat / n).toFixed(2)}`, JSON.stringify(tact));
}
