# Switchback

A downhill motocross run down a mountain made as you ride it. The style target is a single flat-colour illustration (`switchback/target.jpg`): an orange-and-black rider on a pale cliff road, a charcoal rock wall, an orange fence along the drop, black pines, a deep ultramarine sky, blue snow-banded ranges, a white river far below, and speed drawn as orange, white and charcoal shards rather than blur.

![A run down the cliff road](switchback/v-ride.jpg)

## Riding

Drag left or right to steer: the drag's distance from where it began sets how hard you turn. Nothing steers for you: the bike goes where it points, and with no input it runs straight on, so every bend has to be ridden. Turn hard at speed and the rear steps out: the way you're travelling follows the way the bike points only as far as the tyres grip (less at speed, less braking), so the bike yaws past its line and slides, scrubbing pace and throwing roost, until it lines up again. Drag down (or hold ↓ / S) to brake; ← → or A D steer from a keyboard. The engine and the hill keep you going. Kickers (a ramp painted with an orange arrow, a gap over a ravine, a landing deck, both on black trestles) launch you; whoops (a run of rollers) throw you at speed; any crest that falls away faster than you would drop puts you in the air. In the air you can turn a little. The wall on the left glances you off it and costs pace; over the fence on the right is the drop, and that run ends there: you're back on the line where you fell.

The rider is yours from the start; `auto` (a debug and test flag; the preview uses it) hands the steering to the sim's own rider. The eye rides over your right shoulder, the drop side, so the wall rises beyond the rider and the valley opens under you.

## The course (`course.ts`)

The line is laid a metre at a time from the seed, as an off-road route picks its way down rock rather than a road's arcs: straight legs broken by short, sharp kinks (seven to fourteen metres each, some hard; always turning back toward the fall line once the route has wandered, so it keeps going down the valley), a width that never settles (a new one every few metres, joined straight; now and then a pinch between rocks under 5 m, or a wide flat over 10), a fall that steepens and eases, and a rough surface that steps up and down over rock, a new height every few metres joined straight. On the legs, features: a kicker every so often (a 14 m ramp, an 18 m gap, a 36 m deck), whoops between. The mountain stands on the left (a rock wall going up) and falls away on the right, as a cliff road does. Everything asks the course the same things: where the line is at distance `s`, the surface height at (s, u) with u across it, and whether there's surface at all (a gap has none).

## The rider (`sim.ts`)

Arcade physics in the world: the bike has a heading (where it points) and a travel (where it's going); steering turns the heading, quicker at low speed; the travel follows through the grip; where you are on the course (how far down, how far across) is read back from your position. The fall of the hill and the engine drive you, the air holds you back, the loose shoulder slows you. The lean is what the turn asks (pace times how fast the heading swings, against gravity). The engine pulls hard toward 165 km/h; a run averages well over 100. Off a lip you fly; off a crest too, where the ground a tenth of a second on falls away below the arc you'd fly by more than the suspension takes up (so the rough rattles you without throwing you every step). You fly a ballistic arc; you land along whatever's under you, a hard landing squashing the suspension and costing pace; landing short into a deck's face, or falling far below the road, is a crash.

## The bike and rider

A motocross bike in its real proportions: a 1.48 m wheelbase, a 21-inch front wheel on a fork raked at 27°, knobbly tyres drawn as open rings with the rim inside, a swingarm and shock behind, tank and radiator shrouds, a long flat seat, the rear fender kicked up, the pipe and silencer. The suspension works: the frame sinks on its springs as you land and as the rough throws you up, the fork shortening between axle and clamps and the swingarm swinging up, and in the air it extends. The rider stands in the attack position: boots on the pegs, knees bent (more as the bike sinks), hips back, chest over the tank, elbows up, head over the bars; orange jersey with black panels, black pants with orange knee guards, white boots, an orange helmet with its chin bar, peak and goggles.

## The drawing (`mesh.ts`, `render.ts`)

Every triangle has one material and one tone. The renderer takes each face's normal from the screen (so every face is flat), and its light, nudged by its tone, picks one of its material's four colours, all taken from the target: pale snow, packed track, charcoal rock, orange, black, white, the ranges' blues. So planes lit alike still break into different greys, as a painter sets them. Distance doesn't fade smoothly: it steps, four hard bands toward the valley's blues, each face keeping its band so the far slopes stay faceted. The ranges and the valley floor (with its river) are drawn round the eye, far off. The rider's shadow is the bike itself flattened along the sun onto the ground.

The world is built in 48-metre chunks: a cross-section every four metres, a few big planes from high up the wall to far down the drop, jittered hard in all three directions so its faces break into rock, its character drifting as you go down: the wall from a snowy bank to a sheer cliff, the drop from a shelf to straight down, now and then an outcrop of rock rising between the route and the valley; rock where it's steep and snow where it isn't; the track over it, its edges ragged, its ruts straight-cut; the fence (posts, an orange tape and a white one), flags on the wall side, kickers on trestles, big jagged boulders bedded along both sides, crags (clusters of leaning rock towers) down the shelves and up the banks, a few pines.

## Speed, drawn

Motion is drawn as vector shapes on a canvas over the world, never as blurred pixels:

- **Shards**: thin wedges (white, pale, charcoal, orange; a few big ones) streaming out from the point you're riding at, to the sides and below, more and longer the faster you go.
- **Smears**: each fence post and flag near you is dragged back as a wedge from where it is to where it was a moment ago, against the eye.
- **Wake**: thin wedges trailing back from the helmet, the tail and the bars.
- **Debris**: faceted chunks of snow and rock thrown off the rear wheel as you ride, a burst on every landing, a spray on a crash, charcoal chips off the wall, each spun and smeared along its own motion.

## Flags

`seed=` the mountain · `auto` the rider rides itself · `t=` start that many seconds down the run (ridden there by the auto rider) · `still` hold the frame · `preview` no HUD.

## Tests

`node cells/lab/devtools/switchback-run.mjs [seconds] [seeds…]` rides the auto rider down seeds 1–3 for three minutes with no page (few crashes, kickers cleared, pace held), and checks that hands off, nothing steers for you: the bike leaves the line at the first real bend. `node cells/lab/devtools/switchback-shot.mjs [query…]` renders pinned moments at a landscape and a phone size beside the target, in `devtools/out/switchback-board.png`.
