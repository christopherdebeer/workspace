# Stem questions — v0 selection experiment

> Finding the small, fixed, domain-agnostic root layer ("stem cells") of an
> evolving hierarchical question taxonomy for System One (Jev). Context:
> ADR-0097, ADR-0098; TypeSafe docs (primitives, confidence, hierarchical
> classification, autoresearch feature discovery).

## Files

| file | what |
|---|---|
| `pool-v0.json` | 70 candidate stem questions over 13 facets (deliberately over-complete) |
| `analyze.js` | pure selection statistics (runs under node and inside `@c15r/run.exec`) |
| `sweep.js` | `run.exec` body: sample facts per type → `@c15r/jev.decide_many` → compact matrix shards |
| `analyze-run.js` | `run.exec` body: read shards back → `analyze()` → report fact |

Substrate facts (underscore keys: unindexed, never perceived):
`_stems/pool/v0`, `_stems/v0/{A,B,C}/matrix/NN`, `_stems/v0/full/report`.

## Method

Every pool question is asked of every sampled fact in **one** Jev call per fact
(state billed once; the whole 70-question pool measured at ~3,000 input tokens,
~43 tokens/question). Answers are stored as distributions in option order
(noul → `[no, yes]`).

Per question:

- **bits** = `H(mean answer) − mean H(answer_i)` — mutual information between
  *which item* and *the answer*. Zero if every item gets the same answer (no
  split) or every answer is a coin flip (no decisiveness). The primary stem
  signal: how much routing information one question buys.
- **escape** — mean mass on `other/none/unclear/neither`: the vocabulary gap,
  i.e. the growth signal.
- **na** — mean mass on "does not apply" options: a conditional question, i.e. a
  *branch* question masquerading as a stem.
- **redundancy** — soft-joint MI between two questions over the smaller one's
  informative bits (0–1).

Selection is greedy: pick max `bits × (1 − max redundancy to already chosen)`,
stop below 0.08 bits of marginal gain or at 24 questions.

## Results (2026-09-29, `jev-1.13.0`)

578 facts across 20 types (captures, claims, docs, markdown, knowledge,
decisions, todos, questions, projects, bugs, doc-blocks, transcripts, …), 70
questions each, 0 errors. 1.86M input tokens ≈ **$0.08** for the whole sweep.
(`_stems/v0/matrix/00–03` + the superseded `_stems/v0/report` are a first run
that silently lost most of its corpus to the 60 KB read budget; ignore them.)

### The selected 24 (greedy, ≈1,340 of 2,777 pool tokens)

| # | question | type | bits | note |
|--:|---|---|--:|---|
| 1 | `form_kind` | choice | 2.09 | the dominant stem: log 28%, spec 23%, reference 9% … |
| 2 | `act_type` | choice | 1.37 | what the content leads to |
| 3 | `form_cognitive_role` | choice | 1.32 | observation / conclusion / plan … |
| 4 | `form_speech_act` | choice | 1.17 | **16% `other`**: missing option (describe/explain?) |
| 5 | `form_genre` | choice | 1.34 | only 0.38 redundant with `form_kind`: a separate axis |
| 6 | `time_lifecycle` | choice | 0.92 | 17% n/a |
| 7 | `agent_audience` | choice | 0.99 | 10% `unclear` |
| 8 | `subj_domain` | choice | 0.85 | 82% "software": near-constant *in this corpus* |
| 9 | `subj_abstraction` | score | 0.85 | |
| 10 | `form_knowledge_type` | choice | 0.83 | |
| 11 | `time_deadline` | noul | 0.75 | crisp, conf 0.75 |
| 12 | `use_function` | choice | 0.80 | |
| 13–24 | `act_effort`, `gran_completeness`, `time_orientation`, `stakes`, `dur_lifespan`, `dur_novelty`, `subj_technicality`, `gran_shape`, `stakes_importance`, `agent_person`, `agent_focus`, `fit_clarity` | | 0.47–0.76 | |

Selection hit the 24 cap, not the gain floor: the pool has more independent
signal than 24 questions carry. Max pairwise redundancy anywhere is only 0.38.

### What the numbers say about designing stems

1. **"What kind of thing is this" is the stem axis.** The top five are all form
   and act questions, and they stay mostly independent: kind, rhetorical act,
   genre and cognitive role each add bits. Subject domain comes after them.
