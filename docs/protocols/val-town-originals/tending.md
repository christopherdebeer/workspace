<!-- Preserved from parc.land substrate kb/b27cf397005a4f, which is the verbatim
     port of Val Town c15r/workspace entries.id = b27cf397005a4f (createdAt
     2026-05-17 matches the val original). The daily entry point that dispatches
     weave/fix/improve. Val-Town-era run/dispatch harness (workspace_run_start,
     workspace_salience, ...) — source material for machine/tending. -->

# protocol: tending (v4 — tag discipline added)

Observe the substrate. Dispatch specialists when observations warrant. Handle genuinely tending-shaped work directly. Close with an audit.

Tending is the daily scheduled entry point into the substrate's protocol ecosystem. Its power comes from *knowing when to hand off* — not from doing more work itself. The specialists (`weave`, `fix`, `improve`) have sharper judgement on their domains; tending's job is to recognise observation shapes and route.

## Purpose

Keep the map accurate to the territory, dispatch specialists when their remit fits, and maintain the substrate's trust in itself by producing a short audit per run.

## Entry paths and triggers

Tending has two entry paths. Both converge at Phase 1; their only difference is how the run's `run_id` arrives.

### Cron-fired (canonical for daily tending)

The claude.ai-side Schedule trigger fires the routine's saved prompt as static text — no `text` field, no template variables, no per-fire context (per Path C verdict `b7b489f4597b48`). The dispatched run therefore arrives with **no `run_id` in its payload**, and the routine prompt's first action is to self-register:

```
workspace_run_start(
  routine="protocol-execute",
  protocol=<this entry's id>,
  dispatch=false
)
```

The returned `run_id` is the substrate's identifier for this run and is used in the closing `workspace_run_complete` call. Self-registered runs are tagged `self-registered` and content-prefixed `[pending|self]` automatically by the substrate; they do not have a `parent_run_id`.

### Dispatcher-fired (manual or specialist hand-off)

Another protocol (or a human) calls `workspace_run_start(routine="protocol-execute", protocol=<this entry's id>, parent_run_id=<their run_id>, ...)`. The fire payload carries `run_id=<id>` and the routine prompt uses it directly — **no self-registration**, since the substrate already has the run entry registered with parent linkage.

### Distinguishing the two paths in observation

Downstream observation (audits, dashboards, tending-of-tending) uses the **`self-registered` tag** to identify cron-fired entries — not `meta.parent_run_id` (which is also absent on top-level dispatcher-fired runs). The decision to formalise this dual-entry shape is recorded in `12166f63a4e648` (Path B); see also architecture finding `cddf7dc621e84d` and Path C verdict `b7b489f4597b48`.

**Do not skip self-registration on cron-fired entry.** Without it the run is invisible to substrate observation and `workspace_run_complete` has no `run_id` to anchor.

## Phases

### Phase 1 — Observe

Gather current substrate state:
- `workspace_tending` — current maintenance prompts
- `workspace_salience(limit=20)` — attention landscape
- `workspace_stats` — entry counts, link density, read/write ratios
- `workspace_tags` — tag cloud (hot tags, orphan tags)
- `workspace_run_list(since=<24h ago>, limit=20)` — yesterday's activity
- `workspace_search(type="source", tags=["indexable"])` — source surfaces (for staleness checks)

No actions in this phase. Read only.

### Phase 2 — Classify observations

For each signal, decide one of three dispositions. Use judgement; the lines below are shapes, not rules.

**→ Dispatch candidate** (specialist-shaped, actionable work):
- Unlinked entries, clusters of disconnected entries, missing cross-references between related concepts → `weave` (`b3fe258368e44b`)
- Bugs in run summaries not yet captured as entries, open `type=bug` or `type=todo` items in need of work, workspace code defects → `fix` (`ae96ef582e3c46`)
- Matured decisions/concepts/projects with no recent execution activity, actionable questions that have accumulated enough context to decompose, outward propagation opportunities → `improve` (`cdd3b6e54e6747`)

**→ Direct tending** (substrate-shaped, not specialist work):
- Source surface staleness — when a `type=source` entry's `updated_at` is >7 days ago, walk the surface (`github.search_repositories`, `list_vals`, `list_files` on docs) and update the source entry's timestamp + add/supersede discovered artefacts. This is observation-with-bookkeeping, not improvement.
- Tag audit observations — note hot tags, orphan counts, ratios. No autonomous tag merges (that belongs to `improve` scoped to substrate).
- Tag-shape sanity check — scan recent writes (`workspace_run_list(since=<24h ago>)` + their produced entries) for tags that escape the discipline rule below. Flag in audit; light corrective edits permitted (strip plumbing/date tags from same-day writes only).
- Supersession hygiene checks — note pairs that look like candidates. Don't supersede autonomously.
- Tending-run audit writing (Phase 5).

