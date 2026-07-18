# The Graph, As Experienced

> A phenomenological description of the home graph — what a person sees, feels,
> and does, written deliberately WITHOUT implementation vocabulary. No file
> names, no library names, no architecture. The point: this document is the
> design material. Iterate on *it* — rewrite what the experience *should* be —
> and only then ask what has to change underneath. Describing the experience
> separately from the mechanism is how we escape status-quo bias: the current
> behaviour is recorded faithfully here, including its accidents, so that every
> sentence can be challenged on experiential grounds alone.
>
> Two registers are used throughout. **IS** — what happens today. **ACCIDENT?**
> — a property that may exist only because of how it was built, flagged so a
> redesign knows it is negotiable.

---

## 1. Arrival

You open your workspace and choose the map. The screen goes dark — not blank,
but *night*: a deep dusk field with faint atmospheric depth. Within a second or
two, points of light begin to appear — dozens, then hundreds — as if a valley
of settlements were coming into view from a ridge at nightfall. They do not
appear all at once: the brightest, most-alive things land first, and the field
fills inward from importance. A quiet counter in the corner tells you how much
of your world is charted so far — "800 of 6,500" — with the option to reveal
more.

The first impression is *aerial*. You are above and outside something that is
yours. It reads as terrain, not as a diagram: there are dense bright regions,
sparse dim outskirts, and darkness between. A handful of place-names float over
the largest settlements — five or six captions, no more — naming regions the
way a map names towns. Everything else is anonymous light.

If you do nothing, the field drifts. A slow orbital rotation, roughly a degree
every few seconds, keeps the scene alive without demanding anything. The
moment you touch it, the drift stops and waits; when you let go and idle, it
resumes. The map breathes on its own but never fights your hand.

- **IS**: importance-first arrival; the world fills in visibly rather than
  appearing complete.
- **ACCIDENT?**: the *amount* charted at arrival (~800) is a budget, not a
  design intention. Whether arrival should show "everything, dimly" or "the
  vital few, brightly" is an open experiential question.

## 2. What the picture says before you touch it

Everything visible encodes something, though none of it is explained on
screen:

- **Position is meaning.** Things that are *about* the same matters sit near
  each other. Neighbourhoods are topics. The layout is not radial, not
  hierarchical, not chronological — it is semantic adjacency, so the shape of
  the field is the shape of what you think about. A cluster reads as "I have a
  lot going on here"; an isolated point reads as a stray thought.
- **Light is attention.** Brightness and size track how alive a thing is — how
  recently and how often it has been touched, how connected it is, how much
  standing it has earned. The field is therefore a picture of *your attention*,
  not just your content: neglected things literally fade toward the dark.
- **Colour is kind.** Each type of thing (a note, a decision, a document, a
  running process) carries its own hue, consistently. You learn the palette by
  living with it, not from a legend — there is no legend.
- **Names are earned, from one budget.** At rest the map names a *couple dozen*
  things total — a single mind-sized budget (the focus band), spent across
  three distinct voices: a few **landmarks** (steady, always-named territory
  markers — the "north" that persists across visits), and, filling the rest of
  the budget, quiet **suggestions** (faint candidate names near where you're
  looking). Naming is scarce and the scarcity is *one number*, not a scatter of
  caps — and the two voices look different on purpose (see §4).
- **Threads are relations.** Fine lines connect some points. At rest they are
  quiet, almost subliminal — a webbing that suggests structure without
  drawing it. Some lines carry a barely-perceptible directional shimmer, a
  current, hinting that relations flow from somewhere to somewhere.

The overall composition at rest is deliberately *quiet*: places, not names; a
sense of where mass is, not an inventory. The map's first job is orientation —
"where is everything, and where has my attention been" — and it does that
without any interaction at all.

There are exactly **three label voices** (the reframe, now built), and their
whole job is to never be confused for one another:

- **Landmarks** — *orientation*. Persistent territory names, grid-distributed
  so one lives in each broad region of the sky; the same few survive an orbit,
  so you can build a memory of where things are. Steady, quiet, chip-backed.
- **Focus** — *ignition*. The names that appear only when you select or ask:
  the thing you touched and its immediate structure. Committed, accent-lit,
  the only articulate text on screen while a question is open. (Detailed in §4.)
- **Suggestions** — *periphery*. Faint candidate names near your line of
  approach — "you could look here." Deliberately a *different kind of mark*:
  no backing chip, dimmer, lighter. A suggestion can never be mistaken for a
  landmark or a result, because it isn't dressed like one.

The load-bearing rule: these three do not compete on a single size gradient.
They occupy different registers, so a dense region can hold quiet suggestions
*and* a steady landmark without the two blurring into an illegible pile.

- **IS**: no legend, no axes, no explanation anywhere. Comprehension is
  entirely by acquaintance.
