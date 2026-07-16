# ADR-0087 — Branchable substrate states: fork, pin, and replay for reproducible experiments

- **Status:** Proposed 2026-07-16 (drafted from
  `adr-request/branchable-substrate-states`, filed the same day during the
  membrane probe waves).
- **Depends on:** the scope partition (SubstrateTable — every read/write is
  already scope-keyed; the branching primitive has existed since the table
  did), ADR-0050 (touch counters — the salience field that must fork WITH the
  facts, and the replayability trade recorded there), ADR-0066 (content-hash
  versions — how two arms PROVE they start identical), ADR-0080/-0081 (the
  S3 analytics lake + archiver — permanent value history, Athena over it),
  ADR-0030/-0031 (per-scope vector indexes — an arm needs its own),
  ADR-0086 (participant keys — how probes in different arms stay
  distinguishable in telemetry), ADR-0024 (delegation — arm-scoped tokens).
- **Ancestor:** every VCS branch ever taken; PITR as the database tradition's
  "pin". The substrate's own trajectory log was built for *audit*, and this
  ADR is the moment audit grows into *reproducibility*.
- **Grounded in:** the membrane probe battery (`protocol/membrane-probes`,
  waves 1–3). Three confounds recurred in every synthesis: probes MUTATE the
  workspace they measure (writes, salience touches); replicas contaminate
  each other through stigmergy (the wave-2 CI double-ratify — awareness via
  committed writes is also interference via committed writes); and
  wave-over-wave comparisons ride an evolving substrate (wave 3's queue head
  was not wave 2's). Per-verb byte sizes and replicated critiques recover a
  clean signal *within* a wave, but nothing today makes two arms of an
  experiment START equal — the control every A/B needs.

---

## Context

The substrate already affords most of a branching story, unclaimed:

1. **Fork-at-now is a scope copy.** The scope partition means "copy every
   item of scope A to scope B" is a complete fork: facts, values, `_meta`,
   ADR-0050 touch counters (the earned-salience field), and edges. Two arms
   start byte-identical INCLUDING attention state, and ADR-0066 content
   hashes prove it row by row. ~6k facts today — cheap.
2. **Historical pin ≤35 days: PITR.** Table-level point-in-time restore
   reaches any second with full fidelity (values + edges + counters). Heavy,
   operational, zero new code — the escape hatch, not the daily verb.
3. **Permanent value history: the lake.** The archiver lands every fact
   write append-only with full `value_json`; "values at seq N" is an Athena
   materialization, forever.
4. **Differential analytics come free.** Both arms' histories land in the
   same lake; the diff IS an Athena query. The analysis half of A/B needs
   nothing new.

And two places where the affordance honestly runs out:

- **Edges are not archived.** The archiver skips edge partitions, so the
  graph's *past* is unreconstructable beyond PITR's window: historical
  replay rebuilds facts but not links.
- **There is no virtual time.** Recency decay, velocity windows, and fact
  timers evaluate wall clock. A pinned state read a week later has decayed a
  week — the *values* replay faithfully, the *salience field* does not. In
  CALM terms: the monotone substrate (facts, provenance, the append-only
  log) replays for free; the non-monotonic accumulators (recency, windowed
  velocity, timers) are exactly where reproducibility breaks. This boundary
  is load-bearing and the design must say so rather than paper over it.
- **Unverified (Inc 0):** `recordTouch` UPDATEs fact items on a
  NEW_AND_OLD_IMAGES stream, so touch-driven MODIFY events may already land
  archive rows. Whether `planArchiveRows` carries the touch attributes
  decides how lossy historical salience is — verify before designing around
  either answer.

## Decision

**Branching becomes a first-class, scope-native operation — fork-at-now as
the daily verb, PITR as the deep pin, lake replay as the historical
materialization — with the reproducibility boundary stated honestly:
values replay exactly; salience replays exactly at fork time, approximately
in history.**

### 1. `fork` — the admin verb (the experiment primitive)

`workspace.fork {to, prefix?, note?}`: copy the caller's scope at now into a
new arm scope (`<scope>#<arm>` or a caller-named scope) — facts with full
`_meta` and ADR-0050 counter attributes, edges, and the `_config/*` policy
facts; then rebuild the arm's vector index (per-scope, ADR-0030) and mint
arm-scoped tokens (ADR-0024 exchange, narrowed to the arm). Admin-gated,
audited as a fact in BOTH scopes (`_fork/<arm>` in the parent, `_fork/origin`
in the arm — each records source scope, seq head, timestamp, note). Version
hashes make "the arms start identical" a checkable claim, not a promise.

Deliberately NOT copy-on-write: at today's scale (~6k facts) an eager copy
is seconds of work and keeps every read path untouched — no fork-awareness
leaks into the hot path. COW is a scale decision for a later ADR if slices
grow orders of magnitude.

### 2. Arms are ordinary scopes

No special read/write semantics: an arm is a scope, so every existing verb,
grant, machine, and probe works unmodified inside it. Isolation is the
existing scope isolation; discarding an arm is deleting a scope (plus its
vector index and minted tokens). Probes in different arms carry ADR-0086
participant keys, so even shared dashboards/telemetry stay attributable.
The wave-2 contamination class (stigmergy across replicas) dissolves:
replicas that must not see each other run in different arms; replicas that
SHOULD coordinate (wave 3's lease test) run in one.

### 3. Historical states — pin and replay, tiered by fidelity

- **≤35 days, exact:** PITR restore into a scratch table, then scope-copy
  out the slice at that instant. Full fidelity including counters and edges.
  Operational runbook, not code.
- **Any age, values-exact / salience-approximate:** materialize
  values-at-seq-N from the lake into a fresh scope. Labeled honestly:
  `_fork/origin.fidelity: "values"` — the salience field is *recomputed*,
  not restored (and until Inc 3 lands, edges only as currently live).
- **Virtual now (opt-in, test-only):** a read-path override
  (`salience:{nowMs}` — one more field on the existing per-call salience
  override) so a replayed state can be READ as of its own time: recency,
  windows, and timers evaluate against the pinned clock. Never settable by
  standing config — per-call, explicit, and stamped into `_meta.explain` so
  a biased read can't masquerade as a live one.

### 4. Close the edge-history gap

Extend the archiver to land edge put/delete rows (the same append-only
shape facts get). From that point forward, historical reconstruction
includes the graph; the pre-extension past stays values-only and the
fidelity label says so.

## Costs & honesty

- **Fork is a copy: divergence is permanent.** There is no merge verb and
  this ADR does not promise one — arms are for experiments (measure, then
  discard or cherry-pick by hand), not long-lived branches. The moment
  someone wants merge, that is a new ADR with CRDT-shaped problems.
- **The salience boundary cannot be engineered away**, only labeled. Every
  pinned/replayed state carries a fidelity marker; the virtual-now override
  covers reads but nothing retroactively recovers un-archived touch detail
  (pending Inc 0's verdict).
- **Vector indexes must fork too** or arm searches silently read the
  parent's meaning-space. The rebuild is the reindex path (ADR-0031),
  async and chunked; a fork is not "ready" until its index is (the
  `_fork/<arm>` fact carries the reindex status key).
- **Scope explosion is a hygiene problem.** Arms are cheap to make and easy
  to forget; the `_fork/*` audit facts + a timer-leased default (an arm
  expires like presence unless renewed) keep the fleet tendable — the
  substrate's own physics, reused.
- **PITR restores are table-wide and slow** — acceptable for the rare deep
  pin, wrong for the daily loop; that is why fork-at-now leads.

## Increments (dependency order)

0. **Verify touch archiving** (read `planArchiveRows` + a live MODIFY event
   in the lake): decides the fidelity label's fine print.
1. **`workspace.fork`** (facts + counters + edges + config, audit facts both
   ends, vector reindex, arm tokens) + `discard` (scope + index + token
   cleanup). The A/B primitive.
2. **Battery integration:** the membrane probe protocol
   (`protocol/membrane-probes`) gains an arms mode — same probe per arm,
   participant-keyed, Athena diff, discard on synthesis. The first consumer
   and the acceptance test.
3. **Archive edges** — the graph gains a past.
4. **Historical materialization** (lake → fresh scope at seq N) + the
   virtual-now read override, fidelity-labeled.

Validation mirrors the request's motivation: wave N runs twice in parallel
arms forked from one state; the arms' results diff to noise where the
substrate is monotone, and the residual diff IS the measured cost of the
non-monotonic accumulators — the reproducibility boundary, quantified.
