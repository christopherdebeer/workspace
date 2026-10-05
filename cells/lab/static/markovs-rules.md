---
name: "Markovs Chains"
version: "3.0"
players: 2-4
win_condition: "The shared counter arrives at the King of your secret suit"
max_rounds: 30

# Each player is dealt one objective face down: a suit. Their King is their destination.
# (At two or three players the undealt Kings are decoys.)
objectives:
  - { name: "Hearts", count: 1, type: "regular", condition: "The counter arrives at the King of hearts (north edge)", check: { counter_at: "K♥" } }
  - { name: "Diamonds", count: 1, type: "regular", condition: "The counter arrives at the King of diamonds (east edge)", check: { counter_at: "K♦" } }
  - { name: "Clubs", count: 1, type: "regular", condition: "The counter arrives at the King of clubs (south edge)", check: { counter_at: "K♣" } }
  - { name: "Spades", count: 1, type: "regular", condition: "The counter arrives at the King of spades (west edge)", check: { counter_at: "K♠" } }

mechanics:
  hidden_objectives:
    deal_at_start: true
    reveal_on_completion: true
  victory_declaration: true

  # The table: a 5×5 grid of card spaces. The Ace of spades (origin) is laid in the centre,
  # the four Kings at the middle of each edge. New cards go on empty spaces touching a laid
  # card, or anywhere on the outer ring; an Ace anywhere; a card may be laid on top of a
  # junction once no space is empty (build) or at any time in the race.
  grid:
    type: "bounded"
    bounds: { width: 5, height: 5 }
    starting_tile: "origin"
    adjacency: "orthogonal"
    fixed_tiles:
      - { card: "K♥ DESTINATION", at: [2, 0] }
      - { card: "K♦ DESTINATION", at: [4, 2] }
      - { card: "K♣ DESTINATION", at: [2, 4] }
      - { card: "K♠ DESTINATION", at: [0, 2] }
    placement: { touching: true, rim_anywhere: true, cover: true, rotate: true }
    wrap: true
  place_location: true

  # ONE counter, shared by everyone, starts on the origin. Movement is not chosen: on a
  # roll, the counter follows the exit printed for that die face on the card it stands on,
  # as that card is turned. A stay face holds it. An exit off the edge comes in on the far
  # side. Arriving at a King nobody holds returns the counter to the origin.
  shared_counter:
    start: "origin"
    resolve: "junction_faces"
    off_edge: "wrap"
    decoy_destination: "return_to_start"
  junction_routing:
    faces: 6
    directions: ["N", "E", "S", "W", "stay"]
    rotate_with_card: true

  # Two phases: build (lay a card each turn, no rolling, until no space is empty) then race
  # (lay or play or pass, then roll — or play a Jack / Joker instead of the roll).
  phases:
    - { name: "build", until: "no_empty_space", turn: ["place_location | discard"] }
    - { name: "race", turn: ["place_location | play_card | pass", "roll | play_card(instead_of_roll)"] }

  dice_rolling:
    dice_count: 1
    dice_sides: 6
    roll_action: true
    roll_purposes: ["move_counter"]

  hand_limit: 3
  hand_limit_policy: "cannot_draw"
  card_type_rules:
    location: { playable: false, placeable: true, holdable: true, tradeable: false }
    event: { playable: true, placeable: false, holdable: true, tradeable: false }

  cards:
    starting_hand: 3
    deck:
      # === DESTINATIONS (fixed on the table; never drawn) ===
      - { name: "K♥ DESTINATION", count: 0, type: "location", suit: "hearts", role: "destination" }
      - { name: "K♦ DESTINATION", count: 0, type: "location", suit: "diamonds", role: "destination" }
      - { name: "K♣ DESTINATION", count: 0, type: "location", suit: "clubs", role: "destination" }
      - { name: "K♠ DESTINATION", count: 0, type: "location", suit: "spades", role: "destination" }
      # === START (the Ace of spades, fixed in the centre) and the WILD aces ===
      - { name: "origin", count: 0, type: "location", role: "start", exits: "N1 E2 S1 W2" }
      - { name: "A♥ WILD", count: 1, type: "location", suit: "hearts", role: "wild", anywhere: true, exits: "N1 E2 S1 W2" }
      - { name: "A♦ WILD", count: 1, type: "location", suit: "diamonds", role: "wild", anywhere: true, exits: "N1 E2 S1 W2" }
      - { name: "A♣ WILD", count: 1, type: "location", suit: "clubs", role: "wild", anywhere: true, exits: "N1 E2 S1 W2" }
      # === JUNCTIONS: rank is the shape, suit the temperament; exits = faces per direction ===
      # hearts — the current (leans one way)
      - { name: "2♥ THROUGH", count: 1, type: "location", suit: "hearts", exits: "N4 S2" }
      - { name: "3♥ TURN", count: 1, type: "location", suit: "hearts", exits: "N4 E2" }
      - { name: "4♥ TEE", count: 1, type: "location", suit: "hearts", exits: "N4 E1 W1" }
      - { name: "5♥ CROSS", count: 1, type: "location", suit: "hearts", exits: "N3 E1 S1 W1" }
      - { name: "6♥ EDDY", count: 1, type: "location", suit: "hearts", exits: "N5 stay1" }
      - { name: "7♥ SWITCH", count: 1, type: "location", suit: "hearts", exits: "N4 E1 stay1" }
      - { name: "8♥ WEIR", count: 1, type: "location", suit: "hearts", exits: "N4 S1 stay1" }
      - { name: "9♥ FORK", count: 1, type: "location", suit: "hearts", exits: "N3 E1 W1 stay1" }
      - { name: "10♥ BACKTURN", count: 1, type: "location", suit: "hearts", exits: "N2 E4" }
      # diamonds — the mirror (even-handed)
      - { name: "2♦ THROUGH", count: 1, type: "location", suit: "diamonds", exits: "N3 S3" }
      - { name: "3♦ TURN", count: 1, type: "location", suit: "diamonds", exits: "N3 E3" }
      - { name: "4♦ TEE", count: 1, type: "location", suit: "diamonds", exits: "N2 E2 W2" }
      - { name: "5♦ CROSS", count: 1, type: "location", suit: "diamonds", exits: "N2 E1 S2 W1" }
      - { name: "6♦ EDDY", count: 1, type: "location", suit: "diamonds", exits: "N3 stay3" }
      - { name: "7♦ SWITCH", count: 1, type: "location", suit: "diamonds", exits: "N2 E2 stay2" }
      - { name: "8♦ WEIR", count: 1, type: "location", suit: "diamonds", exits: "N2 S2 stay2" }
      - { name: "9♦ FORK", count: 1, type: "location", suit: "diamonds", exits: "N2 E1 W1 stay2" }
      - { name: "10♦ BACKTURN", count: 1, type: "location", suit: "diamonds", exits: "N3 W2 stay1" }
      # clubs — the thicket (one more branch)
      - { name: "2♣ THROUGH", count: 1, type: "location", suit: "clubs", exits: "N3 E1 S2" }
      - { name: "3♣ TURN", count: 1, type: "location", suit: "clubs", exits: "N3 E2 W1" }
      - { name: "4♣ TEE", count: 1, type: "location", suit: "clubs", exits: "N2 E2 S1 W1" }
      - { name: "5♣ CROSS", count: 1, type: "location", suit: "clubs", exits: "N2 E1 S1 W1 stay1" }
      - { name: "6♣ EDDY", count: 1, type: "location", suit: "clubs", exits: "N3 E1 stay2" }
      - { name: "7♣ SWITCH", count: 1, type: "location", suit: "clubs", exits: "N2 E2 W1 stay1" }
      - { name: "8♣ WEIR", count: 1, type: "location", suit: "clubs", exits: "N2 E1 S2 stay1" }
      - { name: "9♣ FORK", count: 1, type: "location", suit: "clubs", exits: "N1 E3 W1 stay1" }
      - { name: "10♣ BACKTURN", count: 1, type: "location", suit: "clubs", exits: "N2 E1 W3" }
      # spades — the well (holds a while)
      - { name: "2♠ THROUGH", count: 1, type: "location", suit: "spades", exits: "N2 S1 stay3" }
      - { name: "3♠ TURN", count: 1, type: "location", suit: "spades", exits: "N2 E1 stay3" }
      - { name: "4♠ TEE", count: 1, type: "location", suit: "spades", exits: "N1 E1 W1 stay3" }
      - { name: "5♠ CROSS", count: 1, type: "location", suit: "spades", exits: "N1 E1 S1 W1 stay2" }
      - { name: "6♠ EDDY", count: 1, type: "location", suit: "spades", exits: "N2 stay4" }
      - { name: "7♠ SWITCH", count: 1, type: "location", suit: "spades", exits: "N1 E1 stay4" }
      - { name: "8♠ WEIR", count: 1, type: "location", suit: "spades", exits: "N1 S1 stay4" }
      - { name: "9♠ FORK", count: 1, type: "location", suit: "spades", exits: "N1 E2 W1 stay2" }
      - { name: "10♠ BACKTURN", count: 1, type: "location", suit: "spades", exits: "N2 W1 stay3" }
      # === THE COURT and the JOKERS (events) ===
      - { name: "J REROUTE", count: 4, type: "event", effect: { type: "walk_counter", value: 1, description: "Instead of rolling, move the counter one space in a direction of your choice (onto a card)" } }
      - { name: "Q SWAP", count: 4, type: "event", effect: { type: "swap_tiles", description: "Instead of laying a card, exchange two junctions on the table (not Kings); the counter stays where it is" } }
      - { name: "JOKER CHAOS", count: 2, type: "event", effect: { type: "random_exit", description: "Instead of rolling, the counter takes one of its card's exits at random" } }
