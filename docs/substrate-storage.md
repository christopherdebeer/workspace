# One substrate table — storage architecture for actually embracing the thesis

> Follow-on to [`declarative-actions-vs-code-cells.md`](./declarative-actions-vs-code-cells.md).
> The question pressed: *by the reef/organ logic, shouldn't all cells share a
> state DynamoDB instead of per-cell tables? Can our table(s) be organised to
> give the query/graph capabilities the substrate thesis demands? Is the
> platform nodding to the thesis without embracing it?*
>
> Short answers: **one shared substrate, yes — zero private tables, no**;
> **yes, single-table + adjacency-list covers what the thesis actually asks
> for** (with one honest limit); and **yes, the nod-without-embrace is real
> and now has a precise name**.

## What the thesis actually demands of storage

Separate three kinds of state the current architecture conflates:

| Kind | Thesis position | Right home |
| --- | --- | --- |
| **Substrate facts** — shared observed truth | "All interaction takes place solely through changes on the blackboard." One logical store, authority = *scopes within it* (`scope(s, e)`), not separate databases | **One shared table** |
| **Organ working state** — a cell's serialized internals | Encapsulated; invisible; "only the resulting truth propagates" | **Per-cell table** (correct as-is!) |
| **Vocabulary** — actions/views | Facts in reserved scopes (sync stores `_actions`/`_views` in the *same* state table) | The substrate table |

So the per-cell tables are not the violation — they are the *organ* half done
well (the trivially-provable permission boundary, clean teardown, promotion
isomorphism). The violation is twofold:

1. **The substrate is implemented as one cell's private feature.** The
   primitive lives in `platform/runtime/state.ts` (library placement says
   "platform primitive") but the *storage and authority* are workspace-cell
   private. Every other participant must RPC through workspace commands.
   Ironically `dynamo-state-store.ts` already lays out a multi-tenant,
   scope-partitioned single table (`STATE#<scope>` / `TRAJ#<scope>`) — inside
   a table nobody else may touch.
2. **Organs cannot reach the reef at all.** The dynamic-cell permission
   boundary caps a cell to *its own* table + the event bus. A dynamic cell
   literally has no way to emit a durable fact into shared truth — the one
   thing the thesis says an organ exists to do. The only shared medium is
   EventBridge: transient, unobservable after the fact, not state.

The `table-factory.ts` invariant — "services own their own table; they never
share one across the cell boundary" — is microservices discipline, and it's
right for *organ scratch*. Applied to *truth*, it is precisely the
architecture the thesis rejects. The reconciliation: the substrate table is
not "another cell's database" — it is **the blackboard**, platform
infrastructure with the same status as the event bus (which every cell can
already touch). `substrate.md` said it — "all organs and no reef" — but the
storage design doesn't just lack the reef, it *enforces organ-hoarding*.

## Can DynamoDB serve the thesis' query model? Yes — because scopes are bounded

The crucial observation from the sync deep-dive: sync "queries" by **loading
the whole room and interpreting in-process**. SQLite isn't doing clever
query work — the *room is small by design*. The unit of observation is the
bounded scope, never the database. The thesis demands bounded-scope
observation, guarded writes, monotonic accumulation, and a change feed — it
never demands cross-scope joins or ad-hoc SQL. That maps onto DynamoDB's
partition model *natively*: **scope = partition**.

### Proposed single-table layout (the substrate table)

```
Facts   pk=S#<scope>          sk=F#<key>            value, revision, writer, via,
                                                    type, tags[], timerExpiresAt,
                                                    enabledExpr, superseded…
Edges   pk=S#<scope>          sk=E#<from>#<rel>#<to>  strength, createdAt
Traj    pk=T#<scope>          sk=<iso>#<seq>        (TTL — exists today)
Seq     pk=Q#<scope>          sk=A                  (atomic ADD — exists today)

GSI-IN   gsipk=S#<scope>#N#<to>    gsisk=<rel>#<from>     ← inbound edges
GSI-TYPE gsipk=S#<scope>#T#<type>  gsisk=<updatedAt>      ← typed/recency reads
Streams  ON                                              ← change feed / materialised views
```

Graded against what the thesis + gap analyses ask for:

