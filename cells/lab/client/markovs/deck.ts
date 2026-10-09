/**
 * Markovs Chains on a standard poker deck.
 *
 * Fifty-two cards and two jokers, every one with a job on the table:
 * - **2–10, four suits:** thirty-six junctions. The rank is the shape (through, a turn, a tee…)
 *   and the suit its temperament: hearts (the river) lean one way, diamonds (the mirror) are even-handed, clubs grow one
 *   more branch, spades hold a while. A junction's six die faces each name an exit (north,
 *   east, south, west) or a stay; the faces turn with the card.
 * - **Kings:** the four destinations, one a suit, laid at the middle of each edge of a 5×5 table.
 * - **Aces:** wild junctions — a cross that can be laid anywhere, touching the chain or not. One
 *   Ace is START, in the middle.
 * - **Jacks:** reroute — instead of rolling, walk the counter one step the way you choose.
 * - **Queens:** swap — exchange two junctions on the table, counter and all.
 * - **Jokers:** chaos — instead of rolling, the counter takes one of its card's exits at random.
 *
 * The four Twos are the commissions: shuffled face down, one dealt to each player (its suit is
 * their secret destination), the rest back in the box unseen. So thirty-two junctions are in
 * play. (At two or three players the undealt Kings are decoys: a counter arriving at one goes
 * back to START.)
 * Build the table first, in turns, until no space is
 * empty; then race: place or play, roll, move. First arrival at your own King wins.
 *
 * Everything here is pure, so the page, the bots and the simulation read the same rules.
 */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ['north', 'east', 'south', 'west'];
export const SUITS = ['♥', '♦', '♣', '♠'];
export const SUIT_NAMES = ['hearts', 'diamonds', 'clubs', 'spades'];
export const SIZE = 5;

/** The four temperaments: how a suit spreads its six faces over a shape. */
export const TEMPER = ['the river', 'the mirror', 'the thicket', 'the well'];
/** the four places, as the Kings name them */
export const PLACES = ['The River', 'The Mirror', 'The Thicket', 'The Well'];
export const TEMPER_NOTE = ['leans one way', 'even-handed', 'one more branch', 'holds a while'];
/** The nine shapes, by rank; for each, the four suits' weights over [north, east, south, west,
 *  stay]. Thirty-six junctions, no two the same under rotation (the test checks). */
export const SHAPES: Record<number, { name: string; note: string; faces: number[][] }> = {
  2: { name: 'THROUGH', note: 'Through, on or back.', faces: [[4, 0, 2, 0, 0], [3, 0, 3, 0, 0], [3, 1, 2, 0, 0], [2, 0, 1, 0, 3]] },
  3: { name: 'TURN', note: 'A turn to the right.', faces: [[4, 2, 0, 0, 0], [3, 3, 0, 0, 0], [3, 2, 0, 1, 0], [2, 1, 0, 0, 3]] },
  4: { name: 'TEE', note: 'On, left or right.', faces: [[4, 1, 0, 1, 0], [2, 2, 0, 2, 0], [2, 2, 1, 1, 0], [1, 1, 0, 1, 3]] },
  5: { name: 'CROSS', note: 'Four ways from here.', faces: [[3, 1, 1, 1, 0], [2, 1, 2, 1, 0], [2, 1, 1, 1, 1], [1, 1, 1, 1, 2]] },
  6: { name: 'EDDY', note: 'On, or held a while.', faces: [[5, 0, 0, 0, 1], [3, 0, 0, 0, 3], [3, 1, 0, 0, 2], [2, 0, 0, 0, 4]] },
  7: { name: 'SWITCH', note: 'On, right, or held.', faces: [[4, 1, 0, 0, 1], [2, 2, 0, 0, 2], [2, 2, 0, 1, 1], [1, 1, 0, 0, 4]] },
  8: { name: 'WEIR', note: 'On, back, or held.', faces: [[4, 0, 1, 0, 1], [2, 0, 2, 0, 2], [2, 1, 2, 0, 1], [1, 0, 1, 0, 4]] },
  9: { name: 'FORK', note: 'Three ways, or a pause.', faces: [[3, 1, 0, 1, 1], [2, 1, 0, 1, 2], [1, 3, 0, 1, 1], [1, 2, 0, 1, 2]] },
  10: { name: 'BACKTURN', note: 'A turn, leaning in.', faces: [[2, 4, 0, 0, 0], [3, 0, 0, 2, 1], [2, 1, 0, 3, 0], [2, 0, 0, 1, 3]] },
};
/** a junction's six die faces (an exit 0..3, or -1 to stay), before turning */
export function facesOf(card: Card): number[] {
  const w = card.rank === ACE ? [1, 2, 1, 2, 0] : SHAPES[card.rank].faces[card.suit];
  const out: number[] = [];
  for (let d = 0; d < 5; d++) for (let i = 0; i < w[d]; i++) out.push(d === 4 ? -1 : d);
  return out;
}
export const ACE = 1;
/** the rank dealt as commissions: one card of each suit, shuffled, one per player */
export const COMMISSION = 2;
export const JACK = 11;
export const QUEEN = 12;
export const KING = 13;
export const JOKER = 0;

