# Settle

Blocks, slowly. A square bed in a still, pale light. Pieces come one at a time, and you put each
one wherever it fits: on the bed, on what's already there, or out from its side. Nothing falls
and nothing hurries. When a layer is filled edge to edge it dissolves with a chime, and whatever
was above comes down to rest.

## Hands

| | Touch | Mouse and keys |
|---|---|---|
| move the piece | one finger (it rides a little above it, so you can see it) | it follows the pointer |
| set it down | tap it, or `set` | click |
| send it somewhere | tap there | — |
| turn it | `turn` | Q / E |
| tip it away from you | `tip` | W / S |
| look around | two fingers; pinch to come closer | drag; the wheel |

A piece goes against any face it's shown, but never hangs in the air: it has to touch the bed
or something already set. Below the piece in hand, soft marks show where each of its columns
would rest.

## The pieces

Twelve small polycubes: a single cube, two and three in a row, a corner, the flat
four-cube shapes (line, square, tee, ell, step), and three that are only possible in three
dimensions (a branch and two twists, one the mirror of the other). The calmer ones come more
often. They come from a seeded bag (`?seed=`). Your bed, the bag and the piece in hand are kept
in this browser, so you can come back to them. `begin again` starts a new bag.

## Light and sound

Each cube's light comes from a low sun. Its shadow is found by marching toward the sun through
the bed's cells, which sit in a tiny 3D texture. Each face's ambient occlusion comes from the
same cells, so corners and the bed's edges darken softly.

Setting a piece rings a tone from a pentatonic scale, chosen by its colour and height. Settling a
layer plays a slow arpeggio. Underneath is a low drone, and everything passes through a soft
echo. `sound` turns it off.

## Notes

- The rules (`client/settle/game.ts`) are kept apart from the drawing and are tested on their own
  (`node cells/lab/devtools/settle.test.mjs`). The test includes a quiet player that places 400
  pieces without the stack rising.
- `?preview` is that same quiet player, setting a piece every second or so while the view turns.
