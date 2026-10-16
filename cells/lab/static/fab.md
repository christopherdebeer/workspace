# Fab

A dressmaking workbench for children. A little wooden figure stands on a turned stand, and beside it lies a garment's
paper pattern: a skirt, a top, a dress, trousers or a jumpsuit. Nothing is chosen from a list. A child decides what a dressmaker decides, the pattern that follows is
drafted to the figure, and the cut cloth is sewn up round it and falls as that cloth falls.

The aim is for a child to find out that clothes are made, and can be reasoned about, constructed and transformed.

This page sets out what Fab claims, how it's built, and the evidence for and against it. The evidence comes from the
**evidence bench** (`?bench=evidence`), which runs the same tests in the page as it does headless.

## One garment family, deep, then five

The first Fab tried to dress the figure in a skirt, a top and a cape, each with the same six dials. The skirt worked.
The top's sleeves never sat properly. Its pieces weren't real pattern pieces:

- the bodice had no armhole cut into it;
- each sleeve head was about 30% bigger than its armhole;

so no simulation could have made a garment of them. And dials like *silhouette* and *drape* claimed to set what should
only ever be found.

So Fab went deep into one family first: **the skirt**. It's the simplest thing that's truly *made*: flat pieces cut,
joined round a body and hung from one line, the waist. Nearly every move a dressmaker has shows in it:

- **extend** (length);
- **flare** (cut a panel as a sector);
- **split** (more panels);
- **gather**, **pleat**;
- **dart**, and **shape a seam** (to take in the waist);
- **cut on the grain or the bias**;
- **join** (side seams, waistband).

With the skirt sound, the same grammar now makes four more families. It follows GarmentCode (Korosteleva &
Sorkine-Hornung 2023): a garment is components drafted to the body's measurements and sewn edge to edge by length. The
first Fab's failures are now checks every pattern has to pass:

- **Tops**: a bodice whose armholes are cut, five necklines, sleeves whose heads are solved to their armholes, and three
  collars.
- **Dresses**: a bodice sewn to any skirt at the waist.
- **Trousers**: four panels with a crotch curve solved to the figure.
- **Jumpsuits**: a bodice sewn to trousers.
- **Tiers** on any skirt or dress.

## The skirt's grammar

A skirt is a **waistband** and **n panels** round it, each sewn to the next.

### What you decide (intentions)

| control | what it is | range |
|---|---|---|
| **length** | down from the waist | 12–62 cm |
| **fullness** | the hem's round ÷ the hips' round | 1–4 |
| **flared / gathered / pleated** | where the fullness comes from: cut into the panels' shape as a sector, or cut as straight width and taken in at the waist (eased evenly or folded and stitched down) | three ways |
| **panels** | how many pieces round | 1–10 |
| **grain** | where on the cloth's threads the panels are cut | straight → bias (45°) |
| **cloth**, **print** | swatches | 8 cloths, 6 prints × 5 colourways |

### What follows (structure), as it does on a cutting table

- **The waist is smaller than the hips, so something must take in the difference.** A wide enough flare already does.
  Otherwise each side seam curves in, but no more than a seam can (2 cm). Darts take the rest, as many as needed and
  none deeper than 3 cm. Fewer panels means fewer seams, and so more darts: cut a straight skirt in one piece and it
  needs darts all round.
- **Gathered or pleated, the extra width is taken in at the waist.** Gathered, it's eased in evenly. Pleated, it's
  folded into knife pleats, one about every 4.5 cm of band and stitched down 5 cm.
- **Nothing sewn closed is tighter than the body plus 4 cm of wearing ease.** A pleat's stitching lets it out as the
  hips widen, and a dart stops where the body needs the room.
- **A dart or pleat closes a whole number of the cloth's grid columns.** So the waist is re-cut to make what's left
  between them *exactly* the band. The waist always fits.
- **Each panel must fit across the cloth's width (140 cm) along its grain.** A panel that doesn't fit is cut in more
  panels. A child's circle skirt fits in one piece; a maxi doesn't. Turn a panel to the bias and it gets wider across
  the grain.
- **A flare can't be fuller than a full circle.**

### What's never set (outcomes)

