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

## 0. The model: a sky you inhabit, and the curl

The graph is your own night sky, and you are *inside* it — on the ground, under
a dome of stars, not above a map of them. Direction on the sphere is meaning;
brightness and size are attention; nothing is culled from the shell, only dimmed.

**You never move. The sky does.** There is no camera to fly, no orbit, no
travelling toward things. Instead a single continuous zoom bends *the sky
itself*. Fully curled, it wraps around you — the planetarium, stars to every
horizon and straight overhead. Unroll it and it peels open around the point you
are facing, arc lengths preserved, until at the midpoint it lies exactly flat: a
**planisphere**, the whole sky spread as one chart in front of you, its far rim
(the point once behind your head) just past the edge of view. Keep going and the
chart re-curls the other way into a **globe held at arm's length** — the orrery
— the patch you were studying resting on its near face. Dome, chart, globe are
not three views with transitions between them; they are three points on one
motion, and you can stop anywhere along it.

One gesture does the turning at every point on that motion: you drag, and the
sky (or chart, or globe) rotates under your hand with the same feel throughout —
drag-the-sky when you are inside it, spin-the-globe when you are outside it, and
never an inverted control or a far-side surprise in between. There is no seam to
cross because there is no transition — only the sky, more or less curled.

- **IS**: one fixed viewpoint; zoom is a continuous curl of the sky's own
  geometry, not motion through space; drag rotates the shell with one consistent
  hand-feel everywhere on the curl.
- **ACCIDENT?**: that the far end of the curl is a *held globe* (rather than, say,
  unrolling forever into an ever-larger flat chart) is one chosen resolution of
  "what is the most zoomed-out thing." So is the choice to *arrive* holding that
  globe (see §1).

## 1. Arrival

You open your workspace and choose the map. The screen goes dark — not blank,
but *night*: a deep dusk field. You arrive already holding your world as a
globe at arm's length — the whole of it, gathered — and within a second or two
points of light begin to appear on it: the brightest, most-alive things first,
the field filling inward from importance. A quiet counter in the corner tells
you how much of your world is charted so far — "800 of 6,500."

Then the map keeps charting *itself*. You do not tap "+more": once the first
band has settled, the sky quietly accretes the rest, a couple hundred stars at a
time, growing outward from importance until your whole substrate is present. One
control pauses that in-fill (and resumes it) if you want the field to hold
still — but the default is a sky that finishes drawing itself while you watch.

The field does **not** drift on its own. A place you inhabit holds still; the
sphere waits for your hand. (An earlier version turned slowly by itself — that
idle rotation is gone. Stillness is the resting state.)

- **IS**: importance-first arrival on the held globe; the world fills in visibly
  and keeps filling without a manual step; at rest, nothing moves.
- **ACCIDENT?**: the *amount* charted before the first pause (~800) is a budget,
  not an intention. And arriving at the fully-uncurled *globe* end — rather than
  under the dome — is a chosen opening posture, not a law.

## 2. What the picture says before you touch it

Everything visible encodes something, though none of it is explained on
screen:

- **Position is meaning.** Things that are *about* the same matters sit near
  each other on the shell. Neighbourhoods are topics. The layout is not radial,
  not hierarchical, not chronological — it is semantic adjacency, so the shape of
  the field is the shape of what you think about. A cluster reads as "I have a
  lot going on here"; an isolated star reads as a stray thought.
- **Light is attention.** Brightness and size track how alive a thing is — how
  recently and how often it has been touched, how connected it is, how much
  standing it has earned. The field is therefore a picture of *your attention*,
  not just your content: neglected things literally fade toward the dark. A
  louder star also sits a hair closer to you, so importance carries a faint
  cue of nearness as well as brightness.
- **Colour is kind.** Each type of thing (a note, a decision, a document, a
  running process) carries its own hue, consistently. You learn the palette by
  living with it, not from a legend — there is no legend.
