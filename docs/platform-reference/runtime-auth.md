# Auth — Tokens as Principals, Scopes & Delegation

## What this subsystem is

The `auth` cell is the platform's **root of trust**. Every other capability in the substrate is measured against the **Fact** primitive, whose defining identity is `scope = IAM principal = OAuth target`. Auth is the thing that *produces* those principals: it turns a credential (a passkey ceremony, an OAuth code, a device grant, a bearer token) into the scoped `Identity` that a Fact's `(scope,key)` authority and writer-stamp depend on.

It is a **standard Cell** (`cell` core primitive): an IAM-isolated Lambda with its own scratch DynamoDB table, a `describeTools` publish seam, event-source attestation, and origin isolation. It is reached three ways:

1. **The `validateToken` / `refreshSession` command seam** — every other cell turns a bearer into `ctx.identity` by calling through `resolveHttpIdentity` (`platform/runtime/define-service.ts`), which invokes the auth cell's `validateToken` command. No other cell reads the auth table.
2. **A raw-HTTP OAuth 2.1 / RFC 8693 / WebAuthn surface** — `/oauth/*`, `/webauthn/*`, `/.well-known/*`, `/auth/device*` (`services/auth/oauth.ts`, `services/auth/webauthn.ts`).
3. **A gateway-facing token-management vocabulary** — `tokens`/`mintToken`/`exchangeToken`/`updateToken`/`revokeToken`/`scope`/`focusScope`/`requestScope`/`adoptGoal`/`dropGoal`, surfaced through the same projection/catalog pipeline (`describeTools`, `services/auth/service.ts:440`) as any other cell's tools.

### The distinctive coherence fact

Unlike almost every other capability, **auth does NOT store its state as Facts.** Tokens, challenges, codes, sessions, clients, and device grants live as hashed rows in the cell's *own* scratch table keyed by `TOKEN#` / `USERTOK#` / `REFRESH#` / `CLIENT#` / `CODE#` / `SESS#` / `DEV#` / `CRED#` / `USER#`. This is the one place that deliberately keeps a keyed store **outside** the substrate — precisely because it is the thing the substrate's per-scope IAM partitioning is *built on*. Auth cannot live behind `scope = IAM-principal` partitioning because it is what mints the principals that become Fact scopes.

The **scope-pattern math module** (`platform/runtime/auth.ts`) is the shared algebra that makes "a token can only narrow, never widen" a single reusable intersection, reused identically at mint, update, exchange, focus, and request.

> ⚠ **Coherence — authority grammar has exactly one home (compounds, PARTIAL/info).** The two authority grammars are cleanly separated: scope-pattern math lives **only** in `platform/runtime/auth.ts` (`matchesScope`:166, `intersectScopePatterns`:185, `hasScope`:279, `hasGrantScope`:306, `holdsUnder`:297, `requireScope`:314), and grant *covering* lives **only** in `services/workspace/grants.ts:65` (`grantCovers`). No participant reimplements either — `services/gateway/service.ts:455` (`enforceScope`) funnels through `hasScope`/`holdsUnder`/`hasGrantScope`; `services/workspace/shared.ts:158,185` type-scope guards call `hasScope('write:type:'+t)`; athena and search import the shared predicates. **Recommendation: keep it that way — do not let either grammar leak a second implementation.**

---

## Capability 1 — Scope-pattern algebra (the ∩ calculus over the scope grammar)

### What it does
The pure, storage-free math module in `platform/runtime/auth.ts` that defines the scope grammar and every operation over it. This is the enforcement algebra the Grant axis (ADR-0007 layer 1, `enforceScope`) composes over, and the leaf dependency of every other auth capability plus the gateway import.

The grammar (three resource families, `docs/scope-grants.md`, commented at `auth.ts:155`):
- `workspace:<owner>:<keyPrefix|*>:<read|write>` — facts
- `cell:<owner>/<name>:<tool|*>` — tools
- `platform:<verb>` — kernel verbs

### Public API
```ts
matchesScope(pattern: string, scope: string): boolean          // auth.ts:166
intersectScopePatterns(a: string, b: string): string | null    // auth.ts:185
intersectScopes(a: string[], b: string[]): string[]            // auth.ts:220
impliesScope(held: string, required: string): boolean          // auth.ts:252
hasScope(identity: Identity, scope: string): boolean           // auth.ts:279
grantScopesOf(identity: Identity): string[]                    // auth.ts:285
holdsUnder(identity: Identity, family: string): boolean        // auth.ts:296
hasGrantScope(identity: Identity, scope: string): boolean      // auth.ts:306
requireScope(identity: Identity, scope: string): string        // auth.ts:314 — throws ServiceAuthError(401)
requireUser(identity: Identity): string                        // auth.ts:148
```

### Data model
No storage. Operates on `Identity.scopes` (the enforced *effective* set) and `Identity.grantScopes` (the *ceiling*) — string arrays of `:`-separated patterns.

### Invariants & edge cases
- **Narrow-only.** Intersection (`intersectScopes`) can only narrow, never widen (`docs/scope-grants.md §3`). This is the single rule reused at mint / update / exchange / focus / request.
- **Wildcard semantics** (`matchesScope`:166): a **trailing** `*` matches one-or-more remaining segments (`a:b:*` covers `a:b:c` and `a:b:c:d` but **NOT** `a:b` itself — `s.length > i`); a **mid-pattern** `*` matches exactly one segment.
- **`intersectScopePatterns`** aligns segments positionally: `a:*:c ∩ a:b:* = a:b:c`; returns `null` when disjoint. It carefully handles the trailing-rest-wildcard on either side (`restA`/`restB` at :188-211) — if one side demands ≥1 more segment the other cannot provide, the meet is `null`.
- **`intersectScopes`** additionally crosses the coarse⊇granular back-compat via `impliesScope` (:236-237): a coarse ceiling (`workspace:write`) still admits a granular request (`write:workspace`), and the meet is the *narrower* (granular) of the two — so a cell ceiling cannot silently zero out a token that legitimately asked for granular scopes.
- **`impliesScope`** is currently **inert** Phase-2 back-compat: it only fires for *granular* required scopes (`read:` / `write:` / `act:` / `cells:create` at :253-255, which no tool declares yet), and only ever **widens** what a held scope satisfies, so it can never lock out an existing coarse token. Granular→coarse is deliberately **NOT** implied.
- **`hasScope` vs `requireScope`**: `hasScope` is a pure predicate for *filtering* (which tools to advertise); `requireScope` is the throwing enforcer (`ServiceAuthError`, `statusCode 401`, `auth.ts:322`).
- **`holdsUnder`** is the *reverse* of `hasScope` (`matchesScope(family, held)`) — an *any-of* gate ("may write SOME type") a downstream handler then refines against the concrete fact type.

