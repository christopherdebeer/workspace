# Mapping the Val Town projects onto the platform

This note explores how three existing Val Town projects — **`c15r/mcp-auth`**,
**`c15r/workspace`**, and **`c15r/sync`** — map onto the serverless
multi-project platform in this repo (see `docs/serverless-platform.md`), and
proposes adopting `mcp-auth` as a first-class **auth primitive service** rather
than the ad-hoc auth currently embedded in `lambda/index.ts`.

The thesis: each Val Town "val" is already a service cell in disguise. The
platform's `HttpServiceCell` + `defineService` give us the same ergonomics
(one HTTP handler, owned persistence, fronted by a router) on AWS, while the
manifest/registry/event-bus machinery replaces Val Town's implicit
cross-val imports.

---

## 1. Primitive mapping (Val Town → platform)

| Val Town primitive | Platform equivalent | Notes |
|--------------------|---------------------|-------|
| HTTP val (`export default (req) => Response`) | `HttpServiceCell` + `defineService` Lambda (Function URL behind CloudFront) | The Deno `Request`→`Response` handler becomes a command handler; routing is by `/svc/<command>`. |
| `std/sqlite` (per-val SQLite) | **Turso/libSQL** per cell (`persistence: { turso: true }`) | Both are libSQL/SQLite. `mcp-auth/db.ts` and `workspace/db.ts` are near-portable: swap `https://esm.town/v/std/sqlite` for a Turso client built from `ctx.config.turso`. |
| `std/blob` (KV) | DynamoDB (`persistence: { dynamo: true }`, `pk`/`sk`) | High-scale mutable / KV state. |
| `esm.town` import of a shared val (e.g. `workspace` importing `mcp-auth`) | Either a **shared platform package** (compile-time) or a **service cell command** (runtime invoke) | This is the central decision — see §3. |
| Interval val (`workspace/tend.ts`, type `interval`) | **EventBridge Scheduler** → cell command (or SQS → worker) | The "just-in-time cron" becomes a scheduled `tend` command. |
| MCP JSON-RPC over HTTP (`/mcp`) | Same, served by a cell | All three vals are MCP servers; the platform is MCP-native by tenet. A thin `defineMcpService` adapter can expose a cell's commands as MCP tools (see §5). |
| Cross-val auth (OAuth/passkey) | **`auth` primitive service** + edge token normalisation | `mcp-auth` is the implementation behind the `x-auth-user` / `x-auth-scopes` headers the runtime already reads (`platform/runtime/auth.ts`). |
| Val Town implicit per-user identity | Scoped bearer tokens minted by passkey auth | `mcp-auth`'s unified token model maps directly to `Identity { user, scopes }`. |
| Long-poll `/wait?condition=...` (sync) | Lambda long-poll (≤ timeout) or Step Functions / SQS for longer waits | See §4. |
| Claude Code "runs" (`workspace_run_start` → fire URL) | Mode 3 queue / EventBridge → worker; fire URL → GitHub Actions dispatch | Async fan-out work. |

---

## 2. `mcp-auth` → the `auth` primitive service

`mcp-auth` is already factored exactly as a reusable primitive: a generic
SQLite schema (`auth_users`, `auth_credentials`, `auth_challenges`,
`auth_oauth_clients`, `auth_codes`, `auth_sessions`, `auth_tokens`,
`auth_device_codes`, `auth_recovery_tokens`) plus protocol handlers for
OAuth 2.1 (PRM, AS metadata, DCR, consent, token) and WebAuthn passkeys
(register/authenticate options+verify), and a unified scoped-token model with
`mintToken` / `validateTokenByHash` / refresh / revoke / device-code flow.

This is **more mature than the auth in `lambda/index.ts`** (which hand-rolls
fido2-lib + a single DynamoDB table + bespoke OAuth). The recommendation is to
make it the platform's auth cell.

### Shape

```
HttpServiceCell "auth"
  routes:    /auth/*            (device flow, token ops, consent)
             /oauth/*           (DCR, authorize, token)
             /.well-known/*     (oauth-protected-resource, oauth-authorization-server)
             /webauthn/*        (passkey register/authenticate)
  persistence: { turso: true }  (the auth_* tables — near-verbatim from mcp-auth/db.ts)
  commands:  mintToken, validateToken, listTokens, revokeToken,
             registerOptions, registerVerify, authOptions, authVerify
  emits:     auth.user.registered, auth.token.minted, auth.token.revoked
```

