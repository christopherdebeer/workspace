# ADR-0097 — Jev as a semantic judgment layer for tagging, relations, and tending

- **Status:** Proposed 2026-09-23 — research draft; no platform integration built.
- **Amended by:** ADR-0098 (System One, always on) — posture moves from
  observation-only to act-by-default with learned thresholds; research, cost
  model and data boundary here stand.
- **Depends on:** ADR-0030 (S3 Vectors as candidate retrieval, not authority),
  ADR-0031/0032 (`similarTo` as weak, ratifiable structure), ADR-0050 (the score
  stage), ADR-0073 (the consolidation organ), ADR-0088 (wake-on-change), and
  ADR-0089 (single-origin fact fanout).
- **Grounded in:** TypeSafe's current Jev API and pricing documentation, the
  `@c15r/jev` cell pulled from Drive and exercised live on 2026-09-23, and the
  platform's existing AWS Lambda/S3/SQS cost model.

---

## Context

The substrate already has semantic **recall**:

- Bedrock embeddings and S3 Vectors retrieve nearby facts (ADR-0030);
- vector similarity proposes weak `similarTo` structure (ADR-0031/0032);
- deterministic score, attention, contested, and consolidation surfaces decide
  what becomes salient and what needs tending.

What it lacks is a reusable semantic **judgment** seam between retrieval and
action. Today the options are either structural heuristics or a generative model
called from a particular cell or Machine. That makes questions such as these
more expensive and less composable than they need to be:

- Is this fact actionable, personal, stale, contested, or durable?
- Which one taxonomy branch best describes it?
- Do these two facts duplicate, support, contradict, supersede, or merely
  resemble one another?
- Which retrieved candidates really satisfy the query?
- Is a proposed tending action safe enough to apply, or should it be reviewed?

Jev is a TypeSafe System One API for typed judgments over supplied text. It does
not generate prose or embeddings. Its primitives are:

- **Noul:** an independent probability for a binary attribute;
- **Choice:** a probability distribution over mutually exclusive options;
- **Score:** a judgment against an ordered qualitative scale.

The application supplies the possible meanings and owns the final combination,
threshold, and action. That constraint fits the substrate: models may observe
and propose, but facts, grants, policy, and ratification remain authoritative.

## Grounded findings

### Jev is a judge, not another vector index

Embeddings answer *which records might be near this query*. Jev answers *whether
a candidate actually satisfies a declared semantic relation*. Replacing S3
Vectors with Jev would require judging too much of the corpus and would throw
away reusable retrieval structure. The useful composition is:

```text
fact/query
  → structural, lexical, graph, or vector candidate retrieval
  → Jev typed judgments over a bounded candidate set
  → durable derived assertions
  → deterministic policy
  → no-op | tag | link | queue | human | Machine
```

S3 Vectors remains an advisory recall accelerator under ADR-0030. Jev becomes
an advisory precision and interpretation layer. Neither is an authorization
boundary or source of truth.

### Pricing is token-based and state reuse matters

As of 2026-09-23, `jev-1.13.0` / `jev-latest` costs **$0.042 per million input
tokens**, with output tokens free. The direct cost is:

```text
cost = input tokens / 1,000,000 × $0.042
```

Illustrative direct Jev cost per million assessed facts or queries:

| Input per assessment | Jev cost |
|---:|---:|
| 100 tokens | $4.20 |
| 500 tokens | $21.00 |
| 1,000 tokens | $42.00 |
| 3,000 tokens | $126.00 |
| 4,000 tokens | $168.00 |

The live `@c15r/jev` trial assessed one shared state with Noul, Choice, and Score
in one `decide` request. It used 539 input tokens: **$22.64 per million
three-judgment assessments**. Issuing the same three judgments separately used
1,263 tokens: **$53.05 per million assessments**. Sharing state reduced the
measured Jev charge by about 57%.

The unit of optimization is therefore not merely "fewer calls." It is:

1. retrieve the smallest pertinent state;
2. ask all independent questions that share it together;
3. persist and reuse the observations until an input, policy, or model changes.

### Relative AWS costs

Illustrative marginal AWS costs per million items, excluding free tiers,
retries, logs, networking, NAT, and any Parc or TypeSafe enterprise charges:

