# Agent ergonomics review — the substrate MCP surface, through use alone (2026-06-12)

> Method: an agent (Claude, in a fresh session) was pointed at the parc.land
> gateway (`f5bbef8d`) and instructed to evaluate the interface **through use
> only** — no code, no design docs — exercising every reachable primitive,
> then to read the vision corpus (`substrate.md`, `substrate-gaps.md`, the
> trajectory records) and contrast. Phase 1 findings below are exactly what
> the surface taught; nothing in them came from documentation. All probe
> artifacts were cleaned up (lease self-expired, scratch view deleted, edge
> unlinked, fact superseded).

## 1. What the surface taught through use alone

The three-verb gateway (`whoami` / `read` / `act`) plus `read("$catalog")`
is genuinely self-documenting. With zero documentation, use alone revealed:

- **The state model.** Facts as `{ value, _meta }` with server-stamped
  provenance (`writer`, `via`, `writers[]`, `revision`, `seq`, timestamps),
  monotonic revisions, supersede-not-delete, computed salience
  (`score`/`velocity`/`elided`). All legible from any single write response.
- **The coordination floor.** CAS verified (`ifRevision` mismatch returns
  `precondition_failed` *with the current revision*); the `claim-task`
  declared action took a 20s lease, refused a second claim with a 409-style
  error, and the lease **vanished on schedule** — `peek` returned `null`
  21s later. Timers are visible in `_meta`. An agent can learn the entire
  lease protocol from three calls.
- **Vocabulary as data.** `_actions/`, `_views/`, `_types/`, `_renderers/`
  are all discoverable as facts; `registerView` → `view` → `deleteView`
  round-tripped in three calls, and the registered view evaluated live
  (`reduce: count` → `1`) against a fact written moments earlier.
- **The organ tier.** `cells.list` shows the running organs with addresses
  and descriptions good enough to infer the architecture (kernel, viewers,
  models, run, input, lit, canvas). `@c15r/run.exec` executed code with
  `parc.*` bindings; `@c15r/models.listProviders` showed key custody
  without keys.
- **The kind boundary and error voice.** `act` on a read target →
  `"workspace.peek" is read-only — invoke it with read, not act.` Unknown
  target → `Unknown capability … Use read("$catalog") to list what's
  available.` Unknown view → `not_found: view "no-such-view" not found`.
  Every error names the fix. This is the best part of the surface: errors
  are *teaching affordances*, and not one probe required a second guess to
  recover.

