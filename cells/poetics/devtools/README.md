# poetics devtools (not synced to the cell)

| file | what |
|---|---|
| `run.mjs` | one round: conditions × tasks × reps, each a fresh `claude -p` session, scored, written to `../static/data/runs/<run>/` |
| `aggregate.mjs` | summaries and the index from the committed trials; copies the programme doc in |
| `lib/score.cjs` | the deterministic scorers, one per task family (pinned by `tests/poetics-score.test.ts`) |
| `lib/stats.cjs` | mean, sd, seeded bootstrap interval for a difference of means |

The subject's working directory is `$POETICS_SCRATCH` (default `/tmp/poetics-subject`), kept
empty so no project instructions load. Each trial is capped at `--budget` USD (default 0.05).
