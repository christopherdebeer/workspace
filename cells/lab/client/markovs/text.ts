/**
 * The rules of Markovs Chains, in words — one source for the print sheet, the folded insert in
 * the box, and the page's own help. Every sentence here is a rule the table (table.ts) enforces.
 */
export interface Section { title: string; body: string[] }

export const RULES_TEXT: Section[] = [
  { title: 'What you need', body: [
    'A standard poker deck with both Jokers (this one, or any), one counter, one six-sided die, and a table big enough for a 5 × 5 grid of squares about 9 cm wide — a card has to fit each square either way up. Two to four players; twenty minutes.',
  ] },
  { title: 'Setup', body: [
    'Lay the four Kings face up at the middle of each edge of the grid: hearts north, diamonds east, clubs south, spades west. Put the Ace of spades in the centre square and the counter on it.',
    'Take the four Twos. Shuffle them face down and deal one to each player: its suit is your King, and your secret. Put the undealt Twos back in the box without looking.',
    'Shuffle the rest face down as the pile. Deal three cards each.',
  ] },
  { title: 'Build', body: [
    'In turns, lay one card from your hand, turned any way you like, on an empty square that touches a laid card — or on any empty square of the outer ring. An Ace may go on any empty square. Arrows need not line up with the neighbours’: only the card under the counter will ever decide a move.',
    'Draw back to three. If you cannot lay (a hand of court cards), throw one in face up and draw. No rolling. Build until no square is empty.',
  ] },
  { title: 'Race', body: [
    'On your turn, first one of: lay a card on top of any junction (never a King); play a Queen to swap two junctions (the counter stays on its square); or pass.',
    'Then move the counter. Roll the die, find that face on the card under the counter, and move one square the way its arrow points. Off the edge, the counter comes in on the far side. A stay face, or an arrow with no card beyond it, leaves the counter where it is.',
    'Instead of rolling you may play a Jack — walk the counter one square, your choice — or a Joker: ignore the printed faces, the counter takes one of the card’s outward exits at random (see The Joker).',
    'Draw back to three. When the pile is empty, play on with what you hold.',
  ] },
  { title: 'Winning', body: [
    'When the counter reaches a King that someone holds, that player shows their Two and wins — whoever moved the counter.',
    'A King nobody holds sends the counter back to the centre square. Thirty movement turns without an arrival is a draw.',
    'Don’t say which King is yours. Every card you lay says a little.',
  ] },
  { title: 'The Joker', body: [
    'Count the card’s distinct outward exits that lead to a card, in the order north, east, south, west. Two exits: 1–3 takes the first, 4–6 the second. Three: 1–2, 3–4, 5–6. Four: 1 to 4, and roll again on a 5 or 6. One exit: take it. None: the counter stays.',
  ] },
  { title: 'Reading a card', body: [
    'Six die faces, each an exit or a stay, printed as ranges beside the arrows: 7♠ SWITCH reads 1 north, 2 east, 3–6 stay. Turn the card and the arrows turn with it: a quarter turn clockwise makes that 1 east, 2 south, 3–6 stay.',
    'The rank is the shape — 2 THROUGH, 3 TURN, 4 TEE, 5 CROSS, 6 EDDY, 7 SWITCH, 8 WEIR, 9 FORK, 10 BACKTURN — and the suit its temperament, a place: ♥ the River leans one way, ♦ the Mirror is even-handed, ♣ the Thicket grows one more branch, ♠ the Well holds a while. The Kings are those places; the Jacks are Wayfinders, the Queens the Exchange. No two junctions are the same card turned.',
  ] },
  { title: 'The first lesson', body: [
    'Before a first game: put the counter on any junction and say where each die face sends it. Turn the card a quarter and say it again. Lay a second card beside it and resolve two rolls. Now add a King — and a secret about who wants it. That is the whole game.',
  ] },
];
