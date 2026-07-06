# ADR-0066 — Proof-of-read: content-hash `version` conditional writes

- **Status:** Accepted 2026-07-06. **Inc 1 shipped + validated live** — persisted
  `version` content hash + `ifVersion` on `remember` + `_meta.version` read exposure
  (`platform/runtime/content-hash.ts`, `state.ts`, `state-store-codec.ts`,
  `services/workspace/{commands-write,descriptors}.ts`, `tests/fact.test.ts`). Prod
  gauntlet passed: a read token passes and rotates the version, a guessed hash and a
  stale token are both rejected, and pre-ADR facts expose a computed version with no
  migration. **Inc 2 shipped** — declarative `_actions` write-templates carry `ifVersion`
  (`services/workspace/actions.ts`, parity with sync's kernel). The optional store-level
  `version` physical condition is **closed / won't-do** — see Rollout: a version-only
  guard would permit metadata-only lost updates, so the revision-based closer is
  strictly safer.
- **Depends on:** ADR-0044 (the write/remember/CAS vocabulary), `docs/substrate-storage.md`
  (phase-2 Gap 3 — the `ifRevision`/`ifAbsent` CAS), and the substrate's ancestor
  **sync** (`christopherdebeer/sync.parc.land`), whose `version`/`revision` split this
  ADR restores. The relevant sync essays are transplanted to `docs/ancestor/sync/`.
- **Restores a regression** introduced silently when sync's model was ported to the
  current DynamoDB substrate.

## Context (grounded)

### What the ancestor did

Sync — the substrate's direct ancestor — enforced read-before-write with an
**unforgeable proof-of-read token**, not a lock or a lease. Each located key carried
**two** distinct version fields (`sync.parc.land/reference/kernel.ts:24-28`):

```ts
export type Entry = {
  value: unknown;
  version: number;     // monotonic revision counter
  hash: string;        // content hash — proof-of-read token
};
```

The content hash is the point (`sync.parc.land/utils.ts:42-44`):

> *"the v6 `version` field — **unforgeable proof-of-read** for if_version writes.
> Agents cannot supply a correct hash without having fetched the current value."*

A conditional write had to echo back the current content hash; the engine rejected a
mismatch with a `409 version_conflict` (`invoke.ts:265-289`, `kernel.ts::writeIfVersion`).
`if_version: ""` meant *create-only* (must not exist). The two fields were split apart
deliberately in sync's v5→v6 migration (`schema.ts:178-186`): the old integer `version`
became `revision`, and `version` was repurposed as the content hash. Sync's own docs are
candid that this is load-bearing but heavy (transplanted to
`docs/ancestor/sync/what-becomes-true.md`): *"The distinction between `revision` and
content-hash `version` — used to enforce proof-of-read on conditional writes — is
conceptually clean but cognitively heavy."*

The **security property**: a content hash cannot be produced without reading the value,
so requiring it as a write precondition *makes the read a precondition of the write* — it
is enforced by construction, not by convention.

### What the current substrate kept — and dropped

The port to DynamoDB kept CAS but replaced the guard. `remember` today takes
`ifRevision`/`ifAbsent` only (`services/workspace/commands-write.ts:25-28`,
`services/workspace/descriptors.ts:144-145`), threaded into the observed-state primitive
(`platform/runtime/state.ts:1494-1504`):

```ts
const hasCas = input.ifRevision !== undefined || !!input.ifAbsent;
if (hasCas) {
  if (input.ifAbsent && livePrev) throw new StatePreconditionError(/* already exists */);
  if (input.ifRevision !== undefined && (livePrev?.revision ?? 0) !== input.ifRevision) {
    throw new StatePreconditionError(/* at revision X, expected Y */);
  }
}
```

…closed atomically by a store-level physical guard (`PutGuard.expectRevision`,
`state.ts:352`) that maps to a DynamoDB `ConditionExpression`
(`platform/runtime/dynamo-state-store-v3.ts:123-131`):

```ts
if (guard.expectRevision === null) input.ConditionExpression = 'attribute_not_exists(pk)';
else { input.ConditionExpression = 'revision = :rev'; /* :rev = expectRevision */ }
```

`StateRecord` carries `revision` (monotonic counter) and `seq`, but **no content hash**
(`platform/runtime/state.ts:196-213`). There is no `version` anywhere.

### The regression

**`ifRevision(N)` is a *guessable* precondition; sync's `if_version(hash)` was not.**

A numeric revision can be satisfied without ever reading the value — an agent that knows
(or increments blindly to) the current revision passes the guard while holding a stale or
entirely unread value. The precondition no longer proves a read happened; it only proves
the writer knew a small integer. The substrate therefore lost the one property sync built
deliberately: **read-before-write is no longer enforced by construction.**

At personal, single-writer-per-slice scale this rarely bites, which is why it went
unnoticed. It bites exactly where the substrate is heading:

- **Organs writing the reef** (the `substrate.write.requested` path) — multiple cells, or
  a cell and a human, contending on one key.
- **Agents** — an LLM is precisely the actor that will confidently supply `ifRevision: N`
  without a fresh read; a hash it cannot fabricate.
- **The deferred "rooms" / multi-writer scopes** (`docs/substrate-storage.md`) — the moment
  a scope has more than one writer, guessable CAS is a lost-update surface.

## Decision

**Reintroduce a content-hash `version` as a first-class, persisted field, and add an
`ifVersion` conditional-write guard alongside `ifRevision` — restoring sync's proof-of-read
split.** Keep both fields with distinct, complementary roles:

| field | kind | role |
|---|---|---|
| `revision` | monotonic integer | ordering, audit, cheap guessable CAS, the physical race-closer |
| `version` | content hash of the value | **unforgeable proof-of-read** token for `ifVersion` CAS |

`ifVersion: "<hash>"` writes only if the live value still hashes to `<hash>`;
`ifVersion: ""` is create-only (must not exist), mirroring sync. A read returns the current
hash in `_meta.version`, so the observe→mutate handshake is: **read hands out the token, the
conditional write demands it back.**

The storage design already anticipated this: `docs/substrate-storage.md:80` lists the CAS
mechanism as *"`ConditionExpression` on revision/**hash**"* — the hash half was named but
never built. This ADR builds it.

### The elegant part: no storage-layer change

The existing **physical `expectRevision` guard already closes the read→write race** for
`ifVersion` too. The primitive reads `livePrev`, checks the supplied hash against it
*semantically*, then commits under `ConditionExpression: revision = :rev`. If any concurrent
writer touched the key between the primitive's read and the commit, `revision` moved and the
condition fails — so proof-of-read CAS is atomic **without a new DynamoDB condition**. The
storage layer (`dynamo-state-store-v3.ts`) is untouched; `version` rides to disk for free via
the record spread (`...fields`, `dynamo-state-store-v3.ts:115`).

(One deliberate semantic: because the physical closer is revision-based, a *same-value*
concurrent write — identical hash but a bumped revision — will conflict an `ifVersion` write
that sync's pure-hash guard would have allowed. This is stricter, never looser: it never
permits a lost update — and, as Inc 2 established, it is the *right* choice: see Rollout.)

## The seam — exact insertion points

**Content hash helper** (new, `platform/runtime/`): `contentHash(value: unknown): string` =
`sha256(JSON.stringify(value))` truncated to 16 hex chars, via `node:crypto` (a builtin — no
SDK-at-import concern). Matches sync's shape (`utils.ts:45-52`). Determinism note below.

1. **`StateRecord.version: string`** — `platform/runtime/state.ts:196-213`. Add the field.
   It persists automatically through the store's record spread; `state-store-codec.ts`
   `itemToRecord` reads it back (`version: (item.version as string) ?? ''`).
2. **`WriteInput.ifVersion?: string`** — `platform/runtime/state.ts:1034-1047`.
3. **Observed-state `put`** — `platform/runtime/state.ts:1481-1552`:
   - compute `version = contentHash(input.value)` and set it on the record (`:1515-1551`);
   - extend `hasCas` to include `input.ifVersion !== undefined` (`:1494`);
   - add the semantic check (`:1495-1504`): reject when `input.ifVersion` is set and
     `(livePrev ? (livePrev.version ?? contentHash(livePrev.value)) : "")` ≠ `input.ifVersion`
     — the `??` fallback covers pre-ADR facts that have no stored hash; `""` means "must not
     exist" (create-only);
   - the existing `store.put(record, { expectRevision: prev?.revision ?? null })` line
     (`:1552`) is unchanged — it now also closes the `ifVersion` race.
4. **Read exposure** — `EntryMeta` (`state.ts:51`) gains `version: string`; the wrap
   (`state.ts:1386-1387`) adds `version: rec.version ?? contentHash(rec.value)`; the
   catalog `META_SCHEMA` prose (`services/workspace/descriptors.ts:33-37`) names it.
5. **Command** — `remember` threads `ifVersion` (`services/workspace/commands-write.ts:99-113`);
   `ingest` may too (today it omits even `ifRevision`, `:149-160`).
6. **Descriptor** — add `ifVersion` to the `remember` `inputSchema`
   (`services/workspace/descriptors.ts:143-146`) with a description that teaches the
   read→echo handshake; update the tool's summary line (`:131`).
7. **Declarative-actions parity** — sync's kernel put `ifVersion` on *action write-templates*
   (`kernel.ts:328-331`); the substrate's declarative actions carry `ifAbsent`/`timer` but not
   `ifVersion` (`services/workspace/actions.ts`, descriptor `:658`). Add per-write `ifVersion`
   to the action write model and interpreter so declared no-code actions get proof-of-read too.
8. **Tests** — extend the CAS suite that already pins `ifRevision`/`ifAbsent` — the
   primitive-level `tests/fact.test.ts:54-62` (cleanest) and command-level
   `tests/workspace.test.ts:386-393`, plus the lease re-claim at `:896-904` — with `ifVersion`:
   a stale-hash write is rejected `precondition_failed`; the correct hash from a prior read
   succeeds and bumps `revision` + changes `version`; `ifVersion: ""` creates iff absent; a
   *guessed revision cannot substitute for the hash* (the regression-tripwire test).

## Design decisions

- **Persist the hash; compare persisted-to-supplied.** Because the supplied token came from a
  prior read's `_meta.version` (the persisted hash), the CAS compares two persisted values —
  so **canonical serialization is not required for correctness** (unlike sync's compute-on-read
  path). The only determinism requirement is that `contentHash(sameStoredValue)` is stable,
  which it trivially is. `JSON.stringify` insertion-order sensitivity is therefore a non-issue.
- **Hash algorithm / length.** SHA-256 truncated to 16 hex (8 bytes), matching sync. Collisions
  are compared only *within one key's successive values*, so 2⁻³² birthday exposure per key is
  ample; note the option to widen to 16 bytes if ever a concern.
- **Backfill is non-breaking.** `version` is additive. Pre-ADR facts have none; the read-time
  `?? contentHash(rec.value)` fallback still hands out a valid token, and the next write
  persists it. No migration job required (contrast sync's `RENAME COLUMN`, `schema.ts:181`).
- **Both guards compose.** A write may carry `ifRevision`, `ifVersion`, `ifAbsent`, or a
  combination; the semantic checks AND, and the one physical revision-guard closes the race.
- **Guidance, not removal.** `ifRevision` stays — it is the right, cheap tool for
  monotonic-progress checks and legacy callers. `ifVersion` is the tool for **contended shared
  keys and agent writers**, where proof-of-read integrity matters. The descriptor copy should
  steer agents to it.

## Consequences

- **Read-before-write is enforced by construction again** for any caller that opts into
  `ifVersion` — the property sync built and the port dropped.
- Reads carry a small extra `_meta` field; writes compute one hash. Negligible.
- The organ write path and declarative actions gain the same guard, so the reef is protected
  uniformly, not just the imperative `remember`.
- When "rooms" (multi-writer scopes) land, the correct primitive already exists.

## Alternatives considered

- **Keep `ifRevision` only.** Rejected — it is the regression; guessable preconditions do not
  prove a read.
- **Compute the hash on read only, never persist.** Rejected — cannot expose it cheaply in
  `_meta`, forces canonical serialization for round-trip stability, and re-hashes on every read.
- **A store-level `version = :ver` physical condition (full sync parity).** **Closed in
  Inc 2 (won't-do).** Its only benefit is tolerating a *same-value* concurrent write (hash
  unchanged, revision bumped). But to get that, the physical guard must drop `revision` in
  favour of `version` — and a `version`-only guard is *less* safe: a concurrent
  **metadata-only** rewrite (a `type`/`tags` change, or a salience touch) bumps `revision`
  but leaves `version` (a hash of `value`) unchanged, so a `version`-only `ifVersion` write
  would slip past it and clobber the concurrent metadata change — a lost update the
  revision-based closer prevents. Trading correctness for a marginal tolerance case is the
  wrong trade; the Inc-1 revision closer stands.

## Rollout

- **Inc 1 (this ADR):** `version` field + read exposure + `ifVersion` on `remember` + tests.
  Validate live: read a fact, echo its `_meta.version` on a conditional write (succeeds);
  mutate it out-of-band, retry the same token (rejected `precondition_failed`); confirm a
  guessed `ifRevision` cannot stand in for a stale `ifVersion`.
- **Inc 2 (shipped):** declarative `_actions` write-templates carry `ifVersion` (parity with
  sync's kernel), with `${params.*}` substitution so an action can pass a token the caller
  read; validated (`tests/workspace.test.ts` — create-only, guessed-token rejection, real-token
  rotation). The optional store-level `version` condition is **closed / won't-do** — a
  `version`-only physical guard permits metadata-only lost updates (a concurrent `type`/`tags`
  change bumps `revision` but not the value hash), so the revision-based closer from Inc 1 is
  strictly safer and stands.
