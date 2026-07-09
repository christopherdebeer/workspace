# ADR-0074 — Principal-adopted goals: attention as a property of the principal

- **Status:** Proposed 2026-07-09 (buffer — feedback welcome before build). Enters
  the buffer beside ADR-0071 (C2) now that C8 closed the wave's loop; this is the
  owner-directed reassessment of the auth track (ADR-0022/0024/0025) against the
  score stage (ADR-0050/0051/0070).
- **Context:** owner direction (2026-07-09): *"goals and even salience might be
  principal specific — an agent can adopt a goal and its queries are automatically
  permuted/perturbed by that."* Also the standing gap the plate has carried since
  the capture pass: **no persistent global goal/attention state** — `relevance`
  biases a read only when `text` is passed on that call.
- **Depends on:** ADR-0022 (tokens as minted principals), ADR-0051 (relevance),
  ADR-0070 (reward), ADR-0010 (layered resolution). **Shapes:** ADR-0071 (C2 must
  reserve the principal layer in its defaults merge — recorded there), ADR-0024/
  0025 (the delegation sketches this refines: attenuation of *attention*, not just
  of scope).

---

## Context (grounded)

Three facts already point at one seam:

- A **principal is already a first-class, stored thing**: `auth.mintToken` narrows
  a bearer to ≤ the minter's standing, with a label and an id — the consolidation
  organ (ADR-0073) *runs as one*. But a principal today carries only **scope**
  (what it may see/do), never **posture** (what it is *for*).
- The score stage is already **layered per call**: `defaults ← _config/salience ←
  lens ← override` (`resolveSalience` + `callSalience`, ADR-0010/0050), and the
  intent (`relevance`) and earned (`reward`) terms are default-inert weights. But
  every layer is either *slice-global* (config) or *per-call* (lens/override) —
  there is no layer between them.
- Agents repeat themselves: an agent working goal G passes `text: G` (or a lens)
  on every read, or forgets to — the unknown-unknowns failure `adaptive-salience.md`
  named ("an agent choosing its own curriculum").

### Grounding — the goal surfaces that already exist (owner aside, 2026-07-09)

Posture must not invent a goal vocabulary; the substrate already has one, in
three layers, and the sketch below is revised to *reference* it:

1. **Durable goals are facts, slice-declared.** `@c15r/tasks` declares the
   `goal` type in its own `types.json` (not compiled code): `goal/<id>` facts
   with a lifecycle (`proposed → active → (done|blocked|dropped)`), a `project`
   pointer to a `kb/proj_*` fact, and tasks whose key-encoded rule projects
   `task —partOf→ goal` edges (`cells/tasks/types.json`, `cells/tasks/index.ts`).
   Live prod carries real instances managed by `@c15r/tasks`, tagged
   `goal · status:* · project:*`. This is exactly the open-vocabulary discipline
   (compose.md §8): the goal shape is slice-declared data.
2. **Per-call goal conditioning already works.** ADR-0051's `recall({text})` /
   `query({text})` is the intent lens — "orient relative to a goal: free text,
   matched by meaning" (`descriptors.ts`) — and capability facts are written so
   "relevance can match a goal to a tool" (`event-handlers.ts:629`). Posture is
   that same machinery hoisted from per-call to per-principal; no new scoring.
3. **Named lenses are the one closed set in the seam.** `SalienceLens`
   (`recent|connected|durable|active`) is a compiled preset table
   (`state.ts` `LENS_PRESETS`). Under the open-vocabulary rule this is a *floor*,
   not a ceiling — a `_config/lenses` slice-declared preset layer is the natural
   companion (recorded as open question 4, not built here).

The consequence for the sketch: **adopting a goal should mean adopting a
`goal/<id>` fact** where one exists — the posture then derives its relevance
text from the fact's `title`/`detail`, inherits its `project` edge for
observability, and the adoption itself is graph-visible — with free text as the
degenerate case for ephemeral purposes no one has filed as a goal fact.

