# ADR-0021 — Session continuity: edge silent-refresh

- **Status:** Accepted (shipped + live). A 30-day passkey grant now keeps the browser signed in for the
  full horizon via a refresh cookie + edge silent-refresh, instead of expiring with the short access
  token within hours.
- **Date:** 2026-06-25
- **Context:** Selecting "30 days" at the passkey consent minted a *30-day grant* but the browser only
  held a short-lived access token in a navigation cookie; once it expired (hours) the next navigation
  bounced to re-sign-in, even though the grant was still valid. The grant horizon and the *session*
  horizon were conflated. Short access tokens are correct (small blast radius); the missing piece was a
  durable, automatically-redeemed refresh path.
- **Depends on:** ADR-0007 (Grant axis — the grant is the authority of record; the session is a
  redemption of it).

---

## Decisions

### 1. Two horizons, two credentials

- **Access** — short TTL, the bearer actually presented on each call. Stays short.
- **Refresh** — bound to the grant horizon (e.g. 30 days), held in a separate `parc_refresh` cookie:
  `httpOnly` + `Secure` + `SameSite`. It is *not* an API bearer; its only power is to redeem a fresh
  access token for the same grant.

### 2. Refresh happens at the edge, silently

`define-service`'s HTTP identity resolution (`resolveHttpIdentity`) returns `{identity, setCookies}`.
On a navigation where the access token is expired/absent but a valid `parc_refresh` cookie is present,
the edge calls `handleRefreshSession`, mints a new access token, and sets it back on the response — the
user never sees a sign-in. The client also schedules a proactive refresh (`scheduleRefresh`) ahead of
expiry so an open tab stays live without a navigation.

### 3. Refresh is revocable and clears on sign-out

Refresh is server-validated against the grant, so revoking the grant kills the session at next refresh.
Sign-out / `revokeToken` clears the `parc_refresh` cookie.

## Consequences

- The displayed grant duration is the *experienced* session duration — "30 days" means 30 days.
- Access-token TTL can stay short without UX cost; the leakable surface is the refresh cookie, mitigated
  by `httpOnly/Secure/SameSite` (acknowledged residual risk — it is still a bearer; see ADR-0024/0025
  for the attenuation direction).

## Open / follow-ups

- **Refresh-token rotation / reuse-detection** is not implemented; a stolen refresh cookie is valid
  until grant revocation. Rotation-on-use is the standard hardening and is deferred.
- **Attested (non-bearer) refresh** — binding refresh to the passkey/device rather than a cookie — is
  the stronger end state and depends on the embodiment/principal work (ADR-0022).
