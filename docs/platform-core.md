# Platform Core

## Thesis

The substrate is **one representation, one read pipeline, one infrastructure axis** — three cores, with one piece of AWS-edge plumbing named alongside because it is what realises the substrate's public HTTP face. The representation is the **Fact** — a `{value, _meta}` row at `(scope, key)` whose monotonic, server-stamped envelope IS the substrate's only storage primitive; **scope** is the key-prefix half of that envelope AND the IAM principal AND the OAuth target, so authority is enforced by AWS `LeadingKeys` rather than an interpreter. The Fact's temporal shadow (a TTL-bounded per-scope append log of trajectory events) rides the same scope partition. Vocabulary (view, action, subscription, type, renderer, config) is Facts under reserved `_<ns>/<id>` namespaces; edges (authored and derived), grants (`_grants/`), and subscriptions (`_subscriptions/<id>`) all ride that contract. The read side is one **Projection pipeline** (select → score → shape → present) every command (`recall`/`query`/`neighbors`/`view`/`graph`/`members`/`$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity`/`changes`/`whoami`/`read`/`act`) is a preset of; the score stage is the 5-term Salience blend; the present stage's output is the Affordance shape that makes the same fact materialise as a canvas tile, a doc block, or a frame region; per-facet last-wins layering is the merge discipline of present and score; reactivity is the same `select` evaluated against the change-stream instead of state; the gating equation `may(principal, verb, resource) = applicableGrants(principal) ∩ token.scope` is a Projection preset over `_grants/` Facts evaluated at every PEP. The **Cell axis** is the bounded organ that supplies Declarations as Facts, backs Affordances, attests event sources (`events:source = cell-<id>`), isolates origins (`<owner>-<name>.on.parc.land`), carries the async write-shape (pending marker → self-dispatch → terminal write → caller polls `workspace.changes`), and exposes the substrate's HTTP face (including the read/act MCP surface as one Cell's wire shape) under a managed permission boundary. The **AWS edge HTTP contract** is named alongside as the three Lambda@Edge transforms (OAC body-signing + `WWW-Authenticate` restoration + `x-forwarded-authorization`) that realise — but do not constitute — the Cell's public HTTP face on CloudFront + Function URL; it is named because if AWS edge primitives changed tomorrow, this would change while the three substrate cores would not. Identity (the validated-bearer principal), the Grant equation, the Declaration registry, Subscription, Edge, Salience, Resolution, Surface factoring, read/act, and the rest are nameable contracts on top of the three cores — they appear in this document because they earn naming as vocabulary referenced across cells and ADRs, not because they live in separate storage or pipelines.

## At a glance

| Primitive | One-line | Reduces? | Primary evidence |
|---|---|---|---|
| Fact | A `{value, _meta}` row at `(scope, key)`: monotonic, server-stamped, supersede-not-delete, CAS, read-time timers, with a TTL-bounded trajectory log as its temporal shadow. Scope-keyed: `pk = STATE#<scope>` IS the IAM principal IS the OAuth target, so authority is `LeadingKeys`, not an interpreter | — | `platform/runtime/state.ts:49` · `platform/infra/substrate-table.ts:21-66` · ADR-0013 · ADR-0007 |
| Scope = owner = identity | The DynamoDB partition prefix IS the IAM principal IS the OAuth target — authority enforced by `dynamodb:LeadingKeys`, not by an interpreter | Fact (key-shape rule of) | `services/cells/cell-template.ts:66-88` · ADR-0007 |
| Authorization (validated bearer ∧ grants ∩ token.scope) | The three enforcement layers ARE the three cores: `validateBearer` is the auth Cell's behaviour; `applicableGrants(principal) ∩ token.scope` is a Projection preset over `_grants/` Facts; the partition `LeadingKeys` layer is Fact's key-shape rule. The `may(principal, verb, resource)` equation is a named composition, not a sibling primitive | Cell + Projection + Fact | `platform/runtime/define-service.ts:80-156` · `services/gateway/service.ts:283-297` · ADR-0007 |
| Edge (Reference projection) | A directional `{from, rel, to, strength}` between Fact keys, produced as `authored ∪ derived` from rules declared on Types | Projection + Fact | `platform/runtime/state.ts:223,708` · ADR-0003 / ADR-0009 / ADR-0016 |
| Declaration registry (vocabulary-as-Fact, storage only) | Vocabulary kinds (view, action, subscription, type, renderer, config) are Facts in reserved `_<ns>/<id>` namespaces; `register`/`list`/`get`/`remove` are 30 lines of pass-through to `state.put`/`state.query(prefix)`/`state.get`/`state.supersede`; per-kind resolution happens at read sites in Projection | Fact + Projection | `platform/runtime/declarations.ts:41-79` · ADR-0001 |
| Resolution (`layer`) | `layer(...parts)` folds an ordered stack of partial layers into one effective value, per-facet last-wins, `undefined` silent | Projection pipeline | `platform/runtime/resolution.ts:17` · ADR-0010 |
| Projection pipeline (select → score → shape → present) | The single read pipeline every command (`recall`/`query`/`neighbors`/`view`/`graph`/`members`/`changes`/`$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity`/`whoami`/`read`/`act`) is a preset of; salience is its score stage, present-stage output is the Affordance shape, per-facet last-wins layering is its merge discipline, reactivity is the same `select` over the change-stream; View ≡ Subscription = same predicate, two streams; the gating equation `applicableGrants ∩ token.scope` is a Projection preset over `_grants/` Facts | — | `platform/runtime/state.ts:1063,1292` · `platform/runtime/present.ts:52` · ADR-0004 / ADR-0006 / ADR-0010 / ADR-0011 / ADR-0012 / ADR-0015 |
| Trajectory (TTL-bounded per-scope append log) | One TTL-bounded append log of `TrajectoryEvent` per scope — the temporal shadow of Fact, read by Projection presets | Fact | `platform/runtime/state.ts:233-275` · ADR-0013 |
| Salience (read-time score stage) | A `[0,1]` weighted blend (recency · velocity · attention · standing · centrality) computed at read time — the score stage of Projection | Projection pipeline | `platform/runtime/state.ts:438-548,1063-1142` · ADR-0006 |
| Surface factoring | Item materialisation factors as `Fact × renderer × placement`; modality (doc, board, view-tile, frame) is a present-stage parameter — the structure of Projection.present output | Projection pipeline | `platform/runtime/present.ts:52` · ADR-0012 / ADR-0015 |
| Edge-surface factoring | Renderer × style applied to References — present-stage applied to the Edge projection's output | Projection pipeline | ADR-0016 (Proposed) · `cells/canvas/client/lib/network/edgeInspect.ts` |
| Cell axis | An IAM-isolated Lambda + scratch table + scope + publish seam (`describeTypes`) + backing for Affordances + declared substrate grants (`ssrReads`/`callerWrites`) under a managed permission boundary; subsumes event-source attestation, bounded-role provisioning, browser-origin isolation, `x-cell-caller`, and the async write-shape (pending-marker pattern). The AWS edge HTTP contract is named as a sibling primitive — realisation, not constitution | — | `platform/infra/dynamic-cell-control-plane.ts:154-163` · ADR-0008 |
| Edge HTTP contract (OAC body-signing + WWW-Authenticate restoration + x-forwarded-authorization) | The three Lambda@Edge transforms that make CloudFront + an IAM-auth Function URL stand in for an API gateway: origin-request signs the body into `x-amz-content-sha256`, origin-response restores `WWW-Authenticate`, `x-forwarded-authorization` preserves the viewer bearer past the OAC overwrite. AWS-stack-specific realisation of the Cell's public HTTP face | — | `platform/infra/service-router.ts:18-63,148-172` · `platform/infra/http-service-cell.ts:148-164` |
| Async write-shape (pending-marker pattern) | Pending marker fact → self-dispatch on own ARN → terminal write → caller polls via `workspace.changes`; the substrate-level async contract any work exceeding Lambda's edge cap follows | Cell axis | `services/cells/cell-template.ts:158-166` · architecture.md §11 |
| Subscription | A Fact at `_subscriptions/<id>` whose `match` is the same Selector as a View/query, evaluated against `fact.written` writes by a bounded reactor (depth cap 50), firing an Action (itself a Fact at `_actions/<id>`) | Fact + Projection | `platform/runtime/selector.ts` · `services/workspace/subscriptions.ts` · ADR-0011 |
| read/act + three-tool MCP surface | The gateway is a Cell; `read` is a family of Projection presets over named providers; `act` is Cell-tool dispatch terminating in a Fact write; `whoami` is a Projection preset over Identity request-envelope state. The wire-level read/act observe-vs-write duality is the same asymmetry already structural to Fact | Cell + Projection + Fact | `services/gateway/service.ts:1-31,141-226` |

## Primitives

### Fact

*A keyed `{value, _meta}` row at `(scope, key)`: monotonic, server-stamped, supersede-not-delete, with optimistic CAS, read-time timers, and a TTL-bounded trajectory log as its temporal shadow. The key-prefix `scope` IS the IAM principal IS the OAuth target — the slice equation is structural to the Fact key, not a separate primitive. The trajectory shadow (a per-scope append log with TTL) is part of Fact's contract: Facts and trajectory entries are written by the same `state.put`, live under the same scope partition (`STATE#<scope>` and `TRAJ#<scope>` are sibling prefixes), and differ only in retention. Vocabulary (view, action, subscription, type, renderer, config) is Facts under reserved `_<ns>/<id>` namespaces; `_grants/` are Facts; `_subscriptions/<id>` are Facts; authored edges (`EDGE#<scope>#<from>`) are Facts.*

