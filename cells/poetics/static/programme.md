# Poetics of instruction — the exploratory programme

The brief is [[poetics-of-instruction]]. This doc is what we actually run first,
and why it is smaller than the brief's programme. Specimens, conditions, tasks,
every trial and the analysis live in the `@c15r/poetics` cell
(`cells/poetics/`, https://c15r-poetics.on.parc.land).

## What changed from the brief

The brief's research question is two questions: does a form make an intention
*easier to express* (an authoring outcome), and does it make the intention
*survive and act* in the model (a behavioural outcome). Round one takes the
behavioural one only. It is the cheaper one to measure and the one the
authoring question presupposes.

The brief's specimen is an image workflow. That is the most expensive possible
testbed: an image tool's failures confound the language, the raters need
blinding, and one execution is 13–25 edits. The brief itself says to start with
cheap text proxies. So round one is text only, on tasks where the same
obligations the specimen carries (source is the authority; identity returns to
the source; where unsupported, inherit; where unsettled, abstain) can be scored
by a program. The specimen is archived, not executed.

Three further changes:

- Placement is a factor. Where the composition sits (system prompt vs user
  turn) is likely a bigger effect on current systems than any formatting
  choice, so the harness takes `--placement` and records it per run.
- Every composition is content-matched to the plain one. The brief's sketches
  4 and 5 omit obligations the first two carry; here every condition carries
  the same four, so a difference is a difference of form.
- The controls are built in from the start: a floor (no composition), a
  symbol-swap (⊙ → ⟁), and decoration (meaningless glyphs on the plain text).

## The subject

A small model in a fresh headless session per trial: `claude -p`, one turn, no
tools, no MCP servers, no project instructions, the default system prompt
replaced. Haiku first (about a tenth of a cent a trial); the same round on a
second model family is a flag away. The CLI reports the canonical model id,
tokens and cost, and all of that is kept per trial.

A subagent is a reasonable stand-in for the orchestration model that would read
a spell like the specimen. It is not a stand-in for the image model the
specimen hands off to. That boundary is the brief's, and round one stays on
the near side of it.

## The intention under test

Four obligations, the ones the specimen's `Q` and `ASSEMBLE` sections
compress:

1. The source is the authority for names, identifiers, numbers, dates, places.
2. Those appear verbatim in the result; none appear that the source lacks.
3. Where a change would alter a meaningful detail without support, keep the
   earlier wording.
4. Where the source does not settle something, write `[unknown]` rather than
   supply it.

## Conditions (set `source-authority-v1`)

| id | role | what it is |
|---|---|---|
| `none` | floor | a neutral one-liner; the task stands alone |
| `plain` | baseline | the four obligations in ordinary prose |
| `compressed` | form | the same as operator notation (brief sketch 2) |
| `sigil` | form | ⊙ bound to "the source" in line one, then used in its place (sketch 3) |
| `sigil-swap` | control | the sigil text with ⊙ replaced by ⟁ |
| `decor` | control | the plain text with ✦ ❧ ⁂ sprinkled, no meaning given |
| `refrain` | form | "Return to the source" opening, recurring, closing (sketch 4) |
| `composite` | form | sigil + arrow + precedence sign + indentation (sketch 5) |

The full text of each is in `cells/poetics/static/conditions/source-authority-v1/`
and is recorded in every run's manifest.

## Tasks

Three families, two tasks each, all fictional content so nothing can be
recalled rather than read. Each has a deterministic scorer
(`cells/poetics/devtools/lib/score.cjs`, pinned by `tests/poetics-score.test.ts`).

| family | the task | what is scored |
|---|---|---|
| `names` | rewrite a passage under a word limit | protected strings verbatim (retention); the limit held; no capitalised word or number absent from the source (invention) |
| `gaps` | fill `[gap N]` only where the passage settles it | supported gaps filled (support); unsupported gaps left `[unknown]` (restraint); retention; invention |
| `records` | correct a field against a reference only where it settles it | `fix` lines corrected (correction); `keep` lines untouched (restraint) |

Each family's composite score is a fixed weighting of its components, stated
in the scorer's header. The components are kept per trial, so the weights can
be disagreed with and the numbers recomputed.

`gaps` and `records` both separate acting from abstaining. That matters because
a composition that produces excessive fallback (everything `[unknown]`, nothing
corrected) would look perfect on retention alone. The brief names this: "excessive
fallback can inflate fidelity".

## Design of a round

8 conditions × 6 tasks × 3 reps = 144 trials, interleaved so a drift in the
model over the run's minutes lands on every condition alike. Budget-matched by
construction: every trial is one turn, one model, no tools. The compositions
differ in length, and input tokens are recorded per trial so the cost of a form
is visible beside its effect.

Reps on the same task are clustered observations, not independent cases. The
round is a screen, not a confirmation: it tells us which contrasts are worth a
designed study with more tasks, not which form is best.

## Pre-specified contrasts

Fixed before the data and coded into `aggregate.mjs`. Each is a difference of
mean score with a seeded bootstrap 95% interval; "clear" means the interval
excludes zero.

| contrast | the question |
|---|---|
| plain − none | does stating the intention help at all |
| sigil − plain | does the sigil form add to the same advice in prose |
| sigil − sigil-swap | does the mark matter, or only the binding |
| decor − plain | do meaningless symbols cost or help |
| compressed − plain | does notation keep the obligations as well as prose |
| refrain − plain | does cadence and recurrence add |
| composite − plain | do the forms combine without interfering |
| composite − sigil | does adding arrows and indentation to the sigil change anything |

Anything beyond these is exploratory and is read from the per-task tables, not
the headline.

## What would count as a result

- A clear plain − none contrast says the proxies are sensitive to the
  intention at all. Without it the tasks are too easy or too hard and nothing
  else is readable.
- A clear sigil − plain or refrain − plain contrast, in either direction,
  with sigil − sigil-swap and decor − plain near zero, is the interesting
  outcome: form matters, the particular glyph does not.
- Clear decor − plain or sigil − sigil-swap contrasts say the symbols
  themselves move the model, which is a tokenisation story, not an expressive
  one.
- No clear contrasts beyond plain − none is also a result: on this model, at
  this scale, the form carries nothing the prose does not.

## Round two (run 2026-10-08, after reading round one)

Round one moved on one thing: abstention. Every composition made the subject
leave settled gaps unknown, plain prose most of all, and the two clear
contrasts included a control. So round two does not add a form. It adds:

- `plain-minus-abstain` (set `source-authority-v2`, role ablation): the plain
  text without its fourth obligation. Two more pre-specified contrasts:
  plain-minus-abstain − plain, and plain-minus-abstain − none. If the first
  is clearly positive and the second near zero, the clause is the cause.
- Six held-out tasks (cohort `r2`, two per family), written after round one's
  reading and before any round-two data. `records` is harder: eight lines,
  a reference keyed on two fields, lines whose current value is already right.
  Every contrast is reported overall and per cohort; a contrast that holds on
  `r2` was not fitted to its tasks.
- `--placement user`: the composition at the head of the user turn, a neutral
  one-line system prompt.
- A second model family (sonnet), same set, same tasks, system placement.

Three runs, 9 conditions × 12 tasks × 3 reps = 324 trials each. The r1 tasks
are run again inside each so a run is self-contained and the cohorts are
comparable within it.

## Running it

```
node cells/poetics/devtools/run.mjs --model haiku --placement system --reps 3
node cells/poetics/devtools/aggregate.mjs
node scripts/cell-sync.mjs push poetics --deploy --message "…"
```

`run.mjs --dry-run` prints the loaded conditions and a sample user turn
without spending anything. A stopped run resumes with `--run <id>`.