### Reduces to
**`projection`** — its own small pure primitive, but it is the enforcement algebra the grant gate ("a projection preset over the grant index") composes over: `hasScope` is what filters which tools a caller may see/advertise (the select→shape stage of the read pipeline). It touches no substrate and is not itself a Fact/Cell/edge-http — it is stringly-typed pattern logic.

### Connections
Imported by `services/gateway/service.ts` (`enforceScope`), `services/workspace/shared.ts` (type-scope guards), athena and search. Every other auth capability depends on it.

### Motivating ADRs
- **ADR-0007** — Grants / the self-model (`$grants`)
- **ADR-0022** — Scopes & consent
- **ADR-0023** — Granular per-type scopes

---

## Capability 2 — Bearer→identity resolution (the auth cell's `validateToken` publish seam)

### What it does
`validateToken` (`services/auth/service.ts:112`) wraps `validateBearer(token, store)` (`oauth.ts:716`): SHA-256s the presented value, reads the `TOKEN#<hash>` row (rejecting revoked/expired), resolves the durable account UUID (`mintedBy`) back to the human username via `getUserById` so scopes/ownership/addresses stay readable, and returns a `ValidatedToken`. `identityFromValidated` (`define-service.ts:122`) maps that onto `Identity`. This is the bridge the entire platform runtime uses — no other cell reads the auth table; they call this command through `resolveHttpIdentity`.

### Public API
```ts
validateToken(input: { token: string }): Promise<ValidatedToken | null>   // service.ts:112
validateBearer(token: string, store: AuthStore): Promise<ValidatedToken | null>  // oauth.ts:716
identityFromValidated(validated: ValidatedToken): Identity                // define-service.ts:122

interface ValidatedToken {   // oauth.ts:663
  userId: string;
  scope: string;              // the granted ceiling
  effectiveScope: string | null;  // ≤ grant; null ⇒ full grant effective
  tokenId: string;
  clientId: string | null;
  posture: TokenPosture | null;
  act: ActClaim | null;
}
```

### Data model
Reads `TOKEN#<sha256(token)>` (`mintedBy`, `scope`, `effectiveScope?`, `posture?`, `act?`, `clientId`, `revoked`, `expiresAt`). `identityFromValidated`: `scopes` = `effectiveScope` split (or full grant when null), `grantScopes` = grant ceiling, `actor` = `agent` when `clientId || act` present else `human` (`define-service.ts:137`).

### Invariants & edge cases
- **Tokens stored ONLY as SHA-256 hashes** (`store.sha256`, `store.ts:44`); the raw value is never persisted.
- **The exposed principal is the human username**; the durable account UUID (`mintedBy`) stays the credential-storage anchor, resolved back via `getUserById` (`oauth.ts:724`). Falls back to `mintedBy` when the account can't be resolved.
- **`actor = 'agent'` iff `clientId` or `act` is present, else `'human'`** — a DCR/connected-client token no longer reads AS the human (ADR-0022 × ADR-0050). Salience weights attention by this class.
- **The auth service resolves itself as ANONYMOUS** (`serviceName === authService` short-circuit, `define-service.ts:170`) — no recursive self-validation.

### Reduces to
**`cell`** — this IS the auth cell's `describeTypes`/command publish seam: `validateToken` is a bounded, IAM-isolated, event-source-attested command invoke other cells reach only via `serviceClient`. **`projection`** — the resolved `Identity` is what every downstream `Projection.select` scores/filters against (scope gate + salience `actorClass` weighting). It does **NOT** reduce to Fact: the token record is a hashed row in the cell's own scratch table.

### Connections
Consumed by `resolveHttpIdentity` (`define-service.ts:141`) at every HTTP request boundary; the produced `Identity` flows into every command's `ctx.identity`, the gateway's `enforceScope`, and the workspace read pipeline's salience.

### Motivating ADRs
- **ADR-0022** — Scopes & consent
- **ADR-0024** — Delegation chains (`act`)
- **ADR-0050** — Actor / embodiment class
- **ADR-0080** — Stable refresh / degraded auth semantics

---

## Capability 3 — Bearer-only HTTP identity with the narrow navigation-cookie carve-out

### What it does
`resolveHttpIdentity` (`define-service.ts:141`) is the single place client credentials become identity on the HTTP path. It trusts ONLY a validated `Authorization: Bearer` (or the edge-preserved `x-forwarded-authorization` when OAC overwrites `Authorization` with its SigV4 sig) — **never** client-supplied `x-auth-*` headers. The one carve-out: the `parc_session` cookie.

### Public API
```ts
resolveHttpIdentity(headers, serviceName, method?): Promise<ResolvedIdentity>  // define-service.ts:141
identityFromHeaders(headers): Identity   // auth.ts:138 — retained, NOT on the HTTP path today
withIdentity(ctx: ServiceContext, patch: Partial<Identity>): ServiceContext    // define-service.ts:219
// Identity.degraded?: boolean   // auth.ts:120
```

### Data model
Reads request headers: `authorization`, `x-forwarded-authorization`, `cookie` (`parc_session` / `parc_refresh`), `sec-fetch-dest`. Emits `ResolvedIdentity { identity, setCookies? }`. Cookies are `HttpOnly` / `Secure` / `SameSite=Lax`.

