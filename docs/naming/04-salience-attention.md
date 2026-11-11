# Salience & Attention — "What is the reality of the situation?"

> Oblique card: *What is the reality of the situation?* — the grounding skeptic's
> lens. For every salience word, this doc strips the poetry and checks the math.
> Where the metaphor (standing, velocity, centrality, decay) promises more than
> `platform/runtime/state.ts` computes, it says so.

The vocabulary is a physics-and-gardening creole: a fact has a *score* blended
from *recency*, *velocity*, *attention*, *standing*, and *centrality*; reads are
shaped into *focus* / *peripheral* / *elided* tiers; and a *tending* loop reports
what is *stale*, *unlinked*, or *dangling*. It is largely honest — the math is
real, bounded, and instrumented — but several names overpromise, and three of
them (`salience` / `score` / `standing`) are doing overlapping jobs.

---

## 1. Inventory (name → what it ACTUALLY computes → what it IMPLIES → where)

| Name | What it actually computes | What the word implies | Where (file:line) |
|---|---|---|---|
| **score** | `clamp01(Σ weightᵢ · termᵢ)` over 5 terms — the single number that drives tiering. Rounded to 4dp. | A grade/ranking. Honest. | `state.ts:429-435` (`scoreParts`), exposed `_meta.score` `state.ts:696` |
| **salience** | Not a field — the *name of the whole subsystem* and the default lens (`SalienceLens='salience'` = empty preset = the tuned defaults). | "How much this stands out to an observer." | `state.ts:335`, `LENS_PRESETS.salience:{}` `state.ts:338` |
| **recency** | `2^(-age / halfLifeMs)`, age = `now - updatedAt`, default half-life **7d**. | Exponential time-decay. Honest, *but* keyed to last **write**, not last read/access. | `state.ts:421` |
| **velocity** | Score term: `min(windowWrites / 5, 1)` — recent **writes** in a 1h window, saturating. Also a *separate* `_meta.velocity` = `windowWrites / windowMinutes` (writes-per-minute, unbounded). | Speed/rate of change; a vector with direction. | term `state.ts:422`; `_meta.velocity` `state.ts:697` |
| **attention** | Score term: `min(windowReads / 5, 1)` — recent **reads** in the 1h window, saturating. Not surfaced as its own `_meta` field. | "What is being looked at." Reasonable — but a `read()` of the whole scope logs attention on *every* surfaced key (`state.ts:840`), and `query` deliberately does **not** log reads. | term `state.ts:423`; read-logging `state.ts:838-840`, `814` |
| **standing** | `min(log1p(lifetimeReads+lifetimeWrites) / log1p(20), 1)` — saturating log of *cumulative* touches (+ import seeds). | Reputation, status, "earned importance," durability. | `state.ts:427`; `_meta.standing` `state.ts:698` |
| **centrality** | `min(degree / 5, 1)` — raw in+out edge **degree**, saturating at 5. | Graph centrality (betweenness/eigenvector/PageRank). It is *only degree*. | `state.ts:428`, degree counted `state.ts:468-471`; `_meta.centrality` `state.ts:699` |
| **focus** | Tier: `score >= focusThreshold` (default 0.5). Full value + meta. | Where attention is directed. Honest as a *threshold*, but nothing is "focused on" — it's the top bucket. | `tierFor` `state.ts:475-479`; threshold `state.ts:321` |
| **peripheral** | Tier: `elideThreshold <= score < focusThreshold`. Full value, just "not focus." | Edge of vision. Honest-ish. | `tierFor` `state.ts:477` |
| **elide / elided** | Tier `score < elideThreshold` (0.1): value **withheld**, entry collapses to a `{key,type,score}` stub. `_meta.elided` flags it. | "Omit / leave out (and read it back implicitly)." Honest — and it's a genuine attention-budget cut, not just dimming. | `state.ts:478`, `shapeEntries` `state.ts:719-723`; `ElidedStub` `state.ts:106-110` |
| **tend / tending** | `attention()` (a derived read of stale/unlinked/dangling) distilled into one `tending/latest` audit fact, on a daily cron + manual verb. | Gardening: prune, weed, cultivate. The system only **reports**; it does not prune. | `runTend` `handlers.ts:1647-1669`; cron `lib/platform-stack.ts:143-145` |
| **attention (the read)** | `attention(scope)` → `{ stale, unlinked, dangling }`. Overloaded name vs. the score term above. | "What needs my attention." Honest as a maintenance queue. | `state.ts:955-994`; tool `handlers.ts:682-704` |
| **stale** | `now - updatedAt > staleMs` (default 14d) on a live, non-system fact. | Gone off, no longer fresh. Honest — but again **write**-age, so a fact read daily but never rewritten is "stale." | `state.ts:973-977` |
| **changes / trajectory** | `trajectory` = the append-only op log (`read|write|supersede|link|unlink`); `changes(sinceSeq)` tails it; it is also the *source* of every salience signal. | Path/direction over time; "what changed." Honest, though "trajectory" implies a fitted curve where there is only an event list. | `TrajectoryEvent` `state.ts:215-221`; `changes` `state.ts:941-953` |
| **lens** | A named weight preset (`recent`/`connected`/`durable`/`active`) that **recomputes** the score (vs `rankBy`, which only re-sorts). | Optical bias on the same scene. Honest and well-chosen. | `LENS_PRESETS` `state.ts:337-354` |

