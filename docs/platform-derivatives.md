# Platform Derivatives

This is the positive mirror of `platform-core.md`'s "What is NOT core" table. That table discharges the reduction by pre-rejecting candidate primitives ("folded into &lt;cores&gt;"). This document reads the same seam from the other side: it takes every notable capability the substrate actually ships and names **which core it compounds on** and **how**. The test each row passes: the capability USES a core primitive's one representation/resolver — it does not re-implement it. Where a capability compounds on more than one core, all are listed; the "how" names the composition.

Tags: **[F]** Fact · **[P]** Projection pipeline · **[C]** Cell axis · **[E]** Edge HTTP contract.

## Compounds on Fact

| Derived capability | Cores | How it compounds |
|---|---|---|
| Supersede-not-delete retirement | [F] | `supersede()` flips `superseded`/`supersededBy` on the same envelope and re-points edges (`migrateLinks`); a fresh write revives. The tombstone IS the Fact, not a second store. |
| Conditional writes / CAS (`ifRevision`/`ifAbsent`/`ifVersion`) | [F] | Optimistic preconditions checked against the timer-live view, rendered as a DynamoDB `ConditionExpression` — one atomic store guard closes the TOCTOU race on the same row. |
| Content-hash proof-of-read (`ifVersion`) | [F] | `version` = 16-hex SHA-256 of `value`, persisted on native writes; a read becomes a precondition of a write with no new primitive. |
| Per-fact lease / reveal timers | [F] | `_meta.timer.{delete,enable}` evaluated lazily at read (`isTimerLive`) — the sole exception to supersede-not-delete; a delete-timer also sets a native DDB `ttl` for GC. No scheduler. |
| Work leases (`lease`/`release`) | [F] | `lease/<domain>/<item>` written with `ifAbsent` + a delete-timer = a crash-safe distributed mutex composed from CAS + timer, no broker. |
| Trajectory write-shadow & change feed | [F] | A TTL-bounded append log written inside the same `put`; `changes()` tails it from a seq — the temporal shadow of Fact, not a second log. |
| Actor-classed touch counters (attention) | [F] | Attention is one conditional DynamoDB `ADD` on lifetime + burst-window counters (no seq, no trajectory event); actors classed platform/agent/human so churn stops manufacturing salience. |
| Import / migration priors & earned reward | [F] | Legacy read/write counts fold into the `standing` term only; `reward` is a persisted per-fact `[0,1]` (7th signal, default weight 0). Both ride the `_meta` envelope. |
| Vocabulary-as-Fact (view/action/subscription/type/renderer/config) | [F] | Each Declaration kind is a Fact at reserved `_<ns>/<id>`; `createDeclarationRegistry` is a ~30-line pass-through to `state.put`/`query`/`get`/`supersede`. |
| Declared actions — no-code write vocabulary | [F] | `_actions/<id>` Fact `{writes[],if?,params?}` applied by a fixed interpreter with decidable conditions (DSL or CEL) and per-write `ifAbsent`+timer atomic claims. |
| Grant-request escalation inbox | [F,P] | Request/answer Facts under `_grants/requests|answers/` (the one platform-performed cross-slice write, requester-stamped); resolution via `approveGrant`/`denyGrant` reads/writes Facts — no new notification channel. |
| Athena analytics SQL surface | [F] | A read-only SQL surface over the durable Fact archive (`SubstrateAnalyticsLane`); `assertReadOnlySql` + double-enforced `platform:*`. Reads Facts flattened off the stream, never a second truth. |
| Per-slice vector index addressing | [F] | `indexForScope` maps a scope to `slice-<scope>` 1:1 with the `STATE#<scope>` partition, so semantic isolation is structural (ADR-0030) — the same key-shape rule as Fact. |

## Compounds on the Projection pipeline

