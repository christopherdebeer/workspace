# Hat-throwers

A macro timelapse of dung fungi out in a pasture, on the real clock. Or, with `?terrarium`, one
pat on its own over its three weeks from the start; or, with `?one`, a single species' night and
morning.

## The field

Time doesn't start from zero. The field's hour is the real one: come in the evening and it's
evening there, on today's date. The camera comes down into a pasture where pats lie at every
age (`client/fungi/pasture.ts`):

- one dropped last night, wet and dark;
- one a week in, its cups firing;
- one at three weeks, its inkcaps inking;
- old ones, crusted and cracked, the grass coming back over them.

Cows keep coming. The field is tiled, and each tile has a few spots where, each on a cycle of
its own (two to three months), a pat is dropped, always at nine in the evening. So which pat is
where, and how old, follows from the field's seed and the hour alone. It's the same field for
anyone looking at the same moment, and nothing has to have been simulated before it. Each pat
near the camera is a terrarium (below), simulated from its own seed when it comes into reach
and moved into place and time. Each stands as a mound for its three weeks, then dries, flattens
and goes back to grass over the next five. All the pats lean their fungi to the field's one sun.

**The grass** (`client/fungi/grass.ts`) is, at this scale, a forest:
- **The grazed sward** is a few centimetres high, its blades bitten off, the tips torn square and
  browning.
- **Rank grass:** cattle won't graze near their own dung, so round each pat the grass grows on,
  rank and darker. Its blades are up to 17 cm long, arching over and leaning in.
- **Under a pat** the grass is smothered; on an old pat it comes back through.
- **Thatch:** last year's leaves lie bleached between the blades.
- **Dew:** from the small hours to mid-morning the blades bead with it, a heavy drop hanging at
  each tip.

**Among the grass** (`client/fungi/flora.ts`):
- **Mosses** grow in patches where the sward is open:
  - cushions of upright shoots, small pointed leaves in a close spiral, the new growth paler;
  - from them, sporophytes: fine red setae, a capsule nodding at each top, green then brown;
  - feather moss creeping over soil and thatch, its stems branched either side.
- **Dung moss** (*Splachnum*) grows on some pats after three weeks. Pale shoots carry long setae,
  and under each capsule is a swollen umbrella, magenta or yellow. Its colour and smell draw
  flies, which carry its sticky spores to the next pat.
- **White clover** grows in patches: stolons along the ground, leaves on long stalks, three broad
  leaflets each with a pale chevron and herringbone veins.
- **Ribwort plantain:** rosettes of long ribbed leaves, rising. Some have tall stalks, each
  with a dark spike ringed in pale stamens where it's flowering.
- **Earthworm casts:** coiled heaps of soil pellets, dark and glistening when fresh.
- **Money spiders' sheet webs** sit low in the grass: hammocks of silk you hardly see by day.
  From the small hours to mid-morning they're silver with dew.

Every blade (and moss, clover, web) comes from the field's seed and its place, so the grass is
the same wherever you look from. It's drawn only near the camera, finer nearer, and never between the camera and what
it's looking at.

**Visitors to the pats** (`client/fungi/visitors.ts`), as long as the fungi are tall:
- **Yellow dung flies** (*Scathophaga*) come to a pat within minutes of its falling:
  - the males are furry and golden, about a centimetre long, each on its own patch facing much
    the same way;
  - they wait for the females, fewer and greyer;
  - they sit, groom with their front legs, and dart to another spot;
  - they're there by day, for the pat's first few days.
- **Dung beetles** (*Aphodius*):
  - small and domed: a black shield, ridged chestnut or black wing cases, a shovel of a head,
    clubbed antennae, front legs broad and toothed for digging;
  - they walk the pat on alternating sets of three legs, dig in, and come up out of another
    hole;
  - over the pat's first week and more it's pitted with their holes.

**The director** works across the field. It prefers moments near where it is: a long way to go
for a moment loses it. Between moments it looks at the pat with most going on nearby. Now and
then it takes other shots:
- **The lie of the field:** pats in their clearings in the grass, from up and back.
- **Dew at dawn:** a blade at a pat's edge.
- **The other life near it:** a moss's capsules, dung moss on an old pat, clover, a dewed
  web.
