# Sign-in without leaving the page

Two asks about platform auth, explored together because the second one makes
the first one cheap:

1. Run the authorize/consent flow as an in-site modal or sheet instead of a
   full-page redirect to `/oauth/authorize`.
2. Simplify the grant a cell asks for when all it wants is "who are you".

Status: (2) is built, (1) is still exploration. Most of (2) already existed
server-side; the gaps were two small ones, noted below.

## How sign-in works today

A cell calls `login()` from the kernel (`cells/kernel/client/main.ts:142`):

- register a DCR client once per origin, cache the `client_id`
- generate a PKCE verifier + state into `sessionStorage`
- stash `location.href` as the return URL
- `location.assign('/oauth/authorize?…')`

parc.land then serves a React SPA (`services/auth/client/main.tsx`) that runs
the passkey ceremony, fetches `/auth/grantable` for the scope picker, and
POSTs `/oauth/consent`. That returns `{ redirect }` as JSON and the SPA does
`location.href = redirect`. Back on the cell, `completeLoginIfReturning()`
exchanges the code at `/oauth/token` and rewrites the URL.

For shelved that's four full page loads to answer "who are you", and the app
state is rebuilt from scratch on the way back.

The useful thing about the current shape: every step is already a JSON API.
`/auth/grantable` and `/oauth/consent` take a `sessionId` and return data, not
HTML. The redirect is the last 5% of the flow, not the mechanism.

## Part 1 — the modal

Three shapes, all preserving PKCE and the passkey ceremony.

### A. Popup + postMessage

`window.open('/oauth/authorize?…&response_mode=web_message')`, and the consent
SPA, when it detects `window.opener`, posts `{ code, state }` back instead of
navigating. The kernel resolves a pending promise and exchanges the code.

- Works from any origin, apex or cell host, no CORS.
- Passkeys work unmodified: the popup is a top-level browsing context on
  parc.land.
- The address bar stays visible, so the user can see who is asking. That's the
  property the redirect buys and the reason I'd not drop it lightly.
- Not a sheet. On iOS Safari a popup is a new tab, which is worse than the
  redirect on the tenet that matters most here (mobile first).

### B. Cross-origin iframe inside a cell-drawn sheet

The cell draws the sheet chrome and animation; parc.land draws the actual
consent content inside `<iframe src="/oauth/authorize?…&response_mode=web_message">`.
Result comes back over `postMessage`.

- Feels native on mobile. The cell owns the sheet, so it matches the app.
- Genuinely isolated for host-isolated cells (`c15r-shelved.on.parc.land`
  framing `parc.land`): the cell cannot read the iframe or the session.
- Passkey sign-in needs `allow="publickey-credentials-get"` on the iframe.
  Widely supported.
- Passkey *registration* needs `publickey-credentials-create`, which is newer
  (Chrome 123+, Safari 18). Registration should fall back to the redirect
  rather than depend on it.
- On the apex the iframe is same-origin, so the isolation is cosmetic. That's
  fine, because an apex cell already reads the session out of `localStorage` —
  it's not a new exposure, just not a real boundary either.
- Needs CORS on `/auth/grantable` and `/oauth/consent`, which don't have it
  today (only `/oauth/register` and `/oauth/token` do,
  `services/auth/service.ts:722`).

### C. Native in-cell modal calling the JSON APIs directly

No iframe, no popup. The cell renders its own sheet and calls
`/webauthn/authenticate/options`, `/auth/grantable`, `/oauth/consent` itself.

- Best UX by a distance. Fully styled by the cell, one DOM, no frame seams.
- The cell's own JS handles the passkey ceremony and holds the consent-scoped
  `sessionId`. Anything holding that session can post `/oauth/consent` for any
  scope the user can grant, with no screen the user can trust.
- Only defensible for apex-served first-party cells, which already have the
  session anyway. Never for a third-party cell.
- Blocked for cell hosts regardless: `/webauthn/*` has no CORS. The preflight
  returns 204 with no `Access-Control-Allow-Origin`, so the call fails.

### Where I'd land

