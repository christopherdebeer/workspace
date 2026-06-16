# Granular consent — capabilities as the grant surface

> Status: **Phases 1 & 2 shipped and deployed** (consent is now verb-enforced and
> back-compatible). Phases 3 & 4 outstanding. See **Status ledger** and **Where
> the code lives** below before continuing — they are the handoff for a fresh
> session.

## Status ledger

| # | Piece | State | Notes |
|---|-------|-------|-------|
| — | Identity-seeding (flash-free home Identity section) | ✅ shipped | dispatch SSR-proxy reads `auth.tokens` etc. as the caller; see "Fallout" below |
| — | SSR-proxy read-only hardening | ✅ shipped | `SSR_READ_TARGETS` allowlist refuses write targets (`services/dispatch/service.ts`) |
| 1 | Manifest + display (catalog + grouped consent) | ✅ shipped | scope catalog with labels; consent SPA groups reads/writes; shows **only requested∩grantable**; human client name |
| 2a | `impliesScope` back-compat (coarse ⊇ granular) | ✅ shipped | `platform/runtime/auth.ts`; only-widens, dormant until granular scopes exist |
| 2b | `cells.create` → `cells:create` (granular, enforced) | ✅ shipped | `services/cells/service.ts`; legacy `platform:cells:create`/`platform:*` still satisfy it |
| 2c | Workspace tools verb-enforced | ✅ shipped + verified | reads need `read:workspace`, acts need `write:workspace`; read-only token is **denied** writes |
| 2d | Granular scopes offered at consent | ✅ shipped | `read:workspace`/`write:workspace`/`cells:create` in `AUTH_SCOPES`; live in AS metadata |
| 2e | Mint-path back-compat + client migration | ✅ shipped | `intersectScopes` honours `impliesScope`; `services/home` requests granular; consent SPA de-dupes aliases |
| 5 | Consent-time grant lifetime | ✅ shipped | consent picker narrows the grant horizon (refresh TTL, or access on non-expiring), clamped to the server ceiling |
| 6 | Third-party-cell author disclosure | ✅ shipped | `describeCellTools` discloses author + declared reads + write-back to non-owner callers; surfaced through the gateway catalog |
| 3 | Incremental authorization | ✅ shipped | mutable **effective scope** ≤ grant ceiling; `auth.scope`/`focusScope`/`requestScope`; gateway raises `scope_offer` (self-serve widen) vs `scope_denied` (re-consent) |
| 4 | Write-time delegation | ⏳ outstanding | cells acting on caller's behalf, bounded to caller's granted writes |

Verified live (deploy #194): read-only token → workspace write returns
`scope_denied: requires write:workspace`; read+write token writes fine
(coarse `workspace:write` satisfies `write:workspace`); AS metadata advertises the
granular vocabulary. The in-repo browser client now requests the granular vocabulary
and the mint path (`intersectScopes`) is back-compat-hardened to match enforcement
(see "Clients migrated" below). The consent screen now also lets the user pick a
grant lifetime, and third-party-cell tools disclose their author + declared reads.
Incremental authorization (Phase 3) is shipped: a session's effective scope is a
mutable subset of its grant. 235 tests pass.

## What actually shipped vs. the original design

The enforced granular vocabulary is intentionally **coarser** than the full
`$catalog`-derived grammar this doc sketched. Shipped scopes:

```
read:workspace     observe your workspace (all workspace read tools)
write:workspace    write to your slice    (all workspace act tools)
cells:create       provision cells        (admin-gated)
```

The fine-grained strings sketched below (`read:@c15r/lit`, `write:type:note`,
`act:@owner/cell.tool`) are **not** implemented. Workspace tools derive their
scope from each tool's declared `kind` (read→`read:workspace`, act→
`write:workspace`) in `workspace.describeTools`; per-cell tools (`@owner/cell.tool`)
remain gated by **ownership + per-cell grants** (`workspace.requestGrant`/
`approveGrant`), not OAuth scopes. That granularity is available later if needed
but was not required to close the consent-integrity gap (a "read-only" token
that could still write).

