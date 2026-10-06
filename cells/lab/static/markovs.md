# Markovs Chains

A game of finite probabilities, on a standard poker deck. Two to four players, one counter, one
d6, 54 cards. This page is the digital prototype of a physical game: play it at one phone
(passed round, a curtain hiding the hand between turns) or against bots, and print the deck.

## The deck

Every card has a job on the table (`client/markovs/deck.ts`):

| cards | job |
|---|---|
| **3–10**, four suits | thirty-two junctions in play, every one different. The rank is the shape, the suit its temperament. A junction's six die faces each name an exit (north, east, south, west) or a stay; the faces turn with the card. |
| **Twos** | the commissions: shuffled face down, one dealt to each player — its suit is their King, their secret; the rest back in the box unseen |
| **Kings** | the four destinations, one a suit, laid at the middle of each edge |
| **Aces** | wild junctions: a cross (1 north, 2–3 east, 4 south, 5–6 west), laid on any empty square and turned like any card. The Ace of spades is START, in the centre |
| **Jacks** | reroute: instead of rolling, walk the counter one square your way |
| **Queens** | swap: exchange two junctions on the table; the counter stays on its square |
| **Jokers** | chaos: instead of rolling, ignore the faces — the counter takes one of its card's outward exits at random (north, east, south, west; two exits 1–3/4–6, three 1–2/3–4/5–6, four 1–4 and reroll 5–6) |

**The temperaments:** ♥ *the River* leans one way (four faces on its main exit); ♦ *the mirror*
is even-handed; ♣ *the thicket* grows one more branch than the shape has; ♠ *the well* holds a
while (three or four faces stay). **The shapes**, by rank, with each suit's faces as
up / right / down / left / stay:

| rank | shape | ♥ River | ♦ mirror | ♣ thicket | ♠ well |
|---|---|---|---|---|---|
| 2 | THROUGH | ↑4 ↓2 | ↑3 ↓3 | ↑3 →1 ↓2 | ↑2 ↓1 ·3 |
| 3 | TURN | ↑4 →2 | ↑3 →3 | ↑3 →2 ←1 | ↑2 →1 ·3 |
| 4 | TEE | ↑4 →1 ←1 | ↑2 →2 ←2 | ↑2 →2 ↓1 ←1 | ↑1 →1 ←1 ·3 |
| 5 | CROSS | ↑3 →1 ↓1 ←1 | ↑2 →1 ↓2 ←1 | ↑2 →1 ↓1 ←1 ·1 | ↑1 →1 ↓1 ←1 ·2 |
| 6 | EDDY | ↑5 ·1 | ↑3 ·3 | ↑3 →1 ·2 | ↑2 ·4 |
| 7 | SWITCH | ↑4 →1 ·1 | ↑2 →2 ·2 | ↑2 →2 ←1 ·1 | ↑1 →1 ·4 |
| 8 | WEIR | ↑4 ↓1 ·1 | ↑2 ↓2 ·2 | ↑2 →1 ↓2 ·1 | ↑1 ↓1 ·4 |
| 9 | FORK | ↑3 →1 ←1 ·1 | ↑2 →1 ←1 ·2 | ↑1 →3 ←1 ·1 | ↑1 →2 ←1 ·2 |
| 10 | BACKTURN | ↑2 →4 | ↑3 ←2 ·1 | ↑2 →1 ←3 | ↑2 ←1 ·3 |

