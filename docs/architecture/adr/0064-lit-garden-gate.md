# ADR-0064 — The garden gate: publishing a doc is a grant, visible where you write

- **Status:** Proposed 2026-07-05 (buffer — feedback welcome before build).
- **Depends on:** ADR-0061/0062 (the garden this gates), `docs/scope-grants.md`
  (grants are the authority model), the lit SSR `_public/<pattern>` path
  (already enforced server-side, verified in `cells/lit/index.ts`).

## Context (grounded — the gap and the lineage)

- lit's SSR already enforces publication: anonymous readers see only what
  `_public/<pattern>` facts cover (`publicPatterns`/`covers`,
  `index.ts:145-159`). But **no surface writes those facts** — the owner
  must author `_public/*` by hand elsewhere (lit review gap #9). The
  enforcement shipped; the VERB didn't.
- dotlit's whole point was gardening IN PUBLIC (digital_gardens.lit quotes
  it: "cultivate your own little bit of the internet", "learn in public,
  fanatically") — and its publish story was `dotlit generate` → GitHub
  Pages: whole-site, all-or-nothing (only `frontmatter.private` opted out,
  rendered as a stub). The substrate can do per-doc, per-fact, revocable.
- A doc is a VIEW over facts (membership decorations). Publishing "the doc"
  therefore has real semantics to decide: the doc fact, its decorations,
  and its MEMBERS are distinct facts — a member may also live in private
  docs; publishing one lens over a fact publishes the fact.

## Decision

**Publishing is a grant written where you write: one verb on the doc
header, honest about its blast radius.**

1. **"share" on the doc header** (owner only): OFF → `public` → (later)
   per-principal. Turning it on writes `_public/` facts covering exactly:
   `doc:<id>`, `_doc/<id>/*` (the arrangement), and each MEMBER key —
   enumerated at publish time, not a prefix wildcard (members from other
   namespaces must not drag their siblings into the light).
2. **Membership changes republish**: while a doc is public, placing a new
   member adds its `_public/` cover (the save path already writes the
   decoration; the cover rides the same outbox batch); un-pinning removes
   the cover UNLESS another public doc still holds the fact (the covers are
   ref-counted by a `via:'lit-publish'` tag scan — cheap, bounded by public
   docs).
3. **The blast radius is shown, not implied**: the share sheet lists what
   will become public — member count, any members whose keys sit outside
   lit's namespaces (`el:`, `machine/…`), each tap-inspectable. A fact
   already public via another doc says so. Unsharing shows the same list in
   reverse.
4. **Public state is visible while writing**: public docs carry a small 🌐
   chip on rows and headers (measured truth: derived from the `_public/`
   facts, not a cached flag); a PRIVATE fact freshly inserted into a public
   doc gets a one-line notice on the block ("now public via this doc").
5. **Anonymous readers get the garden, not the tools**: the public doc
   renders read-only (already true), red-link stubs render as plain text
   (a want-list is the owner's business), execution stays authed-only
   (already true, 0060).

## Increments

1. Share toggle writing/removing enumerated `_public/` covers + 🌐 chips.
2. Membership-change republishing + the blast-radius sheet.
3. Per-principal sharing (grants to named users/groups) — after the
   substrate's grants-to-principals design lands; the UI slot is the same
   sheet.

## Costs & open questions

- Enumerated covers mean a public doc with N members writes N+2 facts on
  publish — bounded, one-time, outbox-coalesced. The alternative (wildcard
  `_public/cell:*`) is a silent overshare; rejected.
- Ref-counting on unshare trusts the `via:'lit-publish'` tag — hand-authored
  `_public/` facts are never touched by lit's unshare (yours stay yours).
- Open: should publishing SUPERSEDE rather than delete covers on unshare
  (an audit trail of what was ever public)? Leaning yes — supersede is the
  substrate's verb for exactly this.
- Open (buffer question): does the 🌐 chip belong on every surface that
  renders the fact (canvas nodes too), not just lit? The `_public/` facts
  are readable by any cell; proposing lit-first, canvas follows via the
  same derived check.
