# ADR-0091 — The public read path: tokenless SSR, a public-viewer token, and the grant fold across every read

- **Status:** Accepted 2026-07-22 (shipped + live: home SSR + featured, the
  `@guest` credential, the `query`/`peek`/`edges` grant fold, the landing doc,
  the reserved-username blocklist).
- **Depends on:** the grant axis (ADR-0007 `$grants`, `applicableGrants`,
  `share`/`group`, IAM `LeadingKeys` partition), `recall`'s existing grant fold
  (`services/workspace/commands-read.ts`), the tokenless direct-IAM cell read
  pattern (lit/canvas — `cells/*/index.ts` reading `STATE#<owner>` over the
  cell's own role), the OAuth 2.1 device grant + `auth.mintToken` scope-ceiling
  narrowing (`services/auth`), the auth-aware home SSR (ADR-0090, the `/r/<key>`
  fact address + `ssr.json` reads-as-caller), and the `docs/*` corpus mirror
  (ADR-0027 `file/docs/<path>.md` public source facts).
- **Grounded in:** the home trailhead work (2026-07). Signed out, the apex was a
  static marketing pitch: the interactive graph, search, and doc reading were all
  gated on `authed`, and an anonymous caller has no token to reach `/mcp`. We
  wanted a **real** signed-out view at the apex — curated public substrate on
  first paint, then an interactive **read-only** graph — without ever risking a
  private fact.

---

## Context

Three walls stand between an anonymous visitor and the substrate:

1. **Scope** — `/mcp` reads need a bearer token; peek/recall require
   `read:workspace`. Anonymous has none. And scope **cannot be slice-limited**:
   `read:workspace` reads the whole slice, never "just the public part". So a
   naive checked-in read token for the owner would expose *everything*.
2. **Grant** — `applicableGrants(store, viewer)` decides what a viewer may see;
   `viewer === undefined` (anonymous) returns only `public` grants. This is the
   right boundary, but only `recall` folded it — `query`, `peek`, `edges`,
   `members` read the caller's **own partition only** (the "in-slice successor"
   design). The graph loads nodes via `query`, links via `edges`, and bodies via
   `peek` — so a viewer with an empty own slice saw nothing.
3. **Partition** — a cell's IAM role is `LeadingKeys`-scoped to `STATE#<owner>`.
   The database *is* the boundary; a tokenless cell read can reach exactly one
   owner's slice.

The safety principle that resolves all three: **make the boundary the DATA a
principal can see, not a constraint on the token.** A credential is safe to
expose iff the identity it authenticates can *only ever* see public content.

## Decision

Five parts, layered — each safe on its own, composing into the public read path.

### 1. Tokenless SSR public slice (first paint, no JS)

Home reads its **own** owner slice directly over DynamoDB (the lit/canvas
pattern: `SUBSTRATE_TABLE` + `STATE#<CELL_OWNER>`, no token — the IAM role is the
boundary), filtered to keys the owner shared to `public` via the `_public/<pattern>`
reflections (`services/workspace/commands-sharing.ts` writes them on
`share {to:"public"}`). It emits ONLY covered keys, so a private fact can never
leak. Anonymous boot carries `featured` (curated public docs, title+summary) and
the page server-renders real content. This is the crawlable, no-JS floor; it can
never do interactivity (SSR is render-once).

### 2. The `@guest` public-viewer token (live reads)

Interactivity needs the client to fetch live — which needs a credential. The safe
one is **a distinct system user, `@guest`, that holds only `public` grants**:

- `@guest` authors nothing (empty own slice); its *view* is exactly the union of
  what every owner shared to `public`. A long-lived **read-only** (`read:workspace`,
  no write) token for it is **public-safe by construction** — a leak exposes only
  what is already world-readable.
- Minted via the OAuth **device grant** (the owner approves as `@guest`), then a
  non-expiring token minted from it. Stored at `_config/guest-token`, read by home
  over its IAM slice-read, injected into the **anonymous** boot.
