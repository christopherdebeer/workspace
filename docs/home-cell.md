# Home — the platform's face and the signed-in window over your substrate

A redesign of the `home` cell, revised (2026-06) now that phases 0–1 shipped
and the grants work ([`scope-grants.md`](./scope-grants.md)) gives it a second
job. `home` predates the surface it should be built on; this doc states what it
becomes and how to get there in phases.

## What `home` is today

- An **SPA shell**: `services/home/service.ts` serves an HTML shell + `app.js`
  (built from `client/main.tsx`), and is the router's default (`/`).
- A **browser read/act client** (phases 0–1, shipped): passkey/OAuth sign-in
  (`client/auth.ts` — PKCE, transparent refresh, revoke-on-logout), then
  `read("$catalog")` rendered as an invokable capability palette — one
  `mcpCall(verb, target, input)` helper drives the same vocabulary an agent
  speaks. The bespoke `/_catalog` is retired.

What it is **not** yet: a landing page that explains anything to a signed-out
visitor, a legible window over the signed-in user's substrate (the console
shows *capabilities*, not *state*), or any identity surface beyond a scopes
chip and a sign-out button.

## The rethink: home has two faces

`home` is simultaneously the **platform's public face** and the **signed-in
user's view over their substrate**. The earlier draft designed only the second
face; both need stating, because they are different audiences with different
first paints:

### Face 1 — signed out: what parc.land is

The anonymous default route is the system's front door, currently a blank
console with a sign-in button. It should carry:

- **One screen of narrative** — what the substrate is (facts, cells, the three
  verbs), in the voice the MCP `instructions` already use
  (`mcp-spec-alignment.md`): the same self-introduction, human-rendered.
- **Sign in / register** — the passkey ceremony, already built; make it the
  obvious action rather than a corner button.
- **The public surface** — cells with `public: true` are already
  anonymously readable (GET/HEAD through dispatch); the landing can list them
  as the visible proof the platform is alive. Anonymous `read("$catalog")`
  returning the public subset is the mechanism (scope-filtered advertising
  already exists; anonymous is just the empty-scope caller).

This face is naturally **server-shaped** — it is identical for everyone and is
the first paint that matters; it resolves the doc's old SSR-vs-SPA question by
splitting it (static-ish landing, hydrated console).

### Face 2 — signed in: your substrate, salience-shaped

The thesis: the same surface MCP clients use, in a browser —

```
passkey auth → read("$catalog") → read(...) / act(...) → render views
```

— but *organised around the user's state, not the tool list*. The console
(palette + JSON args) stays as the power-user floor; above it, four
purpose-built surfaces, each a rendering of targets that already exist:

- **Workspace window** — `workspace.query`/`recall` rendered as
  focus/peripheral tiers with expand-from-elision (the affordance canvas got
  and the MCP projection got via compact stubs; home is the third renderer of
  the same shaping). Attention strip on top: `workspace.attention`, now
  namespace-aware.
- **Identity & grants shell** — the human projection of the
  [`scope-grants.md`](./scope-grants.md) vocabulary: who am I (`whoami`),
  active credentials (`auth.tokens`, revoke/label/mint), what I've shared and
  what's shared with me (`grants.list`, revoke), the **grant-request inbox**
  (`grants.requests`, approve/deny), and the scope-elevation entry (the
  re-consent URL when the token, not the grant, is the ceiling). Every row is
  an `mcpCall` the console can already make.
- **Cells console** — `cells.list` / `readFile` / `writeFile` / `deploy` /
  `logs`: author and ship cells from the browser (the file-tree + editor
  surface).
- **Dashboards** — registered views with `render` hints (`metric` / `table` /
  `feed` / `form` / `markdown` / …), drawn generically from the registry.

## Dependency & phasing

Only the *last* surface is gated on the views/render-hints primitive
(Gap 1 lineage in `substrate-gaps.md` / `sync-learnings.md`). The identity
shell is gated on the grants targets, not on views — so it advances ahead of
the old Phase 2/3 ordering:

