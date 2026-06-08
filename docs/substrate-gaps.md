# Substrate gap analysis — missing primitives vs the legacy workspace

A grounded comparison of the **new platform substrate** (`f5bbef8d`, this repo:
`platform/runtime/state.ts` + the `workspace` cell) against the **legacy rich
workspace** (`cb2166bd`, sync's mature knowledge substrate, ~386 entries / 834
links / 76 runs, with autonomous tending). Goal: name the **primitives the new
substrate is missing** — the substrate layer, not the orchestrator.

> **Framing principle (from the user, and confirmed in the legacy itself).**
> Orchestration stays *external* to the substrate. The legacy tending protocol
> says it outright — *"Just-in-time tending replaces crons. Since Claude can't be
> triggered on a schedule, maintenance surfaces [on read]."* So "tending" is **not**
> a scheduler the substrate runs; it is a **derived read** the substrate exposes,
> which an external agent acts on. Everything below is about giving the substrate
> the primitives that let an *external* orchestrator coordinate safely — leases,
> links, query, a change feed — not about the substrate doing the scheduling.

## What each side has today

| Capability | Legacy (`cb2166bd`) | New substrate (`f5bbef8d`) |
| --- | --- | --- |
| Write | `add` (typed) / `update` (in-place) | `remember` (`put`, revision-bumping) |
| Read one | by id | `peek` (`get`) |
| Read many | `search` (text+tags+type), `salience` (top-N), `tags` (facets) | `recall` — the **whole slice**, salience-shaped |
| Retire | `supersede` (migrates links) | `supersede` (no link awareness) |
| Links | first-class: `link(from,rel,to)`, `links(id)` → inbound+outbound+**implicit** | none (reified as `l:` value-facts by convention) |
| Salience | **stored** scalar, rankable/filterable | **read-time** shaping only (focus/peripheral/elided) |
| Work / runs | `run_start/wait/complete/list` — status lifecycle + blocking wait + `produces` links | none |
| Maintenance | `tending` — derived "what needs attention" | none |
| Multi-tenant | single user | **per-user slices + sharing/views** ✓ (new is ahead here) |
| Provenance | `created_at`/`updated_at`/`read_count` | server-stamped writer/revision/trajectory ✓ |

The new substrate is *deliberately* more primitive, and ahead on multi-tenancy,
provenance, and read-time (always-fresh) salience. The gaps below are the price of
that minimalism — and they're the ones that bite as a slice grows past a handful
of facts (the live `substrate-on-cells` slice is already reifying type/tags/links
into values it then **cannot query**).

---

## Gap 1 — Query / projection + indexable attributes (the biggest)

**Evidence.** Legacy reads are *projections*: `search(type="source", tags=["indexable"])`,
`salience(limit=20, type=…)` (returns a ranked list with scores `21.31 … -4.69`),
`tags` (faceted index), `links(id)` (neighbours). The new substrate has exactly
two reads: `recall` (the entire slice) and `peek` (one key). There is no filter,
no rank, no pagination, and **nothing but the key is indexed** — a fact's value is
opaque JSON. The `substrate-on-cells` graph already encodes `type`/`tags` inside
the value, then has no way to ask "all `type=decision`" or "tagged `tending`"
without pulling and scanning the whole slice client-side.

**Missing primitive.** A query/projection over indexed attributes:

```
query(scope, {
  prefix?, tag?, type?, since?, until?,
  rankBy?: 'salience' | 'recency', limit?, cursor?
}) → { entries, cursor }
```

This requires lifting a few **indexable attributes** out of the opaque value —
minimally `tags: string[]` and `type: string` on `put` (stored as first-class,
GSI-backed), plus exposing the already-computed salience as a **rankable** value,
not just a tier label. Without an index, query is impossible; with DynamoDB GSIs
it's cheap. *This is the single highest-leverage gap* — recall-all does not scale.

## Gap 2 — Links / edges as a first-class primitive

**Evidence.** The legacy graph is real and load-bearing: `links(b27cf397005a4f)`
(the tending protocol) returns **9 outbound + 78 inbound** typed edges
(`executes`×34, `grounds`×18, `refines`×6, …) over an 18-verb `rel` vocabulary
with `strength`, **plus 5 implicit edges derived from shared tags**. The new
substrate has no edges; the `substrate-on-cells` schema reifies them as
`l:<from>|<rel>|<to>` value-facts, which means:
- **traversal = scan** every `l:` key (O(slice)), with no inbound index — you
  can't cheaply ask "what points at X";
- **no derived/implicit links** (shared-tag or co-citation relatedness);
- **supersede orphans edges** — retiring `e:foo` leaves dangling `l:…|foo`
  facts. Legacy migrates links on supersede / `run_complete` (it creates
  `produces` edges as a lifecycle side-effect).

**Missing primitives.**

```
link(scope, from, rel, to, { strength? })
unlink(scope, from, rel, to)
neighbors(scope, key, { dir?: 'in'|'out'|'both', rel? }) → edges + entries
supersede(scope, key, by, { migrateLinks?: true })   // carry edges to successor
relatedByTag(scope, key)                              // optional: derived/implicit
```

