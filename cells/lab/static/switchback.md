# Switchback

A downhill motocross run down a mountain made as you ride it. The style target is a single flat-colour illustration (`switchback/target.jpg`): an orange-and-black rider on a pale cliff road, a charcoal rock wall, an orange fence along the drop, the road switchbacking down the cliff below, black pines, a deep ultramarine sky, blue ranges under snow, a white river far below, and speed drawn as orange, white and charcoal shards and flying chunks rather than blur.

![A run down the cliff road](switchback/v-ride.jpg)

## Riding

**Drag to aim the bike.** When your finger goes down, the bike's heading is noted; as you drag sideways, the bike turns by how far you've moved from there (a radian for a third of the screen's short side) and holds that heading when you stop. Drag further than that and it keeps turning, faster the further, for a hairpin. Lift and drag again for the next bend. Nothing steers for you: the bike goes where it points, and hands off it runs straight on. Drag down (or hold ↓ / S) to brake; ← → or A D turn it at a rate from a keyboard.

**The rear slides.** The way you're travelling follows the way the bike points only as fast as the tyres grip (a lateral pull of about 2.8 g, less braking, less off the road). Turn harder than that and the bike yaws past its line, sliding, scrubbing pace and throwing roost, until the travel comes round.

**Brake assist** (on unless `assist=0`) eases off for a turn ahead that your pace would run wide in. The engine pulls toward 165 km/h; the legs are fast, the hairpins are not.

**Hazards.** A face rising sharply in front is a wall: you glance off it and lose pace. Ground falling away faster than you'd drop (a ramp's lip, a crest, the edge of an embankment) puts you in the air; in the air you can turn a little. You come down on whatever's under you. A hard landing into the ground's slope, a fall onto rough ground well off the road, or a drop off the mountain is a crash, and you're back on the line where you left it.

The rider is yours from the start; `auto` (a debug and test flag, which the preview uses) hands it to the sim's own rider, which aims at a point on the line ahead and brakes for the turns it can't make. The eye rides close behind, high, over the shoulder on the drop side, looking down the road and over the edge.

## The mountain and the route (`course.ts`)

**The mountain** is one height field for the whole world: a steep face (rising about 1.1 m per metre), ridged and gullied, falling toward a valley floor 2.3 km below with a river winding along it. Across the valley the far side rises to the ranges, their crests ridged and sharp, snow above a ragged snow line.

**The route** is laid a metre at a time down that face as a mountain road is. Traverses run across the slope, each angled a little downhill and broken by short sharp kinks; some legs are short, some long. **Hairpins** turn the route back through the fall line, flatter and wider, so each leg runs back below the last, 30–40 m down. From a leg you see the ones below as ledges cut into the cliff, fenced.

- **Height:** the road follows the mountain a little below it, so it's cut in, never steeper than a bike can hold.
- **Width:** it never settles; there are pinches under 5 m and wide flats over 10.
- **Surface:** rough, stepping over rock.
- **Kickers,** on long legs and laid on a gentle grade: a 14 m ramp with its arrow, a 15 m gap through the ledge, a 36 m landing deck.
- **Whoops** between kickers.
- **The fence:** posts at uneven spacing along the drop side, each leaning its own way.
- **Pennants** before the hairpins and the kickers.

**The carved ground** is the mountain with the route cut into it:
- a bench where the road runs;
- a cut face rising above it on the uphill side;
- an embankment falling steeply below it on the downhill side, so between two legs there's a cliff from the one above down to the one below;
- a notch through the ledge under a kicker's gap.

## The bike and rider (`mesh.ts`)

The bike is a motocross bike in its real proportions:
- a 1.48 m wheelbase and a 21-inch front wheel on a fork raked at 27°;
- the rear tyre fat and knobbly, its knob blocks standing proud round the tread, with the rim and spokes inside;
- a swingarm and shock;
- tank and shrouds, a long seat, the rear fender kicked up, the pipe and silencer.

The suspension works: the frame sinks as you land and as the rough throws you up, the fork shortens, the swingarm swings up, and in the air it all extends.

The rider is sculpted in facets, not boxes:
- tapered limbs and a broad back;
- a faceted orange helmet with its chin bar, peak and goggles;
- crouched in the attack position, leaning into the turn, boots on the pegs, elbows up.

## The drawing (`mesh.ts`, `render.ts`)

The look is three values in big masses, as in the target: warm pale where the light falls, charcoal where it doesn't, the blues beyond, and very little in between.

**Faces.** Every triangle has one material and a tone. The renderer takes each face's normal from the screen, so every face is flat. Its light, nudged a little by its tone, picks one of its material's four colours, all sampled from the target.

**Shadows.** The sun is high, from up the mountain, so shadows fall toward the valley. A shadow map around the rider gives hard, dark cast shadows: the cliff across the road, the pines, the truss, the rider. Anything in shadow takes its material's deepest band, the target's charcoal. Filtered and thresholded, the edges stay sharp but run smooth.

**Distance** fades things toward the valley's blues in hard steps, not smoothly, and each material fades by its own amount: the snow and the far blues hardly at all.

**The ground is drawn in rings,** coarsest first, each over the one before:
1. the far ranges (384 m cells);
2. the valley and its river (96 m);
3. the mountainside (24 m);
4. the near ground (4 m), carved, jittered where it's off the road so it breaks into ledges and planes, its vertices near the road's edge laid along it.

On the near ground: slender black pines in jagged tiers, blocky crags of vertical-faced columns, and boulders by the road. Each far ring leaves out detail finer than its cells, so it reads as big shapes, not speckle. Far ground is snow above the snow line where it isn't steep, blue rock where it is, and dark forest low down.

## Speed, drawn

Motion is drawn as vector shapes, never as blurred pixels.

**Debris.** Faceted blocks of snow, track and rock are thrown off the rear wheel, fanning out to the outside of a slide. There's a burst on every landing, a spray on a crash, and chips off a wall. Each block is a 3D block lit like the world; it bounces once and stops. Each fast one has a wedge smeared back along its motion.

**Shards** are thin wedges in white, pale, charcoal and orange. They stream out from the point you're riding at, to the sides and below, more and longer the faster you go. The sky stays clean.

**Smears.** Each fence post and pennant near you is dragged back as a wedge from where it is to where it was a moment ago.

**Wake.** Thin wedges trail back from the helmet, the tail and the bars.

## Flags

- `seed=` the mountain
- `auto` the sim's own rider rides
- `t=` start that many seconds down the run, ridden there by the sim's rider
- `still` hold the frame
- `preview` no HUD
- `assist=0` no brake assist
- `shadows=0` no cast shadows

## Tests

- `node cells/lab/devtools/switchback-run.mjs [seconds] [seeds…]` rides the sim's rider down seeds 1–3 with no page. It checks for few crashes, hairpins made, kickers cleared and pace held. It also checks that, hands off, nothing steers for you: the bike leaves the road within seconds.
- `node cells/lab/devtools/switchback-shot.mjs [query…]` renders pinned moments at a landscape and a phone size beside the target, in `devtools/out/switchback-board.png`.
