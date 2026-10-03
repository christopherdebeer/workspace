# Bricks

A baseplate and a tray of bricks, and nothing to do but build. There's no clock, no score and
nothing clears. Choose a size, brick or plate, and a colour. Move the brick with a finger, then
tap it to press it on.

## Hands

| | Touch | Mouse and keys |
|---|---|---|
| move the brick | one finger on the build (it rides a little above it, so you can see it) | it follows the pointer |
| press it on | tap it, or `set` | click; space |
| send it somewhere | tap there | — |
| turn it | `turn` | R |
| brick or plate | the tray | P |
| take one off | `take`, then tap it | T, then click |
| step back | `undo` | Z |
| look around | one finger on the sky; two fingers pinch, twist and slide | drag; right-drag (or shift) slides; the wheel |

## How bricks go together

The proportions are the real ones. A stud is 8 mm apart, a brick is 9.6 mm high and a plate is
3.2 mm (a third of a brick), so plates and bricks stack into the same courses. The world is a
grid of cells, each one stud across and one plate high: 24 × 24 studs, 72 plates up.

A brick connects as the real ones do: on the baseplate, on the studs of something below it, or
under something above it. Never beside one alone, and never in mid-air. Put a brick against
the side of another and it sits level with that brick's bottom, if something holds it there.
Otherwise it finds the nearest place that does.

The tray has the common sizes (1×1 to 2×6) and fourteen of the classic colours. Your build is
kept in this browser. `begin again` asks twice.

## Light and sound

The plastic is glossy, with a sun's highlight and a little sky in the edges. The fine line where
two bricks meet is a real gap. Shadows are found by walking the grid toward the sun, cell by
cell; the build's cells sit in a small 3D texture. Each face's ambient occlusion comes from the
same cells, and each stud's foot darkens where it meets its brick.

Pressing a brick on makes a double click (filtered noise) and a soft tone from a pentatonic
scale, chosen by colour and height. Taking one off or undoing makes a softer pop. Underneath
is a low drone. `sound` turns it off.

## Notes

- The rules (`client/bricks/build.ts`) are kept apart from the drawing and tested on their own
  (`node cells/lab/devtools/bricks.test.mjs`).
- `?town` (and the index's `?preview`) builds a little town by itself from a seed. The walls are
  laid in courses with their joints staggered, roofs are plates, and there are a few trees.
