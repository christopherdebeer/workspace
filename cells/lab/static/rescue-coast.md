# Lily’s Rescue Boats

*All boats home.* Lily’s lifeboat game, built from the concept boards (“Lily’s Rescue Boats”, “Lily’s Rescue Rangers”, “Little Boats”) and Sol’s write-up. Two ways to play, each on its own coast:
- **the Rescue Service** (Play): three crews, each from its own harbour along the coast (yours at the top, two neighbours further down) and each in its own kind of boat, out into the open sea answering the calls as they come in through the day, each in its own stretch, helping each other until everyone is home safe; the weather changes as the day goes on;
- **the Rally**: Lily’s race, as she wrote it, up a channel between the cliffs to the harbour; a training day where racing is fair.

Her rules are the Rally, and everything the Service is built from:

> You will have a boat, and there are little people in tiny boats. There will be different colours of the tiny boats with the people inside. You have to steer the boat and try to go near enough, and then when you are near enough you will see them coming on to your boat. Try to get as many as you can and reach the finish line.
>
> There will be other boats in the sea, and when you get to the finish line the winner will be the one that rescued the most people. There are five of the big boats (the players), and there will be a 1st place, a 2nd place, a 3rd place, a 4th and a 5th place.

Why two: arrive fast, help slowly. A race for pickups rewards rushing past people; the Service rewards slowing down, coming close and holding steady while they climb aboard, so the game is about what the boards show. The race stays whole as the Rally, and Lily's 1st to 5th is still the Service's last word, as the crews' honours.

It shares no code with the original [Rescue Race](/rescue), which stays as it is: its own coast, rules, models and drawing.

![The title](rescue-coast/v-title.jpg)
![Moored in the harbour](rescue-coast/v-start.jpg)
![The open sea](rescue-coast/v-open-sea.jpg)

## The menu

