# ADR-0090 — The fact address is a path (`/r/<key>`); view-config is query; SSR seeds the read

- **Status:** Accepted — increment 1 implemented 2026-07-22 (route + query
  migration, `/r/*key` SSR seed, trailhead deep-link reading; the hash is
  read-only legacy). The two deferred items largely closed by the ADR-0091/0092
  sprint: **slice-encoding** is the grant fold's `owner/key` spelling used
  verbatim in the path (`/r/<owner>/<key>`, resolved through peek's grant
  checks — plus a peek fix so the SELF-folded spelling works for the owner);
  **anonymous SSR** of public docs comes from the `_public/`-gated corpus
  mirror (the landing-body machinery), with the client's @guest reads covering
  the rest live.
- **Depends on:** ADR-0040 ("the URL IS the key" — path-as-key routing), the
  dispatch SSR-read machinery (`ssr.json` `paths`/`*key` capture, `${param}`
  substitution, `where` validation, `SSR_READ_TARGETS` allowlist running
  reads AS THE CALLER — `services/dispatch/service.ts`), ADR-0061 §5 ("every
  fact is a seed document"), the shared render ladder (ADR-0035/0039 + the
  `@c15r/viewers` cell now consumed by home).
- **Grounded in:** the home trailhead work (2026-07). Home carried selection
  in the URL **hash** (`#selected=<key>&zoom=&rot=&q=`). Hash never reaches the
  server, but home is SSR'd — so a shared fact link could not render the fact
  server-side (blank/graph flash until the client hydrated and peeked) and was
  not linkable/crawlable as content. Meanwhile `lit` (`/r/<key>`) and `machine`
  (`/r/*key` + `ssr.json` peek) already route facts by PATH and SSR-seed them.
  Home was the drifted surface.

---

## Context

A URL for "a place in the substrate" carries three distinct kinds of state,
which had been conflated into the hash:

1. **Content identity** — WHICH fact. This is the address; it wants to be
   server-visible (SSR fast paint, crawlable, canonical).
2. **View configuration** — persistent-but-optional framing: the graph's
   zoom/curl (`zoom`), shell orientation (`rot`), an active query (`q`). The
   server needs these too, for the initial render to match the shared link.
3. **Ephemeral pose** — nothing here yet that must be hash-only; `rot`/`zoom`
   are "config" above (a shared link should restore them server-side).

The hash carried all three and reached the server with none. The result: home
could not honor a `#selected=` link at first paint.

## Decision

**Split the URL by what the server needs:**

- **Path = the fact address.** `/r/<key>`, the key verbatim — `/` and `:` stay
  literal (the substrate's own separators), every other segment
  percent-decoded (the ADR-0040 / lit decode contract). `/` is the trailhead
  (no fact). This is the canonical, shareable, SSR-visible fact address,
  consistent with `lit` and `machine`.
- **Query = view-config.** `?zoom=`, `?rot=`, `?q=` migrate off the hash to the
  query string, which the SSR handler already receives (`rawQueryString`), so
  the server has everything for a matching first render.
- **Hash = retired** for anything the server must know. (May still carry truly
  ephemeral client-only state in future, but selection/zoom/rot/q leave it.)

**SSR seeds the fact read.** `cells/home/ssr.json` gains a
`workspace.peek {"key":"${key}"}` scoped to `paths:["/r/*key"]`. Dispatch runs
it as the navigating caller (scoped, safe), injects `event.ssrData.fact`;
`buildBoot(session, ssrData, path)` folds it into `Boot.selectedKey` +
`Boot.selectedFact`; `App` seeds `useState(() => initial?.selectedKey ?? null)`
— identical on server and client (the serialized `home-state`), so hydration
matches and the fact head paints server-side. This mirrors `cells/machine`
verbatim (`buildBoot(user, ssr, path)` → `useRoute(boot.path)`).

**A deep-linked fact lands on the TRAILHEAD, reading that fact** (not the graph).
The trailhead's `Landing` slot already paints a selected fact's head/body; a
`/r/<key>` visit arrives there (the fact as the "pitch"), and pull-to-enter
carries the selection into the graph. `entered` is seeded deterministically
from `initial.selectedKey` (never from sessionStorage server-side) to stay
hydration-safe.

## Scope (increment 1, now)

- **Authed SSR only.** Server-seeded fast paint for the signed-in visitor
  (it's their workspace — the common case). Route + query migration + trailhead
  deep-link reading.

## Deferred (a broader multi-tenancy sprint)

These are explicitly OUT of increment 1 and captured here so the thinking isn't
lost:

1. **Anonymous SSR of public facts.** Dispatch gates SSR reads on
   `ctx.identity.user`, so an anonymous `/r/<key>` visitor gets NO `ssrData` —
   home can only shell-render and load client-side (if the fact is public).
   `lit` avoids this with its own direct-DDB `_public/` read path; home has
   none. Fixing this means either a home-local public read or a dispatch change
   to run public reads for anonymous callers.

2. **Slice-encoding in the URL — the canonical-address problem.** A fact key is
   only unique WITHIN a user's slice: two users can each have `note:groceries`.
   `/r/note:groceries` is therefore ambiguous across tenants. We need the URL
   to encode WHOSE slice a fact address refers to, so that:
   - the same logical fact has ONE canonical URL;
   - a fact by a different user with the same key is a DIFFERENT URL;
   - a visitor who can't (yet) see a fact gets a clear **access-denied** state
     with an affordance to **request** access, rather than a false 404 or a
     silent empty render.
   This likely means the address is `<slice>/<key>` (or an owner-qualified
   form), resolved through the same access checks as any substrate read. It is
   the crux of making `/r/` truly multi-tenant and should be designed as part
   of that sprint, not bolted on here.

3. **Access-denied / request-access UX** for facts the caller cannot see —
   distinct from "not found." Ties to capabilities-as-facts (ADR-0085) and the
   consent flow.

## Consequences

- One fact-address form across home, lit, and machine (`/r/<key>`), the drift
  ADR-0035/0039 keep fighting, now closed for home too.
- Home's client grows a path/query router (mirror machine's
  `useRoute`/`parseRoute`/`navigate`) alongside the existing selection state;
  the hash `readHashState`/`writeHashState` is reduced to (or removed in favour
  of) query for `zoom`/`rot`/`q`.
- The deferred slice-encoding means increment-1 URLs are **not yet canonical
  across tenants** — acceptable while home SSR is authed-only (the caller's own
  slice is unambiguous), but a known gap to close before public multi-tenant
  links.