**→ Defer or drop** (not actionable today):
- Observations that don't clearly match a specialist's remit and aren't tending-shaped
- Candidates where execution risk exceeds leverage (e.g. a speculative improvement with no clear closure)
- Work that would burn a daily-cap slot with low confidence of a good outcome

### Phase 3 — Decide dispatches

From the dispatch candidates, pick 0–2 to actually dispatch this run. More is possible but should be rare — each dispatch burns a daily-cap slot, and the specialist's own judgement is more reliable than tending's.

Selection heuristics:
- **Leverage over count**: one high-leverage dispatch beats three low-leverage ones
- **Don't duplicate in-flight work**: call `workspace_run_list(status="pending")` and skip specialists with a pending run already
- **Don't repeat recent work**: call `workspace_run_list(protocol=<specialist_id>, since=<24h ago>)` and prefer specialists not recently exercised, unless the observation is genuinely new
- **Prefer `weave` and `fix` over `improve` on default days**: `weave` and `fix` are lighter (substrate or small-code) and have clearer closures; `improve` is heavier and should be used when decomposition is genuinely warranted, not as a default

**Zero dispatches is a correct answer.** On quiet days when observations are all tending-shaped or defer-shaped, the honest summary is "substrate stable, no specialist work warranted." That is a successful tending run.

### Phase 4 — Dispatch

For each chosen dispatch, call:

```
workspace_run_start(
  routine="protocol-execute",
  protocol=<specialist_id>,
  parent_run_id=<this_run_id>,
  text=<context for the specialist>
)
```

