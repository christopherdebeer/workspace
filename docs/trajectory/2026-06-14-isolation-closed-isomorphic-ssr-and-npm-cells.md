# 2026-06-14 — Cell-origin isolation closed, isomorphic React SSR, npm-for-cells

Status snapshot before an **overdue merge**. The working branch
(`claude/canvas-snapshot-ssr`, PR #136) is **44 commits ahead of `main`** and
spans three intertwined arcs that are now all landed and deployed. This doc
captures what shipped, what's still open, and one investigation call-out
(salience) to resolve around the merge.

## Where we are

Everything below is deployed to production from the branch head and validated
live unless noted. The remaining items are follow-ons, not blockers — but the
branch should be **merged to `main` first** (it has drifted far enough that the
divergence is itself a risk).

## What landed this arc

**1. Cell-origin isolation — §1.1 closed (`docs/cell-origin-isolation.md`).**
Each user cell now lives on its own browser origin (`<owner>-<name>.on.parc.land`)
so a cell's client JS can never read the shell's `localStorage`/cookie.
Steps (1)–(7) all shipped:
- Containment + `Sec-Fetch-Dest: document` gate on cookie identity; WebAuthn
  `expectedOrigin` pinned; hyphen-free usernames.
- A gated second CloudFront distribution for `*.on.parc.land` + DNS-validated
  wildcard cert; viewer-request rewrite `<owner>-<name>` → `/@owner/name`.
- `cellAddress()`/`apiBase()`/`cellUrl()` (owner-from-host); `/mcp` + `/oauth`
  CORS for cell origins; Model-A scoped-token handoff (`oauth.ts cellCeiling`
  caps a cell's minted scope to `workspace:read/write` + `cell:<o>/<n>:*` — a
  cell can **never** get admin/`platform:*`).
- **The cutover (step 7):** the apex `/@owner/cell` behaviour 302-redirects
  *navigations* (document/iframe/frame) to the subdomain; sub-resources pass
  through. Verified live (`/@c15r/lit?doc=…` → `302` to the subdomain).

**2. Isomorphic React SSR + hydration — the real flash fix.**
- Platform enabler: forge's cell bundler can now inline a React server renderer.
  `SERVER_BUNDLED` (react/react-dom/scheduler) is resolved from forge's own
  `node_modules` (`bundlingNodeModules`), `jsx:'automatic'`, `NODE_ENV=production`.
- `lit` rewritten isomorphic: one `shared.tsx` tree rendered to a string on the
  server (`renderToString` + a serialized `lit-state` script) and hydrated on the
  client (`hydrateRoot`). Byte-identical markup → no first-paint flash. The
  earlier `paint()`/cookie/`data-ssr-auth` workarounds are obsolete for lit.

**3. Arbitrary npm for cell servers (`docs` n/a — see `transpile.ts`).**
A dep declared once in `client/imports.json` is fetched from esm.sh (`?target=node`)
at bundle time and inlined into the cell's `index.js` (new `cell-http` esbuild
namespace, `/tmp` cache). One import map drives **both** bundlers, so an
isomorphic cell's server and client land on the byte-identical dependency.
No `npm install` (the read-only Lambda fs can't, and CDN-fetch runs no install
scripts / ships no native binaries — narrower supply chain). Proven live: the
`starter` cell renders `ms('2 days')`=172800000 server-side.

**4. Starter template + forge hint.** `cells/starter/` is the copyable
isomorphic-React reference (live, public: `https://c15r-starter.on.parc.land/`);
forge's `create` tool description now advertises the happy path and points at it.

**5. Forge orphan-record fix.** `createCell` reconciles a `DELETING` record whose
CloudFormation stack is already gone (previously it wedged the cell name forever).

## Addendum — post-merge session (2026-06-14, branch `claude/recent-trajectory-doc-cfeciy`)

