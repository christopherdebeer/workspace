# Field Journal

The lab's experiments in one walk. Nothing here is copied: each part is the experiment itself.

- **The wood is Mistwood.** Its module runs on this page's canvas: the same seeded wood, fog, paths,
  deer and sky, from the same address (`?seed=`, `?hour=` …). It publishes its camera each frame,
  so anything drawn over it can stand on the ground (the world's own projection: across the screen
  is the angle, up it the height over the distance).
- **The engraving is the Seals'.** The compass in the corner is a seal that turns as you do; each
  find is marked by a small seal of its family (crystals the diamonds' lattice, fungi the clubs');
  a find's card is the same card shell as Markovs Chains', its border kept clear of the specimen.
- **The finds are Crystals and Hat-throwers.** Crystals in the stone and fungi in the litter are
  scattered from the wood's seed over 46 m cells (`client/field/finds.ts`): the same finds in the
  same places for anyone in that wood. Each carries a seed, and its name is the specimen's
  (Crystals' species, the Hat-throwers' binomial). Come within 14 m and open one: its card holds
  the experiment itself, grown from that seed (`/crystals?seed=…`, `/fungi?one&seed=…`).

The journal keeps what you open, in this browser; open it from the top-left.

Markers come out of the fog with the trees and pulse when you are close enough. They are drawn
over the wood, so a tree between you and a find does not yet hide its marker.