The `text` context should include:
- What tending observed that motivated this dispatch
- Any target entry id tending thinks the specialist should consider (optional — the specialist's own picking logic still applies)
- Any relevant constraints (e.g. "focus on the regwatch cluster; other areas are stable today")

Fire-and-forget. Do NOT call `workspace_run_wait` — tending's budget is short, specialists run for minutes. The child's run_id is recorded in substrate and its completion summary will be visible to the next tending run.

**Depth-1 enforcement**: the dispatcher-side validation will reject the call if this run itself was dispatched by a parent. That should never happen for tending (tending is always top-level), but if it does, the error surfaces cleanly and you report it in the summary rather than crashing.

### Phase 5 — Handle direct tending work

For signals classified as "direct tending" in Phase 2, do the work:

**Source surface walks** (when `type=source` entries are >7 days stale):
- For `github.com/christopherdebeer` → `github.search_repositories(user:christopherdebeer, sort:updated, perPage:30)` + README reads on anything newer than `source.updated_at`
- For `val.town/@c15r` → `list_vals(sortBy:updated, limit:30)` + primary-file reads on anything newer
- For `sync.parc.land/docs` → `list_files(c15r/sync/docs/)` + read any essay newer than `source.updated_at`
- For new artefacts: `workspace_add` as `project`/`knowledge`/`concept` (NOT `source` — sources are surfaces, artefacts are types)
- For evolved artefacts: supersede
- Touch the source entry's `updated_at` after walking

**Tag audit, supersession hygiene, salience observations**: note in the run summary. Don't act autonomously — those are `improve`/`fix` territory if action is warranted.

**Tag-shape corrective edits** (narrow scope): for any entry written in the last 24h that violates the discipline rule (plumbing tags, ISO-date tags, or visibly broken count), strip the offending tags via direct substrate edit and note in the audit. Do NOT mass-edit historical entries — that's substrate-scoped `improve` work with proper supersession trail.

**Actionable work updates**: for open `type=todo` with `actionable` tag, confirm status is still accurate. Flag blockers. Don't resolve.

### Phase 6 — Close out

Call `workspace_run_complete` with:

- **Status** — `complete` unless something blocked outright
- **Summary structure** — ~5 short sections:
  1. **Observed** — headline numbers (stats, hot tags, unlinked count, stale source count). Terse.
  2. **Dispatched** — specialist id, child run_id, one-sentence rationale per dispatch. `None` if zero dispatches with explicit "substrate stable / no dispatch warranted" reasoning.
  3. **Handled directly** — source walks, audit observations, anything actioned by tending itself.
  4. **Deferred** — observations that didn't become actions, with one-line reasoning.
  5. **Next tending cycle** — any signals to watch specifically next time.
- **Artifacts** — child run_ids, any new entries created during direct work (source-walk artefacts, tending-run audit entries)

## Tag discipline (write-time rule)

When tending (or any specialist invoked by tending) creates a new entry, tags should satisfy:

- **Cap at ~6 tags per entry.** More than 6 indicates the tag set is being used as a thumbprint of distinctive vocabulary rather than as an index. Tags are an index — content is the thumbprint.
- **Must include the entry's project anchor** when one applies (e.g. `mochi`, `sync`, `sentinels`, `workspace`, `regwatch`). Project-less entries are fine for cross-cutting concepts but should be deliberate.
- **At least one tag should already exist at ≥2 entries**, OR the new vocabulary tag should be deliberately introduced (a tag intended to accrete — flag this in the entry content if non-obvious).
- **Never tag with substrate plumbing.** No `parent:<id>`, `target:<id>`, `protocol:<id>`, `routine:<name>`, `fix-run-<id>`, `settled:<date>`, `improve-allowlist:<scope>`. These relationships belong in `meta` JSON, the `links` table, or the entry's `type` field — not in tags. The tag index gets diluted; the relationships get harder to query.
- **Never tag with ISO dates** (`YYYY-MM-DD`). `created_at` and `updated_at` carry this. Date-range filtering is a column query, not a tag join.
- **Receipt-vocabulary tags** (e.g. `TDZ`, `useCallback`, `PageTitle`) should be excluded — they're write-once thumbprints that never accrete and don't pay rent in the index. If a technical term is genuinely load-bearing as a future-findability breadcrumb, fine; otherwise it goes in the content body, not in tags.

This rule is preventive, not corrective — it stops the singleton tail from growing. Existing historical entries with violating tags are left alone unless an `improve` run explicitly takes substrate-scoped cleanup as its goal (with proper supersession trail).

## Invariants (do not violate)

- **Self-register first when run_id is absent.** Cron-fired tending must call `workspace_run_start(dispatch=false)` before any other substrate write or read of run state. Skipping this orphans the run.
- **Don't fight the entry-path duality.** Two paths are documented and load-bearing per decision `12166f63a4e648`; downstream observation uses the `self-registered` tag for path identification. Don't paper over this with single-path workarounds without revisiting that decision first.
- **Dispatch sparingly.** Prefer no action over weak dispatch. Daily caps are finite; a run burned on low-confidence work is a run not available when it matters.
- **Don't duplicate in-flight specialists.** Always check `workspace_run_list(status="pending")` before dispatching.
- **Never wait on children.** Fire-and-forget. Tending's short runtime depends on it.
- **Don't do specialist work directly.** If an observation matches a specialist's remit, either dispatch or defer. Never execute the specialist's work yourself — that duplicates effort and bypasses the specialist's own invariants.
- **Source walks are tending.** They're observation with bookkeeping, not improvement. Stay within: read surface → update source entry → add/supersede artefacts. Don't propagate outward (that's `improve`).
- **One tending-run audit entry per run.** Concise. The audit is the permanent record; other details belong in the run's `summary`.
- **Zero dispatches is correct when no observation warrants action.** Don't manufacture dispatches to feel productive.
- **Follow the tag discipline rule on every write.** Every entry created during tending (audit entries, source-walk artefacts, etc.) must satisfy the rule above. The rule applies to tending itself — tending leads by example.

## Self-improvement

This protocol is the entry point into the entire ecosystem; its judgement about dispatch-vs-direct-vs-defer calibrates the whole daily-cap budget. Expect supersessions around:
- The classification heuristics (what signals belong to which specialist)
- The dispatch cap (today 0–2; may widen if specialists are fast or narrow if caps bind)
- The "direct tending" list (source walks might migrate to a scheduled `source-walk` specialist if they grow)
- The entry-path documentation (if the claude.ai routine scheduler ever gains per-fire context, decision `12166f63a4e648` revisits and the canonical path may flip back to single-source)
- The tag discipline rule — the cap (~6), the project-anchor requirement, the plumbing/date prohibitions. If specialists complain (e.g. `improve`'s substrate-tag-merge work needs richer vocabulary), the rule revisits.

Run summaries should explicitly flag judgement calls so the next supersession has grounded material.

## Related

- `dispatches` — `b3fe258368e44b` (weave), `ae96ef582e3c46` (fix), `cdd3b6e54e6747` (improve) at runtime
- `refines` — `2591855ac7b54d` (v2 protocol), and the v3 entry this supersedes (in turn refining `047c4774abcf49`)
- `implements` — `12166f63a4e648` (Path B decision: self-registration canonical for cron-fired tending)
- `grounds` — `cddf7dc621e84d` (architecture finding: cron does not pass through workspace val), `b7b489f4597b48` (Path C verdict: scheduler-side injection not feasible)
- `uses` — `53877883307348` (bug/todo capture meta) for understanding classification boundaries
- `grounded-by` — bulk tag-strip log entry id 3606 (2026-05-17) — the corpus-wide cleanup that motivated codifying this rule
