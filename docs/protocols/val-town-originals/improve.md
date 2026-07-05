<!-- Preserved verbatim from Val Town c15r/workspace, entries.id = cdd3b6e54e6747
     (parc.land substrate: kb/cdd3b6e54e6747). Val-Town-era tool + allowlist
     references; source material for the substrate-native improve machine. -->

# protocol: improve

Take a mature substrate entry — a project, decision, concept, or resolved question whose natural next step is execution — and decompose it into actionable todos, then action what's safe to action this run. The generative counterpart to `fix`: where `fix` closes known items, `improve` creates and executes.

## Purpose
Close the gap between thinking and doing. Mature thinking accumulates as decisions, concepts, and projects in the substrate; without a protocol that *decomposes and acts*, improvements stall at the articulation stage. This protocol converts mapped intent into substrate-recorded todos (with scope, priority, grounding) and executes within scope-defined safety limits.

## Trigger
- Scheduled (alongside tend/fix/weave; or tending may dispatch it as a child run)
- Or manually: `workspace_run_start(routine="protocol-execute", protocol=<this_entry_id>, text=<instruction>)`
- Dispatched: when tending or another protocol determines improvement is warranted, as a child run via `parent_run_id`

## Input modes

**Caller-specified** (preferred when explicit):
- `text` context names the entry id to improve, e.g. `entry=<id>` or a substrate search that uniquely identifies one
- Optional mode flags in text: `dryrun` (decompose only, no execution), `scope=<s>` (override inferred scope)

**Salience-driven** (default when no entry specified):
- `workspace_salience(limit=20, type="project")` and `workspace_salience(limit=20, type="decision")`
- Filter out entries that have had an `improve` run in the last 72h (check via `workspace_run_list(protocol=<this_id>)` and inspect summaries)
- Filter to entries meeting eligibility criteria (below)
- Pick the top-salience remaining entry. If none qualify, skip with honest "nothing ripe" summary.

## Eligibility criteria for improvement

