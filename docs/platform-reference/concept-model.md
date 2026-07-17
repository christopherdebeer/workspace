# Conceptual Model — Cores & ADR Capability Map

## What this subsystem is

This subsystem is not code you deploy — it is the **conceptual spine** the rest of the platform docs hang from, and the falsifiable claim they exist to defend: *the entire parc.land substrate reduces to **three irreducible cores** plus **one** piece of AWS-edge plumbing named alongside.* Everything else — identity, authorization, trajectory, salience, resolution, subscription, edges, surfaces, the MCP `read`/`act` surface, the `$`-self-model — is a **named contract on top of** the three cores, not a fourth primitive.

The three cores (each capability in the platform is measured against them):

- **Fact** — a keyed `{value, _meta}` row at `(scope, key)`: monotonic, server-stamped, supersede-not-delete, CAS, read-time timers, with a TTL-bounded trajectory shadow. `scope` = IAM principal = OAuth target, enforced by DynamoDB `LeadingKeys`. Anchor: `platform/runtime/state.ts:49` (`EntryMeta`), `platform/infra/substrate-table.ts:21-66`, ADR-0013, ADR-0007.
- **Projection pipeline** (`select → score → shape → present`) — the single read pipeline every command is a preset of; score stage = the Salience blend, present stage = the Affordance shape, reactivity = the same `select` over the change-stream, the grant gate = a projection preset over the grant index. Anchor: `platform/runtime/state.ts`, `present.ts`, `selector.ts`, `resolution.ts`, ADR-0004/0006/0010/0011/0012.
- **Cell axis** — an IAM-isolated Lambda + scratch table + scope + `describeTypes` publish seam + bounded substrate grants (`ssrReads`/`callerWrites`) + event-source attestation + origin isolation + `x-cell-caller` + async write-shape. Anchor: `platform/infra/dynamic-cell-control-plane.ts`, `services/cells/cell-template.ts`, `services/cells/service.ts`, ADR-0008.

Plus one realisation primitive (explicitly *not* a core):

- **Edge HTTP contract** — the three Lambda@Edge transforms (OAC body-signing + `WWW-Authenticate` restoration + `x-forwarded-authorization`) that make CloudFront + an IAM-auth Function URL stand in for an API gateway. Realisation, not constitution: if the Cell axis ran on Kubernetes these three would change while the three substrate cores would not. Anchor: `platform/infra/service-router.ts:18-63,148-172`, `platform/infra/http-service-cell.ts:148-164`.

The argument is carried across two paired doc lineages:

1. **The adversarial reduction loop** — `docs/platform-core.md` (the *At a glance* table + *Primitives* sections + the *What is NOT core* table), and its distillation peers `docs/architecture/breathe.md` (the inhale/exhale "breathing" ritual over 19 waves) and `docs/architecture/compose.md` (the post-substrate surface distilled to three shapes). The invariant they defend: **every primitive has one representation and one resolver; every component USES primitives but RE-IMPLEMENTS none** (breathe.md:8-9).
2. **The cognitive re-framing** — `docs/cognitive-substrate.md` + `docs/cerebellar-loop.md`, which map the same three cores onto a neuro stack and name the frontier (the reward/consolidation loop, ADR-0070/0072/0073).

The unit's job is to establish, defend, and keep honest the claim that every derived capability compounds on the three cores, **and to expose that self-model as live, readable data** (the `$`-surfaces). Grounding is the deployed `https://parc.land/mcp` snapshot (principal `c15r`): 6509 facts, 50 live `$types`, 17 deployed `$cells`, `$grants` authority self-model, capabilities projected as `_caps/<target>` facts.

> **A note on drift, by design.** Two source-vs-source and source-vs-deployed gaps run through this subsystem and are documented, not hidden: (a) `architecture.md §4.2.X` still names a **5-signal** salience blend while `compose.md`/the ADR stream ship **7** (relevance ADR-0051 + reward ADR-0070 added default-0-weight); (b) `architecture.md` cites cells/ADRs in the 0001–0016 range, while the deployment runs 17 cells and ADR numbering has reached 0088. See *Live self-model coherence signal* below.

---

## 1. Three-cores reduction (Fact · Projection · Cell) + Edge HTTP contract

**What it does.** This capability *is* the statement of the cores — the conceptual overview the whole doc-set produces. It asserts ONE representation (Fact), ONE read pipeline (Projection), ONE execution/supply axis (Cell), and that everything else is a named contract on top. Each core is stated in `platform/core.md` with a one-line, a "reduces?" verdict, and primary code evidence (the *At a glance* table, `docs/platform-core.md:9-26`). The Edge HTTP contract is named a **sibling**, not a core, and earns separate naming by the **portability test** (`platform-core.md:365-369`).

**Data model (Fact key layout).** From `platform/infra/substrate-table.ts:21-66` and `services/cells/cell-template.ts:66-88`:

```
pk = STATE#<scope>   sk = KEY#<key>          — the Fact row
TRAJ#<scope>                                 — trajectory shadow (TTL)
SEQ#<scope>                                  — per-scope sequence
EDGE#<scope>#<from>|<rel>|<to>               — authored edges
gsi-in   gsi1pk = IN#<scope>#<to>            — inbound reference index
gsi-type gsi2pk = TYPE#<scope>#<type>        — typed / recency reads
```

