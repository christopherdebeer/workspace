# Fab

A dressmaking workbench for children. A little wooden figure stands on a turned stand, and beside it lies a skirt's
paper pattern. Nothing is chosen from a list. A child decides what a dressmaker decides, the pattern that follows is
drafted to the figure, and the cut cloth is sewn up round it and falls as that cloth falls.

The aim is for a child to find out that clothes are made, and can be reasoned about, constructed and transformed.

This page sets out what Fab claims, how it's built, and the evidence for and against it. The evidence comes from the
**evidence bench** (`?bench=evidence`), which runs the same tests in the page as it does headless.

## One garment family, deep

The first Fab tried to dress the figure in a skirt, a top and a cape, each with the same six dials. The skirt worked.
The top's sleeves never sat properly. Its pieces weren't real pattern pieces:

- the bodice had no armhole cut into it;
- each sleeve head was about 30% bigger than its armhole;

so no simulation could have made a garment of them. And dials like *silhouette* and *drape* claimed to set what should
only ever be found.

So Fab now goes deep into one family: **the skirt**. It's the simplest thing that's truly *made*: flat pieces cut,
joined round a body and hung from one line, the waist. Nearly every move a dressmaker has shows in it:

- **extend** (length);
- **flare** (cut a panel as a sector);
- **split** (more panels);
- **gather**, **pleat**;
- **dart**, and **shape a seam** (to take in the waist);
- **cut on the grain or the bias**;
- **join** (side seams, waistband).

A child can go from a straight darted skirt to a full circle, a dirndl or a kilt-like pleat, and the reasons each one
hangs as it does are all in view.

## The grammar

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

## Known limitations

- **The real-time cloth is limper than its own converged self** in drape: coefficients up to 0.27 lower, from too few
  substeps for stiff bending. The next step is more substeps on capable devices, or WebGPU.
- **About 6% stretch at the 99th percentile** of springs near the waist, where gathers and darts crowd the cloth. Real
  woven cloth would buckle more and stretch less.
- **The swatch figures are representative, not measured.** Measuring real swatches (a cantilever, a drapemeter, a strip
  tensile test) and putting the numbers into `fabric.ts` would make test 2 a comparison with reality rather than with
  the literature's ranges.
- **Only knife pleats, a single tier, a single layer.** Box pleats, tiers (a second ring of panels gathered onto the
  first) and petticoats are natural next operations in the same grammar.
- **Seams are hinges.** A real seam allowance stiffens the cloth along it.
- **See-through cloth** (chiffon) shows a faint ladder where folds meet at a seam behind it.

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
| `pattern.ts` | the grammar and its checks |
| `fabric.ts` | the swatches |
| `cloth.ts` | the XPBD cloth |
| `body.ts` | the figure and its distance field |
| `render.ts` | WebGL2, shadow-mapped, the print laid on the flat pieces along the grain |
| `sheet.ts` | the pattern, drawn as a dressmaker would |
| `evidence.ts` | the evidence bench |

### URL parameters

| parameter | values |
|---|---|
| `len` | cm |
| `full` | fullness |
| `cut` | `flare`, `gather` or `pleat` |
| `panels` | number of panels |
| `grain` | degrees |
| `fabric` | `chiffon`, `satin`, `lawn`, `jersey`, `linen`, `flannel`, `organza` or `felt` |
| `print` | 0–5 |
| `colour` | 0–4 |
| `settle` | frames run before the first draw |
| `twirl` | spin the figure on load |
| `sheet` | open the pattern on load |
| `preview` | no controls |
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
