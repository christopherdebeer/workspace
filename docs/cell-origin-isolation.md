# Cell origin isolation — making the browser boundary the trust boundary

> A foundations design. Today the trusted platform and untrusted, user-authored
> cells share **one web origin** (`parc.land`), so the browser cannot isolate
> them: any cell's frontend can read the session token out of `localStorage` and
> impersonate the signed-in user — with whatever authority they hold, up to
> `platform:*`. This doc states the problem precisely against what is actually
> built, then designs the fix: per-(user|cell) **subdomain origins**, least-
> privilege **per-cell tokens**, and the handful of concrete code changes that
> get us there. It cross-checks every claim against the current implementation.

## 1. The vulnerability

The web's only hard security boundary is the **origin** (scheme + host + port).
Everything on `parc.land` — the trusted shell (`home`, `gateway`, `auth`,
`workspace`) **and** every tier-2 user cell at `/@<owner>/<name>` — runs on that
one origin. Mutually-distrusting code therefore shares a security context. Two
exposure surfaces follow:

1. **`localStorage` token theft — catastrophic.** The kernel deliberately shares
   the session under one origin-wide key (`cells/kernel/client/main.ts`:
   `NS = 'parc.session'`, `K.tokens = 'parc.session.tokens'`). `localStorage` is
   per-origin and readable by *any* script on `parc.land`. A user cell is
   user-authored code running on `parc.land`, so its bundle can
   `localStorage.getItem('parc.session.tokens')`, read the raw bearer, and POST
   it anywhere. Whoever you signed in as, the cell now is. This is total
   impersonation; admin scope merely makes it unbounded. Handing a cell your
   *whole* user token is a least-privilege violation regardless of scope.

2. **Ambient cookie authority — a smaller, read-only leak.** The `parc_session`
   cookie (`services/auth/oauth.ts`) is `HttpOnly`, so JS cannot read it (no
   token theft there) — but the browser auto-attaches it. A malicious cell can
   `fetch('/@you/lit?doc=private', { credentials: 'include' })`; `dispatch`
   resolves *you* from the cookie (`platform/runtime/define-service.ts`
   `resolveHttpIdentity`), the target cell owner-renders your private content,
   and the same-origin response is readable by the attacking cell. A
   confused-deputy *read*, no token required.

Both reduce to the same root: **untrusted code shares an origin with the
privileged session.** No amount of token scoping or cookie hardening fixes that
while the origin is shared — #1 is a direct `localStorage` read.

## 2. What is actually built today (cross-check)

- **One origin, one distribution.** `lib/platform-stack.ts` builds a single
  `ServiceRouter` (`platform/infra/service-router.ts`) — one CloudFront
  distribution. Tier-1 cells (`home`, `auth`, `workspace`, `gateway`, `dispatch`)
  are path behaviours; tier-2 dynamic cells are reached at `/@<owner>/<name>`,
  parsed by `dispatch` (`services/dispatch/service.ts`) and proxied through
  `cells.call` (forge holds the invoke permission). The browser sees exactly one
  host for everything.
- **DNS / cert.** Custom domain is optional (`domainNames` + an ACM cert, either
  `certificateArn` or a CDK-managed `CertificateValidation.fromDns()`). DNS is
  **external (Namecheap)** today — ACM validation CNAMEs are added by hand
  (comment at `platform-stack.ts:224`). There is **no Route53** in the stack.
- **Function URLs are OAC-locked.** Each cell origin is a Lambda Function URL
  with `AWS_IAM` auth, reachable only via CloudFront OAC SigV4
  (`http-service-cell.ts`; `service-router.ts` `FunctionUrlOriginAccessControl`).
  An origin-request Lambda@Edge (`ORIGIN_SIGNER_SRC`) signs the body and
  preserves the viewer bearer as `x-forwarded-authorization` (OAC overwrites
  `Authorization`). `originRequestPolicy: ALL_VIEWER_EXCEPT_HOST_HEADER` forwards
  all viewer headers (incl. `Cookie`).
- **Identity propagation.** `resolveHttpIdentity` validates a bearer (or, for
  `dispatch` GET/HEAD only, the `parc_session` cookie) via `auth.validateToken`;
  `callCell` (`services/cells/service.ts:476`) forwards the result to the cell as
  `x-cell-caller` — a validated *identity string*, never the token. Cookie is
  **host-only** (no `Domain`; `Path=/`), `SameSite=Lax`, `HttpOnly`, `Secure`.
