# ADR-0040 — The substrate as a self-maintaining wiki: turn on the compile loop

- **Status:** Accepted — **Inc 0 + Inc 1 shipped/live (2026-06-30).** Names the isomorphism between Karpathy's
  *LLM Wiki* and the parc.land substrate, identifies the **one missing piece** (a reactive compile-on-ingest
  organ + accretion-back), and folds the in-flight "fix the capture key / fix the daily-log / own the `log`
  type / make input↔lit compose" items into **consequences of one loop** rather than four independent patches.
- **Status (Inc 0 — spine + named sources, shipped 2026-06-30):** `@c15r/lit` now **owns the `log` type**
  (manager + `open` handler; the legacy unowned `_types/log` override retired) — fixing both daily-log bugs
  (home's "no handling cell" + the dead link). Capture keys are now **expressive** (`inbox/<date>/<slug>`,
  slug from title → URL segment/host → body) in both the `@c15r/input.capture` tool and the PWA — captures are
  link targets, and the day is a prefix-query. The **Karpathy gist is ingested in full** as
  `reading/llm-wiki-karpathy` (raw layer, auto-embedded), and automatic `similarTo` (ADR-0030) **compounded it
  on ingest** — wiring it to the substrate's own thesis (`blk:welcome-keeps`), its tending ancestor
  (`el:k-ancestor-workspace`), a 2021 digital-garden capture, and the weave (lint) machine's transcript. The
  document about compounding cross-referenced itself with zero compile code.
- **Status (Inc 1 — the compile organ, live 2026-06-30):** the `_subscriptions/wiki.compile` reaction is
  registered (`match:{type:'reading'}` → `deliver:@c15r/models.agent`) — a new source reactively spawns the
  model agent, which reads it and emits a synthesis `claim` (assertion + `support` edges) cross-referenced to
  the existing graph. Demonstrated on source #1. **Almost no new platform code** — the organ is *declared*
  (a subscription + the existing `models.agent` + `claim`/`support` ref-edges), the substrate way.
- **Date:** 2026-06-29 (Inc 0/1 shipped 2026-06-30)
- **Depends on / absorbs:** ADR-0018 (reactive substrate — stateless machine stepper, subscriptions→actions),
  ADR-0030 (automatic embedding via the DynamoDB stream), ADR-0032 (`similarTo` as a *ratifiable* typed
  suggestion — human-in-the-loop accretion), ADR-0003 (reference/embedded edges), ADR-0027 (files-as-facts —
  the raw layer), ADR-0033 (overview-first `recall` = the index), ADR-0005/0014 (collections / doc assembly),
  ADR-0008 (cell axis / federation), ADR-0039 (federated render surface). Sources: Karpathy, *LLM Wiki*
  (`gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`, 2026-04-04); `christopherdebeer/garden`
  (digital-garden prior art: slug-keys, stubs-as-pages, backlinks, log-as-view, accretion discipline).

---

## The insight

Karpathy's *LLM Wiki* and the substrate's founding thesis are the **same architecture described twice**.
*"Compile, don't retrieve — synthesis paid once at ingest, kept current, not re-derived per query"* is
verbatim the substrate's *"state is primary reality; the UI is a projection of it."* So the task is **not**
"build a wiki on parc." It is: **parc is already a wiki whose compile loop is switched off.**

Read the two side by side and almost the whole machine is already standing:

| LLM Wiki | substrate — already present |
|---|---|
| raw sources (immutable) | facts with provenance, *superseded-not-deleted*; files-as-facts (ADR-0027) |
| the wiki (interlinked, maintained) | the fact graph — `knowledge`/`concept`/`claim`/`doc` + **first-class edges** + auto-`similarTo` (ADR-0032) |
| the schema (CLAUDE.md) | `$types`, federated from cells (ADR-0008/0039) |
| **ingest** | `workspace.remember` / `ingest` (+ automatic embed on write, ADR-0030) |
| **query** | `recall` (index-first, ADR-0033) + semantic `search` |
| **lint** | `attention` (stale / unlinked / dangling) + the **`tending` / `weave` machines** — already scheduled |
| index.md / log.md | the `recall` overview / `workspace.changes` + the daily `log:<date>` spine |

