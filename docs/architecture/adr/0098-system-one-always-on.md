# ADR-0098 — System One, always on: act-by-default perception, tending, and a learner that closes

- **Status:** Accepted 2026-09-24 — Inc 0–2 and Inc 4's learner built and
  running on prod as tier-2 cells (`@c15r/jev`, `@c15r/system1`,
  `@c15r/consolidate`); Inc 3's always-on trigger awaits one tier-1 change
  (see *Implementation status*).
- **Amends:** ADR-0097 (Jev as a semantic judgment layer). 0097's research,
  cost model, and data-boundary rules stand. Its *posture* is overturned:
  0097 proposed observation-only judgments with humans or policy ratifying later.
  This ADR makes typed judgment the substrate's default way of **acting**.
- **Overturns, deliberately:**
  - ADR-0032's ratify-before-structure for the *inferred* tier.
  - ADR-0073's autonomy ladder calibration (cosine bar, 5-pair cap, "honest zero").
  - The event-driven-rung refusal in
    `trajectory/2026-06-12-transformers-and-the-executor-tiers`, now that its
    three conditions are met (declared footprint, budget, loop guard; see §7).
  - `ancestor/sync/adaptive-salience` §IX's non-goal ("does not add AI/LLM
    analysis… the substrate stays interpretable without requiring intelligence").
    The substrate stays *inspectable* without intelligence. It no longer stays
    *inert* without it.
- **Depends on:** ADR-0050 (actor-classed counters), ADR-0066 (proof-of-read
  CAS), ADR-0070 (reward), ADR-0072 (contested), ADR-0073/0077 (consolidation
  organ), ADR-0074 (posture), ADR-0084/0065 (machine run modes), ADR-0088/0089
  (wake-on-change, single-origin fanout), ADR-0094 (the learned type bias).

---

## Context: lots of activity, very little action

The loop exists. It runs every day. It does almost nothing.

Here is the slice on 2026-09-24:

| signal | value | source |
|---|---:|---|
| consolidation Stage A structural moves | **0**, 14th consecutive cycle | `consolidation/latest` |
| Stage B adjudicated per cycle | 8, of 4,082 contested | `consolidation/latest` |
| backlog delta, last cycle | **−41** (growth outpaces repair) | `consolidation/latest` |
| pending `similarTo` suggestions | **22,933**, +343/day | `decision/tending-backlog-structurally-chronic` |
| stale / unlinked | 4,830 / 1,799 | same |
| revisions of the "chronic" decision fact | **59** daily re-statements of "same shape" | same, `_meta.revision` |
| reactive machine decisions | 0% since 2026-07-09 (model credit exhausted) | ADR-0065/0084, `kb/consolidation-anthropic-credit-exhausted` |
| untyped facts | 115 | `recall` overview |
| projects (`kb/proj_*`) | 10, reachable only via hand-set tags | `query` |
| active goals | 1 | `@c15r/tasks.list_goals` |

Each tending cycle is honest. It observes, samples, finds root cause #3 again,
writes "0 defensible weave links this cycle", and records an *honest zero*.
Honest zeros repeated 59 times are not caution. They are a system whose
decision threshold is set so that it never decides.

The structural reasons are already named in the docs:

1. **Judgment is priced as deliberation.** Every "should this link / merge /
   tag / fire?" routes to a generative model (`models.agent`) or a human.
   ADR-0072 caps Stage B at 5 pairs. The generative path has been dead on
   billing since July. The design was metered for a cost that no longer applies.
2. **Confidence is cosine.** The autonomy ladder (ADR-0073) gates on vector
   similarity, which cannot tell a heading from its TypeScript twin at 0.99997
   (`trajectory/2026-07-29-linking-without-unlinking`). The bar was raised to
   compensate, so nothing clears it.
3. **Ratification is the only path to structure.** Inferred structure stays
   weak until someone ratifies it. Nobody ratifies 22,933 things. So the graph
   the salience learner and every query rely on stays thin: root cause #3,
   "unlinked sample only carries derived edges".
4. **The learner has almost nothing to learn from.** ADR-0094's learned type
   bias adapts to deliberate reads, but it acts on a substrate whose content
   carries almost no typed meaning (untyped captures, projects only via manual
   tags, goals not linked to the facts that serve them). ADR-0094 Open #5 ("the
   same learning should reach the other fixed weights") has no features to
   learn over.