- **WebAuthn RP ID already tolerates subdomains.** `WEBAUTHN_RP_ID` is set to the
  public hostname (`platform-stack.ts:253`, `new URL(publicBaseUrl).hostname`).
  `rpIdOf` (`services/auth/webauthn.ts:30`) returns the stable RP id when the
  request host equals it **or ends with `.<rpId>`** — so a passkey registered at
  `parc.land` already resolves for `c15r-lit.on.parc.land`. **Passkeys are portable
  across subdomains for free.**
- **…but `expectedOrigin` is not pinned.** `originOf(req)` (`webauthn.ts:25`)
  returns the *request's own* `protocol//host`, and registration/auth pass it as
  `expectedOrigin`. Safe only because there is one origin today; in a subdomain
  world this would **accept a ceremony initiated from a cell subdomain**. This is
  the one concrete WebAuthn change the design requires (see §5).
- **Least-privilege primitives exist, delivery does not.** `auth.mintToken`
  narrows to `requested ∩ minter's scopes` (a ceiling, never widening;
  `docs/scope-grants.md`), and per-cell grants exist
  (`cell:<owner>/<name>:<tool>`). What is missing is a way to hand a cell a
  *narrow* token without other cells reading it — which needs isolation first.

## 3. The principle

**The credential's blast radius must equal the trust boundary, and the only
browser tool for that is the origin.** Trusted shell and untrusted cells must be
**different origins**. Everything else (scoped tokens, `HttpOnly`, `Sec-Fetch`
gating) is defence-in-depth that a same-origin `localStorage` read defeats.

## 4. The design: subdomain origins

Give each cell — or each user — its own host under `parc.land`, so cell code
runs on an origin that **cannot read the shell's `localStorage` or cookie**.

### 4.1 Routing — CloudFront stays; no DNS-to-Function-URL

Isolation comes from the **hostname the browser sees**, not the backend path, so
the backend barely changes:

- Keep the **single CloudFront distribution** as ingress (or add a second one for
  the cell namespace — see below). Add a **wildcard alternate domain name** with a
  wildcard ACM cert, and route by **Host header** (a CloudFront Function, or
  extend the existing origin Lambda@Edge) → the same `dispatch` → `cells.call` →
  Function URL path. Cell Function URLs stay OAC-locked exactly as now.
- **Do not point DNS at Function URLs.** Lambda Function URLs don't support
  custom domains; you'd front them with a CDN anyway and lose OAC + the edge
  layer. So `<username>-<cellname>.on.parc.land` resolves to **CloudFront**, which
  host-routes (by registry lookup, §4.2) to the cell — the gateway/router model
  is unchanged.
- **One wildcard, no per-cell DNS — ever.** A single wildcard record covers every
  cell host, so cells come and go with **zero** DNS or cert changes — you never
  add subdomains per cell, manually or programmatically. On Namecheap (the current
  registrar; **Route53 is not required**) it is two records, once:
  `*.on.parc.land CNAME <distribution>.cloudfront.net` (routing) and
  `_<acm>.on.parc.land CNAME <acm-value>` (one-time cert validation). Route53's
  only value would be CDK auto-managing records; with a wildcard there is nothing
  ongoing to manage, so it earns no place here.
- **Put cells under a dedicated namespace label (`*.on.parc.land`), not the apex
  `*.parc.land`.** parc.land already hosts unrelated subdomains for other
  projects. A namespace scopes the wildcard — DNS *and* cert — to `on.parc.land`,
  leaving those untouched. (An apex wildcard wouldn't break *explicit* existing
  records — explicit beats wildcard in DNS — but the cert would then cover them,
  and future names could collide.) It costs nothing security-wise: `parc.land`
  stays a registrable suffix of `c15r-lit.on.parc.land` (passkeys portable, §4.4),
  the host-only cookie still isn't sent to the deeper host (§4.3), and each cell
  host is still a distinct origin — the reasoning holds at any depth.
- **Distribution choice:** either a **SAN cert** (`parc.land` + `*.on.parc.land`)
  on the existing distribution with host-routing, or a **separate distribution**
  for `*.on.parc.land` so the existing apex setup is untouched. The separate
  distribution is the lower-risk rollout.

### 4.2 Naming & the wildcard-cert constraint