- The client attaches it to **data reads only** (`mcpFetch`), never to identity
  resolution — so a signed-out visitor is still *reported* signed out (the
  landing/auth fork is unchanged); only graph/search/doc reads go live.

The invariant this rests on: **never grant anything private to `@guest`.** That
is an easy, auditable discipline ("treat `@guest`'s grant set as world-readable"),
where scope-limiting a token is impossible.

### 3. The grant fold, completed across the read surface

`recall` folded grants; the interactive surface did not. We extended the fold to
the reads the graph actually uses, keyed `owner/key` (recall's convention):

- **`edges` (`derived:false`)** — folds each granted owner's authored edges, kept
  only where **both** endpoints fall under the viewer's grant patterns (a
  public→private edge would leak the private key), re-prefixed `owner/key`.
- **`query`** — ranges over granted slices: each granted owner's matching facts
  are folded, re-ranked across the union (salience, or per-owner relevance for a
  `text` intent), then offset-paged. Bounded per partition.
- **`peek`** — resolves grant-reachable keys: an `owner/key` address (how folded
  reads key foreign facts → a graph node's body) OR a **bare** key a grant covers
  (the file-body fallback). Own-slice keys and ungranted keys are untouched.

Nodes (`query`), links (`edges`), and bodies (`peek`) now line up on `owner/key`,
so a viewer sees the **shared subgraph end to end**. Owner-viewing-own-slice is
behaviour-preserving (no foreign grants → no fold).

### 4. The default ground is a landing doc

The home page ground (nothing selected) renders a real **fact** — a landing doc —
in place of the hardcoded pitch/featured cards, for both signed-in and signed-out
visitors. Configurable via `_config/home-landing {key}` (default
`doc:docs/substrate`). `DocBody` gained a **public-markdown fallback**: it
assembles from `doc-block` membership when the reader can reach it (the authed
owner), else reads the PUBLIC `file/docs/<path>.md` source (the docs-sync mirror)
— so `@guest` reads the whole body even though `doc-block:` facts are not shared.
The home page is now a fact you edit in lit, not markup.

### 5. Reserved usernames

A username becomes a cell-subdomain segment and a share target, so `guest`,
`parc`, `public`, `admin`, `support`, … are barred at registration
(`services/auth/webauthn.ts` `isReservedUsername`) — lookalikes are an
impersonation surface and platform roles are claimed for platform use.

## Consequences

- **Multi-tenant public falls out for free** — `public` grants from *any* owner
  fold into `@guest`'s view, so "everyone's public docs/graph" works without
  touching IAM partitions (the tokenless cell read, walled to one partition,
  never could).
- **The layers compose, they don't compete** — tokenless SSR is the no-JS /
  crawlable / first-paint floor; the `@guest` token layers live interactivity on
  top; both enforce the same `_public/`/grant boundary.
- **The grant fold is now the read model, not a recall special-case** — any
  future user→user share surfaces in query/peek/edges, not just recall. This is
  also the first time the cross-partition grant machinery runs against a real
  second principal (`@guest`) rather than single-user (c15r).
- **A leaked `@guest` token is a non-event** — it reads only public-granted
  facts. Rate/cost abuse of a world-visible read key is a separate concern
  (mitigate with rate-limiting), never a data-safety one.

## The known gap (→ ADR-0092)

Semantic graph **positions** (`_home/embed2d`) do NOT reach `@guest`: they are
per-scope, keyed by **bare** fact keys, and computed over the **whole** slice
(public + private), so the coordMap would leak private key *names* if shared, and
its bare keys don't match a folded node's `owner/key`. Guest's graph therefore
falls back to connectivity (link-force) layout — coherent but not semantic. The
cross-slice public embedding/indexing problem is deferred to **ADR-0092**.

## Status of the invariant

**A credential is safe to expose iff its identity can only ever see public
content.** `@guest` satisfies it by holding only `public` grants; every folded
read re-checks grant coverage on every emitted key (both edge endpoints, every
query/peek result), so the boundary is enforced at the read, not trusted from the
token. The one operational rule that must hold: never share a private fact to
`@guest` (or to `public`).
