# Plan — token-as-principal & embodiment

> Status: **plan** (for review before coding). Grounds in the `sync.parc.land`
> prior art (`/docs/agency-and-identity`, `/docs/agent-sync-technical-design` §4,
> and the v9 "Authentication & Agent Identity" README) and the shipped
> incremental-authorization work (`docs/capability-consent.md` Phase 3).

## The idea

When you connect a client (Claude.ai, a device) it gets a token, but the token is
a static minted string — you can `revoke` it, not *steward* it. The vision: a
connected client's credential is a **first-class principal** you can **edit,
upgrade/downgrade, refresh, and revoke** over its life, with optional **embodiment**
(the client chooses *who it acts as*), not a write-once secret.

## Prior art (sync.parc.land) — the transferable model

- **Credential = embodied principal.** sync's `as_<agent>` token *is* an identity;
  each call resolves identity from a **mutable session row** (`token_hash →
  {agent_id, scope}`) — *"the session row IS the state"* — so a principal is **edited
  in place**, not reissued.
- **Complete lifecycle:** `POST /tokens` (mint) · `GET /tokens` (list) · **`PATCH
  /tokens/:id` (re-scope/upgrade, bounded by your own access)** · `DELETE` (revoke) ·
  `POST /tokens/refresh`. Invariant: `effective = min(token.scope, role)` —
  **narrow-only relative to your own standing**.
- **In-band scope elevation:** on `scope_denied` the server returns a **stateless
  elevation URL**; the agent shows it to the human → passkey → choose access →
  server patches the token's scope → agent retries. Embodiment never resets.
- **Embodiment is intentional, separate from auth:** OAuth scope is the *ceiling*;
  choosing who you act *as* is a deliberate tool call (`sync_embody`). *"Presence is
  an artifact of intentional engagement, not a side effect of authentication."*
- **Registrar-identity bridging:** an action registered by Alice, invoked by Bob,
  **runs with Alice's authority** — capability delegation decoupled from the caller.

## What this platform already has

- **Incremental authorization** (Phase 3): a token's **effective scope** is a
  mutable subset of its **grant** (the immutable ceiling) —
  `auth.scope`/`focusScope`/`requestScope`; the gateway raises **`scope_offer`**
  (self-serve widen within grant) vs **`scope_denied`** (outside grant → re-consent).
- `auth.mintToken` / `auth.tokens` / `auth.revokeToken`; `validateBearer` returns
  `{ userId, scope, effectiveScope, tokenId, clientId }`; tokens are stored by
  account id with `effectiveScope` mutable (`setEffectiveScope`).
- Provenance already stamps the acting writer on every fact (attributable,
  supersede-able) — the substrate analog of "acted as".

So the spine exists. The gap is treating the token as an **editable object with a
lifecycle + a management surface**, plus the human-in-the-loop elevation link.

## Proposal (phased)

### Phase A — Token as an editable object
- **`auth.updateToken(tokenId, { label?, scope?, expiresInSec? })`** — patch a token
  you own. `scope` re-sets the **grant** (ceiling), clamped to `min(requested, your
  own standing)` (narrow-or-within-your-role, never beyond) — the sync `PATCH`
  semantics. `label` renames; `expiresInSec` re-horizons. Returns the updated
  summary. (`store.updateToken` across memory/dynamo; `effectiveScope` reset or
  preserved per a flag.)
- **Richer `auth.tokens`** — each summary carries `{ id, clientName, label, scope,
  effectiveScope, createdAt, lastUsedAt, expiresAt, kind }` so a UI can show "what
  is this credential, what can it do, when did it last act".
- **Refresh as lifecycle** — already shipped server-side (edge silent-refresh +
  `refreshSession`); expose `lastUsedAt`/rotation so the surface reflects it.

### Phase B — Management surface (the steward UI)
- A **Tokens / Connections** panel (home Identity section, or a `/connections`
  surface): list every connected client + minted token as a principal card —
  client name, scope (editable), effective focus, last used, expiry — with
  **Upgrade / Downgrade scope**, **Rename**, **Refresh horizon**, **Revoke**.
- Built on `auth.tokens` + `auth.updateToken` + `auth.revokeToken` (+ the existing
  `auth.scope`/`requestScope`). This is the concrete "edit/upgrade/revoke/refresh
  over time" the request asks for.

### Phase C — In-band scope elevation (agent ↔ human)
- On `scope_denied`, the gateway returns a **stateless elevation URL**
  (`/authorize?...&elevate=<tokenId>&scope=<needed>`); opening it → passkey →
  approve → **`updateToken`** widens the grant → the agent retries. Lets a connected
  Claude.ai hand you a link to widen *its own* token without re-minting — sync's
  exact UX. (Distinct from `scope_offer`, which is self-serve *within* the grant.)

### Phase D — Embodiment (research / larger)
- Today the substrate is single-principal (`c15r`). sync's embodiment lets one user
  run sessions *as* different agent identities. The substrate analog: a token could
  carry an **`as` / agent label** (a sub-principal under the owner), recorded on the
  session and stamped as the writer — so "who acted" is the embodied agent, chosen
  at connect/embody time, not just the human. This is a model change (sub-principals,
  their addressing, their grants) — scope it separately after A–C land.

## Files (Phases A–C)
- `services/auth/store.ts` + `memory-store.ts` + `dynamo-store.ts` — `updateToken`,
  richer `TokenSummary` (`lastUsedAt`, `clientName`), `lastUsedAt` stamp on validate.
- `services/auth/service.ts` — `updateToken` command + `describeTools` entry;
  extend `tokens`/`listTokens` payload.
- `platform/runtime/auth.ts` — clamp helper (`min(requested, standing)`) for the
  grant patch.
- `services/.../gateway` (resource cell) — elevation URL on `scope_denied`.
- `cells/home/client` (or a new connections surface) — the steward UI.

## Risks / decisions
- **Widening a grant** must never exceed the owner's own standing (sync's
  `min(scope, role)`); `updateToken` clamps to the caller's grant ceiling, and admin
  scopes stay admin-gated (`grantableScopes`).
- **`lastUsedAt`** adds a write on every validate — keep it cheap (throttled /
  best-effort) so it doesn't tax the hot auth path.
- **Embodiment (Phase D)** is the biggest lift and a genuine model change — treat as
  research, decoupled from the lifecycle/steward work, which delivers most of the
  user-visible value (edit/upgrade/revoke/refresh) on the existing single-principal
  model.
