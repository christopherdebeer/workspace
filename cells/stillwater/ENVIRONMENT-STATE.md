# Stillwater — environmental state vocabulary

2026-09-28 · design + dormant infrastructure

The next environmental layer should make the river capable of changing its own
shape and behaviour without turning those changes into conventional game
switches. Two candidate systems are worth preparing: **load / buoyancy** and
**reactive flora**. Neither is activated by this change. The only live addition
is passive bank architecture — piers and blank wooden signs — so they can become
part of the river's visual grammar before they ever acquire meaning.

## 1. Weight and buoyancy: continuous state, not a door switch

Stillwater already has the beginnings of this system. A pad can be pressed,
caught by an oar, sink at one edge, flood, lose dew and resurface. The next step
should generalise that visual special case into a physical state shared by
floating bodies.

For a pad, keep these quantities conceptually separate:

- **load** — downward pressure accumulated from hull/oar/contact;
- **support** — buoyant capacity, mostly proportional to pad area and condition;
- **submergence** — current depth below the undisturbed surface;
- **vertical velocity** — inertia, so sinking and resurfacing are not easing
  animations;
- **wetness** — hysteresis: a recently submerged leaf remains darker/heavier
  briefly while water sheets off;
- **effective collision radius** — falls continuously as the pad goes under.

A sustained hull contact therefore produces a chain of physical consequences:

    contact pressure
      → load exceeds local support
      → edge floods
      → pad rotates / sinks
      → collision footprint shrinks
      → current and wake pass across it
      → the boat can shoulder through
      → load disappears
      → buoyancy + stem tension restore it
      → water drains and the leaf slowly regains its dry optical response

There is no "opened" boolean. A pathway is open only because enough of its
floating obstruction is physically below the boat's draft at that moment.

### Giant / old pads

Do not make larger pads simply stronger. That would make the proposed behaviour
least likely on the most visually tempting leaves. Give old giant pads greater
area but also a much softer stem / higher retained water mass. They resist an
initial nudge, then yield slowly under sustained pressure. The important feel is
**leaning into something living until it gives**, not hitting an obstacle until
a timer completes.

Useful future fields on Pad:

    load: number
    sinkV: number
    wet: number
    compliance: number
    support: number

The existing `sink` remains the rendered submergence signal; these fields would
eventually drive it rather than replace it.

### Boat buoyancy

The boat should get a compatible but simpler model later: `draft`, `roll`
and `pitch` derived from load distribution. That makes carried objects,
grounding in very shallow water, passengers shifting, or a flooded hull possible
without inventing separate systems. It is not needed for pad interaction yet.

## 2. Reactive flora: ecological pulses, not collectible triggers

"Pick up a glowing orb and the flowers activate" has a strong game-language
risk. Preserve the useful part — a local action causing a beautiful state change
that travels through the world — but make the causality botanical.

The river already knows which leaves and blooms share a rhizome. That is the
ideal propagation graph.

A future **pulse** should be a small event:

    { x, y, energy, kind, sourcePlant?, age }

A plant receiving energy stores a scalar `charge`. Above a soft threshold it
responds according to species and time of day:

- buds open over several seconds;
- open flowers turn toward the light / lift;
- dew condenses or releases;
- petals loosen;
- pollen or fireflies rise;
- neighbouring rhizomes receive a weaker delayed pulse;
- dense roots slightly disturb local water / suspended silt.

The wave therefore has a spatial tempo. A pink-lily colony can bloom from one
side of the river to the other rather than all flowers toggling simultaneously.

### What can emit a pulse later?

Prefer events already meaningful in the world:

- a solved dew relationship arriving at the lantern;
- a rare luminous seed touching a rhizome;
- a strong sunbreak after shade;
- the boat disturbing a mature plant;
- a stretch finale;
- rain / dusk / dawn state.

A luminous orb can exist eventually, but it should be understood as **a thing in
the ecology** (seed, pollen mass, trapped light), not as a generic pickup.