C for apex-served first-party cells, B for everything else, and keep the
redirect as the fallback for both (registration, popup blockers, no
postMessage). A is the cheapest to build and the one I'd reach for if only one
gets done, but it loses the sheet, so it doesn't really answer the ask.

The shared piece all three need is small: a `response_mode=web_message` branch
in `submitConsent` (`services/auth/client/main.tsx`) that posts the result to
`window.opener ?? window.parent` instead of navigating, gated on an origin
allowlist. Everything else is the kernel growing a `login({ mode })` that
awaits a message rather than returning `Promise<never>`.

## Part 2 — what a sign-in-only cell should ask for

Every cell sign-in asked for `workspace:read workspace:write`, because that is
the kernel's `DEFAULT_SCOPE` (`cells/kernel/client/main.ts:26`) and no cell
overrode it. shelved called a bare `login()`.

shelved does not read or write the workspace at all. Its data lives in its own
DynamoDB table keyed by `x-cell-caller` (`cells/shelved/lib/store.ts`), and
`index.ts` derives the caller from that header. It needs one fact from the
platform: the username.

Confirmed by probe rather than by reading: a token minted with
`scope: "cells:create"` and no workspace scope called
`@c15r/shelved.list_books` successfully and returned the real shelf, while
`workspace.recall` on the same token returned `scope_denied`. Cell tools carry
`scope: null` (`services/cells/service.ts:1438`) and are authorised by the
registry, not by the caller's scopes.

So the over-ask is real and total. A user signing in to look at their books
grants read and write over everything in their slice.

drive already avoids it, incidentally: there is a live token scoped
`cell:c15r/drive:*` with actor `cell:c15r/drive`, minted through the cell-host
path where `cellCeiling` caps the scope. So the identity-only session is not
theoretical — it just wasn't reachable from the apex, or askable for on purpose.

### The server already has the answer

`cellScopesFor` (`services/auth/oauth.ts:236`) exists to make
`cell:<owner>/<name>:*` grantable at consent, and its own comment says what
it's for: a token holding only that scope is an identity token, which is what
a cell that wants to know who you are should ask for instead of the kernel's
default.

`scopeMeta` even has the copy written (`services/auth/oauth.ts` in the `cell:`
branch):

> Sign in to @c15r/shelved — Let @c15r/shelved know who you are. It learns your
> username, nothing in your workspace.

Both `handleConsent` and `handleGrantableScopes` already admit it
(`oauth.ts:396`, `:438`).

### Two gaps stopped it working (both now closed)

- The kernel never asked for it. `login()` defaulted to workspace read+write
  with no identity-only mode. It now takes `login({ identity: true })`, which
  derives `cell:<owner>/<name>:*` from `cellAddress()` and falls back to the
  default off a cell surface. `ensureAuth` takes the same.
- `cellScopesFor` was derived from `cellCeiling` (`oauth.ts:32`), which returns
  `null` unless the redirect host ends with `CELL_DOMAIN_SUFFIX`. An apex cell
  at `/@c15r/shelved` got an empty list, so requesting `cell:c15r/shelved:*`
  there was filtered out of `granted` and the consent screen offered nothing.
  That was the disabled-Authorize-button case the comment on `cellScopesFor`
  describes, still live for every apex cell. It now derives from
  `cellFromRedirect`.

`cellFromRedirect` (`oauth.ts:54`) already parsed both forms, so the second gap
was a one-line derivation change. It widens nothing: the two agree on the
host-isolated case, the apex case stays bounded to the cell in the path, and
the scope still grants no authority by itself. Note it does now trust the
apex path in the redirect_uri, which is only as trustworthy as the
redirect_uri itself — see the first item below.

Kernel boot survives it: both `$types` (read at `main.ts:421`) and `$catalog`
answered normally on the no-workspace-scope probe token, so a cell can boot the
kernel on an identity-only session.

shelved's `client/lib/auth.ts` now signs in identity-only, so its consent screen
reads "Sign in to @c15r/shelved" with one checkbox instead of two workspace
grants. `requestScopes` also stopped unioning `DEFAULT_SCOPE` back in, which
would have re-asked for the whole workspace at the first incremental widen from
an identity-only session.

