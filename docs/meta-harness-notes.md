# Meta-harness summer — research notes & parc.land bearings

> Source: a June-2026 AINews/Latent.Space issue, *"It's Meta-Harness Summer"*, deep-dived
> against PRIMARY sources. Captures where parc.land already sits on the converging
> agent-harness map and the concrete upgrades the literature endorses. Companion to
> `auth-consent-plan.md` and `token-as-principal-plan.md`.

## Verifiability frame
The issue is dated essentially "today", so separate the real from the future-dated:
- **Real / primary-sourced:** MCP, Zed's ACP, Anthropic *Building Effective Agents*, Databricks
  **Omnigent** (Apache-2.0 "meta-harness", Data+AI Summit 2026), MemGPT, Letta **Sleep-time
  Compute** (arXiv:2504.13171), OpenThoughts (arXiv:2506.04178), **AWM/Agent World Model**
  (arXiv:2602.10090), and the security canon (ocap, confused deputy, RFC 8693, macaroons).
- **At/beyond the horizon (cite precedent, not headline numbers):** Qwen-AgentWorld &
  OpenThoughts-Agent (arXiv 2606.*, "beats Sonnet 4.6 / 44.8%"), Jalapeño chip, GLM-5.2, and the
  specific X-posts (Varda quotes, "bills by the thought").

## 1. The meta-harness pattern
Standard harness components (awesome-harness-engineering + *Building Effective Agents*):
agent loop · planning · context delivery · **tool protocol** · **permissions** · **memory** ·
**orchestration** · verification · observability · human-in-the-loop.

Converging layering, bottom-up:
- **MCP** = agent↔tools/context bus (JSON-RPC; Tools/Resources/Prompts). A harness *ingredient*.
- **ACP** (Zed) = agent↔editor/client bus ("LSP for coding agents"), reuses MCP JSON, mandatory
  per-tool permission requests.
- **Harness** = runtime wiring + orchestrator-worker core (*central LLM decomposes → delegates to
  workers → synthesizes* — subagents/workflows).
- **Meta-harness** (Omnigent) = makes whole harnesses swappable beneath a stable session/policy/
  skill layer; control (cost/permissions) enforced *at the meta-harness layer, not via prompts*.

**parc.land bearing:** already a meta-harness in shape — MCP-native, swappable **cells** behind one
`/mcp` (`read`/`act`) gateway, an orchestrator-worker **Workflow** layer. Deltas vs the converging
stack: (a) no ACP-style **typed agent↔UI protocol**; (b) policy is per-call scope, not a
**session-level policy that travels** with you.

## 2. Agent identity & capability security (the load-bearing thread)
- **Confused deputy** (Hardy 1988): an agent *is* a deputy; ambient authority + an injected
  designation = exploit by construction. Fix = **bundle designation with authority** (object-capability).
- Hierarchy: **ACL/ambient (high exposure) → OAuth scopes (coarse, issuer-only narrowing) → ocap
  (eliminated by construction)**. Varda's Cap'n Web is the ocap-over-RPC incarnation.
- **Two models for agent action:** *impersonation* (act as the user — attribution collapses,
  inherits full authority — avoid) vs **own identity / delegation** (a distinct auditable principal
  that acts-on-behalf-of — 2025–26 consensus). Standards mechanism: **RFC 8693 token exchange** →
  a token carrying `sub` (user) + nested `act` (agent) for multi-hop attribution.
- **Narrowable tokens — macaroons:** holder adds caveats to attenuate *offline*, no issuer call —
  the closest mainstream bridge to ocap, ideal for handing a sub-agent a strictly weaker token.
- **No silent scope elevation:** authority only attenuates; widening must be a *fresh, explicit,
  human/`may_act`-gated, separately-logged* grant. The "bills by the thought" critique = a standing
  credentialed identity is standing risk+cost (NHIs ~144:1 vs humans) → bound lifetime & scope.