After the merge, cleared the low-hanging follow-ons and fixed two issues found
while validating. All deployed to prod (CDK runs #177–#179) and live-verified.

- **Async `cells.deploy` (was: a misleading 502).** Bundling a cell (esm.sh dep
  fetches + two esbuild passes + upload + `updateFunctionCode`) outlasts the
  synchronous path: forge's Lambda has 60s+, but the `/mcp` gateway (default 15s)
  and CloudFront origin (default 30s) in front time out first and return 502 while
  the work *completes* (a sync Lambda invoke isn't cancelled when its caller dies).
  Fixed by making deploy **event-driven**, mirroring `createCell`: `deploy` records
  `DEPLOYING`, emits `cell.deploy.requested` (routed back to forge via
  `CellDeployRoute`, source-pinned to `cells`), and returns; `onDeployRequested`
  runs the bundle off the request path and records `DEPLOYED`/`FAILED` (+ cause).
  `getCell` surfaces `deploy:{phase,version,requestedAt,error?}` as the poll
  target; `cell-sync push --deploy` polls it. forge timeout → 120s. The
  write/edit `deploy:true` flags share the same `requestDeploy` path. Validated
  live: lit redeployed `DEPLOYING → DEPLOYED`, no 502.
- **lit post-hydration flash fixed.** lit SSR'd content, hydrated cleanly, then
  flashed `loading…` before re-showing content. Cause: when the client flips from
  the SSR `<Surface>` to the interactive `<Route>`, `DocEditor`/`ListEditor` init
  their state to `null` and render a loading placeholder while they refetch —
  discarding the server paint for a round-trip. Fixed by **seeding** those views
  from the serialized ViewModel (`docSeed`/`listSeed`) so the first interactive
  render IS the server content; `load()` refreshes in place. *Browser eyeball
  still wanted* to confirm the flash is gone (it's a client-timing behaviour).
- Also done: items 4/5/7 below (data-ssr-auth drop, marked restore, forge
  reconcile gaps).

### Known minor polish (not done)
- The `DEPLOYING` marker's `version` (command-time `Date.now()`) differs from the
  landed `DEPLOYED` version (the worker's own `Date.now()`, == the S3 build key).
  Harmless — pollers read the terminal version — but threading one version through
  `deployCell` would make them identical.

## Outstanding work

1. ~~**MERGE `claude/canvas-snapshot-ssr` → `main` (PR #136).**~~ **DONE** —
   merged (commit `99d97d5`); the addendum work landed on top.
2. **Item 3 — `platform/ui` reusable in cells.** Have `cells/kernel` re-export a
   React UI kit from `kernel/app.js` (cells already import kernel cross-origin),
   then lift `json`/`csv` viewers into shared isomorphic components (the original
   "should viewers be React" question). `mermaid`/`style`/`repl` stay client-only.
3. **Generalize isomorphic React to the other tier-2 cells.** `canvas`/`input`/
   `regwatch` are still vanilla DOM — the flash class remains for them; review for
   the same `shared.tsx`/`hydrateRoot` treatment now that the platform supports it.
4. ~~**lit cleanup.** Drop the now-unread `data-ssr-auth` emission.~~ **DONE**
   (`ssrPage` now emits only `data-ssr="1"`; `isOwner` rides in the serialized
   state, the only thing the client reads).
5. ~~**Restore richer markdown in lit, cheaply.**~~ **DONE** — `marked@12.0.2`
   declared in `cells/lit/client/imports.json` and `renderMarkdown` (shared.tsx)
   now delegates to it. Both bundlers inline the same pin → hydration parity
   holds; the fence enhancer keys on `pre > code` + `language-<lang>`, which is
   marked's default output. *Needs a browser eyeball* (tables/nested-lists render,
   no hydration warning) since cells aren't in the repo type-check/test path.
6. **Cell scope v2.** Per-key-prefix write-narrowing (a cell capped to
   `workspace:<owner>:<prefix>:write`) — currently a cell acts AS the user,
   scope-capped (Model A). Cell-as-principal / agent-run principals deferred
   (explicitly "not now").
7. ~~**Reconcile gaps in forge.**~~ **DONE.** (a) `createCell`'s orphan check now
   treats *any* non-FAILED record whose stack has vanished as recreatable (was
   `DELETING`-only) — so a `CREATING` record whose create failed (auto-deleted via
   `OnFailure: DELETE`) no longer wedges the name. (b) `cells.list` now reconciles
   non-terminal records against their live stacks (parallel describes), via a
   shared `reconcileStatus` helper that `getCell` also uses. Covered by two new
   `forge-cell` tests.
8. **Optional hardening (§6).** A separate registrable domain
   (`parc-usercontent.land`) would make cookie-scope + RP-ID structural rather
   than enforced. Later.
9. **Pending human validation.** Browser eyeball on: the lit pilot (no flash;
   editing/fences/log rollups), the step-7 redirect, and the starter cell.

## RESOLVED — salience redesigned to a hybrid (implemented, not yet deployed)

The investigation below ran with the legacy source in hand (the legacy workspace
is **not in git** — it's the Val Town val `c15r/workspace`; `ops.ts` `salience()`,
`db.ts` schema, `tend.ts` digest). Verified the legacy formula exactly as the
"first-pass corrected" reading predicted: cumulative lifetime reads ×0.5 +
undirected degree ×0.3 + linear age penalty + a **30-day** last-read recency term
(−5 if never read), surfaced via a daily email digest (a *ranking*, not a filter).

**Key reframing:** the new model is a per-read *attention filter* (elide < 0.1
hides the value), not a ranking — so a 5-year corpus ported cold lands almost
entirely below the elide threshold and is **invisible** until each fact is touched.
That's the real migration risk, not aesthetics.

**Decision (chosen): Hybrid.** `computeScore` is now a bounded-[0,1] blend of five
computed signals (`platform/runtime/state.ts`):

```
0.45·recency + 0.15·velocity + 0.10·attention + 0.20·standing + 0.10·centrality
  recency    = 2^(-age / 7d)                       # half-life 1h → 7d
  velocity   = min(writes_in_window / 5, 1)
  attention  = min(reads_in_window  / 5, 1)
  standing   = min(log1p(lifetime_reads+writes) / log1p(50), 1)   # earned floor, saturating
  centrality = min(degree / 8, 1)                  # structural; edges were unused by scoring
```

Both new terms derive from the trajectory + edges in one pass (`buildSignals`);
read/query/neighbors load the full trajectory once and share it. `_meta` now
exposes `standing`/`centrality` for tuning (Q4: measure, don't assert). Behavior
under the new weights (verified by tests): a just-written fact reaches focus; a
month-idle but earned/linked fact stays peripheral (visible); genuinely cold junk
still elides.

**Migration plan (for when the corpus ports):** replay the legacy `log` rows as
trajectory events and `links` as edges into the target scope — `standing` and
`centrality` then compute naturally, no separate counter seeding or score prior.
(The legacy `log` is the same shape as the substrate trajectory.)

**Still open:** (1) **deploy** — this changes live read-shaping for the current
corpus, so it's committed but undeployed pending a deliberate `cdk deploy`;
(2) write the migration script against the val's sqlite when the port is scheduled;
(3) instrument scores/tiers post-deploy and tune weights (Q4) rather than asserting.

<details><summary>Original investigation call-out (now resolved above)</summary>

### Call-out: investigate & contrast legacy vs new workspace salience

**Do this around the merge** — it bears on whether a ported legacy corpus will
feel right under the new substrate.

**New substrate salience is real code** — `platform/runtime/state.ts`
`computeScore` (not inference):

```
score = clamp01( 0.5·recency + 0.3·velocity + 0.2·attention )
  recency   = 2^(-age / halfLifeMs)              # exp decay since last WRITE; halfLife default 1h
  velocity  = min(writesInWindow / 5, 1)         # recent WRITE rate (window default 1h), saturates at 5
  attention = min(readsInWindow  / 5, 1)         # recent READ rate, saturates at 5
```

Computed at read time from the trajectory log; bounded [0,1]; tiers at
focus ≥ 0.5, elide < 0.1.

**Legacy workspace salience** (first-pass reading of the old `ops.ts`, **to be
verified against source** — it lives in the old workspace/sync repo, not here):

```
score = -(days since updated)        # unbounded linear age penalty
        + read_count · 0.5           # CUMULATIVE lifetime reads
        + link_count · 0.3           # CUMULATIVE edge count
        + recency_of_last_read · 0.3 # (or −5 if never read)
```

**The substantive contrasts** (these correct the first pass, which framed the new
model as "velocity-weighted decay" and read `velocity` as access-rate):

- **Window vs lifetime — the deepest difference.** New salience counts reads and
  writes in a ~1h *window*; legacy counts *cumulative lifetime* `read_count` and
  `link_count`. The new model has **no cumulative memory** — it recomputes "what's
  hot now" from the recent trajectory each read.
- **Recency dominates, with a 1h half-life.** The top weight (0.5) is *write*-age
  decay; at the 1h default, an entry not written in ~3h already has recency ≈
  0.125. So a mostly-idle corpus reads as ~0 across the board (matches the
  observed "everything at 0.04/0.00; the just-deployed starter at 0.17").
- **`velocity` = recent writes, `attention` = recent reads** (two separate terms),
  not a single access-rate term.
- **No graph term.** Legacy weighted `link_count`; the new `computeScore` has
  **no link/centrality input at all**, even though edges are first-class in the
  substrate. Worth deciding deliberately.
- **No import path for earned signal.** Legacy scores (e.g. a source surface at
  20.84, a protocol at 19.67) encode months/years of compounding reads+links.
  The new model has no field to seed that into — a ported corpus arrives
  uniformly cold and stays elided until touched.

**Open questions to resolve:**
1. Is a 1h-half-life, window-based recency model right for a *personal
   productivity workspace*, where a week-old note can still be the most important
   thing? (Legacy kept earned importance ~permanently.)
2. Should links feed salience again (centrality), or is that deliberately dropped?
3. Migration: how does a ported 5-year corpus get non-trivial initial salience —
   backfill a synthetic trajectory, seed a per-fact prior, or accept a cold start?
4. Steady-state: is velocity-weighted recency actually better than
   cumulative-additive once signal is re-earned? Genuinely open — worth watching
   with instrumentation rather than asserting.

The honest summary stands: these are *different philosophies*, and the new model
will feel worse for the first weeks of a ported corpus because the signal hasn't
been re-earned — not (necessarily) because the algorithm is worse in steady state.
Decide the migration story (Q3) before the corpus port, and the link question
(Q2) before it calcifies.

</details>
