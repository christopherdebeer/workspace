<!-- Preserved verbatim from Val Town c15r/workspace, entries.id = ae96ef582e3c46
     (parc.land substrate: kb/ae96ef582e3c46). References Val-Town-era tools
     (workspace_run_start, workspace_search, workspace_run_list, ...) that do
     not exist in parc.land — source material for the substrate-native fix
     machine, not a runnable spec. -->

# protocol: fix

Own one full lifecycle of "bug or todo → closed." Each run picks one item, works it end to end, and either closes it or honestly reports where it got stuck. Harvest-from-recent-runs is the first phase so nothing slips through between protocol iterations.

## Purpose
Convert surfaced-but-uncaptured observations into bug/todo entries, then close one of them. Maintain substrate trust: bugs known are either being worked or explicitly deprioritised. Do not let observations rot in run summaries.

## Trigger
- Scheduled (alongside or as an alternative to weave/tend)
- Or manually, via `workspace_run_start(routine="protocol-execute", protocol=<this_entry_id>)`
- Skip if: 0 open bugs/todos AND last 3 runs had no uncaptured observations.

## Phases

### Phase 1 — Harvest

**Goal:** catch observations in recent runs that should have become bug/todo entries but didn't.

1. Determine the harvest window. Look up the most recent completed `fix` run via `workspace_run_list(routine="protocol-execute", status="complete")` filtered to runs produced by this protocol. Use its `kicked_at` as the lower bound. **Bootstrap case:** if no prior fix run exists, walk all runs in the substrate.
2. For each run in the window, read its summary carefully. Look for observations matching the capture criteria in the bug/todo meta-protocol (entry id `35dc91abba0b4b`): statements of something wrong, or something that should be done, where closure can be stated in one sentence.
3. For each candidate observation:
   - Search existing open bug/todo entries for duplicates (`workspace_search` on key phrase, filtered to `status:open` and the relevant type).
   - If a strong duplicate exists, skip — optionally link the source run to the existing bug via `grounds` to strengthen evidence.
   - Otherwise, create a new `type:bug` or `type:todo` entry following the shape in `35dc91abba0b4b`. Link it to the source run with `grounds`.
4. Cap Phase 1 at **10 new captures per run**. If more candidates exist, pick the clearest 10 and leave the rest for the next fix run. Over-capture is a failure mode; honest under-capture with a summary note is better.

### Phase 2 — Review and pick

**Goal:** choose one item to work on this run.

1. List all open bugs/todos: `workspace_search(tags=["status:open"], limit=50)`, filtered to `type:bug` or `type:todo`.
2. For each candidate, assess:
   - **Priority** (`p0` > `p1` > `p2` > `p3`)
   - **Leverage** — does fixing this unblock other protocols, or only improve one thing? A broken `implicitLinks` degrades every weave run; a cosmetic label issue doesn't.
   - **Scope** — workspace-scope is actionable this run. Non-workspace scope means "produce a diagnostic and escalation recommendation" rather than "implement a fix."
   - **Recency of evidence** — a bug backed by a recent run is better-understood than one from weeks ago without refresh.
   - **Cost estimate** — can you credibly close this in one run? If it needs human judgement or cross-repo code review, prefer a different pick.
3. Check each candidate for prior resolution: search for entries that `produce` a fix for it, or entries that supersede it. If the bug appears already-closed, mark `status:resolved` with a note pointing at the resolving entry and **return to step 2** to pick a different item. (This is the common case when harvest re-surfaces an already-known bug.)
4. Pick one. State the pick and reasoning explicitly in the run summary before proceeding. If no suitable pick exists (all open items out of scope, or all blocked), skip to Phase 4 with status=complete and an honest "nothing to do this run" summary.

### Phase 3 — Work it

**Goal:** close the picked item.

