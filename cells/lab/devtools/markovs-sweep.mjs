// Markovs Chains: the transition sweep. Rewrites the suits' die faces (deck.ts SHAPES) along
// four axes and plays the poker game (build then race, wrap + rim) under the sim's bots.
//   node cells/lab/devtools/markovs-sweep.mjs            (N=120 games per line; N=… to change)
//   AXIS=stay|lean|back|contrast|suit  node …             (one axis only; AXIS=none: the head line)
//   KINGS=corners node …                                  (Kings in the corners, not the edge middles)
// Axes (d in -2..+2 faces, applied to every junction of every suit unless noted):
//   stay      d more stay faces, taken from (or given to) the card's biggest outward exit
//   lean      d more faces on the biggest exit, taken from the smallest other outward exits
//   back      d more faces on the back exit (south, before turning), from the biggest exit
//   contrast  the temperaments pulled apart (+) or together (−): stays and leans scaled per suit
//   suit      one suit at a time: its stays ± d (which suit's brake matters?)
// Scorecard per line: draw = hit the 30-roll cap · rolls = median of decided games · P1 = first
// player's share · skill = greedy's share minus random's in a 1-random/3-greedy table · stalls =
// rolls that didn't move · lead = forecast lead changes per game · held = the halfway leader won ·
// off = decided by someone else's roll · stay = mean stay faces per junction after the rewrite.
process.env.LIB = '1';
const { pokerPlay, D } = await import('./markovs-sim.mjs');
const N = Number(process.env.N ?? 120);
const WR = { ...D.RULES, wrap: true, rim: true };
if (process.env.KINGS === 'corners') [D.key(0, 0), D.key(4, 0), D.key(4, 4), D.key(0, 4)].forEach((k, i) => (D.KING_AT[i] = k));
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10];
const BASE = Object.fromEntries(RANKS.map((r) => [r, D.SHAPES[r].faces.map((f) => [...f])]));
const reset = () => { for (const r of RANKS) D.SHAPES[r].faces = BASE[r].map((f) => [...f]); };
const big = (f) => { let b = 0; for (let i = 1; i < 4; i++) if (f[i] > f[b]) b = i; return b; };
const small = (f, not) => { let s = -1; for (let i = 0; i < 4; i++) if (i !== not && f[i] > 0 && (s < 0 || f[i] < f[s])) s = i; return s; };
const move = (f, from, to, n) => { const k = Math.min(n, f[from]); f[from] -= k; f[to] += k; };
const edit = (fn, suits = [0, 1, 2, 3]) => { reset(); for (const r of RANKS) for (const su of suits) fn(D.SHAPES[r].faces[su], su, r); };
const AX = {
  stay: (d) => edit((f) => (d > 0 ? move(f, big(f), 4, d) : move(f, 4, big(f), -d))),
  lean: (d) => edit((f) => { for (let i = 0; i < Math.abs(d); i++) { const b = big(f), s = small(f, b); if (s < 0) break; if (d > 0) move(f, s, b, 1); else move(f, b, s, 1); } }),
  back: (d) => edit((f) => (d > 0 ? move(f, big(f), 2, d) : move(f, 2, big(f), -d))),
  contrast: (d) => edit((f, su) => { // hearts lean harder / spades hold longer (+), or all toward the mirror (−)
    const n = Math.abs(d); if (su === 0) { if (d > 0) for (let i = 0; i < n; i++) { const s = small(f, big(f)); if (s >= 0) move(f, s, big(f), 1); } else move(f, big(f), 4, n); }
    if (su === 3) { if (d > 0) move(f, big(f), 4, n); else move(f, 4, big(f), n); }
    if (su === 2) { if (d > 0) { const s = small(f, big(f)); if (s >= 0 && f[s] >= 2) move(f, s, 4, Math.min(1, n)); } }
  }),
};
const meanStay = () => { let s = 0, n = 0; for (const r of RANKS) for (const f of D.SHAPES[r].faces) { s += f[4]; n++; } return s / n; };
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
function card(name) {
  const g4 = []; for (let seed = 1; seed <= N; seed++) g4.push(pokerPlay(seed, ['greedy', 'greedy', 'greedy', 'greedy'], { rules: WR }));
  const sk = []; for (let seed = 1; seed <= N; seed++) sk.push(pokerPlay(seed, ['random', 'greedy', 'greedy', 'greedy'], { rules: WR }));
  const dec = g4.filter((x) => x.winner >= 0); const rolls = dec.map((x) => x.rolls).sort((a, b) => a - b);
  const draws = (N - dec.length) / N, p1 = dec.filter((x) => x.winner === 0).length / N;
  const skd = sk.filter((x) => x.winner >= 0); const skill = (skd.filter((x) => x.winner > 0).length / 3 - skd.filter((x) => x.winner === 0).length) / N;
  const stalls = g4.reduce((a, x) => a + x.stalls, 0) / g4.reduce((a, x) => a + x.rolls, 0);
  const lead = g4.reduce((a, x) => a + x.extra.leadChanges, 0) / N; const held = dec.length ? dec.reduce((a, x) => a + x.extra.heldLead, 0) / dec.length : 0; const off = dec.length ? dec.reduce((a, x) => a + x.extra.offTurn, 0) / dec.length : 0;
  console.log(`${name.padEnd(22)} draw ${pct(draws)}  rolls ${String(rolls.length ? rolls[rolls.length >> 1] : '-').padStart(2)}  P1 ${pct(p1)}  skill ${(skill * 100).toFixed(0).padStart(3)}pt  stalls ${pct(stalls)}  lead ${lead.toFixed(1)}  held ${pct(held)}  off ${pct(off)}  stay ${meanStay().toFixed(2)}`);
}
console.log(`${N} games per line (4 greedy; skill line 1 random + 3 greedy) · wrap + rim · build then race\n`);
reset(); card(process.env.KINGS === 'corners' ? 'head, corner Kings' : 'head (as printed)');
const only = process.env.AXIS;
for (const ax of Object.keys(AX)) { if (only && only !== ax) continue; console.log(`\n${ax}`); for (const d of [-2, -1, 1, 2]) { AX[ax](d); card(`  ${ax} ${d > 0 ? '+' : ''}${d}`); } }
if (only === 'none') process.exit(0);
if (!only || only === 'suit') { console.log('\nsuit (its stays ± 1)'); for (let su = 0; su < 4; su++) for (const d of [-1, 1]) { edit((f) => (d > 0 ? move(f, big(f), 4, 1) : move(f, 4, big(f), 1)), [su]); card(`  ${D.SUIT_NAMES[su]} stay ${d > 0 ? '+' : ''}${d}`); } }
reset();