The title is the boards' title card: your lifeboat charging along under the lighthouse's headland in the weather you've chosen (round a smooth loop worked out for each coast: out along the rocks, a wide slow turn, back further out, a wide turn home, leaning into the turns; the camera waits a little way ahead round the loop and eases after it, so the picture never jumps or starts over), the logo (*All boats home* under it), and the menu:
- **Play:** straight out on a call, in the Rescue Service.
- **Rally:** Lily's race.
- **Boats:** choose your crew and your boat, in a small drawer at the bottom. Behind it the camera goes to your harbour, where the three kinds of boat lie moored side by side along the pier in your crew's colour, and eases along the pier to the one chosen. Choose by its name in the drawer, the arrows either side of its card, or a tap on the boat itself; tap a crew and they all change colour. (On a wide screen the drawer is down the right-hand side.)
  - **Your crew:** Lily's five, each in its own colour, with the names she gave them: Puffin orange, Dolphin blue, Turtle green, Sunfish yellow, Starfish purple. The card shows your best with that crew.
  - **Your boat** (for the Rescue Service; the Rally's are all lifeboats), three kinds with Speed and Steady bars, as on the boards' boat-choice card (no capacity: there's room aboard for everyone you find):
    - **the lifeboat** (●●● speed, ●●● steady): the all-weather lifeboat, good at everything. A navy hull with tyre fenders along its sides, a tall rounded wheelhouse in your colour with framed windows and an upper steering position, a black mast.
    - **the inshore boat** (●●●● speed, ●● steady): a rigid inflatable, quickest and nimblest but tossed about in a sea, so holding steady alongside out in the open is harder. Its fat tube in your colour with RNLI along it, a console amidships, an A-frame aft with its beacon, twin outboards; the people you rescue sit on the tubes when the deck's full.
    - **the harbour launch** (●● speed, ●●●● steady): slow to get anywhere and slow to turn, but broad and steady, so people come across quickly even in rough water. Its wheelhouse forward in your colour, a fat black fender all round, an open working deck aft with a davit.

    The two neighbours' crews take the other two kinds, so each day there's one of each on the water.
- **Weather:** seven tiles; the title behind changes as you pick. In the Service it's the weather the day starts in; the forecast on the title (☀️ → 🌅 → 🌙) says where it goes from there.
- **Settings:**
  - how good the other crews are (easy, medium, hard);
  - where you steer from: anywhere you touch, or a stick in the bottom-left or bottom-right corner (kept in this browser);
  - sound;
  - a new coast;
  - these notes.

![Choose your boat](rescue-coast/v-boats.jpg)
![Choose your boat, on a bigger screen](rescue-coast/v-boats-wide.jpg)
![The weather](rescue-coast/v-weather.jpg)
![Settings](rescue-coast/v-settings.jpg)
![The title, on a bigger screen](rescue-coast/v-title-wide.jpg)

## Playing

| | Touch | Keys |
|---|---|---|
| steer | put your finger anywhere on the sea and drag: ahead to go faster, to one side to turn, back to slow and back off (or the stick in a corner, if you've chosen it in Settings) | the arrow keys, or WASD |
| stop | let go | let go of the keys |
| sound the horn | the horn, bottom-right (your crew wave) | |
| pause | the button top-left | escape |

- **Wherever you touch is the stick.** There's no stick drawn: put your finger down anywhere on the sea and that spot is the middle of the stick for as long as your finger stays down. Drag ahead and the boat goes, to one side and it turns while going steadily on, back and it slows and backs off; let go and it eases to a stop. While your finger is down a faint ring shows where you put it, and a dot where you've dragged to. Until you've steered, the ring shows low down the screen with its dot drifting up, to say how. (With the game steering every boat, `?auto`, a touch takes yours back.)
- **Or a stick in a corner**, if you'd rather (Settings, or `?hand=right` / `?hand=left`): it stays put, so your thumb never covers the sea ahead; the same stick, with its own knob.
- **The camera** rides low and close behind your boat, as on the boards' gameplay panel: your lifeboat a third of the way across, the coast ahead on the horizon. It turns with the boat but smoothly, and rises over a cliff rather than look through it. Slowing for someone waiting nearby, it eases down and round a little toward them. When a little boat is alongside it cuts in low beside your hull to watch them climb aboard (the boards' close rescue), and eases back out when they're all across.

![Touch anywhere and drag](rescue-coast/v-steer.jpg)
![Wherever you touch is the stick](rescue-coast/v-steer-drag.jpg)

**On the screen**, laid out as on the boards' in-game view:
- **top-left:**
  - pause;
  - in the Service, everyone rescued so far, of everyone whose call has come in (*12/17*), and under it your own crew's count in your colour; in the Rally, how many you've rescued and your place;
  - the clock (in the Service with the weather as it is now; in the Rally's last call, the time left, in red).
- **top-right:**
  - a round map turned to your heading, N going round its rim, showing the little boats still waiting (in their colours; in the Service, one another crew is going for has their colour round it), the other lifeboats and the harbour mouth;
  - under it, the three crews' counts (the Rally: the five places).
- **a speech bubble:** what to do next ("Put your finger on the sea and drag up to go!", "Slow down — let go!", "Nice and steady — climbing aboard!", "Listening for the next call…", "Everyone's aboard! Bring them home to the harbour", "Home! Stepping ashore…"; the Rally's "Last call! Head for the harbour!"), the coastguard on the radio ("📻 Coastguard: A paddleboarder, in trouble just outside the harbour!", "📻 Coastguard: Fog rolling in — watch for the lighthouses"), and the other crews ("Turtle: All yours, Puffin — we'll find someone else!").
- **a lifebuoy and a bar** that fills while people come aboard.
- **arrows** at the edge to the nearest little boats out of sight (in the Service, those in your stretch no other crew is going for, and any elsewhere that have been waiting a while for help), and to the harbour when it's time (in the Service: to your own harbour, once everyone's aboard).
- **the horn**, bottom-right (and the stick, if you've chosen one).

## Coming alongside

Lily’s “near enough”, done the way a lifeboat does it:
- **Come alongside** a little boat, with it close by your side.
- **Ease right off.** Let go and the boat slows to a stop.
- **The line goes over.** Your crew throws a line, and the little boat is pulled in against your hull.
- **They climb aboard** one at a time, in the boards' four moments:
  - **come alongside:** they stand at the edge of their little boat and reach up, while a crew member leans right over the rail and reaches down;
  - **take the hand:** hands held, they're lifted a little;
  - **climb aboard:** feet on the fender, up the side, over the rail;
  - **safe on deck:** down beside the crew member, then to a place on deck.

  Each is counted as they land.
- **Hold steady** (the Service). How fast they climb across depends on how steady you are for them, and the sea decides most of that:
  - **the open sea** is rougher than water in the lee of a headland or an islet (sheltered water looks it: calmer, greener, fewer whitecaps);
  - **your own hull** shelters them: lie side-on to the swell with the little boat on the side the waves run toward, and the water alongside goes calm (you can see the smoothed patch);
  - **moving or turning** shakes it;
  - **your boat:** the harbour launch feels less than half the sea's roughness alongside, the inshore boat half as much again as the lifeboat.

  On the weather side out in the open they still come across, just more slowly; nobody ever falls in. The bar fills as fast as you hold steady and goes amber when it's rough, and the bubble says what would help ("Bumpy here! Turn side-on to the waves to shelter them"). A lifeboat stopped out on the water drifts a little the way the swell runs. The other crews come alongside on the sheltered side when the swell gives them a choice. (The Rally keeps Lily's rule: once alongside and slow, the climb takes the same time anywhere.)
- **Drive off** before they're all across and the rest let go, to wait for the next lifeboat.

How slow is slow enough depends on the level: under half of top speed on easy, under a third on hard. On easy and medium the boat eases off by itself as you come up to a little boat, so a quick drag toward it is enough. A ring in your colour round each little boat near you says “come alongside here”. If you're too fast, the screen says so.

![The line goes over](rescue-coast/v-line.jpg)
![Climbing aboard](rescue-coast/v-climb.jpg)
![A paddleboarder](rescue-coast/v-paddle.jpg)
![Rough water](rescue-coast/v-rough.jpg)

## The Rescue Service

A day on the lifeboats, three crews along one coast, out from their harbours and back.
- **Your harbour.** Your boat lies moored at the end of a stone pier just inside the harbour mouth, lamps along the pier and bunting strung between them, crates, barrels and lobster pots at its root, the station and its slipway beside it, the town of cottages on the hill behind. All round the basin timber jetties run out from the quay on their piles (some with a T across the end), a lamp at each end and someone out on each; boats are moored along both sides of them, bows out, and a few more lie alongside the quay wall: rowing boats, sailing dinghies, kayaks, little blue-and-white fishing boats with their wheelhouses, yachts at the ends. More swing at red mooring buoys out in the basin, all heading the same way into the swell. They all bob on the water; at dusk the lamps come on. None of it is in the way out (the lane in from the mouth and the pier are kept clear), and none of it can be driven through: hit a jetty or a moored boat and you bump off it. While the count goes down the camera looks over the pier, where a few from the town have come down to see you off, at your boat and the hill; at Go it swings round behind your boat.
- **The neighbours.** Two more stations down the coast, each with its own crew and its own little harbour (named for the coast: North Head, South Sound): a basin dug back into the cliffs, two stone breakwaters round the water in front of it with the mouth between their ends facing out to sea, a little lighthouse on the end of one; the station at the head of the basin with its slipway, lamps and bunting on the quay by the berth, a short jetty and a few boats moored along the quays, a handful of cottages on the slope behind, a few from the town on the quay. Your crew is one of Lily's five in the boat you chose; the neighbours are two of the other crews, in the other two kinds of boat.
- **Out to sea.** Out through the mouth between its two little lighthouses, down the approach past the harbour's own headland with the big lighthouse on it, and then the far shore falls away: the open sea, the coast running on down one side with its cliffs and coves, islets and reefs scattered out over the water. Well off the coast the swell is bigger than anywhere along it (it's had room to build), so holding steady alongside out there is harder. The search area ends a little inside the chart's edge; the coastguard calls you back if you go too far.
- **Each station has its stretch.** Yours is the approach and the coast and sea just south of the headland; the neighbours' are further down, each with the sea off it. Each stretch has five calls through the day; one in each is waiting as the crews set out, near its harbour; the rest come in on the radio (a chirp, the coastguard saying who and where, a new dot on the map), nearest first:
  - near the harbour: a kayaker, a paddleboarder, a dinghy;
  - along the coast: rowing boats, sailing dinghies, now and then a fishing boat with engine trouble;
  - out at sea, the bigger one: a yacht that's lost its mast, three to five aboard; or a fishing boat, a dinghy, a rowing boat with two or three.

  A little boat isn't there until its call comes in (and if a lifeboat happens to be right beside the spot, the call waits until it's moved on, so no one appears out of nowhere).
- **Room for everyone you find.** There's no limit to how many your boat takes: the deck fills from aft, then forward, the side decks, then the roof (the inshore boat's tubes). When everyone's been found, take them home: in through your harbour's mouth, slow down, and they step ashore one by one onto the pier, counted safe ashore, to join the crowd waving there. (Passing through your harbour with people aboard any time, they step ashore then.) Each crew lands its people at its own harbour.
- **The crews work together.** The neighbours look after their own stretches and leave yours to you; but a call anywhere that's been waiting more than about half a minute with nobody going for it, a crew with nothing of its own to do goes to help, so nobody is left waiting long (and you can help in theirs whenever you like). Each crew going for someone says so (it's ringed in their colour on your map) and the others leave them to it. If you're plainly nearer, they leave them to you, and say so on the radio. Nobody races anybody for a pickup. A crew with no one to go for and more calls to come waits where it is for the next one; when everyone's been found, each goes home to its own harbour.
- **The weather changes as the day goes on.** Each coast has its day, starting from the weather you chose: fair weather might bring a squall through (the wind getting up, a storm, clearing again), or a fog bank, or freshen into a gale, or go on into the evening and the night; a storm clears; fog lifts, or the night comes down on it; a night ends in a dawn. Each change comes on over half a minute, the coastguard warning of it a few seconds before. The sea changes with it (the boats ride it, and holding steady alongside is harder in a gale); so do the light, the sky, the fog, the rain and the sounds; the lighthouses' beams and your searchlight come on as it gets dark.
- **Over when every call's been answered**, everyone's safe ashore, and every crew is in at its own harbour. Home before the others, you watch a crew at work (or wait in the harbour, ⏩, to skip to the end). A day takes three to four and a half minutes.
- **At the end:** *Everyone home!*, everyone you brought in on the pier and your boat at its end; then the three crews' honours, 1st to 3rd by Lily's rule, as the postscript. Stars: three when everyone's home and your crew did its share, two when everyone's home.