- **A visitor:** a dung fly on its patch, or a beetle going about. The lens goes with it.

The caption names the pat's age. The clock shows the field's date and hour. The scrubber covers
four weeks, two either side of when you came, and moves on as time does. `another` gives
another field. `?hour=6.5` starts at the last time it was that hour; `?age=40` starts at the
pat nearest that many days old.

## A pat (the terrarium)

On dung the fungi come in an order. It's a succession, and a real one:

1. **First, within days:** the pin moulds and the hat-throwers.
2. **After a week or so:** the jelly cups, and in some terrariums an eyelash cup and the flask
   fungi.
3. **Last, at two or three weeks:** the inkcaps, in some pats a yellow fieldcap or two, and the
   tall mottlegills.

Each lives in the dung as mycelium before it fruits, eating it and taking ground from the others.
Where it's thickest and the dung still has food and water in it, it fruits. As the dung is eaten,
the early ones give out and the later ones take their ground.

A terrarium has two to six species, in that order, each arriving on its own day
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

**They leave things about.** Each thrown sporangium lands somewhere: mostly out on the dung,
where it dries and is gone in a few days. Now and then it hits something standing in its line of
flight and sticks to it, as they stick to grass in a field. A cup's spores land in dark smudges
round it. Where those land on wet dung, some of them start the species again: new mycelium,
another flush later. Inkcaps drip ink from their margins as they dissolve, and leave black stains
on the ground that outlast them.

**Animals live with them** (`client/fungi/critters.ts`):

- **Nematodes:** glassy, under a millimetre long, a granular gut down their middle and a clear
  bulb behind the head. Each crawls in the wet film over the dung. Its body slides along its own
  sinuous track, the wave running back down it, now and then backing up, its head lifting and
  swinging as it searches. Some climb a thrower's stalk as it ripens and stand on the sporangium,
  waving (nictating), to be thrown with it. Lungworm larvae do this on *Pilobolus*: thrown out
  into the grass, they're eaten with it by the next cow.
- **Mites**, two families:
  - *Macrochelids:* flat, chestnut, glossy, with a dorsal shield ringed by a groove and setae
    in pairs. They dash and stop, the first legs held up as feelers, tapping, the palps working.
  - *Oribatids* (beetle mites): round, nearly black, slow, with two club-headed sensilla.
  - Their legs are jointed (coxa to claw), hairy, and step in two alternating sets. The gait's
    phase is how far the body has gone, so feet stay planted while it moves and stand still when
    it stops.
- **Springtails** (three kinds: plump dark blue, pale grey, banded yellow): soft, granular,
  segmented, with a black patch of eyes each side and four-jointed antennae feeling about. They
  sit; then the furca folded under them snaps down and they're gone, tumbling, to land a few
  body-lengths off.
- **Nematode-trapping fungi** (*Arthrobotrys*): where nematodes are thick, a trapping fungus
  sets little nets of sticky hyphal loops in the wet, with upright conidiophores, each topped by
  a head of two-celled spores. Now and then a nematode is caught. It thrashes, weakens, is
  still; the fungus fills it (it goes milky, its gut gone) and it slackens and is gone in a day.

When and roughly where comes from the seed and the hour, so a scrub lands on the same animals.
How they move runs in real time, as it would under a lens while the hours went by. When the
camera goes down to a mite or a springtail, it follows it.

**The dung itself** is full of grass, chewed and digested: fragments of leaf and stem lying every
way, straw-coloured to dark brown, veined, half sunk.

The ground shows the grid as it goes:

- white mycelium where it has spread;
- dung paling and drying where it's been eaten;
- wet where it's wet;
- bare grey earth beyond the pellet's edge.

**The camera follows what's about to happen.** The grid's run keeps a list of moments worth
watching: a flush coming up, a thrower about to fire, inkcaps opening or inking, a cushion's
asci firing, a sporangium stuck to a neighbour, a nematode riding one, mites grazing, flasks
shooting, a nematode caught. A director picks the next one, a few hours ahead and not the same sort as the last.
The camera travels there, unhurried: in close, low, the lens wide open. Between moments it pulls
back above whatever is up, stopped down so more is sharp. The caption names the species it's
on, or the terrarium's cast. Touch the view and the director waits; tap to pull focus.

