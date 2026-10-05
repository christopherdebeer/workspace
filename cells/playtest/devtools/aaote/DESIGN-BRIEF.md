# AAOTE: An Agent of the Enemy — design brief (v0.5)

Derived from the design board (2026-10-04): cover art 敵の代理人, twenty characters with
professions and home cities, noir items and scenes, the Nine Cuts, the mechanics sketch
(Project → Stealth · Progress · Sabotage · Reveal · Expose · Cooperate), the verbs
(Kompromat, Gossip, Quid pro quo, Hostile takeover, Research, Corrupt, Investigate, Scoop,
Blackmail), the prisoner's-dilemma note, and three reference games: *Deception: Murder in
Hong Kong*, *Coup*, *The Resistance*. Nothing below is new invention; it is the board,
made playable by the engine.

## What the game is

A Japanese city, noir. Each player is a professional with a private ambition: the
Scientist's research, the Journalist's scoop, the Builder's blueprints, the Gangster's
racket, the Traveler's itinerary, the Student's thesis. One of them is an **agent of the
Enemy**, whose ambition is kompromat — and who must never be exposed.

Everyone pursues their ambition through **projects** laid on the table in front of them.
A project is public unless played in **stealth** (face down). Public projects attract
help and sabotage; stealth projects are safe from sabotage but draw suspicion, and
nobody can help you with what they cannot see.

## The core loop (what each round forces into the open)

| Verb (board) | In play |
|---|---|
| Project | Play a project card from hand to your table, face up |
| Stealth | …or face down: everyone sees a hidden project and its tokens, not what it is |
| Progress | Put a token on one of your projects; at `needs` tokens it completes and scores |
| Cooperate / Quid pro quo | Put a token on another player's *open* project; you score 1 |
| Sabotage | Clear every token from another player's *open* project (public) |
| Expose / Scoop | Turn another player's stealth project face up for everyone (public) |
| Reveal / Investigate | See a player's hand (private) |
| Gossip | See one of a player's stealth projects (private) |
| Accuse | From round 3, once: name the agent |

The deduction is structural, as in the reference games: the agent's only route to points
(Kompromat) exists only in stealth, Kompromat needs more tokens than most honest projects,
sabotage is public, and every investigation leaves a trace the judge can see. Honest
players also play stealth and also sabotage, so the traces are ambiguous — which is the
game.

## Scoring and the dilemma

Points, over 8 rounds, 3 actions a turn. A completed project scores its value (2–3;
Kompromat 3). Completing your ambition (three projects of your kind) scores +4 and reveals
your role. Exposing the agent (a correct accusation) ends the game: the accuser scores +3,
every other honest player +1, the agent's score becomes 0, and the highest score wins.
A wrong accusation costs 2, reveals you, and ends your ambition. At the end of round 8
the highest score wins; the agent wins ties.

The board's note is the heart of it: *if everyone cooperates to expose the agent they each
get 1 point and the agent 0.* Exposing is a public good that mostly helps the leader; the
trailing player's best move is their own projects. The agent lives in that gap.

## The Nine Cuts (variable player powers, one each, public)

Rin (power over others): sabotage costs 1 action, not 2 · Jin (knowing the thoughts of
others): once per game, see a player's ambition · Tō (harmony): cooperating is free ·
Kai (premonition of danger): exposing costs 1 action, not 2 · Zen (enlightenment): you
always see the top card of the deck.

## What a good session looks like (the numbers the climb should chase)

- The agent is exposed in 40–60 % of games — not never, not always.
- Of correct accusations, ≥ 70 % follow evidence involving the agent (an investigation,
  a gossip, an exposure, a sabotage trace), not a guess.
- Wrong accusations are < 20 % of all accusations.
- The agent wins 30–45 % of games (top score at the end, or exposed too late).
- Every seat takes an interactive action (cooperate, sabotage, expose, investigate,
  accuse) at least once per two rounds.
- At least one lead change; a final margin of a few points; games reach round 6.

These replace the mechanical weight of score/v3.1 for this genre. The present score gave
0.85 to a three-round game decided by the agent exposing itself.

## What the engine needs

`projects` mechanic (new): tableau of face-up/face-down project cards, tokens, progress,
cooperate, sabotage, expose. `hidden-objectives`: objective checks on completed projects
by kind; completion as a bonus rather than a win; accusation that scores and ends the
game. `event-effects`: `peek_project` (Gossip). Harness: a stealth play's card name is
hidden from the other players' recent-moves; public exposures reach the judge.
