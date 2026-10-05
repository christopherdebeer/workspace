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

**The temperaments:** ♥ *the current* leans one way (four faces on its main exit); ♦ *the mirror*
is even-handed; ♣ *the thicket* grows one more branch than the shape has; ♠ *the well* holds a
while (three or four faces stay). **The shapes**, by rank, with each suit's faces as
up / right / down / left / stay:

| rank | shape | ♥ current | ♦ mirror | ♣ thicket | ♠ well |
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

No two are the same card turned (the test checks all thirty-six; the Twos, the simplest, are
the ones dealt as commissions). Nobody memorises them: the
faces are printed, and read off the card under the counter at the moment of the roll. What the
thirty-six buy is depth in planning — what might still come out of the pile — and a table
whose character you can read from across the room: a line of hearts is a chute, a corner of
spades a bog.

## The rules

The full text is `client/markovs/text.ts` (the print sheet, the insert in the box and the page
all read it). In short:

1. **Deal.** The four Kings face up at the middle of each edge of a 5 × 5 table of squares (about
   9 cm each, so a card fits either way up), the Ace of spades in the centre, the counter on it.
   The four Twos shuffled face down, one each: its suit is your King, your secret; the rest back
   in the box (at two or three players the undealt Kings are decoys). Three cards each.
2. **Build.** In turns, lay one card from your hand, turned any way, on an empty square touching a
   laid card — or anywhere on the outer ring; an Ace on any empty square. Arrows needn't line
   up. Draw back to three. If you can't lay, throw a card in and draw. No rolling. Build until
   no square is empty.
3. **Race.** On your turn: lay one card on top of any junction (not a King), or play a Queen to
   swap two junctions, or pass. Then roll. Only the card under the counter decides the move:
   that face's arrow, one square; off the edge, in on the far side; a stay face stays. Instead
   of rolling you may play a Jack or a Joker. Draw back to three; an empty pile means play on
   with what you hold.
4. **Winning.** When the counter reaches a King someone holds, that player shows their Two and
   wins — whoever moved the counter. A King nobody holds sends the counter back to the centre.
   Thirty movement turns without an arrival is a draw.

Don't say which King is yours. Every card you lay says a little.

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
`devtools/out/markovs-print.mjs <dir>` renders it to PDF and PNGs and measures every page.

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

## Open

- The cover-under variant, with people: how often they cover the counter's card, how many build
  cards the counter uses, whether anyone can say how an early lay helped or hurt.
- Whether the junctions' suits should matter (a Queen swaps only within a suit? a King's own
  suit lays for free?).
- Jack and Joker balance: the bot plays them when they beat the roll by a margin; people will
  play them for drama.
- A two-player variant with two Kings each.
- The hand under the table on phones.
