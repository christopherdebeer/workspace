# Mistwood

*A walk through a seeded wood in fog.* Started 30 September 2026 from a
photograph: a green-grey woodland fog, a small bare tree leaning over dry grass,
tall trunks fading behind, a birch, a beech sapling keeping last year's leaves.

Nothing to do and nothing to finish. Touch the ground (below the horizon) to walk, at once; the finger is a tiller (held right of the middle you keep bearing right, the further out the sharper; the middle goes straight), so you never need to lift and drag again; the pace builds from a walk (2.4 m/s) to a brisk one (4) and, if you keep on, a run (7.6) (where the device reports real pressure, e.g. Apple Pencil, pressing harder goes faster). Touch the sky to look: across turns you, with a head's weight; up and down cranes your neck, harder the further it goes, and eases back level when you let go. Two fingers pinch to look closer (up to 4×), easing back out. Standing still is still.

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

- **The creek** (`creek` in world.ts and render.ts, the same in both). It
  runs where a smooth field crosses its middle value, like the paths but at a
  larger scale (150–240 m), so it winds. It is cut into the land: about a metre
  deep, banks sloping down over four metres, water a hand or two deep down the
  middle. Along its course it comes and goes (a broad noise field fades it to
  nothing), so it rises from a spring and runs dry into the leaves.
  - Its water runs: the stir is carried down it, the bed shows through the
    shallows, and white water streaks over the fords.
  - Its banks are wet. Mist lies in it, rushes grow at its edges, the bed is
    bare wet gravel, and no tree or scrub grows in the water.
  - **Fords.** Where a path crosses it (not where one runs beside it), the bed
    is built up to a few centimetres under the water, with a line of stepping
    stones across along the path. Fords are found once for each 24 m square
    (`fordsNear`). The nearest six go to the shader as uniforms, so the shader
    never looks for paths.
  - You cannot walk into its deep water; you slide along the bank. Over a ford
    you cross. Flying, nothing holds you.
  - Ponds come from the lie of the land (`landH`), not the creek's cut, so the
    creek never fills with still water.
  - Cost: the ground march looks for the creek only within 1.6 m of the land
    (the creek only ever lowers it).
  - `?find=creek` stands you on a bank looking across. `?find=ford` stands you
    on the path before a ford, looking to the stones.

Each species keeps to the places that suit it (`AFFINITY`). Tall trees keep to
dry shelter. Leaners lean towards the wet. Birch takes the open and disturbed
ground. The fog is a little thicker in the hollows. Slopes facing the light
are a little brighter.

## Undergrowth, and the grade

The open wood stands in a knee- to waist-high mass of dead growth. In the
reference photograph (`devtools/reference/misty-woodland-edge.jpg`) it fills
the bottom third, and its ragged top melts into the mist, so no ground plane or
horizon line ever shows.

- **Near: scrub cards** (`growScrub`), drawn to 38 m. Each card mixes:
  - moor-grass tussocks: dense clumps of arching blades, dark at the base and
    bleached tawny at the tips;
  - bramble: thick dark stems arching over, a dead leaf hanging on;
  - heather or bilberry: low domes of fine zigzag twigs;
  - seedlings: thin whips, some keeping their dry leaves.

  The scrub is thick in the glades and gaps, thinner under the canopy, and
  absent in the wet and on the paths.
- **Beyond: a scrub volume in the ground shader.** The ground march, which
  already steps along each ray, passes through a layer of scrub whose height
  follows the same openness, wetness and path fields (`scrubTop`). It lets less
  light through the deeper it goes: dark and warm in the mass, tawny at the
  tops, ragged at every scale. It takes over from the cards between 6 and 16 m,
  and where the old ground met the fog in a hard line it now goes soft.
- **The forest floor near you is built stone by stone and leaf by leaf**
  (`forestFloor` in render.ts): scattered layers composited top-down, each on
  its own turned grid, one thing to a cell (kept inside it, so it costs one
  lookup a layer). The grids are bent by a slow warp about a cell deep, so no
  row ever lines up.
  - Stones in four sizes (1–5 cm), with irregular outlines (three random
    harmonics), dome-lit, in warm greys and browns, darker and with a sheen in
    the wet; fine grit over dark soil beneath. Leaves are scattered over them.
  - Leaves: oak-lobed or beech-toothed, mottled, curled (and lit as they curl),
    with a midrib and side veins, darker at the edge, and shadowing what lies
    beneath. Colours run from fresh tan through rust to last year's near-black.
  - Twigs (lit as round wood), pebbles (lit as domes), and the mould of older
    leaves beneath.
  - All of it lies on the floor's own relief (`floorRelief`): hummocks
    (~0.6 m), clods (~20 cm) and grit (~7 cm), each fading out when too small
    for the pixel. Its procedural normal lights everything lying on it, and
    dark collects in its hollows.
  - It varies by place: full under the canopy, sparser in the open, trodden
    and stony on the paths, darker and mossy in the wet.
  - Each layer is antialiased by the pixel's true footprint and fades to its
    own average once its things are too small to see, so nothing shimmers and
    it meets the painted ground beyond (16–26 m) without a seam.