**The dress** (`static/markovs/`, served by the cell as the page's assets): the four suits are
painted places — the River, the Mirror, the Thicket, the Well — and each junction wears its
suit's scene above the arrows, the frame, a sigil in the margin, a divider, and the suit's plate
with the shape's name. The court is painted whole: the Jacks are the Wayfinders, the Queens the
Exchange, the Kings the four places. Jokers and the plain fallback (no assets) stay drawn.

No two are the same card turned (the test checks all thirty-six; the Twos, the simplest, are
the ones dealt as commissions). Nobody memorises them: the
faces are printed, and read off the card under the counter at the moment of the roll. What the
thirty-six buy is depth in planning — what might still come out of the pile — and a table
whose character you can read from across the room: a line of hearts is a chute, a corner of
spades a bog.

## The rules

The full text is `client/markovs/text.ts` (the print sheet, the insert in the box and the page
all read it). In short:

1. **Deal.** The Ace of spades in the centre of a 5 × 5 table of squares (about 9 cm each, so a
   card fits either way up), the counter on it. The four Twos shuffled face down, one each: its
   suit is your King, your secret; the rest back in the box. The four Kings shuffled and dealt
   one each face up: the King you will place, not necessarily the one you want (with fewer than
   four players the undealt King stands one square clockwise of its edge's middle, a destination
   nobody holds). Three cards each.
2. **The court.** In turns, place your dealt King on an empty square of the outer ring: never the
   middle of an edge, not beside the counter, not beside another King — so every King is at
   least three steps from the centre. Nothing else happens until every King is placed; the last
   to place one takes the first turn.
3. **Race.** A turn is one landscape action and one movement, in either order. The landscape
   action: lay one card, turned any way, on an empty square touching a laid card or anywhere on
   the outer ring (an Ace on any empty square) or on top of a junction (not a King); or play a
   Queen to swap two junctions; or hold. The movement: roll; only the card under the counter
   decides the move: that face's arrow, one square; off the edge, in on the far side; a stay
   face stays. Instead of rolling you may play a Jack or a Joker. Draw back to three; an empty
   pile means play on with what you hold.
4. **Winning.** When the counter reaches a King someone holds, that player shows their Two and
   wins — whoever moved the counter. A King nobody holds sends the counter back to the centre.
   Thirty movement turns without an arrival is a draw.

Don't say which King is yours. Every card you lay says a little — and so does where you put a King.

(This is v4.2, the playtest head. The build-then-race game of v3.2 — Kings fixed at the edge middles, the table built full before any roll — is what the simulation below plays; `devtools/markovs-sim.mjs` keeps it for the sweeps.)

## Why these rules (the simulation)

`devtools/markovs-sim.mjs` plays rule sets against each other with the same bots (random, and
one action ahead judged by a short forecast of its own King's chances) and scores draws, length,
first-player edge and the gap between the bot and a random player. What it found, on the way
here:

- The four-state chain (the first version) was solved: the same two placements won every deal,
  and the displayed odds led you to them.
- A 5×5 junction race with corner destinations (the second version) rewarded skill but drew a
  third of its games and stalled on 40% of rolls, with a large first-player edge.
- Building the whole table before racing, and putting the destinations at the edge middles,
  cut draws to under 10% and halved the stalls; secret suits became worth hiding (a random
  player wins about 1% at four).
- On the poker deck as it now stands (150 games a line, the Twos as commissions, bots one
  action ahead that know only their own suit and count a decoy King as a return to the start):
  wrap and rim together at two players is 55/43 with 2% draws in 8 moves; at three 5% draws in 9
  moves with the first mover on 39% (fair would be 32%); at four 19% draws in 13 moves, the
  first mover on 21%, and a random player wins 2%. Stalls are 16–22% of moves. Without the court
  cards the race is shorter (9 moves) but stalls more (29%). A bot that reads opponents'
  placements to guess their suit beats one that doesn't, 58–37 at two players: the secret is
  real information, and hiding it is real play.
- **Does the race rewrite the build?** The review's main question. With covering allowed
  anywhere, 51–68% of race lays go on the card under the counter, and 51–59% of moves still land
  on an uncovered build card. The variant — any junction but the one under the counter — keeps
  the same share of moves on build cards (55–57%) and is better on every other column: draws at
  four players 19% → 4%, three 5% → 3%; races 13 → 8 moves; the first mover at three 39% → 33%;
  stalls 22% → 16%. Covering the counter's own card is how a bot bogs the counter down, and the
  draws come from that. The variant is the first thing to propose to the judge, and the first
  thing to try at a table.


## The page

`client/markovs/table.ts` holds the deal, every legal action and the bot; `page.ts` draws the
table — square parking spaces, so a card fits either way up — and the poker cards as SVG; the
card under the counter is read out in plain faces ("1–4 north · 5 east · 6 stays"), and so is
a card in the hand as you turn it. `?players=2..4&bots=0111&seed=1941&wrap=1&rim=1`. "Peek at
my King" shows your suit; "use your own die" takes a real roll. `?mode=physical` is the earlier
grid prototype; `?mode=challenge|duel|workshop` the four-state chain. Tests:
`node cells/lab/devtools/markovs.test.mjs`.

**The print set** ("print cards + rules", A4, nine pages, nothing split or clipped): a page of
rules; the tuck box as a die-line (65 × 90 × 19 mm inside, for card stock: cut the solid line,
fold the dashed, glue the flap); the rules as a folded insert for the box (six panels of
60 × 85 mm on one 180 × 170 mm sheet — fold in half so the lower row, printed upside down,
turns up behind, then in three); and six sheets of nine cards at 63 × 88 mm.
`devtools/markovs-print.mjs <dir>` renders it to PDF and PNGs and measures every page.

## After the review

A review of the previous version asked for the written and implemented rules to be reconciled
before any more mechanics, and for the print export to be repaired. Done, as above: the Twos as
commissions (one suit each, guaranteed distinct, the same deal at the table and on the page),
Aces that turn like any card (their cross is not symmetric), a Joker procedure for a die, the
counter staying put through a Queen's swap, the centre square as the reset, "thirty movement
turns" rather than rolls, the empty pile, and the two sentences that matter most — only the card
under the counter decides a move; the King's owner wins whoever moved the counter — in the rules
and the insert. The bot's forecast now counts a decoy King as a return to the start (in
expectation, knowing only its own suit) and measures distance round the wrap. The review's
hypothesis about covering is answered above, in simulation; it still wants a table of people.

## The judge

The same rules are a definition in the playtest cell (`static/markovs-rules.md`, game
`markovs-chains`), played by Jev through the `junction_chain` engine mechanic
(`cells/playtest/engine/mechanics/junction-chain.ts`): the table, the counter, the build and the
race, the court cards and the decoy rule. A race turn is two steps there (lay, swap or hold; then
roll, Jack or Joker) so that the judge sees the consequences of a lay as a forecast of each King's
chances and never a simulated roll (harness h11). Hands refill at the start of a turn, so the
deck never moves during an action. Suite: seeds 1–6 and 101–106 at three and four players.

The judge's score turned out too coarse for the changes a rules edit makes: sixteen rated
dimensions averaged into a 0.55–0.66 band, mechanical terms saturated at 1, twelve paired games
with a standard error near 0.01 and a 0.02 gate — so a court moved off the cardinals, which the
sim and the pace numbers both liked, was reverted twice for +0.004. Since score v4.3 the mechanic
measures each game itself (off-turn win, forecast lead changes, whether the halfway favourite
won, contenders with a live route at the end, lays, covers, court plays, draw, rounds), the
rules declare `targets` bands on those measures, their suite means score a targets term (a
quarter of the suite score), every climb round reports each measure's paired delta with its
standard error, and the free `screen` plays hundreds of bot games through the same engine and
reports the same measures with standard errors — the fine instrument, with the judge suite kept
for health and critique.

That instrument kept the first change the coarse one had rejected three times. v4.2 (round 5):
the court keeps off the four edge middles, so no King is a two-step chute from the centre.
Paired on sixty bot games: movement turns 8.7 → 13.0 (±1.1), lead changes 2.6 → 3.8 (±0.5), the
halfway favourite winning 73% → 48% (±8), draws 2% → 7% (±3); on the twelve judged games, one
over in two rounds instead of eight. Train +0.026, test +0.021.

The questionnaire (h18–h19): on every second judged decision the acting player is asked, after
choosing and before the move resolves, what they were trying to do, whether anyone is close to
winning (checked against the engine's own forecast), how much better the move was than the next
best, and how likely someone wins before their next turn; and about their last probed turn,
whether the table went their way, whether the counter's movement was expected or surprising or
confusing, how much of it was the cards rather than the die, and whether they changed their
plan. The answers are `q_*` measures beside the engine's, so targets can band them and rounds
report their deltas. The first version taught which questions discriminate: threat calls against
the engine (v4.2 cut false alarms 69% → 38% and the urgency error 0.37 → 0.23) and the revised
plan do; "several alternatives", "as I expected" and "earlier moves mattered" sat at a ceiling,
so v2 asks those as scores with a concrete reference.

## The transition sweep

`devtools/markovs-sweep.mjs` rewrites the suits' die faces along four axes and plays the poker
game under the sim's bots (120 games a line, four greedy; a skill line with one random player);
`BUILD=0|10` plays the court game with no build or a short one, `KINGS=corners|rim` moves the
Kings. The scorecard adds the forecast's lead changes per game, whether the halfway leader won,
and off-turn wins: games decided by someone else's roll.

- **Stays are the draw lever.** Two fewer stay faces on every card: draws 20% → 3%, stalls 21%
  → 5%, the same median length, more off-turn wins. Two more: draws 33%, stalls 46%. One fewer
  on any single suit trims draws by a third; clubs' stays matter most.
- **Back faces are the length lever.** One more face on the back exit of every card: median
  race 13 → 9 rolls; one fewer: 14–15 rolls and more draws.
- **Lean barely moves outcomes** (skill gap 27–31 points across the range); pulling the
  temperaments apart (hearts leaner, spades stiller) raises stalls without buying anything.
- **Kings off the cardinals change who wins, not how soon.** In the court game with no build,
  edge-middle Kings give off-turn wins of 3%: the winner is almost always the roller, laying a
  two-step chute and rolling it. Kings in the corners, or anywhere on the rim but a cardinal,
  lift that to 15–19% and trim draws (18% → 13%); with a short build of ten, rim Kings have the
  fewest draws of any cell (7%). But the shortest tenth of games stays at four or five rolls
  under every placement, with or without the court cards: four players laying a card a turn
  put a three-step chute down within a round whoever wanted it, and under wrap a King one
  square off a cardinal is still three from the centre. The floor is the players, not the
  table.

So: Kings on the rim, off the cardinals, as the next rules change (interaction and draws); a
stay reduction of one face per card, spades keeping their character, as the one after; and
diagonals, if at all, only on the Aces.

## Open

- The cover-under variant, with people: how often they cover the counter's card, how many build
  cards the counter uses, whether anyone can say how an early lay helped or hurt.
- Whether the junctions' suits should matter (a Queen swaps only within a suit? a King's own
  suit lays for free?).
- Jack and Joker balance: the bot plays them when they beat the roll by a margin; people will
  play them for drama.
- A two-player variant with two Kings each.
- The hand under the table on phones.