```mermaid
flowchart TD
  subgraph before["BEFORE — posture is per-call or nowhere"]
    T0["token = scope only"]
    R0["read(text?, lens?, salience?)<br/>repeated on every call, or forgotten"]
    T0 --- R0
  end
  subgraph after["AFTER — the principal carries its adopted goal"]
    T1["token = scope + adopted posture<br/>{ goal?: text · lens? · salience? }"]
    R1["read(…) — defaults resolve THROUGH the principal:<br/>defaults ← config ← PRINCIPAL ← lens ← override"]
    D1["delegation (0024/0025) attenuates ATTENTION,<br/>not just scope: a child token inherits ∩ narrows the goal"]
    T1 --- R1
    T1 -. mint .-> D1
  end
  before ==adopt==> after
```

## Sketch (decisions, tentative)

1. **Posture on the principal.** A token (and later a session principal) may carry
   an adopted posture: `{ goal?: string, lens?: SalienceLens, salience?:
   Partial<SalienceOptions> }`. Stored with the token record (auth) or as a
   substrate fact keyed by principal (`_principals/<id>/posture`) — open question;
   the fact form keeps it observable/tendable, the token form keeps it attested.
2. **Resolution gains the principal layer.** The read path resolves
   `defaults ← _config/salience ← principal.posture ← lens ← override` — one new
   slot in the existing layered merge (ADR-0010), nothing else moves. A principal
   with `goal` gets that goal embedded once and applied as the `relevance` map on
   every read (the ADR-0051 machinery, principal-conditioned instead of per-call).
3. **Adoption is a verb, and it prefers the goal graph.** `auth.adoptGoal
   { tokenId?, goal, lens?, salience? }` (self by default) — an agent *adopts* a
   goal mid-session; `auth.dropGoal` releases it. `goal` is either a **fact key**
   (`goal/<id>` — the `@c15r/tasks` vocabulary; the posture embeds the fact's
   `title`+`detail` and records the reference, so the principal is visibly
   attached to the goal graph and its `project`) or **free text** (the degenerate
   case, for purposes not yet filed). Adoption events land in the trajectory, so
   tending can see what the fleet is attending to — and a fact-referenced
   adoption is itself tendable (a dropped/done goal with postured principals
   still attached is a contested-view candidate).
4. **Delegation attenuates attention (the 0024/0025 reassessment).** When a
   principal mints a child (0024's chain), the child inherits the parent's posture
   and may only **narrow** it (a sub-goal), exactly as scope only narrows — 0025's
   holder-side attenuation applied to *attention*. A dispatched sub-agent is then
   automatically perturbed toward its parent's purpose, without prompt plumbing.
5. **Reward stays factual, goals stay principal.** The posture biases *reads*;
   it never writes. `reward` (ADR-0070) remains earned-per-fact; a goal is a lens,
   not a score mutation — so two principals reading the same slice still see the
   same facts, differently *ranked*.

## Why now (buffer rationale)

C2 (ADR-0071) is about to rebuild the read surface; if it ships without a reserved
principal layer in its defaults merge, this ADR becomes a retrofit. Sketching it
now (per the two-ahead discipline) makes the reservation binding — ADR-0071
already records it. And C8 just demonstrated the pattern concretely: the organ
runs as a minted principal whose *purpose* is currently carried in prose; posture
makes that purpose machine-legible.

## Behaviour-preservation (the gate)

Default-inert, twice over: a principal with **no posture** resolves identically to
today (the new layer is empty); a principal **with** posture changes only ranking/
shaping, never membership of the readable set (scope untouched). Parity: reads
under a posture-free token are byte-identical before/after; a postured token's
reads equal today's reads with the equivalent per-call `text`/`lens` supplied.

## Open questions
1. Posture storage: on the auth token record vs a `_principals/*` substrate fact
   (observable, tendable, but weaker attestation)? Leaning: token record as truth,
   mirrored to a fact for observability.
2. Does a *human* session adopt goals the same way (a "focus mode"), and does the
   home UI surface the active posture?
3. Interaction with grants: does a shared slice read under the *reader's* posture
   only (proposal: yes — posture is the observer's, never the owner's)?
4. Lens vocabulary: `LENS_PRESETS` is compiled-closed — should posture's arrival
   bring a slice-declared `_config/lenses` preset layer (compiled names as the
   floor, per the open-vocabulary discipline), so a posture can name a lens the
   slice itself defined?
5. Goal lifecycle coupling: when a referenced `goal/<id>` transitions to
   `done`/`dropped`, does the posture auto-release, warn on next read, or persist
   until dropped (proposal: persist + surface via contested/tending, not magic)?
