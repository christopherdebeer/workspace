# Marble Run

Twelve marbles in a row behind a gate at the top of a wide, sloping board. Tap one and it's
yours; tap the board and the gate lifts: down board after board of obstacles they go, bumping,
parting, catching up, to a funnel at the end that brings them to a single gap, the chequered
line across it, and a channel beyond, one marble wide. They come to rest in it in the order
they crossed, first at the top: the result is there to see. A chase camera follows yours. Past
the line is build mode: three boards on offer; pick one and the run grows downward.

## The race

| | Touch | Mouse and keys |
|---|---|---|
| make a marble yours | tap it, or its row on the board | click |
| go | `go`, or tap the board | space |
| line up again | `from the top` | space |
| from the last board | `from the end` | |
| follow the leader instead | `following …` | F |
| look round | drag | drag |
| come close | pinch | the wheel |

The board on the right is the order: who's over the line (their time), who leads (how far),
and how far behind the rest are. The marbles are a roster, as a tournament's: all glass and all
the same size, so the run and the knocks decide it and not the marble; each its own look (a
cat's eye, a swirl, speckled, banded), its own colours, its own name. The pattern is in the
glass, so it turns as the marble rolls.

The solver is deterministic, so the same start would be the same race every time, the same
marble first: so each race is its own. Where each marble starts differs by a hair, as a hand
setting them out would differ, and from there the knocks decide it; over a dozen races of one
run the winner changes, though a lane can be a lucky one.

The solver knows other materials too (`physics.ts`: steel, wood, rubber, with their densities,
bounce, grip and rolling resistance), and the tests race them; the roster is glass.

## Building

`build` flies to the end of the run, where three boards are on offer, drawn see-through where
they'd go. Tap one to see it; `add it` and the run is one longer; `three more` offers others.
`take the last off` undoes. The boards are 48 wide, walled at the sides, each a field: pegs,
deflectors (slats and curved slats), a splitter (a V that parts the pack into lanes), a
chicane, spinners (turning crosses that fling), a funnel (everyone through one gap, then a fan
of pegs to spread them again), gates (rows of chevrons with gaps between), bumpers, a step
down, a zigzag, a straight, a bend (the board sweeps round, left or right, and the run heads a
new way; some other boards turn a little too). Nothing on a board stands square to the slope:
whatever a marble meets, it slides off to one side or the other, as on a real board.

The run is its seed and your choices, in the address (`?seed=…&run=0.2.1.…`): share it, and it
is the same run for anyone. `a new run` starts another seed. `?marble=steel` follows that one.

## The solver

Rigid spheres with spin, in centimetres and seconds, in many small steps. Each step a marble
falls a little, then every contact it has is resolved: a normal impulse with restitution (none
when it's barely moving, so it rests), a friction impulse against the grip's limit that also
spins it (which is what makes it roll, and what a spinning marble does when it lands), and the
overlap pushed out. Rolling resistance slows what rolls, and the board's roughness takes more
the faster it goes. A solid sphere rolling down a slope gathers speed at five sevenths of what
a sliding one would, and does here.

A board is a floor, its two sides, and what's stuck on it: walls (segments, met as capsules),
pegs (cylinders), spinners (arms turning about an axle, whose own speed at the point of contact
counts in the bounce and the grip). The floor is cardboard, dull and grippy; the strips are
smoother, so a marble slides down a slanted one rather than resting against it. Nothing on a
board stands square to the slope, and a wall that reaches a side meets it (a gap there wedges a
marble); a marble that stops anyway is nudged sideways. After a push between marbles the board
has the last word, so the pack can't press one through a wall; below a step the sides reach up
to the board above. Marbles meet
each other with restitution and friction between their materials, mass-weighted; twelve of them
on one board is most of the race.

A bent board sweeps its frame round a circle: its middle an arc of its length, turning by its
turn, dropping at its slope. Everything on it is placed by (along, up, across) and bends with
it, the drawing and the solver alike: the floor and sides in pieces, the walls as bent
polylines in the world; a marble's own (along, up, across) is found from its bearing about the
centre of the turn, brought down to the floor first since the floor's normal leans with the
slope.

## Notes

- The track and the solver are tested on their own (`node cells/lab/devtools/marbles.test.mjs`):
  a seeded run is the same run, every board ends lower; the rolling rate, the materials, a
  bounce, walls and pegs, a spinner's fling, a collision, and whole runs with nearly everyone
  over the line and nobody off the board. Across a sweep of seeded runs, the order at rest in
  the channel is the order over the line. The page is driven with
  `node cells/lab/devtools/marbles-shot.mjs --test`.
- Drawn in WebGL2 with a shadow map from the sun; the materials are shaded by roughness and
  metalness, glass refracts and glints, steel mirrors the sky; the floor and sides are
  cardboard.
- `?auto` (and the index's preview) races a fixed run and follows the leader.