Porting effort is low: `mcp-auth/db.ts` becomes the auth cell's data layer with
`sqlite` swapped for a Turso client; `oauth.ts` / `webauthn.ts` handlers become
commands/routes. The browser passkey UI (`renderAuthorizePage` in
`workspace/mcp.ts`) ports as a static asset or an HTML-returning route.

### How it closes the loop with the existing runtime

`platform/runtime/auth.ts` already defines the contract: the edge normalises
credentials into trusted `x-auth-user` / `x-auth-scopes` headers, and cells just
read them. `mcp-auth` supplies the missing verifier. Two placements:

1. **Edge validation (preferred for hot path).** A CloudFront Function /
   Lambda@Edge (or a lightweight authorizer) extracts the bearer token, calls
   `auth.validateToken` (with a short-TTL cache), and injects
   `x-auth-user` + `x-auth-scopes`. Downstream cells stay oblivious — exactly
   what `identityFromHeaders` expects today.
2. **In-cell validation.** A cell calls `ctx.serviceClient('auth').command('validateToken', { token })`
   in a shared middleware. Simpler, but adds a synchronous hop per request.

Either way, **scopes** (`rooms:*`, `workspace:write`, …) flow into
`Identity.scopes`, and `requireUser` / a new `requireScope` helper enforce them.

### Migration of the current experiment

`lambda/index.ts` (WebAuthn + OAuth + KV in one Lambda) is superseded by the
`auth` cell. The migration is incremental: stand up the `auth` cell, point the
frontend's auth calls at `/auth/*` and `/webauthn/*`, then retire the bespoke
handlers. The KV tool can move to its own small cell or stay until ported.

---

## 3. The cross-val import decision: library vs. service

In Val Town, `workspace` and `sync` simply `import` from `mcp-auth`. On the
platform there are two faithful translations, and the right answer differs by
concern:

- **Token *validation* → edge/shared, not a per-request invoke.** It is on every
  request's hot path. Do it once at the edge (§2.1) and pass identity via
  headers. Cells never import auth for this.
- **Token *minting*, registration, consent, device flow → the `auth` cell.**
  These are low-frequency, security-sensitive, and own the `auth_*` tables.
  Other services never touch those tables directly (service-boundary rule);
  they call commands or redirect to `/auth/*` / `/oauth/*`.

This preserves the platform's core invariant — *a project never reads another
project's database* — which Val Town's shared-val imports quietly violate.

---

## 4. `sync` → the `sync` service cell

`sync` is a coordination substrate: rooms, agents, registered **actions**
(write capabilities) and **views** (read capabilities) expressed in **CEL**,
with salience-shaped context and a `{ value, _meta }` wrapped state model.

| `sync` concept | Platform mapping |
|----------------|------------------|
| Rooms / agents / state / audit trail | Turso (relational, multi-writer, replayable). Audit trail → an append-only table or DynamoDB Streams. |
| 18 `sync_*` MCP tools | Cell commands, surfaced as MCP tools via the adapter (§5). |
| Scoped tokens (`rooms:my-room:agent:alice`) | `auth` cell tokens; `Identity.scopes` carries the room scope; cell enforces `min(token.scope, room.role)`. |
| Auth endpoints (`/auth/*`, `/oauth/*`, `/.well-known/*`) | Delegated to the `auth` cell (today `sync` embeds `mcp-auth` directly). |
| CEL evaluation + salience shaping | Pure runtime logic inside the cell — ports unchanged. |
| `/wait?condition=…` long-poll | Lambda long-poll up to the function timeout; for longer waits, return a token and let the client poll, or use Step Functions. |
| `_send_message`, directed messages | Mode 2 events on the bus (`sync.message.created`) for cross-agent/cross-service reactions. |

Routes: `/sync/*` (plus the `auth`/`oauth`/well-known paths owned by the auth
cell). Persistence: Turso. Emits: `sync.room.created`, `sync.action.invoked`,
`sync.message.created`.

---

## 5. `workspace` → the `workspace` service cell

