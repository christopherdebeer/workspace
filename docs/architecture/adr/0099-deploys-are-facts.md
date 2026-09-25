# ADR-0099 — Deploys are facts: a cell's iteration history in the substrate

- **Status:** Accepted 2026-09-25 — built; tier-1 (cells + workspace services).
- **Depends on:** ADR-0027 (files as facts — the `source-manifest`), ADR-0052
  (capabilities are facts), ADR-0024 (delegation chain, `act`), ADR-0086
  (participants), ADR-0098 (System One perceives settled writes).
- **Grounded in:** a live read of the `cells/` slice on 2026-09-25.

---

## Context

Cells are facts. `createCellLifecycleHandler` projects every cell into
`cells/<id>` (type `cell`) and, on deploy, `cells/<id>/source-manifest` (type
`file`), and re-projects `_caps/*` per tool. Asked "how is our cell iteration
represented?", the substrate could only answer **what a cell is now**:

| Observation (2026-09-25) | Consequence |
|---|---|
| `cells/drive-dcfd1204` at **revision 44,796**; ~190 writes in 18h for 22 deploys | every save rewrote the pointer (`dirty:true`) — churn with no history |
| Each deploy overwrites the pointer + manifest | no deploy history in the slice (the analytics lake has it, but is admin-only and was unreachable) |
| `cell.deployed` carries `treeVersion`; the projector dropped it | the fact names a `Date.now()` version, not the source it built |
| Writer is always `platform/cells` | who deployed (me, the drive session, the owner) is unrecoverable |
| No commit / source link | "Git truth: cells/x" is asserted in prose, never recorded |
| system1/jev/consolidate cells carry only inferred `similarTo` edges | no link to their ADR or project |
| The System One subscription excludes `cells/` | correctly — pointers churn — but so iteration is never perceived |

## Decision

**A landed deploy is an event, and events are append-only facts.**

1. **`cells/<id>/deploy/<version>`** (type `cell-deploy`, tags `cell-deploy`,
   `cell:<name>`) is written once per landed deploy. `<version>` is the deploy's
   `Date.now()` string, so keys sort by time. Value:

   ```ts
   { cellId, cell, name, version, deployedAt,
     treeVersion, previousTreeVersion,        // exact source, and what it replaced
     previous,                                 // the prior deploy fact's key
     by, actor?, participant?,                 // who: principal, delegated leaf, participant
     description?, source?,                    // why, and where from (optional)
     changes?: { added, modified, removed, counts, truncated? },
     summary }                                 // always present — see §3
   ```

2. **Edges**: `deploy --deployOf--> cells/<id>` and
   `deploy --supersedes--> <previous deploy>`. The chain *is* the history;
   `workspace.edges({around: "cells/<id>"})` reaches it.

3. **`description` is optional — and the fact is useful without it.**
   - *Why optional:* deploys come from many paths (fused `writeFile deploy:true`,
     `applyPatchSet`, `cell-sync`, agents mid-loop). Requiring prose would
     either break those or train callers to write filler ("deploy"), which is
     worse than nothing. A deploy never fails for its note; over-long text is
     clipped (1000 chars).
   - *Why still present:* intent is the one thing the platform cannot derive.
     `changes` says *what* moved; only the caller knows *why*.
   - *Fallback:* `summary` is always set — the description's first line, else a
     mechanical `name: +a ~m -r files (paths…)`, else `name: deploy <v>`.
   - *Default from git:* `cell-sync push --deploy` fills `description` from
     `--message`, else — only when `cells/<name>` is clean — the last commit
     subject touching it; with uncommitted changes (the push-then-commit order
     drive's runbook uses) that subject names the *previous* change, so it is
     not borrowed and the script prints a hint instead. `source` is
     `git:<owner/repo>@<sha>` (`+dirty` when the deployed tree is not what git
     recorded).
   - *Later, not now:* System Two may annotate undescribed deploys from their
     `changes` during consolidation — a prose writer, so never Jev.

4. **Provenance is captured on the authorized request path.** Bus events carry
   no identity, so `cells.deploy` / `applyPatchSet` build a `DeployNote`
   (`by`, `actor` = ADR-0024 leaf, `participant`, `description`, `source`),
   store it on the `DEPLOYING` marker, and carry it on `cell.deploy.requested`
   to the worker, which puts it on `cell.deployed`. Provenance only — nothing
   authorizes on it.

5. **`changes`** is a file-level diff of the previous deployed snapshot against
   the new one (content versions, lists clipped at 50, true counts kept).
   Best-effort: a legacy unpinned deploy has no prior snapshot and omits it.

6. **The pointer stops churning.** `cells/<id>` gains `treeVersion`,
   `lastDeploy` (head of the chain) and `deployedAt`; a `cell.files.changed`
   that neither alters the file set nor flips `dirty` is **not written**. The
   iteration signal moves from the pointer's revision counter to the deploy
   facts.

## Consequences

- "What changed in drive today, by whom, and why?" is a `query {prefix:
  "cells/drive-dcfd1204/deploy/"}` or a walk of the `supersedes` chain.
- Deploy facts are text-bearing and embedded, so they surface semantically and
  get `similarTo` to the ADRs/docs they concern.
- **System One:** deploy facts are written by `platform/cells`, which the
  `system1-perceive` CEL excludes along with `cells/`. They are deliberately
  admitted by a narrow clause — `key` under `cells/` containing `/deploy/`
  **and** `meta.writer == "platform/cells"` — so each deploy gets a project and
  goal edge. The writer pin is the loop guard: System One's own tag rewrite of
  the deploy fact (writer `agent:system1.*`) does not re-match. Pointers and
  manifests stay excluded.
- **Salience:** `cell-deploy` gets a low type prior (0.25) — history should be
  findable, not flood recall. drive produces ~20/day; consolidation may later
  roll a day's deploys into one digest per cell (not built).
- `revision` on old pointers stays as-is; nothing is backfilled (the lake is the
  record before this ADR).

## Not decided

- A per-deploy code diff (hunks) as a fact — `cells.diff` computes it on demand
  from `treeVersion`s; storing it would duplicate S3.
- Retention/compaction of deploy facts beyond salience.

## Validation (2026-09-25, prod)

CDK run 36159761339 (tier-1 cells + workspace), then:

- `jev` redeployed with `description` + `source` → `cells/jev-30e878c9/deploy/1790353193324`
  carrying `by`, `description`, `source`, `treeVersion`; the pointer gained
  `treeVersion` / `lastDeploy` / `deployedAt`. No `previousTreeVersion`: the
  registry held no pinned `lastDeployed` from before this ADR.
- `jev` redeployed bare → `…/1790353234637`: `previous` + `supersedes` edge to the
  first, `changes` all zero, fallback `summary: "jev: redeploy, no source change"`.
- `system1` redeployed (its own ADR-0099 change) → `changes.modified: ["index.ts"]`,
  both tree versions, `source: git:…@21b1d35`. System One perceived it
  (`durable`, `s1:perceive-v1`, revision 2) and did not re-trigger. No project
  edge: the platform has no project fact — the same residue the ADR-0098
  taxonomy reports for substrate bugs.
- The vector index linked the jev deploys to ADR-0097 unprompted — the
  description is what makes that possible.
