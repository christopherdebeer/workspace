# ADR-0096 — The declared vanity host: a cell's own domain, resolved at the edge

- **Status:** Proposed 2026-09-10 — designed, nothing built. Grounded in a live
  failure report and the measurements below.
- **Depends on:** `docs/cell-origin-isolation.md` (the cell distribution, the
  `<owner>-<name>` label convention, the scoped-token handoff — this ADR is the
  first thing to ask that convention for something it cannot give), ADR-0095
  (the public namespace, whose `/~/*` behaviour must travel with any new host or
  the bank goes cold), ADR-0084 (the drive surface, the first consumer).
- **Grounded in:** the DNS and TLS behaviour of `drive.parc.land`, measured
  2026-09-10 (below).

---

## Context (measured, not argued)

A CNAME was added at the registrar pointing `drive.parc.land` at the cell host
`c15r-drive.on.parc.land`. Chrome answers
`ERR_SSL_VERSION_OR_CIPHER_MISMATCH` — "uses an unsupported protocol". The
error names the wrong layer, and that is why this is worth writing down.

**DNS is entirely correct.** The chain resolves end to end:

| name | answer |
|---|---|
| `drive.parc.land` | CNAME → `c15r-drive.on.parc.land` |
| `c15r-drive.on.parc.land` | CNAME → `dyh164gtggz7b.cloudfront.net` |
| `dyh164gtggz7b.cloudfront.net` | A 3.162.140.{47, 57, 114, 119} |

**TLS is where it dies, and it dies before a certificate is ever offered.** Two
handshakes to the same CloudFront IP, differing only in SNI:

| SNI | result |
|---|---|
| `c15r-drive.on.parc.land` | `CN=*.on.parc.land`, SAN `DNS:*.on.parc.land` |
| `drive.parc.land` | **handshake_failure (alert 40)**, 7 bytes read, *no peer certificate available* |

CloudFront selects a distribution by the **SNI hostname**, not by the IP the
CNAME landed on. No distribution in any account claims `drive.parc.land` as an
alternate domain name, so there is nothing to select and the edge aborts the
handshake rather than presenting a certificate that would not match. Chrome has
no certificate to complain about, so it reports the only thing it can see: no
common protocol or cipher was agreed. **A cipher-mismatch error on a CloudFront
CNAME almost always means an unclaimed alternate domain name.** Nothing about
protocol versions or cipher suites is involved.

And the wildcard cannot be stretched to cover it. TLS wildcards match exactly
one label, so `*.on.parc.land` covers `c15r-drive.on.parc.land` and can never
cover `drive.parc.land` — a different depth under a different parent. The apex
distribution's certificate is `CN=parc.land` with SAN `parc.land, www.parc.land`
and does not cover it either.

### The certificate is the shallow half. The label convention is the deep half.

`docs/cell-origin-isolation.md` §4.2 chose `<owner>-<name>.on.parc.land` as one
DNS label encoding both owner and cell, precisely so one wildcard certificate
serves every cell for ever with no per-cell DNS. The bargain was: **the hostname
carries the cell's identity.** Nine places now cash that bargain in, each by
testing the `.on.parc.land` suffix and splitting the label on its first hyphen.
A vanity host carries no owner and no name in its label, so every one of them
fails — and only the first fails loudly:

| site | what it does with the label | what a vanity host does to it |
|---|---|---|
| `service-router.ts` `CELL_HOST_REWRITE_SRC` | host label → `/@owner/name` URI prefix | `drive.parc.land` → label `drive`, no hyphen, **no prefix prepended** — the request reaches `dispatch` with a bare `/`, which is not a cell |
| `service-router.ts` `CELL_APEX_REDIRECT_SRC` | `/@owner/name` → 302 to `owner-name.<cellDomain>` | still sends navigations to the canonical subdomain, so the vanity host is bypassed the moment anyone links through the apex |
| `kernel/client/main.ts` `cellAddress()` | owner/name from host label | returns `null` on the vanity host, falls through to a path match that is also absent — **the client does not know which cell it is** |
| `kernel/client/main.ts` `cellUrl()` | sibling links as `owner-name.<CELL_DOMAIN>` | every sibling link leaves the vanity origin |
| `kernel/client/main.ts` `onCellHost()` / `apiBase()` | suffix test decides whether to target the apex for `/oauth` and `/mcp` | reads *false*, so API calls go to `drive.parc.land` relative — where there is no `auth` and no `gateway` |
| `kernel/client/main.ts` session cookie write | suffix test gates the host-only `parc_session` write | not written; a cell that relies on it loses SSR identity |
| `auth/oauth.ts` `cellCeiling()` | suffix + split caps a minted token at `workspace:read/write` + `cell:<o>/<n>:*` | returns `null` — **the cap does not apply**, so the redirect is treated as a non-cell client and the scope ceiling that keeps `platform:*` out of a cell is silently not the cell ceiling |
| `auth/oauth.ts` offerable cell scope | same suffix + split | the cell scope is not offerable, so consent cannot mint it |
| `define-mcp-service.ts` `corsHeaders()` | reflects origins ending in `MCP_CORS_ORIGIN_SUFFIX` | no CORS headers — the cell cannot call the apex `/mcp` at all |

Two of these are security-relevant and neither is a crash: the `cellCeiling`
miss means a vanity host is not recognised as a cell origin at the token step,
and the WebAuthn `expectedOrigin` allowlist likewise has no opinion about a name
it has never been told. The rest are a cell that loads and then cannot find
itself. **The failure mode of the label convention is not an error, it is a cell
that half works**, which is the expensive kind.

Two things do keep working by luck and are worth knowing: `rpIdOf` collapses any
hostname ending `.parc.land` to the stable RP id, so **passkeys stay portable to
a vanity host under `parc.land`**; and `allowedOrigins` excludes it, so it
**cannot complete a ceremony** — which is the correct posture, arrived at for
free.

### Why the obvious fixes are not the fix

**An apex wildcard (`*.parc.land`) is not available.** Measured: `sync.parc.land`
resolves to `domains.val.run` / `in.saascustomdomains.com` — a third party's
service on the same registrable domain, and `www.parc.land` is the apex
distribution. §4.1 of the isolation doc already argued this: a wildcard
certificate at the apex would cover names this platform does not serve, and
future cell names could collide with somebody else's subdomain. The reasoning
has not changed and there is now a live example of what it would cover.

**A registrar-level redirect works and buys the wrong thing.** Namecheap can 301
`drive.parc.land` → `c15r-drive.on.parc.land` today, with no platform change.
That gives a memorable link and *not* a vanity origin: the address bar, every
share, and every subsequent request show the canonical host. If the ask is "a
short URL", take the redirect and stop here. This ADR exists because the ask is
"the cell lives at its own name".

**Serving the cell on both hosts is worse than choosing one.** An origin is a
storage partition. `drive` keeps its world cache, its rasters, its survey, marks
and docket in IndexedDB, and its scoped token in `localStorage`; two origins
means two of each, diverging silently, with the service worker precaching twice.
"Both hosts work" reads as a feature and is a bug with a long tail.

## Decision

**A cell may declare exactly one vanity host, which becomes that cell's single
canonical origin. The host→cell mapping is platform-stack configuration baked
into the edge at synth, because the certificate is deploy-time and nothing is
gained by making the mapping more dynamic than the certificate.**

That last clause is the whole design. The instinct is a runtime lookup — a
CloudFront KeyValueStore, or the cell registry consulted at the edge — so a
vanity host can be added without a deploy. It cannot: adding an alternate domain
name to a distribution requires a certificate that covers it, and re-issuing an
ACM certificate is a stack change with a manual DNS validation record behind it.
A dynamic map would sit behind a static gate and add a lookup, a failure mode
and a cache to something that changes on a human's clock.

Five parts.

### 1. The alias is a SAN on the cell certificate and an alias on the cell distribution

`CellCert` (`lib/platform-stack.ts`) gains `subjectAlternativeNames` — the
declared vanity hosts beside `*.<cellDomain>`; `CellDistribution` gains them in
`domainNames`. One certificate, one distribution, no new machinery. A separate
distribution per vanity host was considered and rejected: it multiplies the two
edge Lambdas and the viewer function per name, for isolation between hosts that
are all the same origin group serving the same `dispatch`.

### 2. The map is baked into the viewer function