### Invariants & edge cases
- **`x-auth-*` headers are NEVER trusted on the HTTP path** — CloudFront forwards all viewer headers, so trusting them is spoofable. `identityFromHeaders` (`auth.ts:138`) is retained only for a hypothetical future trusted-edge authorizer.
- **The cookie carve-out is deliberately tight** (`define-service.ts:161`): honoured ONLY when `serviceName === 'dispatch'` **AND** method is `GET`/`HEAD` **AND** `Sec-Fetch-Dest: document` (a genuine, JS-unforgeable top-level navigation). A hostile cell's `fetch()` (`empty`) or `<iframe>` (`iframe`) can't ride your ambient cookie, and the cookie can never authorize a mutation (no CSRF).
- **`degraded=true`** (auth cell unreachable/throwing, `define-service.ts:208`) must map to **503 `auth_unavailable`, never 401 `invalid_token`** (ADR-0080) — so clients retry rather than discard a good token. The credential was never actually checked.
- **The auth cell itself, and any registry missing the auth service, resolve ANONYMOUS** (`define-service.ts:170,173`).
- **`withIdentity` rebuilds the `serviceClient`** (`define-service.ts:219`), not just the identity object — the client's envelope options were captured at context construction, so a bare identity mutation would never propagate downstream.

### Reduces to
**`edge-http`** — this is the runtime half of the Edge HTTP contract: it consumes exactly the headers the three Lambda@Edge transforms produce (`x-forwarded-authorization` restoration, OAC body-signing) and turns CloudFront + IAM-auth Function URL into an authenticated Cell face. **`cell`** — its whole job is to build the `ctx.identity` every Cell command runs under. Not Fact/projection — credential-plumbing at the request boundary.

### Connections
Calls the auth cell's `validateToken` (Cap 2) and `refreshSession` (Cap 7). Emits `setCookies` consumed by the dispatch tier. `x-cell-caller` (never the token) is what reaches dynamic cells downstream (`callCell`).

### Motivating ADRs
- **ADR-0021** — Two-horizon sessions (access + refresh cookies)
- **ADR-0080** — Degraded-auth 503 semantics
- **ADR-0008** — Cell / origin isolation

---

## Capability 4 — Token-as-principal minting and lifecycle (narrow-only ceiling)

### What it does
`mintToken` (`service.ts:148`) mints a bearer clamped to `intersectScopes(requested, grantScopesOf(ctx.identity))` — the minter's **GRANT ceiling** (not its possibly-narrowed session focus). `updateToken` (`service.ts:291`) stewards a live token you own. `revokeToken` (`service.ts:319`) is idempotent and owner-keyed. `tokens`/`listTokens` are the steward roster. `mintTokenFor` (`service.ts:245`) is the non-gateway-exposed reactor path.

### Public API
```ts
mintToken(input: { scope; label?; expiresInSec?; withRefresh? }, ctx): MintedToken & { scope }  // service.ts:148
updateToken(input: { tokenId; label?; scope?; expiresInSec?|null }, ctx)                        // service.ts:291
revokeToken(input: { tokenId }, ctx): { revoked: boolean }                                      // service.ts:319
tokens(_, ctx): { tokens: TokenSummary[] }  /  listTokens(_, ctx): TokenSummary[]               // service.ts:268,273
mintTokenFor(input: { owner; scope; expiresInSec?; label?; actor? }, ctx)  // service.ts:245 — NOT gateway-exposed
store.mintToken(params: MintTokenParams): Promise<MintedToken>             // store.ts:257
```

### Data model
```
TOKEN#<hash>  { id, tokenHash, mintedBy(UUID), scope, effectiveScope?, posture?, act?,
                label, clientId, revoked, expiresAt, refreshHash?, ttl }
USERTOK#<userId> sk=<tokenId>   — the steward-list index
REFRESH#<hash>  — self-contained
TokenSummary { id, scope, label, clientId, revoked, expiresAt, createdAt, act? }   // store.ts:170
```

### Invariants & edge cases
- **`effective = requested ∩ minter's GRANT`** (`grantScopesOf`, `service.ts:159`), never the narrowed session focus — narrow-only, whoever mints (ADR-0022 §2). Empty intersection throws `scope_denied` (`service.ts:161`).
- **A caller whose identity arrives with no scopes cannot mint at all** (empty ceiling ⇒ empty intersection ⇒ throw).
- **`revoke` is idempotent, owner-keyed, and cascades to the paired `REFRESH#` row** so a revoked access token can't be resurrected by refresh.
- **`updateToken` re-scoping resets `effectiveScope`** so the new grant is fully effective; `scope` is clamped to the caller's own ceiling exactly like `mintToken`.
- **`mintTokenFor` is invisible to `describeTools`** — only IAM-allowed direct service invokes reach it, so an external caller cannot mint for someone else. It defaults to 900s expiry and can start a depth-1 `act` chain (`service.ts:255`).
- Every command emits an `auth.token.*` event (`service.ts:703`).

### Reduces to
**`cell`** — these are the auth cell's `act`-kind commands, IAM-gated. **`fact`** (weakly) — a minted token *becomes* a principal, i.e. it defines a future Fact's `(scope,key)` authority anchor and its writer stamp — but the token rows are the cell's own scratch storage, not substrate facts. So it is honestly its own keyed store that the Fact primitive depends on rather than a reduction to Fact.

### Connections
Depends on Cap 1 (scope algebra) and Cap 11 (storage). Feeds the OAuth token endpoint (Cap 6) and token exchange (Cap 8), which both call `store.mintToken`.

### Motivating ADRs
- **ADR-0022** — Scopes & consent (narrow-only)
- **ADR-0024** — Delegation (`mintTokenFor` depth-1 chain)
- **ADR-0007** — Grants

---

## Capability 5 — Incremental authorization (session-mutable effective scope within the grant ceiling)

### What it does
A token carries two scope sets: the immutable **GRANT ceiling** (set at consent) and a mutable **session effective** subset. `scope` (command name `scopeView`, `service.ts:333`) reports both. `focusScope` (`service.ts:343`) narrows the session (start-minimal, shrink blast radius). `requestScope` (`service.ts:363`) widens back UP toward the ceiling.

