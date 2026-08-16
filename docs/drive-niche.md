# Drive: what this game is

The niche, argued from what is already built — and now settled by the owner:
**it is both.** Rally is the *feel* (the rig, the stages, the romance of
Paris–Dakar); the survey is the *mechanic* (the only progression in the code);
solarpunk is the *licence* (a rebuilt world explains why the settlements on
screen are not photographs). The first draft of this document posed rally vs
survey as a choice. The owner's answer is that they fuse — and there is a
figure in real rally sport where they genuinely do (§4).

## 1. What the game already is, on the evidence

Not the pitch. The systems that exist, and what each implies about the player
it expects.

**The whole real Earth, at ground level.** OSM vectors, real elevation, real
land cover, spawn anywhere. Nothing is authored terrain. The implication is
sharp: *the interesting places are not the ones a designer chose.* Your street
is in this game, and so is every road nobody would build by hand.

**The survey.** Checkpoints every 250 m along each named road; drive a majority
and the road latches as **DRIVEN**. A road is only claimable once every tile
touching it has actually rendered — you cannot claim a 10 km pass by driving
its first half-kilometre. This is the only progression system in the build, and
it measures **coverage**. Not time, not speed, not placement.

**Fog of war.** Undriven world is hidden. The map is not given to you; it is
produced by driving.

**A horizon that is modelled.** Named summits ranked by *apparent angle after
the curvature of the Earth*; anything below the horizon draws hollow. That is
built for a player who asks *what am I looking at, and how far is it.*

**An instrument, not a windscreen.** A deliberate pixel scale, a compass strip,
a chart that is a map and a HUD that is a cockpit, kept separate on purpose.
Live weather off a real feed. An odometer in metres that survives every session.

**A rig with an expedition loadout.** 2.4 kW solar, 10 kWh LiFePO4, algae
biodiesel, 120 L water, 1200 km range, 4×4. A vehicle provisioned to be *away
from things for a long time*.

**And no rival on screen anywhere.** No lap, no clock, no stage time, no finish
order. Nothing in the code could tell you that you won a race. Whatever the
rally is in this game, it is not something you can lose to another car.

## 2. The licence: why real roads and invented towns cohere

The solarpunk future is not set dressing — it resolves the build's one apparent
contradiction. The game renders **real road geometry** under **buildings it
invents**, and without a fiction that mismatch reads as a shortcut. With one,
it reads as the world:

> **Roads are the old bones. Buildings are the new flesh.** The road network
> survived the transition — cuttings, passes, bridges, the engineering is
> durable — but what people built beside the roads has been rebuilt to a
> different pattern since. So the *map of the roads* is old, trusted, and due
> for verification; everything standing beside them is new and none of the
> surveyor's business.

This is exactly what the engine does: OSM's ways are treated as ground truth
and everything else is generated. The fiction should keep matching that line —
future work on settlements can be as stylised as it likes *beside* the road,
and must stay honest *about* the road.

It also sets the tone of the apocalypse, which matters: **solarpunk is after a
transition, not after an extinction.** Nobody on the radio is desperate. The
world drew down, travel stopped being routine, long-distance networks went
quiet and maps went stale — that is all the catastrophe the premise needs, and
it is why the register can stay warm without going cosy. The landscape is still
indifferent; the people in it are fine.

## 3. The niche, aesthetically: a field instrument

Unchanged from the first draft, and worth restating as rules:

- The pixels are **resolution, not nostalgia** — the fidelity of a readout.
- **Numbers are the flavour.** "4496 M · 18 CHECKPOINTS" beats any adjective
  because it is true about a real place.
- **Never fake a reading.** Over-horizon summits draw hollow; an unclosed
  survey says so. One decorative lie costs the whole aesthetic.
- **Weather and light are content, not polish** — the difference between two
  drives down the same road, for free, from the real sky.

The visual reference worth naming is **Simon Stålenhag**: ordinary, accurately
observed landscape with one engineered thing standing in it that is slightly
too large and entirely matter-of-fact. Drive's aqueduct viaducts over real DEM
already produce this register by accident. It is the right one on purpose.

## 4. The niche, narratively: CAR ZERO

Real rallies have a car that is neither first nor racing. Before the field is
allowed onto a stage, a **course car — "car zero"** — drives it: checks the
route is passable, the hazards are as noted, the road book matches the road.
The rally exists *behind* that car. It never races anything, and the whole
event depends on it.

**The player is Car Zero.** The rally is real, and it is the fiction's engine —
but it is always behind you.

The frame, in full:

- **The world:** a couple of generations after the transition. Settlements are
  local, solar, comfortable, and disconnected by land. Flight is gone or
  rationed; the sea is slow; the old roads are *rumoured* to still be there.
  The last complete road survey predates the transition — it is, in-world, the
  old map. (Out of world: it is OpenStreetMap. The fiction and the data source
  are the same object.)
- **The institution:** the rallies are being re-founded — not as races first,
  but as the ceremony by which the long routes are reopened. A route that
  carried a rally is a route the whole world knows is drivable again. Trade
  follows. The event is the *proof*, the way a bridge opening is a proof.
  Paris–Dakar is the first, because it was the most famous crossing of the
  hardest ground.
- **The player's job:** you drive ahead of everything, alone, certifying the
  route leg by leg. The survey mechanic *is* the job: a stage is open when its
  roads are DRIVEN. The rally follows you at a distance you never see — you
  hear it on the radio, days behind, growing.
- **Why you specifically:** the previous Car Zero's log ends mid-route. Their
  rig is missing; their last certified stage is where your campaign starts.
  Recovering their route — and eventually the reason the log stops — is the
  doled-out thread the campaign reveals leg by leg.

Why this frame and not another:

**It fuses the three registers instead of choosing.** The rally supplies feel
(stages, road books, liveries, the Dakar romance, a reason the rig is called a
RALLY RIG); the survey supplies the verb (certify, which is what the mechanic
already measures); solarpunk supplies the stakes (reconnection, not conquest —
Death Stranding's rope, §5). Nothing has to be removed; each part carries the
weight it is built for.

**It explains every absence as a feature.** No rivals on screen — Car Zero is
ahead of the field by definition. No clock — certification is not timed, it is
*true or not*. No crowds — the route is not open yet; that is why you are
here. The build's silences all become the premise.

**It keeps the existing title.** PARIS – DAKAR stops being a genre reference
and becomes the campaign's literal subject: reopening that route. Future
campaigns name themselves: the Panamericana, Cape to Cairo, the Silk Road,
Route 6 across Iceland's interior. Each is a real historic route, which honours
the instrument rule — everything in this game is somewhere.

**How the story is doled out — diegetically, never cutscenes:**

1. **The road book.** Each leg's brief, in the clipped register the missions
   already use ("TAKE THE PASS TO THE HEADLAND"). Route notes carry the
   narrator's voice a line at a time.
2. **The radio.** The rally desk, weather calls, and — rarely — the field
   itself, arriving somewhere you certified a week ago. The Firewatch
   mechanism: story delivered *during* traversal, never instead of it.
3. **The predecessor's log.** Found a page at a time at places their route
   book names: fuel stops, cols, the far end of a causeway. The Outer Wilds
   mechanism: the log is also the map of where to go next.

## 5. Prior art — to take from, and to be warned by

### Death Stranding (2019) — what it was actually about

Kojima's stated seed is Kōbō Abe's parable of the first two tools: the **stick**
(to keep things away) and the **rope** (to hold what matters close). Games, he
argued, had spent forty years on sticks; Death Stranding is a rope. Concretely:
a fractured, post-catastrophe America; a courier who walks cargo between
isolated cities and, settlement by settlement, connects them to a shared
network. Underneath the surreal apparatus it is about **connection as labour** —
reconnection of a fragmented polity (it is very much a post-2016 work), the
dignity of logistics work, grief, and parenthood. The traversal itself is the
game: terrain, load, balance, route choice — walking made mechanical.

Three lessons transfer directly, one warning too:

- **The fiction was isomorphic to the mechanic.** Deliveries knit the network;
  the network literally enables help (other players' structures appear). The
  story and the loop are the same act. Car Zero has this property: certifying
  the stage *is* opening the route *is* the plot advancing.
- **Asynchronous solidarity, zero competition.** Other players are present
  only as helpful traces — bridges, ladders, likes. If drive ever grows a
  multiplayer surface, this is the shape: the field that follows you could one
  day be *actual other players' claims*, seen only as roads already DRIVEN.
- **Terrain as the antagonist** carries a whole game without combat.
- **The warning:** Kojima buried it all under hours of cutscene. Drive's
  delivery must stay in the road book and the radio — the game is the drive.

### The rest of the field

- **Outer Wilds** — the truest survey game ever made: progress is *only
  knowledge*, structured by a ship's log, run by a campfire-and-banjo space
  program that is the most solarpunk institution in games. Its lesson is §4's
  log mechanism, and the future mission grammar where completion is an
  *observation* rather than an arrival.
- **Sable** — open-world bike traversal, no combat, Moebius flats; the nearest
  aesthetic cousin. Its critique: frictionless to the point of weightlessness,
  and its tasks are fetch quests wearing robes. Drive's answer is physics and
  truth — the terrain pushes back and the numbers are real.
- **Season: A Letter to the Future** — a cyclist documents a valley before it
  is lost; the exact elegiac register and almost the exact premise. Its
  critique is the sharpest one for drive: **documentation had no mechanical
  consequence** — the journal is a scrapbook the game never reads. Drive's
  survey *latches state the world responds to*. Keep that difference sacred.
- **Pacific Drive** — the car as maintained companion and instrument panel
  intimacy, in a weird exclusion zone. Take the relationship with the rig;
  note that its zone is authored, and drive's is the Earth.
- **The Long Dark** — the quiet apocalypse and the indifferent landscape read
  through instruments (temperature, wind). The closest register to §3.
- **FUEL (2009)** — the cautionary tale. A 14,000 km² world derived from real
  data, and nothing that needed it: big, empty, pointless. That is drive's
  failure mode if the campaign is ever content that "does not need the engine."
- **Snowrunner** — rally-feel truth: terrain difficulty as the entire opponent,
  logistics as satisfaction. No fiction to speak of; drive can have both.
- **Breath of the Wild** — the post-calamity pastoral and map-reveal-as-reward.
  Its towers are the ancestor of every fog-of-war loop including drive's.
- **NieR: Automata** — surveying for an authority whose purpose unravels. If
  the campaign's mystery ever needs teeth: *why* did the previous Car Zero stop
  filing?
- **On paper:** Becky Chambers' *Monk & Robot* (the post-transition solarpunk
  register — gentle, purposeful, quietly asking what the job is for), Le Guin's
  *Always Coming Home* (a future society rendered as field notes — the survey
  as literature), Miyazaki's *Nausicaä* (ecology after catastrophe without
  despair), Stålenhag (§3).