---

# Markovs Chains

## Overview

A game of finite probabilities on a standard poker deck. Two to four players, one counter, one
d6, 54 cards. Build a table of junction cards together; then race the one shared counter to
your secret King.

## The deck

- **2–10, four suits (36 junctions).** The rank is the shape, the suit its temperament: hearts
  (*the current*) lean one way, diamonds (*the mirror*) are even-handed, clubs (*the thicket*)
  grow one more branch, spades (*the well*) hold a while. A junction's six die faces each name
  an exit (north, east, south, west) or a stay; `exits: "N4 E2"` means faces 1–4 go north and
  5–6 east. The faces turn with the card. No two junctions are the same card turned.
- **Kings:** the four destinations, one a suit, laid face up at the middle of each edge.
- **Aces:** wild junctions (a cross, 1 north / 2–3 east / 4 south / 5–6 west), laid anywhere.
  The Ace of spades is START, in the centre.
- **Jacks:** reroute — instead of rolling, walk the counter one space the way you choose.
- **Queens:** swap — instead of laying a card, exchange two junctions on the table.
- **Jokers:** chaos — instead of rolling, the counter takes one of its card's exits at random.

## Setup

Lay the four Kings at the middles of the edges of an imaginary 5 × 5 table, the Ace of spades
in the centre, the counter on it. Shuffle the rest. Each player takes one card face down: its
suit is their King, and their secret (deal again if two players share a suit). Three cards each.