| Operation | Approximate cost |
|---|---:|
| Lambda, 128 MB for 100 ms | $0.41 |
| Lambda, 512 MB for 100 ms | $1.03 |
| Lambda, 1 GB for one second | $16.87 |
| S3 Standard, one PUT per item | $5.00 |
| S3 Standard, one GET per item | $0.40 |
| SQS Standard, send + receive + delete, unbatched | ~$1.20 |
| SQS Standard, same operations in batches of ten | ~$0.12 |

An unbatched SQS → small Lambda → S3 PUT path is therefore about **$6.61 per
million facts** before semantic evaluation. A 500-token Jev assessment brings
the path to about **$27.61 per million facts**. Jev is normally the largest
marginal component, but remains small in absolute terms. At very short states,
one-S3-object-per-result request charges can equal or exceed the judgment cost;
derived semantic observations should normally remain substrate facts rather
than individual S3 objects.

AWS's published S3 Vectors example prices ten million stored vectors plus one
million top-100 queries at about $11.38/month, excluding embedding generation.
That reinforces the division of labour: vector retrieval supplies cheap broad
recall; Jev judges only the shortlist.

### Operational envelope

The documented default limits are 1,200 requests/minute and 250,000
tokens/second. The current context limit is 64k total tokens, with 32k available
to state plus the longest question. At default request limits, shared-state
multi-question calls are important for both cost and decision throughput.

The live cell found one contract wrinkle: its schema accepts Score `criteria` as
an array or a top-level object, but the upstream API returned `422` for the
top-level object. An ordered array works and matches TypeSafe's documented Score
contract. Any reusable integration must normalize to that form.

## Decision (proposed)

Introduce Jev as a **shared semantic judgment layer**, not as logic embedded
inside a particular Machine. Machines may consume its observations or act on
policy outcomes, but they are one actuator among several.

The layer has four versioned protocol shapes.

### 1. `semantic.annotate/v1`

Assess one fact for:

- independent Noul tags such as `actionable`, `personal`, `contested`,
  `ephemeral`, `durable`, and `needs-review`;
- one mutually exclusive Choice taxonomy, always including `none` or `other`;
- ordered Score dimensions such as urgency, novelty, reliability, specificity,
  and expected durability.

This protocol produces observations, not mutations. A separate policy decides
which tags to materialize and at what probability/confidence threshold.

### 2. `semantic.relate/v1`

Assess a fact pair, retrieved from graph or vector candidates, for declared
relations such as:

```text
sameAs | duplicates | supports | contradicts | supersedes |
dependsOn | elaborates | unrelated
```

It should feed ADR-0032's suggestion/ratification path. Jev may propose a
relation and direction; an inferred proposal remains weak and provenance-
stamped until policy or a person ratifies it. Existing authored structure is
never silently replaced.

### 3. `semantic.rerank/v1`

Assess a bounded retrieval set on atomic dimensions—relevance, authority,
freshness, specificity, or fit—then combine them in deterministic code. Jev
does not own the ranking formula. The formula and thresholds are versioned
policy so a changed product decision does not require reinterpretation of an
opaque model answer.

### 4. `tending.inspect/v1`

On a fact change, assess the fact and its immediate neighbourhood for:

- duplication or semantic overlap;
- contradiction or unresolved contest;
- missing provenance;
- staleness or decay;
- actionability and urgency;
- a safe next disposition.

The disposition vocabulary is bounded:

```text
no-op | annotate | suggest-link | queue | request-review | invoke-machine
```

Jev does not generate arbitrary actions. The tending policy maps typed
observations into existing substrate verbs, with ADR-0066-style version checks
and ADR-0073's autonomy ladder. Contradictions remain escalation-only unless a
later ADR explicitly changes that invariant.

## Semantic observations are facts

Every material judgment is stored as an immutable or supersedable derived fact,
not hidden inside a cell table or model transcript:

```ts
{
  subject: "fact/key",
  predicate: "semantic/actionable",
  value: true,
  probability: 0.82,
  confidence: 0.68,
  primitive: "noul",
  model: "jev-1.13.0",
  policyVersion: "semantic.annotate/v1",
  subjectHash: "...",
  contextHashes: ["..."],
  observedAt: "2026-09-23T..."
}
```

The identifying cache key is:

```text
subject hash + context hashes + question/policy version + pinned model version
```

When none changes, the observation is reusable. When one changes, a new
observation supersedes the old one. This makes model upgrades replayable,
permits threshold recalibration without re-calling Jev, and keeps the evidence
for an automatic tending action inspectable.

## Cost and safety controls

1. **Retrieve before judging.** Use graph, types, exact filters, and S3 Vectors
   to reduce the candidate set before any Jev call.
