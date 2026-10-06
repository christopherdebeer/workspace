---
name: "Markovs Chains"
version: "4.1"
players: 2-4
win_condition: "The shared counter arrives at the King of your secret suit"
max_turns: 90

# Each player is dealt one hidden commission (a suit: physically a Two) and, separately, one
# King to place in the opening court. The King in your hand is not necessarily your destination.
# With fewer than four players the undealt suit's King is a neutral destination on the rim.
objectives:
  - { name: "Hearts", count: 1, type: "regular", condition: "The counter arrives at the King of hearts (north edge)", check: { counter_at: "K♥" } }
  - { name: "Diamonds", count: 1, type: "regular", condition: "The counter arrives at the King of diamonds (east edge)", check: { counter_at: "K♦" } }
  - { name: "Clubs", count: 1, type: "regular", condition: "The counter arrives at the King of clubs (south edge)", check: { counter_at: "K♣" } }
  - { name: "Spades", count: 1, type: "regular", condition: "The counter arrives at the King of spades (west edge)", check: { counter_at: "K♠" } }

mechanics:
  hidden_objectives:
    deal_at_start: true
    reveal_on_completion: true

  # The table: a 5×5 grid of card spaces, the Ace of spades in the centre with the one shared
  # counter on it. The Kings are dealt and placed in an opening court; then, from the first
  # turn, lay and move: the counter follows the die faces printed on the card it stands on.
  junction_chain:
    dynamic: true
    flexible_order: true
    king_mode: dealt
    size: 5
    start: "2,2"
    start_card: "origin"
    kings: { hearts: "2,0", diamonds: "4,2", clubs: "2,4", spades: "0,2" }
    wrap: true
    rim: true
    cover: true
    hand: 3
    forecast: 4
    moves: 30      # movement turns in the race; no arrival by then is a draw

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
      # (the four Twos are the commissions, dealt as the secret suits: out of play)
      # hearts — the current (leans one way)
      - { name: "3♥ TURN", count: 1, type: "junction", suit: "hearts", exits: "N4 E2" }
      - { name: "4♥ TEE", count: 1, type: "junction", suit: "hearts", exits: "N4 E1 W1" }
      - { name: "5♥ CROSS", count: 1, type: "junction", suit: "hearts", exits: "N3 E1 S1 W1" }
      - { name: "6♥ EDDY", count: 1, type: "junction", suit: "hearts", exits: "N5 stay1" }
      - { name: "7♥ SWITCH", count: 1, type: "junction", suit: "hearts", exits: "N4 E1 stay1" }
      - { name: "8♥ WEIR", count: 1, type: "junction", suit: "hearts", exits: "N4 S1 stay1" }
      - { name: "9♥ FORK", count: 1, type: "junction", suit: "hearts", exits: "N3 E1 W1 stay1" }
      - { name: "10♥ BACKTURN", count: 1, type: "junction", suit: "hearts", exits: "N2 E4" }
      # diamonds — the mirror (even-handed)
      - { name: "3♦ TURN", count: 1, type: "junction", suit: "diamonds", exits: "N3 E3" }
      - { name: "4♦ TEE", count: 1, type: "junction", suit: "diamonds", exits: "N2 E2 W2" }
      - { name: "5♦ CROSS", count: 1, type: "junction", suit: "diamonds", exits: "N2 E1 S2 W1" }
      - { name: "6♦ EDDY", count: 1, type: "junction", suit: "diamonds", exits: "N3 stay3" }
      - { name: "7♦ SWITCH", count: 1, type: "junction", suit: "diamonds", exits: "N2 E2 stay2" }
      - { name: "8♦ WEIR", count: 1, type: "junction", suit: "diamonds", exits: "N2 S2 stay2" }
      - { name: "9♦ FORK", count: 1, type: "junction", suit: "diamonds", exits: "N2 E1 W1 stay2" }
      - { name: "10♦ BACKTURN", count: 1, type: "junction", suit: "diamonds", exits: "N3 W2 stay1" }
      # clubs — the thicket (one more branch)
      - { name: "3♣ TURN", count: 1, type: "junction", suit: "clubs", exits: "N3 E2 W1" }
      - { name: "4♣ TEE", count: 1, type: "junction", suit: "clubs", exits: "N2 E2 S1 W1" }
      - { name: "5♣ CROSS", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 S1 W1 stay1" }
      - { name: "6♣ EDDY", count: 1, type: "junction", suit: "clubs", exits: "N3 E1 stay2" }
      - { name: "7♣ SWITCH", count: 1, type: "junction", suit: "clubs", exits: "N2 E2 W1 stay1" }
      - { name: "8♣ WEIR", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 S2 stay1" }
      - { name: "9♣ FORK", count: 1, type: "junction", suit: "clubs", exits: "N1 E3 W1 stay1" }
      - { name: "10♣ BACKTURN", count: 1, type: "junction", suit: "clubs", exits: "N2 E1 W3" }
      # spades — the well (holds a while)
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
d6, 54 cards. The Kings are placed first, in an opening court; then, from the first turn, lay
junction cards and move the one shared counter toward the King of your secret commission. Only
the card under the counter ever decides a move.

## The deck

- **3–10, four suits (32 junctions).** The rank is the shape, the suit its temperament: hearts
  (*the River*) lean one way, diamonds (*the Mirror*) are even-handed, clubs (*the Thicket*)
  grow one more branch, spades (*the Well*) hold a while. A junction's six die faces each name
  an exit (north, east, south, west) or a stay; `exits: "N4 E2"` means faces 1–4 go north and
  5–6 east. The faces turn with the card. No two junctions are the same card turned.
- **Twos:** the commissions. Shuffled face down, one dealt to each player: its suit is the King
  you want the counter to reach, and your secret. The rest go back in the box unseen.
- **Kings:** the four destinations. Dealt one to each player, separately from the commission:
  the King you hold may be someone else's destination. Each is placed in the opening court. With
  fewer than four players the undealt King is a neutral destination on the rim.
- **Aces:** wild junctions (a cross: 1 north, 2–3 east, 4 south, 5–6 west; turned like any
  card), laid on any empty square. The Ace of spades is START, in the centre.
- **Jacks:** reroute — instead of rolling, walk the counter one square the way you choose.
- **Queens:** swap — instead of laying a card, exchange two junctions; the counter stays on its
  square.
- **Jokers:** chaos — instead of rolling, ignore the printed faces: the counter takes one of its
  card's distinct outward exits that lead to a card, at random (north, east, south, west in
  that order; with a die, two exits 1–3/4–6, three 1–2/3–4/5–6, four 1–4 and reroll 5–6).

## Setup

Put the Ace of spades in the centre of an imaginary 5 × 5 table of squares, the counter on it.
Deal each player one Two face down (the commission) and one King face up. Shuffle the rest;
three cards each.

## Gameplay

### The opening court

In turn order, each player places their dealt King on an empty square of the outer ring, not
beside the counter and not beside another King. Nothing else happens until every King is placed:
no junction, no movement, no win. Placing a King costs nothing else. The player who places the
last King takes the first full turn.

### The race

From then on, each turn is one landscape action and one movement, in either order. A landscape
action is laying one junction from your hand on an empty square touching a laid card or on the
outer ring (an Ace anywhere), covering a junction already laid, playing a Queen to swap two
junctions, or holding. Movement is a roll of the d6, a Jack, or a Joker: the counter follows the
face printed on the card under it; off the edge, it comes in on the far side; a stay face, or an
arrow with no card beyond, leaves it where it is. Draw back to three.

## Winning

When the counter reaches a King whose suit matches a player's commission, that player shows
their Two and wins — whoever moved the counter. A King nobody's commission names sends the
counter back to the centre square. Thirty movement turns without an arrival is a draw.

Don't say which King is yours. Every card you lay says a little — and so does where you put a
King.

## Strategy

- A lay is the decision: where, which card, which way up — and what it tells the others.
- Hearts run, spades hold: a line of hearts toward a King is a chute; a well of spades in front of one is a bog. Clubs scatter the counter; diamonds are fair.
- Covering the card under the counter changes its very next move; covering further off is a promise the others may undo.

## Engine (implemented)

The `junction_chain` mechanic (cells/playtest/engine/mechanics/junction-chain.ts) owns the table, the counter, the opening court (`king_mode: dealt`), the turn of one landscape action and one movement in either order (`dynamic`, `flexible_order`), the court cards, the decoy rule and the draw at thirty moves; hidden_objectives holds the secret commissions and `counter_at` is read by the chain. The build-then-race game of v3.2 is the same mechanic with those three flags off; the lab's simulation harness (`cells/lab/devtools/markovs-sim.mjs`) plays that one.

## Design notes for the judge

- The decision is the lay: where, which card, which way up, and what it tells the others; and in the court, where you put a King that may not be yours.
- Hidden information is real: the commission is never shown until it wins.
- The open question: with no build phase, is the table rich enough? The free screen reports how many squares are laid when the game ends and how many moves a game lasts.