Silhouette, how many folds and how deep, whether the hem is level, how far it swings out in a twirl. These are what
the simulated cloth does with the cut.

### Dependency model

```
intentions                 structure (pattern.ts)                      material (fabric.ts)       outcomes (cloth.ts)
length ───────────────┐    panel outline (polar: sector ↔ rectangle)   weight (gsm)               silhouette
fullness ─────────────┼──▶ flare angle, or straight width          ──▶ bending rigidity B = w·g·c³ ─▶ folds: count, depth
flared/gathered/pleated┤   darts / side-seam curve / pleats / ease      warp, weft, shear (N/m)    hem level
panels ───────────────┤    panels needed to fit the bolt (140 cm)       grain (woven or not)       stretch, cling
grain ────────────────┘    grain angle on each piece                    friction                   swing in a twirl
                     body: waist & hip rounds at every depth
```

Couplings exist only where the cut or the physics makes them:

- panels and flare → whether darts are needed;
- grain and flare → how many panels it takes to fit the cloth;
- grain and fabric → how much it stretches and clings.

None are invented to make the dials feel richer.

## The other families

Every family is drafted from the figure itself, measured from its own shapes in `body.ts`, and every one passes the
same checks: seams meet, pieces lie flat, pieces fit on the cloth. Each also has checks of its own.

### Tops (`bodice.ts`)

A **front** and a **back**, each half the chest's round and its ease. The ease runs from snug (4 cm) to roomy (16 cm).

| control | what it is |
|---|---|
| **length** | cm below the waist; less than 0 is cropped above it |
| **room** | wearing ease round the chest |
| **sleeves** | cm down the arm, 0 for sleeveless; **plain**, **puff** or **bell** |
| **neck** | **round**, **V**, **square**, **boat** or **scoop**, and how much lower or higher than usual |
| **swing** | how much wider the hem is than the chest |
| **collar** | none, **Peter Pan**, **band** or **frill** |

What follows from those choices:

- **The front is as long as the figure's surface.** It runs as far as the figure's front does from the waist to the
  neck. The shoulder seam falls as the figure's shoulder does across its top, about 17°. The back's shoulder seam is
  cut to the front's length.
- **The armhole** runs from the shoulder's point straight down and meets the side seam under the arm.
- **A sleeve is as wide as the arm plus its ease.** Its head's height is *solved* so the head is 3% longer than its
  armhole (eased in), or 45% longer for a puff (gathered in).
  - Each half of the head fits its own armhole, back and front. GarmentCode solves its sleeve caps the same way.
  - An armhole too short for the sleeve is cut deeper, and the notes say by how much.
  - A long sleeve must pass the hand.
  - A puff is gathered into a cuff as round as the arm there.
  - A bell flares, but no faster than its seams can lean.
- **It has to go over the head.** If the neckline won't, it opens down the back with buttons. A knit (jersey) stretches
  half again, and often needs no opening.
- **A top that comes below the hips** is cut wide enough to clear them.
- **Collars:**
  - A **Peter Pan collar** is two flat ring sectors whose inner edge is the neckline. It's a small circle skirt, rounded
    at the front.
  - A **band collar** is a strip as long as the neckline.
  - A **frill** is 1.8 times as long, gathered on.

### Dresses

A bodice cut to the waist, with a skirt sewn round its hem. The skirt is drafted as before, but its "band" is the
bodice's hem. Its darts, pleats or gathers close into the hem: each point of the skirt's waist is sewn to its own place
round it.

### Trousers (`trousers.ts`)

Four panels, after GarmentCode's PantPanel: a front and a back for each leg.

| control | what it is |
|---|---|
| **legs** | cm of leg below the crotch: shorts (5) to full length (33) |
| **width** | room in the leg, slim to wide (culottes, palazzos) |
| **flare** | the hem over the knee: tapered, straight, flared |

What follows from those choices:

- **Each panel** is a quarter of the hips' round and its ease, straight up to the waist.
- **The crotch curve's reach is solved.** Each crotch seam must be as long as the figure's own surface from the waist,
  down under it, to between its legs, plus 2 cm.
- **The waist** is as wide as the hips and gathers into an elastic band, so it goes over them.
- **A full-length leg** must pass the foot.

