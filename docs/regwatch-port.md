# RegWatch → tier-2 cell: investigation and port design

> Investigation of `c15r/regwatch` (val.town) as of 2026-06-12, and the design
> for hoisting it onto the substrate as a tier-2 dynamic cell. RegWatch is the
> first candidate with a **second human principal** (Emily), so it doubles as
> the test case for user sharing — what [`dynamic-cells.md`](dynamic-cells.md)
> defers as "scope grammar for principals" meets its first real user here.

## 1. What RegWatch is today

FCA / Investment Association regulatory monitoring for Emily (State Street):
an agent collects UK regulatory publications daily, classifies them against
State Street's service lines (depository, custody, fund admin, transfer
agency), and a mobile-first dashboard at `https://emdash.val.run/` presents
them as a review inbox. Design doc lives in the val (`DESIGN.md`).

Anatomy of the val (`c15r/regwatch`, unlisted):

| File | Role |
| --- | --- |
| `main.ts` (~1.6k lines) | HTTP val: server-rendered dashboard (inbox / item detail / settings / about) + JSON API (`/api/ingest`, `/api/items`, `/api/review`, `/api/flag`, `/api/sources`, `/api/prompts`, `/api/feedback`, `/api/stats`, `/api/notes`) |
| `mcp.ts` | Second HTTP val: bespoke MCP server — OAuth 2.1 + WebAuthn passkeys (via `c15r/mcp-auth`), 12 tools for the collector and ad-hoc queries |
| `admin.ts`, `db.ts`, `sources.ts`, `prompts.ts` | Business logic, val.town SQLite wrapper, seed data, prompt templates |

Storage is val-scoped SQLite: `items`, `sources`, `reviews`,
`prompt_versions`, `collector_notes`, plus nine `auth_*` tables belonging to
the bespoke MCP auth stack.

Auth today is three independent mechanisms — the central pain point:

1. Dashboard: HTTP basic auth (`AUTH_USERNAME`/`AUTH_PASSWORD` env vars).
2. Collector API fallback: `?token=` query param (`API_TOKEN` env var).
3. MCP endpoint: full OAuth 2.1 + WebAuthn passkey stack, non-expiring
   tokens, all hand-rolled inside the val.

The collector itself is **not** a val.town cron — it is a Claude Code
scheduled task that connects to the val's MCP endpoint, calls
`regwatch_get_instructions` (versioned prompt + source registry + reviewer
feedback), does the web searching/fetching in the harness, then
`regwatch_ingest`s structured items and `regwatch_post_note`s run summaries.

## 2. Operational findings (2026-06-12)

**The collector has been quietly running, successfully.** 291 items collected
between 2026-04-17 and 2026-06-11 (yesterday), one run per day at ~18:10 UTC:

| Month | Active days | Items |
| --- | --- | --- |
| 2026-04 (from the 17th) | 9 | 114 |
| 2026-05 | 23 | 120 |
| 2026-06 (to the 11th) | 10 | 57 |

Gaps are sparse single days (quiet news days produce zero ingests, and runs
de-duplicate by URL), not outages. Source distribution: `fca_press` 77,
`boe_pra` 56, `hmt` 44, `fca_policy` 35, `ia_funds` 24, `esma` 23,
`travers_smith` 16, `ia_press` 8, `ia_publications` 6, `sidley` 2.

The collector is also self-reporting conscientiously: **80 collector notes**,
including per-run coverage summaries (sources hit, zero-result sources,
fetch failures, search window) and follow-ups it sets for itself. One
recurring operational issue: `bankofengland.co.uk` WAF returns **403 to
WebFetch across all paths** (RSS and HTML). The collector found a workaround
(curl with a `Mozilla/5.0` UA gets the RSS feeds) but individual BoE page
bodies remain unfetchable; affected items are tagged
`meta.fetch_status="primary_failed"`. It has flagged this repeatedly and
recommended a fetch-alternate/proxy.

**Nobody is on the other end of the loop.** All 291 items are `unreviewed`,
the `reviews` table is empty, all 80 collector notes are `open` (none
resolved or responded to). The MCP auth store has exactly one user
(`emily`, registered 2026-04-17 04:22 UTC) with one non-expiring token
minted the same minute — two hours before the first ingest, so that
credential is almost certainly the collector's setup, not Emily on her
phone. Caveat: basic-auth dashboard *views* leave no durable trace (val.town
telemetry only covers the trailing hour), so we can't prove she never looked
— but eight weeks with zero reviews, zero flags, and zero note resolutions
means the feedback loop the system was designed around has never closed.
The prompt-versioning / reviewer-feedback machinery is all dormant
scaffolding waiting on first use.

Two months of real, current data and a proven daily collector make this a
good port candidate: the port can't break a habit that doesn't exist yet,
and a `parc.land` URL with a passkey is a better first-use story than a
shared basic-auth password.

