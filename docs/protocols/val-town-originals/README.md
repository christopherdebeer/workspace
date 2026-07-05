# Pre-substrate protocol originals (Val Town `c15r/workspace`)

These are the **original protocol definitions** from the pre-parc.land workspace
substrate (Val Town val `c15r/workspace`, SQLite `entries` table), preserved
verbatim on 2026-07-05 during the migration investigation.

## Why they're here

The protocols were content-ported into the parc.land substrate as `kb/<id>`
facts (same ids). A diff confirmed **no textual detail was lost** — the
substrate copies are verbatim. What did *not* survive the port is **semantic
applicability**: every protocol is wired to Val Town workspace MCP tools that
do not exist in parc.land —

- `workspace_run_start` / `workspace_run_complete` (the run/dispatch harness)
- `workspace_salience`, `workspace_stats`, `workspace_tags`,
  `workspace_run_list`, `workspace_search`, `workspace_add`, `workspace_update`,
  `workspace_link`, `workspace_links`, `workspace_tending`

…plus concepts (`self-registered` tagging, `parent_run_id` depth-1 dispatch,
"daily-cap slots", allowlist-entry ids `1490139028bc49` etc.) that belong to the
old engine. So these files are **source material, not runnable specs**: the rich
phase structure and judgment heuristics are exactly what the substrate-native
tending machine (`machine/tending`) and its driver should be built from.

## Provenance map

| file | val id | substrate key | tags |
|---|---|---|---|
| `tending.md` | `b27cf397005a4f` | `kb/b27cf397005a4f` | tending · active-protocol · v4 · tag-discipline |
| `improve.md` | `cdd3b6e54e6747` | `kb/cdd3b6e54e6747` | improve · decomposition · execution · generative |
| `fix.md` | `ae96ef582e3c46` | `kb/ae96ef582e3c46` | fix · bugs · todos · lifecycle |
| `meta-capturing-bugs-todos.md` | `ed327907ffac45` | `kb/ed327907ffac45` | meta · bug-capture · todo-capture · reference |
| `weave.md` | `b3fe258368e44b` | `kb/b3fe258368e44b` | weave · links · first-protocol |

The originals also remain live in both stores (the val is not decommissioned;
the substrate `kb/<id>` facts are non-superseded), so this archive is a third,
diffable copy — not the only copy.

## The ecosystem shape

`tending` is the daily entry point; it observes and **dispatches** three
specialists — `weave` (link orphans), `fix` (close bugs/todos), `improve`
(decompose + execute mature entries) — and `meta-capturing-bugs-todos` is the
shared reference the specialists `use`. That dispatch topology is what becomes
the machine graph. See `docs/architecture/adr/0065-machine-drive-mode-per-run.md`.