`CELL_HOST_REWRITE_SRC` becomes a function of the alias table, emitting a
literal object at synth:

```
var ALIAS = { 'drive.parc.land': '/@c15r/drive' };
...
var pfx = ALIAS[host] || labelToPath(label);   // alias first, convention second
```

The label convention stays as the default for every cell that has not declared a
name, so nothing existing moves. The prepend keeps its idempotence guard — a
cell's assets reference `/@owner/name/app.js`, so the function must not
double-prefix.

### 3. A vanity host REPLACES the canonical subdomain; there is always exactly one origin per cell

`CELL_APEX_REDIRECT_SRC` learns the same table and redirects
`/@c15r/drive` navigations to `drive.parc.land`; the cell distribution's own
function redirects `c15r-drive.on.parc.land` navigations there too. One origin
per cell, at any moment, whichever way you arrive — which is what keeps §1's
storage-partition argument from becoming true, and keeps the isolation
property intact (a vanity host is still not the shell origin).

The redirects must agree on the canonical host or they loop. This is the one
place in the design where an inconsistent table is a hard outage rather than a
degradation, so both functions read the same synth-time source and a synth test
asserts the fixed point: canonical(alias) === alias.

### 4. The public namespace behaviour travels with the host

The `/~/*` behaviour and its S3-first origin group must exist on every host that
serves a cell, and the viewer function must map the vanity host to the same
`/@owner/name` prefix so the S3 key is byte-identical
(`public/@c15r/drive/~/…`). Since the behaviour is on the shared cell
distribution and the rewrite is the same function, this comes free — provided
the alias resolves. If it does not, every tile request on the vanity host is a
Lambda invocation and the bank never answers: ADR-0095's own failure mode,
reached from the other side, and invisible because it merely looks slow.

### 5. Every site that parses the host reads a fact instead — and the server owns it

The nine sites above are not nine fixes. Six of them are the client and the auth
service guessing at something the platform already knows for certain:
`CELL_OWNER` and `SERVICE_NAME` are on the cell's own Lambda
(`cell-template.ts`), and the registry holds the pair.

- **Client:** the cell's SSR injects its address, and `cellAddress()` reads that
  first, falling back to the label. `CELL_DOMAIN` (a hard-coded constant in
  `kernel/client/main.ts`) stops being the sole definition of "am I on a cell
  host"; `onCellHost()` becomes "did the server tell me I am a cell". This is a
  strict improvement independent of vanity hosts: the label was always a
  client-side guess at a server-side fact.
- **Auth:** `CELL_DOMAIN_SUFFIX` becomes a suffix *plus* an alias map
  (`CELL_ALIASES`), so `cellCeiling` and the offerable-scope resolution cap a
  vanity redirect exactly as they cap a canonical one.
- **MCP CORS:** `MCP_CORS_ORIGIN_SUFFIX` becomes a list of suffixes and exact
  origins. Reflecting an unlisted origin is the one change here that would widen
  a boundary, so it stays an explicit allowlist and never a pattern.
- **WebAuthn:** unchanged, deliberately. A vanity host under `parc.land` keeps
  passkeys portable via `rpIdOf`, and stays out of `allowedOrigins` so it cannot
  complete a ceremony. A vanity host on a *foreign* registrable domain breaks
  the RP suffix rule and is out of scope (see Open).

### Declaration lives on the platform stack, not the cell record

`publicNamespace` is a per-cell flag because it renders that cell's own stack. A
vanity host is a fact about platform singletons — one certificate, one
distribution, one edge function — so it is declared alongside
`PLATFORM_CELL_DOMAIN` (context/env, e.g.
`PLATFORM_CELL_ALIASES="drive.parc.land=c15r/drive"`) and mirrored onto the
registry record for the client's and discovery's benefit. Recording it in the
registry alone would be a lie: the registry cannot issue a certificate.

## The sharp edges, and what each costs if ignored

**An alternate domain name is globally unique across all of CloudFront.** No two
distributions in any account may claim `drive.parc.land`. So moving a vanity
host between distributions is a remove-deploy-add-deploy dance, not a swap, and
a half-finished migration leaves the name claimed by the distribution that is no
longer serving it — reproducing exactly the handshake failure this ADR started
from, with a much more confusing cause.

