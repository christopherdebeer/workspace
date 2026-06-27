# ADR-0022 — Tokens as minted principals (embodiment lifecycle)

- **Status:** Accepted (shipped + live). Connecting a client (e.g. Claude.ai via MCP) mints a **token
  that is itself a managed principal** acting on behalf of `c15r` — relabel/re-scope/re-horizon/revoke
  over its lifetime, with a steward UI and a human-gated elevation path. Not a bearer the user "is".
- **Date:** 2026-06-25
- **Context:** A connected client was handed a token that simply *was* the user (`c15r`) — impersonation.
  Attribution collapsed (every write looked like the human), authority was the user's full ceiling, and
  the only lifecycle verb was revoke. The embodiment thread (`christopherdebeer/sync.parc.land`) and the
  capability-security canon (object-capability; confused deputy; RFC 8693; macaroons) both point the
  same way: an agent should be a **distinct, auditable principal that acts-on-behalf-of**, with its own
  narrowable, revocable, refreshable lifecycle. See `docs/token-as-principal-plan.md`,
  `docs/capability-consent.md`, and the scorecard in `docs/meta-harness-notes.md` §2.
- **Depends on:** ADR-0007 (Grant axis — authority self-model), ADR-0008 (Cell axis — the requesting
  client is a cell/origin), `docs/scope-grants.md` (the scope grammar + `∩` algebra).

---

## Decisions

### 1. A token is a principal, minted on connect

The DCR/device-flow connect mints a token whose subject is `c15r` but which is a *named, listable
entity* in its own right, not a copy of the user's session. Provenance stamps the token as the writer,
so the trajectory shows *which embodiment* wrote a fact.

### 2. Own identity, never impersonation; authority only narrows

`mintToken` clamps the requested scope to `min(requested, minter's standing ceiling)` via
`intersectScopes` — a token can never widen beyond its minter. The auth vocabulary is
`mintToken / updateToken / revokeToken` plus the gateway-facing `tokens / describeTools`. `updateToken`
lets the steward **relabel, re-scope (narrow), and re-horizon** a live token — validated live on dynamo.

### 3. Widening is a fresh, human-gated, separately-logged event

When a call exceeds a token's effective scope the gateway returns `scope_denied` carrying an **elevation
URL** — `${PUBLIC_BASE_URL}/oauth/authorize?scope=<wanted>&elevate=<tokenId>` — that routes the human
through consent to grant the increment to *that token*. Authority attenuates by default; it only widens
through an explicit human act. (`services/gateway/service.ts`, `services/auth/oauth.ts`.)

### 4. A steward surface

The token list is a management surface (the embodiment roster): each token shows its label, scope, and
horizon, with edit/elevate/revoke. This is the "who is acting for me, with what, until when" view.

## Consequences

- Attribution is restored: writes are attributable to a specific embodiment, not blurred into the human.
- The standing-credential risk ("bills by the thought"; NHI sprawl) is bounded — every principal has a
  label, a narrow scope, and a horizon, and can be retired without touching the human's own session.
- This is the load-bearing surface the rest of the auth canon hangs off (refresh in ADR-0021;
  per-type narrowing in ADR-0023; delegation/attenuation in the ADR-0024/0025 buffer).

## Open / follow-ups

- **Delegation chains** — a token minting a strictly-weaker token for a sub-agent, with multi-hop
  attribution — is not modeled; today a single writer is stamped. See **ADR-0024** (RFC 8693 `sub`+`act`).
- **Offline attenuation** — narrowing a token without an issuer round-trip — see **ADR-0025** (macaroons).
- **Attested refresh** binding a principal to a device/passkey rather than a bearer cookie (ties to
  ADR-0021's open item).
