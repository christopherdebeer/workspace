# Scope grants — granular authority over the substrate

> A foundations design. The deferred-authority items scattered across the design
> corpus (per-tool scope grammar, grants-to-principals, write-through grants,
> scope elevation, token CRUD) are one problem wearing five names. This doc
> collects the call-outs, reviews what is actually built, and designs the
> unified grant model plus its **dual-projection UX** — the same grant/token
> management surface as MCP targets for agents and as home screens for humans.
> The companion [`home-cell.md`](./home-cell.md) rethink carries the human half.

## 1. The call-out ledger (why now)

Every recent design pass deferred the same cluster. Collected verbatim so we
stop re-deriving it:

| Doc | Call-out |
| --- | --- |
| `substrate.md` (status table) | "Room / scope … grants still **coarse** (auth scopes, not per-room)"; gap row: "scope *grammar* for resources; observe-vs-embody; **scope elevation**" |
| `substrate.md` (sequencing §3) | sharing shipped read-only; "Next: a scheduled `tend`, and **write-through grants**" |
| `sync-as-cells.md` §5 | auth-cell maturation: first-class **scope grammar**, **token CRUD**, a "**stateless scope-elevation URL** issued on `scope_denied`", and "**effective = min(token.scope, user role)** — a token can only narrow, never widen" |
| `dynamic-cells.md` | "Per-cell *scope* grammar (`cell:<owner>:<name>:<verb>`) is the **planned next step** for finer-grained, scope-based sharing" |
| `regwatch-port.md` §4/§7 | "Grants are **per-cell, all-or-nothing** … RegWatch is now the concrete motivating case for the deferred **per-tool scope grammar**" — and "a concrete motivating case for three deferred things at once: per-tool scope grammar, **write-through grants + grants-to-principals**" |
| `models-cell.md` §4/§5 | per-run grants narrow-never-widen exist, but "per-caller subsets ride the **grants-to-principals** design (deferred, with Bedrock as its first beneficiary)"; webhook ingress wants "a long-lived **narrow-scope bearer** per hook" |
| `home-cell.md` | the "Auth / identity shell — whoami, sign-in, **scope elevation**" surface is named and unbuilt |
| trajectory 2026-06-09 | ⚠ the principal rename (`50c8cf8`) stranded UUID-era facts **and grants** — "Sharing/grants are keyed the same way, so any UUID-era grants are likewise orphaned" |

## 2. What is actually built — four authorization systems

The same question — *may principal X do verb Y to resource Z?* — is answered
today by four mechanisms with different stores, grammars, and granularity:

1. **Token scopes** (`services/auth/oauth.ts:33` grantableScopes;
   `platform/runtime/auth.ts:62` `hasScope`/`requireScope`). Flat grammar
   (`workspace:read|write|admin`, `platform:cells:create`, `platform:*`) with
   wildcard matching and admin-gated prefixes (`AUTH_ADMIN_USERNAMES`).
   Enforced at the gateway PEP per tool (`services/gateway/service.ts:193`)
   and reflected in scope-filtered `$catalog` advertising. Answers what a
   **credential** may exercise; says nothing about *whose resources*.
