# Naming the drive game

> Oblique strategies drawn live from `https://obs.parc.land`:
> **"Tape your mouth"** (given by Ritva Saarikko), checked against a second card,
> **"Use filters"**.
>
> The first card set the method: for most of this ramble the *game* does the
> talking. Every axis below is built from vocabulary the codebase already uses
> about itself — the words in the comments, the dial labels, the commit
> subjects — rather than from words a marketer would reach for. The second card
> supplied the discipline at the other end: nine axes generate wide, then a
> stated filter set cuts, and what survives the filters is the shortlist.
>
> Sibling docs cover the substrate's naming layers (01–07). This one covers a
> single artefact: `cells/drive`, the game.

---

## 1. What is being named

Four surfaces carry an identity today and no two of them agree:

| surface | today | where |
|---|---|---|
| cell slug / URL | `@c15r/drive` → `parc.land/@c15r/drive` | the `cells/drive` directory name |
| browser title | `drive — the real world, top down` | `index.ts`, `SHELL` |
| boot wordmark | `drive` (lowercase, `letter-spacing: 0.3em`, gold) | `index.ts`, `#boot .t` |
| menu plate | `PARIS → DAKAR` | `client/menu.ts`, `renderHead()` |
| plate sub-line | `SOLARPUNK RALLY RIG` | `client/menu.ts`, `subT` |

Three of the five are already wrong:

- **"top down" is false.** `CamMode` is `top | chase | cab`, and **chase** is
  the default — *"the road view is the game; the chart is a mode you visit."*
  The title describes a prototype that no longer exists.
- **`drive` is a verb with no edges.** As a *slug* it is defensible (§7). As a
  *title* it is unsearchable and says nothing that "car game" doesn't.
- **`PARIS → DAKAR` borrows a live mark.** ASO (Amaury Sport Organisation) owns
  the Dakar trademark and runs the event annually. Two of the sixteen curated
  DESTINATIONS are `PARIS · THE START` and `LAC ROSE · THE FINISH`, so the plate
  is not decoration — it is a claim to be an unlicensed edition of a real,
  actively-defended race.

### The tier rule — the title and the slug need not be the same word

`07-product-cell-branding-voice.md` and `platform-cells.md` already legislated
this and it is the single most useful constraint here: **brand register and API
register are different namespaces, kept strictly apart.** A cell slug is judged
as API surface — generic lowercase noun, coreutils-grade, no metaphors
(`canvas`, `workspace`, `models`, `run`). A title is Tier A and may be
evocative. `park-design-language.md` states the hard version: *motifs never
rename the system.*

So this document answers **two** questions, separately, and refuses to force
one word to do both jobs:

1. **What is the game called?** (Tier A — the plate, the boot, the title tag.)
2. **What is the cell called?** (Tier B — the slug, the directory, the URL.)

---

## 2. The brief — eight things the name has to be true to

Read for this: `cells/drive/index.ts`, `client/main.ts` (11.4k lines),
`client/menu.ts`, `client/font.ts`, `devtools/hud-catalog.md`,
`docs/drive-road-vertical-budget.md`, `docs/drive-road-terrain-corridor.md`,
`docs/drive-survey-checkpoints.md`, and 33 commits on
`claude/c15r-drive-cell-edit-9pawum`.

