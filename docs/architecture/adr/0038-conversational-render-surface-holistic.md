# ADR-0038 — The conversational render surface, holistically: coverage, graph mode, links, docs, escalation

- **Status:** Accepted — **Inc 1 (coverage) shipped.** The card now has structured render branches for
  `graph`/`links` (mermaid node-link diagram, authored solid / derived dashed, capped 50), `attention`
  (stale/unlinked/dangling triage with drills), `grantRequests` (incoming inbox with approve/deny acts +
  answers), `changes` (event feed), `grants` (`$grants` authority surface), `members` (assembled entry cards),
  and `view` (evaluated value by its render hint). A **generic structured fallback** (`genericStructured`)
  renders any remaining array-bearing shape (`actions`/`views`/`subscriptions`/`groups`/`shared`/`$catalog`/
  `$types`) as capped list sections + fields instead of a raw-JSON `<pre>` — which now appears only as a true
  last resort.
- **Status (Inc 2–6 shipped, 2026-06-27):** **Inc 5** — `enforceScope`'s teaching denial is parsed from the
  tool-call `isError` text into an action panel: `scope_offer` → a **"widen session"** tap (`act
  auth.requestScope`, no passkey) → auto-retry; `scope_denied` → **"escalate (passkey)"** → `openLink` the
  elevation URL → **retry**; both notify the agent (ADR-0037). **Inc 3** — a wiki-link `marked` extension
  (mirroring lit's resolver) renders `[[target]]` → an in-card link; clicks on wiki/substrate links peek in
  place (host-proxied), external links go via `openLink`; single facts lazily show **"Linked from"**
  (inbound `neighbors`). **Inc 2** — a **"view as graph"** toggle on any fact list builds a mermaid node-link
  graph of the result set's edges + one-hop neighbours (`workspace.links`, filtered). **Inc 4** — a `doc:` /
  `doc`-typed fact lazily assembles its ordered `members` as blocks below the metadata. **Inc 6** — ranked
  results show a **similarity/salience bar**, the degraded-search `hint` is surfaced, and array entries
  (search) are keyed by their real fact key (fixing the array-index mis-key). D3 force layout (vs mermaid)
  remains the one deferred follow-up.
- **Status (orig):** Proposed. A holistic audit of the MCP-Apps card (`services/gateway/client/main.ts`) against the
  *whole* read/act surface — not the happy-path subset the 2026-06-27 validation exercised. Names the systemic
  gap (most reads dump raw JSON), the nuance gaps (search-as-cards vs graph, dead links, thin docs, plain-text
  escalation), and proposes prioritized increments.
- **Date:** 2026-06-27
- **Depends on:** ADR-0034/0035/0036 (the card, the shared render core, progressive widgets), ADR-0037
  (widget→agent feedback), ADR-0023 (granular scopes + escalation), ADR-0005/0014 (collections / doc assembly).

---

## The systemic finding: the card covers ~⅓ of the surface

The card has dedicated render branches for **7** result shapes — `recall`, `peek`, `query`, `search`,
`neighbors`, `suggestions`, `whoami`. **~15 read targets fall through to the raw-JSON `<pre>` dump:**

| Cluster | Targets that currently dump JSON |
|---|---|
| **Graph / edges** | `graph` (`$graph`), `links` |
| **Inbox / triage** | `attention` (stale/unlinked/dangling), `grantRequests` (incoming/answers), `changes` (event stream) |
| **Registries / lists** | `actions`, `views` + `view`, `subscriptions`, `groups`, `shared` |
| **Authority / self-model** | `grants` (`$grants`), `$catalog`, `$types` |
| **Collections** | `members` (detection bug: `render()` checks `d.entries` (object) but `members` returns a `members[]` array) |

The validation looked complete because it tested the 7 that work. Holistically, the card is a *partial* surface.

## The nuance gaps (within and across the working surfaces)

1. **Search = query, visually.** `search` returns similarity-ranked `{entries[], score}` (cosine 0–1) but renders
   identically to `query` — score is a bare number, no visual encoding, no "why it matched", and the degraded-
   backend `hint` is dropped. There is **no way to see the result set as a shape** — only a card list.
2. **No graph mode.** The user's ask — *"a detail-less force-directed graph of returned data, including authored
   edges and next neighbours"* — has no surface today. `graph`/`links` dump JSON. Yet a **deterministic D3 force
   layout already exists** (`cells/canvas/client/lib/network/storage.ts`: `forceLink`/`forceManyBody`/
   `forceCollide`, 180-tick settle), coupled to the canvas DOM.
3. **Links are dead in the card.** Wiki-links (`[[target]]`) are a **first-class, graph-backed feature in the
   lit cell** (`cells/lit/shared.tsx`: a `marked` inline extension → `<a class="wikilink">`; on save
   `syncCellLinks` writes real `related` edges; backlinks rendered from inbound `neighbors`). In the card:
   `[[x]]` renders as literal text (no extension), and ordinary markdown `[text](url)` links use **default
   browser nav** (exit the sandbox) instead of host-proxied in-card navigation. Backlinks aren't surfaced.
4. **Docs render thin.** A `doc:<id>` fact is *thin metadata* (`{title, summary}`); the document **is** its
   ordered `doc-block` members assembled via `workspace.members` (`seq`/`fold`, ADR-0005/0014). `peek`-ing a doc
   in the card shows the metadata stub, not the assembled narrative — lit already does the assembly.
5. **Escalation is plain text.** `enforceScope` already distinguishes **allow / `scope_offer` (within ceiling —
   self-serve widen via `act auth.requestScope`, no re-consent) / `scope_denied` (outside ceiling — and it
   already builds an elevation URL `/oauth/authorize?scope=…&elevate=<tokenId>`)**. The card renders the whole
   thing as a `<pre>` error. The SDK gives us `openLink` (host-mediated nav) and `act` (the self-serve widen).

## Two binding mechanisms (recap, ADR-0034/0036)

- **Per-shape `_view` dispatch** for tool-result *structures* (inbox/registry/graph/escalation) — the
  generalization of the card's existing `overview`/`whoami`/`suggestions`/`neighbors` special-cases.
- **Per-type** rendering for *fact* values (docs, viewers) — by the type's affordance.

Both already exist; the work is widening coverage, not new architecture.

## Decision — prioritized increments

**Inc 1 — Kill the raw-JSON cliff (coverage).** Generic structured renderers so no read dumps JSON. Lead with the
highest operational value (ADR-0036 Tier 1): **`attention` triage** and **`grantRequests` inbox** (count
breakdown + drill + act), then **graph/links** (→ Inc 2), then the registry lists (`actions`/`views`/
`subscriptions`/`groups`/`shared`) and self-model reads (`$catalog`/`$types`/`grants`) as compact tables, and
**fix the `members` array detection**. A final `<pre>` stays only as a genuine last resort.

**Inc 2 — Graph mode.** A cards ↔ **graph** toggle on `search`/`query`/`graph`/`neighbors` results: render the
returned set as a node-link graph with **authored edges + one-hop neighbours** (host-proxied `neighbors`/`links`
to fetch the edges). Cheap first cut = **mermaid** (reuse the existing viewer, ~zero deps); rich follow-up =
extract the canvas D3 force layout into a `cells/viewers/graph` renderer (strength→edge width, derived→dashed,
salience→node size). This is the user's "detail-less force-directed graph" directly.

**Inc 3 — Link infrastructure (connective tissue).** (a) Register the lit wiki-link `marked` extension in the
card (extract it into a dep-free shared module beside `render-hints`) so `[[target]]` resolves; (b) **intercept
link clicks** (`wikilink` + ordinary `<a>` to substrate keys) → host-proxied `read`/navigate **in-card** instead
of dead browser nav; (c) surface **backlinks** ("linked from") on fact cards from inbound `neighbors`.

**Inc 4 — Lit docs in the card.** Render a `doc` fact as its **assembled ordered blocks** (`members` → `seq`
order → markdown), not the metadata stub — reuse lit's assembly logic. Glanceable (first N blocks) + expand.

**Inc 5 — Grant escalation UX.** Surface denials as structured `_meta` (`scope_required`, `scope_offer` vs
`scope_denied`, `elevateUrl`). For `scope_offer`: a one-tap **"widen session"** (`act auth.requestScope`, in
place, no passkey). For `scope_denied`: an **"escalate grant"** button → `openLink(elevateUrl)` → retry the
original call → `updateModelContext` (ADR-0037) tells the agent it happened.

**Inc 6 — Search nuance.** Visual similarity encoding (score bar/gradient), surface the degraded-backend `hint`,
and a search-specific header distinguishing semantic recall from filtered `query`.

## Recommended order

**1 → 5 → 3 → 2 → 4 → 6.** Inc 1 removes the embarrassing JSON dumps and lands the two real daily inboxes;
Inc 5 closes a concrete friction (a decision blocked mid-card today just shows an error); Inc 3 makes the graph
navigable by text, which Inc 2 then makes navigable visually; docs and search-nuance are refinements.

## Open questions

- **Graph mode default** — auto-graph above N results, or always opt-in via a toggle? Start opt-in.
- **Link interception scope** — only substrate-key links, or all links (with external → `openLink`)? Likely:
  in-card for `[[wiki]]`/substrate keys, `openLink` for external `http(s)`.
- **Shared wiki-link module** — extract lit's extension into `platform/ui` (dep-free, marked injected) so lit,
  home, and the card share one resolver — the same consolidation ADR-0035 did for `render-hints`.
- **D3 in the gateway bundle** — bundle size of `d3-force` in the inlined `app.js`; measure before committing to
  the rich graph renderer (mermaid first keeps it free).