| Derived capability | Cores | How it compounds |
|---|---|---|
| Read-time Salience scoring | [P,F] | `computeScore`/`scoreParts` blend recency·velocity·attention·standing·centrality (+relevance+reward) at read time from `_meta` counters + graph degree — the score STAGE, never persisted. |
| Salience shaping into focus/peripheral/elided tiers | [P] | `shapeEntries` tiers a scored set; below the elide threshold an entry collapses to an `ElidedStub` — the shape STAGE, pure and scope-free. |
| Salience lenses & config re-tuning | [P,F] | Params resolve `defaults ← _config/salience ← named lens ← per-call override`; five compiled floor lenses; `INTENT_PRESET` on text reads. A lens recomputes the score, shifting ranking AND tiers. |
| Relevance as the 6th signal (ADR-0051) | [P,F] | `recall`/`query` accept text; `relevanceFor` embeds once and takes the scope's vector top-K as `{key:cosine}`; `intentSalience` blends it in — meaning enters ranking as a term, not a separate path. |
| Read presets (`recall`/`query`/`peek`/`changes`/`attention`) | [P,F] | Each is a body of the one pipeline: `recall` = own ∪ granted, viewer-scored, overview digest; `query` = filtered/paged/ranked; `changes` = trajectory feed. |
| The one composed `read` by source (ADR-0071) | [P] | `read(source ∈ slice\|store\|vector\|key\|changes)` dispatches to `recall`/`query`/`search`/`peek`/`changes` + a refs periphery fold + ranking-only adopted posture — one verb, one pipeline. |
| One `matchesSelector` predicate | [P] | `{type?,tag?,tags?,prefix?}` is the single structural predicate shared by view membership, `query`, subscription match, and the `inView` backbone edge (ADR-0011). |
| Derived Reference backbone | [P,F] | `deriveBackboneEdges` synthesizes virtual `instanceOf`/`managedBy`/`rendersWith`/`inView` edges from a scope's Facts at read time — the select STAGE feeding centrality. |
| Edge-query presets (`neighbors`/`members`/`graph`/`walk`/`edges`) | [P,F] | One `edges({around,depth})` verb parameterizes all edge framings over the one authored+derived edge set (ADR-0069); depth ≥ 2 runs `walkFrom` maximal simple paths (ADR-0075). |
| Collection membership resolution | [P,F] | `members()` resolves a collection Fact intensionally (its query is a view) or extensionally (inbound edges + declared `value.members`), ordered — a select preset. |
| Attention (just-in-time cron as a read) | [P,F] | `attention()` surfaces stale/unlinked/dangling Facts with capped samples + uncapped totals, reusing signals + derived backbone — a scheduler-free maintenance projection. |
| Read-surface altitude shaping (refs/card/full) | [P] | The `shape` ladder (ADR-0048) narrows what is SENT (key+meta → truncated → as-stored) orthogonally to salience tiering — presentation, never authority. |
| The present stage (inline type affordances) | [P,C] | `affordancesForTypes` builds the `types` map a read carries — one `resolveType` per distinct type from `cells.describeTypes` (the LIVE present stage; the named `resolvePresent` is dead — see coherence audit). |
| Type resolution (`resolveType`/`buildTypeVocabulary`) | [P,F] | Merges cell-canonical `_types/<T>` under the caller's slice override facet-by-facet via `mergeTypeDecl`/`layer` (ADR-0010), most-specific wins, `undefined` never clobbers. |
| `$catalog` progressive disclosure + `{for}`/`{forType}` (ADR-0049) | [P,F] | A scope-filtered menu over every provider's tools, budget-guarded; the contextual variant joins fact→type→manager→that cell's tools — a filter over what the token could already call. |
| Self-model surfaces (`$types`/`$graph`/`$grants`/`$cells`/`$identity`) | [P,F] | Each is a `read(...)` preset over a reserved `_<ns>/` prefix — the substrate describing itself in its own primitives (ADR-0052/0085). |
| Registered views — no-code read vocabulary | [P,F] | A `_views/<id>` Fact `{query,reduce?,path?,filter?,render?}` is a named stored projection — human dashboard and agent affordance from one datum (ADR-0001). |
| Reactivity / subscriptions | [P,F] | `_subscriptions/<id>` Fact whose `match` reuses `matchesSelector` (+CEL); on a matching write the reactor invokes an action or delivers to a cell tool (ADR-0083) — select over the change-stream. |
| Semantic search (`workspace.search`) | [P,F] | Embed once, over-fetch topK from own + grant-owner indexes, collapse to best score, rank, then authoritatively re-read via `state.get` — the index is a candidate generator, never authority. |
| Inferred `similarTo` edges (ADR-0031) | [F,P] | Platform reconciles top-k neighbours as `EdgeRecord`s (writer `platform/vectors`, strength 0.3, cosine as score); centrality picks them up with no scorer change. |
| Ratification / `contested` (ADR-0032/0072) | [P,F] | `suggestions` collapses `similarTo` pairs; `ratify` writes a typed authored edge and drops the inferred one; `contested` surfaces semantically-near, structurally-unconnected same-type pairs. Reuse of the one edge set. |
| PCA 2D/3D semantic atlas (ADR-0082) | [F,P] | `workspace.project` reads the whole vector index and PCA-projects it; a coord-free manifest + 16 hash-bucketed shards; the stream indexer's `patchProjection` keeps it fresh incrementally. |
| Grant gate `may(principal,verb,resource)` | [P,F] | `applicableGrants ∩ token.scope` is a Projection preset over the grant index at every PEP; `enforceScope`'s three-tier output is its shape stage. |
| Capability salience touch (`_caps/<target>`, ADR-0085) | [F] | Every successful dispatch emits `capability.invoked`, applied as one actor-classed counter bump — capabilities projected as Facts. |
| Membrane input validation | [P] | `enforceInput` checks each capability's `inputSchema` at the dispatch choke point (tolerant JSON-Schema subset); violations fail fast, unknown keys warn. |