### Effects on flow

A bloom wave may alter water, but only indirectly and locally. Opening leaves
increase surface drag and wave damping; stems pulling taut alter nearby floating
geometry; dense emergent growth diverts the small eddy component. Avoid directly
setting the river velocity because an objective fired.

### Revealing an objective

If a pulse is later used to guide attention, let the environment reveal the
relationship: a sequence of opening flowers, a temporarily clear current lane,
dew appearing on a related plant cluster, or reflected light travelling toward
a place. Do not spawn an arrow or convert a sign into a UI panel by default.

## 3. Environmental state ownership

Keep three domains distinct:

1. **Physics state** belongs to `Pond`: loads, submergence, flow, pulses.
2. **Ecological state** belongs to plants/blooms/pads and evolves every step.
3. **Learning state** may emit a neutral world event ("energy arrived here") but
   should not reach inside the renderer and toggle a flower or current.

The renderer only observes the resulting world state. This gives us composition
without hidden cross-system switches.

## 4. Dormant bank architecture — LIVE, but intentionally meaningless

Piers and wooden signs now exist as deterministic procedural **Landmark**
objects. They are deliberately ambient:

- no hit testing;
- no collision;
- no target selection;
- no learning hooks;
- no text, arrows, numerals or glow;
- no special sound;
- `state = 0` and is not read by gameplay.

They have stable IDs for their lifetime and a dedicated render path, so future
behaviour can attach to the same objects rather than replacing scenery with
"interactive versions".

### Piers

Sparse weathered timber fingers extend from the natural bank into slack water.
They have transverse plank seams, grain, nail heads, dark wet ends and mossy
waterline staining. For now pads may visually pass beneath them and the boat has
no collision with them. That is intentional preparation, not a finished pier
mechanic.

Possible later roles: mooring/rest state, weighing/loading, a visible unit
length, grouping objects on planks, shallow-water landmarks, or a place where
the rower leaves/collects a physical object.

### Signs

Small blank timber boards sit just above the banks, roughly aligned to the river.
They are scenery first. The face has grain, wear and fixings but **no content**.

Possible later roles: discovered route marks, environmental numerals, a
non-modal hint surface, place naming, or a record of something the child has
already learned. The crucial semiotic rule: because blank signs already belong
to the landscape, later marked signs need not announce "this is a game UI".

## 5. What is deliberately not built yet

- pad load / buoyancy integration;
- boat draft / roll / pitch;
- landmark collision;
- pier mooring;
- plant pulse graph and charge state;
- flow mutation from flora;
- glowing seeds / orbs;
- any objective or learning use of piers/signs.

Those should be added only after observing whether the passive landmarks feel
native to Stillwater's current visual density and whether sustained-contact
sinking reads clearly with the existing pad waterline shader.


## 6. Round 25 correction — hull load is the primary pad interaction

Field observation exposed that the live hull path still used the older rigid-disc
response: it pushed pad centres sideways every frame, but never marked hull
contact as a submerging load. Oars could sink leaves; the boat itself could not.

The corrected model makes hull overlap intentionally permissible. Sustained hull
contact accumulates `load` and downward velocity. As `sink` rises, collision
authority fades continuously; a substantially submerged leaf no longer blocks
the hull or its neighbours. Surface contact retains a modest sideways shoulder,
spin, speed loss and yaw influence so steering through vegetation still has
texture, but the dominant response is downward flooding rather than ricochet.

New live pad state: `load`, `sinkV`, `support`, `compliance`, `wet`.
Large pads gain support from area but also greater compliance, so they feel
massive at first contact and then yield under sustained pressure instead of
behaving like fixed islands.

Pier generation is also endpoint-defined now. The waterward endpoint reaches
into the channel and the landward endpoint is placed 86–142 world units inside
the bank (or beyond the grown field, where it clips off-screen). A pier therefore
cannot exist as a detached rectangle in open water.
