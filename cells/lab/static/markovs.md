# Markovs Chains

A game of finite probabilities. A first playable rules hypothesis inspired by Auxiliary Field's card sketches: diagrams as cards, stamped colour on warm stock, spare arrows, and a token caught between intention and chance.

## The first game: a finite journey

Four states sit clockwise: hearts, diamonds, clubs, spades. Start at hearts; visit clubs, then diamonds, within eight transitions. Diamonds before clubs does not finish the commission.

Five cards are offered. Choose one and then a state: its outgoing probabilities are replaced. Each card describes relative routes (stay, clockwise, across, anticlockwise) in four equal parts. Draw a replacement. You have four placements, or may release early. Undo is free during planning. After release, the sampled journey is final for that deal. Reset repeats the seeded deal and journey; next deal supplies a new seed.

The percentage is the exact finite-horizon probability of completing the ordered commission, calculated by propagating mass over state × commission progress. Progress is part of the state: it is a Markov process on this augmented state space. Successful arrivals are absorbing for the forecast and stop the animation. The simulation samples the same transition rows that the forecast and arrows show. A self-loop consumes a transition.

## Workshop

Free placement and repeat journeys. This is for discovering card combinations, not a scored mode. Share table copies a link containing the routing cards, hand, seed and placement count; it preserves a planning position, not an in-flight replay or complete undo/deck history.

## Art direction

Cream stock, dotted paper, serif title, monospaced registration text, red/gold/green/blue states, a card hand and curved arrows. The diagrams are generated natively as SVG, remaining crisp and interactive on phones. No reference image is copied into the game. The first iteration concentrates on the diagram/card language; the architectural/isometric card reference remains a possible direction for state scenes. Elaborate distressed printing is also future work.

## What remains undecided

- Solitaire versus a competitive shared chain, where each player owns destinations.
- A fixed commission versus drafted private objectives.
- Replacing routes versus adding cards as composable layers.
- Whether exact odds are always visible, earned by inspection, or reserved for workshop.
- The cost of certainty: deterministic cards, limited interventions, and risk/reward scoring.

This version deliberately tests one question: is placing a card into a probabilistic network satisfying? It has no AI opponent, balance certification, persistent campaign or multiplayer. It does not reuse the existing Playtest preset called markovs-chains; the user's visual references are the starting point for this separate design.

## Implementation

client/markovs/rules.ts contains pure transition, probability and seeded-random functions. client/markovs/main.ts owns the table and controls. static/markovs.html is the mobile-friendly page. Use ?seed=1941 or ?mode=workshop. The experiment is registered in Lab and uses its immutable deployment assets.
