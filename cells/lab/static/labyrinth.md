# Labyrinth

Architecture that follows the hand. A travertine slab on a table in the sun, and a palette along the bottom. **auto** (the first, and where it starts) is three gestures: the hand decides the shape, and the stone works out what it takes to stand. The other pieces (block, arch, stair, bridge, tree, pool, take) are there for when you want one thing exactly where you touch. That means arches, arcades and piers under anything with nothing beneath it, arched ways where stone is cut out from under stone, steps and landings where a trace climbs, and courtyards where walls close round the ground.

> Townscaper interprets where you place blocks. Labyrinth should interpret what you're trying to construct.

![a resolved labyrinth: a passage under a walkway, a court, a bridge on one great arch](labyrinth/v-story-4-turned.jpg)

## The hand

### auto: three gestures

| Gesture | On… | Builds |
|---|---|---|
| **tap** | bare stone | a plinth |
| | a top | another course |
| | a side | the stone pushed out that way (on an arch or a pier, if there's nothing under it) |
| **trace** | from the stone, across the stone | a wall along the stroke |
| | from a top, out over anything | a walkway at that height, cut through any wall in its way (what's left over the cut stands on an arch) |
| | from a top to another top at the same height | a walkway joining them: a bridge where it crosses the air |
| | from the stone or a top to a top at another height | steps and landings, climbing evenly along the stroke |
| **hold, then trace** | stone | carves: a top lowered a course; a side cut through, so what's over it stands on an arch |

### The palette: one piece, where it's touched

| Piece | Where it's touched | Puts down |
|---|---|---|
| **block** | the stone, a top, a side | stone in the free cell on that side |
| **arch** | the same | stone with a way through it, running where it's open either side; on an arch, the same way, making one tall arch |
| **stair** | a floor, or beside stone | a flight up a level, climbing toward the stone it was put against (or onto a neighbour's top) |
| **bridge** | a gap at a level, from beside stone | stone laid across the whole span at once (up to seven cells), marked as a bridge so the rules carry it on one arch |
| **tree** | a floor with room above it | a cypress |
| **pool** | the stone | water let into the stone |
| **take** | a piece | takes it away. The rules then carry what was on it on an arch or a pier |

With a piece in hand, a drag turns the view rather than tracing. Both ways of building are operations on the same stone, so pieces and gestures mix freely, undo walks back through both, and the same rules resolve them: an arch put by hand carries what's on it like any stone, and a pool by hand sits in a court beside the court's own water.

![with the palette: a tall arch, a long bridge from its top, a pool, cypresses on the terraces](labyrinth/v-palette.jpg)

### The stone grows

The slab starts as an 8 × 8 square. After that it is only as big as what's built, plus two cells all round. Build on its edge cell and it grows two cells further; undo, and it goes back. There's always room to go on, and the view follows, framing the whole slab. The grid underneath is 48 × 48 cells.

### Moving round it

- Two fingers, or one finger starting on the background, turn the view. It settles on a corner when you let go.
- Pinch, or scroll, to come closer.
- **Undo**, **print** (draw it as a lithograph) and **clear** are at the top right.
- While a finger is down:
  - a trace shows its stroke as a faint dotted line, and the stone is laid behind the finger as it goes;
  - a hold fills a ring before it starts carving;
  - stone that settles puffs a little dust.
- The view never moves while a hand is on the stone, so what's under the finger stays under it.
- What's built is kept on this device.

## The storyboard

The brief's first test asks whether someone, without instruction, can build this: a small raised platform, a wall extending from it, a terrace higher up, a connection between them that resolves into stairs, and a passage cut beneath the walkway. Each picture is made with the gestures a hand would use (`demo.ts`), read by the same rules. The smoke test makes the same structure with real pointer events.

![1: first touch: a small raised platform](labyrinth/v-story-1.jpg)
![2: a traced wall](labyrinth/v-story-2.jpg)
![3: an elevated connection](labyrinth/v-story-3.jpg)
![4: a resolved labyrinth](labyrinth/v-story-4.jpg)

1. **First touch.** Tap the stone, tap its top, tap a side: a platform, two courses high.
2. **A traced wall.** Trace across the stone from beside it, and a wall grows along the stroke.
3. **An elevated connection.** Tap a terrace up three courses. Then trace from the platform's top along the wall's top, and up to the terrace. The landings rest on the wall. The step up comes at the end, and where the route turns off the wall, piers come up under it.
4. **A resolved labyrinth.**
   - Hold on the wall beneath the walkway, then carve. The wall is cut through, and the walkway over the cut stands on an arch.
   - Trace a wall round in front, and the court is closed: paved, with a cypress in its corner.
   - Tap up a tower, and trace from its top to the terrace's top at the same height. The bridge is resolved onto one great arch, springing as low as both sides go.

## How it's built

Three layers, in order of authority (`model.ts`):

1. **Operations.** Each gesture or piece is recorded as what it changes in the intended solid: stone added (a cell at a level, and when it was laid), stairs added (which way each climbs), stone with a way through it, cypresses, pools, and stone cut away. A bridge's stone is marked as a bridge's. Undo takes the last operation back. The world is always these operations replayed, so a new edit never redesigns an earlier one except through the rules below.
2. **The intended solid.** The stone and stairs the operations add up to. The hand decides this, and nothing below changes it.
3. **The resolution.** What the stone has to do so the intended solid stands. It is worked out afresh after every edit, the same every time:
   - stone with nothing under it, between stone either side along x or z, is carried on an **arch** (three cells at most, or seven for a bridge put by hand). The arch springs as low as both sides go, down to where a round arch fits, and the air under it is kept clear;
   - a longer run becomes an **arcade**: a **pier** every three cells, with arches between;
   - a free end, or a stair over nothing, stands on a pier;
   - so cutting under stone opens an arched way through it, and a walkway drawn out over the court comes with what holds it up;
   - ground walled in all round is a **courtyard**: paved, with water where it's open on every side (or at its heart, if it's big enough), and a cypress in a corner. An arched passage counts as a wall.

**Reading a gesture** (`gesture.ts`) takes where the gesture started, the cells the stroke crossed, and where it ended:

- **Where it ended counts** if it's a top at another height. From high up, ending over bare stone, the trace makes a walkway rather than stairs down: tracing *up* to a top is how you climb.
- **Steps are spread evenly**, a level per step, along the stroke.
- **A diagonal stroke** is walked a cell at a time, the way it leans.
- **A stroke that doubles back** keeps only what it covered once.

**The page** (`main.ts`) turns a touch into those terms:

- **What it struck** is found by marching the ray through the actual stone. That includes the stone above an arch's curve, so a touch there is that cell's, not the air's.
- **The stroke's cells** come from projecting the finger onto the level plane it started on, or blended toward the height it's reaching.
- **While a trace is under the finger**, it's re-read every move against the world as it was before the trace began, and the stone is laid behind the finger in the order it was crossed.

## How it's drawn

From the resolved world (`mesh.ts`), then WebGL2 (`render.ts`):

- **Blocks** have their faces where nothing hides them, darker at the foot.
- **Stairs** have six steps.
- **Arches** have spandrels and a deck over an elliptical soffit, lit warm from within.
- **Piers** are square columns with a cap.
- **Courtyards** are travertine flags with their joints.
- **The stone** is dressed travertine laid in courses (a joint every third of a level, the upright joints staggered course to course), banded, pitted with pores, and each block a shade of its own.
- **Light**: a low warm sun with soft shadows. The dappled shade of a tree out of the picture falls across one side, near the build.
- **No outlines**: barely a line where the depth folds.
- **Rising**: the stone rises as it's laid, arches come down from their deck, and courtyard things grow when the court closes.
- **Print** (kept from before) turns the light into hatching on paper, with the edges in ink. It's next to take what Taohua learned about drawing.

![close: the stone, its courses, the light under an arch](labyrinth/v-close.jpg)
![as a print](labyrinth/v-print.jpg)

## Checked

- `node cells/lab/devtools/labyrinth.test.mjs` builds 60 worlds from 60 random actions each (taps, traces between surfaces, carving, and palette pieces), read by `gesture.ts` and `palette.ts`. It checks:
  - whatever the hand built stands: on what's below it, on an arch of three cells at most whose sides are stone, or on a pier that itself stands and carries something;
  - every arch's air is clear;
  - every way of reading a gesture occurs;
  - undo, and doing it again, gives the same world;
  - what's written down makes the same world again;
  - each storyboard stage is what it says it is.
- `node cells/lab/devtools/labyrinth-smoke.mjs` does the palette on a fresh stone (each piece where it's touched: block; arch; arch on arch, making one tall arch; stair against a block; a bridge across a three-cell gap on one arch; cypress; pool; take). It also does the brief's scenario with pointer events: the platform from taps, a wall from a trace, a terrace from taps, the connection traced up to it (stairs, with landings on the wall), and a hold-and-carve under the walkway (an arch carries it). Then undo, a turn from the background, print, what's built kept across a reload, and clear.

**What the tests don't establish** is the brief's real criterion: whether someone can anticipate a result, correct it and repeat it on purpose. That needs a person with the phone.

## Links

- `?story=1` … `?story=4` is the storyboard; `?story=5` adds pieces from the palette.
- `?hand=bridge` (or any piece) starts with that piece in hand.
- `?ops=` builds from operations, as the model writes them.
- `?print`, `?turn=1` (a quarter turn), `?zoom=0.4` (closer).
- `?preview` is the index's card: stage 4, turning slowly.

## Next

- **Snapping on relationships**: geometric (a stroke ending near an edge or a terrace joins it), topological (two walkways meeting make a junction you can walk), architectural (a buttress under an exposed terrace edge).
- **Strokes off the grid**: diagonals kept as diagonals, with slight irregularity in the masonry.
- **Constraint resolution for transitions**: where stairs meet arcades, corners, intersections.
- **Escher, as a separate authored layer**: first impossible-*looking* space (deep arcades, conflicting stairs), later impossible topology (connections that are valid only from one view).

Every picture: [views](labyrinth/views.md), made by `node cells/lab/views.mjs labyrinth`.