## What changed: judgment is now nearly free, fast, and calibrated

`@c15r/jev` (TypeSafe System One) returns calibrated probabilities for typed
questions: `noul` (independent yes/no), `choice` (≤255 exclusive options),
`score` (ordered rubric). Cost is $0.042 per million input tokens, output free,
latency roughly 70–500 ms. It writes no prose.

### Live probe, 2026-09-24 (`jev-1.13.0`)

| state | question | answer |
|---|---|---|
| the two ocean/hydro captures of 2026-08-29 | relation of B to A | `elaborates` **0.90** (`dependsOn` 0.10) |
| same pair | same project? | **0.84** |
| hydro capture | project ∈ {drive, parc, regwatch, shelved, geodesic, none} | `drive` **0.78**, `parc` 0.17 |
| hydro capture | actionable? | **0.89** |
| hydro capture | durability {hours…years} | `years` 0.75 |
| hydro capture | kind {design-plan, idea-fragment, …} | split 0.41/0.59 (confidence 0.48; these options overlap) |
| capture `"A"` (2026-09-21) | accidental / content-free? | **0.59** (honestly unsure) |

Five questions about one fact cost 758 input tokens. The question schema adds
about 350 tokens even when the content is tiny, so questions that share the
same fact should be asked together in one call.

### The backlog now costs pennies

At about 700 tokens per assessment:

| sweep | items | tokens | cost |
|---|---:|---:|---:|
| every contested pair (Stage B, whole backlog) | 4,082 | ~2.9M | **~$0.12** |
| every pending suggestion (relate + rel choice) | 22,933 | ~16M | **~$0.67** |
| perceive every fact in the slice once | ~9,800 | ~6.9M | **~$0.29** |
| steady state: perceive ~500 settled writes/day | 500/day | ~0.75M/day | **~$0.03/day** |

Every limit in ADRs 0072 and 0073 was set to protect a budget that this makes
irrelevant. The binding constraints are now write load, rate limits
(1,200 req/min), and whether we trust the output. The first two are mechanical.
Trust is what this ADR addresses.

## Decision

**Typed fast judgment becomes the substrate's always-on perception and its
default actuator. Deliberation (System Two: `models.agent`, Claude sessions,
the human) is invoked by exception, on low confidence, and as teacher.**

Four moves:

1. **Perceive on write.** Every settled fact is judged once, on arrival, by a
   declared set of questions. The answers are *materialized*, not proposed:
   tags, type, project and goal membership, and links.
2. **Act by reversibility class, not by ratification.** The safety property
   moves from "a human said yes first" to "every act is typed, attributed,
   cheap to undo, and audited after the fact". Autonomy is set per class and
   learned per question.
3. **Tending clears queues instead of sampling them.** Suggestions, contested
   pairs, stale facts, and untyped facts are swept in full, and resolved *both
   ways*: ratify or decline, link or dismiss. Declining is action too.
4. **Close the learner.** Every automated act is a prediction. Its survival or
   reversal, and whether deliberate reads use it, is the label. Thresholds and
   salience weights recalibrate from those labels continuously. System Two's
   daily run turns from dispatcher into teacher.

### 1. Perception: `_judgments/*` as declared vocabulary