ACM/TLS wildcards match **one label only** — `*.on.parc.land` covers
`foo.on.parc.land` but **not** `foo.bar.on.parc.land` (two labels under `on`). The
cell-identifying part must therefore stay a **single label** to live under one
wildcard cert.

**Recommended: `<username>-<cellname>.on.parc.land`** — one label (under the `on`
namespace, §4.1) encoding both owner and cell (e.g. `c15r-lit.on.parc.land`,
`emily-regwatch.on.parc.land`). It gives **per-cell** isolation (every cell its
own origin), stays under a single `*.on.parc.land` cert, is human-readable, and is
**collision-free** because `(username, cellname)` is already unique in the cell
registry.

> **The bargain, and its bill (ADR-0096).** "The hostname carries the cell's
> identity" is what buys one wildcard for ever — and **nine** sites now cash it
> in by testing the `.on.parc.land` suffix and splitting the label on its first
> hyphen (the two edge functions, four kernel-client helpers, two `oauth.ts`
> paths, and `/mcp` CORS). A host that does *not* encode owner and name — a
> vanity domain like `drive.parc.land` — fails all nine, and only the first fails
> loudly; the rest yield a cell that loads and cannot find itself. ADR-0096
> replaces the guess with a fact the server already holds (`CELL_OWNER` /
> `SERVICE_NAME`). Any *tenth* consumer should read the fact, not the label.

| Scheme | Granularity | Cert |
| --- | --- | --- |
| **`<username>-<cellname>.on.parc.land`** (recommended) | **per cell**, readable, collision-free | one `*.on.parc.land` |
| `<cellid>.on.parc.land` | per cell, opaque | one `*.on.parc.land` |
| `<user>.on.parc.land` | per user (a user's own cells share an origin) | one `*.on.parc.land` |
| `<cellname>.<user>.on.parc.land` | per cell, pretty hierarchy | **per-user** `*.<user>.on.parc.land` cert each (provisioned on signup) — more machinery, SNI limits |

Two details for the recommended scheme:

- **Don't parse the label — look it up.** A single `-` is legal inside both
  usernames and cell slugs, so splitting `a-b-c` into owner/name is ambiguous.
  Avoid parsing entirely: at create time register the full label
  `<username>-<cellname> → cellId` in the registry (uniqueness enforced there),
  and have Host-based routing resolve the label to a cell by **lookup**. (Or
  reserve a `--` separator and forbid `--` in names; lookup is cleaner and also
  lets a host be aliased/renamed without re-parsing.)
- **DNS label limits:** ≤ 63 chars, `[a-z0-9-]`, no leading/trailing hyphen — so
  slugify + length-bound `username-cellname`, the same discipline cell slugs
  already use. The combined label must satisfy this even when both parts are long.

### 4.3 Cookies — already correct, plus one gate

- The `parc_session` cookie is **host-only** (no `Domain`), so it is sent only to
  the exact host that set it. On the shell origin it **never reaches cell
  subdomains**. No change needed — but the rule must be preserved: never add a
  `Domain=.parc.land`.
- Close the §1.2 ambient-read on the shell origin by honouring cookie identity
  only for genuine top-level navigations: gate `resolveHttpIdentity`'s cookie
  path on **`Sec-Fetch-Dest: document`** (and `Sec-Fetch-Mode: navigate`). A
  cell's `fetch()` is `Sec-Fetch-Dest: empty`; an `<iframe>` is `iframe`; neither
  is honoured. A top-level navigation can't be both triggered and read by the
  cell (it unloads the cell). These headers are browser-set and unforgeable from
  JS; treat their absence as non-navigation (fail closed).

### 4.4 Passkeys — keep RP ID `parc.land`, pin `expectedOrigin`

- **RP ID stays `parc.land`.** Per WebAuthn, a credential is usable by any origin
  whose domain has the RP ID as a registrable suffix — so `parc.land` passkeys
  work on `parc.land` and every `*.on.parc.land` cell host (`parc.land` is a
  registrable suffix of `c15r-lit.on.parc.land`). `rpIdOf` already collapses such
  hosts to the stable id (§2), so **sign-in keeps working with no passkey
  changes.**
- **Pin `expectedOrigin` to a shell allowlist.** Today `originOf(req)` accepts
  the request's own origin, so a cell subdomain *could* complete a ceremony.
  Change WebAuthn verification to accept `expectedOrigin ∈ { shell origins }`
  (e.g. `https://parc.land`, `https://app.parc.land`) and reject cell subdomains.
  Combined with the fact that **cells don't run the auth flow at all** (they get
  a token by handoff, §4.5), this means a malicious cell subdomain cannot use
  your passkeys even though it technically shares the registrable domain.
