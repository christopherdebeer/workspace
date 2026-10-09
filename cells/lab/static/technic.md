# Technic

Bricks, evolved. The studs are gone; in their place, holes. Beams with holes along them, pins
and axles that go through the holes, gears that mesh, wheels that roll, ramps and marbles, a
motor, and a hub that tells the motor what to do. You build it, then it goes.

The build stands on a pegboard: a wall of holes behind it, a floor beneath. Pieces lie in layers
in front of the board, each layer one module deep (a module is one hole pitch, 8 mm, as on the
real pieces). Pins and axles go through the holes, across the layers, and into the board.

## Hands

| | Touch | Mouse and keys |
|---|---|---|
| the drawer of pieces | `pieces` | P |
| take a piece | tap it in the drawer (it goes in the corner); or drag it sideways out of the drawer onto the build | the same; N for the next |
| use the piece in hand | drag it from its corner | the same |
| put it on | let go where it should go | the same |
| turn the piece in hand | tap its corner | R |
| select a placed piece | tap it (the one you just put on already is) | click it |
| move it | drag the selected piece: the hole you take it by stays under your finger | the same |
| turn it · bring it nearer · send it farther | `turn` · `nearer` · `farther` | R · ] · [ |
| change a beam's colour | `colour` | C |
| take it away | `remove` | Delete |
| let it go | tap nothing | Esc |
| step back | `undo` | Z |
| run it, stop it | `run` / `stop` | space |
| your builds | `builds` (the start screen: continue one, rename or forget it, or start from something) | Esc closes it |
| the hub's program | tap the hub (as it runs, or a selected one); `program` | the same |
| look around | drag anything else; two fingers pinch and slide | drag; right-drag (or shift) slides; the wheel |

## Where a piece goes

- **A beam** (or a crank, the motor, the hub) lands with the hole you hold it by in the hole under
  your finger: in the layer against the board, or the first layer in front of it where it fits.
  Nothing overlaps in a layer.
- **A pin** goes into the hole under your finger: through the front piece there and the one behind
  it. If what's behind is the board, the pin goes into the board. A *tight* pin (black) holds what
  it passes through together. A smooth pin (tan) lets them turn on it. A long pin (blue) goes
  through three.
- **An axle** goes through the hole under your finger, from the back of what's there, forward.
  If the back is against the board, the axle goes into the board: it turns there, freely, so it's
  a pivot. An axle turns freely in a round hole; it's fixed in an axle hole (the cross-shaped one
  in a gear, a wheel, the first hole of a crank, the motor's output).
- **A gear** or **a wheel** goes onto the axle under your finger, in the first layer along it with
  room. Dropped on a hole with no axle, it brings one, long enough to reach from the board (or
  from the back piece) to the gear.
- **A ramp** is a bar with a hole at each end, sloping: `ramp 8·6` goes eight along and six
  down from the hole you hold it by (its top). `turn` makes it slope the other way. Only its
  ends are holes; a pin at either end holds it. It lies between the holes, so nothing else can
  cross it in its layer.
- **A ball** goes where you drop it, in the layer there (or the first in front with room).
  It's the one piece that meets the others: in its own layer it rolls on beams, ramps, the
  motor and the hub, and bounces off gears, wheels and other balls. Across layers, it passes.
- Two gears in one layer mesh when their pitch circles touch: an 8 and a 24 two holes apart, an 8
  and a 40 three, a 24 and a 40 four, two 24s three. The pitch radius is the teeth over sixteen,
  as on the real ones.

What is fixed, what turns, and what is free follows from that. A beam on a tight pin into the
board is part of the board. A beam on an axle in the board is a pendulum. A beam on a smooth
pin to another beam is a link. A gear on an axle through a beam turns with the axle; the beam
doesn't.

## Running

`run` lets it go. Gravity pulls, the floor and the walls hold, the motor turns. Drag anything to
pull on it (a crank, by hand). `stop` puts it all back as built.

The motor needs the hub, anywhere on the build; without it nothing is powered. Tap the hub for
its program: each motor has a port (A, B, …, in the order the motors went on), a speed, and a
rule:

- **run**: at that speed, that way.
- **to and fro**: the other way every two seconds.
- **turn at the walls**: the other way when the machine comes within reach of a wall (a car
  shuttles).
- **turn when tipped**: the other way when the hub tips past 35°.

The hub also shows what it reads: its tilt, and the distance to the nearer wall.

## The solver

The mechanism (`client/technic/pieces.ts`) is read off the build: pieces held together are one
rigid body; pins and axles in round holes are joints; gears touching are meshes; a motor's output
is a motor. The solver (`client/technic/sim.ts`) is position-based (XPBD) in the plane of the
board, in small steps: each step the bodies move freely, every constraint is projected once,
and velocities are read back from where things ended up. A body on one pivot turns about that
point exactly. A gear mesh keeps two rims moving together relative to the line between their
centres, so a gear carried round another still meshes. A motor advances the angle it wants with
only so much torque: stalled, it slips. Friction at the floor holds the bit of rim that touches
it, which is what makes a wheel roll.

Pieces don't collide with each other (they're in layers, and they pass): only the floor and the
walls are solid, and balls, which meet whatever shares their layer. Gravity is a tabletop's,
not the world's.

## Builds

The start screen (`builds`) keeps your builds in this browser, each with a name and a picture,
and offers what to start from: an empty board, or one of the machines. Starting from a machine
makes a new build of your own from it, to take apart, extend and change; the original stays as
it was. `begin again` clears the current build.

The marble run is the one to extend: two ramps, a seesaw, a paddle on the motor. Balls meet
whatever shares their layer (the one against the board, in that build), so a ramp, a beam or a
gear put there is in their way; a ball dropped anywhere joins in. A longer run is more ramps,
staggered, each held by a tight pin at its top; a lift is a crank or a wheel on the motor
where the balls come to rest.

## Notes

- The rules and the solver are tested on their own (`node cells/lab/devtools/technic.test.mjs`);
  the page, drawn and driven, with `node cells/lab/devtools/technic-shot.mjs --test`.
- `?demo=gears|crank|car|swing|marble` opens a machine built for you (not kept); `?auto` runs it
  by itself (the index's preview is `preview&demo=crank`).
- Your builds, each with the hub's program, and the piece in hand are kept in this browser.
- The flat drawings (the drawer's glyphs, the builds' pictures) are `client/technic/glyph.ts`:
  pure SVG from the pieces as built.