### Jumpsuits

A bodice to the waist, with trousers gathered onto its hem.

### Tiers

Any skirt or dress can have two or three **tiers**. Each is a ring of straight panels 1.5 times the round of the hem
above, gathered onto it, as GarmentCode's SkirtLevels are. The first tier still comes past the hips.

### How it's represented

GarmentCode's edges are lines, circle arcs and Béziers whose control points are *relative to their chord* (`edges.ts`),
so a curve keeps its shape whatever its ends do.

A piece is four runs of edges round it, with its cloth's grid laid over them as a **Coons patch**. Every corner between
two edges falls on a grid point. So a bodice with its armholes and neckline, a sleeve with its head and a trouser leg
with its crotch curve are all the same kind of grid the skirt's panels always were. The cloth needed only one new thing.

**A seam sews two runs by length**, as GarmentCode's stitches do. Every point of each run is sewn to the place the same
fraction along the other: between two of its points, by a new interpolated XPBD stitch constraint in `cloth.ts`. Two
runs of different lengths gather the longer onto the shorter. Gathered waists, puffed sleeve heads, tiers and frills are
all that one rule.

The grid runs down each piece, so no edge along a piece's top or side may run in the grid's own direction. That would
crush the cells. So:

- the armhole meets the side seam steeply, not level;
- a round neckline meets the shoulder at 45°, not straight up;
- a square neck's sides lean, as GarmentCode's trapezoid neck allows;
- the crotch curve meets the inseam at 45°.

Under an arm or a leg the difference is a few millimetres. The **pieces lie flat** check catches any grid that crushes.

**The figure is posed for what it wears.** Its arms stay up in a dancer's curve for skirts and trousers. For anything
with a bodice they come down to 45° below its shoulders, as GarmentCode's bodies stand.

Pieces start laid out as GarmentCodeData lays its panels:

- flat and unstretched, on a gentle curve in front of the figure and behind it;
- sleeves as tubes on the arms;
- trouser panels round the legs.

The sewing and the shoulders' holds then draw them round. Tops hang from the tops of their shoulders. Pieces that
aren't held, like sleeves, a dress's skirt and collars, are tethered to what they're sewn to.

## The physical representation

Each piece is a grid over its flat shape, at about 2 cm, coarser for big skirts so the cloth stays near 1,800 points.
The cloth is simulated with **XPBD** (extended position-based dynamics), in its "small steps" form: 8 substeps a frame.
All units are centimetres, grams and seconds.

- **Mass**: each point gets a third of each triangle's flat area, times the fabric's weight.
- **Stretch and shear**: a spring along every mesh edge. Its stiffness is the cloth's *orthotropic* tensile stiffness in
  that edge's direction on the cloth:

  1/E(φ) = cos⁴φ/E₁ + sin⁴φ/E₂ + (1/G − 2ν/E₁)·cos²φ·sin²φ

  So a woven cloth is stiff along its threads and soft on the bias, a knit is soft across its courses, and felt is the
  same every way. Turning the grain dial changes physics, not a texture. This is a spring network, not a finite-element
  membrane: that is the stated compromise.
- **Bending**: the quadratic isometric bending energy of Bergou et al. (2006). At each interior point it takes the
  cotangent Laplacian of the positions, which is zero on the flat pattern. It's weighted by the flexural rigidity,
  computed from the swatch's measured Peirce bending length and weight, over the point's area. It's solved as an XPBD
  constraint with its multipliers carried across three passes a substep, so extra passes converge on the true
  stiffness instead of adding to it.
- **Long-range attachments** (Kim, Chentanez & Müller 2012): each point is tied to its nearest held point, no further
  than the cloth between them plus what that much cloth would stretch hanging, *in that direction*. Without them a
  one-pass solver let woven cloth creep about 7% under its own weight.
- **Seams** are zero-length constraints, drawn closed over the first 0.8 s: the sewing. **Darts** are sewn and folded
  flat. The **waistband** is held, turning with the figure.
- **Air** drags on each point's speed through the cloth by area over mass, so chiffon floats and felt falls.
- **The figure**: an analytic distance field (lathed torso, capsules, balls) with Coulomb friction against its moving
  surface.
