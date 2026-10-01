# Mistwood

*A walk through a seeded wood in fog.* Started 30 September 2026 from a
photograph: a green-grey woodland fog, a small bare tree leaning over dry grass,
tall trunks fading behind, a birch, a beech sapling keeping last year's leaves.

Nothing to do and nothing to finish. Hold still to walk — the pace builds as you keep on (and where the device reports real pressure, e.g. Apple Pencil, pressing harder walks faster; an iPhone touch reports none). Drag across to look about and, once walking, to steer; drag up or down to tilt the view, which eases back level when you let go. Standing still is still: no sway, no drift.

## The approach: silhouettes, in extreme detail, on the GPU

In mist only the outline reads, so everything goes into the outline, and the
realism is carried by the fog and the light rather than by geometry.

- **Trees are grown, not drawn** (`client/tree.ts`). Each is a set of line
  segments in its own plane, from a trunk a hand across down to twigs of three
  millimetres: kinked twigs, sympodial zig-zags, forks, wood that leans to the
  light, birch twigs that hang, short twiglets all along the thin wood (most of
  what the mist shows). Up to 60,000 segments a tree. Species: the leaning
  tree, tall trunks, birch, beech saplings with dry leaves, scrub; and patches
  of ground cover (dry grass with seed heads, bramble with thorns, bracken).
- **Each is baked on the GPU into a card** (`client/bake.ts`): every segment an
  anti-aliased capsule. Twigs thinner than a pixel are drawn as faint lines of
  the right weight, and overlapping ones add up — so a crown of ten thousand
  twigs is the grey haze it is in fog, and sharpens into twigs as you come
  close. A card is baked at the resolution it needs on screen now (less when
  the fog hides it), and baked again, sharper, as you walk up to it.
- **Near trees are real geometry** (the hybrid). Trees are grown in 3D. Within
  about 16 m every segment is drawn live each frame as a screen-space
  anti-aliased line: right from every side, with depth in the crown, bark
  shaded by where it faces, and wind as a smooth field over the tree (so the
  trunk and its kinks never bend and no joint cracks). Segments are stored
  thickest first, so a tree further off draws only as many as are still a
  tenth of a pixel wide; a per-frame budget gives the nearest trees first call.
- **Far trees are cards**, baked as seen from where you are (one of twelve
  sides), turning about their trunk to face you, and cross-fading with the live
  tree over the last few metres of the handover.
- **A cylindrical projection**: across the screen is angle, so looking round
  only slides the picture; nothing stretches at the edges.
- **You walk the way you face**, anywhere: the wood is a grid of cells placed
  from the seed, going on in every direction; a trodden path winds through it
  and the trees keep off it.
