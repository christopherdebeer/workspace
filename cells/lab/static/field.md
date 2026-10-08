# Field Journal

The lab's experiments in one walk. Nothing here is copied: each part is the experiment itself.

- **The wood is Mistwood.** Its module runs on this page's canvas: the same seeded wood, fog, paths,
  deer and sky, from the same address (`?seed=`, `?hour=` …).
- **Now and then, something has broken through.** An anomaly: a crystal erupted out of the ground
  tens of metres high, or fungi grown gigantic. They are few and far between (one in most 190 m
  cells, set beside a path so walking you come on them; one always up the path ahead of where you
  arrive) and the same in the same places for anyone in that wood (`client/field/finds.ts`).
- **The same wood, changed about it.** The light and the fog are the wood's own: nothing glows, and
  an anomaly comes out of the mist as a tree does, a shape first (the compass marks each within a
  quarter-kilometre). Closer, the ground and the trees are changed, out to its reach (30–46 m):
  about a crystal the litter is crusted pale, the ground split by fissures, the grass bleached,
  the trees gone glassy grey as if petrified; about a fungus the earth is dark and white with threads, the trees dark and crusted at
  the foot, and a ring of lush grass runs where its outer ring of lesser fruiting bodies stands. Its
  heart is cleared: nothing grows where the crystals break out or the giants stand.
- **The crystals are the Crystals experiment's own specimens**, grown to tens of metres: the
  species, habit and every crystal of the cluster from the find's seed (`crystals/mineral.ts`),
  each crystal the convex hull of its planes built as faceted geometry (`client/field/
  giantcrystal.ts`), the matrix a low dome of rock half-buried, and shards of the same species
  breaking through the litter about it, leaning out, smaller further off. Its glass is the Crystals
  experiment's own optics (`crystals/shaders.ts`), on the same packed specimen, worked in the
  specimen's units so every feature keeps its true scale: each pixel of a face is traced into the
  crystal's hull, refracted in, reflected about inside (total internal reflection: the fire is the
  later exits), out wherever it leaves, each colour at its own index close to; absorbed by its body
  over the path, with its zoning, phantoms, veils, bubbles, needles, cracks glinting with a thin
  film's colours, striated and frosted faces, tarnish. Only the world it sees is the wood's, not the
  studio's: through it, the wood behind it as drawn so far; in its faces, the wood about it (the
  frame before, the crystals left out of it); the sun or moon through the fog.
- **The fungi are the Hat-throwers' species**, grown gigantic (`client/field/giantfungi.ts`): one
  to three giants of ten to twenty-odd metres in the heart, a ring of lesser ones at the reach,
  young ones coming up between — stalks, caps turned from each form's profile (an inkcap's pleated,
  inking bell; a mottlegill's cone; a fieldcap's flared slimy dome), and under the open caps every
  gill a blade.
- **The seals are in the wood, drawn in light** (`client/field/woodseal.ts`): each anomaly's own
  seal (the Seals' families — crystals the diamonds' lattice, fungi the clubs' — seeded by the
  find) is inscribed on the ground about it (its ward, twenty-odd metres across, following the lie
  of the land under the grass) and stands in the air at the ward's edge, one by the path where it
  passes. Hairlines and their glow, nothing solid. They are not seen from far off: they come up out
  of the dark within twenty-odd metres, the near part of a ward first; a tree or the anomaly in
  front hides them, and the fog and mist take them as everything else. Their detail follows the
  distance — the construction a way off, the fine fill close to.
- **Over the wood, the seals' light**: the compass (a seal that turns as you do, marks on its rim
  toward each anomaly near), the journal's buttons, and a find's card — the seal card shell
  Markovs Chains uses, its lines and words in light over the wood darkened, the find's own seal in
  it at its finest. Come into a ward, or to the seal by the path, and its name comes up: touch it
  (or the seal) to record it in the journal. The journal keeps what you record, in this browser.

## How it is drawn

Mistwood takes the anomalies through three hooks (`client/mistwood/main.ts`):

- `anomalies`: where each is, its reach and kind. The wood's shared GLSL (`render.ts`,
  `WOOD_GLSL`) carries them to every shader: the ground (`anomGround`), the trees and grass
  (`anomTree`, `anomGrass`) are changed by each. Its light and fog are untouched. None by default:
  Mistwood alone is unchanged.
- `obstacle`: what is solid (a crystal's dome and its bigger shards, the giants' stalks): you walk
  round it, not through it.
- `customs`: anything another experiment draws, called in its place among the wood's cards, into
  the scene with its depth buffer. A fungus and a crystal's shards are drawn first, writing their
  depth, so the trees then go in front of them or behind them by it; the wards next. A crystal's
  cluster is drawn in its place among the trees (its heart is cleared, so little stands between):
  it takes a copy of the wood as drawn so far — everything beyond it — and sees through it, bent,
  and in its faces (what lies behind you, not on the screen, folded in from the wood ahead). The
  standing seals are drawn in their place among the trees.

And one in `client/mistwood/world.ts`: `clearing`, how cleared a point is (the anomalies' hearts),
set before the wood is placed.