### Public API
```ts
scope → scopeView(_, ctx): { effective: string[]; grant: string[] }       // service.ts:333
focusScope(input: { scopes }, ctx): { effective; grant }                  // service.ts:343
requestScope(input: { scopes }, ctx): { effective; grant; granted; denied } // service.ts:363
store.setEffectiveScope(tokenId, userId, effectiveScope: string|null): Promise<boolean>  // store.ts:265
```

### Data model
`effectiveScope` attribute on the `TOKEN#<hash>` row (space-joined); `null`/REMOVE ⇒ full grant effective. Owner-keyed writes via the `USERTOK#` index → `TOKEN#` row. In `Identity`: `scopes` = effective, `grantScopes` = ceiling.

### Invariants & edge cases
- **Effective scope can be narrowed and widened freely WITHIN the ceiling with no re-consent**; it can never exceed `grantScopes` (both go through `intersectScopes(..., grant)`, `service.ts:350,375`).
- **`requestScope.denied`** = requested scopes outside the ceiling (`!hasGrantScope`, `service.ts:373`). This is the boundary between self-serve widen and hard `scope_denied` → human re-consent (ADR-0022 §3). `granted = denied.length === 0`.
- **`requestScope` unions the current focus with the requested-within-ceiling, then re-clamps** (`service.ts:375`).
- **Both require a `tokenId`** (a bearer session) — internal/event identities without one throw (`service.ts:346,369`).

### Reduces to
**`cell`** — act/read commands on the auth cell mutating its own token row. **`projection`** — the effective scope is precisely the filter the read pipeline's grant gate applies: narrowing the session narrows what `select` returns / what tools are advertised, without a new credential. Stored on the same scratch `TOKEN#` row (`effectiveScope` attribute), not a Fact.

### Connections
Depends on Cap 1 and Cap 2. The gateway raises a `scope_offer` that points at `requestScope`; `scope_denied` points at the human re-consent path.

### Motivating ADRs
- **ADR-0022** — Scopes & consent (incremental authorization)
- **ADR-0007** — Grants

---

## Capability 6 — OAuth 2.1 authorization server (discovery, DCR, PKCE code, device grant) + cell ceiling

### What it does
The raw-HTTP OAuth surface in `oauth.ts`: RFC 9728 PRM, RFC 8414 AS metadata, RFC 7591 Dynamic Client Registration, the consent flow, the token endpoint (authorization_code + refresh + device_code + token-exchange), and the RFC 8628 device authorization grant. `cellCeiling` caps a token minted for a host-isolated cell host.

### Public API
```ts
handlePRM(req, config) / handleASMetadata(req, config)          // oauth.ts:268,278
handleDCR(req, store)                                            // oauth.ts:302
handleConsent(req, store, config) / handleGrantableScopes(...)  // oauth.ts:338,379
handleToken(req, store, config)  // authorization_code | refresh_token | device_code | token-exchange  // oauth.ts:426
handleDeviceInit / handleDeviceInfo / handleDeviceApprove       // oauth.ts:616,639,650
cellCeiling(redirectUri): string[] | null                       // oauth.ts:32
grantableScopes(config, username): string[]                     // oauth.ts:138
isSelfGrantableGranular(scope): boolean                         // oauth.ts:196
clampGrant(requested, config): number | null   // [MIN_GRANT_SECS=300, refreshExpirySecs]  // oauth.ts:218
```

### Data model
```
CLIENT#<id>   { clientSecret?, redirectUris, clientName }
CODE#<code>   { clientId, userId, redirectUri, codeChallenge, scope?, resource?, grantSecs?, used, ttl }
DEV#<deviceCode> + DEVUC#<userCode>  { scope, status, approvedBy, ttl }
SESS#<id>     { userId, scope, ttl }
```
All TTL-expired by the `ttl` attribute. Auth-code consumption is a conditional update (`used=false → true`) — single-use even under race.

### Invariants & edge cases
- **PKCE S256 mandatory** on authorization_code (`sha256(verifier) === stored codeChallenge`, `oauth.ts:452`); auth codes are **single-use** and `redirect_uri`/`client_id`-bound (`:444,448`).
- **Consent re-gates scopes server-side** against `grantableScopes(user) ∪ isSelfGrantableGranular` (`oauth.ts:356`) — the page's requested set is not trusted.
- **`cellCeiling`** caps a cell-host token (`<owner>-<name>.<CELL_DOMAIN_SUFFIX>`) to `[workspace:read, workspace:write, cell:<owner>/<name>:*]` — never `platform:*`, cell-creation, or another cell (model A, `docs/cell-origin-isolation.md`, `oauth.ts:32-46`). Applied at the token endpoint (`oauth.ts:459`).
- **Admin-prefixed scopes** (default `platform:`) are grantable only to configured `adminUsernames` (`grantableScopes`, `oauth.ts:138`).
- **Device grant is all-or-nothing** (RFC 8628) but **discloses scopes** (`handleDeviceInfo`, session-gated, `oauth.ts:639`) before approval.
- **Grant lifetime** is clamped to `[MIN_GRANT_SECS=300, refreshExpirySecs]` (`clampGrant`, `oauth.ts:218`); the picker can only *narrow*.
- On a **non-expiring deployment** (`tokenExpirySecs ≤ 0`), the refresh_token grant returns `unsupported_grant_type` (`oauth.ts:511`) and access tokens are finite only if the user chose a lifetime (`oauth.ts:471`).

### Reduces to
**`cell`** — the whole OAuth server is the auth cell's raw `http` routes on `defineService` (IAM-isolated Lambda). **`edge-http`** — these endpoints are reached through the same CloudFront + Function-URL face, and DCR/token carry CORS (`authCors`, `service.ts:665`) for cross-origin fetch by host-isolated cell origins — the origin-isolation seam. Not Fact/projection: OAuth state is TTL'd scratch-table rows.

### Connections
Depends on Cap 1, Cap 10 (consent catalog), Cap 11 (storage), Cap 4 (minting). `handleToken` calls `delegationActorForRedirect` (Cap 8) to stamp connected-client tokens.

