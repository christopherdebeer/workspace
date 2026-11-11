# 02 · The Fact Model & Type Vocabulary (Ontology)

> **Oblique cards drawn:** *"Give way to your worst impulse."* (assigned) + *"Look
> closely at the most embarrassing details and amplify them."* (obs.parc.land,
> seed `400cccfc`, idx 68).
>
> So this document does both. It is the maximalist-iconoclast pass over the
> ontology of parc.land — the nouns (`fact`, `value`, `_meta`, `type`, `tag`,
> `key`, `revision`, `superseded`) and the verbs (`remember`/`recall`/`peek`/
> `query`/`ingest`/`supersede`/`tend`). It proposes the renames the codebase
> would normally talk you out of, then sanity-checks which "worst impulses" are
> secretly right. The embarrassing detail it amplifies: **the system is built on
> a memory metaphor it does not actually honor, and a `type` field that means
> four unrelated things.**

---

## 1. Inventory — every noun & type in use

### 1.1 The core fact nouns

| Noun | Meaning | Where (file:line) |
| --- | --- | --- |
| **`fact`** | A located datum `(scope, key) → {value, _meta}`. The Σ-calculus `Loc`. | `platform/runtime/state.ts:11–17` (doc), `:83-87` (`Entry`) |
| **`value`** | The opaque JSON payload of a fact. `null` when elided by salience. | `state.ts:84`, `:550` |
| **`_meta`** | Provenance + dynamics envelope: revision, seq, writer(s), timestamps, type, tags, timer, **and read-time salience** (score/velocity/standing/centrality). | `state.ts:46-81` |
| **`key`** | The within-scope identifier of a fact. Carries convention-encoded structure (`doc:`, `el:`, `_renderers/`, `tending/latest`). | `state.ts:421`, `type-vocabulary.md:124-126` |
| **`scope`** | Authority boundary = the per-user slice = a DynamoDB partition. | `substrate-storage.md:56-59` |
| **`revision`** | Monotonic per-`(scope,key)` write count. The CAS handle (`ifRevision`). | `state.ts:48`, `:493` |
| **`seq`** | Monotonic per-**scope** sequence — the trajectory ordinal / change-feed cursor. | `state.ts:50`, `:572-576` |
| **`writer` / `writers` / `via`** | Server-stamped provenance: last principal, all principals, and a soft "how" label. | `state.ts:52-62` |
| **`superseded` / `supersededBy`** | Retire-not-delete: a flag + an optional successor pointer. A fresh write *revives*. | `state.ts:61-64`, `:786` |
| **`tag`** | Free-string filter facet on a fact (`query` filters by one tag). | `state.ts:67`, `:528` |
| **`type`** | Indexable fact-kind string (GSI-served). **This is the overloaded word — see §3.1.** | `state.ts:65`, `:247` |
| **`timer`** | Lease/reveal: `effect:'delete'` = vanish at expiry (claim), `'enable'` = dormant-until. Evaluated at read, no scheduler. | `state.ts:140-153` |
| **`edge` / `rel`** | First-class typed directed link `from --rel--> to`, with `strength`, inbound-indexed. | `state.ts:204-213` |
| **`trajectory`** | The append-only event log (`read`/`write`/`supersede`/`link`/`unlink`) kept *only* to compute salience. | `state.ts:215-221` |
| **`salience` (score/velocity/standing/centrality)** | Read-time attention scalar in [0,1], blended from 5 signals. Never stored. | `state.ts:395-437` |
| **`shaping` (focus/peripheral/elided)** | The tiering of a read by salience; below-threshold facts collapse to `ElidedStub`. | `state.ts:89-117` |
| **`lens`** | Named per-read salience bias (`recent`/`connected`/`durable`/`active`). | `state.ts:335-354` |

### 1.2 The verbs (`workspace.*` targets)