- **The shaders do the rest** (`client/render.ts`): fog by distance, much
  thicker near the ground (but clear at your feet); banks of mist drifting
  through the wood that veil one tree and not the next; wind that moves the
  thin, high wood and not the trunk; birch bark marks; a fog sky that brightens
  where the sun is behind it; dry ground and a trodden path; then a film pass
  (a soft curve, the fog's lift in the blacks, vignette, grain).

## Paths, light, species, deer

- **Paths** wind and fork through the wood: they are where two smooth noise
  fields cross their middle value — each field's zero line winds by itself, and
  where the two families meet, paths join and fork. The ground shader and
  `world.ts` compute exactly the same noise, so trees stand back from what is
  drawn and the grass thins on it. Drawn as bare, trodden earth, damp in the
  middle with a little of the fog's light on it, grass coming back here and
  there. You start on one, facing along it.
- **Sun and moon** (`client/sky.ts`): the fog's colour low and high, the light
  on the wood, the brighter place in the sky and the direction that shades the
  round wood all follow the key light — the sun by day (warmer when low), the
  moon by night (by its phase). Your clock by default; the eye adapts a little
  at night (it stays night). Everything fogged takes its fog from the direction
  it is seen in, so a far tree fades into exactly the fog behind it.
  `?hour=0–24` · `?moon=0–1` · `?fog=` (× the wood's) · `?warm=-1–1`.
- **Species** are points in the space of growth parameters (`tree.ts`
  `sampleGenome`): each wood draws its own set around the archetypes — taller
  or squatter, steeper or flatter branching, straighter or more kinked, weeping
  or reaching, sparse or dense in twig, some holding dead leaves, a few
  pale-barked, now and then a coppiced one of several stems — each with its
  own bark colour, and a couple of wild cards further out.
- **Roots are the tree inverted**: the same growth — spiralling round the trunk,
  kinking, tapering — pulled down instead of up. Only what is above the ground
  is drawn: the ridge where each root leaves the trunk and dives into the soil
  (shallow-rooted species run further). The trunk's own first 90 cm flare out
  towards the ground in short steps.
- **Bark up close** (near trees, only where the wood is wide on screen): placed
  by where it is round the trunk and up it, so it stays on the wood as you walk
  round. Each species has its own: fissured plates of a few centimetres (deep
  in some, none in others) with relief that catches the light, a fine grain;
  lichen as speckled grey-green crusts (a yellow one now and then) at mid
  height; moss as velvet green low down and on the shaded side. Birch: fine
  lenticels in loose rows, dark patches long across the trunk, papery cream,
  a dark fissured foot with a ragged edge. Wide wood is drawn as a continuous
  cylinder so the pattern runs across segment joints without a seam.
- **Deer** (`client/deer.ts`): they live here. See *Deer* below.

## Places (`client/world.ts` `place`)

The wood is not the same everywhere. The ground rises and falls: gentle relief,
computed identically in JS (`groundH`) and in the shaders, so trees, deer and
your eye stand on it. The world shader marches each ray to the ground, never
stepping further than the slope allows. What the relief makes of each place:

- **Wet hollows.** The low ground is dark and mossy, and holds the fog's light.
  Mist lies in it, a few metres deep. Rushes grow there, standing out into the
  shallows. In some woods the deepest hollows hold still water, which reflects
  the fog and turns to mud at the edges. You walk to the water's edge, not
  into it.
- **Glades.** Open ground, grass thick, few tall trees. Birch and saplings come
  in from the edges.
- **Shelter.** Under the canopy, the grass thins to last year's leaf litter.
- **Windthrow.** Fallen trees (`growLog`) lie mossy on the ground: either the
  root plate torn up on edge, or the jagged break, with snapped branch stubs.
  Birch, saplings and scrub fill the gap.
- **Veterans.** Here and there an old tree, nearly twice the size of the rest,
  with a clearing about it. There is at most one to each 70 m square.

Each species keeps to the places that suit it (`AFFINITY`). Tall trees keep to
dry shelter. Leaners lean towards the wet. Birch takes the open and disturbed
ground. The fog is a little thicker in the hollows. Slopes facing the light
are a little brighter.

## Deer (`client/deer.ts`)

Each wood has its herds of two to five deer. About half of the 120 m squares
hold one, with a home range around a lying-up place in cover, off the paths.
Herds come into being as you come near their range and are let go when you
are far, so they are there again when you come back.

- **Their hours.** They are out grazing at dawn and dusk and lying up in the
  middle of the day, with some about at night. They graze on the grass near
  home (glades, the wet edges), wander a few steps at a time, and heads come
  up now and then.
- **What they make of you.** Alarm builds from what they hear and see:
  - Your steps are loud in dry leaves and soft on the path.
  - They see you only within the fog's reach, mostly when you move.
  - Too near (about 10 m) alarms them whatever you do.
  - Lying up, they hold tight.
  - Keep still and the alarm falls away.
- **How it goes.** As alarm rises:
  1. Heads come up and they stand side-on.
  2. One turns to look at you, stamps, and barks.
  3. They go: away from you and into cover, snapping twigs as they run.
  4. Once there, they stop and look back.
  5. When the alarm has passed, they drift home and graze or lie up again.
- **Heard before seen.** Their steps rustle in the leaves off in the fog, along
  with the stamp, the bark (a hoarse "bōh") and twig snaps. Each sound is
  panned to where it came from, and the further off, the more muffled.
- **Drawn** by the shader from shapes: body, neck, head in profile or turned,
  ears, and jointed legs that walk, bound, or fold under when lying up.

## The journey in the address

The wood is fully seeded. Every tree, tuft, log, pond and herd's home comes
from the seed and the place alone (`Math.random` only picks a fresh seed and
voices the sounds). Where you are is kept in the address as you walk, about
once a second when it changes:

- `x` is metres east of the wood's origin;
- `y` is metres north;
- `heading` is degrees, 0 north and 90 east.

So a reload, or a shared link, goes on from exactly there.

The other way round works too, without reloading. Setting `x`, `y` or
`heading` (from the overlay, or from a test in the same page through
`window.__flags.setFlags({ x, y, heading })`) moves you there at once. Setting
`seed` makes another wood. So a walk can be stepped through and photographed
in one page session:

1. Set the place.
2. Wait for `__mistwood.settled`, which means everything in view is grown and
   baked as sharp as it is wanted.
3. Take the screenshot.

Add `hour`, `time` and `fixed` for the same light, wind and resolution each
time.

What is not replayed: the deer's moment-to-moment wandering. Their herds and
homes are seeded, but where they have got to depends on how you came.

## One seed, one wood

The seed is in the address (`?seed=moss-ford-7`) and at the foot of the
screen; touch it for another wood. Nothing is stored: any stretch of the wood
is placed the same again from (seed, chunk). Trees come from a pool per seed
(about forty, each unique), placed again at different sizes and mirrored.

## Budgets

Cards are kept within about 64 MB (least recently used go first; if everything
in view is in use, every card asks for fewer pixels until it fits). Resolution
drops by itself if frames are slow, and climbs back after a few seconds of
quick ones; time spent on another tab is not counted as a slow frame
(`?fixed` keeps it). A card that isn't baked yet from this side borrows the
nearest side that is, so no tree is ever missing.

Near trees go live within 16 m, nearest first, and those already live keep
their place ahead of newcomers. Short of budget, a tree draws fewer of its
segments (thickest first) rather than dropping to a card. In the handover the
live tree fades in over its card, then the card fades out beneath it, so
coverage never dips. Live trees lay down depth for their solid wood first, so
twigs behind a trunk are hidden. The fog's thickness belongs to the place
(hollows where it lies thick), not to how far you have walked. A new seed
frees every GPU buffer of the old wood.

## Sound (`client/audio.ts`)

Synthesised: wind in the trees, steps in the grass while walking, a far bird
call now and then.

## Flags and the tuning overlay

Every flag in the address is declared once, in `client/flags.ts`, with:

- its kind (number with range and step, choice, switch, text);
- what it does, and its group;
- whether a change applies at once (`live`) or needs a reload.

Code reads flags only through `flag('name')`. An undeclared name does not
compile, and an out-of-range or unknown value is refused with a warning.

- **`?tune`** opens the development overlay. It is built entirely from the
  declarations, so a new flag appears there as soon as it is declared. Live
  flags change as you drag; the rest reload with the new value. Below the
  controls, `window.__mistwood` shows what the wood reports of itself: cards,
  MB, quality, the place you stand in, and each herd's mode, alarm and
  distance.
- **Guards.** `node cells/mistwood/check-flags.mjs` (run before every deploy)
  fails on a declared flag that nothing reads, and on any other file reading
  the address directly. At run time, parameters that are not flags are
  reported in the console and at the top of the overlay.
- **Also:** `window.__wood()` (the Wood itself, to query places).

Current flags:
- **wood:** `seed`, `only`
- **stand:** `x`, `y`, `heading` (kept up to date), `at`, `look`, `near`, `find`, `off`, `walk`
- **sky:** `hour`, `moon`, `fog`, `warm`
- **deer:** `deer`, `deerAt`, `deerBed`, `deerCalm`
- **render:** `fixed`, `time`
- **dev:** `tune`