- **The real practice**, which is the trump card: OpenStreetMap surveying
  itself, StreetComplete's quest loop, geocaching, and the **Degree Confluence
  Project** — humans who travel to integer lat/lon intersections purely to
  photograph and log them. Ground-truthing is not an invented fiction; it is an
  existing human devotion. Drive is its game.

## 6. What this means for the campaign

**A campaign is a route, and a route is legs.** Not sixteen scattered spawns —
an ordered spine with a direction of travel. PARIS – DAKAR: Trocadéro south,
legs sized to a session, each leg a stage to certify. The current sixteen
destinations mostly survive as *bookmarks* (good places to freely drive); the
handful on the route become stages.

**A stage is a survey job with a road book page.** The admission test for a
stage stands from the first draft, sharpened: *would this stage be just as
good in a game with fifteen hand-built tracks?* If yes, it has no business in
the campaign. The engine's stages are the ones only the real Earth can supply —
a real col, a real causeway, a road the old map draws and the ground disputes.

**Mission grammar, in order of need:**

1. **The claim as objective** — "certify `<road>`": a mission whose completion
   *is* the DRIVEN latch, no `dest`. (Nearly expressible today; `via.atLeast`
   is its prototype.)
2. **The observation** — completion on a reading, not a position: report the
   elevation of the col, confirm the crossing exists. The game already computes
   everything it would ask about.
3. **The negative result** — a mission honestly discharged with *the map is
   wrong*. The moment the game can say that, the fiction is real. (And the
   engine's data defects become content, not bugs.)
4. **The region** — "certify six roads inside this box": how a town becomes a
   job.

**The structural gap is unchanged: missions do not persist.**
`missionPhase` is a module variable; a campaign with legs needs completed legs
to stay completed. The sync shipped in `docs/drive-persistence.md` reserved the
slot (`sk = MISSION#<id>`) and nothing writes it yet. This is the first
engineering task of the campaign work, before any authoring.

## 7. What the niche rules out

A niche you cannot say no with is not a niche. Under Car Zero:

- **No rival on screen, ever.** The rally is real and always behind you. The
  moment another car is beside you, this is a racing game and the survey is
  vestigial.
- **No stopwatch on objectives.** Certification is true or not-yet, never fast.
- **No invented places.** Every destination is somewhere, checkable, on Earth.
  The route book's credibility is the game's.
- **No collectibles that are not roads** (the predecessor's log pages live *at*
  places the route book names — they are reasons to go somewhere real, not a
  second currency).
- **No hidden failure.** The instrument does not lie, including about itself.
- **No desperation.** The transition is behind the world. Melancholy is
  allowed; the missing Car Zero earns it. Grimdark is not.

## 8. Decided

Rally feel · survey mechanic · solarpunk licence — fused as **Car Zero**: the
player certifies the route, and the rally the world can see follows behind.
The campaign work now has an order: persist missions first, then author the
Paris–Dakar spine as stages with road-book pages, then grow the grammar
(claim-as-objective → observation → negative result → region).