- This is why a **separate registrable domain is *not* required** for passkeys:
  the RP suffix rule keeps them portable, and the server-side origin allowlist
  keeps cells out. A separate domain (§6) buys *structural* site isolation
  instead of *enforced*, at the cost of breaking that seamless sharing.

### 4.5 The token handoff — a narrow, *declared* owner-scoped grant

Once a cell can't read the shell's `localStorage`, it has no credential by
design. It must receive a **cell-scoped, least-privilege** token, never the
shell's session. The precedent is `sync` (`christopherdebeer/sync.parc.land`),
whose model we adopt almost verbatim:

- In sync, an agent embodying a room is minted exactly
  `rooms:<room>:agent:<id>:write` (`agents.ts:60`) — *one* room, bound to *one*
  identity, write only. Minting is subsumption-checked (`scopeSubsumes`,
  `tokens.ts`): a token can never exceed its minter's scope, and the user must
  actually hold access to the room. And writes are bounded *again* by declared
  actions, whose `writes[]` name specific `(scope,key)` targets. "The
  declaration is the commitment."

We already have every piece — including, from this session, the cell's **type
declaration** (`types.json` → `CellRecord.types`), which is our analogue of
sync's declared actions. So the per-cell token's scope is **derived, not
hand-designed**:

> **scope(cell, user) = declared(cell) ∩ granted(owner→cell) ∩ scope(user)**