export interface Card {
  suit: number;
  /** 1 ace … 13 king; 0 a joker */
  rank: number;
}
export const cardName = (c: Card) => (c.rank === JOKER ? 'Joker' : `${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][c.rank]}${SUITS[c.suit]}`);
export const roleOf = (c: Card) => (c.rank === JOKER ? 'CHAOS' : c.rank === ACE ? 'WILD' : c.rank === JACK ? 'REROUTE' : c.rank === QUEEN ? 'SWAP' : c.rank === KING ? 'DESTINATION' : SHAPES[c.rank].name);
/** a fresh pack: 52 and two jokers */
export function pack(): Card[] {
  const out: Card[] = [];
  for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) out.push({ suit, rank });
  out.push({ suit: 0, rank: JOKER }, { suit: 1, rank: JOKER });
  return out;
}
export function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** what lies on a space: a junction (a numbered card or an ace, turned), or a King */
export interface Tile {
  card: Card;
  rotation: number;
  start?: boolean;
  /** laid while the table was being built (and not covered since) */
  built?: boolean;
}
/** the Joker's exits: the card's distinct outward exits that lead to a card, north, east, south,
 *  west in that order — with a die: two exits 1–3/4–6, three 1–2/3–4/5–6, four 1–4 (reroll 5–6) */
export function chaosExits(board: Board, at: string, rules: Rules): string[] {
  const t = board.get(at);
  if (!t) return [];
  return [...new Set(exits(t).filter((d) => d >= 0))].sort().map((d) => neighbour(at, d, rules)).filter((n): n is string => !!n && board.has(n));
}
export type Board = Map<string, Tile>;
export const key = (x: number, y: number) => `${x},${y}`;
export const xy = (k: string) => k.split(',').map(Number) as [number, number];
export const isKing = (t: Tile | undefined) => !!t && t.card.rank === KING;
/** a junction's six exits as laid (turned); an ace is a cross, and turns like any card */
export function exits(t: Tile): number[] {
  if (t.card.rank === KING) return [-1, -1, -1, -1, -1, -1];
  return facesOf(t.card).map((d) => (d < 0 ? -1 : (d + t.rotation) % 4));
}
/** the Kings' places in the build-then-race game (v3.2, the simulation's): the middle of each
 *  edge, hearts north then clockwise. In the court game (v4.2, the table's) the Kings are dealt
 *  and placed by the players — anywhere on the rim but these four squares. */
export const KING_AT = [key(2, 0), key(4, 2), key(2, 4), key(0, 2)];
export const START = key(2, 2);
/** the Ace of spades in the centre; the Kings where `kings` says (by suit), or, with no court,
 *  at the edge middles */
export function setup(kings: Array<string | null> | 'none' = KING_AT): Board {
  const b: Board = new Map();
  b.set(key(2, 2), { card: { suit: 3, rank: ACE }, rotation: 0, start: true });
  if (kings !== 'none') kings.forEach((k, suit) => { if (k) b.set(k, { card: { suit, rank: KING }, rotation: 0 }); });
  return b;
}
/** where a King stands, if it has been placed */
export function kingAt(board: Board, suit: number): string | null {
  for (const [k, t] of board) if (t.card.rank === KING && t.card.suit === suit) return k;
  return null;
}
/** the court: a dealt King may go on any empty square of the outer ring that is not the middle
 *  of an edge, not beside the counter's square, and not beside another King */