The light runs on a full day too: night, a warm dawn from five, day, a warm evening, night by
nine. Three weeks take about eight minutes. In the field the clock shows the date; in a terrarium
it counts the days.

## The kinds

| Kind | What happens in its day |
|---|---|
| **thrower** (*Pilobolus*) | Sporangiophores push up, clear as glass and yellow at the top, beading with water they sweat out. Under each tip a vesicle swells: a balloon that's also a lens, turning the stalk toward the light. The black sporangium on top darkens. By late morning the vesicle bursts and shoots the sporangium off toward the light; the stalk slumps. |
| **pin** (*Mucor* and kin) | Glass stalks with yellow heads, beading with water. They never throw. |
| **inkcap** (*Coprinellus*) | Pale, pleated caps on velvety, hairy stalks, rising out of tufts of white mycelium. Each cap starts as an egg and opens to a bell. Late on, its margin splits and inks, grey to wet black. |
| **eyelash cup** (*Cheilymenia*, *Scutellinia*) | Saucers a few millimetres across, orange to scarlet and wet inside, paler outside. Their rim is fringed with dark, stiff hairs, curling outward like eyelashes. They open slowly and last days, darkening and drying from the rim as they go. |
| **flask** (*Sordaria*, *Podospora*) | Hundreds of tiny flasks, half sunk in the dung: soft and pale at first, then black and glossy. Each has a neck that turns to the light. Every so often one shoots a puff of spores off the tip of its neck. |
| **fieldcap** (*Bolbitius*) | Late, a few to a pat. A yellow cone on a fragile pale stem, egg-yolk at its middle, slimy, its margin finely striate. It opens out flat within the day and is gone by the next. |
| **mottlegill** (*Panaeolus*) | Last, a few to a pat, on stems several centimetres tall. Its cap is an egg, then a bell, never flat; cream, clay at its top. Its gills mottle black as its spores ripen unevenly. It lasts a few days. |
| **cup** (*Ascobolus*) | Lumps of yellow-green to amber jelly, glistening, deeper orange at their foot. Through their skin the asci push up one by one: clear tubes, each with a column of eight spores, greenish, ripening black. A ripe ascus fires its spores off together, the fastest launch in the living world, and shrinks back. The spores still below the skin show through the jelly as dark streaks. |

## Hands

- **Tap a stalk** to pull focus to it. It holds there for a while, then the camera finds its own
  subject again, moving slowly from stalk to stalk as a cameraman would: one near the middle of
  the picture, ripening, and nearer rather than further.
