# 2026-07-17 — Membrane probe wave 5: the honesty-mechanisms audit

A new wave of the membrane probe battery (`protocol/membrane-probes`), run live
against the substrate through the `read`/`act`/`whoami` MCP boundary. Filed to
the substrate as `membrane-probes/wave-5` (`partOf` the protocol, `continues`
wave-4). This doc is the durable, reviewable mirror.

The membrane is the read/act coupling between an agent's internal workspace and
the substrate's external one (`docs/the-coupled-workspace.md`, ADR-0085). Waves
1–4 taught the boundary a set of **honesty mechanisms** — fail-fast teaching
errors, `_inputWarnings` (warn, don't silently swallow), the contested
`checked/*` idempotence stick, `describe_machine.drift`. Wave 5's finding is that
those mechanisms have themselves become a load-bearing surface — and **two of
them are currently lying.**

## Method

One embodied session, six participant keys (`probe/W5a..W5f`), read-mostly, with
two justified writes (a lease cycle and one honest adjudication) to test the
checked-stick end-to-end. Re-tested the four open wave-4 findings and fuzzed the
validation membrane. Every finding cites the exact call and observed result;
all are live-substrate reproducible.

## Headline

- **W5-1 — the contested checked-stick is INERT** (reproduced end-to-end).
- **W5-5 — `workspace.edges` emits a FALSE `_inputWarnings`** that contradicts
  its own correct behaviour.

The mechanisms built across waves 1–4 to stop the membrane lying are now the
thing lying.

## Confirmed still open (carried from wave 4)

### W5-1 — checked-stick inert (was W4k) · DEFINITIVE

`contested` reports `checked:0` despite 18 well-formed `checked/*` markers in the
slice. Probe: leased `suggestion/9c669fd9ad95ad8a`, wrote
`checked/9c669fd9ad95ad8a` with the **exact** versions the candidate echoed
(`a:80bb31f631e5ad52`, `b:8ed3b52d68983655`), then re-read `contested`. The pair
(`membrane-probes/wave-2 <-> wave-1`) **still surfaced unchanged** and `checked`
stayed `0`.

Writing the precise marker the hint instructs you to write suppresses nothing.
Root cause is localized: the markers are correct (my write matched the echoed
versions byte-for-byte), so the bug is in the `contested` **read's** suppression
join — it never consumes `checked/*`, or joins on a key/version it can't match.
Impact: the consolidation organ re-adjudicates every prior-checked pair every
cycle; idempotence carryover is zero — the organ pays to write markers that never
pay off, cycle after cycle.

### W5-2 — stale tool aliases in machine definitions (was W4h) · CONFIRMED

`describe_machine(weave)` still hands agents deprecated tool names: rails
`Assess->Connect`/`Dangling` list `tools:[workspace.neighbors, workspace.links]`
and the work-rail **prompts** name them in prose, while the live `$catalog`
marks `neighbors`/`links`/`graph`/`members` deprecated. Brief vs live catalog
disagree. `describe_machine.drift` also flags 6 `machine.weave.*`
action/subscription facts as hand-patched (live differs from the definition) — a
redefine would clobber them.

### W5-3 — athena glue block + ARN leak (was athena_glue_denied) · CONFIRMED + SHARPENED

`workspace.athena` now runs trivial expressions (`SELECT 1` → rows) but any real
lake query dies: `information_schema.tables` → *not authorized to perform
`glue:GetDatabases`*. The capability is exposed and looks usable but is
structurally dead for its actual purpose (`docs/substrate-analytics.md`).

New sub-finding: the error **leaks the internal IAM role ARN and AWS account id**
straight through the membrane
(`arn:aws:sts::018159942401:assumed-role/PlatformStack-WorkspaceServiceFunction…`).
A teaching error should teach without exposing infra internals.

### W5-4 — linkCount understates connectedness (was W4e) · CONFIRMED

`kb/0081ce6e0c3b43` shows `linkCount:14` in recall/query but `edges()` reveals
~30 edges (11 outbound + 19 inbound). `linkCount` is not a connectedness measure;
only `edges`/`neighbors` reveal true placement. The trap cuts both ways: a low
count can hide a well-placed hub, and here a mid count hides a dense one.

## New this wave

### W5-5 — false `_inputWarnings` (headline-class)

`workspace.edges` **honors** `key` (it aliases to `around`):
`edges({key:"kb/0081ce6e0c3b43"})` returned the correctly-scoped edge set — yet
the validation layer emitted `_inputWarnings: "key" is not part of the contract
and had NO effect`. A/B proof: `edges({around:"kb/0081ce6e0c3b43"})` returned the
**identical** scoped result with **no** warning.

So the handler's alias-set and the validator's allowlist have drifted apart: the
membrane does the right thing and simultaneously tells you it did nothing. This
is a regression on wave-4's W4d fix (which aliased `key`→`around`) and a general
class — `_inputWarnings`, the very mechanism built to cure the W3f silent-ignore,
now emits **false positives** that would push an agent to distrust a correct
result or retry. Every aliased arg on every verb needs its alias registered in
the validator, not just the handler.

### W5-6 — edges `limit` scope (minor)

On `workspace.edges`, `limit` bounds the hydrated `entries` map but **not** the
raw `outbound`/`inbound` arrays — a high-degree hub returns its full edge list
(~30 here) regardless of `limit:3`. Fine at this scale; a pagination gap for a
genuinely large hub.

## Validated healthy

- **W3f resolution holds** — `query({bogusUnknownArg:true})` ran and echoed
  `_inputWarnings` naming the unknown key + the accepted-key list. Warn-don't-
  swallow works for *truly* unknown keys (W5-5 is specifically the
  aliased-but-unlisted case).
- **Malformed `as` → loud rejection** — `read(as:"BAD KEY!! spaces")` gave a
  teaching error (`use a short path-ish name … e.g. steward/weave`). ADR-0086
  Inc 1 invariant intact.
- **Fail-fast on missing required key** — `peek()` and `describe_machine()`
  without their required key returned a teaching error naming the accepted keys
  and the `$catalog` resolve path.
- **Lease machinery** — ADR-0086 leases clean: `ttlSeconds:300` honored,
  `grantedMinutes:5` echoed (W4g intact); `held`/`holder`/`expiresAt`
  well-formed; release clean. Participant provenance stamped `_meta.as` on every
  write.
- **Capability ignition** — ADR-0085 intent routing passed: an intent query for
  *"take exclusive lock on a contended item before adjudicating"* returned
  `workspace.lease` rank-1, `workspace.contested` rank-2 — exact right verb,
  first, no `$catalog` needed.
- **`shape:"refs"`** trims edge entries to `_meta`-only — a real co-sizing lever.

## Critique

Waves 1–5 keep rediscovering one membrane law: **the boundary must never
silently diverge from what it says it does.** W1–2 found silent-ignore
(F9/W3f); W3 found stale-schema swallow; W4 found silent arg-drops. Wave 5 finds
the *inverse* and more troubling failure — the honesty mechanisms themselves
lying: a warning that fires when the input *was* honored (W5-5), and an
idempotence stick that reports and does nothing while its markers pile up
(W5-1).

Once you build teaching errors, `_inputWarnings`, checked-sticks and `drift[]` to
keep the membrane truthful, those mechanisms become load-bearing and must
themselves be tested for truth. A false *"I ignored that"* is worse than the
silent-ignore it replaced, because the agent now distrusts correct output.

Two concrete next-wave fixes:

1. Make the validator's per-verb allowlist include **every alias the handler
   accepts** — kills the W5-5 class generically.
2. Fix or remove the contested checked-stick — an idempotence marker that never
   suppresses is pure noise the organ pays to write each cycle.

Plus one infra note: athena should not leak its role ARN + account id in the
denied-query error.

## Probe artifacts

- `checked/9c669fd9ad95ad8a` — the honest `wave-2 <-> wave-1 = independent`
  adjudication written to test W5-1; inert by the bug, kept as a valid audit
  record.
- `lease/suggestion/9c669fd9ad95ad8a` — acquired, then released cleanly.
