# Provenance, Capability & Consent — a naming ramble

> **Oblique strategy drawn: "The inconsistency principle."**
> Lens: hunt inconsistencies. The same concept named differently in different
> places; the same word meaning different things across the auth / provenance /
> consent surfaces; verb/noun mismatches (share vs grant vs scope). This file
> catalogues every inconsistency I could find across the capability & identity
> surfaces, then decides which to *unify* and which are *meaningful distinctions
> worth keeping*.

One sentence frames the whole domain: **parc.land answers "may principal X do
verb Y to resource Z?" with four-plus overlapping vocabularies**, and the words
`owner` / `caller` / `principal` / `writer` / `grantee` / `user` are all in play
for the *who*, while `scope` / `grant` / `share` / `consent` / `capability` all
name slices of the *what*. They mostly agree — but not always, and the seams
are exactly where the bugs and the confusion live.

---

## 1. Inventory — term → meaning → where used

### 1a. Provenance (who-wrote, on the fact)

| Term | Meaning | Where (file:line) |
| --- | --- | --- |
| `writer` | the principal who *last* wrote a fact (server-stamped from `identity.user`) | `platform/runtime/state.ts:52,182,738,778` |
| `writers` | distinct principals who have *ever* written it (accumulating set) | `platform/runtime/state.ts:60,186,763–768` |
| `via` | a label for *how* it was written — an action/command name or `@owner/cell` address | `platform/runtime/state.ts:54,183,779` |
| `createdAt` | when the key first came into being (sticky across rewrites) | `platform/runtime/state.ts:56,782` |
| `updatedAt` | when last written | `platform/runtime/state.ts:57` |
| `revision` / `seq` | per-key write count / per-scope trajectory ordinal | `platform/runtime/state.ts:48–49` |
| `writerAddress` | `@<owner>/<name>` — the form a *cell* (organ) is stamped as in `writer` | `services/workspace/handlers.ts:1730,1741` |

Note the **dual nature of `writer`**: for a human write it's a *username*
(`identity.user`); for an organ write it's an `@owner/name` *cell address*. Same
field, two grammars (see §3).

### 1b. Capability / scope (the OAuth ceiling)

| Term | Meaning | Where |
| --- | --- | --- |
| `scope` (token) | OAuth grant string, the consent ceiling — `workspace:read|write|admin`, `platform:cells:create`, `platform:*` | `platform/runtime/auth.ts:71–93`, `services/auth/oauth.ts` |
| granular scope | `read:workspace` / `write:workspace` / `cells:create` (verb-first) | `docs/capability-consent.md:40–44`; `platform/runtime/auth.ts:168` |
| `matchesScope` / `hasScope` / `requireScope` | pattern match / predicate / enforce | `platform/runtime/auth.ts:82,195,219` |
| `impliesScope` | coarse ⊇ granular back-compat table | `platform/runtime/auth.ts:168` |
| `intersectScopes` / `intersectScopePatterns` | the `effective = grants ∩ token` meet | `platform/runtime/auth.ts:101,136` |
| `effectiveScope` / `scopes` (Identity) | what is *enforced now* (mutable, ≤ ceiling) | `platform/runtime/auth.ts:21,27` |
| `grantScopes` / `grantScopesOf` / `hasGrantScope` | the immutable *ceiling* set at consent | `platform/runtime/auth.ts:29–33,201,211` |
| `focusScope` / `requestScope` | runtime narrow / widen-toward-ceiling | `docs/capability-consent.md:192–200` |
| `mintToken` | issue a token ≤ minter's scope | `services/auth/...`; `docs/scope-grants.md:212` |
| `consent` / `grantSecs` / `clampGrant` | consent screen + grant-lifetime picker | `docs/capability-consent.md:119–136` |

### 1c. Grant / share (substrate authority, below OAuth)

| Term | Meaning | Where |
| --- | --- | --- |
| `Grant { owner, grantee, key, mode }` | a share of a slice subset into a grantee's view | `services/workspace/grants.ts:55–62` |
| `GrantMode = read|write` | the verb on a grant | `services/workspace/grants.ts:53` |
| `grantCovers` | does a grant key-pattern cover a key | `services/workspace/grants.ts:65` |
| `share` / `unshare` / `shared` | the workspace command names for grant CRUD | `docs/substrate.md:217`; `services/workspace/handlers.ts` |
| `requireWriteThrough` | enforce a *write* grant on a cross-slice write | `services/workspace/handlers.ts:1081,1168` |
| `requestGrant` / `grantRequests` / `approveGrant` / `denyGrant` | the escalation loop (ask / inbox / resolve) | `services/workspace/handlers.ts:317–320,992–1055` |
| cell grant `grants: string[]` / `toolGrants` | per-cell binary grant + per-tool patterns | `services/cells/service.ts:160–173` |
| `cells.grant` / `authorizeAccess` / `grantCapability` | grant a cell / enforce it / the handler | `services/cells/service.ts:160,380` |
| `grant_denied` / `scope_denied` | the two denial errors (ask owner vs ask your human) | `services/cells/service.ts:149`; gateway |