2. **React to deltas.** Evaluate changed facts and affected neighbours, not
   periodic full-corpus sweeps.
3. **Coalesce bursts.** One settled revision should produce one assessment.
4. **Share state.** Combine independent questions against the same state in one
   request.
5. **Cache by evidence.** Do not pay again for the same content, context, policy,
   and model.
6. **Keep state jaggedness low.** Supply a small, explicit neighbourhood rather
   than a whole workspace or undifferentiated document bundle.
7. **Use confidence bands.** High-confidence, reversible actions may proceed;
   ambiguous cases become attention items; low-value cases are no-ops.
8. **Pin the model.** Production protocol versions name `jev-1.13.0`, not the
   moving `jev-latest` alias. An alias upgrade is a measured policy migration.
9. **Bound spend in our code.** Per-scope token budgets, queue depth, candidate
   caps, and circuit breakers are substrate policy even if the vendor account
   has no suitable hard cap.

## Data boundary

Jev sends selected fact text from the Parc/AWS boundary to TypeSafe. TypeSafe
states that customer requests are not used for model training; zero-data-
retention is an enterprise feature. That assurance does not replace substrate
policy.

Every protocol therefore declares:

- allowed fact types and fields;
- redaction rules;
- whether personal or secret-bearing facts may leave the AWS boundary;
- the maximum contextual neighbourhood;
- the tenant/grant whose authority permits the call;
- retention requirements and the required TypeSafe account posture.

Authorization is checked before candidate text is assembled. The semantic
result cannot grant access to data the caller could not already read.

## Consequences

- The substrate gains a cheaper, narrower semantic instrument between vector
  similarity and generative reasoning.
- Semantic tags and relations become reusable across search, salience,
  contested, consolidation, tending, and Machines.
- Embeddings remain the scalable recall mechanism; Jev improves precision and
  typed interpretation without becoming a second index.
- The system takes on an external data processor, token-metered cost, rate
  limits, model-version migrations, and calibration work.
- Model probabilities become durable evidence, increasing fact volume. A
  compaction/retention policy for superseded observations will eventually be
  needed.
- A wrong judgment can influence tending but cannot bypass grants, become an
  authored assertion without policy, or perform an undeclared action.

## First increment and acceptance gate

Pilot `semantic.annotate/v1` and `semantic.relate/v1` on one bounded, high-value
fact type. Run in observation-only mode:

1. write derived judgments but take no automatic action;
2. compare against a small human-labelled corpus;
3. measure tokens per assessed fact, cache hit rate, latency, precision/recall,
   and the number of useful versus noisy tending candidates;
4. tune thresholds and context assembly;
5. allow only reversible tag/suggestion writes after the calibration gate.

The pilot succeeds when it demonstrates useful semantic precision over vector
similarity alone, a bounded cost per changed fact, and stable replay under a
pinned model. It does not succeed merely because the API returns structured
values.

## Open questions

1. Is the first fact type best chosen from docs, goals/tasks, claims, or
   `similarTo` suggestions?
2. Should observations use a general claim vocabulary or dedicated
   `semantic-observation` facts?
3. Which judgments influence salience directly, and which remain tending-only?
4. Does Jev relation classification replace optional `models` assistance in
   ADR-0032, or form a cheap first stage before it?
5. What labelled corpus and calibration metric govern permission to auto-act?
6. What per-scope daily token budget is appropriate, and where is it enforced?
7. Is TypeSafe's standard retention posture sufficient for all eligible fact
   classes, or does production require enterprise zero-data-retention?
8. Should the Jev cell remain the vendor adapter, or should the platform expose
   a vendor-neutral `semantic.*` service backed by that cell?

## External grounding (pricing snapshot, 2026-09-23)

- TypeSafe introduction: <https://docs.typesafe.ai/introduction>
- TypeSafe models, pricing, limits, and data handling:
  <https://docs.typesafe.ai/models>
- TypeSafe primitives:
  <https://docs.typesafe.ai/primitives/noul>,
  <https://docs.typesafe.ai/primitives/choice>,
  <https://docs.typesafe.ai/primitives/score>
- TypeSafe legal and retention posture: <https://docs.typesafe.ai/legal>
- AWS Lambda pricing: <https://aws.amazon.com/lambda/pricing/>
- AWS S3 and S3 Vectors pricing: <https://aws.amazon.com/s3/pricing/>
- AWS SQS pricing: <https://aws.amazon.com/sqs/pricing/>

