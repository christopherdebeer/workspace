/**
 * The table, on a phone: Markovs Chains on a poker deck, two to four at one screen (pass it
 * round; a curtain hides the hand between turns) or against bots. Everything the page does goes
 * through table.ts' `legal()` and `act()`, so what you can tap is exactly what the rules allow.
 */
import { ACE, DESIGNS, JACK, JOKER, KING, KING_AT, QUEEN, SIZE, SUITS, SUIT_NAMES, cardName, exits, isKing, key, neighbour, pack, roleOf, type Card, type Rules, type Tile } from './deck';
import { ROLL_CAP, act, botAction, clone, current, legal, newGame, type Action, type Game } from './table';

const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const COL = ['#ca4438', '#d6ad35', '#4e8164', '#3c559f'];
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// ─── a card, as drawn: poker corners, the junction in the middle, its name and note ────────────
/** the die faces that take each exit, as printed ("1–3") */
function ranges(t: Tile): Map<number, string> {
  const by = new Map<number, number[]>();
  exits(t).forEach((d, i) => by.set(d, [...(by.get(d) ?? []), i + 1]));
  const out = new Map<number, string>();
  for (const [d, fs] of by) out.set(d, fs.length > 1 && fs.every((f, i) => !i || f === fs[i - 1] + 1) ? `${fs[0]}–${fs[fs.length - 1]}` : fs.join(','));
  return out;
}
export function cardSvg(card: Card, rotation = 0, id = 'c'): string {
  const col = card.rank === JOKER ? '#24231f' : COL[card.suit];
  const suit = card.rank === JOKER ? '★' : SUITS[card.suit];
  const rank = card.rank === JOKER ? 'JOKER' : RANK[card.rank];
  const role = roleOf(card);
  const note = card.rank === JOKER ? 'A random exit. No dice.' : card.rank === ACE ? 'Lay anywhere. A cross.' : card.rank === JACK ? 'Walk one step your way.' : card.rank === QUEEN ? 'Exchange two junctions.' : card.rank === KING ? 'Reach this suit to finish.' : DESIGNS[card.rank - 2].note;
  let mid = '';
  const cx = 31.5, cy = 42;
  const arrow = `<marker id="${id}a" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 0L4 2L0 4" fill="#34312c"/></marker>`;
  if (card.rank === KING) mid = `<circle cx="${cx}" cy="${cy}" r="19" fill="none" stroke="${col}" stroke-width=".4" stroke-dasharray="1 1.5"/><circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${col}" stroke-width=".4"/><circle cx="${cx}" cy="${cy}" r="11" fill="${col}"/><text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#fff" font-size="14">${suit}</text>`;
  else if (card.rank === JACK) mid = `<path d="M${cx - 16} ${cy + 4}Q${cx} ${cy - 22} ${cx + 16} ${cy + 4}" fill="none" stroke="#34312c" stroke-width=".9" stroke-dasharray="2 1.5" marker-end="url(#${id}a)"/><path d="M${cx - 16} ${cy + 6}H${cx + 14}" stroke="#34312c" stroke-width=".9" marker-end="url(#${id}a)"/><circle cx="${cx - 16}" cy="${cy + 5}" r="3.5" fill="${col}"/><circle cx="${cx + 17}" cy="${cy + 5}" r="3.5" fill="${col}"/>`;
  else if (card.rank === QUEEN) mid = `<path d="M${cx - 13} ${cy - 11}L${cx + 11} ${cy + 9}" stroke="#34312c" stroke-width=".9" marker-end="url(#${id}a)"/><path d="M${cx + 13} ${cy - 11}L${cx - 11} ${cy + 9}" stroke="#34312c" stroke-width=".9" marker-end="url(#${id}a)"/><circle cx="${cx - 14}" cy="${cy - 12}" r="3.5" fill="${col}"/><circle cx="${cx + 14}" cy="${cy - 12}" r="3.5" fill="${col}"/><circle cx="${cx - 14}" cy="${cy + 12}" r="3.5" fill="${col}"/><circle cx="${cx + 14}" cy="${cy + 12}" r="3.5" fill="${col}"/>`;
  else if (card.rank === JOKER) mid = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${cx} ${cy}L${cx + Math.cos((a * Math.PI) / 180) * 17} ${cy + Math.sin((a * Math.PI) / 180) * 17}" stroke="#34312c" stroke-width=".7" stroke-dasharray="1.5 1" marker-end="url(#${id}a)"/>`).join('') + `<circle cx="${cx}" cy="${cy}" r="4" fill="#eee8d3" stroke="#50452f" stroke-width=".6"/>`;
  else {
    const t: Tile = { card, rotation: 0 };
    const rg = ranges(t);
    const pts = [[cx, cy - 20], [cx + 20, cy], [cx, cy + 20], [cx - 20, cy]];
    const lab = [[cx + 6, cy - 13], [cx + 12, cy - 4], [cx + 6, cy + 15], [cx - 12, cy - 4]];
    for (let d = 0; d < 4; d++) {
      const [x, y] = pts[d];
      const dotted = card.rank === ACE;
      mid += `<circle cx="${x}" cy="${y}" r="${dotted ? 3.5 : 1.3}" fill="${dotted ? 'none' : '#f9f6ea'}" stroke="#8e826b" stroke-width=".5" ${dotted ? 'stroke-dasharray="1 1"' : ''}/>`;
      if (rg.has(d) || dotted) mid += `<path d="M${cx} ${cy}L${cx + (x - cx) * 0.82} ${cy + (y - cy) * 0.82}" stroke="#34312c" stroke-width="1" ${dotted ? 'stroke-dasharray="1.5 1"' : ''} marker-end="url(#${id}a)"/>` + (rg.has(d) ? `<text x="${lab[d][0]}" y="${lab[d][1]}" text-anchor="middle" font-size="4.6" font-family="ui-monospace,monospace" fill="#27379b">${rg.get(d)}</text>` : '');
    }
    if (rg.has(-1)) mid += `<path d="M${cx - 4} ${cy - 3}C${cx - 24} ${cy - 22} ${cx - 24} ${cy + 14} ${cx - 5} ${cy + 3}" fill="none" stroke="#34312c" stroke-width=".9" stroke-dasharray="1.5 1.2" marker-end="url(#${id}a)"/><text x="${cx - 17}" y="${cy + 10}" font-size="4.6" font-family="ui-monospace,monospace" fill="#27379b">${rg.get(-1)}</text>`;
    mid += `<circle cx="${cx}" cy="${cy}" r="4" fill="#eee8d3" stroke="#50452f" stroke-width=".6"/>`;
  }
  const corner = (x: number, y: number, flip: boolean) => `<g ${flip ? `transform="rotate(180 ${x} ${y})"` : ''}><text x="${x}" y="${y}" font-size="${card.rank === JOKER ? 4 : 8}" font-family="Georgia" fill="${col}">${rank}</text><text x="${x}" y="${y + 7}" font-size="6" fill="${col}">${suit}</text></g>`;
  return `<svg viewBox="0 0 63 88" aria-hidden="true"><defs>${arrow}</defs><g transform="rotate(${rotation * 90} 31.5 44)"><rect x=".6" y=".6" width="61.8" height="86.8" rx="4" fill="#f9f6ea" stroke="#655b44" stroke-width=".8"/><rect x="3" y="3" width="57" height="82" rx="2.5" fill="none" stroke="#514d3b" stroke-width=".3" opacity=".5"/>${corner(5, 11, false)}${corner(58, 77, true)}${mid}<path d="M12 68H51" stroke="#8e826b" stroke-width=".3"/><text x="31.5" y="74.5" text-anchor="middle" font-size="5.2" font-family="ui-monospace,monospace" letter-spacing=".5">${role}</text><text x="31.5" y="80.5" text-anchor="middle" font-size="3.5" font-family="ui-monospace,monospace" fill="#5b5443">${note}</text></g></svg>`;
}