**1 · It is the real Earth, at 1:1, and there is no world file.** OSM vectors
via Overpass (cached to S3 through the cell's public namespace, ADR-0095),
elevation from AWS terrarium tiles, land cover from ESA WorldCover COGs, place
names from Nominatim, live cloud/rain/wind from open-meteo, and sun position
from NOAA arithmetic that needs no dataset at all. The cell's own words: *"no
tile server of our own — the public endpoints named in the cell's CSP are the
whole backend."* Every road on Earth is drivable, and no two are alike because
nobody authored them.
→ *A name that implies a designed track, a circuit, or a fictional world is
lying.*

**2 · The look is CRT-over-GIS, not photoreal.** A dialable post chain:
`PIXEL 240P/320P/480P/FULL`, `PALETTE 8/14/24/OFF`, `SCANLINES`, `BLOOM`,
`LENS FLARE`. The HUD is hand-drawn 5×7 and 3×5 bitmap glyphs at two screen
pixels per HUD pixel on a phone — *"chunky enough to read as 8-bit, fine enough
that a place name and the instruments coexist."* Eight colours, fixed: ink
`#0a1417`, edge teal `#57c9b0`, gold `#f2c14e`, hot orange `#e2703a`, good
`#6fe0a0`, bad `#d94f4f`, plus text and soft. Chrome vocabulary: 1px rules,
gold corner brackets, cell meters instead of numerals.
→ *The name will be seen in gold caps on a five-pixel grid. It has to survive
that, and it has to survive `#boot .t`'s 0.3em letter-spacing.*

**3 · The core loop is survey, not racing.** Invisible checkpoints laid every
250 m of **arc length** along each named OSM way; drive a **majority** and the
road latches CLAIMED, permanently. `drive-survey-checkpoints.md` names the
feeling directly: *"ambient road conquest… no objective, no timer; the reward is
that the map fills in"*, and *"the claim latches — a road never un-claims — so
the log is a history of where you have actually been."* A road cannot be
claimed until its extent is settled: you may not claim what you have not seen
the end of. The odometer persists across every session on the device, forever.
There is no fail state.
→ *This is the single largest constraint. A name that promises speed, danger or
victory is selling a different game.*

**4 · Rally is the framing, not the sport.** A computed co-driver calls the next
bend — chained segments, signed heading change, drawn as a bent arrow *whose
geometry is the bend*. SETUP dials are `STEERING CALM/STOCK/QUICK/RALLY`,
`SUSPENSION SOFT→STIFF`, `TYRES HARD/STOCK/SOFT/STICKY` (grip bought with tread:
the sticky set finds a quarter more surface and gives itself up three times as
fast). The RIG panel reads SUSP / HULL / TYRE / BATT with SLIP / SOL / SVC LEDs.
→ *Rally's paper vocabulary — roadbook, pace note, liaison, recce — fits. Rally's
podium vocabulary does not.*

**5 · Explicitly solarpunk, and decaying gracefully.** From the source:
*"the world is DECAYING GRACEFULLY: cracked asphalt with growth in the seams,
crumbling walls with moss and vines, weathered roofs… the first brick of the
solarpunk overhaul."* The rig is an overland/rally 4×4 off a real spec sheet:
2.4 kW solar array, 10 kWh LiFePO4, biodiesel/algae, 1200 km range, 120 L water,
800 kg payload, 2100 kg curb. A `SOL` LED lights when the array out-makes the
draw. Paint: RUST / EMBER / SAND / OLIVE / FOREST / STEEL. Weathering: CLEAN /
WORN / **BEATEN**.
→ *Warm, worn, self-sufficient, post-scarcity-adjacent. Not chrome, not neon.*

**6 · The «alien script» mechanic was the most distinctive idea the project has
had, and it has just been deleted.** On `main` it is live: tap the place name
and every label garbles into Yi syllables, deterministically, so *"the same
place always garbles to the same glyphs, so landmarks stay RECOGNIZABLE even
unreadable"* — and then, out loud, *"the future trek mechanic depends on that."*
On the WIP branch it is gone, with an epitaph: *"retired — it was carried by the
bitmap font's per-character fallback, and the trek mechanic it existed for never
arrived."* Silkscreen has no Yi glyphs, and the font migration cost it its
carrier.
→ *A whole game was hiding in that toggle, and it was a better game than
"rally". Naming toward it is now a decision to **revive** a deleted feature, not
to describe a live one. Recorded here because a name is a cheap way to commit to
a direction — and an expensive way to fail to.*

**7 · Mobile-first, and it means it.** Touch stick, safe-area insets, wake lock,
paged lists because a canvas cannot scroll (now a DOM menu, because a page is
what the DOM is for), and `REAL DRIVE` — a mode that drives the car from the
device's GPS, so you can play it by actually driving. Save a spot where you
park; every start is a shareable URL.
→ *The name will be a home-screen label under an icon, read at a glance,
one-handed.*

**8 · The engineering voice is measured, literary and allergic to hype.**
Commit subjects: *"the road is what it is made of, not what it is called"*,
*"only the sea gets a seabed, and sea level stops guessing early"*, *"a field,
not a lawn"*, *"Light the walls: faded white paint that reads as paint."* Doc
headings: *"The DEM lies, sometimes"*, *"Sheets in the sky: the drapes had no
such contract"*, *"Then stop clamping vertices at all."* Every mechanism is
priced in a before/after table and every unfixed thing is named.
→ *This project can afford a plain name and let it earn its meaning. It cannot
afford a name that oversells — the whole codebase would read as a rebuke to it.*

---

## 3. The filters — seven tests, stated before generating

**T1 · The bitmap test.** The 5×7 HUD face (`GLYPHS` in `main.ts`) covers
`A–Z`, `0–9`, space, and `. , : / - % · ! ? ( ) + > < = # * " ' °`. Lowercase is
uppercased; anything outside falls back to the system font *per character* and
breaks the grid. **No `&`. No `→`** — the plate's arrow is a `<span>` in
Silkscreen on the DOM menu and was hand-drawn from `fillRect`s before that. The
`safe()` filter that names a saved spot is stricter still:
`/[^A-Z0-9 ,·.-]/`. A name that cannot be a saved-spot name is a name the game
cannot say back to you.

**T2 · The plate test.** `.m-title` is 16px Silkscreen 700 inside `.m-head`
(`padding: 0 12px`, `gap: 8px`) next to an X button, in a panel inset 10px.
On a 360 px phone that leaves roughly 280 px, and Silkscreen advances ~8 px per
character at 16 px — about **35 characters physically**. So width is not the
real limit; legibility is. Budget: **≤ 16 characters** for the plate, **≤ 24**
for the sub-line (`.m-sub`, 10 px, `letter-spacing: 2px`; the incumbent
`SOLARPUNK RALLY RIG` is 19).

**T3 · The boot test.** `#boot .t` is one line, gold, `letter-spacing: 0.3em`.
Wide tracking flatters short words and destroys long ones. Two words maximum.

**T4 · The say-aloud test.** Someone who has not played it hears the name once.
Do they spell it right, and do they expect roughly the right thing?

**T5 · The collision test.** Searchable, and not an existing game or an actively
defended mark.

**T6 · The register test.** Does it sit next to *"the DEM lies, sometimes"*
without embarrassing either?

**T7 · The honesty test — the hard one.** Does it describe **the game that
exists** (no timer, no fail state, ambient survey of the real Earth, a log of
where you have actually been), or **the game a racing trailer would imply**?
Nearly every obvious candidate fails here, and this test alone kills the
incumbent plate.

---

## 4. Nine axes

~180 candidates. One line of *why* each. Each axis carries a note on what it
gets wrong, because an axis that only flatters itself is not divergence.

### Axis A · Survey & cartography
*The claim mechanic's own discipline. The game measures the real world by
traversing it, which is what surveying is.*

| candidate | why |
|---|---|
| **SURVEY** | the code's own word — the menu tab, `surveyHere()`, `SURVEY_MAJORITY`, `surveyEligible` |
| **GROUND TRUTH** | GIS term of art: the reality you check the remote measurement against. The whole game |
| **BEAT THE BOUNDS** | the parish rite of walking every boundary to keep it in memory — the claim mechanic, 800 years early |
| **PERAMBULATION** | the legal name for the same rite: establishing bounds by going round them |
| **ROGATION** | the week beating the bounds was walked in; strange, liturgical, ownable |
| **CHAINAGE** | distance measured along a route from a datum — literally how checkpoints are laid |
| **DATUM** | the agreed reference everything else is measured from; also what the DEM isn't |
| **BASELINE** | the first measured line a whole triangulation hangs off |
| **TRIANGULATE** | fixing a point by sighting it from places you have already been |
| **TRAVERSE** | a surveyor's chain of measured legs; also just what you do to a mountain road |
| **ORDNANCE** | as in Survey — the state's own map, and the thing this game hands you and then ignores |
| **BENCHMARK** | the brass plug in a wall recording a known height; the DEM has none |
| **CADASTRE** | the register of who holds which parcel — the claimed-roads log, formally |
| **THEODOLITE** | the instrument; long, but it *looks* like the HUD |
| **PLANE TABLE** | field surveying's drawing board — mapping while standing in the place |
| **RESECTION** | finding where *you* are from things you can see. What the minimap does |
| **THE FIELDWORK** | measurement done outdoors, by going there, in weather |
| **CLOSING THE TRAVERSE** | when your measured loop meets itself; fails T2 but the concept is the game |
| **STADIA** | distance by optical measurement; unfortunately also a dead Google product |
| **ISOLINE** | a line of constant value; the terrain shader draws them for free |
| **CONTOUR** | plain, beautiful, and the thing the road negotiates |
| **THE LONG SURVEY** | scale + patience in three words |

*What this axis gets wrong:* surveying is a job. Several of these make the game
sound like homework, and `SURVEY` in particular now means "questionnaire" to
almost everyone.

### Axis B · The roadbook
*Rally's paper vocabulary, deliberately excluding its podium vocabulary and its
trademarks.*

| candidate | why |
|---|---|
| **ROADBOOK** | the bound book of instructions a rally crew navigates from. One word, plain, exact |
| **TULIP** | the roadbook's bend pictogram — and the co-driver's drawn arrow *is* a tulip diagram |
| **PACE NOTES** | what the co-driver reads. Two words, instantly legible to anyone who knows rally |
| **PACENOTE** | the same, compressed, more ownable |
| **LIAISON** | the untimed road section *between* stages — i.e. the entire game |
| **THE LIAISON** | the definite article makes the untimed section the point, which it is |
| **RECCE** | the slow pass you make to write the notes. British, short, odd-looking |
| **SCRUTINEER** | the official who checks the car is what its sheet says; the RIG panel does this |
| **TIME CARD** | the stamped card carried between controls |
| **SERVICE PARK** | where the rig gets fixed; the `repair` POI kind already exists |
| **ROAD SECTION** | the neutral, official name for untimed driving |
| **CO-DRIVER** | the game's most-loved system, named as the title |
| **RIGHT SIX** | a real pace-note call ("right six over crest") |
| **OVER CREST** | the same, and it describes the camera problem the WIP branch just fixed |
| **DON'T CUT** | a pace note, and an instruction the survey mechanic enforces |
| **THE ROADBOOK** | with the article, it becomes an object you own rather than a genre |
| **TULIP DIAGRAM** | fails T2 at 13 but reads beautifully in the sub-line |
| **ROADSIDE** | where you stop, and where everything interesting is |
| **CONTROL** | the point you clock through; also a Remedy game (T5 fail) |
| **NEUTRALISED** | rally's word for a section where the clock stops. All of them are neutralised here |

*What this axis gets wrong:* it inherits rally's expectation of a clock. The
game has no clock. `LIAISON` and `NEUTRALISED` are the only two that turn that
into the joke it should be.

### Axis C · One to one
*The scale is the feature. There is no world file.*

| candidate | why |
|---|---|
| **ONE TO ONE** | the scale, said plainly; also what the relationship to the planet is |
| **1:1** | the same, unspeakable aloud (T4 fail) but perfect in the sub-line |
| **ACTUAL SIZE** | the label on a museum card. Dry, funny, exactly true |
| **TRUE SCALE** | cartography's phrase for a projection that doesn't lie. This one does, slightly |
| **FULL SIZE** | plainer still |
| **EVERY ROAD** | the promise, and it is literally true |
| **ALL THE ROADS** | warmer, less brochure |
| **THE WHOLE ROAD** | what a majority claim asks of you |
| **REAL GROUND** | short, honest, a little flat |
| **GROUND** | the plain-word version; the code's own noun (`groundAt`, `roadCeiling`) |
| **TERRA** | short, gold-caps-friendly, badly overused |
| **THE WORLD ROAD** | slightly mythic |
| **NO WORLD FILE** | a developer joke as a title; fails T4, wins T6 |
| **STREAMED** | what the world is; also what nobody wants a game called |
| **OVERPASS** | the actual API the world arrives through, and a road structure. A genuine double |

*What this axis gets wrong:* "the real world" is a *fact* about the game, not a
*feeling* of it. These names describe the tech demo and not the drive.

### Axis D · Solarpunk & the rig
*The array, the battery, the algae diesel, the moss in the seams.*

| candidate | why |
|---|---|
| **SUNWARD** | direction of travel and power source in one word; warm, mobile |
| **LONG SUN** | the array's day; slightly Gene Wolfe |
| **AMP HOUR** | the unit the battery is measured in. Terse, technical, warm |
| **INSOLATION** | solar energy received per area — the exact quantity `solarKw` models |
| **SOLAR MILE** | distance bought from daylight. The rig's whole economy |
| **DAYLIGHT** | the code's word for the clearance under a deck *and* the thing the array eats. A real double |
| **SECOND GROWTH** | the forest that comes back after the first is cut. The world's condition, exactly |
| **SUCCESSION** | the ecological term for what grows back. Perfect meaning, ruinous collision (T5) |
| **GREEN LANE** | the UK term for an unsurfaced right of way. Solarpunk by accident |
| **SALVAGE** | what the rig is made of; too grim for a game with no fail state |
| **BEATEN** | the top weathering setting. One word, strong, wrong connotation |
| **THE LONG RANGE** | 1200 km, and patience |
| **ALGAE DIESEL** | straight off the spec sheet; too silly for the plate, perfect for the sub-line |
| **OFF GRID** | true of the rig and true of the backend |
| **SELF SUFFICIENT** | the spec sheet as a thesis; fails T2 |
| **120 LITRES** | the water tank. Absurd, memorable, wrong |
| **PHOTOVORE** | invented, sun-eating; ownable, cold |

*What this axis gets wrong:* solarpunk is the *texture*, not the *subject*.
None of these say you drive.

### Axis E · The unreadable world
*The world is real, fully mapped, and you cannot read it. This is the strand the
code built, said it was building toward, and then deleted (§2.6).*

| candidate | why |
|---|---|
| **LOANWORD** | a word taken into another language, kept recognisable. The mechanic, in one word |
| **THE OLD ROADS** | roads outlast everyone who built them. Post-human, solarpunk, and literally true of OSM |
| **UNREADABLE** | plain, and slightly hostile |
| **ILLEGIBLE** | the same, more precise, harder to say |
| **STRANGE COUNTRY** | the feeling of the alien toggle, in two warm words |
| **FOREIGN GROUND** | ties Axis E to Axis A's `GROUND` |
| **THE FAR COUNTRY** | old, wide, wistful |
| **SIGNS AND WONDERS** | what unreadable roadsigns become |
| **WAYFARING** | archaic word for travelling by road; carries `way`, OSM's own noun |
| **THE LONG AFTER** | after what is never stated. Fits the decaying-gracefully world |
| **AFTERWORLD** | too metal |
| **RETURNING** | you arrive somewhere real that has gone strange |
| **NOBODY'S ROADS** | ownership inverted — you claim what nobody holds |
| **THE NAMES** | every road in this game has one, and the toggle takes them away |
| **UNSPOKEN** | the place names you can see and cannot pronounce |
| **GLOSSOLALIA** | the Yi syllables, technically; unusable, worth writing down |
| **TRANSLIT** | short for transliteration, which is exactly what `alienize()` does |
| **RECOGNISABLE** | the design constraint, as the title. Too clever |
| **LANDFALL** | arriving somewhere you don't know. Reused often but not by a driving game |

*What this axis gets wrong:* it names a mechanic that **no longer exists.** The
alien script shipped, was off by default, and was retired in the font migration.
Choosing here is choosing to build that game back — which may well be the right
call, but the name would be writing a cheque the code has actively cancelled.

### Axis F · The latch
*What the odometer and the claim log actually are: a record.*

| candidate | why |
|---|---|
| **LOGBOOK** | the object the game hands you. Plain, warm, correct |
| **THE LONG LOG** | scale and patience; slightly awkward aloud |
| **ODOMETER** | persists forever across every session. The game's real score |
| **MILEAGE** | what you have; also what a thing is worth |
| **KILOMETRAGE** | the honest metric version, and unusable |
| **TRIP** | `odo.trip` — one syllable, double meaning, hopelessly generic |
| **WHERE I HAVE BEEN** | the doc's own description of the claim log; fails T2 badly |
| **BEEN THERE** | the same in two words, too flip |
| **TRACE** | what you leave; also a debugging noun the substrate already uses |
| **THE RECORD** | flat but true |
| **WITNESS** | claiming a road is testifying you drove it |
| **PROVENANCE** | the substrate's own word for "how do we know" — and the survey gate is provenance |
| **ATTESTED** | a road you have driven the majority of. Cold, precise |
| **LATCH** | the code's own word for a claim that never reverses. Too small |

*What this axis gets wrong:* a record is the *residue* of play, not the play.
These are good sub-lines and weak titles.

### Axis G · CRT register
*Names built to look right in gold on teal at five pixels.*

| candidate | why |
|---|---|
| **PHOSPHOR** | what the glow is made of; the palette in one word |
| **SCANLINE** | a dial in the game; short, hard, technical |
| **240P** | the lowest PIXEL setting. Numerals read beautifully in 5×7 |
| **LOW RES EARTH** | says the whole joke; fails T2 at 13 and T4 slightly |
| **EIGHT COLOURS** | the palette, literally — `PALETTE 8` |
| **PIXEL RALLY** | the obvious one, and obvious is why it is here rather than in §5 |
| **BITMAP** | a face, a HUD, a look |
| **CATHODE** | the tube; cold, strong |
| **RASTER** | how the terrain cut is stored (`cutCells`) *and* how a CRT draws |
| **SPRITE** | wrong genre, right decade |
| **DITHER** | what the palette dial does at 8 |
| **GOLD ON TEAL** | the palette named as the brand; unusable, correct |

*What this axis gets wrong:* it names the filter, not the film. The retro look
is a `PALETTE OFF` toggle away from not existing.

### Axis H · The plain word
*The workspace's own best habit — `canvas`, `workspace`, `models`. A short
generic noun that calcifies into a term of art by use. This axis is also where
the slug candidates come from (§7).*

| candidate | why |
|---|---|
| **WAY** | OSM's own noun for a road, and an English word for a route, a manner, a distance |
| **WAYS** | the plural makes it a collection — which is what the survey log is |
| **ROADS** | the subject of the game, said once |
| **KERB** | the code's most-used noun; the thing the cut solve is measured against |
| **VERGE** | the strip beside the road; also a threshold. Short, gold-caps-perfect |
| **CAMBER** | the cross-fall the ribbon solves (`tilt`). Technical, beautiful, unclaimed |
| **GRADIENT** | what the WIP branch's "engineered grade line" computes |
| **TARMAC** | warm, physical, British |
| **GRAVEL** | the surface that makes the SETUP dials matter |
| **PASS** | a mountain road, a permit, and a verb. Three-way pun, one syllable |
| **CORRIDOR** | the code's word for the volume a road cuts through terrain |
| **RIBBON** | the function that builds every road (`ribbon()`) |
| **CROSSING** | what a long drive is |
| **HAUL** | the distance and the effort |
| **OVERLAND** | the rig's own class (`CLASS OVERLAND / RALLY`) — but a 2019 game owns it |
| **TERRAIN** | a dial, a subject, and a thousand other things |
| **GROUND** | see Axis C; the strongest single plain noun here |

*What this axis gets wrong:* plain words are unsearchable, and a one-word noun
with no edge gives a stranger nothing to hold. `drive` already fails this way.

### Axis I · Deliberately absurd
*The pressure valve the sibling docs use. Kept in so the shortlist has something
to be measured against, and because two of these are secretly good.*

| candidate | why |
|---|---|
| **THE DEM LIES, SOMETIMES** | a doc heading as a title. Fails every filter. Best sentence in the repo |
| **BIG SUR SIMULATOR 1997** | the genre-parody title, aimed at the wrong shelf |
| **OVERPASS API: THE GAME** | naming the dependency. Funnier than it should be |
| **UNPAVED** | actually good, filed here because it arrived as a joke about `surface=unpaved` |
| **CARBERRA** | portmanteau nonsense; proves portmanteaus don't work here |
| **ROAD ENJOYER** | correct about the audience |
| **NOT A RACING GAME** | states T7 as the title. Unusable and clarifying |
| **A LONG WAY FROM PARIS** | the honest replacement for the plate, at 20 characters |
| **CLAIMS ADJUSTER** | what the survey mechanic is, if you are unkind about it |
| **CHAPMAN'S PEAK DRIVE** | name it after the one road it was tuned on. Apostrophe fails T1 |
| **TERRARIUM** | AWS's tile format *and* a small contained world. A perfect double, four Steam collisions (T5) |
| **BEAT THE BOUNDS** | arrived on this list before it was taken seriously. Now the runner-up |

---

## 5. The shortlist — ten, as full identity sets

Each is rendered as the thing it would actually be: plate, sub-line, boot
wordmark, browser title, slug, tagline. Ranked.

### 1 · GROUND TRUTH  *(Axis A × C)*

| | |
|---|---|
| plate | `GROUND TRUTH` |
| sub-line | `THE REAL WORLD, DRIVEN` |
| boot | `ground truth` |
| title tag | `Ground Truth — drive the actual Earth` |
| slug | `drive` (unchanged — §7) |
| tagline | *Every road on Earth, and the only way to know one is to drive it.* |

The term of art means *the measurement you take by physically going there,
against which the remote data is checked* — which is not a metaphor for this
game, it is a description of it. The whole codebase is an argument with its own
data sources: the DEM lies over Reykjavík harbour, the elevation source has a
footprint, the road is what it is made of and not what it is called, Ou Kaapse
Weg measures 4352 m from one ring of tiles and 10058 m from two. The player is
the correction.

Twelve characters, both words in the bitmap set, unmistakable in gold caps, and
no game owns it — the only prominent use is a 2016 CV paper, *Playing for Data:
Ground Truth from Computer Games*, which is a pleasing inversion rather than a
collision.

**The case against:** it is remote-sensing jargon, so the precision is invisible
to anyone outside GIS/ML, and to everyone else "Ground Truth" sounds like a
military thriller. It also says nothing about *driving*; the sub-line has to
carry that, every time.

### 2 · BEAT THE BOUNDS  *(Axis A)*

| | |
|---|---|
| plate | `BEAT THE BOUNDS` |
| sub-line | `CLAIM A ROAD BY DRIVING IT` |
| boot | `beat the bounds` |
| title tag | `Beat the Bounds — the world, one road at a time` |
| slug | `bounds` or `drive` |
| tagline | *Drive the whole of a road and it is yours. Nothing else counts.* |

Beating the bounds is the English parish rite of walking the entire boundary of
your parish, striking the landmarks as you go, *to keep the boundary in shared
memory when maps were rare*. It survives in a few parishes still. It is the
survey mechanic, eight hundred years early — including the part where a majority
of the walk is the proof, and the part where the record is a memory rather than
a document.

The best thing about it is the inversion. The custom died out because the
Ordnance Survey made it unnecessary. This game hands you Ordnance-grade data —
every way, every contour, every land-cover class — and then asks you to walk the
bounds anyway, because the map is not the same as having been there.

**The case against:** fifteen characters and three words, so it strains T2 and
breaks T3's tracking. "Beat" reads as combat to anyone who does not know the
custom, which is nearly everyone. It is a *British* custom in a game whose
sixteen destinations span five continents.

### 3 · LIAISON  *(Axis B)*

| | |
|---|---|
| plate | `LIAISON` |
| sub-line | `THE UNTIMED SECTION` |
| boot | `liaison` |
| title tag | `Liaison — a rally with no stages` |
| slug | `drive` |
| tagline | *Rally's word for the part between the stages. This game is all liaison.* |

In rally, the liaison is the untimed public-road section between special
stages — the part that is not the sport, that crews grumble through, and that is
the *only* part this game has. Naming it that is a precise joke that turns the
game's central refusal (no clock, no fail state) into its identity. It keeps the
rally register the plate already had, without borrowing a mark.

**The case against:** it is a French loanword with a spelling most people
mis-type, and outside rally circles "liaison" means an affair or a
coordinator role. T4 is a genuine problem.

### 4 · ROADBOOK  *(Axis B)*

| | |
|---|---|
| plate | `ROADBOOK` |
| sub-line | `SIXTEEN GREAT ROADS, AND EVERY OTHER ONE` |
| boot | `roadbook` |
| title tag | `Roadbook — the real world, road by road` |
| slug | `roadbook` or `drive` |
| tagline | *A bound book of somewhere to go, and a record of where you went.* |

One word, eight characters, plain, and it is genuinely what the DRIVES list plus
the SURVEYS log *is*: a book of routes you carry, filled in as you drive them.
Safest name here — it says "roads", it says "travel", it says "on purpose", and
nobody has to be told what it means.

**The case against:** safe is the problem. It is a category name, not a title,
and several rally-navigation apps already use it. It has no second meaning.

### 5 · THE OLD ROADS  *(Axis E)*

| | |
|---|---|
| plate | `THE OLD ROADS` |
| sub-line | `THEY OUTLASTED EVERYONE` |
| boot | `the old roads` |
| title tag | `The Old Roads — drive a world that grew over` |
| slug | `roads` |
| tagline | *The tarmac is cracked and the signs are unreadable. The road still goes where it went.* |

This is the name for the game the code kept hinting at: moss in the asphalt
seams, vines up the walls, the alien script, *"the future trek mechanic"*.
Roads are the longest-lived thing humans build, and OSM is a complete inventory
of them — so a far-future framing costs nothing to justify and would unify
solarpunk decay, unreadable place names, and the survey log into one premise.

**The case against:** it commits to a game that is currently a texture pass and
a deleted feature. If the far-future strand never gets built, the name is a
promise the game breaks every time you drive past a Shell station rendered from
live OSM — and the one mechanic that would have kept the promise was retired
last week.

### 6 · CHAINAGE  *(Axis A)*

| | |
|---|---|
| plate | `CHAINAGE` |
| sub-line | `250 METRES AT A TIME` |
| boot | `chainage` |
| title tag | `Chainage — distance measured by going` |
| slug | `chainage` |
| tagline | *Surveying's word for distance measured along the route itself.* |

Chainage is the measurement of distance *along a road from a datum*, marked at
intervals — which is `SURVEY_P = 250` exactly. Wholly unclaimed, looks superb in
gold caps, and rewards the one person who knows the word.

**The case against:** nobody knows the word. T4 fails outright — most people
will hear "chain gauge" and half will spell it "chainedge".

### 7 · CAMBER  *(Axis H)*

| | |
|---|---|
| plate | `CAMBER` |
| sub-line | `THE SHAPE OF THE ROAD UNDER YOU` |
| boot | `camber` |
| title tag | `Camber — real roads, real ground` |
| slug | `camber` |
| tagline | *The cross-fall of a road is the first thing you feel and the last thing anyone models.* |

Six characters, one plain English noun, and it names the exact thing the
codebase spent a hundred commits getting right — the kerb-solved cross-fall
(`tilt`) read back off two independently-dropped kerbs. A name that only a
driving game could wear.

**The case against:** it is also a Sussex village, a tyre-alignment setting, and
a slightly clinical word. It says "road surface", not "the whole Earth".

### 8 · TULIP  *(Axis B)*

| | |
|---|---|
| plate | `TULIP` |
| sub-line | `THE CO-DRIVER IS DRAWING` |
| boot | `tulip` |
| title tag | `Tulip — the bend, before it arrives` |
| slug | `tulip` |
| tagline | *A tulip is the little diagram that tells you which way the road goes.* |

The roadbook's bend pictogram is called a tulip, and the WIP branch's co-driver
call is *"a bent arrow whose geometry IS the bend"* — the game already draws
tulips and does not know it. Five characters, warm, memorable, wildly
unexpected for a driving game, and the icon designs itself.

**The case against:** it is a flower, a Dutch financial bubble, and a Ridley
Scott film. Nothing about it says road, car, or Earth until someone explains it.

### 9 · LOANWORD  *(Axis E)*

| | |
|---|---|
| plate | `LOANWORD` |
| sub-line | `YOU CANNOT READ IT. YOU CAN STILL GET THERE.` |
| boot | `loanword` |
| title tag | `Loanword — a real world you can't read` |
| slug | `loanword` |
| tagline | *A word taken into another language, still recognisable. Every place name here is one.* |

The most exact single word for what `alienize()` did: deterministic garbling
that keeps a landmark recognisable while unreadable. Unclaimed, literate, sits
perfectly next to the codebase's voice.

**The case against:** it is a *linguistics* word for a *driving* game, and the
mechanic it names has been deleted. Its sub-line is 44 characters — over T2's
budget and needing a rewrite. This one is a bookmark, not a candidate: it is
here so that if the trek mechanic is ever revived, the name is waiting.

### 10 · SURVEY  *(Axis A)*

| | |
|---|---|
| plate | `SURVEY` |
| sub-line | `AMBIENT ROAD CONQUEST` |
| boot | `survey` |
| title tag | `Survey — claim the roads of the real world` |
| slug | `survey` |
| tagline | *No timer, no finish. Drive the whole of a road and the map fills in.* |

The disciplined choice: the game already calls its core loop this, in the menu
tab, the data structures and the design doc. Renaming the product to the thing
the code named itself is exactly the house habit that produced `canvas` and
`workspace`.

**The case against:** to a general audience "survey" means a questionnaire, and
it is one of the least searchable words in English. It also describes the
*mechanic* rather than the *experience* — the pleasure is the driving, and this
name never mentions it.

### Checked and rejected

| candidate | why it died |
|---|---|
| `PARIS → DAKAR` | ASO owns the Dakar mark and runs the event. Also fails T1 — `→` is not in the glyph set |
| `ELSEWHERE` | three collisions (Elsewhere on Steam, Elsewhere Electric, El Paso Elsewhere). **Keep it as the reroll button label, where it is perfect** |
| `TERRARIUM` | Terrarium, Terrarium Builder, Terrarium Land on Steam, plus Terraria's shadow |
| `SUCCESSION` | the meaning is ideal; the search results are 100% HBO |
| `OVERLAND` | a 2019 game of that exact name |
| `CONTROL` | Remedy, 2019 |
| `NORDSCHLEIFE` / `STELVIO` | real places, and naming the game after one of sixteen destinations shrinks it |
| `CHAPMAN'S PEAK DRIVE` | the apostrophe is outside the 5×7 set's `safe()` filter |
| `1:1` | `:` is in the glyph set, but the name is unspeakable (T4) |

---

## 6. Recommendation

**Take `GROUND TRUTH`.** It is the only candidate that is simultaneously precise
about what the game *is* (measurement by going there), true to the codebase's
actual obsession (every doc in `docs/drive-*.md` is an argument with a data
source), clean on collisions, and legible in twelve gold characters on a
five-pixel grid. It passes all seven filters, and it passes T7 — nothing in it
promises a race.

Ship it as:

```
plate      GROUND TRUTH
sub-line   THE REAL WORLD, DRIVEN
boot       ground truth
<title>    Ground Truth — drive the actual Earth
```

**The honest case against, stated once more:** it is jargon, and the jargon is
invisible. Someone who does not work with spatial data hears a thriller. The
name's whole argument has to be carried by the sub-line and the first thirty
seconds of play — which, given that the default spawn parks you on the rim of
El Capitan under real Yosemite weather, is probably enough, but it is a bet.

**Runner-up, which fails differently: `BEAT THE BOUNDS`.** Where `GROUND TRUTH`
is precise and cold, this is warm and obscure — it means nothing to a stranger
and everything once explained, and the explanation *is* the tutorial. If the
project would rather be charming than exact, take it, and accept the three words.

**If the far-future strand is going to get built, stop and take `THE OLD ROADS`
instead.** That is a roadmap decision, not a naming one, and it should be made
before the name is, not after.

---

## 7. The slug — answered separately

**Recommendation: keep `drive`.** Not from inertia — it is the correct answer
under the rules that already exist, and a rename has costs worth naming.

**It satisfies the Tier B rule as written.** `platform-cells.md` asks for a
generic domain noun with bare verbs, and `@c15r/drive` is exactly that: it sits
beside `@c15r/models`, `@c15r/run`, `@c15r/canvas`, `@c15r/lit` without a
metaphor in sight. `07`'s complaint about `lit` was that it was clever;
`drive` has the opposite problem, and the opposite problem is the one the
rulebook prefers. The collision with the English verb only costs anything in
*search*, and search is a Tier A concern that the title now answers.

**A rename has four concrete costs.** Cells today share one origin, `parc.land`,
and are addressed by path (`/@<owner>/<name>` — see `cell-origin-isolation.md`).
So renaming `cells/drive`:

1. **Breaks every shared start URL.** `startDrive()` navigates to
   `?lat=…&lon=…&h=…&cam=chase&m=…`, and the game continuously rewrites the
   URL so the address bar is always a shareable link. Every one already sent
   points at the old path.
2. **Orphans the OSM tile cache.** The vector tiles live in the cell's public
   namespace at `~/osm/v2/<z>/<x>/<y>` (ADR-0095), written on miss and served
   thereafter from S3 with no compute. A new cell name is a new namespace and a
   cold cache — which, per `index.ts`'s own note, is the difference between a
   sub-second tile and a 503 from a rate-limited Overpass mirror.
3. **Would orphan every player's `localStorage` if origins ever split.** Today
   `drive.odo`, `drive.spots.v1`, `drive.dials`, `drive.alien` and `drive.clean`
   survive a path change because the origin is unchanged. Under the per-cell
   subdomain design in `cell-origin-isolation.md`, the slug *becomes* part of
   the origin — and the odometer is the one number in this game that is supposed
   to be permanent.
4. **Buys nothing the title does not already buy.** The slug is read by agents
   and by the URL bar. Neither cares that `drive` is a common word.

**If a rename happens anyway**, the candidates that survive the Tier B rule are,
in order: `ground` (pairs with the recommendation, and is the code's own noun —
`groundAt`, `roadCeiling`), `roads` (plural-as-collection, like `cells` and
`models`), `way` (OSM's own noun; the shortest honest option), `overland` (the
rig's declared class), `terrain` (already a dial, so it is ambiguous inside the
cell). Avoid `survey`, `roadbook`, `tulip` and `loanword` as slugs regardless of
the title — those are Tier A words, and the rulebook's whole point is that they
do not belong in a `target` string.

**Also fix in the same change:** the browser title's "top down", false since
chase became the default. It is the last piece of shell chrome still describing
the old prototype — `#reroll`, `#place`, `#speed` and `#hint` were already
retired in the DOM-menu work, exactly as `devtools/hud-catalog.md` recommended.
