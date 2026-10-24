# Blocks

Stone blocks on a lattice, set with a finger. No block has a shape of its own. Each one
becomes what the blocks round it, and the blocks round those, make it. Alone off the ground
it's a pebble. In a run up it's a column, with a base where the run starts and a capital where
it ends. Carried over nothing it's part of an arch. In a wall three high it has windows. On the
open edge of a roof it has battlements. Where it meets another block it melts into it. In a thin
build it's soft and in a dense one it's crisp. Set one block and the shapes change up to four
cells away; you see the change run out from your finger, ring by ring.

## Hands

| | Touch | Mouse and keys |
|---|---|---|
| see where a block would go | touch: it shows already as it would be there, faint | hover |
| set it | lift your finger | click |
| lay a run | drag: a floor across the top you touched, a wall up the side | drag |
| take a block | hold on it; drag on to take more | right-click |
| take, for a while | `take` (it goes red), then touch or drag | X |
| step back | `undo`: a run is one step | ⌘Z / Ctrl-Z |
| look around | two fingers turn and pinch; or drag the sky | right-drag (or shift-drag); the wheel |
| start again | `begin again` | |

Each block clicks as you set it: higher the higher it is, brighter for a column, deeper for a
mass. The phone buzzes too. The build is kept on this device.

## What a block reads

A block reads the cells two each way round it (124 of them). Nothing about it is stored. Read
the same arrangement again, anywhere, and you get the same block.

- **Its joins**: which of its six faces have a neighbour. A joined face runs on into the
  neighbour, so there's no seam. The corner between two neighbours fills with a fillet.
- **How dense** the build round it is (four levels): this sets how round its open edges are and
  how soft its fillets.
- **What it plays**:
  - a **column**: stone above or below and nothing beside it. It's narrowed, with a base at
    the foot of its run and a capital at the top;
  - a **wall**: a neighbour along one way only and open across it. It's drawn in to 0.8
    thick, so a wall's corners and the roof on it stand proud, like pilasters and a cornice.
    Where the wall is three high it has windows, every other block along it;
  - **nothing under it**: its underside rises from the blocks round it that stand on
    something. Between two that stand one cell apart, two arcs meet in a point. Further apart,
    a round arch. Held on one side only, a curved bracket. Far from any support, a thin vault;
  - a **roof edge**: nothing above, on a wall or a mass, and open on a side. It gets
    battlements along that side, a merlon or a gap by its place along the edge;
  - on the **ground**: a plinth along its open sides;
  - **alone** and off the ground: a pebble.

## How it's made

All the blocks together make one distance field. Each block's own solid is a box, shaped by
its read. The solids are joined with a smooth union, but only where two surfaces meet at an
angle. Two faces that run on in one plane are joined flat, so there's no ridge along the seam.
The underside of anything carried is cut from the whole field. The cut is reckoned from where
the supports are, so every block under one arch agrees on it.

Each cell's part of the surface is cut from the field by surface nets, at six samples a side.
Each vertex is then stepped onto the true surface along the field's gradient. Two cells that
share a sample compute it with the same whole-number arithmetic, so they agree to the last
bit. That's why the build is closed, without a crack, whatever order it was built in.

A cell's mesh depends only on the reads of the cells two each way round it, so it's named by
them. The same arrangement anywhere uses the same mesh, made once. When you set a block:

1. The block itself is shaped already; the faint preview made it.
2. The cells round it are read again.
3. Workers shape whatever is new (this lab's own bundle, loaded again as a worker), nearest
   first, and each new shape is put in as it arrives.

The page's own thread spends about 3 ms on an edit. The shapes spring, settle and sink in the
vertex shader, so a touch is felt without any work on the CPU.

## Presets

`?demo=castle`, `arcade`, `house`, `harbour`: a build to start from (it replaces what's kept).
`?preview`: a castle that builds itself, a block at a time, turning (the lab's index).
`?debug=1`: no shadows. `?debug=2`: normals. `?noworkers`: all the shaping on the page's thread.

## Checks

`node cells/lab/devtools/blocks.test.mjs`: the reads, every demo and a random scatter closed and
facing out, the same build in two orders giving the same shapes, one block changing nothing
more than four cells off, and undo giving back what was.
`node cells/lab/devtools/blocks-shot.mjs [outdir]`: each demo drawn, and the hand tried in a
browser (a tap sets, a drag lays a run, a hold takes, undo).
