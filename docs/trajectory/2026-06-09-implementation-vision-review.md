# Review — implementation vs vision, and the two predecessors (2026-06-09)

> Session record of a full review: the platform implementation against its
> design docs, plus a live investigation of the two ancestors — the legacy
> workspace (`cb2166bd`, sync's knowledge substrate) and sync itself. Durable
> design stays in [`substrate.md`](../substrate.md); this captures what was
> verified, one regression found live, and where the gaps sit.

## What this project is (goals, as synthesised)

A personal productivity **substrate-platform**: AWS-native (CDK), TypeScript,
MCP-native, mobile-first — re-founding two Val Town predecessors on primitives
sharp enough that the system extends itself without core changes.

- **The thesis** (`substrate.md`): software as a shared substrate of observed
  truth — state is primary, UI and MCP tools are two projections of one
  declared vocabulary, agents and humans are equivalent participants.
- **The two ancestors cover complementary halves** (`sync-learnings.md`):
  - **legacy workspace** (`cb2166bd`) = knowledge graph + links + stored
    salience + autonomous tending (no multi-agent coordination);
  - **sync** (`sync.parc.land`) = coordination + declarative actions/views +
    CEL + timers (no graph).
- They are **proof cases, not deliverables**: port them *in the model's terms*
  to validate the foundation, not verbatim as two more organs.

## Implementation — verified against the docs

A code-level review (platform/, services/, lib/, tests/ — ~9.1 KLoC source,
~2.2 KLoC tests) found the implementation faithful to the design docs:

- **`platform/runtime/state.ts`** implements the observed-state substrate
  exactly as documented: `{ value, _meta }`, server-stamped provenance,
  monotonic revisions, supersede-not-delete (fresh write revives), trajectory
  log (DynamoDB, TTL 24h — *not documented*), salience = recency 0.5 +
  velocity 0.3 + attention 0.2, focus/peripheral/elided shaping, single
  `shape()` over the merged own∪granted view. No semantic drift.
- **Gateway** (`services/gateway`): stable `whoami`/`read`/`act` surface;
  capability registry from tier-1 `describeTools` (PROVIDERS = workspace,
  cells) + tier-2 `cells.describeCellTools`; per-target scope checked at the
  gateway (the PEP); read/act kind boundary enforced before dispatch.
- **Dynamic cells** (`services/cells`): CloudFormation per-cell stacks
  (Lambda + table + role), esbuild-wasm transpile, S3 multi-file source
  (`cells/<id>/{src,build,data}`), path-traversal guarded; **IAM permission
  boundary enforced at role creation** — the control plane provably cannot
  mint an unbounded role.
- **Auth** (`services/auth`): WebAuthn passkeys + OAuth 2.1 (DCR, PKCE,
  refresh, revocation, device grant), scoped tokens; the four hard-won MCP
  client-connect fixes (path-suffixed PRM, OAC Authorization clobber →
  `x-forwarded-authorization`, scope picker + admin gating, passkey recovery)
  are all in place.
- **Home** (`services/home`): phases 0–1 of `home-cell.md` shipped — the SPA
  is a real browser read/act client (capability palette + interactive
  console); bespoke `/_catalog` retired (#126).
- Recent tending of the kernel itself landed as documented
  (`platform-cells.md`): `forge → cells` (bare verbs), `resource → gateway`,
  `documents`/`render` retired.

## Live investigation of the predecessors

Both ancestors are connected to this session and were probed live.

**Legacy workspace (`cb2166bd`) — alive and self-maintaining.** 388 entries /
838 links / 3,877 log entries; 15 entry types (knowledge, decision, project,
run, audit, protocol, …). Its v4 tending protocol **cron-fired this very
morning** (08:02 UTC, run `f01a16bc185347`): observed stats, walked no source
surfaces (all within freshness windows), dispatched nothing ("zero is the
protocol-correct call"), wrote a self-linked audit — the fifth consecutive
clean steady-state day after recovering a 9-day scheduler outage. It holds the
record of the *whole personal programme* (Mochi/primer, sentinels, DyGram,
parcland, sol, …), maintained by weekly source walks over github / val.town /
sync-docs surfaces. This is the living benchmark for what "tended substrate"
means.

**New platform gateway (`f5bbef8d`, parc.land/mcp) — live.** `whoami` →
`c15r` with `workspace:*` + `platform:*`; `read("$catalog")` returns 22
capabilities (7 `workspace.*`, 15 `cells.*`) with kind/scope/inputSchema —
the no-reconnect read/act surface works as designed.

## ⚠ Regression found live: the principal rename stranded the slice

`read("workspace.recall", { elision: "none", includeSuperseded: true })`
returns **0 entries** for principal `c15r`.

The 2026-06-08 trajectory doc records the slice holding a real
`substrate-on-cells` knowledge graph (`e:*` entries, `l:*` links,
`meta:schema`) — written under the then-principal `cb47e675-…`. Commit
`50c8cf8` ("expose the human username as the principal") changed identity
resolution to the username, so facts stored under the UUID scope are no longer
reachable from the session that wrote them. Sharing/grants are keyed the same
way, so any UUID-era grants are likewise orphaned.

**Action needed:** either migrate facts (and grants) from the UUID scope to
the username scope, or resolve legacy-UUID scopes as aliases at read time.
Until then the flagship room looks empty and the live proof-case is lost to
its author.

## Other gaps (doc/code drift + documented-but-missing)

- **Doc naming drift:** `dynamic-cells.md` / `serverless-platform.md` /
  `sync-as-cells.md` still say `services/forge` and `services/resource`;
  the code is `services/cells` and `services/gateway` (the rename note at the
  top of `dynamic-cells.md` covers prose, but file paths mislead).
- **Documented but not implemented:** SQS queue mode (Mode 3), Turso/libSQL
  backend (`persistence.turso` is a marker only), `cells.promote` (the
  tier-2→tier-1 PR path), the scheduled/derived `tend`, write-through grants.
- **Implemented but undocumented:** the `describeTools` provider contract,
  the two Lambda@Edge functions' role, dynamic-cell peer invocation under the
  boundary, the 24h trajectory TTL.
- **No integration tests** across CloudFront → auth → gateway → cell; unit
  coverage of the core semantics is otherwise good.

## Where the roadmap points (from the gap analyses)

`substrate-gaps.md` (vs legacy) + `sync-learnings.md` (vs sync) converge on:

1. **CEL layer + registered views** (query/projection — the single
   highest-leverage addition; recall-all does not scale past a small slice).
2. **Conditional writes (`ifRevision`) + per-entry timers** evaluated at read
   (lease / visibility-timeout / cooldown — no scheduler).
3. **Declarative actions** (runtime, no-code, bounded-write vocabulary) —
   brings `enabled` visibility + contested-target detection.
4. **Change feed** (`changes(sinceSeq)` — the trajectory log already has the
   seq).
5. **First-class links + inbound index + supersede migration** (from the
   legacy side; the reified `l:*` convention can't be queried or kept from
   rotting).
6. **Rooms** (shared multi-writer scopes) — only if the substrate is to be
   multi-agent, not just per-user.

Home phases 2–3 (purpose-built surfaces, then the generic view renderer) are
gated on the views primitive (1).

> Net: the organ half (cells + IAM boundary) and the authority half (auth +
> gateway-as-PEP) are built and live; the substrate half has its floor
> (state.ts + workspace room) but not yet its query, graph, coordination, or
> vocabulary layers — and the floor currently has a hole where the principal
> rename stranded the live slice.
