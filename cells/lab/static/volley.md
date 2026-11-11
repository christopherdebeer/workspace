# Volley

> A brick-breaker up a shaft without end, played lying on your back. There is no paddle: the screen is a pane of glass, and you throw the ball back up with a hand on it.

![Before the first ball](volley/v-ready.jpg)
![A ball in flight](volley/v-back.jpg)

The tunnel is the shape of your screen and runs away from you for ever. You are a pane of glass across its whole section. The ball goes on ahead into slabs of bricks and comes back; wherever it comes back through the glass, a hand has to be there. Break most of a slab (three fifths) and the rest of it falls, and you go on down the tunnel to the next. A ball let through is one of five gone.

Touch anywhere to send the ball off (it leans toward where you touched). The orange ring on the glass is where the ball is going to come through; it closes as the ball arrives.

## A ball thrown at the ceiling

You are lying on your back at the bottom of a shaft, throwing a bouncy ball up at what's above you. Down is toward you.

- **It falls back.** Thrown up, the ball slows all the way; if it meets nothing it stops, hangs, and comes down again as fast as it left. Nothing else brings it back: there's no rule that returns it, only the fall.
- **How hard is how high.** How fast your finger is going is how hard the ball goes, and so how far up the shaft it gets. A soft throw doesn't reach the bricks at all; a lob (letting go of a still finger) barely leaves your hand; a hard flick reaches the slab after next.
- **It comes down harder off a brick.** A ball that meets the underside of a brick on the way up is turned, and then falls: the nearer the bricks, the quicker and sharper the volley.
- **Thrown hard enough, it goes through.** A ball meeting a brick square on and fast breaks it and carries on up, a fifth slower, into the next: one good throw can take a line out of a slab, or two slabs. And it can come down on top of the slab it went through, and break its way back. (The dark bricks always turn it.)
- **It spins.** The sideways motion of your finger leaves the ball spinning that way, and the spin bends its flight for about a second, or until a wall takes most of it off.
- **The walls are just walls.** There is no floor: all four sides bounce the same, each keeping nine tenths.

## Three hands

The question this is for: with the whole screen as the surface and no paddle to drag, what should a finger be? **hand** (bottom right) changes it as you play; each keeps its own best depth.

- **pad**: a finger on the glass is a sprung pad, about a sixth of the screen's height across. The ball leaves by where on the pad it landed (off the middle, straight back; off the rim, sharply away from the middle), about as fast as it came and never slowly. Strike it, with the finger moving as it lands, and it goes harder and that way, spinning. Two fingers are two pads.
- **swipe**: a finger that is still does nothing. Only a moving finger counts; the ball leaves the way the finger was going and as hard as it was going. The reach is half as big again, since you are passing through rather than waiting. It asks for timing where the pad asks for placing, and it is the one that hits hardest for least effort.
- **catch**: a finger under the ball catches it, and it stays under the finger for as long as you hold it. It is thrown when you let go, the way and as hard as the finger was moving. The most exact: you can stop, look down the tunnel, wind up, and choose a brick. With this hand you pick the first ball up yourself.

A mouse is a hand wherever it is, button or no; letting the button go is letting go.

![Further down](volley/v-deep.jpg)

## Reading a ball in a tunnel

From the glass, a ball going away and a ball coming back look nearly the same, and its depth is the thing you most need. Four things give it:

- **Its light.** The ball lights the four walls round it, so there is a band of light on the tunnel at the ball's depth, moving with it. The walls are panelled on the bricks' own grid, which makes that band countable.
- **The ring on the glass**, for the last second and a third of its fall: where it will come through, the bounces and the bend reckoned in. `guide=0` takes it away, to see how much the rest carries.
- **Its sound.** Each hit is placed left or right and is quieter with distance; the bricks ring higher toward the top of the tunnel.
- **It is never hidden.** Behind a slab it is drawn faintly through whatever covers it.

## The tunnel

Slab after slab, made from the seed: a frame, a cross, a chequer, bars, a window, a mirrored figure, diagonals; closer pairs now and then, which a ball can get between. Deeper slabs are denser and some bricks take two. The glass runs freely down a clear tunnel and comes to a halt at arm's length from bricks still standing, so the volley is quickest exactly when you're closest. On a wide screen a slab has many more bricks, and ten broken is always enough. The lamps change colour every hundred and twenty metres; the tunnel winds (in the picture only: the game's tunnel is straight).

![On a wider screen](volley/v-wide.jpg)

## How it is made

- `client/volley/sim.ts` is the game and nothing else: a falling, spinning sphere against boxes and four walls, in fixed steps of 1/240 s, everything random from the seed. Hands are given to it as points on the glass with a velocity; what a hand does is decided there. It also holds the stand-in player, which plays all three hands. Tested on its own in `devtools/volley.test.mjs`.
- `client/volley/draw.ts` draws it: every surface an axis-aligned box, instanced, one program; the ball a sphere. The eye sits far enough behind the glass that the glass exactly fills the screen, so a point touched and a point in the tunnel are the same point. No assets, no libraries.
- `client/volley/main.ts` is the fingers, the rings on the glass, the sound and the words.

## Flags

`seed` (a number, or a name like `moss-ford-7`), `hand` (`pad`, `swipe`, `catch`), `auto` (the stand-in plays), `t` (run on this many seconds first, the stand-in playing), `still` (and hold there), `guide=0`, `mute`, `preview` (the index's card). `window.__volley.probe()` reports the game and the renderer.

## Before this

The third version's ball fell toward the bottom of the screen, like a ball thrown at a wall; it came back along the floor, and needed a rule to make it come back at all.

The second version had the tunnel and the three hands, but its ball was an arcade one: weightless, always the same speed, a perfect mirror off everything.

The first version kept the flat game as it was and only moved the eye: a court seen from behind a paddle you dragged left and right. It is in the repository's history (`lab: Volley, a brick-breaker seen from the paddle`).