### 1d. Identity / isolation (who, and which slice)

| Term | Meaning | Where |
| --- | --- | --- |
| `owner` | the principal who *owns* a slice / cell (the authority root) | `grants.ts:55`; `cells/service.ts:161`; `handlers.ts:1734` |
| `caller` | the principal *invoking* a cell, propagated as identity | `services/dispatch/service.ts:104–117`; `cells/service.ts:506` |
| `principal` | the grant *subject* — who a grant is given to/revoked from | `services/cells/service.ts:387–415`; `grants.ts:85` |
| `grantee` | the grant *recipient* (workspace grants) — a synonym of `principal` | `services/workspace/grants.ts:57,81` |
| `user` | `identity.user` — the authenticated principal on a request | `platform/runtime/auth.ts:18`; everywhere |
| `viewer` | the grantee when *assembling a view* (recall) | `services/workspace/grants.ts:98–109` |
| `x-cell-caller` | header carrying the validated caller identity *string* to a cell (never a token) | `services/cells/service.ts:506,1290`; `dispatch` |
| `x-parc-writes` | header by which a cell *requests* caller-slice writes | `services/dispatch/service.ts:121,290` |
| `x-forwarded-authorization` | the viewer bearer preserved past OAC | `platform/infra/service-router.ts:28`; `define-mcp-service.ts:236` |
| `STATE#<owner>` | the DynamoDB partition key = a slice | `cells/run/index.ts:41,55` |
| `LeadingKeys` | IAM condition scoping a cell's table read to `STATE#<owner>` | `lib/platform-stack.ts:69`; `infra/substrate-table.ts:73` |
| `slice` | informal name for one owner's partition of the substrate | `lib/platform-stack.ts:113`; everywhere in prose |
| `group` / `Membership` / `group:<name>` / `public` | named audiences a grant can target | `services/workspace/grants.ts:27,41–51,72` |
| `events:source = cell-<id>` | IAM-attested organ identity (the cell speaking as itself) | `services/cells/cell-template.ts:175`; `lib/platform-stack.ts:129` |

---

## 2. Inconsistencies catalogue

**I-1 — `grantee` vs `principal` (workspace vs cells).** The *same role* — the
recipient of a grant — is `grantee` in workspace grants (`grants.ts:57`) and
`principal` in cell grants (`cells/service.ts:387`, `cell.shared` event payload
`principal`). And the *escalation* loop (`requestGrant`) calls them neither — it
addresses them via the `resource` grammar. Three names, one role.

**I-2 — `scope` means two different things.** OAuth `scope` (a *credential
ceiling*, `workspace:read`) and the Σ-calculus `scope(s,e)` *authority boundary*
= a slice/room. `docs/scope-grants.md:79–83` then introduces a *third* sense:
the resource-grammar pattern `workspace:<owner>:<keyPrefix>:<read|write>` is also
called a "scope". So `scope` = {OAuth grant string} ∪ {authority boundary /
slice} ∪ {resource pattern}. The grammars even collide: `workspace:write`
(coarse OAuth) vs `workspace:c15r:inbox/*:write` (resource pattern) share a
prefix but are different vocabularies (`intersectScopePatterns` returns `null`
across them; `intersectScopes` only rescues it via `impliesScope` —
`auth.ts:145–153`).

**I-3 — `share`/`grant` verb split.** Workspace sharing is `share`/`unshare`
(`substrate.md:217`); cell sharing is `cells.grant`/`cells.revoke`
(`service.ts:380,405`); the escalation loop and the design doc call *both*
"grant" (`requestGrant`/`approveGrant`, `grants.list/grant/revoke` in
`scope-grants.md:204–212`). So the user-facing verb is `share`, the developer/
agent verb is `grant`, and they are the same operation. `unshare` vs `revoke` is
the same split on the inverse.

**I-4 — verb-order inconsistency in scope strings.** Coarse scopes are
*noun-first* (`workspace:read`, `workspace:write`); granular scopes are
*verb-first* (`read:workspace`, `write:workspace`); the resource grammar is
*noun-first-verb-last* (`workspace:<owner>:<key>:write`). Three orderings of
{resource, verb} in one system (`auth.ts:71–93,168`). This is *why*
`impliesScope` (`auth.ts:168`) has to exist at all — it's a translation table
between two of the three orderings.