A judgment is a declaration, beside `_actions`, `_views`, and
`_subscriptions` (ADR-0068). It is data, not code (compose §8: "not hardcoded
vocabulary"):

```ts
// _judgments/perceive-capture
{
  kind: "judgment",
  applies: { types: ["capture", "claim", "kb", "task", "goal", null], exceptWriters: ["system1/*"] },
  context: {                         // bounded, authorization-checked neighbourhood
    projects: "query:type=project",  // live option sets, not compiled lists
    goals:    "@c15r/tasks.list_goals?status=active",
    near:     "similar:k=8",         // S3 Vectors candidate set (ADR-0030)
  },
  questions: {
    type:       { type: "choice", options: "$types|untyped-only" },
    project:    { type: "choice", options: "projects+none" },
    serves:     { type: "noul", each: "goals", instructions: "Does this fact advance goal {title}?" },
    actionable: { type: "noul" },
    durability: { type: "score", criteria: ["hours","days","months","years"] },
    noise:      { type: "noul", instructions: "Accidental or content-free capture?" },
    relate:     { type: "choice", each: "near",
                  options: ["elaborates","supports","dependsOn","duplicates","supersedes","contradicts","unrelated"] }
  },
  model: "jev-1.13.0",               // pinned; an alias upgrade is a migration
  materialize: "system1/materialize-v1"
}
```

One `decide` call per fact covers every non-pairwise question, because they all
share the same state. Pairwise `relate` questions run one call per candidate
pair, in parallel under the rate limit. Questions and their option sets are
slice data, so adding "which regwatch category?" or "which reading list?" is a
single declaration write.

Every answer is written once as a **judgment fact**: an append-only record
keyed by content hash. It supersedes on input, model, or declaration change
(the ADR-0097 cache key: subject hash + context hashes + declaration version +
model). CEL guards, views, subscriptions, and the salience learner read these
facts. **No network call ever runs inside CEL or the read path**, so
sigma-calculus decidability, ADR-0087 replay, and the read cost model all stay
intact.

Perception runs on the ADR-0089 `fact.written` fanout, debounced to settled
revisions, and skips the organ's own writes. It also runs as a one-time
backfill over the slice.

### 2. Actuation: autonomy by reversibility class

| class | examples | default | gate |
|---|---|---|---|
| **A. additive, inferred-tier** | tag `project:drive`, tag `actionable`, type an *untyped* fact, `belongsTo` project edge, `serves` goal edge, relation edge to a neighbour | **act** | p ≥ θ(question, option), learned; initial θ from §4's calibration |
| **B. queue resolution** | ratify a `similarTo` suggestion with a typed rel; **decline** one judged `unrelated`; dismiss a contested pair judged `independent` | **act** | same; declines need p(`unrelated`) ≥ θ |
| **C. subtractive, reversible** | supersede an exact/near duplicate (successor pointer kept); move a `noise` capture to cold (ADR-0079); unlink a derived edge judged spurious | **act** at higher θ | p ≥ θ_C, and ADR-0066 CAS on the version judged |
| **D. epistemic conflict** | `contradicts` | **mark contested, rank, escalate** | never auto-resolved (ADR-0073 invariant retained) |
| **E. authority** | grants, shares, publishing, script trust, consent | **never** | Jev never participates |

Inferred-tier structure gets its own edge weight: **0.6**, between derived
`similarTo` (0.3) and authored (1.0), under writer `system1/*`. Centrality,
queries, and `edges()` see it. `attention.unlinked` still reads authored edges
only (ADR-0006). A later increment may let it count inferred edges that have
**survived** (§4). An inferred edge a human later touches or re-types
graduates to authored, which is ratification by use, not by queue.

Every act carries its judgment key, probability, declaration version, model,
and a `run` id. `system1.revert({run})` undoes a whole run, and
`system1.revert({key})` undoes one act. Undo is a first-class, cheap,
single-call verb, because undo is what makes act-by-default safe.

### 3. Tending and consolidation: sweep, don't sample

The consolidation organ (ADR-0073) keeps its observe → select → act → score
loop, its delta metric, and its reward writes. What changes:

- **Stage B runs over the whole contested backlog**, not 5 pairs. The Jev
  `choice` over {contradict, subsumes, duplicate, independent} replaces the dead
  `models` call. `independent` at θ dismisses the pair (checked marker written).
  `duplicate`/`subsumes` goes to class C. `contradict` goes to class D.
- **Stage A pre-filters with a `noul`** ("substantive claims in tension?")
  before Stage B. This kills the boilerplate N² false positives that cosine
  admits.
- **The suggestion queue is drained both ways.** 22,933 pending suggestions are
  judged with `relate`. Above θ they are ratified with the chosen rel. Judged
  `unrelated`, they are declined with a suppress marker. The queue stops being
  a count and becomes a flow.
- **Machine `judge` rails.** A third rail mode between `auto` (CEL) and `agent`
  (generative): the node's declared `choices` are asked as one Jev `choice`
  over `ctx`. The run advances when the top probability is at least the node's
  θ, and otherwise yields to `agent` or a human `task`. The claim certificate is
  templated from the question, distribution, and inputs. `vote` becomes one
  call returning the distribution. This revives every reactive machine that
  has been dead since July, including `machine/consolidate`.
- **Tending's success metric changes** from "honest observation" to **acts
  that survived per cycle** and **backlog delta**. A cycle with zero acts on a
  non-empty backlog is a defect to diagnose, not an outcome to record.

### 4. The learner closes

The substrate already learns something: ADR-0094 learns a type bias from
deliberate reads. This ADR gives it (a) rich features and (b) labels.

**Labels (ground truth, cheapest first):**

| label | meaning | source |
|---|---|---|
| **reverted** | negative for that (question, option, band) | `system1.revert`, a human unlink, a retag, an un-supersede |
| **corrected** | negative for the old option, positive for the new | a human changes `project:` or type on a system1-written fact |
| **used** | weak positive | a *deliberate* read (ADR-0050 human/agent class) that arrived via an inferred edge or tag, i.e. query-by-tag hit, `edges()` traversal |
| **survived** | weak positive | not reverted after N days, while its subject was deliberately read at least once |
| **audited** | strong ±, unbiased | System Two's daily sample review (below) |

**What learns from them:**

1. **Thresholds.** θ per (judgment, option) is recalibrated nightly from
   audited and reverted labels, using bucketed precision on Jev's probability
   (isotonic in effect). The target is a declared precision per class: A ≥ 0.85,
   B ≥ 0.9, C ≥ 0.97. When a question's measured precision drops, its θ rises
   automatically, and if it cannot reach its target its class falls back to
   propose-only. Autonomy is *earned per question*, not granted per ADR.
2. **Salience weights.** Judgment facts become per-record signals, persisted on
   write the way ADR-0050 persists signals: `durability`, `actionable`, and
   `serves:<goal>`. They enter the blend at weight 0 with a byte-identical
   parity proof (the ADR-0051/0070 discipline). ADR-0094's learner then extends
   to these weights (its Open #5). The weights move toward what deliberate reads
   actually open, bounded per cycle so nothing lurches. This is where adaptive
   salience becomes adaptive in content, not only in behaviour.
3. **Posture relevance without hand-written `applies`.** `serves:<goal>` edges
   are written at perception time. Only 16 of 98 mental models carry an
   authored `applies` field (ADR-0094 §6). The posture's relevance term reads
   the persisted edges, so the read path stays arithmetic.
4. **Reward (ADR-0070)** is written by the consolidation organ only from
   *survival and use* labels, never from Jev's own probabilities. That keeps
   "reward stays factual" (ADR-0074).

**System Two becomes teacher.** The daily driven tending run (currently
writing its 59th "same shape" revision) stops dispatching and instead:

- audits a stratified random sample of the last cycle's System One acts
  (about 20: some near θ, some from each class). Each verdict is a label.
- takes class D escalations and propose-only fallbacks.
- proposes new `_judgments` declarations or option-set edits when it sees a
  systematic miss, for example "the kind options overlap; merge
  design-plan/idea-fragment".

Deliberation is spent where it is irreplaceable: judging the judge, and
extending the vocabulary.

### 5. What future queries gain

- `query({tag:"project:drive"})` and `edges({around:"kb/proj_drive"})` return
  captures, claims, and docs that nobody hand-tagged.
- `edges({around:"goal/consolidation"})` returns what serves the goal.
  `tasks.next` can surface facts relevant to the doing task.
- `query({text})` candidates get inferred-edge centrality. The home graph's
  node band gains structure beyond `similarTo`.
- The ambient frame can say "3 new captures filed to drive, 1 actionable"
  instead of nothing (the home-graph-experience friction: "silence of
  arrivals").
- Contested becomes a short, real list of contradictions rather than 4,082
  cosine neighbours.

## Invariants retained (the non-negotiables)

1. **Authority is never judged.** Jev output never gates grants, shares,
   publish, consent, or script trust (ADR-0052, 0074, 0086, meta-harness-notes).
   Authorization is checked before any state is assembled for a Jev call.
2. **Contradictions are never auto-resolved.** They are detected, marked, and
   ranked automatically, and resolved socially.
3. **Nothing is deleted.** Class C supersedes with a successor or moves to cold.
   Every act is revertible in one call.
4. **No network call in CEL or on the read path.** Judgments are facts. Guards,
   views, and scores read facts.
5. **Non-circularity.**
   - System One's reads are platform-class (weight ≈ 0).
   - Its writes are cell-class (standing ×0.25, ADR-0094).
   - Its judgments never write reward.
   - Its writes never retrigger perception (`exceptWriters`).
   - Labels come only from deliberate reads, explicit reversal, and audit.
6. **Inspectability.** Every materialized tag or edge links to its judgment
   fact (question, distribution, model, declaration version). `explain` on a
   salience score shows any judgment-derived term.
7. **Pinned models.** Moving `jev-1.13.0` → next is a declared migration:
   re-judge the audited set, compare calibration, then switch.

## Cost, load, and failure controls

- **Budget:** `_config/system1 {dailyTokens, perFactTokens, rpm}` is enforced in
  the organ, with a circuit breaker on error rate or spend. The default daily
  budget is 5M tokens (about $0.21). Backfill runs in explicit, resumable
  chunks (ADR-0083 pattern).
- **Write load:** the slice is one DynamoDB partition. Each perception
  coalesces into **one** fact write (tags plus type merged via `update`) and
  one batched edge write. Judgment facts for `unrelated`/`independent`
  outcomes are sparse: checked markers only, no per-pair fact.
- **Self-invoke hops are scarce (incident, 2026-09-24).**
  - **What happened:** AWS Lambda's recursive-loop detection dropped the
    `cell-system1` chain twice (18:12 and 18:42 UTC). Every backfill batch
    re-invoked the function, so a chain passed 16 hops. In total: 247
    invocations, 2 dropped, no runaway cost; both chains simply stopped at
    ~17 batches.
  - **Fix:** a job loops its batches in-process for ~170 s, and only then
    hands off to a fresh invocation, capped at 8 hops.
  - **Rule:** any organ that self-chains through `cell-jobs` must count hops,
    not batches.
- **Loop guard:** perception skips `system1/*` writers. Machine `judge` rails
  keep ADR-0011's depth cap.
- **Kill switch:** `_config/system1.enabled=false` stops perception and
  actuation. Judgments already written stay readable.
- **Data boundary** (from ADR-0097, unchanged): per-declaration type and field
  allow-lists. Secret-bearing and `_`-prefixed system facts are excluded.
  Derived judgments on private facts never enter `@guest` projections.
- **Shape of state:** small and explicit. The fact plus its bounded
  neighbourhood, never a whole doc bundle. This keeps the state small, which
  keeps both cost and accuracy stable.

## Increments

| inc | scope | exit gate |
|---|---|---|
| **0** | Jev cell hygiene. Normalize `score` criteria objects to ordered arrays (the 422 found in ADR-0097). Default model pinned to `jev-1.13.0`. Add `decideMany` (parallel fan-out under rpm). Add usage metering facts. | contract tests green; `status` reports pin |
| **1** | Shadow sweep. Perceive the whole slice. Judge all 22,933 suggestions and 4,082 contested pairs. Write judgment facts only, no acts. System Two audits a stratified 200. | calibration table per (question, option); initial θ per class meets targets on the audit |
| **2** | **Act.** Classes A and B on the backfill and the queues. `system1.revert` shipped first. | suggestions queue under 1,000; contested under 200; untyped 0; revert rate < 15% at 7 days |
| **3** | Always on. Perception on the `fact.written` fanout. Machine `judge` rail mode. `machine/consolidate` Stage B on Jev. | every settled capture tagged within 1 minute; reactive machines advancing; consolidation delta positive for 7 consecutive cycles |
| **4** | Learner closed. Nightly θ recalibration. Judgment signals at weight 0, then ADR-0094 learner over them. Reward from survival. System Two becomes teacher. | θ moves with labels; salience parity proof; weight changes bounded and logged |
| **5** | Class C. Duplicate supersession, noise to cold, spurious derived unlinks. | C precision ≥ 0.97 on audit; zero unrecoverable acts |

Increments 1–2 are about a day's work plus under $2 of Jev spend. By increment
2 the chronic backlog should become a solved problem, or its remaining defects
should become visible and specific. Either is better than a 60th honest zero.

## Implementation status (2026-09-24)

Everything below runs on prod. All of it is git-true under `cells/` and gated
by `tests/system1.test.ts` and `tests/consolidate-*.test.ts`.

**Inc 0 — `@c15r/jev`.**
- The default model is pinned to `jev-1.13.0`.
- Score `criteria` objects are normalised to an ordered array, with the
  descriptions folded into the instructions (the 422 is gone).
- `decide_many` fans out ≤200 states at concurrency 12.
- Every call is metered into the cell's table, and a daily token budget
  (`usage` / `set_budget`) refuses calls with 429 past the cap.

**Inc 1–2 — `@c15r/system1`.** The organ acts as a scoped principal, like
consolidate.

| tool | does |
|---|---|
| `perceive` | project (choice over the 36 live project facts, slugged from their `proj_` prefix), kind, actionable, durability, `serves:<goal>`, type-if-untyped → tags + `belongsTo`/`serves` edges at inferred strength 0.6. Tag rewrites are CAS-guarded and keep the fact's `updatedAt` (`import.updatedAt`), so perception never fakes recency. |
| `sweep_suggestions` | Byte-identical and same-source pairs are pruned (declined) **without** a judgment, per the suggestions contract. Every other pair gets one relation `choice`. It ratifies above θ, declines `unrelated` above θ, and holds pairs where one fact names the other's key (an asset and its capture). |
| `revert` / `label` / `calibrate` | One-call undo of a run. Audit labels. The learner (below). |
| `drive` | The judge rail for driven machine runs: step → Jev `choice` over the yield's branches → `decide` above θ, else stop and return the yield. |
| async + `chain` | A job submits its own next batch: perceive continues the cursor, and sweep skips past held pairs. |

**Measured, and what changed because of it:**
- **Judging is not the cost; writing is.** The first act sweep of 37 pairs
  took 2.6 s to judge and 45 s to ingest one judgment fact per pair. Those
  facts were also embedded, so they minted new `similarTo` suggestions: the
  queue grew 16,542 → 16,703 while the organ drained it, and the top contested
  pairs became the organ's own judgments.
- **Fix:** all bookkeeping lives under `_system1/`, which the vector indexer
  and the write reactor both skip, and the judgments ride inside the one
  run-log fact. The 58 legacy facts were retired. A 40-fact perceive batch now
  takes 4.5 s end to end (load 1.2 s, judge 3.3 s, ~2.8k input tokens per fact).
- **Salience guard:** `judgment`, `system1-run` and `system1-label` are pinned
  low in `_config/salience.typePriors`, so the organ's evidence never
  out-ranks what it annotates.
- **Consolidation Stage B on Jev:** the first cycle had Jev answer 39 of 40
  pairs. It acted on 6 above the 0.9 floor; 30 more were `independent` or
  `subsumes` just under it. With Stage A's 5 ratifications and 5 dangling
  unlinks, the cycle scored **delta +236**, the first positive delta after 14
  flat or negative cycles. The per-pair loop now runs in a pool of 8, reuses
  the batch's peeks, and tallies why each pair went where it went. The delta
  also falls back to summing the prior backlog's parts, because driven-tending
  audits carry no `total`.
- **System Two as teacher, first pass:** a review of a 40-fact `kb/` shadow run
  found project assignment ~85–90% plausible and `serves` loose near 0.75. The
  seed calibration (`_system1/calibration`) set project to 0.75 and serves to
  0.8. `calibrate` moves the gates from there on survival and audit labels.

**Inc 4 — the learner, closed and corrected.**
- **The first System Two audit** (`audit_sample`, 16 acts stratified toward
  the gate) found 14 correct. The 2 misses taught two things:
  - **Plumbing is not a relationship.** Base64 storage chunks of one image were
    ratified `relatesTo`. Sweep now declines any pair touching plumbing
    mechanically (`relatable`: storage and `file/` mirrors, tending logs,
    bookkeeping), without a judgment.
  - **0.73 `relatesTo` can be superficial.** Such a pair was accepted just
    above the 0.70 gate. That label goes to the learner (3× weight).
- **The learner's first run was wrong, in a way worth recording.** It read
  `workspace.edges({around})` as `{edges}`, but the verb answers
  `{outbound, inbound}`. Every surviving act therefore looked reverted:
  precision 0.097, and `relate` tightened to 0.75.
  - The ≤0.05-per-cycle step bound contained it.
  - Fixed, the same 370 labels read precision **0.984** and the gate
    returned to 0.70.
- **Writes are now stamped by the organ.** The backfill runs under an
  `agent:system1` child token (RFC 8693 exchange, ADR-0024), so its writes
  read as the organ, not the owner. The kill switch (`_system1/config`) paused
  and resumed the chains live; undo and the teaching tools still run while
  paused.
- **Deploys go through `cell-sync`** (git-true, three-way, with a baseline
  committed per cell).
- **Second audit (perception, 16 acts): 12 correct.** All 4 misses sat at a
  gate:
  - two `serves` links at exactly 0.80;
  - welcome guide → the old `parcland` project (0.77);
  - a tending source-walk → `playtest` (0.87).

  The misses were reverted by key and labelled. Calibration then moved
  **project 0.75 → 0.77** and **serves 0.80 → 0.82**: the lowest cuts that meet
  target precision (0.914 over 70 labels and 0.833 over 36). `relate` held at
  0.70 (0.98 over 306). One name-level error the sample missed was caught by
  eye and unlinked by hand: ADR-0084 *"The drive surface"* (the machine's
  driven mode) had been tagged `project:drive`. The survival check reads the
  unlink as a negative label.
- **The chronic backlog moved.** A consolidation cycle run after the backfill
  scored **delta +1,435** (backlog 10,719 → 9,284):
  - stale 4,762 → 3,953, because perceived facts now carry authored structure;
  - unlinked 1,809 → 1,611;
  - contested 4,115 → 3,692;
  - Stage B acted on 23 pairs via Jev.

  The previous 14 cycles recorded 0 structural moves.

**Cadence: the existing daily machine runs, no new schedule.**
- The daily driven tending routine already reads `protocol/tending` as its
  source of truth. **v3.3** adds Phase 1.5:
  - mint a session token, then `agent:system1` and `agent:consolidate`
    children;
  - `calibrate`, then start the perceive and sweep chains;
  - drive `machine/consolidate` **every** run, not only as a 36h rescue;
  - late in the run, act as teacher: `audit_sample` → `label` → `revert`
    the wrong ones → `calibrate`.
- `machine/consolidate`'s Adjudicate brief is rewritten in place (the node
  fact, CAS). The machine is not redefined, so its hand-patched projected
  vocabulary is not clobbered. The brief now runs the organ and has the
  driver judge only the pairs Jev escalated (cap 5).
- **Validated by driving one run inline.** At Select, `system1.drive`
  escalated (Adjudicate 0.68), because the yield's context was an elided
  digest with no counts. That is the honest behaviour: System Two decided.
- The validation also caught a `drive` bug before it could bite: it would
  have "judged" the single-branch *work* yield and skipped the work. It now
  acts only on `agent`/`task` decision yields.

**Inc 3 — blocked on one tier-1 line.** Always-on perception is a
`_subscriptions` entry delivering `fact.written` to `@c15r/system1.perceive`
with `grants: {read, write}`. The reactor mints the per-run owner token only
for an allow-listed set of cells (`models`, `run`, `lit`, in
`services/workspace/event-handlers.ts`). Adding `system1` to that list widens
a delegation, so it is left to the owner. Until then the organ runs as driven
chains under a caller-minted token. That is the same posture consolidation
has today.

## Consequences

- The substrate *does things*. Captures arrive filed. Goals know what serves
  them. Queues drain. The graph thickens with typed, attributed structure that
  queries and salience already know how to use.
- Some acts will be wrong. The design accepts a measured error rate in class A
  and B in exchange for coverage, bounded by learned thresholds, cheap undo,
  and a daily audit. This is a deliberate trade. The prior design's error rate
  was near zero because its act rate was zero.
- Fact volume rises: judgment facts, and inferred edges. ADR-0079's cold tier
  and a compaction pass for superseded judgments become necessary, not
  optional.
- An external processor sees more slice text, continuously. ADR-0097's
  retention question (Open #7) becomes a precondition of Inc 3, not a later
  concern.
- ADR-0032's "the model does the bookkeeping, the human keeps judgment" is
  refined, not abandoned. System One keeps the bookkeeping and the routine
  judgments. The human keeps authority, contradiction, vocabulary, and audit.

## Open questions

1. Should inferred-tier edges count toward `attention.unlinked` once they
   survive (i.e. stop the fact being "unlinked")? Leaning yes, after Inc 4.
2. Is project membership a tag (`project:drive`), an edge (`belongsTo`), or
   both? The proposal writes both: tags for cheap query, edges for graph and
   centrality.
3. How much should System Two's audit be stratified toward near-θ items versus
   uniform (calibration versus unbiased precision estimate)?
4. Should the learner's reach extend to `recencyWeight` and the other fixed
   blend weights (ADR-0094 Open #5), or stop at the new judgment signals?
5. Vendor neutrality: expose `system1.*` as the platform seam with
   `@c15r/jev` as its first backend (ADR-0097 Open #8). The answer affects
   where `_judgments` lives.