// ─── the page ─────────────────────────────────────────────────────────────────────────────────
export default function bootTable() {
  let seed = Number(qs.get('seed')) || 1941;
  let count = Math.max(2, Math.min(4, Number(qs.get('players')) || 4));
  let bots = (qs.get('bots') ?? '0111').split('').map((c) => c === '1');
  const rules = (): Rules => ({ wrap: ($('wrap') as HTMLInputElement).checked, rim: ($('rim') as HTMLInputElement).checked, cover: true });
  ($('wrap') as HTMLInputElement).checked = qs.get('wrap') !== '0';
  ($('rim') as HTMLInputElement).checked = qs.get('rim') !== '0';
  ($('count') as HTMLSelectElement).value = String(count);
  let g!: Game;
  let selected = -1;
  let rotation = 0;
  let swapFirst: string | null = null;
  let peeked = false;
  let curtain = false;
  let undoStack: Game[] = [];
  let botTimer = 0;
  const humans = () => g.players.filter((p) => !p.bot).length;
  const me = () => current(g);

  function syncUrl() {
    const u = new URL(location.href);
    u.searchParams.set('seed', String(seed));
    u.searchParams.set('players', String(count));
    u.searchParams.set('bots', bots.slice(0, count).map((b) => (b ? '1' : '0')).join(''));
    u.searchParams.set('wrap', rules().wrap ? '1' : '0');
    u.searchParams.set('rim', rules().rim ? '1' : '0');
    if (!preview) history.replaceState(null, '', u);
  }
  function deal() {
    clearTimeout(botTimer);
    g = newGame(seed, Array.from({ length: count }, (_, i) => `P${i + 1}`), bots.slice(0, count));
    g.rules = rules();
    selected = -1; rotation = 0; swapFirst = null; peeked = false; undoStack = [];
    curtain = !preview && humans() >= 2 && !me().bot;
    syncUrl();
    render();
    maybeBot();
  }
  function seats() {
    $('seats').innerHTML = Array.from({ length: count }, (_, i) => `<span class="seat" role="group" aria-label="Seat ${i + 1}"><button aria-pressed="${!bots[i]}" data-seat="${i}" data-bot="0">P${i + 1} you</button><button aria-pressed="${!!bots[i]}" data-seat="${i}" data-bot="1">bot</button></span>`).join('');
    $('seats').querySelectorAll<HTMLButtonElement>('[data-seat]').forEach((b) => (b.onclick = () => { bots[Number(b.dataset.seat)] = b.dataset.bot === '1'; seats(); deal(); }));
  }

  /** what a tap on a space would do now, for the chosen card (or null) */
  function tapAction(k: string): Action | null {
    const opts = legal(g);
    const c = selected >= 0 ? me().hand[selected] : null;
    if (!c) return null;
    if (c.rank === QUEEN && !g.laid) {
      if (!swapFirst) return opts.some((a) => a.kind === 'swap' && (a.a === k || a.b === k)) ? { kind: 'pass' } : null; // (a first pick: handled by the caller)
      return opts.find((a) => a.kind === 'swap' && ((a.a === swapFirst && a.b === k) || (a.b === swapFirst && a.a === k))) ?? null;
    }
    if (c.rank === JACK && g.laid) return opts.find((a) => a.kind === 'jack' && a.i === selected && neighbour(g.token, a.dir, g.rules) === k) ?? null;
    return opts.find((a) => a.kind === 'lay' && a.k === k && a.i === selected && a.rotation === (c.rank === ACE ? 0 : rotation)) ?? null;
  }
  function doAct(a: Action) {
    undoStack.push(clone(g));
    if (undoStack.length > 12) undoStack.shift();
    const before = g.turn;
    act(g, a);
    selected = -1; rotation = 0; swapFirst = null;
    if (g.turn !== before) { peeked = false; curtain = g.phase !== 'over' && humans() >= 2 && !me().bot; }
    render();
    maybeBot();
  }
  function maybeBot() {
    clearTimeout(botTimer);
    if (g.phase === 'over' || !me().bot || preview) return;
    botTimer = window.setTimeout(() => {
      const a = botAction(g);
      if (!a) return;
      const before = g.turn;
      act(g, a);
      if (g.turn !== before) { curtain = g.phase !== 'over' && humans() >= 2 && !me().bot; }
      render();
      maybeBot();
    }, 700);
  }

  function render() {
    const p = me();
    const opts = legal(g);
    const c = selected >= 0 ? p.hand[selected] : null;
    $('deal').textContent = `DEAL ${seed} / ${g.phase === 'build' ? 'BUILDING THE TABLE' : g.phase === 'race' ? `THE RACE · ROLL ${g.rolls + 1} OF ${ROLL_CAP}` : 'OVER'}`;
    // the table
    let html = '';
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const k = key(x, y);
      const t = g.board.get(k);
      const a = tapAction(k);
      const legalHere = !!a || (c?.rank === QUEEN && !g.laid && !swapFirst && opts.some((o) => o.kind === 'swap' && (o.a === k || o.b === k)));
      const cls = ['slot', legalHere ? 'legal' : '', swapFirst === k ? 'swap' : '', g.token === k ? 'here' : ''].join(' ');
      const label = t ? `${cardName(t.card)} ${roleOf(t.card)}${t.start ? ', the start' : ''} at ${x + 1},${y + 1}${g.token === k ? ', the counter' : ''}` : `empty space at ${x + 1},${y + 1}`;
      html += `<button class="${cls}" data-k="${k}" aria-label="${label}${legalHere ? '; tap to play here' : ''}">${t ? cardSvg(t.card, t.rotation, `t${x}${y}`) : ''}${g.token === k ? '<span class="counter"></span>' : ''}</button>`;
    }
    $('table').innerHTML = html;
    $('table').querySelectorAll<HTMLButtonElement>('[data-k]').forEach((el) => (el.onclick = () => tapSlot(el.dataset.k!)));
    // who, and the hand
    $('who').textContent = `${p.name}${p.bot ? ' (bot)' : ''}`;
    $('peeked').textContent = peeked && !p.bot ? SUITS[p.suit] : '?';
    ($('peeked') as HTMLElement).style.color = peeked && !p.bot ? COL[p.suit] : '';
    ($('peek') as HTMLButtonElement).disabled = p.bot;
    const show = !p.bot && !curtain;
    $('hand').innerHTML = show ? p.hand.map((cd, i) => `<button class="card" data-i="${i}" aria-pressed="${selected === i}" aria-label="${cardName(cd)}, ${roleOf(cd)}">${cardSvg(cd, selected === i && cd.rank >= 2 && cd.rank <= 10 ? rotation : 0, `h${i}`)}</button>`).join('') : p.bot ? `<div class="mono">${p.name} is thinking…</div>` : '';
    $('hand').querySelectorAll<HTMLButtonElement>('[data-i]').forEach((el) => (el.onclick = () => { const i = Number(el.dataset.i); selected = selected === i ? -1 : i; rotation = 0; swapFirst = null; render(); }));
    // words
    const needLay = !g.laid && g.phase !== 'over';
    let detail = '';
    if (g.phase === 'over') detail = g.winner >= 0 ? `${g.players[g.winner].name} arrived at the King of ${SUIT_NAMES[g.players[g.winner].suit]}.` : 'A draw: thirty rolls, and nobody home.';
    else if (c) {
      if (c.rank === QUEEN) detail = needLay ? (swapFirst ? 'Now the second junction to swap with it.' : 'A Queen: tap two junctions to swap them.') : 'A Queen is played instead of laying a card.';
      else if (c.rank === JACK) detail = g.laid ? 'A Jack: tap a neighbouring card to walk the counter there instead of rolling.' : 'A Jack is played instead of the roll: lay or pass first.';
      else if (c.rank === JOKER) detail = g.laid ? 'A Joker: chaos instead of the roll — the counter takes one of its exits at random.' : 'A Joker is played instead of the roll: lay or pass first.';
      else detail = `${roleOf(c)} / ${DESIGNS[Math.max(0, c.rank - 2)]?.note ?? ''} Turn it, then tap a space.${g.laid ? ' (You have laid this turn.)' : ''}`;
    } else detail = needLay ? (g.phase === 'build' ? 'Choose a card, turn it, lay it touching the chain.' : 'Lay a card on any junction, play a Queen, or pass; then roll.') : 'Roll the die — or play a Jack or a Joker instead.';
    $('detail').textContent = detail;
    const status = g.phase === 'over' ? '' : curtain ? `Pass the table to ${p.name}.` : g.phase === 'build' ? `${p.name} to lay a card. ${g.pile.length} in the pile.` : `${p.name} to ${needLay ? 'lay, then roll' : 'roll'}. Counter at ${g.token.split(',').map((v) => Number(v) + 1).join(',')}.`;
    $('status').textContent = status;
    $('die').textContent = g.die ? String(g.die) : '—';
    $('roll-note').textContent = g.log[g.log.length - 1] ?? 'A d6; or enter your own die below.';
    $('log').innerHTML = g.log.slice(-6).reverse().map((s) => `<div>${s}</div>`).join('');
    // buttons
    const canRoll = show && opts.some((a) => a.kind === 'roll');
    const rollBtn = $('roll') as HTMLButtonElement;
    rollBtn.disabled = !canRoll;
    rollBtn.textContent = c?.rank === JOKER && canRoll && opts.some((a) => a.kind === 'joker') ? 'chaos →' : 'roll →';
    ($('pass') as HTMLButtonElement).disabled = !show || !opts.some((a) => a.kind === 'pass' || a.kind === 'discard') || g.laid;
    ($('pass') as HTMLButtonElement).textContent = g.phase === 'build' ? 'throw a card in' : 'pass';
    ($('undo') as HTMLButtonElement).disabled = !undoStack.length || !show;
    ($('left') as HTMLButtonElement).disabled = ($('right') as HTMLButtonElement).disabled = !c || c.rank < 2 || c.rank > 10 || g.laid;
    $('faces').querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = !canRoll || c?.rank === JOKER));
    // the curtain
    document.querySelector('.curtain')?.remove();
    if (curtain) {
      const d = document.createElement('div');
      d.className = 'curtain';
      d.innerHTML = `<div><h2>${p.name}</h2><p>Pass the table over. Nobody else looks.</p><button id="lift">I have it</button></div>`;
      document.body.appendChild(d);
      $('lift').onclick = () => { curtain = false; render(); };
    }
    if (g.phase === 'over' && !$('status').querySelector('.end')) $('status').innerHTML = `<div class="end">${g.winner >= 0 ? `${g.players[g.winner].name} wins · ${SUITS[g.players[g.winner].suit]}` : 'A draw'}</div>`;
  }
  function tapSlot(k: string) {
    if (curtain || me().bot || g.phase === 'over') return;
    const c = selected >= 0 ? me().hand[selected] : null;
    if (c?.rank === QUEEN && !g.laid && !swapFirst) {
      if (legal(g).some((a) => a.kind === 'swap' && (a.a === k || a.b === k))) { swapFirst = k; render(); }
      return;
    }
    const a = tapAction(k);
    if (a && a.kind !== 'pass') doAct(a);
  }
  $('left').onclick = () => { rotation = (rotation + 3) % 4; render(); };
  $('right').onclick = () => { rotation = (rotation + 1) % 4; render(); };
  $('roll').onclick = () => {
    const c = selected >= 0 ? me().hand[selected] : null;
    const opts = legal(g);
    const j = c?.rank === JOKER ? opts.find((a) => a.kind === 'joker') : null;
    if (j) doAct(j); else if (opts.some((a) => a.kind === 'roll')) doAct({ kind: 'roll' });
  };
  $('faces').innerHTML = [1, 2, 3, 4, 5, 6].map((n) => `<button data-face="${n}" aria-label="Die shows ${n}">${n}</button>`).join('');
  $('faces').querySelectorAll<HTMLButtonElement>('[data-face]').forEach((b) => (b.onclick = () => { if (legal(g).some((a) => a.kind === 'roll')) doAct({ kind: 'roll', face: Number(b.dataset.face) }); }));
  $('pass').onclick = () => {
    const opts = legal(g);
    const pass = opts.find((a) => a.kind === 'pass');
    if (pass) return doAct(pass);
    // (building: throw in the chosen card, or the first)
    const d = opts.find((a) => a.kind === 'discard' && (selected < 0 || a.i === selected));
    if (d) doAct(d);
  };
  $('undo').onclick = () => { const s = undoStack.pop(); if (!s) return; clearTimeout(botTimer); g = s; selected = -1; rotation = 0; swapFirst = null; curtain = false; render(); maybeBot(); };
  $('peek').onclick = () => { peeked = !peeked; render(); };
  $('redeal').onclick = deal;
  $('next').onclick = () => { seed++; deal(); };
  $('count').onchange = () => { count = Number(($('count') as HTMLSelectElement).value); seats(); deal(); };
  $('wrap').onchange = $('rim').onchange = () => deal();
  $('print').onclick = () => window.print();
  printSheet();
  seats();
  deal();
  if (preview) {
    // (a built table, mid-race, for the gallery)
    document.body.classList.add('preview');
    for (let i = 0; i < 40 && g.phase === 'build'; i++) { const a = botAction(g); if (!a) break; act(g, a); }
    curtain = false;
    render();
  }
  (window as unknown as { __markovs: unknown }).__markovs = {
    probe: () => ({ seed, phase: g.phase, turn: g.turn, token: g.token, rolls: g.rolls, winner: g.winner, laid: g.laid, hands: g.players.map((p) => p.hand.length), bots: g.players.map((p) => p.bot), suits: g.players.map((p) => p.suit), pile: g.pile.length, curtain }),
    act: (a: Action) => { if (legal(g).some((o) => JSON.stringify(o) === JSON.stringify(a))) { doAct(a); return true; } return false; },
    legal: () => legal(g),
    lift: () => { curtain = false; render(); },
  };
}

