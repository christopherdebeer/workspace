# Hat-throwers

A macro timelapse of a pin mould's night and morning, from a seed. A patch of dung a few
centimetres across, and sixteen hours in under a minute.

*Pilobolus* and its kin fruit on dung overnight:

- **Rising.** A sporangiophore pushes up, clear as glass and yellow at the top, beading with
  water it sweats out.
- **Swelling.** Under its tip a vesicle swells. It's a balloon that's also a lens, and it turns
  the stalk toward the light. The black sporangium on top darkens.
- **Throwing.** By late morning the pressure in the vesicle is enormous, and it bursts. The
  sporangium is shot off toward the light, metres away, and the stalk slumps.
- **The others.** Some kin never throw: no vesicle, just a yellow head on a stalk.

## Hands

- **Tap a stalk** to pull focus to it. It holds there for a while, then the camera finds its own
  subject again, moving slowly from stalk to stalk as a cameraman would.
- **Drag** to move round; **pinch** (or the wheel) to come closer.
- **The scrubber** is the day, and the clock is its time: it starts at nine in the evening.
  `pause` stops the day. `another` gives a new species and a new patch. `?t=` starts at an hour.

## The species

Everything comes from the seed (`client/fungi/genome.ts`):

| Part | What the seed sets |
|---|---|
| Throwing | whether it throws at all (about three in four do) |
| Vesicle | how far it swells, its length to its width |
| Cap | its size, how flat, its colour (black, near-black, brown-black) |
| Stalks | how tall and thick, and how much of the top is yellow, which yellow |
| Lean | how hard they lean toward the light, how much they wander |
| Water | how much beads on them, and how big the drops are |
| Patch | how many stalks, in clumps; how wide; how spread out in time |
| Ground | the dung's dark, its orange beads |
| Light | where it is, how warm |

It also gets a name: a genus made from the seed, and an epithet from what it's like.

Each stalk has its own day: it emerges, grows, swells, ripens and throws. Its droplets bead in
order up it as it grows, more on the vesicle once it's there. When it throws, the cap flies off
along the stalk's aim, the water on the vesicle sprays out, and the stalk slumps, dull and
spent.

## How it's drawn

A macro lens wide open: the stalks are glass, the droplets lenses, and the depth of field a few
millimetres.

1. **The patch.** The ground is a wet, lumpy plane, displaced and shaded from one noise. Fibrous
   and flecked, glossy in its hollows. With it go the orange beads and the caps: glossy, the
   studio's window in their gloss.
2. **The stalks.** Each is a tube along its curve, built in the vertex shader from the same sums
   as `along()` in genome.ts. Its radius swells into the vesicle, or the knob. It's drawn as
   glass: what's behind it, bent toward its edges and tinted, and a glow where the light comes
   through from behind.
3. **The droplets.** Each is a ball lens: the picture behind it, flipped and shrunk into it. Its
   rim goes dark, and the window's glint sits in it, bright enough to bloom.
4. **The depth of field.** Each pixel gathers from a disc as wide as its own blur. It takes a
   sample only if that sample's own blur reaches it, so blur in front spreads over what's sharp
   but blur behind doesn't. Bright glints become discs. A filmic tone, a little green in the
   shadows, a vignette, grain.

The scene is drawn at about half a megapixel, less if the frames come slowly: the depth of field
is the costly part. Rules test: `node cells/lab/devtools/fungi.test.mjs`.
