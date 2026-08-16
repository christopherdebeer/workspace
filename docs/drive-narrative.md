# Drive: the narrative

Canonical, decided by the owner 2026-08-16. Supersedes the Car Zero frame that
briefly lived in `docs/drive-niche.md` §4 — that document remains the argument
about *niche* (evidence, aesthetic, prior art); this one is the fiction.

The one-sentence premise:

> **Drive between sealed city-states to certify the recovering land that
> separates them — until you discover that every road you certify is also a
> claim upon it.**

"Ranger" is the official role; "explorer" is how it should feel to play.

## 1. The world

After the undefined **Leaving**, humanity largely left the land — to space, or
elsewhere; the game never says. The major metropolitan areas are sealed under
enormous geodesic **Covers**: monolithic structures that read as landscape when
you are near them. It is deliberately unclear, city by city, whether a Cover is
fallout isolation, a self-contained polity, a quarantine keeping civilisation
*in*, or a machine for letting the world outside recover. The land between the
Covers was placed under an ancient **recovery Compact**.

**Rangers are among the few people permitted to cross it.** A ranger is
ecologist, mechanic, surveyor and diplomatic courier — but principally an
**independent witness**. A road is not considered open merely because it
appears on an old map. Someone must physically traverse it, inspect the land,
wake the sparse monitoring stations, and deliver an unedited journey record to
the other city.

The game begins as ordinary work. The larger narrative emerges when the player
discovers that **describing the world is also an act of governing it**.

## 2. The first assignment: renew the line

Paris Cover → Dakar Cover. The original Paris–Dakar journey, preserved without
being a race.

The docket is almost aggressively mundane:

- Traverse the dormant P–D line.
- Inspect seventeen **witness** stations.
- Record water, contamination, succession and human disturbance.
- Repair infrastructure only where necessary for passage.
- Deliver Paris's attestation and obtain Dakar's countersign.
- **Do not improve the road.**

A successful crossing renews limited relations between the two cities and
authorises a single exchange of people and material. You begin at a maintenance
aperture beneath Paris's shell and expect to finish at an equivalent aperture in
Dakar. **You may never see inside either city. The journey itself is the
cargo.**

## 3. What hijacks it: the map is law

The first disruption is not a superweapon, a secret passenger, or a
lore-delivering AI. It is a **classification error**. The player encounters
things the official system cannot describe:

- A supposedly abandoned witness station has recently been repaired.
- A forest recorded as unmanaged has carefully maintained firebreaks.
- A collapsed aqueduct is carrying clean water.
- Trees have been pruned back from the road — and no settlement appears on the
  map.
- One witness has been deliberately disabled, with a message in ranger
  notation: **LEAVE THIS ONE ASLEEP.**

Eventually the player learns what their certification actually does. It does
not merely report that the route is passable — **it makes the route legally
available again.** Once all the witnesses on a line are active, old systems can
dispatch clearing machines, extend city jurisdiction, and permit settlement
beyond the Cover.

The "empty" recovering world is not empty. Its inhabitants — or custodians, or
whatever they have become — have stayed **deliberately illegible** to the
cities. They ask the ranger not to certify the line.

And Dakar's claim is also legitimate: a political movement inside has voted to
emerge from the Cover. They believe the withdrawal has served its purpose and
that continued confinement is itself an injustice. The people outside believe
"return" is simply another word for dispossession.

So the first mission changes meaning:

> You thought you were proving that a road existed.
> You were deciding who had the right to use the land around it.

That is the narrative engine for the whole game: **every route can connect
something while simultaneously cutting through something else.**

## 4. The deeper narrative

The central mystery is not *what caused the apocalypse*. It is:

> **What did humanity agree to when it left — and does that agreement still
> bind anyone?**

Later journeys reveal that the Covers do not share a function, only an
architectural ancestry:

- Some genuinely protect inhabitants from contaminated ground.
- Some protect recovering ecosystems *from* their inhabitants.
- Some have become inward-facing city-states.
- Some are empty, but continue to participate through automated systems.
- Some may contain something no longer recognisably civic.
- Some insist they were never shelters at all.

The ranger's map calls all of them "cities" because that is an **institutional
category, not an observed fact** — the first classification error is on the
Service's own map.

Eventually it may become apparent that the ranger service's authority is
**orphaned**. The Compact is still cryptographically renewing itself, but
nobody knows whether the offworld signatories remain alive. Cities, rangers and
terrestrial communities have been obeying — or exploiting — the procedures of
an absent sovereign.

The player is not uncovering a single hidden truth. They are watching several
incompatible definitions of humanity, recovery and ownership collide.

## 5. The three lenses

Structural principles, not prose imitation:

- **Le Guin:** "empty land" is exposed as a cultural and political claim. The
  journey becomes an encounter between coherent ways of living, with no faction
  reduced to villain or utopia. The ranger must learn that **neutrality is also
  a position**.
- **Palmer:** classification, narration and legitimacy *are* the plot. The
  player's supposedly objective field report becomes a future historical
  document. What the interface permits them to record — and what it omits —
  matters as much as what they see.
- **Gibson:** everything arrives through material systems — battered solar
  hardware, obsolete contractors' marks, incompatible authentication layers,
  terse work orders, unexpectedly valid credentials. **Nobody explains the
  global system because nobody understands all of it.**