An entry is a valid `improve` target when all hold:
- Type is `project`, `decision`, or `question` (only questions with `actionable` tag or explicit closure criterion)
- Not superseded
- Has ≥1 inbound link (something in substrate motivates it — isolated entries aren't mature)
- Has ≥1 outbound link OR ≥3 reads (substrate-connected OR demonstrably attended to)
- Hasn't been superseded in the last 48h (avoid fighting in-flight revisions)

If the caller specifies an entry that fails eligibility, proceed anyway but note the exception in the run summary with reasoning.

## Phases

### Phase 1 — Establish target and scope

1. Pick the target entry (caller-specified or salience-driven).
2. Determine scope by inspecting the entry's tags and linked entries. Scope is one of:
   - `scope:workspace` — changes to `c15r/workspace` val code or substrate content
   - `scope:val:<val-name>` — changes to another Val.town val (via branching)
   - `scope:github:<owner>/<repo>` — changes to a GitHub repo (via branch + draft PR)
   - `scope:creation` — creating a new val or GitHub repo (requires the target entry to be a `project` with clear closure)
   - `scope:substrate` — substrate-only changes (new entries, links, supersessions)
3. Read the relevant allowlist entry for the determined scope:
   - workspace → `1490139028bc49`
   - val → `09adffe906df48`
   - github → `26569e0821c640`
4. If the scope is not permitted by its allowlist, either narrow to `scope:substrate` (produce entries only, no external action) or skip with a clear summary.

### Phase 2 — Decompose

Generate todos that together operationalize the target. Each todo follows the bug/todo capture meta-protocol (`35dc91abba0b4b`): one-sentence WHAT, one-sentence CLOSURE, minimal CONTEXT.

**Decomposition discipline** (no mechanical caps; judgement instead):
- Stop decomposing when further breakdown adds noise rather than clarity
- Each todo must be independently closable — if completing todo A depends on todo B's closure, they should be one todo, not two, unless the sequencing itself is load-bearing
- Todos should have `priority:p2` by default; elevate only with reasoning; drop to `p3` for genuinely optional items
- Inherit `scope:` from the target; refine if a todo is clearly out-of-scope from its siblings
- **Creation todos** (for `scope:creation` or creation-adjacent work) must satisfy the creation-readiness check below before capture

**De-duplication (required before creating each todo):**
Search existing open todos matching the proposed WHAT. If a strong match exists, link the target to the existing todo (`motivates`) instead of duplicating. If no match, create.

**Link every created todo** to:
- The target entry via `refines` (the todo is a refinement of the target's intent)
- The current run via `grounds` (the run is the evidence for the decomposition)

### Phase 3 — Action (scope-dependent)

After decomposition, select todos to execute this run. Use judgement, not quota:
- Prefer todos that unblock other todos (leverage)
- Prefer workspace/substrate scope over external scope (lower friction)
- Respect priority when leverage ties
- Stop when the next candidate's execution risk exceeds its leverage

For each selected todo, execute per scope:

#### `scope:substrate` — create entries, link, supersede
Direct substrate operations. No approval needed. Mark todo `status:resolved` when done.

#### `scope:workspace` — workspace val direct-commit
1. Verify scope is in the `workspace-direct-commit` allowlist (`1490139028bc49`).
2. Read relevant files (`Val.town:read_file`), draft change, apply via `Val.town:replace_in_file` or `create_file`.
3. Verify behavior via an MCP tool call or by re-reading the file.
4. Bump `SERVER_VERSION` in `mcp.ts` if a user-facing change was made.
5. Mark todo `status:resolved`.

#### `scope:val:<val-name>` — val branch
1. Verify the val is allowed per `val-branch` allowlist (`09adffe906df48`).
2. Create branch: `Val.town:create_branch` with name `improve/<run_id>-<slug>`.
3. Apply changes on the branch.
4. Record branch URL and summary in substrate: update the todo content with branch URL, tag `status:awaiting-merge`. Do NOT mark resolved — resolution happens when human merges.

#### `scope:github:<owner>/<repo>` — branch + draft PR
1. Verify repo is allowed per `github-branch-pr` allowlist (`26569e0821c640`).
2. Check `default_branch` via `GitHub:search_repositories` or repo metadata.
3. Create branch from default: `GitHub:create_branch`.
4. Apply changes: `GitHub:create_or_update_file` or `push_files`. Include commit trailers:
   ```
   Substrate-Run: <run_id>
   Substrate-Entry: <target_entry_id>
   ```
5. Open draft PR: `GitHub:create_pull_request` with `draft=true`. PR body includes target entry id, run id, and a link to the substrate entry.
6. Record PR URL in the todo, tag `status:awaiting-merge`, do NOT mark resolved.

#### `scope:creation` — create new val or repo
**Creation-readiness check** (all required):
- Target entry is type `project` with explicit closure criterion
- Target has ≥2 inbound links from motivating decisions/concepts
- Target's content names the proposed val/repo by intended identifier
- No existing val/repo already matches the proposed identifier (search first)
- Creation is the single next step (not "build the thing"; just "create the empty skeleton")

If all hold:
1. For val creation: `Val.town:create_val` with minimal placeholder (README or stub index file).
2. For repo creation: not currently implemented via available tools. Produce a diagnostic entry instead.
3. Add a new `type:project` entry (or update the existing one) with the created identifier in content and tags (e.g. `val:<name>` or `repo:<owner>/<name>`).
4. Mark the creation todo `status:resolved`.

If the check fails, capture the unmet condition as a sub-todo with `status:open` and move on.

#### Non-allowed scope → diagnostic only
Produce a diagnostic entry under the target (same shape as `fix`'s external-scope handling). Flag in run summary.

### Phase 4 — Dispatch children (optional)

If the decomposition yields todos in multiple scopes and depth-1 kickoff is available (this run has no parent), the protocol MAY kick off a child `fix` or `weave` run via `workspace_run_start(parent_run_id=<this_run_id>)` for sibling-scope work that would benefit from an isolated session. Do this sparingly — every dispatch burns a daily-cap slot.

### Phase 5 — Close out

1. Summarise: target picked, decomposition count, todos created/linked, actions executed (by scope), awaiting-merge items, children dispatched (if any).
2. Artifacts to pass to `workspace_run_complete`:
   - Target entry id
   - All new todo entry ids
   - New or modified code/val branches/PRs (referenced by URL in summary; entry id references for substrate artifacts)
   - Created vals/repos if any
3. The run's `produces` links will automatically connect this run to all listed artifacts.

## Invariants (do not violate)

- **Allowlists are authoritative.** Check the allowlist entry at run-time; never hardcode scope permissions in the protocol text.
- **Branching over direct edits, outside workspace.** Anything beyond `c15r/workspace` commits to a branch, never main.
- **Draft PRs only.** Never open ready-to-review, never merge, never close others' PRs.
- **Commit trailers.** All external commits include `Substrate-Run` and `Substrate-Entry` trailers.
- **Creation is rare.** `scope:creation` requires full readiness check; default to "not yet" when in doubt.
- **Never modify protocols mid-run.** If improvement reveals a flaw in `improve` itself or in a referenced protocol, capture a sub-todo and leave the revision for a later run.
- **Depth-1 kickoff only.** If `parent_run_id` is set, do not call `workspace_run_start`; the dispatcher already enforces this but check explicitly before calling.
- **Dry-run is honest.** If the caller specified `dryrun`, decomposition happens, no execution, summary explicitly states what *would* have been done.
- **One target per run.** Never pick a second target, even if the first requires little work. Excess budget goes to decomposition quality and sub-todo articulation.

## Self-improvement

This protocol will reveal judgement-heavy failure modes — especially in the "when to stop decomposing" and "which scope to infer" decisions. Run summaries should be explicit about:
- Why the target was eligible (or the eligibility override)
- Decomposition stopping criteria actually used this run
- Scope inference — what signals led to which scope
- Any allowlist narrowness that forced scope-downgrade

These surface areas are where supersession will concentrate. Expect v2, v3, ...

## Related

- `uses` — `35dc91abba0b4b` (bug/todo capture meta-protocol)
- `uses` — `1490139028bc49` (workspace-direct-commit allowlist)
- `uses` — `09adffe906df48` (val-branch allowlist)
- `uses` — `26569e0821c640` (github-branch-pr allowlist)
- `complements` — `ae96ef582e3c46` (fix — closes known items; improve creates them)
- `complements` — `b3fe258368e44b` (weave — links entries; improve actions them)
