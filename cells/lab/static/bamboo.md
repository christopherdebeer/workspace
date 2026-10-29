# Bamboo · 竹径

A run through a wild moso bamboo grove on an endless mountainside, drawn as a lit picture with ink on it: held close to the eye, giving out to the page.

![Running through the grove](bamboo/v-run.jpg)

## Running

- **Hold anywhere and you run**: a fast lope of about 7 m/s, gathering speed in a second or so. Let go and you ease to a stop.
- **Drag left and right to turn**, up and down to look. Arrow keys work too.
- **You never have to pick your way.** Each moment the run takes the clearest way near where you're heading: no culm in its path for nine metres (a stand seen coming and gone round, not met), no rock face to climb, no drop too far to take. It weaves you between the stands. The grove has its own runs, winding lanes where it's thinner (the ways a deer would take), and the run finds them.
- **The ground sets the pace**: uphill slows you, downhill quickens you.
- **It feels its speed**: the head rises and falls with each stride and sways a little; you lean into a turn; the view widens the faster you go.
- **The sound comes with your first touch**: your footfalls (litter and earth; stone on a stair; a thud when you land), the air past your ears rising with your speed, and the wind in the leaves when a gust comes through.

## What you meet

Mostly the grove. But now and then:

- **a trail**: a sparse network of them crosses the mountain, each worn the way feet would rather go: routed over the land so it keeps to the contour and bends where the hill does, taking a slope on only where it must. Roots cross it here and there, from the bank side, half in the earth. Giants stand right at its edge; below it, where the hill falls away, the grove thins, so the way looks out over the valley, its far ranges blue in the mist. Its cut bank is bare red-brown earth, roots run across it and stones stand in it, ferns along its top. The trails run on from one stretch of the mountain into the next and meet here and there. A trail near draws you onto it; run along one and it carries you, turning with it, a little quicker, until you turn off it. Each is cut into the slope as a bench, the bank rising on its uphill side.
- **a flight of steps**: where a trail climbs steeply (a cliff band, mostly), it's a flight of stones laid by hand, each its own width and a little off line and askew, boulders left standing beside it here and there as it was cut through them; where a flight turns, it turns round a great boulder on the inside of its bend. Your stride shortens to the treads.
- **a cliff band**: here and there the rock breaks through and the land steps up five to nine metres along a winding rim. A rock face you can't climb (the run turns you along it, unless a trail's stair takes you up). Off its top, a drop of up to three metres you leap: you're in the air, and land with a dip. A bigger one stops you at the rim, with the valley beyond.
- **a gust**: every so often one comes through the grove, and you see the tops bend over before it reaches you.