### parc.land scorecard (after this session's auth work)
| Canon principle | status |
|---|---|
| Own identity, not impersonation | ✅ tokens are minted principals; provenance stamps the writer; steward UI |
| Authority only narrows; explicit elevation | ✅ mint/`updateToken` clamp to `min(requested,standing)`; `focusScope`; **`scope_denied` → human-gated elevation URL** (canon-correct) |
| Holder-side attenuation (macaroons) | ⚠️ narrow at mint/update only; no offline caveat hand-down |
| Bundle designation+authority (kill ambient) | ⚠️ partial — `write:type:*` (#2B) + grant grammar move toward per-target; coarse `workspace:write` is still ambient over the slice |
| Delegation-chain audit (RFC 8693 `sub`+`act`) | ❌ single writer stamped; multi-hop user→agent→sub-agent not modeled |
| Short-lived/attested vs standing secrets | ✅ short access + edge silent-refresh; ⚠️ refresh cookie is a leakable bearer (httpOnly/Secure/SameSite-mitigated) |

**Three endorsed upgrades:** (a) RFC 8693 `sub`+`act` delegation tokens; (b) macaroon-style holder
attenuation for sub-agent hand-down; (c) finish per-target/per-type authority (**#2B**) to retire
coarse ambient `write:workspace`.

## 3. Memory as infrastructure
- **MemGPT** (LLM-as-OS): core/recall/archival tiers paged by function calls.
- **Sleep-time Compute** (Letta, real): offline consolidation/precompute *between* turns → ~5× less
  test-time compute, +13–18% on stateful benchmarks. (LangSmith Context Hub is really context
  versioning; the "sleep-time" label is Letta's.)
- **write→manage→read** loop = the issue's storage/retrieval/update/**consolidation**/lifecycle.

**parc.land bearing:** the **substrate already is** a memory-as-data-management layer — facts
`{value,_meta}` + **salience** (retrieval) + **tending** (consolidation/lifecycle) + supersede-not-
delete (versioned update). Missing piece: **sleep-time consolidation** — an offline pass that
rewrites raw facts into higher-salience deduped memory ahead of the next query. `tending` is the hook.

## 4. Agent training & world models
Real precedents: **OpenThoughts** (open reasoning-data recipe, 1000+ ablations) and **AWM** (the
verifiable pattern: **code-driven, MCP-exposed, deterministic** synthetic environments + verification
to generate trajectories — *not* neural state simulation). Evals: SWE-bench, WebArena, Terminal-Bench,
τ²-bench. **parc.land bearing (someday):** the **machine cell** (declarative rails over substrate
tools) is shaped like an environment generator; file as long-horizon, not now.

## Net for parc.land
1. The thesis validates the direction; the deltas are an **ACP-like typed agent↔UI protocol** and
   **session-level travelling policy**.
2. **Auth is the strongest, most on-canon surface** post-session — own-identity, narrow-only,
   human-gated elevation. Next: the three endorsed upgrades above (RFC 8693; macaroons; finish #2B).
3. The **substrate is a memory layer** missing only **sleep-time consolidation** (grow `tending`).

## Key sources
- Harness taxonomy — github.com/ai-boost/awesome-harness-engineering · Building Effective Agents — anthropic.com/research/building-effective-agents
- MCP — modelcontextprotocol.io/docs/concepts/architecture · Why MCP Won — latent.space/p/why-mcp-won
- ACP — agentclientprotocol.com · Omnigent — databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents
- Confused deputy — en.wikipedia.org/wiki/Confused_deputy_problem · Object-capability — en.wikipedia.org/wiki/Object-capability_model
- Capability Myths Demolished — papers.agoric.com/papers/capability-myths-demolished/full-text/ · Cap'n Web — blog.cloudflare.com/capnweb-javascript-rpc-library/
- RFC 8693 — rfc-editor.org/info/rfc8693/ · Macaroons — en.wikipedia.org/wiki/Macaroons_(computer_science)
- Agent impersonation vs delegation — blog.christianposta.com/agent-identity-impersonation-or-delegation/ · NHI/IAM — nhimg.org/articles/ai-agent-identity-breaks-traditional-iam-assumptions/
- MemGPT — arxiv.org/abs/2310.08560 · Sleep-time Compute — arxiv.org/abs/2504.13171 · letta.com/blog/sleep-time-compute
- OpenThoughts — arxiv.org/abs/2506.04178 · AWM — arxiv.org/html/2602.10090 · Weaviate Engram — weaviate.io/blog/engram-generally-available · LangSmith Context Hub — langchain.com/blog/introducing-context-hub
