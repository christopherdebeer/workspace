# Marble Run

Six marbles let go from the top of a tower, down a track that goes on for as long as you build
it. A chase camera follows yours. At the end of the run is the cup, and build mode: three
sections on offer; pick one and the run grows downward.

## The race

| | Touch | Mouse and keys |
|---|---|---|
| let them go from the top | `from the top` | space |
| from the last section | `from the end` | |
| follow another marble | tap the track | click |
| follow the leader instead | `following …` | F |
| look round | drag | drag |
| come close | pinch | the wheel |

The board on the right is the order: who's in the cup (their time), who leads (how far), and
how far behind the rest are. The marbles are glass, steel, wood and rubber (and two more
glass), each its own size and weight, and each comes down the same track differently:

| | density | bounce | grip | rolling resistance |
|---|---|---|---|---|
| glass | 2.5 | lively | low | least |
| steel | 7.8 | firm | lowest | low |
| wood | 0.7 | dull | fair | more |
| rubber | 1.2 | most | most | most |

Steel carries its weight through the slalom; rubber grips and bounces; wood is light and gives
up speed to its rolling resistance; glass is quick and skittish. Marbles knock into each other
and sound as they do: glass rings, steel clacks, wood thocks, rubber thuds.

## Building

`build` flies to the end of the run, where three sections are on offer, drawn see-through where
they'd go. Tap one to see it; `add it` and the run is one longer; `three more` offers others.
`take the last off` undoes. The kinds: a slope, a bend, an ess, a helix, a drop, a jump (a
gap, and a wider landing lower down), a loop (a full tube; only offered once the run has the
speed for it), a slalom tray with pegs, a funnel (in along the rim, round and down the hole), a
spinner tray with a turning bar, a switchback. Each ends lower than it began.

The run is its seed and your choices, in the address (`?seed=…&run=0.2.1.…`): share it, and it
is the same run for anyone. `a new run` starts another seed. `?marble=steel` follows that one.

## The solver

Rigid spheres with spin, in centimetres and seconds, in many small steps. Each step a marble
falls a little, then every contact it has is resolved: a normal impulse with restitution (none
when it's barely moving, so it rests), a friction impulse against the grip's limit that also
spins it (which is what makes it roll, and what a spinning marble does when it lands), and the
overlap pushed out. Rolling resistance slows what rolls. A solid sphere rolling down a slope
gathers speed at five sevenths of what a sliding one would, and does here.

The track is a channel: a trough of radius 2.6 swept along a path, open a little more than a
half-pipe (a full tube for a loop), and the marble meets it across that real cross-section: it
rides up the wall in a bend, and over the rim if it's going too fast. The path is a turtle,
its frames carried along by parallel transport and banked, so a loop comes round right. Trays
are a floor, walls, pegs and a bar; the bar's own speed counts in the bounce and the grip. A
funnel is a cone with a hole. Marbles meet each other with restitution and friction between
their materials, mass-weighted.

## Notes

- The track and the solver are tested on their own (`node cells/lab/devtools/marbles.test.mjs`):
  a seeded run is the same run, every section ends lower; the rolling rate, the materials, a
  bounce, bends and helices, a collision, a whole run with everyone arriving. The page is driven
  with `node cells/lab/devtools/marbles-shot.mjs --test`.
- Drawn in WebGL2 with a shadow map from the sun; the materials are shaded by roughness and
  metalness, glass refracts and glints, steel mirrors the sky.
- `?auto` (and the index's preview) races a fixed run and follows the leader.
