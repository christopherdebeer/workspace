# ADR-0095 — The cell as miss handler: a public namespace whose cache misses are compute

- **Status:** Proposed 2026-08-05 — tier-1 CDK + control plane + the first
  consumer (`@c15r/drive`) built and tested; not yet deployed.
- **Depends on:** ADR-0042 (dynamic cells — the per-cell Lambda, table, and
  permission boundary), `docs/cell-storage-s3.md` (the shared code bucket, its
  prefix-scoped namespaces, and the **v2 direct-role S3 access** it describes as
  noted-but-unbuilt — this ADR builds it), ADR-0084 (the drive surface, the cell
  that motivated this), the `/@*` dispatch ingress and the cell-host distribution
  (`docs/cell-origin-isolation.md`).
- **Grounded in:** the drive cell's dependence on public Overpass mirrors,
  measured 2026-08-05 (below).

---

## Context (measured, not argued)

`@c15r/drive` streams OpenStreetMap vectors from public Overpass mirrors,
straight from the browser. Seven requests, the game's exact query at its exact
z16 tiles, to `overpass-api.de` inside one minute:

| tile | attempt | result |
|---|---|---|
| Manhattan | 1, 2 | HTTP 504 (8.0s, 8.2s) |
| Manhattan | 3 | **OK**, 1.9s, 163 ways |
| Chapman's Peak | 1, 2, 3 | HTTP 504 (8.7s, 8.7s, 8.4s) |
| Trollstigen | 1 | **OK**, 0.7s, 12 ways |

**2 of 7 succeeded. Mean latency 6.4s.** The second mirror
(`overpass.kumi.systems`) timed out at 40s having sent zero bytes. This is not
an unlucky minute: three separate test runs the same afternoon reported zero
roads loaded, and one screenshot needed four attempts.

The payload, once trimmed to what the client actually reads
(`{id, tags, geometry}` at 6dp — everything `renderWays` touches):

| tile | ways | raw | trimmed | gzip | brotli |
|---|---|---|---|---|---|
| Manhattan | 163 | 214 KB | 82 KB | 18 KB | **12 KB** |
| Cairo | 224 | 191 KB | 75 KB | 14 KB | **10 KB** |
| Trollstigen | 12 | 29 KB | 10 KB | 3 KB | **2 KB** |

So the thing we are re-fetching, unreliably, at 214 KB, is 12 KB of content that
changes on OSM's clock — weeks — and is identical for every player.

### Why the obvious fixes are not the fix

**A cell-side cache in DynamoDB** works and costs pennies, but every hit is a
Lambda invocation. **`s3://osm-pds`** — the Registry of Open Data mirror — is
not a query surface: `planet/planet-latest.orc` is a single **127.83 GB** object
with no spatial ordering, and OSM ways carry node *references*, not coordinates,
so a bbox filter returns way tags and node ids, never geometry. Resolving that
join is precisely what Overpass sells (`out geom`, the flag in our query). It is
a plausible *build-time* input for a pre-seed; it cannot be a runtime dependency.

**Cache headers alone do nothing here.** Every behaviour on both platform
distributions is `CachePolicy.CACHING_DISABLED`
(`platform/infra/service-router.ts`), so a `cache-control` header from a cell
reaches the browser's own cache and nothing else.

And the comparison that matters: the elevation tiles the same game fetches from
`s3://elevation-tiles-prod` have **never failed in any test**. Not because they
are S3, but because they are *static objects served from a CDN with no compute
in the path*. That is the property worth making available to every cell.

## Decision

**A tier-2 cell may declare a public namespace, and the cell itself is that
namespace's cache-miss handler.**

```
GET /@c15r/drive/~/osm/v1/16/37402/49926
      │
      ├─ CloudFront behaviour  /@*/~/*   (caching ON, no edge lambdas)
      │
      └─ OriginGroup
           ├─ primary:  S3, OAC, originPath /public     → HIT: CDN + S3, zero compute
           └─ fallback: dispatch Function URL            ← on 403/404 only
                  └─ the cell sees /~/osm/v1/16/x/y,
                     does the work, PUTs the object,
                     returns the body. Never invoked for that key again.
```

Five parts.

### 1. The `~/` segment reserves a cell's public namespace

`/@<owner>/<cell>/~/<path>` is the cell's public, cacheable read surface.
Everything under it is a static object; everything outside it behaves exactly as
today. `dispatch`'s router (`^/@([^/]+)/([^/]+)(/.*)?$`) already passes the
sub-path through untouched, so `~/` collides with nothing.

### 2. The S3 key is the URL path

`originPath` is per-origin, so the S3 primary receives `/public` + the URI and
the object key is **byte-identical to the request path**:

```
s3://<CodeBucket>/public/@c15r/drive/~/osm/v1/16/37402/49926
```

The fallback origin receives the URI *unmodified*, which is what dispatch
already routes on. **No CloudFront Function, no Lambda@Edge, no rewriting
anywhere.** This is the decision that makes the whole thing small; every design
that keys S3 by `cellId` instead needs an edge-side lookup the edge cannot do.