- **The cloth against itself**: a spatial hash, with each point's radius under half its nearest neighbour's distance.
  Points near seams and folds are exempt, since there they're meant to meet.

**Assembly is shown, not hidden.** The pieces are first laid on a surface of revolution where nothing is stretched:
its round at each depth is the panels' width there. Then the seams are sewn and the waist is drawn into the band. Press
**sew** to watch it again.

### Why XPBD, and what else was considered

| approach | fits Fab because | against |
|---|---|---|
| **XPBD, small steps** (chosen) | stiffness in real units (compliance), unconditionally stable, cheap, deterministic, easy collisions and seams | stiff materials under-converge at few substeps: measured below |
| plain PBD (the first Fab) | simplest | stiffness depends on iteration count, so it can't be calibrated to a swatch |
| implicit mass-spring / Baraff–Witkin (the CLO and Browzwear lineage) | large stable steps, mature for garments | a sparse linear solve each step; heavy for a phone in JS |
| projective dynamics | fast, stable, prefactored system | refactor on every re-cut; collisions awkward |
| FEM shells (StVK / discrete shells, ARCSim) | the most faithful anisotropy and bending | far too slow for real time on a phone |
| GPU XPBD (WebGPU) | 10–100× the points: finer folds | not yet on every phone; the next step if folds need it |

GarmentCode (Korosteleva & Sorkine-Hornung 2023) programs parametric sewing patterns as components with interfaces.
It's the closest relative of the grammar here. Fab takes its "pattern first, simulate second" stance at a scale a child
can turn by hand.

## Evidence

Each test could show Fab is wrong. Run them at `?bench=evidence` (`&converged` re-measures the slow converged drape
references). The numbers below are from a headless run.

**1 · Is every pattern a real pattern?** Pass. 1,120 designs were tested: every corner of the space (3 ways × 1–10
panels × 4 fullnesses × 3 lengths × straight or bias) plus 400 at random. Each was put through the pattern's own
checks:

- every side seam meets one its own length;
- the waist, folds closed, fits the band to within 4%;
- it clears the body with 4 cm of ease everywhere down to the hips;
- every piece fits on the cloth;
- every dart is sewable (≤ 3 cm deep, ending above the hips);
- every outline is simple.

All 5,632 checks pass. Getting there found real bugs:

- pleat waists up to 21% too long, from rounding to grid columns;
- stitched pleats tighter than the hips;
- darts rounded to 3.6 cm;
- a circle cut in one piece wrapping past itself.