### Motivating ADRs
- **ADR-0022** — Scopes & consent
- **ADR-0023** — Granular per-type scopes
- **ADR-0008** — Cell / origin isolation
- **ADR-0007** — Grants

---

## Capability 7 — Session silent-refresh with a stable refresh credential

### What it does
Two horizons, two credentials (ADR-0021): a short **access token** (the presented bearer) and a long **refresh token** (grant horizon, e.g. 30d) carried in the `HttpOnly`/`Secure`/`SameSite=Lax` `parc_refresh` cookie plus the JS client's localStorage. On a top-level navigation where the access cookie is missing/expired, `resolveHttpIdentity` calls `refreshSession` → `handleRefreshSession` → `store.refreshUnifiedToken`, minting a fresh short access token and re-priming both cookies — no passkey round-trip.

### Public API
```ts
refreshSession(input: { refreshToken }): RefreshedSession | null            // service.ts:125
handleRefreshSession(refreshToken, store, config): RefreshedSession | null  // oauth.ts:696
store.refreshUnifiedToken(oldRefreshHash, newExpiresInSec?, newRefreshExpiresInSec?): RefreshResult | null  // store.ts:285
handleToken grant_type=refresh_token   // oauth.ts:509
handleRevoke(req, store)  // RFC 7009  // oauth.ts:606
// RefreshResult.refreshToken is OPTIONAL — absent ⇒ keep presenting the held value (stable)  // store.ts:183
```

### Data model
```
REFRESH#<sha256(refresh)>  { tokenId, tokenHash, mintedBy, scope, clientId, act?, revoked, expiresAt(long), ttl }
```
Self-contained; validated on its OWN expiry (the access row may already be TTL-gone). `parc_session`/`parc_refresh` cookies are `HttpOnly`+`Secure`+`SameSite=Lax`.

### Invariants & edge cases
- **The refresh credential is STABLE — never rotated** (ADR-0080, `store.ts:183`, `oauth.ts:518`). The `REFRESH#` row is kept, repointed at the newest access token and its expiry slid; the prior access token reaches its natural short expiry rather than being revoked. This is because the **same** refresh value legitimately lives in two holders (cookie + localStorage), so single-use rotation made whichever refreshed first sign the other out.
- **The refresh row carries its OWN longer expiry** so it outlives (and survives the TTL of) the access row it renews.
- **Cookies never authorize mutations** (safe-method top-level navigation only) and are cleared on `/oauth/revoke` (`handleRevoke` returns `clearSessionCookie()` + `clearRefreshCookie()`, `oauth.ts:611`).
- **Non-expiring deployments** (`tokenExpirySecs ≤ 0`) do not refresh — `refreshSession`/`handleRefreshSession` return `null` (`oauth.ts:700`).
- **Explicit revoke** (`revokeToken` / RFC 7009 `/oauth/revoke`, by access OR refresh value) still cascades and kills the whole chain (`revokeByTokenValue`, `store.ts:296`).
- **The `act` delegation chain rides the refresh row** so it survives every re-mint (ADR-0024).

### Reduces to
**`cell`** — `refreshSession` is a self-authorizing auth-cell command (the refresh token IS the credential, like `validateToken`). **`edge-http`** — silent-refresh happens AT the dispatch edge on a safe navigation and re-primes cookies through the same CloudFront/Function-URL response path. State (`REFRESH#` rows) is scratch storage, not Fact.

### Connections
Depends on Cap 2 (`validateBearer` re-validates the freshly-minted token in `handleRefreshSession`, `oauth.ts:703`) and Cap 11. Consumed by `resolveHttpIdentity` (Cap 3).

### Motivating ADRs
- **ADR-0021** — Two-horizon sessions
- **ADR-0080** — Stable refresh (no rotation)
- **ADR-0024** — `act` chain survives re-mint

---

## Capability 8 — Delegation-chain token exchange (RFC 8693 sub+act)

### What it does
`performTokenExchange` (`oauth.ts:767`) is the **one exchange core**, shared by the `auth.exchangeToken` gateway command (`service.ts:206`) and the `/oauth/token` `grant_type=token-exchange` surface (`oauth.ts:550`). It validates a presented PARENT token (self-authorizing — the parent value IS the credential), clamps the child to `intersectScopes(requested, parent.scope)`, and mints a child carrying `act = {sub: actor, act: parentChain}` (outermost = leaf).

### Public API
```ts
performTokenExchange(store, { from, scope, actor?, label?, expiresInSec? }): TokenExchangeResult  // oauth.ts:767
exchangeToken(input, ctx)  // wraps + emits auth.token.exchanged  // service.ts:206
delegationActorForRedirect(redirectUri, asOrigin, clientName, clientId): string | null  // oauth.ts:95
mintTokenFor(input: { owner, scope, actor?, ... }, ctx)  // depth-1 chain for rail agents  // service.ts:245
unwindActChain(act): string[]        // auth.ts:57
leafActOf(identity): string | null   // auth.ts:64
chainDepth(act): number              // store.ts:19
chainActors(act): string[]           // store.ts:26
MAX_DELEGATION_DEPTH = 8             // store.ts:16
```

### Data model
```
ActClaim { sub: string; act?: ActClaim }   // nested, outermost = leaf   // auth.ts:51
```
Rides `TOKEN#`, `USERTOK#` and `REFRESH#` rows and `TokenSummary.act`. Exchange error prefixes: `invalid_grant:` / `scope_denied:` / `delegation_too_deep:` / `delegation_loop:`.

