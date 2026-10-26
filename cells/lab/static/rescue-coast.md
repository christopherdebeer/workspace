# Lily’s Rescue Boats

Lily’s rescue race, built from the concept boards (“Lily’s Rescue Boats”, “Lily’s Rescue Rangers”, “Little Boats”) and Sol’s write-up. Her rules are the game:

> You will have a boat, and there are little people in tiny boats. There will be different colours of the tiny boats with the people inside. You have to steer the boat and try to go near enough, and then when you are near enough you will see them coming on to your boat. Try to get as many as you can and reach the finish line.
>
> There will be other boats in the sea, and when you get to the finish line the winner will be the one that rescued the most people. There are five of the big boats (the players), and there will be a 1st place, a 2nd place, a 3rd place, a 4th and a 5th place.

It shares no code with the original [Rescue Race](/rescue), which stays as it is: its own coast, rules, models and drawing.

![Choose your lifeboat](rescue-coast/v-lineup.jpg)
![Out on the coast](rescue-coast/v-racing.jpg)

## Playing

| | Touch | Keys |
|---|---|---|
| choose your boat | tap one of the five cards | |
| how good the others are | easy, medium or hard | |
| go | the yellow button | enter or space |
| the weather | sunny, calm, windy, stormy, foggy, night or sunset | |
| steer | the joystick in the bottom-right corner: left and right turn, up goes faster, down slows and backs | the arrow keys, or WASD |
| stop | let go of the stick | let go of the keys |

- **The joystick stays put** in the bottom-right corner (or bottom-left: the switch on the line-up, or `?hand=left`), so your thumb never covers the sea ahead. Push it to one side alone and the boat turns while going steadily on. Let go and the knob springs home and the boat eases to a stop.
- **Your boat:** one of five lifeboats, all in the lifeboat look (navy hull, red below the waterline, RNLI along the bow, a tall black mast), each wheelhouse in its own colour: Puffin orange, Seal red, Gannet blue, Otter yellow, Dolphin green. That's how you tell them apart out on the water, and it's the colour of your chip in the places.
- **The camera** rides high behind your boat, turning with it but smoothly. It rises over a cliff rather than look through it.

## Coming alongside

Lily’s “near enough”, done the way a lifeboat does it:
- **Come alongside** a little boat, with it close by your side.
- **Ease right off.** Let go of the stick and the boat slows to a stop.
- **The line goes over.** Your crew throws a line, and the little boat is pulled in against your hull.
- **They climb aboard** one at a time: across to the hull, up its side, over the gunwale, to a place on deck. Each is counted as they land.
- **Drive off** before they're all across and the rest let go, to wait for the next lifeboat.

How slow is slow enough depends on the level: under half of top speed on easy, under a third on hard. On easy and medium the boat eases off by itself as you come up to a little boat, so a quick tap of the stick toward it is enough. A ring in your colour round each little boat near you says “come alongside here”. If you're too fast, the screen says so.

![The line goes over](rescue-coast/v-line.jpg)
![Climbing aboard](rescue-coast/v-climb.jpg)
![A full deck](rescue-coast/v-deck.jpg)

**On the screen:**
- **the places** along the top, yours ringed, and your count;
- **the strip** down the right, each boat between the start and the harbour;
- **arrows** at the edge to the nearest little boats out of sight, each with how many are waiting;
- **a lifebuoy and a bar** while people are coming aboard.

## The finish

- **The finish** is the harbour mouth: through the gap between the two lighthouses, under the FINISH banner.
- **The first boat through** starts the last call. On easy and medium it's always long enough for you to get home from where you are, if you head straight for it.
- **In the harbour**, each boat goes on to the quay.
- **At the end, 1st to 5th** by Lily's rule: the boats home first, by most rescued (a tie goes to whoever was home first), then the rest by most rescued.

![The harbour mouth](rescue-coast/v-finish.jpg)
![1st to 5th](rescue-coast/v-podium.jpg)

## The coast

