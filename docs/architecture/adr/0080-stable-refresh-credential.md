# ADR-0080 — The stable refresh credential: rotation was signing sessions out

- **Status:** Accepted 2026-07-10 (built in the same change — a live defect fix,
  not a buffer entry; the buffer discipline governs capability work, not repairs).
- **Depends on:** ADR-0021 (session silent-refresh — the second consumer of the
  refresh token that made rotation unsound).
- **Refines:** ADR-0021's cookie mechanics; the kernel client's single-flight
  refresh guard (`cells/kernel/client/main.ts`) stays as belt-and-braces.

---

## Context (grounded)

A refresh of a unified token (`refreshUnifiedToken`, both stores) was a **single-use
rotation**: validate the `REFRESH#` row, *revoke the old access token*, *delete the
refresh row*, mint a new pair. Sound for one holder. But ADR-0021 deliberately gave
the SAME refresh token to **two independent holders**:

- the **httpOnly `parc_refresh` cookie** — consumed by the edge silent-refresh on a
  top-level navigation (`platform/runtime/define-service.ts` →
  `auth.refreshSession`), invisible to JS;
- the **JS client's localStorage** (`parc.session.tokens`) — consumed by the kernel
  client's proactive refresh timer and its 401-retry (`cells/kernel/client/main.ts`).

The two chains cannot stay in step: a cell-origin page calls `/oauth/token` on the
apex cross-origin, so the rotated cookie in the response is never stored; and the
edge refresh rotates server-side where localStorage can't hear about it. Within one
access-token lifetime of normal use the chains diverge, and then **whichever chain
refreshes first revokes the other chain's still-valid access token and consumes the
refresh row both depend on**. The surviving symptoms, live:

- `auth.tokens` shows DCR client tokens `revoked: true` weeks before their
  `expiresAt` — revoked mid-life by their own refresh.
- The browser signs itself out "randomly": a navigation's silent refresh kills the
  open tab's bearer (401s → the JS refresh presents a deleted refresh token →
  `invalid_grant` → the client wipes a session that was fine), and vice versa.
- The kernel client already carries two scars fighting this — the single-flight
  memo ("the daily-sign-out bug") and the multi-tab wipe guard — both treating
  symptoms of the same rotation-vs-two-holders conflict.

```mermaid
flowchart TD
  subgraph before["BEFORE — single-use rotation, two holders"]
    R0["refresh_token r1<br/>in parc_refresh cookie AND localStorage"]
    N0["navigation → edge silent-refresh(r1)<br/>revokes access a1 · deletes r1 · mints a2/r2 (cookie only)"]
    J0["open tab still holds a1 + r1<br/>a1 revoked → 401 · refresh(r1) → invalid_grant → signed out"]
    R0 --> N0 --> J0
  end
  subgraph after["AFTER — stable credential, natural expiry"]
    R1["refresh_token r1 stays r1 for both holders"]
    N1["any chain refreshes → new short access token<br/>old access lives to its (≤1h) natural expiry"]
    J1["other chain keeps working · next refresh(r1) also succeeds"]
    R1 --> N1 --> J1
  end
  before ==fix==> after
```

## Decision

`refreshUnifiedToken` keeps the refresh credential **stable for its whole life**:

1. **No rotation.** The `REFRESH#` row is kept (repointed at the newest access
   token, expiry slid by the configured refresh lifetime — the same sliding window
   rotation used to re-mint). `RefreshResult.refreshToken` becomes optional; absent
   means "keep presenting the value you hold". The token endpoint and the edge
   silent-refresh re-issue the *presented* value in the response body and the
   `parc_refresh` cookie, so all holders stay valid by construction.
2. **No revoke-on-refresh.** The previous access token reaches its natural, short
   (≤1h default) expiry instead of being revoked mid-life. Each refresh-minted
   access row carries `refreshHash` → the shared refresh row, so **explicit**
   revocation (`auth.revokeToken`, RFC 7009 `/oauth/revoke`, by access or refresh
   value) still cascades and ends the entire chain at once — the kill switch is
   unchanged.

Security trade-off, named: rotation's replay-detection (a stolen refresh token
dies on first legitimate reuse) is given up — it was already fiction here, since
legitimate reuse happens hourly by design, and every "detection" fired on the
user. Exposure stays bounded by the refresh row's TTL, httpOnly/Secure/SameSite
cookie transport, hashed-at-rest storage, and the explicit-revoke cascade.

## Behaviour-preservation test (the gate)

`tests/auth-oauth.test.ts`: the two rotation tests now assert the stable
semantics — (a) refresh leaves the prior access token valid and re-mints no
refresh token; (b) two holders of the same refresh value can both refresh and
every minted access token verifies; explicit `revokeByTokenValue` still kills the
chain. The pre-existing cascade/revocation/expiry tests pass unchanged.

## Consequences

- **Positive:** navigations, long-lived tabs, multiple tabs, and API clients
  sharing a grant no longer sign each other out; the kernel client's guards
  become redundancy instead of load-bearing; scratch/agent tokens are unaffected
  (no refresh chain — nothing about plain minted bearers changes).
- **Negative/risks:** refresh-token replay is no longer self-detecting; a leaked
  `parc_refresh` cookie mints access tokens until revoked or TTL-expired.
  Mitigation stays: explicit revoke cascade + bounded TTL. If sender-constrained
  tokens (DPoP) ever land, rotation can return per-holder.

## Out of scope

- Per-holder refresh tokens (cookie chain and JS chain each minted their own) —
  strictly stronger, but a two-store/two-cookie migration for the same user-facing
  result; revisit if replay detection becomes a requirement.
- The gateway conflating "auth service unreachable" with `invalid_token`
  (`resolveHttpIdentity` catches errors to ANONYMOUS) — a separate hardening.