- **ACCIDENT?**: the specific five-signal blend behind "brightness" is
  invisible and unexplainable in-situ. Whether light should mean *importance*,
  *recency*, *neglect* (inverted!), or be user-switchable is a real design
  choice currently made by default.

## 3. Moving through it

The camera is your body. One finger (or mouse drag) orbits — the field turns
under you. Pinch or scroll moves you closer and farther; holding a modifier
turns dragging into lateral travel. There is momentum and damping: movement
feels like swimming through something slightly viscous, never like snapping a
diagram around. The map is genuinely three-dimensional — clusters have
volume, and orbiting reveals parallax: near things slide across far things,
which is a large part of why it reads as *terrain* rather than *chart*.

As you dive toward a region, the map meets you halfway. A soft beam of
attention extends from you into the scene — whatever falls near your line of
approach brightens, and labels begin to *ignite* along it: the pointed-at
region gains names one by one, small text chips fading in over their points,
while everything off-beam stays a dim wash. Pull back and the names fade
again. The experience is of a torch swept across a dark archive: reading
happens *where you look*, and only there.

There is always a way home: an overview control returns you to the whole-field
framing in one eased flight. And there is a *depth dial* — a salience slider
that culls the field to the top fraction by aliveness: slide it down and the
map reduces to only the vital few; slide it up and the long tail of dim
material returns.

- **IS**: navigation is entirely spatial (orbit/dolly/pan); reading is gated
  by proximity + aim; no minimap, no zoom levels, no breadcrumbs of *where*
  you are in the field.
- **ACCIDENT?**: three-dimensionality itself. Parallax gives beauty and
  terrain-feel, but costs occlusion, depth ambiguity when tapping, and any
  possibility of stable spatial memory ("it was top-left" means nothing after
  an orbit). Whether 3D serves finding, or only serves *feeling*, is the
  biggest open question in this document.

## 4. Touching one thing

You tap a point — or its name, if it has one. The map is forgiving about
aim: a tap lands on the nearest point *as seen on screen*, within roughly a
fingertip's radius, and a visible name-chip is itself a target. Wobbly
touches still count; small drags don't accidentally select.

Selection is an event with ceremony:

1. **A ring** settles around the chosen point — a warm accent, unmistakably
   "you are here."
2. **The camera flies** to frame the point and its immediate surroundings, an
   eased swoop that recentres your orbit on it: from now on, turning and
   zooming pivot around *it*.
3. **Its neighbourhood ignites.** Directly related points light up and take
   labels; the threads fanning out from the selection take the accent colour
   and their directional current becomes visible. Everything unrelated drops
   further back into the wash. The structure *you are inside* becomes the only
   articulate thing on screen.
4. **The neighbourhood completes itself.** If related things weren't yet
   charted on the map, they materialise within a moment of selecting —
   arriving in place around the selection. The map never says "there are also
   three more things I'm not showing"; it just fills them in.
5. **A breadcrumb** appears at the edge of the view naming the selected thing
   — the one persistent textual anchor while you orbit.
6. **A context panel opens** beside/over the field (the palette becomes a
   field computer): the selected thing's name, kind, and vitals, its
   connections listed textually, and the actions you can take — open it in its
   home surface, edit, drill to a connection. Tapping a connection in the
   panel selects *that* node on the map — panel and map are two views of one
   selection.

Tapping empty darkness, or using the overview control, releases all of this:
ring gone, accent gone, labels return to places-only, the camera opens back
out.

- **IS**: selection = inspection + recentring + neighbourhood revelation, as
  one indivisible gesture. There is no hover state distinct from selection on
  touch; on desktop, pointing warms a point slightly before commitment.
- **ACCIDENT?**: the *panel* carries all affordances (open/edit/act); the map
  itself offers only "select." Whether actions belong on the map (radial
  menu, direct manipulation, drag-to-link) or beside it is unexamined
  inheritance.

## 5. Asking instead of wandering

The palette accepts language. Type a phrase — "that decision about storage" —
and the answer comes back *on the map*: the matching set lights up as
highlighted points, and the camera flies to frame the whole answer-set at
once, however scattered it is. The map becomes an answer surface: search
results are not a list elsewhere, they are *lit territory*.

This is the second navigation mode, and it changes the map's role: wandering
treats it as terrain; asking treats it as a display for answers. Both end at
the same place — a selection, a lit neighbourhood, a context panel.

- **IS**: query→highlight→frame; results also exist as a textual list in the
  palette for precision.
- **ACCIDENT?**: the two modes (wander/ask) are equal citizens today. A
  redesign could subordinate one to the other — e.g., a map you only ever
  *ask*, which then grows terrain around answers.

## 6. The field is alive

The map is not a snapshot. Every few seconds it quietly reconciles with
reality: a note captured from your phone appears in its neighbourhood; a
retired thing fades out; an agent working elsewhere in your workspace leaves
new points of light behind. Nothing announces these arrivals — no toast, no
badge — they are simply *there* on the next glance, the way a city seen from a
hill has new lights at midnight that weren't on at dusk.

