# ADR-0024 — Delegation-chain tokens (RFC 8693 `sub`+`act`)

- **Status:** Proposed (buffer, not built). First of the two-ahead sketch buffer ahead of the accepted
  line. Captures the next decision so the direction is legible before code exists.
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