| Need | Mechanism | Verdict |
| --- | --- | --- |
| Read a slice/room (recall) | one `Query pk=S#<scope>` | ✓ native (today) |
| Guarded write / CAS (`if`, `ifRevision`) | `ConditionExpression` on revision/hash | ✓ native |
| Timers / leases (visibility) | attr + read-time filter; TTL for GC | ✓ native (sync's own lazy model) |
| type/tag filter, recency rank | GSI-TYPE; tags as edge items to tag-nodes | ✓ native — and tags-as-edges gives the legacy's *implicit links* for free |
| `neighbors(key, dir, rel)` | adjacency list: outbound = `Query sk begins_with E#<key>`, inbound = one GSI-IN query | ✓ native (index-served, single-digit ms) — **this is the graph answer** |
| k-hop traversal | BFS: k rounds of fan-out queries in-Lambda | ◑ fine for k ≤ 2–3 on bounded scopes; **not** native recursion |
| Arbitrary graph algorithms / deep paths | — | ✗ honestly: that's Neptune/SQL territory, and the thesis doesn't ask for it |
| CEL views | Query the partition → evaluate in-Lambda (exactly sync's strategy); materialise hot views via Streams | ✓ with the known bound-or-materialise discipline (`sync-learnings.md` §B) |
| Salience rank | read-time from trajectory (preserve), rank in-Lambda post-Query | ✓ (today) |
| Change feed (`changes(sinceSeq)`) | Streams + the existing seq | ✓ native |

The one honest limit is deep/recursive traversal. Everything else the thesis
or the two gap analyses demand is *index-served* in this layout. The legacy
workspace's load-bearing graph operations — `links(id)` returning inbound +
outbound + tag-implied edges, link migration on supersede — are all
one-or-two Query operations here.

### The AWS-native edge: scope authority enforced by IAM

This is where embracing the thesis fully gets us something sync never had.
DynamoDB supports **`dynamodb:LeadingKeys`** IAM conditions — restricting a
principal's access to items whose partition key matches given values/patterns.
So the dynamic-cell permission boundary can grant:

```
dynamodb:Query / GetItem / PutItem / UpdateItem  on the substrate table
  Condition: ForAllValues:StringLike dynamodb:LeadingKeys: ["S#<granted-scope>*", "T#<granted-scope>*", …]
```

Σ-calculus **Theorem 3 (scope authority is inviolable) becomes an
infrastructural guarantee, not an interpreter check**. sync promises scope
isolation in ~10 lines of TypeScript inside one Deno process; we can make
violating it *impossible at the IAM layer* while letting organs read and
write the reef directly. (Discipline required: GSI key prefixes must repeat
the scope so the condition covers index reads too — the layout above does.)

## The mediated-vs-direct write trade-off (decide deliberately)

Raw IAM write access lets a cell skip the library that stamps provenance,
bumps revisions, and appends trajectory. Options:

- **Reads direct, writes mediated** *(recommended first step)*: cells get
  IAM-scoped `Query` on their scopes (cheap, autonomous observation — the
  `observe` half), while writes flow through the workspace organ (the
  existing command path), which stamps provenance server-side. This keeps
  today's provenance discipline intact and is purely additive.
- **Both direct** via a runtime `ctx.substrate` client: faster, more
  autonomous; within a cell's *own* scope, self-stamped provenance is
  tolerable (sync's identity is self-authored too), but cross-scope writes
  (grants) should stay mediated until the client is trusted.

## What changes, concretely

1. **Promote the substrate table to stack-level infrastructure** (peer of the
   event bus): `SubstrateTable` in `lib/platform-stack.ts`, GSI-IN + GSI-TYPE,
   Streams on. The workspace cell points its existing `StateStore` at it —
   the store's key layout barely changes.
2. **Workspace becomes the room provider, not the storage owner**: vocabulary,
   sharing/grants, recall shaping, (next) the declarative-action interpreter —
   over storage it no longer exclusively holds.
3. **Extend the permission boundary** with LeadingKeys-conditioned substrate
   access per cell scope — organs can finally emit facts to the reef.
4. **Edges + type/tag as first-class items** (Gap 2 + Gap 1) on the layout
   above; `ifRevision` CAS (Gap 3) and Streams feed (Gap 4) on the same table.
5. **Per-cell tables stay** — demoted to optional organ scratch. The story
   becomes: *facts to the substrate, scratch to your table, blobs to S3.*
6. The declarative tier from the companion doc lands naturally: `_actions`/
   `_views` are facts in the same partitions; CEL evaluates over one bounded
   Query.

Migration cost: near-zero *right now* — the production slice is empty (the
UUID→username principal change stranded only dummy data). This is the moment
to move the floor.

## Verdict

The platform's organ half (per-cell tables, IAM boundaries) is not the
betrayal — it's the part sync never built. The betrayal is that the reef is
(a) locked inside one organ and (b) unreachable from all the others, with
truth defaulting to private KV. One shared, scope-partitioned substrate
table — adjacency-listed for the graph, GSI'd for the projections,
LeadingKeys-scoped for authority, Streams-tailed for observation — closes
the gap with DynamoDB working *with* the thesis' grain (bounded scopes),
not against it. The thesis never needed SQL. It needs a blackboard with
rooms, and that is exactly what a partition is.