| Verb | Σ-role | Meaning | Where |
| --- | --- | --- | --- |
| **`remember`** | guarded write | Put a fact; bump revision; optional `type`/`tags`/`ifRevision`/`ifAbsent`/`timer`/`owner`. | `handlers.ts:413` |
| **`ingest`** | bulk write | Up to 100 facts + edges in one call (imports/backfills). | `handlers.ts:449` |
| **`recall`** | shaped read | The *whole* slice, salience-shaped. Granted facts under `<owner>/<key>`. | `handlers.ts:499` |
| **`peek`** | point read | One fact by key, unshaped; doubles as existence probe. | `handlers.ts:529` |
| **`query`** | projection | Filter by type/tag/prefix, rank, page. | `handlers.ts:545` |
| **`link`/`unlink`/`neighbors`** | graph | Edge CRUD + traversal. | `handlers.ts:576-619` |
| **`changes`** | observe | Tail the trajectory from a `seq`. | `handlers.ts:657` |
| **`attention`/`tend`** | derived | "What needs tending" (stale/unlinked/dangling); `tend` writes `tending/latest`. | `handlers.ts:682,790` |
| **`supersede`** | retire | Retire toward a successor; `migrateLinks`. | `handlers.ts:883` |
| **`share`/`unshare`/`shared`** | grants | Expose key/prefix/slice to user/`public`/`group:`. | `handlers.ts:901-938` |
| **`registerView`/`views`/`view`/`deleteView`** | declared view | A stored projection (`_views/<id>`) with a render hint. | `handlers.ts:812-880` |

### 1.3 The `$types` vocabulary (fact-kind values actually in use)

Canonical source: each cell's `types.json`, aggregated via `cells.describeTypes`
→ `read("$types")`. Bootstrap fallback: `cells/home/client/type-decls.ts:15`.

| `type` value | Managed by | Meaning | Where declared/used |
| --- | --- | --- | --- |
| `doc` | `@c15r/lit` | A dotlit document. | `cells/lit/types.json`, `lit/client/main.tsx:109,578` |
| `doc-order` | `@c15r/lit` | Ordering/fold metadata for a doc's blocks. | `lit/client/main.tsx:106` |
| `note` | `@c15r/starter` | A starter note. | `cells/starter/types.json`, `starter/client/main.tsx:80` |
| `capture` | `@c15r/input` | Inbox capture. | `cells/input/types.json`, `input/client/main.ts:67` |
| `log` | `@c15r/input` | Append-only log line (`ifAbsent`). | `input/client/main.ts:74` |
| `canvas` | `@c15r/canvas` | A canvas board. | `cells/canvas/types.json` |
| `cell` | `platform` | Pointer-fact to a deployable cell (no managing cell). | `type-decls.ts:16`, `lit/client/main.tsx:88` |
| `renderer` | `@c15r/lit` | Inline-render source (`_renderers/<type>`). | `lit/client/main.tsx:235` |
| `output` | `@c15r/viewers` | REPL output fact, `producedBy` an element. | `viewers/client/main.ts:304` |
| `reading` | `reef-writer` | Organ-emitted reef fact (sensor-ish). | `cells/reef-writer/index.ts:18` |
| `home-layout` | `@c15r/home` | The home dashboard layout fact. | `home/client/app.tsx:2226` |
| `agent-run` | (planned, `models`) | An agent invocation record. | `type-vocabulary.md:175` |
| `decision`/`todo` | (illustrative) | Example indexable kinds in docs/schemas. | `state.ts:65,425` |

---

## 2. Coherence assessment

Read as a *system*, the type values are **not one vocabulary — they are three**,
silently sharing a field:

1. **Content kinds** (`doc`, `note`, `capture`, `log`, `reading`, `output`) —
   "what this fact *is* about." A genuine domain ontology.
2. **Structural/plumbing kinds** (`doc-order`, `renderer`, `home-layout`,
   `cell`) — "what role this fact plays in a *surface's* machinery." Not content
   at all; routing/layout metadata that happens to live in facts.
3. **System namespaces** done by *key prefix*, not type at all (`_actions/`,
   `_views/`, `_renderers/`, `_canvas/`, `tending/`) — `attention()` literally
   excludes `_`-prefixed keys (`state.ts:961`).

That's the embarrassing detail amplified: **`type` is doing the job of at least
two orthogonal axes (content-class vs surface-role) plus a third (key-prefix
namespacing) that lives somewhere else entirely.** A consumer cannot tell from
`type` alone whether a fact is knowledge, plumbing, or a vocabulary declaration.

---

## 3. Tensions / overlaps / gaps

### 3.1 `type` is overloaded — and collides with JSON-Schema `type`
The grep is brutal: 100+ of the `type: '...'` hits in `cells/` are **JSON-Schema
`type: 'string'`**, not fact-types. The single most-used word in the codebase
means two completely different things one indentation level apart
(`models/index.ts:621` schema-type vs `:269` fact-type). Naming a load-bearing
ontological axis `type` guarantees this collision forever.

