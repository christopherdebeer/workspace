// Markovs Chains: both rule sets under the same bots, with a scorecard — before any cardboard.
//   node cells/lab/devtools/markovs-sim.mjs            (N=200 games per line; N=… to change)
//
// Two games. GRID: the other agent's 5×5 junction race (physical-rules.ts), with variants: four
// corners for 2–4 players, and "bounce" (an open exit lets the roller pick an adjacent card, so
// the counter never stalls). MATS: the four-mat Commission (rules.ts' relative motifs): one
// token everyone steers, a d4, each player either holds a secret ordered commission (X then Y)
// or owns a suit that pays on arrival. Bots: random, and greedy (one placement ahead, judged by a
// short forecast of its own chances). Scorecard: draws, length in rolls, first-player edge,
// skill gap (greedy v random), per player count.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/markovs/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const { key, destination, canPlace, DIRS } = await load('physical-rules.ts');
const { MOTIFS, rng, row } = await load('rules.ts');
const N = Number(process.env.N ?? 200);
const CAP = 30;

// ─── GRID ─────────────────────────────────────────────────────────────────────────────────────
const CORNERS = [[0, 0], [4, 4], [4, 0], [0, 4]];
function gridForecast(board, at, players, hops = 8) {
  let mass = { [at]: 1 }; const wins = Array(players).fill(0);
  const absorb = (k, m) => { const g = board[k]?.goal; if (g !== undefined) { wins[g] += m; return true; } return false; };
  for (let h = 0; h < hops; h++) { const next = {}; for (const [k, m] of Object.entries(mass)) { if (absorb(k, m)) continue; for (let die = 1; die <= 6; die++) { const d = destination(board, k, die).at; next[d] = (next[d] || 0) + m / 6; } } mass = next; }
  for (const [k, m] of Object.entries(mass)) absorb(k, m);
  return { wins, mass };
}
function gridUtility(board, at, me, players) {
  const f = gridForecast(board, at, players);
  let v = f.wins[me] - (f.wins.reduce((a, b) => a + b, 0) - f.wins[me]) / (players - 1);
  const [gx, gy] = CORNERS[me];
  for (const [k, m] of Object.entries(f.mass)) if (board[k]?.goal === undefined) { const [x, y] = k.split(',').map(Number); v -= m * (Math.abs(x - gx) + Math.abs(y - gy)) * 0.025; }
  return v;
}
function gridGreedy(board, hand, at, repairs, me, players) {
  let best = null;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const k = key(x, y); if (!canPlace(board, k, repairs)) continue;
    for (let card = 0; card < hand.length; card++) for (let rotation = 0; rotation < 4; rotation++) {
      const v = gridUtility({ ...board, [k]: { card: hand[card], rotation, start: board[k]?.start } }, at, me, players) - (board[k] ? 0.01 : 0);
      if (!best || v > best.v + 1e-9) best = { k, card, rotation, v };
    } }
  return best;
}
function gridRandom(board, hand, repairs, r) {
  const opts = []; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const k = key(x, y); if (!board[k] && canPlace(board, k, repairs)) opts.push(k); }
  if (!opts.length || !hand.length) return null; return { k: opts[Math.floor(r() * opts.length)], card: Math.floor(r() * hand.length), rotation: Math.floor(r() * 4) };
}
function playGrid(seed, strats, { bounce = false } = {}) {
  const P = strats.length; const r = rng(seed);
  const board = { '2,2': { card: 0, rotation: 0, start: true } }; for (let p = 0; p < P; p++) board[key(...CORNERS[p])] = { goal: p };
  let token = '2,2'; const pile = Array.from({ length: 24 }, (_, i) => i % 8); for (let i = 23; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
  const hands = strats.map(() => pile.splice(0, 3)); const repairs = strats.map(() => 2); let stalls = 0;
  for (let turn = 0; turn < CAP; turn++) {
    const p = turn % P; const s = strats[p];
    const pick = s === 'greedy' ? gridGreedy(board, hands[p], token, repairs[p], p, P) : gridRandom(board, hands[p], repairs[p], r);
    if (pick) { const old = board[pick.k]; if (old) repairs[p]--; board[pick.k] = { card: hands[p][pick.card], rotation: pick.rotation, start: old?.start }; hands[p].splice(pick.card, 1); if (pile.length) hands[p].push(pile.shift()); }
    const res = destination(board, token, 1 + Math.floor(r() * 6)); token = res.at;
    if (res.reason !== 'move') {
      stalls++;
      if (bounce && res.reason === 'open') {
        const [x, y] = token.split(',').map(Number); const near = DIRS.map(([dx, dy]) => key(x + dx, y + dy)).filter((k) => board[k]);
        if (near.length) token = s === 'greedy' ? near.map((k) => [k, board[k].goal === p ? 9 : board[k].goal !== undefined ? -9 : gridUtility(board, k, p, P)]).sort((a, b) => b[1] - a[1])[0][0] : near[Math.floor(r() * near.length)];
      }
    }
    if (board[token]?.goal !== undefined) return { winner: board[token].goal, rolls: turn + 1, stalls };
  }
  return { winner: -1, rolls: CAP, stalls };
}

// ─── MATS ─────────────────────────────────────────────────────────────────────────────────────
/** chance the token, from `at`, arrives at `want` within `hops` rolls (first passage) */
function reach(board, at, want, hops = 3) {
  let dist = [0, 0, 0, 0]; dist[at] = 1; let got = 0;
  for (let h = 0; h < hops; h++) { const next = [0, 0, 0, 0]; for (let s = 0; s < 4; s++) if (dist[s]) row(board[s], s).forEach((p, d) => { const m = dist[s] * p; if (d === want && d !== s) got += m; else next[d] += m; }); dist = next; }
  return got;
}
function matsUtility(board, at, goals, me, pub) {
  let v = reach(board, at, goals[me]);
  if (pub) for (let o = 0; o < goals.length; o++) if (o !== me) v -= reach(board, at, goals[o]) / (goals.length - 1);
  return v;
}
function playMats(seed, strats, { commission = true, pub = false, target = 2 } = {}) {
  const P = strats.length; const r = rng(seed);
  const pile = Array.from({ length: 40 }, (_, i) => i % 8); for (let i = 39; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
  const board = [4, 0, 5, 1]; let token = 0;
  const hands = strats.map(() => pile.splice(0, 3)); const score = strats.map(() => 0);
  // a commission: X then Y (X ≠ Y); or the suit you own (player p owns suit p)
  const draw = (p) => { if (!commission) return [p, p]; const x = Math.floor(r() * 4); let y = Math.floor(r() * 3); if (y >= x) y++; return [x, y]; };
  const com = strats.map((_, p) => draw(p)); const step = strats.map(() => 0);
  const goals = () => com.map((c, p) => c[step[p]]);
  for (let turn = 0; turn < CAP; turn++) {
    const p = turn % P; const s = strats[p]; const g = goals();
    let best = null;
    if (s === 'greedy') { for (let i = 0; i < hands[p].length; i++) for (let m = 0; m < 4; m++) { const nb = [...board]; nb[m] = hands[p][i]; const v = matsUtility(nb, token, g, p, pub); if (!best || v > best.v + 1e-9) best = { i, m, v }; } if (best && best.v <= matsUtility(board, token, g, p, pub) + 1e-9) best = null; }
    else if (hands[p].length) best = { i: Math.floor(r() * hands[p].length), m: Math.floor(r() * 4) };
    if (best) { board[best.m] = hands[p][best.i]; hands[p].splice(best.i, 1); } else if (hands[p].length) hands[p].splice(Math.floor(r() * hands[p].length), 1);
    if (pile.length) hands[p].push(pile.shift());
    // the roll: a d4 on the token's card
    const pr = row(board[token], token); let x = r(), d = 3; for (let k = 0; k < 4; k++) { x -= pr[k]; if (x < 0) { d = k; break; } }
    const arrived = d !== token; token = d;
    if (arrived) for (let q = 0; q < P; q++) {
      if (com[q][step[q]] !== token) continue;
      if (commission) { step[q]++; if (step[q] === 2) { score[q]++; step[q] = 0; com[q] = draw(q); } } else score[q]++;
      if (score[q] >= target) return { winner: q, rolls: turn + 1, stalls: 0 };
    }
  }
  return { winner: -1, rolls: CAP, stalls: 0 };
}

// ─── the scorecard ────────────────────────────────────────────────────────────────────────────
const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
function run(name, play, strats, opts) {
  const rows = []; for (let seed = 1; seed <= N; seed++) rows.push(play(seed, strats, opts));
  const P = strats.length; const wins = Array(P).fill(0); let draws = 0, rolls = 0, stalls = 0;
  for (const x of rows) { if (x.winner < 0) draws++; else wins[x.winner]++; rolls += x.rolls; stalls += x.stalls; }
  const dec = rows.filter((x) => x.winner >= 0).map((x) => x.rolls).sort((a, b) => a - b);
  console.log(`${name.padEnd(34)} ${strats.map((s) => s[0]).join('')}  draw ${pct(draws / N)}  P1 ${pct(wins[0] / N)}${P > 2 ? '' : ` P2 ${pct(wins[1] / N)}`}  fair ${pct((1 - draws / N) / P)}  rolls ${dec.length ? dec[Math.floor(dec.length / 2)] : '-'}  stalls ${pct(stalls / rolls)}`);
  return { wins, draws };
}
const G = (n, s, o) => run(n, playGrid, s, o);
const M = (n, s, o) => run(n, playMats, s, o);
console.log(`${N} games per line · draw = hit the ${CAP}-roll cap · fair = what each player would win if equal · rolls = median of decided games\n`);
console.log('GRID (the other agent\'s race)');
G('as shipped, 2 corners', ['greedy', 'greedy']); G('  skill: greedy v random', ['greedy', 'random']); G('  skill: random v greedy', ['random', 'greedy']);
G('bounce (no stalls), 2', ['greedy', 'greedy'], { bounce: true }); G('  skill', ['greedy', 'random'], { bounce: true });
G('4 corners, 3 players', ['greedy', 'greedy', 'greedy']); G('4 corners, 4 players', ['greedy', 'greedy', 'greedy', 'greedy']); G('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
G('4 corners + bounce, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { bounce: true });
console.log('\nMATS (the four-mat Commission)');
M('secret commissions, 2', ['greedy', 'greedy']); M('  skill', ['greedy', 'random']); M('  skill (random first)', ['random', 'greedy']);
M('secret commissions, 4', ['greedy', 'greedy', 'greedy', 'greedy']); M('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
M('public commissions, 2', ['greedy', 'greedy'], { pub: true }); M('public commissions, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { pub: true });
M('suits pay (own a suit), 2', ['greedy', 'greedy'], { commission: false, target: 3 }); M('suits pay, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3 }); M('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3 });
M('secret, 4, first to 1', ['greedy', 'greedy', 'greedy', 'greedy'], { target: 1 });
