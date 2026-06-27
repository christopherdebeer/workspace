# ADR-0033 — Progressive disclosure by default (overview-first reads)

- **Status:** Accepted — shipped. The two reads a context-less agent hits first now default to a
  **broad, succinct orientation**, not a full dump: `read("$catalog")` returns the grouped one-line
  menu (full schemas behind `{detail:"full"}`); a bare `workspace.recall()` returns an **overview**
  (counts by type & key-prefix, salience bands, the top ~12 focus facts, and drill `hints`) — the whole
  shaped view is one arg away (`{view:"full"}`, or any shaping arg). Back-compatible: only the *bare*
  call changes; every configured caller (passing `elision`/`lens`/`detail:"full"`/…) is unaffected.
- **Date:** 2026-06-26
- **Depends on:** ADR-0029 (agent ergonomics — progressive disclosure, inline affordances), ADR-0006
  (salience — the bands the overview reports), ADR-0030/0031/0032 (search/`suggestions` — the drill paths
  the hints point to).

---

## The problem

An agent with **no prior context**, handed the substrate, does what the tool descriptions say: it reads
the catalog, then recalls the workspace. Both defaulted to *heavy*:

- `read("$catalog")` (no `detail`) returned every capability's full input/result **schemas**.
- `workspace.recall()` (bare) returned the **whole shaped view** — every focus/peripheral fact in full.

The shaped view is *supposed* to stay succinct via salience elision, but on a large slice whose salience
is **flat** (the cold-import corpus: velocity 0 → near-zero scores, so nothing separates into a focus
band) elision collapses almost nothing — recall becomes a multi-thousand-fact blob. The "happy path" for
a fresh agent was therefore *dump-and-parse*: spend the whole context window ingesting everything before
doing anything. That is the opposite of orientation.

The principle (ADR-0029, extended): **the default response should be broad and succinct, and should point
to how to dig deeper.** Full detail must be reachable, not mandatory.

## Decision

Make progressive disclosure the **default**, not an opt-in:

1. **`$catalog` → grouped menu by default.** `read("$catalog")` (and a bare `read()`) returns the
   one-line-per-capability menu grouped by cell (what `{detail:"summary"}` used to return). Full
   input/result schemas require `{detail:"full"}` (alias `"schemas"`). `{detail:"summary"}` still works.

2. **`recall` → overview by default.** A *bare* `recall()` returns:
   - `overview`: `{ total, granted, bands:{focus,peripheral,elided}, byType[], byPrefix[] }` — the shape
     of the slice at a glance (and, incidentally, makes flat salience *visible*: a tiny focus band over a
     huge peripheral one is the cold-corpus signal, not hidden in a blob);
   - `focus`: the top ~12 facts by salience, in full — the entry points worth reading now;
   - `hints`: how to narrow — `query({type|prefix|tag|contains})`, `search({text})`, `peek({key})`,
     `neighbors`, `suggestions`, and `recall({view:"full"})` for the whole view.

   The full shaped view (`entries`/`elided`/`_shaping`) is returned whenever the caller passes `view:"full"`
   **or any shaping argument** (`elision`/`expand`/`lens`/`salience`/`explain`/`includeSuperseded`). This
   is the back-compat hinge: configured consumers always pass args, so they are unchanged; only the
   context-less bare call — exactly the case we want to fix — gets the overview.

The gateway `instructions`, the `read`/`$catalog` tool descriptions, and the `recall` descriptor are
reworded to teach the overview-first flow (skim → narrow), replacing the old "recall = the whole view".

## Why this shape (not the alternatives)

- **Why not just fix salience?** Flat salience (cold-import velocity 0) is a real, separate tuning problem
  (standing/centrality should carry more of the score for dormant corpora). But even with perfect salience,
  a bare recall returning hundreds of "focus" facts on a rich slice is still a dump. Overview-first is the
  right ergonomic *regardless* of salience health — and it surfaces the flatness instead of drowning in it.
- **Why not a separate `overview` command?** A new command is another thing to discover. The fresh agent
  already calls `recall`; making *that* succinct meets it where it is. The full view stays one obvious arg
  away.
- **Why "any shaping arg implies full"?** It is the cleanest back-compat rule: it needs no migration of the
  ~dozen SSR/cell/programmatic callers (none call `recall` bare today — verified: no `ssr.json` uses it),
  and it reads naturally ("ask for shaping → you want the shaped view").

## Consequences

- The first two reads an agent makes cost a fraction of the tokens and *teach the drill path* instead of
  burying it. Dump-and-parse is no longer the happy path.
- `recall`'s result is now a union (overview | shaped view); the `resultSchema` documents both, and the
  description leads with the overview.
- Flat-salience visibility is a free by-product (the `bands` breakdown) — a prompt to revisit salience
  tuning for cold corpora (tracked separately; not in scope here).
- Future: the same overview-first treatment likely belongs on other broad reads (`$graph`, `changes`); and
  `byType`/`byPrefix` could themselves carry drill targets (`query({type})`) as structured affordances.

## Tests

`recall({view:"full"})` keeps the shaped contract; a bare `recall()` returns the overview (counts + focus +
hints, full view one arg away); `$catalog` defaults to the grouped summary (bare and target-omitted),
`{detail:"full"}` returns the heavy capabilities form. 482 pass.
