# Declarative actions vs code cells — are they substrate-equivalent?

> A deep dive into the sync predecessor (`christopherdebeer/sync.parc.land`,
> v9) — its implementation (`actions.ts`, `invoke.ts`, `views.ts`, `cel.ts`,
> `timers.ts`) and design corpus (`sigma-calculus.md`, `the-substrate-thesis.md`,
> `what-becomes-true.md`, `the-self-assembling-harness.md`) — to answer one
> question precisely: **from a substrate perspective, are sync's declarative
> actions (+ CEL) and our real TypeScript code cells equivalent?** And the
> follow-on: is the thesis meant to be operationalised *within the substrate
> itself* — self-hosted?

## What a declarative action actually is (from the code)

Mechanically, in sync:

- An action is a **fact**: a `{ description, if, enabled, result, writes[],
  params, scope, registered_by, timer, on_invoke }` JSON value stored as a row
  in the reserved `_actions` scope of the *same* `state` table as everything
  else (`actions.ts` `registerAction`). Views likewise in `_views`. **The
  vocabulary is state.**
- Invocation (`invoke.ts` `invokeAction`, ~350 lines — the whole engine) is an
  *interpreter*: check the timer is live (lazy, at read — cooldown/lease
  semantics with no scheduler); evaluate `enabled` then `if` (CEL, against a
  context built from the room's state) — a failed `if` is a 409
  `precondition_failed`, i.e. **server-side CAS**; substitute
  `${params.*}/${self}/${now}` single-pass (injection-safe); enforce scope by
  *registrar-identity bridging* (a write is allowed iff the action's scope or
  the invoker's identity matches the target scope — capability delegation,
  literally the Σ-calculus scoping rule); apply the writes (`value` | CEL
  `expr` | `merge` | `increment` | `append`, optional per-write `if_version`
  content-hash CAS = proof-of-read, optional per-write timer/enabled); tick
  logical timers; auto-log to `_messages`; append to `_audit`; evaluate the
  `result` CEL against *post-write* state; return the written entries wrapped
  with `_meta`.
- Registration itself is **introspected**: competing write targets are
  detected by *parsing other actions' declared `writes[]`*
  (`computeContestedTargets`) and surfaced as a warning + the `_contested`
  view; re-registration diffs the semantics (`writesChanged`, invocation
  count) and grades the risk. CEL is validated with staged errors and lint.

So a declarative action = **data interpreted by a small fixed engine**, where
the *write footprint, guard, availability, and lifecycle are all legible
without executing anything*.

## The Σ-calculus answer

The calculus (`sigma-calculus.md`) models an action as `write(φ, s, W)` — a
guarded, scoped write where `W : Σ → writes`. Crucially **it abstracts over
how `W` is expressed**. A TypeScript handler can be a `W`; so can a write
template. So at the extensional level — "a guarded transition with scoped
authority over shared state" — **yes, they are equivalent**: every declarative
action could be compiled to a code cell, and the calculus would not notice.

But the calculus' *design goals and laws* are where the equivalence breaks,
because they constrain not what an action does but **what can be known about
it without running it**:

| Substrate property | How declaration provides it | Can a code cell? |
| --- | --- | --- |
| **Decidable activation** (design goal 3: statically determine what *can* fire) | `if`/`enabled` are CEL — total, terminating, evaluable by the substrate | ✗ — undecidable for arbitrary TS; the substrate can't know when a cell is relevant without invoking it |
| **Declared write footprint** → contested-target detection, conflict-as-data | `writes[]` is parseable data | ✗ as code; ✓ if the cell *declares* a write manifest the runtime enforces |
| **Observer purity** (Law 4 / Theorem 1: adding a view can't change reachable states) | views are CEL — side-effect-free *by construction* | ✗ as a promise (our `kind: 'read'` is declared, not enforced); ✓ if read-kind invocations get a read-only state client / IAM role |
| **Scope authority** (Theorem 3) | interpreter checks declared targets at fact granularity | ◑ — our IAM boundary caps the cell to *AWS resources* (its table, its logs), not to substrate `(scope, key)` locations |
| **Vocabulary as protocol** (registration = the only unilateral act; semantic diff on re-registration; audit of the *definition*) | the definition *is* state, versioned and audited | ✗ — code deploys are opaque events; though our S3 source + `cells.readFile` narrows this |
| **Zero-latency, zero-deploy capability** | `_register_action` → instantly invocable | ✗ — `CreateStack` is seconds-to-tens; `cells.deploy` is faster but still a build |

And the inverse table — what code cells have that declarations cannot:

- **Turing-completeness** — loops, real computation, external I/O (`fetch`),
  rich queries. CEL deliberately has none of this.
- **Serialized non-monotonicity** — Law 7: non-monotonic work needs
  serialization. A Lambda + its own table is a bounded, serialized executor —
  exactly the calculus' **organ**. Write templates over shared state are
  reef-level transitions; sync itself concedes ("batch writes are not atomic;
  truly sequential guarantees require bounded engines — organs").
- **Enforcement stronger than interpretation** — this is our AWS-native edge:
  sync's guarantees are interpreter-level promises in one Deno process. We can
  make some of them *infrastructural* (IAM-enforced read-only paths, condition
  expressions, permission boundaries). sync can only check; we can make
  violation impossible.

## So: not equivalent — complementary, by the calculus' own boundary

The monotonicity boundary (Laws 6/7) is the answer to "are these the same
thing": **declarative actions are the reef; code cells are the organs.** A
declarative action that accumulates/merges facts is the coordination-free,
commuting, analyzable element the substrate is made of. A code cell is the
bounded region where ordering, transactions, and arbitrary computation live,
emitting monotonic facts back out. sync built the reef and lacks real organs
(its "organs" are a design note); our platform built excellent organs
(`cells.*` + IAM boundary) and lacks the reef's declarative layer. Neither is
a substitute for the other — **the platform needs both tiers, and the gateway's
read/act surface is already the uniform front door for both.**

The practical statement of equivalence is precise:

> A declarative action ≡ `interpret(definition)` where `interpret` is a small,
> fixed, *reviewed* code cell. The declarative tier doesn't compete with code
> cells — it **runs on one**. Its restrictions (CEL, declared writes) are not
> a weaker form of code; they are the *price of admission for substrate-level
> reasoning* — affordance catalogs, contested detection, progressive
> disclosure, conflict-as-data, audit-before-execution. The moment a
> capability outgrows the template language, that is the signal it is an organ
> and should become a code cell.

This yields an **execution gradient**, which is also the promotion path:

```
declarative action (instant, bounded, analyzable — facts in your slice)
  → code cell        (cells.create — Turing-complete organ, IAM-bounded)
    → tier-1 kernel  (reviewed CDK — universal)
```

## "Operationalise within itself" — yes: the thesis is self-hosting

The deep dive settles this. sync is **already self-hosted in the precise
sense that matters**: actions, views, agents, messages, help, audit — every
piece of the "harness" — are `{value,_meta}` entries in reserved scopes of
one state table. The only privileged code is the fixed interpreter (~9 KLoC).
`the-self-assembling-harness.md` names the consequence: nobody pre-designs
the harness; agents construct the tool set, memory structure, and
verification *as state*, and the substrate makes it legible. Even the
standard library ships as overridable `_help` *content*, not code. The system
is "opinionated only about infrastructure."

For our platform, the same move is available and cheap, because
`platform/runtime/state.ts` already has the right floor (wrapped entries,
revisions, provenance, supersede):

1. **Actions/views become facts** in reserved keys of the workspace slice
   (`_actions/*`, `_views/*`) — registered via
   `act("workspace.registerAction", …)`, no new storage, no deploy.
2. **The workspace cell grows the interpreter** — a port of `invoke.ts`'s
   semantics (guards, substitution, merge/increment/append, `ifRevision`/
   `ifVersion` via DynamoDB `ConditionExpression`, per-entry timers evaluated
   at read) — a few hundred lines on an existing organ.
3. **A sandboxed CEL evaluator** (cel-js or bounded subset) for `if`/
   `enabled`/`result`/views/wait — *one* expression language for guard, query,
   visibility, and condition, which is why CEL is "by necessity": predicates
   must be total, terminating, side-effect-free `Σ → Bool` for activation to
   be decidable and views to be safe at read time. The AWS tension is known
   (`sync-learnings.md` §B): bound CEL to a slice/room, materialize hot views.
4. **The gateway folds them in**: `read("$catalog")` already merges tier-1
   tools and tier-2 cell tools; declarative actions from the caller's slice
   become a third capability source — addressable via the same `read`/`act`,
   no reconnect, instantly after registration. `enabled` adds the missing
   axis (*availability*, beyond salience's *prominence*).
5. **Borrow enforcement back**: give read-kind invocations a read-only state
   client; require dynamic cells that want substrate access to *declare* a
   write manifest the workspace enforces — recovering contested-detection
   for organs too.

One genuine philosophical tension to decide deliberately: sync v6's defining
constraint is **there is no `_set_state`** — all writes flow through declared
vocabulary, which is what makes competition, negotiation, and history legible
("vocabulary construction is the only unilateral act"). Our
`workspace.remember` *is* a raw `_set_state`. Keeping it is right for a
personal substrate (it's the bootstrap, and `via` already tags intent), but
as slices become shared/multi-agent rooms, the sync lesson is that raw writes
should become the exception — the declared-action path is what makes a
multi-writer room self-describing rather than just mutable.

## Verdict

- **Equivalent in the calculus' extensional sense** — both are `write(φ, s, W)`;
  anything a template does, code can do.
- **Not equivalent in the substrate sense** — the properties the thesis is
  *for* (decidable activation, visible conflict, pure observation, audit-as-
  data, instant vocabulary) follow from the definition being **data**, and are
  unrecoverable from opaque code without re-adding declaration.
- **The synthesis is the two-tier gradient on one substrate**, with the
  declarative tier self-hosted as facts interpreted by the workspace organ —
  which is simultaneously the answer to "operationalise within itself": the
  substrate's vocabulary lives *in* the substrate; only the interpreter and
  the IAM walls live outside it.