- **Mist is a volume** (`mistDensity`, the same in JS and GLSL): drifting banks,
  and mist lying a few metres deep in the hollows.
  - What you see through it is what lies along the way: the ground march and
    the sky sum it along each ray, and each tree, card and deer gets the sum to
    its foot and to its top (`mistAlong`, on the CPU).
  - So as you walk, banks pass in front of things, and you walk into and
    through them.
- **Cards keep their light at every resolution.** They are baked with
  premultiplied "over", so tone is a coverage-weighted mean and does not change
  when a card is baked again sharper as you come near.
- **Fog** (`fogAt`, shared by every shader) is clear for the first few metres
  and then closes fast, with a squared distance term. Near things stay sharp
  and dark, the middle distance is soft, and the far is gone.
- **The grade** is measured against the photograph, region by region, with
  `devtools/palette.mjs`:
  - grey-green fog, not teal;
  - the low fog a little warmer;
  - tawny straw over dark, warm dead growth;
  - a firmer film curve for deeper darks.

## Stone (`structuresNear` in world.ts, `traceStructures` in render.ts)

Monolithic structures stand in the wood, seeded like everything else:

- **Ruined round towers.** About one in three 220 m squares has one, on open,
  dry ground off the paths. Each has a battered wall with its top broken away
  unevenly, a round-headed doorway (you can walk in) and slit windows; ivy
  climbs it.
- **Viaducts.** About one in three 340 m squares has one, set across a path so
  the path runs under the middle of a span. Tall battered piers carry arches
  20–30 m up. In the fog you see the piers rise and the arches, if at all, as
  shapes overhead.

- **Dry-stone walls.** About half of the 150 m squares have one: an old field
  boundary 80–170 m long, wandering in 10 m stretches that follow the ground.
  - A wall crosses paths and never follows one. Where a path crosses, there is
    a gap and the wall's ends step down into it.
  - Here and there a stretch has fallen low enough to step over.
  - Walls stop at water.
  - Small dry-laid stones with deep dark gaps between them, coping stones
    standing up unevenly on top, lichen crusts and mossy tops.

How they are made and drawn:

- **Shapes.** Each is a signed-distance shape in its own frame, traced in the
  world pass only where a ray meets its box. JS passes the nearest six
  structures and the nearest 24 wall stretches as uniforms. The march looks
  only at the stretches whose boxes the ray meets.
- **Stone by stone.** Broken tops and wall tops end at whole courses, column by
  column, and each stone stands a little proud of the face or sunk into it.
  Silhouettes are blocky, as the stones are.
- **Shading:** rubble masonry drawn on (rough courses, each stone its own size,
  tone and roughness, proud of the wall, with thin dark mortar). Rain streaks,
  lichen, moss on what faces up, low down and away from the light. Occlusion
  from the shape itself, then fogged and misted like everything else.
- **Depth.** Everything drawn now shares one depth (horizontal distance over
  100 m). The world pass writes the stone's, and the cards, deer and live trees
  test against it (live trees also write their solid wood). A tree behind a
  pier is hidden; one in front crosses it.
- **In the world:** you cannot walk through stone (you slide along it) except
  at a wall's gaps and fallen stretches, and nothing grows in it.
  `?find=tower`, `?find=viaduct` or `?find=wall` takes you to the nearest
  (beside a wall, square to it).

## The small voices (`client/audio.ts` `creatures`)

All synthesised:
- **Frogs** croak in bouts from the nearest wet hollow or pond within about
  45 m, from its direction and muffled by distance, mostly at dusk and through
  the night.
- **Crickets** chirp in trills of three or four, from all about, in the open at
  night.
- **The creek** runs: a hiss of moving water from its nearest water within
  40 m, panned toward it. It grows louder and brighter over a ford and muffled
  with distance. Over it is the babble: small bubbles, each a quick rising
  note, quicker over the stones.
