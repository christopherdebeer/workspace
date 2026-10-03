# Bricks

A baseplate, and bricks offered one at a time, as in Tetris: the next one turns in its corner.
Tap it for another, or drag it out onto the build and let go to press it on. Nothing falls,
nothing clears and there's no clock. You build, and you can change your mind.

## Hands

| | Touch | Mouse and keys |
|---|---|---|
| another brick | tap the one in the corner | click it; N |
| use it | drag it out of its corner; let go where it should go | the same |
| select a placed brick | tap it (the one you just pressed on already is) | click it |
| move it | drag the selected brick: the stud you take it by stays under your finger | the same |
| turn it | `turn` (with nothing selected, it turns the one on offer) | R |
| change its colour | `colour`: the next of the bag's colours | C |
| take it away | `remove` | Delete |
| let it go | tap nothing | Esc |
| step back | `undo`: through all of it; a brick pressed on goes back to its corner | Z |
| look around | drag anything else; two fingers pinch, twist and slide | drag; right-drag (or shift) slides; the wheel |

Where a brick goes is the cell under your finger: on top of what's there, under an overhang, or
beside a brick (level with it, if something holds it there).

## The bag

The bricks come from a seeded bag. The everyday sizes come most often (2×4, 1×2, 2×2, 1×4), the
long and the tiny ones less. About one in five is a plate. Each bag has a colour scheme of a few
colours that sit together, so a build looks like one place: harbour, village, garden, stone or
sunset. Each scheme has its own baseplate. `begin again` (it asks twice) starts a new bag.
Your build, the bag and the brick on offer are kept in this browser.

## How bricks go together

The proportions are the real ones. A stud is 8 mm apart, a brick is 9.6 mm high and a plate is
3.2 mm (a third of a brick), so plates and bricks stack into the same courses. The world is a
grid of cells, each one stud across and one plate high: 24 × 24 studs, 72 plates up.

A brick connects as the real ones do: on the baseplate, on the studs of something below it, or
under something above it. Never beside one alone, and never in mid-air. Put a brick against
the side of another and it sits level with that brick's bottom, if something holds it there.
Otherwise it finds the nearest place that does.

## Light and sound

The plastic is glossy, with a sun's highlight and a little sky in the edges. The fine line where
two bricks meet is a real gap. Shadows are found by walking the grid toward the sun, cell by
cell; the build's cells sit in a small 3D texture. Each face's ambient occlusion comes from the
same cells, and each stud's foot darkens where it meets its brick.

Pressing a brick on (or putting it down after a move) makes a double click (filtered noise) and a soft tone from a pentatonic
scale, chosen by colour and height. Undoing makes a softer pop. Underneath
is a low drone. `sound` turns it off.

## Notes

- The rules (`client/bricks/build.ts`) are kept apart from the drawing and tested on their own
  (`node cells/lab/devtools/bricks.test.mjs`).
- `?town` (and the index's `?preview`) builds a little town by itself from a seed. The walls are
  laid in courses with their joints staggered, roofs are plates, and there are a few trees.