/** the print sheet: one page of rules, then the 54 cards at poker size */
function printSheet() {
  const cards = pack();
  const pages: string[] = [];
  for (let i = 0; i < cards.length; i += 9) pages.push(`<section class="print-page"><div class="cap">MARKOVS CHAINS · 63 × 88 mm · SHEET ${i / 9 + 1} OF ${Math.ceil(cards.length / 9)}</div><div class="print-grid">${cards.slice(i, i + 9).map((c, j) => `<div class="print-card">${cardSvg(c, 0, `p${i + j}`)}</div>`).join('')}</div></section>`);
  $('print-sheet').innerHTML = `<section class="print-page"><h1>Markovs Chains</h1><p><b>A game of finite probabilities on a standard poker deck.</b> Two to four players, one counter, one d6, and the 54 cards here (or any deck: the number cards are junctions, as the table below has them).</p>
<p><b>Deal.</b> Lay the four Kings face up at the middle of each edge of an imaginary 5 × 5 table, the Ace of spades in the centre, the counter on it. Shuffle the rest. Each player takes one card face down: its suit is their King, and their secret. Deal three cards each.</p>
<p><b>Build.</b> In turns, lay one card from your hand, turned any way you like, on an empty space touching a laid card (or anywhere on the outer ring; an Ace anywhere). Draw back to three. If you can't lay, throw a card in and draw. No rolling. Build until no space is empty.</p>
<p><b>Race.</b> On your turn: lay one card on top of any junction (not a King), or play a Queen to swap two junctions, or pass. Then roll the d6. Find that face's arrow on the card under the counter and move one space that way; off the edge, come in on the far side. A loop face stays. Instead of rolling you may play a Jack (walk the counter one space, your choice) or a Joker (the counter takes one of its card's exits at random). Draw back to three.</p>
<p><b>Winning.</b> The first time the counter arrives at your King, show your face-down card: you win. Arriving at a King nobody holds sends the counter back to the Ace. Thirty rolls without an arrival is a draw.</p>
<p><b>The junctions.</b> ${DESIGNS.map((d) => `<b>${RANK[d.rank]} ${d.name}</b> ${d.faces.map((f, i) => `${i + 1}${f < 0 ? ' stay' : ['↑', '→', '↓', '←'][f]}`).join(' ')}`).join(' · ')}. Faces turn with the card.</p>
<p>Don't say which King is yours. Every card you lay says a little.</p></section>${pages.join('')}`;
}
