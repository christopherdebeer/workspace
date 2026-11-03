# Switchback

A downhill motocross run down a mountain made as you ride it. The style target is a single flat-colour illustration (`switchback/target.jpg`): an orange-and-black rider on a pale cliff road, a charcoal rock wall, an orange fence along the drop, black pines, a deep ultramarine sky, blue snow-banded ranges, a white river far below, and speed drawn as orange, white and charcoal shards rather than blur.

![A run down the cliff road](switchback/v-ride.jpg)

## The brief

A moving composition of cut colour: cobalt space, pale passages, charcoal weight and orange force. The mountain, the rider and the machine come out of overlapping silhouettes, deliberate openings and a few decisive internal marks; large areas stay flat and unbroken. Depth comes from perspective, occlusion, parallax, contact and a changing silhouette, not from shading every facet. What isn't drawn matters as much as what is:

- **An edge earns its place** by explaining a silhouette, an overlap, a fold that matters, a contact or a direction. A polygon boundary alone earns nothing.
- **Negative space is designed**: the opening under an elbow, through a wheel, between the hips and the seat.
- **Boundaries may disappear and return**: a black leg merges with the bike, then separates as the rider shifts; posture, contact and the riding decision stay readable.
- **It works between frames**: masses hold together as the rider turns, openings widen and close with load and lean, marks stay attached to what made them.
- **Rider and motorcycle are a changing partnership of masses.** Their axes separate under effort, open in flight and gather for landing. Hands and feet make the contact; elbows, knees and the spaces between show the forces.

## Riding