Living with it produces a distinct feeling: the map is a *cohabited* place.
Other processes — your agents, your automations — visibly leave traces in the
same space where you think. Attention you (or they) spend anywhere in the
workspace slowly reshapes the brightness of the field itself.

- **IS**: ambient, unannounced liveness on a ~12-second heartbeat.
- **ACCIDENT?**: the silence of arrivals. Whether change should be legible
  (trails, pulses, a "what's new since I last looked" sweep) is a choice
  currently made by omission.

## 7. Two weathers

The map has two moods, switchable:

- **Dusk** (default): the luminous dark field described above. Glow, bloom,
  atmosphere, motion. Emotionally: contemplative, a night flight over your own
  mind. Optimised for *feeling* the shape of attention.
- **Paper**: the same territory as a printed star-atlas — warm cream ground,
  ink-drawn points, fine linework, many more captions, no glow, no motion.
  Emotionally: cartographic, editorial, daylight. Optimised for *reading*:
  more names are visible at once, contrast is typographic rather than
  luminous.

That the map has weathers at all is a statement: the same territory serves
two postures — immersive orientation and studied reading — and the person
chooses the register.

- **ACCIDENT?**: exactly two. A redesign might treat "weather" as a spectrum
  (task-tuned renderings: triage weather, writing weather, review weather).

## 8. Feel

The micro-texture matters and is deliberate:

- Nothing pops. Labels only fade; the camera only eases; arrival is a fill,
  not a flash. The one sanctioned "snap" is the selection ring.
- The map is *biased toward calm*: at rest it under-informs on purpose. Its
  failure mode is chosen to be "too quiet," never "too loud."
- Forgiveness over precision: fat-finger tolerance everywhere, drags never
  misread as taps, damping everywhere. It is built to be *petted*, on a phone,
  lying down.
- Depth cues are atmospheric (dimming, parallax, size) rather than drawn
  (no grid, no floor, no axes) — the space is implied, never diagrammed.

## 9. The honest frictions

Recorded so a redesign argues with reality, not a brochure:

1. **Depth is a lie you can't touch.** Tapping selects by screen proximity, so
   an occluded far point can lose to a near stray; there is no way to reach
   *behind* something except orbiting around it.
2. **Spatial memory doesn't accrue.** Free orbit means no stable "north."
   People remember *that* a cluster exists, not where it is; every return
   visit re-orients from scratch (places-captions mitigate, don't solve).
3. **The encodings are esoteric.** Light/size/colour/position all mean things,
   and none are ever stated. First-time comprehension is near zero; the map
   selects for people willing to acquire it by use.
4. **Names contend at density** *(largely addressed by the three-register
   build; watch for residue).* Suggestions are now capped per screen territory
   and drawn as pill-less whispers, so a dense cluster no longer piles chips or
   monopolises the budget — but very tight cores may still shimmer as the
   camera drifts and the per-cell winners change. Re-check against reality.
5. **Relations are undifferentiated.** Threads show *that* things connect and
   faintly *which way*, but not *why* — every kind of relation is the same
   line. The structure the map is proudest of is its least articulate layer.
6. **Emptiness is unexplained.** Darkness might mean "nothing there," "not
   charted yet," or "culled by the depth dial" — three very different truths
   with one appearance. The reach counter helps only if noticed.
7. **The map shows, but barely *does*.** Almost every consequential act
   (edit, open, link, retire) requires leaving for the panel or another
   surface. As a workplace the map is nearly read-only; as a *place* it is
   where you live. That tension is unresolved.
8. **Accessibility is unaddressed.** The experience is wholly visual-spatial
   and motion-rich: no non-visual equivalent, no reduced-motion posture, and
   colour-meaning with no redundant channel.

## 10. Prompts for the next description

Questions to answer *in experiential terms* before touching anything real:

- What is the unit of orientation — the individual fact, or the *place*?
  (Today: facts, with places as decoration. Inverting this changes everything.)
- Is light *importance* or *neglect*? Should the map be able to show "what
  I'm ignoring" as vividly as "what I'm touching"?
- Must it be 3D? What, experientially, would a 2.5D or fixed-viewpoint map
  lose — and would stable spatial memory be worth it?
- Should selection *do* more — is the map a viewer with a panel, or a
  workbench where linking, retiring, and annotating are direct manipulations?
- Should change be legible? What does "what happened here since yesterday"
  look like as weather rather than as a list?
- Who is the map for on a shared substrate — and what does *someone else's*
  attention look like in your sky?

---

*This document describes the experience as of 2026-07-18. When the experience
changes, rewrite the description first; treat divergence between this file and
the felt reality as a bug in one of them — and decide which.*
