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
| **across**: up across a wall taller than the terrace beyond | the stair through the wall | climbs to a gate in the wall, the way on through it | ✓ |
| **fold**: a climb drawn folding back against a wall | two flights, a shared landing | a switchback: two flights, a landing at the turn | ✓ |
| **thick**: up a mass two cells thick (a house) | the stair inside it | in at a door at its foot, up its stair inside, out on its top (a terrace now) | ✓ |
| **thin**: beside a thin wall | a screen beside an exposed stair | the flight stands free (a thin wall carries no steps), the wall a jali beside it | ✓ |
| **top**: up to a long wall's top | the wall a promenade | walked along its top, railed both sides | ✓ |
| **spine**: along a wall that steps up | a stepped spine, its top a stair | walked up its top, a step at each rise | ✓ |
| **cut**: from the ground along a wall's length to its top | steps cut into the wall | steps cut into the wall, out on its top | ✓ |
| **water**: beside a wall, pools at its foot | a dry stair and a cascade | apart, as laid; **a reading away**, a cascade of basins beside the stair falling to the pool | ○ |
| **beside + tree** | the stair yields round the tree | passes it, hung from the wall | ✓ |
| **across + way** (a way along the far side) | through the wall, landing on the way | through the gate on to it | ✓ |
| **top + house** | the promenade arriving at a door in the house | walked, railed, an arched door in the house's face there (the wall itself read as an inhabited step of the house, windows in it) | ✓ |
| **beside + stair** (a second from the first's terrace, back the other way) | the two interlock, one landing shared | the terrace their landing, a switchback against the wall | ✓ |

**12 of 13 at their best as laid, the last a reading away** (2 of 12 at the start).

## The capabilities, built

| Capability (Astra's terms) | What it is in the model | Cases |
|---|---|---|
| **Penetrate / thickness** | a way's step can be carved into the hand's stone where the stroke's drawn over or through it, headroom cut, the stone over it kept as an arch or opened to the sky where it can't span (`World.carved`); a level way through stone a cell to three thick opens a gate, preferred to climbing over | across, across + way, cut |
| **Edge becomes surface** (exchange roles) | walking the hand's existing tops lays nothing, so costs almost nothing; a top a way arrives on is a **promenade** (`Buildings.promenade`): walked on along it at that height, railed both sides where it's a cell across and two up; a house face met at that height gets a door | top, top + house, spine |
| **Fold / interlock** | a climb drawn folding back on itself, that followed as drawn would climb in one flight, is read as a switchback; a terrace a flight arrives on is the next one's landing | fold, beside + stair |
| **Inside implied** | a stroke drawn over a house to its top: in at a door where the stroke meets it, up its stair inside, out on its top (`RULE.within`, kept at its foot) | thick |
| **Dissolve** | a thin wall carries no cantilevered steps; beside a flight it becomes a screen (the rules' dressing) | thin |
| **Water with levels** | an encounter, a flight beside water (`flight-beside-water`): apart, or a cascade of basins at each step falling to the pool, or that with a lantern at its head | water |

Still to come of the first list: **yield** (notch, bow, step back), the one most likely to compound across other pairings.

## Next pairings

wall × stair is the first. Then, by how much they'd exercise the capabilities above: **roof × stair** (a roof becoming a terrace; a stair over the eaves), **court × way** (divide, wrap, a threshold), **arcade × wall** (dissolve, reconcile rhythms), **tower × bridge** (interlock, penetrate), **water × terrace** (water with levels), and each with a third thing: a tree, a crossing way, another stair, a roof.
