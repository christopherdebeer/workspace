# @c15r/models — the generative executor, by design

> The models cell is the **generative kind** of transformer (taxonomy:
> `docs/trajectory/2026-06-12-transformers-and-the-executor-tiers.md` §3):
> things that need *a model and an API key*. This document is the cell's
> design record — custody, tools, the job pattern, and the agent loop —
> written after each piece was validated (or honestly failed) through live
> use. Git truth: `cells/models/`; deployed at `/@c15r/models`.

## 1. Custody: secrets collocate with the code that spends them

Provider keys live as `SECRET#<provider>` items in **this cell's own
DynamoDB table** (IAM-scoped to this cell's role alone), written by the
owner via the `/secrets` page or the `setProvider` tool. There is **no
readback path** — not even for the owner. The alternative (a generic
secrets service that hands keys to callers) is exfiltration-as-a-service:
any cell that can call it can steal. What is shared is the *capability*
("generate", "run an agent"), never the credential.

Consequence: every model call executes server-side in this Lambda. The
cell is the custody boundary, the billing boundary, and the place where
provider client code (raw HTTP — the runtime ships no provider SDKs) lives.

## 2. The tool surface

| tool | kind | what it does |
| --- | --- | --- |
| `setProvider` | act | owner-only, write-only key storage (+ model overrides) |
| `listProviders` | read | enablement + configured models; never keys |
| `run` | act | one-shot generation: text (anthropic/openai/google, VLM via `imageB64`) or image (openai/google); `async:true` for the job pattern |
| `agent` | act | model-in-the-loop over the substrate (§4); **always** async |
| `fetch` | read | poll a job: `{status, text?, imageB64?, mime?, error?}` + agent fields `{factKey, provider, turns, toolCalls}` |

Providers: **anthropic** (text/VLM), **openai** (text + image), **google**
(text + image). Image runs are dimension-aware: the caller passes the
target box and the cell maps to the nearest provider-native size (openai
1024/1536 variants) or aspect (google 1:1…16:9).

## 3. The async job pattern (the edge forces it)

The CloudFront → Function-URL edge caps synchronous round trips at ~30s.
Anything longer uses: `submit` writes a `JOB#` item → the Lambda
**self-invokes** (Event-type; the IAM grant is `lambda:InvokeFunction` on
its *own* ARN only) → the caller polls `fetch`. Results above DynamoDB's
400KB item cap chunk across items and reassemble on fetch. Two hard-won
reliability rules are encoded here:

- **`removeUndefinedValues` on the DocumentClient** — a job result
  legitimately carries undefined fields, and without it the marshaller's
  failure *masks* the result (the live symptom: a Fibonacci repl run
  "erroring" with DynamoDB configuration advice).
- **Save failures must not impersonate the work** — persistence errors are
  recorded as `failed to persist result: …`, never as the job's own error.

## 4. `agent` — model-in-the-loop over the substrate

The most consequential tool: a tool-use loop whose toolbox **is the
substrate** —

- `substrate_query` / `substrate_read`: the cell's IAM-scoped reads of the
  owner's slice (DynamoDB `LeadingKeys` condition — the database enforces
  the ceiling, no application code is trusted);
- `substrate_emit`: the organ path (`substrate.write.requested`,
  `Source` IAM-pinned to this cell), so every agent write lands with
  machine-attested provenance `@c15r/models`, `via: agent` — unforgeable
  even by the model's own output.

**Authority: grants narrow, never widen.** Per-run
`grants: { read?: true|false|prefixes[], write?: true|false|prefixes[] }`
(read defaults on, write defaults **off**) is enforced twice: the emit
tool is not even *offered* to the model unless write is granted, and query
results are re-filtered per key so a broad prefix cannot widen a narrow
grant. The v0 ceiling is the **cell's** standing — the owner's slice —
same honesty as `@c15r/run`; per-caller subsets ride the
grants-to-principals design (deferred, with Bedrock as its first
beneficiary).

**Always async, facts by construction.** A loop cannot fit the edge cap,
so `agent` returns `{jobId, factKey}` immediately. On completion the
result lands at `factKey` (type `agent-run`, recording prompt, result,
provider, model, fallbacks, turns, toolCalls) and the turn-by-turn record
at `factKey/transcript` (type `transcript`) — queryable, linkable,
placeable like any fact. Transcript entries are clipped (4KB text / 2KB
tool results; 16KB fed back to the model) to respect both item caps and
attention.

**Provider fallback, with a side-effect rule.** The loop is
provider-agnostic (an adapter owns each provider's native tool-calling
format; anthropic and openai today, google's third format deferred).
Candidates are the enabled chain `anthropic → openai` unless `provider`
pins one. The policy sharpens canvas's `runWithFallback` for stateful
runs: an enabled key can still be a dead org (observed live — a valid
anthropic key, out of credits), so a failure on the **first model call,
before any tool has executed, falls through** to the next provider; a
failure *after* effects fails honestly rather than replaying tool calls
under another model. Fallbacks are recorded in the result fact and noted
in the transcript.

## 5. Trust-ladder position, and what is deliberately absent

`agent` sits on the **manual/declared** rungs: something must invoke it
(a human, an MCP caller, a declared action's invoker). It does not fire
on writes — event-driven transformers need declared write footprints,
budgets, and loop guards first (two agents watching each other's outputs
is an unbounded bill). Also deliberately absent: per-caller grants
(above), google agent support (third tool format, not worth a third
adapter until asked for), and streaming (the job pattern is the
substitute the edge allows).

## 6. Webhook ingress (related investigation, undecided)

Tools are **not** MCP-only: dispatch routes plain HTTP to
`/@c15r/models/_tools/<tool>`, so a webhook could `POST …/_tools/agent`
without speaking JSON-RPC — but it must carry a platform bearer
(anonymous callers get GET/HEAD on public cells only). For
provider-webhooks that cannot OAuth, the candidate designs are: (a) a
long-lived narrow-scope bearer per hook; (b) an **ingress cell** that
verifies a per-hook HMAC in-cell and then acts within its own standing;
(c) declared `_triggers/<id>` vocabulary + a platform `/hooks/` route.
(b) costs the core nothing and matches the organ model; undecided, not
built.
