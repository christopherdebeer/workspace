/**
 * Markovs Chains on a standard poker deck.
 *
 * Fifty-two cards and two jokers, every one with a job on the table:
 * - **2–10, four suits:** nine junction designs, four of each. A junction's six die faces each
 *   name an exit (north, east, south, west) or a stay; the faces turn with the card. The suit on
 *   a junction is for the poker player; the game doesn't read it (yet).
 * - **Kings:** the four destinations, one a suit, laid at the middle of each edge of a 5×5 table.
 * - **Aces:** wild junctions — a cross that can be laid anywhere, touching the chain or not. One
 *   Ace is START, in the middle.
 * - **Jacks:** reroute — instead of rolling, walk the counter one step the way you choose.
 * - **Queens:** swap — exchange two junctions on the table, counter and all.
 * - **Jokers:** chaos — instead of rolling, the counter takes one of its card's exits at random.
 *
 * Each player is dealt one card face down: its suit is their secret destination. (At two or
 * three players the other Kings are decoys.) Build the table first, in turns, until no space is
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

export interface Design {
  rank: number;
  name: string;
  /** die faces 1..6: an exit (0 N, 1 E, 2 S, 3 W, before rotation) or -1 to stay */
  faces: number[];
  note: string;
}
/** the nine junctions; no two the same under rotation */
export const DESIGNS: Design[] = [
  { rank: 2, name: 'STRAIGHT', faces: [0, 0, 0, 2, 2, 2], note: 'Through, either way.' },
  { rank: 3, name: 'HOOK', faces: [0, 0, 0, 0, 1, 1], note: 'Mostly on; sometimes a turn.' },
  { rank: 4, name: 'CROSS', faces: [0, 1, 1, 2, 3, 3], note: 'Four ways from here.' },
  { rank: 5, name: 'SPLIT', faces: [0, 0, 2, 2, -1, -1], note: 'Through, or held.' },
  { rank: 6, name: 'ELBOW', faces: [0, 0, 0, 1, 1, 1], note: 'A right-angle turn.' },
  { rank: 7, name: 'LOOP', faces: [-1, -1, -1, -1, 0, 0], note: 'Stay, or move on.' },
  { rank: 8, name: 'BRIDGE', faces: [0, 0, 0, 0, 2, 2], note: 'Through, leaning one way.' },
  { rank: 9, name: 'FORK', faces: [0, 0, 1, 1, 3, 3], note: 'One in, three out.' },
  { rank: 10, name: 'T', faces: [0, 0, 0, 1, 1, 3], note: 'Three directions, one favoured.' },
];
export const ACE = 1;
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
export const roleOf = (c: Card) => (c.rank === JOKER ? 'CHAOS' : c.rank === ACE ? 'WILD' : c.rank === JACK ? 'REROUTE' : c.rank === QUEEN ? 'SWAP' : c.rank === KING ? 'DESTINATION' : DESIGNS[c.rank - 2].name);
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
}
export type Board = Map<string, Tile>;
export const key = (x: number, y: number) => `${x},${y}`;
export const xy = (k: string) => k.split(',').map(Number) as [number, number];
export const isKing = (t: Tile | undefined) => !!t && t.card.rank === KING;
/** a junction's six exits as laid (turned); an ace is a cross */
export function exits(t: Tile): number[] {
  const faces = t.card.rank === ACE ? DESIGNS[2].faces : DESIGNS[t.card.rank - 2].faces;
  return faces.map((d) => (d < 0 ? -1 : (d + t.rotation) % 4));
}
/** the Kings' places: the middle of each edge, hearts north then clockwise */
export const KING_AT = [key(2, 0), key(4, 2), key(2, 4), key(0, 2)];
export function setup(): Board {
  const b: Board = new Map();
  b.set(key(2, 2), { card: { suit: 3, rank: ACE }, rotation: 0, start: true });
  KING_AT.forEach((k, suit) => b.set(k, { card: { suit, rank: KING }, rotation: 0 }));
  return b;
}
export interface Rules {
  /** an exit off the edge comes in on the far side */
  wrap: boolean;
  /** a new card may be laid on any empty space of the outer ring, touching the chain or not */
  rim: boolean;
  /** in the race, a card may be laid on top of a junction */
  cover: boolean;
}
export const RULES: Rules = { wrap: false, rim: false, cover: true };

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
/** may this card be laid here? (`phase`: building, or racing) */
export function canPlace(board: Board, k: string, card: Card, rules: Rules, phase: 'build' | 'race'): boolean {
  const [x, y] = xy(k);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  if (card.rank === KING || card.rank === JACK || card.rank === QUEEN || card.rank === JOKER) return false;
  const here = board.get(k);
  if (here) return !isKing(here) && (phase === 'race' ? rules.cover : !hasEmpty(board));
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
 *  and where the rest is. Routes as they stand. */
export function forecast(board: Board, at: string, rules: Rules, hops = 4): { wins: number[]; mass: Map<string, number> } {
  let mass = new Map<string, number>([[at, 1]]);
  const wins = [0, 0, 0, 0];
  for (let h = 0; h < hops; h++) {
    const next = new Map<string, number>();
    for (const [k, m] of mass) {
      const t = board.get(k);
      if (isKing(t)) {
        wins[t!.card.suit] += m;
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
      wins[t!.card.suit] += m;
      mass.delete(k);
    }
  }
  return { wins, mass };
}
