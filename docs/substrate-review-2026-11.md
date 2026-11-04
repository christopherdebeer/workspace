# Substrate review: System One, decision models, the core, and the cells

*2026-11-04 · a read of `docs/`, `platform/`, `services/`, `cells/` and `tests/` at `claude/technic-lab`,
plus read-only queries of the live slice (`workspace.peek` / `workspace.query`) for what System One
and consolidation have actually done. `npx jest` passes: 91 suites, 1,257 tests. Nothing was changed.*

## Summary

**What it is.** A personal substrate:
- **Facts** `{value, _meta}`, with provenance, salience, typed declarations, and authored, derived
  and inferred edges.
- **Three MCP verbs** (`whoami`/`read`/`act`) over a gateway, on one DynamoDB table with three stream
  consumers (vectors, a lake, an event fan-out).
- **24 deployable cells.** Some are cognitive organs: consolidation, System One, machine, lit, tasks,
  input. Others are tools (Jev, models, run), apps, and a large amount of exploration (lab, drive,
  playtest).

**The most important findings, across everything:**

1. **The cognitive loop runs on one leg.**
   - System One's perception is live and ambient: 1,026 runs, the latest last night.
   - The parts that make it learn have not run since launch: no recalibration and no audits since
     2026-09-24. Consolidation, which owns backfill and the taxonomy report, last cycled on
     2026-10-09.
   - The learner would mislearn if it ran, because "survived" means "still present", not "still
     present after N days and read".
   - Perception is one-shot per fact.
   - Facts edited more than 50 times stop triggering subscriptions at all (§2.3).
2. **Work has moved off the substrate.**
   - Since 1 October, 1,037 of 1,045 commits are in `cells/lab`.
   - `platform/`, `services/`, `lib/` and the organs have not changed since 2026-09-25.
   - The four largest cells (drive, lab, playtest, jev: 86% of cell code) read and write no facts.
     They use the platform as hosting, auth and a CDN.
   - The substrate's distinctive machinery (salience layers, `_caps`, contested, consolidation) is
     maintained for a slice that is mostly written by the organs themselves.
3. **Authority is broader than the design says.** Security findings about how token scopes, cell
   grants and cell IAM are enforced were reported to the owner directly. **Because this repository
   is public, they are deliberately not recorded here.**
4. **Durability and correctness hazards in the core.**
   - The substrate table, the auth table and the code bucket are created with DESTROY removal
     policies.
   - A non-CAS write can lose a concurrent write's fan-out announcement.
   - Every read is a write (touch counters), which amplifies the stream and the lake.
