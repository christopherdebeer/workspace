# Transformers, the executor tiers, and the vocabulary made load-bearing (2026-06-10 → 2026-06-12)

> Session record and technical design narrative for the work on
> `claude/models-transformers` (PR #130, 32 commits at time of writing) plus
> the live-substrate artifacts that have no git shadow (renderer facts, type
> facts, demo elements, imported boards). Durable design stays in
> [`substrate.md`](../substrate.md), [`canvas-substrate-design.md`](../canvas-substrate-design.md),
> and [`narrative-surface.md`](../narrative-surface.md); this document is the
> argument for *why each piece was built the way it was*, measured against the
> substrate thesis. Everything described here is deployed and was validated
> through live use on parc.land before being written down.

## 0. The thesis, restated as a test

The substrate thesis (`substrate.md`) claims that a personal productivity
system can be built as **one observed-state table** — facts of
`{ value, _meta }` with server-stamped provenance, monotonic revisions, and
computed salience — over which *everything else is projection*. UI surfaces
(canvas, narrative, home) and MCP tools are two views of one declared
vocabulary; agents and humans are equivalent participants; capability is
granted, never assumed.

The corollary that this session set out to test: **if the thesis holds, the
system should absorb entire new capability classes without core changes** —
by adding *vocabulary* (facts that declare behavior) and *organs* (cells that
write through the attested event path), never by widening the kernel. The
capability class chosen was the most demanding one available:
**transformers** — things that take facts and produce other facts, spanning
deterministic rendering, model-backed generation, and arbitrary code
execution.

The session ends with three executor tiers live (`@c15r/viewers`,
`@c15r/models`, `@c15r/run`), a fourth vocabulary tier (`_types`) joining
`_actions`/`_views`/`_renderers`, a narrative surface (`@c15r/lit`) and a
capture organ (`@c15r/input`) built entirely from existing primitives, and —
the honest part — a short list of things that were *deliberately not built*
because the capability model isn't ready for them (§12). The core platform
(`platform/runtime/state.ts`, the gateway, the provisioner) needed exactly
the changes you'd expect of infrastructure, not semantics: timeouts, presigned
uploads, error passthrough. The thesis survived contact.

## 1. Vocabulary extensions: tend, links, ingest, and a real CEL

The session opened by paying down vocabulary debt inherited from the two
ancestors (legacy workspace and sync, per `sync-learnings.md`):

- **`tend` + cron** — autonomous tending is the legacy workspace's signature
  behavior: the system revisits its own facts on a schedule, decaying salience
  and surfacing the neglected. Porting it as a substrate verb (rather than a
  bespoke job) means tending is *observable* — each pass is provenance-stamped
  like any other write, and a human can read what the gardener did.
- **`links`** — first-class edges between fact keys. The thesis insists
  relations are facts too (they carry provenance and can be superseded), and
  every surface built later in the session leaned on this: canvas synthesizes
  layout from link topology (§10), day-logs chain through `then` edges (§5),
  repl outputs point at their source via `produced-by` (§8).
- **`ingest`** — bulk intake. Imports and capture backfills write many facts
  in one attested batch instead of N gateway round-trips. This is what made
  the parcland backpack rescue (§6) and the dotlit corpus import tractable.
- **CEL, upgraded** — declarative conditions moved to
  `@marcbachmann/cel-js` (zero-dependency, throws typed
  `ParseError`/`EvaluationError`, BigInt integers). Action conditions are
  `{cel, key?}` evaluated over `{params, self, now, key, exists, value}`;
  view definitions gained a `filter` expression over `{key, value, meta}`.
  Two safety properties are non-negotiable and were implemented as such:
  **parse errors refuse registration** (a vocabulary entry that cannot be
  evaluated must not exist) and **non-boolean results fail closed** (a
  condition that evaluates to anything but `true` denies). Vocabulary is
  data, but it is *checked* data.

The thesis framing: all four are vocabulary, not features. None of them gave
any cell new authority; they gave *declarations* new expressive range.

## 2. The consolidation: kernel, cells-under-git, and reference-not-copy

Three structural moves, committed together as "the consolidation"
(`771b709`), addressed the same disease: **drift between copies**.

**The client kernel (`@c15r/kernel`).** Every tier-2 cell client had grown
its own PKCE dance, its own `/mcp` wrapper, its own boot-failure handling —
four copies, four drift vectors. The kernel collapses them into one module
that cells import **by URL** (`https://parc.land/@c15r/kernel/app.js`), not
by bundling. This is the substrate's reference-not-copy tenet applied to
code: there is one session implementation, and upgrading it upgrades every
surface at once. Concretely the kernel owns:

- **One origin-wide session** (`parc.session.*` storage keys): sign in once
  on any surface; iframed embeds (a board inside a doc inside home) inherit
  it; `signOut()` and `requestScopes()` are shared affordances.
- The **read/act client** over `/mcp`, plus `bootStatus`/`bootFail` so a
  cell that cannot boot says so legibly instead of white-screening.
- **`loadTypes` / `titleOf` / `hrefOf`** — the type vocabulary client (§9),
  so every surface names and links facts identically.

**Cells under git (`cells/<name>/` + `scripts/cell-sync.mjs`).** Tier-2 cell
sources had lived only in the platform's S3 source store — editable through
tools, deployable, but unreviewable and unversioned. The session made **git
the truth**: each cell's `src/` mirrors to `cells/<name>/` in this repo, and
`cell-sync.mjs pull|push <name> [--deploy]` moves bytes through the same
`/mcp` tools any agent would use (device-flow token at `/tmp/parc-token.json`,
mode 600, refresh-and-retry on 401). The script is deliberately *not* a
backdoor — it authenticates and is scope-checked like every other caller.
This restored the review loop (PR #130 is readable) without surrendering the
live-edit loop (push `--deploy` is one command).

**Home demotion, staged.** `home` had accreted privileged routing knowledge.
The `DISPATCH_DEFAULT_CELL` seam stages its demotion to *just another cell*:
the platform dispatches to whatever cell is configured as the default
surface, and home's remaining hardcoded knowledge (§9) was moved into data
this session. Nothing about home is special anymore except a config value.

## 3. The transformer taxonomy: three executor kinds and a trust ladder

The organizing design of the session. A **transformer** is a declared
morphism over facts: input fact(s) → output fact(s) or rendering. The
taxonomy splits by *what the executor needs*, because what it needs
determines where it must run and what it must be trusted with:

| kind | needs | examples | executor |
|---|---|---|---|
| **pure** | nothing — deterministic, free, secretless | json tree, csv table, mermaid, style | `@c15r/viewers`, runs in the *viewer's* browser |
| **generative** | a model + an API key | text/image generation | `@c15r/models`, runs server-side where the keys live |
| **code** | arbitrary execution + substrate access | repl, migrations, ad-hoc compute | `@c15r/run`, runs server-side with organ-path writes |

Two principles fall out of the split and governed every implementation
decision below:

**Custody requires collocation.** Secrets live in the table of the cell that
spends them, written write-only, readable by nothing — not even their owner
through the API. The alternative (a generic secrets cell that hands keys to
callers) is exfiltration-as-a-service: any cell that can call it can steal.
`@c15r/models` therefore stores provider keys as `SECRET#<provider>` items in
*its own* DynamoDB table, set via an owner-only, write-only `setProvider`
tool and a kernel-authed `/secrets` page. The keys never transit the gateway
after write; the *capability* ("generate me an image") is what's shared.

**The trust ladder: manual → declared → event-driven.** Every transformer
enters at *manual* (a human clicks run), can graduate to *declared* (a
vocabulary fact wires it to a type or fence), and only later — not this
session, see §12 — to *event-driven* (it fires on writes). Each rung demands
more safety machinery than the last; the session built the first two rungs
completely and refused the third honestly.

## 4. `@c15r/viewers`: the pure tier, and the renderer ladder exercised

The cheapest transformers are pure functions from text to DOM, and the
substrate already had a place for them: `_renderers/<type>` facts, designed
in `canvas-substrate-design.md` but never exercised beyond built-ins. The
session built `cells/viewers/client/main.ts` — a single ESM module exporting
`json`, `csv`, `mermaid`, `style`, `repl` views plus `renderFence`/`fenceLangs`
for the narrative surface — and then registered each viewer as a
**one-line renderer fact**:

```js
export { json as view } from 'https://parc.land/@c15r/viewers/app.js';
```

That one line is the whole point. The renderer ladder loads `_renderers/*`
facts as data-URI ESM imports and overlays them on the built-in registry
(built-ins first, facts win). Because the fact *re-exports by URL* rather
than inlining code, the viewers module is upgraded in one deploy and every
registered renderer follows — reference-not-copy again, this time at the
vocabulary tier. The same module serves three masters with zero duplication:
canvas elements (via the `view(render)` factory producing
`{mount, update, unmount}` with a `dataset.vw` content guard against
redundant re-renders), lit fences (§7), and lit *inline fact rendering*
(§7, the session's final change).

Implementation notes that matter:

- **json**: collapsible `<details>` tree, typed color classes, auto-opens
  nodes of ≤8 entries — readable at mobile sizes without interaction.
- **csv**: quote-aware parser, 500-row render cap — a viewer must never be
  the thing that freezes a board.
- **mermaid**: lazy `import()` of the mermaid ESM from CDN, cached promise,
  `securityLevel: 'strict'` — the diagram language is untrusted fact content.
- **style**: writes a global `<style data-vw-style="<ownerId>">`, replaced
  on re-render — a *fact* can restyle a surface, and superseding the fact
  un-styles it. Vocabulary-as-data taken literally.

## 5. The capture organ and days-as-facts

`@c15r/input` is the capture organ: a minimal PWA (with `share_target`, so
the OS share sheet writes to the substrate) that does one thing — turn a
thought into a fact with machine-attested provenance, fast enough to use
standing up. Its design was deliberately informed by the dotlit corpus: the
session imported and analyzed dotlit's Input Buffer, whose core lesson is the
**no-graduation tenet** — a captured note is not a second-class draft
awaiting promotion into a "real" system; it *is* a fact from the moment of
capture, and every later structure (a doc, a board placement, a day-log)
is decoration around the same key.

Days themselves became facts (`9e783e0`): a `log:<date>` fact per day,
`capture → day` membership edges, and `then` edges chaining days into a
walkable timeline. This is the links vocabulary (§1) earning its keep: the
day-log is not a table scan by timestamp prefix, it is a *graph region*, so
canvas can render it (day cards with item counts, edges projected for any
member key — fixed in `0b95ba1`/`d2a83fb`) and lit can narrate it (§7's
virtual day-log docs) from the same facts.

## 6. The parcland backpack rescue

A migration exercise that doubled as a stress test: the user's legacy
parcland boards ("backpack") were imported as substrate facts — board
elements via `ingest`, and their image assets **mirrored into the cell data
store** via `putData`'s new `url` mode (`c54ccfc`: the server fetches the
remote blob, so the edge never carries it and the browser never proxies it).
The imported boards render through the same canvas the native boards use,
which is the migration claim of the thesis in one sentence: *importing is
writing facts; there is no second rendering path to build*.

## 7. `@c15r/lit`: the narrative surface, through to inline fact rendering

Built this session per [`narrative-surface.md`](../narrative-surface.md) and
finished with the inline-fact-rendering change deployed an hour before this
document. The load-bearing decisions:

- **A doc is a fact** (`doc:<id>` `{title, summary, blocks: [{key, fold?}]}`),
  and **blocks are plain facts** referenced by key. Ordering is a list in the
  doc fact — a sequence is a list, reordering is one write. The same fact can
  sit on a board and in a doc; only the decoration differs (no graduation).
- **Fences are transclusions**: ` ```view <name>``` `, ` ```board <id>``` `,
  ` ```cell <id>``` ` embed the live surfaces; ` ```json/csv/mermaid/style``` `
  render through `@c15r/viewers`' `renderFence`; ` ```repl``` ` (added in the
  final change) mounts the full repl element (§8) inside a document.
- **Day-log virtual docs**: `?doc=log:YYYY[-MM[-DD]]` and `log:YYYY-wNN`
  synthesize documents from the day-graph (§5) — rollups grouped by day with
  dotlit-style period navigation. No doc fact exists for these; they are
  *views wearing the document projection*, proving docs and views are the
  same seam.
- **Inline fact rendering** (the session's last code change): a typed fact
  appearing as a block now renders through its **declared viewer**. Lit
  loads the `_types` vocabulary via the kernel (`loadTypes`), resolves
  `viewerFor(meta, value)` (checking `_meta.type`, then `value.type`),
  dynamic-imports the viewers module, and calls
  `renderFence(host, viewer, content, key)` — falling back to markdown when
  no viewer is declared. The demo that validates it: `el:demo-json` reads as
  a collapsible tree inside `doc:viewers` *exactly* as it does on
  canvas-002. One fact, one viewer declaration, two surfaces — the item seam
  (`fact × renderer × placement` vs `fact × renderer × seq`) rendered
  literal.

## 8. `@c15r/run` and the repl: the code kind, writing as an organ

The most trust-demanding tier. `cells/run/index.ts` exposes two tools —
`exec` (sync, or `async: true` for the job pattern, §11) and `fetch` — and
runs submitted JavaScript as an async function body with a deliberately tiny
ambient: `parc`, `input`, `console`, `fetch`.

`makeParc()` is the design center. The code kind's substrate access is
**exactly the cell's own standing**, no more:

- `parc.read(key)` / `parc.query({prefix, limit})` go straight to DynamoDB
  on the substrate table, but the cell's IAM role carries a
  **LeadingKeys condition** pinning it to its owner's partition — the
  database itself enforces the read scope; no application code is trusted.
- `parc.emit(key, value, {type, tags})` does **not** write the table. It
  puts a `substrate.write.requested` event on the bus with
  `Source = <the cell's own pinned source>`, and the substrate ingests it
  like any organ write. The payoff was visible in the first live test: the
  emitted fact landed with writer `@c15r/run-e18f51dc` — **machine-attested
  provenance** that the executing cell could not forge even if the submitted
  code tried, because the Source is pinned by IAM, not by the payload.

This is v0 honesty: code currently runs with the *cell's* standing rather
than the *caller's* (cells receive only `x-cell-caller`, no bearer token, so
there is nothing to impersonate the caller *with* — a feature). Per-caller
scoping rides the expressive-grants design (§12). Polyglot execution
(python, bash) **throws an honest error** — "needs a container runtime —
deferred" — rather than shelling out of a Node Lambda and pretending.

**The repl element** (in `@c15r/viewers`, mountable on canvas and in lit
fences) is the manual rung of the trust ladder for the code kind: a textarea,
a run button, and a *server* checkbox. Client runs use
`new Function('console','input', …)` in the viewer's own browser — zero
server trust needed for scratch work. Server runs submit through
`@c15r/run.exec {async: true}` and poll `fetch` (2.5s interval, 90s budget).
The `⤓ output→fact` button is the thesis move: it writes the output as an
`out:<sourceKey>:<ts36>` fact (type `output`, via `repl`) **plus a
`produced-by` link to the source fact**. Outputs are not console ephemera —
they are facts with lineage, queryable and placeable like anything else.

## 9. `_types`: the fourth vocabulary tier, and home's knowledge demoted

Home (and canvas, and lit) each knew how to title, iconify, and link facts —
as code. The session moved that knowledge into **`_types/<type>` facts**:
`{icon, titlePath, href, viewer}`, where `href` is a template over
`${key}/${id}/${value.*}`. The kernel exposes `loadTypes`/`titleOf`/`hrefOf`;
canvas adopted it first (`dab55eb`, fact cards), home was migrated off its
hardcoded routing table (its list items now resolve icon/title/href entirely
from type facts, with conventions as fallback), and lit's inline rendering
(§7) reads the same `viewer` field. Fourteen types were declared as facts
(`json 🌿, csv ▦, mermaid ◉, style 🎨, repl ▶, output ↳, audit 🔎, doc 📄,
log 🗓️, cell 🔋, capture 📥, view 📊, action ⚡, canvas-element ◻️`).

The justification is the same as for `_actions`/`_views`/`_renderers`:
**adding a type must not require touching any surface**. Declare the fact;
every surface that speaks the vocabulary renders it. The session proved the
property end-to-end: `repl` and `output` are types that did not exist when
home, canvas, or lit were written, and all three present them correctly.

## 10. Canvas: the field, the cards, and consent

Canvas absorbed the most live-use feedback. Grouped by theme rather than
chronology:

**Layout as a physical field.** Un-positioned facts get a deterministic
d3-force layout (`3658eee`), links drive hub/leaf clustering (`ffd2baf`),
and — the significant one — the field stays **warm during interaction**
(`4f092e1`): a rAF loop (3 ticks/frame) keeps the simulation flowing while
anything drags, with fixed nodes tracking the drag. Doing this safely took
two corrective commits worth of guards: the loop's own position writes
pre-register in `lastPos` so it cannot feed itself (`3779cf6`), episodes cap
at 8s, the loop pauses on hidden tabs, and *linked* items participate while
deliberately-placed (pinned) items do not get dragged around by physics.
**Un-pin** (`537f3c6`, multi-select) is the inverse consent: placement
retires and the field takes the items back. The principle threading all of
it: *the system proposes positions; the human's explicit placements are
sovereign*.

**Facts as first-class cards.** The renderer ladder's floor (`fd86cf9`):
*any* fact key renders as a card — typeless facts included — with identity
carried via `_factKey`, icons/titles/hrefs from the `_types` kernel path,
and **⊕ expand-from-elision** (`3d0c840`): a card elided by the salience
window carries an affordance to pull its neighborhood back in
(`parc:expand`). Salience modulates presentation, never position, and
collapse is consensual — the day-card count fix (`d2a83fb`) exists because
a leafless hub must *name* what the window elided rather than silently
shrinking.

**Stability work, because a substrate surface must not crash.** The
recursion crash — a surface element iframing its own board (`9af3d3b`) —
got a depth-capped `safeEmbedSrc` guard; a flight recorder and hidden-tab
pauses (`e09bdbf`) made the next crash diagnosable; persisted state went on
a diet (`versions` and `childCanvasState` dropped at persist time — derived
state is ephemera, not facts). iOS taught two lessons recorded for
posterity: Safari silently returns PNG from `toDataURL('image/webp')`, and
a pinch is two pointerdowns whose orphaned long-press timer fired the
context menu (`99f0a03`). Context menu v2 (`ab0ccd2`) became labeled,
sectioned, selection- and substrate-aware; a minimap element and
image-from-selection joined the menu.

## 11. The edge constraints, and the patterns they forced

Two hard limits of the CloudFront → Function-URL edge were discovered by
hitting them, and both forced *structural* answers that are now platform
patterns:

**~30s origin read timeout caps every synchronous round trip.** No tool
call, however configured, can take longer — raising the Lambda timeout
(`configureCell`/`timeoutSeconds`, 10–300s clamp, `7784d25`) is necessary
but insufficient. The structural answer is the **async job pattern**
(`64680ed`): `submit` writes a `JOB#` item and the Lambda **self-invokes**
(Event-type, fire-and-forget) to do the long work; the client polls `fetch`.
Self-invocation needed exactly one new IAM statement — `InvokeSelf`,
`lambda:InvokeFunction` on the cell's *own* function ARN only, added to the
cell template. The grant is the narrowest possible: a cell may continue
*itself*; peers stay mediated through forge. Results larger than DynamoDB's
400KB item limit chunk across items (300KB chunks) and reassemble in
`fetch`. Validated live with image generation: ~16s of model time, fully
decoupled from the edge.

**~1MB request bodies 403 at the edge (OAC).** Uploading images through
`putData` base64 bodies died at the edge, and the session's first
workaround (client-side webp compression) died on iOS (§10). The user
called the right fix: *"allow putData to return a presigned url"*. So
`putData {presign: true}` returns `{uploadUrl, url}` (SDK `getSignedUrl`,
5-minute expiry, content-type-pinned), the code bucket grew a CORS rule
(PUT from `https://parc.land` only), and the browser PUTs bytes **straight
to S3** (`96620d9`) — the edge carries a 200-byte JSON exchange instead of
megabytes. Validated with a 3MB upload, serve, and preflight.

**Sequencing matters**: `configureCell` re-renders the stack template from
the **fresh** source bundle before `updateStack` — an earlier version
rebuilt from the registry's stale pointer and would have reverted code on
every config change. And cell deploys must wait for CloudFormation
`ACTIVE`; pushing `--deploy` against a stack mid-CREATE 502s (learned
twice; pollers must refresh their device tokens, also learned twice).

## 12. `@c15r/models`: the generative executor in full

The generative kind, assembled from the parts above. `cells/models/index.ts`
holds three providers behind one `generate` surface — Anthropic
(`claude-opus-4-8` default), OpenAI (`gpt-5.1` text, `gpt-image-1` images),
Google (`gemini-2.5-flash` text, `gemini-2.5-flash-image` images) — with
keys under collocated custody (§3), async jobs with chunked image results
(§11), and **dimension awareness** (`e1292c2`): canvas passes the target
element's box, and the executor picks the nearest provider-native size
(OpenAI's 1024/1536 variants) or aspect (Google's 1:1…16:9), so generated
images land fitting the space they were summoned into.

Two reliability lessons are encoded in code:

- **Provider fallback** (`49cd1ff`): an *enabled* provider can still fail —
  the live case was a valid Anthropic key on an out-of-credits org. Canvas's
  `runWithFallback` walks the enabled chain instead of letting one dead key
  block generation.
- **Error passthrough** (`56baf6e`): `callCellTool` now appends the cell's
  error body to the gateway error. The fix validated itself — the
  out-of-credits diagnosis above was *read verbatim* through it.

Bedrock was considered and deferred: it is the one provider whose custody
model is IAM-native (no key to collocate), which makes it the natural first
beneficiary of grants-to-principals — so it waits for that design rather
than getting a bespoke bridge now.

## 13. Deferred, deliberately

The honest ledger. Each of these was *in reach* this session and refused
because the prerequisite model isn't built:

- **Event-driven transformers** (the trust ladder's third rung): a
  transformer firing on writes needs declared write footprints, budgets,
  and loop guards *before* the first one ships — two transformers watching
  each other's outputs is an unbounded bill. Manual and declared rungs only.
- **Per-caller substrate scoping in `@c15r/run`** and **grants to
  principals** generally: today a grant names a cell; the design direction
  is grants to *principals* (users, agents) with grant-to-create-with-
  capability. Run's v0 (cell's own standing, §8) is safe precisely because
  it grants nothing new.
- **Polyglot execution**: needs container-image Lambdas; the langs throw
  honestly instead of approximating.
- **Bedrock** (§12): waits for IAM-native grants.
- **This document, natively in the substrate**: the user's instruction was
  explicit — markdown in repo, *"not substrate natively_yet_/this time"*.
  The narrative surface it would live on (`doc:` facts on lit) exists and
  hosts its design predecessors; hoisting this record is a one-`ingest`
  follow-up when wanted.

## 14. Branch and process notes

Mid-session the working branch became unmergeable after a rebase-merge on
main; the recovery was `claude/models-transformers` cut from fresh
`origin/main`, `git rebase` auto-skipping 11 patch-identical commits,
27 surviving, tests green — now PR #130, with this session's later work
(viewers, run, types, lit inline rendering) landing on top. The standing
loop held throughout: implement → test → commit → push → deploy →
**validate through live use** — every feature above was exercised on
parc.land (often from a phone, which is where iOS taught its lessons)
before being called done. Cells iterate through `cell-sync.mjs push <name>
--deploy`; git remains the truth for their sources (§2).

The arc in one line: the substrate grew three executor tiers, a fourth
vocabulary tier, two new surfaces, and an organ — and the kernel of the
thesis (one table, attested writes, vocabulary as data, projection
everywhere) did not move.
