# Rescue Race

A game designed by Lily, who wrote down how it goes on two pages (her words, the spelling tidied):

> You will have a boat, and there are little people in tiny boats. There will be different colours of the tiny boats
> with the people inside. You have to steer the boat and try to go near enough, and then when you are near enough you
> will see them coming on to your boat. Try to get as many as you can and reach the finish line.
>
> There will be other boats in the sea, and when you get to the finish line the winner will be the one that rescued the
> most people. There are five of the big boats (the players), and there will be a 1st place, a 2nd place, a 3rd place,
> a 4th and a 5th place.

That's the game, rule for rule. Everything below is how each of them is made to happen.

![The line-up: choose your boat, how good the others are, and go](rescue/v-lineup.jpg)
![Out on the sea: the first rescued aboard, the places along the top, how far to the finish down the side](rescue/v-racing.jpg)

## Playing

| | Touch | Keys |
|---|---|---|
| choose your boat | tap one of the five | |
| how good the others are | easy, medium or hard | |
| go | the big button | enter or space |
| steer | hold your finger on the sea where you want to go | the arrow keys (up to go, down to slow) |

- **Your boat:** one of five big rescue boats, each its own colour and a sea creature's name: Puffin, Dolphin, Turtle, Sunfish, Starfish. The other four are steered by the game.
- **Steering:** hold your finger on the sea, and your boat turns toward it and goes. Let go and it drifts on slowly. The camera looks up the course from behind your boat, so the finish is always up the screen.
- **Near enough:** each tiny boat near yours has a dashed ring round it. It turns your colour when you're close.
- **Coming across:** come within it (7.5 m of the line down your boat's middle) and the people jump across. They go one at a time, in an arc, onto your deck, and are counted as each one lands.
  - They fill the deck from the wheelhouse forward, then the side decks, the stern, and the wheelhouse roof.
  - A tiny boat claimed is no one else's.
  - Once you're across the line you can't rescue any more.
- **Waiting:** people waiting in a tiny boat turn to face the nearest big boat. When one comes close they wave both arms.

![Near enough: a boat swings in, the people in the tiny boat waving](rescue/v-waving.jpg)
![Coming across, one at a time, onto the deck](rescue/v-jump.jpg)
![A full deck](rescue/v-deck.jpg)

**On the screen:**
- **The places**, along the top, as they stand: the boats by how many they've rescued. Yours is ringed, and your own count is the big number.
- **The strip** down the right shows each boat between the start and the finish.
- **Arrows** at the edge of the screen point to the nearest tiny boats you can't see, each marked with how many people are waiting.

**The finish:**
- **The first boat across** the line starts the **last call**: a bell, and a countdown to get across.
  - On easy and medium the last call is always long enough for your boat to get home from wherever it is when the bell rings, if you head straight for the finish (the arrow points the way).
  - On hard it's 35 seconds, whatever.
- **The finish line** is a chequered band floating right across the water, with a lighthouse at each end.
- **In the harbour:** each boat that crosses goes on in, to its berth along the pier, and its crew cheers.

![The finish line](rescue/v-finish.jpg)
![1st to 5th: the boats at their berths, the places by most rescued](rescue/v-podium.jpg)

**At the end, 1st to 5th**, as Lily's rule has it:
- The boats across the line come first, by most rescued. A tie goes to whoever crossed first.
- A boat that didn't get across before the last call ran out comes after them, still by how many it rescued.
- Then: again (the same sea), a new sea, or back to choose a boat.

## The other boats

Each of the game's four boats:
- **Keeps to a lane of its own** across the channel, more or less, so they spread out rather than chase in a pack.
- **Goes for the tiny boat worth most to it:** its people, over how long it would take to get there and turn to face it. One behind it, or out of its lane, is worth less.
  - It passes over one another boat will plainly get to first.
  - It holds to what it's going for unless something much better turns up.
- **Steers clear of the land and the other boats.** It goes straight at its aim where the water's clear, and by a route found over a grid of the water where an island's in the way.
- **Heads for the finish** when:
  - there's nothing left in reach;
  - it's fallen too far behind the leader to make the line in the last call;
  - or the last call is running out.

How quick and how sharp they are is the level:
- **easy:** they go at four-fifths of your speed, take their time setting off, and often settle for second best.
- **medium:** a little quicker, a little sharper.
- **hard:** nearly your speed, and they don't dither.

On easy and medium they also **keep with you**: well ahead of you they ease off a little, and behind you they push a little, so there's always a race going on round you.

A child at the wheel, simulated (steering for the nearest waiting boat, a second or so to react), wins about three races in four on easy, comes 2nd or 3rd on medium, and mostly 4th or 5th on hard.

## The sea

Each sea comes from a seed (shown on the line-up, and kept in the address as `?seed=`). It's a channel of open water running north between two coasts:
- **The start:** a beach behind the start line, and the five boats lined up at it.
- **The course:** islands and rocks out in the channel, and about thirty-four tiny boats in eight colours, spread evenly along it and across it. Each has one, two or three people in it, every one with their own skin, hair and shirt, and now and then a straw sun hat.
- **The harbour:** past the finish line, with a pier, the berths and houses along the beach.

The land and the seabed are one heightfield: deep water, shallows by every shore, a beach, then grass rising inland. The water is drawn over it:
- turquoise and clear in the shallows (you can see the sand, and the sun netting it), blue out deep;
- foam rolling in along every shore;
- the long swells the boats bob and roll on.

![On a bigger screen](rescue/v-wide.jpg)

## How it's made

| | |
|---|---|
| `client/rescue/sea.ts` | the sea from a seed: the heightfield, islands, tiny boats and their people, what stands about, the waves |
| `client/rescue/race.ts` | the rules: steering, running aground, bumping, near enough, the jumps, the other boats, the last call, the places |
| `client/rescue/mesh.ts` | the things, as triangles: the boats, the people, palms, trees, houses, lighthouses, the pier |
| `client/rescue/render.ts` | the drawing (WebGL2): the land, the things (instanced: arms that swing, flags that flutter, palms that sway), the water, the marks on it |
| `client/rescue/fx.ts` | wakes, ripples, splashes, sparkles, shadows, the near-enough rings, the finish band |
| `client/rescue/sound.ts` | the sounds, all made in the page: the horn, the count of three, a hop for each person landing (higher for each), the bell, a tune for your place |
| `client/rescue/main.ts` | the page: the camera, your hand on the wheel, where everyone is each frame, what's said on the screen |

The sea and the rules are pure, and tested without a page (`node cells/lab/devtools/rescue.test.mjs`):
- every tiny boat is in deep water and can be reached;
- near enough claims, and nothing from further off;
- everyone lands and is counted, and no one is taken twice;
- whole races steered by the game end, with no boat aground and the places by Lily's rule;
- the same seed gives the same race.

The page is played by hand in a browser (`node cells/lab/devtools/rescue-smoke.mjs`): choose, go, a finger held, the arrow keys, the end. The pictures here are made by `node cells/lab/views.mjs rescue`.

**Addresses:**
- `?seed=` a sea;
- `?level=easy|medium|hard`;
- `?boat=0..4` yours;
- `?auto` every boat the game's;
- `?t=40` that far into the race;
- `?view=podium` straight to the end;
- `?still` time held;
- `?zoom=` nearer or further;
- `?near=n` tiny boat n and the boat nearest it, in view;
- `?preview` small and quiet: the game's own race, on and on.