![Home harbour](rescue-coast/v-home.jpg)
![The neighbours: North Head](rescue-coast/v-north.jpg)
![The neighbours: South Sound](rescue-coast/v-south.jpg)
![Setting out](rescue-coast/v-harbour.jpg)
![Along the coast](rescue-coast/v-racing.jpg)
![A yacht that's lost its mast](rescue-coast/v-yacht.jpg)
![A full deck](rescue-coast/v-deck.jpg)
![Safe ashore](rescue-coast/v-landing.jpg)
![The neighbours home](rescue-coast/v-their-landing.jpg)
![Everyone home](rescue-coast/v-podium.jpg)

## The Rally

Lily's race, as she wrote it, on its own coast: the same boats, the same coming alongside. The crews race up a channel between the cliffs for the little boats and the places, to the harbour at the top. The weather stays as you chose it.

![Lily's race](rescue-coast/v-rally.jpg)

### The finish

- **The finish** is the harbour mouth: through the gap between the two lighthouses, under the FINISH banner (only the Rally has the banner; the Service comes home between the lighthouses).
- **The first boat through** starts the last call. On easy and medium it's always long enough for you to get home from where you are, if you head straight for it.
- **Crossing it**, a FINISH banner springs up on the screen, and a picture is taken of the moment.
- **In the harbour**, each boat goes on to the quay.
- **At the end, 1st to 5th** by Lily's rule: the boats home first, by most rescued (a tie goes to whoever was home first), then the rest by most rescued.
- **The rewards**, as on the boards' finish panel (the Service has the same polaroid and best, kept apart from the Rally's):
  - stars: three for 1st, two for 2nd or 3rd, one for getting home;
  - the picture from the finish, as a polaroid, with how many you rescued;
  - your best with that boat (kept in this browser).
- **Then:** again, a new coast, or the menu.

![The finish line](rescue-coast/v-rally-finish.jpg)
![1st to 5th](rescue-coast/v-rally-podium.jpg)

## The coast

Each coast comes from a seed (on the line-up, and `?seed=`), in two kinds that share its name, its harbour town and its granite.

**The Service's:**
- **Your harbour:** a little one at the top of the chart, its stone pier just inside the mouth, the station by it, quays round it, the town on the hill. Seven jetties out from the quay all round the basin, each 26–36 m, half of them with a T-head; boats laid along them and the quay wall one at a time, each kept off everything laid before it (hulls and decks as rectangles, a little room round each), none in the lane in from the mouth or within 20 m of the pier's moorings; a dozen more at buoys out in the basin, well off the jetties and the pier. Each jetty's piles and each moored hull is a row of circles the boats bump off, and the routes go round them.
- **The neighbours' harbours:** two down the west coast (about 480 and 780 m south of yours), where no headland or cove is let form: a basin 68 × 56 m dug back into the land, two breakwaters 6 m wide out from the shore round the water in front of it, their ends about 26 m apart for the mouth, which faces east, out to sea and away from the swell. The ground round them is quay, the water dredged and calm (sheltered by the breakwaters and calmed like your harbour); no reef or skerry inside or off the mouth. Each crew's berth is in the basin's north-east, bows to the mouth; the way in from the mouth to it, and the slipway, are kept clear of moored boats.
- **The approach:** south from the mouth between the cliffs and the harbour's own headland (the big lighthouse on it), with red and green buoys in pairs.
- **The open sea:** past the headland the far shore falls away east, off the chart; the coast runs on down the west side, headland and cove, and far down turns away west. Islets, sea stacks and reefs are scattered out over the water, a lighthouse on the biggest.
- **The calls:** fifteen little boats, five in each station's stretch (two near its harbour, two along its coast, one out at sea), each with the time its call comes in (above); none in a harbour or within 45 m of a mouth, none within 30 m of the edge of the search area.

**The Rally's** is a channel of open sea running north between granite cliffs:
- **The start:** a wide bay by the lifeboat station and its slipway.
- **The course:**
  - headlands and coves along both shores;
  - grassy islets, sea stacks and reefs out in the channel, one with a lighthouse;
  - red buoys to the west and green to the east, in pairs up the course;
  - about twenty-six little boats in six colours, spread along it and across it: rowing boats with one to three people, sailing dinghies with two, kayaks with one.
- **The finish:** the narrow harbour mouth, a lighthouse either side. Beyond it, the harbour with its quay and a town of cottages on the hill.

One field says where the land is: the distance to the nearest shore, positive over water and negative on land. Everything is made from it, so nothing disagrees:
- **the cliffs:** granite split along its joints. A few big blocks to a stretch rather than many small ones, each squared to the coast's two joint sets, which swing slowly along it, so neighbouring blocks line up face to face and the joints run on from one to the next. A block goes from the seabed to the top in one, or stops at a ledge with a narrower block stepped back above it; its sides lean in a little and kink once on the way up, its corners are broken off, and a corner of its top is sometimes knocked lower. Along the skyline a tor stands here and there above the turf, and elsewhere the turf rolls over a lower edge. Now and then a block has fallen and lies tipped in the surf at the foot. The stone is drawn with a few straight dark joints down each face (some stopping partway) and widely spaced bedding lines across, patterns measured across and up each face so nothing stripes diagonally; warm grey, the same tone along a stretch, patched with orange lichen above the splash zone, the sunlit tops a little darker and golden, dark and wet below.
- **the ground:** a steep face behind the blocks, then cliff-top turf (olive and sun-dried gold, greener in the hollows, with thrift and gorse in flower), sandy coves, quays, the town's hill, the seabed;
- **the boulders:** a few fallen at the cliffs' feet, heaped along beaches and low shores; skerries (little reefs of rock) a stone's throw off the cliffs, where the surf breaks. No rock reaches further into the water than a hull is allowed to go;
- **where a boat can go:** the hull keeps 2.6 m from the shore, so it can't sail into a rock;
- **the routes** the game's boats find;
- **the swell:** a little smaller near the shore, and much smaller in the lee of land. Looking back the way the swell comes from each patch of water (three rays, 8 m apart over the whole coast), land close upwind shelters it: behind a headland or an islet the water is calm, out in the channel it's open, and inside the harbour it's calm whatever the weather. On the Service's coast, well off the mainland it's more than open (up to nearly half as big again, still calmer in an islet's lee). The same number sets the waves the boats ride and the waves that are drawn, the whitecaps and the colour of the water, how steady a lifeboat can hold alongside, and how far a stopped one drifts;
- **the surf:** breaking white along every shore, and spray thrown up where a crest meets the rocks.

![On a bigger screen](rescue-coast/v-wide.jpg)
![The lifeboat](rescue-coast/v-study.jpg)
![The inshore boat](rescue-coast/v-study-inshore.jpg)
![The harbour launch](rescue-coast/v-study-launch.jpg)

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

The weather doesn't change the rules: every boat rides the same sea. In the Rally it stays as chosen; in the Service it's where the day starts, and the day goes on from there (above). The race keeps the sea to the day's weather itself, step by step (so a day runs the same without a page), and the page draws the rest from the same numbers.

![Windy](rescue-coast/v-weather-windy.jpg)
![Stormy](rescue-coast/v-weather-stormy.jpg)
![Foggy](rescue-coast/v-weather-foggy.jpg)
![Night](rescue-coast/v-weather-night.jpg)
![Sunset](rescue-coast/v-weather-sunset.jpg)
![Calm](rescue-coast/v-weather-calm.jpg)
![A storm, on a bigger screen](rescue-coast/v-storm-wide.jpg)
![Night, on a bigger screen](rescue-coast/v-night-wide.jpg)

## The other boats

Each of the others (four in the Rally, the two neighbours' crews in the Service) is steered by the game:
- **Choosing:** it goes for the little boat worth most to it: its people, over the time to get there and take them aboard. In the Rally it prefers its own side of the channel, and passes over one another of the game's boats is plainly nearer. In the Service it keeps to its own station's stretch, going for one in another's only once it's been waiting 35 s with nobody going for it (and then valuing it a little less); it claims the one it's going for, leaves alone any another crew has claimed, never gives up on anyone however far, and keeps to the one it chose unless another is much better (they're all over the sea, and changing its mind costs the trip). With no one to go for and more calls to come it waits where it is; when everyone's been found, it goes home.
- **Finding the way:** it goes straight where the water's clear. Where an islet or a headland is in the way, it follows a route found over a 4 m grid of open water (the water round each buoy is closed on that grid, so a line of buoys is gone round, not through). It bends its way round a buoy, or a little boat it isn't going for, and only into clear water. If it's really getting nowhere (pinned against something, whatever its engine is doing), it backs off and tries again.
- **Coming alongside:** it slows as it nears and passes with the little boat a beam's width off its side (in the Service, on the sheltered side when the swell gives a choice), then stops while the people come aboard.
- **Heading home:** it makes for the harbour when nothing's left for it (in the Rally, when nothing's worth going for or the last call won't wait; in the Service, when everyone's been found), and eases on to its berth (in the Service, each to its own station from wherever it is, landing its people on the way in).

The level sets how quick they are (and in the Service, the kind of boat: the inshore boat is about a sixth quicker than the lifeboat, the launch about a sixth slower):
- **easy:** four-fifths of your speed;
- **medium:** nine-tenths;
- **hard:** nearly yours.

In the Rally, on easy and medium, they ease off when well ahead of you and push on when behind.

## How it's drawn

Its own WebGL2 renderer: the lab ships one bundle with no packages, so Three.js wasn't an option here. Lit like the boards:
- **Light:** a warm sun with shadows, and a cool sky filling the shade.
- **Materials:** glossy painted toys, glass and metal, skin and cloth, granite (grain, flecks, lichen on top, darker and glossy where the sea wets it), lamps, gorse.
- **The sky:** cumulus over the horizon.
- **Distance:** hazed toward the horizon.
- **The finish:** everything is drawn in linear light into a floating-point buffer (where the phone allows); one pass then adds the glow of the brightest things, a soft focus away from what the camera is looking at (stronger on the title and close-ups, so the scene reads as a model), the exposure, one filmic tone curve, and a light vignette.
- **Measured against the boards:** besides the side-by-side sheets, the share of white water, of warm (lichen, sunlit rock) colour and the saturation in each locked scene, and the water's hue, are compared with the board's. The last pass made the sea a deeper, bluer body (its hue now the boards'), whitewater textured with a lace of bursting bubbles round its edges, more of it round the hulls (wider and churning at speed, slapping round a boat lying still), round the little boats and along the rocks, the granite lighter, layered and fractured (see the cliffs, below), with orange lichen in patches and the sunlit tops a little golden, and the grade a touch less saturated.
- **Checked against the boards:** `?ref=hero`, `?ref=rescue` and `?ref=coast` hold fixed scenes laid out like the boards' hero shot, close rescue and coastal landscape (the hero out in the open sea heading for the stacks: the coast's cliffs off one bow, the horizon open off the other, the crews strung out at different distances, one alongside a dinghy taking its people off; `?ref=hero-rally` keeps the older one up the Rally's channel) (and `?ref=harbour` looks over the Service's harbour from above its mouth, as on the boat-choosing board) (the HUD hidden, nothing moving; `&u=0..1` sets how far through the climb aboard the rescue is). `node devtools/rescue-coast-fidelity.mjs <dir>` draws them and puts each beside its target panel, kept in `devtools/fidelity/`.

The sea:
- **The swell:** eight Gerstner waves, from a 24 m swell down to 1.7 m chop, the same sums on the CPU (the boats ride them) and in GLSL; the weather scales their height and steepness. Faces turned to the light are brighter, backs and troughs darker, so the relief reads from above.
- **Its colour:** light coming back up out of the water, lit by the sun and the sky, dark navy in the troughs and teal where a crest is thin enough for the light to come through it, greener in the shallows; the sky reflected more at a glancing angle; a sheen toward the sun and fine glints where a ripple turns just right.
- **Foam:** only where something makes it, as bubbly clumps that fill in as there's more of it and thin out at their edges, lit and shaded like a rough white thing on the swell:
  - whitecaps where a high crest folds (in patches, not on every crest);
  - old foam drawn out thin downwind, here and there;
  - round each lifeboat's hull a collar and a bow wave that grows with speed, a lap of white round each little boat;
  - surf along every shore and round every rock that stands through the water (the coast's field keeps the distance to both);
  - wakes, white straight behind the stern and two long broken arms, lying on the sea as it's drawn (displaced sideways by the waves, as the boats are);
  - spray off the bow when going fast (most when it slams into a wave), and on the rocks.

**Cost on a phone** (counted in the browser, a race in full swing): about 125 draw calls and 800k triangles a frame. That's within Sol's budget for draw calls, but the triangles want watching: the boulders and the ground are most of them.
- **Already in place:**
  - distant ground and boulders are drawn coarser;
  - people and gulls are left out of the shadows;
  - the screen's resolution follows the frame time, between 0.8 and 1.75 × the CSS pixel, without see-sawing: a level that was too slow isn't tried again for half a minute, and on the title it only ever steps down.
- **Not yet done:** it hasn't been timed on a phone.

| | |
|---|---|
| `client/rescue-coast/coast.ts` | the coast from a seed (the Rally's or the Service's): the shore field, ground, islets, boulders, lighthouses, town, pier, station, buoys, the little boats and their people; the Service's three stations and the neighbours' harbours, its harbours' moored boats, and each station's calls |
| `client/rescue-coast/race.ts` | the rules: steering, the shore and other hulls, coming alongside, the line and the climb, the game's boats (flow fields over the water), the last call, the places; the Service's crews and kinds of boat, its calls, each station's stretch and helping in another's, landing at home, the search area |
| `client/rescue-coast/weather.ts` | the seven weathers, blending one into another, the Service's days |
| `client/rescue-coast/waves.ts` | the swell (CPU and GLSL) |
| `client/rescue-coast/shapes.ts`, `models.ts` | making meshes; the lifeboat, the inshore boat, the harbour launch (and where people go aboard each), people, little boats, buoys, boulders, lighthouses, cottages, station, jetties, banner, gulls |
| `client/rescue-coast/world.ts` | the coast made drawable, in pieces along it |
| `client/rescue-coast/render.ts`, `fx.ts` | the drawing; wakes, spray, the line, the rings |
| `client/rescue-coast/joystick.ts`, `sound.ts`, `main.ts` | the stick (wherever you touch, or in a corner); the sounds; the page |

**Tests:**
- The coast and the rules, without a page: `node cells/lab/devtools/rescue-coast.test.mjs`.
  - The little boats are in open water, apart, and every one can be reached.
  - There's a way through the harbour mouth to every berth.
  - No boulder reaches past a hull's clearance.
  - Alongside and slow claims; fast or far doesn't; everyone climbs aboard and is counted once; drive off and the rest wait.
  - Whole races steered by the game finish with no hull inside the shore and the places by Lily's rule.
  - The Service's coast: three stations, yours on the pier inside the mouth and the two neighbours' down the coast, apart, each crew moored at its own in open water, bows to the way out, and able to get out of its harbour and back; each neighbour's harbour with its station, a light on its breakwater, quays, cottages and boats moored, and calm; your harbour's jetties with a lamp at each end, bunting along the pier, fifty or more boats moored (rowing boats, dinghies, fishing boats, yachts; some at buoys), none laid over another or over a jetty, all afloat, none in the way in from a mouth or by a crew's berth, no route through any of it; the lighthouse on the harbour's headland; open sea out to the chart's edge past it, the swell bigger well out and calm in the harbour; no route past the edge of the search area; each station's stretch with its five calls (near its harbour, along its coast, out at sea), the stretches in order down the coast, none in a harbour or its mouth, one waiting by each harbour at the start, the further ones later on average, the bigger groups out at sea.
  - The Service's rules: however many are aboard already, everyone waiting climbs aboard; no one steps ashore out on the water, and in the harbour they do, one at a time, counted safe; a little boat whose call hasn't come isn't taken aboard even alongside, its call waits while a lifeboat is right there and comes in once it's gone. People come across sooner in the lee of the hull than on the weather side, and sooner in sheltered water than in the open, and always come across in the end. Nearer, you take one over and the crew that had it says so.
  - The weather: a day starts in the weather chosen and changes; different seeds, different days; half way through a change it's half way; the sea the race reads is the weather drawn; the night stays night or dawns.
  - Driven flat out at a jetty side on: a bump, held off, still on the side it came from.
  - The crews: yours in the kind of boat you chose, the neighbours two other crews in the other two kinds; the Rally's Lily's five, all lifeboats. The kinds: flat out the inshore boat is quickest and the launch slowest; the inshore boat turns tightest; alongside in a sea the launch holds steadiest and the inshore boat least.
  - Another station's stretch: a call in yours is left to you for a while; then, nobody going for it, a neighbour with nothing of its own to do comes to help.
  - Whole days steered by the game (two levels, each kind of boat yours in turn; and in a storm): everyone ashore and every crew in, in three to six minutes; no hull inside the shore or through a jetty or a moored boat; each crew landing its people at its own harbour and only there; no crew heading home while someone's left waiting for it; none going for a call in another's stretch till it's waited a while; the calls at their times; no two crews after one little boat.
  - The same seed gives the same race, and the same day at sea.
- In a browser, by hand: `node cells/lab/devtools/rescue-coast-smoke.mjs` (the line-up and the tagline, the Boats panel's five crews and three kinds (choosing the inshore boat: its card and bars), Play into the Service on its own coast: three crews, yours in the boat you chose at your harbour, the neighbours down the coast in the other kinds, a call in by each; the fleet's count, the Rally from its own button on its own coast; steering from anywhere: no stick drawn, a ring low down until you have, a touch on the sea away from the boat dragged up, to the right, let go, the faint ring where you touched; with the game steering, a touch takes your boat back; the keys; the stick in either corner when asked; both ends).
- The pictures: `node cells/lab/views.mjs rescue-coast`.

**Addresses:**
- `?mode=rally` the Rally (the Service unless asked);
- `?at=` the title's clock, in seconds round its loop (with `still`, one moment of it);
- `?seed=` a coast;
- `?level=easy|medium|hard`;
- `?boat=0..4` your crew;
- `?kind=lifeboat|inshore|launch` your boat (the Service's; a choice in Boats is kept);
- `?follow=n` with `auto`, the camera on race boat n (the Service: 0 yours, 1 and 2 the neighbours);
- `?auto` every boat the game's;
- `?t=40` that far into the race;
- `?still` time held;
- `?view=podium` straight to the end;
- `?near=n` (or `near=any`) a little boat and the lifeboat coming for it;
- `?study` a close look at your boat;
- `?ref=neighbour&n=1|2` a neighbour's harbour from the sea off its mouth;
- `?zoom=`;
- `?hand=touch|left|right` where you steer from (wherever you touch unless asked; a choice in Settings is kept);
- `?weather=sunny|calm|windy|stormy|foggy|night|sunset` (the Service's day starts in it);
- `?clean` no lens blur and no glow, to judge the materials and the water as they are (`devtools/rescue-coast-fidelity.mjs <dir> --clean` makes the comparison sheets that way);
- `?preview` small and quiet.

**Not here yet**, though the boards have them:
- the world map and missions;
- stars, shells and stickers;
- towing;
- a hovercraft.

They're beyond Lily's two pages, and they'd come after the race itself looks and plays right.