### Invariants & edge cases
- **Child scope = `min(requested, PARENT token's grant)`** — the ceiling is the *parent's grant*, not the caller's session (`oauth.ts:776`), so a chain only narrows hop-over-hop whoever performs the exchange.
- **The child's SUBJECT stays the parent's subject** (`oauth.ts:798-800`) — authorization anchors to the original consenting human; `act` is **provenance only** and never enters a scope check. The workspace writer stamp reads the LEAF (`leafActOf`, `auth.ts:64`; `platform/runtime/state.ts` `EntryMeta`).
- **Depth-bounded**: `chainDepth(parentChain) + 1 > MAX_DELEGATION_DEPTH(8)` → `delegation_too_deep` (`oauth.ts:790`).
- **Loop-guarded**: an actor may not reappear in the chain (`chainActors(parentChain).includes(actor)`) nor equal the subject (`actor === parent.userId`) → `delegation_loop` (`oauth.ts:793`).
- **Both surfaces call the SAME `performTokenExchange`** so the command and the RFC 8693 grant cannot drift.
- **`delegationActorForRedirect`** (`oauth.ts:95`) makes connected clients actors from mint: same-origin SPA → `null` (root/human); cell host → `cell:<owner>/<name>`; foreign origin → `client:<name>`.
- **Device-code tokens stay root** (no client identity on that path — `handleToken` device branch mints with no `act`, `oauth.ts:534`).

### Reduces to
**`cell`** — `exchangeToken` is an act-command; the exchange also rides the OAuth cell endpoint. **`fact`** — it genuinely *compounds on* Fact via provenance: the delegation chain exists so that a Fact's writer stamp (`state.ts` `EntryMeta`, `leafActOf`) attributes the LEAF actor while scope/subject authorization is unchanged. This is the auth-side of the Fact server-stamp. Chain storage is on scratch token rows, but its whole reason for being is the Fact writer stamp.

### Connections
Depends on Cap 1, Cap 2, Cap 4. Feeds `platform/runtime/state.ts` writer stamps.

### Motivating ADRs
- **ADR-0024** — Delegation chains (`act`)
- **ADR-0025** — Delegation attention reassessment
- **ADR-0022** — Scopes & consent
- **ADR-0007** — Grants

---

## Capability 9 — Principal-adopted posture (goal/lens/salience riding the token)

### What it does
`adoptGoal`/`dropGoal` (`service.ts:403,425`, ADR-0074) attach a mutable posture `{goal, lens, salience, adoptedAt}` to a token record — **what the session is FOR, not what it may touch**. Threaded into `Identity.posture` by `validateBearer` and into the command envelope, the workspace read path resolves its defaults through it (`defaults ← config ← PRINCIPAL ← lens ← override`).

### Public API
```ts
adoptGoal(input: { tokenId?, goal?, lens?, salience? }, ctx)   // service.ts:403
dropGoal(input: { tokenId? }, ctx)                             // service.ts:425
store.setPosture(tokenId, userId, posture: TokenPosture | null): Promise<boolean>  // store.ts:271
interface PrincipalPosture / TokenPosture { goal?, lens?, salience?, adoptedAt? }  // auth.ts:35 / store.ts:146
```

### Data model
`posture` attribute on `TOKEN#<hash>` (owner-keyed writes via the `USERTOK#` index); `null`/REMOVE clears. Threaded onto `Identity.posture` and command envelopes. Emits `auth.goal.adopted` / `auth.goal.dropped`.

### Invariants & edge cases
- **Posture biases ranking only** — it never touches scope or membership; a caller's per-call args always win over it.
- **Default-inert**: a token with no posture behaves exactly as before.
- **Requires a `tokenId`** (own session token or an explicit child token the caller minted, `service.ts:405,427`) — a minter may posture a child token it owns (delegation attenuates attention, not just scope).
- `goal` is ideally a workspace `goal/<id>` fact key or free text; `lens`/`salience` are an open read-bias vocabulary the reader validates (unknown names ignored, never fatal).
- **A per-participant posture** (`_posture/<participant>` fact, ADR-0086) can override the token posture — one level finer.
- `adoptGoal` requires at least one of `goal`/`lens`/`salience` (`service.ts:407`).

### Reduces to
**`cell`** — act commands mutating the token row. **`projection`** — posture biases the score→shape stages of the read pipeline (salience weights, lens); it "biases RANKING only, never scope or membership." The goal often POINTS at a Fact (`goal/<id>`) but the posture itself is stored on the scratch token row, interpreted by the projection read path.

### Connections
Depends on Cap 2 (threading via `validateBearer`). Consumed by the workspace read pipeline's salience/lens resolution.

### Motivating ADRs
- **ADR-0074** — Principal-adopted goals/posture
- **ADR-0086** — Per-participant posture (`as` key)
- **ADR-0024** — Delegation attenuates attention

---

## Capability 10 — Consent-screen scope catalog and capability metadata

### What it does
The legibility layer for consent (`docs/capability-consent.md`): `scopeMeta(scope)` (`oauth.ts:167`) maps a scope to `{verb, title, description}` from a static `SCOPE_CATALOG`, falling back to structural inference. `grantableScopes` returns the scopes a user may grant; `handleGrantableScopes` (`oauth.ts:379`) also surfaces requested self-grantable granular scopes, the originating cell (`cellFromRedirect`), and the grant-lifetime ceiling (`maxGrantSecs`).

### Public API
```ts
scopeMeta(scope): ScopeMeta { verb: 'read'|'write'|'admin'; title; description }   // oauth.ts:167
grantableScopes(config, username): string[]                                        // oauth.ts:138
isSelfGrantableGranular(scope): boolean                                            // oauth.ts:196
cellFromRedirect(redirectUri): { owner, name, address } | null                     // oauth.ts:54
handleGrantableScopes(req, store, config)  // → { username, scopes, catalog, clientName, resource?, maxGrantSecs }  // oauth.ts:379
```

### Data model
`SCOPE_CATALOG` static map (`oauth.ts:156`) + regex inference (`oauth.ts:172-184`). Consent response carries `{scopes, catalog(scope→ScopeMeta), clientName, resource:{kind:'cell',address}?, maxGrantSecs}`.

### Invariants & edge cases
- **Self-grantable granular scopes are bounded to `read|write:type:<T>` families only** (`isSelfGrantableGranular` regex, `oauth.ts:196`) — never admin/platform/cell scopes (the owner is inherently entitled to grant over their own slice).
- **Consent-time scope admission is authoritative** (`grantableScopes ∪ isSelfGrantableGranular`, `oauth.ts:356`); it does not trust the page's requested set.
- **Verb inference** (`scopeMeta`, `oauth.ts:180`) makes new/granular capabilities group sensibly with no catalog entry: `read:type:<T>`/`write:type:<T>` render as `Read/Write "<T>" facts`; unknown scopes infer verb from shape (admin/write/read regexes). Grouping by verb surfaces the Σ-calculus read=disclosure vs write/admin=consequential distinction.

