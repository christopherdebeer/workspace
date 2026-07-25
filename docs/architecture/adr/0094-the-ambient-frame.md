# ADR-0094 — The ambient frame: orientation is a header, not a ranking

- **Status:** Accepted 2026-07-25 — built, gated, deployed tier-1 + tier-2,
  validated live. Filed from membrane probe wave 7 (`membrane-probes/wave-7`),
  the first wave aimed at **surfacing** rather than boundary honesty.
- **Depends on:** ADR-0033 (progressive disclosure — the overview-first default),
  ADR-0048 (altitude shaping), ADR-0050 (actor-classed touch counters — the
  anti-churn defence this ADR declines to invert), ADR-0051 (relevance; intent
  can demote), ADR-0074 (principal-adopted posture), ADR-0084 Open #4 (the
  ambient frame, scoped), ADR-0085 (capabilities are facts; the type-weight it
  asks for), ADR-0086 Inc 2 (presence in the frame).
- **Completes:** ADR-0084 Open #4 and ADR-0086 Inc 2 — both decided, both
  unbuilt. This ADR does not re-decide them; it builds them and says why the
  obvious alternative is wrong.

---

## Context (measured, not argued)

The question was: *does an agent that doesn't know what exists get oriented?*
Wave 7 pointed the battery's **capability-ignition** probe at the `@c15r/tasks`
vocabulary — three fresh, minimally-instructed replicas, natural vs directed.

**The starting hypothesis was falsified.** All three found the right work
unaided, including a deliberately weak model. Discovery is not broken:

| replica | calls | ignited on |
|---|---|---|
| directed (intent-first) | **3** | `query({text, type:'capability'})` → rank 1, `total:1` |
| natural | 8 | untyped `query({text})` — a `_caps/*` fact among content |
| natural (weak model) | 8 | `$catalog` browse |

What the wave found instead, and what this ADR answers:

1. **`whoami` was a dead call, 2/2.** Both naturals opened with it and got
   nothing useful — because its description advertised only "principal and
   granted scopes" while the handler had been returning `posture` (ADR-0074) and
   `participants` (ADR-0086) for weeks. It was answering; it never said so.
2. **The instructions offered three coequal doors** — "Know your goal?",
   "Browsing instead?", "To orient in your data" — with no ordering, when
   wave 7 measured 3-vs-8 calls and wave 5 measured 9-vs-12 between them.
   Wave 5's SWARM-G had already written this finding; it sat unactioned.
3. **The ignition band was 83% prose about the system.** A bare `recall()`
   returned 12 focus cards: 10 `doc`/`markdown`, 2 state. Five of the twelve
   slots were spent on two sources (three sibling blocks of one README, plus a
   doc+file pair). The band that *looks* like "what is going on here" was the
   band least about what is going on.

Finding 3 has a root cause that rules out the obvious fix. Measured live with
`explain:true`:

| fact | score | standing | note |
|---|---:|---:|---|
| `doc-block:docs/platform-reference/README/2` | 0.814 | 1.00 | freshly synced |
| `doc:…/adr/0023-type-declared-granular-scopes` | 0.603 | 0.988 | untouched 3 days |
| `consolidation/latest` | 0.702 | 1.00 | |
| `task/consolidation/mro5zqkugqq3` | **0.230** | **0.184** | |

`standing` carries weight 0.30 and never decays. Docs saturate it. A `task`
written by the `@c15r/tasks` cell is classed `agent` and takes a ×0.25 standing
multiplier — **so open work is structurally unable to outrank an essay.** That
multiplier is ADR-0050's deliberate defence ("the substrate's own machinery no
longer manufactures salience by churning"), and it is correct. The docs'
`standing` is itself manufactured — `docs-sync` authenticates as the human owner,
so every ingested block is classed `human` at weight 1.0, bypassing that defence.

---

## Decision

### 1. Open work goes in a FRAME, not in the band

`recall`'s overview gains `frame`: the adopted posture, live peers, and standing
work. It is a **header** — thin rows, capped, omitted when empty, never fails the
read it decorates, and computed off facts already in hand so it costs no extra
round trip.

This is ADR-0084 Open #4 verbatim: *"parked driven runs are standing
wait-conditions and belong in every driver's perception — scoped to a frame
header instead of a payload."*

**Why not re-rank instead.** Open work is not *more salient* than an essay; it is
a different kind of thing — a standing wait-condition. Making tasks win the
blended score would mean inverting ADR-0050's actor classing, i.e. letting
cell-written bookkeeping manufacture salience. ADR-0088 already records where
that leads: *"bookkeeping writes out-scoring the knowledge they track."* One
ranking cannot answer both "what is true" and "what is pending"; the frame lets
each keep its own question.

The frame **adds metadata and withholds nothing** — `adaptive-salience.md`'s
constraint on exactly this mechanism.

### 2. A type declares itself ambient; tier-1 never learns a cell's name