2. **Cell grants** (`services/cells/service.ts:121` `authorizeAccess`,
   `:319` `grantCapability`). `grants: string[]` on the cell record —
   per-cell, **binary**: a grantee can call *every* tool, including the
   owner-shaped ones (regwatch's `save_prompt`). Identity propagates as
   `x-cell-caller`, so attribution works; granularity doesn't exist.
3. **Workspace share grants** (`services/workspace/grants.ts:19`). `(owner,
   grantee, key|*)` — dual-indexed (`GRANT#<grantee>` / `GRANTBY#<owner>`),
   assembled into `recall` as `<owner>/<key>`. **Read-only**, key-or-whole-slice
   (no prefixes), and its own store/vocabulary disjoint from 1 and 2.
4. **Per-run grants in `models.agent`** (`models-cell.md` §4). `grants: {read,
   write: true|false|prefixes[]}`, narrow-never-widen, enforced twice. The
   right *semantics* — but ad hoc, per-invocation, not attached to principals.

The strengths to preserve: identity is **one principal** for humans and agents
(passkey → OAuth bearer → `Identity { user, scopes }`); the gateway is a real
PEP; provenance is server-stamped; token mechanics (PKCE, refresh, RFC 7009
revocation, hashing) are production-grade. What's missing is **one model**
underneath the four, and any management surface at all (no token list UX, no
grant inbox, no audit of revocations).

## 3. The model: principals, grants, tokens

Three nouns, one rule.

- A **grant** attaches durable authority to a **principal** over a **resource
  pattern**: *who* may do *what* to *whose what*. Granted by the resource's
  owner, revocable, optionally expiring.
- A **token** carries a *portion* of its principal's standing — its scope
  string is a **ceiling, never a floor**.
- **Effective access = grants(principal) ∩ token.scope** — sync's
  `min(token, role)` rule, generalised. A token can only narrow; only a new
  grant (by the owner) can widen. This subsumes models-cell's per-run grants:
  a run's `grants` param is just a further ∩ inside the cell.

### The resource grammar

One grammar across the three resource families, extending the existing
colon-separated wildcard matcher (`hasScope` already does `a:b:*` ⊨ `a:b:c` —
no new matcher needed):

```
workspace:<owner>:<keyPrefix|*>:<read|write>     facts (slices, by key prefix)
cell:<owner>/<name>:<tool|*>                      tools (per-cell, per-tool)
platform:<verb>                                   kernel verbs (unchanged)
```

Today's flat scopes remain valid as degenerate forms (`workspace:write` ≡
`workspace:<self>:*:write`). The `rooms:<id>:…` namespace from sync slots in
later as a fourth family without touching the grammar. Owner-relative
addressing matches the read/act surface (`@owner/cell.tool` targets,
`<owner>/<key>` granted facts) — the grammar is the target vocabulary with
verbs attached.

### Grants as facts

Grants move into the substrate itself: reserved namespace `_grants/` in the
**owner's** slice, written through the normal observed-state path. This buys,
for free, everything the current stores lack:

- **Audit**: supersede-not-delete means revocation is a superseded grant fact
  with full provenance (`writer`, `via`, `revision`, timestamps) — the
  "revocations leave no trace" gap closes by construction.
- **Legibility**: `read("workspace.query", {prefix: "_grants/"})` *is* the
  grants API for the owner; grants surface in `changes`, in `attention`
  (expiring/expired grants), and on home — no parallel introspection system.
- **Consistency with the thesis**: "vocabulary is state" — authority
  declarations are exactly the kind of fact the substrate exists to hold.

**Enforcement stays indexed, not scanned.** The hot path (every gateway call,
every `recall` assembly) cannot query a slice. The existing dual-index
`GrantStore` shape (`grants.ts`) becomes the **enforcement projection** of
`_grants/` facts — written through on grant/revoke (the fact and the index
rows in one operation), read by grantee at check time, cached briefly at the
gateway. The fact is the record; the index is the materialised view. This is
the same fact-vs-index discipline `substrate-gaps.md` Gap 1 applied to
tags/type.

### Grant shape (the fact value)

```jsonc
// _grants/<id> in the owner's slice
{
  "grantee": "emily",
  "resource": "cell:c15r/regwatch:review",   // grammar pattern; arrays allowed
  "mode": "allow",
  "expiresAt": null,                          // optional; expiry rides _meta.timer
  "note": "reviewer — items/notes only"
}
```