---

## 2. Tensions — metaphor vs reality

### 2a. `salience` vs `score` vs `standing` — three words, blurred jobs
- **`salience`** is the *family name* and the *default lens*, but never a stored
  number. **`score`** is the actual computed salience. So "salience" is both the
  umbrella and (via the lens) a synonym for "the default scoring." A reader can't
  tell from a value whether "salience" means the subsystem, the lens, or the
  number — and the canvas client literally reads `_meta.score` into a map called
  `salienceByKey` (`cells/canvas/.../salience.ts:13,84`). The number *is* salience;
  there is no reason to keep two words.
- **`standing`** sounds like a peer of `score` ("social standing," a status rank)
  but it is *one of five inputs to* `score`. Worse, it overlaps semantically with
  `score`: both claim "importance." The honest distinction — `score` is *momentary*
  salience, `standing` is the *cumulative* term — is invisible in the names.

### 2b. The physics metaphors are uneven in honesty
- **recency / decay** — honest. Exponential half-life is exactly what the word
  implies. The only quiet lie: decay is measured from **last write** (`updatedAt`),
  so a fact you *read* every day still decays. Recency is really "write-recency."
- **velocity** — the weakest physics word. Real velocity is a signed rate with
  direction; this is `min(writes/5, 1)`, a *saturating magnitude of writes*. It has
  no direction (a fact being hammered with corrections and a fact growing both read
  the same), and the score-term is clamped to [0,1] while the *separate* `_meta.velocity`
  is unbounded writes/min — two different numbers under one name. The design docs
  themselves note velocity is "a rare, bursty signal already mostly captured by
  recency" (`state.ts:287-289`) and cut its weight to 0.10. A signal the authors
  admit is mostly redundant should not carry the most evocative physics name.
- **centrality** — the boldest overclaim. In graph theory "centrality" is a family
  of structural measures (betweenness, closeness, eigenvector, PageRank) that ask
  *how central in the whole graph*. This computes `min(degree/5, 1)` — pure local
  degree, saturating at 5 edges. A hub-of-hubs and a node with 5 leaf neighbors
  score identically (both 1.0). It is **degree**, not centrality.
- **standing** — the metaphor (earned reputation that survives idleness) is
  actually *well* served by the math: `log1p` compression means each touch matters
  less and an old-but-loved fact keeps a floor (`state.ts:404-406`). This is the
  *most* honest of the metaphors. The problem is only the name's collision with
  `score` (see 2a).

### 2c. `tending` (gardening) — promises cultivation, delivers a report
The gardening frame is consistent and appealing (tend, stale, weed-implied,
"knowledge health" `state.ts:959`). But `runTend` is **read-only reporting**: it
calls `attention()` and writes one audit fact. It does not prune the stale, link
the unlinked, or fix the dangling — the trajectory doc's own "weave pass" is
*deferred* because real linking "need[s] author judgement, not blind guesses"
(`2026-06-15-...md:89`). So "tending" names an *aspiration*; today it is "auditing"
or "a health check." A gardener who only files reports is an inspector.

### 2d. `attention` is overloaded
It is both (a) the score *term* for recent reads and (b) the *maintenance read*
`attention()` returning stale/unlinked/dangling. These are unrelated concepts
sharing a word. One is "this got looked at recently"; the other is "this needs
looking at." Opposite directions of attention, same name.

### 2e. focus/peripheral/elided — honest, with one subtlety
The vision metaphor (focus → peripheral → elided) maps cleanly to three score
bands, and elision is a *real* attention-budget cut (the stub costs less than the
full envelope — `state.ts:101-104`). The one mismatch: "peripheral" implies
*reduced* fidelity (you half-see it), but a peripheral entry is returned in **full**
(`state.ts:725`) — only the *elided* tier is actually reduced. So the middle tier
is named for an effect it doesn't have.

### 2f. The signals are not as independent as five weights suggest
`recency` (write-decay), `velocity` (recent writes), and `attention` (recent reads)
all draw from the same trajectory window, and recency+velocity are openly
correlated. The five-term blend *implies* five orthogonal dimensions; in practice
it's closer to two-and-a-half (freshness, cumulative use, structure), which is
exactly what the four lenses collapse it back into.