export function canCrown(board: Board, k: string, counter: string = START): boolean {
  const [x, y] = xy(k);
  if (board.has(k)) return false;
  if (!(x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1)) return false;
  const mid = (SIZE - 1) / 2;
  if (x === mid || y === mid) return false;
  return !DIRS.some(([dx, dy]) => key(x + dx, y + dy) === counter || isKing(board.get(key(x + dx, y + dy))));
}
/** with fewer than four players, the undealt King stands one square clockwise of its edge's middle */
export function neutralKingAt(suit: number): string {
  const [x, y] = xy(KING_AT[suit]);
  const last = SIZE - 1;
  return y === 0 ? key(x + 1, 0) : x === last ? key(last, y + 1) : y === last ? key(x - 1, last) : key(0, y - 1);
}
export interface Rules {
  /** an exit off the edge comes in on the far side */
  wrap: boolean;
  /** a new card may be laid on any empty space of the outer ring, touching the chain or not */
  rim: boolean;
  /** in the race, a card may be laid on top of a junction */
  cover: boolean;
  /** in the race, the junction under the counter may be covered too (default yes; the variant
   *  to test if building turns out not to matter) */
  coverUnder?: boolean;
}
export const RULES: Rules = { wrap: false, rim: false, cover: true, coverUnder: true };
/** steps from a to b on the table, round the edge if it wraps */
export function distance(a: string, b: string, rules: Rules): number {
  const [ax, ay] = xy(a), [bx, by] = xy(b);
  const d = (u: number, v: number) => { const m = Math.abs(u - v); return rules.wrap ? Math.min(m, SIZE - m) : m; };
  return d(ax, bx) + d(ay, by);
}

/** one step from `at` in direction d, as the rules have it (null: off the table) */
export function neighbour(at: string, d: number, rules: Rules): string | null {
  const [x, y] = xy(at);
  let nx = x + DIRS[d][0];
  let ny = y + DIRS[d][1];
  if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) {
    if (!rules.wrap) return null;
    nx = (nx + SIZE) % SIZE;
    ny = (ny + SIZE) % SIZE;
  }
  return key(nx, ny);
}
/** where the counter goes from `at` on a die face (1..6), and why */
export function destination(board: Board, at: string, face: number, rules: Rules): { at: string; reason: 'move' | 'loop' | 'open' | 'king'; dir: number } {
  const t = board.get(at);
  if (!t || isKing(t)) return { at, reason: 'king', dir: -1 };
  const d = exits(t)[face - 1];
  if (d < 0) return { at, reason: 'loop', dir: d };
  const next = neighbour(at, d, rules);
  return next && board.has(next) ? { at: next, reason: 'move', dir: d } : { at, reason: 'open', dir: d };
}
/** may this card be laid here? (`phase`: building, or racing; `token`: where the counter is) */
export function canPlace(board: Board, k: string, card: Card, rules: Rules, phase: 'build' | 'race', token?: string): boolean {
  const [x, y] = xy(k);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  if (card.rank === KING || card.rank === JACK || card.rank === QUEEN || card.rank === JOKER) return false;
  const here = board.get(k);
  if (here) return !isKing(here) && (phase === 'race' ? rules.cover && (rules.coverUnder !== false || k !== token) : !hasEmpty(board));
  if (card.rank === ACE) return true;
  if (rules.rim && (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1)) return true;
  return DIRS.some(([dx, dy]) => {
    const t = board.get(key(x + dx, y + dy));
    return t && !isKing(t);
  });
}
export function hasEmpty(board: Board): boolean {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!board.has(key(x, y))) return true;
  return false;
}

/** The counter's chances: from `at`, over `hops` rolls, the mass arriving at each King (by suit),
 *  and where the rest is. Routes as they stand. A King nobody holds sends the counter back to
 *  START: a player knows only their own suit (`own`), so of the other three Kings, `players - 1`
 *  are held — each absorbs that share of what arrives, and the rest returns to the start. With
 *  no `own`, every King absorbs (the table's eye view). */
export function forecast(board: Board, at: string, rules: Rules, hops = 4, own?: number, players = 4): { wins: number[]; mass: Map<string, number> } {
  let mass = new Map<string, number>([[at, 1]]);
  const wins = [0, 0, 0, 0];
  const held = (suit: number) => (own === undefined || suit === own ? 1 : (players - 1) / 3);
  for (let h = 0; h < hops; h++) {
    const next = new Map<string, number>();
    for (const [k, m] of mass) {
      const t = board.get(k);
      if (isKing(t)) {
        const share = held(t!.card.suit);
        wins[t!.card.suit] += m * share;
        if (share < 1) next.set(START, (next.get(START) ?? 0) + m * (1 - share));
        continue;
      }
      for (let face = 1; face <= 6; face++) {
        const d = destination(board, k, face, rules).at;
        next.set(d, (next.get(d) ?? 0) + m / 6);
      }
    }
    mass = next;
  }
  for (const [k, m] of mass) {
    const t = board.get(k);
    if (isKing(t)) {
      const share = held(t!.card.suit);
      wins[t!.card.suit] += m * share;
      mass.delete(k);
      if (share < 1) mass.set(START, (mass.get(START) ?? 0) + m * (1 - share));
    }
  }
  return { wins, mass };
}