`resource` may be a list (`["cell:c15r/regwatch:review", "…:flag",
"…:list_*", "…:stats"]`) — the regwatch reviewer split is one grant fact.
Workspace sharing becomes `"resource": "workspace:c15r/inbox:*:read"` — and
**write-through** is just `:write` on the same pattern, with provenance
already stamping the grantee as `writer` (nothing new to build for
attribution; the owner's view shows who wrote).

## 4. Mechanics per family

- **Workspace (facts).** `share`/`unshare` become sugar over grant facts with
  `workspace:` resources; gain **key prefixes** (today key-or-`*`) and
  **mode** (`read`/`write`). Write-through enforcement lives where reads are
  assembled now: the StateStore checks grantee writes against the granted
  prefix; competing writes are *surfaced, not blocked* (the existing
  philosophy; contested-target detection extends to grants when declarative
  actions land).
- **Cells (tools).** `cells.grant` gains `tools?: string[]` (default `*` —
  back-compat with today's binary grants); `authorizeAccess` takes the tool
  name and checks owner-or-matching-grant. `grants: string[]` on the cell
  record migrates to grant facts + index (`cell:` family). Public cells keep
  anonymous GET/HEAD as an explicit `cell:<owner>/<name>:_public` standing.
- **Tokens (auth cell).** Token CRUD as commands *and* gateway targets:
  `read("auth.tokens")` (id, label, scope, clientId, createdAt, lastUsed,
  expiresAt, revoked), `act("auth.mintToken", {scope, label, expiresIn})` —
  the **narrow-scope long-lived bearer** the webhook-ingress investigation
  wants, mintable only ≤ the minter's own effective access —
  `act("auth.revokeToken", {id})`, `act("auth.labelToken")`. `auth` stays an
  infrastructure cell but gains a small provider surface (a deliberate
  amendment to `platform-cells.md`'s taxonomy: the *tokens* vocabulary is
  user-facing even though the OAuth plumbing is not).

## 5. Request / escalation — the loop, both modalities

The ergonomics review's strongest finding was that **errors are teaching
affordances**. Authority denials should teach the path to authority:

**Agent path (grant request).** A denied call returns a structured
`grant_denied` error naming the missing resource pattern *and* the ready-made
next call:

```
grant_denied: "cell:c15r/regwatch:save_prompt" requires a grant from c15r.
Request it: act("grants.request", { owner: "c15r", resource: "cell:c15r/regwatch:save_prompt", note: "…" })
```

`grants.request` writes `_grants/requests/<id>` into the **owner's** slice
(the one cross-slice write the platform performs itself, server-stamped with
the requester as `writer` — provenance is the anti-spoofing). The request
surfaces in the owner's `attention`, `changes`, and home inbox. The owner
acts: `act("grants.approve", {id})` (writes the grant fact + index) or
`grants.deny` (supersedes the request with a reason). The requester observes
the outcome via `changes`/`peek` — no new notification machinery.

**Human path (scope elevation).** When the *token* is the ceiling (the grant
exists but the credential wasn't minted with the scope), `scope_denied`
carries a stateless elevation URL — `/oauth/authorize` pre-filled with
`scope = current ∪ missing` (sync's model). Re-consent issues a widened token
without sign-out; the consent screen's admin gating
(`oauth.ts grantableScopes`) already enforces the ceiling authoritatively.
This is incremental consent, not a new flow — the authorize endpoint exists;
the URL issuance and the home affordance are the work.

The two paths compose: an agent that is denied first checks which ceiling it
hit — `whoami` already reports `scopes`; the error should distinguish
`grant_denied` (ask the owner) from `scope_denied` (ask *your* human to
elevate, here's the URL).

## 6. UX — one vocabulary, two projections

Per the surface thesis, the management plane is **not a new screen and not a
new API**: it is read/act targets, rendered.

**MCP projection** (scope-filtered into `$catalog` like everything else):

| Target | Kind | What |
| --- | --- | --- |
| `grants.list` | read | grants I've given ∪ received; `{role: "owner"\|"grantee"}` filter |
| `grants.grant` | act | `{grantee, resource\|resources[], expiresAt?, note?}` |
| `grants.revoke` | act | supersedes the grant fact, removes index rows |
| `grants.request` | act | the escalation write into the owner's slice |
| `grants.approve` / `grants.deny` | act | resolve a request |
| `grants.requests` | read | my inbox (requests on my resources) + my outstanding asks |
| `auth.tokens` | read | active credentials with scope/label/lastUsed |
| `auth.mintToken` / `auth.revokeToken` / `auth.labelToken` | act | token CRUD (ceiling: minter's effective access) |

**HTML projection** — home's **identity & grants shell**
(see [`home-cell.md`](./home-cell.md)): the same targets rendered as the
account surface — who am I, what credentials exist (with revoke), what I've
shared and what's shared with me (with revoke), the grant-request inbox
(approve/deny), and the elevation entry point. Because home is already a
browser read/act client, every row is an `mcpCall(verb, target, input)` the
console can *already* make — the shell is a purpose-built rendering, not new
plumbing. The OAuth **consent screen** stays the moment-of-minting picker;
home is the **standing** management plane.

## 7. Hazards and prerequisites

- **Fix the stranded principal first.** Grants will be keyed by principal;
  the UUID→username rename regression (trajectory 2026-06-09) must be
  resolved (migrate or alias UUID-era scopes/grants) before a grant store is
  built on the same keys, or it inherits the same orphaning.
- **Hot-path cost.** Grant checks join token validation on every call. The
  dual index + short-TTL gateway cache (the same pattern as token-validation
  caching in `valtown-mapping.md`) bounds it; measure before adding layers.
- **∩ semantics with wildcards.** Intersection of two pattern sets needs a
  defined, tested algebra (`workspace:*:read` ∩ `workspace:c15r/inbox:*` =
  `workspace:c15r/inbox:*:read`). Small, but get it right once in
  `platform/runtime/auth.ts` next to `hasScope`.
- **Raw writes vs declared vocabulary.** `declarative-actions-vs-code-cells.md`
  flags that shared/multi-writer scopes want writes through *declared*
  actions, not raw `remember`. Write-through grants are the first multi-writer
  pressure: keep them prefix-bounded, and treat "grantee write-through must
  flow through a declared action" as the room-era tightening, not a v1 gate.
- **Requests are cross-slice writes.** Bound them (rate, size, one open
  request per (requester, resource)) so the inbox is not a spam vector.

## 8. Sequencing

1. **Principal migration/aliasing** (the §7 hazard) — unblocks everything keyed
   by principal.
2. **Grammar + ∩ algebra** in `platform/runtime/auth.ts` — pure functions,
   fully testable, no storage change.
3. **Per-tool cell grants** (`cells.grant {tools}` + `authorizeAccess(tool)`) —
   smallest visible win; **regwatch reviewer split is the acceptance test**
   (Emily: `review`/`flag`/`list_*`/`stats`; collector/owner: `ingest`,
   prompts, sources).
4. **Grants-as-facts + enforcement index** — migrate workspace share grants and
   cell grants[] onto the one store; `grants.list/grant/revoke` targets.
5. **Write-through grants** (prefix + mode on workspace resources) — the
   regwatch follow-on (`substrate.md` already names it "Next").
6. **Token CRUD targets + home identity shell** — the management UX, both
   projections (home Phase 2a in `home-cell.md`).
7. **Request/escalation loop** — `grant_denied`/`scope_denied` affordances,
   `grants.request/approve/deny`, elevation URL, home inbox.

Each step is additive (the layering discipline sharing itself used); 3 and 6
ship user-visible value before the unification in 4 is complete, and 4 can
land behind the existing call sites without changing their semantics.

> **Status (2026-06-12, same day).** Steps 2, 3, 5, 6, and 7 shipped in the
> commits following this doc:
>
> - **Grammar + ∩ algebra** — `matchesScope` / `intersectScopePatterns` /
>   `intersectScopes` in `platform/runtime/auth.ts`; `hasScope` rides the
>   matcher unchanged. Command envelopes now carry the caller's token scopes
>   across service hops (the ceiling survives the gateway → provider invoke).
> - **Per-tool cell grants** — `cells.grant {tools}` (patterns, trailing `*`),
>   `cells.revoke`, per-tool enforcement in `authorizeAccess`/`callCell`/
>   `callCellTool`, scope-filtered `describeCellTools`. The regwatch reviewer
>   split is expressible today: one `cells.grant { owner, name: "regwatch",
>   principal: "emily", tools: ["review","flag","list_*","stats"] }`.
> - **Write-through + prefix grants** — `workspace.share {mode, key:
>   "inbox/*"}`; `remember`/`peek` take `owner` for write-/read-through;
>   provenance stamps the grantee as writer; reserved namespaces refused.
> - **Token CRUD** — `auth` joined the gateway providers (`auth.tokens` /
>   `auth.mintToken` / `auth.revokeToken`); `mintToken` narrows to
>   `requested ∩ minter's scopes` and refuses an empty meet.
> - **Request/escalation loop** — `workspace.requestGrant` / `grantRequests`
>   / `approveGrant` (routes cell-family resources to `cells.grant`) /
>   `denyGrant`; outcomes land in the requester's slice under
>   `_grants/answers/`. `grant_denied` (cells, workspace) and `scope_denied`
>   (gateway) errors carry the ready-made next call.
> - **Home identity & grants shell** (Phase 2a in `home-cell.md`) —
>   credentials with revoke, grants given/received with revoke, the request
>   inbox with approve/deny, request answers.
>
> Deliberately not done this pass: **step 4** (grants-as-facts as the single
> store — workspace grants remain on the dual-index `GrantStore`, cell grants
> on the registry record; the `_grants/` namespace currently holds only
> requests/answers), the **stateless elevation URL** for the human re-consent
> path (the `scope_denied` error names the path in prose instead), and the
> **step 1 principal cleanup** (explicitly waived — pre-rename UUID-era grants
> are treated as abandoned).
