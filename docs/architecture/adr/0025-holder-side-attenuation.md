# ADR-0025 — Holder-side attenuation (macaroon-style caveats)

- **Status:** Proposed (buffer, not built). **Reconciled 2026-07-09:** the attenuation
  PRINCIPLE shipped piecewise — `focusScope`/`requestScope` (session self-narrowing),
  mint-time intersection, and ADR-0074 posture (attention attenuation). Remaining here:
  holder-side attenuation of a token you HOLD but did not mint. Second of the two-ahead sketch buffer. The forward edge of
  the auth direction — keep one decision sketched beyond ADR-0024.
- **Date:** 2026-06-25
- **Context:** Today a token narrows only at **mint/update** — an issuer round-trip (ADR-0022 §2). When
  an agent hands work to a sub-agent it cannot say "here is my authority, *minus* this, right now,
  offline." The scorecard (`docs/meta-harness-notes.md` §2) marks holder-side attenuation ⚠️ and names
  **macaroons** as the mainstream bridge to object-capability: a bearer the *holder* can attenuate by
  appending caveats, verifiable without calling the issuer. This is the natural partner to the
  delegation chain (ADR-0024): exchange establishes *who*, caveats bound *what*, both without a server hop.
- **Depends on:** ADR-0024 (delegation chains — the hop that wants to hand down weaker authority),
  ADR-0022 (tokens as principals), `docs/scope-grants.md` (the `∩` algebra caveats must respect).

---

## Sketch (decisions, tentative)

### 1. A token may carry holder-appendable caveats

A macaroon-style token is an issuer-rooted secret plus a chain of HMAC-bound caveats. The holder can
append a caveat (e.g. `type = note`, `key prefix = inbox/`, `before = <ts>`) producing a strictly-weaker
token **offline** — no `mintToken` call. Verification re-walks the caveat chain at the gateway.

### 2. Caveats only intersect; they can never widen

Each caveat is an additional `∩` against the effective scope, reusing the `intersectScopes` semantics
already proven in ADR-0022/0023. A caveat that doesn't narrow is a no-op; there is no caveat that grants.

### 3. Sub-agent hand-down without an issuer round-trip

The intended use: an agent (ADR-0024 `act`) hands a sub-agent a token attenuated to exactly the slice the
sub-task needs, at delegation time, with no latency or issuer load — the object-capability ideal of
"bundle designation with authority, narrowed to need."

## Why now (buffer rationale)

It is the ⚠️→✅ move for two scorecard lines (holder attenuation; bundle designation+authority) and only
makes sense *after* principals (ADR-0022) and ideally alongside delegation (ADR-0024). Sketching it now
forces the ADR-0024 format question — opaque-server-token vs signed/self-describing — because caveats
want a verifiable, self-contained token.

## Open questions

- Revocation: macaroons are notoriously hard to revoke (the issuer never sees the attenuated copies).
  Likely answer: short root horizon (ADR-0021 refresh) + third-party caveat for a revocation check.
- Where verification lives — gateway-only, or pushed into each cell's substrate client (ADR-0017)?
- Migration: can the current opaque token coexist with a macaroon token type behind one `validateToken`?