5. **The design record is honest but no longer a reliable map of the code.**
   - 100 ADRs, none ever marked superseded.
   - Several say "Proposed" but are built (0081, 0095); several are accepted but unbuilt (0079,
     0087, 0088, 0096).
   - Some contradict each other without recording the reversal (0044 vs 0024; 0067's "three
     shapes, not thirty tools" vs 43 workspace tools).
   - `docs/architecture.md` and several `CLAUDE.md` files describe code that no longer exists.

**What is strong:**
- One fact primitive with one implementation, guarded by memory-vs-Dynamo parity tests.
- A stable three-verb surface where discovery is data.
- Isolation enforced by IAM leading keys.
- Pure planning cores split from I/O, under a fast suite.
- ADRs that record measurements, incidents and their own mistakes.
- In the Jev lab, a genuinely new design principle: code proposes, a judging model discriminates.

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

## 2. The substrate core

### 2.1 What it is, in its own terms

- **Fact.** `{value, _meta}` is the only data primitive (`platform/runtime/state.ts:51`). `_meta`
  holds three things:
  - provenance: revision, content-hash version, per-scope seq, writer, `via`, `as`, writers;
  - lifecycle: supersede, never delete;
  - indexable type and tags, a timer, and read-time salience (score, velocity, standing, centrality,
    relevance, reward).
- **Edges.** Authored `{from, rel, to, strength}`; "backbone" edges derived from type rules; inferred
  `similarTo` from the vector indexer; and, since ADR-0098, System One's inferred tier at strength 0.6.
- **Declarations.**
  - `_types/<type>`: one object with facets (shape, present, handlers, manager, and now judgments).
  - `_actions/`, `_views/`, `_subscriptions/`: facts, run by a fixed interpreter with CEL guards.
- **Tenancy.** Scope = principal = a DynamoDB partition. Shares are grant items, plus groups and a
  `public` audience. No branching: ADR-0087 is unbuilt.
- **Verbs.** Three MCP tools at the gateway (`whoami`, `read`, `act`).
  - Targets resolve to sentinels (`$catalog`, `$types`, `$graph`, `$grants`, `$cells`), provider
    commands (`workspace.*`, `cells.*`, `auth.*`), or cell tools (`@owner/cell.tool`).
  - Each call gets input validation, a 60 KB read budget and a capability-touch event.
- **Storage.** One table (facts, edges, a 24 h trajectory, sequence counters, grants) with streams
  to three consumers:
  - the vector indexer: Bedrock Titan embeddings into S3 Vectors, plus `similarTo`;
  - the archiver: Firehose to an S3 lake, queried with Athena;
  - fact-fanout: `workspace.fact.written` on EventBridge.
- **Auth.**
  - Passkeys plus OAuth 2.1, with dynamic client registration and open sign-up.
  - Hashed tokens, 30-day refresh, two scope spellings (`workspace:read` and `read:workspace`).
  - Postures, delegation chains and participants ride on the identity.

### 2.2 Components

| component | does | size | tests | status |
|---|---|---:|---|---|
| `platform/runtime/state.ts` (+ codec, Dynamo store) | facts, CAS, edges, 7-signal salience, ranking, timers | ~3.2k | ~140 incl. memory/Dynamo parity | live |
| `platform/runtime` service/MCP/auth/vectors/projection | Lambda entry, MCP JSON-RPC, scope algebra, vector seam, type resolution, cell SDK | ~3.3k | ~140 | live |
| `platform/infra` | CDK constructs: table, service cells, router, bus, dynamic-cell control plane, analytics lane | 1.4k | public namespace only (26); none for the table, control plane or lane | live |
| `platform/ui` | vocab resolver, markdown, forms, sandboxed renderer host | 2.2k | ~70 | live |
| `services/gateway` | the MCP membrane | 2.2k | ~65 | live |
| `services/workspace` | 43 tools, 9 bus handlers, reactor, tend, machine tick | 7.8k | ~270 | live |
| `services/auth` | passkeys, OAuth, tokens, posture | 3.9k | 91 (no WebAuthn tests) | live |
| `services/cells` (forge) | registry, source trees, transpile, deploy, tool dispatch | 6.4k (`service.ts` 3.7k) | ~90 | live |
| `services/dispatch` | `/@owner/cell` routing, SSR, caller writes | 0.5k | 26 | live |
| `services/fact-fanout` / `vector-indexer` / `substrate-archiver` | stream consumers | 0.2k / 0.5k / 0.1k | 6 / ~40 / 4 | live |
| `lib/platform-stack.ts` | wiring (46% comments) | 0.6k | no synth assertions | live |
| `lib/inline-lambda-stack.ts` | an empty stack kept for teardown | 22 lines | — | dead |

### 2.3 Critique of the core (security items reported privately)

1. **Stateful resources would be destroyed with the stack.** `new SubstrateTable(this, 'Substrate')`
   passes no `retain` (`lib/platform-stack.ts:77`), so it takes the construct's DESTROY default
   (`platform/infra/substrate-table.ts:49`). The auth table is the same, and the code bucket is
   DESTROY with auto-deleted objects (`platform/infra/dynamic-cell-control-plane.ts:51`). Only the
   lake is retained. One mistaken `cdk destroy`, or a construct-ID change, deletes the workspace.
2. **The reactor's depth cap is a lifetime cap.** `if (revision > (sub.maxDepth ?? 50)) skip`
   (`services/workspace/event-handlers.ts:663`) compares the fact's lifetime revision, not the
   reaction chain's depth. Any fact edited more than 50 times silently stops triggering every
   subscription, including System One's perception. The facts edited most are the ones this hits.
3. **Lost announcements.** A write without CAS is a read followed by an unconditional put, so two
   writers can stamp the same revision. fact-fanout's "revision changed" filter then drops the second
   write's announcement, and its reactions never fire. Nothing de-duplicates across stream, bus and
   Lambda retries, and fan-out emits sequentially, so a mid-batch failure re-emits.
4. **Reads are writes.**
   - `get` records a touch with an `UpdateItem` (`state.ts:2075`). That writes the all-projection type
     index and produces a stream record for all three consumers.
   - Several reads scan a whole partition: `read`/`recall`, `members`, `attention`, `contested`,
     `suggestions`, and `ratify`, which reads every edge to drop one pair.
   - Superseded history is never compacted, because ADR-0079 is unbuilt.
   - Neither token validation nor `describeTools` is cached, so a plain `read` is three synchronous
     Lambda hops plus an event.
   - `$catalog` silently truncates at 25 cells.
   - The July cost review found 1.29 billion read units against a 51 MB table.
5. **The core knows about particular cells and one user.**
   - Machine-run logic lives in fact-fanout and in the workspace tick.
   - The vector indexer maintains home's `_home/embed2d`.
   - Tend and tick are hard-coded to `scopes: ['c15r']` (`lib/platform-stack.ts:346,366`). Sign-up is
     open, but degree reconciliation and capability refresh never run for anyone else.
6. **Duplicated mechanisms.**
   - Authority lives in five places: token scopes, slice grants, cell grants and tool grants, the
     `_public/` mirror, and `_groups/`.
   - Capabilities exist both live and as ~2.5k `_caps/` facts rewritten daily.
   - Scopes have two spellings.
   - Retired verbs survive as aliases.
   - Three event logs exist (trajectory, stream, lake), though ADR-0013 says history "never grows a
     second event log".
7. **The docs no longer map the code.**
   - Wrong about the code:
     - `services/CLAUDE.md` lists `documents/` and `render/` services that don't exist;
     - `tests/CLAUDE.md` lists WebAuthn tests that don't exist;
     - `architecture.md` cites a deleted state store and only 11 of 24 cells;
     - `architecture.md` and `technical-spec.md` still describe hand-emitted `fact.written`, which
       ADR-0089 removed;
     - `substrate-storage.md` says CEL is "not yet", but it shipped.
   - Status drift in the ADRs: 0081 and 0095 say "Proposed" but are built. No ADR is ever marked
     superseded; statuses are edited in place.
8. **Jargon load.** Around 633 ADR citations and ~80 incident codes in core comments, and 32–46% of
   key files are comments. At least 18 reserved `_` namespaces carry behaviour through key strings.
   On top of that sits a five-layer salience merge over seven signals plus type priors, tuned by one
   person. It is rich, and it is expensive for anyone (including an agent) to hold in their head.

## 3. The cells

### 3.1 Catalogue

The clone is shallow, so commit counts are lower bounds. "Touches" is how each cell reaches the
substrate:
- **SDK**: reads through `@parc/runtime/cell`.
- **kernel**: the browser kernel's `substrate.js`.
- **raw**: hand-written `STATE#` reads.
- **organ write**: an EventBridge `substrate.write.requested` event.
- **gw**: a gateway call with a bearer token.
- **own table**: the cell's own DynamoDB table.

| cell | kind | what it is | touches | TS lines | CI tests | status |
|---|---|---|---|---:|---|---|
| consolidate | organ | the self-maintenance loop: observe, act the safe tier, score the backlog delta (ADR-0073/0077) | gw (caller token), SDK, jobs, own table; calls jev, models, system1 | 0.8k | 2 | built; last cycle 2026-10-09 |
| system1 | organ | fast perception and default actuator (ADR-0098) | gw, SDK, jobs; calls jev, tasks, machine | 1.6k | 1 (30 cases) | perception live; learner idle |
| machine | organ | workflow machines as facts; rails become actions and subscriptions | kernel (its only adopter), 4 types, 3 renderers | 2.6k | 1 | built; reactive machines "dead since July" (ADR-0098) |
| lit | app + organ | doc reader; markdown ingestion into doc and block facts | raw, organ write, gw (minted token), 4 types | 2.9k | 1 | live (docs-sync on deploy) |
| tasks | organ / vocabulary | goals and tasks; read by posture, system1 and consolidate | SDK, organ write, 2 types | 0.3k | 0 | live; frozen since July |
| input | organ | capture PWA writing `inbox/<ts>` | organ write, form | 0.5k | 0 | unknown; untouched since July |
| models | tool | generative executor, holding its own provider secrets | raw, organ write, gw, jobs, own table | 1.0k | 0 | frozen; generative path "dead" (ADR-0098) |
| jev | tool + lab | the Jev adapter, metered; the jev · lab experiments | own table, secret; no facts | 53k (~48k vendored engine) | 0 (smoke scripts) | live dependency |
| run | tool | server-side JS with `parc.read/query/emit/call` | raw, organ write, gw, jobs | 0.3k | 0 | live |
| kernel | shared SDK | browser kernel plus server modules copied into cells | imported by URL by 11 cells | 2.2k | 3 | live, critical |
| viewers / editor | shared modules | renderers (json/csv/mermaid/repl); a CodeMirror editor | — | 0.5k / 0.3k | 0 | live |
| home | app (front door) | SSR landing, graph, field computer | raw, 18 types, renderer host | 13k | 7 | live; quiet since August |
| canvas | app | spatial lens: fact × renderer × placement | raw, kernel outbox, 3 types | 9.9k | 3 | live; stale since August |
| starter | template | the canonical cell exemplar (the only user of caller writes) | SDK, caller writes, ssr | 0.3k | 1 | reference |
| regwatch | app | FCA regulatory inbox for a second user, ported from val.town | own table; no facts | 1.2k | 0 | unknown; no change since the port |
| shelved | app | social book lending with shipping labels (a live app, despite the name) | own table (other users' addresses), secret; no facts | 2.1k | 1 | dormant |
| drive | product | pixel-art driving game over real map data; ships to Steam/iOS | own table, public namespace, own OAuth client; no facts by design | 129k (`main.ts` 65k) | 1 (175 in-cell, not in CI) | dormant since 09-28 |
| lab | exploration | 25 GL/3D experiments in one cell | public namespace only | 90k | 0 (24 devtools tests) | the only active cell |
| playtest | experiment | game design by hill-climbing Jev playtests (ADR-0100) | own table, jobs, stores an owner bearer for Jev | 55k (~49k vendored) | 0 | dormant |
| stillwater | app | children's numeracy game | none | 13k | 5 | dormant |
| poetics | exploration | prompt-form research, published as a site | read-only tools | 1.3k | 1 | frozen artefact |
| reef-writer | stub | a 23-line untyped organ write | organ write | 23 lines | 0 | dead |
| mistwood | stub | a redirect to `lab/mistwood` | — | 12 lines | 0 | tombstone |

**Groupings.**
- **Organs:** consolidate (calls system1, jev, models), system1 (calls jev, tasks, machine), machine
  (turns rails into subscriptions), lit (ingestion), input (capture), tasks (the goal and task
  vocabulary).
- **Executors:** jev (judgment), models (generation), run (code).
- **Shared:** kernel, viewers, editor. **Front door:** home. **Template:** starter.
- **Apps that live on the substrate:** canvas, lit. **Apps that use the platform only as hosting,
  auth and a table:** regwatch, shelved, stillwater, drive.
- **Explorations:** lab, playtest, poetics, jev · lab.

### 3.2 Critique of the cells (security items reported privately)

1. **The largest cells are separate products that do not use the substrate.**
   - Cells hold ~380k TS lines, against ~32k in `services/` plus `platform/`.
   - drive, lab, playtest and jev are 86% of cell code, and none reads or writes facts.
   - drive is outgrowing the cell model: its deploy Lambda uses ~700 of 1,024 MB, `main.ts` hit the
     single-write ceiling, it carries its own native CI, and it has a 19.5k-line `CLAUDE.md`.
   - These products also inherit owner-level platform authority they have no use for.
2. **Substrate access is fragmented, against ADR-0017** ("one shared client, not a re-implementation
   per cell").
   - The kernel's `substrate.js` is used only by machine.
   - The `@parc/runtime/cell` SDK is used by four cells.
   - Six cells hand-write `STATE#` reads, and six hand-write organ write events.
   - A key-layout change would break them silently, and several have no tests.
3. **Organs have no identity of their own.**
   - consolidate and system1 act only under a token a caller passes in.
   - playtest stores an owner bearer to reach Jev ("cells get no service identity").
   - What triggers each organ (a tending machine, a subscription) lives in facts, not the repo. So
     whether the organs run cannot be read from the code, and it has silently stopped before:
     machines in July, consolidation in October.
4. **Cells are outside CI.**
   - The root and client `tsconfig`s include only `bin`, `lib`, `platform` and `services`.
   - jest's only root is `tests/`.
   - Twelve cells have no CI tests, among them run (arbitrary code), models (secrets), tasks, jev and
     playtest.
   - drive's 175 and lab's 24 in-cell tests never run in CI.
   - Cells deploy outside CI through `cell-sync`, and only 8 of 24 have a sync baseline. For the
     rest, the drift between git and what is live is unknowable.
5. **Duplication.**
   - The playtest engine is vendored twice (~47k lines each; 174 files identical, 19 diverged).
   - Secret custody is written four times (models, jev, shelved, playtest), each as items in the
     cell's own table rather than Secrets Manager or KMS.
   - `md.ts` is copied between lab and poetics, and machine's client copies home's.
6. **The cell contract is mostly unused.**
   - `/_tools`, the caller header and own tables are used everywhere.
   - The audited caller-write path (`x-parc-writes`) has one user: the template.
   - `ssr.json`: 3 cells. `ui://` renderers: 4. The public namespace: 2.
7. **consolidate and system1 overlap.** Both ratify, unlink and supersede on the same suggestion and
   edge queues, and each has its own learning signal (ADR-0070 reward versus `calibrate`). Which one
   owns those queues is unwritten.
8. **Runtime coupling.**
   - 11 cells import `https://parc.land/@c15r/kernel/app.js` unpinned, with a 60 s cache. A kernel
     change reaches every surface at once, with no redeploy and no type contract (the shim is `any`).
   - viewers loads `mermaid@11` from a CDN.
9. **Dead weight and naming.**
   - Retire: reef-writer, mistwood (a stack for one redirect), and jev's engine copy.
   - Probably stale: regwatch, models, input.
   - Confusing names:
     - "drive" is both the game and the machine's drive mode, and ADR-0095 conflates the two;
     - there are three "labs";
     - "shelved" is a live app.
10. **Against the stated tenets (`CLAUDE.md`).**
    - "AWS native": generation and judgment call Anthropic, OpenAI, Google and TypeSafe directly;
      Bedrock is used only for embeddings.
    - "Composable React": `@parc/ui` is used by 5 cells.

## 4. What it adds up to

The substrate was designed as a workspace that tends itself:
- facts arrive and are perceived;
- structure accretes;
- salience learns from use;
- organs consolidate;
- the human keeps authority, contradiction and vocabulary.

The September work (ADR-0097–0100) was the most coherent step towards that. It priced judgment
honestly, chose the right instrument (a discriminating model over closed option sets), and recorded
its own measurements.

The system as it stands is a different thing. **A large, careful platform hosts mostly
non-substrate products. A perception organ runs on every write, while the loops that would correct
and use what it writes are idle.** The risk now is that the substrate's complexity keeps costing
(reads that write, full-partition scans, daily `_caps` rewrites, organs that need tokens and
triggers to stay alive) while its distinctive value goes unexercised.

Two honest directions, not mutually exclusive:

1. **Make the substrate earn its keep.** Close System One's loop properly (§1.4). Give organs a
   service identity and a schedule in code. Fix the lifetime depth cap and the lost-announcement
   race. Make consolidate and system1 one owner of the queues. Then measure a single outcome:
   facts that were filed, linked or surfaced by the system and *then used*.
2. **Separate the platform from the products.** Give hosting-only cells (lab, drive, playtest,
   stillwater, regwatch, shelved) a tier with no substrate IAM, or move them out of the repo. That
   shrinks the authority surface, gets their code into a CI that checks it, and makes the
   substrate's own size and health visible.

Either way, before anything else:
- retain the stateful resources;
- act on the privately reported authority findings;
- record a decision on what text leaves the boundary for TypeSafe.

## 5. Open questions for the owner

1. Is this a multi-tenant product or a single-owner tool? Open sign-up and per-user slices sit
   uneasily with `c15r`-only schedules and organs that need the owner's
   token.
2. Which organs should run on a schedule, and as whom? Should consolidation and System One become
   one tending organ?
3. Should System One's survival labels require age and a deliberate read? Should tag acts be
   labelled? Who audits, and how often?
4. What is TypeSafe's retention posture for the text System One sends, and which types may leave
   the boundary at all?
5. Should hosting-only cells lose substrate IAM, or leave the repo?
6. Which SDK is canonical for cells (`@parc/runtime/cell` or the kernel), and should cells join CI
   type-checking and tests?
7. What is the forgetting story (ADR-0079 is unbuilt; every list reads all superseded history)?
8. Do the unbuilt accepted ADRs (0079, 0087, 0088, 0096) stay as backlog, and should ADRs gain a
   real "Superseded by" status?
9. Which of the salience machinery (lenses, posture, reward, `_caps`, contested) is used week to
   week, and worth its read and write cost?