- **Drag** to move round; **pinch** (or the wheel) to come closer.
- **The scrubber** is the run (three weeks, or one species' day), and the clock is its time: it
  starts at nine in the evening. `pause` stops it. `another` gives a new terrarium (or species).
  `?t=` starts at an hour. `?one&form=eyelash` (or `thrower`, `pin`, `inkcap`, `cup`, `flask`)
  asks for a kind. `?one&critter=macro` (or `ori`, `hypo`, `iso`, `ento`, `worm`, `trap`) puts one
  animal under the lens.

## The species

Everything comes from the seed (`client/fungi/genome.ts`): which of the kinds it is, then
its own range of everything:

- **Stalks:** how tall and thick, glass or velvet, how hairy, how much they lean toward the light
  and wander.
- **Throwers:** the vesicle (how far it swells, its shape) and the cap (size, flatness, colour).
- **Pin moulds:** the yellow of the head, and how much of the stalk it takes.
- **Inkcaps:** the bell (size, height, 14 to 34 pleats and how deep, its cream and the browner
  apex), how much it inks.
- **Eyelash cups:** the saucer (size, depth, its orange), how many hairs and how long.
- **Flasks:** the body, the neck (how long, how hairy, how far it leans).
- **Cups:** the jelly's colours, the cushions (how many, how big, how tall), how many asci, the
  spores' colour.
- **The patch:** water (how much beads and how big), how many things in clumps, how spread out
  in time.
- **The ground:** its dark, its orange beads, mycelium, how wet.
- **The light:** where it is, how warm.

It also gets a name: a genus made from the seed with an ending for its kind, and an epithet
from what it's like.

## How it's drawn

**Light.** The sun (or the lamp at night) casts soft shadows. Each frame first draws a depth map
from the light, fitted to what the camera is on and snapped to its texels so the shadows don't
crawl. Into it go the ground and the pats' mounds, the fungi's caps and opaque stems, the grass,
the animals and the litter. Clear things (*Pilobolus* stalks, nematodes, wings) cast next to
nothing. Everything opaque then looks it up softly: grass stripes the pats with shade, a cap
shades the dung under it. The shade keeps some of the sky. On a device too slow to keep up even
at its smallest size, the shadows switch themselves off; `?noshadow` turns them off.

**Surfaces.** The ground's relief comes from cellular noise and a height turned into a normal
across each pixel. No detail is drawn finer than a pixel can hold.
- **Fresh dung:** dark, wet with a smooth gloss, straw fibres in it at every angle, air pits.
- **Drying dung:** a crust that splits into irregular plates, the cracks widening with age, each
  plate its own shade.
- **The field's floor:** soil crumbs with pale grains among them, flakes of dead leaf with
  their veins, fine roots.
- **Mushroom caps:** radial fibrils; a mottlegill's cap water-soaked toward its margin, drying
  in patches; gills granular with spores.
- **Grass blades:** rows of stomata along them, soil splashed up their bases, tiny teeth on
  their edges catching the light.

**The lens** adds a faint bloom round the brightest light (glints, dew), lateral colour fringing
toward the frame's edges, grain and vignetting.

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
   - **The eyelash cups** are the inkcap's bell turned over: a saucer, wet and bright inside,
     downy outside. It sits as the ground slopes, and is raised where a lump of dung would come
     through its floor. Its hairs are the stalk's tube, dark, leaving the rim already tipped out.
   - **The flasks:** a glossy black body and a dark tube of a neck.
   - **The animals are limbs:** swept tubes along a polyline of up to 24 points, each with its
     radius, kept in a float texture (a row each). Each is smooth (Catmull-Rom) or jointed, round
     or flattened, with rounded ends. A mite's body is one, flattened; each leg is another,
     jointed at its seven points; palps, chelicerae and every seta are more. Their materials:
     - polished, pitted chitin with a darker shield and margins that glow with the light behind;
     - paler legs, dark at the joints;
     - a springtail's velvety granular skin, pale between segments, with a violet sheen;
     - a grass fragment's veins and cells.

     Patterns are in the limb's own coordinates (along it in millimetres, round it), so they
     move with the animal. Near limbs get a fine mesh, far ones coarser, the farthest none. The
     ground darkens softly under the nearest animals.
   - **Nematodes** are limbs in the glass pass. They're seen through (refracting what's behind),
     milky, with the gut and the pharynx's bulb inside and light caught along their edges.
   - **The inkcaps' veil:** woolly white patches and fibrils over a greyer cap, thick on the
     egg, pulled apart as it opens.
   - **The pats** are mounds in the ground, in both the ground's vertex shader and the page's sums
     (so what stands on them stands on them). Their outline is the same lumpy round as their
     dung, and each pat's map is a layer of a texture array. Old, the ground crusts: greyer,
     cracked, then the field's floor coming back over it. Between pats lies the field's floor:
     dead leaf, roots, soil, green in it. The ground's mesh follows the camera.
   - **Moss shoots, clover leaves, setae and the dung moss's umbrellas** are limbs as well:
     - A moss shoot's leaves are a spiral pattern in its own coordinates. Where its edge would
       be smooth, it's broken off between the leaves, so it's ragged.
     - A clover leaflet is a broad, flattened limb whose width follows a leaf's outline.
     - Further off, a moss cushion is a velvet tuft.
     - A web is its dew: a few hundred tiny drops along its threads, drawn with a coarse mesh.
   - **Grass blades** are limbs too: flat ribbons whose width keeps across their bend, however
     far over they bend. Each has a keel and veins, is paler at the sheath, and has a waxy sheen;
     the light through it is green-gold. Grazed tips are torn and browning.
   - **A thrower's trophocyst:** the swollen orange-yellow foot it grows from, half in the dung.
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
