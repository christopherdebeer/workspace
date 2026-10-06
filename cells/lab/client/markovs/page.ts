/**
 * The table, on a phone: Markovs Chains on a poker deck, two to four at one screen (pass it
 * round; a curtain hides the hand between turns) or against bots. Everything the page does goes
 * through table.ts' `legal()` and `act()`, so what you can tap is exactly what the rules allow.
 */
import { ACE, COMMISSION, DIR_NAMES, PLACES, SHAPES, TEMPER, TEMPER_NOTE, JACK, JOKER, KING, QUEEN, SIZE, SUITS, SUIT_NAMES, cardName, exits, key, neighbour, pack, roleOf, type Card, type Rules, type Tile } from './deck';
import { ROLL_CAP, act, botAction, clone, current, legal, newGame, type Action, type Game } from './table';
import { METHOD_TEXT, RULES_TEXT } from './text';

const $ = (id: string) => document.getElementById(id)!;
const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const COL = ['#ca4438', '#d6ad35', '#4e8164', '#3c559f'];
/** the ink of each suit's paintings, and their paper */
const INK = ['#622418', '#49351b', '#0a281e', '#0d1e37'];
const PAPER = '#f6e8cf';
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
/** a card's faces in plain words, as it lies: "1–4 north · 5 east · 6 stays" */
export function literal(t: Tile): string {
  if (t.card.rank === KING) return 'a destination: the counter stops here';
  const rg = ranges(t);
  return [0, 1, 2, 3, -1].filter((d) => rg.has(d)).map((d) => `${rg.get(d)} ${d < 0 ? (rg.get(d)!.length > 1 ? 'stay' : 'stays') : DIR_NAMES[d]}`).join(' · ');
}
/** where the experiment's assets are served from ('' when there are none: the plain design) */
const ASSETS = (() => { const m = typeof document !== 'undefined' ? document.querySelector<HTMLMetaElement>('meta[name=assets]') : null; return m?.content && !m.content.includes('{{') ? m.content : ''; })();
const SUIT_KEY = ['h', 'd', 'c', 's'];
const COURT = { [JACK]: ['THE WAYFINDER', 'REROUTE', 'Walk one step your way.'], [QUEEN]: ['THE EXCHANGE', 'SWAP', 'Exchange two junctions.'], [KING]: ['DESTINATION', 'DESTINATION', 'Reach this suit to win.'] } as Record<number, string[]>;
/** `square`: a square viewport the card fits either way up (the table's parking spaces) */
export function cardSvg(card: Card, rotation = 0, id = 'c', square = false): string {
  const col = card.rank === JOKER ? '#24231f' : COL[card.suit];
  const suit = card.rank === JOKER ? '★' : SUITS[card.suit];
  const rank = card.rank === JOKER ? 'JOKER' : RANK[card.rank];
  const role = roleOf(card);
  const sk = SUIT_KEY[card.suit];
  const open = `<svg viewBox="${square ? '-12.5 0 88 88' : '0 0 63 88'}" aria-hidden="true"><g transform="rotate(${rotation * 90} 31.5 44)">`;
  // the court, painted: the Wayfinders, the Exchange, the four places, and the two Jokers — the
  // scene floating on the paper; the index large with its glyph beneath; dotted sigil columns
  // with stars in the margins; the suit's seal at the foot of the scene; the name on a rule
  // (and the Twos, the commissions: dealt face down as the secret suits, never on the table, so
  // they carry their place as a scene)
  const two = card.rank === COMMISSION;
  if (ASSETS && (card.rank === JACK || card.rank === QUEEN || card.rank === KING || card.rank === JOKER || two)) {
    const jk = card.rank === JOKER, jsuit = jk ? (card.suit === 0 ? 0 : 3) : card.suit;
    const sk = SUIT_KEY[jsuit], ink = INK[jsuit];
    const img = (f: string, x: number, y: number, w: number, h: number, extra = '') => `<image href="${ASSETS}${f}" x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
    const index = (flip: boolean) => `<g ${flip ? 'transform="rotate(180 31.5 44)"' : ''}>${jk ? `<text x="4.6" y="13" font-size="10" fill="${ink}">★</text><text x="4.9" y="18.6" font-size="2.7" font-family="Georgia,serif" letter-spacing=".45" fill="${ink}">JOKER</text>` : `<text x="${rank === '10' ? 4.4 : 5}" y="13.2" font-size="10.5" font-family="Georgia,serif" font-weight="bold" fill="${ink}">${rank}</text>${img(`${sk}-glyph.png`, 5, 14.4, 6.2, 6, 'preserveAspectRatio="xMidYMid meet"')}`}</g>`;
    const star = (x: number, y: number, r: number) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${ink}"/>`;
    const column = (x: number) => `<path d="M${x} 22V68" stroke="${ink}" stroke-width=".22" stroke-dasharray=".4 1.1"/>${star(x, 30, 1.5)}${star(x, 45, 0.9)}${star(x, 60, 1.5)}<circle cx="${x}" cy="37.5" r=".45" fill="${ink}"/><circle cx="${x}" cy="52.5" r=".45" fill="${ink}"/>`;
    const [name, sub] = card.rank === KING ? [PLACES[card.suit].toUpperCase(), 'DESTINATION', 'Reach this suit to win.'] : two ? [PLACES[card.suit].toUpperCase(), 'COMMISSION', 'Your King. Your secret.'] : jk ? ['THE TRICKSTER', 'CHAOS', 'A random exit. No dice.'] : COURT[card.rank];
    const big = name.length >= 10;
    return `${open}<rect x=".6" y=".6" width="61.8" height="86.8" rx="4" fill="${PAPER}" stroke="#655b44" stroke-width=".8"/><rect x="1.8" y="1.8" width="59.4" height="84.4" rx="3.2" fill="none" stroke="${ink}" stroke-width=".45"/><rect x="2.9" y="2.9" width="57.2" height="82.2" rx="2.6" fill="none" stroke="${ink}" stroke-width=".2"/>${img(`${jk ? 'JOKER' : RANK[card.rank]}${card.suit}.webp`, 5.5, 4.2, 52, 58.3, 'preserveAspectRatio="xMidYMax meet"')}${jk ? '' : column(4.1) + column(58.9)}${jk ? '' : img(`${sk}-seal.png`, 25, 57, 13, 13)}${index(false)}${index(true)}<text x="${big ? 29.5 : 31.5}" y="74.6" text-anchor="middle" font-size="${big ? 3.9 : 5}" font-family="Georgia,serif" letter-spacing="${big ? 0.5 : 1.1}" fill="#2a2420">${name}</text><path d="M15 77.2H${31.5 - sub.length * 0.95 - 1.5}M${31.5 + sub.length * 0.95 + 1.5} 77.2H48" stroke="${ink}" stroke-width=".25"/><text x="31.5" y="78.1" text-anchor="middle" font-size="2.4" font-family="Georgia,serif" letter-spacing=".5" fill="${ink}">${sub}</text></g></svg>`;
  }
  const arrow = `<marker id="${id}a" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 0L4 2L0 4" fill="#34312c"/></marker>`;
  const note = card.rank === JOKER ? 'A random exit. No dice.' : card.rank === ACE ? 'Lay anywhere. A cross.' : card.rank === JACK || card.rank === QUEEN || card.rank === KING ? COURT[card.rank][2] : SHAPES[card.rank].note;
  // the junction, engraved: a ring of four stations on a dotted orbit, the exits as hatched rods
  // with open heads, the stays as a dashed loop, the faces in serif figures of the suit's ink
  const ink = card.rank === JOKER ? '#24231f' : INK[card.suit];
  const cx = 31.5, cy = ASSETS ? 30.5 : 42, R = ASSETS ? 16 : 20;
  const su = card.rank === JOKER ? -1 : card.suit; // (0 the River, 1 the Mirror, 2 the Thicket, 3 the Well)
  let mid = '';
  const hair = (d: string, w = 0.3, extra = '') => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  /** a rod from the hub out to the station in direction d (0 north … 3 west): a tapered engraved
   *  shaft with a shade line, and an open head */
  const rod = (d: number, dashed = false) => {
    const ux = [0, 1, 0, -1][d], uy = [-1, 0, 1, 0][d], px = -uy, py = ux;
    const a = 5.2, b = R - 3.4;
    const P = (t: number, o: number) => `${(cx + ux * t + px * o).toFixed(2)} ${(cy + uy * t + py * o).toFixed(2)}`;
    let out = '';
    if (dashed) out += hair(`M${P(a, 0)}L${P(b, 0)}`, 0.55, 'stroke-dasharray="1.3 .9"');
    else {
      // (the shaft, drawn as a sliver: wide at the hub, a point at the head)
      out += `<path d="M${P(a, 0.42)}L${P(b - 0.4, 0.08)}L${P(b - 0.4, -0.08)}L${P(a, -0.42)}Z" fill="${ink}"/>`;
      // (the suit's character beside it: the River's current ripples along the shaft, the Mirror
      // shades both sides alike, the Thicket sprouts twigs, the Well's shade is a row of drops)
      if (su === 0) { let w = `M${P(a + 0.6, 0.9)}`; for (let t = a + 0.6; t < b - 2.2; t += 1.2) w += `Q${P(t + 0.6, 1.35)} ${P(t + 1.2, 0.9)}`; out += hair(w, 0.14); }
      else if (su === 1) out += hair(`M${P(a + 0.6, 0.95)}L${P(b - 2.2, 0.5)}M${P(a + 0.6, -0.95)}L${P(b - 2.2, -0.5)}`, 0.14);
      else if (su === 2) { for (let t = a + 1.2, k = 0; t < b - 2.6; t += 1.7, k++) { const o = k % 2 ? 1 : -1; out += hair(`M${P(t, 0.3 * o)}L${P(t + 0.9, 1.5 * o)}`, 0.18); } }
      else if (su === 3) { for (let t = a + 1; t < b - 2.2; t += 1.3) out += `<circle cx="${(cx + ux * t + px * 0.95).toFixed(2)}" cy="${(cy + uy * t + py * 0.95).toFixed(2)}" r=".17" fill="${ink}"/>`; }
      else out += hair(`M${P(a + 0.6, 0.95)}L${P(b - 2.2, 0.5)}`, 0.14);
    }
    out += hair(`M${P(b - 2.3, 1.75)}L${P(b + 0.5, 0)}L${P(b - 2.3, -1.75)}`, 0.6);
    return out;
  };
  /** a station on the orbit: a compass mark — a ring with four ticks; live ones carry a dot */
  const station = (d: number, live: boolean) => {
    const x = cx + [0, R, 0, -R][d], y = cy + [-R, 0, R, 0][d];
    const w = live ? 0.42 : 0.2, dim = live ? '' : 'opacity=".55"';
    const dot = live ? `<circle cx="${x}" cy="${y}" r=".62" fill="${ink}"/>` : '';
    // (the River: a ripple of three rings; the Mirror: a lozenge; the Thicket: a ring with six
    // sprouts; the Well: rings within rings; the Joker: a compass mark)
    if (su === 0) return `<g ${dim}><circle cx="${x}" cy="${y}" r="1.8" fill="${PAPER}" stroke="${ink}" stroke-width="${w}"/><path d="M${x - 2.9} ${y + 0.2}a2.9 2.9 0 0 1 5.8 0M${x - 2.4} ${y - 1.4}a2.6 2.6 0 0 0 4.8 0" fill="none" stroke="${ink}" stroke-width=".16"/>${dot}</g>`;
    if (su === 1) return `<g ${dim}><path d="M${x} ${y - 2.4}L${x + 2.4} ${y}L${x} ${y + 2.4}L${x - 2.4} ${y}Z" fill="${PAPER}" stroke="${ink}" stroke-width="${w}"/><path d="M${x - 2.4} ${y}H${x + 2.4}" stroke="${ink}" stroke-width=".14"/>${dot}</g>`;
    if (su === 2) { const sp = [30, 90, 150, 210, 270, 330].map((a) => { const r = (a * Math.PI) / 180; return hair(`M${x + Math.cos(r) * 1.8} ${y + Math.sin(r) * 1.8}L${x + Math.cos(r) * 2.9} ${y + Math.sin(r) * 2.9}l${Math.cos(r + 0.9) * 0.6} ${Math.sin(r + 0.9) * 0.6}`, live ? 0.26 : 0.16); }).join(''); return `<g ${dim}><circle cx="${x}" cy="${y}" r="1.8" fill="${PAPER}" stroke="${ink}" stroke-width="${w}"/>${sp}${dot}</g>`; }
    if (su === 3) return `<g ${dim}><circle cx="${x}" cy="${y}" r="2.6" fill="${PAPER}" stroke="${ink}" stroke-width=".14"/><circle cx="${x}" cy="${y}" r="1.8" fill="none" stroke="${ink}" stroke-width="${w}"/><circle cx="${x}" cy="${y}" r="1.1" fill="none" stroke="${ink}" stroke-width=".14"/>${dot}</g>`;
    const ticks = [0, 90, 180, 270].map((a) => { const r = (a * Math.PI) / 180; return hair(`M${x + Math.cos(r) * 1.9} ${y + Math.sin(r) * 1.9}L${x + Math.cos(r) * 2.7} ${y + Math.sin(r) * 2.7}`, live ? 0.28 : 0.16); }).join('');
    return `<g ${dim}><circle cx="${x}" cy="${y}" r="1.8" fill="${PAPER}" stroke="${ink}" stroke-width="${w}"/>${dot}${ticks}</g>`;
  };
  /** the hub: two rings, the six faces as pips round the inner one, a dot */
  const node = `<circle cx="${cx}" cy="${cy}" r="4.7" fill="${PAPER}" stroke="${ink}" stroke-width=".5"/><circle cx="${cx}" cy="${cy}" r="3.4" fill="none" stroke="${ink}" stroke-width=".2"/>${Array.from({ length: 24 }, (_, k) => { const a = (k * 15 * Math.PI) / 180; const l = k % 6 === 0 ? 1.1 : 0.55; return hair(`M${cx + Math.cos(a) * 3.5} ${cy + Math.sin(a) * 3.5}L${cx + Math.cos(a) * (3.5 + l)} ${cy + Math.sin(a) * (3.5 + l)}`, k % 6 === 0 ? 0.26 : 0.14); }).join('')}${(() => { const n = card.rank >= 1 && card.rank <= 10 ? card.rank : 6; return Array.from({ length: n }, (_, k) => { const a = ((k * 360 / n - 90) * Math.PI) / 180; return `<circle cx="${(cx + Math.cos(a) * 2.25).toFixed(2)}" cy="${(cy + Math.sin(a) * 2.25).toFixed(2)}" r="${n > 8 ? 0.32 : 0.38}" fill="${ink}"/>`; }).join(''); })()}<circle cx="${cx}" cy="${cy}" r=".7" fill="${ink}"/>`;
  /** the orbit: a dial — a dotted ring, a hairline outside it, a tick every 10°, longer at 30°,
   *  and a mark at the four half-way points */
  const orbit = (() => {
    const r1 = R + 3, r2 = R + 6.4;
    let o = `<circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="${ink}" stroke-width=".22" stroke-dasharray=".45 1.05"/><circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="${ink}" stroke-width=".12"/>`;
    for (let k = 0; k < 36; k++) {
      if (k % 9 === 0) continue; // (the stations sit there)
      const a = (k * 10 * Math.PI) / 180, l = k % 3 === 0 ? 1.1 : 0.55;
      o += hair(`M${cx + Math.cos(a) * r1} ${cy + Math.sin(a) * r1}L${cx + Math.cos(a) * (r1 + l)} ${cy + Math.sin(a) * (r1 + l)}`, k % 3 === 0 ? 0.2 : 0.12);
    }
    // (the card's number, once more, as marks round the dial: an Ace one, a ten ten)
    const n = card.rank >= 1 && card.rank <= 10 ? card.rank : 4;
    for (let k = 0; k < n; k++) { const a = ((k * 360) / n + 45) * (Math.PI / 180); o += `<circle cx="${(cx + Math.cos(a) * r1).toFixed(2)}" cy="${(cy + Math.sin(a) * r1).toFixed(2)}" r=".5" fill="${ink}"/>`; }
    return o;
  })();
  const fig = (x: number, y: number, t: string, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="4.4" font-family="Georgia,serif" fill="${ink}">${t}</text>`;
  /** the stays: an eddy — a curl out of the hub's west side and back, engraved as a dashed
   *  hairline over a faint solid one, with its own head */
  // (the loop's head sits on the curve's end tangent — from its last control point to its tip)
  const tip = [cx - 5.4, cy + 3.2], ctl = [cx - R - 1.5, cy + 12.5];
  const tl = Math.hypot(tip[0] - ctl[0], tip[1] - ctl[1]), tu = [(tip[0] - ctl[0]) / tl, (tip[1] - ctl[1]) / tl], tp = [-tu[1], tu[0]];
  const headAt = (t: number[], u: number[], p: number[]) => hair(`M${(t[0] - u[0] * 2.6 + p[0] * 1.75).toFixed(2)} ${(t[1] - u[1] * 2.6 + p[1] * 1.75).toFixed(2)}L${t[0].toFixed(2)} ${t[1].toFixed(2)}L${(t[0] - u[0] * 2.6 - p[0] * 1.75).toFixed(2)} ${(t[1] - u[1] * 2.6 - p[1] * 1.75).toFixed(2)}`, 0.6);
  const loopHead = headAt(tip, tu, tp);
  const whirl = `M${cx - 4.4} ${cy - 2.6}C${cx - R - 1.5} ${cy - R + 2.5} ${ctl[0]} ${ctl[1]} ${tip[0]} ${tip[1]}`;
  const eddy = su === 3 ? `${hair(whirl, 0.55, 'stroke-dasharray="1.3 1"')}${hair(`M${cx - 6.2} ${cy - 1.2}C${cx - 12.5} ${cy - 7.5} ${cx - 13} ${cy + 6.5} ${cx - 7.2} ${cy + 1.8}`, 0.2, 'opacity=".6"')}${loopHead}` : `${hair(`M${cx - 4.4} ${cy - 2.6}C${cx - R - 1.5} ${cy - R + 2.5} ${cx - R - 1.5} ${cy + 12.5} ${cx - 5.4} ${cy + 3.2}`, 0.2, 'opacity=".45"')}${hair(whirl, 0.55, 'stroke-dasharray="1.3 1"')}${loopHead}`;
  if (card.rank === KING) mid = `${orbit}<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${ink}" stroke-width=".4"/><circle cx="${cx}" cy="${cy}" r="10" fill="${ink}"/><text x="${cx}" y="${cy + 4.6}" text-anchor="middle" fill="${PAPER}" font-size="13">${suit}</text>`;
  else if (card.rank === JACK) mid = `${orbit}${hair(`M${cx - 15} ${cy + 4}Q${cx} ${cy - 20} ${cx + 15} ${cy + 4}`, 0.55, 'stroke-dasharray="1.6 1.1"')}${hair(`M${cx - 15} ${cy + 6}H${cx + 13}`, 0.55)}${station(3, true)}${station(1, true)}`;
  else if (card.rank === QUEEN) mid = `${orbit}${hair(`M${cx - 12} ${cy - 10}L${cx + 10} ${cy + 8}M${cx + 12} ${cy - 10}L${cx - 10} ${cy + 8}`, 0.55)}${[[-13, -11], [13, -11], [-13, 11], [13, 11]].map(([x, y]) => `<circle cx="${cx + x}" cy="${cy + y}" r="2.4" fill="${PAPER}" stroke="${ink}" stroke-width=".4"/>`).join('')}`;
  else if (card.rank === JOKER) mid = `${orbit}${[0, 1, 2, 3].map((d) => rod(d, true)).join('')}${[0, 1, 2, 3].map((d) => station(d, true)).join('')}${node}`;
  else {
    const t: Tile = { card, rotation: 0 };
    const rg = ranges(t);
    mid += orbit;
    for (let d = 0; d < 4; d++) {
      if (rg.has(d) || card.rank === ACE) mid += rod(d, card.rank === ACE);
      mid += station(d, rg.has(d));
    }
    // the figures beside each rod, on the side away from the stay loop
    const F = R - 7;
    if (rg.has(0)) mid += fig(cx + 3.2, cy - F - 1, rg.get(0)!, 'start');
    if (rg.has(1)) mid += fig(cx + F - 1, cy - 2.4, rg.get(1)!, 'middle');
    if (rg.has(2)) mid += fig(cx + 3.2, cy + F + 3.4, rg.get(2)!, 'start');
    if (rg.has(3)) mid += fig(cx - F + 1, cy - 2.4, rg.get(3)!, 'middle');
    if (rg.has(-1)) mid += eddy + fig(cx - R + 5.5, cy + 9.6, rg.get(-1)!, 'middle');
    mid += node;
  }
  const under = card.rank >= 2 && card.rank <= 10 ? TEMPER[card.suit].toUpperCase() : '';
  if (ASSETS) {
    // the etched dress: a double hairline border with the suit's small flourish in each corner,
    // the junction above, one of the suit's six vignettes, by rank, in fine ink across the lower third, the name on a rule
    const img = (f: string, x: number, y: number, w: number, h: number, extra = '') => `<image href="${ASSETS}${f}" x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
    // (the index: rank over glyph in a block 7 × 14 mm at the top-left, 5 mm in from the edges,
    // and the same turned about the centre at the bottom-right; the vignette and the rules stop
    // short of both)
    const joker = card.rank === JOKER;
    const index = (flip: boolean) => `<g ${flip ? 'transform="rotate(180 31.5 44)"' : ''}>${joker ? `<text x="5" y="10.5" font-size="3.4" font-family="Georgia,serif" letter-spacing=".4" fill="${ink}">JOKER</text><text x="5.6" y="17.5" font-size="6" fill="${ink}">★</text>` : `<text x="${rank === '10' ? 4.6 : 5.4}" y="12.3" font-size="${rank === '10' ? 8.2 : 9.2}" font-family="Georgia,serif" fill="${ink}" ${rank === '10' ? 'letter-spacing="-.6"' : ''}>${rank}</text>${img(`${sk}-glyph.png`, 5.2, 13.4, 5.2, 5, 'preserveAspectRatio="xMidYMid meet"')}`}</g>`;
    const corner = (_x: number, _y: number, flip: boolean) => index(flip);
    // (the flourish is drawn for a bottom-left corner: its corner at the origin, reaching up and right)
    const flourish = joker ? '' : [[3.2, 84.8, 0], [3.2, 3.2, 90], [59.8, 3.2, 180], [59.8, 84.8, 270]].map(([x, y, a]) => `<g transform="translate(${x} ${y}) rotate(${a})">${img(`${sk}-cornerS.png`, 0, -7.4, 6.5, 7.4, 'opacity=".85"')}</g>`).join('');
    const name = card.rank === ACE ? 'THE WILD' : role;
    return `${open}<defs>${arrow}</defs><rect x=".6" y=".6" width="61.8" height="86.8" rx="4" fill="${PAPER}" stroke="#655b44" stroke-width=".8"/><rect x="1.8" y="1.8" width="59.4" height="84.4" rx="3.2" fill="none" stroke="${ink}" stroke-width=".45"/><rect x="2.9" y="2.9" width="57.2" height="82.2" rx="2.6" fill="none" stroke="${ink}" stroke-width=".2"/>${flourish}${corner(0, 0, false)}${corner(0, 0, true)}${mid}${joker ? '' : img(`${sk}-vig${(card.rank + 4) % 6}.png`, 6, 51.5, 46, 17.5, 'preserveAspectRatio="xMidYMax meet"')}<path d="M14 72.6H47.5" stroke="${ink}" stroke-width=".25"/><text x="30.75" y="78.2" text-anchor="middle" font-size="4.6" font-family="Georgia,serif" letter-spacing="1" fill="#2a2420">${name}</text><path d="M14 80.6H47.5" stroke="${ink}" stroke-width=".25"/></g></svg>`;
  }
  // (the plain dress: an orbit with its four stations, a sigil column in the margin — the suit's
  // temperament — and the temperament named under the shape)
  const sig = { 0: `<path d="M3.5 30c1.5-1.2 3-1.2 4.5 0M3.5 33c1.5-1.2 3-1.2 4.5 0" fill="none" stroke="${col}" stroke-width=".5"/>`, 1: `<path d="M5.75 29l2.2 2.2-2.2 2.2-2.2-2.2z" fill="none" stroke="${col}" stroke-width=".5"/>`, 2: `<path d="M5.75 34v-3m0 0l-2-2m2 2l2-2" fill="none" stroke="${col}" stroke-width=".5"/>`, 3: `<circle cx="5.75" cy="31.5" r="2.2" fill="none" stroke="${col}" stroke-width=".5"/><circle cx="5.75" cy="31.5" r=".8" fill="${col}"/>` }[card.rank === JOKER ? 3 : card.suit];
  const dress = card.rank === KING || card.rank === JOKER ? '' : `<circle cx="${cx}" cy="${cy}" r="24" fill="none" stroke="#8e826b" stroke-width=".35" stroke-dasharray="1 1.6"/>${[0, 1, 2, 3].map((d) => `<circle cx="${cx + [0, 24, 0, -24][d]}" cy="${cy + [-24, 0, 24, 0][d]}" r=".9" fill="#8e826b"/>`).join('')}<path d="M5.75 22v4m0 14v18" stroke="#8e826b" stroke-width=".3" stroke-dasharray=".8 1.4"/>${sig}<path d="M57.25 28v30" stroke="#8e826b" stroke-width=".3" stroke-dasharray=".8 1.4"/><circle cx="57.25" cy="43" r=".9" fill="none" stroke="#8e826b" stroke-width=".4"/>`;
  const corner = (x: number, y: number, flip: boolean) => `<g ${flip ? `transform="rotate(180 ${x} ${y})"` : ''}><text x="${x}" y="${y}" font-size="${card.rank === JOKER ? 4 : 8}" font-family="Georgia" fill="${col}">${rank}</text><text x="${x}" y="${y + 7}" font-size="6" fill="${col}">${suit}</text></g>`;
  return `${open}<defs>${arrow}</defs><rect x=".6" y=".6" width="61.8" height="86.8" rx="4" fill="${PAPER}" stroke="#655b44" stroke-width=".8"/><rect x="3" y="3" width="57" height="82" rx="2.5" fill="none" stroke="#514d3b" stroke-width=".3" opacity=".5"/>${dress}${corner(5, 11, false)}${corner(58, 77, true)}${mid}<path d="M12 68H51" stroke="#8e826b" stroke-width=".3"/><text x="31.5" y="73.5" text-anchor="middle" font-size="5" font-family="ui-monospace,monospace" letter-spacing=".5">${role}</text>${under ? `<text x="31.5" y="77.5" text-anchor="middle" font-size="3.2" font-family="ui-monospace,monospace" letter-spacing=".6" fill="${col}">${under}</text>` : ''}<text x="31.5" y="82" text-anchor="middle" font-size="3.3" font-family="ui-monospace,monospace" fill="#5b5443">${note}</text></g></svg>`;
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
    return opts.find((a) => a.kind === 'lay' && a.k === k && a.i === selected && a.rotation === rotation) ?? null;
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
      html += `<button class="${cls}" data-k="${k}" aria-label="${label}${legalHere ? '; tap to play here' : ''}">${t ? cardSvg(t.card, t.rotation, `t${x}${y}`, true) : ''}${g.token === k ? '<span class="counter"></span>' : ''}</button>`;
    }
    $('table').innerHTML = html;
    $('table').querySelectorAll<HTMLButtonElement>('[data-k]').forEach((el) => (el.onclick = () => tapSlot(el.dataset.k!)));
    // who, and the hand
    $('who').textContent = `${p.name}${p.bot ? ' (bot)' : ''}`;
    $('peeked').textContent = peeked && !p.bot ? SUITS[p.suit] : '?';
    ($('peeked') as HTMLElement).style.color = peeked && !p.bot ? COL[p.suit] : '';
    ($('peek') as HTMLButtonElement).disabled = p.bot;
    const show = !p.bot && !curtain;
    $('hand').innerHTML = show ? p.hand.map((cd, i) => `<button class="card" data-i="${i}" aria-pressed="${selected === i}" aria-label="${cardName(cd)}, ${roleOf(cd)}">${cardSvg(cd, selected === i && (cd.rank === ACE || (cd.rank >= 2 && cd.rank <= 10)) ? rotation : 0, `h${i}`, true)}</button>`).join('') : p.bot ? `<div class="mono">${p.name} is thinking…</div>` : '';
    $('hand').querySelectorAll<HTMLButtonElement>('[data-i]').forEach((el) => (el.onclick = () => { const i = Number(el.dataset.i); selected = selected === i ? -1 : i; rotation = 0; swapFirst = null; render(); }));
    // words
    const needLay = !g.laid && g.phase !== 'over';
    let detail = '';
    if (g.phase === 'over') detail = g.winner >= 0 ? `${g.players[g.winner].name} arrived at the King of ${SUIT_NAMES[g.players[g.winner].suit]}.` : 'A draw: thirty moves, and nobody home.';
    else if (c) {
      if (c.rank === QUEEN) detail = needLay ? (swapFirst ? 'Now the second junction to swap with it.' : 'A Queen: tap two junctions to swap them.') : 'A Queen is played instead of laying a card.';
      else if (c.rank === JACK) detail = g.laid ? 'A Jack: tap a neighbouring card to walk the counter there instead of rolling.' : 'A Jack is played instead of the roll: lay or pass first.';
      else if (c.rank === JOKER) detail = g.laid ? 'A Joker: chaos instead of the roll — the counter takes one of its exits at random.' : 'A Joker is played instead of the roll: lay or pass first.';
      else detail = `${roleOf(c)} of ${TEMPER[c.suit]} / ${SHAPES[c.rank]?.note ?? 'A cross.'} ${TEMPER_NOTE[c.suit]}. As turned: ${literal({ card: c, rotation })}. Tap a space.${g.laid ? ' (You have laid this turn.)' : ''}`;
    } else detail = needLay ? (g.phase === 'build' ? 'Choose a card, turn it, lay it touching the chain.' : 'Lay a card on any junction, play a Queen, or pass; then roll.') : 'Roll the die — or play a Jack or a Joker instead.';
    $('detail').textContent = detail;
    const under = g.board.get(g.token)!;
    $('under').textContent = g.phase === 'build' ? '' : `Under the counter: ${cardName(under.card)} ${roleOf(under.card)}${under.rotation ? `, turned ${under.rotation === 1 ? 'once' : under.rotation === 2 ? 'twice' : 'three times'}` : ''} — ${literal(under)}.`;
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
    ($('left') as HTMLButtonElement).disabled = ($('right') as HTMLButtonElement).disabled = !c || c.rank > 10 || g.laid;
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
    playtest: (d: PlaytestData) => setPlaytest(d),
    playtestLoaded: () => !!playtestData,
  };
  void loadPlaytest();
}

// ─── print: the rules, the box, the insert, the cards ─────────────────────────────────────────
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** the tuck box for 54 poker cards (65 × 90 × 19 mm inside), flat: cut the solid line, fold the
 *  dashed ones, glue the narrow flap inside the far side */
export function boxSvg(): string {
  const G = 12, W = 65, D = 19, H = 90, T = 14;
  const x1 = G, x2 = x1 + W, x3 = x2 + D, x4 = x3 + W, x5 = x4 + D;
  const y1 = T, y2 = y1 + D, y3 = y2 + H, y4 = y3 + D, y5 = y4 + T;
  const ink = '#24231f';
  const cut = `M0 ${y2 + 4}L4 ${y2}H${x2}L${x2 + 1} ${y2}L${x2 + 3} ${y1 + 4}H${x3 - 3}L${x3 - 1} ${y2}H${x3}V${y1}H${x3 + 4}Q${x3 + 4} 0 ${x3 + 9} 0H${x4 - 9}Q${x4 - 4} 0 ${x4 - 4} ${y1}H${x4}V${y2}L${x4 + 1} ${y2}L${x4 + 3} ${y1 + 4}H${x5 - 3}L${x5 - 1} ${y2}H${x5}V${y3}H${x5 - 1}L${x5 - 3} ${y4 - 4}H${x4 + 3}L${x4 + 1} ${y3}H${x4}V${y4}H${x4 - 4}Q${x4 - 4} ${y5} ${x4 - 9} ${y5}H${x3 + 9}Q${x3 + 4} ${y5} ${x3 + 4} ${y4}H${x3}V${y3}H${x3 - 1}L${x3 - 3} ${y4 - 4}H${x2 + 3}L${x2 + 1} ${y3}H4L0 ${y3 - 4}Z`;
  const folds = [[x1, y2, x1, y3], [x2, y2, x2, y3], [x3, y2, x3, y3], [x4, y2, x4, y3], [x2, y2, x5, y2], [x2, y3, x5, y3], [x3, y1, x4, y1], [x3, y4, x4, y4]].map(([a, b, c, d]) => `<path d="M${a} ${b}L${c} ${d}" stroke="${ink}" stroke-width=".25" stroke-dasharray="1.5 1.2"/>`).join('');
  const side = (x: number) => `<g transform="translate(${x + D / 2} ${y2 + H / 2}) rotate(-90)"><text text-anchor="middle" y="1.5" font-size="3.8" font-family="ui-monospace,monospace" letter-spacing=".9" fill="${ink}">MARKOVS CHAINS · 2–4 PLAYERS</text></g>`;
  const front = `<g transform="translate(${x1} ${y2})"><rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="${ink}" stroke-width=".3"/><text x="${W / 2}" y="13" text-anchor="middle" font-size="7.5" font-family="Georgia" letter-spacing="-.3" fill="${ink}">Markovs Chains</text><text x="${W / 2}" y="18" text-anchor="middle" font-size="2.2" font-family="ui-monospace,monospace" letter-spacing=".6" fill="#27379b">A GAME OF FINITE PROBABILITIES</text><svg x="${(W - 34) / 2}" y="24" width="34" height="47.5" viewBox="0 0 63 88">${cardSvg({ suit: 0, rank: 5 }, 0, 'bx').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg><text x="${W / 2}" y="79" text-anchor="middle" font-size="2.8" font-family="Georgia" fill="${ink}">Build the table together.</text><text x="${W / 2}" y="83" text-anchor="middle" font-size="2.8" font-family="Georgia" fill="${ink}">Race one counter to your secret King.</text></g>`;
  const lines = ['One counter, one die, this deck.', 'Kings at the edges, the Ace of spades in', 'the centre. Each player draws a Two face', 'down: its suit is their King, their secret.', '', 'BUILD: lay junctions, turned as you like,', 'until the 5 × 5 table is full.', 'RACE: lay or swap, then roll — the card', 'under the counter says where it goes.', 'Jacks steer, Jokers gamble, Queens swap.', '', 'First to bring the counter to their own', 'King wins — whoever moved it.', '', '2–4 players · 20 minutes · 54 cards'];
  const back = `<g transform="translate(${x3} ${y2})"><rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="${ink}" stroke-width=".3"/><text x="${W / 2}" y="11" text-anchor="middle" font-size="4.5" font-family="Georgia" fill="${ink}">Markovs Chains</text>${lines.map((l, i) => `<text x="6" y="${18 + i * 4.3}" font-size="2.7" font-family="Georgia" fill="${ink}">${esc(l)}</text>`).join('')}<text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="2.2" font-family="ui-monospace,monospace" fill="#8e826b">AUXILIARY FIELD · LAB · EXPERIMENT 05</text></g>`;
  const lid = `<g transform="translate(${x3} ${y1})"><text x="${W / 2}" y="${D / 2 + 1.5}" text-anchor="middle" font-size="3.6" font-family="Georgia" fill="${ink}">♥ ♦ ♣ ♠</text></g>`;
  const glue = `<text transform="translate(${G / 2} ${y2 + H / 2}) rotate(-90)" text-anchor="middle" font-size="2.4" font-family="ui-monospace,monospace" fill="#8e826b">GLUE</text>`;
  return `<svg viewBox="-5 -5 ${x5 + 10} ${y5 + 10}" width="${x5 + 10}mm" height="${y5 + 10}mm" aria-hidden="true"><path d="${cut}" fill="${PAPER}" stroke="${ink}" stroke-width=".35"/>${folds}${ASSETS ? `<image href="${ASSETS}box-front.jpg" x="${x1}" y="${y2}" width="${W}" height="${H}" preserveAspectRatio="none"/><image href="${ASSETS}box-back.jpg" x="${x3}" y="${y2}" width="${W}" height="${H}" preserveAspectRatio="none"/>` : front + back}${side(x2)}${side(x4)}${lid}${glue}</svg>`;
}
/** the rules as a folded insert for the box: six panels of 60 × 85 mm on one sheet, 180 × 170 mm
 *  — fold the sheet in half (the bottom row is printed upside down, so it reads once folded
 *  behind), then in three; it fits in the box */
export function insertHtml(): string {
  const panel = (title: string, inner: string, cls = '') => `<div class="ins-panel ${cls}"><div class="ins-title">${title}</div>${inner}</div>`;
  const sec = (name: string) => { const x = RULES_TEXT.find((r) => r.title === name)!; return x.body.map((b) => `<p>${esc(b)}</p>`).join(''); };
  const cover = `<div class="ins-cover"><div class="ins-h1">Markovs<br>Chains</div><div class="ins-sub">A GAME OF FINITE PROBABILITIES<br>ON A POKER DECK</div><svg viewBox="0 0 63 88" style="width:26mm;margin:3mm auto;display:block">${cardSvg({ suit: 3, rank: 7 }, 0, 'ins').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg><p style="text-align:center">2–4 players · 20 minutes</p>${sec('What you need')}</div>`;
  const top = [panel('', cover, 'cover'), panel('Setup', sec('Setup')), panel('Build', sec('Build'))];
  const bottom = [panel('Race', sec('Race')), panel('Winning · The Joker', sec('Winning') + '<div class="ins-sub2">The Joker</div>' + sec('The Joker')), panel('Reading a card · The first lesson', sec('Reading a card') + '<div class="ins-sub2">The first lesson</div>' + sec('The first lesson'))];
  return `<div class="ins-sheet"><div class="ins-row">${top.join('')}</div><div class="ins-row ins-flip">${bottom.join('')}</div><div class="ins-fold ins-fold-h"></div><div class="ins-fold ins-fold-v" style="left:60mm"></div><div class="ins-fold ins-fold-v" style="left:120mm"></div></div>`;
}
/* ─── the playtest pages: version, changelog, evaluation, and the method ────────────────────── */
const PLAYTEST = 'https://parc.land/@c15r/playtest';
const PLAYTEST_GAME = 'markovs-chains';
interface PlaytestData {
  game: { game?: { name?: string; climb?: { rounds?: number; status?: string } }; head: { version: number; hash: string; createdAt: string; rules: string } | null; versions: Array<{ version: number; status: string; rationale?: string; createdAt: string }>; evals: Array<{ id: string; version: number; train: number; test: number; tag: string; harness?: string; createdAt: string; engine: string }>; rounds: Array<{ round: number; from: number; to: number; decision: string; delta: { train: number; test: number }; reason: string; createdAt: string; bot?: { n: number; targets?: { base: number; cand: number; delta: number; se: number | null } | null; measures?: Record<string, { base: number; cand: number; delta: number; se: number | null }> } }>; suite: { train: { seeds: number[]; players: number[] }; test: { seeds: number[]; players: number[] }; epsilon: number; noise?: number; probe?: number }; engine: string; harness?: string };
  eval?: { train: { score: number; targets?: { score: number; bands: Record<string, { mean: number; lo: number; hi: number; band: number }> } | null; critique?: { index: number; dims: Record<string, number>; n: number } | null }; test: { score: number; n: number }; bot?: { n: number; measures: Record<string, { mean: number; se: number }>; targets?: { score: number } | null } | null; tag: string; createdAt: string } | null;
}
let playtestData: PlaytestData | null = null;
const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
const versionOf = (rules?: string) => /^version:\s*"?([\d.]+)"?/m.exec(rules ?? '')?.[1] ?? '?';
function playtestHtml(): string {
  const d = playtestData;
  const link = `${PLAYTEST}/#/g/${PLAYTEST_GAME}`;
  if (!d) return `<section class="print-page rules-page pt-page"><h1>Playtest</h1><p class="lede">The definition under evaluation lives at <span class="mono">${link}</span>. The live numbers could not be fetched when this set was printed.</p></section>`;
  const g = d.game;
  const head = g.head;
  const headVersion = versionOf(head?.rules);
  const baseline = [...g.evals].reverse().find((e) => e.version === head?.version && /baseline/.test(e.tag)) ?? [...g.evals].reverse().find((e) => e.version === head?.version);
  const ev = d.eval;
  const kept = g.versions.filter((v) => v.status === 'head' || v.status === 'kept');
  const changelog = kept.slice(-5).reverse().map((v) => `<tr><td class="mono">#${v.version}</td><td class="mono">${v.createdAt.slice(5, 10)}</td><td>${esc((v.rationale ?? '').replace(/\s+/g, ' ').slice(0, 170))}${(v.rationale ?? '').length > 170 ? '…' : ''}</td></tr>`).join('');
  const rounds = g.rounds.slice(-6).reverse().map((r) => `<tr><td class="mono">${r.round}</td><td class="mono">#${r.from}→#${r.to}</td><td class="mono">${r.decision}</td><td class="mono">${r.delta.train >= 0 ? '+' : ''}${fmt(r.delta.train)} / ${r.delta.test >= 0 ? '+' : ''}${fmt(r.delta.test)}</td><td class="mono">${r.bot?.targets ? `${r.bot.targets.delta >= 0 ? '+' : ''}${fmt(r.bot.targets.delta)} ±${fmt(r.bot.targets.se, 3)}` : '—'}</td></tr>`).join('');
  const bands = ev?.train.targets?.bands ?? {};
  const targetsRows = Object.entries(bands).map(([k, b]) => `<tr><td class="mono">${k}</td><td class="mono">${fmt(b.mean, 2)}</td><td class="mono">${b.lo}–${b.hi}</td><td class="mono">${fmt(b.band, 2)}</td></tr>`).join('');
  const bot = ev?.bot?.measures ?? {};
  const measureRows = ['rolls', 'rounds', 'lays', 'covers', 'courtPlays', 'leadChanges', 'heldLead', 'offTurnWin', 'contenders', 'draw'].filter((k) => bot[k]).map((k) => `<tr><td class="mono">${k}</td><td class="mono">${fmt(bot[k].mean, 2)} ± ${fmt(bot[k].se, 2)}</td></tr>`).join('');
  const dims = ev?.train.critique?.dims ?? {};
  const dimRows = Object.entries(dims).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td class="mono">${k}</td><td class="mono">${fmt(v, 2)}</td></tr>`).join('');
  return `<section class="print-page rules-page pt-page"><h1>Playtest</h1>
<p class="lede">The rules printed here are the lab's physical game. The same design is evaluated as a definition in the playtest cell, where the head is <b>v${esc(headVersion)}</b> (definition #${head?.version ?? '?'}, ${head?.createdAt.slice(0, 10) ?? ''}), climbed over ${g.rounds.length} round${g.rounds.length === 1 ? '' : 's'}. Live: <span class="mono">${link}</span></p>
<div class="pt-cols">
<div><h2>Evaluation of the head</h2>
<p>${baseline ? `Baseline eval <span class="mono">${baseline.id}</span> (${baseline.createdAt.slice(0, 16).replace('T', ' ')}, harness ${baseline.harness ?? '?'}, engine ${baseline.engine.slice(0, 8)}): train <b>${fmt(baseline.train)}</b>, held-out test <b>${fmt(baseline.test)}</b>.` : 'No baseline yet.'} Suite: seeds ${g.suite.train.seeds.join(', ')} (train) and ${g.suite.test.seeds.join(', ')} (test) at ${g.suite.train.players.join(' and ')} players; gate ε ${g.suite.epsilon}, noise ${fmt(g.suite.noise ?? null, 4)}; questionnaire every ${g.suite.probe ?? 2}nd decision; ${ev?.bot?.n ?? 60} bot games.</p>
${targetsRows ? `<h2>Targets (the rules' bands, measured on the bot games)</h2><table class="pt-table"><tr><th>measure</th><th>mean</th><th>band</th><th>score</th></tr>${targetsRows}</table><p>Targets term ${fmt(ev?.train.targets?.score ?? null, 3)}.</p>` : ''}
${measureRows ? `<h2>Measures (bot games, mean ± SE)</h2><table class="pt-table"><tr><th>measure</th><th>value</th></tr>${measureRows}</table>` : ''}
</div>
<div>${dimRows ? `<h2>The judge's critique (0–4, mean over ${ev?.train.critique?.n ?? 12} games)</h2><table class="pt-table">${dimRows}</table><p>Index ${fmt(ev?.train.critique?.index ?? null, 3)}.</p>` : ''}
<h2>Rounds</h2><table class="pt-table"><tr><th>#</th><th>versions</th><th>decision</th><th>Δ train / test</th><th>Δ targets</th></tr>${rounds || '<tr><td colspan="5">none yet</td></tr>'}</table>
<h2>Changelog (kept definitions)</h2><table class="pt-table">${changelog}</table>
</div></div></section>`;
}
function methodHtml(): string {
  const text = METHOD_TEXT.map((r) => `<h2>${r.title}</h2>${r.body.map((b) => `<p>${esc(b)}</p>`).join('')}`).join('');
  return `<section class="print-page rules-page pt-page"><h1>Method</h1><p class="lede">How this game is tested and iterated: a lab of seeded simulations, and a playtest cell where a model plays, a model judges, the engine measures, and one change at a time is kept or reverted on the numbers.</p><div class="rules-cols">${text}</div></section>`;
}
/** fetch the live playtest numbers (the cell's public API; same origin on parc.land) and re-render */
async function loadPlaytest(): Promise<void> {
  try {
    const base = location.hostname === 'parc.land' ? '/@c15r/playtest' : PLAYTEST;
    const game = await (await fetch(`${base}/api/game/${PLAYTEST_GAME}`, { headers: { accept: 'application/json' } })).json();
    const head = game?.head?.version;
    const evals = (game?.evals ?? []) as PlaytestData['game']['evals'];
    const base_ = [...evals].reverse().find((e) => e.version === head && /baseline/.test(e.tag)) ?? [...evals].reverse().find((e) => e.version === head);
    const ev = base_ ? await (await fetch(`${base}/api/eval/${base_.id}`, { headers: { accept: 'application/json' } })).json() : null;
    setPlaytest({ game, eval: ev });
  } catch { /* the print set says so */ }
}
function setPlaytest(d: PlaytestData): void { playtestData = d; printSheet(); }

/** the print set: a page of rules, the box, the insert, then the 54 cards at poker size, nine
 *  a sheet (A4, cut on the card borders), then the playtest and method pages */
function printSheet() {
  const cards = pack();
  const sheets = Math.ceil(cards.length / 9);
  const pages: string[] = [];
  for (let i = 0; i < cards.length; i += 9) pages.push(`<section class="print-page"><div class="cap">MARKOVS CHAINS · CARDS 63 × 88 mm · SHEET ${i / 9 + 1} OF ${sheets} · cut on the borders</div><div class="print-grid">${cards.slice(i, i + 9).map((c, j) => `<div class="print-card">${cardSvg(c, 0, `p${i + j}`)}</div>`).join('')}</div></section>`);
  const rules = RULES_TEXT.map((r) => `<h2>${r.title}</h2>${r.body.map((b) => `<p>${esc(b)}</p>`).join('')}`).join('');
  $('print-sheet').innerHTML = `<section class="print-page rules-page"><h1>Markovs Chains</h1><p class="lede">A game of finite probabilities on a standard poker deck. Two to four players, one counter, one d6, 54 cards. Build a table of junction cards together; then race the one shared counter to your secret King.</p><div class="rules-cols">${rules}</div></section>
<section class="print-page"><div class="cap">MARKOVS CHAINS · THE BOX · 65 × 90 × 19 mm inside · card stock · cut the solid line, fold the dashed, glue the flap</div>${boxSvg()}</section>
<section class="print-page"><div class="cap">MARKOVS CHAINS · THE RULES, FOLDED · 180 × 170 mm · cut the outline; fold in half so the lower row turns up behind; then fold in three</div>${insertHtml()}</section>${pages.join('')}${playtestHtml()}${methodHtml()}`;
}
