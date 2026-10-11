# Squishy

A third-person platformer in which you are a dumpling: a steamed one, of dough, with a face;
from level 13 (and, once you've been there, by the word at the bottom, anywhere) a clear pink
jelly squishy toy of one, full of glitter, with a pointed tip. You don't walk: you flick. Drag back
from anywhere on the screen and let go, as with a slingshot, and the dumpling flies the other
way, as hard as you pulled. Across a kitchen counter from one top to the next, steamers,
plates, a chopping board, a pudding, a lazy Susan, tea tins, up and over, to the golden
steamer: home.

| | Touch | Mouse and keys |
|---|---|---|
| flick | drag back and let go | drag back and let go |
| spin | swipe as you let go: on, the way it will fly, for topspin; back, for backspin | the same |
| nudge | tap: it rolls once toward where you tapped (tap on it: straight on) | click |
| turn the camera, tilt it | two fingers, sideways and up or down | ← → |
| come close | pinch | the wheel |
| start the level again | `again` | R |

While you pull, the dumpling winds up, squeezed along the way it's going with its eyes shut
tight, and a dotted arc shows where its middle will go, ending in a ring where it lands: green
for a top further on, cream for one already reached, red for nowhere (the floor). The band on
the glass shows how hard. Its middle flies a true parabola, so the arc is exact up to where it
touches something. You can only flick from something, but a flick let go in the air waits a
moment (a third of a second) and goes as it touches.

A finger lifted still flicks just as aimed. A finger *swiped* as it lets go gives spin, and the
aim is taken from before the swipe, so the swipe doesn't change where it goes. Swiped on, the
way it will fly, it has topspin: it rolls on when it lands, two or three times as far, which is
how you cross a pan or reach the far side of a board. Swiped back, it has backspin: it bites
where it lands and stays, even on butter. A word at the bottom says which you gave it.

A tap is a nudge: one roll the way you tapped, a hand's width and no more, with hardly a hop. For
creeping to an edge, off a lid, or back to the middle of a top.

Fall to the counter and it's a splat, and back to the last top you stood on. The clock runs
until you're home, the count of falls beside it, and your best time for each level is kept. Levels after the first are longer
and their gaps wider, with more kinds of top: 1 is steamers and a board, 2 brings plates, 3
puddings and tins, 4 the lazy Susan. Level 5 moves to the stovetop, a new kitchen with its own
things (below); from 9 on the two are mixed.

## The tops

- **Steamers**: bamboo baskets stacked down to the counter, each with its rim. Good grip.
- **A plate** on a tea tin: glazed porcelain, a little slippery. Land soft, or slide off.
- **A chopping board** laid across two jars: wide, and grippy.
- **A mango pudding** on a saucer: it gives, and throws you back up a little.
- **A lazy Susan**: lacquered, turning. It carries you round; flick from where it's taken you.
- **A tea tin**: tall, with a small top.
- **Chopsticks**, now and then, laid as a bridge between two tops near the same height.

## The stovetop

From level 5 the course is on the hob: brushed steel, a burner under each pot, the tiles behind.

- **A frying pan** on a pot: wide, a little slippery (seasoned iron), with a rim round it that
  catches a slide, and its handle out to one side.
- **A butter dish**: the butter is slippery, so a landing slides, a long way at speed; the dish
  has a lip all round that stops you. Backspin bites instead. From against the lip, a flick over
  it catches on it (the arc shows the catch), so flick away from it, or hop to the middle first.
- **A honey jar**, from level 6: taller than a flick reaches, with honey run down its side. You
  don't land on it: you land *against* it, splat into the honey, and stick, hanging there,
  until you flick on. The course turns sharply at a jar. Honey holds whatever touches it, so a
  flick into the jar from the honey climbs it a little and sticks again, higher.
- **A pot with its lid on**, from level 7: every few seconds the steam under the lid lifts it,
  seven centimetres, rattling, and lets it down again. Land on the lid and you ride up with it;
  flick from the top of the lift and you've seven centimetres more. The arc knows the lid's
  cycle, so it shows where you'd land at the moment you'd land there. A lid lifted while you
  arrive is a lid you can land *under*, on the pot, and then it comes down on you.

Every level is made from its number, so level 6 is always the same level, and every hop in it
is checked when it's made: from the middle of each top there is a flick that lands on the next;
onto a lid, at some moment of its cycle; from a honey jar, from a little lower on it too.

## What gets on it

Some tops have something on them that comes off on the dumpling where it touches, and stays
there, on that part of it, wearing off in time and shaken off by a hard landing; while it's on,
it has its say in how it lands:

- **Flour** (on half the chopping boards): dry. It grips better, and loses its own tack, so it
  won't hold to a wall.
- **Butter** (the butter dish): slippery. It slides far on anything, can't hold a wall, and
  honey won't hold a buttered patch: a buttered dumpling thrown at a jar slides off it.
- **Crumbs** (some plates): rough. It bounces where it lands, and takes longer to settle.
- **Pepper** (some plates): it sneezes, a little while after, a hop any way, and the pepper's
  off it. On a small top, mind.
- **Hundreds and thousands** (some puddings): sweet and sticky. More tack: it holds walls
  better.

You can see all of it: the flour's dusting, thicker in the creases, butter's yellow sheen,
crumbs stuck on in lumps, pepper's specks, the sprinkles' coloured rods, each on the part that
touched, riding its wobble. The first of each is named at the bottom when you pick it up.

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
surface has any, and tack: dough is sticky, and the jelly nearly as much, so it holds to what it
touches, a wall included for a moment, and the tack tires on a wall so it slides down. Butter
has no tack to give. Honey has more than the dumpling's own, and it never tires: a particle
that touches honey is held where it touched, the whole body is slowed hard so its momentum
doesn't tear it off the patch that's stuck, and each step the rest of it is drawn back up so
that it hangs from the patch rather than sagging off it.

Spin is what you gave it at the flick, spent as it lands: with topspin it really rolls, the
roll is let live and the grip eased for a moment; with backspin the grip is doubled, the tack
quick to hold and the roll killed, so it plants. Its wobble is damped against its
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

The camera follows easily, but if the dumpling nears the edge of the glass, or leaves it, the
camera catches up at once.

The lids move: they're drawn where the steam has them, with a puff of steam out from under as
one lifts and a rattle you hear when you're near. The honey jar is glass, drawn after
everything else and seen through, the honey in it lit from within.

`?level=3` starts a level (5 to 8 are the stove); `?skin=dough` the dough; `?auto` lets it play
itself.
