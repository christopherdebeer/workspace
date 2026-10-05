---
name: "Markovs Chains"
version: "3.1"
players: 2-4
win_condition: "The shared counter arrives at the King of your secret suit"
max_turns: 60

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

  # The table: a 5×5 grid of card spaces, the Kings at the middle of each edge, the start
  # card (the Ace of spades) in the centre with the one shared counter on it. Build it, then
  # race: the counter follows the die faces printed on the card it stands on.
  junction_chain:
    size: 5
    start: "2,2"
    start_card: "origin"
    kings: { hearts: "2,0", diamonds: "4,2", clubs: "2,4", spades: "0,2" }
    wrap: true
    rim: true
    cover: true
    hand: 3
    forecast: 4

  card_type_rules:
    junction: { playable: false, placeable: false, holdable: true, tradeable: false }
    court: { playable: false, placeable: false, holdable: true, tradeable: false }

  cards:
    starting_hand: 3
    draw_action: false   # hands refill by rule; drawing is not a move
    deck:
      # === START (the Ace of spades, fixed in the centre) and the WILD aces ===
      - { name: "origin", count: 0, type: "junction", role: "start", exits: "N1 E2 S1 W2" }
      - { name: "A♥ WILD", count: 1, type: "junction", suit: "hearts", role: "wild", exits: "N1 E2 S1 W2" }
      - { name: "A♦ WILD", count: 1, type: "junction", suit: "diamonds", role: "wild", exits: "N1 E2 S1 W2" }
      - { name: "A♣ WILD", count: 1, type: "junction", suit: "clubs", role: "wild", exits: "N1 E2 S1 W2" }
      # === JUNCTIONS: rank is the shape, suit the temperament; exits = faces per direction ===
      # hearts — the current (leans one way)
      - { name: "2♥ THROUGH", count: 1, type: "junction", suit: "hearts", exits: "N4 S2" }
      - { name: "3♥ TURN", count: 1, type: "junction", suit: "hearts", exits: "N4 E2" }
      - { name: "4♥ TEE", count: 1, type: "junction", suit: "hearts", exits: "N4 E1 W1" }
      - { name: "5♥ CROSS", count: 1, type: "junction", suit: "hearts", exits: "N3 E1 S1 W1" }
      - { name: "6♥ EDDY", count: 1, type: "junction", suit: "hearts", exits: "N5 stay1" }
      - { name: "7♥ SWITCH", count: 1, type: "junction", suit: "hearts", exits: "N4 E1 stay1" }
      - { name: "8♥ WEIR", count: 1, type: "junction", suit: "hearts", exits: "N4 S1 stay1" }
      - { name: "9♥ FORK", count: 1, type: "junction", suit: "hearts", exits: "N3 E1 W1 stay1" }
      - { name: "10♥ BACKTURN", count: 1, type: "junction", suit: "hearts", exits: "N2 E4" }
      # diamonds — the mirror (even-handed)
      - { name: "2♦ THROUGH", count: 1, type: "junction", suit: "diamonds", exits: "N3 S3" }
      - { name: "3♦ TURN", count: 1, type: "junction", suit: "diamonds", exits: "N3 E3" }
      - { name: "4♦ TEE", count: 1, type: "junction", suit: "diamonds", exits: "N2 E2 W2" }
      - { name: "5♦ CROSS", count: 1, type: "junction", suit: "diamonds", exits: "N2 E1 S2 W1" }
      - { name: "6♦ EDDY", count: 1, type: "junction", suit: "diamonds", exits: "N3 stay3" }
      - { name: "7♦ SWITCH", count: 1, type: "junction", suit: "diamonds", exits: "N2 E2 stay2" }
      - { name: "8♦ WEIR", count: 1, type: "junction", suit: "diamonds", exits: "N2 S2 stay2" }
      - { name: "9♦ FORK", count: 1, type: "junction", suit: "diamonds", exits: "N2 E1 W1 stay2" }
      - { name: "10♦ BACKTURN", count: 1, type: "junction", suit: "diamonds", exits: "N3 W2 stay1" }
      # clubs — the thicket (one more branch)
      - { name: "2♣ THROUGH", count: 1, type: "junction", suit: "clubs", exits: "N3 E1 S2" }
      - { name: "3♣ TURN", count: 1, type: "junction", suit: "clubs", exits: "N3 E2 W1" }
      - { name: "4♣ TEE", count: 1, type: "junction", suit: "clubs", exits: "N2 E2 S1 W1" }
      - { name: "5♣ CROSS", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 S1 W1 stay1" }
      - { name: "6♣ EDDY", count: 1, type: "junction", suit: "clubs", exits: "N3 E1 stay2" }
      - { name: "7♣ SWITCH", count: 1, type: "junction", suit: "clubs", exits: "N2 E2 W1 stay1" }
      - { name: "8♣ WEIR", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 S2 stay1" }
      - { name: "9♣ FORK", count: 1, type: "junction", suit: "clubs", exits: "N1 E3 W1 stay1" }
      - { name: "10♣ BACKTURN", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 W3" }
      # spades — the well (holds a while)
      - { name: "2♠ THROUGH", count: 1, type: "junction", suit: "spades", exits: "N2 S1 stay3" }
      - { name: "3♠ TURN", count: 1, type: "junction", suit: "spades", exits: "N2 E1 stay3" }
      - { name: "4♠ TEE", count: 1, type: "junction", suit: "spades", exits: "N1 E1 W1 stay3" }
      - { name: "5♠ CROSS", count: 1, type: "junction", suit: "spades", exits: "N1 E1 S1 W1 stay2" }
      - { name: "6♠ EDDY", count: 1, type: "junction", suit: "spades", exits: "N2 stay4" }
      - { name: "7♠ SWITCH", count: 1, type: "junction", suit: "spades", exits: "N1 E1 stay4" }
      - { name: "8♠ WEIR", count: 1, type: "junction", suit: "spades", exits: "N1 S1 stay4" }
      - { name: "9♠ FORK", count: 1, type: "junction", suit: "spades", exits: "N1 E2 W1 stay2" }
      - { name: "10♠ BACKTURN", count: 1, type: "junction", suit: "spades", exits: "N2 W1 stay3" }
      # === THE COURT and the JOKERS (events) ===
      - { name: "J REROUTE", count: 4, type: "court", role: "reroute", effect: { type: "none", description: "Instead of rolling, walk the counter one space in a direction of your choice" } }
      - { name: "Q SWAP", count: 4, type: "court", role: "swap", effect: { type: "none", description: "Instead of laying a card, exchange two junctions on the table" } }
      - { name: "JOKER CHAOS", count: 2, type: "court", role: "chaos", effect: { type: "none", description: "Instead of rolling, the counter takes one of its exits at random" } }

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
stays. Instead of the roll you may play a Jack (walk the counter one space your way) or a Joker (a random exit). Draw back to three.

## Winning

The first time the counter arrives at the King of your suit, show your face-down card: you win.
Arriving at a King nobody holds sends the counter back to the Ace of spades. Sixty turns
without an arrival is a draw.

Don't say which King is yours. Every card you lay says a little.

## Strategy

- A lay is the decision: where, which card, which way up — and what it tells the others.
- Hearts run, spades hold: a line of hearts toward a King is a chute; a well of spades in front of one is a bog. Clubs scatter the counter; diamonds are fair.
- In the race, covering the card under the counter changes its very next move; covering further off is a promise the others may undo.

## Engine (implemented)

The `junction_chain` mechanic (cells/playtest/engine/mechanics/junction-chain.ts) owns the table, the counter, the two phases, the roll at the end of a race turn, the court cards and the decoy rule; hidden_objectives holds the secret suits and `counter_at` is read by the chain. A free simulation harness of the same rules is `cells/lab/devtools/markovs-sim.mjs`.

## Design notes for the judge

- The decision is the lay: where, which card, which way up, and what it tells the others.
- Hidden information is real: a bot that reads which King each opponent's placements have
  been helping beats one that doesn't (56–36 at two players).
- Simulated at four players under the reference rules: ~15% draws, ten rolls after a
  six-placement build, a random player wins 2%. Three players favour the first mover.
