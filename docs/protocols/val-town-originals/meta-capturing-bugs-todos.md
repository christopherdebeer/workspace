<!-- Preserved verbatim from Val Town c15r/workspace, entries.id = ed327907ffac45
     (parc.land substrate: kb/ed327907ffac45). The shared reference the fix/
     improve protocols `use`. Val-Town-era tool + allowlist-id references. -->

# meta: capturing bugs and todos

A reference for protocols that surface observations during normal work. Link to this entry with rel=`uses` when your protocol can produce bug/todo entries as byproducts.

## When to capture

Create a `type:bug` or `type:todo` entry when **you can answer "what would closing this look like?" in one sentence**. If the closure condition is vague, the observation stays in your run summary as context. Over-capture dilutes the backlog; under-capture loses information. Err toward capture when in doubt — `fix` will filter.

## Bug vs todo

- **bug** — something in the system is *wrong*, mis-behaving, or inconsistent with its specification. Verifiable; can be invalidated.
- **todo** — something *should be done*. An intent, improvement, or gap. Completable, not verifiable.

"implicitLinks returns empty when it shouldn't" → bug. "Consider excluding entries created <24h ago from unlinked count" → todo. "The vocabulary feels complete" → neither (observation, not actionable).

## Required tags

Every bug/todo entry carries:

- `bug` or `todo` (matches the type, but tag-searchable)
- One of the status tags (see Lifecycle below); start at `status:open`.
- A `scope:…` tag (see Scope below) — this is how `fix` and `improve` decide whether they can act and via which path.
- `priority:p0` through `priority:p3` — default `p2`. Only elevate with reasoning in content.

### Scope

Scope is defined by reference to the three authoritative allowlists rather than by a hardcoded per-system enumeration. Any scope tag resolves to exactly one path:

- `scope:substrate` — substrate-only (new entries, links, supersessions). No allowlist gate. Always actionable.
- `scope:workspace` — `c15r/workspace` val direct commit. Gated by the **workspace-direct-commit** allowlist (`1490139028bc49`).
- `scope:val:<val-name>` — another Val.town val, via branch. Gated by the **val-branch** allowlist (`09adffe906df48`).
- `scope:github:<owner>/<repo>` — GitHub repo, via branch + draft PR. Gated by the **github-branch-pr** allowlist (`26569e0821c640`).
- `scope:external:<name>` — anything not covered by the three allowlists. Produces diagnostics; never direct changes.

Do **not** invent per-system scope tags (`scope:sync`, `scope:regwatch`, etc.). If a system is already in an allowlist it falls under `scope:val:<name>` or `scope:github:<owner>/<repo>`; if it isn't, it's `scope:external:<name>` until the allowlist widens. The allowlist entries are the single source of truth — this document just names the buckets.

### Lifecycle (status)

An entry moves through at most four states. Tags carry exactly one.

- `status:open` — initial state at creation. Nothing has picked it up yet.
- `status:resolved` — closed. For a bug: the misbehaviour is gone and was verified. For a todo: the intent has been actioned. Sets on the superseding resolution entry (see *Resolution entry shape* below), not on the original.
- `status:awaiting-merge` — used by `improve` when a val-branch or GitHub draft PR is open and awaiting human merge. Resolution happens when the human merges, at which point a later run drops this tag and adds `status:resolved`.
- `status:needs-escalation` — used by `fix` for external-scope items that produced a diagnostic but can't be closed without human action in another system. The entry stays in the backlog; the tag marks it as "known blocked on human, don't re-pick."

Never skip directly from `status:open` to `status:active` or any other state not in this list.

## Required content shape

Three sections, terse:

1. **What** — one sentence. The observation or intent, stated factually.
2. **Closure** — one sentence. What done looks like. (The filter criterion from "when to capture".)
3. **Context** — optional. Reproduction steps for bugs; motivation or blockers for todos. Link to the run that surfaced this rather than reproducing its summary.

## Resolution entry shape

When a protocol (typically `fix`) closes a bug or todo, it supersedes the original with a **resolution entry**. The shape is:

- **Type** — stays `bug` or `todo` (whichever the original was). Supersession preserves identity.
- **Tags** — drop `status:open`; add `status:resolved`. Keep the `scope:…` and `priority:…` tags so the closure is scope-filterable in audits.
- **Content** — one sentence describing what changed, followed by a link or commit reference to the actual change (a SERVER_VERSION bump, a branch URL, a PR URL, or a substrate entry id depending on scope).
- **Linking** — the closing run gains a `produces` link to the resolution entry; no explicit link from the resolution back to the run is needed (the run's `produces` is bidirectional for traversal).

Callers that mark a todo resolved **without** supersession (e.g. `improve` closing a substrate-only sub-todo in-place) still honour the tag contract: drop `status:open`, add `status:resolved`, and leave a one-sentence closure note in the content via `workspace_update`.

## Priority vocabulary

- `p0` — drop everything; substrate trust compromised or work blocked
- `p1` — high; substantially degrades a protocol or common operation
- `p2` — normal; worth doing, not urgent
- `p3` — nice-to-have; cosmetic or speculative

When unsure between two levels, pick lower. `fix` will promote if leverage warrants.

## De-duplication before creating

Before creating a bug/todo, search for existing open entries covering the same thing:

```
workspace_search(q=<key phrase>, tags=["bug"|"todo", "status:open"])
```

If a match exists:
- If the existing entry captures it well, link your observation-source to it (`grounds` or `motivates`) instead of creating a duplicate.
- If your observation is stronger (better reproduction, clearer closure), supersede the existing entry with the improved version.

## Linking

- Link the bug/todo to the run that surfaced it: `<bug_id> → <run_id>, rel=grounds` (the run is the evidence for the bug).
- If the bug blocks or affects a known concept/project/protocol entry, link with `depends-on` or `refines` as appropriate.
- When `fix` resolves a bug, it supersedes the bug entry with a resolution entry and the closing run produces a `produces` link to it.

### When decomposing

When a sub-todo is generated by breaking a mature entry apart (e.g. `improve` decomposing a project / decision / question per protocol `cdd3b6e54e6747`), the sub-todo carries **two** links rather than the single `grounds` used for harvest-style capture:

- `<sub_todo> → <decomposition_target>, rel=refines` — the sub-todo refines the parent entry's intent.
- `<sub_todo> → <source_run>, rel=grounds` — the run that performed the decomposition is the evidence for the sub-todo.

The two-link convention serves two retrieval needs the single-link harvest shape doesn't:
- **Parent traversability** — the inbound `refines` set on a decomposition target is the canonical "what sub-todos belong to this entry?" query, used by `improve` (to see what's already decomposed) and `fix` (to pick a sibling).
- **Run provenance** — `grounds` preserves which run produced the sub-todo, which matters for audit and for harvest-style picks that ignore decomposition siblings already in flight.

Harvest-style capture (a single observation surfaced from run summary review) carries only `grounds → <source_run>`; the `refines → <target>` link is what marks an entry as belonging to a decomposition tree.

## Minimal example

Content:
```
WHAT: workspace_links returns empty `implicit` array for all entries, including well-tagged hubs.
CLOSURE: implicitLinks() returns a non-empty array for entries sharing ≥2 tags with others.
CONTEXT: surfaced by weave run caf852a8db7c42. Fell back to workspace_search. See session for query examples that should have matched.
```

Tags: `["bug", "status:open", "scope:workspace", "priority:p1"]`
Type: `bug`