- **Names are earned, from one budget.** At rest the map names a *couple dozen*
  things total — a single mind-sized budget (the focus band), spent across
  distinct voices: a few **landmarks** (steady, always-named territory markers —
  the "north" that persists across visits), and, filling the rest of the budget,
  quiet **suggestions** (faint candidate names near where you're looking). Naming
  is scarce and the scarcity is *one number*, not a scatter of caps.
- **Threads are relations.** Fine lines connect some stars. At rest they are
  quiet, almost subliminal — a webbing that suggests structure without drawing
  it. Under focus, some lines carry a travelling shimmer, a current, showing that
  a relation flows from somewhere to somewhere.

The overall composition at rest is deliberately *quiet*: places, not names; a
sense of where mass is, not an inventory. The map's first job is orientation —
"where is everything, and where has my attention been" — and it does that
without any interaction at all.

There are exactly **three label voices**, and their whole job is to never be
confused for one another:

- **Landmarks** — *orientation*. Persistent territory names, distributed so one
  lives in each broad region of the sky; the same few survive as you turn, so you
  can build a memory of where things are.
- **Focus** — *ignition*. The names that appear only when you select or ask: the
  thing you touched and its immediate structure. Committed, accent-lit, the only
  articulate text on screen while a question is open. (Detailed in §4.)
- **Suggestions** — *periphery*. Faint candidate names near where you are facing
  — "you could look here." Deliberately a *different kind of mark*: no backing,
  dimmer, lighter. A suggestion can never be mistaken for a landmark or a result,
  because it isn't dressed like one.

The load-bearing rule: these three do not compete on a single size gradient.
They occupy different registers, so a dense region can hold quiet suggestions
*and* a steady landmark without the two blurring into an illegible pile.

- **IS**: no legend, no axes, no explanation anywhere. Comprehension is entirely
  by acquaintance.
- **ACCIDENT?**: the multi-signal blend behind "brightness" is invisible and
  unexplainable in-situ. Whether light should mean *importance*, *recency*,
  *neglect* (inverted!), or be user-switchable is a real design choice currently
  made by default.

## 3. Moving through it: the curl

There is no body to move. Two motions is the whole vocabulary: **turn** and
**curl**.

**Turning.** You drag and the sky turns under your hand; the stars wheel past
the way the real sky does when you crane your neck. You can bring any region to
face you and tip toward the point once straight overhead — and the motion never
snarls, tumbles, or locks at the top the way an early version did. There is a
level horizon that stays level: no matter how you have turned, "up" is still up.
When you fling the sky and let go, it keeps drifting a moment and coasts to rest,
like spinning a globe — a small physical courtesy, not a snap-back.

**Curling.** Rolling the wheel (or pinching) is not travel — you never leave the
ground. It runs the one continuous zoom of §0. Near one end it is a *telescope*:
the field narrows from the whole dome at a glance down to a tight, deep crop that
pulls faint far things into reading size, and as it narrows your dragging
automatically gets finer, so a hard zoom stays steerable. Past that it becomes
the *unfurl*: the dome peels flat into the planisphere and on out into the held
globe. Magnifying and unfurling are the same gesture at different depths — one
axis, no seam, no mode to switch.

**The air itself.** The sky is not flat black while it is curled around you. It
deepens from a faint warm glow low on the horizon — the dusk-band, the ground's
own light — up to a deep, faintly-blue zenith, and darkens again below. Because
that gradient belongs to the *world* and turns with the sky rather than with your
eye, it reads as *atmosphere*: the warm band stays at the horizon and the dark
stays overhead as you turn, and that alone tells you which way is up before you
have found a single landmark. As you unfurl toward the flat chart the air thins
away — a chart has no airglow — and it is gone by the time you are holding the
globe. (It is deliberately dim — it never glows, never competes with a star, and
can be dialled from full gradient down to a plain void.)

**Reading where you face.** Whatever falls near the point you are facing
brightens, and labels begin to *ignite* there: the centred region gains names one
by one, small text fading in over their stars, while everything toward the edges
stays a dim wash. Turn away and the names fade again. The experience is of a
torch fixed to your gaze and swept across a dark archive by turning the sky:
reading happens *where you face*, and only there.

There is a *depth dial* — a salience control that thins the field to the top
fraction by aliveness: slide it down and the map reduces to only the vital few;
slide it up and the long tail of dim material returns.

- **IS**: navigation is turn + curl from one fixed viewpoint; reading is gated by
  what you have brought to centre; no minimap, no travel, no breadcrumb of
  *where* you are (there is nowhere to be — you are always at the centre).
- **ACCIDENT?**: that turning is *free* (the shell can rotate to any orientation)
  means absolute bearing still drifts unless landmarks re-anchor it. A detented
  or landmark-snapping turn is an unexplored alternative.

## 4. Touching one thing

You tap a star — or its name, if it has one. The map is forgiving about aim: a
tap lands on the nearest star *as seen on screen*, weighted toward the ones
already bright and named, and a visible name is itself a target. Wobbly touches
still count; small drags don't accidentally select.

Selection happens in **two beats**, and the first one does not shove you around:

1. **First tap — it lights in place.** A ring settles around the chosen star (a
   warm accent, unmistakably "you are here"), its neighbourhood ignites, and the
   context panel opens — but *the sky holds still*. You inspect without being
   moved. Directly related stars light up and take labels; the threads fanning
   out take the accent colour and their current becomes visible; everything
   unrelated drops further into the wash. If related things weren't yet charted,
   they materialise within a moment, arriving in place around the selection.
2. **Second tap on the same star — the sky turns to it.** Now the sky wheels to
   bring that star dead ahead and steps the curl in a notch, centring and
   enlarging it. Motion happens only when you ask for it, on the second beat —
   never as a side effect of a first touch.

Alongside: a **breadcrumb** names the selected thing at the edge of view — the
one persistent textual anchor while you turn — and the **context panel** (the
palette becoming a field computer) carries its name, kind, and vitals, its
connections as text, and the actions you can take: open it in its home surface,
edit, drill to a connection. Tapping a connection in the panel selects *that*
star — panel and sky are two views of one selection.

Tapping empty darkness releases all of this: ring gone, accent gone, labels
return to places-only.

- **IS**: selection separates *inspecting* (first tap, camera still) from
  *facing* (second tap, sky turns + steps in). There is no hover distinct from
  selection on touch; on desktop, pointing warms a star slightly before
  commitment.
- **ACCIDENT?**: the *panel* carries all affordances (open/edit/act); the sky
  itself offers only "select" and "face." Whether acts belong on the sky (direct
  manipulation, drag-to-link) or beside it is unexamined inheritance.

## 5. Asking instead of wandering

The palette accepts language. Type a phrase — "that decision about storage" —
and the answer comes back *on the map*: the matching set lights up as
highlighted stars, and the sky turns to bring the whole answer-set to centre at
once, however scattered it is. The map becomes an answer surface: search results
are not a list elsewhere, they are *lit territory*.

This is the second navigation mode, and it changes the map's role: wandering
treats it as terrain; asking treats it as a display for answers. Both end at the
same place — a selection, a lit neighbourhood, a context panel.

- **IS**: query→highlight→face; results also exist as a textual list in the
  palette for precision.
- **ACCIDENT?**: the two modes (wander/ask) are equal citizens today. A redesign
  could subordinate one to the other — e.g., a map you only ever *ask*, which
  then grows territory around answers.

## 6. The field is alive

The map is not a snapshot. Every few seconds it quietly reconciles with reality:
a note captured from your phone appears in its neighbourhood; a retired thing
fades out; an agent working elsewhere in your workspace leaves new points of
light behind. Nothing announces these arrivals — no toast, no badge — they are
simply *there* on the next glance, the way a city seen from a hill has new lights
at midnight that weren't on at dusk.

Living with it produces a distinct feeling: the map is a *cohabited* place. Other
processes — your agents, your automations — visibly leave traces in the same
space where you think. Attention you (or they) spend anywhere in the workspace
slowly reshapes the brightness of the field itself.

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
  ink-drawn stars, fine linework, many more captions, no glow, no motion.
  Emotionally: cartographic, editorial, daylight. Optimised for *reading*: more
  names are visible at once, contrast is typographic rather than luminous.

That the map has weathers at all is a statement: the same territory serves two
postures — immersive orientation and studied reading — and the person chooses the
register.

- **ACCIDENT?**: exactly two. A redesign might treat "weather" as a spectrum
  (task-tuned renderings: triage weather, writing weather, review weather).

## 8. Feel

The micro-texture matters and is deliberate:

- Nothing pops. Labels only fade; the curl and the turn only ease; arrival is a
  fill, not a flash. The one sanctioned "snap" is the selection ring.
- The map is *biased toward calm*: at rest it under-informs on purpose, and it
  holds perfectly still until touched. Its failure mode is chosen to be "too
  quiet," never "too loud."
- Forgiveness over precision: fat-finger tolerance everywhere, drags never
  misread as taps, momentum and easing everywhere. It is built to be *petted*, on
  a phone, lying down.
- Depth cues are atmospheric (dimming, the faint nearness of louder stars, the
  turning airglow) rather than drawn (no grid, no floor, no axes) — the space is
  implied, never diagrammed.

## 9. The honest frictions

Recorded so a redesign argues with reality, not a brochure:

1. **The far side.** On the held globe the back of the shell sits behind the near
   face. It can be hidden hard (nothing past the horizon rim is drawn) or left
   faintly showing — a chosen setting, not a fixed truth — but "reach the star
   behind this one" is still done by *turning the globe*, not by touching through
   it. Occlusion is now a dial, not an accident, but it is not *nothing*.
2. **Along-shell depth barely reads.** With every star seated at nearly one
   distance and your eye at the centre, distance *along your gaze* carries almost
   no signal while the sky is curled — the falloff that once separated near from
   far in a 3D terrain has little to bite on here. Brightness and angle do the
   work instead. Whether that lost budget should be spent elsewhere is open.
3. **Bearing still drifts.** The shell turns freely, so absolute orientation is
   not conserved across a session; landmarks re-anchor it, but there is no fixed
   "north" you can trust between visits without them. Better than a free 3D orbit,
   not yet a stable frame.
4. **The encodings are esoteric.** Light/size/colour/position all mean things,
   and none are ever stated. First-time comprehension is near zero; the map
   selects for people willing to acquire it by use.
5. **Relations are undifferentiated.** Threads show *that* things connect and
   faintly *which way*, but not *why* — every kind of relation is the same line.
   The structure the map is proudest of is its least articulate layer.
6. **Emptiness is unexplained.** Darkness might mean "nothing there," "not
   charted yet," or "thinned by the depth dial" — three very different truths with
   one appearance. The reach counter helps only if noticed.
7. **The map shows, but barely *does*.** Almost every consequential act (edit,
   open, link, retire) still requires the panel or another surface. The palette
   has grown to host *tuning the feel* live, so the seam is narrowing — but as a
   workplace the sky itself is nearly read-only, while as a *place* it is where
   you live. That tension is unresolved.
8. **Accessibility is unaddressed.** The experience is wholly visual-spatial and
   motion-rich: no non-visual equivalent, no reduced-motion posture, and
   colour-meaning with no redundant channel.

## 10. Prompts for the next description

Questions to answer *in experiential terms* before touching anything real:

- What is the unit of orientation — the individual fact, or the *place*? (Today:
  facts, with places as decoration. Inverting this changes everything.)
- Is light *importance* or *neglect*? Should the map be able to show "what I'm
  ignoring" as vividly as "what I'm touching"?
- The 3D-vs-flat question is now *answered by the curl* — one fixed viewpoint,
  the sky's own geometry doing the depth. Does the curl fully earn its keep, or
  are there tasks that still want a genuinely flat, memorisable chart with a
  fixed north (the paper weather half-reaches for this)?
- Should selection *do* more — is the sky a viewer with a panel, or a workbench
  where linking, retiring, and annotating are direct manipulations?
- Should change be legible? What does "what happened here since yesterday" look
  like as weather rather than as a list?
- Who is the map for on a shared substrate — and what does *someone else's*
  attention look like in your sky?

---

*This document describes the experience as of 2026-07-20, the curl baseline —
one fixed viewpoint, zoom as the sky's own geometry curling from dome to chart to
held globe. When the experience changes, rewrite the description first; treat
divergence between this file and the felt reality as a bug in one of them — and
decide which.*