**Why it is core.** Strip Fact and nothing else stands. The Declaration registry's vocabulary kinds are Facts in `_<ns>/<id>`. Edges' authored half rides the same single-table store. Trajectory is a Fact-adjacent append log under the same scope partition, written by the same `put` call (verified: `appendTrajectory` runs inside the same `state.put` body at `platform/runtime/state.ts:1272-1275`, and `dynamo-state-store.ts:8-19,31-32` shows trajectory rows carry TTL while fact rows do not — TTL is a storage property of the same envelope, not a separate primitive). Grants' request/answer inbox lives at `_grants/requests/` and `_grants/answers/` as Facts, while the live grant index is its own key shape via `createDynamoGrantStore` (see Authorization's surprise note). Groups, subscriptions, and `_meta.writer` all live in the Fact envelope. The substrate has *one representation, one resolver* — Fact is the representation. The scope-as-key-prefix rule is what makes infrastructure (not an interpreter) the authority layer: `pk = STATE#<scope>` IS the IAM principal IS the OAuth target, and GSI partition keys deliberately *repeat* the scope so `LeadingKeys` covers index reads too (that's the whole reason `gsi1pk=IN#<scope>#<to>` and `gsi2pk=TYPE#<scope>#<type>` are shaped that way; verified at `cell-template.ts:66-88` with STATE/TRAJ/SEQ/IN/TYPE all prefixed with owner). ADR-0013 explicitly pins the contract as executable spec; ADR-0007 pins the partition layer of the Grant axis. The TTL on trajectory entries is a storage property (retention), not a separate primitive: the log is the temporal envelope of the same Fact write.

**Evidence.**
- `platform/runtime/state.ts:49` — `EntryMeta` (revision/seq/writer/via/createdAt/updatedAt/writers/superseded/timer + computed score/velocity/standing/centrality).
- `platform/runtime/state.ts:104` — `_meta: EntryMeta` on every record.
- `platform/runtime/state.ts:1206-1277` — `put` server-stamps writer/seq/revision/createdAt AND appends trajectory under the same call.
- `platform/runtime/state.ts:233-275` — `TrajectoryEvent` + `appendTrajectory` + `recentTrajectory` (the temporal shadow).
- `platform/runtime/dynamo-state-store.ts:8-19,31-32` — storage shapes mirror the IAM contract; trajectory carries TTL, facts do not.
- `platform/infra/substrate-table.ts:21-66` — key layout doc; GSI partition keys repeat scope.
- `services/cells/cell-template.ts:66-88` — LeadingKeys condition pinned to `STATE#<owner>`, `TRAJ#<owner>`, `SEQ#<owner>`, `IN#<owner>#*`, `TYPE#<owner>#*`.
- `platform/infra/dynamic-cell-control-plane.ts:99-115` — permission-boundary substrate read statement caps tier-2 cells to read-only.
- `docs/architecture/adr/0013-fact-floor.md` — Accepted; names trajectory as Fact's temporal shadow.
- `docs/architecture/adr/0007-grant-axis.md:20-26` — three enforcement layers (scope, grant, partition).

**Evidence (verified).** `platform/runtime/state.ts:49` (EntryMeta) · `platform/runtime/state.ts:101` (Entry interface with _meta) · `platform/runtime/state.ts:1206` (put server-stamps writer/seq/revision/createdAt) · `platform/runtime/state.ts:1219-1228` (CAS ifRevision/ifAbsent) · `platform/runtime/state.ts:1272-1275` (atomic guard + trajectory append in same put) · `platform/runtime/state.ts:1255-1257` (supersede-not-delete; fresh write revives) · `platform/runtime/state.ts:233-239` (TrajectoryEvent shape) · `platform/runtime/state.ts:275-277` (appendTrajectory + recentTrajectory) · `platform/infra/substrate-table.ts:21-66` (key layout: STATE#/TRAJ#/SEQ# + gsi-in IN#<scope>#<to> + gsi-type TYPE#<scope>#<type>; streams enabled) · `services/cells/cell-template.ts:66-88` (LeadingKeys condition for STATE/TRAJ/SEQ/IN/TYPE all prefixed with owner) · `platform/infra/dynamic-cell-control-plane.ts:104-115` (boundary caps tier-2 to substrate read-only) · `docs/architecture/adr/0013-fact-floor.md`.

**Consequences.**
- DynamoDB scope-partitioning maps directly: `pk = STATE#<scope>`, `sk = KEY#<key>`; bounded by design.
- `recall = one Query pk=S#<scope>` — bounded by design.
- OAuth scope grammar `workspace:<owner>:<keyPrefix|*>:<read|write>` (one grammar, three layers).
- Username regex `^[a-z0-9]+$` (no hyphens) so the first-hyphen host split on `<owner>-<name>.on.parc.land` is unambiguous.
- Per-cell origin/IAM/DDB/role isolation becomes a layered nest.
- Supersede-not-delete: revocations and edits become inspectable history rather than data loss (`platform/runtime/state.ts:1569-1599`; fresh write to a superseded key revives at `:1244-1258`).
- Read-time timers (`_meta.timer.delete`/`enable`) make crash-safe leases possible with no scheduler — and the timer is the documented sole `delete` exception to supersede-not-delete.
- Single-table physical floor with `gsi-in`/`gsi-type` follows from the Fact contract.
- Conditional-write CAS: the semantic precondition is checked against the *live* view AND the store closes the race via DynamoDB `ConditionExpression`.
- Substrate write asymmetry (reads-direct, writes-mediated via events) follows for v1.
- `workspace.changes(sinceSeq)` is a Projection preset that tails the trajectory log without going through Salience — the polling substitute for `resources/subscribe`.
- Lease + `ifAbsent` + `timer.delete` = crash-safe distributed claim with no broker.
- Vocabulary-as-Fact: every Declaration kind lives at `_<ns>/<id>` under the same scope key rule, so `$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity` Projection presets just `state.query(prefix='_<ns>/')` — no registry abstraction needed above Fact.

**Reduction history.**
- Round 2: scope = owner = identity → reduce → absorbed Scope into Fact's key-shape rule; the prefix-IS-principal-IS-target equation is structural to the Fact key (`pk = STATE#<scope>`), and the IAM `LeadingKeys` condition is the AWS-side enforcement of that key rule, not a sibling primitive.
- Round 3: trajectory → reduce → ADR-0013 names trajectory as "Fact's temporal shadow"; same `state.put` writes both; the TTL is a storage retention property; the "one log, two readers" invariant is preserved by naming both readers as Projection presets (`workspace.changes` and Salience) over the same Fact-adjacent log.
- Round 4: absorbed the storage half of Declaration registry → vocabulary kinds (view/action/subscription/type/renderer/config) ARE Facts in reserved `_<ns>/<id>` namespaces; the registry's `register`/`list`/`get`/`remove` are 30 lines of pass-through to `state.put`/`state.query(prefix)`/`state.get`/`state.supersede`. Subscription and Edge's authored half follow the same reduction.

### Scope = owner = identity

*Reduced — folded into Fact as the structural rule of its key shape. The DynamoDB partition prefix (`STATE#<scope>`, `TRAJ#<scope>`, `IN#<scope>#*`, `TYPE#<scope>#*`) IS the IAM principal IS the OAuth target, and `LeadingKeys` is the AWS enforcement of that key rule. See Fact for the rule, evidence, and consequences.*

**Why it is core.** Reduced into Fact. The code corroborates that scope IS the structural key prefix and IAM enforces it via LeadingKeys (verified at `services/cells/cell-template.ts:66-88` and ADR-0007:20-26). One concrete correction to the prose: the load-bearing username regex `^[a-z0-9]+$` is asserted in the doc text but was not located as a single canonical regex declaration in the verified codebase paths. The first-hyphen host-split discipline IS, however, verifiably implemented — the CloudFront cell-host-rewrite Function at `platform/infra/service-router.ts:103-118` splits host labels on the first hyphen, which is the operational claim that matters for unambiguous `<owner>-<name>.on.parc.land` resolution.

**Evidence (verified).** `platform/infra/substrate-table.ts:21-37` (key layout doc — prefix IS authority) · `services/cells/cell-template.ts:66-88` (LeadingKeys condition tying IAM principal to scope prefix) · `platform/infra/service-router.ts:103-118` (first-hyphen host-split in cell-host-rewrite CF Function) · `docs/architecture/adr/0007-grant-axis.md`.

**Reduction history.**
- Round 2: reduce → Fact (key-shape rule of). Scope's load-bearing claim — "the prefix IS the principal IS the OAuth target" — is structural to the Fact key, not a separate primitive; naming it twice double-counts.
- Round 3: reaffirmed reduce → Fact.
- Round 4: reaffirmed reduce → Fact (confirmed in `services/cells/cell-template.ts:66-88` and ADR-0007:20-26).

### Authorization (validated bearer ∧ grants ∩ token.scope)

*Reduced — folded into Cell + Projection + Fact. The three enforcement layers ARE the three cores: (1) `validateBearer` is the auth Cell's behaviour — `platform/runtime/define-service.ts:80-156`'s `resolveHttpIdentity` calls into `services/auth/oauth.ts`, which is a Cell; the bearer-only rule is the auth Cell's contract. (2) `applicableGrants(principal) ∩ token.scope` is a Projection preset: `services/workspace/grants.ts:53-117` reads grant rows via `applicableGrants`, and `platform/runtime/auth.ts:101-129` `intersectScopePatterns` is the score/shape over them. (3) The partition `LeadingKeys` layer is Fact's key-shape rule (already absorbed into Fact). The `Identity` object carrying `scopes`+`grantScopes` is request-envelope state, not a substrate primitive. The OAuth scope grammar is a parameter to the gating Projection, not a primitive — every Projection preset has a grammar. The three-tier failure UX (`allow`/`scope_offer`/`scope_denied`) is the gating Projection's shape stage producing affordances.*

**The substrate-genuine claim that survives** is the named composition `may(principal, verb, resource) = applicableGrants(principal) ∩ token.scope` over the three layers (token, grant view, partition) — a documented contract that lives across Cell + Projection + Fact. **A correction to the earlier framing is required here, surfaced by verification: the prose claim "`_grants/` are Facts" is only partially true. The grant request/answer *inbox* lives at `_grants/requests/` and `_grants/answers/` as Facts (`grant-requests.ts:19-21`), but the *live grant index itself* is its own DynamoDB key shape (`GRANT#<grantee>`, `GRANTBY#<owner>`, `MEMBER#<principal>`) provisioned via `createDynamoGrantStore` — not a `_grants/<id>` Fact.** "`applicableGrants` is a Projection preset over `_grants/` Facts" is conceptually right (a Projection select over scope-partitioned grant rows), but the storage shape is a parallel index in the same substrate table, not the reserved-namespace Fact convention used by other vocabulary kinds. **A second correction: the cookie carve-out in `resolveHttpIdentity` is narrower than the prose suggests — it is dispatch-only and restricted to safe HTTP methods (GET/HEAD) with `Sec-Fetch-Dest: document`, not a general fallback.** ADR-0007's title "Grant axis" names the *axis* (a slice across the three cores), not a sibling primitive. The codebase confirms the reduction: there is a `services/workspace/grants.ts` and a `platform/runtime/auth.ts`, but no `authorization.ts` — the name "Authorization" was a bundling label, not a structural primitive.

**Evidence (preserved across the reduction).**
- `platform/runtime/define-service.ts:80-156` — `resolveHttpIdentity`: bearer-only, with a narrow cookie carve-out (auth Cell behaviour).
- `platform/runtime/auth.ts:1-15` — the comment naming the bearer-only rule (auth Cell contract).
- `platform/runtime/auth.ts:17-37,71-129,136` — `Identity` shape + `intersectScopePatterns`/`intersectScopes` as pure functions over scope-pattern strings (the gating Projection's score function).
- `platform/runtime/service-client.ts:11-32` — `CommandEnvelope` propagates user/scopes/grantScopes/tokenId between Cells.
- `platform/infra/service-router.ts:25-44` — `x-forwarded-authorization` preserves the viewer bearer (AWS edge plumbing of the auth Cell).
- `services/gateway/service.ts:275,283-297` — `enforceScope` at the gateway; three-tier outcome `scope_offer` vs `scope_denied` (Projection.shape producing affordances).
- `services/workspace/grants.ts:53-117,119-192` — Grant Fact shape + `grantCovers` + `applicableGrants`; DDB grant index `GRANT#<grantee>`, `GRANTBY#<owner>`, `MEMBER#<principal>` (Fact key shape over `_grants/`).
- `services/workspace/handlers.ts:1286-1303,1456-1494,1701-1732` — `requireWriteThrough`; `recall` folds `applicableGrants(viewer)` over the substrate; `share` reflects into `_public/` (Projection presets).
- `services/auth/oauth.ts:8,324` — `intersectScopes` caps minted tokens to the cell ceiling (auth Cell behaviour).
- `docs/architecture/adr/0007-grant-axis.md` — the documented `may(principal, verb, resource)` contract.
- `docs/scope-grants.md:50-55` — one principal for humans and agents.

**Evidence (verified).** `platform/runtime/define-service.ts:97-156` (resolveHttpIdentity: bearer-only with cookie carve-out for dispatch GET/HEAD navigations only) · `platform/runtime/define-service.ts:129-131` (validateToken called on auth cell) · `platform/runtime/auth.ts:1-15` (bearer-only doctrine comment) · `platform/runtime/auth.ts:17-37` (Identity shape with scopes + grantScopes + tokenId) · `platform/runtime/auth.ts:101-129` (intersectScopePatterns) · `platform/runtime/auth.ts:136-157` (intersectScopes) · `platform/runtime/service-client.ts:11-32` (CommandEnvelope propagates user/scopes/grantScopes/tokenId) · `services/gateway/service.ts:283-297` (enforceScope three-tier allow/scope_offer/scope_denied) · `services/workspace/grants.ts:53-69` (Grant shape + grantCovers) · `services/workspace/grants.ts:98-117` (applicableGrants) · `services/workspace/grants.ts:119-192` (GRANT#/GRANTBY#/MEMBER# DDB shapes — separate index, not `_grants/<id>` facts) · `services/workspace/handlers.ts:1286-1303` (requireWriteThrough) · `services/workspace/handlers.ts:1478-1490` (recall folds applicableGrants over the substrate) · `services/auth/oauth.ts:20-34` (cellCeiling) · `services/auth/oauth.ts:322-324` (cell-host token capped via intersectScopes).

**Consequences (now properties of Cell/Projection/Fact).**
- Provenance (`_meta.writer`) is auth-Cell-validated, never client-supplied (Fact envelope + auth Cell).
- Agents and humans share the same `/mcp` gateway with scoped tokens (gateway Cell).
- Per-cell scoped tokens are derived: `declared(cell) ∩ granted(owner) ∩ scope(user)` (auth Cell's `intersectScopes`).
- Effective scope is a mutable subset of the immutable grant ceiling (gating Projection over the grant index).
- Sharing is additive without mutating facts: grant index writes only (Fact preserves provenance; gating Projection rereads).
- Three-tier failure UX: allow / `scope_offer` / `scope_denied` (gating Projection's shape stage; teaching denial carries the ready-made `workspace.requestGrant` call).
- `cellCeiling` clamps cell-host tokens to `[workspace:read, workspace:write, cell:<owner>/<name>:*]` (auth Cell's mint policy).
- Grant request/approval inbox built on `_grants/requests/`/`_grants/answers/` Facts — no new notification channel (Projection over Fact). The live grant index itself is a parallel DDB key shape, not a `_grants/<id>` Fact.
- Group/public audiences as Facts with `MEMBER#<principal>` reverse index (Fact GSI shape).

**Reduction history.**
- Round 1: identity vs effective-access → folded → Identity and the gating equation only ever appear together; `Identity.scopes`/`Identity.grantScopes` are fields on the same object; `intersectScopes` operates on both.
- Round 2: reduce-to-Fact+Projection+Cell → kept → close call on composition-as-contract grounds.
- Round 3: kept on API-contract grounds.
- Round 4: reduce → Cell + Projection + Fact. The brutal first-principles verdict (the three layers ARE the three cores) settles it: validateBearer is the auth Cell, `applicableGrants ∩ token.scope` is a Projection preset over the grant index, the partition rule is Fact's key shape. The split-verdict and rename-verdict admit the same structure from a different angle — split-into-Identity+Grant concedes "the three layers ARE the three primitives" by separating the principal from the equation; the rename-to-Grant-axis concedes that "Authorization" is the bundling label while the codebase consistently names the mechanism (`grants.ts`, ADR-0007). Composition-as-contract is what `may(principal, verb, resource)` is — a named contract over the three cores, not a fourth. The earlier defence ("the composition is referenced across cells") concedes the reduction: composition is what makes it a named contract, not a primitive.

### Edge (Reference projection)

*Reduced — folded into Projection + Fact. Authored edges are Facts in the edge half of the single-table store under the same scope key rule (`EdgeRecord` at `platform/runtime/state.ts:223`). Derived edges are a Projection.select preset (`deriveBackboneEdges` at `platform/runtime/state.ts:556-815`) that reads Type Facts' `refs`/`keyPattern`/`keyEdges` value-half (Type is the `type` kind of vocabulary, itself a Fact in `_types/<type>`) and emits virtual edges at read time. The rel/strength grammar is three numeric constants embedded in the projection (`platform/runtime/state.ts:595-597`); the rule grammar is the `shape` value-half of `_types/<type>` Facts. ADR-0003's own title is "Reference as a projection" — the primitive admits it is a projection.*

**The substrate-genuine claim that survives** is "Type Facts carry projection rules," which is structural to the Fact value-half: every `_types/<type>` Fact's `value.shape` may declare `refs`/`keyPattern`/`keyEdges`/structural-backbone fields that the Projection.select stage compiles into virtual edges. Centrality and `$graph` are Projection presets over the same store. ADR-0009's per-rule strength is a tunable parameter of the projection; ADR-0016's edges-first-class is the present stage applied to References (see Edge-surface factoring). One detail surfaced by verification: authored strength is enforced at the consumption point — `state.ts:543` reads `const w = ed.strength ?? 1`, confirming the prose claim that null authored strength is treated as 1.0.

**Evidence (preserved across the reduction).**
- `platform/runtime/state.ts:223` — `EdgeRecord` Fact shape.
- `platform/runtime/state.ts:556-815` — `BACKBONE_RELS` + `extractTypeRules` + `compileKeyPattern` + `deriveBackboneEdges` (the projection over Type Facts).
- `platform/runtime/state.ts:595-597,596-622` — graded strengths (authored 1.0 > embedded 0.6 > membership 0.4 > structural 0.2), ADR-0009.
- `platform/runtime/state.ts:1063-1078` — centrality counts derived edges alongside authored.
- `cells/machine/types.json` — `machine-rail.keyEdges` projects `node —rail→ node`; `machine-node.keyEdges` projects `inMachine`.
- ADR-0003 (Reference as a projection) · ADR-0009 (edge strength) · ADR-0016 (edges first-class, Proposed).

**Evidence (verified).** `platform/runtime/state.ts:223-231` (EdgeRecord shape) · `platform/runtime/state.ts:556-815` (BACKBONE_RELS, extractTypeRules, compileKeyPattern, deriveBackboneEdges) · `platform/runtime/state.ts:574-580` (BACKBONE_RELS: instanceOf/managedBy/rendersWith/inView) · `platform/runtime/state.ts:595-597` (STRUCTURAL_STRENGTH=0.2, MEMBERSHIP_STRENGTH=0.4, EMBEDDED_STRENGTH=0.6) · `platform/runtime/state.ts:543` (`const w = ed.strength ?? 1` — authored strength default 1.0) · `platform/runtime/state.ts:617-622` (TypeRules: manager/refs/keyPattern/keyEdges) · `platform/runtime/state.ts:642-667` (compileKeyPattern) · `platform/runtime/state.ts:708-815` (deriveBackboneEdges) · `platform/runtime/state.ts:1077` (centrality reads authored ∪ derived) · `cells/machine/types.json:33-35,60-61` (machine-node.keyEdges and machine-rail.keyEdges) · `docs/architecture/adr/0003-reference-projection.md` · `docs/architecture/adr/0009-edge-strength.md` · `docs/architecture/adr/0016-edges-first-class.md`.

**Reduction history.**
- Round 1: reduce-to-Fact+Projection → kept → authored edges do ride Fact storage and derived edges are a Projection preset, but the rel/strength/derivation-rule grammar is named once here and referenced as vocabulary across cells.
- Round 2: rename → Reference → Edge (Reference projection). Codebase consistently uses `edge`; ADR-0009 title is "Edge strength"; ADR-0016 is "Edges first-class."
- Round 2: reduce-to-Fact+Declaration+Projection → kept → vocabulary citation across machine/canvas/lit/regwatch.
- Round 3: reduce → Projection pipeline + Declaration registry + Fact. ADR-0003 admits "Reference as a projection."
- Round 4: reduce → Projection + Fact. With Declaration registry collapsed into Fact (vocabulary-as-Fact-under-reserved-namespace), the third reducer dissolves. The substrate-genuine claim "Type Facts carry projection rules" is structural to the Fact value-half — the `_types/<type>` Fact's `value.shape` IS where the rules live.

### Declaration registry (vocabulary-as-Fact, storage only)

*Reduced — folded into Fact + Projection. The implementation at `platform/runtime/declarations.ts:50-79` is 30 lines of pass-through to `state.put`/`state.query(prefix)`/`state.get`/`state.supersede`; the parametric `DeclarationKind<D>` carries `ns: string` + `validate: (def) => void` + `factType: string` — all three are per-kind concerns, not registry-level abstractions. The self-stated boundary at `platform/runtime/declarations.ts:10-13` ("the registry owns storage + resolution only. A kind's evaluate is NOT here; it operates on an already-resolved declaration") concedes the reduction: storage IS Fact, and "resolution" here means `state.get` (Fact read). The self-model surfaces `$catalog`/`$types`/`$graph`/`$grants`/`$cells` are Projection presets that read these reserved namespaces directly via `state.query(prefix='_<ns>/')` — they don't go through a registry abstraction.*

**The substrate-genuine claim that survives** is "vocabulary is a Fact in `_<ns>/<id>`; per-kind validation runs at registration; per-kind evaluation runs at read sites in Projection." This is structural to Fact's key shape (the `_<ns>/<id>` convention is to vocabulary what `STATE#<scope>` is to scope), and to Projection (every self-model surface is a `state.query(prefix='_<ns>/')` preset). Per-kind validation lives with the kind, not with a registry; per-kind evaluation lives in the Projection stage that consumes the kind. ADR-0001 stays as documentation of the reserved-namespace convention. Verification surfaced one nuance: Subscription is the visibly-deployed consumer of `createDeclarationRegistry` (`services/workspace/subscriptions.ts:181-200`); views/actions/types follow the same shape per ADR-0001 but live in workspace handlers rather than going through `createDeclarationRegistry`. The reduce-to-Fact+Projection claim holds: the registry truly is a thin convenience wrapper.

**Evidence (preserved across the reduction).**
- `docs/architecture/adr/0001-declaration-registry.md` — the contraction (now documentation of the reserved-namespace convention).
- `platform/runtime/declarations.ts:10-13` — the boundary comment that concedes the reduction.
- `platform/runtime/declarations.ts:41-79` — `DeclarationRegistry<D>` interface + `createDeclarationRegistry<D>` (30-line pass-through to `state.put`/`state.query`/`state.get`/`state.supersede`).
- `platform/runtime/index.ts:58` — exported as public runtime API ergonomic helper.
- `docs/declarative-actions-vs-code-cells.md:14-44` — sync's `_actions`/`_views` as facts; the action IS the data.
- `docs/type-vocabulary.md:38-49` — vocabulary primitive made data.

**Evidence (verified).** `platform/runtime/declarations.ts:10-13` (boundary comment: registry owns storage+resolution only) · `platform/runtime/declarations.ts:41-79` (DeclarationRegistry interface + createDeclarationRegistry — pure pass-through to state.put/query/get/supersede) · `services/workspace/subscriptions.ts:181-200` (subscriptionKind uses createDeclarationRegistry — the visibly-deployed consumer) · `services/workspace/subscriptions.ts:23` (SUBSCRIPTIONS_PREFIX = '_subscriptions/') · `docs/architecture/adr/0001-declaration-registry.md`.

**Reduction history.**
- Round 1: reduce-to-Fact → kept → a Declaration is a Fact in `_<ns>/<id>`, but the registry contract is what makes the self-model surfaces uniform.
- Round 2: rename → Declaration → Declaration registry. ADR-0001's own title is "Declaration registry."
- Round 3: rename → Declaration registry → Declaration registry (vocabulary-as-Fact, storage+resolution only). Per-kind resolution happens at read sites in Projection, not inside the registry.
- Round 4: reduce → Fact + Projection. The implementation is 30 lines of pass-through; `register/list/get/remove` are `put/query(prefix)/get/supersede` on Fact. The `kind.validate` step at registration is a per-kind responsibility (a Type knows how to validate its own shape; a Subscription knows how to parse its CEL match) — not a registry primitive. The self-model surfaces are Projection presets each parameterised by an `_<ns>/` prefix; that's a Projection pattern, not a registry primitive. Vocabulary citation rate ("machine/lit/canvas/regwatch emit Declarations") is the same shape as "they emit Facts under reserved namespaces" — citation isn't structure. The 30-line helper survives as an ergonomic convenience in `platform/runtime/`, but it doesn't earn a primitive name above Fact + Projection.

### Resolution (`layer`)

*Reduced — folded into Projection pipeline as the merge discipline of its present and select stages. `layer<T>(...parts)` is a 9-line helper at `platform/runtime/resolution.ts:17-26` with exactly two callers (`mergeTypeDecl` in `platform/runtime/type-schema.ts:15` and `effectiveRules` in `platform/runtime/state.ts:44`); both call sites run inside Projection stages (type-decl resolution during present; effective rules during select). ADR-0010 admits the bar: "Don't over-abstract: a shared `resolve()` is worth it only if ≥2 sites genuinely share code after it; otherwise this stays a *named contract*." Two callers is exactly the bare minimum, and the ADR explicitly leaves Salience (numeric, clamps) and Grant (set union) out of the helper.*

**The named contract "per-facet last-wins"** is genuine and survives — but as a discipline of how Projection.present and Projection.select consume their stacked configs, not as a sibling primitive. ADR-0010 stays as a documentation note on Projection.shape/present. The four cited consumers (Type facets, TypeRules, Frame precedence, home `_home/layout`) all live downstream of Projection stages. Verification corroborated the two-caller count exactly: `state.ts:755` (`effectiveRules`) and `type-schema.ts:33` (`mergeTypeDecl`). Salience config layering at `state.ts:1097` uses object-spread instead of `layer`, exactly as ADR-0010 anticipated.

**Evidence (preserved across the reduction).**
- `platform/runtime/resolution.ts:17` — `export function layer<T extends object>(...parts)`.
- `platform/runtime/state.ts:44,755` — `effectiveRules(t) = layer<TypeRules>(typeRules?.[t], sliceRules.get(t))` (inside Projection.select).
- `platform/runtime/type-schema.ts:15` — `mergeTypeDecl(canonical, slice) = layer(c, s)` (inside Projection.present resolution).
- ADR-0010 (Accepted, now folded into Projection as merge discipline).

**Evidence (verified).** `platform/runtime/resolution.ts:17-26` (layer<T> — 9-line helper) · `platform/runtime/state.ts:44` (import { layer }) · `platform/runtime/state.ts:755` (effectiveRules = layer<TypeRules>(typeRules?.[t], sliceRules.get(t))) · `platform/runtime/type-schema.ts:15,33` (mergeTypeDecl uses layer) · `platform/runtime/state.ts:1097` (salience config uses object-spread, not layer — exactly as ADR-0010 anticipates) · `docs/architecture/adr/0010-resolution.md`.

**Reduction history.**
- Round 1: reduce-to-Projection → kept → the per-facet last-wins discipline was named here as a documentation contract.
- Round 2: reduce-to-Projection → kept → explicit "if a future round finds the ADR-0010 reference rate has dropped, this primitive should reduce."
- Round 3: reduce → Projection pipeline. The helper is 9 lines with two callers, both inside Projection stages.
- Round 4: reaffirmed reduce → Projection.

### Projection pipeline (select → score → shape → present)

*The single read pipeline every command — `recall`/`query`/`neighbors`/`view`/`graph`/`members`/`changes`/`$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity`/`whoami`/`read`/`act` — is a preset of: select (predicate + edges) → score (Salience × lens) → shape (tier/limit/page × config) → present (Affordance/Renderer). The pipeline's stages absorb the formerly-sibling primitives: the **score stage** is Salience (the 5-term blend), the **present stage** is Surface factoring (`entity × renderer × decoration`), the **merge discipline** of present/score is Resolution (per-facet last-wins), the **change-stream variant** of select is Subscription's `match` (View ≡ Subscription = same predicate, two streams), the **gating Projection** is `applicableGrants(principal) ∩ token.scope` evaluated over the grant index at every PEP (the Grant-axis equation), and `read`/`act`/`whoami` MCP-wire dispatch is a family of presets at the gateway Cell's HTTP face.*

**Why it is core.** Names the whole read side as one composition rather than parallel command bodies. Each stage has its own ADR (0004 select/shape, 0006 score, 0010 layering, 0011 reactivity, 0012 present, 0015 frames, 0007 grant-as-Projection); the pipeline is what makes them composable and closes the breathe invariant "every primitive used, none re-implemented." View ≡ Subscription is the same predicate evaluated against two streams (state vs change) — verified by `matchesSelector` at `state.ts:774` being shared with subscription matching at `subscriptions.ts:158`. Surface factoring lives at the present stage's output. The score stage's no-stored-score / always-fresh contract is what distinguishes this substrate from legacy stored-score systems. The Edge projection (`authored ∪ derived`) is a select-stage preset over Fact (authored half) + Type Fact's `value.shape` (derivation rules). The `read('$catalog')`/`read('$types')`/`read('$graph')`/`read('$grants')`/`read('$cells')`/`read('$identity')` self-model surfaces are Projection presets each parameterised by an `_<ns>/` prefix — capability-as-data. **A correction surfaced by verification: `resolvePresent` is invoked primarily at the gateway `$types` boundary (`service.ts:335-339`), not as a per-fact stage of every `recall`. Clients re-derive their own present in some flows (canvas/lit), referencing the "gateway-resolved Present facet." The pipeline framing is accurate, but consumer convergence on a single present-stage call site is partial today — the present stage exists, but is exercised at the type-resolution seam rather than threaded through every read.**

**Evidence.**
- `docs/architecture/adr/0004-projection-pipeline.md` — names the pipeline; `$graph` shipped.
- `platform/runtime/state.ts:1063,1083,1096,1292` — `signalsFor` → `loadSalienceConfig` → `baseSalience` → `callSalience` (the score chokepoint = Salience).
- `platform/runtime/state.ts:438-548` — `KeySignals` + `computeScore` + `buildSignals` — the 5-term blend, degree weighting by edge strength.
- `platform/runtime/state.ts:478-507` — the 5-term blend + `clamp01`.
- `platform/runtime/state.ts:1295-1317` — read scores under per-call lens, then shapes.
- `platform/runtime/state.ts:1176-1203` — `shapeEntries` tiers; elided becomes a stub.
- `platform/runtime/state.ts:556-815` — Edge projection at the select stage (`deriveBackboneEdges` reads Type Facts' `value.shape`).
- `platform/runtime/state.ts:1041` — `workspace.changes` is a select preset that tails the trajectory log.
- `platform/runtime/state.ts:774` — view membership uses the same `matchesSelector` as Subscription.
- `platform/runtime/present.ts:52` — `resolvePresent(fact, decl): Affordance` (the present stage; Surface factoring's `entity × renderer × decoration` is its output shape).
- `platform/runtime/resolution.ts:17` — `layer` is the per-facet last-wins merge discipline of present/score stages.
- `platform/runtime/auth.ts:101-129` — `intersectScopePatterns` is the gating Projection's score function over the grant index.
- `services/workspace/grants.ts:53-117,119-192` — `applicableGrants(principal)` is the gating Projection's select-half; `grantCovers` is its filter.
- `services/gateway/service.ts:50-58,141-226,346-385` — `PROVIDERS` table + `resolveTarget` + the `read`/`act` routers are Projection presets at the gateway Cell.
- `services/gateway/service.ts:387-395,426,490` — `whoamiTool` is a Projection preset over Identity request-envelope state (a fixed-shape `read('$identity')`).
- `cells/canvas/shared/frame.ts` — `fitRegion` + `regionBBox` (region modality at the present stage).
- ADR-0006 (Salience) · ADR-0010 (layering) · ADR-0011 (reactivity) · ADR-0012 (present) · ADR-0015 (frames) · ADR-0007 (Grant axis as Projection slice).

**Evidence (verified).** `platform/runtime/state.ts:1063-1078` (signalsFor — select stage builds signals) · `platform/runtime/state.ts:1083-1092` (loadSalienceConfig) · `platform/runtime/state.ts:1094-1097` (baseSalience) · `platform/runtime/state.ts:429-432` (callSalience) · `platform/runtime/state.ts:1295-1317` (read: signalsFor → score → shapeEntries) · `platform/runtime/state.ts:1176-1203` (shapeEntries: tier, elide, stub) · `platform/runtime/state.ts:438-548` (computeScore + scoreParts + buildSignals) · `platform/runtime/state.ts:478-507` (5-term weighted blend + clamp01) · `platform/runtime/state.ts:556-815` (Edge projection at select stage) · `platform/runtime/state.ts:1514-1526` (changes preset over trajectory) · `platform/runtime/state.ts:774` (matchesSelector shared by view membership and subscriptions) · `platform/runtime/present.ts:52` (resolvePresent — present stage; invoked primarily at the gateway $types boundary, not per-recall) · `platform/runtime/selector.ts:32` (matchesSelector) · `services/gateway/service.ts:50-58` (PROVIDERS + sentinels: $catalog/$types/$graph/$grants/$cells) · `services/gateway/service.ts:141-183` (resolveTarget) · `services/gateway/service.ts:186-226` (buildCatalog filters by hasScope) · `services/gateway/service.ts:346-385` (read/act routers).

**Consequences.**
- Selector (type/tag/prefix/CEL) shared by view membership, query, subscription match.
- Collections (ADR-0005) are predicate × {intensional, extensional} — both members through this pipeline (`workspace.members`).
- An `_meta.explain` flag exposes the score stage's signals/weights/contribution as data — inspectable scoring.
- Edge-strength weighting tunes the score stage's centrality input.
- Frame's camera resolution is the present stage for region modality.
- Surface factoring (`entity × renderer × decoration`) is the structure of the present-stage output; modality (doc, board, view-tile, frame) is a present-stage parameter.
- Per-facet last-wins layering (Type canonical ← slice, TypeRules, frame precedence, home `_home/layout`) is the merge discipline of present and select.
- No stored score: the substrate is always fresh because scores never persist.
- Standing/velocity/attention have one source of truth in the score stage.
- Named lenses (recent/connected/durable/active) recompute scores, not just re-tier.
- `shape()` vs `read()` distinction (re-tier vs full recompute).
- `workspace.changes(sinceSeq)` is a select preset over trajectory — the polling substitute for `resources/subscribe`.
- Renderers form a declarative→code ladder (built-in → renderer-facts `_renderers/<type>` → cell iframes) at the present stage.
- The Grant equation `may(principal, verb, resource) = applicableGrants(principal) ∩ token.scope` is a gating Projection over the grant index; three-tier failure (allow / `scope_offer` / `scope_denied`) is its shape-stage output.
- The MCP wire `read`/`act` family is a thin gateway-Cell HTTP exposure of Projection presets; `whoami` is `read('$identity')` shipped as a discoverability convenience.

**Reduction history.**
- Round 3: absorbed Resolution (`layer`) → reduce.
- Round 3: kept Salience, Surface factoring, Subscription as separately-named primitives despite their stages-of-Projection nature.
- Round 4: absorbed the gating Projection half of Authorization — `applicableGrants ∩ token.scope` is a Projection preset over the grant index (the score function is `intersectScopePatterns`, the select function is `applicableGrants`, the shape stage is `enforceScope`'s three-tier output).
- Round 4: absorbed the `read`/`act`/`whoami` MCP wire surface — these are Projection presets at the gateway Cell's HTTP face; the wire-level observe-vs-write duality is the same asymmetry already structural to Fact (reads-direct, writes-mediated).
- Round 4: absorbed the change-stream half of Subscription — `match` against `fact.written` is the change-stream variant of Projection.select. Subscription's `_subscriptions/<id>` storage half lives in Fact.

### Trajectory (TTL-bounded per-scope append log)

*Reduced — folded into Fact as Fact's temporal shadow. ADR-0013 explicitly names the trajectory as "Fact's temporal shadow." Trajectory entries are written by the same `state.put` that writes Facts (`platform/runtime/state.ts:1206-1277`), live under the same scope partition (`TRAJ#<scope>` is a sibling prefix to `STATE#<scope>`), carry the same scope key rule (LeadingKeys covers them), and differ from Facts only by having a TTL — which is a storage property, not a structural one. The "one log, two readers" invariant is preserved by naming both readers (Salience and `workspace.changes`) as Projection presets over the same Fact-adjacent log — verified end-to-end: `signalsFor` at `state.ts:1070` consumes `recentTrajectory`, and `changes` at `state.ts:1521` also calls `store.recentTrajectory`. Two readers, one log.*

**Evidence (preserved across the reduction).**
- `platform/runtime/state.ts:233-239` — `TrajectoryEvent` interface (now part of Fact's contract).
- `platform/runtime/state.ts:275,277` — `appendTrajectory(event)`; `recentTrajectory(scope, sinceMs)`.
- `platform/runtime/dynamo-state-store.ts:31-32` — trajectory carries TTL; facts do not (storage property of the same envelope).
- `platform/runtime/state.ts:1041` — `workspace.changes` tails the trajectory (a Projection select preset over the temporal shadow).
- `services/cells/cell-template.ts:66-88` — `TRAJ#<owner>` LeadingKeys covers the shadow under the same scope rule as Facts.
- ADR-0013 § "one trajectory feeds both changes (reader A) and Salience (reader B)" — both readers are Projection presets.

**Evidence (verified).** `platform/runtime/state.ts:233-239` (TrajectoryEvent) · `platform/runtime/state.ts:275-277` (appendTrajectory, recentTrajectory) · `platform/runtime/state.ts:1275` (appendTrajectory inside put) · `platform/runtime/state.ts:1284` (read appends 'read' op) · `platform/runtime/state.ts:1313-1314` (scope-level read trajectory event) · `platform/runtime/state.ts:1514-1526` (changes(scope, sinceSeq) — reader A) · `platform/runtime/state.ts:1070` (signalsFor uses recentTrajectory — reader B) · `platform/runtime/dynamo-state-store.ts:8-19,31-32` (trajectory carries ttl; facts do not) · `services/cells/cell-template.ts:79` (TRAJ#<owner> LeadingKeys) · `docs/architecture/adr/0013-fact-floor.md`.

**Reduction history.**
- Round 1: split-from-{Trajectory+Salience} → split → the two halves have separate ADRs and independent consumers.
- Round 2: reduce-to-Fact → kept → "one log, two readers" invariant cited by name.
- Round 3: reduce → Fact. ADR-0013 explicitly names trajectory as "Fact's temporal shadow."
- Round 4: reaffirmed reduce → Fact.

### Salience (read-time score stage)

*Reduced — folded into Projection pipeline as its score stage. ADR-0006 literally titles it "Salience stage" and `callSalience` at `platform/runtime/state.ts:1063,1083,1096,1292` is the score chokepoint of Projection. The 5-term blend (recency · velocity · attention · standing · centrality) is the implementation of the score stage; the no-stored-score invariant is a property of how the score stage runs (computed at read time, never persisted — verified in `wrap` at `state.ts:1102` where scores are always computed per-key from signals, never read from storage); the lens grammar is parameters to the score stage. All five lenses (`salience`/`recent`/`connected`/`durable`/`active`) exist in `LENS_PRESETS` at `state.ts:405-424`.*

**The substrate-level scoring contract** that callers cite as "Salience" — the 5-term blend, the no-stored-score invariant, the focus/peripheral/elided tiers, the lens grammar — survives as substantive content of the Projection.score stage. ADR-0006 stands as documentation of that stage. The `[0,1]` shaping is what makes attention scarce and elision possible.

**Evidence (preserved across the reduction).**
- `platform/runtime/state.ts:438-548` — `KeySignals` + `computeScore` + `buildSignals` — degree weighting by edge strength.
- `platform/runtime/state.ts:478-507` — the 5-term blend + `clamp01`.
- `platform/runtime/state.ts:1056-1142` — `signalsFor` + wrap with import priors folded into standing.
- `platform/runtime/state.ts:1063,1083,1096,1292` — `signalsFor` → `loadSalienceConfig` → `baseSalience` → `callSalience` (the score chokepoint).
- ADR-0006.

**Evidence (verified).** `platform/runtime/state.ts:438-548` (KeySignals + computeScore + scoreParts + buildSignals) · `platform/runtime/state.ts:466-475` (5-term blend docs) · `platform/runtime/state.ts:478-507` (computeScore body) · `platform/runtime/state.ts:405-424` (SalienceLens + LENS_PRESETS: salience/recent/connected/durable/active — all five present) · `platform/runtime/state.ts:429-432` (callSalience) · `platform/runtime/state.ts:1063-1078` (signalsFor — score chokepoint) · `platform/runtime/state.ts:1099-1142` (wrap computes score per-key from signals — no stored score) · `docs/architecture/adr/0006-salience-stage.md`.

**Reduction history.**
- Round 1: split-from-{Trajectory+Salience} → split.
- Round 2: reduce-to-Projection → kept → close call on vocabulary grounds.
- Round 3: reduce → Projection pipeline.
- Round 4: reaffirmed reduce → Projection.

### Surface factoring

*Reduced — folded into Projection pipeline as the structure of its present-stage output. `resolvePresent(fact, decl): Affordance` at `platform/runtime/present.ts:52` IS the present stage of Projection; `entity × renderer × decoration` is the shape of what that stage emits. ADR-0015's claim "every surface = collection × render modality" is the claim that the present stage parameterises over modality (doc, board, view-tile, frame) — not that there is a separate primitive. The "no new surface noun ever" discipline is the discipline of Projection.present.*

**The substrate-level vocabulary** — `entity × renderer × decoration`, the doc/board/view-tile/frame modality table, the renderer ladder (built-in → renderer-facts `_renderers/<type>` → cell iframes), the per-surface decoration grammar (canvas `{x,y,w,h}` / doc `{seq, fold}` / frame `region`) — survives as substantive content of the Projection.present stage. ADR-0012 (present-stage) and ADR-0015 (frames) stand as documentation of the present stage. Frames are not a new noun; they are a region-modality preset of present. **A correction surfaced by verification: `resolvePresent` is exported (`platform/runtime/present.ts:52-60`) but is called primarily at the gateway `$types` boundary (`services/gateway/service.ts:335-339`), not in a unified per-fact pipeline. Clients hand-roll their own affordance composition (e.g. `cells/canvas/client/lib/network/storage.ts` references "gateway-resolved Present facet"). The factoring is real but consumer convergence is partial — `frame.ts` (`regionBBox`/`fitRegion`) is the cleanest direct evidence of region-modality at the present stage.**

**Evidence (preserved across the reduction).**
- `docs/architecture/adr/0015-frames.md` — "every surface is collection × render modality"; doc/board/view-tile/frame table.
- `docs/architecture/adr/0012-present-stage.md` — Present resolves `{icon, label, render, handlers}` with renderer ladder + decoration layers.
- `platform/runtime/present.ts:52` — `resolvePresent` (the present stage itself).
- `cells/canvas/shared/frame.ts` — `fitRegion` + `regionBBox` (region modality at present).
- `docs/narrative-surface.md:32-44` — same fact = narrative block OR canvas node; only decoration differs.

**Evidence (verified).** `platform/runtime/present.ts:17-26` (Affordance shape: icon/label/render/handlers) · `platform/runtime/present.ts:52-60` (resolvePresent) · `services/gateway/service.ts:335-339` (gateway exports resolved present facet — the primary invocation site today) · `cells/canvas/shared/frame.ts:72-104` (regionBBox + fitRegion + resolveCamera — region-modality at present) · `docs/architecture/adr/0012-present-stage.md` · `docs/architecture/adr/0015-frames.md`.

**Reduction history.**
- Round 1: split-from-Surface → split → ADR-0015 names item factoring with its own present resolver.
- Round 2: rename + reduce → "Surface factoring (entity × renderer × decoration)".
- Round 2: reduce-to-Projection → kept.
- Round 3: reduce → Projection pipeline.
- Round 4: reaffirmed reduce → Projection.

### Edge-surface factoring (deferred)

> ⚠ ASPIRATIONAL — verifier flagged this primitive as not load-bearing today. ADR-0016 is Status: Proposed; only the phase-1 rel-vs-label un-conflate inspector ships (`cells/canvas/client/lib/network/edgeInspect.ts:1-50` implements selectable/editable edge UI separating rel/label/style — confirming the doc's phase-1 claim). The substrate-genuine claim ("rel ≠ label") is already covered by Edge → Fact + Projection (the `_types/<type>` Fact's `value.shape`) and does not require this primitive section to be load-bearing for the rest of the substrate to stand.

*Reduced — folded into Projection pipeline as the present stage applied to References. ADR-0016 is Status: Proposed; the canvas-side renderer ladder is not yet implemented (`cells/canvas/client/lib/network/edgeInspect.ts:1-30` ships only phase-1 rel-vs-label un-conflate). When the edge-side present stage ships, it rides the same Projection.present machinery as items, with the entity slot bound to a Reference instead of a Fact. Until then, the substrate-genuine claim ("rel ≠ label") is already covered by Edge → Fact + Projection (the `_types/<type>` Fact's `value.shape`).*

**Evidence (verified).** `cells/canvas/client/lib/network/edgeInspect.ts:1-50` (phase-1 rel-vs-label inspector — selectable/editable edge UI) · `docs/architecture/adr/0016-edges-first-class.md` (Proposed).

**Reduction history.**
- Round 1: split-from-Surface → split.
- Round 2: reduce → Surface factoring + Edge.
- Round 3: split-back acknowledged the Round-2 generalisation was premature, then reduce → Projection pipeline.
- Round 4: reaffirmed reduce → Projection.

### Cell axis

*A Cell is `code · table · scope · publish seam (describeTypes) · backing for Affordances · bounded substrate grants (ssrReads/callerWrites) · IAM-attested event source (events:source = cell-<id>) · permission-boundary-capped role · browser-origin isolation · x-cell-caller (token-never-reaches-tier-2) · async write-shape (pending-marker pattern)` — the orthogonal infra axis that supplies vocabulary Facts, backs Affordances, and carries every property that makes a tier-2 Cell safe to run author-supplied code under a managed permission boundary. The AWS edge HTTP contract is named alongside as a sibling primitive (realisation, not constitution) — see "Edge HTTP contract" below.*

**Why it is core.** Cell is not one of the nouns; it is what makes user-extensible vocabulary and managers exist at all. Every Type's `manager`, every renderer, every action handler resolves to a Cell. Without naming this axis, the substrate has no story for *where* vocabulary Facts come from, *how* an isolated Lambda gets bounded substrate access, *what* attests events, *what* bounds roles, *what* isolates origins, *how* identity propagates to tier-2 code, or *how* long-running work composes the substrate's primitives into observable async progress. All of these are inseparable properties of "what a Cell is": remove any one and the tier-2 story collapses. The promotion path tier-2 → tier-1 (same primitives, same resources) is what makes "no graduation" real for code. The validated-bearer behaviour (`auth Cell`), the gateway's `read/act/whoami` wire face (`gateway Cell`), and every cell-tool act handler are all Cell behaviours — the substrate's only execution axis. **Verification corroborated all six organ sub-claims in code, and confirmed the async write-shape (sub-claim 6) is exercised today only in `cells/models` for agent/run async paths — the `lambda:InvokeFunction Event` self-invoke at `cells/models/index.ts:945-950` on `SELF_FUNCTION` is the only `InvocationType:'Event'` invocation surfaced in the cells directory. The IAM grant for self-invoke is universally provisioned by cell-template (`InvokeSelf` Sid at `cells/cell-template.ts:158-166`), so the *capability* is universal even where the pattern is not yet uniformly adopted. JOB# chunking rows live at `cells/models/index.ts:605-640`.**

**Sub-claims (each previously a primitive, now folded).**

1. **`ctx` capability surface + registry-mediated peers.** Authors NEVER import an AWS SDK directly; AWS is reached only through `ctx.events`/`ctx.serviceClient`/`ctx.state`/`ctx.identity`. Peer reach requires `caller.allow(target)` which adds the IAM grant AND the `SERVICE_REGISTRY` env entry; missing registration is a registry error, not a 403. `platform/runtime/types.ts:10-24`, `platform/runtime/service-client.ts:68-117`, `platform/infra/http-service-cell.ts:185-194`, `platform/runtime/define-service.ts:176-209`.

2. **IAM-attested event source (`events:source` pinned).** A dynamic cell's role can call `events:PutEvents` only under `StringEquals events:source = cell-<id>`; event-route rules narrow by `sourcePrefix`. Bus events build an anonymous identity — trust is the source. `services/cells/cell-template.ts:167-176`, `platform/infra/event-bus.ts:38-53`, `lib/platform-stack.ts:130,135-140,146,215-216`, `platform/runtime/define-service.ts:225-246`.

3. **Permission boundary + bounded-role provisioning.** Every dynamic cell role MUST carry a managed `CellBoundary` policy capping it to `cell-*` resources, and `forge` can only call `iam:CreateRole` conditioned on `iam:PermissionsBoundary == this.permissionBoundary.managedPolicyArn`. `platform/infra/dynamic-cell-control-plane.ts:20-31,67-117,154-163`, `services/cells/cell-template.ts:113-119`.

4. **Cell-origin isolation (host = browser origin).** User cells are served from `<owner>-<name>.on.parc.land` via a second CloudFront distribution; a viewer-request CF Function rewrites the host to `/@<owner>/<name>`; apex-side redirect bounces top-level navigations to the cell subdomain; `cellCeiling` caps minted tokens. `platform/infra/service-router.ts:96-144,289-328`, `cells/kernel/client/main.ts:71-118`, `lib/platform-stack.ts:276-291`.

5. **`x-cell-caller` (token never reaches a tier-2 cell).** Forge invokes a dynamic cell with `headers: { 'x-cell-caller': ctx.identity.user ?? 'anonymous' }` and never forwards the bearer; SSR-declared reads run AS THE CALLER through dispatch; Phase-4 caller-writes are bounded by `ssr.json ∧ scope(caller, write)`. `services/cells/service.ts:496-519,1278-1295`, `services/dispatch/service.ts:39-229`, `services/cells/registry.ts:60-72`.

6. **Async write-shape (pending-marker pattern).** Any work that may exceed the synchronous edge cap follows ONE shape: write a pending marker fact, dispatch via EventBridge-back-to-self or `lambda:InvokeFunction Event` on own ARN, terminal write on completion, caller polls via `workspace.changes` (a Projection preset over Fact's temporal shadow). The self-invoke IAM grant pattern (a cell can `lambda:InvokeFunction` only its own ARN) is part of cell-template provisioning, sibling to `events:source = cell-<id>`. Per-cell DDB `JOB#` rows with 300KB chunking handle >400KB results. None of the four pieces is new — the *shape* is just how a Cell composes Fact + Projection (`workspace.changes`) + cell-template IAM under Lambda's edge cap. `services/cells/cell-template.ts:158-166`, `platform/runtime/state.ts:1041`, architecture.md §11.

**Evidence.**
- `docs/architecture/adr/0008-cell-axis.md` — Accepted; `read('$cells')` ships.
- `services/cells/service.ts:548,564,949,963` — `ssrReadsFor`/`callerWritesFor`/`describeTypes` aggregation/`ssrReads` `CellRecord` field.
- `cells/{canvas,home,kernel,lit,machine,models,input,reef-writer,regwatch,run,starter,viewers}` — the cell instances.
- `docs/dynamic-cells.md:36-58,240-250` — two-tier model; permission boundary.
- `docs/substrate.md:114-120` — forge dynamic cell is an organ.
- `services/gateway/service.ts:474` — the gateway IS a Cell (`defineMcpService({name:'gateway',...})`); the read/act/whoami wire surface is this Cell's HTTP face.
- `services/auth/oauth.ts` — the auth Cell; bearer-validation is its behaviour.

**Evidence (verified).** `platform/runtime/types.ts` (ctx capability surface — exported via runtime/index.ts) · `platform/runtime/service-client.ts:68-117` (createServiceClient mediated peer calls) · `platform/infra/http-service-cell.ts:148-164` (Function URL with IAM auth by default) · `platform/infra/http-service-cell.ts:184-194` (allow(target) adds InvokeFunction grant + SERVICE_REGISTRY env) · `platform/infra/dynamic-cell-control-plane.ts:20-31,67-117` (CellBoundary managed policy capping cell-*) · `platform/infra/dynamic-cell-control-plane.ts:154-163` (CreateRole conditioned on PermissionsBoundary match) · `services/cells/cell-template.ts:113-119` (PermissionsBoundary attached to cell role) · `services/cells/cell-template.ts:158-166` (InvokeSelf — own-ARN only) · `services/cells/cell-template.ts:167-176` (PublishEvents — events:source = cell-<id>) · `services/cells/cell-template.ts:66-88` (substrate read with LeadingKeys) · `services/cells/service.ts:496-519` (invokeCell sends x-cell-caller header; never token) · `services/cells/service.ts:1345` (describeTypes) · `services/cells/service.ts:548-572` (ssrReadsFor / callerWritesFor) · `services/gateway/service.ts:474` (defineMcpService — gateway IS a Cell) · `cells/models/index.ts:945-950` (the one observed `InvocationType:'Event'` self-invoke; pattern exercised in models cell today) · `cells/models/index.ts:605-640` (JOB# chunking rows) · `platform/infra/dynamic-cell-control-plane.ts:99-115` (boundary caps tier-2 to read-only on substrate) · `docs/architecture/adr/0008-cell-axis.md`.

**Consequences.**
- Types are declared by Cells (`types.json` → `describeTypes`), so vocabulary Facts are user-extensible without runtime change.
- Managers in `Type.manager` resolve to Cells — backing for open/edit/render affordances.
- `$cells` joins `$catalog`/`$types`/`$graph`/`$grants` as the fifth self-model surface.
- A shared cell substrate client (`cells/kernel/static/substrate.js`, ADR-0017) exposes `{read, query, emit, supersede}` — vendored today, npm-published soon — and is what makes the stateless machine stepper (ADR-0018) possible.
- Test substitutability via `__setX` injection seams; v2/v3 SDK split is a consequence.
- Organ→reef write path attested by IAM, not by token; reactor only fires on `workspace.fact.written` from `source=workspace`.
- Tier-2 cell code cannot exceed cap regardless of inline policy; promotion path tier-2 → tier-1 same primitives.
- Browser origin boundary equals trust boundary; username regex `^[a-z0-9]+$` (no hyphens) for unambiguous host split.
- Cell deploy pipeline (CellDeployRoute, idempotency, retry, SERVER_BUNDLED allowlist) is an instance of the async write-shape.
- MCP server→client features deliberately absent (no SSE, no progress, no sampling, no cancellation) — covered by `workspace.changes` as the polling substitute (Projection preset over Fact's temporal shadow).
- The gateway's three-tool wire surface (`whoami`/`read`/`act`) is the gateway Cell's HTTP face — exposing Projection presets as MCP tools, not a separate primitive.
- The auth Cell's bearer-validation is the substrate's only path from HTTP to a principal; provenance (`_meta.writer`) is auth-Cell-validated.

**Reduction history.**
- Round 1: absorbed Capability-only runtime, IAM-attested event source, Permission boundary + bounded-role provisioning, Cell-origin isolation, `x-cell-caller`, Lambda async pattern, CloudFront OAC + body-signing + WWW-Authenticate restoration → all reduce → properties of the Cell axis.
- Round 2: split → Async write-shape (pending-marker pattern).
- Round 3: re-absorbed Async write-shape (pending-marker pattern) as sub-claim 7.
- Round 4: split → Edge HTTP contract back out. The Round-1 absorption bundled sub-claim 6 (the three Lambda@Edge transforms) with the six organ-semantics sub-claims, but the absorbed list itself isolated it: "AWS-stack-specific plumbing that realises the Cell axis's public HTTP face." The phrase "realises … public HTTP face" admits the relationship is one of *realisation*, not *constitution*. If the Cell axis ran on Kubernetes or Fly tomorrow, the three transforms would change entirely while the other six sub-claims would not — that is the test for a smuggled-together primitive. Edge HTTP contract becomes its own substrate-level infra primitive named alongside Cell axis; the organ semantics (sub-claims 1–5 + async write-shape) stay in Cell axis. The gateway's read/act/whoami wire surface is now correctly described as one Cell's HTTP face (a Cell behaviour), exposing Projection presets as MCP tools — that absorption survives this round.

### Edge HTTP contract (OAC body-signing + WWW-Authenticate restoration + x-forwarded-authorization)

*The three Lambda@Edge transforms that compose to make CloudFront + an IAM-auth Lambda Function URL stand in for an API gateway: origin-request signer hashes the body into `x-amz-content-sha256`, origin-response handler restores `WWW-Authenticate`, `x-forwarded-authorization` preserves the viewer bearer past the OAC `Authorization` overwrite. Named alongside Cell axis as a sibling primitive — AWS-stack-specific realisation of the Cell's public HTTP face, not a constitutive property of the Cell organ.*

**Why it earns its own name.** The other six Cell-axis sub-claims describe the Cell organ itself (capability surface, IAM-attested events, permission boundary, origin isolation, caller-identity header, async write-shape). This primitive describes how AWS edge primitives force the Cell's public face to be wired. If the Cell axis ran on Kubernetes or Fly tomorrow, the three transforms would change entirely while the other six would not. The doc's own "What is NOT core" list previously described this as "AWS-stack-specific plumbing that realises the Cell axis's public HTTP face" — the phrase "realises … face" admits the relationship is realisation, not constitution. Naming it separately lets the substrate's portability story stay honest: three cores plus one piece of edge plumbing, not three cores plus seven things bundled. **Verification surfaced one correction to the prose: the body-signing transform also injects `x-forwarded-authorization` for *all* methods (`service-router.ts:25-31`), not only POST/PUT/PATCH/DELETE — the bearer-preservation half is broader than the body-signing half. A single Lambda@Edge function handles origin-request (signing) and another handles origin-response (www-authenticate restoration); they share a single edgeRole.**

**Evidence.**
- `platform/infra/service-router.ts:18-63` — origin-request signer; hashes the body into `x-amz-content-sha256` so OAC SigV4 covers POST bodies end-to-end (CF → FURL).
- `platform/infra/service-router.ts:148-172` — origin-response handler that restores `WWW-Authenticate` (CloudFront strips it; the handler reinjects it from origin response metadata).
- `platform/infra/service-router.ts:25-44` — `x-forwarded-authorization` preserves the viewer bearer past the OAC `Authorization` overwrite (OAC must own `Authorization` for SigV4; the bearer rides in a parallel header).
- `platform/infra/http-service-cell.ts:148-164` — the body-signing pipeline configuration that wires the three transforms into each Cell's HTTP face.

**Evidence (verified).** `platform/infra/service-router.ts:18-44` (ORIGIN_SIGNER_SRC: x-forwarded-authorization preservation injected for all methods, body sha256 for POST/PUT/PATCH/DELETE) · `platform/infra/service-router.ts:46-63` (WWW_AUTH_FIX_SRC: restores www-authenticate from x-amzn-remapped-www-authenticate) · `platform/infra/service-router.ts:198-209` (OriginSigner Lambda@Edge function) · `platform/infra/service-router.ts:219-226` (WwwAuthEdge Lambda@Edge function) · `platform/infra/service-router.ts:238-249` (edgeLambdas wired on every behaviour) · `platform/runtime/define-service.ts:105-109` (resolveHttpIdentity reads x-forwarded-authorization) · `platform/infra/http-service-cell.ts:148-164` (IAM-auth Function URL ↔ OAC plumbing).

**Consequences.**
- POST bodies authenticate end-to-end (CF → FURL); no body-tampering window between CloudFront and the Function URL.
- MCP clients discover the auth server via 401 + `WWW-Authenticate` — the restored header carries the OAuth metadata URL.
- Bearer tokens survive the OAC SigV4 overwrite; `resolveHttpIdentity` reads the bearer from `x-forwarded-authorization` (injected for all methods, not only those with signed bodies).
- The Cell's public HTTP face is realised on CloudFront + Function URL without an API gateway in the data path.

**Reduction history.**
- Round 1: absorbed into Cell axis as one of six AWS edge sub-claims.
- Round 4: split back out from Cell axis. The "realises Cell's public HTTP face" framing in the absorbed list admits the relationship is realisation, not constitution. The portability test (would this change if Cell ran on Kubernetes?) cleanly separates this primitive from the organ-semantics sub-claims. Named as a sibling substrate-level infra primitive — three cores plus this one piece of AWS edge plumbing.

### Async write-shape (pending-marker pattern)

*Reduced — folded into Cell axis as sub-claim 6. Pending marker = Fact write; self-dispatch = `lambda:InvokeFunction Event` on own ARN (an IAM grant in cell-template provisioning, sibling to `events:source = cell-<id>` pinning); terminal write = Fact supersede; caller polls via `workspace.changes` (a Projection preset over Fact's temporal shadow). None of the four pieces is new — the shape is how a Cell composes existing primitives under Lambda's edge cap. **A correction surfaced by verification: the full four-step pattern is exercised today only in `cells/models` for agent/run async paths — `cells/models/index.ts:945-950` carries the lone `InvocationType:'Event'` self-invoke on `SELF_FUNCTION` observed in the cells directory. The IAM grant for self-invoke is universally provisioned by cell-template (`InvokeSelf` Sid at `cell-template.ts:158-166`), so the *capability* is universal even where the *pattern* is not yet uniformly adopted across all cells. `JOB#`/`sk:'v1'` and `sk:\`c${i}\`` chunking match the doc.***

**Evidence (preserved across the reduction).**
- architecture.md §11/§11.3 — pending-marker → self-dispatch → terminal write → caller polls.
- technical-spec.md §11 — the canonical shape and IAM grant pattern.
- `services/cells/cell-template.ts:158-166` — `InvokeSelf` Sid: `lambda:InvokeFunction` restricted to own ARN (cell-template provisioning).
- `platform/runtime/state.ts:1041` — `workspace.changes` tails the temporal shadow (Projection preset).

**Evidence (verified).** `services/cells/cell-template.ts:158-166` (InvokeSelf Sid — lambda:InvokeFunction restricted to own ARN; universally provisioned) · `cells/models/index.ts:945-950` (putJob pending → InvokeCommand on SELF_FUNCTION with InvocationType:'Event' — the one observed exercise of the pattern) · `cells/models/index.ts:605-640` (JOB# rows with TTL, chunking for >300KB results) · `cells/models/index.ts:910-934` (getJob — poll path) · `platform/runtime/state.ts:1514-1526` (workspace.changes — the polling substitute) · `docs/architecture.md:1062-1063` (workspace.changes documented as polling primitive).

**Reduction history.**
- Round 2: split-from-Cell-axis → split → framed as substrate-level workflow contract.
- Round 3: reduce → Cell axis.
- Round 4: reaffirmed reduce → Cell axis.

### Subscription

*Reduced — folded into Fact + Projection. A Subscription is a Fact at `_subscriptions/<id>` (Fact key-shape rule under reserved namespace) whose value carries `{match, invoke|deliver, params}` (Fact value-half; the per-kind CEL parser is a Subscription concern, not a registry primitive), evaluated by a bounded reactor reading `fact.written` events (the change-stream variant of Projection.select — `platform/runtime/state.ts:774` shows `matchesSelector` is shared between view membership and subscription match at `subscriptions.ts:158`, confirming View ≡ Subscription = same predicate × {state, changes}). The depth cap of 50 is reactor implementation policy, verified at `handlers.ts:2160` (`sub.maxDepth ?? 50`), not a structural property of the primitive. Action targets are Facts in `_actions/<id>`. The polling-substitute-for-SSE via `workspace.changes` is a Projection preset over Fact's trajectory shadow at `platform/runtime/state.ts:1041`. The reactor re-emits `workspace.fact.written` so chained subscriptions step forward (`handlers.ts:2186`).*

**The substrate-genuine claim that survives** is "reactivity is the temporal evaluation of Projection.select against `fact.written` Facts; the subscription value is a Fact at `_subscriptions/<id>`." ADR-0011's architecture diagram (View ≡ Subscription) admits the reduction; the Round-3 keep-defence (citation rate across machine/tending/weave/regwatch) was vocabulary, not structure. The named composition survives as documentation of how reactivity is realised on top of Fact + Projection; ADR-0011 stays as the doc.

**Evidence (preserved across the reduction).**
- `docs/architecture/adr/0011-reactivity.md` — Accepted; the View ≡ Subscription diagram admits the reduction.
- `platform/runtime/selector.ts` — exported via `runtime/index.ts:52` (the shared selector grammar at the heart of Projection.select).
- `platform/runtime/state.ts:774` — `if (!matchesSelector(r, view)) continue` (view membership routed through the shared predicate; same predicate against change-stream is Subscription).
- `services/workspace/subscriptions.ts` — `SUBSCRIPTIONS_PREFIX = '_subscriptions/'`, `SubscriptionMatch`, `SubscriptionDefinition` (Fact value-half shape).
- `cells/machine/engine.ts:391` — `projectStepSubscription` (one "on run change → step" sub replacing per-auto-rail subs, ADR-0018).

**Evidence (verified).** `services/workspace/subscriptions.ts:23` (SUBSCRIPTIONS_PREFIX = '_subscriptions/') · `services/workspace/subscriptions.ts:35-61` (SubscriptionDefinition with id/match/invoke|deliver/params/maxDepth) · `services/workspace/subscriptions.ts:122-151` (validateSubscription with CEL parse) · `services/workspace/subscriptions.ts:156-167` (matches — uses matchesSelector shared with view membership) · `services/workspace/subscriptions.ts:181-200` (subscriptionKind + createSubscriptions wraps createDeclarationRegistry) · `services/workspace/handlers.ts:2138-2197` (createFactReactionHandler — bounded reactor) · `services/workspace/handlers.ts:2160-2163` (depth cap default 50 via `sub.maxDepth ?? 50`) · `services/workspace/handlers.ts:2186` (re-emits workspace.fact.written so next rail reacts) · `cells/machine/engine.ts:391` (projectStepSubscription) · `docs/architecture/adr/0011-reactivity.md`.

**Reduction history.**
- Round 1: reduce-to-{Declaration+Projection} → kept → ADR-0011 names this collapse explicitly.
- Round 2: rename → Reactivity (Subscription) → Subscription.
- Round 2: reduce-to-Cell+Declaration+Projection → kept on vocabulary grounds.
- Round 3: reduce-to-Declaration+Projection → kept on vocabulary grounds.
- Round 4: reduce → Fact + Projection. With Declaration registry collapsed into Fact + Projection, Subscription decomposes cleanly: the storage half is a Fact at `_subscriptions/<id>` under the same reserved-namespace convention as `_types/`/`_views/`/`_actions/`; the evaluation half is the change-stream variant of Projection.select. ADR-0011's own diagram (View ≡ Subscription = predicate × {state, changes}) admits the reduction. The depth-cap-bounded reactor is reactor-implementation policy. The CEL `match` parser is a Subscription-kind validator at registration (per-kind concern). The substrate-level claim "reactivity is the temporal evaluation of Projection.select" survives as documentation on Projection.

### read/act + three-tool MCP surface

*Reduced — folded into Cell + Projection + Fact. The gateway is a Cell (`services/gateway/service.ts:474` is `defineMcpService({name:'gateway',...})`); `read` is a family of Projection presets over named providers (`services/gateway/service.ts:50-58,141-183,186-226` — the `PROVIDERS` table is a router into Projection.select against Fact-stored providers like `$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity`); `act` is Cell-tool dispatch which terminates in a Fact write, gated by `hasScope(ctx.identity, scope)` (the gating Projection over the grant index); `whoami` is a Projection preset over Identity request-envelope state — a fixed-shape `read('$identity')` shipped at the wire as a discoverability convenience. The wire-level read/act observe-vs-write duality is the same observe-vs-write asymmetry already structural to Fact (reads-direct, writes-mediated). The "capability lives in arguments" rule is the API surfacing of `$catalog` being a Projection preset (capability-as-data). Verification corroborated `whoamiTool` at `service.ts:387-395` as exactly the small synchronous Identity-only function described — empty `inputSchema` (line 426), `readOnlyHint:true` (line 427), separate handler entry. `read` and `act` both route through `resolveTarget → enforceScope → cap.forward`; only behavioural difference is the `kind: 'read' | 'act'` type check.*

**The substrate-genuine claim that survives** is "MCP wire = Cell HTTP face exposing Projection presets; `read`/`act` are the projection-vs-cell-tool routers, `whoami` is `read('$identity')` shipped as a separate tool for discoverability." This is one Cell's behaviour, not a substrate primitive. The primitive's previous keep-defences — "MCP clients depend on the names" and "API contract referenced across docs" — are citation, not structure. `whoami` is admitted in the prose to "fold to `read('$identity')`" when the duplication is paid down; the code at `services/gateway/service.ts:387-395` confirms it is a 7-line synchronous function returning `ctx.identity` directly, bypassing `resolveTarget`/`enforceScope`. Splitting whoami out makes the reduction honest: it was always a fixed-shape Projection preset, never a substrate primitive.

**Evidence (preserved across the reduction).**
- `services/gateway/service.ts:1-31` — the load-bearing comment: stable surface, dynamism in arguments; "mirrors the substrate's own read/put duality, lifted to the whole platform: read observes, act effects" (Fact's observe-vs-write asymmetry surfaced at the wire).
- `services/gateway/service.ts:11` — "read observes, act effects" (Fact asymmetry at the wire).
- `services/gateway/service.ts:26` — "read/act refuse to cross the read/act boundary" (Projection-vs-Cell-tool boundary).
- `services/gateway/service.ts:50-58` — `PROVIDERS` table (Projection presets indexed by sentinel).
- `services/gateway/service.ts:141-183` — `resolveTarget`: tier-1 vs tier-2 routing (gateway Cell behaviour).
- `services/gateway/service.ts:186-226` — `buildCatalog` filtered by `hasScope` (gating Projection over the grant index feeding the catalog Projection preset).
- `services/gateway/service.ts:346-385` — `read`/`act` routers (both route through `resolveTarget` → `enforceScope` → `cap.forward`; only behavioural difference is `kind: 'read' | 'act'` type check).
- `services/gateway/service.ts:387-395,426,490` — `whoamiTool` is a 7-line fixed-shape probe with empty `inputSchema` and its own dispatch — a `read('$identity')` Projection preset shipped as a separate tool for discoverability; long-term home is `read('$identity')`.
- `services/gateway/service.ts:422-447` — three tools listed at `tools/list` (gateway Cell's wire surface).
- `services/gateway/service.ts:474` — `defineMcpService({name:'gateway',...})` (the gateway IS a Cell).
- `docs/dynamic-cells.md:172-208` — why `read`/`act` instead of named tools per capability.

**Evidence (verified).** `services/gateway/service.ts:1-31` (load-bearing doctrine comment) · `services/gateway/service.ts:50-58` (PROVIDERS table + sentinel targets) · `services/gateway/service.ts:141-183` (resolveTarget for tier-1 and tier-2) · `services/gateway/service.ts:186-226` (buildCatalog filtered by hasScope) · `services/gateway/service.ts:283-297` (enforceScope — three-tier) · `services/gateway/service.ts:346-385` (read/act handlers — both route resolveTarget → enforceScope → cap.forward) · `services/gateway/service.ts:387-395` (whoamiTool — 7-line synchronous identity probe) · `services/gateway/service.ts:422-447` (whoami/read/act registration with empty inputSchema and readOnlyHint:true for whoami) · `services/gateway/service.ts:474-492` (defineMcpService for gateway). PROVIDERS includes 'workspace', 'cells', 'auth' as the three tier-1 providers.

**Reduction history.**
- Round 1: reduce-to-{Projection+Cell+Authorization} → kept → underlying machinery admitted, but read/act observe-vs-write boundary named.
- Round 2: reduce-to-Cell+Projection+Authorization → kept on API-contract grounds.
- Round 3: split (whoami vs read/act) acknowledged in prose, but kept as one section "because the three tools ship as one wire surface" (a confession that shipping shape ≠ primitive shape).
- Round 3: reduce-to-Cell+Projection+Authorization → kept on API-contract grounds.
- Round 4: reduce → Cell + Projection + Fact. The honest admission in Round 3 ("this primitive earns its name on API-contract grounds; the implementation reduces to Cell + Projection + Authorization") settles the verdict, especially now that Authorization itself has reduced to Cell + Projection + Fact. The gateway is one Cell; `read`/`act` are routers into Projection presets; `whoami` is the `read('$identity')` Projection preset shipped at the wire. The wire-level observe-vs-write duality is the same Fact-level asymmetry surfaced at the wire — citation rate isn't structure. The earlier split-into-whoami-vs-read/act verdict is honoured by noting in the reduction that `whoami` was always a distinct Projection preset and reduces cleanly on its own; keeping the section as a single primitive section would re-bundle two contracts, so the section is now scoped to acknowledging both halves reduce.

## What is NOT core

The streams pre-rejected these. The substrate already covers each below the listed primitive(s):

- **Identity (validated bearer) as standalone:** folded into **Cell + Projection + Fact** — Identity is request-envelope state populated by the auth Cell's `validateBearer` behaviour (Cell); it carries `scopes`/`grantScopes` consumed by the gating Projection at every PEP (Projection over the grant index).
- **Effective access = grants ∩ token.scope as standalone:** folded into **Projection over Fact** — `applicableGrants(principal)` is the gating Projection's select-half over the grant index; `intersectScopePatterns` is its score function.
- **Authorization (validated bearer ∧ grants ∩ token.scope) as standalone:** folded into **Cell + Projection + Fact** — bearer-validation is the auth Cell's behaviour; the gating equation is a Projection preset over the grant index; the partition layer is Fact's key-shape rule. ADR-0007's title "Grant axis" names the *axis* (a slice across the three cores), not a sibling primitive. The codebase confirms (no `authorization.ts`; only `grants.ts` and `auth.ts`).
- **Grant axis (grants-as-data + intersection equation) as standalone:** folded into **Projection over Fact** — the grant index lives in the substrate table under the same scope key rule (live index at `GRANT#`/`GRANTBY#`/`MEMBER#`, request/answer inboxes at `_grants/requests/` and `_grants/answers/` as Facts); the intersection equation is a Projection preset evaluated at every PEP.
- **Scope = owner = identity as standalone:** folded into **Fact** — the prefix-IS-principal-IS-target equation is structural to the Fact key (`pk = STATE#<scope>`); `LeadingKeys` is the AWS enforcement of that key rule.
- **Trajectory (TTL-bounded per-scope append log) as standalone:** folded into **Fact** — ADR-0013 names trajectory as "Fact's temporal shadow"; same `state.put` writes both; the TTL is a storage retention property; the "one log, two readers" invariant is preserved by both readers (Salience and `workspace.changes`) being Projection presets over the same Fact-adjacent log.
- **Salience as standalone:** folded into **Projection pipeline** as its score stage — ADR-0006 titles it "Salience stage"; `callSalience` is the score chokepoint of Projection; the 5-term blend is the stage's implementation; the no-stored-score invariant is how the stage runs.
- **Resolution (`layer`) as standalone:** folded into **Projection pipeline** as the merge discipline of its present/select stages — 9-line helper, two callers, both inside Projection stages; ADR-0010 admits the bare minimum; per-facet last-wins survives as documentation on Projection.shape/present.
- **Declaration registry (vocabulary-as-Fact) as standalone:** folded into **Fact + Projection** — `register`/`list`/`get`/`remove` are 30 lines of pass-through to `state.put`/`state.query(prefix)`/`state.get`/`state.supersede`; the reserved `_<ns>/<id>` namespace convention is structural to Fact's key shape (same way `STATE#<scope>` is); per-kind validation is a kind responsibility (Type knows how to validate its shape; Subscription knows how to parse its CEL); per-kind evaluation lives at read sites in Projection.
- **Edge (Reference projection) as standalone:** folded into **Projection + Fact** — ADR-0003 admits "Reference as a projection"; authored edges are Facts under the same scope key rule; derived edges are a Projection.select preset; rel/strength is three numeric constants in the projection; the rule grammar is the `_types/<type>` Fact's `value.shape` facet.
- **Surface factoring (item-surface) as standalone:** folded into **Projection pipeline** as the structure of its present-stage output — `resolvePresent` IS the present stage (invoked primarily at the gateway `$types` boundary today, with client consumer convergence partial); `entity × renderer × decoration` is the shape of present's output; ADR-0015's claim "every surface = collection × render modality" is the claim that present parameterises over modality.
- **Edge-surface factoring as standalone:** folded into **Projection pipeline** — ADR-0016 Status: Proposed; only phase-1 shipped (`cells/canvas/client/lib/network/edgeInspect.ts`); the factoring shape is identical to item-surface's with the entity slot rebound to a Reference, and item-surface itself reduces to Projection.present; the substrate-genuine "rel ≠ label" sits in Edge → Fact + Projection.
- **Subscription as standalone:** folded into **Fact + Projection** — `_subscriptions/<id>` is a Fact under the reserved-namespace convention (Fact); `match` against `fact.written` is the change-stream variant of Projection.select; ADR-0011's own diagram (View ≡ Subscription) admits the reduction; the depth-cap-bounded reactor (default 50) is implementation policy, not structure.
- **Async write-shape (pending-marker pattern) as standalone:** folded into **Cell axis** as sub-claim 6 — pending marker is a Fact, self-dispatch is the cell-template IAM grant (sibling to `events:source` pinning, universally provisioned), terminal write is a Fact supersede, caller-poll is a Projection preset; the shape is how a Cell composes existing primitives under Lambda's edge cap. The pattern is currently exercised in `cells/models` for agent/run async paths.
- **read/act + three-tool MCP surface as standalone:** folded into **Cell + Projection + Fact** — gateway is one Cell, `read` is a router into Projection presets over Fact-stored providers, `act` is Cell-tool dispatch terminating in a Fact write, `whoami` is a `read('$identity')` Projection preset shipped at the wire as a discoverability convenience (long-term home: `read('$identity')`). Wire-level observe-vs-write duality is the same Fact asymmetry surfaced at the wire.
- **`whoami` (gateway tool) as standalone:** folded into **Projection over Fact** — a 7-line synchronous function returning `ctx.identity` (Projection over Identity request-envelope state); empty `inputSchema`, separate dispatch; long-term home is `read('$identity')`. Shipped at the wire today alongside read/act for discoverability.
- **Capability-only runtime (`ctx` + registry-mediated peers):** absorbed into **Cell axis** — `ctx` is what a Cell sees of the outside world.
- **IAM-attested event source (`events:source` pinned):** absorbed into **Cell axis** — cell-template provisioning under the permission boundary.
- **Permission boundary + bounded-role provisioning:** absorbed into **Cell axis** — boundary IS the IAM enforcement of the Cell axis's safety claim.
- **Cell-origin isolation (host = browser origin):** absorbed into **Cell axis + Fact (scope rule)** — browser-origin trust boundary is the scope key rule expressed in the browser tier plus Cell hosting the iframe.
- **`x-cell-caller` (token never reaches a tier-2 cell):** absorbed into **Cell axis** — synchronous twin of `events:source`.
- **Lambda Function URL ~30s edge cap → async-by-construction:** environmental constraint that motivated the **Async write-shape** sub-claim of Cell axis.
- **CloudFront OAC + body-signing + WWW-Authenticate restoration:** named as the **Edge HTTP contract** primitive — split back out from Cell axis in Round 4 as a sibling AWS-edge-realisation primitive (not a constitutive property of the Cell organ).
- **Type-as-one-object (facets):** the value shape of `_types/<type>` Facts; reduces to **Fact + Projection.present/select** (per-facet canonical ← slice ← `_renderers/<type>` layering at read sites).
- **Edge / Reference projection rules (embedded/key-encoded/structural):** rule grammar declared on `_types/<type>` Facts' `value.shape`; reduces to **Fact + Projection.select**.
- **Collections (intensional + extensional):** Collection = predicate × {intensional via Projection.select, extensional via membership edges + ordering decoration}; reduces to **Projection pipeline**.
- **Edge strength (per-rule):** tunable property of the Edge projection + a parameter of centrality; reduces to **Projection over Fact**.
- **Frames (viewpoint / region render):** `frame = Collection + region render`, explicitly not a new primitive (ADR-0015); reduces to **Projection pipeline** (region modality at the present stage).
- **Stateless machine stepper / machine decomposed graph:** features on the settled substrate; reduce to **Cell axis (substrate client) + Fact + Projection (`keyEdges` rules on `_types/<type>`)**.
- **Affordance `{icon, label, render, handlers}`:** output of the present stage; reduces to **Projection pipeline**.
- **`may(principal, verb, resource)`:** a documented contract over the three enforcement layers; reduces to **Cell + Projection + Fact** (the layers ARE the three cores).
- **`$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity`:** each is a `read(...)` preset over Facts under a reserved namespace; reduces to **Projection over Fact** with the appropriate `_<ns>/` prefix.
- **`decide as agent` (ADR-0019 §2):** vocabulary consolidation on top of `models.agent`; reduces to **Cell + Fact (`_subscriptions/<id>`) + Projection**.
- **Action / View / Subscription-as-category / Collection / Room / Tending / Frame / Machine / CEL / Lease / Storage layout / Two-tier / Reflexivity / Provenance / Origin isolation (as standalone primitives):** every one of these is either a Fact under a reserved namespace, a Projection preset, an Edge projection (a Projection over Fact), a `_meta` facet of Fact, or an implementation manifestation of one of the above.
- **Cell substrate client (the shared `{read, query, emit, supersede}` module):** the caller-side manifestation of the **Cell axis**.
- **OAuth + WebAuthn flows / RP ID collapse / refresh tokens / `parc_session` carve-out:** auth Cell's implementation; reduces to **Cell**.
- **AWS SDK v2/v3 split + `__setX` injection seam:** consequences of the **Cell axis** under Node 20.
- **Cell deploy pipeline (CellDeployRoute, idempotency, retry, SERVER_BUNDLED allowlist):** instance of the **Async write-shape** sub-claim of Cell axis + event-source provenance from Cell axis.
- **Per-cell DynamoDB tables ("rows vs facts"):** Fact's scope key rule expressed at DDB + the Fact contract defining what rises above it.
- **`_groups/<name>` + `MEMBER#<principal>` index, grant request/answer inbox:** Facts under reserved `_grants/` namespace (for the request/answer inbox) + DDB grant index rows (for the live index) + gating Projection; reduces to **Projection over Fact**; no new notification channel.
- **`SubstrateTable` / `HttpServiceCell` / `ServiceRouter` / `PlatformEventBus` / `DynamicCellControlPlane` CDK constructs:** deploy-time bookkeeping captured directly under **Cell axis**, **Fact** (scope key rule), and **Edge HTTP contract**.
- **S3 cell-storage layout + `cleanPath`:** Fact scope key rule expressed in S3 + path-traversal defense for forge-mediated isolation.
- **Park / visual language:** presentation discipline applied to the present stage — design contract, not a substrate primitive.
- **The three tenets as listed:** the primitives in prose form — the tenets list is the index, not an additional claim.
- **Open-questions inventories:** meta — not load-bearing in either doc's argument structure.