`workspace` is an accretive knowledge substrate: `entries` + `links` + an
operation `log`, with an SQL **salience** ranking, **tending** prompts, and
**runs** that orchestrate Claude Code routines.

| `workspace` concept | Platform mapping |
|---------------------|------------------|
| `entries` / `links` / `log` (`db.ts`, `ops.ts`) | Turso (relational, recursive link queries, salience SQL). Near-verbatim port. |
| Salience / stale / tag-cloud SQL | Pure runtime — unchanged. |
| `tend.ts` interval ("just-in-time cron") | EventBridge Scheduler → `tend` command; surfaced prompts can also emit events. |
| MCP tools (`workspace_add`, `_search`, `_salience`, …) | Cell commands + MCP adapter. |
| Runs (`workspace_run_start` POSTs to a routine fire URL; `_run_complete`, `_run_wait`) | Mode 3: enqueue to SQS / emit `workspace.run.requested`; a worker (or GitHub Actions dispatch) executes; completion via `workspace.run.completed`. `_run_wait` = long-poll like `sync`. |
| OAuth/passkey via `mcp-auth` | Delegated to the `auth` cell. |

Routes: `/workspace/*`. Persistence: Turso (+ DynamoDB if run-queue state wants
high-churn KV). Emits: `workspace.entry.created`, `workspace.run.requested`,
`workspace.run.completed`.

### MCP adapter (a concrete "MCP-native" artifact)

All three vals expose the same JSON-RPC 2.0 MCP surface over HTTP. Rather than
re-implement it per cell, a small runtime helper — `defineMcpService` — can wrap
`defineService`, auto-generating `initialize` / `tools/list` / `tools/call` from
the command set and their JSON schemas, and mapping MCP auth to the `auth`
cell's tokens. This is the natural next construct to add to `platform/runtime`.

---

## 6. Target topology

```
                         app / *.parc.land
                                │
                                ▼
                       CloudFront Router
                 (edge: bearer → auth.validateToken
                  → inject x-auth-user / x-auth-scopes)
                                │
        ┌───────────────┬───────┴───────┬───────────────┐
        ▼               ▼               ▼               ▼
     auth            workspace         sync          (future cells)
   /auth/* /oauth/*  /workspace/*     /sync/*
   /webauthn/*
   .well-known/*
   Turso(auth_*)     Turso(entries)   Turso(rooms)
        │                  │               │
        └── mint/validate  │  events       │  events
            (commands)     ▼               ▼
                         EventBridge platform bus
                  workspace.run.requested → SQS → run worker
```

- **One** auth primitive, owned tables, reused by every cell via tokens — not
  imports.
- `workspace` and `sync` keep their SQLite logic almost verbatim on Turso.
- Cron, runs, and messages move onto Scheduler / SQS / EventBridge.

---

## 7. Status / next steps

1. **`auth` cell — DONE.** `services/auth` ports `mcp-auth/{db,oauth,webauthn}.ts`:
   WebAuthn passkeys, OAuth 2.1 (DCR, PKCE, refresh, device grant), unified
   scoped tokens. It exposes a `validateToken` command (the edge/peer bridge to
   `identityFromHeaders`) and `/oauth`, `/webauthn`, `/.well-known`, `/auth/device`
   routes via the new `defineService({ http })` capability. Storage is a
   `AuthStore` interface with DynamoDB (TTL) + in-memory implementations.
   > Storage note: the port uses **DynamoDB**, not Turso — auth access is all
   > point-lookups (by token hash, username, credential id), which single-table
   > DynamoDB serves directly. Turso remains the target for the relational
   > `workspace`/`sync` cells.
2. **Edge token normalisation** — wire a CloudFront Function/Lambda@Edge (or an
   authorizer) that calls `auth.validateToken` and injects `x-auth-user` /
   `x-auth-scopes`. The runtime already consumes these.
3. **`defineMcpService`** — wrap `defineService` to expose commands as MCP tools
   with auth-cell-backed tokens.
4. **Turso client helper** in `platform/runtime` (from `ctx.config.turso`) so
   `workspace`/`sync` `db.ts` files port with minimal edits.
5. **Port `workspace`** (smaller surface) as the reference relational cell, then
   `sync`.
6. **Retire `lambda/index.ts` auth** once the `auth` cell is wired to the
   frontend.
