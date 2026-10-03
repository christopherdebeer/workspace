# Hat-throwers

A macro timelapse of a terrarium of dung fungi over three weeks, from a seed. Or, with `?one`,
of a single species' night and morning.

## The terrarium

On dung the fungi come in an order. It's a succession, and a real one:

1. **First, within days:** the pin moulds and the hat-throwers.
2. **After a week or so:** the jelly cups.
3. **Last, at two or three weeks:** the inkcaps.

Each lives in the dung as mycelium before it fruits, eating it and taking ground from the others.
Where it's thickest and the dung still has food and water in it, it fruits. As the dung is eaten,
the early ones give out and the later ones take their ground.

A terrarium has two to four species, in that order, each arriving on its own day
(`client/fungi/terrarium.ts`). Under them is a grid of the dung, about a millimetre to a cell,
stepped every six hours through the three weeks. Each cell has:

- **Two foods.** Sugars are quick and soon gone; other microbes take them too. Fibre is tough
  and lasting. The pin moulds and throwers live on the sugars, so they're done when the sugars
  are. The cups take some of each. The inkcaps live on the fibre and come into their own late.
- **Water.** The dung dries by day and takes up dew by night, a little drier each day.
- **Each species' mycelium.** It spreads into the cells around it as fast as there's food and
  water, more slowly where another holds the ground more strongly. Starved, it dies back.

From the grid come the fruit. Each species flushes at nine in the evening, once it's settled in,
in clumps where its mycelium is thickest: as many as it can feed. Every stalk and cushion has a
lifespan; it slumps, inks, shrivels and goes.

The ground shows the grid as it goes:

- white mycelium where it has spread;
- dung paling and drying where it's been eaten;
- wet where it's wet;
- bare grey earth beyond the pellet's edge.

**The camera follows what's about to happen.** The grid's run keeps a list of moments worth
watching: a flush coming up, a thrower about to fire, inkcaps opening or inking, a cushion's
asci firing. A director picks the next one, a few hours ahead and not the same sort as the last.
The camera travels there, unhurried: in close, low, the lens wide open. Between moments it pulls
back above whatever is up, stopped down so more is sharp. The caption names the species it's
on, or the terrarium's cast. Touch the view and the director waits; tap to pull focus.

The light runs on a full day too: night, a warm dawn from five, day, a warm evening, night by
nine. Three weeks take about eight minutes; the clock counts the days.

## The kinds

| Kind | What happens in its day |
|---|---|
| **thrower** (*Pilobolus*) | Sporangiophores push up, clear as glass and yellow at the top, beading with water they sweat out. Under each tip a vesicle swells: a balloon that's also a lens, turning the stalk toward the light. The black sporangium on top darkens. By late morning the vesicle bursts and shoots the sporangium off toward the light; the stalk slumps. |
| **pin** (*Mucor* and kin) | Glass stalks with yellow heads, beading with water. They never throw. |
| **inkcap** (*Coprinellus*) | Pale, pleated caps on velvety, hairy stalks, rising out of tufts of white mycelium. Each cap starts as an egg and opens to a bell. Late on, its margin splits and inks, grey to wet black. |
| **cup** (*Ascobolus*) | Lumps of yellow-green to amber jelly, glistening, deeper orange at their foot. Through their skin the asci push up one by one: clear tubes, each with a column of eight spores, greenish, ripening black. A ripe ascus fires its spores off together, the fastest launch in the living world, and shrinks back. The spores still below the skin show through the jelly as dark streaks. |

## Hands

- **Tap a stalk** to pull focus to it. It holds there for a while, then the camera finds its own
  subject again, moving slowly from stalk to stalk as a cameraman would: one near the middle of
  the picture, ripening, and nearer rather than further.
