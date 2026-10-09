# Marble Run

Twelve marbles in a row behind a gate at the top of a wide, sloping board. The gate lifts and
they go: down board after board of obstacles, bumping, parting, catching up, to a chequered line
at the end. A chase camera follows yours. Past the line is build mode: three boards on offer;
pick one and the run grows downward.

## The race

| | Touch | Mouse and keys |
|---|---|---|
| let them go from the top | `from the top` | space |
| from the last board | `from the end` | |
| follow another marble | tap the board | click |
| follow the leader instead | `following …` | F |
| look round | drag | drag |
| come close | pinch | the wheel |

The board on the right is the order: who's over the line (their time), who leads (how far),
and how far behind the rest are. The marbles are glass, steel, wood and rubber (several of
each, each its own size and weight), and each comes down the same board differently:

| | density | bounce | grip | rolling resistance |
|---|---|---|---|---|
| glass | 2.5 | lively | low | least |
| steel | 7.8 | firm | lowest | low |
| wood | 0.7 | dull | fair | more |
| rubber | 1.2 | most | most | most |

Steel carries its weight through the pack; rubber grips and bounces; wood is light and gives
up speed to its rolling resistance; glass is quick and skittish. Marbles knock into each other
and sound as they do: glass rings, steel clacks, wood thocks, rubber thuds.

## Building

`build` flies to the end of the run, where three boards are on offer, drawn see-through where
they'd go. Tap one to see it; `add it` and the run is one longer; `three more` offers others.
`take the last off` undoes. The boards are 48 wide, walled at the sides, each a field: pegs,
deflectors (slats and curved slats), a splitter (a V that parts the pack into lanes), a
chicane, spinners (turning crosses that fling), a funnel (everyone through one gap, then a fan
of pegs to spread them again), gates (rows of chevrons with gaps between), bumpers, a step
down, a zigzag, a straight. Nothing on a board stands square to the slope: whatever a marble
meets, it slides off to one side or the other, as on a real board.

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
smoother, so a marble slides down a slanted one rather than resting against it. Marbles meet
each other with restitution and friction between their materials, mass-weighted; twelve of them
on one board is most of the race.

## Notes

- The track and the solver are tested on their own (`node cells/lab/devtools/marbles.test.mjs`):
  a seeded run is the same run, every board ends lower; the rolling rate, the materials, a
  bounce, walls and pegs, a spinner's fling, a collision, and whole runs with nearly everyone
  over the line and nobody off the board. The page is driven with
  `node cells/lab/devtools/marbles-shot.mjs --test`.
- Drawn in WebGL2 with a shadow map from the sun; the materials are shaded by roughness and
  metalness, glass refracts and glints, steel mirrors the sky; the floor and sides are
  cardboard.
- `?auto` (and the index's preview) races a fixed run and follows the leader.
