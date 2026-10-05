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
const D = await load('deck.ts');
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
function playMats(seed, strats, { commission = true, pub = false, target = 2, steps = 2, start = 0, suits = 1 } = {}) {
  const P = strats.length; const r = rng(seed);
  const pile = Array.from({ length: 40 }, (_, i) => i % 8); for (let i = 39; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
  const board = [4, 0, 5, 1]; let token = start < 0 ? Math.floor(r() * 4) : start;
  const hands = strats.map(() => pile.splice(0, 3)); const score = strats.map(() => 0);
  // a commission: X then Y (X ≠ Y); or the suit you own (player p owns suit p)
  // (owning: suit p, or with `suits` 2 each at 2 players, p and p+2 — opposite mats)
  const draw = (p) => { if (!commission) return suits === 2 ? [p, p + 2] : [p, p]; const c = [Math.floor(r() * 4)]; while (c.length < steps) { const y = Math.floor(r() * 4); if (y !== c[c.length - 1]) c.push(y); } return c; };
  const com = strats.map((_, p) => draw(p)); const step = strats.map(() => 0);
  const goals = () => com.map((c, p) => (commission ? c[step[p]] : c[0]));
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
      if (commission ? com[q][step[q]] !== token : !com[q].includes(token)) continue;
      if (commission) { step[q]++; if (step[q] === steps) { score[q]++; step[q] = 0; com[q] = draw(q); } } else score[q]++;
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
  const played = rows[0].played !== undefined ? `  specials/game ${(rows.reduce((a, x) => a + x.played, 0) / N).toFixed(1)}` : '';
  const extra = rows[0].extra ? '  ' + Object.keys(rows[0].extra).map((k) => `${k} ${pct(rows.reduce((a, x) => a + x.extra[k], 0) / N)}`).join(' ') : '';
  console.log(`${name.padEnd(34)} ${strats.map((s) => (s === 'reader' ? 'R' : s[0])).join('')}  draw ${pct(draws / N)}  P1 ${pct(wins[0] / N)}${P > 2 ? '' : ` P2 ${pct(wins[1] / N)}`}  fair ${pct((1 - draws / N) / P)}  rolls ${dec.length ? dec[Math.floor(dec.length / 2)] : '-'}  stalls ${pct(stalls / rolls)}${played}${extra}`);
  return { wins, draws };
}
const G = (n, s, o) => run(n, playGrid, s, o);
const M = (n, s, o) => run(n, playMats, s, o);
console.log(`${N} games per line · draw = hit the ${CAP}-roll cap · fair = what each player would win if equal · rolls = median of decided games\n`);
if (!process.env.ROUND2) {
console.log('GRID (the other agent\'s race)');
G('as shipped, 2 corners', ['greedy', 'greedy']); G('  skill: greedy v random', ['greedy', 'random']); G('  skill: random v greedy', ['random', 'greedy']);
G('bounce (no stalls), 2', ['greedy', 'greedy'], { bounce: true }); G('  skill', ['greedy', 'random'], { bounce: true });
G('4 corners, 3 players', ['greedy', 'greedy', 'greedy']); G('4 corners, 4 players', ['greedy', 'greedy', 'greedy', 'greedy']); G('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
G('4 corners + bounce, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { bounce: true });
}
if (!process.env.ROUND2) {
console.log('\nMATS (the four-mat Commission)');
M('secret commissions, 2', ['greedy', 'greedy']); M('  skill', ['greedy', 'random']); M('  skill (random first)', ['random', 'greedy']);
M('secret commissions, 4', ['greedy', 'greedy', 'greedy', 'greedy']); M('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
M('public commissions, 2', ['greedy', 'greedy'], { pub: true }); M('public commissions, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { pub: true });
M('suits pay (own a suit), 2', ['greedy', 'greedy'], { commission: false, target: 3 }); M('suits pay, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3 }); M('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3 });
M('secret, 4, first to 1', ['greedy', 'greedy', 'greedy', 'greedy'], { target: 1 });
}


// ─── HYBRID: grid + secret targets; build the whole board first, then race ──────────────────────
// Four target cards (one per suit) on the board — corners, or the middles of the edges. Each
// player is dealt one suit in secret (at 2–3 players the rest are decoys). Phase 1: in turns,
// place junction cards (on top of existing ones too) until every space is covered; no rolling.
// Phase 2: each turn place one card (optional, on top) then roll a d6. First arrival at your own
// target wins. Someone else's target is just a card the token passes over.
const EDGES = [[2, 0], [4, 2], [2, 4], [0, 2]];
function hybridUtility(board, at, me, P) {
  const f = gridForecast(board, at, 4);
  // (secret: everyone else's suit is a possible target — don't feed any of them)
  let v = f.wins[me] - (f.wins.reduce((a, b) => a + b, 0) - f.wins[me]) / 3;
  const [gx, gy] = (board.__spots)[me];
  for (const [k, m] of Object.entries(f.mass)) if (board[k]?.goal === undefined) { const [x, y] = k.split(',').map(Number); v -= m * (Math.abs(x - gx) + Math.abs(y - gy)) * 0.025; }
  return v;
}
function hybridGreedy(board, hand, at, me, P, cover) {
  let best = null;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const k = key(x, y); if (board[k]?.goal !== undefined) continue; if (board[k] && !cover) continue; if (!board[k] && !canPlace(board, k, 0)) continue;
    for (let card = 0; card < hand.length; card++) for (let rotation = 0; rotation < 4; rotation++) {
      const v = hybridUtility({ ...board, __spots: board.__spots, [k]: { card: hand[card], rotation, start: board[k]?.start } }, at, me, P) - (board[k] ? 0.01 : 0);
      if (!best || v > best.v + 1e-9) best = { k, card, rotation, v };
    } }
  return best;
}
function playHybrid(seed, strats, { edges = false, cover = true } = {}) {
  const P = strats.length; const r = rng(seed); const spots = edges ? EDGES : CORNERS;
  const board = { '2,2': { card: 0, rotation: 0, start: true } }; spots.forEach(([x, y], g) => (board[key(x, y)] = { goal: g }));
  board.__spots = spots;
  // (secret suits: a permutation of the four, one each)
  const suits = [0, 1, 2, 3]; for (let i = 3; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [suits[i], suits[j]] = [suits[j], suits[i]]; }
  const mine = strats.map((_, p) => suits[p]);
  const pile = Array.from({ length: 48 }, (_, i) => i % 8); for (let i = 47; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
  const hands = strats.map(() => pile.splice(0, 3));
  let token = '2,2'; let turn = 0; let stalls = 0;
  const empty = () => { for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (!board[key(x, y)]) return true; return false; };
  const place = (p, allowCover) => {
    const s = strats[p]; let pick = null;
    if (s === 'greedy') pick = hybridGreedy(board, hands[p], token, mine[p], P, allowCover);
    else { const opts = []; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const k = key(x, y); if (board[k]?.goal !== undefined) continue; if (board[k] ? allowCover : canPlace(board, k, 0)) opts.push(k); } if (opts.length && hands[p].length) pick = { k: opts[Math.floor(r() * opts.length)], card: Math.floor(r() * hands[p].length), rotation: Math.floor(r() * 4) }; }
    if (pick) { board[pick.k] = { card: hands[p][pick.card], rotation: pick.rotation, start: board[pick.k]?.start }; hands[p].splice(pick.card, 1); }
    if (pile.length && hands[p].length < 3) hands[p].push(pile.shift());
  };
  // phase 1: cover the board (empties first; covering allowed once nothing's empty)
  for (let i = 0; i < 60 && empty(); i++) place(i % P, false);
  // phase 2: place, roll
  for (let roll = 0; roll < CAP; roll++) {
    const p = (turn++) % P; place(p, cover);
    const res = destination(board, token, 1 + Math.floor(r() * 6)); token = res.at; if (res.reason !== 'move') stalls++;
    const g = board[token]?.goal; if (g !== undefined) { const who = mine.indexOf(g); if (who >= 0) return { winner: who, rolls: roll + 1, stalls }; }
  }
  return { winner: -1, rolls: CAP, stalls };
}

// ─── POKER: the game on a standard deck (deck.ts) ──────────────────────────────────────────────
// Bots: random (lays a card somewhere legal, never plays a special); greedy (one action ahead,
// its own King's chances minus the average of the other three); reader (greedy, but weighs the
// other Kings by what each opponent's placements have been helping — a guess at their suit).
// The Twos are the commissions (shuffled, one each, the rest out of play). `coverUnder: false`
// is the variant where the card under the counter may not be covered. Each game also reports
// how much of the race rewrote the build: `under` = race lays that covered the counter's own
// card, of all race lays; `onBuilt` = moves that landed on a card laid in the build and never
// covered, of all moves.
function pokerPlay(seed, strats, { rules = D.RULES, hand = 3, specials = true } = {}) {
  const P = strats.length; const r = rng(seed); const board = D.setup();
  const twos = D.shuffle(D.pack().filter((c) => c.rank === D.COMMISSION), r); const mine = strats.map((_, p) => twos[p].suit);
  let pile = D.shuffle(D.pack().filter((c) => c.rank !== D.KING && c.rank !== D.COMMISSION && !(c.rank === D.ACE && c.suit === 3)), r);
  if (!specials) pile = pile.filter((c) => c.rank >= 2 && c.rank <= 10);
  const hands = strats.map(() => pile.splice(0, hand));
  const beliefs = strats.map(() => strats.map(() => [0.25, 0.25, 0.25, 0.25]));
  let token = '2,2', stalls = 0, played = 0; const laid = []; let raceLays = 0, under = 0, moves = 0, onBuilt = 0;
  const value = (b, at, p, tok = token) => {
    const f = D.forecast(b, tok, rules, 4, mine[p], P); let v = f.wins[mine[p]];
    for (let o = 0; o < P; o++) { if (o === p) continue; const w = strats[p] === 'reader' ? beliefs[p][o] : [0.25, 0.25, 0.25, 0.25]; for (let su = 0; su < 4; su++) if (su !== mine[p]) v -= (f.wins[su] * w[su]) / (P - 1) / (strats[p] === 'reader' ? 1 : 0.75); }
    const [gx, gy] = D.xy(D.KING_AT[mine[p]]);
    for (const [k, m] of f.mass) v -= m * D.distance(k, D.KING_AT[mine[p]], rules) * 0.02;
    return v;
  };
  const lay = (b, k, card, rotation) => { const nb = new Map(b); nb.set(k, { card, rotation, start: b.get(k)?.start }); return nb; };
  const placements = (p, phase) => {
    const out = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const k = D.key(x, y); for (let i = 0; i < hands[p].length; i++) { const c = hands[p][i]; if (!D.canPlace(board, k, c, rules, phase, token)) continue; for (let rot = 0; rot < 4; rot++) out.push({ k, i, rot }); } }
    return out;
  };
  const noteWatch = (p, before, after) => { // the others read what a placement helped
    const a = D.forecast(after, token, rules).wins, b = D.forecast(before, token, rules).wins;
    for (let o = 0; o < P; o++) { if (o === p || strats[o] !== 'reader') continue; const bl = beliefs[o][p]; let z = 0; for (let su = 0; su < 4; su++) { bl[su] *= Math.exp(6 * (a[su] - b[su])); z += bl[su]; } for (let su = 0; su < 4; su++) bl[su] /= z; }
  };
  const act = (p, phase) => {
    const s = strats[p]; const opts = placements(p, phase);
    let best = null;
    if (s === 'random') { if (opts.length) best = { ...opts[Math.floor(r() * opts.length)], kind: 'lay' }; }
    else {
      for (const o of opts) { const v = value(lay(board, o.k, hands[p][o.i], o.rot), token, p) - (board.has(o.k) ? 0.01 : 0); if (!best || v > best.v + 1e-9) best = { ...o, v, kind: 'lay' }; }
      // a queen: swap two junctions
      const qi = hands[p].findIndex((c) => c.rank === D.QUEEN);
      if (qi >= 0 && phase === 'race') { const ks = [...board.keys()].filter((k) => !D.isKing(board.get(k))); for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) { const nb = new Map(board); const ta = board.get(ks[a]), tb = board.get(ks[b]); nb.set(ks[a], { ...tb, start: ta.start }); nb.set(ks[b], { ...ta, start: tb.start }); const v = value(nb, token, p); if (!best || v > best.v + 1e-9) best = { kind: 'swap', a: ks[a], b: ks[b], i: qi, v }; } }
    }
    if (!best) { if (hands[p].length && phase === 'race') hands[p].splice(Math.floor(r() * hands[p].length), 1); }
    else if (best.kind === 'lay') { laid.push([p, hands[p][best.i].suit, hands[p][best.i].rank]); if (phase === 'race') { raceLays++; if (best.k === token) under++; } const before = board; board.set(best.k, { card: hands[p][best.i], rotation: best.rot, start: board.get(best.k)?.start, built: phase === 'build' }); noteWatch(p, before === board ? lay(before, best.k, { suit: 0, rank: 2 }, 0) : before, board); hands[p].splice(best.i, 1); }
    else { const ta = board.get(best.a), tb = board.get(best.b); board.set(best.a, { ...tb, start: ta.start }); board.set(best.b, { ...ta, start: tb.start }); hands[p].splice(best.i, 1); played++; }
    while (pile.length && hands[p].length < hand) hands[p].push(pile.shift());
  };
  // phase 1: build until nothing's empty
  for (let i = 0; i < 80 && D.hasEmpty(board); i++) {
    const p = i % P; const before = new Map(board); act(p, 'build');
    // (readers note what the placement did — comparing the boards before and after)
    for (const o of strats.keys()) if (o !== p && strats[o] === 'reader') { const a = D.forecast(board, token, rules).wins, b = D.forecast(before, token, rules).wins; const bl = beliefs[o][p]; let z = 0; for (let su = 0; su < 4; su++) { bl[su] *= Math.exp(6 * (a[su] - b[su])); z += bl[su]; } for (let su = 0; su < 4; su++) bl[su] /= z; }
  }
  // phase 2: place or play, then roll (or a jack / a joker instead of the roll)
  for (let roll = 0; roll < CAP; roll++) {
    const p = roll % P; const s = strats[p]; const before = new Map(board); act(p, 'race');
    for (const o of strats.keys()) if (o !== p && strats[o] === 'reader') { const a = D.forecast(board, token, rules).wins, b = D.forecast(before, token, rules).wins; const bl = beliefs[o][p]; let z = 0; for (let su = 0; su < 4; su++) { bl[su] *= Math.exp(6 * (a[su] - b[su])); z += bl[su]; } for (let su = 0; su < 4; su++) bl[su] /= z; }
    let moved = false;
    if (s !== 'random') {
      const ji = hands[p].findIndex((c) => c.rank === D.JACK), ki = hands[p].findIndex((c) => c.rank === D.JOKER);
      const base = (() => { let v = 0; for (let f = 1; f <= 6; f++) v += value(board, token, p, D.destination(board, token, f, rules).at) / 6; return v; })();
      if (ji >= 0) { let bd = null; for (let d = 0; d < 4; d++) { const n = D.neighbour(token, d, rules); if (!n || !board.has(n)) continue; const v = value(board, token, p, n); if (!bd || v > bd.v) bd = { n, v }; } if (bd && bd.v > base + 0.08) { token = bd.n; hands[p].splice(ji, 1); played++; moved = true; } }
      if (!moved && ki >= 0) { const dests = D.chaosExits(board, token, rules); if (dests.length) { const v = dests.reduce((a, n) => a + value(board, token, p, n), 0) / dests.length; if (v > base + 0.08) { token = dests[Math.floor(r() * dests.length)]; hands[p].splice(ki, 1); played++; moved = true; } } }
      while (pile.length && hands[p].length < hand) hands[p].push(pile.shift());
    }
    if (!moved) { const res = D.destination(board, token, 1 + Math.floor(r() * 6), rules); token = res.at; if (res.reason !== 'move') stalls++; }
    moves++; const t = board.get(token); if (t?.built) onBuilt++;
    const extra = { under: raceLays ? under / raceLays : 0, onBuilt: onBuilt / moves };
    if (D.isKing(t)) { const who = mine.indexOf(t.card.suit); if (who >= 0) return { winner: who, rolls: roll + 1, stalls, played, laid, extra }; }
    if (D.isKing(t)) token = D.START; // (a decoy: back to the start)
  }
  return { winner: -1, rolls: CAP, stalls, played, laid, extra: { under: raceLays ? under / raceLays : 0, onBuilt: onBuilt / moves } };
}
if (process.env.CARDS) {
  // which junctions get laid, and whether laying them wins: the quiet and the busy cards
  const n = Number(process.env.N ?? 200); const use = new Map(); const win = new Map();
  for (let seed = 1; seed <= n; seed++) { const g = pokerPlay(seed, ['greedy', 'greedy', 'greedy', 'greedy'], { rules: { ...D.RULES, wrap: true, rim: true } }); for (const [p, su, rk] of g.laid) { const k = `${rk}${D.SUITS[su]}`; use.set(k, (use.get(k) ?? 0) + 1); if (g.winner === p) win.set(k, (win.get(k) ?? 0) + 1); } }
  const rows = [...use.entries()].map(([k, u]) => [k, u, (win.get(k) ?? 0) / u]).sort((a, b) => a[1] - b[1]);
  console.log('laid per game (32 junctions in play; the Twos are the commissions):'); console.log(rows.map(([k, u, w]) => `${k.padEnd(4)} ${(u / n).toFixed(2)} laid/game, wins ${(w * 100).toFixed(0)}%`).join('\n'));
}
if (process.env.POKER) {
  const K = (n, s, o) => run(n, pokerPlay, s, o);
  const W = { ...D.RULES, wrap: true }, R = { ...D.RULES, rim: true }, WR = { ...D.RULES, wrap: true, rim: true };
  console.log('\nPOKER DECK (deck.ts; Kings on the edge middles, build then race)');
  K('base, 2', ['greedy', 'greedy']); K('base, 4', ['greedy', 'greedy', 'greedy', 'greedy']); K('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
  K('wrap, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: W }); K('rim placement, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: R });
  K('wrap + rim, 2', ['greedy', 'greedy'], { rules: WR }); K('wrap + rim, 3', ['greedy', 'greedy', 'greedy'], { rules: WR }); K('wrap + rim, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: WR }); K('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy'], { rules: WR });
  K('wrap + rim, 4, hand of 4', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: WR, hand: 4 });
  K('wrap + rim, 4, no specials', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: WR, specials: false });
  K('reader v 3 greedy (wrap+rim)', ['reader', 'greedy', 'greedy', 'greedy'], { rules: WR }); K('reader v greedy, 2 (wrap+rim)', ['reader', 'greedy'], { rules: WR }); K('greedy v reader, 2 (wrap+rim)', ['greedy', 'reader'], { rules: WR });
  // does building matter? the variant: the card under the counter may not be covered
  const NU = { ...WR, coverUnder: false };
  console.log('\nthe variant: not the card under the counter (under = race lays on the counter\'s card; onBuilt = moves landing on an uncovered build card)');
  K('wrap + rim, 2, no cover under', ['greedy', 'greedy'], { rules: NU }); K('wrap + rim, 3, no cover under', ['greedy', 'greedy', 'greedy'], { rules: NU }); K('wrap + rim, 4, no cover under', ['greedy', 'greedy', 'greedy', 'greedy'], { rules: NU }); K('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy'], { rules: NU });
}