In three minutes of running the run covers about a kilometre at a mean of 4.8 to 6 m/s (the mountain's steep), on a trail for a few per cent of it (`node cells/lab/devtools/bamboo-run.mjs [seconds] [seed]` checks that it never runs through a culm, never stalls for long, and keeps up its pace).

## The mountain

Long steep-sided ridges and the valleys between (half the hillside steeper than one in three), endless (where a rim or a rock face bars the way ahead, the run looks wider and turns you along it): built where you are and a little way round, 32 m at a time, as you run, and let go behind you. The same seed is the same mountain wherever you go.

## The grove

- **Culms:** moso, thick and pale, in **stands**, as a grove grows from its runners: clumps of a few to a dozen or more, with open floor between them, each stand of an age (young and pale, or old and dull), stoutest toward its middle. Now and then one old giant stands beside a trail, the one the eye goes to. Each culm has its own girth and height (the stoutest are the tallest) and its own lean, downhill toward the light and out over a way beside it. Its internodes lengthen up the culm. Young culms are pale celadon with fresh white powder under each node; old ones are duller and olive, patched with lichen. Below a way, on the side where the slope falls away, the grove is sparser, so the walk looks out between them.
- **Sprays:** the leaves come in sprays of three to five blades (个 and 介) along the upper part of every culm, so the ceiling is high. Small sprays at shin and knee height are scattered through the grove, thicker along a trail's edges.
- **Litter:** a carpet of fallen leaves everywhere, drawn leaf by leaf near the eye, thinner in the worn middle of a trail, lying on a stair's treads.
- **Stones:** boulders fallen under the cliffs and at the foot of a trail's bank, mossy on top.
- **Rock:** a cliff's face is grey stone streaked down its fall, inked with broken strokes down it.
- **Wind:** every culm sways a little on its own. Every so often a gust comes down the slope: you see the tops bend over upslope before it reaches you, then the sprays stream.

## How it's drawn

Three passes, after Labyrinth's, and the land's own strokes laid in the world:

- **The shadows**: the culms near you seen from the sun, so their shadows stripe the litter, the steps and each other. The canopy's own shade is its dapple, cast down the sun from the gaps overhead. The sun is low and warm, so the shadows run long, and shafts of light come through when you run toward it.
- **The picture**: each surface lit in its own colour.
  - **Culms**: olive-celadon, dry-brushed down their length, darker just under each node, a band of white powder there.
  - **Sprays**: dark ink-green in shade, glowing gold-green with the sun behind them.
  - **Litter**: a carpet of fallen leaves.
  - **Stone**: worn, warm.

  Beside the colour, each surface hands on its own **marks**, the ink it calls for:
  - a culm's node ticks, darkest at its edges as the eye sees them, dry-brush strokes down its shaded side, and ink pooled at its foot;
  - a spray's blade edges, its blades filled in ink where the colour's given out;
  - each near fallen leaf's edge;
  - a trail's edges;
  - the strokes down a rock face;
  - a crack across a step.
- **The land's strokes** (`strokes.ts`): marks the mountain's features call for, laid as ribbons on it, so each stays where it is as you run and the mountain still reads when its colour's gone: a trail's **edges**, broken, firmer where the bank's cut deep; a **rim** along the top of a bank's cut and **hachures** down it in small groups; a flight's **strings** along its sides and a stone's front edge now and then; a cliff's **rim** and **strokes down its face**; a few **contours** along the hillside and short **strokes down the fall** where it's steep enough to show; where a **stone** meets the ground. Each is turned to the eye, held to a least width on the screen by its kind (a rim most), lighter with distance, and left out whole by its pick where the drawing thins, never faded. A rim holds over the colour; a contour's only for the paper.
- **The page**: the outlines, found where the depth jumps or one thing meets another, inked on the side that's in front; a culm's breaks just under each node, as a brush lifts there. They lighten with distance, so a far culm is a fine grey line.

### How far it's drawn

It isn't a mask laid over the picture: it's how each thing is drawn. Each thing asks how far drawn it is, once for the whole of it (give or take a pick of its own, so neighbours differ), and is drawn in three stages:

- **lit**: in the sun and shade, in its own colour;
- **flat**: the light gone, laid in its own colour as a wash, no shading;
- **ink**: its marks and outlines alone on bare paper, heavier where the colour's gone, as a drawing's line carries what the colour did;
- then the **page**: the sky, the mist and the far side of the valley are the paper itself, the far ranges laid in as washes darkest at their crests.

How far drawn a thing is, is the further of two things:

- **in the world**: how far it is from the eye, `colour` (lit to), `wash` (flat to) and `ink` (marks to) metres;
- **in the frame**: how far it is from the **focus** (where you're going and looking: the ground the eye's line meets past the culms crossing it, kept between 7 and 30 m, and moved to slowly). Out from it the frame goes: the picture, then linework, then sparse marks, then clear paper just inside **every edge**, top and bottom as much as the sides (the frame's measured near-square), whatever's there and however near. Things far beyond the focus go sooner; things much nearer a little, so the ground at your feet holds. `frame` sets how far round the focus the picture holds (0 tight … 1 wide), `depth` how much sooner far things go.

The paper isn't a mask feathered over the picture: it's made by **leaving things out**. Past its colour, a culm, a spray, a stroke is kept or left out **whole**, by its own pick, fewer and fewer toward the paper; the ink lightens through the sparse marks. A culm's dry-brush shading goes with its colour; its node ticks and its foot carry on in the drawing. A long stroke lifts off, a stretch at a time, before it reaches the paper.

A thing gone to the page is gone: it hides nothing behind it. One drawn as its ink alone still stands in front of what's behind it, its paper its own. So a spray or a stone changes whole, never cut by a line across it; a culm changes an internode at a time, each where it stands, its top going before its foot; a spray going out stays as its blades in ink. The ground goes leaf by fallen leaf, the bare earth between them first, its edge dragged dry across the slope as a brush leaves it.

The 墨 button (bottom right) sets them: four presets, and a slider for each. The bands stay in order, and the address keeps what you set, so a drawing can be passed on.

| preset | colour | wash | ink | frame | depth |
|---|---|---|---|---|---|
| picture | 85 m | 110 m | 130 m | 1 | .25 |
| board (the default: lit, then straight to ink, carried far) | 29 m | 29 m | 160 m | .14 | .98 |
| drawing | 8 m | 28 m | 85 m | .25 | .5 |
| marks | — | — | 90 m | .4 | .4 |

![Marks: the drawing, with a few things near the eye keeping a touch of their colour by their own picks](bamboo/v-marks.jpg)

## Judged against the board

![The board: three targets and three references](bamboo/board.jpg)

The look was found by image generation first (`devtools/bamboo/explore.md`: three rounds of prompts and what each taught). The reference frames are found on the mountain by what they need (`?ref=a`, the foot of a stair; `?ref=b`, a trail with a fall beside it; `?ref=c`, in the grove off the trails; `?ref=cliff`, a rim; `?ref=run`, mid-stride), and `node cells/lab/devtools/bamboo-fidelity.mjs` draws a, b and c and puts each beside its target. The views are made with `node cells/lab/views.mjs bamboo`.

## The gates

The look is now hill-climbed against five target studies (`devtools/bamboo/targets/`, and `gates.md` there for what each is judged by: the contour run, culm scale, ink reach, the stair, a gust), in gates: **0**, geometry and composition in plain colour with no marks; **1**, the drawing alone, which must still carry the route and the bank; **2**, the board as it's shown; **3**, motion and finish. `node cells/lab/devtools/bamboo-gates.mjs [gate…]` draws each target beside its pinned scene (`?cam=`, never found afresh) three ways: picture, ink only, board.

## Addresses

- `seed=<n>`: the mountain.
- `ref=a|b|c|cliff|run|up|gust`: a frame found on the mountain by what it needs; `cam=x,z,heading,pitch[,speed]`: one pinned exactly.
- `reach=picture|board|drawing|marks`, or `colour=`, `wash=`, `ink=` and `soft=` (metres), `frame=` (0–1) and `depth=` (0–1.5): how far it's drawn (above).
- `shadows=0`: no culm shadows (cheaper).
- `auto`: run on by itself, wandering.
- `t=<seconds>` and `still`: time held.
- `fov=<degrees>`.
- `clean`: without the shafts and the paper's grain.
- `marks=0`: the picture without its ink.
- `strokes=all`: every stroke the land has, at full weight, none left out (to see what's laid).
- `clay`: every surface one clay, its light kept (the sun on it, the culms' cast shadows, the sky), no paper, no ink: the forms alone.
- `culms=0`: the land alone, no bamboo (the gates' hard test: does the mountain and its path still read?).
- `mute`: no sound.
