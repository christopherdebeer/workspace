# 2026-06-15 — Legacy corpus import, salience lenses, and warm-corpus tuning

Continues the salience arc from `2026-06-14-isolation-closed-isomorphic-ssr-and-npm-cells.md`.
Branch `claude/recent-trajectory-doc-cfeciy`. Everything below is deployed to prod
(CDK runs #182–#184) and measured against the live corpus.

## What shipped

**1. Per-call salience lenses + raw override (`computeScore` was instance-only).**
Salience is observer-relative, so `read`/`query` (and `workspace.recall`/`.query`
over MCP) now take a per-call **lens** — `recent` / `connected` / `durable` /
`active` (weights sum to 1) — and a raw `salience: Partial<SalienceOptions>`
escape hatch, merged *defaults ← lens ← override*. A lens **recomputes** the score,
so it shifts ranking **and** the focus/peripheral/elided tiers together (unlike
`rankBy`, which only re-sorts). Lens echoes in `_shaping.lens`. This is the lever
that makes tuning a live A/B instead of a redeploy — and recovers the inspectable
ranking the legacy `workspace_salience` tool had (see the ergonomics addendum).

**2. Import fidelity (`WriteInput.import`).** `put`/`remember`/`ingest` accept
`{ createdAt, updatedAt, seedReads, seedWrites }`: historical timestamps (recency
reflects true age) and cumulative legacy counts carried as **standing priors** on
the record — folded into the cumulative term in `wrap` (never the recent window),
so a ported fact arrives with its earned importance, not cold. No trajectory
replay needed. `ingest` also gained a bulk `edges` field for graph import.

**3. Legacy knowledge corpus imported.** 316 active entries from the Val Town val
`c15r/workspace` (runs excluded, matching how the legacy salience filters exhaust)
→ substrate facts keyed `kb/<legacy-id>`, preserving content/type/tags, with
`seedReads=read_count`, `seedWrites=write_count`, and real timestamps. Exported via
the legacy `workspace_*` MCP (`workspace_salience(400)`); imported in 22 batches of
15 (100/call 502'd — `ingest`'s per-fact `put→wrap` does a full trajectory scan
each, so the batch must stay small; a known perf cost to revisit). 0 errors.

**4. Substrate-native tending protocol** written as a fact (`protocol/tending`,
type `protocol`) — adapted from legacy tending v4 to `read`/`act` + lenses +
ambient elision (no run/dispatch ecosystem yet). Observe through lenses → classify
→ act-light → one audit.

## The tuning story (measured, not asserted)

The lens/override let me simulate any parameterization **offline** by inverting
`_meta.standing`/`centrality`/`velocity` back to raw signals (validated to 1e-4
against live scores), so a single corpus pull sweeps every variant.

- **Cold native corpus (731, pre-import):** signal-starved — 85% no trajectory,
  59% unlinked. Only high-variance signal is age, so global-default tuning had
  ~marginal headroom (std 0.055→~0.08); discrimination comes from the *lens*, not
  the default. Held the marginal default tweak.
- **Warm imported corpus (316):** the opposite — real `standing` (median 0.23, 40
  facts ≥0.5) but genuinely old. At the prior default (`standingWeight .20`) **~95
  earned, multi-read knowledge entries were wrongly elided** once aged — the Q1 risk
  made real. Measured fix: **`recencyWeight .45→.35`, `standingWeight .20→.30`** keeps
  every `standing≥0.3` fact above elision while still budgeting away the read-once
  tail (≈149/316, correct), and leaves fresh native work fully visible (native stays
  4/727/0). Deployed (#184).
- Note: elided ≠ inaccessible (still in `query`, behind a lens, via `peek`) — and
  the legacy salience *also* ranked most old entries deeply negative, so a large
  elided tail is consistent, not a regression.

## Outstanding

1. **Phase B — import the legacy link graph (860 edges).** Needs `SELECT * FROM
   links` (the SQLite path, which requires interactive approval — blocked while AFK)
   → bulk `ingest {edges}`. Until then imported facts have `centrality 0`, so the
   structural salience signal is dark for `kb/*` and earned-but-unread knowledge
   leans entirely on `standing`. **Do this first when back.**
2. **Final re-tune after edges land** — centrality will rescue connected knowledge;
   re-measure the joint corpus and likely nudge `centralityWeight` up.
3. **Weave pass** (the tending protocol's Phase 3) — deferred: high-confidence links
   need either the legacy graph (Phase B) or author judgement, not blind guesses.
4. **`ingest` perf** — per-fact `put→wrap` full-scans the trajectory; batch>~15
   times out at the edge. Score lazily on write, or scope the scan, before large imports.
5. **Port the legacy specialist ecosystem** (weave/fix/improve + an agent-run/
   dispatch primitive) — the biggest agent-ergonomics gap vs legacy (see addendum).