GSI partition keys deliberately **repeat scope** so `LeadingKeys` covers index reads too (`platform-core.md:34`). `EntryMeta` (`platform/runtime/state.ts:49`) = `{revision, seq, writer, via, createdAt, updatedAt, writers, superseded, supersededBy, timer, + computed score/velocity/standing/centrality}`.

**Public API (the reduction targets' entry points).**

```ts
ObservedState.put(scope, key, value, opts)   // server-stamps writer/seq/revision/createdAt + appendTrajectory in ONE call — state.ts:1206-1277
ObservedState.read/query/neighbors(...)        // shaped Projection presets
resolvePresent(fact, decl): Affordance         // present stage — present.ts:52
callSalience(...)                              // score chokepoint — state.ts:429-432
may(principal, verb, resource) = applicableGrants(principal) ∩ token.scope  // ADR-0007
```

**Invariants & edge cases.**
- One representation, one resolver — strip Fact and nothing else stands (`platform-core.md:34`).
- `scope = IAM principal = OAuth target` is structural to the Fact key, not a separate primitive (Round-2 reduction, `platform-core.md:66`).
- Edge HTTP realises, does not constitute, the Cell's public HTTP face (portability test, `platform-core.md:363`).
- The three cores are AWS-stack-portable; only the Edge HTTP contract is AWS-specific.

**Reduces to.** This capability *defines* the reduction targets `fact`, `projection`, `cell`, `edge-http`; it does not reduce further. Its honesty hinge is that Edge HTTP is held separate from Cell (realisation ≠ constitution), and that scope/trajectory/salience/resolution/authorization/subscription/read-act all fold INTO the three cores.

**Connections.** Every other capability in this subsystem depends on this one. The *What is NOT core* table (§2) is its discharge; the salience signal set (§3) is the score stage of one core; the cognitive mapping (§7) is the same three cores in Latin.

**Motivating ADRs.** ADR-0013 (Fact floor), ADR-0004 (Projection pipeline), ADR-0008 (Cell axis), ADR-0007 (Grant axis).

---

## 2. The "What is NOT core" reduction table

**What it does.** The load-bearing *exhale* of the reduction: an itemised table (`docs/platform-core.md:456-505`) enumerating ~30 candidate primitives the streams pre-rejected — Identity, Authorization, Grant axis, Scope=owner=identity, Trajectory, Salience, Resolution, Declaration registry, Edge/Reference projection, Surface factoring, Subscription, Async write-shape, read/act, whoami, capability-only runtime, event-source attestation, permission boundary, origin isolation, `x-cell-caller`, CloudFront OAC, Type-as-one-object, Collections, Edge strength, Frames, machine stepper, Affordance, the `$`-surfaces, decide-as-agent, and the CDK constructs. Each row carries an explicit **"folded into `<cores>`"** verdict + a one-line justification. This is where the doc discharges the coherence-audit obligation: nothing is left un-placed.

**Representative folds** (from `platform-core.md:460-503`):
- Identity / Authorization / `may()` → **Cell + Projection + Fact** — `validateBearer` is the auth Cell; `applicableGrants ∩ token.scope` is a Projection preset over the grant index; the partition rule is Fact's key shape.
- Salience / Resolution / Surface factoring / Collections / Frames / Affordance → **Projection pipeline** (score/merge/present stages).
- Trajectory / Scope → **Fact**.
- Subscription → **Fact** (`_subscriptions/<id>`) + **Projection** (change-stream select).
- Async write-shape / `x-cell-caller` / event-source / permission-boundary → **Cell axis**.
- CloudFront OAC → **Edge HTTP contract**.

**Data model.** References the reserved-namespace Fact convention `_<ns>/<id>` — `_types/`, `_views/`, `_actions/`, `_subscriptions/`, `_renderers/`, `_config/`, `_groups/`, `_public/`, `_grants/requests/`, `_grants/answers/`.

> **⚠ Coherence — the grant-index correction (compounds, with a caveat).** The prose claim "`_grants/` are Facts" is only partially true, and the doc corrects itself at `platform-core.md:85-112` and `:463`. The **live grant index** is a *parallel DynamoDB key shape* (`GRANT#<grantee>`, `GRANTBY#<owner>`, `MEMBER#<principal>`) provisioned by `createDynamoGrantStore` (`services/workspace/grants.ts:119-192`), **NOT** a `_grants/<id>` Fact. Only the request/answer inbox (`_grants/requests/`, `_grants/answers/`) is reserved-namespace Facts (`services/workspace/grant-requests.ts:19-21`). When you modify anything that reads grants, treat the live index as a sibling table shape, not a namespace scan. "`applicableGrants` is a Projection preset over grant rows" stays conceptually correct.

**Invariants & edge cases.**
- Every rejected candidate is a Fact under a reserved namespace, a Projection preset, an Edge projection (Projection over Fact), a `_meta` facet of Fact, or an implementation manifestation of one of the above.
- Citation across cells ("machine/lit/canvas emit Declarations") is **vocabulary, not structure** — it never justifies keeping a primitive (`platform-core.md:164`, `:493`).

**Reduces to.** `fact`, `projection`, `cell`, `edge-http` — each row is a reduction verdict.

**Connections.** Depends on the three-cores reduction (§1). Directly parallels `breathe.md` Wave 5–14 ("Deliberately not unified": Grant/Scope and Cell are axes, not nouns — `breathe.md:256-263`) and `compose.md §8` ("What this is not").

**Motivating ADRs.** ADR-0001 (declaration registry), ADR-0007 (grant axis), ADR-0010 (resolution), ADR-0011 (reactivity), ADR-0016 (edges first-class, Proposed).

---

## 3. The salience score-stage signal set (5 → 6 → 7 signals)

**What it does.** Defines Projection's **score stage**: a `[0,1]` weighted blend computed at read time and never persisted. `architecture.md §4.2.X` documents the original **five** signals; the ADR stream extends it to seven. This is the doc-set's clearest source-vs-source drift.

The five original signals (`platform/runtime/state.ts:478-507`):

```
recency    = 2^(-age / halfLife)
velocity   = min(windowWrites / saturation, 1)
attention  = min(windowReads  / saturation, 1)
standing   = log1p(lifetimeTouches) / log1p(saturation)
centrality = Σ edge-strength / saturation
```

Default weights sum to ≤ 1.00; tiers are focus / peripheral / elided (thresholds 0.5 / 0.1); five named lenses `salience/recent/connected/durable/active` live in `LENS_PRESETS` (`state.ts:405-424`). Import-priors (`seedReads`/`seedWrites`) give standing a permanent floor past the 24h trajectory TTL. Then:
- **ADR-0051** adds `relevance` (the sixth, intent lens, default-0 weight).
- **ADR-0070** adds `reward` (the seventh, default-0 weight — the earned `R(s,a,s')` the consolidation organ moves; `compose.md:187-199`).

**Public API.**

```ts
computeScore(signals, weights): number     // state.ts:478-507
scoreParts(...)                            // pure weighted sum of injected signals — compose.md cites state.ts:696-728
buildSignals(...)                          // state.ts:438-548
callSalience(...)                          // score chokepoint — state.ts:429-432
SalienceLens / LENS_PRESETS                // state.ts:405-424
resolveSalience(...)                       // default-0 weights for relevance & reward
ObservedState.touch(...)                   // ADR-0085 actor-classed touch on _caps/<target>
```

**Data model.** Per-fact `_meta` exposes `score, velocity, standing, centrality` (rounded 4 d.p.) + `relevance` (ADR-0051) + `explain` rows. Weights/thresholds resolve via `_config/salience` Declaration (lens preset ← config ← per-call override ← principal posture, ADR-0074). Confirmed live: `_caps/workspace.query` shows `score:0.263, standing:1, centrality:0.4681`. Saturations: velocity/attention 5 per 1h window; standing 20 touches (ADR-0050 raised centrality saturation to 50, log-compressed); halfLife 7d default, 1d under `recent`.

**Invariants & edge cases.**
- **Score never persists** — always recomputed per read from signals (`wrap` at `state.ts:1099-1142` computes per-key, never reads stored score).
- Default weights sum to ≤ 1; raw overrides are **not** auto-normalised (caller owns it).
- Recency reads `record.updatedAt`, so it keeps decaying past the 24h trajectory TTL; standing survives TTL only via seed priors.
- A new signal lands **default-0-weight** so every existing read stays byte-identical (relevance & reward both used this discipline — the reason `search` gaining salience is "free", `compose.md:127-140`).
- Actor class (human vs agent) is auth-stamped from the validated token, not name-inferred (ADR-0050 Inc1b / ADR-0022).

> **⚠ Coherence — the 5-vs-7 drift (source-vs-source conflict).** `architecture.md §4.2.X` and `platform-core.md:19,466` still describe salience as a **5-term** blend. `compose.md:44,187-199,225` and the ADR stream ship **7** (`relevance` + `reward`). Both are internally honest — relevance/reward were added default-0-weight precisely so the 5-term reads are unchanged — but if you touch `scoreParts`, expect seven fields, not five, and update `platform-core.md` / `architecture.md` when you do. This is the same drift class §9 tracks as a live coherence signal.

**Reduces to.** `projection` — Salience is the SCORE STAGE (ADR-0006 titles it "Salience stage"; `callSalience` is the chokepoint). The 5/6/7-term blend is the stage's implementation; the lens grammar is its parameters; centrality reads the unified Edge projection (authored ∪ derived, weighted by per-rule strength ADR-0009), so this stage also compounds on the Edge-projection preset.

**Connections.** Feeds *Derived-capability composition* (§5, `search = read(vector, projection, relevance)`) and the *cerebellar-loop closure* (§8, reward is the loop's scored output).

**Motivating ADRs.** ADR-0006 (salience as score stage), ADR-0009 (edge strength → centrality), ADR-0050 (materialize the score), ADR-0051 (relevance — sixth signal), ADR-0070 (reward — seventh signal), ADR-0074 (principal-adopted goals).

---

## 4. The breathe invariant ("every primitive used, none re-implemented")

**What it does.** States the methodological guarantee the reduction docs are built to satisfy — **"3NF for architecture"**: every primitive has exactly one representation and one resolver; every component USES primitives but RE-IMPLEMENTS none (`breathe.md:8-9`). `breathe.md` operationalises it as a repeatable **inhale/exhale** ritual (enumerate a layer in full to surface duplication, then collapse N near-duplicates into one primitive + N usages, valid only if behaviour-preserving) run across 19 waves, closing with a "grep audit, clean" table (`breathe.md:764-769`) proving one resolver each for Resolution (`layer`), Selector (`matchesSelector`), Present (`resolvePresent`), Membership (`workspace.members`).

**Public API (the one-resolver-each proof).**

```ts
layer<T>(...parts): T           // resolution.ts:17 — the one merge resolver (2 callers, both in Projection stages)
matchesSelector(record, sel)    // selector.ts:32 — shared by view-match · query · subscription.matches
resolvePresent(fact, decl)      // present.ts:52 — the present resolver
resolveLabel(...)               // present.ts:42 — used only internally by resolvePresent
workspace.members(...)          // state.ts — the membership resolver
```

**Data model (Wave 14 storage floor, `breathe.md:539-561`).** One table item = Fact `{value,_meta}`; `gsi-in` = Reference inbound index; `gsi-type` = typed/recency reads (Projection.select); `TRAJ#` (TTL) = Salience input only. Timers = lazy lease/reveal at read.

**Invariants & edge cases.**
- A contraction is valid **only if behaviour-preserving** (the parity harness is the merge gate, `compose.md:277-279`).
- One representation + one resolver per primitive; re-implement nothing.
- **Strangler-fig migration**: the composed verb wraps the old ones, old names alias for a deprecation window, no data migration (`compose.md:284-286`).
- **Deliberately NOT unified**: Grant/Scope (authority axis) and Cell (infra axis) gate/supply the nouns but are none of them (`breathe.md:256-263`).

> **⚠ Coherence — `resolvePresent`/`resolveLabel` are dormant (documentation drift, not a runtime conflict).** The breathe "grep audit" (`breathe.md:768`) lists `present.ts` `resolvePresent`/`resolveLabel` as *the* one Present resolver with "home/kernel are consumers." In the current tree they have **zero call sites** in `services/` or `cells/`: `resolveLabel` (`present.ts:42`) is invoked only internally by `resolvePresent` (`present.ts:56`); every other occurrence is a re-export barrel (`platform/runtime/index.ts:94`, `cell-sdk.ts:33`), the compiled bundle string in `cell-runtime.generated.ts`, `tests/present.test.ts`, or a non-invoking comment at `cells/kernel/client/main.ts:435`. The gateway actually resolves the **present facet** at `services/gateway/service.ts:509` via `buildTypeVocabulary → resolveType` (`platform/runtime/type-vocabulary.ts:43-48`, attaching `resolved.present`), never via `resolvePresent`. `platform-core.md:190,291` mis-cite this two ways: (a) wrong function and (b) wrong line — `services/gateway/service.ts:335-339` is the `CORE_FACT_VERBS` string Set, unrelated to present. ADR-0042 (`docs/architecture/adr/0042-govern-the-cell-core-seam.md:34,75`) independently confirms `resolvePresent`/`resolveLabel` have zero callers. **Severity: medium** — the docs' broader thesis (present resolved at the type-resolution seam; consumer convergence partial) is directionally true, so this is a mis-citation/coherence defect, not a design conflict. **Recommendation:** either wire `resolvePresent` in as the real per-fact present stage (fold the gateway/workspace inline present-facet handling into it) or delete it and rewrite the docs to name `resolveType`'s present facet + `buildTypeVocabulary` as the actual present core; in either case correct `platform-core.md:190,291` (stop citing `service.ts:335-339`) and the ADR-0012 "consumers migrate to `resolvePresent`" plan.

**Reduces to.** `fact`, `projection`, `cell` — but it is a **discipline OVER** the primitives, not a primitive. It reduces the expressive surface to "three nouns (Fact · Reference · Declaration), two mechanisms (Resolution · Projection), one signal (Salience), two orthogonal axes (Grant · Cell)". Note the lineage difference (part of this capability's honesty): `breathe.md` keeps Reference and Declaration as named nouns; `platform-core.md`'s later reduction rounds absorb both into Fact + Projection.

**Connections.** Is the precondition of *Derived-capability composition* (§5) — every C1–C8 contraction is a behaviour-preserving breathe.

**Motivating ADRs.** ADR-0001..0014 (the first breathe migration wave), ADR-0044 (distill the substrate), ADR-0067 (recompose the surface).

---

## 5. Derived-capability composition (three shapes + two completions)

**What it does.** `docs/architecture/compose.md` distils the ~34-tool post-substrate surface to **three recurring shapes** plus **two completions** and one DRY, showing "thirty tools are instances of three shapes with parameters nailed shut" (`compose.md:31-35`):

- **Shape A · Declaration** — `declare/list/undeclare(kind)` + per-kind `evaluate` (`invoke`·`view`·`match`). Eleven hand-written handlers → four (`compose.md:63-98`).
- **Shape B · Read** — `read(source, shape)` with `source ∈ slice·store·vector·key·changes` (`compose.md:109-140`).
- **Shape C · Edge** — `edges(around?·rel?·membership?·derived?)` over one reduction `[...authored, ...deriveBackboneEdges(live)]` read four ways (`compose.md:147-171`).

Plus **two completions** (causal rels; reward the 7th signal) and one **DRY** (cell-jobs). Eight behaviour-preserving contractions C1–C8, all shipped live 2026-07-09 (`compose.md:218-266`).

**This is the reference for reading any tool as a preset:**

```
recall   = read(slice, overview)
query    = read(store, projection)
search   = read(vector, projection, relevance)   // now salience-aware, bug gone
peek     = read(key, raw)
changes  = read(changes)
neighbors/graph/members/links = edges(...)
```

**Public API.**

```ts
declare(kind, def) / declarations(kind) / undeclare(kind, id) / evaluate(kind, id, args)   // ADR-0068 (C1)
read(scope, { source, shape, relevance?, folds? })                                          // ADR-0071 (C2)
edges(scope, { around?, rel?, membership?, derived?, hydrate? })                            // ADR-0069 (C3)
// platform/runtime/cell-jobs.ts
submit / run / poll                                                                          // ADR-0076 (C5)
```

**Data model.** `$catalog` lists `workspace.read` (ADR-0071), `workspace.edges` (ADR-0069), `workspace.contested` (ADR-0072) as survivors; `workspace.search/neighbors/links/graph/members/view` marked deprecated (still callable aliases). Edge `rel` is a **free string** (`state.ts:313`; `assertEdgePart` only forbids empty/`|`); `EdgeRecord.score` holds cosine for `similarTo` and per-rel confidence for causal edges.

**Invariants & edge cases.**
- Every shape already exists underneath in `platform/runtime`; the surface is **aligned** to it, not given new abstraction (`compose.md:277-279`).
- The `evaluate` boundary holds — `invoke`/`view`/`match` stay kind-specific, closed only because each has bespoke code, not because vocabulary is assumed (`compose.md:280-282`).
- `link`/`unlink` (write) do **NOT** fold into `edges` (read) — a read and a write are different shapes (`compose.md:169-171`).
- **Open-world vocabulary discipline**: type/tag/rel names are slice-declared data, never compiled sets; a compiled set is at most a fallback floor (`compose.md:287-297`).

**Reduces to.** `fact`, `projection`. Shape A = Fact (vocabulary at `_<ns>/<id>`) + Projection (per-kind evaluate at read sites); the universal register/list/delete lifecycle belongs to the registry, only `evaluate` is kind-specific (ADR-0001 boundary held). Shape B = the Projection pipeline parameterised by candidate source + shape. Shape C = one reduction read four ways by filter flags (Edge projection = Projection over Fact). Completions: causal rels are ordinary authored `EdgeRecord`s (free-string rel, zero schema, confidence rides `strength`) — Fact + Projection; reward is a default-0 term in `scoreParts` — the Projection score stage. `cell-jobs` is Cell-axis DRY.

**Connections.** Depends on the breathe invariant (§4) and the salience signal set (§3). Feeds the `$`-surfaces (§6, `$catalog` lists the composed verbs) and the coherence signal (§9, `workspace.graph` "Unhandled" is exactly the C3 deprecated-alias gap).

**Motivating ADRs.** ADR-0068 (one declaration surface), ADR-0069 (one edge query), ADR-0071 (one read by candidate source), ADR-0070 (reward), ADR-0075 (causal relations), ADR-0076 (vendor cell-jobs).

---

## 6. The self-model surfaces ($catalog · $types · $graph · $grants · $cells · $identity)

**What it does.** Guarantees the substrate fully describes itself **in its own primitives** — the proof legibility went from 2 to 6 read surfaces (`breathe.md:711`), each replacing reverse-engineering with a read:

- `$catalog` — scope-filtered capability menu (grouped one-line, or `{resolve}` for one contract, or `{for}`/`{forType}` for contextual, ADR-0049).
- `$types` — canonical `describeTypes` merged with per-user `_types/` overrides.
- `$graph` — the Reference projection (ADR-0004; the "missing third" of breathe Wave 15).
- `$grants` — the authority self-model resolving the three enforcement layers.
- `$cells` — the fifth surface joining fact→type→manager→tools.
- `$identity` — `whoami`.

ADR-0052/0085 close the loop further: capabilities themselves are projected as `_caps/<target>` `capability` facts, so `recall`/`query` surface what you can DO by meaning, and every dispatch announces `capability.invoked` so used verbs accrue salience.

**Public API.**

```ts
read('$catalog' | '$types' | '$graph' | '$grants' | '$cells' | '$identity')
read('$catalog', { resolve:'<target>' } | { for:'<key>' } | { forType:'<type>' } | { detail:'full' })
// gateway internals
PROVIDERS table + resolveTarget + buildCatalog(filtered by hasScope)   // service.ts:50-58,141-226
workspace.query({ text:'<goal>' })                                     // intent-first capability+fact discovery — ADR-0085
```

**Data model (live shapes confirmed).** `$catalog` groups 17 cells / ~102+ caps (workspace 17, cells 20, auth 10, plus tier-2 `@c15r/*` cells) with `kind read|act` and a `deprecated[]` list; `$types` = 50 type contracts each `{icon, label, manager, handlers{open/edit/render/embed}, present{icon}, keyPattern?}`; `$grants` = `{principal, scope{active,ceiling}, slice, grant{shared[],receiving[],groups[]}}` (c15r: active/ceiling both `[workspace:read]`, two public `doc:docs/*`+`file/docs/*` shares); `_caps/<target>` facts type `capability`, writer `platform`/`cells`, `via tend:capabilities`.

**Invariants & edge cases.**
- `tools/list` enumerates only `whoami`/`read`/`act`; all capability lives in the target argument — new vocabulary is discoverable via `$catalog` without a client reconnect (`services/gateway/service.ts:1-31`).
- `$catalog` is scope-filtered by `hasScope` (you see only what you may call, `service.ts:186-226`).
- A failed narrow read must **never** silently widen to the whole menu (ADR-0085 Inc4).
- `capability` facts are reconciled diff-only on redeploy, superseded on delete; **deprecated aliases are deliberately not projected** (this is why a deprecated verb can be callable yet absent from `_caps/` — see §9).

**Reduces to.** `projection`, `fact`. Each `$`-surface is a Projection preset parameterised by an `_<ns>/` prefix (a `state.query(prefix)` over Facts) — no registry abstraction above Fact. `$grants` is the gating Projection over the grant index. `$identity`/`whoami` is a fixed-shape `read('$identity')` preset over Identity request-envelope state. ADR-0052/0085 dissolve the last capabilities-only-on-the-wire exception into Fact: `_caps/<target>` are `capability`-typed facts, embedded and salience-ranked like any fact.

**Connections.** Depends on *Derived-capability composition* (§5) and the *What is NOT core* table (§2). Is the instrument the *Live coherence signal* (§9) reads against source.

**Motivating ADRs.** ADR-0004 (`$graph`), ADR-0007 (`$grants`), ADR-0008 (`$cells`), ADR-0049 (contextual capabilities), ADR-0052 & ADR-0085 (capabilities are facts).

---

## 7. The cognitive-substrate mapping (neuro layers ↔ primitives)

**What it does.** A second, orthogonal conceptual overview. `docs/cognitive-substrate.md` reads an external neuro-evolutionary account of cognition against the substrate and argues they are **the same architecture in two vocabularies** — Participants→Surfaces→Derived Meaning→State→Organs is reflex→orienting→selection→maps→cortex seen inside-out. It maps every biological layer to an existing substrate primitive:

| Neuro layer | Substrate primitive |
|---|---|
| reflex arc | `subscriptions`/`actions`/`timers` |
| tectum / orienting | the salience signals + lenses + bands |
| basal ganglia | `$catalog {for}` / `actions` / `suggestions` |
| thalamus | `read`/`act`/`whoami` spine |
| hippocampus | `facts` + CAS + `changes` + `share` |
| pallium | `edges` + `similarTo` + `neighbors` + `graph` |
| cerebellum | `attention`/`tend`/`ratify` — **the OPEN loop** |
| neocortex | `machine`/`models`/`run`/`cells.create` |

It frames Karpathy's LLM-wiki as a degenerate special case (only the cortical-map layer) and names the frontier precisely.

**Public API (the organs cited).**

```ts
registerSubscription / actions / invoke     // reflex
attention / tend / ratify / pruneSimilar    // cerebellum
workspace.contested                          // ADR-0072 — Stage A contradiction read (now live)
@c15r/consolidate.run / .latest              // the consolidation organ (now live, delta +11/+7/+3)
```

**Data model (live corpus is the evidence).** 6509 facts across bands focus 442 / peripheral 4789 / elided 1278; top types `doc-block, doc-order, capture, doc, canvas-placement, markdown, canvas-element, capability, mental-model, log, knowledge, claim`. The tending telemetry (stale/unlinked/dangling counts) is the cited proof the cerebellar loop *measures* but historically did not converge.

**Invariants & edge cases.**
- **Organs** (substrate physics) vs **applications** (built with cognition) vs **infrastructure** (forge/auth) are three distinct categories — not every cell is an organ.
- The missing piece is not maps/attention/selection but the **cerebellum**: a loop that corrects the maps and is SCORED on the correction.
- Exploration-compounding (answers file back as facts) is the founding axiom, not a feature to add.

**Reduces to.** `fact`, `projection`, `cell` — every row is one of the three cores wearing a Latin name: reflexes/reactions = Fact (`_subscriptions`/`_actions`) + Projection (change-stream select); orienting/attention = the Projection score stage; memory/blackboard = Fact; maps = the Edge projection (Projection over Fact); organs/neurogenesis = the Cell axis (`cells.create`). The doc's own claim: "the substrate was not designed as a brain and converged on one anyway" — the cores are sufficient to express the cognitive stack with **no fourth primitive**.

**Connections.** Sets up the *cerebellar-loop closure spec* (§8) as its named frontier turned into build. Shares the salience signal set (§3) as the "orienting" layer.

**Motivating ADRs.** ADR-0040 (substrate as self-maintaining wiki), ADR-0045 (close the wiki loop), ADR-0072 (contested view), ADR-0073 (consolidation organ), ADR-0070 (reward signal).

---

## 8. The cerebellar-loop closure spec (contested view + consolidation organ)

**What it does.** The build-ready design that turns §7's named frontier into shipped primitives — and thereby validates the reduction's core test: *a new capability must require no platform-core edit* (`substrate.md`). `docs/cerebellar-loop.md` specifies two pure tier-2 moves:

1. **The `_contested` view** — a two-stage contradiction read. Stage A: a `registerView` cheap structural pre-filter over `similarTo ≥ θ` + no-authored-edge pairs. Stage B: a metered `models.agent` adjudication into `contradict`/`subsumes`/`duplicate`/`independent` with `checked/<hash>` idempotency markers.
2. **The consolidation organ** — a bounded cell that each cycle observes `attention`+`changes`+`contested`, acts on a ≤20-item work-slice, and emits a quality delta it is accountable for, feeding delta back as the **reward** salience term.

Both are confirmed LIVE in the snapshot (`workspace.contested`; `@c15r/consolidate run/fetch/latest`; deployed cell).

**Public API.**

```ts
workspace.contested(...)                       // Stage A read — ADR-0072
@c15r/consolidate.run(...)                     // bounded cycle — ADR-0073/0077
@c15r/consolidate.latest()                     // backlog/delta/rewards/escalations
ratify / suggestions / supersede+migrateLinks  // the repair verbs
```

**Data model.** `consolidation/latest` fact = `{backlog, delta, actions, rewards, escalations}`; delta **positive = progress**. Contested verdicts write `contested/<hash(a,b)>` facts + authored `contradicts` edges (the causal-edge down-payment). `checked/<hash>` markers carry input versions for idempotent re-adjudication.

**Invariants & edge cases.**
- A contradiction is **NEVER auto-resolved** — always escalate; only duplicates/links/high-confidence ratifications act directly.
- The organ is scored on **delta moved**, not on "ran successfully" — a run reporting the same backlog twice is by its own score a failure.
- Stage B is metered (top-N by `cosine × salience`) and idempotent (`checked` markers) so it never re-bills settled pairs.
- Both are **tier-2 builds — no platform-core edit** — the exact test `substrate.md` sets for a primitive being the right one.

**Reduces to.** `cell`, `projection`, `fact`. The `_contested` view = a Declaration (Fact at `_views/`) whose `evaluate` is a Projection select over the vector-adjacency candidates. The consolidation organ = the Cell axis (a bounded serialized Lambda emitting monotonic facts) composing existing reads (`attention`/`changes`/view) + writes (`link`/`ratify`/`supersede`). The reward hook = the seventh salience signal (Projection score stage, ADR-0070). The whole closure adds **ZERO platform-core primitives** — the reduction's falsifiable prediction, confirmed.

**Connections.** Depends on the cognitive mapping (§7) and the salience signal set (§3, reward). Is C7+C8 of *Derived-capability composition* (§5). Its live status is a data point for the coherence signal (§9).

**Motivating ADRs.** ADR-0072 (the contested view), ADR-0073 (the consolidation organ), ADR-0077 (the postured organ), ADR-0070 (reward), ADR-0074 (principal-adopted goals).

---

## 9. Live self-model coherence signal (source-vs-deployed reconciliation)

**What it does.** Guarantees the conceptual model is kept honest against what actually ships: the deployed self-model is readable, and the doc-set treats disagreements as **defects to document, not hide**. The snapshot surfaces three concrete reconciliations the conceptual docs must carry:

1. `workspace.edges` (ADR-0069 unified Reference projection) returns real `platform/vectors` `similarTo` edges while `workspace.graph` **errors "Unhandled"** — the exact deprecated-alias-vs-survivor gap the C3 contraction predicts (§5).
2. `architecture.md §4.2.X` documents **FIVE** salience signals while `compose.md`/ADR-0051/0070 ship **SEVEN** (§3).
3. `architecture.md` names ~13 cells / 7 tier-1 `HttpServiceCell`s while the deployment runs **17** cells including both `home` and `home-next`. ADR numbering has grown to **0088**, past the 0001–0016 range `architecture.md` cites.

**Public API.**

```ts
workspace.edges(...)                        // survivor
workspace.graph(...)                        // deprecated alias — errors "Unhandled"
read('$cells') / read('$types') / read('$grants')
whoami
```

**Data model (snapshot ground truth).** 17 deployed cells (`canvas, consolidate, demo, home, home-next, input, kernel, lit, machine, models, parcland-shell, reef-writer, regwatch, run, starter, tasks, viewers`); 50 live `$types`; 6509 facts; `$grants` scope active/ceiling `[workspace:read]`. `edges.json` shows `platform/vectors` `similarTo` edges with `strength 0.3` and cosine in `EdgeRecord.score`. `graph_verb_status`: "`workspace.graph` errors Unhandled; `workspace.edges` (ADR-0069 unified) works".

**Invariants & edge cases.**
- Deployed self-model is READ-ONLY **ground truth for what ships**; source is **ground truth for how it is built**; disagreements are documented gaps, not silent.
- Deprecated verbs stay callable as aliases within the deprecation window (strangler-fig) — but a live "Unhandled" error signals an alias that **lost its backing before its menu entry was retired**.
- The reduction is only credible if the live surfaces confirm it — the `$`-surfaces are the coherence-audit instrument.

> **⚠ Coherence — `workspace.graph` "Unhandled" (a conflict the reduction predicts, not a surprise).** This is the deprecated-alias-vs-survivor gap C3 (§5) forecasts. `workspace.graph` is a deprecated alias the gateway no longer routes to a live provider path, while `workspace.edges` (ADR-0069) is the survivor. Because deprecated aliases are deliberately not projected as `_caps/` facts (§6 invariant), a caller can still hit `graph` from an old client and get "Unhandled". **Recommendation:** retire the `graph` menu entry in lockstep with its backing, or restore an alias shim for the deprecation window — do not leave a callable name with no provider.

**Reduces to.** `projection`, `fact`, `cell`. This capability is Projection over Fact applied **reflexively to the platform itself**: the `$`-surfaces ARE the ground-truth read, and the reconciliation is comparing that read against the source docs. The `workspace.graph` "Unhandled" error is a Cell-axis behaviour (a deprecated verb the gateway no longer routes) surfaced through the read Projection — the same `read`/`act` dispatch every capability uses.

**Connections.** Depends on the `$`-surfaces (§6) and *Derived-capability composition* (§5). Consumes the 5-vs-7 drift from §3.

**Motivating ADRs.** ADR-0069 (one edge query), ADR-0071 (one read by candidate source), ADR-0051 (relevance), ADR-0070 (reward), ADR-0088 (wake-on-change — newest ADR).

---

## Gotchas / non-obvious behavior

1. **`resolvePresent` is exported but dead.** `platform/runtime/present.ts:52` has zero in-repo callers; the gateway resolves the present facet via `buildTypeVocabulary → resolveType` (`services/gateway/service.ts:509`, `type-vocabulary.ts:43-48`). `platform-core.md:190,291` mis-cite `service.ts:335-339` (which is the `CORE_FACT_VERBS` Set). ADR-0042 confirms the zero-caller state. Do not assume "the present stage runs on every recall."
2. **The live grant index is NOT a Fact.** `GRANT#`/`GRANTBY#`/`MEMBER#` are a parallel DDB key shape (`grants.ts:119-192`); only `_grants/requests/` and `_grants/answers/` are reserved-namespace Facts. The prose "`_grants/` are Facts" is a known over-simplification the doc self-corrects.
3. **Salience is 7 signals now, not 5.** `architecture.md §4.2.X` and `platform-core.md:19` still say five; `scoreParts` carries seven (relevance ADR-0051 + reward ADR-0070, both default-0-weight). A new signal always lands default-0-weight so existing reads stay byte-identical.
4. **Score never persists.** It is recomputed per read from signals every time (`wrap`, `state.ts:1099-1142`). Never look for a stored `score` column.
5. **Recency outlives the trajectory TTL; standing does not (without seeds).** Recency reads `record.updatedAt`; standing needs `seedReads`/`seedWrites` priors to survive the 24h trajectory TTL.
6. **`workspace.graph` errors "Unhandled" while `workspace.edges` works.** Deprecated alias whose backing was retired; deprecated aliases are intentionally absent from `_caps/` projection.
7. **`link`/`unlink` do not fold into `edges`.** Reads and writes are different shapes; `edges(...)` is read-side only.
8. **Vocabulary citation ≠ structure.** "machine/lit/canvas emit Declarations" never justifies keeping a primitive — the reduction rejects citation-rate arguments explicitly (`platform-core.md:164,493`).
9. **Grant/Scope and Cell are axes, not nouns.** They gate/supply Fact·Reference·Declaration but are deliberately never folded into them (`breathe.md:256-263`).
10. **The async write-shape capability is universal but the pattern is not.** The `InvokeSelf` IAM grant is provisioned for every cell (`cell-template.ts:158-166`), yet the only observed `InvocationType:'Event'` self-invoke lives in `cells/models/index.ts:945-950`.
11. **The breathe/platform-core lineages disagree on primitive count on purpose.** breathe.md keeps three nouns (Fact·Reference·Declaration); platform-core.md's later rounds absorb Reference and Declaration into Fact + Projection, leaving three cores. Documenting that difference is part of the model's honesty, not an error to reconcile away.
12. **Edge HTTP is a sibling, not a core.** The portability test (would it change if the Cell axis ran on Kubernetes?) is the whole reason it is named separately — do not treat it as a fourth core.