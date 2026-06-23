# Machine-declared tool scopes for executing agents

> Design spec (not a trajectory record). Generalises the tending fix's
> point-solution (`substrate_supersede` hard-coded into `@c15r/models.agent`)
> into a robust model: **a machine declares which substrate MCP tools its
> executing agent may call, scoped to keys/types, and execution enforces that
> through the platform's existing token-scope system** — not bespoke per-tool
> checks reimplemented in a cell.

## The problem with point-tools

`@c15r/models.agent` today offers a small, hard-coded toolbox —
`substrate_query`, `substrate_read`, `substrate_emit`, and now
`substrate_supersede` — each a bespoke reimplementation (direct DynamoDB reads;
organ-path writes). Two faults:

1. **It lags the real vocabulary.** The substrate already exposes a rich MCP
   surface (`workspace.query/peek/recall/neighbors/links/link/unlink/supersede/
   invoke/remember`, plus every `@owner/cell.tool`). Re-creating a subset means
   `link`/`unlink`/`neighbors`/cross-cell calls never reach the agent — exactly
   the edge work the tending audit needs. Every new capability is another cell edit.
2. **Authority is ad-hoc.** `grants:{read,write[]}` are prefix lists checked in
   the cell. There is no per-tool scoping, and it does not compose with the
   platform's real scope system (`workspace:read`, `workspace:write`,
   `cell:<owner>/<cell>:*`, key/type narrowing).

## The model

A machine node that spends an agent declares a **tool allowlist + scope**:

```jsonc
// a `work` (machine-spawns-agent) or agent rail
{
  "from": "Tend", "to": "Done", "mode": "work",
  "tools": [                       // the substrate MCP capabilities it may call
    "workspace.query", "workspace.peek", "workspace.neighbors",
    "workspace.supersede", "workspace.link", "workspace.unlink"
  ],
  "scope": {                       // the keys/types each call may touch
    "read":  true,                 // or prefix/type constraints
    "write": ["tending/", "machine-run/", "agent/"]
  },
  "prompt": "…", "maxTurns": 12
}
```

`tools` is the allowlist (a subset of `read("$catalog")`); `scope` bounds *which
facts* those tools may touch. Together they are the "granular scopes specific to
the tools the machine allows."

## Execution: scope via a narrowed token, against the real `/mcp`

The platform already has the enforcement primitive. `auth.mintToken` mints a
token whose scope is `intersect(requested, ceiling)` where the **ceiling is the
minter's own grant** — *narrow-only, never widen* (`services/auth/service.ts`,
`docs/scope-grants.md §3`). So execution is:

1. Resolve the node's `tools` × `scope` to a concrete scope set
   (e.g. `workspace:read workspace:write cell:c15r/models:* key:tending/* …`).
2. `auth.mintToken({ scope })` → a token narrowed to exactly the allowlist,
   bounded by the executor's grant.
3. The agent's toolbox **becomes those MCP capabilities**, discovered from
   `$catalog` and called via the real `read`/`act` gateway with that token. The
   gateway enforces scope per call — the cell stops re-implementing checks.

`grants:{read,write[]}` thus generalises to **tool × scope** pairs, expressed in
the platform's scope grammar.

## Two execution paths, one declaration

The same `tools`/`scope` declaration serves both halves of the original ask,
differing only in *who holds the token*:

| | **Driving agent uses a machine** (part 2) | **Machine spawns an agent** (tending today) |
|---|---|---|
| Holder of the token | the driving agent (a claude.ai routine / authed session) — it already has a token | a server-side cell (`@c15r/models`) — has **no** user token |
| Mint | the driver calls `auth.mintToken` narrowing **its own** grant to the node's allowlist | needs a mintable **principal** for the cell |
| Status | **works on today's auth** — narrow-only minting is exactly this | blocked on **grants-to-principals** (the deferred piece the models cell comments already name) |

So the robust model lands first and cleanest for the **driving** path: the
machine hands the agent its current node + the node's allowed tools + a narrowed
token, the agent does the step and advances. The **spawn** path reuses the same
declaration but, until a cell can mint as a scoped principal, keeps the bespoke
allowlisted tools as an interim (see "Increment 1").

> This is the convergence: "machine spawns agent" and "driving agent uses
> machine" are the *same* scope model — a declared tool allowlist + a narrowed
> token — applied to different token holders.

## Sequencing

- **Increment 1 (now, forward-compatible):** add `tools` (+ `scope`) to the
  machine/rail schema (data model, carried on the `work` deliver). `models.agent`
  accepts a `tools` allowlist and *filters* its exposed toolbox to it — so a node
  can already say "this agent gets read-only" or "no supersede". Bespoke tools
  remain the floor; the declaration is the seam the token model slots into.
- **Increment 2 (driving path) — DONE as `protocol/machine-drive`.** A driving
  agent already iterates a machine with existing primitives only: `peek
  machine-run/<run>` (where am I) + `peek machine/<m>` (the rails, each carrying
  the node's `tools`/`scope`/`prompt` from Increment 1) + `invoke` of the
  projected `start` / `<from>-to-<to>` / `decide-<from>` actions (whose `if`
  guards make them safe + idempotent). The protocol fact is what a scheduled
  routine is *pointed at*; the machine name arrives in the dispatch text. Token
  narrowing (gateway-enforced scope) is the only remaining upgrade — today the
  allowlist discipline is the driver's to keep. A `drive`/`step` convenience tool
  (one call resolves the deterministic prefix + returns the next agent node) is a
  nicety that would need the machine cell to gain substrate-read provisioning;
  the protocol works without it.
- **Increment 3 (spawn path, full):** grants-to-principals so a cell can mint a
  scoped token for the agent it spawns; the bespoke `substrate_*` tools retire in
  favour of the real `workspace.*` vocabulary behind that token.

## Why not just keep adding bespoke tools

`substrate_supersede` was the right *unblock* for tending (it shipped the one
verb the audit needed). But each added verb is a cell edit that still can't reach
`workspace.link`/`neighbors`/cross-cell tools, and never composes with real
scopes. The allowlist + narrowed-token model reaches the whole vocabulary and
inherits the platform's enforcement — it is the last tool-plumbing change, not
the next one.
