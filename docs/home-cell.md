# Home — the browser read/act client

A redesign of the `home` cell for the platform as it now is. `home` predates the
surface it should be built on; this doc states what it becomes and how to get
there in phases.

## What `home` is today

- An **SPA shell**: `services/home/service.ts` serves an HTML shell + `app.js`
  (built from `client/main.tsx`), and is the router's default (`/`).
- A **bespoke `/_catalog`**: merges the static `PLATFORM_CATALOG` manifests with
  the caller's dynamic cells (`forge.catalogCells`), scoped to owner+granted.
- First-party **passkey sign-in** (`client/auth.ts`).

It was the right shape when "discovery" meant a hand-rolled HTTP endpoint.

## Why revisit

The platform moved underneath it:

- **`read("$catalog")` now exists** at the gateway — home's `/_catalog` is a
  *parallel, hand-rolled* discovery surface. Duplication.
- **The substrate (`workspace`)** is real — home should be the *human window* over
  `recall` / facts / salience.
- **Dynamic cells + S3 authoring (`cells.*`)** — home should be a *console*:
  list / edit files / deploy / tail logs.
- **Coming: registered views + rooms** (see `sync-learnings.md`) — dashboards that
  are *views with render hints*, not hardcoded screens.

## Thesis: home = the browser read/act client + a view renderer

The same surface MCP clients use, in a browser:

```
passkey auth  →  read("$catalog")  →  read(...) / act(...)  →  render views
```

Home authenticates, **discovers via `read("$catalog")`** (no bespoke catalog),
interacts via `read`/`act`, and **renders registered views as surfaces** (sync's
`render` hints: `metric` / `table` / `feed` / `form` / `markdown` / …). The UI is
*generated from the registry*, not hardcoded — so four things fall out of **one**
mechanism:

- **Workspace window** — render `workspace.recall` / `workspace.peek` (the
  substrate, salience-shaped).
- **Cells console** — `cells.list` / `cells.readFile` / `cells.writeFile` /
  `cells.deploy` / `cells.logs` (author + ship cells from the browser).
- **Dashboards** — registered views with `render` hints (sync's "the dashboard is
  a view query"), per room/slice.
- **Auth / identity shell** — `whoami`, sign-in, scope elevation.

`/_catalog` retires into `read("$catalog")`; `home` becomes a thin, generic client
over the same vocabulary everything else speaks.

## Dependency & phasing

The full version is **gated on the views primitive** (registered CEL views +
render hints — Gap 1 in `substrate-gaps.md` / the `sync-learnings.md` menu). So
phase it, shipping value before that lands:

- **Phase 0 — capability palette (shipped, additive).** The SPA calls
  `read("$catalog")` via `/mcp` (using the same `authFetch`/bearer it already uses
  for `/mcp/whoami`) and renders a **Capabilities** card grouped by cell — home is
  now a real read/act client. Done *additively*: the bespoke `/_catalog`
  (`Catalog`/`MyCells`) is **retained** for now; retiring it (the capability
  catalog subsumes the cell directory — a "cell" is just a namespace in
  `$catalog`) is a fast-follow once the palette is confirmed in the live UI.
- **Phase 1 — workspace window (read-only).** Render `workspace.recall` as the
  default surface (focus/peripheral/elided tiers, expand). Pure `read`.
- **Phase 2 — cells console (`act`).** File tree + editor + deploy + logs over
  `cells.*`. The "val.town on AWS" authoring UI in the browser.
- **Phase 3 — the generic view renderer.** Once registered views + render hints
  exist, draw any view by its hint; dashboards/surfaces come from the registry,
  not code. This is where `home` stops being hand-written screens.

## Naming

`home` is **infrastructure** (its name never appears in a read/act `target`), so
the question is its **role, not its name**. If we tidy later, `web` / `app` /
`console` are fair candidates — not urgent.

## Open questions

- **Render-hint → component mapping.** Define the surface-type vocabulary
  (`metric`/`table`/`feed`/`form`/…) and the React components once, shared via
  `platform/ui`.
- **SSR vs SPA.** Today it's an SPA shell; a read/act client is naturally
  client-rendered, but the first paint (identity + catalog) could be server-shaped.
- **Per-room vs per-slice surfaces.** If rooms land (`sync-learnings.md`), the
  dashboard is per-room; today it's per-user-slice.
- **Offline/caching.** read/act over the network per interaction — decide a cache
  story for the substrate window.
