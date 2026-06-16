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
| 3 | Incremental authorization | ⏳ outstanding | server-requested mid-session scope upgrades |
| 4 | Write-time delegation | ⏳ outstanding | cells acting on caller's behalf, bounded to caller's granted writes |

Verified live (deploy #194): read-only token → workspace write returns
`scope_denied: requires write:workspace`; read+write token writes fine
(coarse `workspace:write` satisfies `write:workspace`); AS metadata advertises the
granular vocabulary. 224 tests pass.

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
  `tests/auth-oauth.test.ts` (`grantableScopes` admin-gating),
  `tests/scope-grammar.*`/`platform` (matches/implies).

## Outstanding work

### Phase 3 — Incremental authorization
Server-requested scope upgrades mid-session (`scope_request`/`offer`/`reduced`),
per sync `agency-and-identity.md` Appendix A: effective scope mutable
server-side, the OAuth grant remaining the ceiling. Lets a session start minimal
and widen on demand instead of front-loading consent.

### Phase 4 — Write-time delegation
The write counterpart of the SSR read-proxy: when a cell acts on the caller's
behalf, it should exercise only the caller's **granted write** capabilities —
`scope(caller, write)` enforced at the act boundary. Today only reads are
delegated (the SSR-proxy); writes from cells go through the substrate-write event
path, not a scoped delegation.

### Optional — migrate clients to request granular
`services/home/client/auth.ts` `DEFAULT_SCOPE` still requests the coarse buckets
(`workspace:read workspace:write platform:cells:create`); these work via
`impliesScope`. New browser tokens could request `read:workspace write:workspace`
to be precise. Low priority — back-compat already covers it.

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
