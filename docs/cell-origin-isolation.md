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

### 4.5 The token handoff (least privilege)

Once a cell can't read the shell's `localStorage`, it has no credential — by
design. It must receive a **cell-scoped, least-privilege** token, never the
shell's session:

- The shell mints, via `auth.mintToken`, a token narrowed to *that cell's*
  authority — its own tools (`cell:<owner>/<name>:*`) plus only the substrate
  scopes the cell needs — **explicitly excluding `platform:*`/admin**.
- Delivery options (cell never sees the shell token):
  1. **First-load handoff:** the shell opens/links the cell with a one-time code
     (or fragment) the cell exchanges, same as an OAuth code, landing a scoped
     token in the *cell's own* (now isolated) `localStorage`.
  2. **Broker via `postMessage`:** the cell runs as a cross-origin iframe; a
     hidden shell frame holds the session and answers scoped action requests —
     the cell holds nothing. (The stronger, Figma/Lightning-Locker model;
     heavier authoring contract.)
- The cell then calls `gateway` `/mcp` **cross-origin with its scoped bearer in
  the `Authorization` header** — which needs CORS on `/mcp` allowing the cell
  origins (preflight). The cookie is irrelevant to `/mcp` (bearer-only), so no
  CSRF surface is added.

## 5. Concrete changes against today's code

A punch list, smallest-blast-radius first:

1. **Containment now (no isolation yet):**
   - **Revert** `services/home/client/auth.ts` sharing `parc.session.tokens` —
     do not move the admin session into the cell-readable store (branch only,
     not deployed).
   - **Add the `Sec-Fetch-Dest: document` gate** to the cookie branch of
     `resolveHttpIdentity` (closes §1.2 on the shell origin).
   - Keep admin scope out of any cell-reachable store; consider step-up for
     `platform:*` rather than minting it into the web session at all.
2. **WebAuthn:** pin `expectedOrigin` to a shell-origin allowlist in
   `services/auth/webauthn.ts` (`originOf` → validated allowlist); keep
   `WEBAUTHN_RP_ID` / `rpIdOf` as-is (already subdomain-correct).
3. **Routing/infra:** wildcard alternate domain(s) + wildcard cert on the
   `ServiceRouter`; Host-header routing (CloudFront Function or the existing
   edge) to `dispatch`; pick the naming scheme (§4.2). Optionally adopt Route53.
4. **Handoff + CORS:** a `mintToken`-backed cell-scoped handoff (§4.5) and CORS
   on `/mcp` for cell origins. Update the kernel so a cell reads its *own*
   scoped token, not the shared one.
5. **Decommission the shared `localStorage` session for cells** once the handoff
   lands — the kernel's `parc.session.tokens` stops being cross-cell because each
   cell is now a separate origin with its own store.

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

> **Status (2026-06-13).** Containment §5.1 (1) and (2) landed on the branch: the
> home `parc.session.tokens` key-share was reverted (the admin token stays out of
> the cell-readable store; it never deployed), and the cookie branch of
> `resolveHttpIdentity` now requires `Sec-Fetch-Dest: document` — so the cookie is
> honoured only on a genuine top-level navigation, closing the §1.2 ambient-read
> (a cell's `fetch()`/`iframe` no longer rides it). The rest is design: the
> `localStorage` exposure (§1.1) — the kernel's origin-wide session — is the real
> driver, and only the subdomain-origin move (§4) plus the scoped-token handoff
> (§4.5) closes it. The cookie-borne SSR identity (`parc_session`, `HttpOnly`,
> host-only) shipped first and is the motivating context.