- **Cicadas** buzz, swelling and fading, only in the heat of a warm day
  (`?warm` above 0) in the open. A cool misty wood has none.

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
- **Drawn** as geometry (`client/deermesh.ts`): a mesh lofted from cross-sections (rump,
  haunch, the deep ribcage, chest; the neck; the head, a wedge from skull to muzzle, with its
  eyes and ears; the tail; the legs, three bones each down to the hoof) skinned to a skeleton of
  nineteen bones, the spine bending mid-back. Its proportions are a deer's, checked by laying its
  side view over photographs (a fallow doe standing, a white-tailed fawn walking) and over the
  drive's deer (a different look, the same animal): the trunk a third again as long as the deer is
  tall at the withers and half as deep, the belly level under a deep ribcage and tucked up to the
  stifle; the neck deep at its base in the chest front, rising steeply to the head; the ears big
  leaves set out in a V, cupped and open to the front. Over each hind leg the haunch, the thigh's
  mass from the croup down to the stifle, deep behind the bone (the ham) and wider than the waist
  (hips about half a metre across, the legs set out under them), its top moving with the
  hindquarters and its foot with the thigh, so it swings and stretches with the stride; a lesser
  mass over each shoulder; the forearm full at the top, the gaskin deep and flat. Its coat is warm
  brown, white beneath (belly, throat and chin, the insides of the legs, under the tail between the
  hams, behind the black nose), the lower legs greyer; some herds are dappled as fallow are (each
  herd one or the other, from its key): pale spots over the back, the upper flanks and the
  haunches, fixed to the body as it moves, and a pale line along the lower flank — drawn in the
  shader from the deer's rest shape, and where they are too small to see, the coat a little paler
  for them instead. Its pose comes from what the herd's simulation says it is doing, each frame:
  - its gait follows its speed over the ground, the cycle advancing as far as it has gone, so a
    hoof set down stays put while the body passes over it: a four-beat walk, a trot in diagonal
    pairs, and the bound it dashes in (hind legs together, then the fore, a moment in the air, the
    spine flexing, the body pitching, the tail up), blended as it speeds up;
  - each leg solved for its hoof: the cannon upright on the ground or folded back in the swing,
    the two bones above bent to reach it (the front elbow back, the hind stifle forward);
  - grazing, the neck down and the head turned back up from it, the muzzle in the grass,
    nibbling; lying up, the legs folded under; alert, the head turned to look at you; the ears
    flick, the tail twitches.

  Its coat is lit as the wood is (a wrapped key light, the fog's light from where it faces, the
  fog catching in the hair at its edge), fogged and misted, and it writes its depth.

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

Synthesised: wind in the trees, a far bird call now and then, and your steps.

- **Steps** come from the stride, which also drives the bob and the sway, so
  you hear a foot land as the eye drops onto it.
  - The step lengthens far more than it quickens: about two a second at a
    walk, a little under three at a run, where each is a long bound.
  - At a run, each landing has a soft thud under the swish of grass and
    leaves. Each foot sounds a little to its own side, and the body sways over
    it.

## Devtools (`devtools/`, not synced to the cell)

`harness.mjs` builds the client, serves it the way the cell does, and drives
headless Chromium through the flags. The other tools are built on it:

- `shots.mjs`: screenshots of any queries, each taken once settled.
- `fly.test.mjs`: flying with twin sticks (moves, tilt stays, climbs).
- `creek.test.mjs`: held at the creek's edge, across at a ford, over it flying.
- `input.test.mjs`: real touches (Chrome's touch emulation). Ground walks, sky
  looks and tilts, the tilt eases back, and a pinch zooms then eases out.
- `journey.test.mjs`: the address keeps the journey, a reload resumes it, and
  moving or changing seed works in the same page.
- `determinism.test.mjs`: one address gives one wood, across fresh pages.
- `compare.mjs`: renders beside a reference photograph, at its shape.
- `palette.mjs`: region-by-region colour and luma against a reference.
- `deer-sim.mjs`: a deer encounter, without drawing.
- `species.mjs`: a seed's species and what stands near its start.
- `check-flags.mjs`: guards the flags.

Output goes to `devtools/out/`, which git ignores.

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
- **The panel is glass:** the wood shows through it, lightly blurred, so you
  can see what a change does while tuning on a phone. While you hold a
  slider, everything but that row vanishes, so the whole view is clear.
- **Guards.** `node cells/lab/devtools/check-flags.mjs` (run before every deploy)
  fails on a declared flag that nothing reads, and on any other file reading
  the address directly. At run time, parameters that are not flags are
  reported in the console and at the top of the overlay.
- **The panel's bar:**
  - **help** shows what each flag does.
  - **reset** puts every flag back to its default, keeping the seed, where you
    stand, and the panel.
  - **copy** copies the link: this wood, where you stand, and every flag.
- **Fly** (`?fly`, dev only, in the panel) uses twin sticks:
  - The left half of the screen moves you: push from where you touched (up is
    on, down is back, aside is aside), up to 14 m/s, the way you look. Tilt up
    and push on to climb.
  - The right half looks, and the tilt stays where you leave it.
  - Pinch still looks closer. Keys: WASD, with Q/E to sink and rise.
  - You go through anything but never below the ground. Turning it off lands
    you. `devtools/fly.test.mjs` checks it with real touches.
- **Also:** `window.__wood()` (the Wood itself, to query places).

Current flags:
- **wood:** `seed`, `only`
- **stand:** `x`, `y`, `heading` (kept up to date), `at`, `look`, `near`, `find` (pond, creek, ford, log, veteran, glade, tower, viaduct, wall), `off`, `walk`, `tilt`
- **sky:** `hour`, `moon`, `fog`, `warm`
- **deer:** `deer`, `deerAt`, `deerBed`, `deerCalm`, `deerCoat`
- **render:** `fixed`, `time`
- **dev:** `tune`, `fly`
