# Drive: what this game is

Before authoring a campaign, a decision about what the campaign is *for*. This
document argues the niche from what is already built rather than from what a
driving game usually is — because the mechanics in this build already point
somewhere specific, and they do not point where the title does.

## 1. What the game already is, on the evidence

Not the pitch. The systems that exist, and what each one implies about the
player it expects.

**The whole real Earth, at ground level.** OSM vectors, real elevation, real
land cover, spawn anywhere. Nothing is authored terrain. The implication is
sharp and unusual: *the interesting places are not the ones a designer chose*.
Your street is in this game, and so is every road nobody would ever build by
hand.

**The survey.** Checkpoints every 250 m along each named road; drive a majority
and the road latches as **DRIVEN** (`SURVEY_P`, `SURVEY_MAJORITY`,
`surveyed()`). A road is only claimable once every tile touching it has actually
rendered — you cannot claim a 10 km pass by driving its first half-kilometre.
This is the only progression system in the build, and it measures **coverage**.
Not time, not speed, not placement.

**Fog of war.** Undriven world is hidden. The map is not given to you; it is
produced by driving.

**A horizon that is modelled.** Named summits are ranked by *apparent angle
after the curvature of the Earth* — a 1787 m ridge at 50 km outranks Whitney's
4421 m at 324 km, and anything below the horizon draws hollow. Nobody builds
that for a racing game. That is built for a player who is asking *what am I
looking at, and how far away is it.*

**An instrument, not a windscreen.** A deliberate pixel scale, one bitmap face,
a compass strip, a chart that is a map and a HUD that is a cockpit — kept
separate on purpose. Live weather off a real feed. An odometer in metres that
survives every session.

**A rig with an expedition loadout.** 2.4 kW solar, 10 kWh LiFePO4, algae
biodiesel, 120 L water, 1200 km range, 4×4, "OVERLAND / RALLY". That is a
vehicle provisioned to be *away from things for a long time*.

**And no competition anywhere.** No lap, no clock, no rival, no stage time, no
finish order. There is no code in this build that could tell you that you won.

## 2. The tension

Three fictions are currently in the game at once, and they are not compatible.

| in the build | what it says | supported by mechanics? |
| --- | --- | --- |
| **PARIS – DAKAR** (campaign title, splash) | a rally: stages, speed, a field | **no** — nothing races, nothing is timed |
| **SOLARPUNK RALLY RIG** (splash, spec sheet) | self-sufficient overland travel | partly — the loadout agrees, the word RALLY does not |
| **THE SURVEY** (the actual loop) | cover ground, claim roads, fill the map | **yes** — it is the only progression there is |

The campaign is dressed as a rally and plays as a cartographic expedition. The
sixteen destinations are a *greatest-hits list of famous driving roads* —
Stelvio, Trollstigen, Nordschleife, Transfăgărășan — which is exactly what a
driving game with no niche picks. Each is a fine place to spawn. None of them
needs the whole Earth, the fog of war, the survey, or the horizon model. They
would work identically in a game with fifteen hand-built tracks.

**That is the diagnosis: the content does not need the engine.** Any campaign
worth authoring has to need it.

## 3. The niche, aesthetically: a field instrument

The look already commits to this and should stop apologising for it.

The pixels are not nostalgia and should never be justified as retro. They are
**resolution** — the fidelity of a readout. Everything on screen is either the
world or an instrument reading the world, and the game is careful about which is
which (the chart is a map; the pins are a cockpit instrument; they do not mix).
The summit labels carry heights. The compass carries degrees. The odometer
counts metres. The weather is the real weather where you are.

The register to hold: **an honest instrument in an indifferent landscape.** Not
heroic, not cosy, not retro. The world does not care that you are there, the
truck is competent, and the display tells you the truth including when the truth
is that the terrain has not loaded yet.

What follows for art and copy:

- **Numbers are the flavour.** "4496 M · 18 CHECKPOINTS" is more evocative here
  than any adjective, because the number is *true about a real place*.
- **Never fake a reading.** A summit that is over the horizon draws hollow. A
  road that has not finished surveying says so. The instrument's credibility is
  the whole aesthetic; one decorative lie costs it.
- **Weather and light are content, not polish.** They are the difference between
  two drives down the same road, and they are free — they come from the real sky.

## 4. The niche, narratively: ground-truth

Here is the recommendation, and the case for it.

**The player is ground-truthing the map.** The roads in this game *are*
OpenStreetMap — the game streams them live. The fiction that costs nothing and
explains everything is that you are out there checking whether the map is right,
because the map is a claim someone made about a place and the only way to settle
it is to go.

Three reasons this one and not another:

**It is true, so it never fights the engine.** Every rough edge in this build
becomes fiction instead of a bug. A bridge OSM does not know about. A road whose
fragments disagree about their height. A tunnel that renders as a cliff. A
village square tagged as a motorway. Today those are defects in a driving
simulator; under this frame they are *the job*. The engine's failure modes
become its content, which is the single most valuable property a fiction can
have.

**It explains the survey exactly.** Why drive a *majority* of a road rather than
touch it? Because you are verifying it, and a verification you did from one end
is not a verification. Why does a road only become claimable once its
surrounding tiles have loaded? Because you cannot certify what you have not
seen. The mechanic that already exists gets a reason, rather than a reason being
invented and a mechanic bolted on.

