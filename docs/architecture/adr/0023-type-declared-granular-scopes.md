# ADR-0023 — Type-declared granular scopes & cell-named consent

- **Status:** Accepted. Consent now names the *requesting cell* (shipped + live, #2A). Types can declare
  granular `write:type:<T>` scopes enforced by a family gate (#2B — code shipped, deploying to prod at
  time of writing; the change is inert for every existing coarse/internal token).
- **Date:** 2026-06-25
- **Context:** Consent offered only **full workspace read** or **full workspace write** — coarse ambient
  authority over the whole slice, and the screen never said *who* was asking. Two gaps: the human can't
  make an informed grant without the requester's identity, and a client that only needs to write notes
  still had to be handed write-everything. The capability canon calls coarse ambient authority the
  confused-deputy substrate; the fix is to bundle designation with authority and let authority be
  per-target. See `docs/auth-consent-plan.md` and the scorecard in `docs/meta-harness-notes.md` §2.
- **Depends on:** ADR-0022 (tokens as principals — the thing being scoped), ADR-0007 (Grant axis),
  ADR-0008 (Cell axis — the requesting cell is the named designation), `docs/scope-grants.md`.

---

## Decisions

### 1. Consent names the requesting cell

When the OAuth `resource`/redirect resolves to a cell (`cellFromRedirect`), the consent screen shows
*that cell* as the requester rather than a generic client. The human grants to a named deputy.

### 2. Types declare a granular scope family

A tool/type can advertise a `scopeFamily` (e.g. `write:type:*`); `remember` and `ingest` declare it, and
`describeTools` surfaces it so a client can request the *narrow* vocabulary `write:type:<T>` instead of
coarse `write:workspace`. The granular family coexists with the coarse scope — it does not replace it.

### 3. The family gate is `holdsUnder`, and it only tightens granular-only tokens

`platform/runtime/auth.ts` adds `holdsUnder(identity, family)` — true iff a *held* scope falls **under**
the family (the reverse of `hasScope`/`impliesScope`, which is coarse ⊇ granular). The gateway's
`enforceScope(ctx, target, scope, family?)` checks the coarse path first, then the family. The workspace
helper `enforceTypeWrite(identity, type, key)` returns early when the caller is **internal** (empty
scopes) or holds the **coarse** `write:workspace`, and only requires `write:type:<T>` for a token that
carries *granular-only* scope. Net: existing coarse tokens and internal calls are unaffected; only a
deliberately-narrow token is held to its declared types.

## Consequences

- A client can be handed exactly `write:type:note` and is then denied a `todo` write at the gate
  (`scope_denied` + elevation URL per ADR-0022) — coarse ambient `write:workspace` stops being the only
  option.
- Because the enforcement is gated on *granular-only* identities, it shipped safely: zero behavior change
  for every token and internal caller in existence at deploy time.
- This is the first concrete step toward retiring coarse `write:workspace` (scorecard line: "bundle
  designation+authority").

## Open / follow-ups

- **Consent-screen surfacing of type-scopes** — the type→scope coupling exists in the vocabulary but the
  consent UI doesn't yet *offer* per-type checkboxes; documented as polish, deferred.
- **Per-key / per-target authority** (beyond per-type) — the grammar supports it; finishing it is the
  remaining work to fully retire ambient `write:workspace`.
- **Read-side granularity** — only the write family is declared; `read:type:<T>` is symmetric and unbuilt.
