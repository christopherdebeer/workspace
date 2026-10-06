# Seals

The junction cards of Markovs Chains, redrawn as engraved seals. This is a drawing experiment
for the game: the functions here are pure, so once the seals are right they move into the
card renderer unchanged.

## What a seal says

Every junction card is a die table: six faces, each an exit (north, east, south, west) or a
stay. The seal draws exactly that, bold, over a faint engraved ground:

- **an exit** is a shaft from the hub out past the rim, with a barbed head; its faces are
  numbered roundels across the shaft;
- **the stays** are a closed loop hanging off the hub, on the side furthest from the exits,
  with an arrow back into the hub and the stay faces on the loop. The loop never reaches the
  rim, so a stay can't be read as an exit (the old dials' stay curl could);
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

## How a seal is made

Three pure stages (`client/seals/seal.ts`):

1. **`sample(style, seed)`**: the seed moves every number marked `~` by up to a quarter of its
   range times `variance`. Same style and seed, same seal.
2. **`draw(params, faces, seed)`**: the marks (circles, paths, figures) in seal units, with the rim
   at radius 50. Each layer of the ground draws from its own stream (`hash(seed, layer)`), so
   turning one control redraws one layer only. The ground draws one half-sector and repeats it
   round the fold, mirrored.
3. **`sealSvg` / `sealCard`**: the marks as SVG, on their own or on a 63 × 88 mm card.

The styles and the schema the controls are built from are in `client/seals/styles.ts`.

## Using it

Pick a suit, a card (or `seal` for the bare ground) and a seed, then choose a view: one card,
the whole suit, the four suits side by side, or six seeds. Open **Hyperparameters** to turn the
suit's style. Your changes stay with the suit and in the address, so a link shares them.
**Copy style** gives the JSON to paste into the styles file.
