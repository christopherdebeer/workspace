# ADR-0020 — Path-param SSR & deep links (kill the hash)

- **Status:** Accepted (shipped + live). The dispatch tier serves path-scoped `ssr.json`, cells route
  on path segments, and the machine cell's deep links are path-form. Hash params are no longer the
  addressing scheme for a cell view.
- **Date:** 2026-06-25
- **Context:** Cell front-ends addressed state with hash params (`#view=…&id=…`). The hash never reaches
  the server, so a cell view could not be server-rendered for its actual target — first paint was a
  generic shell, deep links were opaque to the substrate's graph, and a shared URL carried no
  observable designation. ADR-0008's Cell-axis self-model and ADR-0017's shared substrate client gave
  cells real read access at the edge; nothing yet used it to render *the addressed thing* on the server.
- **Depends on:** ADR-0008 (Cell axis — `read("$cells")`), ADR-0017 (shared cell substrate client),
  ADR-0019 (machine decomposed graph — the first cell with per-node addressable deep links).

---

## Decisions

### 1. Path is the addressing scheme; hash is at most ephemeral UI state

A cell view's *target* lives in the path (`/@owner/cell/<segment>/<segment>`), never the hash. The
path is what the server sees, what a link carries, and what the substrate can resolve to a fact. Hash
is reserved for throwaway client-only state (scroll, open accordion) that no one would bookmark.

### 2. Dispatch serves path-scoped `ssr.json`

The dispatch tier matches the request path against a cell's declared `paths` patterns and performs the
scoped substrate read *before* handing HTML to the client. Patterns use two wildcards:

| token | matches | binds |
|---|---|---|
| `:seg` | exactly one path segment | a named param |
| `*rest` | one-or-more trailing segments | the remainder |

The matched params substitute into the read template, so `/@c15r/machine/run/:run` server-reads that
run's facts and ships them inline. First paint is the addressed view, not a shell.

### 3. Deploy-order is prefix-reads-before-type-reads

`ssr.json` read entries that key off a path *prefix* must be ordered ahead of entries that key off a
*type*, because a duplicate `as` binding resolves last-write-wins. Getting this backwards silently
shadows the prefix read. Documented as a deploy hazard, not just a convention.

## Consequences

- A cell URL is now a real designation: shareable, server-renderable, legible to the graph.
- SSR works for any cell that declares `paths`; the machine cell is the reference consumer (run and
  node deep links render server-side).
- The hash is demoted to ephemeral client state, so back/forward and refresh behave like a normal app.

## Open / follow-ups

- **Canvas/`$graph` deep links** are not yet path-addressable end to end — the renderer half still
  reads embedded element state (cf. ADR-0019 open item). Deferred.
- ~~**Param validation** is structural (segment count) not semantic; a bad `:run` 404s at read time
  rather than at route time.~~ **Closed** — an `ssr.json` read may declare `where: { param: regex }`;
  a captured param that fails its anchored pattern means the read does not apply to that path (the
  section degrades to a client load) instead of issuing a doomed substrate read. A malformed author
  regex falls back to permissive, so a typo never breaks SSR. (`services/dispatch/service.ts`
  `paramsSatisfy`/`selectSsrReads`.)