## 3. Port design: `@c15r/regwatch`

Why it's the right tier-2 test case: a real app with real data, an external
agent writer (the scheduled collector), a browser UI, and — uniquely — a
second human principal. Every prior cell (`@c15r/run`, `@c15r/models`,
`@c15r/viewers`, `@c15r/lit`, `@c15r/input`) serves only its owner.

### Mapping

| val.town today | tier-2 cell |
| --- | --- |
| Deno HTTP val `export default (req: Request)` | Lambda Function-URL handler (`services/cells/cell-template.ts` stack) |
| val-scoped SQLite | per-cell DynamoDB table (`pk`/`sk`) |
| `https://emdash.val.run/` | `https://parc.land/@c15r/regwatch/` via the `/@*` dispatcher |
| basic auth + `?token=` + bespoke OAuth/WebAuthn | **deleted** — kernel session in the browser, gateway-authenticated MCP for tools, `x-cell-caller` for identity |
| `mcp.ts` JSON-RPC plumbing, CORS, SSE shim | **deleted** — cell exposes `GET /_tools` + `POST /_tools/<name>`; gateway surfaces them as `@c15r/regwatch.<tool>` |
| env vars (`API_TOKEN`, `AUTH_*`) | none needed |
| source lives only in val.town | `cells/regwatch/` under git, `scripts/cell-sync.mjs push regwatch --deploy` |

The biggest single win is deletion: `mcp.ts`'s entire auth surface (nine
`auth_*` tables, passkey ceremony UI, token minting, consent flow) was a
hand-rolled copy of exactly what the platform now owns once (`services/auth/`,
`@c15r/kernel`). The port removes ~40% of the val's code by letting the
substrate be the substrate. What remains to port is honest app code:
the storage layer, the tool handlers in `admin.ts`, and the dashboard HTML.

### Storage sketch

Single-table layout in the cell's own DynamoDB table:

```
pk                  sk                          item
ITEM                <collected_at>#<id>         full item (title, url, body_md, summary, signals, status, meta)
ITEM_URL            <canonical url>             { id } — dedupe guard (conditional put)
REVIEW              <item_id>                   relevance, applicability, notes, action_required, reviewer (from x-cell-caller), reviewed_at
SOURCE              <source_id>                 registry entry
PROMPT              <name>#v<version>           prompt text, notes, active flag
NOTE                <created_at>#<id>           collector note, status, resolution
```

Inbox query = `pk=ITEM` descending by `sk`, filter `status=unreviewed` —
matches the access pattern the dashboard actually uses (newest-first, limit
100). `body_md` documents occasionally run long; anything over the item-size
comfort zone goes to the cell's S3 data space (`cells.putData`,
`docs/cell-storage-s3.md`) with a pointer in the item.

### UI

The dashboard is server-rendered template-literal HTML — it ports nearly
verbatim into the Lambda handler. The one structural change: drop basic auth,
load the kernel (`https://parc.land/@c15r/kernel/app.js`) in a small client
shim for session + `read/act` calls, and let review/flag actions go through
`@c15r/regwatch.review` etc. so they carry the caller's identity. Mobile-first
inbox metaphor is unchanged — that part of the design was never the problem.

### Collector

Unchanged in kind: it stays a Claude Code scheduled task (tier-2 cells have
no cron — deliberately deferred, see `dynamic-cells.md` §12 and the
trajectory doc's "event-driven transformers" caveat). It just repoints its
MCP connection from the val.town endpoint to `parc.land`'s gateway and calls
`@c15r/regwatch.get_instructions` / `.ingest` / `.post_note`. Authenticating
as `c15r` (device-flow token, same as `cell-sync.mjs`), it is the cell owner
— no grant machinery needed for the agent at all, which is cleaner than
today's separate non-expiring token. Carry over the collector-note follow-up:
give the runtime prompt the BoE UA workaround permanently, since the notes
show it being rediscovered.

### Tools

The 12 `regwatch_*` tools port one-to-one as `/_tools` entries (the
`@c15r/run` / `@c15r/models` pattern). They become `@c15r/regwatch.ingest`,
`.list_items`, `.review`, `.stats`, `.feedback`, `.get_instructions`,
`.post_note`, `.list_notes`, `.list_sources`, `.add_source`,
`.update_source`, `.get_prompt`, `.save_prompt` — plus `.review` gains a
`reviewer` field stamped from `x-cell-caller` rather than trusted input.

### Migration

One-shot, small: export `items`, `sources`, `prompt_versions`,
`collector_notes` from the val's SQLite (the data is ~291 items + 80 notes;
`reviews` is empty, nothing to lose), bulk-write through a temporary
`.migrate` tool on the cell, verify counts, then leave the val running
read-only as fallback until the new collector has a week of green runs.
The `auth_*` tables are deliberately not migrated — that identity dies with
the val.