## Compounds on the Cell axis

| Derived capability | Cores | How it compounds |
|---|---|---|
| Stable three-verb MCP surface (`whoami`/`read`/`act`) | [C,P] | The gateway IS a Cell (`defineMcpService`); all capability lives in `target`, so a new capability is callable the instant it exists with no `tools/list` change. |
| Capability resolution & dispatch | [C,P] | `resolveTarget → enforceScope → enforceInput → forward` via Mode-1 `serviceClient`; both `read` and `act` route the same way through the one PEP. |
| Async write-shape (pending-marker pattern) | [C,F,P] | Pending Fact → `lambda:InvokeFunction Event` on own ARN (`InvokeSelf`, universally provisioned) → terminal Fact write → caller polls `workspace.changes`. Composition of Fact + Projection + cell-template IAM under the ~30s edge cap. |
| Dispatch tier-2 ingress + SSR read-proxy + caller-writes | [C,F,E] | Dispatch parses `/@owner/name/*`, runs declared read-only reads AS THE CALLER (`ssrData`), and applies `x-parc-writes` intents via `workspace.remember` bounded by three guards — the real `scope(caller,write)` boundary. |
| Live incremental vector indexer | [F,C] | A DynamoDB-stream consumer; `planStreamWork` (pure) filters to facts, drops on REMOVE/supersede/delete-timer, sha-skips metadata-only rewrites; a candidate generator re-checked at search time. |
| Substrate archiver / analytics lane | [F] | A second stream consumer flattening each mutation to one JSON row → Firehose → S3 lake → Athena; never decides access, never writes back. |
| Embedder / VectorStore backends (Hashing/Bedrock, Memory/S3Vectors) | [C,F] | `vectorsFromEnv` wires the backend from env; swapping to production S3 Vectors + Bedrock is a wiring change, never a rewrite (ADR-0030 §2a). |
| Federated / sandboxed renderers | [P,E] | Cell-authored `ui://` renderers register against `window.__parcRender`; a `sandbox=allow-scripts` iframe (opaque origin) hosts foreign code over a postMessage protocol — the security realisation of the renderer contract. |
| Platform events → Facts write fan-out | [F,C] | EventBridge handlers turn cell lifecycle / `capability.invoked` / tend cron / `substrate.write.requested` into Facts in the owner's slice; the reactor mints per-run scoped agent tokens. |
| Auth as a Cell (OAuth 2.1 + WebAuthn + delegation) | [C,F,E] | Bearer→identity, token-as-principal mint, RFC 8693 `sub`+`act` delegation, WebAuthn passkeys — all behaviours of the auth Cell; `AuthStore` is the deliberate keyed store OUTSIDE the substrate (the trust root scope=IAM-principal rests on). |
| Granular type-declared scopes (`write:type:<T>`) | [F,P] | A type advertises a `scopeFamily` so a client can hold `write:type:note` instead of coarse `write:workspace`; `enforceTypeWrite/Read` constrain only granular-only tokens. |

## Compounds on the Edge HTTP contract

| Derived capability | Cores | How it compounds |
|---|---|---|
| End-to-end POST body authentication | [E] | The origin-request signer hashes the body into `x-amz-content-sha256` so OAC SigV4 covers POST bodies CF→FURL — no body-tampering window. |
| 401 discovery (MCP / RFC 9728) | [E] | The origin-response handler restores `WWW-Authenticate` from `x-amzn-remapped-www-authenticate`, carrying the OAuth metadata URL. |
| Bearer preservation past OAC | [E,C] | `x-forwarded-authorization` (injected for all methods) preserves the viewer bearer past the OAC `Authorization` overwrite; `resolveHttpIdentity` reads it. |
| Cell-origin browser isolation | [E,C,F] | First-hyphen host split maps `<owner>-<name>.on.parc.land` → `/@owner/name` distinct browser origins; the scope key rule expressed in the browser tier. |

## Two completions and one DRY (ADR compose map)

The ~34-tool surface reduces to three shapes (Declaration, Read, Edge) + two completions + one DRY (`concept-model.md`, sequenced as behaviour-preserving contractions C1–C8):

- **Causal relations completion** — the directional `walk` (ADR-0075) completes the edge/Read shapes: compound confidence as the product of step strengths over the one authored edge set. Compounds on **[P,F]**.
- **Reward completion** — `reward` (ADR-0070) + the consolidation organ feeding it completes the score stage: a persisted 7th signal that a tier-2 delta-scored audit writes. Compounds on **[F,P]** and validates the reduction's test that a new capability needs no `platform-core` edit.
- **Cell-jobs DRY** — the async write-shape is the single job pattern all long-running work (models/run/deploy) shares rather than re-implementing. Compounds on **[C]**.