### Reduces to
**`cell`** — auth cell http handlers. **`projection`** — essentially a `Projection.present` preset: it is the affordance-shaping stage applied to scope strings (select the grantable scopes, score/group by verb, present as labelled consent checkboxes). Pure metadata over the scope grammar; no Fact storage.

### Connections
Depends on Cap 1. Consumed by the consent SPA and the device-info disclosure (`handleDeviceInfo`, `oauth.ts:646`, uses the same catalog).

### Motivating ADRs
- **ADR-0023** — Granular per-type scopes
- **ADR-0022** — Scopes & consent

---

## Capability 11 — Auth storage model (AuthStore over the cell scratch table)

### What it does
The storage-agnostic `AuthStore` interface (`store.ts:217`) with two implementations — `createDynamoStore` (production single-table pk/sk over the `HttpServiceCell`-provisioned DynamoDB with native TTL) and `createMemoryStore` (tests/local) — chosen at import by whether `TABLE_NAME` is set (`service.ts:53`). This is the auth cell's own scratch persistence — the deliberate exception to "everything is a Fact."

### Public API
```ts
interface AuthStore {   // store.ts:217
  createUser, getUserByUsername, getUserById,
  saveCredential, getCredentialsByUserId, getCredentialById, updateCredentialCounter,
  saveChallenge, getChallenge, deleteChallenge,
  saveOAuthClient, getOAuthClient,
  saveAuthCode, consumeAuthCode,
  createSession, validateSession, deleteSession,
  mintToken, validateTokenByHash, setEffectiveScope, setPosture, updateToken,
  refreshUnifiedToken, revokeToken, revokeByTokenValue, listUserTokens,
  createDeviceCode, getDeviceCode, getDeviceCodeByUserCode, approveDeviceCode, consumeDeviceCode
}
createDynamoStore(tableName): AuthStore
createMemoryStore(): AuthStore
sha256 / generateToken / generateId / generateUserCode   // store.ts:44,38,34,324
// TTL consts: CHALLENGE 5m, CODE 10m, SESSION 15m, DEVICE 15m, REFRESH 30d  // store.ts:308-313
```

### Data model
Single pk/sk table, `sk='A'` for profile items. pk namespaces: `USER#`/`UNAME#`, `CRED#`, `CHAL#`, `CLIENT#`, `CODE#`, `SESS#`, `TOKEN#`(by hash), `USERTOK#`(by userId, sk=tokenId), `REFRESH#`(by hash), `DEV#`/`DEVUC#`. The `ttl` attribute drives native expiry. Secondary lookups are modelled as **index ITEMS** (`UNAME#`, `USER#`/`CRED#`, `USERTOK#`, `DEVUC#`) rather than GSIs so it runs on the standard platform table. The memory store mirrors the same semantics.

### Invariants & edge cases
- **Tokens persisted only as `SHA-256(base64url)` hashes** (`store.ts:44`) — raw values never stored.
- **`TOKEN#` is the authoritative row** `validateTokenByHash` reads; `USERTOK#` is the steward-list index; `setEffectiveScope`/`setPosture`/`updateToken` keep them in sync via the `USERTOK#`→`tokenHash` link.
- **`REFRESH#` rows are self-contained** with their own longer expiry so they survive the access row's TTL.
- **`consumeAuthCode` / `approveDeviceCode` use conditional writes** for single-use / race-safety.
- **The two stores are behavior-equivalent** (the gate test in `tests/auth-oauth.test.ts`).

### Reduces to
**`cell`** — and an *honest re-introduction of a keyed store* rather than a reduction to Fact. The mandate says Fact is the keyed `{value,_meta}` row at `(scope,key)` in the substrate, but auth keeps its own DynamoDB rows **OUTSIDE** the substrate. Correct and necessary: auth is what mints the principals that become Fact scopes, so it cannot itself live behind the `scope = IAM-principal` partitioning. It is a Cell's bounded scratch table (the cell axis's scratch-table facet), not the shared blackboard.

### Connections
Underpins every other auth capability. Provisioned by `platform/infra/http-service-cell.ts`.

### Motivating ADRs
- **ADR-0022** — Scopes & consent
- **ADR-0080** — Stable refresh (`RefreshResult.refreshToken` optional)
- **ADR-0008** — Cell isolation

---

## Capability 12 — WebAuthn passkey registration and authentication

### What it does
The first-party human sign-in: `/webauthn/register/{options,verify}` and `/webauthn/authenticate/{options,verify}` over `@simplewebauthn/server` (`services/auth/webauthn.ts`). Registration enforces the username is a single hyphen-free DNS label, creates the user + stores the credential public key/counter, and opens a consent session. Authentication verifies the assertion, bumps the signature counter, and opens a session.

### Public API
```ts
handleRegisterOptions(req, store, config) / handleRegisterVerify(req, ctx, store, config)  // webauthn.ts:68,102
handleAuthOptions(req, store, config) / handleAuthVerify(req, store, config)               // webauthn.ts:154,175
allowedOrigins(req): string[]   // pinned to shell origin(s), NOT *.parc.land  // webauthn.ts:47
rpIdOf(req, config)                                                             // webauthn.ts:30
```

### Data model
```
USER#<id> + UNAME#<username> index
CRED#<id>  { userId, publicKey(b64url), counter, transports, rpId }
           + USER#<id> sk=CRED#<id> index for allowCredentials
CHAL#<id>  { challenge, type, userId?, ttl=5min }
```
Register emits `auth.user.registered`.

