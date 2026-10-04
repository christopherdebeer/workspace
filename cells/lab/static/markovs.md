# Markovs Chains — physical card playtest

The default is now a physical-first junction card game, separate from the archived four-state probability interface. Twenty-four square junction cards (three copies of eight designs), START, two destination cards, one counter, a d6, four reroute coins, and a thirty-turn tally reproduce every rule on a real table.

## Rules

Imagine a 5×5 grid: clubs at column 1 row 1, START at 3,3, diamonds at 5,5. Put the counter on START. Player 1 seeks clubs; player 2 diamonds. Shuffle, deal three cards each and give each player two reroute markers. For the guided first deal, player 1 receives ELBOW, STRAIGHT, LOOP, removed from the deck before dealing the opponent. Subsequent ordinary deals shuffle all 24 cards.

Choose and rotate one card, then place it adjacent to an existing junction, not an isolated destination. Every card has four inlet sockets; numbered outgoing arrows specify a direction for each die face. Numbers rotate with the card. Alternatively spend one reroute marker to replace any junction, including under the counter; destinations stay fixed. Discard replaced cards. Draw if the deck is not empty. Passing placement is legal.

Roll a d6. Read its face on the counter's current card and move one card in that direction. A loop or missing neighbour means stay and still uses a turn. Arrival wins for the destination owner, regardless of who rolled. Thirty rolls without arrival is a draw. Empty hands pass and roll. Digital undo restores the pre-roll board, hand, deck and reroute coins.

## Modes

/markovs and ?mode=physical use this game. ?play=bot offers a local opponent; ?play=two is pass-and-play; ?play=workshop supplies all eight reusable designs and unlimited placements and reroutes. Manual die-face buttons permit using a real die. Workshop has a counter-to-start button. An inline guide teaches a first turn on the actual table. Card inspection explains printed routes in readable text.

Print cards + rules invokes native printing: one A4 rule sheet plus three sheets of nine 60mm square cards. No odds calculation, concealed transition or digital state is needed to resolve movement.

The bot follows the same full turn, reroute budget, deck and die rules. It evaluates visible hand placements and rotations with a fixed-board route forecast and distance heuristic. It cannot inspect future draws or die rolls. Balance is untested: watch for blocked exits, remote placements, and the strength of rerouting under the counter.

## Archive and implementation

Earlier experiments remain at ?mode=challenge, ?mode=duel and ?mode=workshop with their original tutorial. These are different rule hypotheses, not physical game modes.

physical-rules.ts contains pure card exits, placement legality, movement and bot evaluation. physical.ts contains UI, turn state, guide, manual rolls, deck and printable sheets. main.ts selects the default physical game or archive. rules.ts continues to power the old probability experiment.