### Why OAuth scopes are coarse — and where the fine-grained surface actually lives

A fair question: a cell often only needs to write *one type* (`note`) or *one
prefix* (`inbox/*`), so why does consent grant blanket `write:workspace`?

Because there are **two distinct authority layers**, and per-type/per-prefix
bounding belongs to the lower one:

1. **The OAuth scope** is the *consent ceiling for a client acting AS the human,
   inside the human's own slice.* Within your own slice the consequential axis is
   read-vs-write (the Σ-calculus monotonicity asymmetry — reads are disclosure,
   writes are the risk). Splitting *your own* writes into `write:type:note` vs
   `write:type:todo` spends consent-UI budget on a distinction that doesn't change
   the trust relationship (it's still you writing your slice), and it would bake a
   fact-type taxonomy into the AS metadata / token grammar — static, redeploy to
   change. So the OAuth layer deliberately stays coarse: read / write / create.

2. **The substrate grant grammar** (`docs/scope-grants.md`) is where fine-grained,
   prefix- and type-bounded capability already exists — for the cases that
   actually need it: **one principal acting on *another's* slice, or a cell acting
   under a bounded delegation.** Grants are addressed as
   `workspace:<owner>:<keyPrefix|*>:<read|write>` and `cell:<owner>/<name>:<tool>`,
   are *data* (requestable at runtime via `workspace.requestGrant` /
   `approveGrant`, not baked into a scope vocabulary), and are enforced by
   `requireWriteThrough` → `grantCovers(g.key, key)` — a write-through to
   `alice`'s `inbox/*` requires exactly a `write` grant whose key pattern covers
   `inbox/*`, nothing wider. That is precisely the "only write a specific prefix"
   bound, living one layer down from OAuth.

So a cell that should only touch `note` facts or `inbox/*` is expressed as a
**bounded grant**, not a bespoke OAuth scope. The granular OAuth strings the
original design sketched (`write:type:note`, `read:@c15r/lit`) remain available as
a future *refinement of the ceiling* if a real consent-time need appears, but the
prefix/type precision the question asks for is already achievable today through the
grant grammar — and it's where Phase 4 (write-time delegation) will bind a cell's
writes to `scope(caller, write)` rather than letting it write the whole slice.

**Enforcement point:** the `/mcp` gateway (`enforceScope`/`hasScope`) for external
callers. Internal Mode-1 `serviceClient` calls bypass scope checks (trusted,
identity-carried); the SSR-proxy is Mode-1 but is separately constrained to the
read-only target allowlist. So verb-enforcement applies to agents and the home
browser client's `mcpCall` — both of which carry coarse `workspace:read`+`write`
(see `services/home/client/auth.ts` `DEFAULT_SCOPE`) and so satisfy the granular
requirements via `impliesScope`.

## Where the code lives (continue here)

- **Scope grammar / back-compat:** `platform/runtime/auth.ts` — `matchesScope`
  (wildcards), `impliesScope` (coarse ⊇ granular table), `hasScope` (gateway gate).
- **Consent + scope catalog + admin-gating:** `services/auth/oauth.ts` —
  `SCOPE_CATALOG` (labels), `grantableScopes`/`isAdminScope`, `handleConsent`.
  Consent SPA: `services/auth/client/main.tsx`.
- **Advertised scopes / admin prefixes:** `lib/platform-stack.ts` `AUTH_SCOPES`
  and `AUTH_ADMIN_SCOPE_PREFIXES` (`platform: cells:create`).
- **Workspace verb-scope derivation:** `services/workspace/handlers.ts`
  `describeTools` (derives `read:`/`write:workspace` from tool `kind`; `tend`
  keeps explicit `workspace:admin`).
- **Cell-creation scope:** `services/cells/service.ts` `CREATE_SCOPE`.
- **SSR read-only allowlist:** `services/dispatch/service.ts` `SSR_READ_TARGETS`.
- **Tests:** `tests/workspace.test.ts` (describeTools verb scopes),
  `tests/auth-oauth.test.ts` (`grantableScopes` admin-gating, grant lifetime),
  `tests/scope-grammar.*`/`platform` (matches/implies),
  `tests/forge-cell.test.ts` (cell author disclosure).

## Consent-time grant lifetime (✅ shipped)

A grant the user can time-box is the cheapest mitigation for the cell-write-back
risk below — so the consent screen now offers a **"this access lasts…" picker**.
It can only *narrow*: the chosen seconds are clamped server-side to a ceiling
(`grantCeilingSecs` = the configured refresh TTL) and threaded as `grantSecs` on
the auth code. At token exchange (`handleToken`):

- **Expiring deployments** (the norm): the **refresh token** carries the chosen
  horizon (the re-consent clock); the access token stays the short configured TTL.
  A choice *shorter than* the access TTL collapses to a single short-lived token
  with no refresh.
- **Non-expiring deployments**: a finite choice makes the **access token** itself
  finite (no refresh on that deployment); omitting it preserves non-expiry.

Code: `ConsentBody.expiresInSec` + `clampGrant`/`grantCeilingSecs` in
`services/auth/oauth.ts`; `AuthCode.grantSecs` through both stores; the picker in
`services/auth/client/main.tsx` (fed `maxGrantSecs` from `/auth/grantable`).

## Third-party-cell author disclosure (✅ shipped)

The honest answer to "a cell writes data to another location — exfiltration?".
A cell **receives no token** when invoked (only an `x-cell-caller` header); it
writes back exclusively through the **organ path** (`substrate.write.requested`,
IAM-pinned `events:source = cell-<id>`), which lands in the cell **owner's**
(= author's) slice — never the caller's, never a third party's
(`createSubstrateWriteHandler`). The exfiltration shape is therefore: *user B
invokes author A's cell; dispatch runs A's declared SSR reads **as B** and hands
the results to A's code, which can persist them into **A's** slice.* Gated (B must
be owner/granted, or it's an anonymous public GET) but previously **undisclosed**.

This is **not** an OAuth-consent concern (that governs a client acting as *you*,
in *your* slice); it's a third-party-app trust decision. So the disclosure rides
the discovery/first-invoke surface instead: `cells.describeCellTools` now attaches
a `disclosure { author, reads, note }` to every tool whose cell the caller does
**not** own, and the gateway carries it into the `$catalog` — so both humans and
agents see "runs @author's code; it can observe these reads and persist results
into @author's workspace" at the moment they choose to use it. Owners see no
notice (writing to your own cell's slice is writing to yourself). A consent/grant
**UI** can render this block at `approveGrant` time; the data is now exposed for it.

## Outstanding work

### Phase 3 — Incremental authorization (✅ shipped)

"Scope is the ceiling (OAuth, at consent); focus is the arbiter (runtime)" made
real. A token's **grant** is the immutable ceiling; the session's **effective
scope** is a mutable subset of it, so a session can start minimal and widen on
demand — no re-consent, no new token.

**Data:** a token row carries `effectiveScope` (null ⇒ the full grant is active),
mutated by `setEffectiveScope(tokenId, userId, scope)` — keyed by the owner's
account id, so a session only ever mutates its own token (`services/auth/{store,
memory-store,dynamo-store}.ts`). `validateBearer` now returns `{ scope (grant),
effectiveScope, tokenId, … }`.

**Identity:** `Identity` gained `grantScopes` (the ceiling) and `tokenId`;
`scopes` is the effective set that `hasScope`/enforcement reads. Both propagate on
the Mode-1 command envelope (`service-client.ts`) so the auth cell, reached via the
gateway, sees the caller's ceiling + token id. `grantScopesOf`/`hasGrantScope`
(`platform/runtime/auth.ts`) read the ceiling; absent `grantScopes` ⇒ equals
`scopes` (back-compat — nothing changes until a session narrows).

**Protocol (the three terms):**
- `auth.scope` (read) → `{ effective, grant }`.
- `auth.focusScope` (act) → narrow to a minimal subset (`reduced`).
- `auth.requestScope` (act) → widen toward requested, clamped to the ceiling
  (`scope_request`); scopes outside the grant come back in `denied`.
- The gateway's `enforceScope` raises **`scope_offer`** (the `offer`) when a
  capability needs a scope within the grant but not the current focus — pointing
  at `auth.requestScope`, a self-serve widen — vs **`scope_denied`** when it's
  outside the grant entirely (the human re-consent / `auth.mintToken` path).

**Default is opt-in:** new tokens start with effective == grant (so behaviour is
unchanged), and a cautious client/agent calls `focusScope` at session start to
shrink blast radius, widening only when a `scope_offer` says it's within reach.
**Note:** a refresh mints a fresh access token whose effective resets to the grant
(re-narrow after refresh) — acceptable for now; a future refinement could carry
the focus across rotation.

Tests: `tests/auth-incremental.test.ts` (end-to-end through the auth handler),
`tests/auth-oauth.test.ts` (store: effective scope + token id),
`tests/resource-cell.test.ts` (gateway `scope_offer` vs `scope_denied`).

### Phase 4 — Write-time delegation
The write counterpart of the SSR read-proxy: when a cell acts on the caller's
behalf, it should exercise only the caller's **granted write** capabilities —
`scope(caller, write)` enforced at the act boundary. Today only reads are
delegated (the SSR-proxy); writes from cells go through the substrate-write event
path, not a scoped delegation.

### ✅ Clients migrated to request granular (+ mint-path back-compat hardened)
`services/home/client/auth.ts` `DEFAULT_SCOPE` now requests the granular
vocabulary (`read:workspace write:workspace cells:create`); legacy already-minted
coarse tokens still work via `impliesScope`. (The ported `cells/home` client signs
in through the `c15r/kernel` `login`, so its scope is the kernel's to set, not this
repo's.)

Making this safe required closing a back-compat asymmetry the original note missed:
the coarse⊇granular table lived **only** in `impliesScope`/`hasScope` (the
*enforcement* path), not in `intersectScopes`/`cellCeiling` (the *mint* path in
`services/auth/oauth.ts`). `intersectScopePatterns('read:workspace','workspace:read')`
is structurally `null` (disjoint grammars), so a cell-host (model-A) redirect that
requested granular scopes would have intersected against the coarse `cellCeiling`
to an **empty** scope — silently locking the token out. `intersectScopes` now falls
back to `impliesScope` across the two grammars and keeps the **narrower** (granular)
side, so the mint path agrees with enforcement (`tests/scope-grammar.test.ts`).
The consent SPA also de-duplicates coarse/granular aliases that render identically
(both families stay grantable for legacy requests; the picker shows each permission
once, preferring the granular form).

---

## Original design (rationale — retained)

### Why


Signin grants coarse buckets — `workspace:read workspace:write workspace:admin
platform:cells:create platform:*` (`AUTH_SCOPES`). The consent SPA
(`services/auth/client/main.tsx`) renders those as checkboxes. But the substrate
already has a *granular* capability surface:

- **reads/writes are first-class** — every capability is `read(target)` or
  `act(target)` over the `$catalog` (workspace.query, @owner/cell.tool, …).
- **per-cell grants** already exist below OAuth (`cell:owner/name:*`,
  `workspace.requestGrant`/`approveGrant`).
- a cell now **declares the reads it needs** as data (`ssr.json`) and the
  **writes/types it manages** (`types.json` handlers, act targets).

So the material for granular consent exists; it just isn't surfaced at signin.

### The mapping (Σ-calculus)

`sync/docs/sigma-calculus.md`: the only two participation terms are
`observe(φ, s, R)` (a **read** → a surface/output) and `write(φ, s, W)` (a
**scope-authoritative write** → an action); `scope(s,·)` is the authority
boundary and **capability delegation falls out of scoping**. So:

- a **capability** = `(verb, target)` where verb ∈ {`read`/observe,
  `act`/write}, target is a `$catalog` address.
- a **grant** = a bounded set of capabilities a principal may exercise — exactly
  a delegated `scope(s, …)`.
- **monotonicity asymmetry (Laws 6/7):** reads are monotone, coordination-free,
  low-risk → grant broadly, even auto. Writes are non-monotone (organs,
  serialized), higher-risk → this is where granular, per-target consent earns
  its keep. *Spend consent-UI budget on writes; reads are disclosure.*

`sync/docs/agency-and-identity.md` §X gives the UX blueprint: **scope is the
ceiling (OAuth, set at consent); focus is the arbiter (runtime).** Per-resource
scope strings, grouped on the consent screen, with progressive/incremental
widening.

### Scope vocabulary (granular)

Derive scope strings from the capability surface (`$catalog` + `$types` +
`cells.describeTypes`/`describeTools`), namespaced by verb:

```
read:workspace                 observe the workspace room
read:@c15r/lit                 observe a cell (its read tools)
write:workspace                write facts to your slice
write:type:note                write only `note` facts        (type-scoped)
act:@c15r/lit.publish          invoke a specific cell tool
cells:create                   provision cells
auth:admin                     admin (token mgmt)
```

Back-compat: the coarse buckets map to capability sets —
`workspace:read ⊇ read:*`, `workspace:write ⊇ write:* act:*`,
`platform:cells:create = cells:create`, `platform:* = admin`. So old tokens keep
working while new ones can be precise.

### Cell capability manifest

A cell declares, as data, the capabilities it **needs** (to act on the caller's
behalf) and **exposes** (its tools). `ssr.json` reads are already its read
requirements; generalize to a `capabilities` block (or keep `ssr.json` for reads
and derive writes from `types.json` act/edit handlers + the cell's tools):

```jsonc
// cells/<x>/capabilities.json  (or fold into ssr.json)
{
  "reads":  [ { "target": "workspace.query" }, { "target": "cells.list" } ],
  "writes": [ { "target": "workspace.remember", "types": ["note"] } ]
}
```

This is the same declaration that drives the SSR-proxy (reads) and the consent
screen (reads + writes), and the agent's affordance list — one source.

### Consent screen

Render the *requested* capabilities, grouped, with human labels:

```
Authorize Claude.ai
  Reads (sees)
    ☑ your workspace                read:workspace
    ☑ your cells                    read:@c15r/cells
  Writes (changes)
    ☑ remember notes               write:type:note
    ☐ provision cells              cells:create
  [Authorize]
```

Reads default-checked (disclosure); writes explicit. The ceiling is what's
granted; the runtime focus narrows within it.

### Phases (original plan — see Status ledger above for actual state)

1. **Manifest + display (non-breaking).** Cells declare capabilities; an
   aggregated catalog; the consent SPA *shows* granular capabilities grouped
   reads/writes (labels from the catalog) while still granting the existing
   coarse buckets. No enforcement change. ← start here.
2. **Scope vocabulary.** `scopesSupported` derived from the catalog; the gateway
   maps granular scopes → enforcement with the back-compat table above. New
   tokens precise; old tokens unchanged.
3. **Incremental authorization.** Server-requested scope upgrades mid-session
   (`scope_request`/`offer`/`reduced`), per sync agency-and-identity Appendix A;
   effective scope mutable server-side, OAuth grant the ceiling.
4. **Write-time delegation.** Cells acting on the caller's behalf (the write
   counterpart of the SSR read-proxy) exercise only the caller's granted write
   capabilities — `scope(caller, write)` enforced.

### Fallout: Identity-seeding (✅ done)

The home Identity section used to load client-side because its `auth.tokens` read
wasn't in the dispatch SSR allowlist (which gated to `workspace`/`cells`). Adding
`auth` (dispatch already has `dispatch.allow(auth)`) let the SSR-proxy read
`auth.tokens` + `workspace.shared`/`grantRequests` as the caller and seed the
section — the last flash-free piece, and the concrete first step in this thread
(it exercised the read-capability path the manifest formalizes). Shipped, with the
SSR-proxy hardened to a read-only target allowlist (`SSR_READ_TARGETS`).
