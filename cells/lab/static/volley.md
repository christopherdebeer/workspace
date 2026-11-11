# Volley

> A brick-breaker down a tunnel without end. There is no paddle: the screen is a pane of glass, and you return the ball with a hand on it.

![Before the first ball](volley/v-ready.jpg)
![A ball coming back](volley/v-back.jpg)

The tunnel is the shape of your screen and runs away from you for ever. You are a pane of glass across its whole section. The ball goes on ahead into slabs of bricks and comes back; wherever it comes back through the glass, a hand has to be there. Break three quarters of a slab and the rest of it falls, and you go on down the tunnel to the next. A ball let through is one of five gone.

Touch anywhere to send the ball off (it leans toward where you touched). The orange ring on the glass is where the ball is going to come through; it closes as the ball arrives.

## Three hands

The question this is for: with the whole screen as the surface and no paddle to drag, what should a finger be? **hand** (bottom right) changes it as you play; each keeps its own best depth.

- **pad**: a finger resting on the glass is a round pad, about a sixth of the screen's height across. The ball leaves by where on the pad it landed (off the middle, straight back; off the rim, sharply away from the middle), and a little by how the finger was moving. This is the old paddle's rule, turned from a line into a disc, and it can be anywhere at once: two fingers are two pads.
- **swipe**: a finger that is still does nothing. Only a moving finger counts, and the ball leaves the way the finger was going. The reach is half as big again, since you are passing through rather than waiting. It asks for timing where the pad asks for placing.
- **catch**: a finger under the ball catches it, and it stays under the finger for as long as you hold it. It is thrown when you let go, the way the finger was moving. The slowest and the most exact: you can stop, look down the tunnel, and choose a brick.

A mouse is a hand wherever it is, button or no; letting the button go is letting go.

![Further down](volley/v-deep.jpg)

## Reading a ball in a tunnel

From the glass, a ball going away and a ball coming back look nearly the same, and its depth is the thing you most need. Four things give it:

- **Its light.** The ball lights the four walls round it, so there is a band of light on the tunnel at the ball's depth, moving with it. The walls are panelled on the bricks' own grid, which makes that band countable.
- **The ring on the glass**, for the last second and a third of its flight. `guide=0` takes it away, to see how much the rest carries.
- **Its sound.** Each hit is placed left or right and is quieter with distance; the bricks ring higher toward the top of the tunnel.
- **It is never hidden.** Behind a slab it is drawn faintly through whatever covers it.

## The tunnel

Slab after slab, made from the seed: a frame, a cross, a chequer, bars, a window, a mirrored figure, diagonals; closer pairs now and then, which a ball can get between. Deeper slabs are denser and some bricks take two. The glass runs freely down a clear tunnel and comes to a halt at arm's length from bricks still standing, so the volley is quickest exactly when you're closest. On a wide screen a slab has many more bricks, and fourteen broken is always enough. The lamps change colour every hundred and twenty metres; the tunnel winds (in the picture only: the game's tunnel is straight).

![On a wider screen](volley/v-wide.jpg)

## How it is made

- `client/volley/sim.ts` is the game and nothing else: a sphere against boxes and four walls, in fixed steps of 1/240 s, everything random from the seed. Hands are given to it as points on the glass with a velocity; what a hand does is decided there. It also holds the stand-in player, which plays all three hands. Tested on its own in `devtools/volley.test.mjs`.
- `client/volley/draw.ts` draws it: every surface an axis-aligned box, instanced, one program; the ball a sphere. The eye sits far enough behind the glass that the glass exactly fills the screen, so a point touched and a point in the tunnel are the same point. No assets, no libraries.
- `client/volley/main.ts` is the fingers, the rings on the glass, the sound and the words.

## Flags

`seed` (a number, or a name like `moss-ford-7`), `hand` (`pad`, `swipe`, `catch`), `auto` (the stand-in plays), `t` (run on this many seconds first, the stand-in playing), `still` (and hold there), `guide=0`, `mute`, `preview` (the index's card). `window.__volley.probe()` reports the game and the renderer.

## Before this

The first version kept the flat game as it was and only moved the eye: a court seen from behind a paddle you dragged left and right. It is in the repository's history (`lab: Volley, a brick-breaker seen from the paddle`).
