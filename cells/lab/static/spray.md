# Spray

The phone is the can. Hold it like one, aim it with the middle of the screen, and keep a thumb on
the glass to spray. The paint stays on the wall in front of you, out in the world.

## Three ways to hold the can

| | Where | What's tracked | How near the can is |
|---|---|---|---|
| **AR** | where the browser has WebXR AR (Chrome on Android) | the phone, in space: walk about, come close, step back | measured: the real distance to the wall |
| **camera** | everywhere else with a camera (iPhone among them) | which way the phone points (its gyroscope), not where it is | the slider under your right thumb |
| **a brick wall** | anywhere (no camera, a desk, the lab's index) | your finger, or the mouse, is the nozzle | the slider |

**In AR** the first spray finds the wall: the surface the phone points at, which can be a wall,
the floor or a table. Paint lands on it at its real distance. `new wall` lets the next spray find
another surface.

**Through the camera**, the wall is put where the phone points when you start, a metre and a half
out. Turning on the spot, the paint stays where it was sprayed. A pure turn moves everything in
view alike, however far away it is, so the paint holds to the real wall even though its distance
isn't known. Walking, it doesn't: the phone isn't tracked in space, and the paint comes with you.
`new wall` puts it where you're pointing now. The picture's field of view is a guess at a
phone's main camera (66° across its long side); if the paint swims as you turn, `?fov=` sets it.

## The paint

- **The cone.** The spray is a cone (about 11° to its edge). A spot's size is the can's distance
  times that, so near is small and far is wide.
- **Density.** Near is dense: a solid line in half a second. Far is a mist that takes a few
  seconds to build. It's not as steep as the spot's area alone would make it, because a real
  cone is fuller at its middle.
- **Overspray.** Around the core, single droplets land as crisp dots, thinning with distance from
  the middle.
- **Drips.** A coarse grid soaks up the paint where it lands. A patch that gets too wet (a near
  spray held still) runs: a drip, down the wall, slowing as it spends its paint, with a bead at
  the end. Far mist never runs. Paint dries in a few seconds.
- **The texture.** The wall's paint is one texture, 3072 × 2304. Stamps are laid into it many
  times a frame, close enough along a fast sweep that it stays a line, not a row of dots.

## Sound and the rest

- **Sound.** A hiss while spraying, harder and higher close to the wall. Shake the phone and the
  mixing ball rattles; picking a cap rattles it too.
- **The caps.** Eleven colours: white, black, chrome, red, orange, yellow, lime, cyan, blue, pink
  and violet.
- **`photo`.** Saves the camera's picture with the paint over it, or shares it where the phone
  can. In AR the browser doesn't hand the camera's picture to the page, so there's no photo there
  yet.
- **`?tag`.** Watch a wall get tagged by itself: letters as loops and slashes, filled fat,
  outlined thin, a few white glints on top. The lab's index (`?preview`) does the same, smaller.

## Notes

- `client/spray/paint.ts` is the paint: walls, the cone, stamps, wetness and drips. It knows
  nothing of how the can is tracked. `main.ts` is the three ways to hold the can, the sound and
  the tagger.
- Camera and motion stay in the phone. Nothing is sent anywhere.
- The AR path is written to the WebXR spec (hit-test, dom-overlay) but has not been tried on a
  device yet.
