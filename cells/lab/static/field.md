# Field Journal

The lab's experiments in one walk. Nothing here is copied: each part is the experiment itself.

- **The wood is Mistwood.** Its module runs on this page's canvas: the same seeded wood, fog, paths,
  deer and sky, from the same address (`?seed=`, `?hour=` …). It publishes its camera each frame,
  so anything drawn over it can stand on the ground (the world's own projection: across the screen
  is the angle, up it the height over the distance).
- **The engraving is the Seals', drawn in light.** The compass is a seal that turns as you do; each
  find is marked by a small seal of its family (crystals the diamonds' lattice, fungi the clubs'),
  all of them glowing hairlines with nothing solid, fading into the fog with distance as the trees
  do, and giving way to the find itself in the last few metres. A seal has a fixed size in the wood (1.6 m), so it grows as you come close, and its detail
  follows its size: far off a ring and its glyph; nearer, the construction (rings, band, star
  lattice); nearer still an even fill of ornament; close to, fine and intricate, with lace. Each
  level cross-fades into the next over a band of sizes, the lines stay one pixel at every size,
  and a finer level is drawn just before it is wanted. A find's card is the same card shell as Markovs Chains'.
- **The finds are Crystals and Hat-throwers.** Crystals in the stone and fungi in the litter are
  scattered from the wood's seed over 46 m cells (`client/field/finds.ts`): the same finds in the
  same places for anyone in that wood. Each carries a seed, and its name is the specimen's
  (Crystals' species, the Hat-throwers' binomial). Come within 14 m and open one: its card holds
  the experiment itself, grown from that seed (`/crystals?seed=…`, `/fungi?one&seed=…`).

## The specimens in the wood

Close to, the finds are the real things, drawn into the wood itself by their own renderers — in
their place among the trees and grass, in the wood's light, fog and mist:

- **Crystals** — the Crystals ray tracer (`client/crystals/engine.ts`, the Crystals page a thin
  page over it), in its cut-out mode on a small WebGL context of its own, its camera put where
  your eye is relative to the specimen, every frame, its field of view fitted to it: so walking
  round a crystal it turns, from above you look down into it, and it refracts and disperses as the
  studio specimen does. Its picture is set into Mistwood's scene at the specimen's place and
  depth (`client/field/woodcrystal.ts`).
- **Fungi** — clusters of the Hat-throwers' capped species (its own genome: heights, bells,
  colours, pleats, ink, slime) built as meshes, tapering stalks and caps turned from each form's
  profile (an inkcap's pleated, inking bell; a mottlegill's cone; a fieldcap's flared slimy dome
  over its gills), at true size, drawn in Mistwood's projection and shaded in its light and fog,
  writing their depth (`client/field/woodfungi.ts`).
- **Mistwood** takes them through a hook (`customs` in `client/mistwood/main.ts`, `CustomDraw` in
  `render.ts`): anything another experiment draws is called in its place among the wood's cards,
  back to front, into the scene with its depth buffer.

The journal keeps what you open, in this browser; open it from the top-left.

Markers come out of the fog with the trees and pulse when you are close enough. They are drawn
over the wood, so a tree between you and a find does not yet hide its marker.