The catalog descriptions deserve specific praise: they are compact, they
carry the design philosophy inline ("the just-in-time cron made manual",
"competing write targets are surfaced, not blocked", "so the graph does not
rot"), and they made correct first-call usage possible for ~25 capabilities.
The `cells.replaceInFile` description (exact-match, `occurrences` for
ambiguity detection, `deploy:true` for one-round-trip edit+verify) is
agent-tool design at the level of Claude's own `Edit` tool.

## 2. Friction found through use (measured)

### 2.1 `recall` is a context bomb — the headline problem

Bare `workspace.recall` — the capability the catalog pitches as "Your
workspace view … salience-shaped into focus/peripheral/elided" — returned
**424,039 characters** (~110K tokens) for a 719-fact slice. `elision:
"auto"` changed nothing (423,999 chars): shaping *was* applied (`_shaping`
reported 19 focus / 16 peripheral / 684 elided), but every elided entry
still ships its full `_meta` envelope (~550 chars) with `value: null`.

**~95% of the payload is metadata for facts the system itself decided to
hide.** The salience pipeline computes exactly the right thing and then
discards the win at serialization. The non-elided content — the part the
shaping chose — is ~18.6K chars, which would have fit comfortably.

`state.ts` confirms this is designed behavior (`value: V | null` when
elided; entries always returned). The design withholds *values*; an agent
needs it to withhold *envelopes*.

This matters doubly because recall is the **first call** the
self-documenting surface steers a new agent toward. The best entrypoint
description leads to the worst call on the surface. (`substrate-gaps.md`
already knew: "recall-all does not scale … Do first" — `query` was built
as the answer, but recall kept the headline billing.)

### 2.2 Salience surfaces plumbing, not knowledge

The 19 focus-tier facts were: 11 `_canvas/canvas-002` elements, 5 system
`_types`, cell registry entries, and demo elements. The slice's actual
knowledge (inbox captures, day-logs, docs, the imported boards) was
elided. Score is dominated by recency × write-velocity, so *the most
recently dragged canvas element is the most salient fact in the
workspace*. Attention ≠ importance. Related: the change feed shows
hundreds of `read _views/open-claims` events from a polling dashboard —
reads feed the attention term, so **observation perturbs salience**
(an observer effect the model should either embrace explicitly or
discount by principal/via).

### 2.3 Inconsistent result shapes

Learned only empirically, since the catalog declares input schemas but not
output shapes:

| Read | Shape |
| --- | --- |
| `workspace.recall` | `{ entries: { key → Entry }, _shaping }` (map) |
| `workspace.query` | `{ entries: [ { key, value, _meta } ], count }` (array) |
| `parc.query` (inside `run.exec`) | bare array, different element shape |
| `workspace.peek` (missing key) | `null` |
| `workspace.view` (missing id) | `not_found` error |

Each is individually fine; together they force an agent to re-learn the
envelope per capability. Missing-key semantics (`null` vs `not_found`)
disagree between `peek` and `view`.

### 2.4 Smaller frictions

- **Token noise in `_meta`:** scores in scientific notation
  (`3.4535116265989783E-19`), velocity to 17 significant digits, and
  always-present nulls (`supersededBy: null`, `timer: null`, `tags: []`)
  on every entry of every read.
- **No cursor on `query`** — `limit` only. The gaps doc's own proposed
  signature had `cursor`; it was dropped in implementation.
- **`changes` requires two calls to tail** — `sinceSeq` defaults to 0
  (oldest-first), so "what just happened" costs a probe call to learn the
  head seq first.
- **Dangling links are silent at write time.** Linking to a nonexistent
  key succeeds with no hint (`toExists: false` would cost nothing);
  detection is deferred to `attention`, a different session entirely.
  "Surfaced, not blocked" is the right philosophy — but surfacing can
  happen in the write response too.
- **`attention` is drowned by plumbing.** 25/26 unlinked items were
  `_canvas/*` structural facts and `_actions/claim-task` — system
  namespaces the underscore convention already marks, which tending does
  not respect. The one real signal (a dangling `derived-from` edge) was
  buried.
- **The catalog is flat.** 47 capabilities, ~12K tokens, one list. Fine
  today; as `@owner/cell.*` entries multiply it needs a summary mode
  (per-cell counts + one-liners, drill-down on demand).
- **Vocabulary opacity at the edges.** "Organ-path write", "the reef",
  "tier-2" appear in descriptions but are only decodable from the docs.
  Through use alone, `@c15r/reef-writer` remained the one capability whose
  purpose I could not infer.
- **Discovery above the gateway.** The harness tool-search for "parc
  substrate" surfaced the *legacy* workspace server first — the gateway's
  generic tool names (`read`/`act`/`whoami`) carry no searchable keywords;
  only the server URL hints. The server-level description is part of the
  ergonomic surface too.

## 3. Contrast with the stated vision

Read afterwards: `substrate.md`, `substrate-gaps.md`, `sync-learnings.md`,
both trajectory records, `canvas-substrate-design.md` (skimmed),
`state.ts` (verification only).

**Where use confirmed the vision, strongly:**

- *"Vocabulary is the protocol."* Real and load-bearing: actions, views,
  types, renderers all round-trip as facts; the declared-action lease
  worked exactly as the σ-calculus `write(φ, scope, W)` story says.
- *"No orchestrator."* CAS + leases + timers + `changes` + `attention` are
  precisely the external-coordination floor `substrate-gaps.md` specified.
  All five named gaps are filled and work as designed — the design loop
  (gap analysis → primitive → live validation) demonstrably closes.
- *Dual projection.* Views carry render hints an agent can read and a
  human can see; `cells.list` descriptions point at live surfaces; the
  same facts placed on canvas were readable through `query`.
- *Attested provenance.* `writer: "platform/cells"`, `via:
  "action:claim-task"`, `writers[]` history — visible on every read,
  never client-supplied.

**Where use exposed a vision/implementation gap:**

1. **"Reads shaped by salience" fails its primary consumer.** The thesis
   says salience exists to protect attention; the agent is the participant
   with *hard* attention limits (context windows), and recall is unusable
   for it at 719 facts. The canvas got the ⊕ expand-from-elision
   affordance and "salience modulates presentation" care
   (`canvas-substrate-design`, §10 of the transformers record); the MCP
   projection of the *same* shaping got none of that investment. If
   "agents and humans are equivalent participants, distinguished only by
   the modality of their observation," the agent modality is currently the
   second-class one — an inversion of the system's own MCP-native tenet.
2. **Salience quality is the open question the docs already name.**
   `substrate.md` asks whether the self-model can "develop an opinion
   about the quality of its own accreting vocabulary, rather than just
   accumulating." Live answer: not yet — the score function makes edit
   churn the dominant signal, and system plumbing outranks knowledge.
   The next salience design pass should treat *type* and *namespace* as
   first-class signals, not just trajectory.
3. **Output shape was never declared part of the surface.** The vision
   carefully specifies input affordances (schemas, scopes, kinds) and
   never result envelopes — which is exactly where the implementation
   drifted inconsistent (§2.3). A surface declaration should bind both
   directions.

## 4. Recommendations, ranked by leverage

1. **Put recall on a context budget.** Elided entries return as keys (or
   `{key, type, score}` triplets) under a separate `elided` field — plus
   the existing counts and the `expand` affordance for pulling any of them
   back. Alternatively/additionally: a `budget` (max chars/entries) param.
   This single change makes the flagship read usable and is consistent
   with the existing design (elision already exists; it just elides the
   wrong half of the entry).
2. **Envelope diet everywhere.** Round `score`/`velocity` to ~3 decimals;
   omit null/empty `_meta` fields; consider `meta: "slim"` (default for
   list reads) vs `"full"` (peek/single reads). At 719 entries this is
   ~40% of the remaining payload.
3. **Unify result shapes.** One entries representation (the `query` array
   form is the better one), shared by recall/query/neighbors and by
   `parc.query` inside `run`; one missing-resource convention (`not_found`
   errors, since `peek`'s `null` is ambiguous with an elided/timer state).
4. **Declare outputs in the catalog** — a `resultSchema` or a one-line
   example per capability. This is the missing half of self-documentation
   and the guardrail against future shape drift.
5. **Make `attention`/`tend` namespace-aware.** Exempt or bucket `_`-
   prefixed keys so tending surfaces knowledge health, not canvas plumbing.
6. **Cheap affordance wins:** `toExists` on link responses; `sinceSeq:
   "head"` (or a bare `changes` returning just the head seq cheaply);
   cursor on `query`; catalog summary mode grouped by cell.
7. **Salience v2:** discount reads from polling principals/vias in the
   attention term; weight by type/namespace; revisit whether velocity
   should saturate. This is the `substrate.md` open question and deserves
   its own design doc before more surfaces lean on the score.
8. **Name the gateway for discovery.** The MCP server description should
   say "parc.land substrate" and name the cell families, so harness-level
   tool search lands here instead of on the ancestors.

## 5. The one-line verdict

The surface is unusually good at teaching its *semantics* — verbs, state
model, coordination, vocabulary, errors — entirely through use; what it
does not yet manage is its own *weight*: the salience machinery that is
supposed to fit the substrate into a bounded observer's attention computes
the right answer and then ships the wrong bytes, and the agent — the
bounded observer the MCP-native tenet exists for — is the participant who
pays.
