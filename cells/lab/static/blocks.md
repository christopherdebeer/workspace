# Blocks

Stone blocks on a lattice, set with a finger. You set plain blocks and nothing else: no block has a
part to play, and no form has a name. Every cell, stone or empty, is read from the cells round it
as a few plain quantities. Two programs then fill it with small cubes, twelve a side, from its
read and its neighbours' reads.

What comes of that is a small diorama. Ring a patch of ground with walls and it becomes a court:
- the court is paved;
- water stands in a tiled basin where the walls are far;
- beds of shrubs and roses grow against the walls, and a cypress in each corner;
- windows look onto it;
- a covered bay open to the court becomes a porch, with a door at its back framed in tile.

Walls carry a cornice. Roofs have a parapet, and a dome where the roof is roof all round. Stacks
taper into fluted columns, arches are cut under what has nothing beneath it, and ivy climbs where
the surroundings say. Nothing in the code asks for a courtyard, a porch or a column. Where the
quantities fall in between, you get something in between.

Set one block and the shapes round it change. So do the shapes across any court it closes or
opens. You see the change run out from your finger, ring by ring.

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

Each block clicks as you set it. The click is higher the higher the block is, brighter for a
slender stone and deeper in a mass. The phone buzzes too. The build is kept on this device.

## What a cell reads

A cell reads the cells two each way round it: 124 cells. An empty cell also looks along its own
level, up to six cells each way. Nothing about a cell is stored: read the same arrangement again,
anywhere, and you get the same cell.

A stone cell reads:
- **joins**: which of its faces meet stone;
- **softness**: how little stone is round it;
- **openness** of each face: open, sheltered (stone two cells out), or closed;
- **load**: the stone resting on it, straight up, counted to two;
- **support**: whether it stands on stone or on the ground. If it doesn't, which blocks round it
  at its level do;
- **thrust**: whether stone carried over nothing pushes on it from one side, low enough that it
  can spread its foot the other way to the ground.

An empty cell reads:
- **joins**: which of its faces meet stone. Stone over it means it's covered;
- **court**: of the four ways along its level, how many meet stone within six cells;
- on the ground:
  - **water**: in a court (three ways or more), with no stone within two cells, at its level or
    the one above;
  - **a bed**: open to the sky, against stone, in a court (two ways or more);
  - **a tree's foot**: a bed in a corner of walls, in a court of three ways or more. The cells
    over it, while they stay clear, read that a tree goes on up through them.

Both read their surroundings turned to a canonical orientation: the least of the eight turns and
mirrors about the vertical, compared cell by cell. That gives a **code**, which seeds whatever is
chosen by chance (where ivy grows, the lilies, the blooms). Cells with the same surroundings,
however turned, come out alike.

## What a stone cell becomes

- **Section.** Each open side is drawn in. How far depends on how open the two sides across are,
  and on the run the block is part of:
  - alone, it's drawn in fully;
  - in a run, it's drawn in less;
  - at the end of a run, least.
  Load holds the section out, so a stack tapers toward its top.
- **Steps.** Where it meets broader stone above or below, it steps out to meet it: a capital, a
  base. On the ground, its foot steps out.
- **A slender stone**, drawn in both ways, has its corners taken off and its faces fluted.
- **Nothing under it.** Its underside is cut from the blocks round it that stand: a quarter
  ellipse, flat beyond 1.25 cells. Every block under one arch reckons the cut from the same
  supports, so the cut is one arch. The arch's edge on its faces is picked out in tile.
- **Each open face**, if it's wide enough, is treated by the empty cell in front of it:

| The empty cell in front | The face |
|---|---|
| covered, with stone beyond it | a sunk panel of tile (a niche) |
| covered, walled at its sides | the back of a porch: a pointed opening framed in tile, a door on the ground, a window above |
| covered | a pointed opening |
| a court, with stone over this block | a window, or a door on the ground |
| outside, above the ground, with stone over this block | a slit window |

  Where the empty cell's code says so, ivy grows over the face, thicker low down.

## What an empty cell becomes

- **On the ground:**
  - in a court, paving;
  - water in a basin, rimmed with tile where the next cell isn't water too, with lilies, and a jet
    where it's water all round;
  - a bed: earth in a kerb, shrubs and roses, higher against the wall;
  - a cypress at a tree's foot, two cells and a half high, through the cells over it.
- **Beside stone:**
  - at the foot of a standing run, a plinth;
  - under the top of a wall above the ground, open to the sky, a cornice on dentils.
- **Over stone:**
  - along a roof's open edges, a low parapet with a crest of dentils;
  - over a roof that's roof all round, with nothing beside it, a dome: plaster or tile, by the
    code, with a finial.

## How it's made

Each cell's cubes come from its own read and the reads of the 26 cells round it. A cell's mesh is
made from its cubes and its neighbours' cubes. So a mesh depends only on the reads of the cells
two each way round it, and it's named and kept by them: the same arrangement anywhere is the same
mesh, made once.

A face of a cube shows where it meets nothing, in this cell or the next. Faces of the same stuff in
one plane, shaded alike, are merged into one quad. Each corner is darkened by the cubes round it.
Every face lies on the lattice of twelfths, the same from either cell, so the build is closed
whatever order it was built in.

When you set a block:
1. The block itself is shaped already; the faint preview made it.
2. The cells round it are read again, and so are the cells across its court.
3. Workers shape whatever is new, nearest first, and each new shape is put in as it arrives. The
   workers are this lab's own bundle, loaded again as workers.

The page's own thread spends a few milliseconds on an edit. The shapes spring, settle and sink in
the vertex shader, so a touch is felt without any work on the CPU.

## Drawing

The build is seen from above, square on to the diagonal, with no perspective. It stands in the
dark on a slab of ground cut square round it, with the section of earth and stone strata showing.

Each cube's face is coloured by its stuff and where it is:
- limestone laid in courses, each cube a little different, dusty on top and damp low down;
- trim paler;
- tile in a mosaic of turquoise, cobalt and cream;
- wood, and glass lit warm from within;
- water, leaves, flowers, paving and earth.

It's lit by a low warm sun with shadows, a dim sky, and light thrown back from the ground.

## Presets

- `?demo=`: a build to start from (it replaces what's kept). The builds are `courtyard`, `castle`,
  `arcade`, `aqueduct`, `stones`, `house` and `harbour`.
- `?preview`: the courtyard, building itself a block at a time, turning. The lab's index uses it.
- `?debug=1`: no shadows. `?debug=2`: normals. `?debug=3`: each cube coloured plainly by its stuff.
- `?noworkers`: all the shaping on the page's own thread.

## Checks

`node cells/lab/devtools/blocks.test.mjs` checks:
- the reads, and what they make:
  - a stack tapers, and its foot steps out;
  - a run is drawn in less than a stone alone, and its end least;
  - an arch sees both its supports, and its underside is cut, edged in tile;
  - a corner pier spreads both ways;
  - the same surroundings read alike, turned;
- the courtyard:
  - its court meets walls four ways;
  - water where the walls are far, beds against them, trees in the corners, growing on up;
  - nothing growing under cover, and no court outside;
  - windows onto the court, and a door at the back of the porch;
- every demo and a random scatter are closed and face out, face by face on the lattice of twelfths;
- the same build in two orders gives the same shapes;
- one block changes nothing further than a court's reach and the cells round it;
- undo gives back what was there.

`node cells/lab/devtools/blocks-shot.mjs [outdir] [view,view…]` draws each demo and tries the hand
in a browser: a tap sets, a drag lays a run, a hold takes, and undo puts it back.
