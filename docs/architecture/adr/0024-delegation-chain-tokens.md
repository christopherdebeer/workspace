# ADR-0024 — Delegation-chain tokens (RFC 8693 `sub`+`act`)

- **Status:** Decided + built 2026-07-13. **Reconciled 2026-07-09:** partially realised
  and reassessed by **ADR-0074** — a minted child can now be POSTURED by its minter
  (delegation attenuates attention, not just scope), and mint-time scope narrowing already
  enforces the ceiling. **Built 2026-07-13:** `auth.exchangeToken` (RFC 8693 shape) mints a
  child from a presented parent token — scope clamps to min(requested, parent grant) via the
  existing `intersectScopes`, and the child carries `act` ({sub: actor, act: parentChain}),
  outermost = leaf. Depth bound (MAX_DELEGATION_DEPTH = 8) + loop guard (an actor may not
  reappear; nor may the subject). The chain threads token → `validateBearer` →
  `Identity.act` → command envelopes, and the workspace writer stamp reads the LEAF act
  (`leafActOf`, platform/runtime/state.ts) while authorization stays anchored to the subject
  (`Identity.user`). `unwindActChain` serves audit views; `TokenSummary.act` surfaces the
  chain in the steward list. Token format stays opaque server-validated (the first open
  question, answered conservatively — a signed JWT can come later without schema change).
  **Consumed 2026-07-13 (same day, second pass):** the mechanism gained its two real callers.
  (1) The exchange core moved to `performTokenExchange` (services/auth/oauth.ts), shared by the
  `auth.exchangeToken` command and a new `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`
  on `/oauth/token` (advertised in AS metadata) — any OAuth client holding a parent token can now
  mint an attenuated, chain-carrying child through the standard AS surface (RFC 8693 response
  shape: `issued_token_type` + `act` echo; `invalid_grant`/`invalid_scope`/`invalid_request`
  mapping). (2) The reactor's rail-spawn mint (`mintTokenFor`, called from
  services/workspace/event-handlers.ts) now names the spawned agent as `actor`, so the per-run
  token carries a depth-1 chain (`{sub: "agent:<cell>.<tool>"}`) and facts written by a
  machine-rail agent stamp the AGENT as writer instead of re-flattening to the owner — the
  scorecard ❌ closed in the production path, not just the test suite.
  (3) Connected clients are actors FROM MINT: the `authorization_code` grant now decides by
  redirect origin (`delegationActorForRedirect`) — same-origin = the platform's own SPA (the
  human, root token); a cell host = `cell:<owner>/<name>`; any foreign origin (Claude, ChatGPT)
  = `client:<name>`. Facts written through Claude vs ChatGPT stamp differently instead of both
  flattening to the user, and the chain now rides the refresh row in both stores so it survives
  the re-mints connected clients perform constantly. Device-code tokens stay root (no client
  identity on that path — a follow-up if device connectors matter).
- **Date:** 2026-06-25
- **Context:** ADR-0022 made a token a principal acting on behalf of `c15r`, but only **one writer** is
  stamped per fact. When that embodiment spawns a sub-agent (an orchestrator-worker hop, an MCP cell
  calling another), the chain *user → agent → sub-agent* is invisible — the sub-agent's writes are
  attributed to the agent, or worse re-flattened to the user. The meta-harness scorecard
  (`docs/meta-harness-notes.md` §2) lists this as the ❌ line and endorses **RFC 8693 token exchange**:
  a token carrying `sub` (the user) plus a nested `act` (the acting agent), composable per hop.
- **Depends on:** ADR-0022 (tokens as principals — the link in the chain), ADR-0007 (Grant axis).

---

## Sketch (decisions, tentative)

### 1. A delegation token carries `sub` + nested `act`

Minting a token *for a sub-agent from an agent token* records the existing principal as `act` and
preserves the original `sub`. Nesting composes: `sub: c15r, act: {agent, act: {sub-agent}}` — every hop
appends, none is erased. Multi-hop attribution becomes a structural property of the token, not a
convention.

### 2. Exchange is the mint verb for delegation

A new `auth.exchangeToken` (or `mintToken` with a `from` token) performs RFC 8693-style exchange: the
result is clamped to `min(requested, presented-token scope)` — delegation can only attenuate, reusing
the ADR-0022 `intersectScopes` clamp. No hop can widen.

### 3. Provenance stamps the leaf, audit reads the chain

A fact's writer stamp is the leaf `act`; the trajectory/`$grants` view can unwind the `act` chain to
show "sub-agent X, acting for agent Y, acting for c15r."

## Why now (buffer rationale)

This is the named ❌ on the canon scorecard and the natural next step once principals exist (ADR-0022)
and sub-agent/Workflow orchestration is in play. Sketching it keeps the token schema decisions honest —
`updateToken`/`mintToken` shapes should not foreclose a nested `act`.

## Open questions

- Token format: stay with the current opaque server-validated token + stored chain, or move to a signed
  JWT carrying `act` so a downstream resource can verify offline? (Interacts with ADR-0025.)
- Depth bound / loop guard on the `act` chain.
- How the chain renders in the steward UI (ADR-0022) without overwhelming it.