Drag left or right to steer: the drag's distance from where it began sets how hard you turn. Nothing steers for you: the bike goes where it points, and with no input it runs straight on, so every bend has to be ridden. Turn hard at speed and the rear steps out: the way you're travelling follows the way the bike points only as far as the tyres grip (less at speed, less braking), so the bike yaws past its line and slides, scrubbing pace and throwing roost, until it lines up again. Drag up and down to drive, as far as you drag, like the steering: up opens the throttle wider (a harder pull, toward ~185 km/h), down brakes; left alone, the engine and the hill keep you going as they always have. ← → or A D steer from a keyboard, ↑ ↓ or W S drive. Kickers (a ramp painted with an orange double chevron, a gap over a ravine, a landing deck, both on black trestles) launch you; whoops (a run of rollers) throw you at speed; any crest that falls away faster than you would drop puts you in the air. In the air you can turn a little, and steering **whips** the bike: it swings out sideways beneath you (and back when you let go). Up and down **tips the nose**, measured from where your drag stood when you left the ground (so the throttle held through a lip doesn't tip you over; let go and it's measured from nothing): pull down and the nose comes up and keeps coming, over into a **backflip** if you hold it; push up and it goes down, to meet a falling slope or over the front. Let go and the turning dies away quickly and the nose settles back to the line of the flight. How the bike meets the ground matters: square to its slope, the landing's soft and keeps its pace (a nose pushed down onto a falling slope carries you on a little faster); a little off and a wheel slams; well off (nose first, or looped over onto the back wheel) is a crash. A whole turn landed is a BACKFLIP or a FRONT FLIP (DOUBLE, or more), across the screen with a three-note chime. Bring it back straight before you land: still out a little and it comes down yawed and slides straight, scrubbing pace; still well out (past about 34°) and it's a crash. The wall on the left glances you off it and costs pace; the drop side, on the right, is forgiving: you can ride the shoulder past the fence and the slope beyond it (the bike rides the ground as it's drawn there, and slides down it where it's steep), and only going too far down it, landing too hard into it, or riding into a face (an outcrop, the side of a raised deck) ends it. A fall or a crash puts you back at the last **checkpoint**: the flags on the wall side, further apart the further down you are (about 300 m apart at the top, about a kilometre five kilometres on), each one counted as you pass it (CHECKPOINT n across the screen, and again when you're put back at it), and you start again just past it, going.

The rider is yours from the start; `auto` (a debug and test flag; the preview uses it) hands the steering to the sim's own rider. The eye rides over your right shoulder, the drop side, so the wall rises beyond the rider and the valley opens under you.

## The course (`course.ts`)

The line is laid a metre at a time from the seed, as an off-road route picks its way down rock rather than a road's arcs: straight legs broken by short, sharp kinks (seven to fourteen metres each, some hard; always turning back toward the fall line once the route has wandered, so it keeps going down the valley), a width that never settles (a new one every few metres, joined straight; now and then a pinch between rocks under 5 m, or a wide flat over 10), a fall that steepens and eases, and a rough surface that steps up and down over rock, a new height every few metres joined straight. On the legs, features: a kicker every so often (a 14 m ramp, an 18 m gap, a 36 m deck), whoops between. The mountain stands on the left (a rock wall going up) and falls away on the right, as a cliff road does. Everything asks the course the same things: where the line is at distance `s`, the surface height at (s, u) with u across it, and whether there's surface at all (a gap has none).

## The rider (`sim.ts`)

Arcade physics in the world: the bike has a heading (where it points) and a travel (where it's going); steering turns the heading, quicker at low speed; the travel follows through the grip; where you are on the course (how far down, how far across) is read back from your position. The fall of the hill and the engine drive you, the air holds you back, the loose shoulder slows you. The lean is what the turn asks (pace times how fast the heading swings, against gravity). The engine pulls hard toward 165 km/h; a run averages well over 100. Off a lip you fly; off a crest too, where the ground a tenth of a second on falls away below the arc you'd fly by more than the suspension takes up (so the rough rattles you without throwing you every step). You fly a ballistic arc; you land along whatever's under you, a hard landing squashing the suspension and costing pace; landing short into a deck's face, or falling far below the road, is a crash.

## The bike and rider

A motocross bike in its real proportions: a 1.48 m wheelbase, a 21-inch front wheel on a fork raked at 27°, knobbly tyres drawn as open rings with the rim inside, a swingarm and shock behind, tank and radiator shrouds, a long flat seat, the rear fender kicked up, the pipe and silencer.

- **On the ground:** each wheel stands on the surface under it (sampled ahead and behind), and the bike is pitched between them, so both tyres touch on slopes, crests and the rough.
- **Steering:** the whole front (the wheel, fork, fender, clamps, bars, grips and number plate) turns about the raked steering head. It turns the way you steer, less at speed, and toward where you're going in a slide (opposite lock).
- **Lean:** what the turn asks (the pace times how fast the way you're going is swinging, smoothed so a flick isn't a turn, against gravity). It comes in over about a third of a second and is never more than about 35°.
- **Suspension:** the frame sinks on its springs as you land and as the rough throws you up, and in the air it extends.

The rider isn't fixed to the bike; it works it:
- **The body rides on springs.** It sways against the bike's lean (the bike tips further than the body, which stays nearer upright over it), shifts to the outside of a slide, rocks back as the bike speeds up and forward as it brakes, bobs with the bike's lurches up and down. It lags, overshoots and settles.
- **States read as different shapes.** Riding, it stands on the pegs, the hips off the seat, the elbows open. Landing, the pelvis drops toward the seat (never into it), the chest goes down toward the bars and the elbows out and back: the figure shortens. In the air it stands tall at first, the hips well off the seat, and as it comes down it gathers, the hips settling and the weight going forward.
- **A chain, not a statue.** The pelvis, the chest and the head each turn their own amount: the chest is bent forward off the pelvis; in a whip the pelvis twists toward the swung bike, the chest less, the head a little the other way, toward where it'll land. The shoulders' line tips under the effort of the bars.
- **The head leads.** It's sprung on its own, quicker than the body: it looks into a turn and along a slide, nods down toward the ground as you come down to it, and is held nearer level than the bike.
- **Legs and arms are solved each frame** (two bones each) from the hips to the pegs and from the shoulders to the grips, which turn with the bars and swing with a whip. Their joints are pushed differently on each side, so the openings are made by what the body's doing: under the bars' effort or a whip one elbow goes up and out (a broad opening) as the other comes down and in (closing), and one knee grips the machine as the other comes away.

**Drawn as cut colour**: three masses, each one flat field with one dark cut where it turns from the light. Orange is the jersey (one shape, lofted through the pelvis, a narrow waist, the chest and broad, rounded shoulders; sleeves full at the shoulder, narrowing to the elbow) and the bodywork. One charcoal is the legs, the gloves and the whole machine (engine, frame, swingarm, pipe and silencer, side plates, tyres), with no marks inside it. Cream is kept for what touches or steers (the boots, the fork as one slash), the front plate and the helmet, its one dark cut the goggles and strap as a single band, with an orange stripe over the top; a dark neck parts it from the jersey. The wheels are thick knobbled rings, open through the middle. The rider is lit for the picture, not by the sun: from above, behind the eye and to its left, so what faces you is one field and only the side turned to the eye's right takes the cut.

`look=side|front|rear|quarter` holds the eye off the bike, for judging the model.

**Studies** (flags, for judging the figure):
- `rider=sil` draws the rider and bike as one solid charcoal, to judge the silhouette before the colour; `rider=facets` the old way, every face its own band (orange jersey with black panels, white boots, an orange helmet).
- `whip=<degrees>` holds the bike in a whip beneath the rider, for a pinned frame.
- `world=0` draws the rider alone on the sky, to judge its silhouette and openings.

## The drawing (`mesh.ts`, `render.ts`)

Every triangle has one material and one tone. The renderer takes each face's normal from the screen (so every face is flat), and its light, nudged by its tone, picks one of its material's four colours, all taken from the target: pale snow, packed track, charcoal rock, orange, black, white, the ranges' blues. So planes lit alike still break into different greys, as a painter sets them. Distance doesn't fade smoothly: it steps, four hard bands toward the valley's blues, each face keeping its band so the far slopes stay faceted. The rider's shadow is the bike itself flattened along the sun onto the ground. Each face's position is taken relative to the eye before its normal is found, so far down the mountain, where world coordinates run to thousands of metres, faces don't speckle between bands.

**The backdrop** is drawn round the eye, far enough off that it needn't move with you, in one family of blues: lighter and flatter the further off, never charcoal. It's a few deliberate set pieces rather than a field of random facets:
- **Two skylines**, the farthest (3.4 km) and a nearer one (2.5 km) in front of it. Each is one continuous ridge line: peaks of their own heights and widths, broad shoulders and sharp summits, some broken by a notch, overlapping so one hides the next, and saddles that never sink far.
- **Folds:** each skyline has one fold row partway down, pushed toward you under the summits and back in the saddles, so each face is one plane, lit or in shade.
- **Snow** comes down from the crest where it's above the snow line, further down the gullies than the spurs, so it reads as fields and runnels rather than caps.
- **Foothill ridges:** one or two in the middle distance (about 1.2–1.5 km), each a single long ridge rising from the valley floor and falling back to it, its face in a few big planes with one fold, and a band of forest along its foot, its top edge ragged as treetops.
- **The valley floor** is flat, in one blue, with the white river winding across it.

The world is built in 48-metre chunks: a cross-section every four metres, a few big planes from high up the wall to far down the drop, jittered hard in all three directions so its faces break into rock, its character drifting as you go down: the wall from a snowy bank to a sheer cliff, the drop from a shelf to straight down, now and then an outcrop of rock rising between the route and the valley; rock where it's steep and snow where it isn't; the track over it, its edges ragged; the fence (posts, an orange tape and a white one), checkpoint flags on the wall side, further apart the further down (their banners flying, built fresh each frame: waves run out along them, bigger toward the free end, which droops and swings; the facets catch the light and lose it as they turn), kickers on trestles, big jagged boulders bedded along both sides, crags (clusters of leaning rock towers) down the shelves and up the banks, a few pines.

**Ruts** (`ruts.ts`) are drawn as bolts, not stripes: chains of straight strokes with breaks between them, each a thin dark wedge (the track's shade, nearly charcoal) that comes to a point at its uphill end, toward the eye, and is cut off blunt and slanted at its downhill end. A stroke kinks sideways where the surface bends (a rock step's edge, a roller's crest or trough) and every five metres or so between, so each lies on one plane of the road and takes that plane's light: the ruts are what describes the road's rise and fall. Two lines run down the road, swinging in toward the inside of a bend; where they come close they merge, and part again; now and then a third splits off one, runs its own way and rejoins it. They run on the road, the rollers and a landing deck, not on a ramp or over a gap. Near the eye they stream past as speed; further off fewer are drawn, and past about 60 m none, so the far road is one pale field. They're built each frame round the rider, not into the world.

**Your own track** is the same mark, fresh and a shade darker: strokes laid behind the rear tyre as you ride, a little kinked at each joint, wider where the rear was sliding, broken where you were in the air, the last 30 m of it kept. A crash keeps it until you're put back at the flag.

## Speed, drawn

Motion is drawn as vector shapes on a canvas over the world, never as blurred pixels:

- **Shards**: thin wedges (white, pale, charcoal, orange; a few big ones) streaming out from the point you're riding at, to the sides and below, more and longer the faster you go.
- **Smears**: each fence post near you is dragged back as a wedge from where it is to where it was a moment ago, against the eye.
- **Wake**: thin wedges trailing back from the helmet, the tail and the bars.
- **Debris**: faceted chunks of snow and rock thrown off the rear wheel as you ride, a burst on every landing, a spray on a crash, charcoal chips off the wall, each spun and smeared along its own motion.

## Title, menu, settings

It opens on its title, the sim's own rider riding the mountain behind a veil of the sky's blue. **RIDE** starts your run from the top (and the sound: browsers only start it from a tap). The menu (the two bars top left, or Esc) pauses the run: **CARRY ON**, **START AGAIN**, and the settings, kept in this browser:

- **Sound**: on or off, and its volume.
- **Camera**: how far back the eye rides. MID is the usual chase. CLOSE is tight behind and low: the rider and bike fill the lower half of the screen. FAR is high and well back, an overview of the road ahead with the rider small in it. (`cam=close|mid|far` sets it for one page, for pinned frames.)
- **Mountain**: another seed.

## Sound (`audio.ts`)

All made in the page (WebAudio, no files):
- **The engine:** a two-stroke's buzz, three detuned oscillators driven through a soft clipper and a low-pass that opens as it revs. The revs come from the pace through six gears, so it climbs, drops a gear and climbs again. In the air the back wheel's free and it screams; braking, it falls to a burble.
- **The wind:** noise through a band-pass that rises with the pace, louder as the square of it.
- **The ground:** a gravel crunch under the tyres, more in a slide, none in the air.
- **One-shots:** a landing's thump, a crash, a glance off rock, a checkpoint's two-note chime.

## Flags

`seed=` the mountain · `auto` the rider rides itself · (any flag below skips the title) · `fx=0` no speed layer · `fog=0` no distance fade (both for judging a frame) · `rider=sil|facets`, `whip=`, `world=0` the rider studies (above) · `t=` start that many seconds down the run (ridden there by the auto rider) · `still` hold the frame · `preview` no HUD.

## Tests

`node cells/lab/devtools/switchback-run.mjs [seconds] [seeds…]` rides the auto rider down seeds 1–3 for three minutes with no page (few crashes, kickers cleared, pace held), and checks that hands off, nothing steers for you: the bike leaves the line at the first real bend; that a whip thrown over a gap and let go lands, while one held out into the landing is a crash; and that a pull held over a kicker and let go in time lands a backflip, held on it loops out, and the throttle held open (through the jumps too) is faster than left alone. `node cells/lab/devtools/switchback-shot.mjs [query…]` renders pinned moments at a landscape and a phone size beside the target, in `devtools/out/switchback-board.png`.
