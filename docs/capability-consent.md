# Granular consent — capabilities as the grant surface

> Status: design. Spine for the thread. Phases 1→4; only Phase 1 (manifest +
> display) is non-breaking. Touches the auth primitive, so land it in order.

## Why

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

## The mapping (Σ-calculus)

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

## Scope vocabulary (granular)

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

## Cell capability manifest

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

## Consent screen

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

## Phases

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

## Fallout: Identity-seeding (do now)

The home Identity section still loads client-side because its `auth.tokens` read
isn't in the dispatch SSR allowlist (which gates to `workspace`/`cells`). Adding
`auth` (dispatch already has `dispatch.allow(auth)`) lets the SSR-proxy read
`auth.tokens` + `workspace.shared`/`grantRequests` as the caller and seed the
section — the last flash-free piece, and a concrete first step in this thread
(it exercises the read-capability path the manifest formalizes).