### 3. The boundary gains S3, scoped twice

`docs/cell-storage-s3.md` already describes this as v2 — "let a cell's *own*
role read/write its prefix directly at runtime… additive, same isolation shape
as the per-cell table grant". It is built here, with the same two-level
discipline the substrate read grant uses:

- the **permission boundary** caps every cell at `<CodeBucket>/public/@*/~/*`;
- the **cell template** renders an inline statement narrowed to that cell's own
  `public/@<owner>/<name>/~/*`.

A cell can therefore write only into its own public namespace, and no future
change to a cell's inline policy can widen that — the boundary is the cap.

### 4. Hits do not touch Lambda@Edge

The two existing edge functions serve the Function-URL auth path: one hashes
request bodies so OAC's SigV4 covers them, one un-mangles `WWW-Authenticate`.
A static read needs neither. The public behaviour omits both, so a cache hit is
one CloudFront request and one S3 GET — the terrarium property, exactly.

### 5. It is opt-in

`cells.create` / `cells.configureCell` take `publicNamespace: true`. Without it a
cell gets no S3 statement, and the behaviour simply finds no object and falls
through to a cell that will 404 — the status quo.

## What this is not

It is not a drive feature. It is a **read-through cache as a platform
primitive**: any cell wrapping something slow, flaky, rate-limited or expensive
gets a CDN-backed origin by declaring one flag and writing a handler for the
miss. `drive` is the first consumer and the proof, not the reason.

## The sharp edges, and what each costs if ignored

**Negative results must be written.** A genuinely empty tile — ocean, desert,
most of the planet — must store an empty-marker object. Miss this and every
empty tile is a permanent miss and therefore a permanent Lambda invocation:
the exact failure this design exists to prevent, arrived at from the other side.

**Failures must never be written, or cached.** An upstream 504 returns `503`
with `Retry-After` and writes *nothing*, and the behaviour sets 5xx error-caching
TTL to zero. Otherwise one bad minute poisons a tile for a week — worse than the
flakiness we started with, because it is now our flakiness and it persists.

**Versioned paths instead of invalidation.** `~/osm/v1/…`. Changing the stored
shape means `v2`, and every client and every edge moves together. There is no
invalidation call and no hunt for stale objects, which is the only invalidation
strategy that stays correct when the cache is this distributed.

**Behaviour precedence is declaration order, not specificity.** `/@*/~/*` must
be registered ahead of `/@*` or dispatch swallows it, and the failure is silent
— it simply works, slowly, forever. Asserted in a synth test.

**Origin failover is GET/HEAD/OPTIONS only.** This makes the primitive
deliberately read-only, which is the right constraint: a namespace whose misses
are compute should not also be a write surface.

**CloudFront's read grant on the bucket is bucket-wide; the reachable key space
is not.** CDK's OAC helper adds `s3:GetObject` for `cloudfront.amazonaws.com`
over the whole bucket (SourceArn-scoped to this distribution), which the code
zips also live in. Two things bound it: `originPath: /public` is *prepended* and
cannot be removed by a request URI, and the behaviour only matches URIs of the
shape `/@…/~/…`. So every key CloudFront can be made to ask for begins
`public/@…/~/`. Path traversal is not a mechanism here — S3 keys are opaque
strings, `..` is a literal character in a key, and CloudFront normalises the URI
before forwarding regardless.

**The miss handler must fail faster than the edge.** `ORIGIN_READ_TIMEOUT` is
60s; the handler caps its own upstream fetch well below that and returns rather
than holding the connection.

**Concurrent misses duplicate work.** Two clients missing the same key both
invoke and both PUT. Same bytes, last write wins, bounded by Lambda concurrency.
Not worth a lock.

## Consequences

- A cell's public namespace is genuinely public — served without auth, by S3,
  to anyone with the URL. This is a *read* surface for derived or already-public
  data; nothing private should be filled into it. The boundary makes it
  impossible to write
  outside your own prefix, not impossible to publish something you shouldn't.
- Cells become stateful in a second place (S3, alongside their table), so
  lifecycle is now a question: eviction is an S3 lifecycle rule per prefix, and
  teardown must empty the prefix alongside deleting the stack.
- The first request for a key is *slower* than today by one hop. Every
  subsequent one, from anyone, anywhere, is a CDN hit.
- `drive`'s CSP loses four third-party Overpass hosts for `'self'`, and its
  wire payload for a tile drops 214 KB → 12 KB.

## Open

1. **Owner-scoped writes.** Writes are cell-scoped here. An owner-mediated
   seeding path (fill `@c15r/drive`'s namespace from an offline job) is what a
   pre-seed of the curated drives would want, and is deliberately deferred.
2. **Pre-seeding from bulk OSM.** With this primitive in place, the curated start
   locations could be filled offline from a Geofabrik extract, making a famous
   drive independent of any third party at runtime. Bounded, and worth doing
   before missions depend on those locations.
3. **`stale-while-revalidate`.** Nothing refreshes a filled object today; a
   version bump is the only path. A background revalidation on read is the
   obvious next increment and is not needed yet — OSM moves in weeks.