2. **Stems must be observable, not predictive.** Nouls that ask for a judgement
   about the future or about other people are coin flips. Each of these has
   confidence ≤ 0.15 and < 0.11 bits: `dur_reference` ("would someone look this
   up later?"), `fit_single_label`, `use_teaches`, `mod_contestable` and
   `form_machine_made`. Crisp textual properties work: `time_deadline` (0.75
   confidence) and `agent_person` (0.67). This matches Jev's jaggedness notes:
   it reads literally and doesn't infer intent. Rewrite predictive questions as
   observable ones, or drop them.
3. **Guards are a different class.** `sens_secret`, `sens_health`,
   `sens_private`, `sens_financial` and `fit_noise` are decisive (confidence
   0.5–0.8) but rare, so they score near 0 bits. Information is the wrong way to
   value them; the cost of missing one is what matters. Keep them as an
   always-asked guard tier (~150 tokens) outside the selection.
4. **`na` flags branch questions posing as stems.** `agent_perspective` (65% "no
   clear perspective") and `place_scale` (31% "no physical place", plus
   `place_material` at 12% yes) are conditional here. They belong under a gate,
   not at the root.
5. **`escape` is the growth signal, and it works.** The options are missing
   something in `form_speech_act` (16% other), `mod_modality` (16% other,
   probably "as a rule / specification"), `subj_domain_coarse` (14% neither) and
   `agent_audience` (10% unclear). Those are the first splits or new options.
6. **Corpus bias is real.** This workspace is mostly about building itself, so
   `subj_domain` scores 0.31 on marginal entropy. Freeze nothing until the pool
   has also been swept over non-dev input: personal captures, agent turns,
   inbound mail.

### Proposed v1 root (for the next sweep)

- **Routers** (choices, gate the branches): `form_kind`, `form_speech_act`
  (+ "describing or explaining"), `form_genre`, `form_cognitive_role`,
  `act_type`, `time_lifecycle`, `agent_audience`, `subj_domain`,
  `form_knowledge_type`, `use_function`.
- **Dials** (scores, for salience and ranking, not routing): `subj_abstraction`,
  `act_effort`, `gran_completeness`, `stakes`, `dur_lifespan`, `dur_novelty`,
  `subj_technicality`, `fit_clarity`.
- **Detectors** (crisp nouls): `time_deadline`, `agent_person`,
  `agent_product`, `agent_org`.
- **Guards** (always asked, not selected by bits): `sens_secret`,
  `sens_private`, `sens_health`, `sens_financial`, `sens_ai_directed`,
  `fit_noise`.
- **Demote to branches:** `agent_perspective`, `place_*`.
- **Rewrite or retire:** `dur_reference`, `fit_single_label`, `use_teaches`,
  `mod_contestable`, `time_sensitive`, `gran_self_contained`,
  `form_machine_made`, `use_audience_value`, `fit_clear_purpose`.

That is ≈28 questions and ≈1.5k question tokens, one Jev call per input:
≈ $0.07 per 1,000 inputs plus state.

### Caveats

- `bits` favours many-option choices: a noul maxes out at 1 bit. Per token the
  types are comparable (`form_kind` ≈ 0.018 bits/token, `time_deadline` ≈
  0.025). Ranking by bits per token is a one-line change.
- No ground truth yet. `bits` measures how much a question *discriminates*, not
  whether it is *right*. Routers need the ADR-0098 labels (reverted, corrected,
  used) before any of them gates an act.
- State is truncated to 1,200 characters, so long docs are judged on their
  opening.

## Athena / extraction at scale

Athena is **not broken**: `workspace.athena` ran a full `GROUP BY` over the lake
in seconds (~0.94 GB scanned, ≈ $0.005). It was not the bottleneck for this
experiment, and it is the wrong tool for it today:

1. **The lake is a change log, not a table of facts.** 719,321 rows for 12,173
   keys (~59 revisions per key, 3.9 GB of `value_json`). "Current state of every
   fact" needs a `row_number() … revision DESC` dedupe on every query.
2. **Gzipped JSON can't be column-pruned.** Every query scans the whole ~0.94 GB
   regardless of the columns it touches.
3. **The surface is small by design.** `platform:*`-gated, 1,000-row cap, 50 s
   timeout, and results come back through the caller's context — useless for
   feeding hundreds of states into a judge.

What actually bit this experiment was the **substrate read budget**:
`workspace.query` refuses any page over 60 KB and returns `{error}` with no
entries (`markdown`, `project`, `transcript` pages of 10–40 long facts). A
first run silently lost two-thirds of its corpus that way. Server-side
(`run.exec`), `whole: true` is the right override; paging with `cursor` is the
general fix. Worth making the error loud in `parc.call` rather than a result
shape callers have to remember to check.

If/when judging runs over the whole corpus (not a stratified sample), the
cheap, aws-native fix is:

- **`facts_current`** — a compacted Parquet (or Iceberg) snapshot, one row per
  live key, rebuilt nightly by CTAS/`MERGE`. Type/key/tag scans drop from GB to MB.
- **`UNLOAD` to S3** instead of `GetQueryResults` for bulk extraction, so a cell
  reads the result file directly — no row cap, no context.
- **Firehose Parquet conversion** of the lake itself (already listed under
  "Later" in `docs/substrate-analytics.md`).

None of that is needed to grow the stems: the stem pass is per-write (ADR-0098
perceive-on-write), and calibration corpora are hundreds of items.