An **inbound index** is the key addition (the convention can't provide it). Edge
migration on supersede keeps the graph from rotting as facts are retired.

## Gap 3 — Coordination: lease / visibility-timeout / atomic claim

**This is the tending/protocol enabler you flagged — and it is *not* scheduling.**
Legacy models in-flight work as durable status-bearing entries: `run_start`
creates `type=run, status:pending`; `run_complete` flips it to `complete|failed`
and links `produces` artifacts; `run_wait` **blocks until terminal or timeout**;
`run_list(status="pending")` lets tending avoid double-dispatch. The *firing* is
external (routine `/fire` endpoints, claude.ai schedules); the substrate only
holds and transitions the work state. The new substrate has **no** way to do this
safely. The missing cluster, all of which DynamoDB gives cheaply:

- **Conditional write (CAS).** `remember` is last-writer-wins. Add
  `put(…, { ifRevision?, ifAbsent? })` (DynamoDB `ConditionExpression`) so two
  workers can't both claim the same item. *This is the foundational coordination
  primitive* and we already have the revision to condition on.
- **Lease / visibility-timeout.** `claim(scope, key, { leaseMs })` sets a
  `claimedUntil = now + leaseMs` attribute; `query`/`recall` treat a fact as
  **invisible while `claimedUntil > now`** and it **reappears** when the lease
  lapses (crash-safe hand-off — SQS-visibility-timeout semantics). Plus
  `heartbeat` / `release` / `complete`. Note: this is an *attribute + filter*, not
  literal deletion. (DynamoDB **TTL** is the right mechanism for a *different*
  need — genuinely **ephemeral facts** that should auto-GC: claims, transient
  signals. Worth adding `put(…, { ttl })` too.)
- **Await.** `await(scope, key, { until, timeoutMs })` — block until a fact
  reaches a terminal state (legacy `run_wait`). Can ride Gap 4 instead of polling.

Together these let an **external** orchestrator run protocols reliably — claim,
work, heartbeat, complete, and reclaim anything that timed out — with the
substrate owning only the coordination state, never the schedule.

## Gap 4 — Change feed / watch (mostly already there)

**Evidence.** External orchestration is reactive, and the new substrate already
keeps a **trajectory log with a monotonic `seq`** (today used only to compute
salience). That *is* a change-feed substrate. Exposing it:

```
changes(scope, { sinceSeq, limit }) → { events, seq }   // tail the trajectory
```

(optionally backed by DynamoDB Streams → the event bus) lets workers react to new
/ superseded / claimed facts without re-`recall`-ing the slice. Low cost — `seq`
exists; we just don't surface it. The cell already emits `workspace.fact.written`,
so half of this is built.

## Gap 5 — Tending as a derived view (the "just-in-time cron")

**Evidence.** `workspace_tending` = "surface maintenance prompts. The just-in-time
cron." It returns *derived* attention — stale sources (by `updated_at` windows),
the singleton-tag tail, unlinked entries, in-flight-too-long runs — computed from
substrate health, **not** a scheduler. An external agent reads it at session start
and acts.

**Missing primitive.** A derived maintenance view:

```
attention(scope) → { stale[], orphaned[], expiredClaims[], drifting[], … }
```

Importantly this is **not new storage** — it *composes* Gaps 1–4 (query by
recency + neighbour-degree (orphans) + expired leases + change-feed deltas). It's
the substrate's read-time "what needs attention," exactly mirroring legacy's
JIT-tending-replaces-crons stance. Orchestration (acting on the prompts) stays
external.

---

## Priority & how to add them (in the substrate's style)

Add additively via `StateStore` methods + `workspace` read/act targets, the way
sharing was layered on — no churn to the monotonic core.

1. **Gap 1 (query + indexed tags/type + rankable salience)** — unblocks
   everything else and is what breaks first at scale. Do first.
2. **Gap 3 (CAS → lease/visibility-timeout → await)** — the coordination floor
   for *any* external protocol/tending. `ifRevision` is a tiny, high-value start.
3. **Gap 2 (first-class links + inbound index + supersede migration)** — makes the
   `substrate-on-cells` graph native instead of convention, and stops link-rot.
4. **Gap 4 (`changes(sinceSeq)`)** — cheap; turns polling into tailing.
5. **Gap 5 (`attention()`)** — falls out of 1–4 as a derived read.

### Preserve (new-substrate strengths, don't regress)
Per-user slices + sharing/views (legacy is single-user), read-time/always-fresh
salience (vs a stored field that can drift), monotonic revisions + server-stamped
provenance, and the `read`/`act` surface. The gaps above should be filled *without*
giving up these — e.g. salience stays read-time but becomes **rankable** in
`query`; links become first-class but stay **per-slice and shareable**.

> Net: the new substrate has the right *floor* (observed state, provenance,
> multi-tenant views). What it lacks are the **query, graph, and coordination**
> primitives that turn a flat per-user KV into a substrate an external orchestrator
> can run protocols against — with leases/visibility-timeouts (Gap 3) being the
> specific enabler for tending-style work, exactly as you noted.
