# ADR-0092 — Cross-slice public embedding & indexing: semantic layout and search for shared/public views

- **Status:** Accepted 2026-07-22 — Inc 1 + Inc 2 implemented (as amended
  below: owner-scoped lookup, coords-only `.pub`, stream-driven refresh), plus
  the A4 short-term search-coverage fix. Inc 3's `PUBLIC_INDEX` endgame and
  Inc 4 (shared public basis) remain open. Successor problem opened by
  ADR-0091's "known gap".
- **Depends on:** ADR-0091 (the public read path + the `owner/key` grant fold
  across query/peek/edges), ADR-0030 (semantic search over S3 Vectors — the
  per-scope vector index + `workspace.search`/`query{text}` relevance), ADR-0047
  (the semantic 2D layout `_home/embed2d` + `workspace.project` basis + the
  vector-indexer's incremental refresh), the grant axis (ADR-0007), and the
  live DDB-stream vector indexer (`services/vector-indexer`).
- **Grounded in:** deploying the `@guest` public read path (ADR-0091). Nodes,
  links, and bodies now fold across grants and line up on `owner/key`, so the
  signed-out graph renders — but its **positions** do not. `_home/embed2d` is
  per-scope, keyed by **bare** fact keys, and computed over the **whole** slice,
  so it is unreadable by `@guest`, unsafe to share as-is, and mis-keyed against
  folded nodes. Guest falls back to connectivity layout. The same gap applies to
  *any* viewer of a shared slice, and to *semantic search* over public facts —
  so this is the general "make the derived/semantic layer grant-aware" problem,
  not a home-only cosmetic.

---

## Context

Two derived, semantic artifacts sit beside the substrate, both **per-scope** and
both computed over the owner's **whole** slice:

1. **The vector index** (ADR-0030) — `indexForScope(scope)` in S3 Vectors; feeds
   `query{text}` / `search` relevance. ADR-0091's `query` fold already computes
   **per-owner relevance** in the fan-out (`relevanceFor(vectors, owner, text)`),
   so semantic search across grants *mostly works today* — the workspace service
   reads each granted owner's index server-side. But it fans out per owner, and
   nothing filters a granted owner's index hits to the viewer's covered keys
   before ranking (coverage is applied after, on the folded entries).

2. **The 2D semantic layout** — `_home/embed2d` (+ sharded `_home/embed2d/s<N>`),
   a `{ bareKey: [x,y] }` coordMap the vector-indexer refreshes incrementally
   against a basis fixed by `workspace.project` (ADR-0047). The graph reads it via
   `peek`/`query` and seats each node at `coordMap[node.id]`, else a deterministic
   fib-sphere fallback.

Three properties make both hostile to cross-slice reads:

- **Privacy** — the coordMap (and the index) contain an entry for *every* fact,
  including private ones. Sharing `_home/embed2d` wholesale leaks **private fact
  key names** (the coordinates are harmless; the keys are not). The index is
  worse: hits carry content.
- **Keyspace** — artifacts are keyed **bare** (`doc:x`) in the owner's namespace,
  but a folded node is `owner/doc:x`. Lookups miss.
- **Basis** — each owner's 2D projection lives in its **own** learned basis
  (`project` fits per scope). Two owners' coordMaps are not comparable, so a
  multi-owner public view cannot simply concatenate coordMaps into one
  meaning-space.

## Problem statement

Give a viewer **semantic positions and semantic search for the facts granted to
them** (public being the common case) such that:

- no artifact served to a non-owner ever contains a **key that isn't granted** to
  that viewer (the privacy boundary of ADR-0091, applied to derived data);
- positions **key-match** folded nodes (`owner/key`);
- across multiple owners' public facts, positions share **one meaning-space** (so
  the public sky is a single constellation field, not per-owner islands);
- the cost is bounded (no whole-index fan-out per read).

## Forces

- **Precompute vs filter-at-read.** A per-audience precomputed artifact (e.g. a
  public projection) is cheap to read but must be refreshed and is one-per-audience;
  filtering the owner's full artifact at read time is always-correct but leaks
  nothing only if the filter is trusted and runs server-side (never ship the full
  artifact to the client).
