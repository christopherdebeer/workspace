# Mistwood

*A walk through a seeded wood in fog.* Started 30 September 2026 from a
photograph: a green-grey woodland fog, a small bare tree leaning over dry grass,
tall trunks fading behind, a birch, a beech sapling keeping last year's leaves.

Nothing to do and nothing to finish. Hold to walk; drag to look about.

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

## One seed, one wood

The seed is in the address (`?seed=moss-ford-7`) and at the foot of the
screen; touch it for another wood. Nothing is stored: any stretch of the wood
is placed the same again from (seed, chunk). Trees come from a pool per seed
(about forty, each unique), placed again at different sizes and mirrored.

## Budgets

Cards are kept within about 64 MB (least recently used go first; if everything
in view is in use, every card asks for fewer pixels until it fits). Resolution
drops by itself if frames are slow (`?fixed` keeps it).

## Sound (`client/audio.ts`)

Synthesised: wind in the trees, steps in the grass while walking, a far bird
call now and then.

## Debug

`?seed=` · `?at=<metres>` · `?walk=1` · `?look=<radians>` · `?fixed` ·
`window.__mistwood` (cards drawn and baked, MB, the resolution bias).
