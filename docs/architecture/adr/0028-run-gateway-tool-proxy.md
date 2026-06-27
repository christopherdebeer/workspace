# ADR-0028 — `@c15r/run` gateway tool proxy (`parc.call` over MCP)

- **Status:** Accepted (shipped in the run cell — `parc.call` + per-run `token`). Extends ADR-0026; the
  shared-helper extraction is deferred (one consumer today).
- **Date:** 2026-06-25
- **Context:** `@c15r/run`'s code sandbox had three bindings — `parc.read/query/emit` — wired **directly**
  to DynamoDB/EventBridge under the cell's **ambient IAM over the whole owner slice**. So run code could
  CRUD the owner's slice but could not call another cell's tool, `act` an arbitrary capability, `whoami`,
  or read the self-model — and its slice access bypassed the gateway PEP entirely (coarse, ambient).
  Meanwhile `@c15r/models.agent` already solved "call the real tool surface as a scoped principal": given
  a per-run token it proxies dotted targets to `/mcp` (`callGatewayTool` + `toolVerb`,
  `cells/models/index.ts`). Run should reach the same surface the same way.
- **Depends on:** ADR-0022 (tokens as principals — the per-run scoped token), ADR-0023 (read:type/
  write:type — what now bounds a code step), ADR-0017 (the cell substrate-access model this widens),
  ADR-0026 (the work-code rail that mints + passes the token).

---

## Decisions

### 1. `parc.call(target, input)` — the full MCP surface, gated by a token

The run sandbox gains `parc.call(target, input)` (alongside the existing direct bindings). It proxies to
the `/mcp` gateway as the run's **scoped principal**, auto-routing `read` vs `act` by the target verb
(`READ_VERBS`). With no token it throws — the direct owner-slice `read/query/emit` stay the fast path.
Run is *simpler* than `models.agent` here: code passes the dotted `target` directly, so there's no
tool-name sanitisation (that exists only because LLM tool schemas forbid `.`/`@`/`/`).

### 2. The token is the ceiling — authority comes in, not ambient

`exec` takes an optional `token`. Its scope is the bound: a machine `work-code` rail (ADR-0026) mints it
**narrowed** (e.g. `write:type:note`), so a code step gets exactly the authority the rail grants — not
god-mode over the slice. Crucially, `parc.call` goes **through the gateway PEP**, so the read:type/
write:type enforcement (ADR-0023) and every other scope check apply to run code, which the direct
bindings bypass. Extending run to the MCP surface is therefore also how run's authority gets *bounded*.

### 3. Mirror now, vendor later

The proxy logic (`callGatewayTool`/`toolVerb`) is duplicated from `@c15r/models` rather than shared —
tier-2 cells are independent bundles, so sharing means vendoring (as with `substrate.js`). Inlined now;
extract a `@c15r/gateway-tools` module when a third consumer appears.

## Consequences

- A run can now orchestrate: link facts, invoke other cells, read `$catalog`/`$grants`, etc. — bounded
  by a scoped token, audited by the gateway.
- The direct `parc.read/query/emit` remain for the common owner-slice case (no token, no gateway hop) —
  but they stay *ambient*; `parc.call` is the path that respects the scope grammar. A future increment
  could route the direct bindings through the PEP too, retiring the ambient path.

## Open / follow-ups

- **Shared helper** extraction once a second non-models consumer lands.
- **Direct-binding retirement** — make `parc.read/query/emit` also go through a (cached) scoped path so
  run never has ambient slice authority.
- **Grants allowlist** beyond the token scope (a per-run tool-name allowlist, as `models.agent` has)
  if a rail wants to hand a broad token but expose only a few targets.
