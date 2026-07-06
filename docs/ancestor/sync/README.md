# Sync — the substrate's ancestor (transplanted docs)

These 13 essays are transplanted **verbatim** from the substrate's direct
ancestor, **`christopherdebeer/sync.parc.land`** (`docs/`), so the substrate's
own docs and ADRs can link to the ideas they descend from without leaving the
repo.

- **Source:** `github.com/christopherdebeer/sync.parc.land` @ `363194206d35`
  (2026-03-19), also rendered at [sync.parc.land/docs](https://sync.parc.land/docs).
- **Preserved as-is.** Internal cross-links and any `../code` references reflect
  the *original* sync repo layout, not this one — read them as historical
  pointers into the ancestor, not live links here.
- **Why transplant, not just cite.** These are the intellectual genealogy of the
  current substrate (the reef/blackboard, salience, organs, the Σ-calculus, the
  substrate thesis). Keeping them in-corpus means they flow into the substrate as
  `file/docs/ancestor/sync/*` facts (ADR-0027 docs-sync), linkable from the
  ancestor project fact and from ADRs that revive an ancestral mechanic.

## The essays

| File | What it is |
|---|---|
| `the-substrate-thesis.md` | The core thesis — state as a shared substrate, components as predicates over it. |
| `SUBSTRATE.md` | Condensed thesis + the intellectual genealogy (blackboard AI, tuple spaces, FRP, stigmergy). |
| `sigma-calculus.md` | The formal model — `Σ(s,k)=v`, versioned keys, predicate algebra, observer independence. |
| `pressure-field.md` | Salience as a pressure field over the substrate. |
| `adaptive-salience.md` | How salience adapts — the ancestor of the current score/tending stage. |
| `the-self-assembling-harness.md` | Agents assembling their own coordination harness. |
| `agency-and-identity.md` | Actors, identity, authority. |
| `what-becomes-true.md` | Affordance-thinking; also the candid ledger of costs — incl. the `revision`/content-hash `version` proof-of-read note. |
| `agent-sync-technical-design.md` | The technical design of agent↔substrate sync. |
| `surfaces-design.md` | Surfaces — the ancestor of the canvas/lit render surfaces. |
| `frontend-unify.md` | Unifying the frontend over the substrate. |
| `isnt-this-just-react.md` | Why the substrate is (and isn't) "just React". |
| `introducing-sync.md` | The introduction / narrative entry point. |

## Load-bearing for the current repo

- **ADR-0066** (`docs/architecture/adr/0066-proof-of-read-content-hash-version.md`)
  revives sync's **content-hash `version` proof-of-read** — see
  [`what-becomes-true.md`](./what-becomes-true.md) and
  [`sigma-calculus.md`](./sigma-calculus.md).