The frame is driven by an `ambient` facet in a cell's own `types.json`:

```jsonc
"ambient": { "as": "work", "when": { "status": ["todo","doing"] },
             "label": "value.title", "verb": "@c15r/tasks.next" }
```

Vocabulary as data, like `keyEdges` and render handlers (ADR-0093/0081/0052).
`@c15r/tasks` is the first consumer. Tomorrow it is inbox captures or contested
pairs, with no tier-1 change. The frame reports a **count and a pointer**; the
declared `verb` stays authoritative for the list.

### 3. One focus slot per source

A decomposed document exists as `doc:X`, `file/X.md` and N `doc-block:X/i`,
scoring within ~0.05 of each other. The band now keeps the best-scoring
projection per source, reusing `degeneracyOf` — the same predicate
`suggestions()` uses to refuse ratifying a block against its own parent — so the
two surfaces cannot disagree about what "the same thing" means. (W3-F1:
unanimous across four probe replicas in waves 1–3, unbuilt until now.)

### 4. Type priors are the sanctioned instrument for "reference vs state"

ADR-0085 asked for *"a lens, or a type-weight"* so tools surface when you ask
"what can I do?" and stay out of "what do I know?". That instrument already
exists — `_config/salience.typePriors`, a per-type multiplier on the ambient
blend — and it was already demoting `doc-order`, `canvas-placement`, `log`.

Two gaps were closed as **config, not code**: `file: 0.6` had been orphaned when
ADR-0081 retyped docs to `markdown`, and `doc`/`doc-block` never had a prior at
all. Machinery types (`subscription`, `graph-layout*`, `decompose-*`,
`public-share`) were added on the same principle.

Crucially, `prior` multiplies the ambient terms and **not** `relevance` — so a
demoted doc is unchanged under `query({text})`. This is precisely
"reference, not state" semantics: docs stay fully findable by meaning, they
simply stop winning an orientation read nobody aimed at them.

### 5. An advertisement must describe its behaviour

`whoami`'s description and `outputSchema` now name what it returns, and the
instructions teach **one ordered opener** rather than three coequal doors. Both
are gated: a jest test drives `tools/list` + `tools/call` with a maximal identity
and fails if any returned key is undeclared.

---

## Consequences

**Measured, live, before → after** (bare `recall()`, 12 focus cards):

| | before | after |
|---|---|---|
| documentation cards | 10 | 0 |
| machinery cards | ~1 | 1 |
| state + knowledge cards | 2 | 11 |
| slots spent on duplicate sources | 5 | 0 |
| `bands.focus` | 348 | 9 |

The `bands.focus` collapse is the honest number: 348 was inflated by ~5,300 doc
facts holding a manufactured `standing`. Nine facts out of 7,573 genuinely above
threshold is what a settled workspace looks like.

**Costs and honesty:**

- **The corpus is not healed, only re-weighted.** `standing` counters were baked
  in at write time and keep their inflated values. The prior is a multiplier over
  the top; fixing the `docs-sync` writer class (below) is prospective only.
- **Priors are hand-maintained.** A new machinery type appears un-demoted until
  someone notices. A principled default (e.g. types whose manager is a platform
  cell start low) would be better; not attempted here.
- **The frame is another thing on the hottest read.** Bounded by caps and
  omit-when-empty, but it is real bytes on every bare `recall()`.
- **Postured sessions lose the digest cache.** The digest is per-slice and the
  frame echoes the principal's posture, so caching it would serve one session's
  goal to the next. Correctness over the cache hit; postured sessions are rare.

## Open

1. **`docs-sync` authenticates as the human owner**, so ingested docs are classed
   `human` (weight 1.0) and bypass ADR-0050's anti-churn defence. Mint the CI
   token under a `platform/` principal. Prospective only — see above.
2. **Re-decomposition rewrites unchanged blocks**, spiking recency+velocity by
   ~0.45 across a doc's whole block fan on any deploy that touches it. A
   content-hash skip in `@c15r/lit` closes it.
3. **Centrality counts a doc's own projections** — measured at ~48% of one doc's
   degree. Real, but worth only ~0.015 of score; correctness fix, not a symptom
   fix.
4. **The `standing` signal has no decay** (ADR-0079, proposed, unbuilt). Every
   finding above is downstream of that.
5. **The sentinels are still five separate reads** (`$catalog`/`$types`/`$graph`/
   `$grants`/`$cells`, 71.5KB if you read them all; `$types` alone is 30.7KB).
   ADR-0085 Inc 5 already records the intent to collapse them into
   `query({type:…})`. Unbuilt, and the largest remaining piece of "the surface is
   too broad at first glance."

## Validation

The acceptance test is the instrument that produced the findings: re-run wave 7's
natural replicas verbatim against the deployed membrane. Closure is a drop in
calls-to-answer with the ignition path unchanged — **a counter improving without
a natural-condition probe behind it does not count as closed** (the protocol's
own honesty rule, promoted here to a decision).
