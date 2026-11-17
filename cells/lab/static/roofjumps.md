# Roof Jumps

A figure running over an endless city of rooftops, in any direction, leaping whatever is in the
way. Drag anywhere and it runs that way (the drag is a stick: further is faster). It leaps gaps,
steps and clutter by itself, runs up walls too high to leap, and rolls out of long drops. Tap to
jump, and once more in the air. A second finger turns the eye. Keys: WASD or the arrows, space,
Q and E.

This is a study of two things only, the geometry and the figure moving over it, and it is drawn
as plainly as it can be on purpose: one grey, one light, fog. The point is to have a core that
looks can be tried over later without touching it.

`?seed=` the city · `?look=grid|clay|wire|tags|normals` · `?auto` it runs itself, wandering ·
`?t=` start that many seconds into such a run · `?still` hold the frame · `?preview` nothing over
the picture · `?follow=0` the eye never turns by itself · `?far=` chunks drawn each way (4) ·
`?side=90&zoom=2.6` the eye side on and close, for looking at the rig.

## The geometry (`city.ts`)

The world is a plane of chunks, 64 m square, each made from the seed and its own coordinates
alone: any chunk, at any time, in any order, always the same. A chunk is a list of boxes on a
one-metre lattice, about sixty of them (six hundred triangles):

- the chunk inside its streets is split in two again and again into lots, with a street, an alley
  or nothing between the halves;
- each lot is a building, a whole number of three-metre storeys, its height from a slow noise over
  the plane (so neighbours are mostly within a storey or two of each other) with the odd tower;
- on its roof, perhaps a raised part a storey up, a stair hut, a few units, a tank.

Every box carries a tag saying what it is, and nothing about how it looks. The sim asks the city
one question, `heightAt(x, z)`. A renderer gets the boxes.

## The runner (`runner.ts`)

A point with a velocity, and the judgement that makes the running effortless. At an edge, a step
or a wall it looks along the way it is going for where it can next stand: the first flat place
within a storey up or a couple down, else a wall, else the highest place in reach however far
down. Then it throws itself there on an arc worked out to land it: high enough to clear what is
between, flat enough to keep its pace. A wall is jumped at, caught and run up. Turn away in the
air and the leap is yours again. Its test holds a direction for a minute, sixteen ways in four
cities, and checks it never stops, never leaves the surface, and makes at least 5 m/s good
(`node cells/lab/devtools/roofjumps.test.mjs`).

## The figure (`rig.ts`)

Thirteen bones: pelvis, torso, head, two-part arms, two-part legs, feet. No keyframes. Each pose
is a dozen joint angles worked out from what the runner is doing: the stride's phase, the
flight's rise and fall (driving up off one leg, tucked over the top, reaching down), the
landing's weight, the wall. The hips ride at the height that puts the lower foot on the ground.
`bones()` gives each bone's matrix and its extent as a tapered block; the lab draws the blocks,
and anything else could hang on the same matrices.

## The looks (`render.ts`)

Everything about how it is drawn is in one fragment shader, switched by `look`: `grid` (clay with
the lattice drawn faintly over it: a metre, a storey), `clay`, `wire` (every triangle's edges),
`tags` (what each face is), `normals`. A new aesthetic is a new look there, or a new renderer
over the same chunks and bones.

## Not yet

Sloped roofs, ledges, planks and wires between buildings (everything is a box so far); vaults,
wall runs along a wall, slides; feet placed by IK; sound. The reference clip this was started
from could not be opened from here, so its particulars are not in this.