Each coast comes from a seed (on the line-up, and `?seed=`). It's a channel of open sea running north between granite cliffs:
- **The start:** a wide bay by the lifeboat station and its slipway.
- **The course:**
  - headlands and coves along both shores;
  - grassy islets, sea stacks and reefs out in the channel, one with a lighthouse;
  - red buoys to the west and green to the east, in pairs up the course;
  - about twenty-six little boats in six colours, spread along it and across it: rowing boats with one to three people, sailing dinghies with two, kayaks with one.
- **The finish:** the narrow harbour mouth, a lighthouse either side. Beyond it, the harbour with its quay and a town of cottages on the hill.

One field says where the land is: the distance to the nearest shore, positive over water and negative on land. Everything is made from it, so nothing disagrees:
- **the ground:** stepped granite cliffs, sandy coves, quays, the town's hill, the seabed;
- **the boulders:** heaped along every shore and up the cliff steps, none reaching further into the water than a hull is allowed to go;
- **where a boat can go:** the hull keeps 2.6 m from the shore, so it can't sail into a rock;
- **the routes** the game's boats find;
- **the swell:** a little smaller near the shore;
- **the surf:** breaking white along every shore, and spray thrown up where a crest meets the rocks.

![On a bigger screen](rescue-coast/v-wide.jpg)
![The lifeboat](rescue-coast/v-study.jpg)

## The weather

Picked on the line-up (`?weather=`), from the boards' weather panel: Calm, Windy, Foggy, Choppy, Night, plus the title card's sunset. Each one sets:
- **the sea:**
  - how high the waves are and how steep (the boats ride the same waves, so a big sea pitches and rolls them and throws spray off the bow);
  - how much foam: whitecaps where the crests fold, streaks along the wind, surf on the rocks;
- **the light:** the sun's way, colour and strength (the moon's, at night), and the sky's fill in the shade;
- **the sky:** its colours, how much cloud and how dark beneath, stars on a clear night;
- **the air:** fog, how near it starts and how thick it gets.

| | the sea | the air | and |
|---|---|---|---|
| ☀️ sunny | choppy, whitecaps | clear, cumulus | gulls |
| 🌤️ calm | a gentle swell | clear | gulls |
| 💨 windy | bigger, steeper, foam streaks, spray flying | broken cloud racing | gulls |
| ⛈️ stormy | high and grey, the next boat lost behind a wave | a lid of dark cloud, rain | lightning and thunder; the beams turning |
| 🌫️ foggy | moderate | thick fog, the coast lost in it | lighthouse beams and your searchlight cut through; a foghorn |
| 🌙 night | moderate | stars, the moon on the water | windows lit, beams turning, your searchlight ahead |
| 🌅 sunset | moderate | low gold sun ahead | the sea and cliffs warm |

The weather doesn't change the rules: every boat rides the same sea.

![Windy](rescue-coast/v-weather-windy.jpg)
![Stormy](rescue-coast/v-weather-stormy.jpg)
![Foggy](rescue-coast/v-weather-foggy.jpg)
![Night](rescue-coast/v-weather-night.jpg)
![Sunset](rescue-coast/v-weather-sunset.jpg)
![Calm](rescue-coast/v-weather-calm.jpg)
![A storm, on a bigger screen](rescue-coast/v-storm-wide.jpg)
![Night, on a bigger screen](rescue-coast/v-night-wide.jpg)

## The other boats

Each of the four is steered by the game:
- **Choosing:** it goes for the little boat worth most to it: its people, over the time to get there and take them aboard. It prefers its own side of the channel, and passes over one another of the game's boats is plainly nearer.
- **Finding the way:** it goes straight where the water's clear. Where an islet or a headland is in the way, it follows a route found over a 4 m grid of open water.
- **Coming alongside:** it slows as it nears, passes with the little boat a beam's width off its side, and stops while the people come aboard.
- **Heading home:** it makes for the harbour when nothing's worth going for, or when the last call won't wait.

The level sets how quick they are:
- **easy:** four-fifths of your speed;
- **medium:** nine-tenths;
- **hard:** nearly yours.

On easy and medium they ease off when well ahead of you and push on when behind.

## How it's drawn