The wiki is here. What is **not** wired is the part Karpathy's whole essay is about.

## The one thing missing: compile-on-ingest

Today, when a source enters, the only thing that fires is shallow cosine `similarTo`. Karpathy's claim is
that ingest **reads the source and integrates it** — writes/updates a synthesis page, cross-references it,
flags contradictions, files good answers back. *"The LLM does the bookkeeping that makes a knowledge base
useful over time."* The substrate has every primitive to do exactly that, reactively, and has simply never
connected them into a loop:

- a source is written → a **subscription** matches it (ADR-0018) → it starts a **compile machine** whose
  **`work` rail spawns `@c15r/models.agent`** (the machine-uses-agent primitive already in the `machine`
  cell). The agent reads the source and emits **facts**: a synthesis `knowledge` page, `claim`s with
  `support` edges, and proposed `refines`/`grounds`/`related`/`contradicts` edges to existing facts —
  **all ratifiable** (ADR-0032), so the human confirms rather than the model asserting unchecked.
- **lint is the `tending`/`weave` machines**, already running — extend their remit to wiki health
  (orphans via `attention.unlinked`, contradictions across `claim`s, stale syntheses whose source was
  superseded, missing pages). Their output is a daily lint fact + ratifiable fixes.
- **query files answers back**: an agent answer can be promoted to a `knowledge`/`claim` fact by an `act`,
  so explorations accrete into the graph instead of evaporating into chat — Karpathy's *"good answers
  filed back as new pages."*

That is the loop: **ingest → compile → lint → query, with answers re-entering as ingest.** Built from
primitives that already exist, **declared as facts** (subscriptions, machines, actions, claims, edges) —
runtime-deployable and federated, not platform code. The substrate compiling itself, the substrate way.

## Decision

Turn on the loop, and let the four pending items fall out of doing it right — do **not** ship them as
independent patches.

1. **A raw layer with named sources.** Capture intakes a **`source`** (immutable, full content inline →
   auto-embedded, ADR-0027/0030) with an **expressive, linkable key** (`source/<host>/<slug>` or
   `reading/<slug>`). A `capture` becomes the thin, day-stamped **intake event** (a clip + a `cites` edge to
   its source), not a dead-end inbox blob. Expressive keys are not cosmetic: **in a wiki every node is a
   named page you link by** — opaque `inbox/mqz…` is precisely why captures can't join the `[[ ]]` graph
   today. (Absorbs the "expressive capture keys" item.)

2. **The compile organ (the new, declared piece).** A `_subscriptions/wiki.compile` matches new `source`
   facts and starts a `wiki-compile` machine (a `work` rail running `@c15r/models.agent`) that synthesizes +
   cross-links into the wiki, emitting ratifiable edges. The prompt and rails are **machine vocabulary
   (facts)** — tunable without a deploy, visible in `$graph`.

3. **The wiki layer + the chronological spine.** `lit` owns and renders the wiki (`knowledge`/`doc`/`claim`)
   **and** the **`log` type** — the daily `log:<date>` is Karpathy's `log.md`, the timeline of what entered.
   Owning `log` (manager + `open` handler, superseding the legacy `_types/log` override) fixes both reported
   bugs — home's "no handling cell" and the dead daily-log link — as a *consequence*, plus a lit SSR `log:`
   branch to render the day server-side. (Absorbs the "own `log`" + "fix lit link" items.)

4. **input ↔ lit are the raw→wiki boundary.** `input` intakes raw sources + writes the day spine; `lit`
   renders the maintained wiki. They are complementary *because* they are the two layers — the contract is
   **only** substrate conventions (the `source`/`log` facts, the `cites`/`on` edges, the `$types` decls), no
   cell importing another. (Absorbs the "input↔lit without coupling" item.)