### Invariants & edge cases
- **Username must match `^[a-z0-9]+$`** (`webauthn.ts:81`) — a single DNS label, hyphen-free — because it becomes the owner segment of a cell subdomain (`<username>-<cellname>.on.parc.land`), and the host→cell rewrite splits on the first hyphen as the owner/cell separator.
- **WebAuthn verification origins are pinned to the configured shell origins** (`allowedOrigins`: `PUBLIC_BASE_URL` + `WEBAUTHN_EXPECTED_ORIGINS`, `webauthn.ts:47`), **NOT** to any `*.parc.land` host — because RP ID `parc.land` is a registrable suffix of every cell subdomain, so a cell origin could otherwise assert it and phish a passkey (`docs/cell-origin-isolation.md §4.4`). Falls back to the request origin only when nothing is configured.
- **Signature counter is updated on every successful authentication** (`updateCredentialCounter`, `webauthn.ts:214`) — clone/replay detection.
- **Challenges are single-use** (deleted on verify, `webauthn.ts:144,215`) and TTL-bounded (5 min).
- `handleAuthVerify` returns a specific diagnostic when the credential is unknown to the server (likely registered against a different RP id/origin, `webauthn.ts:191`).

### Reduces to
**`cell`** — raw http routes on the auth cell. **`edge-http`** — origin/RP-ID pinning is the auth counterpart to cell origin-isolation: the same domain seam the edge enforces. Not Fact: credentials/challenges are scratch-table rows with challenge TTL.

### Connections
Depends on Cap 11 (storage). Opens the consent session consumed by Cap 6 (`handleConsent`) and the device-approval flow.

### Motivating ADRs
- **ADR-0008** — Cell / origin isolation (anti-phishing RP-ID pinning)
- **ADR-0022** — Scopes & consent (sign-in opens a consent session)

---

## Gotchas / non-obvious behavior

- **Auth is the ONE keyed store outside the substrate.** If you are tempted to "make tokens Facts," don't — auth mints the principals that become Fact scopes, so it cannot live behind the `scope = IAM-principal` partitioning. Its scratch table (`store.ts`) is intentional (Cap 11).
- **Two scope sets on every token.** `Identity.scopes` is the *effective* (enforced-now) set; `Identity.grantScopes` is the *ceiling*. `hasScope` reads effective; `hasGrantScope` reads the ceiling. `mintToken`/`updateToken`/`exchangeToken` all clamp to the **grant ceiling** (or the parent's grant), never the possibly-narrowed session focus (`service.ts:159`).
- **`grantScopesOf` back-compat.** When `grantScopes` is absent it equals `scopes` (`auth.ts:285`) — a session that never narrowed. Don't assume `grantScopes` is always populated.
- **Trailing `*` does not match the pattern's own prefix.** `a:b:*` covers `a:b:c` but **not** `a:b` itself (`matchesScope`, `auth.ts:172` requires `s.length > i`). Easy to get wrong when designing new scope patterns.
- **`impliesScope` is inert today** — it only fires for granular required scopes (`read:`/`write:`/`act:`/`cells:create`) that no tool declares yet, and only widens. It is a Phase-2 migration shim, not live enforcement.
- **`x-auth-*` headers are dead on the HTTP path.** `identityFromHeaders` (`auth.ts:138`) still exists but is only for a hypothetical future trusted-edge authorizer. Never trust these from CloudFront.
- **The `parc_session` cookie is honoured ONLY for `dispatch` + GET/HEAD + `Sec-Fetch-Dest: document`.** Absent `Sec-Fetch-Dest` (curl, old clients) is treated as non-navigation. The gateway (`/mcp`) stays strictly bearer-only. A cookie can never authorize a mutation.
- **`degraded` must become 503, not 401.** When the auth cell errors, `resolveHttpIdentity` returns `{...ANONYMOUS, degraded:true}` (`define-service.ts:208`). Downstream HTTP seams must map this to `auth_unavailable`/503 (ADR-0080) so clients retry rather than discard a good token.
- **The refresh credential is STABLE — never rotate it.** ADR-0080. Because the same refresh value lives in both the `parc_refresh` cookie and localStorage, single-use rotation signed one holder out. `RefreshResult.refreshToken` is *optional*: absent ⇒ keep presenting the held value.
- **`act` is provenance ONLY.** The delegation chain never enters a scope check — the subject (the original consenting human) drives every authorization; the chain only decides the workspace *writer stamp* (`leafActOf` → `state.ts`). Scope is already clamped hop-by-hop.
- **`Identity.participant` (ADR-0086) is also provenance-only** and trust-grade of `via` — no filter/grant/guard may condition on it; real delegation uses child tokens (Cap 8).
- **`mintTokenFor` is invisible to `describeTools`.** It is reachable only by IAM-allowed direct service invokes (the reactor), so external callers cannot mint-for-others (`service.ts:245`).
- **Both exchange surfaces share `performTokenExchange`.** The `auth.exchangeToken` command and the `/oauth/token` RFC 8693 grant call the identical core (`oauth.ts:767`) so they cannot drift — modify only the shared function.
- **The auth cell resolves ITSELF as anonymous** (`serviceName === authService`, `define-service.ts:170`) — no recursive self-validation; its own OAuth endpoints don't need it.

> ⚠ **Coherence — duplicated admin gate in workspace search (low, conflicts, adjacent).** Three literal copies of the same admin disjunction exist in `services/workspace/commands-search.ts` (`reindex` ~L408, `project` ~L432, `pruneSimilar` ~L462): `if (!hasScope(ctx.identity,'workspace:admin') && !hasScope(ctx.identity,'platform:*')) throw ...`. `shared.ts` exposes only read/write assertions — there is **no `requireAdmin` helper**. Note that athena (`commands-athena.ts:149`) deliberately uses a *stricter* `requireScope(ctx.identity,'platform:*')` — verified narrower because `impliesScope` returns `false` for a coarse required scope, so `workspace:admin` does NOT satisfy `platform:*` (`auth.ts:252-268`); athena's stricter bar is intentional (it reads across every scope). The real defect is narrow: three duplicated inline admin disjunctions with no shared helper — a DRY/drift maintainability risk, **not** a current behavioral bug or security hole. **Recommendation: extract one `requireAdmin(identity)` helper (into `shared.ts` or `auth.ts`), reuse it in reindex/project/pruneSimilar, and deliberately decide + comment whether athena's whole-lake read keeps its stricter `platform:*` bar.**
