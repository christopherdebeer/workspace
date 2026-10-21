# Labyrinth: an atlas of encounters

Astra's note, in short: the ambition depends on what the material can become. Beneath finished pieces (a stair, a tower, a bridge) are more fertile ingredients: **thickness, surface, edge, void, span, fold, opening, rhythm**. What matters is what forms do when they meet (**penetrate, divide, wrap, thicken, exchange roles, interlock, dissolve, reconcile**), and how the hand's movement steers that (pass alongside, cross through, circle around, double back, broaden, pull upward, retrace). Pairs show whether forms meet; three-way combinations show whether a form can *adapt* or only *attach*.

The method proposed: map the encounters broadly; find the geometric capabilities recurring in the best results; build those as reusable operations; add forms that use them differently; test combinations of combinations.

This page is the first map: **wall × stair**, made the way a hand makes it.

## How it's made

`devtools/labyrinth-atlas.mjs`. Each case lays a setting (a wall, a terrace, pools, a tree), then draws one stroke through the production reading (`gesture.ts` `stroke()`: no intent in hand, as the app reads a stroke). What came of it is recorded and classed:

- **adapts**: one changed for the other (the wall opened, was cut, was walked, carried the stair);
- **attaches**: something was laid beside the other, neither changed;
- **refused**: nothing was laid.

That's generous, so each case also names what it would be **at its best** and checks for it (`BEST` in the harness): the measure that matters.

## Wall × stair, as it stands

![wall × stair: thirteen cases](labyrinth/atlas-wall-stair.jpg)

| Case | At its best | What it is now | Best? |
|---|---|---|---|
| **beside**: up beside a wall to a terrace past its end | cantilevered steps hung from the wall | a flight hung from the wall | ✓ |
| **across**: up across a wall to a terrace beyond | the stair through the wall | a gate through the wall's foot, the flight beyond it | ✓ |
| **fold**: folding back against a wall | two flights, a shared landing, a door in the wall | one straight flight; the fold drawn is lost | · |
| **thick**: up a wall two cells thick | the stair contained in its thickness | a house (two deep is a building); the way goes round it | · |
| **thin**: beside a thin wall | the thin wall a screen beside an exposed stair | hung from it, the wall unchanged | · |
| **top**: up to a long wall's top | the wall a promenade, walked, railed | a flight up to it; the top not railed | · |
| **spine**: along a wall that steps up | a stepped spine, its top a stair | read as a tower and roofs; routed round | · |
| **cut**: from the ground along a wall's length to its top | steps cut into the wall, out on its top | steps cut into the wall, out on its top | ✓ |
| **water**: beside a wall, pools at its foot | dry stair and cascade sharing the wall | the pools ignored | · |
| **beside + tree** | the stair yields round the tree | passes it, hung from the wall | ✓ |
| **across + way** (a way along the far side) | through the wall, landing on the way | through the wall's foot | ✓ |
| **top + house** | the wall-top promenade arrives at a door in the house | a flight up; no door at that level | · |
| **beside + stair** (a second, the other way) | the two interlock, one landing shared | a second long flight, apart | · |

**5 of 13 at their best** (2 of 12 before this round).

## What the misses need: capabilities, not pieces

| Capability (Astra's terms) | Cases it would turn | Status |
|---|---|---|
| **Penetrate / thickness**: a way may pass through the hand's stone, climbing; the stone over it kept as an arch, or opened to the sky where it can't span | across, across + way, cut | **built**: a step carved into the hand's stone with its headroom (`World.carved`), dearer than any open step so only strokes drawn over or through stone use it; a level way through stone a cell to three thick opens a gate, now preferred over climbing over |
| **Edge becomes surface** (exchange roles): a top arrived on is walked as it is, railed as a promenade; met by a house face at that level, a door | top, top + house, spine | begun: walking on the hand's existing tops now costs almost nothing (it lays nothing), so ways use them; rails and doors to come |
| **Fold / interlock**: a drawn fold kept; two flights sharing a landing; a door at the landing | fold, beside + stair | next |
| **Inside implied**: two-deep stone a building, entered and climbed inside when a stroke ends on its top | thick | next |
| **Dissolve**: a thin wall beside an exposed stair becomes a screen | thin | small |
| **Water with levels**: a cascade beside a dry stair, sharing the retaining wall | water | larger |

The order follows the count of cases each turns, and how many other pairings it would reach: **yield** (notch, bow, step back) and **edge becomes surface** recur across stair × terrace, roof × tree, building × well and parapet × arrival, so they compound.

## Next pairings

wall × stair is the first. Then, by how much they'd exercise the capabilities above: **roof × stair** (a roof becoming a terrace; a stair over the eaves), **court × way** (divide, wrap, a threshold), **arcade × wall** (dissolve, reconcile rhythms), **tower × bridge** (interlock, penetrate), **water × terrace** (water with levels), and each with a third thing: a tree, a crossing way, another stair, a roof.