- **Phase 0 — capability palette** *(shipped)*: `$catalog` via `/mcp`,
  rendered grouped by cell.
- **Phase 1 — interactive read/act console** *(shipped)*: every capability
  invokable; `/_catalog`, `PLATFORM_CATALOG`, and home's `allow()` grants
  retired.
- **Phase 2a — identity & grants shell** *(shipped, same day)*: one card
  rendering `auth.tokens` (revoke), `workspace.shared` given/received
  (revoke), and the `workspace.grantRequests` inbox (approve/deny) + request
  answers — the human end of the agent escalation loop, every row an
  `mcpCall` the console could already make. Still to come here: minting a
  narrow token from the UI, and the scope-elevation (re-consent) entry.
- **Phase 2b — the landing face** *(shipped, first cut)*: the anonymous route
  now renders the narrative card (the MCP `instructions` voice,
  human-rendered: facts/provenance/salience, the three verbs, grants) with the
  passkey door as the primary action; the signed-in console renders past it.
  Still open: the **public-cells directory** — anonymous `$catalog` is blocked
  at the MCP layer today (401 before dispatch), so listing `public: true`
  cells needs either an anonymous-catalog gateway path or a small public
  endpoint; and the first paint is still client-rendered (the SSR half of the
  original question).
- **Phase 2c — workspace window + cells console** *(shipped, first cut)*: the
  workspace window renders `workspace.attention` as a strip (the just-in-time
  cron at a glance) over the top of the slice by salience
  (`workspace.query`), titled/routed through the `_types` vocabulary; the
  cells console lists owned cells (`cells.list`) with status, the live
  address, and on-demand `cells.logs`. Still open: the file tree + editor +
  deploy surface (authoring stays in the generic capabilities console), and
  expand-from-elision on the window (query top-N stands in for tiered
  recall).
- **Phase 3 — the layout comes from the registry, not code** *(shipped, first
  cut)*: home renders from a **`_home/layout` fact** in the signed-in slice —
  an ordered list of sections — falling back to the default order when absent.
  Sections are the built-in surfaces (greeting / stats / capture / workspace /
  activity / identity / views / cells / console) plus custom ones: a pinned
  **board** (`{type:'view', id}` → `ViewSurface`), a single **fact**
  (`{type:'fact', key}` → rendered + opened through the type vocabulary), or an
  ad-hoc **query** (`{type:'query', query, title}`). A **Customise** mode does
  per-section reorder + hide, persisted back to `_home/layout` — *"make your
  own home over time"* is data, not a fork. Each rendered fact gets its
  open path from the type-vocabulary resolver (`docs/type-vocabulary.md`), so
  home hardcodes no cells. An **Add-section** picker (in Customise mode) pins a
  board, a fact (by key), or an ad-hoc query from the page — and custom
  sections can be removed. Still open: richer section types as the
  view/render-hint vocabulary grows, and a sharer (pin someone's board/view
  into your home, once cross-slice grants make it natural).

## Naming

`home` is **infrastructure** (its name never appears in a read/act `target`),
so the question is its role, not its name. With the landing face it leans
further toward `web` / `app`; still not urgent.

## Open questions

- **Render-hint → component mapping.** Define the surface-type vocabulary
  (`metric`/`table`/`feed`/`form`/…) and the React components once, shared via
  `platform/ui` — the identity shell and workspace window should be written
  *as if* they were renderings of views, to ease Phase 3.
- **Anonymous catalog.** Confirm the empty-scope `$catalog` read returns
  exactly the public subset and nothing else before the landing advertises it.
- **Per-room vs per-slice surfaces.** If rooms land (`sync-learnings.md` H),
  the dashboard is per-room; today it's per-user-slice.
- **Offline/caching.** read/act over the network per interaction — decide a
  cache story for the workspace window (the change feed (`sinceSeq:"head"`)
  is the invalidation signal).