if (process.env.HYBRID) {
  const H = (n, s, o) => run(n, playHybrid, s, o);
  console.log('\nHYBRID (secret targets, build then race)');
  H('corners, 2', ['greedy', 'greedy']); H('  skill', ['greedy', 'random']); H('  skill (random first)', ['random', 'greedy']);
  H('corners, 3', ['greedy', 'greedy', 'greedy']); H('corners, 4', ['greedy', 'greedy', 'greedy', 'greedy']); H('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy']);
  H('edge-middles, 2', ['greedy', 'greedy'], { edges: true }); H('edge-middles, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { edges: true }); H('  skill, 4 (one random)', ['random', 'greedy', 'greedy', 'greedy'], { edges: true });
  H('corners, 4, no covering in race', ['greedy', 'greedy', 'greedy', 'greedy'], { cover: false });
}

if (process.env.ROUND2) {
  console.log('\nMATS round 2');
  M('suits pay, 2, random start', ['greedy', 'greedy'], { commission: false, target: 3, start: -1 });
  M('suits pay, 2, two suits each', ['greedy', 'greedy'], { commission: false, target: 3, suits: 2, start: -1 });
  M('  skill', ['greedy', 'random'], { commission: false, target: 3, suits: 2, start: -1 });
  M('suits pay, 4, random start', ['greedy', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3, start: -1 });
  M('  skill (one random)', ['random', 'greedy', 'greedy', 'greedy'], { commission: false, target: 3, start: -1 });
  M('suits pay, 3, random start', ['greedy', 'greedy', 'greedy'], { commission: false, target: 3, start: -1 });
  M('secret 3-step commissions, 2', ['greedy', 'greedy'], { steps: 3, target: 1 });
  M('  skill', ['greedy', 'random'], { steps: 3, target: 1 });
  M('secret 3-step, 4', ['greedy', 'greedy', 'greedy', 'greedy'], { steps: 3, target: 1 });
  M('  skill (one random)', ['random', 'greedy', 'greedy', 'greedy'], { steps: 3, target: 1 });
}
