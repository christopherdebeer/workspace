# Seals

The junction cards of Markovs Chains, redrawn as engraved seals. This is a drawing experiment
for the game: the functions here are pure, so once the seals are right they move into the
card renderer unchanged.

## What a seal says

Every junction card is a die table: six faces, each an exit (north, east, south, west) or a
stay. The seal draws exactly that, bold, over a faint engraved ground:

- **an exit** is a shaft from the hub out past the rim, with a barbed head; its faces are one
  label on the shaft, grouped as print does ("1–2", or "3" in a roundel; **group faces** off
  gives a roundel per face, across the shaft);
- **the stays** are a closed loop hanging off the hub, on the side furthest from the exits,
  with an arrow back into the hub and the stay faces ("4–6") on the loop. The loop never reaches the
  rim, so a stay can't be read as an exit (the old dials' stay curl could);
- every head (barbed, a slim dart, an open chevron, or barbed with a lozenge behind: **arrow
  heads**, with **arrow size**) is aimed along its line; on the loop it is aimed from a head's
  length back along the arc to the tip, so its base sits on the curve, and the arc stops where
  the head takes over (the game's dials had the same fix);
- the faces always read like print: left to right across a shaft, top to bottom down one;
- under the seal, the same in words: `1–2 ↑   3 →   4–6 stay`, and
  `Six outcomes · one state · two exits`.

## The four families

Each suit has a style: a set of hyperparameters, read off the reference seals.

| Suit | Family | Ground |
|---|---|---|
| Hearts | filigree, red with a wash | lens arcs through the hub, a hexagram, fans of rays on the diagonals, heart motifs with curled scrolls, crescents east and west |
| Diamonds | lattice, brown | an inscribed square run out to the rim, tick scales, four-pointed stars on every axis, cardinal nodes standing proud |
| Clubs | lattice, olive | the same lattice, ragged scales, trefoils in roundels on the diagonals |
| Spades | filigree, navy | denser: four great arcs, more rings, spades on the axes, crescents on all four |

## Even filling

A seal has a few lines (rings, the band, optionally a star, spokes, arcs), and then a **fill**:
the space the lines leave is packed with discs, each as large as the space at its centre allows,
and each disc carries one ornament from the suit's vocabulary (dots, sparkles, the suit's motif,
rosettes, roundels, scrolls, star polygons, eyes, crescents), chosen by the suit's weights.
**Evenness (tries)** is the dial: at 1 the discs go in at random and leave clumps and holes; at
30 or more the largest space is always filled first, and the fill comes out even. Optional lace
links neighbours with curved hairlines, and a stipple pass dots what is left.

**Fade** makes a fill thin out: toward its sparse side the spacing between discs widens and
the largest disc shrinks, so the fill stays evenly spaced but sparser, rather than losing discs at
random. **Dense at** picks the dense side: *outer* (far from the centre: a seal's rim, a card's
corners), *inner*, *edge* (along every edge of the region) or *deep* (its middle). The spacing
only widens between discs, never against the construction's lines, so narrow bands keep their
fill.

The fill repeats under the seal's symmetry: a fourfold seal fills one sixteenth and turns and
mirrors it. A disc close to a mirror line snaps onto it, so the axes carry ornament instead of
a seam.

**Inner lines** off leaves the fill the whole interior, the clearest way to judge the fill.

## Safe zones

Anything that has to stay legible (the faces' roundels, shafts and loop, the title, the face
line, the summary) has a **safe zone** sized to its geometry or its words, grown by **zone
margin**. A fill packs symmetrically first, then every disc a zone touches shrinks to fit or goes,
then a pass of smaller discs (not symmetric) closes the gaps round the zone. So the ornament
gives way locally and stays symmetric everywhere else.

**Faces**: *shown* draws the probabilities; *hidden* shows the bare base, as if there were none;
*zones* hides them but keeps their space and shows the zones in pink. **discs** overlays the
packing: teal for the symmetric pass, orange for the refill.

## Shapes, borders and corners

Regions are signed distance fields (`client/seals/field.ts`): circles, rings, rounded boxes,
polygons, capsules, circle strokes, and their unions, intersections, differences, offsets and
level lines. A shape gets the seal's **construction** before its fill (`structure.ts`), all of
it read off the shape's own field:

- **nodes**: rays along the symmetry's mirrors (and to a box's corners); where a ray runs inside
  the shape, its deepest point is a node. On the rays the suit puts its motifs (hearts and
  clubs the diagonals, diamonds both, spades the axes) a node carries a **medallion**: a small
  seal of the suit's own, with rings, beads, a star polygon and the suit's motif;
- **rules**: contour lines inset from the edge (marching squares on the field), of the shape
  less its medallions and labels, so the rules wrap round both, like cartouches;
- **band**: a bead rule, then ticks along a contour (the suit's scale or rays), lengths from a
  noise that is the same at every mirror image;
- **lattice**: a star polygon through the points where the rays meet the inner rule, spokes, and
  arcs round the medallions, clipped to the shape, so across a frame they become rungs and
  bracing;
- the construction takes at most a third of the shape's depth, so a thin frame keeps its rules,
  only finer; the fill packs what is left.

So the same code makes a card's **frame** (a box minus a smaller box), its **corner pieces** (a
disc at each corner, cut by the frame), a ring or a lens. **Card border** puts a frame, corners
or both round each card: its rules wrap round the title, the face line, the summary and the
seal, each zone sized to its words. The **Shapes** view does six shapes round a label you type.
**Medallions** sets their size (0: none).

## Measuring evenness

Under a single card, and under each shape, the fill is measured on a grid of samples over its
free area (the region, less the lines and the zones): **coverage** (the share inside a disc) and
the **gap**, the radius of the empty circle at a free point (its mean, its 95th percentile, and
its largest). An even fill has a low p95 gap and a max close to it; a clumpy one has holes, so
its max runs away. The tests check that largest-first leaves smaller gaps than random addition.

## How a seal is made

Three pure stages (`client/seals/seal.ts`):

1. **`sample(style, seed)`**: the seed moves every number marked `~` by up to a quarter of its
   range times `variance`. Same style and seed, same seal.
2. **`draw(params, faces, seed)`**: the marks (circles, paths, figures) in seal units, with the rim
   at radius 50: the lines, then the fill (`ornament.ts` `fill`, built on `pack.ts`), then the
   faces. Each layer draws from its own stream (`hash(seed, layer)`), so turning one control
   redraws one layer only.
3. **`sealSvg` / `card`**: the marks as SVG, on their own or on a 63 × 88 mm card with its
   border (`card` also returns the seal and border fills, with their numbers).

The styles and the schema the controls are built from are in `client/seals/styles.ts`.

## Using it

Pick a suit, a card (or `seal` for the bare ground) and a seed, then choose a view: one card,
the whole suit, the four suits side by side, or six seeds. Open **Hyperparameters** to turn the
suit's style. Your changes stay with the suit and in the address, so a link shares them.
**Copy style** gives the JSON to paste into the styles file.