Synthesis: Le Guin's anthropology, Palmer's contested history, Gibson's
infrastructural intrigue.

## 6. How the game begins

No prologue explaining the Leaving. No archive describing the Covers. No
character asking questions everyone in the world should already know.

> At Paris South they give you two things: a key Dakar will accept and an
> instruction not to improve the road. The Service map shows Paris, Dakar, and
> between them a green field marked RECOVERY. Fifty-three kilometres out,
> someone has pruned the trees back from the first witness. The terminal
> classifies the clearing as natural.

That is enough. The player already knows something is wrong, but not yet what
kind of wrong.

## 7. Lexicon and register

The words the game uses, consistently, without ever defining them on screen:

**the Leaving** · **Cover** (never "dome") · **the Compact** · **the Service**
· **ranger** · **witness** (the stations; also what a ranger *is*) ·
**aperture** (the way in and out of a Cover) · **the line** (a route between
two Covers) · **attestation / countersign** · **RECOVERY** (the map's word for
everything between) · **ranger notation** (the terse field shorthand other
rangers' marks are written in).

The register is institutional and terse — work orders, dockets, station labels
— with the cracks showing. The build's existing all-caps clipped HUD voice
("4496 M · 18 CHECKPOINTS", "SURVEYED · DRIVE A MAJORITY") is already this
voice; the narrative arrives by making that voice occasionally *wrong* about
what the player can see.

## 8. Fiction → build: what already agrees

The reason this narrative is right for *this* engine — most of it is already
true in code:

- **"Someone must physically traverse it."** `surveyed()` refuses to close a
  road until every tile touching it has rendered, and a claim needs a driven
  majority. The build already refuses to certify what has not been seen. The
  fiction re-reads an existing gate; nothing is bolted on.
- **"The journey itself is the cargo."** The persisted state *is* an unedited
  journey record — checkpoints keyed by position, counts, claim times, an
  odometer in metres. The attestation the ranger delivers is literally what
  `/state` already syncs.
- **"Do not improve the road."** The engine cannot modify terrain. The
  docket's strangest instruction is simply the physics of the game — the best
  kind of rule, because it can never be broken by accident.
- **The green field marked RECOVERY.** Fog of war plus the overview backdrop:
  un-surveyed land already renders as an undifferentiated field the player's
  traversal resolves into fact.
- **Roads real, buildings invented.** The terminal's map is the old,
  pre-Leaving survey — in-world it *is* OpenStreetMap. Roads are the durable
  bones the Compact preserved; whatever stands beside them now is none of the
  old map's business. The engine's one apparent shortcut is the fiction's
  premise.
- **The Cover deletes the game's hardest problem.** The engine cannot render a
  believable Paris — and now it never has to. A Cover is one monumental object
  that becomes landscape when near, and the playable world is the land
  between, which is exactly where the engine is strongest. Aperture = spawn.
- **The anomalies are renderable today.** "A collapsed aqueduct carrying clean
  water" — the engine grew aqueduct arches this same week. The firebreaks, the
  pruned corridor, the repaired station: all are small placed deviations from
  the generated norm, which is the cheapest possible content.

## 9. What it demands, in build order

1. **Mission persistence** (unchanged, still first). `missionPhase` is a module
   variable; a campaign with legs needs completed legs to stay completed. The
   sync reserves `MISSION#<id>` and nothing writes it.
2. **The witness station as a content type.** A placed object on the line;
   drive to it, wake it. The campaign schema grows `stations[]`; "wake the
   witness" is expressible in today's giver/dest grammar. Seventeen of them
   *are* the P–D campaign's spine.
3. **The docket surface.** The leg brief as a readable page in the menu — the
   work-order register of §7, replacing nothing (the mission brief already
   exists; it grows a page).
4. **Observation recording.** Water, contamination, succession, disturbance as
   readings taken at stations. First pass automatic: arriving records. The
   Palmer mechanic — categories that don't fit what you see — comes later and
   lands on this surface.
5. **The withholding choice.** By the time the hijack lands, certification must
   be *per witness and refusable* — LEAVE THIS ONE ASLEEP only means something
   if the player can comply. A woken/left state per station is the one
   genuinely new system the narrative demands. Leg 1 does not need it; the
   campaign's turn does.

## 10. What it retires and rules out

Retired:

- **Car Zero and the rally-as-institution.** No field behind you, no rally
  desk. The Service is not a sporting body.
- **"SOLARPUNK RALLY RIG"** as splash copy, eventually — the rig is a Service
  vehicle. (The rig itself is unchanged; its loadout was always a ranger's.)

Ruled out, inheriting the instrument rules from `docs/drive-niche.md` §3 and
sharpening them:

- **No prologue, no codex, no lore dumps.** The world is learned the way the
  reader of a good novel learns it: by being in it. Anyone on the radio already
  knows what a Cover is and would never explain one.
- **No faction reduced to villain or utopia.** Dakar's emergence movement and
  the illegible custodians are both right. The game takes no side; the player
  must, eventually, and quietly.
- **No fictional places.** The line is real, the stations sit at real
  coordinates, the clearing at kilometre fifty-three is a real clearing.
- **No lying instruments — but institutionally wrong ones, yes.** The terminal
  saying CLEARING: NATURAL about pruned trees is not the renderer lying; it is
  the *category* failing. The screen stays honest about what it shows and
  becomes unreliable only about what it means. That distinction is the whole
  game.
