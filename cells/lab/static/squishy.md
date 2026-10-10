# Squishy

A third-person platformer in which you are a dumpling: a clear pink squishy toy of one, full of
glitter, with a little pointed tip and a face printed on (or, by the `jelly` word at the bottom,
a steamed one of dough). You don't walk: you flick. Drag back
from anywhere on the screen and let go, as with a slingshot, and the dumpling flies the other
way, as hard as you pulled. Across a kitchen counter from one top to the next, steamers,
plates, a chopping board, a pudding, a lazy Susan, tea tins, up and over, to the golden
steamer: home.

| | Touch | Mouse and keys |
|---|---|---|
| flick | drag back and let go | drag back and let go |
| turn the camera, tilt it | two fingers, sideways and up or down | ← → |
| come close | pinch | the wheel |
| start the level again | `again` | R |

While you pull, the dumpling winds up, squeezed along the way it's going with its eyes shut
tight, and a dotted arc shows where its middle will go, ending in a ring where it lands: green
for a top further on, cream for one already reached, red for nowhere (the floor). The band on
the glass shows how hard. Its middle flies a true parabola, so the arc is exact up to where it
touches something. You can only flick from something, but a flick let go in the air waits a
moment (a third of a second) and goes as it touches.

Fall to the counter and it's a splat, and back to the last top you stood on. The clock runs
until you're home, the count of falls beside it, and your best time for each level is kept. Levels after the first are longer
and their gaps wider, with more kinds of top: 1 is steamers and a board, 2 brings plates, 3
puddings and tins, 4 the lazy Susan.

## The tops

- **Steamers**: bamboo baskets stacked down to the counter, each with its rim. Good grip.
- **A plate** on a tea tin: glazed porcelain, a little slippery. Land soft, or slide off.
- **A chopping board** laid across two jars: wide, and grippy.
- **A mango pudding** on a saucer: it gives, and throws you back up a little.
- **A lazy Susan**: lacquered, turning. It carries you round; flick from where it's taken you.
- **A tea tin**: tall, with a small top.
- **Chopsticks**, now and then, laid as a bridge between two tops near the same height.

Every level is made from its number, so level 6 is always the same level, and every hop in it
is checked when it's made: from the middle of each top there is a flick that lands on the
next.

## The dumpling

It is soft for real: a skin of particles in its shape (562 for the jelly's gumdrop, broad on a
flat bottom and drawn up into its tip; 450 for the dough's xiaolongbao, twelve pleats twisting
up to a knot), held to that shape by shape matching (Müller et al. 2005: each step,
the rotation that best fits where the particles are, from Müller, Bender et al.'s 2016
iteration, and the particles drawn back toward the rest shape so turned, partly allowed to
stretch). Its volume is kept as a constraint of its own, so a hard landing squashes it wide
and flat rather than smaller, and it bulges at the sides. It's stepped ten times a frame
(position-based dynamics: move, fit, keep the volume, push out of what it touches, and take
the velocities from where everything went).

The two are made differently: the jelly springs back faster and keeps more of each wobble, so a
landing squashes it to under half its height and it jiggles back; the dough is slower and
deader, and plops.

Where it touches, there's friction (Coulomb, from how hard it was pushed out), bounce where the
surface has any, and tack: dough is sticky, and the jelly nearly as much, so it holds to what it touches, a wall included
for a moment, and the tack tires on a wall so it slides down. Its wobble is damped against its
moving as one body (its middle's motion and its turning), so it jiggles and settles rather
than ringing. On the ground its roll dies and it rights itself like a roly-poly: tipped over, on its side or
its head, it rolls back over the edge it's lying on onto its flat bottom; sat still, it
shuffles round to look at you.

The face is drawn on its rest shape, so it turns, squashes and stretches with it: round eyes
with a shine that blink, red cheeks, squeeze shut `> <` while you wind up, an `o` in the air, a happy `^ ^` at home.

## Drawing

WebGL2. The light is a window's: a soft shadow map (the shadow sharper near what casts it),
the course in its materials (woven bamboo with its rims, glazed porcelain, a pudding with a
caramel top, lacquer, painted tins, a chopping board's grain, chopsticks with lacquered ends),
the tiled wall with its windows behind, steam in the air.

The jelly is seen through. What's behind it is copied and drawn again through it, bent as a lens
of jelly bends it (refracted, from how far through it the eye looks at each point) and tinted
the deeper it goes (red comes through; green and blue are taken), with a little of the light
caught inside it, pinker at its thin rim and glowing where the window is behind it. In it, a
thousand flakes of glitter, each carried by the four nearest particles of the skin so they
squash and wobble with it, each a tiny mirror turned its own way: one flashes when it catches
the window, as the jelly turns or jiggles. Over it all its gloss (the room in it, the window
sharp) and the printed face. Where the window's light comes through it to the ground, a pink
light gathers in its shadow.

The dough is lit as dough:
thick, the light wrapping round it and glowing a little through its thin edges, darker in its
pleats, faintly floury, with a dark under it on whatever it's over.

`?level=3` starts a level; `?skin=dough` the dough; `?auto` lets it play itself.
