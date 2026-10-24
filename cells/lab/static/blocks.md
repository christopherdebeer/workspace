# Blocks

Stone blocks on a lattice, set with a finger. No block has a shape or a part to play of its own,
and no form has a name. Each block is read from the blocks round it, and from theirs, as a few
plain quantities: how open each face is, how much rests on it, what stands near it, what pushes
on it. One shape program makes every block from those numbers.

Columns, arches, capitals and buttresses appear where the quantities fall that way. Nothing in the
code asks for them. Where the quantities fall in between, the shape is something in between.

The carving comes from the neighbourhood as well. Blocks with the same surroundings, however
turned, are carved alike and turned to match, so the build rhymes where it repeats. Set one block
and shapes change up to four cells away. You see the change run out from your finger, ring by
ring.

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

## What a block reads

A block reads the cells two each way round it: 124 cells. Nothing about it is stored. Read the
same arrangement again, anywhere, and you get the same block. It reads:

- **joins**: which of its faces meet stone;
- **softness**: how little stone is round it;
- **openness** of each face: open, sheltered (stone two cells out), or closed;
- **load**: the stone resting on it, straight up, counted to two;
- **support**: whether it stands on stone or on the ground. If it doesn't, which blocks round it
  at its level do;
- **thrust**: whether stone carried over nothing pushes on it from one side, low enough that it
  can spread its foot the other way to the ground.

## What that makes

One program, the same for every block:

- **Section.** Each open side is drawn in. How far depends on how open the two sides across are,
  and on the run the block is part of:
  - alone, it's drawn in fully;
  - in a run, it's drawn in less;
  - at the end of a run, least.
  Load holds the section out. Load is measured from the top of the stone above, so a stack tapers
  as one. On the ground, the foot flares.
- **Joins.** Where a block is joined, it runs on into its neighbour, one direction at a time, so
  the two are one stone. Where their faces meet at an angle, a fillet fills the corner. The fillet
  is wider between a block and the one above or below it.
- **Underside.** A block with nothing under it is cut from below. The cut rises from the blocks
  round it that stand: a quarter ellipse, flat beyond 1.25 cells. Every block under one arch
  reckons the cut from the same supports, so the cut is one arch. Between two stones that stand a
  cell apart, two arcs meet in a point. Held on one side only, it's a bracket.
- **Thrust.** A block pushed from one side gets a wedge on the other. The wedge's sloping face
  runs from nothing at the level of the push to its full spread on the ground.
- **Edges.** They're rounded by how exposed the block is, softer when it's alone.

What comes of that:
- **A column** is a stack open all round.
- **Its capital** is the fillet where the column meets the broader stone it carries. **Its base**
  is the flare on the ground.
- **A wall** is a run drawn in across, thicker at the bottom where it carries more. **Its
  corners** stand proud like pilasters, because a corner block isn't open on both sides of
  either axis.
- **An arch** is a run carried over nothing between stones that stand.
- **A buttress** is what an end pier of an arcade grows.
- **A lone stone** is a tapering post.

None of these is a rule.

## Carving

A block's surroundings are turned to a canonical orientation: the least of their eight turns and
mirrors about the vertical, compared cell by cell. That orientation gives a code:
- 12 bits from the 26 cells next to the block;
- 12 bits from all 124.

The fragment shader turns each point into that orientation and carves the face. The cells next to
the block, and where it is, choose the kind:

| Where | Kinds |
|---|---|
| a column | fluting, or bands |
| what's carried over nothing | chevrons, or coffers underneath |
| the ground course | rustication |
| a top course | a frieze: lozenges, vermiculation, roundels |
| the field of a wall | mostly plain, sometimes a sunk panel, a roundel or a slit |

All 124 cells set the kind's measures: how many flutes or lozenges, how deep the panel, how wide
the slit.

Blocks with the same surroundings, however turned, carry the same carving, turned with them.
The four corners of the arcade are carved alike, each turned its own way. A long wall's middle
blocks are carved alike, its ends differently, and its courses differently again.

Joints are drawn where two blocks meet. The carving fades near them and near the line where one
block's surface gives way to another's, so the change from one carving to the next doesn't
show. The stone is darker and damper where it's sheltered and low. Exposed tops are bleached and
spotted with lichen.

`?debug=3` colours each block by its code, which shows the rhymes.

## How it's made

All the blocks' solids together make one distance field. Each cell's part of the surface is cut
from that field by surface nets, at six samples a side. Each vertex is then stepped onto the true
surface along the field's gradient.

Two cells that share a sample compute it with the same whole-number arithmetic. They agree to the
last bit, so the build is closed, with no crack, whatever order it was built in. The stone is cut
level with the ground.

A cell's mesh depends only on the reads of the cells two each way round it, so it's named by them.
When you set a block:

1. The block itself is shaped already; the faint preview made it.
2. The cells round it are read again.
3. Workers shape whatever is new, nearest first, and each new shape is put in as it arrives. The
   workers are this lab's own bundle, loaded again as workers.

The page's own thread spends a few milliseconds on an edit. The shapes spring, settle and sink in
the vertex shader, so a touch is felt without any work on the CPU.

## Presets

- `?demo=`: a build to start from (it replaces what's kept). The builds are `aqueduct`, `stones`,
  `arcade`, `castle`, `house` and `harbour`.
- `?preview`: a castle that builds itself a block at a time, turning. The lab's index uses it.
- `?debug=1`: no shadows. `?debug=2`: normals. `?debug=3`: blocks coloured by their codes.
- `?noworkers`: all the shaping on the page's own thread.

## Checks

`node cells/lab/devtools/blocks.test.mjs` checks:
- the reads, and what they make:
  - a stack tapers as one, and its blocks agree where they meet;
  - a run is drawn in less than a stone alone, and its end least;
  - an arch sees both its supports;
  - a corner pier spreads both ways;
  - the same surroundings read alike, turned;
- every demo and a random scatter are closed and face out;
- the same build in two orders gives the same shapes;
- one block changes nothing more than four cells away;
- undo gives back what was there.

`node cells/lab/devtools/blocks-shot.mjs [outdir]` draws each demo and tries the hand in a
browser: a tap sets, a drag lays a run, a hold takes, and undo puts it back.