### 3.2 `tag` vs `type` vs `key-prefix` — three overlapping classifiers
`type='doc'`, `tags=['doc']`, and key `doc:...` co-occur on the *same* fact
(`lit/client/main.tsx:109`). Three redundant ways to say "this is a doc," each
indexed/queried differently. `query` can filter by all three. Nobody has decided
which is authoritative.

### 3.3 `remember`/`recall` — the metaphor the system breaks
The verbs promise human memory. But:
- **`remember` is a hash-map `put`** (`state.ts:736`), last-writer-wins with CAS.
  Human memory doesn't take an `ifRevision`.
- **`recall` returns the *whole slice*** salience-shaped (`handlers.ts:501`).
  Human recall is associative and cued; this is "dump everything, dimmed."
- **Nothing forgets.** `superseded` hides; `timer:'delete'` is the *only* actual
  forgetting, and it's a lease GC, not memory decay. Salience *dims* but the fact
  is immortal. A memory model whose defining feature is that it never forgets is
  misnamed.

### 3.4 `superseded` is a verb-as-adjective doing two jobs
`superseded: true, supersededBy: null` = "retired, dead-end." `supersededBy: K`
= "retired toward K." These are arguably *retracted* vs *replaced* — one boolean
+ pointer conflates retraction, replacement, and (via revive-on-write)
un-retraction. `migrateLinks` only works on the second meaning.

### 3.5 `_meta.salience` lives inside `_meta` but is not metadata
`score`/`velocity`/`standing`/`centrality` are **computed at read time from the
trajectory** (`state.ts:664-703`) — they are a *view*, not provenance. Bundling
ephemeral attention scores into the same `_meta` envelope as immutable
`createdAt`/`writer` invites callers to treat a read-time opinion as a stored
fact. Embarrassing detail: `_meta` is half-truth, half-opinion, undeclared.

### 3.6 `fact` is the grandest possible word for "row"
A "fact" here is mutable (revision bumps), retractable (supersede), and revivable.
Logicians' facts are none of those. The word claims an epistemics the storage
doesn't provide. (See §5 — this one is *defensible*, but worth naming.)

### 3.7 Gaps
- **No content/role distinction in the type axis** (§2) — there is no `kind` vs
  `class` separation; `agent-run`, `home-layout`, `doc` share one field.
- **No fact-of-fact / annotation type** — provenance about provenance (who
  decided this `decision`?) has nowhere to go but a new opaque fact + edge.
- **No declared *value* schema per type.** `$types` declares how to *open/render*
  a type, never what its `value` shape is. `value` is forever `unknown`
  (`state.ts:175`). The type vocabulary describes presentation, not data.

---

## 4. Bold reframings (worst impulses) — and which survive

### Impulse A — Kill the word `type`. Split it into `kind` + `role`.
**Proposal:** `kind` = content-class (`doc`, `note`, `reading`); `role` =
surface-machinery (`layout`, `renderer`, `vocabulary`, `pointer`). Plumbing
stops polluting the knowledge ontology, and the JSON-Schema-`type` collision
(§3.1) dies.
**Verdict: SURVIVES.** This is the secretly-right one. Even a soft convention
(`role`-bearing facts always live under `_`) would let `attention()` stop its
`startsWith('_')` hack and reason structurally.

### Impulse B — Rename `remember`/`recall` to `write`/`read` (or `assert`/`observe`).
**Proposal:** drop the memory metaphor entirely; the substrate doc *already*
speaks Σ-calculus `write`/`observe` (`substrate.md:100-106`). `assert`/`retract`/
`observe` would be honest about the (non-)epistemics.
**Verdict: PARTIALLY survives.** `write`/`read` collide with the *gateway* verbs
(`read`/`act` are the three-verb spine). But `recall`→ something is right:
`recall` is a misnomer for "dump the shaped slice." Rename `recall`→**`view`** or
**`slice`** and keep `remember` as the warm front-door alias. (Note `view` is
taken by registered-views — see Impulse F.)

### Impulse C — `superseded` → `retracted` + `replacedBy`.
**Proposal:** separate retraction (`retracted: bool`) from replacement
(`replacedBy: key|null`), so the two §3.4 meanings stop sharing a boolean.
**Verdict: SURVIVES, low-cost.** A pure rename + field-split; `migrateLinks`
becomes "only when `replacedBy` is set," which is clearer than today.

