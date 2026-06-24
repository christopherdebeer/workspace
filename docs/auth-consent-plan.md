# Plan — consent: requesting cell as client + type-declared granular scopes

> Status: **plan** (for review before coding). Grounds in `docs/capability-consent.md`
> (the shipped granular-consent work) and `docs/scope-grants.md` (the substrate grant
> grammar). Two asks, addressed separately because they live at different layers.

## Context (what already exists)

- The consent screen already resolves the **DCR client's human name** and offers a
  grant-lifetime picker: `handleGrantableScopes` → `{ username, scopes, catalog,
  clientName, maxGrantSecs }` (`services/auth/oauth.ts`); the SPA groups scopes by
  verb (`services/auth/client/main.tsx`).
- `ConsentBody` already carries an optional **`resource`**, threaded onto the auth
  code (`AuthCode.resource`).
- **Host-isolated cells** (`*.on.parc.land`, model A) already get a cell-scoped
  ceiling: `cellCeiling(redirectUri)` → `['workspace:read','workspace:write',
  'cell:<label>:*']` and the mint intersects against it.
- OAuth scopes are **deliberately coarse** (`read:workspace`/`write:workspace`/
  `cells:create`); fine per-type/per-prefix precision is the **grant grammar's** job
  one layer down (`workspace:<owner>:<prefix>:<verb>`, `cell:<owner>/<name>:<tool>`),
  requestable at runtime (`workspace.requestGrant`/`approveGrant`). See
  `capability-consent.md` §"Why OAuth scopes are coarse".

## Gap A — show the requesting **cell** as the client (when appropriate)

Today an **apex-served** cell (`/@c15r/machine`) signs in through the shared kernel
OAuth client, so consent reads "parc.land", not "@c15r/machine". (Host-isolated
cells already self-identify by host.)

**Approach** (no new primitive — thread the cell context that already flows):

1. **Derive the cell from the navigation.** The kernel's `redirect_uri` is
   `origin + pathname`; for an apex cell that's `/@<owner>/<name>/…`. In
   `/oauth/authorize` (and `handleGrantableScopes`), parse `/@owner/name` from the
   redirect_uri (mirror `cellCeiling`'s parse) → a `cell { owner, name }` hint.
2. **Surface it at consent.** `handleGrantableScopes` returns an optional
   `resource: { kind:'cell', address:'@owner/name', title, manager }` (title/manager
   from `cells.get`/`describeTypes`). The SPA headline becomes
   *"Authorize **@c15r/machine** to act in your workspace"* with the client app
   (e.g. parc.land / Claude.ai) shown as the carrier beneath.
3. **Optionally disclose what the cell does.** Fold in the existing
   `cells.describeCellTools` `disclosure { author, reads, writes, note }` so the user
   sees the cell's declared reads/writes at consent — the data already exists
   (Phase 6, `capability-consent.md`).

**Files:** `services/auth/oauth.ts` (`/authorize` + `handleGrantableScopes` cell
parse + `resource` in the response), `services/auth/client/main.tsx` (headline +
disclosure block). No enforcement change — this is presentation + an honest subject.

## Gap B — let **types** declare requestable granular scopes

Today consent shows only the coarse buckets. The ask: a type (e.g. `note`) declares
a narrower scope a client can request, so a client that only writes notes isn't
granted blanket `write:workspace`.

**Approach** (a *refinement of the ceiling*, back-compat by `impliesScope`):

1. **Declare on the type.** `types.json` gains an optional `scopes` facet, e.g.
   ```jsonc
   { "type": "note", "manager": "@c15r/starter",
     "scopes": { "write": "write:type:note", "read": "read:type:note" } }
   ```
2. **Derive the menu.** `scopesSupported` (AS metadata) unions the declared type
   scopes with the coarse set; the catalog labels them from the type
   (icon + title). `handleGrantableScopes` includes them so the SPA can offer
   *"remember notes"* (`write:type:note`) as a narrower alternative to
   *"write your workspace"*.
3. **Enforce with back-compat.** Extend `impliesScope` so `write:workspace ⊇
   write:type:*` (coarse satisfies granular — existing pattern), and the workspace
   `remember`/`ingest` handlers, when writing a typed fact, accept either
   `write:workspace` **or** `write:type:<T>`. New precise tokens; old coarse tokens
   unchanged.
4. **Keep the layering honest.** Per the `capability-consent.md` rationale, fine
   per-prefix/cross-slice bounds stay in the **grant grammar** (Phase 4 write-time
   delegation). Type-scopes are an *optional* consent-ceiling narrowing, defaulting
   to coarse — they don't replace grants.

**Files:** `cells/*/types.json` (opt-in `scopes`), `services/cells/service.ts`
(surface type scopes via `describeTypes`), `lib/platform-stack.ts` `AUTH_SCOPES`
(or derive dynamically), `services/auth/oauth.ts` (`SCOPE_CATALOG` from types +
`grantableScopes`), `platform/runtime/auth.ts` (`impliesScope` table),
`services/workspace/handlers.ts` (`remember`/`ingest` type-scope check),
`services/auth/client/main.tsx` (render type scopes grouped under their coarse parent).

## Phasing

- **A1** cell-as-client display (presentation only) — smallest, ship first.
- **A2** consent-time cell disclosure (reuse describeCellTools).
- **B1** type `scopes` facet + AS-metadata/catalog derivation + consent display
  (still grants coarse — non-breaking).
- **B2** enforcement (`impliesScope` + workspace type-scope check) — flip new
  clients to request granular.

## Open questions

- Should type-scopes be **per-cell** (`write:@c15r/lit`) or **per-type**
  (`write:type:note`)? Per-type composes across cells but bakes a type taxonomy into
  the token grammar (the doc's stated reason to stay coarse). Recommend per-type,
  opt-in, with the grant grammar still carrying prefix/cross-slice precision.
- Do we want the cell shown as the **OAuth client** (DCR per cell) or as a
  **resource** the shared client acts on? Resource is far less machinery and matches
  the existing `resource`/`cellCeiling` shape — recommended.
