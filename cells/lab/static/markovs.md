# Markovs Chains

A game of finite probabilities, on a standard poker deck. Two to four players, one counter, one
d6, 54 cards. This page is the digital prototype of a physical game: play it at one phone
(passed round, a curtain hiding the hand between turns) or against bots, and print the deck.

## The deck

Every card has a job on the table (`client/markovs/deck.ts`):

| cards | job |
|---|---|
| **2–10**, four suits | nine junction designs, four of each. A junction's six die faces each name an exit (north, east, south, west) or a stay; the faces turn with the card. |
| **Kings** | the four destinations, one a suit, laid at the middle of each edge |
| **Aces** | wild junctions: a cross, laid anywhere. The Ace of spades is START, in the centre |
| **Jacks** | reroute: instead of rolling, walk the counter one step your way |
| **Queens** | swap: exchange two junctions on the table |
| **Jokers** | chaos: instead of rolling, the counter takes one of its card's exits at random |

The nine junctions, as printed (face: exit): **2 STRAIGHT** 1–3 up, 4–6 down · **3 HOOK** 1–4
up, 5–6 right · **4 CROSS** 1 up, 2–3 right, 4 down, 5–6 left · **5 SPLIT** 1–2 up, 3–4 down,
5–6 stay · **6 ELBOW** 1–3 up, 4–6 right · **7 LOOP** 1–4 stay, 5–6 up · **8 BRIDGE** 1–4 up,
5–6 down · **9 FORK** 1–2 up, 3–4 right, 5–6 left · **10 T** 1–3 up, 4–5 right, 6 left. No two
are the same design turned. The suit on a junction is for the poker player; the game doesn't
read it (yet).

## The rules

1. **Deal.** The four Kings face up at the middle of each edge of a 5 × 5 table, the Ace of
   spades in the centre, the counter on it. Shuffle the rest. Each player takes one card face
   down: its suit is their King, and their secret (at two or three players the other Kings are
   decoys). Three cards each.
2. **Build.** In turns, lay one card from your hand, turned any way, on an empty space touching a
   laid card — or anywhere on the outer ring; an Ace anywhere. Draw back to three. If you can't
   lay, throw a card in and draw. No rolling. Build until no space is empty.
3. **Race.** On your turn: lay one card on top of any junction (not a King), or play a Queen to
   swap two junctions, or pass. Then roll. Find that face's arrow on the card under the counter
   and move one space that way; off the edge, come in on the far side; a loop face stays.
   Instead of rolling you may play a Jack or a Joker. Draw back to three.
4. **Winning.** The first time the counter arrives at your King, show your face-down card. A
   King nobody holds sends the counter back to the Ace. Thirty rolls without an arrival is a draw.

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
- On the poker deck (120–150 games a line, bots one action ahead): wrapping round the edge halves
  the stalls (19% → 9% of rolls); laying on the rim changes little on its own; both together at
  two players is 47/49 with 5% draws in 9 rolls, at four 15% draws in 10 rolls, and a random
  player wins 2%. Jacks and Jokers are what rescue a stalled counter (without them 19% of rolls
  stall). A bot that reads opponents' placements to guess their suit beats one that doesn't,
  56–36 at two players: the secret is real information, and hiding it is real play. Three
  players still favours the first mover (43% v a fair 30%); open.


## The page

`client/markovs/table.ts` holds the deal, every legal action and the bot; `page.ts` draws the
table and the poker cards as SVG (and the print sheet: 54 cards at 63 × 88 mm, one page of
rules). `?players=2..4&bots=0111&seed=1941&wrap=1&rim=1`. "Peek at my King" shows your suit;
"use your own die" takes a real roll. `?mode=physical` is the earlier grid prototype;
`?mode=challenge|duel|workshop` the four-state chain. Tests: `node cells/lab/devtools/markovs.test.mjs`.

## Open

- Whether the junctions' suits should matter (a Queen swaps only within a suit? a King's own
  suit lays for free?).
- Jack and Joker balance: the bot plays them when they beat the roll by a margin; people will
  play them for drama.
- A two-player variant with two Kings each.
- The hand under the table on phones.