Its own WebGL2 renderer: the lab ships one bundle with no packages, so Three.js wasn't an option here. Lit like the boards:
- **Light:** a warm sun with shadows, and a cool sky filling the shade.
- **Materials:** glossy painted toys, glass and metal, skin and cloth, granite (grain, flecks, lichen on top, darker and glossy where the sea wets it), lamps, gorse.
- **The sky:** cumulus over the horizon.
- **Distance:** hazed toward the horizon.
- **The finish:** one filmic tone curve over everything.

The sea:
- **The swell:** eight Gerstner waves, from a 24 m swell down to 1.7 m chop, the same sums on the CPU (the boats ride them) and in GLSL; the weather scales their height and steepness. Faces turned to the light are brighter, backs and troughs darker, so the relief reads from above.
- **Its colour:** deep cobalt, lighter where the light comes through a wave, the sky reflected in it, sun glitter.
- **Foam:**
  - lace where the crests fold;
  - wind streaks drawn out along the waves;
  - surf breaking along every shore;
  - wakes, white straight behind the stern and two long arms;
  - spray off the bow when going fast (most when it slams into a wave), and on the rocks.

**Cost on a phone** (counted in the browser, a race in full swing): about 125 draw calls and 800k triangles a frame. That's within Sol's budget for draw calls, but the triangles want watching: the boulders and the ground are most of them.
- **Already in place:**
  - distant ground and boulders are drawn coarser;
  - people and gulls are left out of the shadows;
  - the screen's resolution follows the frame time, between 0.8 and 1.75 × the CSS pixel.
- **Not yet done:** it hasn't been timed on a phone.

| | |
|---|---|
| `client/rescue-coast/coast.ts` | the coast from a seed: the shore field, ground, islets, boulders, lighthouses, town, station, buoys, the little boats and their people |
| `client/rescue-coast/race.ts` | the rules: steering, the shore and other hulls, coming alongside, the line and the climb, the game's boats (flow fields over the water), the last call, the places |
| `client/rescue-coast/waves.ts` | the swell (CPU and GLSL) |
| `client/rescue-coast/shapes.ts`, `models.ts` | making meshes; the lifeboat, people, little boats, buoys, boulders, lighthouses, cottages, station, banner, gulls |
| `client/rescue-coast/world.ts` | the coast made drawable, in pieces along it |
| `client/rescue-coast/render.ts`, `fx.ts` | the drawing; wakes, spray, the line, the rings |
| `client/rescue-coast/joystick.ts`, `sound.ts`, `main.ts` | the stick; the sounds; the page |

**Tests:**
- The coast and the rules, without a page: `node cells/lab/devtools/rescue-coast.test.mjs`.
  - The little boats are in open water, apart, and every one can be reached.
  - There's a way through the harbour mouth to every berth.
  - No boulder reaches past a hull's clearance.
  - Alongside and slow claims; fast or far doesn't; everyone climbs aboard and is counted once; drive off and the rest wait.
  - Whole races steered by the game finish with no hull inside the shore and the places by Lily's rule.
  - The same seed gives the same race.
- In a browser, by hand: `node cells/lab/devtools/rescue-coast-smoke.mjs` (the line-up, the stick up, right, let go, the keys, the left-handed corner, the end).
- The pictures: `node cells/lab/views.mjs rescue-coast`.

**Addresses:**
- `?seed=` a coast;
- `?level=easy|medium|hard`;
- `?boat=0..4` yours;
- `?auto` every boat the game's;
- `?t=40` that far into the race;
- `?still` time held;
- `?view=podium` straight to the end;
- `?near=n` (or `near=any`) a little boat and the lifeboat coming for it;
- `?study` a close look at your lifeboat;
- `?zoom=`;
- `?hand=left`;
- `?weather=sunny|calm|windy|stormy|foggy|night|sunset`;
- `?preview` small and quiet.

**Not here yet**, though the boards have them:
- the world map and missions;
- stars, shells and stickers;
- towing;
- the other kinds of boat (inshore, hovercraft, RIB).

They're beyond Lily's two pages, and they'd come after the race itself looks and plays right.
