# Drive: where player state lives

A design for moving `@c15r/drive` off `localStorage`, decided against what the
platform actually provides rather than what it could be made to provide. Every
claim below is cross-checked against code in this repo and against the live
cell; file references are exact.

Two decisions frame it, both made by the owner:

1. **Signed-in sync only.** Anonymous players keep playing exactly as they do
   now, with progress on the device. Signing in is what earns durability.
2. **The game stays isolated.** Drive uses the platform's *infrastructure* — its
   own table, its public namespace, its identity — and writes **nothing** into
   the workspace fact store. No facts, no slice, no `@guest`.

The second one does most of the design work, and it is worth stating why it is
not a compromise: a driving game's progress is not knowledge. It has no
provenance worth keeping, nothing links to it, and nobody will ever query it by
meaning. Facts are the wrong container, and the isolation is what lets drive
take **zero authority** over a player's workspace (§4).

## 1. What is persisted today

Nine keys in `localStorage`, all in the cell's own origin
(`c15r-drive.on.parc.land` — see §3 on why that origin matters):

| key | what | write cadence |
| --- | --- | --- |
| `drive.survey.cp` | collected checkpoints, `"lat,lon"` at 5dp | **one per checkpoint — every 250 m driven** |
| `drive.survey.done` | claimed road **names** | same |
| `drive.spots.v1` | saved places, `Drive` records, capped 40 | on save/delete |
| `drive.dials` | settings indices | on change |
| `drive.paint` | bodywork colour | on change |
| `drive.odo` | total distance | throttled |
| `drive.mute`, `drive.mapUp`, `drive.clean` | device preferences | on change |

**Missions do not persist at all.** `missionPhase` is a plain module variable
(`cells/drive/client/main.ts`), so finishing a job survives until reload and no
further. Anything built on missions inherits that.

## 2. Three problems that are about the SHAPE, not the store

These bite whatever the destination is, and two of them are cheap to fix now.

**The whole set is rewritten on every checkpoint.** `saveSurvey()` is called
from inside the collection loop, so collecting three checkpoints in one frame
serialises the entire set three times. At 1551 km driven — a real odometer
reading from this session — that is ~6,200 keys ≈ 140 KB re-serialised every
250 m. Harmless against `localStorage`, untenable as a network write. **This has
to become incremental before it can leave the device.**

**The set outgrows a DynamoDB item.** `SURVEY_CAP` is 20,000 keys ≈ 440 KB
against a 400 KB item limit. It cannot be one row, and padding it into one is
the wrong answer anyway (§5).

**Roads are claimed by bare name.** `surveyClaimed.add(r.name)` — so claiming
one "Main Street" claims every Main Street in that player's record. Latent today
because the record is one device's and mostly one region's. It becomes a real
correctness bug the moment progress is durable and portable.

## 3. What the platform gives an isolated cell

All verified; nothing here needs provisioning.

**Its own DynamoDB table, already provisioned.** `services/cells/cell-template.ts`
gives every dynamic cell `TABLE_NAME`, a `pk`/`sk` string-keyed table on
`PAY_PER_REQUEST`, and an inline `OwnTable` IAM statement granting
`GetItem`/`PutItem`/`UpdateItem`/`DeleteItem`/`Query`/`Scan`/`BatchGetItem`/
`BatchWriteItem` **scoped to that table's ARN alone**. `drive-dcfd1204` has one
and has never used it.

**A CDN-fronted public namespace, already in use.** `CELL_PUBLIC_BUCKET` /
`CELL_PUBLIC_PREFIX` (ADR-0095) — the prefix drive already serves its OSM,
overview and peak tiles from. A cache hit never wakes the Lambda.

**Caller identity, without the credential.** `services/cells/service.ts` sets
`x-cell-caller: ctx.identity.user ?? 'anonymous'`, and
`platform/runtime/define-service.ts` states the rule plainly: *dynamic cells
receive `x-cell-caller`, never the token*. Drive learns **who** without ever
holding a player's credential — no token storage, no rotation, no leak surface.
Anonymous callers arrive as the literal string `anonymous`, which is the
discriminator for free.

**A shipped sign-in path from the cell origin.** All seven steps of
`docs/cell-origin-isolation.md` §5 are ✅: subdomain routing, CORS on `/mcp` and
`/oauth/{register,token}`, the PKCE handoff, and the apex→subdomain redirect for
navigations. The interactive page only ever runs on the cell's own origin.

**No ambient identity, by design.** The `parc_session` cookie is host-only
(§4.3) and never reaches a cell subdomain. An anonymous visitor therefore
arrives with no identity at all — which is not a gap to close, it is the
isolation working.

## 4. Signing in must cost the player nothing

`cellCeiling()` in `services/auth/oauth.ts` caps a token minted for a cell host
to:

```
['workspace:read', 'workspace:write', `cell:<owner>/<name>:*`]
```

Taken at face value that means signing into a driving game hands it read **and
write** over your entire workspace slice. Per-key-prefix narrowing is explicitly
deferred v2 in the isolation doc. For the owner playing their own game it is
moot; for anyone else it is a serious over-grant.

But the ceiling is an **intersection**, not a floor:

```ts
const ceiling = cellCeiling(authCode.redirectUri);
const effectiveScope = ceiling ? intersectScopes(scope.split(/\s+/).filter(Boolean), ceiling).join(' ') : scope;
```