**It scales to the whole Earth, which is the thing nobody else has.** A rally
needs a route; a courier needs an economy; a survey needs only somewhere nobody
has been yet — and there is always somewhere nobody has been. It makes the
player's own street a legitimate destination, which is the game's best trick and
is currently unused.

The register is **quietly bureaucratic and slightly absurd**, in the good way:
you are one rig doing an impossibly large job with perfect equanimity. Closer to
a lighthouse keeper's log than to a race broadcast.

### The alternatives, and why they lose

- **Keep the rally.** Needs a clock, a field, and stage times — three systems
  that do not exist, and whose addition would make the survey vestigial. It also
  wastes the Earth: a rally cares about a route, not a planet.
- **Courier / haulage** (the Euro Truck lane). Needs an economy, cargo,
  contracts, damage, and money. It is a good genre with excellent games already
  in it, all of which have hand-built worlds precisely *because* a courier loop
  needs authored density. Drive would compete on their turf with worse detail.
- **Pure travelogue** (the Flight Simulator lane — no goals, just go). This is
  the honest fallback and it is what the game is today. It is pleasant and it
  does not need a campaign at all, which makes it the wrong answer to the
  question being asked.

## 5. What this means for the campaign

The campaign stops being a list of famous roads and becomes **a survey with a
shape**. Concretely:

**A drive should exist because of something the engine can only do with the real
Earth.** The test for admitting a destination: *would this be just as good in a
game with fifteen hand-built tracks?* If yes, cut it. Stelvio's 48 hairpins are
a beautiful road and a weak destination — hairpins are the easiest thing in the
world to author. Badwater Basin at −86 m with the Panamint escarpment on the
horizon is a strong one, because the elevation, the light and the sightline are
*measured* and could not be faked as cheaply.

**Group by survey job, not by geography.** A chapter is a claim to be settled,
not a country. Candidate shapes the current engine already supports:

- **the traverse** — one long named road, end to end, claimed. The survey
  mechanic in its purest form.
- **the contradiction** — the map says a route connects; find out whether it
  does. Resolvable either way, and a dead end is a *result*, not a failure.
- **the sightline** — get somewhere a named summit is visible from, and confirm
  the height. Uses the horizon model, which nothing currently does.
- **the extreme** — the lowest road, the highest pass, the northernmost tarmac.
  These are facts about the real Earth, so they are checkable and they are
  *someone's* answer to argue with.
- **the ordinary** — survey a town's street grid to completion. Unglamorous, and
  the one that most needs the whole planet, because the point is that it works
  anywhere including where the player lives.

**Sixteen scattered spawns is not a campaign, it is a bookmark list.** The
current set should mostly survive as *bookmarks* (they are good places to start
a drive) but the campaign proper should be a smaller, ordered spine with reasons.

## 6. What this means for missions

The mission grammar today is `giver → dest`, with `within` metres and an
optional `via: { name, atLeast }`. Chapman's Run uses all of it, and the `via`
count is the interesting part: it is what turns "arrive at the headland" into
"take the pass".

That grammar already expresses **the traverse**, and nothing else. To carry the
niche, it needs to be able to say a few more things — in roughly this order of
value:

1. **A claim, not a destination.** "Survey `<road>` to completion" — the
   existing `via.atLeast` almost does this; the missing piece is a mission whose
   objective *is* the claim, with no `dest` at all.
2. **A verifiable fact.** "Report the elevation at the col", "confirm this
   connects". Needs a mission that completes on an *observation* rather than a
   position — and the game already computes elevations, headings, distances and
   summit angles it could ask about.
3. **A negative result.** A mission that can be honestly discharged with *no,
   the map is wrong* is the one that makes the fiction real rather than
   decorative. Nothing in the grammar can currently express failure-as-success.
4. **A region rather than a point.** "Survey any six roads within this bbox" —
   the unit that makes a town legible as a job.

And one structural gap that blocks all of it: **missions do not persist.**
`missionPhase` is a module variable, so finishing a job survives until reload
and no further. Any campaign with a spine needs that fixed first; the sync
built in `docs/drive-persistence.md` has the slot for it (`sk = MISSION#<id>`)
and does not use it yet.

## 7. What the niche rules out

A niche you cannot say no with is not a niche. Under this one:

- **No lap times, no rival, no podium.** If a stopwatch would improve it, it
  belongs in a different game.
- **No fictional places.** Everything is somewhere, and the somewhere is real
  and checkable. The moment one destination is invented, every other one's
  credibility drops to its level.
- **No collectibles that are not roads.** The unit of progress is a claimed
  road. Scattering pickups would be a second, weaker progression competing with
  the good one.
- **No hidden failure.** If the terrain has not loaded, the survey says so; if
  the road cannot be claimed yet, it says why. The instrument does not lie —
  including about itself.
- **No cosiness by default.** Warm where the real world happens to be warm. The
  landscape's indifference is the register.

## 8. The one thing to decide

Everything above follows from §4, which is the owner's call and not a technical
one: **is drive a survey, or is it a rally?**

The build says survey; the title says rally. Whichever way it goes, the other
should be removed rather than left to coexist — the campaign cannot be authored
against two fictions at once, and the sixteen-famous-roads list is what
authoring against neither produces.
