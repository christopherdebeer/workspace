# Bamboo · 竹径

A run through a wild moso bamboo grove on an endless mountainside, drawn as a lit picture with ink on it: held close to the eye, giving out to the page.

![Running through the grove](bamboo/v-run.jpg)

## Running

- **Hold anywhere and you run**: a long, easy lope of about 5 m/s, gathering speed over a second or two. Let go and you ease to a stop.
- **Drag left and right to turn**, up and down to look. Arrow keys work too.
- **You never have to pick your way.** Each moment the run takes the clearest way near where you're heading: no culm in its path for five metres, no rock face to climb, no drop too far to take. It weaves you between the culms. The grove has its own runs, winding lanes where it's thinner (the ways a deer would take), and the run finds them.
- **The ground sets the pace**: uphill slows you, downhill quickens you.
- **It feels its speed**: the head rises and falls with each stride and sways a little; you lean into a turn; the view widens as you go; and at a run, dry strokes drag at the frame's edges.
- **The sound comes with your first touch**: your footfalls (litter and earth; stone on a stair; a thud when you land), the air past your ears rising with your speed, and the wind in the leaves when a gust comes through.

## What you meet

Mostly the grove. But now and then:

- **a trail**: a sparse network of them crosses the mountain, running on from one stretch of it into the next and meeting here and there. Run onto one more or less along it and it carries you, turning with it, a little quicker, until you turn off it. Each is cut into the slope as a bench, the bank rising on its uphill side.
- **a flight of steps**: where a trail climbs steeply (a cliff band, mostly), it's a flight of stones laid by hand, each a little off line. Your stride shortens to the treads.
- **a cliff band**: here and there the rock breaks through and the land steps up five to nine metres along a winding rim. A rock face you can't climb (the run turns you along it, unless a trail's stair takes you up). Off its top, a drop of up to three metres you leap: you're in the air, and land with a dip. A bigger one stops you at the rim, with the valley beyond.
- **a gust**: every so often one comes through the grove, and you see the tops bend over before it reaches you.

In three minutes of running the run covers about 850 m at a mean of nearly 5 m/s, on a trail for a few per cent of it (`node cells/lab/devtools/bamboo-run.mjs [seconds] [seed]` checks that it never runs through a culm, never stalls for long, and keeps up its pace).

## The mountain

Long slopes and ridges and the valleys between, endless: built where you are and a little way round, 32 m at a time, as you run, and let go behind you. The same seed is the same mountain wherever you go.

## The grove

- **Culms:** moso, thick and pale, close but not a wall. Each has its own girth and height (the stoutest are the tallest) and its own lean, downhill toward the light and out over a way beside it. Its internodes lengthen up the culm. Young culms are pale celadon with fresh white powder under each node; old ones are duller and olive, patched with lichen. Below a way, on the side where the slope falls away, the grove is sparser, so the walk looks out between them.
- **Sprays:** the leaves come in sprays of three to five blades (个 and 介) along the upper part of every culm, so the ceiling is high. Small sprays at shin and knee height are scattered through the grove, thicker along a trail's edges.
- **Litter:** a carpet of fallen leaves everywhere, drawn leaf by leaf near the eye, thinner in the worn middle of a trail, lying on a stair's treads.
- **Stones:** boulders fallen under the cliffs and at the foot of a trail's bank, mossy on top.
- **Rock:** a cliff's face is grey stone streaked down its fall, inked with broken strokes down it.
- **Wind:** every culm sways a little on its own. Every so often a gust comes down the slope: you see the tops bend over upslope before it reaches you, then the sprays stream.

## How it's drawn

Two layers that agree, after Labyrinth's:

- **The picture:**
  - The sun comes through the canopy as a dapple, and the same patches of light lie across the path, the litter and a culm alike; there are sky and bounce light too.
  - Each culm is drawn with the dry brush down its length: streaks, darker just under each node, a band of powder there, the node's own ring.
  - Each spray is lit dark ink-green in shade, yellow-green in sun, and glows where the sun is behind it.
  - The air between: far things are paler and cooler, toward the paper.
- **The ink:**
  - A tick at each node, curving with the ring and darkest at the culm's edges as the eye sees them.
  - Ink pooled at a culm's foot.
  - Each blade's edge on a near spray; each fallen leaf's edge.
  - The way's edges, broken.
  - The outlines, found where the depth jumps or one thing meets another, are inked on the side that's in front. A culm's outline breaks just under each node, as a brush lifts there.
- **The page:**
  - The colour is laid on as far as it reaches (about 10 to 40 m), and the ink reaches further (to about 75 m). Beyond that, the sky, the mist and the far side of the valley are the paper itself, with the far ranges laid in as washes darkest at their crests.
  - Far off, a culm isn't faded: it's in or out whole, by its pick against how far drawn it would be, so the grove thins to a few verticals and then to the page.
  - Shafts of light come through where the canopy opens toward the sun.

## Judged against the board

![The board: three targets and three references](bamboo/board.jpg)

The look was found by image generation first (`devtools/bamboo/explore.md`: three rounds of prompts and what each taught). The reference frames are found on the mountain by what they need (`?ref=a`, the foot of a stair; `?ref=b`, a trail with a fall beside it; `?ref=c`, in the grove off the trails; `?ref=cliff`, a rim; `?ref=run`, mid-stride), and `node cells/lab/devtools/bamboo-fidelity.mjs` draws a, b and c and puts each beside its target. The views are made with `node cells/lab/views.mjs bamboo`.

## Addresses

- `seed=<n>`: the mountain.
- `ref=a|b|c|cliff|run|up|gust`: a fixed frame.
- `auto`: run on by itself, wandering.
- `t=<seconds>` and `still`: time held.
- `fov=<degrees>`.
- `clean`: without the shafts, the paper's grain and the strokes at speed.
- `marks=0`: the picture without its ink.
- `mute`: no sound.
