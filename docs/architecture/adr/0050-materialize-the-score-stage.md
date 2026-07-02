# ADR-0050 — Materialize the score stage: persisted signals, honest standing

- **Status:** Inc 1 shipped 2026-07-02 — actor-classed counters (`touches`/`window`
  flat attrs + `recordTouch`) live in the store + scorer; reads no longer write the
  trajectory or allocate seq; `signalsFor` no longer scans the trajectory (degree
  only); centrality log-compressed (saturation 50); `typePriors` in
  `_config/salience`. Open: stream-maintained degree, the `_index/overview` digest,
  card projection at the store, `score0` GSI, counter backfill for pre-ADR facts.
  Amends ADR-0006 (the score stage) and repays the open cost question in
  `docs/substrate.md` ("trajectory-driven scoring is read/write-amplifying; bound it
  before it sits under every read").
- **Depends on:** ADR-0006 (salience as the score stage), ADR-0009 (edge strength),
  ADR-0013 (fact floor), ADR-0048 (read shaping).

## Context (grounded — two defects, one cost)

**Standing's memory is amputated at 24h.** `signalsFor` states its contract:
*"Lifetime (cumulative) terms need the full trajectory, so this reads from seq 0 —
the price of `standing`"* (`platform/runtime/state.ts`). But every trajectory event
is written with `ttl = at + TRAJECTORY_TTL_SEC` where `TRAJECTORY_TTL_SEC = 24h`
(`state-store-codec.ts` — "comfortably beyond the salience window" is true of the
1h burst window, false of the cumulative term). So standing — 30% of the blend,
re-weighted upward on 2026-06-15 precisely to protect earned-but-idle knowledge —
is actually `log1p(touches in the last day)`. Only imported facts survive on
persisted `seedReads`/`seedWrites`; **no natively-authored fact can accrue durable
standing at all.** The TTL predates the re-weight (`51c0fa4`, 06-11 vs 06-15): the
tuning was calibrated against a signal that was already broken.

**Attention is actor-blind.** `TrajectoryEvent` is `{op, scope, key, at, seq}` — no
actor. Cell deploys, tending-cron steps, canvas drags (145 revisions of one
placement), and agent peeks count identically to the owner deliberately touching a
fact. The machinery out-writes the human by an order of magnitude, so "attention"
measures machine churn — and reflexively: agents read what recall surfaces, each
peek appends a read event, which keeps it surfaced. Measured 2026-07-02: a
canvas-placement's drag geometry scored 0.6556 while the top knowledge claim scored
0.6523, and all 53 `decision` facts sat at 0.21–0.24.

**The cost.** Every scored read re-derives the world: full fact partition + full
trajectory partition + full edge partition + backbone regex over every record, per
read, per granted scope, serially — then two writes (`nextSeq` + trajectory Put) on
the read's critical path, all serialized through the single `SEQ#<scope>` item.

## Decision

Signals become **state on the record**, maintained at write time; the score stage
becomes per-record arithmetic. Five moves:

1. **Actor-classed persisted counters.** Each fact carries cumulative
   `reads`/`writes` split by actor class (`human` / `agent` / `platform`), plus a
   small windowed bucket pair for the burst terms. A touch is one `UpdateItem ADD`.
   `standing`/`attention`/`velocity` compute from the record; the scorer weights
   actor classes (platform ≈ 0, agent < human). This is the same mechanism as the
   import seeds, generalized — and it deletes the TTL bug rather than patching it.
2. **Weighted degree maintained by the stream.** The `SubstrateTable` stream
   consumer updates `degree` on both endpoints on link/unlink/fact-write, deriving
   backbone edges once at write instead of for the whole scope on every read.
   Centrality switches from hard saturation at 5 to log-compression (like
   standing), so a heavily-cited claim can outrank board plumbing (fixes the
   ADR-0006 promise the cap made impossible).
3. **Reads stop writing the trajectory.** The counter increment *is* the attention
   record — fired off the critical path. The trajectory shrinks to writes only
   (which is what `changes()` reports anyway); its TTL becomes honest. `nextSeq`
   contention leaves the read path entirely.
4. **A scope digest.** The stream consumer maintains `_index/overview` per scope
   (counts by type/prefix/band + top-N focus keys + the time-invariant `score0`).
   A bare `recall()` = one GET + one BatchGet of the focus facts, instead of ~10
   sequential partition scans and a cross-Lambda `describeTypes` hop. Granted
   scopes contribute digests; the grant fold parallelizes.
5. **Card projection at the store.** The ~240-char card tier (ADR-0048) is
   precomputed at write into its own attribute; `refs`/`card` reads use a
   `ProjectionExpression` — no canvas bodies or manifests over the wire.

**Type priors** enter the same resolution (defaults ← `_config/salience` ← lens ←
override): a declared type contributes a salience prior, so plumbing types
(`canvas-placement`, `log`, `machine-run`, cell-source `file`) sit low by default
without per-fact configuration. Declared on `_types/*` per ADR-0001/L1.

The nightly tend becomes the **repair organ**: recompute digests/`score0`/degree
from scratch (self-healing against missed stream events), apply decay
re-materialization, prune stale `similarTo`.

## Consequences

- Score = pure function of (record, now). Scoring a fact reads only that fact;
  read cost goes from O(scope × 3 partitions) to O(returned page). Lenses survive
  unchanged — the signal *values* live on the record, a lens is just weights.
- `explain` keeps working and gains actor-class visibility (which class earned the
  attention). Tuning stays evidence-driven.
- Focus bands become eventually-consistent (seconds behind the stream, repaired
  nightly) — strictly better than fresh-but-wrong, which is what the 24h TTL has
  been delivering.
- Rankable salience in `query` (substrate-gaps Gap 1) falls out: `score0` in a GSI
  bounds top-K reads.
- Migration: counters backfill from `seedReads`/`seedWrites` + a one-shot
  trajectory fold; ship the writer first, shadow-compare scores, then cut reads
  over.
