# Substrate review: System One, decision models, the core, and the cells

*2026-11-04 · a read of `docs/`, `platform/`, `services/`, `cells/` and `tests/` at `claude/technic-lab`,
plus read-only queries of the live slice (`workspace.peek` / `workspace.query`) for what System One
and consolidation have actually done. Nothing was changed.*

<!-- SUMMARY -->

---

## 1. System One and Jev

### 1.1 What they are

**Jev** (TypeSafe's System One model) answers typed questions about a supplied state with calibrated
probabilities: `noul` (independent yes/no), `choice` (≤255 exclusive options), `score` (an ordered
rubric). It never writes prose. Input costs $0.042 per million tokens, output is free, and latency is
roughly 70–500 ms per call.

| piece | what it is | where |
|---|---|---|
| `@c15r/jev` | The vendor adapter, 658 lines: `set_key` (owner-only, write-only), `status`, `decide`, `noul`/`choice`/`score`, `decide_many` (≤200 states, concurrency 12, max 24), `usage`/`set_budget`. Model pinned to `jev-1.13.0`. Score criteria normalised to the array form (the upstream 422). Every call is metered into the cell's own table and refused past a daily token budget. | `cells/jev/index.ts` |
| jev · lab | A public page of experiments, run under the caller's own session: free-text answers from a model that only discriminates (`lib/answer.ts`, `lib/decode.ts`), pictures by recognition (`lib/image.ts`), programs synthesised by typed choice (`lib/program.ts`), and games played and judged by Jev (`client/playtest/`). | `cells/jev/client/` |
| ADR-0097 | *Proposed, research.* Jev as a shared semantic-judgment layer between vector recall and action: four protocols (`annotate`, `relate`, `rerank`, `tending.inspect`), observations stored as facts under a content-hash cache key, nine cost controls, and a data boundary (per-protocol allow-lists, redaction, retention posture). Observation only. | `docs/architecture/adr/0097-…` |
| ADR-0098 | *Accepted.* System One, always on. Overturns 0097's observation-only posture: typed judgment becomes the default actuator, with autonomy set by reversibility class (A additive, B queue resolution, C subtractive, D contradiction → escalate, E authority → never), thresholds learned from survival, reversal and audit, one-call revert, and System Two (agents, the owner) as teacher. The addendum adds judgments declared per type, backfill owned by consolidation, learned mental-model applicability, and taxonomy growth from "residue". | `docs/architecture/adr/0098-…` |
| `@c15r/system1` | The organ, 1,560 lines: `perceive`, `sweep_suggestions`, `revert`, `label`, `calibrate`, `audit_sample`, `drive` (the judge rail for machine decisions), `backfill`, `taxonomy`, `retire_legacy`. Pure planning core exported and tested (30 cases in `tests/system1.test.ts`). It acts as a scoped principal under an `agent:system1.*` token. | `cells/system1/index.ts` |
| other Jev callers | `@c15r/consolidate` (Stage B adjudication on Jev), `@c15r/playtest` (ADR-0100: Jev picks each move among the legal ones the engine enumerates, then judges the session). | `cells/consolidate`, `cells/playtest` |

The jev · lab experiments carry the most useful finding in this area, measured and written down in
the code. Jev cannot generate: asked pixel by pixel, it paints noise (mean confidence 0.39), and it
cannot spell past the first character. But it recognises the right candidate sharply: a smiley 0.82
against 0.01, an answer 0.95–0.99. Its latency is nearly flat in width (64 nouls ≈ 1.1 s; the whole
20k lexicon as one `decide_many` ≈ 3 s). The design rule that follows is stated plainly in
`lib/answer.ts`: **code generates the candidate space; Jev discriminates within it; spend width to
save depth.** System One mostly follows it: closed option sets, live projects and goals as options,
and `none` always offered.

### 1.2 What the live slice says it has done

Read on 2026-11-04 with `workspace.peek` / `workspace.query`.

| signal | value | source |
|---|---:|---|
| perceive runs | **1,026**; latest 2026-11-03 23:49 (it perceived last night's lab deploy) | `_system1/run/*`, `_system1/latest` (revision 1,050) |
| facts carrying the perception marker | **1,436** (ADR-0098 counted ~9,800 facts in the slice) | `tag: s1:perceive-v1` |
| tagged `actionable` / `durable` | **91** / **759** (53% of perceived facts are "durable") | tag queries |
| input tokens per perceived fact | **~2,640** (the ADR's cost table assumed ~700) | latest run logs |
| time per single-fact perceive | **14–16 s**: load 7–8 s, Jev 1.6–1.9 s, act 5.7 s | `timings` in run logs |
| last calibration | **2026-09-24**, 348 labels: relate 0.98 (n 306), project 0.914 (70), serves 0.833 (36); every other question "too few labels" | `_system1/calibration` |
| audit labels (System Two as teacher) | **32**, all dated 2026-09-24 | `_system1/label/*` |
| last consolidation cycle | **2026-10-09**, delta **−110**; backlog 7,553 (unlinked 1,723, contested 2,419, stale 3,411), down from 10,719 before the backfill | `consolidation/latest` |
| that cycle's Stage B | 12 acted (all `independent` dismissals, e.g. two 2021 journal logs at 0.99), 40 fell back to `models`, 28 escalated | same |
| taxonomy residue report | last aggregated 2026-10-09: 60 runs, **0** residue items (today's runs do record residue, e.g. the lab deploys: project `none` at 0.52–0.66) | `_system1/taxonomy` |

So **perception is live and ambient**, as the addendum says. Within days of launch, though, **the rest
of the loop stopped**. The learner has not run since day one, nobody has audited since day one, and
consolidation (which owns backfill and the taxonomy report) last cycled 26 days ago. The backlog did
fall by about 30% while it ran.

### 1.3 Critique, most significant first

**1. The learner does not close, and its labels would not let it if it ran.**
- *Nothing schedules it.* `calibrate` and `audit_sample` are tools that something must call.
  ADR-0098 promises nightly recalibration. Protocol v3.4 then deliberately took System One out of the
  tending driver's hands. Nothing replaced it, so the thresholds have been the 2026-09-24 values for 41 days.
- *Survival is not the label the ADR defines.* §4 says a weak positive is "not reverted after N days,
  **while its subject was deliberately read at least once**". `runCalibrate`
  (`cells/system1/index.ts:1103`) labels an act correct if its edge is present right now: no minimum
  age and no read check. In a one-owner workspace nobody revisits most inferred edges, so survival
  measures inattention. Precision reads ≈0.98 by construction, and the calibrator (`calibrate()`:
  "the lowest θ that meets target") walks gates down toward their floors whenever it does run.
- *Most questions have no labels at all.* Only `link`/`ratify` acts are survival-checked. Tag acts
  (`actionable`, `durable`, `noise`, `type`, and every declared tag judgment) are labelled only by
  audits, and there are none for them. Their gates are the seed constants in `DEFAULT_THRESHOLDS`.
  "Autonomy earned per question" is, in practice, autonomy granted by hand-set defaults.
- *Gates are per question, not per (question, option)* as §4 specifies. One θ covers all 36 projects.

**2. Perception is one-shot, so judgments go stale.** `loadSubjects` excludes any fact already
carrying `s1:perceive-v1` unless `force` is passed (`index.ts:770`). An edited fact is never
re-judged, its old tags and edges stay, and nothing supersedes them. The ADR's cache key (subject hash
+ context + declaration + model) is implemented only for declaration versions, through backfill
markers. A capture that grows from a fragment into a plan keeps the judgment of the fragment.

**3. The data boundary is weaker than the ADR's own precondition.** ADR-0097 requires per-protocol
allow-lists of types and fields, redaction rules, and a decided retention posture. ADR-0098 made the
retention question "a precondition of Inc 3". The code uses a deny-list (`SKIP_TYPES`,
`SKIP_PREFIXES`), with no redaction, and no decision on TypeSafe retention is recorded anywhere. Yet
Inc 3 has been live since 2026-09-25, sending up to 1,800 characters of every settled write's text
off the AWS boundary.

**4. Not every act is revertible.** `revert` reports declines as "not restorable (the vector index
re-proposes it on reindex)". That contradicts invariant 3 ("every act is revertible in one call").
A tag revert rewrites the whole value under CAS, so it fails once the fact has changed. Reversibility
therefore decays with time, which is exactly when a late audit would want it.

**5. The real cost is writes and round trips, not Jev, and the cost model is out by ~4×.**
- A perceived fact costs ~2,640 input tokens. Most of that is the question schema: 36 projects with
  descriptions, the goals, the kind options.
- The money is still trivial (~$0.0001 per fact). The time is not: 14–16 s per single-fact perceive,
  of which Jev is under 2 s.
- Every perceived fact gets a whole-value rewrite just to stamp the marker, even when nothing else
  clears a gate. That is an extra revision and write per fact, on a slice that is one DynamoDB partition.
- The ADR itself found that "judging is not the cost; writing is"; the marker write is the same
  lesson, still unapplied.

**6. Much of what it materialises carries little information.**
- `durable` lands on 53% of perceived facts.
- `planRelate` ratifies a generic `relatesTo` whenever the "related mass" (1 − p(unrelated)) is
  ≥0.85, even when no specific relation clears θ.
- Stage B's acts are dominated by dismissing cosine false positives between templated logs and doc
  blocks. That is clean-up of a queue the embedding suggester creates, rather than the "short, real
  list of contradictions" the ADR promised.
- The useful outputs (`project:`, `serves`, a typed rel) are a minority of acts. No measure separates
  useful acts from churn.

**7. Tests cover the planner, not the organ.**
- The 30 tests exercise the pure core well.
- The two production bugs the ADR records are both in the untested shell: `workspace.edges` read
  as `{edges}` (scoring every surviving act as reverted, precision 0.097), and `drive` "judging" a
  work yield.
- Nothing tests `revert`, the labelling, or the gateway contract against a fake.

**8. Spend controls drifted from the ADR.**
- The adapter's default budget is 20M tokens a day; ADR-0098 specifies 5M.
- It is one global budget, not per scope as ADR-0097 asks.
- It is checked before a batch of up to 200 states, so a batch can overshoot it.

**9. The same game engine is vendored twice.** `cells/jev/client/playtest/engine` and
`cells/playtest/engine` hold ~47k lines of the playtest engine: 174 identical files, 19 already
diverged. This is most of both cells' line counts.

**What is genuinely good:**
- **The ADRs measure and correct themselves.** Probes, costs, incidents and audit misses are written
  into the decision, and two reversals (protocol v3.3→v3.4; the learner's 0.097 misread) are recorded
  rather than buried.
- **The reversibility-class model is the right safety framing** for an act-by-default organ.
- **The non-circularity rules are thought through.** The organ's reads weigh zero, its own writes
  never retrigger it, and its judgments never write reward. Moving bookkeeping under `_system1/`
  stopped the organ from feeding its own queue.
- **The kill switch and the scoped child token are in place.**
- **The jev · lab principle ("code proposes, Jev discriminates") is a real insight,** and the
  organ's closed option sets follow it.

### 1.4 What would make System One do what ADR-0098 says

1. **Give the learner a clock and honest labels.**
   - Run `calibrate` and a ~20-act `audit_sample` from the consolidation cycle (or a schedule of
     its own).
   - Count survival only after N days, and only if the subject was deliberately read in that window
     (the ADR-0050 human/agent read class).
   - Label tag acts by peeking at them, as edges already are.
   - Report label sources separately, so a precision figure built on inattention can't pass for one
     built on audits.
2. **Re-perceive on change.** Key the marker by subject version, or keep the judgment cache key the
   ADR describes. Supersede System One's own earlier tags and edges on a fact when it is re-judged.
3. **Decide the boundary.** Record the retention posture. Replace the deny-list with per-judgment
   allow-lists and a redaction step. Until then, consider shadow mode for personal types.
4. **Stop writing the marker into the fact.** Keep "perceived at version v" in the run log or a
   side index, or add a tag-only patch verb, so a no-op perception costs no revision.
5. **Cut low-information outputs.** Raise or drop `durable`, drop ratify-by-mass, and measure useful
   acts (later read through, or used by a query) rather than act counts.
6. **Find out why consolidation stopped on 2026-10-09.** Backfill, the taxonomy report and Stage B
   all hang off it.
7. **Test the shell** against a fake gateway: revert round-trips, survival labelling, edges shapes.

<!-- CORE -->

<!-- CELLS -->

<!-- CROSS -->