5. **Authoring discipline, ported from garden.** The wiki's pages follow garden's conventions: **assertion-
   titled** `knowledge` (the title is a claim, not a topic), **link liberally**, a broken `[[link]]` mints a
   first-class **`stub` fact** that surfaces inbound pressure (the "missing" view = un-written ideas ranked by
   backlinks), and an **accretion `status`** (`seedling → budding → evergreen`) with *update > append > new*.
   Backlinks and the link graph already exist (edges + `neighbors` + lit's `[[ ]]` resolver) — parc is ahead
   of garden here; only stubs-as-facts and `status` are new.

**Dogfood:** the Karpathy gist is **source #1** — captured as a `source`, compiled by the organ into a
synthesis `knowledge` page cross-linked to the substrate's own thesis facts, and picked up by the next
`tending` lint pass. We use the loop to ingest the document that describes the loop.

## Consequences & trade-offs

- **The capture stops being a dead end.** It becomes the front door of a compile pipeline; sources and
  answers *compound* (the founding promise of both theses) instead of piling up in an inbox.
- **Almost nothing is new platform code.** The loop is declared (subscription + machine + types + actions) —
  the substrate-native axis. The only genuinely new vocabulary is the `wiki-compile` machine, the `source`
  refinement, `stub`, and `status`. This is the ADR-0039 lesson applied again: prefer federated, declared,
  runtime-deployable facts over imperative cell code.
- **Human-in-the-loop by construction.** Every compiled edge/claim is a *ratifiable suggestion* (ADR-0032),
  not an unchecked assertion — the model does the bookkeeping, the human keeps judgment, exactly Karpathy's
  division of labor.
- **Cost / latency.** Compile spawns a model agent per source — real token cost. Mitigations: it is async
  (reactive, off the write path), opt-outable per source, and batchable; lint runs on the existing schedule.
- **Risk: synthesis drift.** An over-eager compiler could bloat the wiki with low-value pages. The
  accretion discipline (update > new, assertion titles, ratify-before-authored) is the guard; lint prunes
  orphans/duplicates.

## Increments (sequenced from the one loop, not the four-item list)

- **Inc 0 — the spine + named sources (foundation).** Own `log` in `lit` (fixes both bugs); make capture
  write an expressive, linkable `source` + a `cites` edge; lit SSR renders `log:<date>`. Dogfood: re-ingest
  the gist as a proper `source`.
- **Inc 1 — the compile organ.** The `wiki.compile` subscription + `wiki-compile` machine (work-rail →
  `@c15r/models.agent`) emitting a synthesis `knowledge` page + ratifiable edges. Validate on source #1.
- **Inc 2 — lint = tending/weave for wiki health.** Extend the scheduled machines to orphans / contradictions
  / stale-synthesis / missing-pages, emitting ratifiable fixes; surface in the conversation card's
  ratify/attention surfaces (ADR-0036/0038).
- **Inc 3 — accretion-back + garden discipline.** An `act` that promotes an agent answer to a
  `knowledge`/`claim`; `stub`-as-fact on broken links; `status` on knowledge; assertion-title authoring.

## Open questions

- **Compile trigger granularity** — every `source`, or only on an explicit "ingest this" act? Start
  opt-in (a `tags:['compile']` or an `act`), graduate to auto once the synthesis quality is trusted.
- **`source` vs `capture` vs `reading`/`file`** — collapse or keep distinct? Proposed: `capture` = the
  intake *event* (day-stamped pointer/clip); `source`/`reading`/`file` = the immutable *content*; a capture
  `cites` a source. Confirm we don't need a new `source` type if `reading`/`file` already fit.
- **Where the compiler writes** — its own `knowledge` pages in the owner slice (organ path, ADR-0039 Inc 2
  mechanics) vs proposing to the human first. Ratifiable-by-default leans toward "write as suggestion."
- **Stub keys** — `stub:<slug>` vs minting the real key empty; how a stub is "filled" (superseded by the
  real page) without losing its backlinks.
