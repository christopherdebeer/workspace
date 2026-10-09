# poetics

The poetics-of-instruction lab, one cell: `@c15r/poetics`, at https://c15r-poetics.on.parc.land.

The brief is `docs/poetics-of-instruction.md`; what we run first and why is
`docs/poetics-exploratory-programme.md`. The question, in one line: does the form of a
prompt (a sigil, a refrain, a notation) carry an intention through a model better than the
same intention in plain prose, once the content is held equal and the controls are in?

## What the Lambda does

Serves what is in this package, nothing else. All content under `static/` is produced by the
harness in git and arrives by deploy; the cell computes HTML at request time and no more.

| route | what |
|---|---|
| `/` | the proposition, the runs with their headlines, the materials |
| `/programme` | the exploratory programme (copied from docs/ by `aggregate.mjs`) |
| `/specimen/<id>` | an archived composition with its provenance |
| `/conditions/<set>` | every composition under test, with role and note |
| `/task/<id>` | a proxy task: instruction, source, what is scored |
| `/run/<id>` | a round's analysis: contrasts, per condition, per family, per task |
| `/run/<id>/<condition>` | every trial of one condition: output, score, what was missed |
| `/data/…` | the raw JSON |
| `/_tools` | read tools for agents: specimens · conditions · tasks · runs · run · trials |

## Layout

```
index.ts                       the Lambda: pages, /data, /_tools
md.ts                          markdown to HTML (lifted from @c15r/lab)
static/specimens/<id>.md       archived compositions, front matter = provenance
static/conditions/<set>/<id>.md  the compositions under test; front matter = id, role, note
static/tasks/<id>.json         proxy tasks: family, instruction, source, checks
static/data/index.json         the runs and their headlines (written by aggregate)
static/data/runs/<run>/        manifest.json (exact materials), trials-<condition>.json, summary.json
static/programme.md            copy of docs/poetics-exploratory-programme.md
devtools/                      the harness (not synced to the cell): run.mjs, aggregate.mjs, lib/
```

## A round

```
node cells/poetics/devtools/run.mjs --model haiku --placement system --reps 3
node cells/poetics/devtools/aggregate.mjs
node scripts/cell-sync.mjs push poetics --deploy --message "round: …"
```

`run.mjs` casts every condition × task × rep as a fresh headless `claude -p` session (one
turn, no tools, no MCP, no CLAUDE.md, the default system prompt replaced by the composition),
scores the output with `devtools/lib/score.cjs`, and writes the trials. `aggregate.mjs`
recomputes each run's summary and the index from the committed trials. `--dry-run` prints the
materials and spends nothing; `--run <id>` resumes or extends a round; `--placement user`
puts the composition at the head of the user turn instead.

The scorer is pinned by `tests/poetics-score.test.ts`.

## Adding

- A specimen: a `.md` under `static/specimens/` with front matter (`id`, `title`, `kind`,
  `provenance`, `status`) and the text, verbatim, in a fence.
- A condition set: a folder under `static/conditions/`. Keep one `none`, one `plain`, and the
  controls for whatever form you add; content-match everything to `plain`.
- A task: a `.json` under `static/tasks/` in one of the three families (`names`, `gaps`,
  `records`), or a new family with its scorer in `score.cjs` and its pins in the test.
- A contrast: `CONTRASTS` in `aggregate.mjs`, before the round, not after.