So drive requests **only `cell:c15r/drive:*`** and receives exactly that. It
never asks for `workspace:read`, never asks for `workspace:write`, and cannot be
handed them by a consent screen the player clicks through. Combined with §3's
"cells receive the caller, never the token", the whole authority surface of
signing into drive is: *drive learns your username.*

That is the concrete payoff of the isolation decision, and it should be treated
as a constraint to preserve, not an implementation detail: **if a future change
needs `workspace:*`, the isolation has been abandoned and this document is
wrong.**

## 5. The data model

Progress is stored **per player, per road** — not as one blob. That single
change dissolves all three problems in §2 at once: no item approaches 400 KB,
writes become one small item per claim instead of a full rewrite, and each item
carries its own road identity.

```
pk = PLAYER#<caller>            sk = PROFILE           { odo, paint, createdAt, seenAt }
pk = PLAYER#<caller>            sk = ROAD#<roadId>     { name, got, total, claimedAt? }
pk = PLAYER#<caller>            sk = SPOT#<id>         { name, sub, lat, lon, h }
pk = PLAYER#<caller>            sk = MISSION#<id>      { phase, at }
```

**Sync the claims, not the crumbs.** The 20,000 checkpoint keys are a local
detail that regenerates by driving; what a player would grieve is a *claimed
road*, not an individual crumb. So claimed roads sync as one item each, and
in-progress roads sync a `got`/`total` count. Only roads that are started but
unclaimed need their crumb list, and that set is small by construction — you are
part-way through a handful of roads, not thousands. `localStorage` keeps the
full crumb set as the working copy.

**`roadId` must not be a bare name** (§2). It needs the name plus something
positional — a coarse geohash of the road's own geometry — so that two Main
Streets are two roads. This wants care: a long road spans tiles and its
fragments arrive independently (see `docs/drive-survey-checkpoints.md`), so the
positional part has to be derived from something stable across fragments rather
than from whichever fragment loaded first.

**Merging is trivial because progress is monotonic.** Claimed roads are a set
union; `got` is a max; the odometer is a max. Last-writer-wins is *wrong* here
and would silently delete progress made on a second device. Union-and-max is
both correct and order-independent, which means no clock, no vector, no
conflict UI.

**Local-first, always.** `localStorage` stays the working copy and the game
never blocks on the network — it already plays offline off the IndexedDB tile
cache, and progress must not become the one thing that needs a connection. The
table is a durable mirror, written on claim events (rare, immediate) and on a
debounce for counts (frequent, batched).

## 6. Campaigns and missions: authored in-repo, served from the namespace

`DRIVES` and the `Mission` definitions are hardcoded arrays inside
`client/main.ts` — the same file that just crossed the ~1 MB single-write ceiling
and now needs a chunked upload. Moving them out is worth doing on its own.

With no facts available, they are authored **in the repo** (`cells/drive/campaigns/*.json`,
pushed with the cell) and served from the public namespace as static JSON. That
keeps them:

- readable by anonymous and signed-in players alike, with no token and no
  identity path;
- CDN-cached, so serving a campaign never wakes the Lambda;
- versioned and reviewable in git, which is where the rest of the game's
  authored content already lives.

A cell route that writes campaigns to the namespace at runtime is possible and
deliberately **not** proposed: it would need an author-only write path on a
public HTTP surface, for content that changes about as often as the code does.

## 7. Order of work

1. **Campaigns and missions out of `main.ts`, into the public namespace.** No
   identity, no writes, no new security surface. Pays down the deploy-size debt.
2. **Fix the save shape in place** — per-road records, incremental writes, real
   road identity — while still writing to `localStorage`. Every §2 problem dies
   here, with no network involved and no way to lose data.
3. **Sign-in and sync.** PKCE requesting only `cell:c15r/drive:*`; a `/state`
   route on the cell reading `x-cell-caller`; union-and-max merge; a one-time
   upload of existing local progress on first sign-in.

Steps 1 and 2 are independently valuable and carry no risk to existing players.
Step 3 is the only one that needs the identity work, and by then the data it
syncs is already in the right shape.

## 8. Notes and non-goals

- **Drive does not need `parc.land` in `connect-src` for state.** The `/state`
  route is same-origin on the cell, so `'self'` covers it. The CSP needs the
  apex only for the OAuth token exchange, and CORS on `/oauth/{register,token}`
  is already shipped.
- **Device preferences stay local.** Dials, paint, mute, map-up, clean HUD.
  Making a settings toggle a network round-trip buys nothing.
- **`@guest` is not used.** It is a `read:workspace` token for reading a public
  slice (`_config/guest-token`, home injects it at SSR). An isolated game reads
  no slice, so it has nothing to offer here — and drive's static shell would
  have to become per-request to inject it.
- **Right-sizing.** With signed-in-only sync and one account today, step 3 means
  "the owner's progress survives a cleared cache and moves between devices."
  That is a fair goal, and it is worth being honest that it is the goal.
- **The project log is not game data.** `kb/proj_drive` remains a fact in the
  workspace, as project bookkeeping written by the humans and agents working on
  drive. The isolation rule in this document is about what the *running game*
  reads and writes, which is nothing.