**I-5 — `writer` is polymorphic.** `writer` holds a *username* for human writes
but an `@owner/name` *cell address* for organ writes (`handlers.ts:1730,1741`).
`writers[]` therefore mixes the two grammars in one array. There is no field
that says "this writer is a cell, not a person" — you infer it from the `@`
sigil. `via` *also* sometimes carries `@owner/name` (`dispatch:219`,
`handlers.ts:1737`), so the "who" (`writer`) and the "how" (`via`) can hold the
*same string*.

**I-6 — `owner` vs `caller` vs `writer` in the cross-slice write.** In a
caller-write (`dispatch:166–219`) the *caller* is the principal, the write lands
in the caller's slice, and the caller becomes the `writer` — but the requested
write also carries an `owner` field (`dispatch:139`) that means *target slice*,
not *the owner of the cell*. Meanwhile the organ path (`handlers.ts:1734`) uses
`owner` to mean *the cell's owner = the slice it writes to*. So `owner` =
{slice-to-write-to} in dispatch but {cell-author/slice-root} in the organ
handler — adjacent code, opposite emphasis.

**I-7 — `effective` vs `grant` scope, two-layer; `grants` (substrate) is a
*third* layer with the same word.** `Identity.scopes` (effective) ≤
`Identity.grantScopes` (ceiling) — both OAuth (`auth.ts:21–33`). But
`Grant`/`grants[]` (substrate) is an entirely separate authority store
(`grants.ts`, `cells/service.ts`). "Grant" thus names both *the OAuth ceiling*
(`grantScopes`) and *the substrate share*. `docs/scope-grants.md:28` literally
calls this out: "one problem wearing five names."

**I-8 — `group:<name>` vs `public` vs `audience`.** A grant's recipient may be a
person, a `group:<name>`, or `public` (`grants.ts:27,41–51`). The doc corpus
calls this set the "audience" (`capability-consent.md` uses `audience` in the
domain framing) but the code has no `audience` term — it's just `grantee`, which
overloads person/group/public into one string field with sigil-encoded type
(`group:` prefix, bare `public`). Same sigil-overloading pattern as I-5.

**I-9 — `x-cell-caller` (identity string) vs `x-forwarded-authorization`
(bearer) vs `x-parc-writes` (intent).** Three `x-` headers carry three different
slices of the same request's authority: the *who* (validated string, no token),
the *credential* (raw bearer, past OAC), and the *requested writes*. The naming
gives no hint they're a family; `x-cell-caller` and `x-parc-writes` use
different prefixes (`x-cell-` vs `x-parc-`).

**I-10 — `via` default differs by path.** Organ path defaults `via` to the cell
*address* `@owner/name` (`handlers.ts:1737`); caller-write path defaults `via` to
the cell *address* too (`dispatch:219`) — consistent! — but a *human* write
leaves `via` null (`state.ts:779`). So `via` present ⇒ machine-mediated, `via`
null ⇒ direct human. That's actually a *useful* distinction the naming under-
documents (see §4).

**I-11 — `slice` is prose-only.** Everywhere in docs and comments the unit of
isolation is a "slice" (`platform-stack.ts:113`, `dispatch:104`), but in code
it's `scope` (state.ts `put({scope})`), `owner` (the partition principal), and
`STATE#<owner>` (the storage key). Three code-names for the one concept the prose
consistently calls "slice."

---

## 3. Unification proposals (and distinctions to keep)

### Unify

**U-1 (from I-1, I-8): settle on `principal` for any grant subject; reserve
`grantee` for the receiving end of a *specific* grant fact, `audience` for the
*kind*.** Rename the workspace `Grant.grantee` field's *role* in prose to
"principal," keep `grantee` only where a grant instance is being described, and
introduce `audience: 'principal' | 'group' | 'public'` as an explicit tag rather
than sigil-sniffing `group:`/`public`. One word per role.

**U-2 (from I-2, I-4): pick ONE scope ordering and stop translating.** The
coarse noun-first (`workspace:read`) and the resource grammar
(`workspace:<owner>:<key>:write`) are *already* noun-first and compose; the
verb-first granular family (`read:workspace`) is the odd one out and exists only
because the consent UI wanted reads-vs-writes grouping. **Recommendation: make
granular noun-first too** (`workspace:read` is already the degenerate form of
`workspace:<self>:*:read` per `scope-grants.md:85`) and retire `impliesScope`'s
cross-grammar half once tokens migrate. Reads-vs-writes grouping is a *render*
concern, not a string-ordering one.