---

## 3. Candidate vocabulary

A pass that matches names to the math, keeping the good metaphors:

| Current | Reality | Proposed | Rationale |
|---|---|---|---|
| `score` + `salience` (lens) | the computed [0,1] number | **`salience`** (the number); default lens → `'default'` | One word for the number. "Salience" is the right metaphor and is already what the canvas calls it. Retire `score` or keep as a deprecated alias. |
| `standing` | cumulative-use term | **`tenure`** or **`weight`** | "Tenure" captures *earned-through-time, survives-idleness* without colliding with `score`/`salience`'s "importance." "Weight" is plainer. Avoid "standing" — too close to "rank." |
| `centrality` | local degree, saturating at 5 | **`connectedness`** or **`degree`** | Stop claiming graph centrality you don't compute. If you later add real PageRank/betweenness, *then* "centrality" is earned. |
| `velocity` | saturating recent-write magnitude | **`churn`** or fold into recency | No direction, mostly redundant with recency (authors' own words). "Churn" is honest about "being rewritten a lot." Strongest candidate for *removal* as a distinct term. |
| `attention` (score term) | recent reads | **`interest`** or **`viewing`** | Frees "attention" for the maintenance read. "Interest" = recently looked-at. |
| `attention()` (the read) | stale/unlinked/dangling queue | **`maintenance`** / **`health`** / **`needsTending`** | It's a to-do list, not a score. Pairs naturally with `tend`. |
| `tend` / `tending` | reports health, doesn't act | **`audit`** (today) → reserve `tend` for when it *acts* | Name the current reality (audit/health-check); promote to "tend" only when it prunes/weaves. Or keep `tend` but be explicit it's *observational tending*. |
| `recency` | decay from last **write** | keep `recency`, but consider `freshness` and document it's write-keyed | Either rename to `writeRecency`, or also decay on read so the word becomes true. |
| `peripheral` tier | returned in **full** | keep, but document "full fidelity, lower rank" | Or rename the trio focus/**context**/elided, since "peripheral" implies degraded. |
| `trajectory` | append-only op log | keep — but know it's an *event log*, not a fitted path | Fine as poetry; just don't build "trajectory analysis" features expecting a curve. |

The four **lenses** (`recent`/`connected`/`durable`/`active`) are the best-named
part of the whole system and need no change — they're honest optical biases and
they already reveal the *true* dimensionality (≈3) underneath the 5 terms.

---

## 4. The honest core (what the family gets right)

Worth stating plainly, since the brief is skepticism: the *math* is disciplined.
Every term is bounded to [0,1], weights sum to ≤1 so `score` stays in [0,1] and
thresholds keep meaning (`state.ts:285-289`), saturation prevents the "legacy
unbounded score" runaway (`state.ts:404-406`), and the whole thing is **measured,
not asserted** — the tuning doc inverts live `_meta` back to raw signals and
A/B's parameterizations offline (`2026-06-15-...md:39-58`). The `_meta` breakdown
(`scoreParts`, `state.ts:385-393`) means the names are *falsifiable*: you can see
each term. That is the opposite of metaphor-as-handwave. The problem is purely
**lexical** — good math wearing names that promise a different (usually grander)
computation.

---

## 5. Top 3 concrete recommendations

1. **Collapse `score` + the `salience` lens-name into one word: `salience` is the
   number.** Today "salience" is the subsystem, the default lens, *and* informally
   the score; `_meta.score` is the actual value. Pick `_meta.salience` as the
   computed [0,1] number, make the default lens `'default'`, and let "salience" be
   the family name *because* it's the field. Removes the single worst ambiguity in
   the vocabulary (and matches what the canvas already calls it).

2. **Rename `centrality` → `connectedness` (or `degree`) and `velocity` → `churn`
   (or remove it).** These are the two dishonest physics words. `centrality`
   computes local degree, not any graph-centrality measure; `connectedness`/`degree`
   tells the truth and leaves "centrality" available if real structural metrics
   ever land. `velocity` is directionless, double-defined (clamped term vs unbounded
   `_meta.velocity`), and admittedly redundant with recency — rename to `churn` or
   fold its 0.10 weight into recency and drop the term.

3. **Split the overloaded `attention`, and rename `tend` to match what it does.**
   Free "attention" from doing two opposite jobs: the *score term* (recent reads)
   becomes `interest`/`viewing`; the *maintenance read* becomes `health`/
   `maintenance`/`needsTending`. And since `tend` only **reports** (the weave/prune
   pass is explicitly deferred), call today's verb `audit` (or document it as
   *observational tending*) and reserve `tend` for the day it actually cultivates —
   so the gardening metaphor stops writing a check the code doesn't cash.
