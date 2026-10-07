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

The finds are not pictures over the wood: they stand in it, on the ground, among the trees and
behind the grass, in the same fog, drawn by their own experiments.

- **Crystals** — the Crystals ray tracer, made a reusable engine (`client/crystals/engine.ts`, the
  Crystals page now a thin page over it), with a cut-out mode: the specimen alone on transparency.
  One engine, offscreen, draws each crystal near you from where you stand (so walking round one,
  it turns), the nearest and longest-waiting first.
- **Fungi** — mushrooms native to the wood (`client/field/mushrooms.ts`): the Hat-throwers' capped
  forms from its own genome (inkcaps, pleated and inking at the rim; mottlegills; slimy yolk-yellow
  fieldcaps), each species' heights, bells, colours and counts, painted once as a small cluster
  on the litter at true size (10–17 cm) and stood in the wood among the grass. Opening one shows
  the Hat-throwers' own macro view of the same species, live, in its card.
- **Mistwood** takes them as sprites (`sprites`, `spriteTexture` in `client/mistwood/main.ts`):
  coloured pictures standing on the ground, drawn in their place among its cards with its fog,
  mist and light.

The journal keeps what you open, in this browser; open it from the top-left.

Markers come out of the fog with the trees and pulse when you are close enough. They are drawn
over the wood, so a tree between you and a find does not yet hide its marker.
