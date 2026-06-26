# 2026-06-26 — the silent machine-trigger failure (and four defenses)

A `work-code` machine validation kept "not starting": `trigger_run` wrote the trigger
fact, but no `machine/<m>/run/<run>` ever appeared. It looked like *latency* (logs
showed minutes-stale lines, writes draining in cold-start bursts). It wasn't.

## Root cause (proven via the strongly-consistent `workspace.changes` feed)
```
write trigger/r1 → read trigger/r1 → read _actions/<m>.start → (silence)
```
The `itrigger` reaction fired and loaded the `start` action, then the run-write never
happened. Mechanism:

1. The `start` action templates `text: ${value.text}`. On a trigger with **no `text`**,
   `resolveParams` coerced the unresolved exact placeholder to **`null`** (`?? null`).
2. The action interpreter's param validator saw `text: null` — *not* `undefined`, so it
   didn't skip the optional param — then `typeof null !== 'string'` → threw
   `invalid_param`.
3. The reactor's invoke `catch` only silently continues on `precondition_failed` /
   `action_disabled`; everything else is swallowed as a `warn`. So the run silently
   never started. Proven: the *same* machine triggered **with** `text` ran end-to-end
   (`run → done`, the work-code `parc.emit` fact landed). The only variable was `text`.

Not a regression from the branch cell deploys — the invoke path was untouched.

## Why it masqueraded as latency
- The failure was a **swallowed `warn`** (no surfaced error).
- `platform.logs`/`cells.logs` returned the **oldest** N of the window: `filterLogEvents`
  with a `limit` returns events from `startTime` forward, so a live tail showed stale
  lines and never the recent failure.
- Cold-start bursts on the organ write path looked like a backlog but were normal.

## Four defenses (each independently prevents the bug)
1. **`stripUndefined` at the DynamoDB write** (`platform/runtime/dynamo-state-store.ts`)
   — the SDK-v2 equivalent of `removeUndefinedValues`; an absent field never fails a write.
2. **`resolveParams` omits unresolved exact placeholders** (`services/workspace/subscriptions.ts`)
   — an unresolved `${value.text}` is now *absent*, not `null`.
3. **The action validator treats `null` as absent for optional params** (`services/workspace/actions.ts`).
4. **The reactor dead-letters swallowed failures** as an observable `_reaction-errors/<id>`
   fact (`services/workspace/handlers.ts`) — silent reaction faults now surface in the
   substrate, not just CloudWatch.

Plus an observability fix: `getLogsByGroupName` now **pages to the recent tail** (not the
window head), and `platform.logs` documents `since`/`filter`/`limit` (default 200).

## Lessons
- A swallowed `warn` on a best-effort reaction path is a latent silent-failure trap;
  dead-letter to the substrate so it's discoverable where the work lives.
- `null` ≠ absent: an "unresolved template" should be *omitted*, and optional-param checks
  must coalesce `null`.
- For live debugging, return the log **tail**, and prefer the strongly-consistent
  `workspace.changes` feed over lagged CloudWatch.