**U-3 (from I-3): name the verb pair once: `grant`/`revoke` everywhere, with
`share`/`unshare` as an explicit human-facing alias documented as sugar.** The
design doc already moves this way (`scope-grants.md:138` "`share`/`unshare`
become sugar over grant facts"). Keep the alias for the home UI; make `grant` the
canonical noun the agent surface and the substrate use.

**U-4 (from I-9): give the request-authority headers one prefix and a documented
family.** `x-parc-caller`, `x-parc-writes`, `x-parc-authorization` — one `x-parc-`
namespace, documented together as "the cell request-authority headers." (Don't
touch `x-forwarded-authorization` if it's a CDN convention, but alias/document
it.)

**U-5 (from I-7, I-11): in code, name the isolation unit `slice` to match the
prose, OR commit to `scope` and purge "slice" from comments.** Pick one. Given
Σ-calculus uses `scope(s,e)` foundationally, I lean toward keeping `scope` in
code and treating "slice" as the colloquial gloss — but then the docs should say
so once, not drift.

### Keep (meaningful distinctions)

**K-1: `owner` vs `caller` vs `writer` are genuinely three roles.** Owner =
authority root of a slice; caller = who's invoking right now; writer = who
last mutated a given fact. They *coincide* in the common case (you write your own
slice) but the cross-slice and organ paths prove they must stay separable. Do
**not** collapse these. The fix for I-6 is narrower: rename the dispatch
`RequestedWrite.owner` field to **`targetSlice`** (or `intoSlice`) so it stops
colliding with cell-author `owner`.

**K-2: `scope` (effective) vs `grantScopes` (ceiling) is the load-bearing
incremental-auth distinction** (`auth.ts:21–33`). Keep both; the `Scope` vs
`GrantScope` naming is good. Just don't let substrate `Grant` reuse the bare word
without qualification — call the substrate one a **share-grant** or **resource-
grant** in prose.

**K-3: `writer` vs `via` (the who vs the how) is worth keeping** even though both
can hold `@owner/name` (I-5). `writer` = the *accountable principal*; `via` = the
*mechanism/action*. The fix is to **type `writer`**: add a sibling
`writerKind: 'user' | 'cell' | 'agent'` so consumers stop sniffing the `@` sigil.

**K-4: `grant_denied` vs `scope_denied` is a precise, teachable distinction**
(`cells/service.ts:149`; gateway `scope_denied`). One says "ask the *owner* for a
grant," the other says "ask *your human* to re-consent / widen the token." Keep
both; they encode *which ceiling you hit*.

---

## 4. The `via`-present signal (a distinction the naming hides)

I-10 surfaced something worth promoting: a write with `via` set is
machine-mediated (organ or caller-write proxy); a write with `via` null is a
direct human `remember`. This is a *free provenance bit* the system already
computes but never names. Proposal: document `via === null ⇔ direct write` as a
first-class provenance invariant, or make it explicit with `writerKind` (K-3).

---

## 5. Top 3 concrete recommendations

1. **Type the writer; stop sigil-sniffing.** Add `writerKind: 'user' | 'cell' |
   'agent'` to `EntryMeta` (`platform/runtime/state.ts:46–81`) and stamp it where
   `writer` is set (`state.ts:738,778`; `handlers.ts:1741` → `'cell'`). This kills
   I-5 and makes the `@owner/name`-vs-username polymorphism legible without
   parsing the value. Lowest-risk, highest-clarity change.

2. **Rename `RequestedWrite.owner` → `targetSlice` in dispatch
   (`services/dispatch/service.ts:139,154,195,218`).** It currently collides head-on
   with the organ handler's `owner` (= cell author/slice root). `targetSlice`
   says exactly what it is — the slice the caller is writing *into* — and removes
   the single most dangerous ambiguity in the capability surface (I-6), where the
   wrong reading of `owner` is a cross-slice write authorization bug waiting to
   happen.

3. **Declare the canonical authority lexicon in one doc and converge the verbs.**
   Adopt: **principal** (any grant subject) · **owner** (slice/cell authority
   root) · **caller** (current invoker) · **writer/writers** (fact provenance) ·
   **scope** (OAuth credential ceiling, noun-first grammar only) · **grant** (the
   substrate share, with `share`/`unshare` as documented human-facing aliases) ·
   **grantee/audience** (recipient / recipient-kind) · **slice** (colloquial for a
   `scope` partition; `scope` in code). Then retire the verb-first granular scope
   family (U-2) so `impliesScope` (`platform/runtime/auth.ts:168`) can eventually
   be deleted rather than carried forever as a cross-grammar bridge.
