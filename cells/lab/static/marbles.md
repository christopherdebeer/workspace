# Marble Run

Twelve marbles behind a gate at the top of a wide, sloping board. They're already alive: set
down by hand, a hair differently each time, they roll to the gate and settle against it,
knocking, each with its name beside it. Tap one and it's yours; go lifts the gate, and down
board after board of obstacles they go, bumping, parting, catching up, to a funnel at the end
that brings them to a single gap, the chequered line across it, and a channel beyond, one
marble wide. They come to rest in it in the order they crossed, first at the top: the result
is there to see. A chase camera follows yours. There's no wall behind the gate, so a drag
swings the view round the row to look down the run from behind it. Past the line is build
mode: three boards on offer; pick one and the run grows downward.

## The race

| | Touch | Mouse and keys |
|---|---|---|
| make a marble yours | tap it, or its dot in the order | click |
| go (from the lineup) / again (back to the gate) | the dark button, or tap the board when lined up | space |
| the camera: yours, the leader, the finish | the light button beside it | C |
| look round | drag | drag |
| come close | pinch | the wheel |

`build` swaps those two buttons for building's three: `add it`, `undo`, and `try it`, which
races just the last board, the camera on the leader, to see how it runs. A line of help
shows for a moment at each change and then gets out of the way.

The row across the top is the order, first on the left: yours is the big one, named, and the
ones in are ringed; tap any to follow it. The clock beside it has your place and your gap.
Nothing else sits over the board. As each marble crosses the line its place, name and time
fade in beside it, to the right of the channel, which is barely wider than a marble, so the
file is straight. A marble that has come to rest there sleeps (it stays put, a stone for the
next to stop against, unless knocked hard), so the file settles in under a second; and once
the first is in, a straggler stuck on the run is waited for 25 seconds and no longer. The marbles are a roster, as a tournament's: all glass and all
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

## Themes

`atelier` is the workshop: kraft-paper boards on taped boxes and cords, bunting, daylight by
the window. `nocturne` is an observatory at night: ink-blue lacquer with a star chart drawn in
gold, brass-bound strips and brass pegs, dark oak posts, the moon low in the windows and the
pendant lamps lit. The theme is where the run is and what it's made of (`theme.ts`): the key
light, the room's colours, the lamps, the material of every part (colour, roughness,
metalness, and a style: paper fibre, corrugation, lacquer, brushed brass, oak, leather,
planks, stone, glaze, chart), the supports, what stands about, the haze and the dust. The
course, the physics, the race and the camera know nothing of it: tap `atelier`/`nocturne`
under a race and the race goes on exactly as it was, in another place. The scenery's
randomness has its own seed, so it never changes the course. `?theme=nocturne` in the address.

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
- Drawn in WebGL2 into the frame's own multisampled buffer, in linear light with a filmic
  roll-off at the end. The cardboard is built: paper skins about a corrugated core, seen
  wherever a piece was cut (the top of every strip, its rounded ends, the edge of a board, the
  side of a peg), glue seams at every foot, tape at the joins, fibres along the way a piece was
  made. The run is a homemade installation in a workshop: near the floor the boards stand on
  stacks of taped boxes, higher up they hang by cords from the rafters; pendant lamps with
  enamel shades hang over every other board, bunting on pencils crosses some, a chequered flag
  stands at the line and poles at the gate; offcuts, boxes, tape and pencils lie about the
  floor; dust drifts in the light. The room around (a dark floor, warm walls, a broad window)
  is what the glass reflects. A marble is glass seen into:
  the view refracts in, crosses the sphere and refracts out, and what it then meets is read from
  the scene already drawn (the board, magnified and bent); the ribbons and swirls are marched
  through in the marble's own space, so they have depth and turn as it rolls; bubbles catch the
  light. The sun's shadow map moves in whole texels, so edges don't crawl; a soft dark lies
  under every marble; what the frame draws is between the solver's last two states, by how far
  into the next step it is. Shadows are as soft as a broad window makes them: a blocker
  search in the shadow map finds how far the blocker is, and the filter is that wide, so the
  foot of a strip is crisp and its far edge spreads. Each marble lays a caustic in its own
  shadow, in its colour, from the key light by day and the nearest lamp at night. The frame
  goes to the screen through a lens: in focus at the marble the camera is on, softer nearer
  and further, a sharp thing in front never smeared by the blur behind it. The floor wears where they run: a rubbed band along each side,
  scuffs along the way, and the roughness varies with the paper. Nearing the end of a board the
  chase leans toward the next board's heading, so a bend is met rather than chased. A stuck marble's nudge is seen as a tap on the board, and heard.
- `?auto` (and the index's preview) races a fixed run and follows the leader.
