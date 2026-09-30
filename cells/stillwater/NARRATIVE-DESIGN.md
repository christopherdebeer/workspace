# Stillwater — beyond counting

*What else this river can hold, and in what order to build it. Companion to
`LEARNING-DESIGN.md`, which covers the numeracy. Status line at the end.*

## 0. The premise

The environment is the asset. It has reaches with their own character, forks
the boat commits to, a whole day and night, a lantern fed by dew, six flower
forms that bloom and shed, fish with moods, dragonflies and butterflies, piers,
a basket and a coil of rope in the boat, a river that remembers each child,
and names drawn on leaves. Counting uses a fraction of it. Everything proposed
here reuses what is already there and adds as few new objects as possible.

Three rules, in order of importance:

1. **Nothing is a mode.** A six-year-old does not want a menu. The counting
   asks come and go; everything else is simply *there*, always, and the child
   finds it by looking. The start screen stays as it is: a name, and the river.
2. **Nothing is hoarded, scored or timed.** The river is calm because nothing
   in it is a resource to be optimised. Seeing a thing, sharing a thing and
   growing a thing are their own reward; the notebook is a record, not a
   collection.
3. **Nothing fails.** There is no wrong tap, no missed creature that will not
   come back, no plant that dies. Absence is an invitation to return.

## 1. The notebook — collecting by noticing *(built: Round 56)*

**What it is.** A naturalist's notebook the child keeps without being asked.
Tap a creature or a flower and it is *seen*: it reacts (a dragonfly darts, a
butterfly lifts, a fish flicks away, a firefly blinks), its name is said in the
hint slot, and the first time, a page is added to the notebook. The notebook
opens from a small tab at the bottom left and is drawn *by the river itself*:
the creatures on its pages are the live sprites at rest on paper, not
illustrations, so what the child saw is what they see again.

**Why it works here.** The species are already gated by reach and by the time
of day, so noticing is patient rather than exhaustive: the blue emperor in the
open reach at noon, the koi under the pier, the brimstone in the flowering
reach, fireflies only after dusk, the spent flower only where lilies are old.
Nothing is caught. It also carries literacy quietly: every page has a name.

**Species, as they exist today.**

| group | entries | where / when |
| --- | --- | --- |
| dragonflies | emperor (blue), common darter (red), banded demoiselle (green) | open water by day, into dusk |
| butterflies | small tortoiseshell, cabbage white, common blue, brimstone | by day; near flowers and the boat |
| fish | chub (dark), carp (pale), koi, minnow | deep runs, piers, shallows |
| flowers | white water lily, pink lily, yellow lily, double rose lily, spatterdock, a spent flower | flowering reaches, old leaf families |
| lights | firefly | after dusk |

**Mechanics added.** A tap that is not the boat, not a dewy leaf, and not the
water first asks the scene what is under the fingertip, with slack; critters,
fish and open flowers can be *sighted*. Sightings are per child
(`stillwater.p.<id>.notebook.v1`: first seen, how many times). The notebook
page is a renderer pass (paper, then the sprites at rest, unseen entries as
faint silhouettes) with DOM labels. No new objects.

**What comes next for it.** The hint that says *where* an unseen thing lives
("at dusk", "by the pier"), so the notebook teaches looking. A count on a page
after the tenth sighting ("you have seen the koi ten times"), which is the only
number in the notebook and is there for the child who wants one.

## 2. Sharing — the basket *(next)*

Tap the basket in the boat and crumbs scatter on the water astern. The fish
already have curiosity and a feeding mood; they gather, and the child watches.
It is small, and it is the natural home for **fair sharing**, the first shape of
division: three fish and six crumbs, and the ask is *make it fair*. The
learning design gains a rule (`share`) beside `sum` and `groups`, driven by
the same memory and stretch machinery.

Needs: a tappable basket (the boat's frame, `boatWorld`), crumb floaters (the
petal floater path), a feeding mood in `fish.ts` that eats a crumb, and the
`share` rule. No new species.

## 3. Growing — seeds and a river that remembers

The spent flower already has a seed head. Let it shed a seed the child can
drag onto the water. Because the river is deterministic from its seed, a
planting is only *which reach, how far along, how far across*, stored per
child; on the next visit a young pad has grown there, and over real days it
matures and flowers. Dew gathered by counting can water it. This gives the
counting a purpose beyond the lantern without a score, and gives the child a
reason to row back to one particular reach, which the forks make a choice.

Needs: a seed object and a drag-to-plant gesture, a `plantings` list per child
that `grow` honours, growth by calendar time, and a "welcome back" line that
mentions it.

## 4. The lantern keeper — a story laid over the rest

Once there are things to notice, share and grow, the reaches can become
chapters. The story is a picture book told one line at a time in the hint
slot, never a quest log: the light must be carried through the dark reaches,
and at each pier someone is waiting — a heron who has seen every fish, a frog
who wants a lily, an old turtle who remembers the river before the piers.
Counting stays the currency (the lantern), the notebook is what the heron asks
about, the plantings are what the frog wants. No failure state; a chapter that
is not finished tonight waits.

Needs: three large characters (new sprites, the biggest cost), a line-of-
dialogue presentation, chapter state per child, and arrival at a pier (the
collision already gives contact; a moment's stillness there is the trigger).

## 5. Growth axes, not modes

Weather and seasons (rain on the sim, thicker mist, autumn through the reach
gamut) belong to the calendar: the river in November is not the one from June.
Passengers (a frog hopping into the boat, a leaf towed on the painter) belong
inside the story as episodes. Neither is a mode.

## 6. Not doing

Fishing (the fish are characters). Scores, timers, streaks. A menu of modes.
Rewards that accumulate. Anything that makes the river a place to *finish*.

---

*Status: §1 built in Round 56 (`client/notebook.ts`, the notebook pass in
`render.ts`, the tab and page in `static/index.html`). §2–§4 proposed.*


## Resident pass — 29 September 2026

Residents now respond to an explicit tap (keyboard R), with one short line.
Approaching only changes their attention; visits pause the learning prompt.
Each deterministic landing has its own saved resident and pier lantern.
A successful dew collection leaves a little carried light; touch an unlit
lantern nearby (keyboard L) to transfer it in a visible arc. Lit lanterns
persist per child, illuminate the pier and cast a broken water reflection.
They do not drain on a timer. Turtle completion requires its own lit lantern.

The procedural silhouettes now include heron feet and folded feathers, frog
haunches/skin/blinking, and turtle shell growth marks. A content frog can hop
to an actual nearby grown planting. Legacy species chapters are claimed by
one landing only, preserving progress without completing every resident.

This supersedes the automatic arrival trigger proposed in §4. It remains a
lightweight layer within the river, rather than a separate story mode.