## 4. User sharing: what Emily needs

This is the part the platform hasn't exercised yet. The pieces exist:

1. **A principal.** Accounts are created on first OAuth consent
   (`services/auth/` — PKCE in the browser, passkey registration via
   WebAuthn). Emily signs in once on her phone at the cell's URL; the kernel
   drives the flow. No invite system exists or is needed at this scale.
2. **A grant.** `cells.grant` (`services/cells/service.ts:1179`) adds her to
   the cell's `grants[]`; both UI dispatch (`callCell`) and tool calls
   (`callCellTool`) authorize owner-or-grantee. One call:
   `cells.grant { cell: regwatch, user: "emily" }`.
3. **Attribution.** The dispatcher forwards the authenticated principal as
   `x-cell-caller` (`services/cells/service.ts:410,994`), so her reviews are
   stamped with her identity without the cell doing any auth work itself.

What this exposes, honestly:

- **Grants are per-cell, all-or-nothing.** Emily granted the cell can call
  *every* tool, including `.save_prompt` and `.update_source`. For this app
  that's arguably correct — reviewer feedback steering the prompt is the
  design — but RegWatch is now the concrete motivating case for the deferred
  per-tool scope grammar. When that lands, the natural split is
  reviewer-scoped (`review`, `flag`, `list_*`, `stats`, notes) vs
  owner/collector-scoped (`ingest`, prompts, sources).