- **Per-owner islands vs a shared basis.** Per-owner sub-layouts are easy and
  privacy-clean but give the multi-owner public view disjoint clusters; a shared
  global basis is the honest "one substrate" layout but introduces a cross-owner
  aggregate that must be access-controlled to public-only.
- **Public is special but not unique.** The same mechanism should serve "a slice
  shared to user B" and "a group audience", not just `public` — else every new
  audience needs bespoke plumbing.

## Decision (proposed — increments, smallest safe first)

**Inc 1 — Client key remap (cheap, ready now, no privacy surface).**
When looking up `coordMap[node.id]` for a folded node, also try the
`owner/`-stripped key. Harmless on its own (still no data for guest), but it makes
every later increment "just work" the moment a grant-covered coordMap exists. Ship
independently.

**Inc 2 — Per-owner PUBLIC projection (`_home/embed2d.pub`).**
The vector-indexer / `project` writes a second coordMap containing **only the
owner's `_public/`-covered keys**, in the owner's existing basis. It is safe to
expose (no private key present), reflected/served like other public reads (folds
as a public fact, or shared to `public`). Guest seats grant-covered nodes from it
(via Inc 1's key strip); everything else keeps the fib-sphere fallback. This
gives a **single-owner public sky its real semantic layout** without a private
leak, and generalizes to per-audience projections if needed (public first).

**Inc 3 — Grant-aware index coverage for search.**
Formalize what ADR-0091's `query` fold does ad hoc: when folding a granted owner's
`text` hits, filter the index candidates to the viewer's **covered keys** *before*
ranking (not only after), and bound the per-owner fan-out. Consider a
`shouldIndex`-style public predicate so a **public index view** can answer guest
search without per-owner fan-out at all.

**Inc 4 — The shared public basis (the multi-tenant core; needs a decision).**
For a public sky spanning multiple owners, positions must share one basis. Two
candidate shapes, to be chosen when multi-owner public is real:
  - **(a) A platform public projection** — a single index + `project` basis over
    the union of all `_public/` facts across owners, written as a platform-level
    `embed2d.pub`. One meaning-space; one artifact; must by construction contain
    only public keys. This is the "public substrate index" — clean for viewers,
    but a new cross-owner aggregate to own and access-control.
  - **(b) Per-owner sub-layouts stitched** — keep per-owner public projections and
    place each owner's constellation in a meta-layout (owner as a super-node).
    No cross-owner aggregate, but the meaning-space is per-owner, not global.

Recommended path: **Inc 1 + Inc 2** solve the immediate single-owner public sky
safely and are low-risk; **Inc 3** tightens search coverage; **Inc 4(a)** is the
eventual multi-tenant answer but is deferred until a second public owner exists,
because it introduces the one genuinely new thing here — a **cross-owner public
aggregate** — which deserves its own scrutiny (who writes it, where it lives, how
"only public" is guaranteed and audited).

## The invariant (carried from ADR-0091 to derived data)

**No artifact served to a non-owner may contain a key that isn't granted to that
viewer.** Every increment above is a way to honor it for *derived* data: the
public projection is filtered to `_public/` at write time; the index fold filters
to covered keys at read time; the shared basis (Inc 4a) is built over `_public/`
only. A private key must never appear in a coordMap, an index hit, or a basis
served to anyone but the owner.

## Consequences

- The public/shared sky gains **semantic** layout, not just connectivity — the
  meaning-space that makes the graph worth exploring.
- Search over public facts becomes first-class for `@guest` (and any grantee),
  with coverage enforced in the index fold, not only post-hoc.
- A new artifact class — **audience-scoped derived data** (`*.pub`, or a platform
  public aggregate) — enters the model; it must ride the same `_public/` boundary
  as raw facts, and refresh with them (stream-driven, like the vector indexer).

## Amendments (2026-07-22, pre-implementation review — multi-user sprint)

A second review pass, grounded line-by-line in the implementations, made four
corrections before code. They amend the increments above; where they conflict,
the amendment wins.

**A1 — Inc 1 is owner-scoped lookup, not a flat key strip.** The proposed
`coordMap[strip(node.id)]` fallback has a mis-seat hazard for an *authenticated*
viewer with grants: the client loads the viewer's OWN layout, the stripped
foreign key (`c15r/file/docs/x.md` → `file/docs/x.md`) can collide with an
unrelated own fact of that name, and the foreign node seats at a meaningless
position in the viewer's basis. And with multiple public owners (this sprint),
two owners' coordMaps are in incomparable bases and collide on bare keys, so a
flat merged map is wrong twice over. The client instead keeps **per-owner
maps**: a folded node `owner/key` is seated ONLY from that owner's public map
under the bare key; own-slice nodes only from the own map. Per-owner
constellations render as islands — Inc 4(b)-lite, the honest interim — and
Inc 4(a) later becomes "swap the map source", not a re-key.

**A2 — `_home/embed2d.pub` is coords-only (no basis/norm).** The coords are in
the owner's basis, fine — but the basis itself (corpus mean + principal axes)
is fit over the WHOLE slice including private facts: a statistical artifact of
private content. Viewers never project new vectors, so `.pub` carries only
`{ patterns, coords, count, generatedAt }`. This extends the invariant from
keys to derived aggregates at zero cost. (`patterns` — the `_public/` share
patterns the artifact was filtered by — are world-readable by definition and
let the incremental patcher test coverage without a slice scan.)

**A3 — Refresh is stream-driven; the trigger already exists.** `_public/<pattern>`
reflections are ordinary facts, so share/unshare flows through the DDB stream
the vector-indexer already consumes (it currently no-ops on them —
`indexableText` skips `_` keys). Two lanes: a `_public/` write/supersede →
**wholesale rebuild** of `.pub` from the existing layout shards + current
patterns (no re-projection — the coords already exist); a covered regular fact
write → **incremental patch** beside the existing `patchProjection`, projecting
on the persisted basis. Batch `project` also writes `.pub` (the replay path)
and performs the one-time `share {to:"public"}` of the artifact. Stated
honestly: **unshare → removal from `.pub` is eventually consistent** (a
retracted key name lingers until the stream batch lands — bounded seconds).

**A4 — Inc 3's real defect is topK starvation, not membership.** Coverage is
already enforced on the folded entries (`grantCovers` post-filter); nothing
leaks. But `relevanceFor` takes the granted owner's index top-K (200) over the
WHOLE slice, so an owner with 8 public facts among 3,000 yields a top-K
dominated by private hits — the covered facts score relevance 0 and rank as if
irrelevant. Short-term fix (this sprint): for granted-owner queries, widen the
top-K and filter candidates to the viewer's covered keys BEFORE building the
relevance map. The endgame is the dormant `PUBLIC_INDEX` seam (ADR-0030 §2a) —
a real public-only index — decided when guest search quality is measurably
inadequate, not preemptively.

**Serving `.pub` (resolves the "where does it live" question):** the owner
shares it once — `share {to:"public", key:"_home/embed2d.pub"}` (done by
`project` when public patterns exist). The client fetches it per-owner through
**peek's existing `owner/key` addressing** (`peek {key:"<owner>/_home/embed2d.pub"}`
resolves through the grant fold today, unmodified), discovering granting owners
from `workspace.shared`'s `receiving` list. No new read plumbing. The folded
`.pub`/`_public/` reflection facts must stay out of the node band client-side
(the plumbing filter learns the folded `owner/_…` spelling).

## Open questions

- **Refresh & churn.** A per-owner `embed2d.pub` must refresh when the public set
  changes (share/unshare, new public doc). Incremental (indexer stream) or batch
  (`project`)? What re-fits the basis, and how often?
- **Filter-at-read for the index.** Can the granted-owner index query pass a key
  allow-list (the viewer's covered keys) into S3 Vectors, or must coverage stay a
  post-filter? The former bounds cost and tightens the boundary.
- **Where the public aggregate lives (Inc 4a).** A platform slice? A dedicated
  `@public`/system principal's slice built by a reactor over `_public/` writes?
  How is "only public" guaranteed structurally, not by discipline?
- **Audience generality.** Precompute `*.pub` only for `public`, or a projection
  per named audience/group? Precompute the common case, filter-at-read the rest?
- **Does this converge with the self-model?** `$graph`/`$grants` already project
  the authority-shaped view; a grant-aware semantic layer may be the same idea
  extended to the derived (embedding) plane.
