# Labyrinth

A flat stone, and touches that build on it. Each touch raises the stone around it by a level. Walls of a maze rise first. Touch again and the next level stands on arches over the passages below. Dead ends grow stairs up onto the walls, and the walls' tops are walkways. It is drawn the way Escher's prints draw such things: from above at an angle, square to nothing, in ink. It can also be hatched as a lithograph.

![nine touches: a mound of levels, each a maze, each on arches over the one below](labyrinth/v-built.jpg)

## Using it

- **Touch the stone** to build. Where nothing stands, the walls of a maze rise around the touch in a ripple. Touch something already built and the next level goes up there. The levels below spread a little wider than the one above, so it climbs as a stepped mound of up to seven levels.
- **Drag sideways** to turn it. When you let go, it settles on the nearest corner, looking down a diagonal as the prints do.
- **Pinch**, or scroll, to come closer or go back.
- **print** draws it as a lithograph. **again** clears the stone.
- What you've built is kept on this device: its seed and the columns you touched, in order.

![where it starts](labyrinth/v-stone.jpg)
![one touch](labyrinth/v-one.jpg)
![three touches in one place](labyrinth/v-three.jpg)

## How it's built

The stone is a square of 17 × 17 voxels: 8 rooms each way, with walls between them as thick as the rooms. It holds up to seven levels, each 1.25 voxels high (`model.ts`).

**Each level is a block maze.** Its rooms and passages are one voxel wide, its walls one voxel thick, and there is a post wherever walls cross. Each level is a perfect maze: there is exactly one way between any two of its rooms. A touch adds rooms to the level and joins them in with a randomised Kruskal, opening walls only between rooms that aren't yet connected. Where new rooms meet part of the level that's already built, one gate opens into each such part.

**Each level's grid is offset by a voxel from the one below.** Its rooms and posts swap places. That one choice settles how every level stands on the one below:

- a room sits on a post below, so it has a floor;
- a post stands over a room below, on a **cross vault** springing from that room's four corner posts;
- a wall, or a walkway, over a wall below sits on it;
- over a passage below, the passage is spanned by an **arch**, a barrel vault between the posts either side. Whatever is above (a wall or a walkway) stands on that.

So any open voxel with something built over it has a vault, and the lower labyrinth runs on beneath the upper one. Where a vaulted passage opens onto a passage with nothing over it, the arch shows in the face between them.

![the passages below run on under the level above](labyrinth/v-arches.jpg)

**A touch raises a stepped mound.** The touch builds the next level up from the column it lands on. Each level below it spreads a little wider than the one above, so the upper levels have something to stand on. The ground level is broad. Each level above it is a small **core** over the touch, which a later touch can build on again, with **arms** reaching out from the core: walled walkways that walk outward room by room, mostly straight on.

**Arms can go on as bridges.** An arm that walks past the edge of the level below carries on over open air. It stands on **piers** that rise from the stone, or from stone below, at its posts, with arches between them. A pier is a column of stone standing alone, not part of any level's maze.

**Stairs are not stored.** They follow from the maze. About half of the dead ends with nothing built over them have a stair. Each stair climbs onto the wall at the end of its dead end, and the tops of walls are walkways. Build over a stair, or open the wall at its end, and the stair goes. A level above the first also opens a gate out onto the wall tops of the level below.

![dead ends climb onto the wall at their end](labyrinth/v-stairs.jpg)
![touched five times in the same place](labyrinth/v-tower.jpg)

## How it's drawn

Everything is built from the model each time it changes (`mesh.ts`):

- **blocks** are drawn with their faces where nothing solid is against them, darkened at the foot where they meet a floor;
- **vaults** are surfaces `y = f(x, z)` under a deck: a barrel `ys + √(r² − d²)` across the span, or for a room, a groin vault that takes the higher of the two barrels at each point. Where the two barrels meet, the groins are sharp creases. A spandrel face carries the arch where a vault opens onto the sky;
- **stairs** have five steps each;
- **the stone** has a faint seam where each voxel's square lies.

It is rendered with WebGL2 (`render.ts`):

- the camera is orthographic;
- a shadow map gives the shadows of a low sun, with sky light weighted by how shut in each surface is (ambient occlusion, baked per vertex);
- a post pass draws the ink where the depth folds (a Laplacian, so a sloping face doesn't draw a line) or where the surface turns sharply.

In **print**, the light becomes hatching on paper: one direction of lines, then crossed, then a third direction as it gets darker.

Everything rises as it's built. Each vertex knows when its voxel was built and the height it grows from, and the vertex shader draws it grown that far: walls rise from their floor, and vaults come down from the deck above.

![as a print](labyrinth/v-print.jpg)
![close, as a print](labyrinth/v-print-close.jpg)

## Checked

`node cells/lab/devtools/labyrinth.test.mjs` builds 60 labyrinths of 40 touches each and checks every voxel, about 94,000 checks in all:

- every level is a perfect maze, with as many passages as rooms less its separate parts;
- every built voxel stands on something: the stone, what's built below it, or an arch whose springing is stone or a pier;
- every pier stands on stone and carries something;
- every stair is in a dead end with nothing built over it, and climbs onto a wall;
- the same seed and the same touches make the same stone;
- most labyrinths reach the fourth level, and there are stairs, vaults and bridges.

These are the model's promises, checked on the model itself. Whether it *looks* Escheresque is judged from the pictures.

## Links

- `?seed=7&taps=8.8,8.8,8.8,4.12,12.4,8.8,12.12,4.4,8.8` builds that labyrinth at once (each tap is a column `i.j`, in order). Add `&print` to see it as a print.
- `?turn=1` turns it a quarter; `?zoom=0.45` comes closer.
- `?preview` is the index's card: a labyrinth built, turning slowly.

Every picture: [views](labyrinth/views.md), made by `node cells/lab/views.mjs labyrinth`.

## Next

- A walker: someone small who goes through it, up the stairs and over the arches. The model already says where the floors, wall tops and stairs are.
- Escher's own impossibilities: from one corner, a walkway that meets a wall it can't reach, or a stair that climbs forever.
- Masonry: courses and joints on the stone, as the prints cut them.