- **No substrate slice involvement is required.** Emily doesn't need a
  workspace; the cell's table is the app's truth. `workspace.share` only
  enters if we later project regwatch facts into slices (e.g. an
  `inbox-count` fact shared into c15r's home surface). Keeping the first
  multi-user test on the narrower `cells.grant` path is deliberate.
- **Onboarding is a two-step, phone-friendly story:** open
  `parc.land/@c15r/regwatch`, register a passkey; owner runs one grant call.
  Compare today: a shared basic-auth password she never used.

## 5. Sequence

1. Scaffold `cells/regwatch/` (handler + storage module + `/_tools`), deploy
   via `cell-sync.mjs`, smoke-test tools through the gateway as owner.
2. Port the dashboard HTML with kernel session; verify on a phone.
3. Migrate data from the val; reconcile counts (291 items / 10 sources /
   80 notes / prompt versions).
4. Repoint the scheduled collector at `parc.land`; watch one full run and
   its coverage note.
5. Create Emily's principal with her, `cells.grant`, first review on her
   phone — the moment the 8-week-old feedback loop first closes is also the
   platform's first real multi-user datapoint.
6. After a week of green runs: freeze the val (revoke its token, leave it as
   archive), and fold the BoE 403 workaround into the active collector
   prompt.

## 6. Status — ported (2026-06-12)

Steps 1–3 are done and live; the cell is `regwatch-b0393000` at
`https://parc.land/@c15r/regwatch/`.

- **Cell deployed** from `cells/regwatch/` (source mirrored here under git):
  Lambda handler + per-cell DynamoDB table (60s timeout for the migration
  path), 17 tools at `/_tools` → `@c15r/regwatch.*`, public shell + kernel
  client. Verified end-to-end through the gateway as owner: `stats`,
  `list_items`, `get_item`, `get_instructions`, `save_prompt`,
  `resolve_note`, and anonymous `GET /app.js` through dispatch.
- **Data migrated and reconciled.** A temporary token-gated `/api/export`
  route on the val let the cell's `migrate` tool pull the dump server-side
  (nothing bulky through chat context); the route and `checkAuth` bypass were
  removed afterwards. Counts match the val exactly: 291 items (per-source
  distribution identical), 11 sources (10 active), 80 collector notes,
  collector prompt v1–v2 + classifier v1.
- **Collector prompt v3 saved** (active): tool references renamed from
  `regwatch_*` to `@c15r/regwatch.*`, and the BoE browser-UA fetch
  workaround is now standing instruction. The two recurring BoE-403 notes
  were resolved with replies pointing at v3, which now surface in
  `get_instructions` as reviewer guidance — first real use of the
  resolved-notes feedback channel.
- **Remaining (require the humans):** repoint the Claude Code scheduled
  collector at the parc.land MCP server (step 4 — its config lives in
  claude.ai, not reachable from here); Emily's first sign-in + `cells.grant`
  (step 5); freeze the val after a week of green runs (step 6). Until the
  collector is repointed it keeps feeding the val, so plan a final
  incremental `migrate` (the URL dedupe makes it idempotent) at cutover.

## 7. Substrate-nativity, honestly (2026-06-12)

Assessment after re-reading [`substrate.md`](substrate.md),
[`declarative-actions-vs-code-cells.md`](declarative-actions-vs-code-cells.md),
and the trajectory ledger — recorded so the next session can pick up the
outstanding items without re-deriving the argument.

### What the port is, in the thesis's terms

A well-housed **organ**, not reef. `substrate.md`'s pre-substrate diagnosis
of the platform — "all organs and no reef" — describes regwatch-as-ported in
miniature:

- **Items are rows, not facts.** No `{value, _meta}`, no server-stamped
  provenance (`collected_at`/`reviewer` are hand-rolled where the substrate
  stamps `writer`/`revision` for free), no supersede (status mutates in
  place), no salience, no links.
- **The dashboard is a bespoke surface, not a projection.** The tools and
  the client are two separate builds, not two renderers of one declaration.
- **The vocabulary is code-only.** `review`/`flag` are exactly the shape
  sync's declarative actions express as data — a CEL guard
  (`status == 'unreviewed'`) plus a declared write footprint. On the
  execution gradient, only the collector genuinely needs an organ (network
  I/O, dedupe serialization); the triage loop sits at the declarative end
  and is the obvious first demotion of code to declaration.

The thesis names the test this trips: *"if porting requires working against
the platform's grain — treating `{value, _meta}` as cell-private trivia —
that is the signal the foundation is missing something."* Tripped
deliberately, as step one; the missing piece it points at is identity.

### Tenancy: what a grant actually gets you

The cell's table is **one shared pool with attribution, not isolation**.
Every granted principal sees the same items/notes/sources through the tools;
reviews are stamped with the caller via `x-cell-caller`. Known consequences:

- `REVIEW` is keyed by item id alone — structurally **one review per item,
  latest reviewer wins**. Correct while "the reviewer" is singular (the
  app's design premise); wrong the day two reviewers disagree.
- Grants are binary (per-cell), so the owner/reviewer split is an ad-hoc
  `OWNER_ONLY` check inside the cell — an interim stand-in for the deferred
  per-principal scope grammar.
- The only *primitive* per-caller storage a cell gets is the S3 data space
  (`cells.putData` partitions by caller); the table's tenancy is whatever
  the cell code decides, and regwatch decided team-shared.

### The single-user bias is foundational, not incidental

A substrate-native regwatch would be: the collector as an attested organ
(the `@c15r/input` pattern) emitting `reg-item` facts into a **slice**;
inbox as a registered view; triage as declared actions; salience doing the
deadline/neglect work the val built bespoke machinery for; items linkable
onto boards and day-logs so the silo dissolves. But — **whose slice?** The
natural owner is Emily, with the collector granted write-into-her-scope. The
substrate cannot express that today:

- slices are per-user and cells bake `OWNER=c15r` into IAM
  (`LeadingKeys: STATE#c15r`) and env;
- `workspace.share` is **read-only** sharing — `substrate.md` step 3 lists
  "write-through grants" as next;
- grants-to-principals sits in the trajectory doc's deferred ledger.

So *Emily-as-grantee-of-c15r's-app* is what's expressible today (and what
shipped); *Emily-as-first-class-owner-of-her-own-reviewed-state* is what the
model wants and the primitives don't yet support. Regwatch is now the
concrete motivating case for three deferred things at once: per-tool scope
grammar (the app's view), write-through grants + grants-to-principals (the
substrate's view), and the organ→vocabulary promotion path (triage first).

### Outstanding items (pickup list for the next session)

Operational (from §6):

1. Repoint the Claude Code scheduled collector at the parc.land MCP server
   (config lives in claude.ai); watch one full run and its coverage note.
2. At cutover, run one final incremental `migrate` from a fresh val export
   (idempotent — URL dedupe skips existing items).
3. Emily onboarding: passkey sign-in at `parc.land/@c15r/regwatch`, then
   `cells.grant { cellId: "regwatch-b0393000", principal: <her handle> }`.
4. Real-device check of the OAuth → inbox boot (verified via gateway and
   dispatch, not yet clicked through on a phone).
5. After a week of green runs: freeze the val (revoke its token, keep as
   archive).

Substrate-convergence (each independently shippable):

6. **Reef projection (cheap, now):** have the cell emit a small projection
   into the substrate via the reef-writer/organ path — `regwatch/inbox-count`
   and/or stub facts per high-relevance item linking back to the cell — so
   regwatch surfaces in home/attention/tend instead of being invisible to
   the reef.
7. **Per-review history:** key reviews `REVIEW / <item_id>#<reviewer>` (or
   append-only) before a second reviewer ever exists.
8. **Triage as declared actions:** when write-through grants land, move
   `review`/`flag` to vocabulary over item facts and demote the cell to
   ingest-only organ.
9. **Items as facts:** the full promotion — collector writes `reg-item`
   facts into the owning slice via the attested event path; inbox becomes a
   registered view; the dashboard shrinks to a themed projection. Gated on
   grants-to-principals + write-through grants; regwatch is the test case
   that should drive their design.