**The certificate re-issues, and the deploy waits on a human.** Adding a SAN
replaces the certificate; DNS is external (Namecheap, no Route53), so ACM
publishes a new validation CNAME and the stack blocks until it is added by hand.
Queue the record before the deploy, exactly as `docs/cell-origin-isolation.md`
notes for the original wildcard.

**Changing a cell's canonical origin abandons its stored state.** Moving `drive`
from `c15r-drive.on.parc.land` to `drive.parc.land` leaves every existing
player's IndexedDB — world cache, rasters, survey, marks, docket — and their
scoped token behind on the old origin. The cache refills; the survey does not.
Either accept the loss, announce it, or export/import across the hop before
flipping. A cell with meaningful local state should take its vanity name *early*
or not at all.

**A vanity host must not shadow a cell label, and the check belongs at synth.**
`drive.parc.land` is unambiguous; a declared alias whose own first label happens
to parse as `<owner>-<name>` under the cell domain, or two aliases pointing at
one cell, are the collisions worth failing the build over rather than debugging
at the edge.

**The alias table must be total in the function, not just in the certificate.** A
name on the certificate and the distribution but absent from the viewer map
handshakes fine and then serves whatever `dispatch` does with a bare `/` — a
working TLS connection to the wrong thing, which is harder to diagnose than a
refused one.

**The service worker and CSP follow the origin.** `web/sw.js` precaches by path
and is origin-relative, so it is fine; but a cell that names hosts in its CSP,
or whose manifest carries absolute URLs, needs the new origin. Verify by loading
the vanity host with the network throttled, not by reading the diff.

**Nothing here is testable from a synth test alone.** The certificate, the SNI
selection and the redirect fixed point are live-edge behaviour. The check is the
same handshake this ADR opened with — `openssl s_client -servername
drive.parc.land` must present a certificate whose SAN list contains that exact
name — plus a `curl -I` on a navigation to confirm which host is canonical.

## Consequences

- A cell can be a product with its own name, which is the point:
  `drive.parc.land` rather than `c15r-drive.on.parc.land`. The `<owner>-<name>`
  host stops being the address a player sees and becomes the internal one.
- The label convention gains an exception, and exceptions cost. Nine sites go
  from "parse the host" to "ask for the fact", which is better code and more of
  it, and any *tenth* site added later must be written the new way or it
  reintroduces the half-working failure.
- Vanity hosts are deploy-gated and manually validated, so they are a
  deliberate, low-frequency act — one per cell that has earned one, not a
  self-service field. That is a feature at this scale and a bottleneck later.
- Origin isolation is unchanged: a vanity host is still not the shell origin, so
  §1.1 of the isolation doc stays closed. The `parc.land` registrable domain is
  still shared, so cookie scope and RP ID remain enforced rather than structural
  — exactly as they are for `*.on.parc.land`.
- The cost is one certificate re-issue per new name and nothing recurring: no
  per-cell DNS, no per-cell distribution, no edge lookup on the hot path.

## Open

1. **A foreign registrable domain** (`somecell.com`). Breaks passkey portability
   via the RP suffix rule, the CORS suffix, and the cookie relationship all at
   once — it is the "separate registrable domain" of the isolation doc §6 arriving
   by accident rather than by design. Deliberately out of scope; if it is ever
   wanted, it wants §6's full cross-site handoff, not an extra SAN.
2. **Self-service vanity hosts.** Would need automated DNS (Route53 or a
   registrar API) to escape the manual validation record, and a claim/verify flow
   so one owner cannot name another's cell. The wildcard was chosen precisely so
   this machinery was never needed; adding it for vanity names is a large step
   and should be justified by more than one cell.
3. **State migration across an origin hop.** No mechanism exists to carry a
   cell's IndexedDB or scoped token from one origin to another. A one-shot
   export/import through the apex would be the honest fix and is unbuilt; until
   then, "take the name early" is the whole strategy.
4. **The apex `/@owner/name` path as a permanent alias.** It currently redirects
   navigations and passes sub-resources through. With a vanity host in play there
   are three ways to name one cell, and it is worth deciding whether the apex path
   should eventually 301 rather than 302 — i.e. whether it is a legacy address or
   a supported one.