**2a · Does each cloth bend as stiffly as its swatch says? (Peirce cantilever)** Pass. A strip held twice its bending
length out should droop to 41.5°. Converged (a fine mesh, 200 substeps), the bending length read back is within 10% of
every swatch (the test allows 12%; Peirce's formula is itself approximate), so the bending model is right. As worn (a 2 cm mesh, 8 substeps), it's within 18%.

**2b · Does each cloth drape as such cloth does? (Cusick drape test)** Pass, with a measured compromise. The test is a
30 cm disc on an 18 cm pedestal.

| cloth | bending length | drape coefficient, as worn | converged | nodes |
|---|---|---|---|---|
| chiffon | 1.1 cm | 0.18 | 0.29 | 12 |
| silk satin | 1.4 cm | 0.23 | | 9 |
| jersey | 1.6 cm | 0.25 | | 10 |
| cotton lawn | 2.0 cm | 0.35 | 0.57 | 7 |
| wool flannel | 2.3 cm | 0.41 | | 6 |
| linen | 2.8 cm | 0.50 | 0.77 | 6 |
| organza | 3.2 cm | 0.58 | | 5 |
| felt | 4.5 cm | 0.83 | 0.94 | 5 |

- Converged, the coefficients run 0.29–0.94, inside the 0.3–0.98 range drape testers report, and they're ordered by
  stiffness. The fold count falls as stiffness rises (12 → 5), as on real drapemeters.
- As worn, the order holds but the cloth is limper by up to 0.27. That is the cost of 8 substeps on a phone.
- Getting here found a measuring bug (empty bearings in the shadow), a solver bug (repeated passes without carried
  multipliers stiffened the cloth), and a data bug (felt's in-plane stiffness was 6× too low).

**2c · Does cloth cut on the bias stretch as bias-cut cloth does?** Pass. A 30 × 6 cm strip hung for 3 s:

| cloth | straight grain | bias | ratio |
|---|---|---|---|
| chiffon | +0.12% | +0.43% | 3.5 |
| cotton lawn | +0.11% | +0.23% | 2.1 |
| jersey | +0.39% | +1.01% | 2.6 |
| felt (no grain) | +0.15% | +0.16% | 1.0 |

Real bias growth under its own weight is bigger than this linear model gives. Woven cloth creeps on the bias, which is
why dressmakers hang bias skirts overnight before hemming. The direction is right; the magnitude is a known gap.

**3 · Is the design space really expressive?** Pass. Each skirt was settled from flat on the figure, then twirled at
0.9 turns a second.

One construction (flared, 4 panels, 2.2× full) in contrasting cloths:

| cloth | hem out | fold depth | folds | hem level (sd) | swing |
|---|---|---|---|---|---|
| chiffon | 14.3 cm | 1.8 | 22 | 0.18 | +15.2 |
| cotton lawn | 15.4 | 3.4 | 10 | 0.59 | +12.3 |
| linen | 16.8 | 3.6 | 8 | 0.82 | +13.5 |
| felt | 15.7 | 5.9 | 4 | 2.07 | +14.4 |

One cloth (cotton lawn) in contrasting constructions:

| construction | hem out | fold depth | folds | swing |
|---|---|---|---|---|
| straight (darted) | 12.6 | 1.3 | 2 | +0.2 |
| flared | 15.4 | 3.4 | 10 | +12.3 |
| gathered | 17.5 | 2.1 | 9 | +10.3 |
| pleated | 15.8 | 2.8 | 13 | +11.9 |
| one piece, bias | 16.1 | 4.0 | 9 | +10.4 |

Every skirt in each set is measurably apart from its nearest neighbour (≥ 1.16 in the bench's scaled units). All are
stable: 99% of the cloth is within 9% of its cut length.

**4 · Is it quick enough, and the same every time?** Partly. On this container's CPU a skirt of about 1,800 points
takes 11–15 ms a frame, a little over the 12 ms target. Sewn twice, it lands in exactly the same place. To measure a
phone, open the evidence page on it.

**5 · Do children understand it?** Not yet tested; it can't be tested here. The protocol:

- **Sessions**: children aged 6–11, alone or in pairs, 20 minutes, no instructions beyond "this is a skirt-making bench".
- **Predict, then try.** Show a skirt, name a change ("more panels", "cut on the bias", "felt instead of chiffon"), and
  ask: *will it stand out more or less? Will the hem be wavy?* Then make the change. Record predictions before and after
  an hour of play: does accuracy rise?
- **Explain.** Show two skirts made from the same pattern in different cloths, and two cloths cut to different patterns,
  and ask why they differ. Code each answer: names a material property / a construction / only the look.
- **Intention.** Ask for "a skirt that twirls out wide" or "one that's straight and neat". Count steps to success, and
  note whether they use the pattern card.
- **Observe** what they open (the pattern, the sew replay), what surprises them (look for laughter or a "wait…"), and
  what they try twice.

Success would be predictions improving with play, and explanations naming construction or material rather than looks.

**5 · Is every garment a real pattern?** Pass. 752 garments were drafted and put through every check, 4,011 checks
in all:

- every neckline × sleeve length × sleeve × collar of a top, a dress and a jumpsuit, at both ends of their room and
  length;
- the corners of trousers' legs;
- tiered skirts and dresses;
- 300 more at random across everything.

Getting there found real bugs, each caught by the checks:

- sleeve heads split 24/8 cm between their halves (a bisection the wrong way round);
- grid cells crushed to 0° wherever an armhole, neckline or crotch curve ran level or upright;
- a shoulder seam at 45° when it should be 17°, from measuring the shoulder's point up the figure's side;
- tiers gathered 1.45× when they should be 1.5×, from loops that dropped each panel's last step.

**6 · Does every garment sew up?** Pass. Each of the 27 garments on the workshop's rails was laid out, sewn and let
settle for 2.5 s. Every seam closed to within 1.6 cm, mostly to a few millimetres. The cloth stayed whole and nothing
was left inside the figure. Each took 1.6–4.7 ms a frame here.

The cloth stretches more at its 99th percentile under a bodice (18–34%) than in a skirt (6–7%). That stretch sits where
gathers and set-in sleeve heads crowd it.

## Known limitations

- **The real-time cloth is limper than its own converged self** in drape: coefficients up to 0.27 lower, from too few
  substeps for stiff bending. The next step is more substeps on capable devices, or WebGPU.
- **About 6% stretch at the 99th percentile** of springs near the waist, where gathers and darts crowd the cloth. Real
  woven cloth would buckle more and stretch less.
- **The swatch figures are representative, not measured.** Measuring real swatches (a cantilever, a drapemeter, a strip
  tensile test) and putting the numbers into `fabric.ts` would make test 2 a comparison with reality rather than with
  the literature's ranges.
- **Only knife pleats, a single layer.** Box pleats, petticoats and linings are natural next operations in the same
  grammar.
- **Under a bodice the cloth stretches more** at its 99th percentile (18–34%, against 6–7% in a skirt). Gathered heads
  and the shoulders' holds crowd it. More substeps, or a finer grid at seams, would let it buckle instead.
- **The grid can't follow every curve.** Armholes, necklines and crotch curves meet their neighbours at an angle rather
  than level (see *How it's represented*). GarmentCode meshes its panels freely; a grid can't.
- **No fitted darts in bodices yet**, and no princess seams. A child's figure barely needs them; a grown one would.
- **A dress on its hanger** settles a little crumpled where its gathered skirt meets the bodice.
- **The Peter Pan collar is hard to see in the same cloth.** A contrast collar would show it.
- **Seams are hinges.** A real seam allowance stiffens the cloth along it.
- **See-through cloth** (chiffon) shows a faint ladder where folds meet at a seam behind it.

## The rails

Fab opens on the workshop's wall: a row of clothes rails, each hung with garments on hangers.

- **The workshop's rails** are chromed: one each for skirts, tops, dresses, and trousers and jumpsuits, with one of each
  way of making them in contrasting cloths, to start from.
- **Each person has their own rail**, powder-coated in their own colour, with what they've made. Tap **+ a rail** and
  give it a name.

Using the rails:

- Drag the skirts along a rail and they slide like real hangers. They run on, slow down, and settle with one in front.
  They bunch up toward the bar's ends, and each swings on its hook as it's pushed.
- Swipe up or down, or tap a name tag, to move to another rail.
- Tap the skirt in front, or **put it on the figure**. It comes off its hanger, the camera crosses the room to the
  bench, and the skirt is laid out flat and sewn onto the figure.
- A person's rail starts with a bare hanger, for a new skirt.

Saving:

- **hang up** at the bench hangs the skirt back on its owner's rail. A skirt that came from the workshop's rail goes
  on the rail in use instead, and if nobody has a rail yet, Fab asks whose it is.
- Going back to the **rails** hangs it up too, if it's changed.
- Long-press one of your own skirts to take it off the rail.
- Tap your own rail's name tag to rename it. Clear the name to take the rail away.

Every skirt on a rail is the real thing. Its pattern is drafted from its design, a little coarser than at the bench
(about 650 points). It's sewn and let fall from the hanger's two clips, which hold its waistband flat, by the same
cloth simulation. Each one settles once, a few at a time, nearest first. After that it hangs still, and only its swing
moves it.

The rails live in this browser (localStorage), so a rail is a person on this device: a family's tablet, or a
classroom's. Nothing leaves the device. Sharing rails between devices would need storage behind the cell, which this
static lab cell doesn't have.

## Using it

- **Turn the figure**: drag. **Come close**: pinch, or scroll.
- **twirl**: spins the figure on its stand.
- **sew**: lays the pieces out flat and sews them up again.
- **The pattern card** (bottom right) opens the whole pattern: the pieces with their grain lines, darts and pleats, how
  many to cut, the notes the cut made, and the pattern's checks.

## How it's built

All of it is in `client/fab/`:

| file | what it does |
|---|---|
| `garment.ts` | every garment from one design: its family, its components, how they're sewn together, the shared checks |
| `edges.ts` | the geometry: lines, arcs, Béziers (chord-relative), Coons-patch pieces, sewing runs by length |
| `cut.ts` | what every cut shares: the figure measured, waistbands, holds, hangers, the shared checks |
| `pattern.ts` | the skirt: its grammar and its checks |
| `bodice.ts` | tops: bodice, necklines, sleeves, collars |
| `trousers.ts` | trousers |
| `fabric.ts` | the swatches |
| `cloth.ts` | the XPBD cloth |
| `body.ts` | the figure and its distance field |
| `render.ts` | WebGL2, shadow-mapped, the print laid on the flat pieces along the grain |
| `sheet.ts` | the pattern, drawn as a dressmaker would |
| `rails.ts` | the rails: the carousel, the swing, hanging skirts settled on their hangers |
| `store.ts` | the rails kept in this browser, and the workshop's own skirts |
| `evidence.ts` | the evidence bench |

### URL parameters

| parameter | values |
|---|---|
| `fam` | `skirt`, `top`, `dress`, `trousers` or `jumpsuit` |
| `len` | skirt length, cm |
| `full` | fullness |
| `cut` | `flare`, `gather` or `pleat` |
| `panels` | number of panels |
| `grain` | degrees |
| `tiers` | 1–3 |
| `blen`, `ease`, `swing` | a top's length below the waist, its room round the chest (cm), its swing |
| `neck`, `ndepth` | `round`, `v`, `square`, `boat` or `scoop`; cm lower (or higher, below 0) |
| `slen`, `sleeve` | sleeve length (cm; 0 sleeveless); `plain`, `puff` or `bell` |
| `collar` | `none`, `peterpan`, `band` or `frill` |
| `llen`, `lwidth`, `flare` | trousers' leg below the crotch (cm), room (1–2), hem over knee (0.8–1.8) |
| `fabric` | `chiffon`, `satin`, `lawn`, `jersey`, `linen`, `flannel`, `organza` or `felt` |
| `print` | 0–5 |
| `colour` | 0–4 |
| `settle` | frames run before the first draw |
| `twirl` | spin the figure on load |
| `sheet` | open the pattern on load |
| `preview` | no controls |
| `rails` | start at the rails (a design in the query starts at the bench) |
| `warm` | settle the rails' skirts before the first frame |
| `bench` | `evidence` opens the evidence bench |

## Sources

- Korosteleva & Sorkine-Hornung, *GarmentCode: Programming Parametric Sewing Patterns*, ACM TOG 42(6), 2023:
  [arXiv:2306.03642](https://arxiv.org/abs/2306.03642).
- Macklin, Müller & Chentanez, *XPBD: Position-Based Simulation of Compliant Constrained Dynamics*, MIG 2016.
  Macklin et al., *Small Steps in Physics Simulation*, SCA 2019.
- Bergou, Wardetzky, Harmon, Zorin & Grinspun, *A Quadratic Bending Model for Inextensible Surfaces*, SGP 2006.
- Kim, Chentanez & Müller, *Long Range Attachments: A Method to Simulate Inextensible Clothing in Computer Games*,
  SCA 2012.
- Peirce, *The "handle" of cloth as a measurable quantity*, J. Textile Inst. 1930. ASTM D1388 (the cantilever test).
  On the formula's known overestimate of stiffness:
  [MetaTOC summary](https://www.metatoc.com/papers/40121-improved-accuracy-in-the-determination-of-flexural-rigidity-of-textile-fabrics-by-the-peirce-cantilever-test-astm-d1388).
- Cusick, *The dependence of fabric drape on bending and shear stiffness*, J. Textile Inst. 1965. BS 5058 / ISO 9073-9.
  The 30–98% range of drape coefficients is from the
  [Materials Science (Medžiagotyra) drape study](https://matsc.ktu.lt/index.php/MatSc/article/view/26688/13757).
  That stiffness dominates drapeability is from the [JTATM study](https://jtatm.textiles.ncsu.edu/index.php/JTATM/article/view/11259/5989).