## Gameplay

A turn is one lay (and, in the race, one roll). Two phases:

### Build

In turns, lay one card from your hand, turned any way you like, on an empty space touching a
laid card, or anywhere on the outer ring; an Ace anywhere. Draw back to three. If you cannot
lay, throw a card in and draw. No rolling. Build until no space is empty.

### Race

On your turn: lay one card on top of any junction (not a King), or play a Queen to swap two
junctions, or pass. Then roll the d6. Find that face's arrow on the card under the counter and
move the counter one space that way; off the edge, it comes in on the far side; a loop face
stays. Instead of rolling you may play a Jack or a Joker. Draw back to three.

## Winning

The first time the counter arrives at the King of your suit, show your face-down card: you win.
Arriving at a King nobody holds sends the counter back to the Ace of spades. Thirty rolls
without an arrival is a draw.

Don't say which King is yours. Every card you lay says a little.

## What the engine needs (declared, not yet implemented)

This definition declares mechanics the engine does not have; until it does, a playtest plays
a different game. They are, in the order they matter:

1. `shared_counter` — one counter for all players (not an avatar each), moved by the table.
2. `junction_routing` — a laid card's exits by die face, turned with the card; a stay face.
3. `grid.placement` — rotation on laying, laying on the outer ring, covering a junction;
   `grid.wrap` — an exit off the edge comes in opposite; `grid.fixed_tiles` for the Kings.
4. `phases` — build (no rolling, until the table is full) then race.
5. `objectives[].check.counter_at` — a destination check on the shared counter, with the
   decoy rule (nobody's King returns the counter to the origin).
6. Event effects `walk_counter`, `swap_tiles`, `random_exit` for the court and the jokers.

A free reference implementation of all six is `cells/lab/client/markovs/{deck,table}.ts`
(pure TypeScript: the deal, every legal action, movement, a one-action-ahead bot), with a
simulation harness (`cells/lab/devtools/markovs-sim.mjs`) that plays rule variants against
each other and reports draws, length, first-player edge and skill gap.

## Design notes for the judge

- The decision is the lay: where, which card, which way up, and what it tells the others.
- Hidden information is real: a bot that reads which King each opponent's placements have
  been helping beats one that doesn't (56–36 at two players).
- Simulated at four players under the reference rules: ~15% draws, ten rolls after a
  six-placement build, a random player wins 2%. Three players favour the first mover.