- **Drag** to move round; **pinch** (or the wheel) to come closer.
- **The scrubber** is the run (three weeks, or one species' day), and the clock is its time: it
  starts at nine in the evening. `pause` stops it. `another` gives a new terrarium (or species).
  `?t=` starts at an hour.

## The species

Everything comes from the seed (`client/fungi/genome.ts`): which of the four kinds it is, then
its own range of everything:

- **Stalks:** how tall and thick, glass or velvet, how hairy, how much they lean toward the light
  and wander.
- **Throwers:** the vesicle (how far it swells, its shape) and the cap (size, flatness, colour).
- **Pin moulds:** the yellow of the head, and how much of the stalk it takes.
- **Inkcaps:** the bell (size, height, 14 to 34 pleats and how deep, its cream and the browner
  apex), how much it inks.
- **Cups:** the jelly's colours, the cushions (how many, how big, how tall), how many asci, the
  spores' colour.
- **The patch:** water (how much beads and how big), how many things in clumps, how spread out
  in time.
- **The ground:** its dark, its orange beads, mycelium, how wet.
- **The light:** where it is, how warm.

It also gets a name: a genus made from the seed with an ending for its kind, and an epithet
from what it's like.

## How it's drawn

A macro lens wide open: wet things glisten, stalks are glass or velvet, droplets are lenses, the
jelly is lit from inside, and the depth of field is a few millimetres.

1. **The opaque patch.**
   - **The ground** is a lumpy plane with a finer relief of its own for the light: fibrous,
     crumbly, flecked, darker and glossier in its wet hollows, sparkling where the wet catches
     the light. It goes white with mycelium threads in patches and round the feet of the stalks.
   - **Litter:** crumbs and the orange beads.
   - **The caps:** glossy, with the studio's window in their gloss.
   - **The inkcaps' bells:** surfaces of revolution, pleated, opening from egg to bell, glowing
     where the light is behind their thin flesh, with fine dark gills beneath. They ink, wet and
     shining, at the margin.
   - **Spores and mycelium:** the asci's spores, and tufts of mycelium (hairs, not a skin). Round
     each inkcap's foot, threads of mycelium fan out over the ground and curl: the same tube as
     the stalks, at a fraction of the detail, a few dozen to a foot.
   - **The far distance:** a haze, warm toward the top, with soft discs of far-off light that
     drift a little as the view turns. It's always behind everything, so always at full blur.
2. **The glass.**
   - **The jelly** is a cushion, lumpy and wrinkled, refracting what's in it, its colour mostly
     in the light that comes through. Its skin glistens. Its normal comes from its shape itself,
     not its mesh's facets, so it stays smooth however close the lens comes.
   - **The stalks and asci** are tubes along their curves (built in the vertex shader from the
     same sums as `along()`). They're glass that bends what's behind and glows with the light
     through it, or velvet: pale, opaque, a sheen of hairs at the edge.
3. **The droplets.** Each is a ball lens: on the stalks, on the jelly, and standing in pools on
   the ground. The picture behind it is flipped into it, with a dark rim and a glint that
   blooms.
4. **The throw.** A thrown sporangium leaves a streak of itself along its flight, as a shutter
   would smear it. When something fires near where the lens is looking (a sporangium, or a cup's
   ascus), the camera jolts, more the nearer it is to the plane of focus.
5. **The light through the day.** It follows the clock:
   - **Night:** cool and dim, as if lamp-lit.
   - **Dawn (from five):** low and warm, coming from behind them.
   - **Morning (by nine):** brighter and higher.

   It always comes from the same side, the side they lean to. The camera opens up a little in
   the night, but never all the way: night stays night.
6. **The depth of field.** Each pixel gathers from a disc as wide as its own blur. It takes a
   sample only if that sample's own blur reaches it, so blur in front spreads over what's sharp
   but blur behind doesn't. A filmic tone, a little green in the shadows, a vignette, grain.

The scene is drawn at about half a megapixel, less if the frames come slowly. Rules test:
`node cells/lab/devtools/fungi.test.mjs`.