### Deploy order

The platform change has to land before the cell does. A cell asking for
`cell:c15r/shelved:*` against the old auth service is offered nothing on the
apex, which is the disabled-Authorize case above. So: platform deploy, then the
kernel cell, then shelved.

### What this doesn't cover

A cell that genuinely does write back to the slice (lit, canvas, input) still
needs workspace scope. The identity-only path is for cells whose storage is
their own table. Anything in between wants the declared write-back prefixes
from `cell-origin-isolation.md` §4.5, which is a bigger piece and not this.

## Three things found on the way

All pre-existing and independent of the above. The first is the serious one.

### redirect_uri was never checked against the registered client (fixed)

`handleDCR` stores `redirect_uris` on the client record
(`services/auth/oauth.ts:360`), and nothing ever reads them back. The two
`getOAuthClient` lookups (`:456`, `:539`) use the record only for
`clientName`. `handleConsent` takes `redirectUri` from the request body, mints
an auth code bound to it, and returns a redirect there. `handleToken` compares
the presented `redirect_uri` to the one on the code, which is consistency, not
registration.

So the code goes wherever the authorize URL said:

1. Register a client at `/oauth/register` (open, unauthenticated), or reuse any
   `client_id` — the redirect isn't tied to it either way.
2. Craft `/oauth/authorize?client_id=…&redirect_uri=https://evil.example/&code_challenge=<yours>&scope=workspace:read+workspace:write`.
3. The victim gets the real consent screen on the real origin with a real
   passkey prompt, and approves.
4. The code lands on `evil.example`, and is exchanged with the verifier the
   attacker chose.

PKCE doesn't help: whoever crafted the authorize URL holds the verifier.

`handleConsent` now looks the client up and refuses a redirect it never
registered, before any code is minted.

The bound is the ORIGIN, not the exact string RFC 6749 §3.1.2.3 asks for. The
kernel caches one client per origin and reuses it across every surface path
there (`ensureClientId` registers `[origin, origin + pathname]`), so the client
a reader registered at `/` is the one that signs them in at `/@c15r/shelved`.
Exact matching would reject every path but the one they first landed on.
Origin matching still closes the hole — a code cannot land anywhere the client
did not name — and tightening further is a kernel change, not a server one.

Two things it does not address:

- DCR is open and `client_name` is attacker-chosen, so a client registered as
  "parc.land" with its own redirect still reads as parc.land at consent. The
  cell-as-resource line helps (a foreign redirect names no cell), but the
  client name itself is unverified.
- I could not enumerate what the existing clients registered — there is no
  capability that reads back `redirect_uris`. Origin matching is what makes
  that acceptable; exact matching would have been a guess about live
  integrations.

### /oauth/authorize can be framed

No `X-Frame-Options` and no `frame-ancestors`, so any site can iframe the
consent screen and clickjack Authorize. Shape B needs a `frame-ancestors`
policy anyway, so it'd be fixed in passing.

### /webauthn/* has no CORS

Cell hosts can't run a ceremony against the apex directly. Adding it is what
shape C would need to work off-apex, and I'd rather not add it — it's the thing
that currently stops a cell-host page from driving a passkey ceremony it
shouldn't be driving.

## Open questions

- Is the address bar worth keeping for first-party cells? Shape C drops the
  only un-forgeable signal of who is asking. For `@c15r/*` on the apex the
  answer is probably yes-drop-it, since the origin is already shared. It stops
  being true the moment a cell someone else wrote is served from the apex.
- Should the identity scope be `cell:<owner>/<name>:*` or a narrower
  `cell:<owner>/<name>:signin`? The `:*` form reads as "all its tools", which
  overstates it, though the tools are registry-authorised regardless.
- Was dropping `DEFAULT_SCOPE` from `requestScopes` right? It now unions only
  what the session already holds, so an identity-only session stays narrow at
  the first incremental widen. The cost is that a user who deselected
  `workspace:write` at consent no longer has it silently re-requested, which
  reads as correct to me but is a behaviour change for existing sessions.
