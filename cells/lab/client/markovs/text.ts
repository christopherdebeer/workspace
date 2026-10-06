/**
 * The rules of Markovs Chains, in words — one source for the print sheet, the folded insert in
 * the box, and the page's own help. Every sentence here is a rule the table (table.ts) enforces.
 */
export interface Section { title: string; body: string[] }

export const RULES_TEXT: Section[] = [
  { title: 'What you need', body: [
    'This deck (an ordinary poker deck will do with the card sheet beside it as a lookup: the junctions’ exits are printed, not standard), one counter, one six-sided die, and a table big enough for a 5 × 5 grid of squares about 9 cm wide — a card has to fit each square either way up. Two to four players; twenty minutes.',
  ] },
  { title: 'Setup', body: [
    'Put the Ace of spades in the centre square of the grid and the counter on it.',
    'Take the four Twos. Shuffle them face down and deal one to each player: its suit is your King, and your secret. Put the undealt Twos back in the box without looking.',
    'Shuffle the four Kings and deal one to each player face up: that is the King you will place, not necessarily the one you want. With fewer than four players, stand the undealt King on the outer ring one square clockwise of the middle of its edge (hearts north, diamonds east, clubs south, spades west): a destination nobody holds.',
    'Shuffle the rest face down as the pile. Deal three cards each.',
  ] },
  { title: 'The court', body: [
    'Starting with the player left of the dealer and going clockwise, place your dealt King face up on an empty square of the outer ring — never the middle square of an edge, not beside (orthogonally next to) the counter’s square, and not beside another King. So every King stands at least three steps from the centre; a corner is four.',
    'Nothing else happens until every King is placed. The player who places the last King takes the first turn of the race.',
  ] },
  { title: 'Race', body: [
    'A turn is one landscape action and one movement, in either order.',
    'The landscape action: lay one card from your hand, turned by quarter turns any way you like, on an empty square that touches (shares an edge with) a laid card or on any empty square of the outer ring (an Ace on any empty square), or on top of a junction already laid (never a King) — the covered card goes face up to the discard, the table never stacks; or play a Queen to swap two junctions, each keeping its turn, even the one under the counter (the counter stays on its square); or hold, which is always allowed. Instead of holding you may throw a card in face up to be rid of it. Played and discarded cards are out of the game.',
    'The movement: roll the die, find that face on the card under the counter, and move one square the way its arrow points. Off the edge, the counter comes in on the far side. A stay face, or an arrow with no card beyond it, leaves the counter where it is. Arrows need not line up with the neighbours’: only the card under the counter ever decides a move.',
    'Instead of rolling you may play a Jack — walk the counter one square in any direction you choose, ignoring the printed exits, round the edge as a roll would, onto any card including a King — or a Joker: ignore the printed faces, the counter takes one of the card’s outward exits at random (see The Joker).',
    'Draw back to three. When the pile is empty, play on with what you hold.',
  ] },
  { title: 'Winning', body: [
    'When the counter reaches a King that someone holds, that player shows their Two and wins — whoever moved the counter.',
    'A King nobody holds sends the counter back to the centre square; the count of movement turns goes on. Thirty movement turns without an arrival is a draw.',
    'Don’t say which King is yours. Every card you lay says a little — and so does where you put a King.',
  ] },
  { title: 'The Joker', body: [
    'Count the card’s distinct outward exits that lead to a card, in the order north, east, south, west. Two exits: 1–3 takes the first, 4–6 the second. Three: 1–2, 3–4, 5–6. Four: 1 to 4, and roll again on a 5 or 6. One exit: take it. None: the counter stays.',
  ] },
  { title: 'Reading a card', body: [
    'Six die faces, each an exit or a stay, printed as ranges beside the arrows: 7♠ SWITCH reads 1 north, 2 east, 3–6 stay. Turn the card and the arrows turn with it: a quarter turn clockwise makes that 1 east, 2 south, 3–6 stay.',
    'The rank is the shape — 3 TURN, 4 TEE, 5 CROSS, 6 EDDY, 7 SWITCH, 8 WEIR, 9 FORK, 10 BACKTURN; the Twos are the commissions — and the suit its temperament, a place: ♥ the River leans one way, ♦ the Mirror is even-handed, ♣ the Thicket grows one more branch, ♠ the Well holds a while. The Kings are those places; the Jacks are Wayfinders, the Queens the Exchange. No two junctions are the same card turned.',
  ] },
  { title: 'The first lesson', body: [
    'Before a first game: put the counter on any junction and say where each die face sends it. Turn the card a quarter and say it again. Lay a second card beside it and resolve two rolls. Now add a King — and a secret about who wants it. That is the whole game.',
  ] },
];

/** The method: how the design is tested and iterated, for the print set's method page. */
export const METHOD_TEXT: Section[] = [
  { title: 'Two tables', body: [
    'The game is developed on two tables. The lab table is this page and its simulation: seeded bots play the physical rules hundreds of times a line, and sweeps rewrite the die faces, the Kings\' places and the build to see what each lever does to draws, length, first-player edge and the skill gap. The playtest table is the @c15r/playtest cell: the same rules as a definition (YAML frontmatter and prose) played by a language-model player through a rules engine, judged by a model, scored, and climbed one change at a time.',
  ] },
  { title: 'The loop', body: [
    'A definition is classified (what it asks of the engine, what is missing), then evaluated over a fixed suite: six training seeds and six held-out seeds at three and four players, each game judged and scored; sixty bot games by a greedy stand-in for the measures; and, on every second decision of a judged game, the questionnaire. The first evaluation of a head is the baseline; a re-run of the head measures the noise floor. A proposal is one change with a rationale drawn from the training runs only. It is kept when the training score improves by at least the gate (epsilon, noise and the paired standard error, whichever is largest) and the held-out score improves too, or when the targets the rules declare improve on the bot games by more than their jackknife error with the judged suite inside its noise floor. Otherwise it is reverted. Three rounds without a keep is a stall, and the climb stops to diagnose.',
  ] },
  { title: 'What is measured', body: [
    'A run\'s score is a weighted sum: finished by its own rules; the judge\'s critique over sixteen dimensions; the judge\'s confidence that the game plays as designed; variety of moves; real choice per turn; pace (movement turns in the band the rules ask for); and no engine faults. The suite adds definition health, outcome balance across the secret suits, and the targets term. The engine measures each game directly: movement turns, lays and covers, court cards played, forecast lead changes, whether the halfway favourite won, games decided by someone else\'s roll, contenders with a live route at the end, draws. The rules declare target bands on those measures; that is the designer\'s own definition of better, measured in volume rather than inferred from a rating.',
  ] },
  { title: 'The questionnaire', body: [
    'Fun is not one number. After a player has chosen and before the move resolves, they are asked what they were trying to do, whether anyone is close to winning (checked against the engine\'s forecast), how much better their move was than the next best, and how likely someone wins before their next turn; and, about their last probed turn, whether the table went their way, whether the counter\'s movement was expected, surprising or confusing, how much of it was the cards rather than the die, and whether they changed their plan. Answers are private, predictions come before outcomes, and the wording always allows "nothing happened". They become measures beside the engine\'s, so a change can be seen to raise anticipation or authorship, not just a score.',
  ] },
  { title: 'Reading the numbers', body: [
    'A score near 0.9 is a game that plays as designed; differences of a few hundredths are inside the noise of twelve judged games, which is why the measures and the bot split exist. A round\'s record lists every measure\'s paired delta with its standard error, so the reason for a keep or a revert is a number with an error bar, not a verdict. Model judgements are evidence about legibility and structure, not about human enjoyment; the table of people decides that.',
  ] },
];