### Impulse D — Hoist `salience` out of `_meta` into a sibling `_view` envelope.
**Proposal:** `{value, _meta, _view}` where `_view` holds the read-time
score/tier/lens. Provenance stays immutable in `_meta`; opinion lives in `_view`.
**Verdict: SURVIVES conceptually, defer in practice.** The honesty is real
(§3.5) but the churn touches every consumer. Worth it at the next `_meta` break;
until then, document loudly that `_meta.score` is a read-time view.

### Impulse E — Abolish `tag`. Tags are degenerate edges to tag-nodes.
**Proposal:** `substrate-storage.md:82` already says tags-as-edges gives implicit
links "for free." So delete the `tags[]` field; `tag('indexable')` becomes
`link(fact, 'tagged', 'tag:indexable')`. One classifier (edges), not three (§3.2).
**Verdict: TOO FAR — but directionally right.** Collapsing tag into the graph is
elegant and kills redundancy, but tags are hot-path `query` filters; making every
tag a 2-hop traversal regresses the most common read. Keep `tag` as a *projection*
of tag-edges (materialized), not as a separate truth. The redundancy with `type`
and key-prefix (§3.2), though, *must* be adjudicated: pick `type` as canonical,
demote the rest to derived.

### Impulse F — Rename `fact` to `note`, and `workspace` to `notebook`.
**Proposal:** maximally irreverent — stop pretending to be a logic substrate;
it's a personal notebook of mutable notes.
**Verdict: DIES.** `fact` overclaims (§3.6), but `note` *under*claims: edges,
actions, views, leases, and agent-runs are not notes. `fact` earns its keep as
the one word general enough to cover "any located datum." Keep it.

### Impulse G — Make `view` mean one thing.
Today `view` is (a) a registered projection (`_views/<id>`), (b) the verb to
evaluate one, and (c) the natural rename target for `recall`. Three claims on one
short word. **Verdict: pick.** Reserve `view` for the declared-projection noun;
rename the *evaluate* verb to `evaluate`/`render`, and rename `recall`→`slice`.

---

## 5. Top 3 concrete recommendations

1. **Split the overloaded `type` axis into `kind` (content-class) + `role`
   (surface-machinery), and pick one canonical classifier.** (Impulses A + E.)
   This is the highest-leverage fix: it untangles `doc`/`note` (knowledge) from
   `home-layout`/`renderer`/`cell` (plumbing), lets `attention()` drop its
   `startsWith('_')` heuristic (`state.ts:961`), ends the JSON-Schema-`type`
   collision, and forces a decision on `type` vs `tag` vs key-prefix redundancy
   (§3.2). Start as a documented convention (`role` facts live under `_`), harden
   into a field when the next `_meta`/`StateRecord` break lands.

2. **Separate `superseded` into `retracted` + `replacedBy` and document
   `_meta.salience` as a read-time view (not stored provenance).** (Impulses C +
   D.) Both are honesty fixes the model is one rename away from. The supersede
   split clarifies `migrateLinks` and the revive-on-write semantics; flagging
   salience as opinion (ideally hoisted to a `_view` sibling later) stops callers
   from persisting or trusting an ephemeral score as if it were `createdAt`.

3. **Keep `fact` and `remember`, but rename `recall`→`slice` (or `view`-the-noun
   discipline) and stop the verb collisions.** (Impulses B, F, G.) `fact` and the
   warm `remember` front-door earn their metaphor; `recall` does not — it returns
   the whole shaped slice, which is the opposite of cued recall. Reserve `view`
   for the declared-projection noun, rename its *evaluate* verb, and rename
   `recall` to something that says "shaped slice of everything." This costs almost
   nothing and removes the system's most actively misleading name.

> **Net:** the ontology's bones are good — `{value, _meta}`, supersede-not-delete,
> read-time salience, first-class edges. The embarrassment is cosmetic-but-deep:
> one word (`type`) carries three jobs, one metaphor (`recall`) lies about its
> behavior, and `_meta` mixes fact with opinion. None of the radical demolitions
> (kill `fact`, tags-as-edges-only, drop the memory verbs) survive scrutiny — but
> their *milder cousins* (split `type`, rename `recall`, separate retraction) all
> do, and they're cheap.