#### For `scope:workspace` bugs:
1. Investigate — read the relevant code in the `c15r/workspace` val (`ops.ts`, `runs.ts`, `mcp.ts`, `db.ts`). Use `Val.town:read_file`.
2. Propose a minimal fix. Prefer targeted `replace_in_file` over full rewrites — keeps version history legible.
3. Apply the fix. Verify it works: call an MCP tool that exercises the fix and confirm the observed behaviour matches expectations.
4. Bump the workspace MCP version in `mcp.ts` (minor bump for any behaviour change; patch bump for pure correctness fixes).

#### For `scope:workspace` todos:
1. Decide whether the todo reduces to a code change (then follow the bug flow above), a substrate change (new entry, supersession, re-link), or a protocol change (supersede the relevant protocol entry).
2. Execute. Substrate changes only affect workspace data; they're safe.
3. **Do not modify protocols as a side effect of fixing a code bug.** If the fix reveals a protocol gap, capture that as a new `type:todo` entry and leave it for the next fix run.

#### For non-workspace scope (`scope:sync`, `scope:regwatch`, etc.):
1. Do not attempt code changes to external repos in this run.
2. Produce a diagnostic: what's wrong, why it matters, what you'd need to fix it, whether it belongs as a GitHub issue in the target repo.
3. Add the diagnostic as content updates to the bug entry itself (via `workspace_update` or supersede with enriched version). Flag in the run summary that human escalation is appropriate.

### Phase 4 — Close out

**Goal:** record what happened, leave the substrate better than you found it.

1. **For a successful workspace fix:** supersede the bug entry with a resolution entry. Resolution entry type stays `bug`; new tags should include `status:resolved` and drop `status:open`. Content: one sentence describing the fix + link or commit reference to what changed.
2. **For a substrate-only todo completion:** update the todo entry's tags to `status:resolved`. No need to supersede unless the closure revealed the original todo was phrased wrong — in which case supersede with the corrected understanding.
3. **For external-scope items:** leave the bug `status:open` but update content with the diagnostic. Tag adds `status:needs-escalation`.
4. **For items picked then judged already-resolved in Phase 2:** update their tags to `status:resolved` with a note linking to the entry that actually resolved them.
5. Call `workspace_run_complete` with:
   - All new bug/todo entries created in Phase 1 (as artifacts)
   - The picked entry id (as artifact)
   - The resolution entry id if superseded (as artifact)
   - A summary structured as: *harvest result (N captured), pick (id + reason), work done, closure status.*

## Success criteria

- Every open bug/todo entry has up-to-date status; no zombies.
- One item legitimately closed, OR an honest "nothing picked" summary with reasoning.
- Harvest captured at most 10 new entries, each meeting the capture criteria.
- No false closures: if you couldn't verify the fix worked, the item is not `status:resolved`.

## Invariants (do not violate)

- **Workspace scope only for code changes.** Never push to external repos, never modify files outside `c15r/workspace`. External-scope items produce diagnostics, never fixes.
- **Never supersede this `fix` protocol within a run that executed it.** If fixing reveals a flaw in this protocol itself, capture a `type:todo` entry describing the revision and leave it for a later run to address. Prevents self-modifying loops.
- **One substantive fix per run.** If you finish early, do not grab another item; use the remaining budget for Phase 1 harvest quality or for updating existing bug entries with sharper context.
- **Respect priorities.** If an open `p0` exists and is in workspace scope, it is the pick unless it's already resolved or genuinely unfixable.
- **Never manufacture bug entries to hit harvest quotas.** 0 captured is a fine result.

## Self-improvement

This protocol will reveal its own gaps quickly — especially around the "leverage" heuristic (which items to prioritise beyond stated `priority:`) and the capture threshold (what counts as a one-sentence closure). Run summaries should be explicit about judgement calls so that future `fix` runs (or a human superseding this protocol) can refine the rules. This is a substrate-native protocol; it should mutate as we learn.

## Related

- `uses` — `35dc91abba0b4b` (bug/todo capture meta-protocol)
- `refines` — the original tending approach that observed-but-didn't-act