- **declared(cell)** — the write-back region the cell *declares* it manages,
  plus its own tools (`cell:<owner>/<name>:*`). Note a *type name* is not a *key
  prefix*: lit's `doc` type spans `doc:` **and** `blk:` keys. So the cell must
  declare its write-back **key prefixes explicitly** (a `writes: ["doc:", "blk:"]`
  field on `types.json` / the cell manifest — sync's "declared actions name their
  `(scope,key)`"), which expand to `workspace:<owner>:<prefix>:write`. Never
  `workspace:<owner>:*`, never `platform:*`. *(New declaration field — the one
  piece §6's handoff adds.)*
- **granted(owner→cell)** — what the owner has actually granted that cell
  (`cells.grant` / `workspace.share`); the owner stays in control.
- **scope(user)** — the visiting principal's own ceiling. `auth.mintToken`
  already computes `requested ∩ minter.scopes`, so the meet is enforced for free
  and can never escalate (sync's `scopeSubsumes`).

So when **c15r** views their own `c15r-lit`, the cell gets `workspace:c15r:doc:*`
+ `blk:*` write-back (attributed via `@c15r/lit` provenance) and nothing else.
When **emily** (granted) views it, the token is *emily's* identity narrowed to
what c15r granted emily-through-lit. No cell ever holds the owner's whole slice.

**Delivery (cell never sees the shell token):**
1. **First-load handoff** *(recommended, reuses the kernel OAuth flow):* the cell,
   on its own origin, runs the kernel's existing PKCE flow against the apex
   `auth` cell, *requesting the derived cell scope* (it knows `owner`/`name` from
   its host, §4.1). Consent/mint narrows to the meet above; the scoped token
   lands in the **cell's own** (origin-isolated) `localStorage`. RP ID `parc.land`
   keeps passkeys working (§4.4); for the owner's own cells this can be silent
   (no re-consent) since it only ever narrows.
2. **Broker via `postMessage`** *(stronger, heavier):* the cell is a cross-origin
   iframe; a hidden shell frame holds the session and answers scoped requests —
   the cell holds nothing. Figma/Lightning-Locker model; defer unless needed.

**Cross-origin `/mcp`:** the cell calls the apex `gateway` `/mcp` with its scoped
bearer in `Authorization` (not the cookie — `/mcp` is bearer-only, so no CSRF).
This needs **CORS on `/mcp`** allowing the `*.on.parc.land` origins (preflight +
`Access-Control-Allow-Origin`/`-Headers`). The kernel's `read`/`act` base URL
must point at the apex (`https://parc.land/mcp`) when running on a cell host.

### 4.6 The same primitive powers *autonomous* write-back

This is not only the interactive-cell handoff. A long-lived narrow owner-scoped
token is exactly how a cell or agent writes back **programmatically** — a
collector, a scheduled job, a background agent — into a bounded region of the
owner's slice, attributed and revocable, holding nothing more. (sync's agents
*are* this.) So "a cell given a grant to a narrow scope of the owner, for
programmatic write-back" is the general capability; subdomain isolation is one
consumer, autonomous agents another.

## 5. Concrete changes against today's code

A punch list, smallest-blast-radius first. **(1)–(3) are shipped + deployed;
(4)–(7) are the remaining arc, fully specified below.**

1. ✅ **Containment** — reverted the home `parc.session.tokens` key-share; added
   the `Sec-Fetch-Dest: document` gate to `resolveHttpIdentity` (closes §1.2).
2. ✅ **WebAuthn `expectedOrigin` pin** (`services/auth/webauthn.ts`
   `allowedOrigins`) + hyphen-free usernames (`^[a-z0-9]+$`) so `<owner>` is a
   safe single DNS label.
3. ✅ **Routing/infra** — gated `*.on.parc.land` cell distribution + DNS-validated
   wildcard cert (`ServiceRouter`, `PLATFORM_CELL_DOMAIN`); viewer-request
   function rewrites `<owner>-<name>.on.parc.land` → `/@<owner>/<name>` for
   `dispatch`. Deployed; `c15r-lit.on.parc.land` SSRs.
4. ✅ **Cell client: owner/name from host** (`cells/kernel/client/main.ts`).
   `cellAddress()` returns `{owner, name}` from `location.host` on a cell host,
   else from the `/@owner/cell` path; `apiBase()` targets the **apex**
   (`https://parc.land`) when on a cell host. `cellUrl(owner, name)` resolves
   sibling-cell links origin-aware. lit/canvas/input consume these.
5. ✅ **CORS on `/mcp`** (`platform/runtime/define-mcp-service.ts`): reflects
   origins ending in `MCP_CORS_ORIGIN_SUFFIX` (`.on.parc.land`) — preflight
   `OPTIONS` + `Access-Control-Allow-Origin`/`-Headers`/`-Methods`. Bearer in the
   header, no credentials mode. CORS also added to `/oauth/{register,token}`.
6. ✅ **Scoped-token handoff, Model A** (§4.5/§4.6): the kernel runs PKCE against
   the apex `auth` from the cell origin; `services/auth/oauth.ts` `cellCeiling()`
   caps the minted scope to `workspace:read/write` + `cell:<owner>/<name>:*` when
   the `redirect_uri` is a cell host — so a cell can **never** receive admin /
   `platform:*`. The cell stores that capped token in its **own** origin
   `localStorage`. (Per-key-prefix write-narrowing is the deferred v2; the cell
   acts AS the user, scope-capped — cell-as-principal is later.)
7. ✅ **Cutover** (`platform/infra/service-router.ts` `CELL_APEX_REDIRECT_SRC`):
   the apex `/@owner/cell` behaviour **302-redirects navigations** (document /
   iframe / frame) to `<owner>-<name>.on.parc.land`, so a cell's interactive page
   only ever runs on its own origin; per-origin `localStorage` then isolates the
   token automatically (the shared `parc.session.tokens` key is harmless once it
   lives in a distinct origin). Sub-resources and non-browser requests pass
   through unchanged. **This closes §1.1.**

## 6. When you'd want a separate registrable domain

Subdomains isolate the **origin** (`localStorage`, DOM) — which kills the
catastrophic §1.1 hole — but share the **site** (registrable domain). Two things
stay *enforced rather than structural*: cookie scope (host-only, §4.3) and RP ID
(`expectedOrigin` allowlist, §4.4). A separate registrable domain
(`parc-usercontent.land`, the githubusercontent pattern) makes both structural —
cells physically can't receive `.parc.land` cookies or assert `parc.land`'s RP
ID. The cost: the shell↔cell relationship becomes fully cross-site, so *all*
capability must pass through the explicit handoff/broker (§4.5) with nothing
shared implicitly. Treat it as later hardening if the "malicious cell prompts
WebAuthn" residual (already mitigated server-side) ever justifies it.

## 7. Threat model after the change

| Attack | Today | After subdomains + handoff |
| --- | --- | --- |
| Cell reads shell session token from `localStorage` | **Full impersonation** | **Blocked** — different origin, can't read shell storage |
| Cell rides ambient cookie for authed reads | Possible (read-only) | **Blocked** — cookie host-only (not on cell origin) + `Sec-Fetch` gate on shell |
| Cell gets the user's *full*/admin authority | Yes (shared token) | **No** — cell holds only its own least-privilege token |
| Cell prompts WebAuthn as the user | Would be accepted (`expectedOrigin` = request host) | **Rejected** — `expectedOrigin` pinned to shell; cells don't run auth |
| Compromise of one cell | Reaches the shared session | Bounded to that cell's origin + its own scoped token |

## 8. Sequencing

1. **Containment** (§5.1) — revert home key-share; `Sec-Fetch` gate. Hours.
2. **WebAuthn `expectedOrigin` pin** (§5.2). Small, do before any subdomain.
3. **Subdomain routing + wildcard cert** (§5.3) — pick naming; CloudFront +
   (optional) Route53.
4. **Scoped handoff + CORS + kernel per-cell token** (§5.4) — the substantive
   work; this is where least privilege is actually enforced.
5. **Retire the shared `localStorage` session for cells** (§5.5).

Each step is independently shippable; (1) and (2) reduce live risk immediately
without waiting on the origin move, and (3) can land (cells served from
subdomains, still on the shared session) before (4) without regressing — though
the security win only completes once (4) removes the shared token.

> **Status (2026-06-14).** Containment §5.1 (1)/(2) and the infra for §5.2/§5.3
> have landed on the branch (not yet deployed):
> - **§5.1 (1)** home `parc.session.tokens` key-share reverted (admin token stays
>   out of the cell-readable store; it never deployed).
> - **§5.1 (2)** the cookie branch of `resolveHttpIdentity` now requires
>   `Sec-Fetch-Dest: document` — honoured only on a genuine top-level navigation,
>   closing the §1.2 ambient-read (`fetch()`/`iframe` no longer ride it).
> - **§5.2** WebAuthn `expectedOrigin` is pinned to a shell allowlist
>   (`PUBLIC_BASE_URL` + `WEBAUTHN_EXPECTED_ORIGINS`), falling back to the request
>   origin only when unconfigured — so a cell subdomain can't complete a ceremony.
> - **§5.3** `ServiceRouter` gained an additive, gated cell distribution
>   (`PLATFORM_CELL_DOMAIN`): a `*.<cellDomain>` DNS-validated cert + a second
>   CloudFront distribution whose viewer-request function rewrites
>   `<owner>-<name>.<cellDomain>` → `/@<owner>/<name>` for `dispatch` (no backend
>   change). Unset ⇒ nothing changes; synth confirms zero new resources.
>
> **Resolved:** the host→path rewrite splits the label on the first hyphen, so
> registration now enforces **hyphen-free usernames** (`^[a-z0-9]+$`).
>
> **Deployed (2026-06-14).** `PLATFORM_CELL_DOMAIN=on.parc.land` is live:
> `*.on.parc.land` cert issued, the cell distribution serves, and
> `https://c15r-lit.on.parc.land/` returns lit's SSR — the **origin boundary is
> real**. What's served there is anonymous-only until the handoff (§5.6).
>
> **Design complete (the arc).** §4.5/§4.6 specify the per-cell token model,
> adopted from `sync` (`agents.ts` mints `rooms:<r>:agent:<id>:write`,
> subsumption-checked; declared actions bound writes): a cell's token is
> **derived** — `declared(cell, via types.json) ∩ granted(owner) ∩ scope(user)`,
> met by `mintToken` — never hand-designed, never the owner's whole slice.
>
> **Arc complete (2026-06-14).** §5 (4)–(7) all shipped: `cellAddress()`/
> `apiBase()`/`cellUrl()` (owner-from-host), `/mcp` + `/oauth` CORS for
> `*.on.parc.land`, the Model-A scoped-token handoff (`oauth.ts` `cellCeiling`
> caps the minted scope so a cell can never get admin), and the apex→subdomain
> **redirect** (`service-router.ts` `CELL_APEX_REDIRECT_SRC`) that bounces cell
> navigations off the apex origin. **§1.1 is closed**: a cell's interactive page
> runs only on its own origin and cannot read the shell's `localStorage`. Residual
> hardening (a separate registrable domain, §6; per-key-prefix write-narrowing,
> §4.5 v2) stays optional.
