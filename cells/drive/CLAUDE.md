# drive — working notes for the next session

A mobile-first pixel-art driving game rendering real OSM, DEM and WorldCover
data. Deployed as a parc.land cell at https://c15r-drive.on.parc.land.

This file is the stuff that cost previous sessions hours to learn. It is not a
tour of the code — the code carries its own reasoning in long comment blocks,
and those comments are the primary documentation. Read the block above a
function before changing it; most of them exist because the obvious change was
tried and was wrong.

---

## The deploy ritual

> **PARSE THE BUNDLE BEFORE YOU BELIEVE THE DEPLOY.** Step 5 below greps
> `app.js` for a symbol, and a grep cannot tell a working bundle from a broken
> one — measured: a deploy whose `app.js` contained every symbol the check
> looked for and would not parse, so the game did not load at all. And
> **`node --check` is not the gate**: on that same file it exited 0. `npx
> esbuild --log-level=error --outfile=/dev/null app.js` found it instantly
> (`Syntax error "a"`, line 14569). Use esbuild.
>
> The break was a `String.replace()` filling a placeholder in the served
> `app.js`. `replace` takes the FIRST occurrence, `client/runtime.ts` had been
> using that same placeholder for years, and the substitution landed inside
> `typeof __DRIVE_BUILD__`. **Grep for a placeholder before minting one** — the
> build id already existed as `DRIVE_BUILD`, already exported, already imported
> by `main.ts`.


The cell is deployed from `/home/user/workspace` (the cwd matters — `cell-sync`
resolves paths from the repo root, and running it from `cells/drive` fails with
a confusing module error):

1. `mcp__Substate__act` → `auth.mintToken`
   `{scope: "write:workspace cells:create", label, expiresInSec}`
2. `PARC_TOKEN=<tok> node scripts/cell-sync.mjs pull drive` — **always**, see below
3. `PARC_TOKEN=<tok> node scripts/cell-sync.mjs push drive --deploy`
4. `auth.revokeToken {tokenId}` — do not leave a token open
5. Verify by fetching the live bundle and grepping for a symbol you just added:
   `curl -s https://c15r-drive.on.parc.land/app.js | grep -c mySymbol`

**A DEPLOY THAT NEVER LEAVES `DEPLOYING` IS THE DEPLOYER OUT OF MEMORY, AND
NOTHING TELLS YOU.** Root-caused on 2026-09-10 with `platform.logs
{service: "cells"}`, which tails the cells service's own Lambda
(`PlatformStack-CellsServiceFunction…`, 512 MB, 120 s). A deploy request is a
`cell.deploy.requested` bus event handled by that function: it reads every
file of the cell, bundles `index.ts`, transpiles `client/main.ts` into
`app.js` and zips `static/`. For this cell that is a 2.5 MB `main.ts`, a
3.2 MB `ne-wide.b64` and 6.4 MB of `static/` in all, and it runs at the
function's ceiling EVERY time. The stuck deploy, v1789047456197:

```
REPORT RequestId: 22a3f9a9-…  Duration: 70369 ms   Max Memory Used: 512 MB
  Status: error  Error Type: Runtime.OutOfMemory             (13:40:33Z)
REPORT RequestId: 22a3f9a9-…  Duration: 120000 ms  Max Memory Used: 512 MB
  Status: timeout                                            (13:44:47Z)
```

The second line is Lambda's own async retry of the same event, which found
the same heap and hit the timeout instead. Neither failure path writes
`deploy.phase`, so `cells.get` says `DEPLOYING` for as long as anyone looks
and the cell serves the previous build; cell-sync's 180 s wait reports the
same and is not wrong. The forty-minute stall recorded under the wide-chart
cloud fix (v1788955892954) was this, seen without the logs.

Three things to do with it:

- **Read the REPORT line, not the phase.** `platform.logs` needs the
  platform scope; the line to find is the one with `Status: error` or
  `Status: timeout` beside a 512 MB `Max Memory Used`.
- **Re-issue with `cells.deploy {cellId}`, not another push.** A push
  resends 133 files through the cells tools to arrive at the same deploy
  event; `cells.deploy` raises the event over the files already there. The
  re-issue landed in 46 s — `Duration: 45994 ms  Max Memory Used: 512 MB`,
  at the ceiling again, which is why the same input can fail one time and
  land the next: it is the heap's timing, not a bad file. **And the version
  it lands as is not the version requested** (requested 1789048207732,
  deployed 1789048252332 — the deployer stamps its own completion), so wait
  for `phase: DEPLOYED` or the live symbol, never for the requested number.
- **The memory is the PLATFORM's function.** `cells.configureCell
  {memoryMb}` sizes the cell's own runtime Lambda and does nothing for the
  deployer. What the cell can do is shrink what the deployer must chew:
  `main.ts` is the largest single transpile, `ne-wide.b64` is 3.2 MB carried
  as a JS string and decoded whole, and close to 3 MB of fixtures under
  `static/` ride along for nothing at deploy time. Any of those is a
  cheaper fix than the next stuck deploy.

### THE TILE BANK IS ON NOW — AND WAS NOT, FOR A LONG TIME

Every `~/` route ends in `putTile`, and `putTile` opens with
`if (!process.env.CELL_PUBLIC_BUCKET) return;`. That variable is only set when
the cell's `publicNamespace` flag is on, and drive's was **false** — so every
bank was a silent no-op since the day the code was written, the S3-first origin
group in front of the cell always missed, and EVERY tile request from EVERY
player was a live Overpass query or a live COG read. The ADR-0095 comments in
`index.ts` ("CloudFront looks in S3 first and falls through here on 403/404")
described a mechanism that had never once run.

Turned on with `cells.configureCell {cellId, publicNamespace: true}`. Measured
immediately after, same tiles:

| route | before | after |
|---|---|---|
| `~/osm/v3/` fine z16 | live Overpass, every request | 0.20–0.35s from S3 |
| `~/osm/ov1/` overview | live Overpass, 502 roulette | 0.18–1.09s from S3 |
| `~/cover/v1/` | live COG range-reads | 0.21s from S3 |

**A stack change wipes `app.js`.** `configureCell` re-renders the stack from
`src/` and does not reproduce the client bundle, so the game 404s until a
`cells.deploy` follows. The tool says so in its own response; believe it, and
have the deploy queued.

**The edge gives up at ~15.5s; the Lambda has 50s.** A cold tile slower than
that returns a 502 the client never sees a body for — and then banks anyway, so
the NEXT request is a CDN hit. That self-healing is the whole design and it only
works with the flag on. A tile needing more than the 44s Overpass budget still
never lands.

### WHAT ACTUALLY REACHES THE LAMBDA

The cell is pushed as source and deployed as **one bundle**: the platform reads
every file into a `Record<string, string>`, bundles `index.ts`, and ships that
plus `app.js` plus anything under `static/`. Nothing else is on the running
Lambda's disk.

So `readFileSync(join(__dirname, 'web', …))` reads nothing, and it fails as a
404 rather than an error. The PWA manifest and icons were added that way and
were dead on the live cell from the day they landed — the shell linked a
manifest that was never served, and no test noticed because every tool here
runs the client, not the deployed handler.

**`static/` IS shipped, and is now binary-safe.** The directory is
`cells/drive/static/` (it was `web/`), it is the one source of truth, the native
shells copy it verbatim, and `index.ts` reads it off /var/task with
`readFileSync(join(__dirname, 'static', file))` — no encoding, so a PNG stays a
Buffer from disk to base64 to the wire.

That took a platform fix, made 2026-09-01. Source files were carried through the
cells tools as JSON strings and stored `text/plain; charset=utf-8`, so a PNG did
not arrive corrupted, it arrived LARGER: every byte that is not valid UTF-8
became U+FFFD, 19,203 bytes in and 34,465 out, served with a 200 and a
content-type that still said image/png. `cells.writeFile` takes
`encoding: 'base64'` now, `readFile` returns bytes as base64 with the stored
content type, `deployCell` loads `static/` through `getObjectRaw`, and
`zipStore` writes a Buffer verbatim. `tests/cell-files.test.ts` holds it.

The workaround it replaced — `scripts/build-web-assets.mjs` rendering `web/`
into a 230KB generated `web-assets.ts` of base64 literals so the bytes could
ride inside the module graph — is deleted. If you find a reference to it, it is
stale.

**cell-sync is binary-safe in both directions too.** It sends a known binary
extension as base64 in ONE call (never chunked — two independently-decoded
base64 chunks only concatenate when the first is a multiple of four characters)
and writes a base64 response as a Buffer. Before that fix every pull silently
corrupted the five icons in the working tree, and the only thing that ever
caught it was `git status` showing five modified PNGs after a pull that should
have been a no-op.

**COMMIT BEFORE YOU PULL.** `cell-sync pull` overwrites the working tree with
the cell's copy of every file it has, and it does not care that you were
mid-edit. It ate an uncommitted rewrite of `index.ts` and of this file during
the very change that removed the workaround — `git status` then showed them as
CLEAN, because the cell's copy matched HEAD, which is the most convincing way
for work to disappear. It also RESURRECTS files you deleted locally, since the
cell still has them; `cells.deleteFile` is what actually removes one.

**Verify the deployed HANDLER, not just the bundle.** Grepping `app.js` for a
symbol proves the client shipped; it says nothing about a route. Curl the
routes.

### PULL BEFORE YOU PUSH. ALWAYS.

`cell-sync push` sends **every file in the cell**. Other agents edit the
deployed cell's source directly — during one session the hydro author was
iterating on `client/hydro/*` continuously — so pushing without pulling first
silently overwrites work that exists nowhere else.

The routine that survives this:

```
pull  →  git status  →  for each modified file, decide who owns it
      →  git checkout -- <files you own>        (restore yours)
      →  keep theirs, git add + commit verbatim (so it cannot be lost)
      →  tsc  →  push --deploy
```

Commit other people's pulled work with a message that says plainly it is not
yours and where it came from. It has happened repeatedly that the cell was
**ahead of git** — their work lived only on the deployed cell until a pull
rescued it.

The reverse also happens: the cell can be **behind** git when someone commits
without deploying. Check the direction of each diff before restoring anything.

---

## Verification ladder

Nothing here is fast. Budget for it.

| command | what it buys | rough time |
|---|---|---|
| `npx tsc --noEmit` (from `cells/drive`) | the only cheap check | ~30s |
| `node devtools/boot.mjs` | the world boots and probes exist | ~1min |
| `node devtools/lab.test.mjs` | every lab opens, dials persist and travel | ~6min |
| `node devtools/fixture-world.test.mjs` | the whole mesh pipeline over authored ground | ~7min |
| `node devtools/through-node.test.mjs` | junction pins survive the per-way build, on two fixtures | ~3min, no-draw |
| `node client/clip.test.mjs` | tile clipping, incl. the corner nicks | instant |
| `node devtools/dock-sky.test.mjs` | the chart dock's sky is the dock's own | ~3min |
| `node devtools/fixture-stream.test.mjs` | a fixture streams its box and touches no network | ~3min |
| `node devtools/appshell.test.mjs` | the worker precaches only what the cell serves | instant |
| `node devtools/offline-shell.test.mjs` | the browser starts with the network off | ~20s |
| `node devtools/storage-reset.test.mjs` | settings can hand the whole device back | ~20s |
| `node devtools/offline-ground.test.mjs` | and finds ground when it does | ~3min |
| `node devtools/<name>.test.mjs` | 66 of them; pick what you touched | varies |

Run them from `/home/user/workspace`, not from the cell directory.

**`tsc` failure is silent if you pipe it.** `npx tsc --noEmit 2>&1 | head && echo OK`
prints OK on failure, because `head` succeeds. Use `;` not `&&`, and read the
output.

### THE COMPILER IS PINNED NOW, AND IT HAD BEEN FLOATING

Two configs compile this client — `cells/drive/tsconfig.json` (plus `index.ts`)
and `native/tsconfig.json` (which includes `../client/**/*.ts`) — and they were
running **different compilers**. The root had `"typescript": "^5.3.3"` and NO
`package-lock.json`, so an install resolved it to whatever was newest; native
pinned 5.3.3 exactly and has a lock. `npx tsc` in the cell therefore reported
five errors that `npm run typecheck` in native did not, which is how a previous
session recorded "the cell typechecks clean" in a commit message and was wrong.

The errors were real and were entirely TypeScript 5.7's doing: typed arrays
became generic in their buffer (`Float32Array<ArrayBufferLike>`), `BufferSource`
in `lib.dom` is invariant `ArrayBufferView<ArrayBuffer>`, and `@types/three`
0.160 types `new DataTexture(data)` as `BufferSource`. Five declarations —
`HydroTileField`'s four arrays and `WxField.data` — now say `<ArrayBuffer>`,
which is what they always were.

**That syntax is a hard error on 5.3.3** ("Type 'Float32Array' is not generic"),
so both sides moved together: root pinned to `5.9.3`, native's pin and lock
bumped to match. Measured before committing to the direction — 5.9.3 over
native's wider include produced the SAME five errors and nothing else, so the
migration was bounded. If you ever unpin either one, they will drift again and
the two checks will disagree in silence.

### Tests that fail for reasons that are not you

`sward.test.mjs` and anything else that needs a road under the car depend on
**Overpass**, a busy public service that fails for whole sessions at a time.
Its road/water masking checks fail in a family and the count moves run to run.
Before blaming a change, stash it and run the test on the parent commit. Say
plainly which failures are environmental rather than claiming green.

---

## The harness

`devtools/harness.mjs` → `openDrive({spot, pagePath, tag, settle, bootTimeout})`.
Its own header documents two traps in detail; the short version:

- **Chromium cannot use the agent proxy.** Every https request is intercepted
  and relayed through `curl` with a SHA1 disk cache. A cold run takes minutes,
  a warm one seconds.
- **The relay bypasses CSP**, so these tools are structurally blind to CSP
  bugs. A blocked host looks like a working one. Do not use the harness to test
  reachability.
- **Headless renders at 2–4 fps**, so wall time is not sim time. Anything that
  integrates must wait on `simWait`, never a timeout.

- **A package that only exists in `client/imports.json` is stood in for.**
  The import map is the platform's: the browser fetches those packages from
  esm.sh at the pin and the deploy transpile bundles them the same way, but
  the harness, `shell-server.mjs` and the native build run esbuild against
  node_modules with no network — and esbuild without code splitting hoists a
  lazily imported module's externals into static imports at the top of the
  bundle, so a package only a lab reaches would break EVERY page load if it
  were merely marked external. `devtools/offline-deps.mjs` aliases each such
  package to a stand-in under `devtools/stubs/` that throws when USED, with
  the reason — and only when the package is absent: `npm i --no-save
  @dgreenheck/ez-tree@1.1.0` at the workspace root and the harness bundles
  the real thing, which is how the lab was measured. `three` is installed
  and is not in that table. The type check is the same story:
  `client/ez-tree.d.ts` is the published declaration trimmed to the callable
  surface, so tsc holds the lab to the real API on a fresh checkout. A new
  esm.sh dependency needs a stub row and a declaration, or the harness dies
  at link with `Could not resolve`.

Other harness facts learned the hard way:

- Synthetic double-taps must dispatch **both** PointerEvents inside ONE
  `page.evaluate` — two separate calls exceed the 450ms window.
- `navigator.clipboard.readText()` **hangs** without permission in headless
  rather than failing. The dials panel mirrors COPY output to
  `root.dataset.lastCopy` for exactly this reason. A test that read the
  clipboard once stalled for ten minutes.
- **Measure with `?nodraw=1`.** Headless Chromium paints through SwiftShader
  at three or four frames a second and the world build is paced by the frame
  loop, so a fixture that touches no network still took three minutes to
  settle — painting frames nobody looks at. `NODRAW` skips only the draws:
  Camps Bay settles at t+21s instead of t+180s with every probe reading the
  same. A screenshot run leaves it off, by definition. And a `rev` older than
  the commit that added it simply ignores the flag and draws — four
  "stalled" Vélizy runs were exactly that, the old eleven-minute path on a
  pinned control, read as a freeze.
- **`settle` is SIM seconds, and sim seconds are frames.** `openDrive({settle})`
  waits for the sim clock, which advances by a clamped `dt` per frame — so
  while a big capture's frames each carry seconds of synchronous road build,
  `settle: 9000` is 180 slow frames: eight minutes of boot on the paris-south
  capture against fourteen seconds on Camps Bay, all of it before the script's
  own gate started counting. A measurement with its own settle gate passes
  `settle: 0`; the option exists for tests that integrate physics.
- Screenshots land in `/tmp/drive-tools/` (`$DRIVE_WORK`).
- A bundle built for a test must be written **inside the repo** (e.g.
  `node_modules/.cache`) — `--external:three` resolves from where the file
  lives, so a bundle in `/tmp` cannot find `three`.
- Never `pkill` a test by name from inside a compound command; it kills the
  enclosing shell and discards pending edits. (Yes, really.)
- **`page.evaluate` IS EXEMPT FROM THE PAGE'S CSP EVAL RULE.** It goes
  through the DevTools protocol, which may evaluate a string under any header
  — so a `new Function` inside `page.evaluate` succeeded under the locked
  policy and would have "proved" the policy was off. The harness does enforce
  a `csp:` it is given (no `bypassCSP`); what cannot be trusted is a probe
  that evaluates from the protocol's side. Anything about eval has to be
  asked by PAGE SCRIPT — `__eruda().evalAllowed` is a boolean main.ts
  computes once at boot for exactly this — and read back afterwards.

---

## Where the world comes from

Everything arrives through exactly **three fetches**, which is what makes the
fixture world possible:

| source | function in `main.ts` | zoom |
|---|---|---|
| terrarium height tile | `fetchHeights(x, y, z)` | z14 |
| WorldCover class tile | `loadCoverTile(x, y)` | z12 |
| OSM vector tile | `proxyTile(x, y)` / `readTileCache` | z16 |

Answer those three from an authored fixture and the **entire production
pipeline** runs with no network: terrain build, corridor carve, ribbon, batter,
kerb, junction, vegetation, sward, façades, water. That is `client/world-fixtures.ts`,
reached with `?fixture=<id>` and chosen from `/lab/world`.

---

## Offline, and the two different things it means

The native shells carry `dist/web` inside the application, so they have always
started with no network — and then shown an empty planet, because only ONE of
the three world fetches used to survive a reload. Both halves are fixed and
they are fixed in different places (`docs/drive-persistence.md` §8):

- the **app shell** is a service worker, `web/sw.js`, served at `/sw.js` and
  registered only in the browser. It answers the page, the bundle, the manifest
  and the icons, and deliberately nothing else.
- the **ground** is `readRaster`/`writeRaster` in `main.ts` — the same
  `drive-cache` database as the ways, keyed by SOURCE URL, holding bytes.

Three traps, each of which cost a round:

- **A refused fetch must not end the Mapterhorn pyramid climb.** Where a z14
  tile is absent the thing that got STORED is an ancestor; returning at the
  refused level never reaches it. 26 tiles, 26 refusals, no ground, full cache.
- **One IndexedDB transaction per tile is too many.** Fifty overlapping
  readwrite transactions queue and drain at roughly one every four seconds
  behind the render loop. Measured: 56 puts, 4 stored, ZERO failed, nothing in
  the console. Writes are batched now; `__raster()` exists so the next silent
  version of this is one probe away rather than four rounds.
- **Cache bytes only after something has decoded them.** A route that answers
  200 with an error document is a passing fault; storing it makes it permanent.

`devtools/offline-ground.test.mjs` holds the ground half, on the main harness.
The page half is on **`devtools/shell-server.mjs`** instead — the same shell,
bundle, `web/` assets and stamped worker on 127.0.0.1 — because the main
harness serves no `/sw.js` and relays through curl, which makes it as blind to
a service worker as it is to CSP. It is also seconds rather than minutes, so
anything about the PAGE rather than the planet belongs there.

## Giving the device back

`__storage()` says what is held; SETTINGS → STORAGE has the two buttons.
`devtools/storage-reset.test.mjs` drives them by the words on them.

- **CLEAR THE WORLD CACHE** empties the `osm` and `raster` STORES, and must not
  delete the database. Dropping it would leave `osmDb` pointing at nothing and
  every read for the rest of the session answering "not cached" — the exact
  invisible failure the open was written to prevent — and would need a reload
  to recover from a button whose whole point is that it does not.
- **RESET THIS DEVICE** takes keys, databases, caches and the service worker,
  then reloads. It refuses when offline: the offline copy is part of what goes,
  so a reset with no network takes the game away and cannot put it back.

Three traps live in there:

- **The unload flush undoes it.** `pagehide` and `visibilitychange` write the
  survey, the marks and the docket — and the reload a reset schedules IS a
  pagehide, so a wipe puts three of the biggest stores straight back and
  reports success. `storageWiped` latches them off; a last-registered pagehide
  sweep is the backstop.
- **Never a wholesale clear.** A browser cell can share an origin with every
  other cell on its host, so `localStorage.clear()`, or deleting every database
  the origin has, is somebody else's lost save. Everything is prefix-scoped and
  the test plants a neighbour to prove it.
- **A count that did not answer is not zero.** A readonly count queues behind
  the raster flush; the first cut timed out at 2s and put "0 GROUND TILES" on
  the screen of a session holding twenty-seven. It reads `?` now.

---

## A road can go missing with nothing failing

`renderGated` clips every highway to its OWN tile before building it, so a road
is drawn by each tile it passes through and by no other. That makes
`client/clip.ts` the one place a road can vanish without anything reporting it:
no fetch error, no console, the way present and complete in the tile's own data,
and simply nothing built where it crosses.

Which is exactly what it did. Reported from the seat driving Edge Hill to Ben
Nevis at Senqu: short segments missing, consistently where a road nicks the
CORNER of a tile between two nodes, metres at a time, on a road that is unbroken
on the overview layer (which does not clip). The clipper walked the VERTICES and
opened a run whenever one was inside the box — which covers wholly-in, entering
and leaving, and silently drops the fourth case: a segment whose two endpoints
are BOTH outside and which passes through. No vertex is ever inside, so no run
is ever opened.

Two things worth keeping from how it was found:

- **The obvious suspect was wrong.** The first hypothesis was Overpass — that
  its bbox filter does not return a way with no node inside the tile. Measured
  before touching anything, over a 3x3 of live tiles at Senqu: every way that
  crosses a tile IS present in that tile's own response. The data was never the
  problem. `devtools/`-style measurement first, every time.
- **The old code is the test's control.** `client/clip.test.mjs` drives the
  SHIPPED function; the old vertex walk was replayed beside it to prove the new
  cases actually fail against it (`[]` for both corner nicks, correct output for
  a crossing with vertices inside). A regression test that does not fail on the
  bug it names is decoration.

The clipper is Liang–Barsky per segment now, which has no case split at all.
Adjacent tiles still meet EXACTLY on their shared edge — both sides solve the
same edge line against the same endpoints, so the crossing point is the same
double — and the test asserts that, because trading a gap for a seam would not
be a fix. A segment that only grazes a corner has `t0 === t1` and yields
nothing: a two-point run of identical points is a zero-length ribbon with no
normal to build from.

## The wide view, and what feeds it

Three layers stand in for the fine world past its rings, each on its own ladder
of zoom levels, each a 5x5 ring at whichever level is current:

| layer | levels | picked by | reach at the ceiling |
|---|---|---|---|
| terrain shell | `FAR_LEVELS` 13/11/9/7 | `farLevelFor(sight)` | z7, ~630km |
| overview vectors | `OV_LEVELS` 13..8 | `ovLevelFor(r)` | z8, ~390km |
| shell land cover | `COVER_WIDE_LEVELS` 10/8 | `coverWideLevelFor(shellR)` | z8, ~390km |

**The ceiling is DERIVED, not chosen.** `SIGHT_MAX` says how far the world is
streamed and `ZOOM_MAX` is computed from it by running `viewRadius`'s own
arithmetic backwards. They were independent numbers once and had drifted three
and a half times apart: `viewRadius` clamped at 60km while the ceiling stood at
1600, so every reading was IDENTICAL at zoom 458, 800 and 1600 — the same shell
level, the same tile counts, the same everything, with nothing but more empty
frame. If you raise the reach, the ceiling follows; do not type a zoom number.

**The shell has its own land cover, and must.** `coverTiles` (z12, 7x7, ~28km)
feeds the biome, the sward, the vegetation and the sea datum, and wants its 37m
pixels. Everything past it used to be painted with `coverMode`, the modal class
of that ring — one colour for a whole quadrant. Measured with `__far().cover`,
which reports how much real cover each shell tile had when it baked: **13 of 25
tiles blind at zoom 300, 22 of 34 at the old ceiling, `min 0` throughout**.
`coverWide` is a second, coarser raster sampled only by the shell's colour bake
(`sampleCoverShell`). After: 0 blind, mean 0.99 at zoom 300.

Three traps in there, each of which cost a round:

- **Gate the coarse cover on the SHELL'S REACH, not the sight line.** They come
  apart: `farLevelFor` rounds UP, so the ring it fills reaches further than the
  number that chose it. At the 24km floor the z11 ring still spans 40km, twelve
  past the fine raster — 2 of 4 tiles blind at zoom 100 with the gate on
  `sight`.
- **One shell rebuild when the coarse ring is home, not one per tile.** The
  fine loader calls `coverDirtiedFar` per tile, which is right for an 8km tile
  overlapping two shell tiles and catastrophic for a 130km one overlapping all
  of them: twenty-five arrivals demolished the shell twenty-five times and
  nothing survived to be seen.
- **The plausibility floor is -500m only where the wheels are.** `fetchHeights`
  refuses a tile with >2% of pixels outside Earth's LAND range, which is right
  at z14 and wrong for a shell tile that is mostly ocean — AWS terrarium
  carries real bathymetry, and the z7 tile off the Cape is 10.1% below -500m,
  bottoming at -3,348m of Atlantic. Every coarse coastal tile was refused,
  re-asked, refused again, and the shell stood at ZERO tiles with `bad` climbing
  where nobody looked. Mapterhorn hid it for years: Copernicus is a LAND model
  whose sea is nodata, so the guard only bites where mapterhorn has no tile —
  exactly the coarse levels the shell never used to reach. The coarse floor is
  Challenger Deep; the documented -13,029m corruption is still below it and
  still refused.

**The tile-debug overlay folds as it stops being legible.** Its grids are sized
in GROUND metres, so pulling the chart out does not spread them, it collapses
them: at the wide end 361 z16 cells of grid line and pip stack into a few pixels
of dirty haze in the middle of the frame, and the post chain turns narrow bright
features into a white contour diagram rather than forgiving them. Each layer now
draws cells only while a cell can carry a marker (`DBG_CELL_PX`) and outlines
its RING when it cannot — and the far shell draws its own grid at exactly the
zooms where the fine grids have folded, because that is the layer actually
streaming out there. Close up is unchanged.

**Measuring any of this costs minutes.** A coarse ring is 25 DEM fetches at 4
concurrent, and every one goes through the harness's curl relay. Budget three
to five minutes per zoom step, and read `__far()` (meshes, asked, inFlight,
queued, cover) rather than watching the picture.

### The zoom range doubled at both ends

Asked from the seat: pull in twice as close and twice as far. Each end is a
different change and `devtools/zoom-reach.mjs` measures both (`NEAR=1` on a
capture, the default live at the Cape and at Paris).

- **The near end is a number and a picture.** `ZOOM_MIN` 0.25 → 0.125 puts the
  chart camera 22m over the truck instead of 44: `viewRadius` 39m → 16m, a
  frame about 23m across, which is one junction with its kerbs legible. The
  near plane follows the orbit (`setNear(dist × 0.08)`) to 1.75m and nothing
  in the chart stands inside it.
- **The far end is a ladder, and every rung had to be there.** `SIGHT_MAX`
  300km → 600km, so `ZOOM_MAX` (derived) 2292 → 4584. A z7 shell ring reaches
  600km only below about 40° of latitude, so `FAR_LEVELS` gained z6 — same
  cost, since `farSeg` already clamps z7 at 128 segments. Measured live:
  Simon's Town picks z7 and Paris z6, both 25/25 tiles in 20s through a warm
  relay. The overview gained z7 and the cell serves it (`OV_LEVELS`, and the
  guard in `serveOverview`).
- **A z7 OVERVIEW TILE IS THE NARROWEST ASK ON THE LADDER, BECAUSE IT WAS
  MEASURED.** A 313km box asked for motorways and trunks alone came back from a
  loaded mirror as 6,645 ways, 58k points, 7.6MB, in 65s — past the 44s the
  handler can wait — and the same box's coastline on its own did not return in
  100s. So z7 carries motorways and cities only, no rivers, no summits, no
  coast; the shell's own cover paints the sea at that scale. A dense European
  z7 tile may still take several stream passes to land; the bank then serves
  it for ever. (`overpass-api.de` refuses this container's proxy outright; the
  measurement came from the other two mirrors, with a User-Agent, which they
  demand.)
- **THE FAR OCEAN WAS PAINTED AS GRASSLAND, AT EITHER CEILING.** `__far().cover`
  reads 16 of 25 shell tiles blind at the Cape with the z6 cover ring fully
  home (`__cover().wide` 25/25) — the same on the pinned control at 300km.
  WorldCover is a LAND map: its tiles stop a few tens of kilometres offshore
  and answer 0 beyond, `sampleCoverShell` reads 0 as "no cover", and the bake
  fell back to `coverMode`, the modal class of the country. Measured on one
  pixel row through the truck: sea-blue at 30km west of Simon's Town,
  grassland at 60. The coarse DEM carries bathymetry, so a coverless vertex
  under the sea datum is water now: 60 to 150km west read [97,97,55] before
  and [38,86,94] after, the land to the east unchanged. `hit` still counts
  only real cover, so the blind count is unchanged and honest — it is
  measuring the raster, not the paint.

## The stream, audited: what loads, at what scale, in what order

Asked from the chart over the Cape Town CBD, facing south, with the tile
overlay on: the fine ring was filling from Table Bay northward while the tile
under the wheels and the peninsula ahead waited, and the same minute's device
telemetry read 260 terrain builds for 26 tiles in 85 s at 58 ms of main
thread each (39 of them re-draping). Every layer's ask was read and the
answer is a table, because the layers are not alike:

| layer | level | ring | asked in | served by | prioritised? |
|---|---|---|---|---|---|
| fine terrain (DEM) | z14 | 5×5 to 7×7 by view | **rings outward** (was raster) | DEM gate, FIFO | fetch order only |
| terrain BUILDS | — | the dirty set | **wedge-cheapest, owner-first hop** (was raster) | one build a slot | yes now |
| land cover | z12 | 3×3 to 7×7 | rings outward | — | yes |
| vector tiles | z16 | 5×5 to 9×9 + corridor | sorted by wedge cost | gate of 6, wedge-cheapest, ring gate drops | yes, and best of all |
| far shell | z13→z6 | 5×5 | **rings outward** (was raster) | gate of 4, FIFO | fetch order only |
| shell cover | z10→z6 | 5×5 | raster | — | no; cheap |
| overview vectors | z13→z7 | 5×5 | raster | queue | no; chart only |
| summits | z8 | 3×3 + reach | nearest tile per pass | 2 in flight | yes |

**THE BUILD ORDER KNEW NOTHING ABOUT THE TRUCK.** `flushTerrain` took the
dirty set in raster order — row then column, north-west first — because that
is the cheapest way to build an owner before its followers (a follower built
first takes a row its owner is about to replace and builds twice). It is
also why the sea to the north built before the road ahead. The pick is now
the dirty tile cheapest in the vector stream's own wedge (`wedgeCost`:
ahead is cheap, behind is dear), and then walks to a dirty west or north
owner while there is one, at most two hops, so the ownership rule holds
locally and the near tile builds within a hop rather than after the sea.

**A WAY DIRTIED A SIX-KILOMETRE BOX.** `dirtyTerrainAround` marked a 3×3 of
terrain tiles around every eighth vertex of every landing way — nine tiles
of two kilometres for a road twelve metres wide whose earthworks reach
thirty. In a city every vector tile that lands dirties the whole ring, and
the ring rebuilds for every vector tile: 25 of 26 tiles dirty at once in the
telemetry, a rebuild every third of a second. A way now dirties the tiles it
crosses and a neighbour only where a sample stands within the corridor's
reach (`TOE_REACH + cutL`) of that edge. And a way-dirtied tile waits
`WAY_HOLD_MS` (1.5 s) from the FIRST way that dirtied it while the stream is
busy, so the hundreds of ways one vector tile carries build once; a freshly
loaded tile, a cover arrival, a border owner's rebuild and the corridor scan
are not held.

**Measured at the CBD spot, same 240 s through the relay, control against
fix.** Terrain loads are identical (63 builds by t+30 s, 49 tiles). After
that every build is the vector stream's doing:

| | control | fix |
|---|---|---|
| vector tiles landed / ways | 5 / 1,722 | 7 / 2,437 |
| builds after the ring was up | 90 | 17 |
| builds per landed vector tile | **18** | **2.4** |

The relay's network is not the phone's — seven tiles in four minutes where
the device had 216 — so the ratio is the number, not the totals. The Vélizy
capture is the deterministic witness: every way lands in the first frames,
so the churn is bounded by how the flush coalesces them. Same fixture, both
runs settled to the same world (2,945 road cells, 4 corridor tiles):

| Vélizy, 20 tiles | control | fix |
|---|---|---|
| builds | 82 | 51 |
| …of which `way` | 56 | 16 |
| worst tile | 25 builds | 10 |

**And the order is the truck's now.** The first sixteen tiles BUILT at the
CBD, as distance from the truck in metres — control: 534, 2561, 3226, 2034,
4857, 4391, 6172, 9041, 7680, 6669, 6181, 6338, 7098, 8296, 7801, 4161 (its
own tile, then the north-west corner of the box outward, nine kilometres
away before the next ring); fix: 534, 2561, 3226, 2033, 3309, 2163, 4590,
4161, 4992, 4391, 2578, 1501, 2470, 6083, 4743, 4027 — the inner ring, then
the next. Builds follow arrivals, and the DEM gate is still a FIFO, so a
tile fetched late builds late (the 1501 at rank 12 was rank 8 to be asked);
the pick can only order what has arrived.

**`__streamAudit` is the instrument**, and `devtools/stream-audit.mjs` runs
it live at a spot for a fixed budget (`REV=` for a control, which falls back
to `__buildLog` on a revision older than the probe; `FIX=` for a capture).
It reports each layer's ask order as (rank: distance, ahead/behind), builds
per tile and per reason, and the last re-drape's reach.

**What the same telemetry says that is NOT fixed here**, for the next pass:
`drawHud` at 10 ms a frame on the chart — the half-rate gate is 40 ms and
these frames were 54, so it drew every one; `treeRefresh` at 37 ms a call
with the tree rack's DRAW RANGE at 2.8 km, which is the dial's own price;
`redrape` at 39 ms a build in a city, because a two-kilometre tile in the
CBD touches most of the draped footways in the world and every vertex of
each is re-read — fewer builds is the first cut at it, an incremental
re-drape (only the drapes over cells the build actually moved) the second.

## Capturing a real place as a fixture

`devtools/capture-world.mjs NAME --lat= --lon= [--r=700]` pulls the three
fetches for a box — terrarium heights, WorldCover classes, OSM ways — and writes
`client/fixtures/world-NAME.json`. `captured()` in world-fixtures.ts turns that
back into a playable `WorldFixture`, listed in /lab/world as `?fixture=at-NAME`.

**No browser.** All three sources are plain HTTPS: the cell serves the ways and
the cover, AWS serves the DEM. So a capture is three fetches and some
arithmetic, and takes seconds.

Measured on the Big Sur report: a captured world settles in **28 seconds**
against roughly six minutes of live streaming, and is identical every run
instead of depending on tile arrival order. It found in one boot what two
streaming boots had not.

What it deliberately does NOT capture is arrival order. A captured world has
ALREADY ARRIVED — every tile present in the first frame. That makes it useless
for "it only happens on a drive-in, not on a reload" (`devtools/capture.mjs` is
for that, and replays renderWays into the solver) and ideal for everything else,
because a defect that survives a settled world is a defect in the geometry.

**The capture conditions the DEM exactly as the game does**, and did not at
first. `client/demrepair.ts` is the shipping range/spike guard, the patch and
the shape repair, extracted so both readers of the terrarium mosaic run the
same code. The Camps Bay capture is why: the raw tile there scatters a few
dozen pixels from -5,600m downward — 0.5% of the tile, comfortably under the
2% the game refuses at, so the game accepts it, patches those pixels to its own
ground and builds ordinary suburb. The capture kept them and reported ground
running **-7,049m to 399m**. A fixture that reproduces a defect the game does
not have is worse than no fixture: it is a defect report with a fabricated
witness. The capture now prints a per-tile line (raw range, bad, spiked,
repaired) and says out loud when a tile is one the game would REFUSE.

**A fixture streams its own box.** See FIX_R in `main.ts`: the terrain ring, the
cover ring, the OSM ask set and the coarse shell are all held to the fixture's
own extent, fixed at its origin rather than following the car. Before that, a
1.4km fixture built a 5×5-to-7×7 block of z14 tiles — ten kilometres on a side —
and carved every one at one tile per 200ms. And the extent for a CAPTURE is
`cap.r`, not the extent of its ways: capture-world keeps any way that comes near
the box but keeps its whole geometry, so one arterial passing through measured
2,562m for a 700m capture.

**Two streamed layers a fixture cannot answer, and used to ask for anyway.**
`loadOvTile` and `loadPeakTile` go straight to the cell. So every top-view frame
of an authored world fetched the REAL coarse road network and the REAL summits
at the fixture's coordinates — for the authored fixtures that is the country
above Geneva, drawn over a synthetic crossroads, with the Alps on its horizon.
Both are gated on `!FIXTURE` now, and `devtools/fixture-stream.test.mjs` holds
it. Asserted from `__fixworld().built` rather than a request log, because the
harness relays through curl and is structurally unable to witness a request.

`relief 0` on a capture flattens the ground to a plane at the site's mean
elevation and LEAVES THE ROADS WHERE THEY ARE — the same junctions with and
without their terrain, which is a comparison no authored fixture can offer. The
road dials do nothing on a capture: its classes and widths are the evidence.

Each capture is a couple of hundred KB in the bundle. Fine for one, not for
twenty; at that point move them to `static/` (which ships verbatim now that
binary assets work) and fetch at boot.

## A junction is reconciled twice, and the second time undid the first

Reported from Camps Bay: node steps of 2.18m and 1.81m where two residential
streets cross, and "overlapping" carriageways down half the hillside. It took
three instruments to attribute, and each one overturned the reading before it:

| probe | what it says | what it showed |
|---|---|---|
| `__joinwhy(x,z,r)` | every fragment END built near a point — anchor found, at what distance, chain hint, weld residual, at BUILD time | 360 ends, 169 shared-node pairs, **zero** same-road pairs over 10cm. The end weld works. |
| `__hintsAt(x,z,r)` | every chain hint at a point, with its value | at the eight worst steps both chains AGREED — `0.404, 0.404` at a node built as `1.81` and `-0.373`. The planner works. |
| `__stagewhy(x,z,r)` | a through-node station after every stage of the per-way build | the GRADE LINE (`eng = wide(wide(prof))`, a ±200m running mean) overwrote 128 of 179 lost pins. |

The through-node case is the one the end weld cannot reach by design
(`deckAnchorAt` is ENDS ONLY; reaching along a segment was tried and reverted),
so a crossroads depends entirely on the planner's junction pin surviving the
per-way build. The ends were always protected (the grade line's `pin` fades to
zero there), which is exactly why fragment ends weld to 4cm while through-nodes
step by metres. The 4cm is `SURFACE.road.lift`.

Two lessons that generalise:

- **A post-hoc probe at a seam reports the store as it is now, not as it was
  when the fragment built.** `__sharedAt` recorded that after four earlier fixes
  moved nothing. Both `joinLog` and `stageLog` are written from inside the
  build for that reason, as `cropLog` was.
- **A settle gate on the carve is not a settle gate on the roads.** `dirty`
  reached 0 at t+63s and held; `roadCells` went 171 → 2012 over the next two
  minutes. Every junction number read at the old gate described an eighth of a
  world and undercounted in the direction of "no problem". Wait for `dirty`,
  `seenWays` AND `roadCells` to stop moving.

And the `__overlap` "lengthwise seam" mostly is not one: of the six worst, four
are a KINK at a welded node — the per-way pipeline seats one fragment's end
0.6m off its chain hint, the weld pulls it back, and the correction is spread
along the whole fragment, so one side leaves the node at 19% and the other
arrives level. `__overlap` compares segment midpoints and reads that as a height
gap. Two of the six are genuinely side by side (Kloof Road's hairpin arms).

`layer` was kept in `KEEP_TAGS` and read nowhere. The pin rule was purely
spatial, and at the Vélizy interchange 10 of 44 grade-separated crossings put a
flyover station inside the 3m pin radius of the road beneath — the grade line
was un-welding those by accident, which is why holding pins and reading the
layer had to ship as one change. `layerOf` in roadsolve.ts is the rule.

**The fix, measured.** A station carrying two same-layer chain hints is held
through the grade line, the deviation clamp, the seat, the edge smoothing and
both per-way grade rulings, and the end weld spreads its residual only as far
as the nearest held station. Same fixtures, same probes, same settle gate:

| | before | after |
|---|---|---|
| Camps Bay node steps >10cm / >30cm / worst | 32 / 5 / 2.18m | 27 / 1 / 0.47m |
| Camps Bay pins lost through the per-way build | 179 of 262 | 24 of 262 |
| (42.1,270) Eldon / Cheviots decks | 1.81 / −0.373 | 0.404 ×4 |
| junctions (authored crossroads) steps >10cm | 4 of 4 meets | 0 of 792 joins |

The 0.47m left is a through-node whose two CHAINS disagree by 7cm — the
planner's residual. The 15 grade-line movers left are stations whose partner
chain's station is more than 0.3m away, which is a bend rounded by densify; the
`hintsNear` radius is the lever, and widening it blindly holds the wrong
station. `devtools/through-node.test.mjs` holds the bars one notch above these.

Two numbers that looked like the fix's doing were not: `__steep` reports an
89% segment on The Cheviots Road and the seat log a 10.67m end on Shanklin
Crescent after the fix. An A/B on the parent commit (the harness's `rev`, which
rebuilds main.ts from git) reproduces both exactly — 89% at (106,407), 10.67m
at (81.5,128.1) — and the fix took the seated-end count from 55 to 32. Both are
the seat moving a fragment END, which the ruling grade exempts by construction.
Attribute with the A/B before believing a probe you have no baseline for.

**And the pin learned the layer.** Hints carry the layer they were solved on
(`layerOf`: `layer=*`, else `bridge=yes` is above and `tunnel=*` below), per
STATION — OSM splits a road at its bridge and the planner chains the pieces by
name, so one chain runs at grade, over the flyover and back. The planner pins
and the per-way lookup stay on their own layer; the end weld is layer-blind on
purpose, because a portal joins its approach across a layer change. This had to
ship with the hold: at Vélizy the pin rule was welding flyovers to the road
beneath and the grade line was un-welding them by accident.

**What the layer does NOT do on its own is lift anything.** Vélizy after the pin
fix: the N 118 (`layer=1 bridge=yes`) over the A 86 at deck 1.35m on ground
1.34m. A tagged bridge is a chord between portals that anchor to at-grade
approaches, and OSM carries no elevation. The lift — the chord rises so every
station clears the highest lower-layer deck beneath it by `BRIDGE_CLEAR`, read
from the planner's hints; higher layers build first so the approaches weld UP
to the portals — is its own change, `__lifts` reports it.

## The per-way build reads the chain — and eleven ways it did not

The chain planner is the only thing in the pipeline that knows about more than
one road at a time. Everything the per-way build does with a junction rests on
reading the planner's answer back correctly, and eleven separate mechanisms were
quietly failing to. Each was found with an instrument, on the Camps Bay and
Vélizy captures, and each fix was measured on a pinned control (see the harness
note below):

- **`ruleGrade` floored every span at ONE METRE.** `densifyPts` rounds a bend
  with `r = 0.45 × leg`, so between two consecutive bends it leaves a straight
  of `0.1 × leg` — 0.53m on The Cheviots Road — and under a 1m floor that
  station may rise a full metre's worth of grade. The fixture's worst seam
  (0.53m) and its 100% segment were that one station. The floor is 0.1m now.
- **`hintAt` was the nearest chain STATION within 2.5m.** A per-way station on
  a straight leg found one only when the chain's densify was in phase with the
  way's own — which it is exactly when the chain begins where the way begins.
  Where the chain has rounded a corner, or started three ways back, its
  stations along a 12m-stepped leg sit anywhere up to 6m from the way's and the
  way loses its hints on a coin toss: an 82m two-node piece of Shanklin
  Crescent came out under the 80% hint gate, fell to the single-anchor branch,
  was held LEVEL at the deck its far end had found, and its hinted neighbour
  welded 10.6m up to meet it. Hints carry their chain and index now, and
  `hintAt` projects onto the segment to the next station as well: the deck
  between two stations IS the straight line the ribbon draws.
- **A junction was "two hints within 0.3m".** Two chains only both have a
  station on the node when neither rounded a bend there; the through road's
  arc puts its stations `r(1 − cos(turn/2))` off the node — 0.3m at a
  30-degree bend of a 9m arc, 2.6m at a right angle — so the fifteen
  through-node stations the grade line was still moving were all at bends.
  `chainsNear` counts DISTINCT chains at the planner's own pin radius, by the
  same point-or-segment distance `hintAt` reads.
- **The flyover lift was a step at the portal.** Raising the chord as one
  piece works when the approach builds after the bridge and welds up to it,
  and cannot work when the approach built first, at grade, from another tile —
  measured at Vélizy with the layer, the defer and the build order all in: one
  portal still 5.9m above the approach it was anchored to. The deck now climbs
  from the portal at the ruling grade and is at clearance by the crossing (the
  two-pass cone); the portals rise only by what the ramp cannot absorb, and
  `__lifts` reports that residual per portal.

- **The host warp faded by STATION, after the last logged stage.** Once the
  ends are welded, a way's last stations are eased onto the host road's plane
  with a weight of `1 − k/5` — written for 12m stations and read as "about
  sixty metres". On a bend the arcs put stations 2.4m apart with the 0.1×leg
  straight between them, so a fifth of the whole disagreement with the host
  landed on the half-metre station: an 86% segment that `__fragwhy` showed at
  19% one stage earlier. The fade runs over sixty metres of ground now and is
  logged as `7-warped`. Anything that moves the profile after the last
  `stage()` call is invisible to every instrument; log it or do not add it.

- **And the same warp faded THROUGH junction pins.** Where Eldon Lane crosses
  Shanklin Crescent 22m short of Eldon Lane's end, both chains agreed at
  12.765, every logged stage left the pin within 16cm, and the built deck
  stood 1.02m off: the fade had reached back through the held station toward
  the host plane at the end. It stops at the first held station now — the
  rule the weld spread already follows.

- **A portal's hint was on the bridge's layer only.** The shared node is one
  chain station; once it carried the bridge's layer, the approach — asking for
  its own layer at its own end — found nothing there, and at Vélizy the
  approach's deck was absent at the N 118 portal after the world settled. The
  station's value is the chain's, one profile for both members, so it is
  written once more under the neighbouring station's layer wherever the layer
  changes; `hintAbove` still sees the bridge's layer there, so the approach
  still waits for the portal.

- **The tunnel/bridge chord wrote through pins.** Portal to portal, every
  station between, held junction stations included — on Eldon Lane the one
  stage that moved a pin both chains agreed on (12.765 → 12.343) while every
  stage that knows about `held` left it alone. The chord runs between
  consecutive pins now.
- **The warp's plane was extrapolated sixty metres and believed.** Three
  samples on a curving host, extended along the way, stood 1.8m under Lower
  Kloof Road's through-stations — stations that agreed with their own chain to
  the centimetre — and the fade pulled them down to it: a 139% segment on a
  road whose end had welded to the host within 4cm. No station moves further
  than the residual measured AT THE NODE now; the plane only shapes the fade.
- **Equal-width roads cropped each other.** A tie defers to whichever is
  built, but the pre-grid answers for a host that has NOT built, so two equal
  roads meeting in one batch each found the other and both cropped: where
  Blair Road turns into Shanklin Crescent, `__cropwhy` logged `cropped` from
  both ends of the same node and the corner was drawn by nobody — the hole in
  the carriageway reported from the seat. The first to build leaves a tie
  alone, and nothing crops against a host that ENDS at the same node (a
  corner is not a T).

**Measured, same fixture, same three-signal gate**, from the chain of pinned
runs (each commit's own control was the commit before it):

| Camps Bay | before | after all ten |
|---|---|---|
| node steps >10cm / >30cm / worst | 26 / 1 / 0.53m | 8 / 0 / 0.19m |
| through-node pins left >10cm / worst | 24 / 1.52m | 5 / 0.40m |
| ends seated >30cm off hint / worst | 26 / 10.67m | 6 / 1.60m |
| segments over 20% / over 50% | 106 / 7 | 41 / 1 |

Not every step helped on its own: reading hints along the chain uncovered a
1.02m step at a pin that the warp had been hiding, and the arc-length fade
made the warp reach further before it learned to stop at a pin. Attribute per
commit, on a pinned control, or the middle of a sequence reads as a regression.

- **A crumb anchored only to BUILT decks.** The short-fragment branches read
  `deckAnchorAt` and nothing else, so a crumb that built before the road it
  joins found no deck at the node — Vélizy's worst seam after everything
  above: a three-station unnamed piece, one hinted station of three so
  under the gate, held level 0.92m under the planner's pin at its own end.
  The pin IS the deck the through road will build to; a hinted end now
  serves as the anchor where nothing is built yet. Vélizy: pins left >10cm
  18 → 7, seated ends off hint 54 → 39, worst seam 0.92 → 0.41m.

**Vélizy's build is order-dependent and Camps Bay's is not.** The same
commit measured 10 / 2 / 0.41m drawn and 12 / 3 / 0.92m without drawing at
Paris, because which fragment builds first decides who anchors to whom, and
the frame rate changes that order. Camps Bay reads identically both ways.
The fix above removed the worst of the order dependence; the rest is the
reason to keep measuring on the same path every time.

`__fragwhy(x, z, r)` is the instrument that found most of these: every fragment
with a station within r, its way key (`wid`, for `__wayTags`), its branch,
its anchors, its hint coverage, and each such station — with its `x, z` — after
every stage. `__stagewhy` could say which stage moved a
PIN; it could not say why a segment eight metres from any pin stood at 100%.

**A control is the revision's WHOLE client.** `openDrive({rev})` used to write
the old `main.ts` beside the CURRENT siblings, so a control built that way
measured the old `main.ts` over the new `roadsolve.ts` — no control at all once
the change under test lives in a sibling, which every one of the four above
does. It unpacks the revision's entire `client/` under `node_modules/.cache/rev`
now. A measurement chain that reads the working tree at each run's start is
not pinned either: pass `rev` explicitly and queue the runs, or the third run
measures whatever you were editing when it started.

**Two shell habits that cost a run each this session.** `kill` by pattern from
inside a compound command matches the command itself when the pattern is in
its own text (`pgrep -f "until grep"` found the shell that was running it, and
the exit code 144 was the shell dying). And a measurement queued with
`(until …; do sleep; done; node run.mjs) &` reads `run.mjs` and the working
tree when the loop ENDS, not when it was queued.

**A Paris run at 130 polls is not settled, and said nothing.** `after.mjs`
capped its three-signal gate at 130 × 3s; Camps Bay settles at ~170s, the
paris-south capture (16 tiles, 1,078 highways) does not settle in 390s, and the
script printed a `settled` line only on success — so three Vélizy
"measurements" were of three different partial worlds (5,608 / 5,255 built
segments, 208 / 198 chains) and the comparison between them was noise dressed
as a result. The cap is `SETTLE_POLLS` now and an unsettled world is named as
such with its counts. Look for the `settled` line before reading any number
under it.

**The chase camera under a flyover is inside its slab.** A structure's beam is
`1.15m + 0.085 × daylight` deep (1.6m under a 5.5m deck), so the soffit sits
around 3.9m up and the chase camera, 3-4m above the car, renders the slab from
inside: a black band across the frame and a flat tinted wall. It looks like a
wall to the ground; it is not one. Judge clearance from `__joinAt` decks or a
top view, never from the chase frame under a bridge.

**Vélizy, settled, on the deployed lineage (`c050297`, t+654s, 9,318 joins):**
39 node steps over 10cm, 17 over 30cm, worst 1.20m; 67 segments over 20%.
The portal defer works there: four approaches built after their bridges and
welded up 2.8–4.4m onto the lifted portals, and the one cross-tile approach
that built first has the bridge eased down onto it by the warp (a 2.08m
residual, under `GRADE_SEP`). Any Paris number without a `settled` line
beside it is from a partial world — see above.

### Senqu: a road with no chain, and a crumb held level

The live spot `?lat=-30.75509&lon=27.68403` (rural Lesotho, an unnamed
unpaved tertiary) drew a trench with no carve in it on one visit and a flat
road on the next — reported as "terrain is not carving". Neither the carve
nor the junction work was involved; `senqu-21ce3a9` (before all of it) has
the same trench. Two mechanisms, both found with `__fragwhy` at the truck and
then at BOTH ends of the fragment under it (`senqu4.mjs`, now with station
coordinates and `__wayTags(wid)`):

- **The planner wanted the WHOLE way under loaded ground.** `__chaindbg()`
  read `considered: 23, noHeight: 23, chains: 0, dropped: "(unnamed)
  [tertiary] 285pts" × 12`. A rural way runs for kilometres and always has a
  node past the loaded DEM, so every way here was dropped and nothing had a
  hint. The planner now cuts a way into the runs whose nodes AND densified
  stations have ground under them; each run is a member keyed
  `id:from+count` (the whole way keeps `id`), and a run that grows as ground
  streams in is a new key, so it is fresh and solved again wider.
- **A crumb was sixteen STATIONS.** With no hints, a fragment of ≤16 stations
  took the crumb branches: ramp between two anchors, hold LEVEL at one, or
  the bench. At Chapman's that is a 40-55m gallery piece; at Senqu it was a
  15-station, 110m piece of hillside with 10.7m of ground fall along it.
  Built after its neighbour it was held level at the shared node and stood
  11m over the ground at its far end (`branch=-12.509` at every station,
  ground −13 → −23.7); built after the far tile instead it was held level at
  −23.8, sat 10.8m under the hill at the shared node, and the neighbour then
  welded −11.3m down to it — the trench, and `tn` (no carve) because burial
  past `TUNNEL_H + 0.6` is left under the hill by design. The crumb gate is
  `n ≤ 16 && fragM ≤ CRUMB_M (70m)` now; a longer piece is solved.

Measured after both fixes, two runs, identical: `noHeight: 0`, one chain of
12.4km, every fragment at the spot `pb=1` with every station hinted, the 110m
piece running −13.0 → −23.8 with the ground, the deck within 1.4m of the
ground along all of it, and no weld residual anywhere on the road.

The weld itself was not the fault: it spread a residual that was true of the
deck it found. Refusing large residuals was considered and not done — it
trades a buried road for a step, and the step is not more drivable.

**Where the burial rule reads.** `elevMin[i] − prof[i] > TUNNEL_H + 0.6`
(5.6m, lateral minimum of three ground samples at `halfW`) on an untagged run
sets `tn` on those segments: `rasterizeCut` returns, no tube (a tube needs
`tunnel=*`). It is the right rule for a road the solver put under a hill —
the alternative is a permanent crater — and `__buried(r)` counts what it hid.

## The corridor is in the terrain

The structural job every batter pass was standing in for. A terrain cell is
8-15m and a road's cross-section is metres wide, so while the corridor was
something the carve did to a regular grid, every kerb sample dragged whole
cell corners down and left a bench — a flat shelf a cell wide beside every
road — which the batter strip then hid with a sheet, three times over.

Now (`refineTileGeometry`, `?refine=0` for the old grid + carve):

- **Break lines.** Every strip contributes its crest (the shoulder's outer
  edge, `hw + 0.6`) and its toe on both sides; the toe is where the batter's
  wedge — a face at `CUTF_K` up to the ground, a bank at `BANK_K` down to it
  — meets the field (`toeOut`, cached on the strip as `bl`). A crest more
  than `DECK_GAP_T` above the ground is a structure and gets no toe.
- **Cells split along them.** Each cell a line crosses is a convex polygon
  split by the line (`splitPoly`), and every polygon is fanned from its
  CENTROID — a fan from a vertex leaves the collinear points on that vertex's
  own sides out of every triangle, which is a T-junction. Points landing on
  a cell boundary are recomputed from the line and the boundary coordinate
  so the neighbour, split by the same line from different pieces, gets the
  same point to the bit; a millimetre key then makes it one vertex. A plain
  cell that shares an edge with a split one fans its augmented ring from
  its centre. No T-junctions inside a tile; across tiles the same lines
  produce the same edge points.
- **One profile for every height.** `corridorH(x, z, N)`: under a
  carriageway or its shoulder the deck floor (dug to where the ground stands
  above, raised to where it falls away so an embankment is solid — unless
  the road is a structure or the ground is water); outside it the wedge,
  and the ground past the toe. The carve is skipped on a refined tile: the
  surface is the profile by construction. Kinds ride with the vertices — a
  cut face is tinted toward earth and shaded by its own slope, a bank by
  its own; the batter strip, targeting `groundAt`, then finds the ground at
  the crest and draws nothing.
- **Lookups stopped assuming the grid.** `cellTrisOf(geo, SEG)` is a
  per-geometry table of any number of triangles per lattice cell, built at
  emission time for a refined tile and from the index for a plain one;
  `meshSurfaceAt`, `meshTriAt`, the carve's `enforce` and `carveChannels`
  read it (`carveChannels` by vertex position now). `segOf(geo)` reads the
  lattice resolution off the geometry.

- **Near the truck only, stitched beyond.** A tile within `REFINE_R`
  (1100m, `?refr=`) of the truck at build time takes its corridor; further
  out it keeps the plain grid and the carve, and STITCHES to any refined
  neighbour: every refined tile stores its border vertices
  (`refinedBorders`), a plain tile built beside one takes those points into
  its border cells' rings at the neighbour's heights (re-pinned after its
  own carve), and a plain tile that was built first is dirtied when the
  refined neighbour lands. A plain tile that comes into range is rebuilt on
  the quiet path, one per visit, and one no road reaches is flagged so it
  never rebuilds for nothing.

- **…and only once the road stream is quiet.** Every way that lands dirties
  the tiles it crosses, so during a stream the in-range tiles rebuild a
  dozen times each: Vélizy ran 209 tile builds for 30 tiles with a corridor
  build costing 350ms in that density, and gating the neighbour rebuild on
  the border differing changed nothing (212 → 209) because the churn was
  never the cascade. `corridor` now also needs `osmStreamQuiet()` (nothing
  in flight, and no road landed for 2.5s — not "nothing queued", a tile on
  a retry backoff would hold every corridor off); a tile built plain
  meanwhile is rebuilt with its corridor by the quiet path, once. The tile's
  `corridor` flag records INTENT: a corridor build that found no break
  lines is still done, or the quiet path would dirty it on every visit.

- **T-junction repair.** A cell's line list is capped at 16 (widest roads
  first), so the cell next door may keep a line this one dropped — or lie
  in the next tile — and a point then stands on the shared edge for one
  side only: black dashes along the horizon at Vélizy, pure (0,0,0) in the
  frame, which is the void through a crack and not a shading seam. After
  every cell has split, each refined cell takes every point any neighbour
  put on its edges (`edgePts`, the same store the plain rings read, seeded
  with the next tile's border) into the side of the polygon it lies on.
  The vertex-fan shortcut is judged on the ring AFTER that.

- **The field is read inside the tile's own box.** A vertex exactly on the
  border is outside the tile's half-open box, so `sampleHeight` looked to
  the neighbour and answered ZERO while the neighbour's DEM had not loaded;
  stored as the border, pinned into the neighbour, taken back as a seed on
  the rebuild, that zero lived for ever — measured at Vélizy as border
  vertices 18m and 89m off the field with the row inside within 3m, and
  drawn as a dark line along every tile edge that the sun march, the shadow
  map, the normal map and the vertex colours were each cleared of in turn
  (`layers.mjs`, `ab.mjs`: hide the terrain and the line goes; nothing else
  moves it). `fieldAt` clamps the read a hair inside the tile; break lines
  are cached only once the ground is under both crests.
- **Every border has one owner.** Two corridor tiles computing the same
  border row from their own raster edges and their own line sets disagreed
  by up to 0.91m with 41 points missing (`__borderDiff`). The west and the
  north tile own a shared border; a corridor tile follows only the owners
  of its west and north edges (seeds and pins), a plain tile follows every
  refined neighbour, a follower's own extra edge points are pinned onto the
  owner's polyline, and only an owner dirties a follower (`borderShared`).
  Vélizy after: worstDy 0, worstGap 0 on all four edges.
- **…for EVERY tile, not only refined ones.** The clamp-inside read on its
  own made the two sides of a plain border read rasters a DEM pixel apart —
  the old code read one raster for both by the accident of a half-open box
  — and on a Lesotho hillside that was a wall of metres along every seam,
  seen from the drone the morning it shipped. So every tile stores its
  border (`storeBorder`), every tile pins its west and north edges to the
  owners' rows (`refinedBorderPins`, or seeds in the refined build), and
  every build dirties its east and south followers whose rows differ. The
  read itself is back at the EXACT edge where the field has a tile — the
  half-open box hands a border point to one raster for both sides — and
  falls inside only where that raster is missing; the quiet path audits one
  tile's followers per visit (`borderAuditAt`), so a follower that took a
  row its owner then rebuilt past is caught whatever the build order did.
- **A border point is matched WITHIN a millimetre, in Float64.** The rows
  were Float32 world coordinates keyed by millimetre cell. At 3.4km from
  the origin a Float32 x steps by 0.24mm, so the two tiles' copies of one
  lattice point rounded to different cells: NOTHING in the owner's row
  matched, nothing pinned, `borderShared` said no, and the audit rebuilt
  the follower every 800ms for as long as the page lived (Camps Bay,
  9027/9834 — 84 of 173 builds in the ledger, invisible to a dirty-count
  poll because each build clears the flag in the same slot). Rows are
  Float64 now, every lookup (`mmNear`) takes the nearest point within
  1.5mm across the neighbouring cells, the vertex pool does the same, and
  the audit gives a follower three tries and then leaves it alone — a
  seam that cannot converge must never become a rebuild loop.
- **A seed is on my EDGE, not on its line.** The seed filter accepted any
  point of an owner's row on the infinite line of one of my edges, so a
  tile took its north owner's whole east column: phantom vertices a
  hundred metres outside the box, pinned, stored as its border, and fanned
  into the corner cell's ring. They are what `__borderDiff` reported as a
  3.5m "mismatch" between two corridor tiles at Camps Bay — two phantoms
  from two different owners, used by no real triangle. `onTileEdge` gates
  seeds, pins and stored rows.
- **The settle criterion is the BUILD COUNT.** `__tstats().builds` counts
  every build; `__refine().tiles` counts refined ones, and a plain rebuild
  loop is invisible to it. `__buildLog()` is the last hundred builds with
  the reason each was dirtied (`way`, `tile:`, `owner:`, `audit:`, `scan`,
  `cover`) — read it before believing any seam measurement: a page that is
  still rebuilding has not settled, whatever the dirty count says.

- **THE BUILD LIVES IN `client/terrain-kernel.ts`.** Everything a tile
  computes — lattice or refined geometry, heights, both carves, border
  ownership, the colour pass, vertex normals, the normal-map bytes — over
  plain arrays and a `TerrainStore` of world facts, with no THREE and no DOM.
  main.ts supplies the store (`kStore`, getters onto its rasters, strips,
  channels, palette, area tints, road grid) and does only what a renderer
  must: wrap the arrays in a BufferGeometry, place the mesh, dirty the
  followers. That split is the whole point: the same kernel runs in a worker
  next (docs/terrain-worker.md). Measured before the split, a plain build
  was 108 ms of which the colour pass was 69 and the heights pass 24 —
  lookups, not arithmetic — with 17 ms of post-steps that stay on the main
  thread. Anything the kernel needs from the world goes through the store;
  a module global of main.ts read from the kernel would silently break the
  worker.

- **A cell table counts TRIANGLES.** The kernel's plain lattice wrote its
  `offs` in index entries (six a cell) where every reader — `meshSurfaceAt`,
  the carve, the batter — walks `offs[c]..offs[c+1]` as triangles and reads
  `tris[h*3]`. Every plain tile's surface read landed three cells past its
  own and then off the end of the table: undefined vertices, a NaN ground
  under the first wheel, the chassis NaN latch firing twice, and the frame
  loop dying on a non-finite radial gradient at 443ms — which is why every
  Chromium test then saw an empty world (joins 0, "settled NEVER"). The
  parent commit passing under the same network was the proof it was mine.
  `__kernelCheck` had said the lattice matched PlaneGeometry to 6e-14 and no
  position was non-finite, both true: it is the TABLE that was wrong, and a
  probe that scans positions cannot see an index bug. `__nanTrace()` is the
  tracer that found it — it records the first non-finite intermediate in
  the chassis step with the surface read's working (`meshDiag`).

- **THE BUILD RUNS IN A WORKER** (`client/terrain-worker.ts`). The kernel
  is one closure, `createTerrainKernel`, embedded as text in a Blob worker
  like the road profile worker — nothing inside it may touch a module
  binding of terrain-kernel.ts or the worker throws on its first job.
  Rasters are mirrored once; strips, channels, areas, pads, a climate
  raster and the palette state travel with every job, so nothing can go
  stale. The main thread's share of a build fell from 125 ms to 5 ms plus
  the post-steps (17–30 ms), which are the residue now. `?tworker=0` is the
  synchronous path and the A/B; `__tworker()` the ledger. The harness's
  software renderer starves the worker (seconds of wait a job): measure
  throughput with `nodraw=1`, cost with rendering on, never the two from
  one run.

- **WHERE THE FRAME GOES: `__frameprof()`.** Milliseconds per call site
  since the last read, with the worst call — the frame loop's subsystems
  and, outside the loop, the road build slices, the terrain apply and the
  hydro builds. Read it in three windows (boot, streaming, quiet). In the
  harness the `render` row is the software renderer issuing draws and the
  wall time is seconds a frame; only the other rows carry to a device.
- **THE POST-STEPS AFTER A BUILD** were one thing: `hydroFeed` sampling a
  132×132 elevation raster on the main thread — 20 ms of a 20 ms residue;
  reseat, redrape, batter and culverts are each under a millisecond. The
  worker samples that raster with the build (`hydroElevation`) and hands it
  back; a starved refeed asks the worker for the raster alone. What is
  left is the hydro system's own work: 6 ms of analysis in `upsertTile`
  and a 13 ms tile build (max 41) that used to run in the promise job
  right behind the apply, invisible to every frame timer. It now runs from
  the frame loop's own queue, one a frame and never in a frame with a
  terrain apply (`drainHydroJobs`).
- **A BUILD'S MAIN-THREAD SHARE IS PACED BY TIME, NOT FRAMES — ON THE
  WORKER PATH TOO.** With the build off the thread the reply zeroed the
  pacing so the next tile went out on the next frame, which read as a win
  here (5 ms a build) and put the device under 10 fps for the length of
  every stream: packing, apply, the hydro analysis and the hydro tile build
  are ~25 ms a build on this machine and three times that on a phone, once
  a frame instead of five times a second. `workerGap` is three times the
  last build's own main-thread cost, clamped to 100–400 ms, and the hydro
  drain keeps half of it. The harness cannot see this class of regression:
  its frames are seconds apart, so "once a frame" is rarer there than the
  old floor. Anything that changes how often per-build work runs needs the
  device, or an FPS number from `__clock`, before it ships.

- **TELEMETRY IN PLAY: double-tap the FPS readout.** The profiler keeps a
  session aggregate the windows never reset: per phase, total ms, calls,
  max, and — the part that isolates a contributor — the ms it spent inside
  frames over 50 ms and how often it was the largest thing in one. The
  tick is sectioned with `profMark` (sim:drive, sim:collide,
  sim:suspension, lamps, world:fx, world:stream, camera, hud+misc,
  draw:misc): a mark claims everything since the previous one that no
  wrapped call inside it already took, so inline code shows up by name.
  What nothing explains is two rows, not one: `tick residue` (tick code no
  mark covers — it reads 0 now) and `gap (unmeasured)` (wall time between
  frames that no wrapped call accounts for: the GPU's wait, vsync, GC,
  layout, the browser's own scheduling — any of them). Off-tick tasks are
  wrapped too (terrainApply, hydroRefeed, tileDecode, coverDecode, osmParse)
  and counted against the frame that paid for them. **The gap cannot
  establish a GPU bottleneck.** It was labelled `gpu/vsync/gc` and read as
  "the CPU-or-GPU verdict" here; the other agent's polish pass relabelled it
  and withdrew the claim, and the claim was wrong: unmeasured time is a
  residual, and a residual has no cause until something measures one. The
  same pass moved the frame boundary to the tick's entry time
  (`performance.now()` rather than the animation timestamp, which can
  precede the callback), counts a slow frame at 50 ms inclusive so it
  agrees with the histogram, and reports the percentiles as the RECENT
  window they are. So a device report from before 2026-09-07 is not
  comparable to one after it on the gap row or the slow-frame count.
  The first device report (iPhone, 153 s) had 70% of wall time in one
  undifferentiated row and could not say which; with p50 28 ms and ~8 ms
  of JS a frame, most of it was vsync quantisation (a 17 ms budget missed
  by a little costs a whole 33 ms frame). A double tap on the FPS figure
  copies the report to the clipboard, or opens it in a text box where the
  clipboard is refused; `__telemetry()` returns the same text for the
  harness. Read the "in slow frames" columns first: a phase with a small
  total but a large slow-frame share is the one causing drops; the slow
  frame log names each frame's top three, so stacked jobs show as such.
  The second device report (Chapman's run, 40 s) read: tick 8.8 ms/frame
  p50 5, gap 14.6 ms/frame (60% of wall, the vsync/GPU side), and the
  slow frames were the SWARD SWEEP (15–26 ms a frame for twelve frames,
  17 of 41 slow frames) stacked on a hydro build (8 a second, 7.8 ms) on a
  vsync-quantised gap. drawHud was the largest steady tick line after
  render at 1.9 ms every frame.

- **INLAND WATER FOR HYDRO COMES FROM THE COVER.** The terrain painter
  paints every WorldCover class-80 pixel; hydro was handed OSM ways and the
  ocean mask only, and the mask refuses class-80 pixels above the sea datum
  or landward of the coastline — an estuary is landward by definition. At
  George (measured through the cell's cache) the OSM tiles held one river
  centreline with no width, the cover a band 110–270 m wide. Now every
  ocean-mask build hands the refused class-80 pixels to
  `client/inland-water.ts`: four-connected components, rings traced along
  pixel edges (water on the right; right-most turn at a checkerboard
  corner), collinear merge, one Chaikin pass, Douglas–Peucker at 0.2 px.
  `coverWaterFeed` (main.ts, above `oceanMaskFor`) registers them as
  `landcover` features, `lake` or `river` when a flowing OSM line runs
  through (and `coverWaterReclassify` flips a lake to a river when the line
  arrives later). The signature is the inland mask XOR the count of pixels
  the DEM answers for, so a lake with no ground under it yet is skipped and
  retraced when its tiles land. `hydroFeed` builds the mask BEFORE gathering
  features, or a tile's first feed misses its own lakes. `__hydro().landcover`
  has tiles/feats/rivers/pixels/pts/maxPts/traceMs. Known seam: a body split
  by a cover-tile edge (~10 km) is two ids and may settle two levels.

- **A FLOWING AREA TAKES THE NEAREST PROFILE'S LEVEL.** A riverbank or a
  cover reach of kind `river` has no profile of its own; build-tile used bed
  plus nominal depth per texel, a surface copying every DEM wrinkle. Where
  a centreline profile is within reach (the same search that gives the area
  its river space) the texel takes that profile's level, capped at the
  thalweg bed plus nominal depth like the line branch.

- **AREA COVERAGE IS A SCANLINE FILL, NOT A DISTANCE.** An area's coverage
  was a signed distance to its rings per texel — O(texels × points), 177 ms
  for one hydro tile in the harness once a cover lagoon arrived. It is now a
  4×4 sub-sampled even-odd scanline fill (`areaCoverageRaster`), O(rows ×
  edges), and dry texels skip the nearest-profile search. Harness: 19.6 →
  15.1 ms mean, 177 → 69 ms max.

- **WATER RELATIONS ARRIVE IN v4 TILES.** Anything larger than a pond is a
  `type=multipolygon` relation in OSM, and the tile query fetched ways only.
  The proxy query now adds `relation["natural"="water"]` and
  `relation["waterway"="riverbank"]`; `osm-rings.ts` joins the member ways
  into closed rings (an unclosable chain is dropped, a relation over 6000
  points is dropped — the cover gives hydro the giants) and `trimWays` emits
  them with a NEGATIVE id (ways and relations share a number space), the
  first outer ring as `geometry`, and `rings` for the polygons. The client
  fetches `/~/osm/v4/`, its IndexedDB key is `6/…`, `OsmWay.rings` rides
  through the cache, `KEEP_TAGS` keeps water/width/intermittent/seasonal/
  tidal/water_level, and `noteHydroWay` hands the rings to `extractOsmHydro`
  as `polygons` in local metres. `devtools/osm-rings.test.mjs` and
  `devtools/inland-water.test.mjs` are the unit tests.

- **A HYDRO BUILD IS PROFILED, AND A WIDE RIVER WAS 292 MS OF IT.** The
  third device report (De Hoop / Breede River, 160 s): hydroBuild 292 ms a
  call, 332 calls, 61% of wall, every slow frame 350–600 ms. The v4 tiles
  had just brought the Breede River `water=river` relation (1830 points,
  300 m wide) into every tile along it, and the flowing-area path — which
  had never run before, since relations were never fetched — searched every
  profile in the tile for every wet texel: 12k texels × candidates ×
  `sampleProfileAt` at 3 search cells. Reproduced OFFLINE to the millisecond
  (281 ms) with `node_modules/.cache/hydrobench.ts`: the real v4 tile JSON,
  a synthetic DEM, `analyseHydroTile` + registry + `buildHydroTile`, and
  `HYDRO_BUILD_PROF` (also `__hydro().buildProf` on a device) split by
  phase. The harness could not: Overpass was refusing the fills. Three
  cuts, measured on the same bench: candidates chosen once per area by
  reach and skipped per texel by bounds; the search once per 2×2 texel
  block with each texel's distance, side and station derived from the
  block's segment (`BlockHit`, the centreline seam stays exact); the
  scanline raster walking only the edges that cross the tile's rows; and
  `paint` reading per-body constants once (`constsOf`) with the caller's
  ground sample. Worst tile 281 → 42 ms, typical 10–20 ms. The benchmark is
  the tool for the next one of these: a phone number with no harness
  reproduction is a bench run away.

- **A FOOTBRIDGE IS A BRIDGE, AND A COVERED BRIDGE IS STILL ONE.** Reported
  from the A6 at Rubigen (`?lat=46.88905&lon=7.54015&h=345`): a dark slab
  across both carriageways. Three things stood between a `highway=footway
  bridge=yes layer=1 covered=yes` way and a lift over the motorway, found
  one at a time with `__fragwhy` (which now logs `2d-chord` and `2e-lift`
  stages), `__lifts` and `__hintsAt`: tracks took mode `'none'` whatever
  their tags said (renderWays), so no chord and no lift; `deckBelow` in
  roadsolve measured the distance to chain STATIONS twelve metres apart
  with a footway's 2.25 m radius, so a narrow bridge crossing a motorway
  almost never found the deck beneath — it projects onto the chain segment
  now, as `hintAt` does, and the lift samples every three metres along
  each leg, clear of `PORTAL_R` (8 m) of either portal so a river bridge
  does not lift off its own approach; and `canopy` (covered=yes) skipped
  the chord block — right for a Chapman's gallery at grade, wrong for a
  roofed bridge, which now chords and lifts and wears its roof on the
  lifted deck. After: the covered footbridge lifts 4.74 m over the A6 with
  its portals raised 3.4 / 3.0 m; the plain footbridge beside it 0.12 m.
  Verifying any of this takes a 300 s harness run at the spot — the roads
  there take that long to stream through the curl relay.

- **THERE IS NO ROAD LOD; THE "LOD AHEAD" WAS THE TEXTURE FILTER.** Asked
  from the seat what LOD the ribbons have: none — a ribbon is built once at
  full detail. The radii that DO change with distance are shadows (80/110/
  150 m by quality), grass (140 m, GPU fade to 360), plants and ruins
  (700 m), corridor refinement (`REFINE_R` 1100 m), the fine OSM ring
  (5×5 of ~500 m tiles plus one ahead at speed; the overview road layer is
  chart-only, so beyond it chase view has NO roads), and fine terrain (5×5
  of 2 km tiles, then the z11 shell at 63 m/px). The reported effect was
  unchanged by `?refr=2000` and the PIXEL FULL frame showed it: the coarse
  mip's blocks, road-width squares, nearest-sampled. Canvas textures now
  take anisotropic filtering (`TEX_ANISO`, min(8, max), `?aniso=0` for
  the old filter, `__texfilter()`) with trilinear minification; the
  magnification stays NEAREST for the pixel look.

- **THE REGISTRY PICKS A RIVER'S PROFILE IN A FIXED ORDER.** The fourth
  device report (Breede, 76 s): 277 hydro builds for 77 terrain builds, 25
  tiles, hydroBuild top of 92 slow frames at 22 ms each. `resolve()` took
  the longest observation's profile with ties to INSERTION order, and
  `updateTile` deletes and re-adds a tile's observation — so re-feeding
  the earliest tile (every terrain rebuild) moved it to the end, another
  tile's profile took over, its stations differed (each tile samples its
  own ground and extrapolates the rest of a 26 km line), the body
  "changed", and `markBodiesDirty` rebuilt every tile along the river.
  Ties break on the tile key now. The bench's re-feed check reads 0
  changed bodies over three rounds against 1 for the old order. The
  deeper fix — merging the per-tile profiles station by station, each
  tile contributing the stations it actually sampled — is still open, and
  is what would make a long river's level right away from the tile that
  happened to answer first. The HUD's half-rate gate is 40 ms now: at the
  device's usual 26 ms frames the 22 ms gate never fired and drawHud
  (4.5 ms, 14.7% of wall) drew every frame.

- **iOS DITHERS THE COVER CLASSES; THE DECODE SNAPS THEM.** A field query
  at George read "CLASS 9 ×6, FOREST ×3" off one z12 cover raster that
  holds nothing but exact classes (verified byte for byte through the
  cache, at z12, z10 and z8). Safari colour-manages the greyscale PNG
  despite `RAW_BITMAP`, with dither, so one class comes back as two
  values — and every reader compares exactly (`coverWater` is `=== 80`),
  so a dithered 79 was dry land. `snapCoverClass` in `loadCoverTile`'s
  decode takes the nearest valid class within 2; `__cover().snapped`
  counts the pixels that needed it, and a non-zero count is the tell for
  a colour-managing browser. If the DEM ever looks noisy on a phone, the
  same mechanism on terrarium's G channel is ±1 m and worth a probe.

- **A STREAM NARROWER THAN A TEXEL STILL DRAWS.** The wooded valley east
  of George has two unnamed `waterway=stream` ways in its tile and had no
  water in the hydro field: a 4 m default width against a ~9 m texel
  peaked at 0.66 coverage on the centreline and the shore fade took the
  rest. `drawnHalfW` in build-tile makes a line body's coverage half-width
  at least 0.8 × antialias, and the profile index reaches as far as the
  drawn width; the structure's cross-channel chart keeps the tagged width.
  The cover cannot help there — under a canopy WorldCover says forest,
  not water — so the streams are the only source, and OSM widths are what
  they are.

- **ONE HEAVY JOB A FRAME.** `frameHeavyMs()` sums what this frame has
  already paid to hydroBuild, terrainApply, roadBuild and swardFrame (read
  from the profiler's `curFrame`, which is why the wrappers must stay).
  The hydro drain and the sward step both stand down above
  `FRAME_HEAVY_MS` (4 ms) — the sward unless its sweep has waited over
  `SWARD_LAG_MS`, the hydro unless its queue is backing up. The sward step
  itself is bounded by time now, a sixth of the smoothed frame (3 ms at
  60 fps, 5 at 30, the old eight rows at the harness's two seconds), so a
  sweep takes more frames at the same total cost. `refreshSwardField(true)`
  and the `__sward(_, true)` probe still sweep synchronously, which is what
  the tests use. The HUD draws every other frame while `frameMs < 22`.

- **A HYDRO FEED THAT CHANGES NOTHING IS NOT A BUILD.** Every terrain apply
  re-fed its tile's water in full — a corridor refinement, a border audit, a
  road update — and the field rebuilt, 15 ms a tile and 35 for a river
  tile, whether or not anything the water reads had moved. The phone at
  Yosemite: 345 hydro builds in 52 s for 35 tiles, the top contributor to
  slow frames. `hydroFeed` now keeps what each tile was last fed
  (`hydroFedInputs`: the elevation raster, and a signature of the
  overlapping features by id and size plus the ocean's status and mask) and
  ends without a build when all three are unchanged. A tile made stale by a
  BODY change elsewhere (`hydroDirty`) is fed regardless: same inputs, new
  answer. The telemetry worker line says `feeds N skipped M`; `?hydroskip=0`
  turns the skip off for an A/B. What remains after the skip is the build
  itself on the main thread — the next cut, if hydro still tops the slow
  frames, is the build in the worker: it is arithmetic on plain data (the
  raster, the features, the registry's resolved bodies, the previous field),
  all of it transferable.

- **THE LUMA READBACK IS ASYNCHRONOUS.** `stepLuma` read its 40×88 luma
  and depth target with `readRenderTargetPixels` — a synchronous
  glReadPixels that waits for the GPU to finish the whole frame queued
  before it — eight times a second, streaming or not. On WebGL2 the pixels
  go into a pixel-pack buffer behind a fence and are collected a frame
  later; the luma was 120 ms old by design. `?lumasync=1` is the old read
  for an A/B on a device; `__lumastat()` counts which path ran.

`__refine()` counts tiles, split cells, vertices, triangles against the
plain grid and milliseconds by phase (lines, split, heights, geometry).
`__borderDiff(x, z)` compares the tile under a point with each neighbour
along their shared border: shared, missing, the worst height difference on
a shared point and the worst gap of a missing one off the neighbour's edge.
`tiles` counts BUILDS, not tiles — read it against the tile count.
`__nrmEdge(x, z)` reads a tile's normal map along its four edges against
the row inside (mean degrees) and the border vertex colour against one
row in — a lighting seam is a number there before it is a line.

**`__meshAt` was shadowed.** A second binding later in the file made it the
RAYCAST probe, which answered 1688 at Dante's View where the vertex under
the point (and the wheels, through `meshSurfaceAt`) read -0.05. The raycast
is `__meshRay` now; `__meshAt` is the analytic read, and `__vtxAt` shows the
vertex. Three sessions of "the mesh probe disagrees with the mesh" were
this line.

**Measured.** Bixby, the vertex 14m uphill of the Cabrillo Highway: carved
grid 10.3m under natural ground (a corner dragged to the bench), refined
0.08m from it; the cut face is a 32° earth slope in the terrain and the
fill side falls to the sea with no sheet. The road numbers do not move —
Camps Bay seams 8 / 0 / 0.19m, steep 41 / 1, seat 6 / 1.60m, through-node
test green — because the refinement never touches a profile. Cost, first
cut: Camps Bay 17 tiles, 11.5k split cells, 2.2× the plain triangles, 320ms
a tile — too much, and the reason for per-strip reach, the at-grade skip,
vertex fans and the per-tile strip index that followed (Camps Bay then
1.7×, 125ms a tile). Unbounded, Vélizy refined 60 tile builds at 2.4× and
200ms each — the number that made the radius: the corridor is a near-field
detail and a phone cannot rebuild a whole interchange's tiles at that price.

## The joins at Simon's Town

Reported from the seat at `-34.19511,18.44192` heading 246, four ways: the
batter stops short of a join and leaves a gap; the arms of a junction do not
meet on one closed plane; the batter is a picture the truck drives into; and a
mis-joined arm can put a guard rail across the carriageway. Captured as
`at-simonstown` (194 highways over 437m of relief in a 1.4km box) and measured
with two probes before anything moved: `__nodes(r)` clusters every built
fragment end into junctions and reads each one's deck spread, the parapets
lying across its arms, whether the planner pinned it, and how far the box's
corners stand off the arms' decks; `__batterLine(x0,z0,x1,z1,n)` walks a
transect reading the drawn strip against the mesh the wheels read, the
kernel's wedge and the tyre height. `devtools/simonstown-junctions.mjs` runs
both, transects the arms and corner bisectors of the worst nodes, and
photographs them; `REFINE=0` measures the plain-lattice path and `REV=<sha>`
the control.

What the numbers said, against what the seat said:

- **The decks DO meet.** 136 junctions, spread over 10cm at 4, over 30cm at
  1 (an unnamed car-park loop); every named road within 23cm. The pins work
  here as they did at Camps Bay. "Not one closed plane" was not the decks.
- **THE PARAPETS WERE THE HOST'S OWN KERB RAILS, RUN IN FROM BOTH SIDES TO
  MEET IN THE MIDDLE OF THE TURNING.** Four of them — across Flagship Road,
  Living Waters Close, Church Street and Blacks Lane, each a narrow joiner
  meeting Runciman Drive or Saint George's Street — and the decks agreed at
  all four to 4cm. `roadMeetsHere` decided the host's bay with the built grid
  and the planner's pins, and at the moment a host bay builds a narrow joiner
  has not built (a batch builds widest first), three of the four had no pin
  (a crumb has no chain) and the fourth was pinned after the host had gone up
  (a chain solves asynchronously). OSM's topology knew all four before any
  of it built. `juncNodeGrid` keeps every registered node past the batch,
  `roadMeetsHere` reads it first, and the rail count went 4 → 0 on both the
  refined and the plain path.
- **THE PICTURE THE TRUCK DRIVES INTO IS TWO ROADS' WEDGES DISAGREEING.** At
  the report spot a road stands 2.9m above its neighbour and 2.5m from it.
  The kernel's `corridorH` took the NEAREST strip's wedge — the lower road's
  cut face — while the batter strip, built per bay from the upper kerb, laid
  the upper road's bank down the same gap: +1.41m of strip over the wheels on
  a refined tile, +2.2m on the plain path. Earthworks are a union now: the
  highest fill bank standing over the ground, else the lowest cut face, a
  fill standing on a cut and stopping at the lower road's shoulder — which is
  the retaining wall two terraces have. Then two rules about the strip: on a
  refined tile it draws nothing at all (`fillCorridor`) and the strips a tile
  had before it took its corridor come down with the rebuild (`dropBatterFor`,
  `fillDropped`), so refined transects went from strip on 132 of 197 to strip
  on none; and on a PLAIN tile — beyond REFINE_R, or built while the roads
  were landing — the wheels read the kernel's wedge about the drawn ground
  (`wheelGround`), which is the strip's own rule, so the picture and the
  ground agree: strips over the wheels by more than 30cm went 32 → 9 of
  comparable transects, and the nine left are all within 0.7m of a kerb
  inside `KERB_FAIR`, where the fairing to the deck is the wall. The two
  rules must not be summed — a refined tile's mesh already carries the wedge.
- **THE BOX WAS ONE TRIANGLE PER HULL EDGE.** `twist` reads each box corner
  back through `roadHeightAt` against its own arm's deck at that distance,
  grade-corrected (the first cut was not, and read a 30% arm's own fall as a
  twist): 51 of 136 over 30cm, worst 1.59m, where Queens Road's corner (falling
  at 11%) and the next corner on a side road climbing at 16% were spanned by
  a single tilted triangle the ribbon came up through. Hull edges are walked
  in 1.5m steps and each step takes the height of the road it stands on.
- **"THE BATTER STOPS SHORT OF THE JOIN"** is the ledger's `junctionDrewNothing`
  (126 of 136 joins): the host's bays across the mouth, whose first step lands
  on the joiner's tarmac. That is the box's ground, not a gap. The gap the eye
  reads is the wedge seam in the corner quadrant, which the union rule closes;
  corner transects with a mesh step over 0.5m in half a metre went 4 → 2.

**THE SHEET TO THE SKY IS A STRIP SEATED ON GROUND THAT WAS NEVER THERE.**
Reported from the cab at Glencairn (`?lat=-34.15515&lon=18.43619&h=14`, taken
BEFORE any of the above shipped): a batter strip drawn as a dark sheet from
the verge into the sky over a hillside and a sward that were fine underneath,
while the HUD read RETRYING WORLD DATA. `sampleHeightRaw` answers 0 where no
height tile is loaded — relative height 0, the ORIGIN'S elevation — and
`flushBatter`'s steps reach thirty metres past the kerb into whatever tile is
there, or is not: a bay flushed beside a tile on a retry reads the origin's
elevation as the hillside and draws its face or bank to it. The stranded
sweep guarded only the bay's own midpoint. A run that reaches unknown
ground before it has met anything is now parked on that point
(`waitX/waitZ/waitTiles`) and looked at again only when a height tile has
landed somewhere; nothing is drawn meanwhile and the fascia keeps the road
edge closed, as it does for every bay still waiting. `fillUnknown` counts
the parkings. **Unverified at the spot**: `devtools/strip-audit.mjs` ran
there twice through the relay, six minutes each, and the world never
settled (8 of 25 vector tiles home), so the audit saw nine strips and not
one vertex without a tile under it, before or after. The mechanism is the
only path that can put a strip at the origin's elevation, and the guard
withholds nothing a loaded world would have drawn; that is the evidence,
and it is code reading, not a reproduction. `__stripAudit` reports the
strips standing IN THE AIR over the mesh separately from those buried in
it — the first cut took the absolute, and a cliff face lying inside the
hill read the same as one standing in front of it.

**Only three of the fixture's twenty tiles carry a corridor, and that is
right.** The road box spans four z14 tiles; one is False Bay. The quiet path
refines one tile a visit, only tiles a strip reaches, and stops when none are
left — read `__buildLog()`'s last build per tile before reading any of this
as a failure to refine. The evaluation's first pass did.

Same fixture, `through-node.test.mjs` and `fixture-world.test.mjs` green
after; `__nodes` at Camps Bay is the next control to run before believing
the union rule elsewhere.

## The visual survey

`scratch: survey.mjs` in the session, worth keeping as a devtool: six
captures, sixteen spots, three frames each (chase, cab, top at zoom 0.35) at
double resolution, each fixture settling blind and `__draw(true)` before the
frames. Thirty minutes for everything, and the frames are the critique.

What the first survey said, by layer:

- **The noon headlight cone** was the additive beam at full strength: from
  the cab it filled the frame and the road under it read as a white slab. It
  takes `dayF` now, as the pool always did. The pool itself is still a white
  square in daylight (`HEAD_DAY`).
- **Markings** are one texture per road culture with the lines at fixed
  positions across the width: a service road wears a trunk road's edge lines
  and centre dash, and `lanes`, `oneway` and class never reach the paint.
  South Africa's centre line is white and its edge line yellow, France's
  centre line is white; both captures draw yellow dashes. A per-vertex
  marking selector, the way `roadTint` already travels, is the shape of the
  fix.
- **The kerb strip** outlines every road in a pale line two or three palette
  steps above the tarmac. A kerb is a shadow, not a highlight.
- **The surface's tar patches** are 1-3m rectangles on a 20m wrap and read
  as a periodic rhythm from the chart. No wheel-track wear anywhere.
- **The batter** reads well as a grassed slope and badly as a cut: a flat
  brown band with a hard edge against the sward, terraced stripes on a steep
  fill. It wants a material by slope, the grain shader, a dithered edge and
  a shadow line under the cut-side kerb.
- **Junction planform**: crossroads meet as rectangles (the bellmouth only
  serves cropped side roads), roundabout islands are featureless discs, and
  at an interchange nothing separates a deck from the road beneath it in the
  chart view.

What the second pass changed, and what it left:

- **The batter is a wedge about the natural ground** (`flushBatter`): from
  the verge it may fall at `BATT` (0.6) below the kerb line or rise at
  `CUT_K` (0.62) above it, and it takes the ground wherever the ground is
  inside that wedge — so a fill bank follows the hillside instead of sheeting
  to a fixed slope, a cut face is earth (`EARTH`) and past `CUT_REACH` (8m) a
  rock wall (`ROCK`) that steps to the ground, and a road at grade gets a
  shoulder strip and nothing else. On-ground faces wear the terrain mesh's
  own recipe (`terrainPalette` + `coverPaint`, per vertex via `tintInto`),
  so the bank and the sward it meets are the same colour.
- **A junction gets a box.** `juncNodes` collects every shared vertex of
  drivable ways with its arms; `flushJunctions` puts a convex hull of the
  kerb corners at `L = maxHw + 0.5` over any node with ≥3 arms from ≥2 ways,
  fanned at `roadHeightAt` deck heights, in plain tarmac (`MAT.box`), with a
  give-way bar (`MAT.gw`) across each arm narrower than the widest by 0.25m.
  The old mouth bar is gone: two bars a metre apart was what the two
  mechanisms drew.
- **No sign stands on another road's tarmac.** `sign()` refuses a post whose
  foot is on any carriageway (`onCarriageway` at −0.3, or `preEdge` inside
  the kerb); `SIGN_EVERY` 340, chevrons 34/110, `POST_EVERY` 22;
  `spanStats.signRefused` counts the refusals.
- **Markings are per look and per region.** `roadLook(tags)` → `{lanes,
  oneway, edge, centre}` from class tier, `lanes`, `oneway`, roundabouts,
  motorways; `roadTexture(culture, look)` bakes one texture per pair (lane
  boundaries at k/lanes, the middle one of a two-way road the centre line,
  the rest short dividers); `conventionFor(lat, lon)` forces the culture by
  geography — Americas `yellow`, Nordics `nordic`, Europe `euro`, southern
  Africa `za` (white centre, yellow edge, zero climate affinity), Australasia
  `euro`. The texture wraps every 20m of road (`v = along / 20`): the centre
  dash is two 10m periods per wrap (3.5m on), dividers 3m on 7m off, and the
  paint alpha is `0.92 − 0.4·wear` — at 0.75 the Bixby centre line measured
  cream (219,200,164) and the edge lines grey through the quantiser. Judge
  a marking's colour by counting pixels in a top frame, never by eye through
  the dither. And no paint without tarmac: `surface` in `UNSEALED` (unpaved,
  gravel, dirt, ground, …) or `tracktype` grade2-5 gets no edge and no centre
  line — the Senqu tertiary wore yellow edge lines over gravel until it did.
- **The dark blotches beside every desert road were the batter, through its
  texture.** Five live frames (Giza, San Juan County, Dante's View, Rueil)
  showed blocky dark-earth sheets ten to thirty metres out from the roads.
  Three suspects measured innocent in turn: the carve (`__vtxAt` — the mesh
  vertex under the road sits on natural ground), the cover tint (`__coverAt`
  — bare ground at Dante's View, and Giza's built pixels looked the same with
  the tint changed), and the terrain palette (the vertex colour beside the
  road is the plain sand). What was left was the strip that roofs the carve's
  bench in "the terrain's own colour": `MAT.batter` carries `batterTex`
  (mean ≈ 0.44) and the terrain carries no map, so colour × map rendered at
  under half the ground's brightness. `tintAt` now divides by the texture's
  mean (`batterMean()`, read once off the canvas). Cover, carve and palette
  unchanged; the earth, rock and shoulder tints keep the texture.
- **Built ground is the ramp, greyed.** WorldCover's built class was pulled
  55% toward one fixed grey; it is now the ramp's own colour desaturated at
  92% of its luminance, mixed at 0.75 of `COVER_MIX`. Not the blotch fix,
  but a desert town no longer goes brown.
- **The noon headlight pool is a hint.** `HEAD_DAY` 90 cd / 110 m → 16 cd /
  70 m: at 90 it was a pale slab beside the truck in every noon frame, and
  the "slab" at the Suresnes cul-de-sac was it.
- **An instrument to distrust:** `__meshAt` (`meshSurfaceAt`) returned
  heights metres off the vertex under the same point at Dante's View and
  Suresnes while `__vtxAt` read the vertex directly. The physics did not
  misbehave in either frame, so the fault may be the probe path; it is not
  yet explained. Read `__vtxAt` for "what is the mesh doing here".
- **The batter closes the gap to the ground that is DRAWN, and no more.**
  Third pass, from a Dakar frame: the wedge was clamped about the natural
  surface and then followed it while the carved mesh lay below — roofing the
  carve's bench out to 30m. On a coarse tile the bench is a whole cell, so
  the strip was a sheet with the cell's straight edges sampled at the step
  distances. The target is `groundAt` now (kerb above it: a bank; below it:
  a face; at it: nothing), the toe is solved as the crossing between two
  steps rather than the next step out, per side, and a landed side holds a
  metre past its toe while the other finishes. Width is the height
  difference over the slope, continuously. The bench beyond the toe shows as
  terrain, which blends by construction; how deep and how wide it is belongs
  to the carve and, properly, to a terrain mesh with vertices at the kerb
  and the toe — the structural job still open.
- **Tile seams.** The colour pass took its slope from a forward difference
  clamped inside the tile, so the last column and row of every tile had zero
  slope, no shade darkening, and drew a one-vertex bright line along two
  edges of each tile — the cross through the truck on the Colcha K and
  Walter Sisulu chart frames. It is a central difference on the field now
  (which knows the neighbouring tile), and the per-tile normal map's edge
  pixels read the neighbour through the field too. The lighter quadrant in
  the Colcha K frame is NOT a missed cover recolour (`coverDirtiedTerrain`
  rebuilds on arrival) and is not yet explained.
- **Still standing:** the pale kerb strip (a kerb is a shadow); the surface's
  periodic tar patches; roundabout islands and crossroads fillets; nothing
  separating a deck from the road beneath it in the chart.

## The buildings, and the tags that are not there

The building review's headline is one measurement, and it should be the first
thing anyone reaches for before proposing a building feature that reads a tag.
**Counted over the three captures this game ships — 5,120 footprints:**

| tag | Suresnes | Camps Bay | Simon's Town |
|---|---|---|---|
| `building:levels` | 6% | 0.3% | 0.2% |
| `height` | 0.05% | 0% | 0% |
| `roof:shape` | 1.4% | 0% | 0% |
| `building:colour` / `:material` | 0% | 0% | 0% |
| `building=yes` (untyped) | 80% | 89% | 90% |

Seven buildings in five thousand carry a height. **The R55 note that restored
this vocabulary measured Freiburg**, which is unusually well surveyed; the note
is honest about its own source and was then read as a general fact. Everywhere
anyone drives, `levels || 2` was not a fallback, it was the height of ~94% of
every town — one value, 6.2m — and the roof default keyed off a `building=` word
list left 99% of the world wearing a flat extrusion cap.

So the rule for anything about buildings: **synthesise from what is always
present** (the footprint's area and box, `builtUpAt`, the culture, the stand
seed) and defer to a tag only where one exists. `massHeight` and the roof gate
in `building()` are the worked examples. `building:colour`, `building:material`
and `roof:colour` are kept in `KEEP_TAGS` and are 0% in all three captures —
`registerPaint`'s mapped path and the ruin gate's colour exemption effectively
never fire.

- **A STAND NORM, NOT A PER-BUILDING HASH.** The same lesson as the tree atlas
  ("a wood is one wood"): an independent draw per building is noise, and a
  terrace at six unrelated heights reads as broken data. The 32m stand sets a
  local norm and the building's own draw moves it half a storey.
- **`intact` AND `ruin` CANNOT SEE THIS.** They are identical whether every
  building is 6.2m or none is. The defect lives in the DISTRIBUTION, which is
  why `buildStats.hist` (3m buckets) and `.roofs` exist. Read them, not the
  counts.
- **THE ROOF GATE OVERSHOT FIRST AND THE PROBE CAUGHT IT.** Gating on the
  culture's pitch and a height ceiling alone put a roof on 98.7% of Suresnes,
  1,474 hipped against 28 flat — as wrong as the 99% flat it replaced. Flat
  roofs are specific and real: outbuildings, blocks, commercial sheds. Hipping
  stays a minority choice even where the plan allows it, or a street reads as
  stamped.
- **`look.pitch` HAD BEEN COMPUTED AND READ BY NOTHING** since the cultures
  shipped — snow-biased, reported by `__culture`, and the ridge came off
  `min(du,dv)*0.45` regardless, so every building on earth had the same roof and
  an adobe town's flat silhouette arrived only by the kind regex not matching.
  If a probe reports a value, check something consumes it.
- **STOREY HEIGHT BELONGS TO THE CULTURE** (`BuildCulture.storeyM`), beside the
  wall texture. It is not one number: 2.7 against 3.3 over four floors is two
  metres of silhouette.

### The façade's surface, and three ways it went black

- **GLASS WAS AN ABSOLUTE COLOUR, so on a dark wall the windows were LIGHTER
  than the wall** and read as pale panels stuck on the building. The panes were
  0.05–0.17 on the assumption the paint is pale limewash; a shaded face or any
  dark paint inverts it. Photographed at Camps Bay as beige rectangles on oxide
  red. The void is a fraction OF the wall now, which cannot invert. The
  sun-catching reflection stays absolute — that is the SKY's brightness.
- **A BUILDING AT NIGHT WAS A HOLE IN THE FRAME.** Measured at `?time=NIGHT`:
  wall linear luminance **0.0052 (sRGB 13) against ground at 0.13**, and not one
  lit window anywhere in the world. The skylight lift was `0.075 * dayF`, so the
  one stand-in for the missing bounce left at dusk while the ground kept its
  moonlight response. It has a night floor now, and `uFacNight` lights a share
  of the bays. **The lit window goes to EMISSIVE, not to the diffuse colour** —
  at night the diffuse is multiplied by almost no light, so tinting it changes
  nothing, which is the trap that makes this look like it did not work. After:
  0.0208 (sRGB 53) with a scatter of lit windows across the skyline.
- **RUINS COULD NEVER JOIN `bldSkylit`** and are 42% of Suresnes' stock. They
  carry weathering in VERTEX COLOURS, so `material.color` is white and
  `emissive.copy(color)` would light every ruin in the world white. A mid
  weathered tone stands in.
- **A SOFFIT IS NOT A VOID.** Roofs were outside the lift, invisible while
  nothing was pitched and a hard black band along every eave the moment most of
  the stock was. **The mechanism is the one already written down for the
  ribbons**: DoubleSide flips the shading normal toward the VIEWER, so a surface
  seen from below points away from the sun and Lambert correctly clamps to zero.
  The ribbons could answer it by CULLING — nobody is meant to see the underside
  of a road — and a soffit cannot, because looking up at the eave is how you see
  a house.

**BUILDINGS ARE THE CHEAPEST THING IN THIS WORLD.** Measured with `__census`,
settled: at Suresnes buildings are 126,590 triangles in **10 draw calls** and
ruins 219,990 in 5, against vegetation's 1.86M — the whole built world is 11% of
the scene's triangles, and 3% at Camps Bay. Pitched roofs on most of the stock
cost **+3.5%** and no extra draw calls. Per-fragment work is the abundant
resource here (the frame is ~148×320), so façade detail is close to free; what
is scarce is per-vertex and per-draw, and neither is where the building bill is.

### What ruled itself out, and the instruments that did it

Three plausible causes of dark roofs, all measured innocent — worth knowing so
nobody re-litigates them:

- **NOT the batter's colour-times-map fault.** `__texmean` reports every
  building texture's mean off its own canvas: 0.91–0.98. (`batterMean` exists
  because that fault was real for the batter at 0.44.)
- **NOT self-shadowing.** `?shadows=0` moves a roof sample by 4%.
- **NOT inverted roof caps.** `__bldwind` (the buildings' answer to
  `__ribbonwind`) reports 21.8% of building triangles facing down — and that is
  the extrusion's FLOOR SLAB, which is meant to be there. Ruins read 0% down.

### Framing a façade, and the sun that is not the clock

- `devtools/building-survey.mjs` picks spots from `__plots()` and stands 26m
  back looking AT a building. The visual survey frames JUNCTIONS — its spots are
  node coordinates and its cab frames look down a carriageway — so before this
  a wall was only ever whatever happened to be off to one side.
- `devtools/facade-light.mjs` samples wall, ground and sky luminance;
  `devtools/roof-light.mjs` does the roof, standing the truck ON a footprint so
  the top view's centre is that roof.
- **`?sunalt` FORCES ONLY THE SUN'S DIRECTION.** `dayF`, `sun.color`, the
  twilight band and `uNight` are all still computed from the CLOCK's altitude
  (`stepSun`), so a forced negative altitude is midday with the light raked
  through the floor. The first three "night" frames of this review were noon.
  Anything about brightness needs `?time=`, and that is a page load each.
- **READING THE LIVE CANVAS BACK GIVES A BLACK IMAGE.** The renderer runs
  without `preserveDrawingBuffer`, so the drawing buffer is gone by the time
  anything outside the frame asks for it — measured as wall, ground and sky all
  `[0,0,0]`, which reads as a black world and is a reading of nothing. Decode
  the SCREENSHOT in Chromium instead, the route `imgdiff.mjs` takes.

**Still standing, and not yet explained:** a large pure-black region in the
Suresnes b1 cab frame, present before this work as well as after, on a surface
that is not obviously a lifted wall or a lifted soffit. Worth one raycast.
Also open: one bay grid for the planet (2.75m × 3.1m, fixed in `facade.ts`, no
per-culture or per-class window rhythm), and no chimneys, parapets, cornices or
balconies anywhere.

**AND THE MARK TINS ARE STILL ABSOLUTE, which is the glass fault one surface
over.** A tin is mixed in at `fadeMin + fadeVar` of its own colour regardless of
the paint underneath, so on the oxide-red Camps Bay wall a tag reads as a bright
tan blob rather than as paint on a wall. `graffiti.test.mjs` asserts no tin is
bright enough to BLOOM and passes — that is an absolute test, and this is a
CONTRAST problem, so the suite cannot see it. The fix is the same shape as the
glass one: carry the tin toward the wall's own value rather than mixing a fixed
colour over it.

## The labs

`/lab` lists them; each is `/lab/<slug>`, registered in `client/labs.ts`.

| slug | what it isolates |
|---|---|
| `hydro` | water fields, coastlines, river profiles |
| `marks` | the production façade shader and its graffiti |
| `roads` | the bench-search profile solver, as a section |
| `flora` | the climate ladder **and** a real stand of the shipping plants |
| `weather` | the 48×48 weather lattice, with time on a dial |
| `sound` | the mixer with no world: every voice on a dial, every one-shot on a button, meters per tap, the gravel and rattle A/B, targets as sliders that COPY as the engine literal |
| `world` | a chooser: the whole engine over an authored planet |
| `flora-ez` | the shipping silhouettes against a reduced EZ-Tree skeleton, and the hybrid: EZ wood under Drive crowns (pulls `@dgreenheck/ez-tree` from esm.sh; see below) |

### EZ-Tree: what the flora-ez lab found

The question the lab asks is whether a procedural skeleton, cut down hard,
reads better than the 20-triangle archetypes at Drive's pixel scale. Measured
in the harness with the real package (three 0.160 runs it), 8 m trees, pixel
scale 3, 40 m and 105 m cameras:

- **The package.** 4.0 MB from esm.sh, 3.97 MB of it twenty embedded bark and
  leaf textures loaded at import; the generator itself is ~47 KB, MIT. Full
  presets are 3.6k–19k triangles and 8–70 ms to generate; the lab's hard
  reduction (levels 2, sections ×0.3, segments ×0.4, children ×0.3) is
  80–800 triangles at ~1 ms. EZ-Tree has no decimation of its own — the
  reduction is its `branch` and `leaves` option groups, multiplied.
- **EZ's own leaves are the wrong leaf.** They are alpha-textured cards; drawn
  opaque and untextured at three pixels they are confetti, and the canopy
  never closes short of the full 7k-triangle preset. Cards lose at every
  reduction.
- **The hybrid wins for broadleaf.** EZ's wood with a Drive icosahedron
  (`clumpsAt`) on every leaf anchor: leaves ×0.15, clump 2 m, ~390 triangles
  (10× the archetype, 2.4 ms). At 40 m it is a lobed, branching tree beside
  the lollipop; at 105 m it still reads as a canopy with more variety than the
  archetype stand. Aspen and oak presets both work.
- **Conifers want a frond, not a blob.** Round 2 m crowns on every leaf
  anchor of a pine made a blob pile (2.1k triangles). One leaf per branch,
  started at 0.9 of its length, with a squat five-sided cone on each tip
  (`clumpShape: cone`, 1.3 m) reads as a whorled spruce at 40 m and a dark
  dense stand at 105 m, ~700–900 triangles: 24× the cone, and worth it for
  the nearest few dozen.
- **Bare skeletons win outright.** The shipping snag is a tapered post; an ash
  or aspen with leaves ×0 is a dead tree with branches at 60–250 triangles.
  This is the case where the eye needs branching most and pays least.
- **The budget forbids a straight swap.** Caps are 1600 broadleaf and 1400
  conifer within `VEG_RANGE`; at 390 triangles that is 600k triangles for
  broadleaf alone against ~60k for all plants today. Snags (cap 450, ~100
  triangles) fit wholesale. A near ring is not a radius: on the A6 at the Aare
  there is one broadleaf within 300 m and 218 within 700, while a dense wood
  can put the whole cap inside 300 m — so a hybrid tier must be **the N
  nearest** (N≈120 → ~47k triangles), the rest the archetype, bucketed in the
  placement loop that already knows every site's distance.
- **A lab's static import of an imports.json package is a GAME-LOAD cost.**
  labs.ts reaches every lab through `import('./x-lab')`, but the platform
  bundles the client without code splitting, so the lab's body is inlined
  into app.js and a static `import … from '@dgreenheck/ez-tree'` inside it
  became a top-level `import … from "https://esm.sh/@dgreenheck/ez-tree…"`
  of app.js — 3.0 MB brotli, fetched and its twenty textures decoded by
  every player before the game booted, for as long as the pulled lab was
  live. Only a dynamic `import('@dgreenheck/ez-tree')` of the package ITSELF
  survives bundling as a dynamic import (the platform marks the bare name
  external; esbuild keeps `import()` of an external lazy). `curl
  …/app.js | grep '^import '` is the check.
- **Shipped as a bake, not the dependency — EVERY TREE, EVERY DISTANCE.**
  `devtools/bake-ez-flora.mjs` takes the lab's COPY JSON per family (paste
  what read well) and generates the variants in node (a DOM stub;
  `document.createElementNS` is all the package's texture loader touches),
  writing `client/flora-ez-baked.ts`: Int16 wood, Uint16 indices, and the
  crown as leaf cards (`leafAs: card`, two triangles a leaf, opaque,
  double-sided, toned per card) or as anchors for a Drive blob (`clump`:
  icosa, `flat` = a pressed octahedron, `cone` = an open frond). Each
  variant is ONE geometry with a per-vertex `aWood` flag; `ezMaterial`
  colours the crown from the instance and the wood from bark. In main.ts
  every broadleaf, conifer and snag site wears a skeleton (`ezTiers`, two
  InstancedMeshes a variant: one casts shadows for trees inside
  `shadowSpan`, its twin does not, same shape). Sized in METRES:
  `EZ_M_PER_SCALE` × the site's scale draw, so an oak is 8–21 m, a pine
  10–26, a snag 4–11. **The near tier was rejected from the seat** — a tree
  that changes shape as you drive at it is worse than either shape — and
  so was ring-order admission: with the caps binding, crossing a 220 m
  cell re-centred the rings and rerolled the wood. Trees are gathered and
  the nearest N admitted by true distance, fading toward the ground over
  the last third of the admitted edge (`__ez().edge`).
  **The tree rack:** SETTINGS → TREES exposes the real levers independently:
  POPULATION CAP (0.25×–16×), DRAW RANGE (350 m–2.8 km), EZ TRI CAP
  (0.3M–100M), baked variant breadth, whole-tree height, form spread and
  deterministic growth bend. The upper stops are deliberately allowed far
  beyond frame budget; instance pools grow only on demand, so the shipped
  defaults still allocate and draw exactly what they did before. The defaults
  are 1×, 700 m, 2.4M, ALL, 1×, STOCK and bend OFF. `?treetris=` remains an
  exact, unsaved override and outranks the remembered rack; `?ez=0` restores
  the archetypes. `__ez()` reports the live tuning, capacity and triangle
  bill; `__ezgeo()` reports every variant's extent.
  **Diversity has two scales:** the 6/4/4 baked silhouettes remain stable per
  site and EZ VARIANTS can collapse them to prove what that atlas contributes;
  FORM SPREAD magnifies the already stable height/width/lean draws, while
  GROWTH BEND adds a continuous position-hashed bow in the vertex shader for
  no vertices or draw calls.
  Change a recipe → re-bake (`npm i --no-save @dgreenheck/ez-tree@1.1.0`,
  run the devtool); the bake prints the drawn triangles per variant.

### The atlas has a vocabulary now, and a wood is one wood

Three things it did not have, and the fourth is what makes it extensible.

- **A FORM, DECLARED AND CHECKED.** Every variant says what shape it is —
  `round`, `columnar`, `conic`, `umbrella`, `palm`, `bare` — and the bake
  MEASURES the silhouette off the geometry it just produced: the bare trunk
  below the crown (`clear`), the crown's widest radius (`width`), and whether
  it widens or narrows going up (`taper`), all as fractions of the tree's own
  height, read from the points the world will actually draw. A declaration
  nothing checks is a label. The whole point is that a guild can ASK for a
  shape; the form is GEOMETRY and `guild.ts` owns the biology, because the same
  umbrella crown is an acacia in the Sahel and a paperbark in Kakadu.
- **THE CHECK CAUGHT ITS OWN RULE TWICE, on the first run.** Width was tested
  before taper, so a small pine at width 0.22 with taper −0.31 came out
  `columnar` — a narrow cone is still a cone. And `umbrella` demanded a clear
  trunk over 0.45 of the height, which no acacia on earth has: a mature
  *Vachellia tortilis* is about 8m with 3m of clear trunk and a 10m crown, so
  clear ≈ 0.38 and width ≈ 0.6. **The threshold is anchored to the real tree,
  not to a recipe that needs to pass**, and moving it was checked to
  reclassify none of the fourteen variants that already existed.
- **AND THE ATLAS HAS NO COLUMNAR TREE.** Every broadleaf measures 0.34 to 0.57
  wide. That is a real gap the vocabulary made visible, and it is where the
  next bake should go: a columnar broadleaf, and a small-leaved sclerophyll for
  the Mediterranean rows, which the guild currently has to serve with an oak.

**AN ACACIA AND A PALM**, because the guild has asked for both since it shipped
and the package's sixteen presets are all temperate northern — so a savanna got
oaks and a mangrove got a 20-triangle archetype. Same generator, different
dials, and the dials were found by measuring rather than by eye:

- a clear trunk needs `branchStart` at BOTH levels; `start[1]` alone stalls at
  0.23 of the height, because level-2 branches hang back down through it;
- near-horizontal arms are the obvious answer for a flat crown and are wrong —
  at 80° the children droop and the clear trunk fell from 0.45 to 0.30;
- trunk length against arm length is the real lever, and it is a TRADE: a
  longer trunk raises `clear` and narrows `width` together, so the acacia sits
  on a frontier rather than at an optimum;
- **`branch.force` is the droop, and it defaults to pulling branches UP.**
  Pointing it down is what makes a palm a palm: it took the crown from 0.10 of
  the tree across to 0.22, while `length[1]` — the obvious lever — moved it
  from 0.060 to 0.070 and no further.

Both cost less than the broadleaf beside them (acacia 720t, palm 632–696t
against an oak's 1032t). `EZ_FAMILIES` is five now and six hard-coded
three-family record literals are derived from it, so a sixth is one edit.

**A WOOD IS A WOOD.** A silhouette was chosen by hashing the TREE'S OWN
COORDINATES at an eighth of a metre — every variant equally likely at every
point, so two trees standing together came out a broad oak and a leggy aspen.
That is not variety, it is noise. Real vegetation is coherent at two scales, so
`ezPalette(family, districtSeed)` picks the few silhouettes a country grows and
`ezPickVariant(palette, standSeed)` picks which one this thicket is, both from
`culture.ts`'s own scopes (district 6km, stand 32m) — jittered Voronoi keyed on
lat/lon, so a palette survives a world rebase and a stand does not reroll as
you drive past it. That machinery already existed for bedrock; this is the
second thing to use it. `?ezstand=0` is the exact A/B.

**Measured** at Camps Bay, same fixture, the switch the only difference:

| | per stand | per position (`?ezstand=0`) |
|---|---|---|
| distinct silhouettes in a 32m stand | **1.07** | 1.54 |
| distinct silhouettes across 400m | **5** | 12 |

**AND THE ATLAS IS CHEAP TO EXTEND NOW.** Each tier was born holding its
FAMILY'S WHOLE CAP, on the reasoning that worst case every site lands on one
variant — true, and it meant the boot allocation was the cap times the variant
count: 40,600 instance slots, about 3MB of matrices and colours, of which at
most one family's cap is ever in use. `refreshVeg` already computed the true
per-variant need and already called `ensureVegCapacity` with it every refresh,
so the up-front cap bought nothing the growth path was not going to provide.
Tiers are seeded at 64 and grown. **Measured: 4,096 slots against 40,600 — 90%
less — with every tree still placed.** It matters more with the palette: a
district uses two silhouettes of a family's six, so four tiers stand empty at
any moment and used to be empty AND fully allocated.

### `treeRefresh` was never the refresh — it was the seeding

The device put `treeRefresh` at 9% of session CPU with a mean of 93 ms a call.
`vegMs` is ONE NUMBER for a function that walks a ring of cells twice, sorts
every tree by distance and composes a matrix per plant, and one number cannot
say which of those to cut. `devtools/veg-cost.mjs` splits it, on a fixture so
no tile arrival can move the answer.

**Both obvious suspects measured innocent.** The new two-scale variant choice
costs 0.98 µs a tree against the old hash's 0.15 — 6.5× more and 1.5 ms of the
93. And the refresh loop itself is **5.5 ms median**, of which `place` is 60%.

What the split actually found: **worst refresh 104 ms, of which 94 ms was
`seedCell` seeding EIGHTY-ONE CELLS IN ONE CALL.** Seeding is a FIRST-VISIT
cost — once per 220m cell, from inside `refreshVeg` — so a settled world seeds
nothing and the 93 ms mean was the calls that hit a burst. The whole ring
arrives together at boot and on every world hop, which the attract reel does on
a timer.

- **MEASURE FROM THE FIRST FRAME, NOT AFTER QUIET.** The first cut of the bench
  waited for the population to settle and then sampled, and reported 5.9 ms
  with the seeding at zero — a perfect measurement of the one state in which
  the problem does not exist.
- **A refresh may now spend `VEG_SEED_MS` (8) seeding and no more**, less
  whatever the frame has already paid to `frameHeavyMs()`. The ring is already
  walked outward from the truck, so what defers is the FAR country.
- **AND IT CATCHES UP FAST.** Deferring inside the 900 ms cadence would fill a
  hop's ring over a quarter of a minute; a refresh that had to defer asks for
  the next one in 120 ms. `?vegseed=0` is the exact A/B.
- The budget is checked BEFORE the cover and ecoregion waits and does not touch
  `vegDeferredAt`: that clock is about EVIDENCE and this is about TIME, and
  starting it here would make a busy frame look like a missing tile.
- It can overshoot by one cell, because nothing stops a cell mid-seed — which
  is why the worst refresh lands near 28 ms rather than at 8.

**Measured**, Camps Bay fixture, sampled from the first frame, the switch the
only difference:

| | budget on | `?vegseed=0` |
|---|---|---|
| worst refresh | **28.0 ms** | 108.7 ms |
| worst seeding | **12.0 ms over 2 cells** | 95.4 ms over 81 cells |
| median refresh | 6.8 ms | 5.6 ms |
| trees placed | 741 | 741 |

`?treerange=` and `?treepop=` are exact unsaved overrides for the rack's two
biggest stops, so a bench can stand the world up where the cost is without
driving the settings panel.

Probes: `__stand(r)` reports `forms`, `variants`, `stands` and `perStand` (the
mean distinct silhouettes in one stand — the number that says whether the
confetti is gone); `__ez()` adds `slots` and `slotsIfCapped`;
`__vegdist().ms` adds `phase`, `seededNow`, `seedMsNow` and `seedDeferred`. Held by
`devtools/tree-stand.test.mjs` (the palette in node, the world on a fixture, no
network either way) and checked live by `devtools/savanna.mjs`, which is the
one that proves the whole chain closes: the Serengeti returns *Southern
Acacia-Commiphora bushlands* → the savanna guild → `forms {bare 6, umbrella 2}`,
and the Sundarbans returns *Sundarbans mangroves* → the mangrove guild →
`forms {bare 16, palm 11}`.

### The polish pass — another agent, on the cell, two pushes apart

Astra (a ChatGPT-6 client on the same workspace) worked directly on the
deployed cell again on 2026-09-07 and was pulled on a watch loop, one cycle
every ten to fifteen minutes, each pull committed verbatim as NOT MINE so
nothing could be lost. The first pull caught the work HALF LANDED —
`main.ts` passing `audio.space` a cab flag that `audio.ts` did not yet
declare, so the tree did not type-check — and the second pull completed it.
**A pull of another agent's cell is a snapshot of its editor, not a
release**: read `tsc` before reading the diff, and expect the second pull
to change the meaning of the first.

What it landed, in `POLISH-2026-09-07.md`'s own order: rain as two voices
(an outdoor wash on the world bus, roof drops from a bed of 720 impacts
baked once at arm on the near bus, sheltered by enclosure and louder in the
cab); the mix told which camera is in use (`space(enc, cab)` closes the
outside lowpass and bus in the cab); a wet road in the tyre roar; one
stereo position per bird phrase, and the phrase's nodes released after its
tail — the old code leaked them until GC; a crown interior shade on the
baked skeletons and a root shade on the sward blades; the tree refresh
yielding to a heavy frame with a 180 ms starvation cap; the re-drape
skipping vertices whose float would not change; and the telemetry
semantics above. `client/polish-check.mjs` is its component witness and
passes here; the report is explicit that no frame was rendered and nothing
was listened to. The two visual changes were photographed on the Camps Bay
capture against the revision before them before deploying — see the
session's frames — and the enclosure audit was re-run against the new
`space()`.

### The refresh was tuned by another agent, on the cell, and the ritual held

Pulled from the deployed cell after a deploy from this branch: a second agent
(a ChatGPT-connected client on the same workspace — `auth.tokens` shows it as
`act.sub: client:chatgpt`) had rewritten parts of `refreshVeg` and
`ensureVegCapacity` directly on the cell, with two new files beside them.
`client/render-work.ts` is three pure helpers — `squareRings` (walk the
perimeter, not the interior; the old loop was cubic in `reach`),
`nearestStable` (heap selection of the nearest N instead of sorting the whole
candidate list, ties kept in input order so an equidistant tree cannot change
identity), `uploadPrefix` (a GPU `updateRange` over the live instance prefix
instead of `needsUpdate` on the whole allocation). In main.ts: road-clearance
(`onCarriageway`) is asked only of sites that survived admission, not of every
candidate; the near/far tiers are sized to their DISJOINT counts instead of
both to the combined need; and `ensureVegCapacity`'s
`renderer.attributes?.remove(…)` — an internal that does not exist on this
three, so a silent no-op that retained GPU buffers on every pool growth — is
`m.dispose()`.

**IT ARRIVED WITHOUT ITS OWN WITNESS.** `client/perf-check.mjs` extracts both
versions of `refreshVeg` from main.ts by AST and asserts byte-identical output
over a deterministic mock world; it reads the pre-change function from
`baseline-refresh.txt`, which was not on the cell. Reconstructed here from this
branch's own pre-diff main.ts with the same extraction, and the agent's own copy
arrived on the next pull byte-identical bar a trailing newline. **Measured:**
20/20 refills identical; road queries at 2.8 km / cap 120 **18,335 → 1,160**;
allocation at cap 1200 **1,609,984 → 1,118,720 bytes**; nearest-8 of 100k
**49 → 3 ms**. `client/upload-check.mjs` then drives `uploadPrefix` and
`dispose` against three r160's REAL `WebGLAttributes`/`WebGLObjects` with a
recording GL: a 10-instance refill sends 640 bytes where the capacity is
65,536, and dispose deletes exactly the two instance buffers with the shared
geometry and material surviving. In a real page: `boot.mjs` clean,
`tree-stand.test.mjs` all ok at **3,648 slots** against the 4,096 recorded
above. Synthetic component numbers and a fixture, not device frames — the
agent's own `PERFORMANCE-2026-09-07.md` says the same.

**THE BASELINE IS A SNAPSHOT AND WILL GO STALE.** `perf-check.mjs` compares the
live `refreshVeg` against a text file of the old one. The next change to
`refreshVeg` makes that file the WRONG control — the check would then be
comparing a new version against a version two steps back and passing or failing
for the wrong reason, which is a fabricated witness of the kind this file keeps
warning about. Re-snapshot it (`git show <parent>:…/main.ts`, extract
`refreshVeg`) as part of any change to the refresh, or retire the check.

### The flora lab was reviewing a game nobody plays

Asked to look at the new vegetation in the flora lab, and the lab could not
show it. It drove `climate.ts` and the twenty-triangle archetypes — the five
biomes and the lollipops — while the world had moved to
site → ecoregion → guild for the CHOOSING and to baked EZ skeletons for every
broadleaf, conifer, acacia, palm and snag it DRAWS. So the one surface whose
entire job is "does this look like anything" had been silently reviewing a
previous version of the game for as long as the atlas has existed. It runs the
real chain now: a real place, `siteAt` over an authored hillside, the place's
real ecoregion, `guildAt`, and the skeletons.

- **THE PLACES ARE RESOLVED, NOT TYPED.** Seventeen coordinates, each looked up
  against the live `~/eco/v1/` tiles by `devtools/eco-places.mjs`, covering ten
  of the fourteen biomes and — deliberately — the distinctions one sample
  cannot make: two Mediterranean shrublands in different realms (Cape, Big
  Sur), two savannas in two (Serengeti, Kakadu) and three deserts in three
  (Sonoran, Sahara, Outback), which is the only way to watch the cactus gate do
  its one job. An eighteenth, a New Zealand fiord, came back with no
  terrestrial ecoregion at z5 and was dropped rather than nudged onto land.
- **`EZ_FAMILIES` AND `EZ_M_PER_SCALE` MOVED INTO `flora-ez.ts`.** They were
  module state of main.ts, so a lab could not size a tree the way the world
  sizes it without retyping both — and a lab that retypes what it inspects
  proves something about itself and nothing about what ships. main.ts still
  owns where a tree stands; the atlas owns what the families are and how tall
  one grows.
- **A PATCH WAS ONE CLUMP, so it could not show a guild's proportions at all.**
  The old stand drew a single dominant and gave it 83% of the population, which
  is right for one thicket and useless as a landscape: the Cape came out 244
  broadleaf and 3 conifer out of a mix that is 59% bush. It scatters clumps now
  with `seedCell`'s own draws — 3–19 plants at 6–22 m, a tone and a dominant
  rolled for each — and reads bush 133 / broadleaf 103 / rock 6 / snag 3 /
  conifer 2. **The lumpiness those numbers produce is most of what a landscape
  looks like from a distance**, and it is also why a census under about fifteen
  clumps is noise: one extra broadleaf clump is seventeen plants.
- **AND `COVER CLASS` DEFAULTED TO CANOPY**, which narrows a guild to its TREES
  by design. Every reading was a guild's forest and never its country. `none`
  is a real answer, the commonest one, and is now the default.
- **A VARIANT'S NAME WAS THE RECIPE'S, NOT THE TREE'S.** Every acacia recipe
  started from an EZ-Tree Oak preset and every palm from a Pine, so the lab's
  own readout said the Sundarbans grows `Pine Small #44 ×35` and the Serengeti
  `Oak Medium #3 ×17`. The geometry was right — the form is MEASURED off the
  bake — but the line reads exactly like the guild planting the wrong tree,
  which is a fabricated witness of the kind this file keeps warning about.
  `EzVariant.label` (`acacia umbrella 2`, `palm palm 1`) is what readouts use;
  `name` keeps the provenance, because it is how a recipe is found again.
- **THE SITE COLUMN RAN OFF THE CANVAS** and the first thing it cut was `salt`
  — the one term that decides whether a coast grows mangrove.

`devtools/flora-guild.mjs` drives it: a place per frame, `--ab` for the guild
and skeleton switches, `--dist/--eye/--turn` for the framing. Thirty seconds a
place, no network at all, against eight and a half minutes for one live
`guild-ab.mjs` pair.

### What the frames said

Judged from windscreen height (`--eye=2.5 --dist=34`), which is the distance
and the height a driver actually sees roadside trees from. **Frame the camera
before believing an impression**: the first close-up put the eye inside a
crown and the leaf cards looked like sheets of cardboard; from the seat the
same crowns read as foliage. The findings that survived a fair framing:

- **The conifers and the palms are good.** A Sierra spruce reads as a whorled
  conifer at 30 m, and the Amazon from the seat is bare palm trunks going up
  out of frame with a closed canopy overhead and a shaded floor — the `clear
  0.83` trunk doing exactly what it was dialled for.
- **THE COLUMNAR BROADLEAF IS A STACK OF PLATES.** `width 0.15` with the
  family's card size gives cards wider than the crown they hang in, so they
  overlap flat-on and the tree reads as a column of leaves on a pole with no
  branching — beside a conifer it looks like a different, worse art style. It
  is not a rare case: the guild asks `forms conic,columnar` for temperate
  conifer forest, so EVERY broadleaf in a Sierra Nevada is one of the two
  columnar aspens. The fix is in the bake — card size as a fraction of the
  crown's own radius rather than of the tree's height — and it needs a re-bake,
  so it is reported rather than done.
- **AND THEIR EDGES DRAW BRIGHT SLIVERS.** The cards are double-sided and lit,
  so one seen edge-on is a one-pixel bright line — precisely the "narrow bright
  features become white contour diagrams" the rendering doctrine forbids.
- **NOTHING IS KNEE-HIGH IN A FOREST.** From the seat the floor of both the
  Amazon and the Sierra is bare between the trunks, while the census says
  `fern 70` and `bush 23`: the archetype fern is a three-pixel sprite at 30 m.
  `refreshShrubs` fixed this for the WORLD's sward and the guild's understory
  weights have no equivalent — a guild that spends 43% of a mangrove on `fern`
  is spending it on something the player cannot see.
- **THE RAINFALL MODEL IS FAR OUTSIDE ITS STATED TOLERANCE AWAY FROM ITS OWN
  FIXTURES.** Serengeti 2208 mm against a real ~800; Sundarbans 194 mm against
  a real ~1800. That is a factor of 2.8 and 9 respectively, where
  `climate-fixtures.test.mjs` claims 1.5 in the tropics — because the claim is
  a tolerance AT its nine sites, not a global one. It matters because
  `waterMm` is a guild input: the six `dry` forest rows thin on it, and the
  Yosemite lesson (a sub-linear response with a 0.55 floor) is the only reason
  a three-fold error is not visible today. **Do not add a term that reads
  `waterMm` linearly.**
- **A TRUNK IS A FLAT BROWN SLAB CLOSE UP.** The wood takes `uWood` and
  faceTone and nothing else; at 10 m an Amazon trunk is an untextured prism.
  The grain shader is already on the material and could carry bark.
- **THE LAB'S GROUND IS A DIAL, so a desert stands on grass.** The Sonoran
  frame is honest about its plants and misleading about its place.

### …and what was done about it

Every item above is fixed. Two of them turned out to be a different fault from
the one the frame accused, which is the part worth keeping.

- **A CARD IS SIZED AGAINST THE TREE AND HAS TO BE JUDGED AGAINST THE CROWN.**
  `leafScale` multiplies the preset's own leaf, which is a fraction of the
  TREE, so a crown a fifth as wide as an oak's got the same card. **Measured
  over the first bake: a round oak's card is 0.11–0.15 of its crown's DIAMETER
  — seven or eight cards across — and a columnar aspen's was 0.49, so two cards
  spanned the whole crown.** That is the plate look, as a number. The bake
  measures `sil.card` now and flags anything over **0.25** — a line set between
  the two AND above every variant that already looked right, so it names the
  failure and not the family. It caught its own three on the first run
  (both columns and the leggy round aspen at 0.34).
  The fix is BOTH HALVES of the ratio: a wider crown (level-1 branches longer
  and less steeply swept, still under the 0.26 the vocabulary calls columnar)
  and a card under half the size with the leaf count tripled so the crown still
  closes. 0.49 → 0.23, at 1,448 drawn triangles against 908.
  **A BLOB CROWN WAS TRIED AND REJECTED**: 27 icosahedra up the column closed
  perfectly and read as *beads on a stick* at 1,268 triangles. Denser smaller
  cards are what a poplar is.
- **A BLOB CROWN'S `width` IS ITS ANCHOR SPREAD**, not its drawn silhouette —
  the blob's own radius stands outside those points, so a conifer measures
  ~0.075 narrower than it draws and a palm ~0.2. Left alone deliberately: the
  thresholds were set against these numbers and adding the radius reclassifies
  the palms (0.24 + 0.2 is past the 0.30 the rule calls palm) for no gain.
- **BARK, AND THE FRAME IT IS MEASURED IN.** The wood carried `uWood` and the
  baked facet tone and nothing else. `grain.ts` IS chained onto the material
  and could not help: its noise is isotropic at about half a metre and a trunk
  is half a metre wide, so it tints a trunk rather than texturing it. Bark is
  VERTICAL — fast around, slow up — in the skeleton's own unit-height frame so
  it scales with the tree. **The first numbers were an order out**, because a
  trunk's radius in that frame is about 0.02 and not half a metre: 34 put one
  light-to-dark transition across the whole trunk. 150/14 is what reads.
- **A CARD SEEN EDGE-ON IS A ONE-PIXEL BRIGHT LINE**, which is the white
  contour diagram the rendering doctrine forbids. It is pulled toward a darker
  tone as it turns away; its projected area there is nearly nothing.
  **Measured, because carrying a uniform proves nothing and a shader that fails
  to link throws nothing** (`devtools/ez-edge-ab.mjs`, two runs of one stand
  with `uEzEdge` the only difference): **3.07% of the stand moved, worst
  channel 25/255** — the edge-on cards and nothing else, which is the intent.
  Both live on `#include <normal_fragment_begin>`, which nothing else hooks:
  `grain.ts` owns `color_fragment`, `terrainFx` owns `worldpos_vertex`,
  `lights_fragment_begin` and `dithering_fragment`. `vNormal` does not exist
  there — the material is flat-shaded and three declares that varying only
  `#ifndef FLAT_SHADED` — but `normal` and `vViewPosition` do. `?ezbark=0` and
  `?ezedge=1` are the exact A/Bs.
- **THE FERN WAS ANKLE-HIGH. MEASURED: 0.20–0.41 m tall and up to 1.5 m
  across** — a rosette lying flat, and it is the understory the guild leans on
  hardest (43% of a mangrove, 22% of the Amazon). Its fronds reached 0.7 and
  rose 0.42, a 31-degree arch. Rise and reach are swapped and a three-frond
  lower whorl added: **0.68–1.41 m, taller than wide**, at eight triangles.
  Every archetype's real height is now on the record — `broadleaf` 1.95–5.02 m,
  `conifer` 3.64–9.36, `snag` 2.88–7.20, `bush` 0.71–1.79 — because "the
  understory is invisible" is a claim about metres and nobody had measured one.
- **THE SERENGETI'S 2208 mm WAS THE LAB'S FLAT GROUND, NOT THE MODEL.** The
  authored hillside has no upwind relief, so `rainShadow` had nothing to fire
  on; with the Crater Highlands where they actually are (1500 m in the upwind
  15–40 km) the same model reads **883 mm against a real 800**. It is a fixture
  now. **A site term that reads TERRAIN cannot be judged on a fixture with
  none**, and a number quoted from such a frame is a measurement of the
  fixture — the same lesson as the settle gate, one layer down.
- **THE MONSOON, HOWEVER, IS REAL AND IS NOT A TUNING PROBLEM.** The Sundarbans
  reads 194 mm against ~1800. Tamanrasset is 0.84° further north and the SAME
  call is doing its job at 135 mm against 45. Monsoon-versus-desert on one
  parallel is a fact about longitude and continent geometry; widening the
  tropics until Bengal is wet floods the Sahara BY CONSTRUCTION. So it is
  asserted as a known miss beside the deserts, and what changes is downstream:
  **`tropical moist forest` loses its `dry` flag.** A row is `dry` when the
  biome spans a moisture gradient and its dry edge really is thinner; a row the
  ecoregion has already called MOIST has answered that question better than the
  rainfall model can, and flagged `dry` it would have thinned every monsoon
  forest in Asia toward the 0.55 floor on a number that is blind there. The
  same reasoning already exempts Mediterranean scrub.
- **AND THE LAB'S GROUND IS THE PLACE'S NOW.** `GROUND_RAMPS` and
  `groundColourAt` moved into `climate.ts`, so main.ts and the lab paint from
  the same numbers; the lab does the band-and-blend itself and NOT the whole of
  `terrainPalette` (no cover tint, no slope shade, no shallows rule), which
  stays where the world state it reads lives. GROUND FROM SITE is on by
  default with the colour dial as the override.

**`tree-wind.test.mjs` FAILS AT BOTH SPOTS, AND THE CONTROL SAYS IT IS NOT THE
CHANGE.** It asserts that a gale moves more of the frame with the trees swaying
than with them rigid, and it recorded 31.89% against 16.22% when it was written.
Now: at its default Paris spot, 28.26% against 37.49% — the RIGID number more
than doubled, which is tiles landing between the two shots, not shading. On the
Camps Bay fixture (no network, so no streaming at all) both runs saturate near
50%, because a 70 km/h gale moves the sward and the sward fills that frame; the
trees' contribution is inside the noise. **The control is the pair that matters:
same fixture, `?ezedge=1&ezbark=0` — the two new surface terms OFF — reads
−2.47 points where the shipped build reads +2.45.** The sign flips with the
noise and both fail, so the instrument is not measuring this change. Left
failing and recorded rather than retuned: the honest fix is to count only the
band above the sward line (the way `ez-edge-ab.mjs` restricts to the stand
pane), and a threshold moved to make a test pass is a test that has stopped
meaning anything.

**A SHELL TRAP THAT COST TWO ROUNDS.** `npm i --no-save @dgreenheck/ez-tree`
PRUNES `three` and `@types/three` from the root tree, and installing those back
prunes ez-tree — so the bake and the typecheck take it in turns to be broken.
Install all three in ONE command, with `--legacy-peer-deps` (ez-tree peers on
`@types/three` ^0.169 and this repo pins 0.160):
`npm i --no-save --legacy-peer-deps @dgreenheck/ez-tree@1.1.0 three@0.160.0 @types/three@0.160.0`.

- **THE SWARD GROWS SHRUBS.** Between the sward's flowers and the trees
  there was nothing knee-high. `refreshShrubs` (beside `refreshVeg`, every
  900 ms) stands `shrubGeo` — two blobs leaning on each other — on a 5 m
  lattice inside the grass's 140 m reach, reading the GPU sward's OWN field
  (`swardFieldData` rate, `swardColData` ground colour + `SwardCtx` habitat
  per 8 m texel): a shrub stands where grass grows, at `SHRUB_RATE` for the
  habitat (open meadow sparse, wood floor and water's edge thick, cliff and
  ruin next to none), the sward's green at half its light so it reads as a
  shadow in the grass before a shape, dissolving toward the ground colour
  like the tufts. World-snapped lattice, so a shrub never moves. One draw,
  a few hundred instances. No GPU sward, no field, no shrubs. `?shrub=0`;
  `__shrubs()`.

- **A WATER EFFECT IS DRAWN ON WATER THE TRUCK IS IN, OR NOT AT ALL.**
  Every sheet and droplet stands on the `restingLevelM` of whatever body the
  field holds at that x,z, and nothing used to ask WHERE that surface was.
  Photographed at Obergoms at midnight as a pale curtain hanging in the sky
  over the road: the sheets were the right size (two metres) standing on a
  river surface three metres above the truck. Surveyed there with a settled
  suspension, 9 of 20 of that river's own texels resolve their level ABOVE
  the chassis and 3 hold no depth over the drawn ground at all — so half the
  emissions were wrong. `splashWet` is now the one geometric gate every
  effect passes: real water (level over the DRAWN ground, because the
  field's depth channel is floored at the build's minimum and cannot answer
  it) and the truck IN it — the waterline within `WETFX_LIFT` above the
  chassis and `WETFX_DROP` below. `splashFit` then keeps a sheet under the
  lower of the truck's roof and a metre over the waterline, less a bob
  margin: fitting to the roof alone left sheets 14cm over it once the
  springs settled, because the chassis moves and the waterline does not. A
  puddle has no body, so puddle spray is born on the contact patch instead
  of on the river under the bridge. `__wetfx()` reports the verdict, the raw
  sample beside it, and whether any live sheet is over the roof — that pair
  is what tells a perched body from no water at all.

- **A SUMMIT PASSES TWO EYES, AND EITHER MAY SAY NO.** The peak labels have
  a depth-buffer test (`depthVisible`, the 40x88 luma map) and a geometric
  sight-line march (`peakBlocked`), and the depth map used to be the SOLE
  authority whenever it was primed. It has one pardon a distant summit walks
  straight through: past 25km it scans several grid rows ABOVE the apex for
  sky, because the analytic earth-curve and the renderer's disagree by whole
  rows at that range (Bears Ears, 68km). At 25-47km those rows are ~80 screen
  pixels — enough to clear a ridge a kilometre away and find sky over it.
  Photographed in the Senqu: THABA-NTŠO at 25.3km and QUTHING DISTRICT HIGH
  POINT at 47.1km labelled with their marks INSIDE the hillside that hides
  them, while the sight line through that hillside stood 16m and 23m over the
  line to each. So the march is a VETO, not a fallback: the depth map keeps
  the near occluders no heightfield knows (a building, a cutting wall, a
  tree), the march keeps the ridge ten kilometres out. Both must pass.
  Three supporting repairs: the march no longer stops at 4.2km (it walks to
  0.72 of the summit's own distance); beyond the fine ring it reads the
  COARSE RASTER — the far shell's own 256² height tiles, kept now in
  `farRasters` (19m of ground a pixel at z13, 66-76m at z11), which is the
  honest source the shell's chorded MESH never was, with a blocker there
  having to beat the line by its own pixel size; and the per-peak verdict
  memo is cleared when `terrainBuilds` changes, not only after 40m of
  driving, or a verdict reached before the ridge loaded outlives the ridge's
  arrival. `__peakwhy('name')` walks the line sample by sample (distance,
  source fine/coarse/none, ground, sight line, margin) and `__farat(x,z)`
  says what each source answers at a point.

- **WHY A WATER SURFACE STANDS OVER THE VALLEY FLOOR** — measured in the
  Rhône gorge above Obergoms with `__hydrowhy(x,z)`, which names the body,
  its level model, the field's own bed raster and the drawn ground at one
  point. 157 wet texels: the water is SEATED on average (median surface
  minus drawn ground +0.01m mid-channel, −0.69m at the rim); the artefacts
  are the tails, and there are two of them.
  **One, the ribbon is a fixed half-width on a section that is not.** The
  cross-section is deliberately flat (`bedFoot` is sampled at the centreline
  thalweg so the surface does not hump at its edges), so where the drawn
  ribbon ends before the ground has risen to the level, its rim stands proud
  — worst measured 4.35m over the drawn ground with the field's own depth
  channel reading 0.32m, and 3.04m over the field's OWN bed at that texel.
  **Two, the field's raster and the drawn mesh disagree by up to 3m at a
  point** (median 0.00, range −2.47…+3.02): the field is ~16m a texel over a
  2km tile and an alpine channel is narrower than two of those.
  **THE FIX: ONE BED, NOT TWO.** A watercourse was solved twice — the
  terrain kernel carves a channel to a monotone invert (`carveChannels`,
  from `channelGrid`, whose `ya`/`yb` are that invert less 0.15m) while the
  hydro build fitted its own profile to the elevation raster, and nobody
  reconciled them. `HydroTileInput.channelInvertM` now hands the build the
  carved invert (`channelInvertAt` in main.ts) and `lineProfile` stands its
  stations a nominal depth above it, so the surface sits in the channel the
  player is driving past by construction. Measured over 158 wet texels above
  Obergoms: the rim, where a hanging edge shows, went from +2.36m worst to
  **−0.03m — no texel's surface stands over the ground at all** — and the
  mid-channel worst halved, 5.24m to 2.93m.
  TWO RULES LEARNED THE HARD WAY. **Take the LOWEST channel, not the first:**
  `channelAt` returns whichever segment the 3×3 walk meets first, and in a
  gorge that is as often a tributary hanging on the wall — it put an invert
  6m over the drawn ground and the water with it (worst went to +6.9m before
  this was found). **And ask it per STATION, never per texel:** the lookup is
  a grid walk, and in the wet-texel loop it cost +7ms a build, on top of the
  +3-5ms the station calls already cost (14.7 → ~19). What remains unfixed is
  the ribbon's WIDTH against the channel's: texels painted wet on high ground
  now sink further under it (worst −9.9m, up from −5.9m). Buried water is
  invisible, which is why this trade was taken, but the widths still disagree.
  TWO FIXES THAT DID NOT WORK, both measured and reverted:  TWO FIXES THAT DID NOT WORK, both measured and reverted: sampling the
  profile stations from the fine `sampleHeight` instead of the raster made
  the rim sink (median −0.05 → −0.75m) and the worst burial went from −5.9m
  to −10.9m, because the profile then follows a channel the ribbon's width
  does not; doing the same per wet texel cost +5ms a build (14.7 → 19.8) and
  is the exact fault the `bedFoot` comment warns about. What would actually
  work is either a field resolution that follows the terrain's steepness, or
  a river channel carved into the terrain mesh the way a road corridor is —
  make the ground agree with the water rather than the water with the ground.

- **A ROAD IS A LINE ON THE GROUND, NOT A NAME.** `wayAhead` chains the
  carriageway forward and used to refuse any segment whose name differed
  from the one under the wheels. That breaks a drive twice over, both
  reported from the seat: a through road that CHANGES NAME at a boundary —
  the commonest thing in OSM — ended the chain dead, so the autopilot's
  course simply stopped; and at a junction where the through road renames
  while a spur keeps the name, the only candidate the filter allowed was the
  spur, so the drive turned off. Continuity decides now and the name only
  votes: a candidate must clear `AHEAD_MIN_DOT` (0.12, about 83° — LOOSE on
  purpose, because a hairpin's apex is one vertex with most of a right angle
  in it and a tight gate would end the chain inside every switchback), and
  the best score wins — alignment, plus `NAME_BONUS` for keeping the name
  (heavier for the co-driver's `namedOnly` ask, which wants one road's
  identity), less a penalty for a step change in width so a farm track
  cannot hijack a highway it happens to line up with. Walls (`ya`
  undefined) are not candidates at all.
- **AND A GOAL IS A PLACE THE DRIVE IS TRYING TO REACH.** A mission carries
  an AUTHORED route (`buildRoute`, `routeAhead`) and the autopilot follows
  it; everything else the world knows was somewhere you could be teleported
  to and nothing you could drive to. `goal` is the smallest thing that fixes
  that: a named point, set by the site card's second action (DRIVE TO,
  beside RELOCATE), which biases every junction in the chain toward it
  (`AHEAD_GOAL_W`, scaled by how much of the leg is progress, so a slight
  bend toward the target beats a hard turn away and never the reverse).
  Once the chain passes within `GOAL_REACH` the course is CUT there and
  declared a destination, so the speed plan brakes to a stop on the place
  instead of carrying past it; within `GOAL_WITHIN` it clears and toasts.
  Held in lat/lon and re-projected on a hop, exactly as the mission route
  is. `__goal(name,x,z)` sets one, `__goal(null)` clears, `__chain()`
  reports the chain's length and the distinct names it crosses — which is
  how to check the rename fix on a device, since the harness's proxy often
  has no roads streamed at all (`cells: 0`) and could not exercise it here.
  **AND NOW IT IS SOLVED.** `solveGoalRoute` is Dijkstra over the streamed
  carriageway — nodes are segment endpoints, edges the segments, cost is
  length times a penalty for narrowness (`GOAL_NARROW`, so the route prefers
  the road to the lane beside it) — from the deck under the truck to the deck
  nearest the goal. `autoCourse` ranks a mission's authored leg first, the
  solved route second, the chain last; the chain's junction bias is what
  drives while the map fills in, which is why it stays. Re-solved on
  `GOAL_SOLVE_MS` when the goal changes, when more road has streamed
  (`osmDone.size`), or when the truck has left the line it solved. Measured
  at the Senqu: 470 nodes, 110-node path, 1.14km of road for 933m of straight
  line, **2.9ms**, and the autopilot reports `src: route:<name>`.
  **THE LESSON THAT COST TWO RUNS: match endpoints, do not quantise them.**
  A half-metre key looked equivalent to the chain walk's 1.5m adjacency
  tolerance and is not — two ends either side of a bucket boundary land in
  different nodes, the junction never joins, and the solver says "no path"
  across a road you can see (646 nodes, the truck's own component 477, a
  target 1.9km off unreachable). Ends are matched through a coarse hash
  against nodes already placed, with HEIGHT in the match, because a bridge
  deck and the road under it pass within a metre in plan and are not the
  same place. `__route()` reports the solve, `__farnode()` the farthest
  REACHABLE node — a test that picks the farthest node anywhere is testing
  whether OSM happened to stream a connected world, not the solver.
  **AND IT AIMS FOR THE CLOSEST IT CAN GET.** Most places worth driving to
  are not ON the network — a trig point is up a hillside, a lake's name sits
  in the water, a fix lands where the thumb did, and while the world streams
  even a town's pin can be a kilometre from the nearest loaded road.
  Demanding a node within some radius of the goal made all of those
  unroutable, which is the same failure as having no router. There is no
  target now: the walk settles the whole reachable component and takes the
  node that gets CLOSEST, with a light penalty on the driving itself
  (`GOAL_DETOUR`) so a hundred metres of gain is not bought with ten
  kilometres of road. Measured: an on-network goal solves 0m short, the same
  goal shoved 700m into open veld solves 521m short in 1.5ms. The end of the
  plan is a destination wherever it lands — the course brakes there rather
  than running off its end — and arrival at the road's closest approach
  counts as arriving, with the toast saying how far the rest is on foot.
  Still not done: no turn cost, no one-way, no surface preference.

- **THE CHART SHOWS THE PLAN, NOT THE ROAD YOU HAPPEN TO BE ON.** The chart
  used to trace every streamed segment sharing the CURRENT road's name in
  teal, so it could answer "which way does this run". The chart draws the
  roads itself, and once the drive gained a solved route that teal was
  competing with the one line that is actually a plan — two highlights,
  neither obviously the answer to "where am I going". So the named-road pass
  keeps only the TASK's via (gold, solid) and the solved route gets its own
  line: mint and DOTTED (`s.route` in `refreshRoadLine`/`projectRoadLine`),
  subtle enough to sit inside the chart's own language, dashed so it never
  reads as another road.
- **A PIN IS A RECORD ALREADY, AND THE LINE IS NOT A PLACE TO TELEPORT FROM.**
  A double tap on the chart dropped a NEW fix wherever it landed, including
  squarely on a pin that already names that place — burying the thing you
  were pointing at under a fresh mark called something else. A tap within
  `chartTapR()` (about eight millimetres of glass, so the gesture means the
  same at every zoom) opens THAT pin's record instead, on the line as well as
  off it, because reading a place is not travelling to it. The card's two
  travel actions — RELOCATE and DRIVE TO — are withheld while `lineOn`: a
  ranger who can teleport to the next checkpoint, or hand the drive to an
  autopilot aimed at it, is not driving the pipeline.

**The rule that keeps a lab honest: it imports the SAME modules the game runs.**
A lab that reimplements what it is inspecting proves nothing about what ships.
This is why the façade shader became `client/facade.ts`, the plants became
`client/flora.ts` and the grain shader became `client/grain.ts` — each was
extracted *so that* a lab could drive the real thing.

Labs exist because in-world verification is unreliable: Overpass fails, and
finding a town, waiting for four tiles and hoping the camera comes to rest
facing the right wall is not a test. When something is invisible in the world,
three very different faults share one symptom — a placement bug, a streaming
failure, and a shader that silently failed to compile. A lab removes the world
from the question.

### The dials bargain

Every lab uses `createDials` from `client/lab-dials.ts`, and owes three things:

1. **Be liberal.** A number worth arguing about is worth a slider. The cost of
   one more dial is a row; the cost of a missing one is an edit-build-look
   cycle per guess.
2. **It survives a reload**, per lab, under `drive.lab.<slug>.dials`.
3. **It comes out as text.** `source:` writes a paste-ready engine literal;
   PASTE takes it back. Tuning that cannot leave the lab is a toy.

Group dials with `{kind: 'section'}` — the panel and each section fold, and the
fold state lives under a separate `drive.lab.<slug>.fold` key so it never rides
along on the clipboard. Folding sets `--dials-w: 0`, which lab layouts should
lay out against instead of a hard gutter.

---

## Rendering doctrine

**The post pipeline governs every visual decision.** The composite quantises to
14 levels and Bayer-dithers at *display* resolution, then magnifies with
nearest-neighbour. Consequences that are not negotiable:

- Prefer **binary alpha**, flat stepped tones and hard edges.
- Narrow bright features become white contour diagrams. Avoid them.
- The bloom cut is **0.62** — anything above it glows. "White paint at midnight
  is a bug": every emissive thing takes a daylight factor.
- One palette step is about **0.07 sRGB**. Anything subtler is eaten by the
  quantiser or smeared into the dither, so texture must be coarse and
  high-contrast to survive. This is why `grain.ts` pushes three octaves through
  a gamma under one.
- Per-fragment work is the **cheap** resource here (the frame is ~148×320);
  per-vertex and per-draw work is the scarce one. Procedural beats textured.

### The dither is a rack, and what can and cannot go in it

Nine threshold patterns on the PATTERN dial — `BAYER4 BAYER8 CHECK GRAIN LINES
BAYER16 IGN TPDF HALFTONE` — plus DITHER (amplitude), THRESHOLD (the rounding
constant, which on the 1-bit inks IS the ink point), CONTRAST, PALETTE and INK.

- **THE GLSL LIVES ONCE, IN `DITHER_GLSL`.** It had been copy-pasted into the
  composite AND the vehicle bay's copy pass — which exists precisely so the
  truck in the bay ends on the same grade and palette as the world — each with
  its own `bayer2/4/8` and its own five-way selector. A sixth pattern would have
  landed in one and not the other and the bay would have quietly stopped
  matching. Both inject the one string now.
- **ERROR DIFFUSION CANNOT GO HERE, and it is what anyone asking for "more
  dither algorithms" usually means.** Floyd–Steinberg, Atkinson and Sierra are
  sequential by definition: each pixel's error is pushed into neighbours that
  have not been quantised yet, so pixel N depends on N−1. A fragment shader has
  no ordering and no neighbour feedback. Doing it honestly needs a serial CPU
  pass over the 148×320 buffer — feasible at 47k pixels, but a readback and an
  upload every frame, and the readback is the thing the luma map just went
  ASYNCHRONOUS to avoid. So the honest set is ordered patterns and noise.
- **APPEND TO THE DIAL, NEVER INSERT.** The rack persists an INDEX, so splicing
  a pattern into the middle silently re-points every saved preference — the trap
  the TIME dial needed a named migration to undo. The four new patterns are 5–8.
- **`uDChan` IS A SECOND AXIS, NOT A PATTERN.** One scalar threshold added to all
  three channels means every channel crosses its level boundary on the same
  pixel, so the dither can only move a pixel along the GREY axis and fourteen
  levels stay fourteen. A threshold per channel lets a pixel land on a mixture
  of two palette entries. **Measured at Camps Bay, land band, same frame:
  distinct tones 128 → 154 (bayer4), 130 → 166 (ign), 129 → 172 (grain)** — a
  quarter to a third more apparent colour for no extra level and no extra pass.
  The cost is a little chroma fringing on a shallow ramp, which is why it is a
  dial (`DITHER CH: GREY | RGB`) and not a change.

**MEASURE ON ONE SCENE RENDER.** `composite()` lives outside the frame loop so a
probe can re-run it over whatever is already in `rtScene`; `__draw(false)` then
`__dither({pat})` gives frames that differ by the post chain and nothing else.
This matters more here than it did for the shutter: the clouds, sward, wildlife,
suspension and still-arriving tiles move far more pixels between two frames than
any threshold pattern does. `devtools/dither-lab.mjs` does it for all nine.

**THE RUN-LENGTH METRIC SATURATES, so read the tone count and the frames too.**
`banding.test.mjs`'s median longest run of one exact colour is the right measure
of "dithered versus rounded" and it cannot rank the ordered patterns against each
other — at 14 levels bayer4, bayer8, bayer16 and check all hit 3 and IGN 4.
Measured at 14 / 2 levels (sky band):

| pattern | run @14 | run @2 | what it is |
|---|---|---|---|
| bayer4 (shipped) | 3 | 8 | the control |
| bayer8 / bayer16 | 3 | 8 | larger tile, no measurable gain |
| check | 3 | 3 | bayer2; loudest weave |
| ign | 4 | 16 | closed-form, nearest blue noise, no tile to read |
| halftone | 8 | 8 | clustered dot — a printing press, pairs with MONO |
| grain | 14 | 32 | white noise; clumps |
| tpdf | 21 | 56 | triangular noise: smoother, dithers LESS |
| lines | 390 | 390 | varies in y only — degenerate by construction |

**TPDF dithers less, not better.** Two uniform draws summed concentrate the
threshold near 0.5, so it breaks a ramp up less than plain grain at the same
amplitude — it trades break-up for a quieter floor. Worth knowing before
reaching for it as "the better noise".

**Still not in the rack:** true blue noise (a void-and-cluster LUT — the one
pattern that would need a baked texture, and IGN gets most of the way there for
free), and a **surface-locked** dither. The pattern is keyed to
`floor(vUv * uPix)`, i.e. screen space, so the weave crawls across surfaces as
the camera moves; the composite already carries `invPV`, `camPos` and
`depthTex`, so keying it to reconstructed world position is possible and would
make the weave stick to the ground. It is the most interesting experiment left
and the most likely to look worse — it will swim at silhouette edges where the
depth reconstruction jumps.

### The wide chart makes the weave the picture

Reported from the seat, browsing Europe from a truck in California: "larger
(dither?) circles" in the far shell, which the baked globe beneath it does not
have. Four suspects read innocent from the code and one measurement before the
frame was reproduced: the 48–80m mottle and the cloud shadows (both faded to
nothing by `smoothstep(15, 60, uMpp)`, and `chartMpp()` is ~11,000 there); the
fine world's repeat-70 procedural normal map (the shell does not wear it —
`farMatFor` builds an OBJECT-SPACE map from the tile's own DEM); and
bathymetry (on the real z5 terrarium tile at 52N 25W the palette's slope shade
spans 0.95–1.00 across a 990km tile, under a quarter of one palette step, so
it crosses no boundary at all).

**Four composites over ONE scene render settled it** (`devtools/far-circles.mjs`,
47N 8E at zoom 19,300 — `mpp 10,989`, the seat's own scale — all 25 z5 tiles
home): 256 levels with the amplitude at zero is SMOOTH, no blobs anywhere; 14
levels with it at zero is the same patches, posterised with hard edges; the
shipped pair is those patches woven. Every circle is in `ditherQuant` and none
is in the terrain.

**The mechanism, and why it only bites out there.** An ordered dither puts its
pattern on every pixel whose value falls between two levels — 57% of the
terrain pane on the undithered render, and that share is the same at every
zoom, because it is a property of a smooth signal and not of the scale. What
scales is the SIZE of each such patch: one palette step divided by the
signal's gradient. From the seat the ground crosses a step in a pixel or two
and the weave is a thin band that reads as texture. On a 3,874km chart the
shell's colour has been averaged into a ramp a few steps deep across the
whole frame, and the same weave spreads over connected regions measured at
**3,115 art pixels for the largest — 63 across, 166 screen pixels on the
phone — then a family at 12–22 art px (33–58 screen px)**. A 4×4 tile
magnified 2.6× over a patch that size is not texture; it is a blob.

**So past the fine ring the tile gives way to a pattern with no period.**
`uDPatWide` (interleaved gradient noise, index 6) takes over from the dial's
pattern once `uMpp > 60` — the boundary the cloud shadows and the mottle
already stand down at, so the chart changes its rules in one place, and 0
from the seat by construction. `?widedither=0` is the exact A/B;
`__dither().wideNow` says whether THIS frame is past the line, which is how a
test tells "IGN because the chart is wide" from "IGN because the dial says
so". The bay's copy pass keeps the dial's pattern: it is never a wide chart.

**Measured over the same render, every pattern in the rack** (`SWEEP=1`):
the autocorrelation of the detrended luma at bayer4's own period, over the
terrain pane at art resolution, labels and roads masked. The undithered
render — the terrain's own structure — reads 0.135 at lag 4. bayer4 reads
**0.229**, bayer8 0.218, bayer16 0.215, check 0.272: every tiled pattern ADDS
a period. IGN reads **0.078 at lag 4 and 0.072 at lag 8**, the only pattern
below the terrain at every lag; grain matches it at 4 and clumps back to 0.175
at 8, TPDF 0.104 and 0.197. More levels help bayer4 (0.144 at 28) at the cost
of 534 tones against 204, which is a different look and not this fix.

**Verified on the build that ships it**, same stand, blind boot, no page
errors, `__dither()` reading `patWide: "ign", wide: 1, wideNow: true`: the
shipped frame's period at bayer4's lag went **0.216 → 0.088** (lag 8: 0.301 →
0.140), under the undithered terrain's own 0.137, with the tone count
unchanged (230 → 238). The frames are the pair `farc-before-bayer4.png` and
`farc-shipped.png` in `$DRIVE_WORK`; by eye the sea is an even grain and the
coast, the Alps and the roads are exactly where they were.

**Two things the run-length table above cannot see, which is why this was
measured on the frame it is for and not read off the table.** That table was
taken at a junction zoom, where the gradient is steep and every ordered
pattern saturates at a run of 3; it ranks patterns by how well they break a
ramp, not by whether their period is legible over a sixty-pixel patch — the
question the wide chart asks. And the baked globe reads visibly crisper at
the same zoom (`farc-globe-only`): not because its data is finer — it is
39km a texel, magnified 3.5× there — but because its bake draws palette
breaks as hard steps at its own resolution where the shell hands the
quantiser a smooth ramp. That is the same fact as the cost arithmetic in the
planet section, seen from the other side: the globe is the layer built for
this scale.

**Anything hung around the eye is a function of the CAMERA, not of the frame.**
The scene is rendered more than once per frame — the world through `camera`,
then the chart's POV dock through `miniCam`, then the studio bay — and anything
set once per frame is silently inherited by every render after the first.

The sky dome is the worked example. It is a 20km shell centred on the eye, and
its centre, its scale and the cloud deck's ray origin (`uCamXZ`) were all set
from the main camera. Reported from the chart: the sky in the dock lifts and
drops as the MAIN viewport zooms. It did — the chart camera stands 3.4km up at
reading zoom and 93km up at the ceiling, and the dock's preview, whose eye is at
1.3m, was drawn under a dome centred at whichever of those the chart happened to
be at, inflated by up to 3.4x because the scale rides the chart's near plane.
Measured with `__docksky`: gaps of 5km, 32km and 97km across three zooms, and
the far end rendered as a black band where the sky should be.

`aimSky(cam)` is now called once per RENDER. The dock block already did exactly
this for `ovGroup`/`farGroup` under a comment reading THE DOCK IS A POV, SO IT
GETS THE POV'S WORLD; the sky was simply missed when that was written. If you
add another camera, it needs the same treatment — and `__docksky` reports the
dome's position from inside `blitPixelated`, at the render rather than beside
the assignment, because a value asserted next to where it is set proves nothing.

**Layers are NOT the fix for this, and were the first thing suggested.**
`Object3D.layers` + `Camera.layers` do work — `skyDome.layers.set(2)` with
`camera.layers.disable(2)` would genuinely hide the dome from the chart — but
hiding it solves the wrong problem twice over: the dock NEEDS the sky and needs
it in the right place, and the chart needs it too, because a hole in the
streamed world shows the dome and a chart with no backdrop is the black map that
was reported at half past midnight. Reach for layers when a camera should not
SEE something; reach for a per-camera update when every camera needs its own
version of it.

**GLSL ES 1.00**: dynamic indexing of a uniform array in a fragment shader is
illegal. Use a lookup texture. (`markTins` in `facade.ts` is the worked
example.)

**A backtick inside a GLSL comment breaks the enclosing TS template literal.**
This has now cost three separate rounds. Do not write `\`f\`` in shader
comments.

---

## The one wind, and who reads it

`worldWind` is the single source: bearing and km/h, from live weather, or
forced with `?wind=60&winddir=200` / `__windset(kmh, deg)` — which exist
because a calm day is the common case and nothing wind-driven can be judged
from the seat, or asserted in a harness, without a gale you can ask for. Every
consumer goes through `windKmhNow()`/`windDegNow()`, so a forced wind cannot
make two of them disagree.

The readers: the sky deck and the cloud shadows it throws (`envU.uWind`), the
standing-water swell (`waterU.uWDrift`), the hydro system, the ambience mixer's
`gusty`, the sward (`windU`, both the CPU tufts and the GPU field) — and, since
the complaint that a stiff breeze lays a meadow over between a hundred rigid
lampposts, **the trees**.

- **THE TREES WERE NEVER PATCHED, and nothing could see it.** `leafMat`,
  `woodMat`, `stoneMat` and `ezMaterial` simply had no wind term. A material
  that had silently never been given one looked exactly like one that had, so
  `__fxchain()` now covers `ez` and `wood` too and `__wind()` reports the live
  wind beside the crown throw it implies — the number to argue with when it
  looks wrong from the seat.
- **`uWindK` IS THE WHOLE DIFFERENCE BETWEEN GRASS AND TIMBER.** `uGust` is
  direction × amplitude in metres of tip travel per metre of BLADE — the
  grass's unit, and far too much for wood. `TREE_WIND_K` (0.085) is the
  fraction of that a tree takes, so a 20m crown moves about 15cm on an ordinary
  day and about 60cm in a blow. `?treewind=0` is an exact A/B.
- **THE SQUARE OF THE RISE, BAKED PER VERTEX** (`swayWeight`). A blade leans
  linearly because it is uniform all the way up; a trunk is stiff at the base
  and limber at the tip. It is baked rather than computed as `y*y` in the
  shader because the archetypes are not normalised to a common height — a
  conifer cone stands 2.6 units and a bush 1.2, so one shader line would have
  swayed the conifer six times as hard for no reason but how it was built. That
  also makes STIFFNESS a property of the plant: palm 1.6, shrub 1.3, acacia
  1.2, bush 1.1, broadleaf 1.0, conifer 0.7, **cactus 0.1** — a saguaro in a
  gale is a saguaro. The EZ bake is already unit-height, so the skeletons use
  `y*y` directly.
- **THE OFFSET IS A WORLD DIRECTION, PROJECTED BACK INTO THE INSTANCE.**
  Instances carry a Y rotation (`v.rot`), so adding the gust in the local frame
  would have sent every tree in a stand its own way and a wood would have
  milled about instead of leaning downwind. `dot(gust, iX)/dot(iX, iX)` puts
  the same world metres on every tree whichever way it is turned, and survives
  the instance scale for free.
- **BIG TREES ARE SLOW.** Frequency goes as 1/sqrt(height) off the instance's
  own Y scale: about 2.3s a cycle at 20m, 1.2s at 5m. Phase runs along the
  wind's bearing at a forest's wavelength (~100m, against the sward's ~15m) so
  gust fronts sweep downwind, plus a per-instance hash so a stand does not
  pulse as one animal.
- **LEAVES FLUTTER FASTER THAN TIMBER BENDS.** `aWood` already separates crown
  from wood for the colour; the crown takes a second, quicker, smaller term on
  top of the bend. Nothing extra is stored for it.
- **WOOD AND STONE STAY RIGID** — deliberately. `woodMat` draws the archetype
  snag, the fallen logs and the separate trunk mesh under archetype crowns, and
  a log swaying would be worse than a still forest. The archetype crown sits on
  that rigid trunk and its own base is planted, so there is no seam: what moves
  is the canopy, which is what a palm actually does.
- **CHAIN, DO NOT CLOBBER** — `leafMat`'s hook is assigned BEFORE `terrainFx`
  and `grainFx`, which capture and call the previous one. This is the third
  helper to want that one slot, and the grass lost its wind for months to a
  hook written straight over another.

Verified by `devtools/tree-wind.test.mjs`: `__fxchain` for the structure, and
then pixels, because carrying a uniform proves nothing about motion — a shader
that fails to link logs to the console and throws nothing. Two shots 1.5 sim
seconds apart in a 70km/h wind, run once with the sway and once with
`?treewind=0`; the sward moves in both, so the measurement is the difference
between the runs and never against zero. **Measured**: 31.89% of the frame
moved with the trees swaying against 16.22% with them rigid — the trees roughly
double what a gale changes on screen — with no page errors and `wood`/`stone`
confirmed still rigid.

**FOUND WHILE LOOKING, NOT FIXED: `ezMat` never gets `terrainFx`.** The audit
reports `ez: ["wind", "grain"]` beside `leaf: ["wind", "terrainFx", "grain"]`,
so the baked skeletons — which are now EVERY broadleaf, conifer and snag —
are the one thing in the landscape standing outside the cloud shadows and the
weather tint that the archetypes, the sward, the stones and the ground all
take. It is a one-line fix (`terrainFx(ezMat)`) and deliberately not made
here: it would change the look of every tree in the game, and it may well be
a considered omission, since the skeletons carry the largest fragment bill in
the scene and `terrainFx` is not free. Ask before landing it.

## The site: a continuous environment under the five biomes

`climate.ts` above `siteAt` answers one question — which of five biomes is this
— from latitude, height and a moisture read off the LAND COVER. That last part
is partly circular (the vegetation predicts the vegetation) and it has nothing
to say where cover is coarse or absent. Five classes also put fynbos,
chaparral, savanna, steppe and monsoon forest in one box.

`siteAt` is the layer under it. It does not classify: it reports the physical
facts a plant responds to — heat, the annual range, frost, water and WHEN the
water arrives, continentality, rain shadow, height against the treeline — and
leaves the choosing to whatever sits on top. It reads no land cover, so it is
not circular.

- **THE LOCAL HALF IS THE POINT.** `CLIM_G` is 2048m and its note is right:
  climate does not vary meaningfully inside two kilometres. But a Cape ravine
  holds forest while the slope above it holds fynbos, and a coastal California
  gully holds redwood beside a chaparral ridge — same climate cell, different
  ASPECT and DRAINAGE. **No refinement of the climate term reaches those, at any
  resolution**, so `insolation` (slope and aspect against a hemisphere-aware
  sun) and `wetness` (a ring test — a ravine floor is flat and reads as a plain
  to any gradient; it is the WALLS that say what it is) are sampled from the
  terrain at terrain resolution.
- **WHAT THE NUMBERS ARE.** Three gaussians on the general circulation — the
  ITCZ's rain, the storm track's rain, and a floor — modulated by distance from
  the sea and by what the wind had to climb. Not a climatology, not measured. A
  bioclim raster would beat them everywhere; the value of one sampler is that
  swapping to one is a swap, not a rewrite.
- **FOUR ERRORS THE FIXTURES FOUND, AND THE TERMS THAT FIXED THEM.** The first
  version passed every band it was given while being six degrees wrong — which
  is what a too-generous band buys. *Manaus at 1261mm against 2300*: the
  interior-drying penalty was flat, and 1400km means nothing to the Amazon
  because the ITCZ delivers regardless and the forest recycles its own water;
  the penalty now fades toward the equator. *Reykjavik at −1.2°C against 5.0 and
  Irkutsk at 5.5 against 1.0*: one missing term with a sign, not two errors —
  the sea moves the MEAN as well as widening the range, mildly poleward and
  hardly at all in the tropics. *Tamanrasset at 14.5°C against 22*: no
  aridity-heating, so a cloudless desert ran at its latitude's temperature.
  *Yosemite at 464mm against 900*: terrain could only ever SUBTRACT — one
  sampling of the upwind ground gives both, its highest being the shadow you
  stand behind and its lowest the climb the air made to reach you.
- **THE DESERTS ARE THE KNOWN MISS AND THE SUITE SAYS SO.** Tamanrasset lands
  at 17.2°C/135mm against 22°C/45mm, Death Valley 20.6/140 against 25/60 — a
  heated plateau does not cool at the free-air lapse rate, and three gaussians
  cannot make a place as dry as the Sahara. Asserted loosely and deliberately
  rather than omitted or tuned away.

**Measured** (`devtools/climate-fixtures.test.mjs`, pure node — esbuild the
module and import it, the route `culture.test.mjs` takes; seconds, no browser,
no tiles, no cover raster). Nine sites against published normals: temperature
within 3.5°C everywhere (Reykjavik +0.2, Manaus −0.9, Irkutsk +1.1, the worst
Ulaanbaatar +2.9), rain within a factor of 1.5 in the tropics and 2.2
elsewhere. **The tolerances are the ones the model earns**; tightening them is
how the next improvement gets noticed instead of absorbed.

- **CONTINENTALITY IS BAKED, NOT STREAMED** (`devtools/bake-coast.mjs` →
  `coast-baked.ts` → `coast.ts`). It has to be answered at 400km, which is the
  one scale nothing the game streams reaches — the fine ring stops at 5km and
  the chart's overview at 47. Natural Earth 110m land (127 features, 5143
  vertices, 138KB) rasterised to a half-degree mask, chamfer-transformed to the
  nearest sea cell with a PER-ROW horizontal step (an equirectangular cell is
  55.6km tall everywhere and narrower away from the equator, so a transform in
  cells would call Siberia as coastal as the Congo), and stored one byte a cell
  SQRT-scaled over 0–3000km: half a kilometre of resolution at the coast, twelve
  in the far interior, which is the right way round.
  **Bundled rather than fetched**, and that is the deliberate half: 55KB gzipped
  on a 618KB bundle, against a fetched asset that would leave every climate
  verdict unevidenced for the first seconds and then CHANGE it — the failure
  this codebase has recorded from the seat more than once.
- **AND THE BAKE SPLIT `salt` OFF FROM IT.** The measurement made the case:
  a half-degree field puts Cape Town at 0km and Singapore at 57. Perfect for a
  400km e-folding, hopeless for a term that resolves nine hundred metres. So
  `coastKmAt` (coarse, global, kilometres) and `seaNearAt` (local, metres) are
  separate inputs, and deriving salt from the coarse one — which the first cut
  did — would have made every coastal city a mangrove swamp.

**ECOREGIONS ARE THE ONE THING CLIMATE CANNOT DERIVE**, and they arrive through
the same read-through cache as everything else (`~/eco/v1/{z}/{x}/{y}`,
`serveEco`). The Cape is an ordinary Mediterranean climate — mild wet winter,
bone-dry summer, maritime — growing something structurally unlike any other
Mediterranean climate on earth, and no refinement of a temperature and a
rainfall reaches it because the difference is not climatic. RESOLVE Ecoregions
2017 (846 regions in 14 biomes) via ArcGIS Living Atlas, **verified against the
fixture set before the route was written**: the Cape returns *Fynbos
shrubland*, Yosemite *Sierra Nevada forests*, Zermatt *Alps conifer and mixed
forests*, Tamanrasset *West Saharan montane xeric woodlands*.
One zoom and a coarse one — z5, ~1250km tiles, simplified to 0.05° server-side.
Measured over the Cape: six features, 52KB gzipped, and the six are exactly the
distinctions that matter (Fynbos, Renosterveld, Succulent Karoo, Albany
thickets). 0.02° doubled the payload and moved nothing. An EMPTY tile is a real
answer and is stored like any other — most of the planet is ocean and has no
terrestrial ecoregion, and leaving that unwritten makes the commonest tile on
earth a permanent miss.

**WIRED INTO THE WORLD NOW.** `siteEnv` in main.ts extends `climEnv` with the
three inputs the biome field never needed — the SIGNED latitude, the coarse
`coastKm`, and `seaNearAt` — and `siteNow(x, z)` memoises a site on a 250m cell
stamped with `terrainBuilds`, so a verdict reached before the DEM arrived never
outlives the ground that would correct it. `client/eco.ts` decodes the z5
ecoregion tiles and answers a point; main.ts asks for the truck's tile from the
stream loop and `ecoAt` looks it up. The place card carries SITE, LOCAL and ECO
rows beside BIOME; `__siteclim(x, z)` is the probe and `__sitecard(x, z)` the
card's own rows. Nothing chooses a plant with any of it yet — that is the
guild layer, and it is next.

- **`seaNearAt` IS A DIFFERENT QUESTION AND HAS TO BE CHEAP.** `oceanAt` cannot
  say "I do not know" — it answers false for dry land and for a point no cover
  tile covers — so the tile index is asked directly, and only a covered point
  ever walks rings. The first cut walked 818 samples out to a kilometre, each
  one a mask read through every loaded cover tile, on every INLAND site as well.
  The baked coast field rejects the interior for free (a half-degree cell is
  55km, so past 60km nothing is within a kilometre of salt water), and what
  survives that walks 16 samples on 100m rings, which is the resolution `salt`
  can actually use.
- **`__site` WAS ALREADY TAKEN** by the place card, years ago. The site
  sampler's probe is `__siteclim`, and the card's rows are `__sitecard` —
  separately, because the card also counts cover, samples the hydro field and
  reads the tile books, none of which belongs in a call used to time the memo.
  `__field` is a third thing again: the LINE's tile-pipeline record.
- **THE ECO ROUTE NEEDED A HARNESS ROUTE.** `devtools/harness.mjs` serves a
  fixed list of paths and 404s everything else, and `loadEcoTile` reads a 4xx
  as permanent — so the first in-world run reported `ecoState: failed` on frame
  zero and looked exactly like a broken cell. Proxied to the deployed cell now,
  like the overview, summit and fine vector tiles, and for the same reason: no
  client fallback exists, so a local 404 does not degrade the layer, it deletes
  it.

**AND WIRING IT FOUND A SIGN ERROR NOTHING ELSE COULD.** The first honest run
at Chapman's Peak read `insolation 1.00` — full sun — on ground the card
described as falling 32° SOUTH at 34°S, which is the pole-facing side of the
ridge. `sunward` was built from `dz`, the GRADIENT, which points UPHILL; the
direction a slope faces is its negation. Every pole-facing slope on earth read
as sunny and every sunny one as shaded, **symmetrically in both hemispheres**,
which is exactly why nine climate fixtures were green: the authored hillside in
`climate-fixtures.test.mjs` was built from the same wrong premise, so the model
and its test agreed. `aspectLift` — the term the game has actually shipped for
months — had it right all along, so nothing on screen was ever wrong.

Three things came out of it, and the third is the general one:

- the minus sign in `siteAt`;
- the same minus in the fixture's own ground function, plus a `fall` relief
  option that is stated in ABSOLUTE world terms (+z, whatever the hemisphere) —
  because a hemisphere-relative fixture cannot catch a hemisphere-symmetric
  error, and the new pair asks about ONE slope at +45° and −45° and requires
  opposite answers;
- **a new term is asserted against the shipped one, not against its author's
  idea of a slope.** `insolation > 0.5` must equal `aspectLift < 0` on the same
  ground, four ways. Reverting the sign fails all eight of the new assertions
  and prints the contradiction (`insolation 0.11` beside `aspectLiftM -105`);
  before the fix, two of them passed.

Held by `devtools/eco.test.mjs` (pure: authored geometry with a hole, a
multipolygon and a vertex on the ray, then the live tiles under five fixture
sites — the Cape returns *Fynbos shrubland*, Manaus the
*Japurá-Solimões-Negro moist forests*, 38µs a lookup worst case) and
`devtools/site-world.test.mjs` (the real thing at Chapman's Peak).

**AND A TEST'S COORDINATES ARE PART OF ITS MEASUREMENT.** The first cut of
`site-world.test.mjs` used a point four hundred metres north and passed every
assertion in it — while the truck floated in Hout Bay: elevation −1m, cover
WATER, ground WATER, salt 1.00, and a "Mediterranean" temperature that was the
sea-level fallback for a world with no DEM under it. Sixteen green checks
describing the ocean. The spot was then chosen by reading the terrarium mosaic
directly (318.7m), and the preconditions — on land, on the hillside, DEM
arrived — are assertions in the file rather than assumptions behind it.

## The guild: what actually grows, from the site and the ecoregion

`client/guild.ts` is the layer that turns the two sensing layers into a
landscape. It is pure, it draws nothing, and it needs no new art: it returns
weights over the SAME twelve archetypes the game has always had, plus a height
and a density multiplier. A guild is a proportion, not a species.

Two inputs, two jobs, and they are genuinely different questions:

- the **ECOREGION** says what KIND of vegetation this is — RESOLVE's fourteen
  biomes, looked up because no climate model can derive them.
- the **SITE** says how much, how tall, and what THIS slope does — the ravine
  that holds forest in shrubland country, the pole-facing face that holds
  conifer in a broadleaf valley, the salt sliver where only mangrove lives.

`?guild=0` is the exact A/B and restores the shipping climate path completely.
`guildAt` returns **null** wherever there is no region — the sea, a fixture, a
tile still in flight — and the caller then runs the old path unchanged; a
half-guild would be a landscape that changes species under the player.

- **THE REALM IS THE OTHER THING ONLY THE DATASET KNOWS.** Cacti are Nearctic
  and Neotropic; everything cactus-shaped in the Sahara or the Karoo is a
  euphorbia that converged on the silhouette. The old rule had one `arid`
  archetype for the planet and put saguaros in the Sahara. The gate is a string
  compare on `REALM`, and the weight goes to `bush` rather than vanishing —
  an Old World desert has the same amount of standing scrub, it is a different
  plant.
- **A RELATIVE BOOST APPLIED TO A TOKEN WEIGHT INVENTS A STAND.** The first
  A/B put conifer at 35% of the Cape's standing plants — worse than what it
  replaced — from a "the shaded face favours conifer" rule multiplying a mix
  that carried one point of conifer against two of broadleaf. Two fixes: the
  Mediterranean row leans its trees hard to broadleaf (3 against 0.5), and the
  boost is gated on the conifer's EXISTING share of the mix, so it shifts a
  mixed wood and cannot create a pine forest out of a rounding error.
- **A DRY BIOME IS NOT A DRY FOREST.** The aridity multiplier halved the Cape's
  density, because fynbos at 350mm tripped a rainfall penalty — but summer
  drought is the DEFINITION of Mediterranean scrub, not a degradation of it,
  and the row already says how dense it is. Only rows flagged `dry` (the six
  forest biomes) thin on their own dry edge; a savanna, a desert, a tundra and
  a scrub carry their spacing in the row.
- **THE COVER PIXEL NARROWS THE GUILD; IT DOES NOT REPLACE IT.** A canopy pixel
  picks from the guild's TREES — WorldCover is 10m data and is right about the
  structure of this spot, while RESOLVE at z5 is right about the country — so
  fynbos on a tree-cover pixel grows the trees that stand out of fynbos rather
  than becoming a wood. Bare and frozen ground stays geology whatever the
  region says.
- **A SEED IS ONE-SHOT, SO THE CELL WAITS FOR ITS REGION.** `seedCell` already
  defers up to 30s for a cover tile; it now strikes the same bargain with the
  ecoregion, because a cell that seeds before its region lands plants the
  climate's guess and is never revisited.
- **THE MEMO NEEDS A SINGLE ENTRY IN FRONT OF IT.** `guildNow` is asked once
  per vegetation candidate and once per planted site — tens of thousands of
  times in a seed burst — and a 250m cell key is a string allocation per call
  in the hottest loop the vegetation has. The map is still there for the cell
  either side; the front cache is what stops the allocation.

Probes: `__siteclim()` carries the guild with its `why` (the interesting half —
what moved it off the base row); `__sitecard()` shows the GROWS row a player
reads; `__stand(r)` counts what is actually PLACED by kind with the mean scale
and the population per hectare, which is the only instrument that can see
density and height — `__vegkind` rolls the chooser and cannot.

Held by `devtools/guild.test.mjs` (pure, a second, and every case is one the
five-biome model gets wrong), by `devtools/guild-fixture.test.mjs` (four worlds
in 30 SECONDS, no network, the same answer every run) and measured in the world
by `devtools/guild-ab.mjs`, which boots the same spot twice with the switch as
the only difference.

**A FIXTURE DECLARES ITS ECOREGION.** `ecoAt` refuses to fetch on a fixture —
asking would pull the REAL ecology of the authored crossroads' coordinates, the
country above Geneva, which is the trap `loadOvTile` and `loadPeakTile` already
wear a gate for. But a flat null left the guild untestable on the only worlds
that are deterministic and need no network: every fixture fell back to the
climate path, so the fast offline harness could say nothing about the rule that
decides what grows. `WorldFixture.eco` is one record — id, biome, name, realm —
and a point answer for a 700m–1.4km box is not an approximation worth
apologising for, because an ecoregion boundary is not real to five kilometres.
The six captures carry theirs from one lookup at their own coordinates, recorded
in `CAPTURE_INDEX`; `capture-world.mjs` prints the line to paste for a new one
and deliberately does NOT write it into the capture JSON, which is the three
world FETCHES and nothing else.

The set is worth knowing, because the answers cannot all be the same:
Camps Bay is *Fynbos shrubland* (12, Afrotropic), Big Sur and both Carmels are
*Santa Lucia Montane Chaparral & Woodlands* (12, Nearctic), both Paris captures
are *European Atlantic mixed forests* (4, Palearctic), and an authored fixture
is nowhere — which has no ecoregion and keeps the shipping path. The Cape and
Big Sur landing on the SAME guild is the honest answer: fynbos and chaparral
are structurally alike, and the realm parts them only where a cactus is
involved.

**A STABLE COUNT IS NOT A SETTLED WORLD, AND A FRAME IS NOT A CLOCK.** Two
gate mistakes in a row, each measured:

- The first A/B accepted twenty frames in, on a world holding 27 plants — the
  population had not started moving yet, so the "comparison" was between two
  accidents of arrival order. So: a floor before stability counts.
- The floor was in FRAMES, which paces the BUILD and says nothing about the
  NETWORK. Turning the draws off made a frame a tenth of the wall time, so the
  same 900-frame floor took thirty seconds instead of twenty minutes — and
  measured a third fewer plants, because the tiles were still on the wire. The
  gate is wall-clock now (90s floor, 25s of the count holding still), and both
  runs of a pair use the same numbers, which is what makes the comparison mean
  anything.

**AND THE DRAWS WERE MOST OF THE FORTY MINUTES.** `guild-ab.mjs` drew because
it took a screenshot; headless paints through SwiftShader at two to four frames
a second AND THE WORLD BUILD IS PACED BY THE FRAME LOOP, so drawing did not
merely cost the picture, it slowed the streaming the measurement was waiting
for. The frames were no use anyway — a chase camera on a 32° slope shows sward
and hillside, and a shrub at that distance is three pixels. **Numbers are the
default, `--shots` is opt-in**: 8m26s a pair against 40 minutes, on a MORE
complete world.

**MEASURED**, Chapman's Peak, both runs settled at 392 frames, the switch the
only difference:

| within 300m | guild | climate (`?guild=0`) |
|---|---|---|
| palm | **0%** | 16% |
| acacia | **0%** | 3% |
| bush | 32% | 37% |
| broadleaf | 45% | 22% |
| plants per hectare | 3.4 | 4.1 |
| mean scale: bush | **0.67** | 1.08 |
| mean scale: broadleaf | **1.03** | 1.84 |
| mean scale: snag | **1.28** | 2.02 |

**WHAT ACTUALLY CHANGES IS HEIGHT AND THE VETOES.** Every woody plant loses a
third to a half of its height, which is the difference between a scrub and a
thin wood; and a sixth of the standing plants at the Cape were PALMS, with
acacias beside them, in a shrubland that has neither. The broadleaf share rises
because the guild's tree list for this row is broadleaf-heavy where the climate
model split a canopy pixel four ways.

**AND THE MEASUREMENT MOVED WHEN THE GATE DID.** An earlier, less-streamed run
of the same pair read palm 7% and broadleaf 13/9 — same direction, weaker
everywhere, because the world was a third empty. Quote a number from this table
only against the gate that produced it.

The other two sites, same gate:

| | guild | climate |
|---|---|---|
| **Sahara** (13, Palearctic) — `why: no cactus outside the New World` | cactus 0% | cactus 4% |
| standing plants | 15 (0.5/ha) | 22 (0.8/ha) |
| **Sierra** (5, Nearctic) — conifer share | 52% | 34% |
| palm / acacia | 0% / 0% | 2% / 1% |
| standing plants | 410 (14.5/ha) | 509 (18/ha) |

**AND THE SIERRA CAUGHT A TERM TRUSTING A GUESS TOO FAR.** The first Sierra run
read density 0.62 and thinned a Sierra Nevada conifer forest from 511 standing
plants to 322 — because the aridity multiplier read `waterMm` linearly, and the
model says 372mm at Yosemite against a real ~900. `waterMm` is three gaussians
whose own fixtures claim only a factor of 1.5 in the tropics and 2.2 elsewhere;
a term that responds linearly to it is trusting it far past what it is worth.
The response is sub-linear with a 0.55 floor now (`0.55 + 0.45·min(1, mm/600)`),
so a true desert still reads as one and an under-rained forest stays a forest:
0.62 → 0.83, and 410 plants against 509. **The general rule: a derived quantity
with a stated tolerance must not drive a visible effect harder than that
tolerance allows.**

## The attract reel drives itself

A tape (`client/tapes.ts`) is recorded INPUT — four bytes a step of steer,
throttle and brake, replayed through the sim. That is right for a player's own
banked run, because a run is a performance and the point is that it was theirs.
It was wrong for the house programme, and the arithmetic says why: the two
authored tapes ran **21.25 and 18.9 seconds**, so forty seconds of driving was
the whole show, and every extra minute had to be driven by hand and pasted into
the bundle as base64.

`client/reel-drives.ts` is the same entry as data: WHERE TO BOOT and WHERE TO
GO. The autopilot — the same `goal` and Dijkstra route the DRIVE TO action
already uses — does the driving, live, on the player's hour and weather. A new
postcard costs two coordinate pairs and a name.

- **IT IS A DIRECTION, NOT AN APPOINTMENT.** The slot ends on a time cap far
  more often than on arrival, by design: the goal exists to give the router
  something to aim at so the truck takes the scenic road rather than the first
  turning. Three ends, and all three are needed — ARRIVED (`goalDone`), CAPPED
  (the slot's own seconds), STUCK (`ATTRACT_STILL_S` of not moving). Without
  the last, the orbit circles a parked truck for ever.
- **THE AUTOPILOT IS ENGAGED LATE, NOT AT ARM.** It needs a road graph and
  there is none in the first frames after a hop. `attractDriveTick` waits for
  `roadGrid.size`, and writes the slot off after `ATTRACT_ROADS_S` if the
  survey never arrives. (That rule was seen working before it was wanted: with
  drawing on, the harness streams at three frames a second, no road reached the
  rig in forty seconds, and the slot correctly moved on.)
- **THE BANKED PATH IS UNTOUCHED.** The reel is designed to show the player's
  own runs and the authored tapes were "placeholders for a cold account, not
  the show" — so drives replace that fallback and a signed-in player still sees
  their own tapes. `ATTRACT_TAPES` stays: the recorder writes them, a banked
  run is one, and the reload fallback re-arms from whichever bundle
  `reelList` would have built.

**THE PAUSE AND THE REEL FLATLY CONTRADICTED EACH OTHER.** `paused` is
`menu.tab() !== null`, and the reel only runs with the hub OPEN — `stepAttract`
stands it down otherwise. A recorded tape never noticed, because `played` is
spliced in ahead of the pause: a replay drives a paused world by construction.
The autopilot has no such splice — it is handed `off` when paused AND its
output is zeroed when paused — so a driven slot armed, engaged, streamed four
thousand road cells and **sat still for ninety seconds with `src: none`**. A
driven reel is exempt from the pause now, exactly as REAL drive already is, and
recording is suppressed separately so the reel's own driving cannot land in the
player's tape ring and come back as something they KEPT.

**AND `?nodraw=1` FROZE THE WHOLE SUBSYSTEM.** The hop leaves from after the
render because it captures the frame it is departing on for the cross-fade;
with nothing drawn there is no frame, and the early return skipped the hop
entirely. So the one flag that makes the harness fast made the reel untestable.
It travels under `nodraw` now.

**EVERY START IS ON A ROAD, AND IT IS CHECKED** —
`devtools/reel-roads.mjs`, against the same OSM tiles the game streams. It
exists because the first cut put Chapman's Peak at `-34.0745,18.3590`, a
coordinate THIS SESSION had already established sits in Hout Bay, on the water.
The failure was silent in the way that costs an afternoon: the slot armed, the
goal was set, the roads streamed, the autopilot engaged, and the rig sat still
because there was nothing under it to drive on. A start must be within 25m of a
drivable way; a goal need not be on one at all, since the router aims for the
closest it can get.

Held by `devtools/reel-drive.test.mjs`, whose last assertion is the one that
matters most: **the reel gives the wheel back.** `travelTo` calls `attractStop`
on every tap, so a reel that left the autopilot on and a goal set would hand
the player a truck that drives itself to Noordhoek.

**AND A TEST HAS TO BE IN THE STATE THE FEATURE LIVES IN.** The first cut of
that test opened the world in chase view with no menu, so every slot armed
correctly and `stepAttract` stood it down on the very next frame — "leaving the
hub mid-reel means the player chose THIS place". The probe read `drive: null`
six times over and could not say whether the arm had failed or never been
attempted, which is why `__reel()` now reports `busy` (hopping, real, line,
pending, quiet) and `why` — the last reason a go did not arm.

## Routing across two maps

The router's graph was the fine OSM survey and nothing else, so a goal past the
ring had no path — while the chart was at that moment DRAWING the trunk road
that goes there. The overview tiles have always arrived as tagged polylines and
been spent on ribbons ("a backdrop nothing samples", in the layer's own words):
true of the picture, false of the need.

- **THE COARSE WAYS ARE KEPT** (`ovWays`), in world metres, exactly as
  `ovPlaces` keeps the names. RAW geometry, not the tile-clipped pieces the
  ribbons draw: a way crossing three tiles arrives three times and the node
  matcher collapses the shared ends, which is what makes the network continuous
  across a boundary instead of a row of stubs.
- **WHERE THE SURVEY ENDS IS A FACT; ITS BUDGET IS A WISH.** The handover was
  `osmRingR * 0.8` — the radius the tile queue is *willing* to reach — and the
  roads it has actually got are another matter. Measured: a budget of 1541m
  over a network that petered out at 250m, so the coarse tier began a kilometre
  beyond anything it could be joined to and floated unreachable. It now reads
  the graph it has just built: the **85th percentile** of fine-node distance,
  not the farthest (one motorway spur streamed along the corridor would drag
  the handover out behind it). Where the survey is healthy this lands on the
  budget; where it is thin the chart's roads arrive closer, which is the right
  way round.
- **AND NO FLOOR UNDER IT.** A fixed 250m looked like the obvious guard and
  cost three runs: the percentile *guarantees* that 15% of surveyed nodes lie
  beyond the handover, so there is always something to portal from, and a
  metre count guarantees nothing. The percentile is its own floor.
- **PORTALS, NOT GEOMETRY, AND ASKED FROM THE SURVEY'S EDGE.** A z10 polyline
  sits fifty to a hundred metres off the surveyed centreline of the same road,
  so `NODE_SNAP`'s metre and a half never fires between tiers. Each fine node
  past the handover — a road that, to the graph, ends in the middle of nowhere
  — gets one synthetic edge to the nearest coarse node within `PORTAL_R`,
  priced at the straight line × `PORTAL_K`. Asking from the coarse side instead
  made *zero* (three times as many nodes, a 105-cell span over the shared 4m
  hash, and the wrong question); asking from the survey's edge puts the join on
  the boundary where it belongs. The reach is 420m because the tiers are not
  two samplings of the same points — the nearest coarse node to the last
  surveyed one is routinely a few hundred metres *along* the road.
- **THE AUTOPILOT ONLY STEERS ON THE SURVEY.** The half that decides whether
  this is good or dangerous. A coarse leg is right about which valley the road
  goes up and wrong by a hundred metres about where it is, so `goalAhead`
  neither locates the truck on one nor walks past one: the driving line stops
  at the handover and the junction bias carries on, which is what that bias was
  built for. The chart draws the whole plan, the far half fainter and at a
  longer stride, because the plan has two confidences and should say so.

**Measured** (`devtools/far-route.test.mjs`): a 26km goal plans 26.18km, of
which 0.34km is surveyed and driveable; 104 of 175 points are the chart's; 28
portals across a 247m handover; 3.2ms over 349 nodes; and it finishes 225m from
the goal against 25,889m short before. The negative control matters as much:
take the coarse tier away and the same goal falls back to 0.43km and 25,689m
short, so the tier is doing all of the work and none of it is the search
getting cleverer.

- **AND IT COST 17% OF A PHONE'S CPU BEFORE ANY OF THAT WAS MEASURED THERE.**
  The harness said 3.2ms over 349 nodes; the device said 141,147ms over 286
  solves — a mean of 493ms, a worst of 1237ms, the single largest cost in the
  game, and a 797ms frame that was 732ms of route. A phone on Chapman's Peak
  has 72,084 road cells and thirty kilometres of coarse network behind them.
  Two causes, and the split (`graphMs` against `ms`) is now in the probe
  because the first telemetry could not say which:
  **the graph was rebuilt every solve** — every cell, every coarse way, every
  2.5s, to reconstruct something that had not changed. It changes when a fine
  tile streams, a coarse tile lands, or the truck moves `GRAPH_MOVE`; nothing
  else. Cached on exactly those, which also takes a large recurring allocation
  out of a session whose gap row is 27%.
  **And the walk settled the whole reachable component** — fine at five
  kilometres, tens of thousands of nodes behind thirty. It stops when nothing
  in the frontier can win, and the bound is EXACT rather than heuristic because
  the walk's contract is to find the closest the roads get: a prune that can
  drop the winner is a wrong answer, not a faster one. Dijkstra pops in
  increasing cost and no gap is negative, so nothing unsettled scores below
  `cost · GOAL_DETOUR`. **The tempting tighter form, `GOAL_DETOUR · (cost +
  gap)`, is unsound** and was written first: the next node need not lie beyond
  this one and may sit on a branch already nearer the goal.

**The bench injects its network** (`__ovinject`) rather than waiting for tiles.
Three runs went by measuring Overpass instead of the router — z13 after 36s
with 4km of reach, then z8 not arriving at all in two minutes — and every one
ended in an honest SKIP, which is not verification. The tile path is exercised
by the chart whenever anyone opens it; what needed a deterministic bench is the
graph, the portals and the steering rule. Probes: `__route()` (both tiers, the
portals, `inner` against `budget`, and the driveable fraction beside the
planned one), `__ovroads()`, `__ovinject()`.

## The chassis

The truck is three models stacked, and knowing which one is arguing matters
more than any single number in them.

- **The drive step** picks between ARCADE (the shipped bicycle model, the
  `trac` dial's 0) and the TYRE model (LOOSE/REAL, `stepTraction`). Both write
  `state.x/z/heading/speed` and `slideV`.
- **The suspension pass** lays the body on four wheel contacts and writes
  `bodyY`, `pitchC`, `rollC`, `groundedF`, `gradePitch`, `gradeRoll`, `axleMu`
  and `wheelMu` — which the NEXT frame's drive step reads. One frame of lag,
  deliberately.
- **`groundedF`** is the contact fraction, 0–1, summed from the four wheel
  deflections. It gates thrust, braking, steering and the friction budget.

Two rules used to stand in for physics here, and both were felt from the seat.

- **PARKED IS A HOLD, AND IT IS DECIDED BEFORE THE STEP.** The old `parkHold`
  zeroed `state.speed`/`slideV` AFTER `stepTraction` had already integrated the
  frame's position, so the velocities were reset and the DISPLACEMENT was kept.
  The shape of that leak is worth knowing, because it explains why the
  complaint came from the seat and never from the harness: the frame's own
  displacement is ½·a·dt², so the creep per SECOND is ½·a·dt — **proportional
  to the frame time**. On a 20° slope that is 2.8cm/s at 60fps, 5.6 at 30 and
  16.8 at 10, so the worse the phone was doing the further the parked truck
  wandered. It now latches (`parkLatch`) before the step and the step is
  skipped entirely: nothing integrates, so nothing moves. **Measured** on 1.1°
  ground with 28.8° of hold available, all three traction modes: 0.000m over
  5.1 sim seconds, speed and `slideV` both exactly zero.
- **THE GRADE IT SURVIVES IS THE TYRES', NOT A NUMBER.** g·sinθ pulls, μ·g·cosθ
  holds, so a standing truck stays put while `tanθ ≤ μ` — the angle of repose,
  read from the friction the four wheels are already sampling. Dry tarmac holds
  past 40°, wet mud lets go by 20; the old fixed 30° was wrong both ways.
  Release is the throttle, real drive, a wheel lifting, or a steeper grade
  streaming in underneath — never a timer.
- **THE BRAKE NO LONGER DEFEATS THE HOLD.** Requiring "no pedal" made the one
  input that should guarantee a parked truck the one that forbade it, and it is
  why a rig left on a hillside under the drone slid off its own pin.
- **NOTHING YANKS AN AIRBORNE TRUCK DOWN.** The reseat read
  `Math.abs(tY - bodyY) > 6` and seated the body on the ground whenever it
  found itself six metres from it, in either direction. It exists to recover a
  relocation that left the hull 3.9km up — but it cannot tell that from a truck
  that drove off a ledge, so every jump ended in a teleport at exactly six
  metres. Three narrow reseats replace it, each naming what actually went
  wrong: **buried** (`bodyY < tY - 6`, the ground came up through the hull — a
  lift, never a drop), **the ground moved** (`tY` jumped >6m in one frame while
  the truck was still standing on it, which is streaming and cannot fire on a
  truck already in the air), and **never landed** (12 unbroken seconds of air,
  a 700m fall; the watchdog, and the only one that is a rule). The fall itself
  is the heave spring's `-9.81` floor and nothing else.
- **AIRBORNE, THE ATTITUDE SPRINGS ARE OFF TOO.** They ARE the wheels holding
  the body against the ground; with nothing touching, chasing `tPitch` had the
  hull rotate in mid-air to lie parallel to terrain it was only flying over.
  In flight the body carries the rate it left with, bled at `exp(-0.6·dt)`; the
  springs re-engage the instant a wheel touches, and that is the landing.
  **Flying, not merely light**: the freeze needs `airS > 0.2`, because a
  descent over broken ground lifts all four wheels for a frame or two at a time
  (35% of frames on the Stelvio descent) and freezing the attitude on those
  would stop the body following a hill it is still driving down — which keeps
  the wheels drooped, which keeps it airborne, which is a loop.
- **GRAVITY DOES NOT NEED FOUR WHEELS** (`gravGrip`). Thrust, braking and
  cornering come out of the contact patch and are rightly scaled by
  `groundedF`; the pull down the hill is not — a truck accelerates at g·sinθ on
  four tyres, two, or ice. Scaling it by the contact fraction meant the
  steepest, most articulated ground was also where the hill stopped pulling.
  Any contact now gives the whole of gravity; only genuine flight takes it.
- **ROLLING RESISTANCE FADES OUT, it does not flip.** `Math.sign(u)` is a step:
  at a crawl it reverses every sub-step and shoves a nearly-stopped truck about
  in the noise. `clamp(u / 0.5, -1, 1)` is what a rolling wheel does, and what
  has stopped rolling is held by the latch instead.

**Measured** (`park-air.mjs`, Stelvio, LOOSE): `__launch(14)` gives an apex of
10.12m against the 9.99m that v²/2g predicts, a median descent acceleration of
−9.80 m/s², `grounded` 0 for the whole 2.9s of flight and a landing that
settles to a zero gap. Under the old rule the body was teleported onto the
terrain the moment the gap passed 6m — about 0.55s in, a third of the way up.
The same run also caught the model refusing to hold where it should: 39°, 32.5°
and 19.9° of ground against 28.8°, 28.3° and 17.5° of tyre, so the truck slid
in all three modes, which is right and is why the audit now hunts for ground
inside the repose angle before it measures a creep.

Probes: `__phys()` (adds `park` — the latch, the slope in degrees and the
degrees the surface could hold — plus `air` and `grounded`), `__susp()` (adds
`air` and `gap`), `__launch(vy)` kicks the sprung body upward so a fall can be
measured without hunting for a ramp, and `devtools/park-air.mjs` runs both
halves. Sim seconds cost roughly ten real ones in the harness, so keep the
windows short and state the thresholds per second.

Still open, and deliberately left alone: a landing costs the truck no forward
speed and no condition, however far it fell; there is no lateral load transfer,
so a corner never loses grip to roll; and a river current still walks a latched
truck downstream, which is arguably right and certainly untested.

## What main.ts actually is, measured

Surveyed with the TypeScript checker rather than by grep, because the first
pass matched identifiers by TEXT and reported **zero** dead declarations in a
42,000-line file — which is not a credible answer, and was shadowing: with two
thousand module names every short one collides with a local. Only symbol
identity is trustworthy here.

- **41,915 lines, of which 42% are comment.** The program is ~24,000 lines and
  the rest is this file's own doctrine doing its job. It is 64% of the client.
- **The whole body is the else-clause of one `if (startLab(...))`.** Nothing
  inside is module-scoped in the ES sense; it is one 41,800-line block, which
  is why nothing is exported and why every extraction so far has had to hand
  state across by hand.
- 2,024 declarations: 663 functions (22,375 lines), 828 `const`, 451 `let`,
  70 interfaces. Plus 494 loose statements — **304 of them probe assignments,
  4,744 lines, 11% of the file.**
- **There is almost no dead code.** 12 declarations referenced nowhere, 36
  lines; 6 more across the siblings, 24 lines. All removed. Three shapes worth
  recognising: aliases left behind when their call sites went with an
  extraction (`profileHints`/`hintedWays`/`writeHints`, whose own comment said
  they were kept so the call sites would read the same); a documented function
  whose consumer was deleted (`tapeCount`); and **a rule stated twice where the
  copies disagree** — `routeDriven` restated the inline mission check with
  `Math.min` where the live one has `Math.max(1, …)`, so an edit to the obvious
  helper would have changed nothing.
- **A checker cannot see the devtools.** They are `.mjs` importing an esbuild
  bundle, so `SERVICE_MARK`, `onLand`, `GUILD_BIOMES` and `corners` all read as
  dead exports and are test API. Re-grep `devtools/` before deleting anything.
- **302 `window.__*` probes, 120 driven by no devtool, test, lab or sibling.**
  Deliberate — a console surface — and they ship to every player.
- **The entanglement is shallower than the size suggests.** 366 of 663
  functions (55%) touch NO module `let`; 441 `let`s are read by at least one
  function and **197 by exactly one**. There is no god-variable: the largest
  hubs are `baseElev` (30 functions), `camMode` (24), `origin` (20). Eight
  utilities are reached by everything and would be imports, not members:
  `clamp`(44), `gkey`(19), `GRID`(18), `roadGrid`(17), `state`(14),
  `climateAt`(11), `hctx`(10), `groundAt`(9).
- **TREE SHAKING IS NOT THE LEVER.** esbuild already shakes, and there is
  nothing to shake. The 2.2 MB bundle is `three` 654 KB (28%), main.ts 641 KB
  (28%), **`coast-baked` 337 KB and `flora-ez-baked` 279 KB — 616 KB of baked
  data, 27%** — and 83 KB of LABS, which every player downloads because the
  platform bundles without code splitting. The levers are splitting and moving
  baked data to `static/`, not elimination.

## The soundscape, lifted out

`client/audio.ts`. It was the easiest thing in main.ts to lift and the survey
said so before anyone opened it: **624 lines reaching exactly three things
outside themselves** — `clamp`, a four-word string union, and a callback. Every
other input arrives as an argument, every frame, which is what a mixer is.
`createAudio()` returns the same twenty-member surface; `client/num.ts` now
owns `clamp` (44 of main's state-free functions reach it — the most shared
thing in the client) so a module that leaves no longer has to take a copy.

**THE CALLBACK DID NOTHING.** `syncBtn()` was `const syncBtn = (): void => { /*
label is drawn from audio state each frame */ };` — an empty arrow, declared
four hundred lines BELOW the call that hoisting made legal, kept alive for a
button that had stopped needing it. It was the only thing in the file reaching
back into the game, and moving the file is what made it visible.

**AND THE VOICES DID NOT AGREE ABOUT WHAT "OFF" MEANS.** Eight one-shots asked
for a context, a master, a RUNNING context and the dial on. `update` and
`ambience` omitted the dial — safe, but only because the context happens to be
suspended when the dial is off, which is a coincidence and not a reason. And
`brush`, `scrape` and `water` asked NEITHER, writing gain automation onto a
suspended context whose clock is not advancing. Nothing was audibly wrong (the
master sits at zero) but three voices were living on someone else's guard and
the next voice copied from one of them would have inherited that. `live()` is
the one predicate now. Verified by `mix-audit.mjs`: engine 0.336, grit 0.38,
roar 0.19, no page errors, same numbers as before the move.

### What the soundscape is missing, now that it can be read at once

Not fixed — recorded, because the list is the useful thing and each item is its
own piece of work. In rough order of what a driver would notice:

- **NOTHING IS SPATIALISED** and **NO SENSE OF ENCLOSURE** — the first two are
  DONE, and the next section is what they cost. What is left of the first is
  the contacts: the rustle, the scrape, the brush and the crash are still mono,
  and a graze is on one side of the truck.
- **THE MIX DOES NOT KNOW WHICH CAMERA IS IN USE.** Cab and chase sound the
  same. In the cab there should be less wind and more engine; that is one
  argument to `update`.
- **A SURFACE CHANGE HAS NO EDGE.** Tarmac to gravel glides across on
  `setTargetAtTime`; there is no kerb tick, no rumble strip, no cattle grid.
  `surfKind` changes on a known frame.
- **RAIN HAS NO IMPACTS.** `rainAmt` only opens the wind channel. Rain in a
  vehicle is patter on the roof, which is the one thing this does not do.
- **THE BIRDS DO NOT KNOW WHERE THEY ARE.** One phrase generator, 2.3–4 kHz,
  everywhere on Earth — while the guild layer three modules away can say
  whether this is fynbos, taiga or mangrove. The same "the world knows and the
  layer is not told" shape the flora review found, one layer over.
- **NO ENGINE LOAD.** Pitch follows `rev` and `gear`; coasting and pulling
  sound the same, which is most of what an engine actually says.
- **`drive.mute` LIVES OUTSIDE THE DIAL RACK**, in its own localStorage key, so
  it is not covered by the rack's versioning or its migrations the way TIME,
  PALETTE and WATER are.

### The water has a side, and a ceiling changes the mix

The first two items off the gap list above, taken together because they are one
change to the graph: everything was mono into `master`, so nothing could be
LOCATED and nothing could be ENCLOSED.

- **TWO BUSES, BECAUSE ENCLOSURE IS NOT A VOLUME KNOB.** Under a bridge the
  world outside goes away and your own noise comes back at you, and one master
  gain cannot say that — muffling everything takes the engine with it, and the
  engine is the thing a tunnel makes louder. The world's voices (wind, leaves,
  river, birds, thunder) share `outBus`; the truck's (engine, tyres, grit,
  rubber, bodywork, every impact) share `nearBus`. `space(enc)` closes a
  lowpass from 20 kHz to 900 Hz over the first and opens a 55 ms slap with
  feedback on the second. **At zero enclosure the path is the old one exactly**
  — filter at 20 kHz, bus at unity, send at silence — so an open road is
  unchanged and the mechanism costs three nodes nobody hears.
- **THE RING THAT MEASURED HOW MUCH WATER ALREADY KNEW WHERE IT WAS.** The
  ambience sampler walks six probes at 24 m twice a second; summing the wet
  ones' own directions gives a bearing for free. It is a SUM, not a nearest, so
  water on both sides of a ford cancels to the middle, which is where it
  actually is. Panned to ±0.75 with a 0.7 s glide.
- **THE ROOM IS GLIDED IN TWO PLACES** — `encL` eases toward the sampled
  verdict at about 0.4 s, and `space()`'s own `setTargetAtTime` at 0.45 s. A
  portal is a hard edge in geometry and a soft one in air: you hear a tunnel a
  moment before you are inside it, and snapping the filter at the mouth reads
  as a bug rather than as an entrance.

**FOUR RUNS, AND EVERY ONE FAILED FOR A DIFFERENT REASON.** The mixer half
passed first time; the detector took all four, and three of them are lessons.

- **A BLANKET REWRITE PASSED `tsc` AND THREW ON THE FIRST FRAME.** Sending
  fourteen voices to two buses was done with one `connect(master)` →
  `connect(nearBus)` rewrite, which also rewrote the bus plumbing it had just
  introduced: `outLP.connect(nearBus)` (unassigned at that line),
  `nearBus.connect(nearBus)`, `slapDelay.connect(nearBus)`. **tsc was happy
  because every one of those is an `AudioNode`.** Only running it caught it —
  `Overload resolution failed` inside `build()`.
- **`at-paris-west` IS NOT VÉLIZY.** The first run over the live planet read no
  ceilings because Overpass served nothing; the second went to a capture
  believed to be the interchange. It is SURESNES — a flat suburb of pavements
  with nothing to drive under — and read zero for the honest reason.
  `at-paris-south` is the A 86 interchange. Read the card, not the name.
- **`roadCells` IS ON `__tstats`, NOT `__field`.** The gate read
  `__field?.().roadCells ?? __built?.().roadCells ?? 0`, got 0 from both, and
  looked exactly like an empty world.
- **AND THE ONE THAT MATTERED: THE HINT STORE IS THE PLANNER'S PROFILE, AND IT
  IS NOT LIFTED.** Reading the deck above a point from `solver.hints` looked
  right — a tile is planned whole before any ribbon builds, which is why
  `hintAbove` reads there — and it cannot work, because the flyover's rise over
  the road beneath is the per-way build's chord-and-lift stage and that never
  writes back. This file already said so about the layer tag; it applies to the
  whole store. **Measured at the layer-2 lift at (-133,-62): `__lifts` reports
  6.39 m raised, and the highest hint within 8 m over a 60 m box stands at
  2.765 on ground of 2.352 — four tenths of a metre where six were built.**
  The deck is read from `roadGrid`'s `ya`/`yb` now, which is after the lift,
  and the half-width test comes free with it: a roof is only over you if you
  are under the carriageway. **After: 46 of 2,601 swept points enclosed, all of
  them decks, clearances 4.1-5.6 m, clustered on that same layer-2 crossing —
  and 98.2% of the interchange still open sky, which is the assertion that
  would catch a rule that simply says yes.**

**WHAT THE DETECTOR READS.** Three sources, and they are not the same amount of
room: a tunnel interior (`tn`, the solver's own flag, set on the inside of every
tagged tube as well as on untagged burial) is 1; a tunnel mouth (`pc`, the
portal porch) is 0.65, because a portal that snapped to full bore would read as
a wall rather than as an entrance; a deck overhead caps at 0.7 and fades out as
it climbs away — full to five metres of clearance, nothing by nine. Two rules
guard it, and each was a wrong answer first:

- **THE BASE IS THE LISTENER'S HEIGHT, NOT THE GROUND'S.** At the truck it is
  `bodyY`. `roadHeightAt` looked like the better answer for a swept point and
  is not: it takes the road NEAREST IN PLAN, and a flyover is directly over the
  road beneath it, so at a crossing the base comes back as the flyover's own
  deck and the sweep asks what is above the bridge. A swept point uses
  `groundAt` — the mechanism question a sweep is for.
- **A DECK IS ONLY A ROOF IF THE GROUND UNDER IT HAS FALLEN AWAY**, and it has
  to clear head height. Without the first a steep road is its own ceiling — a
  station on a 25% grade stands 1.7 m over your head within seven metres, and
  Vélizy is flat and would never have shown it. Without the second the lowest
  deck above you is the carriageway under your own wheels, four centimetres up.

**THE BORE BRANCH SHIPS UNMEASURED, AND THE AUDIT SAYS SO OUT LOUD.**
`__buried(400)` at Vélizy reports `exempt: null` — not one segment marked `tn`
or `pc`, worst cover 1.72 m — because its 23 tagged tunnels are car-park ramps
and footway subways whose chords are capped at the terrain on flat ground, so
nothing ever ends up the 5.6 m under a hill that sets the flag. No capture in
the index has a drivable bore. Reported rather than asserted, and rather than
dressed up with a synthetic segment: a test that plants its own witness proves
nothing.

**AND A GALLERY IS STILL SILENT.** `canopyRun` roofs a road, leaves no flag on
its segments, and its roof is not in `roadGrid`, so nothing can see it.
Chapman's Peak galleries are the most audible enclosure this game has. One flag
in the ribbon — and no fixture to measure it on, which is why it is written
down here instead of shipped.

### The river was playing at Vélizy, four hundred kilometres from the sea

Found by the pan, which is the argument for building it. The first Camps Bay run
of the audit read the sea as present on BOTH beams; the first Vélizy run read
`__mix().river` at 0.16, which is the channel's full level, on a dry
interchange.

**`waterInfoAt` RETURNS `depth: 0.5` WHEN THERE IS NO WATER.** Every other
caller has already established there is — the physics asks after `surfaceAt`
says `water`, the wheel sink asks inside the water branch — so the last line is
a sensible default rather than a claim. The ambience ring was the first caller
to use the function as the DETECTOR, testing `depth > 0.06` at six points, and
every dry probe came back 0.5. So the river bed has been at full level
everywhere on earth with no hydro body, no carved channel and no ocean, since
the ring was written. `wet` is the honest answer now; `depth` keeps its default
so no existing caller changes behaviour.

**A CENTRALISED SUBSYSTEM IS WHAT MAKES THIS KIND OF THING VISIBLE.** The bug
is old and was invisible while the mixer was 624 lines in the middle of
main.ts: nothing could ask "what is the river channel doing right now" without
a probe nobody had written. `__mix()` and one measurement at a place with no
water is the whole diagnosis.

**AND FIXING IT EXPOSED WHAT IT HAD BEEN HIDING: THE RING REACHED 24 METRES.**
With the bed on everywhere, nobody could tell it could not hear anything
further than a cricket pitch. Measured at the Yosemite valley floor with the
default gone — the spot `amb-audit.mjs` has always used, chosen for "the Merced
nearby" — the Merced is **67 m away, the 24 m, 40 m and 60 m rings are all dry,
and its nearest wet probe is on the 90 m ring**. A river you can see from the
road, silent. So water is audible a long way and quieter further off, which
makes distance a WEIGHT rather than a radius: three rings at 24/60/120 m
weighted 1 / 0.55 / 0.28, eighteen probes twice a second instead of six. The
bearing is the same weighted sum, which makes it better too. **Froth stays on
the inner ring alone** — rapids two hundred metres off are a wash, not a
rattle.

**Measured after, same spot: `riverRaw` 0.09 at a bearing of −0.83** — the
Merced faint, off the port side, where it was silent an hour before and a
full-level 1.0 before that. **The 1.0 was the bug and the 0.09 is a
judgement**: 0.28 is what a river a hundred metres off is worth, and there is
no external anchor for that number the way there is for a tree's height or a
site's rainfall, so it is written down here rather than defended. Two things
to know before moving it. The level is dominated by the INNER ring by
construction, so raising the far weight makes distant water louder and changes
nothing about a river you are beside. And six probes on a 120 m circle is 754 m
of circumference sampled at 126 m intervals — at Yosemite the 90 m ring caught
three of twenty-four bearings and the shipped six caught one — so the far rings
UNDER-sample a linear feature, and constant arc spacing (6 / 10 / 14 probes)
would steady the estimate without making it louder.

`__space(x?, z?)` reports the verdict at the truck or at any point — the deck,
the clearance, the two flags and the glided `enc` — and `__audioSpace(e)` forces
the room for twelve seconds the way `__windset` forces a gale, because a tunnel
is somewhere you have to drive to and a mix cannot be photographed.
`devtools/space-audit.mjs` holds both halves, on two captures: Vélizy for the
ceiling and Camps Bay for the side the sea is on.

**THE PAN IS ASSERTED AS THE SAME WATER FROM TWO HEADINGS**, which is what makes
it an assertion rather than a coincidence: park sixteen metres off a wet point,
face so the sea is off the port beam and read the pan; turn a hundred and eighty
degrees so the SAME water is off the starboard beam and read it again. Nothing
about where the Atlantic actually is has to be assumed, and a pan wired to a
constant, to the world axes, or to the wrong sign fails one of the two.
Measured: bearing −0.75 panned to −0.56, then +0.75 panned to +0.54, at a river
level of 0.186 both ways. **Sixteen metres and not twenty-four**: the ring's six
probes sit at fixed sixty-degree bearings on a 24 m circle, so a stand exactly
on that circle catches one of them and a stand well inside it catches three.

### The bed was forty decibels down, and the probe was reading gains

Found from the seat: *"parked, engine off, next to a river, and I heard little
to nothing."* Three measurements, none of them an ear, all in
`devtools/voice-levels.mjs` and `devtools/soundscape-audit.mjs`:

- **An offline render of every chain at unit gain.** The river on its bank
  rendered at **−41.5 dBFS**, wind on a 12 km/h day −44, the rustle −48, a bird
  −35 at the peak of a phrase; the engine idling −29 for scale, the landing
  thud −34, the creak **−49**, the tarmac roar at 100 km/h −40 and the gravel
  bed at 40 km/h −42. Anything under about −40 dBFS is gone on a phone speaker.
  With the engine off the only thing left was an occasional faint bird, which
  is exactly "little to nothing".
- **The mixer's own gains at three named river spots, engine off.** The Senqu
  ford and the "French river bank" both read `river 0`: the hydro field's
  nearest water was outside the 120 m ring — 220 m off at the French bank,
  none within 300 m at the Senqu. The Merced at 67 m read `river 0.015`, which
  is −62 dBFS. Whether a spot fails on reach or on level, it fails.
- **`__mix()` reports gains, and per voice a gain is worth up to 22 dB more or
  less than another.** A gain is what a node multiplies by; white noise
  through a 340 Hz bandpass keeps one percent of its energy where a 900 Hz
  highpass keeps ninety-six. So "grit 0.38, engine 0.34" — the mix-audit's
  reading of a gravel bed dominating the engine, recorded above as "the
  loudest thing the truck does" — was a grit at −44 dBFS under an engine at
  −31. The whole bed and half the truck were tuned by numbers that meant a
  different thing on every channel, and two rounds of "raise it" changed
  nothing from the seat because a raise of 0.1 on a chain that keeps one
  percent is a raise of nothing.

**WHAT A GAIN OF 1 IS WORTH is now a table.** `UNIT` in `audio.ts` is the RMS
each chain renders at unit gain, measured by `voice-levels.mjs` (an offline
render of the module's own pattern generators through the same filters), and
`lvl(unit, dBFS)` turns a target into a gain. The devtool prints the drift
between what it measures and what is recorded, so a moved filter shows up
there before it shows up from the seat. Every world voice is written as a
level now: the river **−26 dBFS** on the bank of still water (rapids five over
that plus a boil at −24), wind **−34 on a 12 km/h day and −26 at forty**, the
rustle −36 → −27 the same way, the new sward −40 → −34, birds −27 at the peak.
The truck's two surface voices are restated too — roar −31 at 100 km/h on
tarmac, grit −29 at speed on open ground — because they were the ones proved
inaudible. **The engine, squeal, scrape and brush keep their linear gains**:
measured, the engine idles at −29 (−38 through a 400 Hz highpass standing in
for a phone — its energy is at 50–150 Hz) and the squeal at full is near −35,
and those are the next list, not this one.

**A LIMITER IS WHAT LETS THE BED UP.** The master sat at 0.55 to leave headroom
for a crash and the world paid for that headroom permanently. A
`DynamicsCompressor` at −4 dB threshold, ratio 16, catches the peaks instead;
it adds about +3.5 dB of make-up uniformly, and `__levels()` reads on both
sides of it (`master` where the targets are written, `out` what the speaker
gets) so the targets are checked where they are stated.

**`__levels()` IS THE INSTRUMENT `__mix()` WAS BEING USED AS** — dBFS RMS over
the last 43 ms at an analyser on each bus and each voice worth asking about,
computed only when called. `soundscape-audit.mjs` reads it through rest,
rough ground and the drone. Numbers or it did not happen, and gains are not
numbers.

**And the soundscape got what the review said it lacked:**

- **The ring reaches 220 m, the far rings are dense, and the NEAREST wet
  probe sets the level.** Six probes on a 220 m ring are 230 m apart and a
  river twenty metres wide goes between all of them; the first cut measured
  the Merced at `riverRaw 0.09` from one hit on the 120 m ring. Twelve probes
  on the outer rings (38 in all, twice a second, cheaper than one tree), and
  the level is the nearest ring's weight (24 m 1, 60 m 0.8, 120 m 0.6,
  220 m 0.35) plus a little for every further hit, so a lake on the beam is
  still wider than a brook but a brook is no longer a lottery.
- **Grass.** A meadow with no tree in it was as silent as a car park: `sward`
  is a thin high band answering to five WorldCover texels under and around the
  truck, in the wind, with the same duck as the rustle.
- **Gusts.** Wind was a fan; it is an envelope now (two incommensurate sines of
  the clock), and the leaves and the grass answer it half a second late.
- **The river laps and the rapids boil.** Still water's level breathes at the
  rate water moves against a bank; froth opens the gravel pattern slowed to a
  third and held low, so fast water churns rather than hisses.
- **The window comes down.** The cab's shell (Astra's cab mix) took 4.7 dB off
  the world and shut it above 4.8 kHz with the key out — the one moment a
  driver stops to listen. `space(enc, cab, parked)` opens it when stopped with
  the engine off.
- **The chassis rattles.** Over washboard the only chassis sounds were two
  one-shots at the bump stops, because the body rides the smooth plane by
  design and nothing else said the ground was rough. `chassisShake` is the
  washboard's RATE at the four wheels — exactly what the dampers are being
  asked to do: tarmac 0.3 m/s, a graded track 1.5, open ground at speed 4,
  with a knee at 0.3 so tarmac stays silent and worn dampers rattling more —
  and it drives a bed of pins, trim and tools (`rattlePattern`) that gets
  denser as well as louder. −28 dBFS flat out, beside the grit.
- **A landing is the same box being hit.** The thud's gain clamped at 0.5 from a
  fifth of the way up its range (every landing the same loudness) and rang
  none of the chassis modes a wall hit rings. `ringModes` is shared now: the
  crash's two low modes carry the body of a landing too, scaled continuously
  with the force the suspension reported.
- **The creak can be heard.** −49 dBFS was a sawtooth sweeping OUT of a narrow
  bandpass at a tenth of the gain for 160 ms. A lowpass keeps the fundamental
  as it falls; three times the gain, twice the length.
- **The drone has a voice.** It never had one — every revision was searched.
  Four blade-pass tones a hair apart (the beat is what a quad sounds like),
  a triangle an octave up for the body, a bandpass to keep it a machine, and
  a thin highpassed whoosh for the downwash. Pitch and level ride the spool
  and the load (a climb, a dash, a lean); from the truck it falls with the
  square of distance and sits on the side it is on; on board it is −21 dBFS.

**MEASURED AFTER, `soundscape-audit.mjs`, Yosemite valley floor, no page
errors.** Parked with the engine off: the Merced at 67 m reads `riverRaw 0.67`
off the port side and the river tap **−25.6 dBFS** (it was −62); wind −28,
rustle −40 (this cell has little foliage), sward −44 (cover a quarter grass);
the world bus −25, the speaker −28. Flat out on the valley floor at 85 km/h:
`shakeRaw` 1.1 m/s, shake 0.55 with healthy dampers, **rattle −27.6, grit
−25.9**, wind −21, the engine −13.4, the truck bus peaking at −12.7 — the
engine is still seven to fourteen decibels over everything else under it,
which is the ear-tuned bus's balance and the next thing to restate. The drone:
in the harness the launch ceremony barely advanced in ten wall-clock seconds
(spool 0 with the truck held stopped — the sim clock stops with it), so the
on-board tap read −36 at the start of the spool-up; the full-spool levels
(−21 on board, −27 ten metres off, −46 at forty) are the offline render's and
the seat's report is the verification.

**A CORRECTION TO THE NUMBERS ABOVE, from the lab's first run:** the voice and
bus taps sat before the master gain and `out` after the limiter, so the
per-voice readings in that paragraph are 5.2 dB hotter than what reaches the
speaker (the Merced's −25.6 is −30.8 at the ear; `master` and `out` were
right). `levels()` applies the master to everything upstream of it now, so a
voice's number is the number its target names; the lab's own run then read
the still bank's river at −28, rapids' boil, open ground's grit and rattle,
and the drone on board all within a decibel and a half of their targets.

**THE GRIT WAS A BUBBLING BROOK.** First report from the seat after the deploy:
*"not sure if it's the grit or rattle but it sounds like a bubbling brook."* It
was the grit, and the diagnosis is in the pattern: every gravel grain had been
given "a little pitch" — a sine ring with an exponential decay — and through
the 900–2300 Hz bandpass it wore, a short pitched chirp that dies is the
recipe for a water bubble. Nobody heard it in the year it sat at −42 dBFS;
at −29 it was a brook on the first drive. Gravel is broadband and crackly and
has no pitch, so `gritPattern` is crackles (one to eight milliseconds of
noise, most small, a few large) over a few low crunches a second (a one-pole
lowpass with mass), through a wide band at 2–4 kHz. **The pitched pattern is
the rapids' now** — `bubblePattern` under the boil, where "a great many short
chirps, dying" was right all along. The rattle had the other half of the same
fault (seven hundred random sine tinkles — wind chimes) and is a BUZZ now:
bursts of clicks at thirty to ninety a second with two inharmonic metal
partials, swelling and dying, over low knocks — because what separates a
rattle from a tinkle is the repetition. Both re-measured into `UNIT`; the
targets did not move. Verified by arithmetic and the pattern's construction,
not by an ear: the seat's next report is the verification.

### The sound lab: the mixer with no world

`/lab/sound` (`client/sound-lab.ts`). Asked for from the seat after the brook —
*"do we need a soundscape lab so we can isolate and tune, with buttons to
trigger the range of possible sounds and combinations thereof"* — and the
answer was already in the mixer's shape: it owns no world state and takes
every input as an argument, so the lab is `createAudio()` with dials where the
world was, and the loop feeds it the SAME derived numbers main.ts does (the
bed's duck by motion and engine, the rustle as wind × foliage × duck, the
parked window), so a level read there is the level the game would make.

- **Every continuous input on a dial**: the world's (wind, foliage, grass,
  river, froth, side, birds, rain), the truck's (engine, throttle, speed,
  surface, quality, slip, spin, grounded, shake, scrape, brush, wash), the
  room's (tunnel, cab) and the drone's (spool, load, distance, side, on board).
- **Every one-shot on a button** at the forces the world fires them at, a
  **level meter per tap** with a peak that holds for a second and a half so a
  thud can be read after it has gone, **scenes** for what the targets were
  written for, the gravel and the rattle as an **A/B** against what they used
  to be, a **mute per voice** with a solo mode.
- **THE TARGETS ARE SLIDERS, AND COPY WRITES THE ENGINE LITERAL.** `TARGETS`
  in audio.ts is exported and mutable; the lab moves it live and COPY puts
  `export const TARGETS = {…}` on the clipboard with the scene and the levels
  as a comment. A number found by ear on the phone becomes the engine's by
  paste, which is the whole bargain the dials were built for.
- **Phone-first.** The shared dial panel is a fixed column that covered the
  meters and the buttons on a 390 px screen; below 640 px the main panel
  comes first in the flow and the dials follow as a block.
- `devtools/sound-lab.test.mjs` drives it without a finger: canvas painted,
  the mixer arms, a still bank puts the river on the meter near its target,
  open ground the grit and the rattle, the drone on board near its target, a
  thud leaves a peak, a mute takes a voice away, the A/B swaps. All green,
  no page errors. `mute()`, `bird()`, `pattern()` and `mutes()` exist for
  the lab and nothing in the game calls them.

**JUDGEMENT, NOT ANCHORS.** The targets are numbers written down so they can be
moved, like the river's 0.28 before them. What is known: −40 dBFS is inaudible
on a phone; a bed at −26 to −36 leaves the engine (−23 at 40 km/h) on top; the
crash's strike still peaks near −10 and the limiter holds it. Whether −26 is
the right river is the seat's call, and there is now an instrument for the seat
to say so with. Still on the review's list: a surface change has no edge, the
birds do not know where they are, and there is no engine load.

### The hydro polish rebase — another agent, on the cell, after the lab

Pulled 8 September, after the sound lab shipped: `HYDRO-REBASE-2026-09-08.md`
and `client/hydro-rebase-check.mjs` are its own note and check, and the
note says it kept this branch's mixer whole ("superseded local terrain/drone
voices were intentionally not applied"), which is the first time a pull of
another agent's cell has come back already rebased on ours. It had deployed
itself before the pull — the live bundle carried its strings.

- **Water.** Swells arrive in SETS (a slow envelope on amplitude only, phase
  continuous); the high-energy standing amplitude rises **0.72 → 1.05 m** and
  the river's 0.16 → 0.21 before the existing shoaling gates; the lighting
  follows the displaced mesh's slope through `dFdx/dFdy` (WebGL1 without
  derivatives keeps the analytic normal); rain PERTURBS THE NORMAL within
  90 m as one staggered ring per 3 m cell instead of painting white pocks;
  a spent wash lingers behind a breaker on the shore phase. No geometry or
  draw-count change; the per-fragment cost is unmeasured on a phone and the
  bigger sea is a judgement the seat has not yet seen.
- **Air.** Fog gets broad terrain-space pockets and the mist takes the haze's
  solar tint; a descending-edge `smoothstep(uFogTop, uFogTop − 55, y)` —
  undefined in GLSL — is rewritten as the ascending expression it meant.
- **Sound.** `update()` takes `surfaceWet` beside `rainAmt`, so the wet-road
  roar follows the weather field's stored wetness (a shower stops before the
  road dries) while rain still drives the drops and the roof; the rattle is
  gated to zero below 0.5 m/s in the mixer as well as in main.ts, and
  main.ts hands it 0 while wading. No new nodes.

Verified here: `tsc` clean, its check green, `boot.mjs` no page errors,
`hazeAt`/`uHazeWarm`, `wxL.wet`, `vRenderPosition`, `hash21` and `camDist`
all in scope where used, `extensions.derivatives` still a field on this
three's ShaderMaterial. Not verified: how it looks, or what it costs.

### A half-written snapshot is carried forward, not over

The shoreline pass arrived on the cell as a snapshot of an editor: an 87-line
`client/shoreline.ts` (reed and mineral bank habitat from cover, moisture,
temperature, slope and a hydro bank sample; stationary metre-space GLSL
patches shared by hydro and the sward; a bounded bank-field sampler), one
import in main.ts, and the sward's ground revision reading a `bankRevision`
that the hydro system did not have yet. Its author ran out of credits there.
Meanwhile the river work (`b5db0c7`: a cobble bed under clear shallows,
shallow rapids, bend eddies, a rig trail on the water, a 4-connected mask for
narrow diagonal streams, lab scenes with rocks) landed on the branch from the
other session and had to ship.

**The rule:** a deploy must not write over what another agent has on the
cell, and it must not wait on it either. So the snapshot rides along — its
file, its import, its revision line — and the one thing it lacked is declared
as a PLACEHOLDER: `HydroSystem.bankRevision`, zero, commented as that agent's
to make count. The tree type-checks, the bundle runs (an unused import is
tree-shaken; the counter reads zero), and when the agent resumes it finds the
cell exactly as it left it plus the branch's work plus one field it meant to
write. Verified: `tsc` clean, hydro self-tests and the inland-water test
green, `boot.mjs` no page errors, its own check script green.

### The shoreline wired in, and what the crossing at the Joggemspruit actually is

Reported from the seat at −30.72068, 27.75659 heading 66: *the shallows are a
colour that does not match the bank, the water still meets the ground on a
hard edge, and driving the road across the river raises no splash.* Captured
as `at-senqu-ford` (`devtools/capture-world.mjs`): six highways and the
Joggemspruit in 1.4 km of Drakensberg grassland at 1,800 m. The other agent's
half-written `shoreline.ts` is finished here.

- **The water takes the ground's colour AT THE FRAGMENT.** `uTerrainColour`
  was `groundTint(state.x, state.z)` — the ground under the truck, one colour
  for every shallow, bed and damp bank in view — so a river forty metres off
  wore the road's tint. `HydroFrame.terrainField` carries the sward's colour
  field (the terrain palette per 3 m texel over 768 m, already built for the
  grass) and the fragment shader samples it as `terrainC` wherever the field
  reaches, the frame colour standing in beyond. Every use in the bed, the
  damp band, the gravel bank and the palette's ground affinity moved to it.
- **The waterline is ragged, not rastered.** Coverage ramps over about one
  18.75 m texel and a single cut through it is a straight line. The cut now
  moves by a few metres either way on the shared bank patches (`BANK_GLSL`,
  the same stationary metre-space noise on both sides), so the edge is the
  same broken line for the water and the bank.
- **The bank is on the ground side too.** `swardRows` asks `bankHabitat` for
  every texel at the water: mineral pulls the sward's colour to the gravel
  family the water draws and thins the grass (0.85), reeds thicken it in a
  sheltered shallow margin (0.7 tufts/m²), and nothing grows under the
  resting level. `HydroSystem.fieldAt` and the agent's bounded
  `sampleBankField` find the nearest wet texel; `bankRevision` counts field
  installs so the sward re-sweeps when the water builds. The sweep costs 26 ms
  more per pass at this river (73 vs 47), spread over frames by the step
  budget. `?shore=0` is the A/B.
- **A road under water is a ford.** `surfaceAt` returned road wherever a
  carriageway was, and the doctrine said why ("a road over a channel is a
  culvert's deck or a bridge"). It now compares the hydro resting level with
  the road deck: over it a bridge, under it by 0.12 m wading — splash, wash,
  spray, wake — and `waterInfoAt` measures depth against the deck rather than
  the bed the road was laid over. `__ford(x, z)` prints every term.

**AND THE CROSSING IS NOT A FORD.** Measured on the fixture: the road deck at
1,790.0 m, the river's resting level 1,788.6 m — the water is 1.4 m UNDER the
carriageway. The DEM (8 m) does not resolve the channel, the road profile
rides the DEM, the hydro profile solver found the bed lower, and the crossing
is a culvert by construction (see the culverts section). No splash is what
the geometry says; the fault the seat named is that the geometry should not
say it here. OSM carries no `bridge` on that way and would carry `ford=yes`
on a real drift; the tile keeps neither, and the mirror could not be asked
(overpass through the proxy times out). The next unit is a drift: at a road ×
river crossing with no bridge tag, dip the deck to the invert over the wet
span with ramps, and build no culvert — a corridor-solver change, not a
physics one. **Verified:** `tsc` clean, hydro and inland-water tests green,
the agent's check green, `boot.mjs` no page errors, the probe's terms at the
crossing, the wade firing off-road at the river (surface `water`, wash 0.2).
**Not verified by eye:** the colour and the edge — the fixture's water at the
crossing is under the road and the frames the harness could take do not show
a bank close up. The seat's report against `?shore=0` is the verification.

### From above, the Senqu was a pale sheet — and most of it was not water

Asked for from the seat at −30.70685, 27.75090 in the chart at 0.8 zoom.
Captured as `at-senqu-top` (class 80 in the box — the broad Senqu). Rendered
in the harness (the top camera needs a 240 s screenshot timeout; a held truck
stops the tick and the canvas with it, so shoot while rolling): the river was
a cream sheet with raster-blob edges, lighter than the grassland around it,
and `?shore=0` made no difference. Three findings, in the order they fell:

- **The field called a hundred-metre river 8–40 cm deep and fast**, because
  flowing depth is level minus ground and the DEM does not resolve a channel;
  the shader honestly drew that as shallow rapid and visible bed from bank to
  bank. `build-tile` now floors a flowing texel's depth by its distance from
  its own shore (8 cm a metre, to 4 m), and the fragment shader calms reach
  energy toward the middle of deep water (a wide river carries the same drop
  with far less turbulence than a brook) so the riffles stay at the margins.
  Measured: `fieldDepth` 0.08–0.39 → 1.31–1.86 at the probe texels; the
  river's pixels went from (154,154,137) to (137,137,120) against ground at
  (109,109,91) — greener and darker, still lighter than the ground.
- **The wet mask here is a winding line one or two texels wide**, not a body:
  `__hydromap` shows it, and every wet texel is 16 m from a dry one, which is
  why the floor gives every one 1.3 m. The hydro is drawing the OSM waterway
  LINE as a ribbon; the class-80 body around it was never built —
  `landcover: feats 0, pixels 0` on a tile whose cover carries class 80 — and
  the cream sheet the seat sees from above is the TERRAIN's own paint for
  class-80 cover, at the cover raster's 22 m, with the narrow ribbon inside
  it. That is why the shoreline pass could not touch it: there is no
  shoreline there, only paint. A 3×3 majority pass now closes pinholes in
  flowing coverage, and the sward's colour field paints class-80 texels as
  the nearest bank class (`bankPaint`) so the water's local colour is the
  bank's rather than the riverbed paint's; neither builds the body.
- **The next unit is the body:** trace the class-80 component beside a
  waterway line into a hydro river area (the tracer dropped it here —
  `COVER_WATER_MIN_PX` 4 is not the filter, so it is `inlandComponents` or
  the OSM-covered test, to be measured), union it with the ribbon, and the
  depth floor then reaches metres in the middle. Until then, from above, a
  wide river is a narrow river in a pale bed.

Verified: `tsc` clean, hydro and inland-water tests green, the agent's check
green, `boot.mjs` no page or GLSL errors, the field's depth at six probe
texels, the pixel readings above. Not verified by eye at the bank.

**THE SEAT'S FRAME SETTLED IT.** A screenshot from the phone at the same spot
(09:00, haze, 60 fps) showed the band at 35–40 m — the truck for scale — and
its edge stepped at the hydro field's own 18.75 m texel. The relay reached
the live upstreams on a second try (four minutes; `__coverwater` reads the
same two class-80 pixels the capture has, `WATER 0%` within 700 m), so the
band IS the hydro river, the OSM line as a ribbon, drawn cream — not cover
paint, and the fixture was faithful after all; the "cover body" the previous
paragraph reaches for does not exist here. Then the pixels, sampled from the
harness frame against ground at (109,109,91):

| river pixel | before | depth floor + calm | bed through water | + attenuation, overhead |
|---|---|---|---|---|
| mid-band | (154,154,137) | (137,137,120) | (120,137,120) | (103,120,103) |
| bend | (164,182,146) | (146,164,128) | (146,164,146) | (128,146,109) |

Three more terms, each honest physics the shader had skipped: **the bed is
seen through the water** (its colour now crosses the column twice, red eaten
first — a 1.3 m riverbed goes dark olive instead of dry sand); **fresh water
attenuates at 0.85 a metre, not 0.5** (silt shortens it further); and
**looking down, you look deeper** — the palette's depth scales with the
view's overhead component, so the chart sees the deep colour and the seat at
the bank keeps the shallow one. From above the river is now a sage band at
the ground's own luminance, greener and bluer than it; from the bank it is
the pale sky-reflecting sheet it was. Judgement, not anchors: the seat's
next frame is the verification.

### "On water" near the water — every input to the decision, painted on the ground

The seat reported the readout saying WATER on grass "near" the river, and
asked whether the physics' inputs align with what the hydro draws. They did
not, and nothing showed them side by side. Five things can say water under
the wheels — a carriageway's absence, a carved channel, the ocean mask, the
hydro field's resting surface, the cover raster's class 80 — and the hydro
draws by a sixth (coverage past the shader's ragged cut, AND the resting
level above the ground). Two tools now, sharing one classifier
(`wetClassAt`) so they cannot disagree:

- **`?wetdebug=1`** (or `__wetdebug(true)`) paints the classes over the
  768 m around the truck, 128 texels a side, repainted every two seconds
  while on (57 ms a repaint; the terrain shader mixes it in after the clouds
  and costs one uniform read when off). Legend: **blue** W drawn water and
  the truck would be in it · **orange** D deck over water · **magenta** U the
  field is wet but its surface is UNDER the ground · **yellow** E the
  waterline band, where the shader's cut and the physics' 0.5 may part ·
  **cyan** C carved channel with no hydro water, F a ford · **navy** O ocean
  mask · **grey** c cover class 80 with nothing built · **red** X the physics
  says water and nothing above explains it.
- **`__wetmap(halfM, n)`** is the same as ASCII for the harness, truck at `@`.

What it showed at both Senqu fixtures: the drawn river is a W band one or
two texels wide inside a **magenta skirt** of U — texels the field calls wet
(kind river, coverage 0.53–0.93) whose resting level sits 0.08 to 3.36 m
BELOW the DEM. The field's sampler gates on coverage ≥ 0.5 and never asked
whether the water clears the ground, so `hydroWet` said yes there, the
readout said WATER, the wade played, and the truck drove on grass; the mesh
drawn there is hidden by the ground, which is why the eye saw nothing. That
skirt is exactly the seat's "on water near water". `hydroWet` now requires
the resting level above the ground by 2 cm (the drawn water is the water),
and the site panel's WATER row says `RIVER · 2.7M UNDER GROUND` rather than
a depth when it is. Also seen: some U texels report a `water` surface — that
is the carved channel's ribbon under a wet-but-buried field texel; the
classifier gives U precedence over C, so a channel under a skirt reads
magenta, not cyan.

Verified: `tsc` clean, `switches.test` green (both `wetdebug` and `shore`
now read through `qsOn`, the typed reader — the shore flag had been passing
that test by a coincidental literal elsewhere), `boot.mjs` no page or GLSL
errors, the ASCII maps at `at-senqu-top` and `at-senqu-ford`, an overlay
frame from the top camera with the magenta blocks around the truck, the
repaint leaving `surfQ` as it found it. Not verified from the seat.

### The chart's river wore a beach — the water was never lit by the scene

The seat's frame at −30.70911, 27.75188 in the chart at 2.2 zoom, a hazy
09:00: the river a band at twice the valley's luminance with a cream rim,
and no bed in it. "The shallows and banks should be helping the river mesh
merge with the surroundings; it's doing the opposite." Measured off the
frame (sRGB luminance): ground 50–55, band 107–112, rim 129–150.

**Ablation first.** `__hydrotune({ shallowBedStrength: 0 })` and friends zero
one look term at a time (a probe added for this; the tuning setter had no
window). Bed off, river edge off, foam and turbulence off, all off,
`?shore=0` — the rim stayed at L 147–171 in every variant. It was not a
term; it was the palette, and two things under it:

- **The water lit itself.** Its light was a curve of its own — 0.82 of
  ambient for any sun above thirty degrees, a quarter of a direct term,
  nothing for cloud — while the ground beside it is a Lambert surface under
  the scene's sun, sky fill and cloud deck. Under haze at a low sun the
  ground fell to 0.64 of its noon and the river to 1.0. `HydroFrame.sceneLight`
  is now the ground's irradiance on the flat (sun × cosine + sky fill + moon,
  per channel) as a ratio to THIS biome's clear noon: 1.005 at noon, 0.81 /
  0.86 / 0.94 under haze, 0.64 / 0.72 / 0.84 at a 32° sun under haze,
  0.25 / 0.33 / 0.48 at night. The cloud deck's shadow reaches the water
  through `SceneShade`: main.ts hands the hydro material the terrain's own
  cloud GLSL and uniforms (prefixed `uCs*`, because hydro's `uWind` is a
  vec3 and the deck's drift a vec2), spliced ahead of `main()`.
- **The ground's colour arrived as albedo.** `terrainC` is the terrain
  palette — the vertex colour the Lambert ground multiplies by its light
  over π — and every constant in the water shader is a LIT colour at a clear
  noon. Mixed as they came, a bank seen through a shallow, a gravel bar, the
  damp margin, stood at three times the brightness of the bank beside them.
  `uGroundGain` (E_ref / π ≈ 0.49, 0.46, 0.43) puts the ground's colour on
  the constants' scale the moment it is sampled; the scene light then scales
  both alike. This one line is most of the fix: the palette re-anchoring
  below did nothing measurable without it.

With those in place, the rest of the ask: inland, the first centimetre of
water is the WET GROUND (`wetGround`: the local colour a fifth darker and a
fifth greyer) and the water's tint arrives with depth; the bed's sediment,
gravel bars and damp margin derive from `terrainC` in place of sand
constants, and the sward's bank mineral applies the same rule
(`bankMineralOf`) so the two meet in one colour at the waterline. **A channel
is a trough:** across the ribbon the visual and bed depth fall from 0.18 of
the texel's depth at the bank to all of it at the thalweg, so the margins
show the bed and the middle goes dark — the shape the chart sees, while the
physics keeps the texel. The bed's broad structure (`bedLod`) outlives the
skin's 875 m; its bar contrast opens with the overhead component; the fine
grain still fades with range. And a chart looks into the ZENITH, not the
horizon band.

| frame (harness, z 2.2) | ground L | rim L | mid L | mid / ground |
|---|---|---|---|---|
| noon clear, before | 109–123 | 158–169 | 122–140 | 1.05 |
| noon clear, after | 108–123 | 113–126 | 97–105 | 0.85 |
| haze noon, before | 86–101 | 147–162 | 117–133 | 1.30 |
| haze noon, after | 75–89 | 80–93 | 68–75 | 0.85 |
| haze, 32° sun, before | 97–101 | 149–157 | 117–124 | 1.20 |
| haze, 32° sun, after | 86–101 | 85–95 | 72–79 | 0.80 |
| night, after | 50–58 | 38–42 | 28–31 | 0.55 |

Rim within the ground's range everywhere; the river reads as a darker band
in its valley with a thalweg streak, blue-grey under haze, and it is still
there at night under the chart's moon.

Verified: `tsc` clean, hydro, inland-water and switches tests green, `boot`
no page or GLSL errors, five chart renders and a chase render without a
shader error, the profiles above. Not verified from the seat at the bank.
`water-cover.test` fails five checks — it runs against the live cell's
land-cover route and fails identically at fe0dae5, before any of this; not
this unit's. Pulled and merged the owner's e21c3cd on the way ("sol attempt
to fix": the physics samples the field at the shader's `WATERLINE_CUT`
through `drawnHydroAt`, `sampleFieldSurface` extracted with a coverage-cut
argument, `terrainC` hoisted out of the surf split) — no conflicts.

### The bank pass pulled from the cell — texel centres, one hash, reeds and stones

Pulled after v1788878839369 and committed as the other agent's work
(9f9ee54): it builds on the chart unit above and keeps every rule of it.
What it changes, for whoever reads the bank next:

- **The field is sampled the way the GPU samples it.** `hydro/field-sample.ts`
  interpolates geometry and dynamics bilinearly at texel CENTRES —
  `(i − gutter + 0.5) · span / resolution` — and reads class and flags
  nearest; the self-test and `sampleBankField` use the same centres. The
  old `round((res − 1)·u)` was half a texel off the shader everywhere.
- **One hash for the waterline, on both sides.** The bank patches' hash works
  in float32's exact integer range; the fractional-multiply version diverged
  by whole buckets between CPU and GPU at kilometre scales, so the physics
  cut and the drawn cut could part. `WATERLINE_CUT` now takes the kind:
  ocean and lagoon keep 0.5 because the surf strip shares that boundary.
- **The sward grows the bank from its own tufts.** Reed and mineral
  suitability ride the colour texture's two spare floats; a submerged slot
  is a NEGATIVE density only an emergent may occupy; the same nine vertices
  become an upright reed or a three-faced stone, damped in the wind and
  never scaled up by range. `REED_M2` is 0.14 — before `SWARD_LUSH`, tall
  stalks need fewer slots than short grass.
- **A river's bank wetness follows metres and depth**, not thirty percent of
  every channel; an unclassified texel is discarded before it draws a skirt.

Verified here: `tsc` clean, hydro, inland-water and switches tests green,
`boot.mjs` no page or GLSL errors, the Senqu chart and seat frames rendered
without errors and the wet map unchanged. Not judged by eye at the bank.

### The route solve was a frozen frame every two and a half seconds

Telemetry from the seat, the Chapman's Peak run to Noordhoek on an iPhone:
`routeSolve` 99 calls in 484 s, 141 ms mean, 405 max, top of 51 of the 410
slow frames and a quarter of all slow-frame time; the last forty seconds
were a 300–480 ms stall every two to five seconds. The graph was cached and
the walk was bounded (above) and it was still a stall, because a budget
for a SOLVE and a budget for a FRAME are different numbers. Three things,
and a fourth the seat noticed:

- **The re-solve ran on every tick of its timer.** The key it compared
  (`goal|osmDone`) was written without the coarse tier's version that the
  solve recorded (`goal|osmDone|ovWayV`), so they never matched and `stale`
  was always true. Fixed by making them the same string — and then gated:
  **a tile can only change the plan where the plan is.** Every finished OSM
  tile is noted with its centre (`noteOsmDone`), and while the truck is on
  its route a survey-only change re-solves only if one of the new tiles
  comes within `ROUTE_CORRIDOR_M` (250 m plus the tile's half-width) of the
  route's polyline. A new goal, a swapped coarse tier and a truck off its
  line re-solve at once, as before. The dump counts `tiles skipped / hit`.
- **The solve is a job in slices.** `RouteJob` holds the graph build's
  iterators (the road grid's cells, the coarse ways, the graph's own
  entries for the portals), the handover, and the walk's heap and frontier;
  `routeJobStep(job, ROUTE_SLICE_MS)` runs it until three milliseconds of
  the frame are spent and hands the frame back. The route in force stays in
  force until the new one lands whole. The budget is checked AFTER an item
  is processed in every phase but the portals, where it is checked before
  the iterator is advanced — a node pulled and abandoned for the frame
  would never be seen again. Live iterators, not snapshots: a cell that
  gains segments behind the cursor is the next solve's business. The
  handover percentile comes off a ten-metre histogram; sorting fifty
  thousand distances was a ten-millisecond slice on its own.
  `solveGoalRoute` is the same job run to completion in one call — the
  probe's and the bench's path, unchanged in contract: the Simon's Town
  fixture solves identically before and after (48 nodes, walked 48, inner
  489/490), and `far-route.test` passes (164 nodes, 104 coarse, 26 portals,
  3.8 ms). A first run of that bench failed on the live roads with the
  truck moved onto a 107-node component; the previous commit fails the
  same way on a bad draw, which is what the fixture run was for.
- **The dump attributes the solver.** One `route solves` line: count, found
  and failed, ms a solve with the graph's share, the worst, slices and the
  worst slice, the last solve's wall span, walked against nodes, the tiers
  and portals, graph cache hits, tiles skipped and hit, and the last
  answer.
- **The plan was drawn on the chart and nowhere else.** `refreshRoadLine`
  and the mint dots ran only in the top camera, so a truck plainly steering
  down a plan showed no plan from the seat. `refreshRouteAhead` now builds
  the driven line — `goalAhead` to 320 m, the surveyed half the autopilot
  may steer on, at deck height plus 0.6 m — every 250 ms in any other
  camera, and the same projection and the same dots draw it on the road
  ahead in perspective. The minimap draws the whole plan as mint dots in
  its rotated frame, the coarse half fainter and at a longer stride.

Verified: `tsc` clean, `boot.mjs` no page errors, switches and autopilot
suites green, the fixture comparison above, `far-route.test` green on a
second draw, and the harness frames at Simon's Town — the dots up the road
ahead from the seat, the plan on the inset, the chart as before. Not yet
measured on the device: the next telemetry paste from a run with a goal is
the verification, and it should show `routeSolve` under 4 ms a call.

### The route solve in slices, and the plan drawn from the seat

Telemetry from the seat on the Chapman's Peak run: `routeSolve` ninety-nine
calls in eight minutes, 141 ms mean, 405 max, the top phase in fifty-one
slow frames. Two faults: the re-solve key was written with the coarse
tier's version and compared without it, so the two never matched and the
solve ran on every tick of `GOAL_SOLVE_MS`; and a solve's budget is not a
frame's — even cached and bounded, 140 ms is six dropped frames.

- **The solve is a job** (`RouteJob`, `routeJobStep`): the fine survey, the
  handover, the coarse tier, the portals and the walk are each resumable,
  and a slice takes `ROUTE_SLICE_MS` (3 ms) of a frame. The route in force
  stays in force until the next lands whole. `solveGoalRoute` is the same
  job run to completion — the probe's and the bench's path, unchanged in
  contract: on the Simon's Town fixture the job and the old function give
  the identical route, and `far-route.test` passes with a mixed plan over
  26 portals. The handover's percentile comes off a 10 m histogram, not a
  sort of fifty thousand floats. THE BUDGET CHECK GOES BEFORE THE ITERATOR
  IS ADVANCED in the portal phase — a node drawn and abandoned for the
  frame would never be seen again.
- **Tiles re-solve only where the plan is.** Each finished tile is noted
  with its centre (`noteOsmDone`); with the truck on its route, new survey
  re-solves only when a tile lies within `ROUTE_CORRIDOR_M` of the line.
  A new goal, a swapped coarse network and a truck off its line re-solve
  at once. The dump prints the solver's books (`route solves …`).
- **The seat sees what the autopilot drives.** The mint dots were chart-only
  by construction (`refreshRoadLine` ran in top mode alone). From the seat
  `refreshRouteAhead` projects the DRIVEN line — a mission's authored leg
  first (gold, as the chart draws it), the solved plan second (mint) — the
  surveyed part ahead to `ROUTE_SHOW_M`, on the deck, dotted so it never
  reads as a marking; the minimap draws both whole. The first cut drew only
  the plan and the second run from the seat was a mission, so the seat saw
  nothing again: `autoCourse` ranks the leg above the plan, and the line
  has to rank the same way.
- **The second run's dump had no solver line at all** because no goal was
  held: a reel drive sets its goal in `startDrive`, a reload with `m=` arms
  the mission and nothing else, and arrival clears it. That is the
  autopilot on the leg, honestly, not the solver failing.

Bench caveat: `far-route.test` runs on live roads and `__toroad` can land the
truck on a small disconnected component (a first run: 107 nodes walked, 4
portals, no coarse leg); the previous commit fails the same draw. The
fixture comparison (`scratchpad/route-fixture.mjs` in the session) is the
deterministic check. `autopilot-drive.test` fails three checks for want of
a road under the truck at its live spot, before and after.

### The route is a chip, not a line in the seat

The owner's rule, after two Chapman's runs: the dotted plan belongs to the
CHART only — no dots on the road from the seat, none on the minimap — and
the active route belongs on the glass the way an active task does: a chip
top-left, in the plan's mint, on the task's row (under the task chip when
both are up; `--route-dy` is set by the overlay, not the stylesheet). A tap
opens the card — ROUTE · name · "430M BY ROAD · 25.7KM ON FOOT" — with the
one action a plan needs, CANCEL ROUTE, and an X that folds it back. The
distance is what is left along the plan from the truck's nearest point,
straight-line when there is no plan yet, memoised at 500 ms. `cancelRoute`
drops the goal, the route, the job in flight and the ARRIVED toast;
`__routecard('expand'|'collapse'|'cancel')` drives it from a test.

Verified in the harness at Simon's Town: chip shown with a goal set, card on
tap, cancel clears `__goal()` and `__route()`; no dots in the chase frame.

### Four small things from the seat, and one of them was not small

- **THE DRONE FILLED IN THIRTEEN MINUTES.** 4.1 kW into a 0.9 kWh pack, for
  sixty-two seconds of air: twelve times the sortie it pays for, so the drone
  was one flight a session and the rack was where it lived. The rate is stated
  as `DRONE.FILL_S` (90 s) now and the kW falls out of it (36), because the
  fill time is the thing being chosen. **The energy is unchanged** — a sortie
  still costs 0.9 kWh of the truck's 10, still stops at the reserve, and the
  array still pays it back. Only the rate moved.

- **DRAGGING THE CLOCK STOPPED THE DAY.** `clockHeld` was an ABSOLUTE hour and
  `solarHour` returned it before it looked at anything else, so a scrub in
  CYCLE (the default, 24x) froze the world at the dragged hour. It is
  `clockShift` now — hours ADDED to whatever the mode's own clock says — so the
  drag moves the sun and the mode goes on running underneath it. A fixed hour
  behaves exactly as the old hold did, because its base does not move.

- **AND A TAP CUT RATHER THAN RAMPED.** The tap still steps the TIME dial
  instantly, but the displayed hour eases from where the sun was to where the
  new mode wants it (`clockRamp`, 1.6 s, `hourDelta` so it takes the short way
  round the face). **THE LAYERING IS LOAD-BEARING AND WAS MEASURED.** The first
  cut captured `solarHour()`, which already carries the splash's golden lean,
  and then the lean was applied again to the blend's output: with a synchronous
  read either side of a tap the sun moved **0.34 h BACKWARDS in the instant the
  mode changed** — a cut, which is the one thing the ramp exists to prevent.
  `clockHour()` (base + shift + ramp, no lean) is what a gesture captures now;
  `solarHour()` is that plus the lean. Same read after the split: the mode
  jumped 3.37 h and **the sun moved 0.0000 h**.

- **THE DOWNED DRONE'S PIN VANISHED AT SIXTY METRES.** `POI_PIN_NEAR` drops a
  pinned POI you are closer than 60 m to, on the reasoning that a pin you are
  standing on describes something already filling the frame. True of every
  other pinned POI, because they are all PLACES; false of the one that is a
  shoebox in waist-high scrub. The pickup radius is 9 m, so the whole 60→9 m
  window — exactly the stretch where the marker stops being a bearing and
  starts being a search — was blind. Kind `drone` is exempt from the near cull.

**AND THE CHART'S OVERVIEW NEVER LOADS AT THREE OF ITS SEVEN LEVELS.** Asked as
"I open the chart and zoom out and it is not clear if or when the overview will
load". Measured against the live cell at Cape Town, one cold ask per level:

| level | box | result |
|---|---|---|
| z13 / z12 / z11 | 5–20 km | **200** in 0.4–0.6 s, from the bank |
| z10 / z9 / z8 | 39–156 km | **502 at the edge, ~15.5 s, every time** |
| z7 | 313 km | **200** in 0.45 s |

The 502s are not cold tiles filling. Re-asked immediately: 502. Re-asked after
**75 s**, past the Lambda's own 50 s budget: 502. They never bank, because
`putTile` runs only after Overpass answers, and `serveOverview` returns a
bare 503 both when the upstream times out and when the answer hits `OV_CAP`.
Asked of a mirror directly, the z10 box's **motorways, trunks and primaries
alone come back at 3,000 ways in 35 s — exactly the z10 cap**, so the handler
refuses it as too dense before the coastline, rivers and peaks are even
counted. (The other clauses could not be timed cleanly: the mirror was
returning 504s on queries that should be instant, so it was loaded. What is
solid is the highway count and the round trip.)

So the class ladder's own rule — "the classes climb as the tiles shrink" — is
not actually kept in the middle: z8, z9 and z10 all ask for
`motorway|trunk|primary`, over boxes of 156, 78 and 39 km. z7 was narrowed to
motorways and cities when it was measured; z8–z10 never were. **The fix is
cell-side and is not made here** — it wants the same measure-then-narrow pass
z7 got, and a deploy of `index.ts` between measurements.

Two things WERE fixed on the client, because they are the seat's experience of
it rather than the cause:

- **A REFUSED TILE BACKS OFF.** `loadOvTile` cleared its key on any failure, so
  the chart re-asked a 25-tile ring every 1.2 s for ever, four at a time, each
  burning an 11 s abort — a permanent load on a route that cannot answer.
  `ovFailedAt` and `OV_RETRY_MS` (45 s), the shape `osmFailedAt` has had for
  years on the fine layer.
- **AND THE CHART SAYS WHAT IT IS DOING.** The fine vector layer has had a
  status line for years; the one layer the chart actually draws streamed in
  silence, and a backdrop that has not loaded looks exactly like one that
  never will. `MAP z12 · 7/25 · 2 ON THE WIRE` (or `· 3 RETRY`) takes the info
  line in top view while the ring is filling, and yields it back the moment it
  is home. `__ov()` is the probe; `__clockat()` is the clock's tap target, so a
  test can aim a real pointer at it the way `__poirects` lets one aim at a pin.

**THE HARNESS CANNOT SEE A 1.6 s TRANSITION.** Its frames are seconds apart, so
a `setTimeout(180)` returned after 4.2 s and the ramp had long finished by the
first sample. What it CAN do is read either side of a dispatched gesture inside
one synchronous block, where no frame can pass — which is how the ramp above
was proved, and is the general trick for anything with a time constant shorter
than a harness frame.

### The goal's banner, and a summit that has to hold its verdict

Two from the seat, both about a thing appearing when it should not.

- **THE BANNER COULD BE CANCELLED AND NOT PUT AWAY.** `.ov .x` ships
  `display: none` and every card opts IN — the task card does it through
  `dismissable` — so the route card's X was built, wired to the collapse and
  invisible, leaving CANCEL ROUTE as the only way out of a plate you might
  simply want off the glass. The X is turned on, and the two actions now carry
  their right weights: the X folds the banner to its chip with the route
  untouched, CANCEL ROUTE is the only thing that drops the goal.
- **AND IT SAT IN THE MIDDLE OF THE ROAD.** Full width at the message rail,
  growing DOWN from 33% of the screen with a full-width button under it —
  measured 282-376px on an 844px phone. It is a compact centred plate now
  (max-content, 195px measured) that hangs UPWARD off that same rail, so it
  occupies 188-282px — the 22-33% band, clear of the road — and drops below
  the task card instead when that owns the line. The height is measured after
  the plate is shown, because a plate has no height until it is drawn.
- **SELECTING A GOAL OPENS IT.** The banner is the receipt for a decision:
  what, how far by road, and how much of the last of it is on foot. It is the
  chip from then on.

- **A SUMMIT'S LABEL NOW HAS TO EARN ITS PLACE.** The appear gate was 350ms,
  which is under the noise — a peak coming out from behind a ridge at driving
  speed, or one the depth map forgives for a frame, put its name up and took
  it away again. `PEAK_ON_MS` is 2500 against `PEAK_OFF_MS` 900, deliberately
  asymmetric: a label that has just left was probably real and is cheap to
  restore, while one that flickers on is a claim the world has not settled
  enough to make. Any flip restarts the clock, so a wavering summit never
  latches at all. **And a peak arrives OFF** — the first sighting used to seed
  `on` from its own first verdict, so a summit entering range on a lucky frame
  was drawn instantly and the gate applied to everything except the case it
  was written for.

### The chart stood off by speed, and the chase camera never did

Reported from the seat as "we have camera pull back in chase mode (correct)
but it appears to also apply in top/down chart view". Half of that is exactly
backwards, and the half that is backwards is the interesting half.

**CHASE HAS NO PULL-BACK.** It had one — `+0.26m per m/s` — and it was
deliberately removed, because backing the camera away LOWERS the angular flow
of everything near the eye, which is the strongest speed signal there is, and
it read from the seat as "the game feels slow". What replaced it is `fovKick`:
the 55° lens widens toward 63° as the rig approaches its top speed. That reads
as a pull-back and is the opposite of one. The note is already by the code; it
is repeated here because the seat's report was a reasonable reading of what the
frame looks like, and the next person to go looking will start where the seat
pointed.

**THE CHART HAD ONE, AND NOTHING COULD SEE IT.** `CAM.perKmh`, 1.1 metres of
orbit per km/h, in the top camera's stand-off. It was wrong on its own terms
three ways over:

- it broke `ZOOM_MIN`'s whole purpose. That constant exists to put the eye 22m
  over the truck — "a frame about 23m across, the whole of a junction and its
  corners, which is the scale the joins are judged at from the chart". At
  100km/h the same zoom stood at 132m, at 180km/h at 220m. The one thing the
  minimum zoom is FOR was unreachable whenever the truck was rolling.
- it broke `ZOOM_MAX`'s derivation, which runs `viewRadius`'s arithmetic
  backwards and says in its own docstring that it does so *at a standstill*. Any
  speed at the ceiling overshot `SIGHT_MAX` and was swallowed by the clamp — the
  exact "the clamp saturated and the extra ceiling bought nothing" failure that
  `SIGHT_MAX`'s note was written to end.
- and the four places that computed it did not agree. The camera exempted a
  flying drone; the streaming budget, the pan scale and the tap unproject did
  not. With the drone up and the truck moving, the eye stood at one distance
  while the map's own arithmetic believed another.

`chartDist()` is the one place now, and `CAM.perKmh` is retired rather than
zeroed. **A constant nobody reads is the thing this file keeps warning about**,
and this one had been read by four hand-written copies of one expression.

**AND `__cam` COULD NOT HAVE CAUGHT IT.** It reported the zoom and not the
stand-off — and the zoom was precisely the half of the distance that was
behaving. It reports `dist` and `kmh` now. The general rule, again: a probe
that reports the input and not the output cannot witness a term applied
between them.

`devtools/chart-dist.mjs` is the measurement, and it has a trap in it worth
keeping. **The zoom and the speed live on different clocks.** `__zoom` sets a
TARGET that `zoomCur` eases toward at 8/s, so changing it needs frames to pass;
the speed term, if it were still there, is applied per frame from `state.speed`,
so proving it gone needs NO frame to pass — `__drive` IS the sim's state object,
and setting `speed` on it and reading `__cam()` in the same evaluate means the
sim never gets the chance to put the speed back. The first cut ran the whole
thing in one synchronous block and read `zoom 1 / dist 175` in all six rows: a
real pass on the speed question and no test of the zoom question at all.
Measured after, three zooms, four speeds each: 22m at 0.125, 385m at 2.2, 3495m
at 20, identical at 0, 60, 120 and 180 km/h.

### The wide chart does not load, and it is NOT that the tiles are too dense

The standing diagnosis in this file — z8, z9 and z10 return 502 because their
boxes are too dense for the class ladder, so narrow the ladder — **is not
supported, and the measurement that was supposed to support it was measuring
somebody else's queue.** Two controls overturned it, and both are the kind that
should have been run first.

**A PURE OCEAN TILE FAILS IDENTICALLY TO A CITY TILE.** Asked of the live cell,
same rung, three densities:

| | z10 | z9 | z8 |
|---|---|---|---|
| Cape Town (city + coast) | 503 @ 9.0s | 502 @ 15.9s | 502 @ 16.0s |
| Namib (near-empty) | 502 @ 15.5s | 502 @ 16.0s | 502 @ 16.0s |
| **South Atlantic (pure ocean)** | **502 @ 16.0s** | **502 @ 16.0s** | **502 @ 15.9s** |

A mid-Atlantic z8 box contains essentially nothing. An empty answer cannot be
slow because of how much it contains, so density is not the discriminator —
whatever else is true. (The controls in the same run: Cape Town z12 serves 1,647
ways / 201KB in 395ms and z7 784 ways / 89KB in 310ms, both from the bank, so
the route, the bank and the edge are all healthy.)

**AND A COLD FINE TILE FAILS TOO.** `~/osm/v3/` at z16 over the Karoo — a place
nobody has driven, so a genuine miss — returned 503 in 12.8s, while the banked
Cape Town z16 beside it served 135KB in 3.0s. **The upstream is degraded for
this cell across every layer, not at the coarse rungs specially.** Nothing about
the ladder can be concluded on a day like this one.

**WHY THE ORIGINAL NUMBERS WERE WRONG.** The mirror health control, which is one
query and had never been run: a ONE-CITY-BLOCK query returning 23 ways — a cost
of essentially nothing —

| mirror | one-block query | verdict |
|---|---|---|
| overpass.kumi.systems | **39.6s** | saturated |
| overpass.private.coffee | **36.4s** | saturated |
| overpass-api.de | **1.6s** | healthy, `Rate limit: 2` |

Two of the cell's three mirrors are twenty-five times slower than the third on
a query with no content. Every "this rung takes 35 seconds" reading in the
previous investigation came off those two, so it was a reading of their queue
and not of the box. **Measure the instrument before measuring with it** — the
same lesson as the settle gate, one layer out.

**WHAT IS STILL SOLID**, because it is arithmetic and code-reading rather than a
timing, and each of these is worth fixing whatever Overpass is doing:

- **The ladder is not a ladder in the middle.** z8, z9 and z10 all ask for
  `motorway|trunk|primary`, over boxes of 156, 78 and 39km — 16x, 4x and 1x the
  area. Only z7 was ever narrowed, and it was narrowed because it was measured.
- **The caps are inverted against their own stated reason.** z8 gets 8000 and
  z10 gets 3000, "the same narrow class set over 4x and 16x the ground" — but
  the class set at z8 is not narrower than z10's, it is identical, so 16x the
  area is given 2.7x the headroom.
- **`OV_ATTEMPT_MS` (26s) is a silent hard gate.** A query that genuinely needs
  30s never completes on ANY attempt, so the tile can never bank however many
  times it is asked — and the design's whole answer to slowness is that the
  Lambda outlives the edge and banks anyway. Confirmed against the live cell:
  the same z9 tile asked at 0s, 70s and 140s returned 502 every time. It is not
  filling in the background.
- **At most two of the three mirrors are ever tried.** `askOverpass` gives
  mirror one `min(26s, 44s)` = 26s; on failure `left` is 18s so mirror two gets
  18s; then `left < 1500` and the loop breaks. The third mirror is unreachable
  by construction whenever the first two time out.
- **Mirror choice has no memory of health.** The rotation is `(x+y+z+minute) %
  3`, so a mirror that has failed every request for an hour is asked exactly as
  often as one that is answering. With two of three saturated, two thirds of
  overview asks start by spending most of the budget on a mirror that will not
  answer.
- **The ring is 25 tiles at the rungs that cost most**, four in flight, against
  a mirror whose per-IP limit is two concurrent queries.

**UNVERIFIED AND WORTH ONE QUERY** when the service is well: `out geom` returns
a matched way's WHOLE geometry, and a coastline or a large river way is not
bounded by the box. If that is right, the coast clause at z8 and z9 can drag a
continent's coastline into a 156km tile, and it would be invisible in a way
count. z7 already carries no coast, for a reason recorded as a timing.

**THE THING TO BUILD FIRST IS NOT A FIX, IT IS A WITNESS.** `serveOverview`
returned a bare 503 on every failure — mirror refused instantly, query too big,
budget exhausted and cap tripped were one string. Nobody could tell them apart
from outside, which is why this took two sessions to get wrong twice. The 503
now carries `why` (`upstream` or `cap`), `src` and, on a coarse rung, why the
bake did not answer.

### …so the wide rungs stopped asking, and are served from a bake

z7, z8 and z9 come from Natural Earth now (`ne-wide.ts`, baked by
`devtools/bake-ne-roads.mjs` into `static/ne-wide.b64`). Not because the ladder
was too dense — it was not, see above — but because a chart backdrop cannot
depend on a third party answering a 156km bounding-box query inside the fifteen
and a half seconds CloudFront will wait, whatever mood the mirrors are in.

**AND OSM WAS THE WRONG SOURCE FOR THOSE RUNGS ANYWAY.** A z8 tile rendering
into 256 art pixels is 600m a pixel. At that scale the chart wants the trunk
network that makes a landform legible, which is a generalised cartographic
product — and Natural Earth is one. Same source and the same shape as
`bake-coast.mjs`, for the same reason: the answer is needed at a scale nothing
this game streams can reach.

**COVERAGE WAS THE ONE THING THAT COULD HAVE KILLED IT**, so it was measured
before anything was written (`devtools/ne-roads-coverage.mjs`), in km of road
per million km²: W Europe 42,911 and the eastern US 41,593 against Southern
Africa 17,115, Central Asia 16,068, the Andes 12,733, the Sahel 8,186, SE Asia
7,584, Australia 5,726. **That spread is real road density — Australia genuinely
has fewer roads than Belgium — and nowhere is empty.** A wide chart that worked
in France and was blank in the Karoo would have been the same failure wearing a
new cause and no error message.

**SCALERANK IS THE LADDER, AND CARTOGRAPHERS ALREADY BUILT IT.** 46% of NE's
features carry `type: "Unknown"`, so a ladder in its type vocabulary would be
guesswork; every feature carries `scalerank`, which is its own judgement of the
zoom at which a road starts to matter. z7 takes ≤ 4, z8 ≤ 6, z9 ≤ 8. **The asset
holds everything to 8 and the HANDLER applies the cut**, so moving a rung is an
edit and a deploy rather than a re-bake and three megabytes back through the
cells tools — which is precisely how the old middle rungs ossified into one
class set over sixteen, four and one times the area.

**IT SPEAKS OSM, SO THE CLIENT DOES NOT KNOW.** `neWideTile` returns the same
`RawWay[]` an Overpass answer does, with `highway` and `place` tags, so
`trimOverview`, `loadOvTile`, the ribbons and the coarse tier of the route
solver are all unchanged, and the swap is undone by one condition. If the asset
is missing from a deploy the rungs fall through to Overpass exactly as before —
degraded, not broken — and the 503 says the bake is why.

Three things worth keeping about how it is built:

- **BASE64 TEXT, NOT A BINARY ASSET.** `cell-sync push` sends a binary in ONE
  signed request and that request 403s past about a megabyte (the cliff that
  once made a grown `main.ts` undeployable), because two independently-decoded
  base64 chunks only concatenate when the first is a multiple of four. Text is
  chunked with `appendToFile` and decoded whole at the far end, so the trap
  cannot fire. 2.26MB does not fit under the binary cap by any means: measured,
  even a 1200m simplify — twice the coarsest rung's own tolerance — is 1.19MB.
  It pushed in 6 parts.
- **THE BAKE TOLERANCE IS THE FINEST RUNG'S OWN, EXACTLY.** z9's trim tolerance
  is 153m, so the bake simplifies at 150m: nothing is lost at any rung it
  serves, and nothing is carried that every rung would immediately discard.
- **THE ENCODER ROUNDS THE WAY THE DECODER WILL.** A line's first point is
  absolute Int32 and the rest are Int16 deltas at 1e-4 degrees. Taking each
  delta against the TRUE previous point lets the error random-walk — about 55m
  after a hundred points; taking it against the point AS THE DECODER WILL
  RECONSTRUCT IT bounds it at one step. Measured worst error 7.9m, against a
  305m chart pixel at the finest rung it serves.

**AND A ROAD'S IDENTITY IS NOT UNDER `name`.** The first bake shipped with
place names and not one road name, which looked like the truth about the dataset
and was not: counted over all 56,600 features, `name` is 19% and mostly a bare
number, `local` 4% and national (`A61`, `N634`), `label` 6% and European
(`E31`). It matters because the coarse route tier scores a candidate with
`NAME_BONUS` for keeping the road's identity — the rule that stops a drive
turning off onto a spur that happens to line up — so **a layer swap would have
silently disabled a routing heuristic while every tile looked fine.**
`local || label || name` gives 29% of baked roads an identity; Paris z9 reads
A10 / A6 / A4 / A5 / N104 / N4.

**MEASURED, LIVE, BEFORE AND AFTER**, same three tiles at three densities:

| | z8 before | z8 after | z9 before | z9 after |
|---|---|---|---|---|
| Cape Town (city+coast) | 502 @ 16.0s | **200 @ 3.8s**, 21 ways | 502 @ 15.9s | **200 @ 4.5s**, 11 ways |
| Namib (near-empty) | 502 @ 16.0s | **200 @ 3.8s** | 502 @ 16.0s | **200 @ 0.20s** |
| S. Atlantic (nothing) | 502 @ 15.9s | **200 @ 4.3s**, empty | 502 @ 16.0s | **200 @ 0.17s** |

The seconds are the cold Lambda decoding the asset; warm is 0.2s and **a
re-ask is `Hit from cloudfront, age 4`** — the tiles bank now, which the old
rungs never once did (the same z9 tile asked at 0s, 70s and 140s was 502 every
time). `devtools/ne-wide.test.mjs` holds it in pure node: 41,068 lines decode in
87ms, a dense Paris z9 slices in 1.2ms, and the 5×5 ring the chart actually asks
for carries roads at every rung at all eight places the game is driven.

**THE TEST'S FIRST CUT ASSERTED THE WRONG THING, and the failure was the
useful kind.** It required a road in the TILE under each spot and failed at the
Serengeti and the Sundarbans — correctly reporting that those 78km boxes hold no
major road, which is a fact about the Serengeti and not a defect in anything. A
plain is allowed to be empty. The chart is not, and **the chart never shows one
tile**: `ovLevelFor` picks the rung so the 5×5 ring covers the view. An
assertion about one tile was an assertion about the world; the assertion about
the ring is one about what a player sees.

**WHAT IS LEFT.** z10 is still Overpass's, now asking motorways and trunks
alone over a 39km box (it asked for primaries too, over the same set as z8's
156km box). It still failed at Cape Town on the day this shipped, because the
upstream was degraded for every layer including cold fine tiles. The unfinished
piece is the **pyramid**: build a z10 tile by merging its four z11 children from
the bank and re-simplifying, so a rung the player has already zoomed through
costs an S3 read rather than a live query. It needs a bank READ path in the
handler, which does not exist yet — `putTile` writes and nothing reads.

**AND THE BANK IS NOT VERSIONED PER CONTENT.** `~/osm/ov1/` tiles are stored
`immutable` for a week, so the handful banked between the first bake and the
name fix will serve nameless coarse roads until they expire. Bumping to `ov2`
would have invalidated the whole overview bank — including every z11/z12/z13
tile that cost a real Overpass query — which is far too much for 29% of coarse
roads gaining a label the chart does not draw. If a future change to the bake
alters what a tile DRAWS, that trade goes the other way.

### The wide chart wore a checker and a cross, and it was the weather, not the shell

Reported from the seat at −29.9872, 24.7765 on the wide chart: uniform in the
splash, then once driving four quadrants of different tone with hard seams, one
noisy and one flat, "as if we tile a texture". Two hypotheses were built and
measured before the right one, and both are worth keeping because each was
plausible and each has a witness now.

**NOT THE SHELL'S BAKE.** The first suspect was `coverDirtiedFar` skipping any
tile at hit > 0.98 when the wide-cover LEVEL moves — so tiles baked from the
previous level's raster would stand beside tiles baked from the next, four
times apart in resolution. `farBakeZ` records the level per tile now and
`__far().perTile` lists it; `devtools/far-bake-levels.mjs` runs the spot two
ways, arrived pinned wide and walked out from a driving zoom. Both paths end
with the same nine z7 tiles, all baked under cover z6, tint spread 0.134 — and
**that spread is the Karoo not being the Highveld**: the pinned harness frame
has no seam in it at all. The mechanism is real (a walk that passes through
z9 while the cover level is z8 can still do it) and it was not this.

**NOT A TILE EDGE AT ALL.** The seat's frame, decoded properly (it is a 16-bit
PNG; the forty-line decoder refused it and Chromium is the image library this
repo has), puts the tile-debug's dotted z7 edges at x≈740 and y≈570/1140 and
the 20-luma tone step at **x≈554** — on no shell edge and no cover edge, since
cover tiles sit on the same grid. Whatever it was, it was keyed to the truck,
not to the map.

**IT WAS THE CLOUD SHADOWS.** `terrainFx` darkens the ground by the cloud deck
overhead, reading the weather lattice at world position — and the lattice is
48 cells of 256m, **12.3km**, centred on the truck, in a `DataTexture` with no
wrap mode set, which in three is clamp-to-edge. On a 570km chart at 470m a
pixel the lattice is a 26px square; everything else on screen read the
lattice's EDGE TEXELS: four constant corners (the checker) and four
one-dimensional edge rows extended to the screen's edge through the truck
(the cross). The speckle was `clfbm` at `CLOUD_SCALE` — patches of about 600m,
one to two pixels at that zoom, pure aliasing. And the splash was uniform
because its sky read CLEAR: `uCloudS` was 0 and the whole term is behind
`if (uCloudS > 0.005)`; a drive rolled the weather to haze and opened it. The
far shell wears the same material, so the backdrop took it too.

**MEASURED, same chart, same zoom, the sky pinned** (`?wx=`), quadrant luma /
speckle sd:

| | clear | haze, before | haze, after |
|---|---|---|---|
| LL | 101 / 6.2 | 93 / 7.6 | 90 / 6.7 |
| LR | 101 / 8.7 | **74 / 12.7** | 90 / 8.3 |
| UL | 107 / 9.2 | — | 97 / 9.1 |
| UR | 105 / 7.2 | 83 / 11.2 | 97 / 8.4 |

Before: a 19-luma step between the halves and the speckle doubled, the same
signature as the seat's frame (left 80 against right 92, sd 9–10 against
5–6, mirrored by which edge texels happened to carry cover). After: left and
right agree to the unit; what remains is a 7-luma top-to-bottom gradient that
is the haze itself — the chart is tilted 70°, so the far edge looks through
more air — smooth, present nowhere in the clear frame, and correct.

Three rules in the fix, and they generalise:

- **BEYOND THE LATTICE, THE REGION'S MEAN — from the seat.** `clInLattice(uv)`
  is 1 inside and fades to 0 over the last eight percent; past it `covL` is
  `uCloudS`, the regional cover the lattice was seeded from, so the far hills
  under a clouded sky keep a gentle, physical dim with no edge. A clamped
  texture is a half-plane of somebody's edge; a mean is a fact about the
  region.
- **AND NONE OF IT ON A CHART WIDER THAN THE FINE WORLD.** The owner's rule,
  stated flat: no cloud shadows at zooms wider than the fine ring. `uMpp` is
  metres of ground per art pixel on the chart (0 from the seat, by design —
  nothing there is wider than a pixel at the range the shell begins); the
  whole cloud term fades over `smoothstep(15, 60, uMpp)`, 15m being a 3km view
  where a cloud crossing the road is still something you watch and 60m a 12km
  one — the fine ring's edge and the lattice's — so it is gone before any
  pixel outspans a 600m patch. The 30–80m mottle fades over the same range.
  **The aerial perspective goes with it**: the composite's `deep` term had a
  floor written for a survey view looking straight down, but the chart is
  tilted 70°, so its top edge looks 47° off vertical and took three times the
  haze of its bottom edge — measured as a 7-luma gradient down the frame under
  `?wx=haze`, absent under a clear sky. Haze at 500m is a fact; at 330km it is
  a smear over a map. One shared uniform (`mppU`), declared ahead of the
  composite because the composite is built before `envU` is.
- **A UNIFORM, NOT `fwidth()`.** The chart looks straight down from one
  distance, so one number is exact for the whole frame, and it needs no
  derivatives extension on WebGL1.

A first cut collapsed the noise to its MEAN where a pixel outspanned a patch,
rather than switching the term off, and the mean was measured off the shader's
own `clfbm` in node (E[clCov] ≈ 0.013 + 0.240c + 0.392c²; the first port of the
hash fracted its two components before multiplying and read a noise mean of
0.24 for a true 0.47). It worked — left and right agreed to the unit — and it
was superseded by the rule above, which is simpler and what the seat asked for.
The measurement is kept here because the next person to want a cloud's average
on a wide surface will otherwise measure it wrong the same way.

**Measured under the rule**, same pair of frames: haze UL 94 / UR 93 / LL 91 /
LR 91, clear 103 / 103 / 100 / 99 — the quadrants within three luma either
way, and the top-to-bottom gradient 3 under haze against 3–4 under a clear
sky, so the aerial-perspective ramp took the 7-luma smear with it. The haze
frame is nine luma darker overall, uniformly: that is the sky's own light
under cloud, and it is supposed to be.

The water's `sceneShade` carries the same edge and the same fade, or a river on
the wide chart would keep the cross its banks lost. `?wx=haze` on the wide
chart is the two-minute check for any of this; `devtools/wide-cloud-ab.mjs`
takes the pair of frames and `__cam().mpp` says what the fade is keyed on.

**AND THE DEPLOY STUCK.** The first deploy of this fix (v1788955892954) sat in
`DEPLOYING` for forty minutes and the cell kept serving the build before it —
the seat reported the artefact "still present" against a bundle that did not
carry the fix. `cells.get` is the witness (`deploy.phase`); a second
`push --deploy` was issued over it. cell-sync's 180s wait is not the deploy's
duration and never was: verify the LIVE bundle for the symbol, and read
`cells.get` before believing a deploy that outran the wait. The mechanism was
found the next time it happened — the deployer ran out of memory and no
failure path writes the phase; see the deploy ritual at the top of this file.

### The reach is 1,500km, and the globe is the next step

Asked from the seat: "what would it take to zoom out to view the full world,
at dramatically lower detail?" Two steps, and this is the first. The tangent
plane is stretched as far as it honestly goes; the second step is a sphere.

**WHAT MOVED.** `SIGHT_MAX` 600km → 1,500km, and `ZOOM_MAX` follows because it
is derived (≈11,460; the camera stands 2,000km up at the ceiling). Each ladder
gained the rung that serves it: the far shell z5 (a z6 ring reaches 1,355km at
30° and the ceiling asks 1,500; z5's reaches 2,710), the wide cover z4 (a z6
cover ring reaches 1,565km against a z5 shell ring of 2,710, so two thirds of
the shell would be blind without it), the overview z6 and z5 from the same
Natural Earth bake as z7-z9 (scalerank ≤ 3 and ≤ 2, the trunk network of a
subcontinent and its capitals — the asset already held them, and `NE_MIN_Z`
is the one number the handler's range and the bake's cut both read).

**CHECKED BEFORE THE NUMBER MOVED**, because a rung nobody has stood on is a
rung that may not hold: the cell serves cover at z4 and z5 and terrarium
serves DEM at z4 and z5 (curled, 200s, 256² PNGs); `demFloor` is Challenger
Deep for anything coarser than z14, so a z5 tile that is mostly ocean is not
refused; the top camera's far plane is `dist × 4`, 8,000km at the ceiling;
`farSeg` clamps at 128 from z7 down, so a z5 tile costs what a z7 tile does.
`devtools/reach-ceiling.mjs` arrives at the ceiling and reads every layer.

**WHAT BREAKS FIRST IS THE PROJECTION, and it is why there is a second step.**
`toLocal` is equirectangular scaled by cos(origin.lat). A z5 tile ten degrees
north of the truck is placed with the truck's cosine — 8% too wide at 30° —
and everything ON it (roads, cover, coast) is stretched with it, so the map
stays internally consistent and becomes, smoothly, a plate carrée centred
where you stand. At 1,500km that is a mild distortion at the frame's edge; at
3,000km it is a lie. The curvature drop is the other limit: d²/2R is 177km at
1,500km and the tilt compensation is first-order. `GLOBE_FROM_M` marks the
hand-over and equals `SIGHT_MAX` for now: the plane runs right up to it, and
lowering it is how the globe arrives.

**WHAT THE GLOBE NEEDS, so it is written down while the plane is fresh:** a
sphere of radius R with the camera at altitude past `GLOBE_FROM_M`; a baked
global base (a WorldCover-tinted relief as one equirect PNG in `static/`, a
few hundred KB); the Natural Earth 110m coast, already baked for the site
model (`coast-baked.ts`); roads at scalerank ≤ 1-2 and capitals from
`ne-wide.b64` by lowering `NE_MIN_Z`; the day/night terminator from
`clockHour()`; the truck as a pin at its lat/lon; space and an atmosphere rim
in place of the 20km sky dome (which is centred on the eye — see "anything
hung around the eye is a function of the camera"); pan becoming rotate; and a
cross-fade with the plane chart over a zoom band above `GLOBE_FROM_M`. It
must not touch the fine world at all. `mppU` is already the one number the
chart's scale-keyed terms read, and the globe sets it too.

### The planet: Tier 2, and what a globe costs

Asked from the seat after Tier 1: the full world, at dramatically lower detail.
The plane could not go further — `toLocal` is equirectangular scaled by
cos(origin.lat) and the curve compensation is first-order — so past it there is
a sphere. `client/globe.ts`, `static/globe-base.png`, `devtools/bake-globe.mjs`,
`devtools/globe.test.mjs`, `devtools/globe-view.mjs`.

**IT IS A BACKDROP, NOT A MODE, AND THAT IS THE WHOLE DESIGN.** The instinct is
a globe VIEW with a cross-fade over a zoom band. It is not needed: the far
shell already sinks by d²/2R, which IS the sphere to second order, so a sphere
of the same radius centred one Earth radius under the truck passes through it.
They agree where they overlap (2.5km apart at 1,500km — a sixth of a percent)
and the globe simply fills whatever the streamed world does not, exactly as the
shell fills what the fine ring does not. **The limb arrives on its own.** There
is no transition to build, no two projections to keep registered, and nothing
in the fine world changes. What DOES change is the camera: the tilt eases to
straight down and the far plane has to clear the horizon.

**THE BASE IS BAKED FROM THE GAME'S OWN RULES.** Every texel of the 1024×512
equirect image is coloured by importing `client/climate.ts` and calling the
same `climCompute` → `groundColourAt` the terrain painter calls, over AWS
terrarium z4 and the cell's own cover z4. A NASA Blue Marble tile would be
prettier and WRONG: this world's ground is `GROUND_RAMPS`, where the emerald
comes from the plants standing on the sand rather than from the sand, and a
photographic Earth would read as another game's map the moment you zoomed onto
it from the shell. 317KB, under the ~750KB binary cap, fetched on the first
wide chart and never at boot. Tiles cache under `node_modules/.cache`, so
re-baking after a palette change costs no network.

**FIVE FAULTS, AND THE ORDER THEY WERE FOUND IN IS THE USEFUL PART:**

- **The frame is LEFT-HANDED and a sphere notices.** The world is `x = east,
  z = south` ("north = -z (screen up)"), which is right for a chart and, in
  three dimensions, left-handed as a geography: east × up is north, north is
  −z, so x̂ × ŷ = −ẑ. A flat tangent plane never notices, because every layer
  is placed by the same `toLocal` and a mirror about the map's own vertical is
  invisible. **No rotation carries a physically-handed globe into that frame** —
  only a reflection, and a reflected mesh draws its texture mirror-imaged, with
  the Atlantic on the wrong side of Africa and every coordinate still checking
  out. The test caught it as `det = −1`: five orientations returning `up`
  = 0.0000 instead of 1. The mirror is taken ONCE, in the frame's definition
  (`latLonToUnit` negates z), and a reflection applied to both a surface and
  its light preserves every dot product, so the terminator is exactly where the
  real Earth's is.
- **The fresnel compared two different frames.** `vN` is the normal in the
  globe's frame (what the sun is dotted with, because `uSun` is a globe-frame
  vector) and the limb needs it in VIEW space. Using one for both makes a
  number with no meaning that happens to be large over most of the disc: it
  rendered as a blue veil over the whole planet, washing the continents flat
  and hiding the terminator. **And it looked exactly like atmospheric haze** —
  the composite's fog of war and aerial perspective were both suspected and
  both measured innocent (`uFow` defaults to 0; the haze already stands down
  past the fine world) before the shader was read. Two varyings now.
- **The day side ignored the sun's angle.** `mix(uNight, 1.0, lit)` lights the
  planet evenly from terminator to terminator, while the shell beside it is
  Lambert ground under the same sun — so they meet at a step through the whole
  hand-over band. With the cosine in, measured at 6km a pixel: shell/globe luma
  **0.969**, which is as close as two different datasets get.
- **`dist × 4` cut the planet off mid-ocean.** The horizon is √(h²+2Rh), which
  grows as √h while 4h grows as h; they cross at h = R/8 ≈ 800km. At 200km up
  the horizon is 1,609km and the far plane stood at 800. `globeFar`.
- **A backtick in a GLSL comment, for the fifth time this file has said so.**

**AND THE SHELL HANDS OVER WHEN IT STOPS COVERING THE FRAME.** The far shell is
a 5×5 ring; past the zoom where that ring is narrower than the frame it is a
RECTANGLE of coarse ground sitting on a planet. At 6km a pixel it is a flat
grey-green smear over two thirds of the frame with a hard edge across the Cape,
while the globe beside it carries a hillshaded coast and a real sea — the shell
was built to back a 600km chart and is no longer the better picture at 1,500km
and beyond. The rule is geometric and self-adjusting at every rung: **the ring
draws while it is wider than the frame's DIAGONAL** (the corners are where a
square ring under a rotated frame gives out first), and the planet draws above
that, so no edge is ever on screen. Where there is no planet to hand to — a
fixture, or the texture never arriving — the shell keeps drawing, because a
coarse backdrop beats an empty frame.

**Measured** (`devtools/globe-view.mjs`, Letsemeng at noon, `?wx=clear`):

| zoom | altitude | m/px | tilt | shell | ring vs frame | space |
|---|---|---|---|---|---|---|
| 11,000 | 1,925km | 6,263 | 81° | on | 5,424 / 2,208km | 0.03 |
| 40,000 | 7,000km | 22,774 | 89° | **off** | 5,424 / 8,029km | 1 |
| 110,000 | 19,243km | 62,608 | 89° | off | 5,424 / 22,074km | 1 |

At noon the sun reads over longitude 24.78 — the origin's own meridian, to two
decimals — and 55.07° up. No page errors at any zoom. The 40,000 frame is
southern Africa entire, with the Karoo, the Drakensberg's relief and the
coastline correct; the 110,000 frame is the planet with its limb and its
terminator.

### The planet's gestures, and the one test they all rest on

> **THE STORAGE RULE IN THIS SECTION WAS OVERTURNED THE NEXT DAY — see "Globe
> navigation: retain the place, not a disposable spin" below.** A drag no
> longer holds a disposable offset that decays home; it moves a RETAINED chart
> focus, and zooming in keeps the place instead of returning to the rig. The
> seat reported the behaviour described here as wrong, and it is: zooming in on
> somewhere you went looking for is not a request to be taken home.
>
> What survives, and is why this section is kept rather than deleted: the
> hand-over test, the rate derivation, the tap on the sphere, the pin, the
> label gates, and every measurement below. The two bullets that are now
> HISTORY rather than doctrine are marked in place.

A drag moves the planet, a tap lands on it, and the fine world's labels stand
down. Three changes, and every one of them is decided by the SAME question:
does the streamed shell still cover the frame? `globeFree` is that question,
the top-camera branch's `shellOn` is now literally `globeFree() === 0`, and
`devtools/globe-spin.test.mjs` asserts both regimes from both sides — restated
against the retained-focus contract after nine of its assertions failed the
day that landed. A test that survives a change of contract by being loosened
is worse than one that fails.

- **A SPIN IS NOT A PAN, AND MUST NOT BE STORED AS ONE.** *(HISTORY: the
  successor stores exactly that, in `panX/panZ`, and the objection below is
  answered by never springing the pan home and by reading remote chart height
  from the coarse raster. Kept because the arithmetic is still the reason a
  retained focus needs `chartRemote` and `chartGround`.)* The obvious
  implementation accumulates the drag into `panX/panZ`. At planet zoom one
  drag across the glass is thousands of kilometres of tangent plane — nine
  million metres of `panX`, which the moment you zoomed back in would stand
  the chart's camera nine thousand kilometres from the truck over a world that
  has none of it streamed. `globeSpinLat/Lon` are degrees, and the globe's
  POSITION never moves for them: the sphere stays tangent under the truck and
  only its orientation changes, so what turns is the Earth under a fixed eye.
- **THE RATE IS THE GEOMETRY'S** (`globeDegPerPx`): the ground the frame
  covers, over R. `chartMpp` is metres per ART pixel and a finger is on SCREEN
  pixels, so this divides by the frame's own height instead. The east
  component of a drag is divided by the cosine of the tangent latitude —
  floored at 0.25, about 76° — which is the spherical form of the same "is the
  ground you grabbed still under your finger" rule `chartPlaneAt` answers for
  the flat chart. A drag from the middle of the disc to its limb turns the
  Earth about 115° rather than 180°, because the mapping is the tangent
  plane's and linear; that is what makes a small drag near the middle feel
  like the same gesture as a small drag on the flat chart one step below.
- **AND `globeFree` IS A STEP, WHICH THE FIRST CUT WAS NOT.** *(Still true, and
  the successor tightened it further: it reads the FINAL shell's reach
  (`farLevelFor(SIGHT_MAX)`) rather than the in-flight `farZ`, so a tile
  landing mid-gesture cannot change which gesture a held finger owns, and it
  measures the frame in screen pixels rather than art pixels so the PIXEL dial
  cannot move it.)* A ramp over the
  band above the hand-over is the obvious shape and is wrong, measured: at
  z40,000 it stood at **0.801**, so a drag asking for ten degrees turned the
  Earth eight. The rate is already exact, and scaling an exact rate by a
  second ramp breaks the contract by a factor that changes with the zoom.
  There is nothing left for a ramp to soften either — the shell it exists to
  agree with is a hard switch itself, and above the hand-over the shell is
  OFF. The step is invisible where it fires, and not by luck: the frame it
  fires on is the one where the coarse ring covers the frame corner to corner,
  so the planet snapping home is behind the shell just drawn over it.
- **AND THE LATITUDE BOUND IS ON WHERE THE VIEW REACHES, NOT ON THE SPIN.**
  The spin is an offset from the TRUCK, so a symmetric ±85 written on the
  offset bounds the wrong thing: a rig in the Karoo at −30° could turn the
  view to +55° and no further, and Cape Town could not be used to look at the
  Arctic — which is most of the point of being able to turn the planet. The
  clamp is `gLat + spin` within ±85 (85 and not 90 because the tangent-point
  cosine that scales a horizontal drag goes to zero at a pole).
- **THE PIN, BECAUSE A SPUN GLOBE IS A GLOBE YOU CAN GET LOST ON.** The
  truck's own lat/lon, a child of the globe group so it rides round the limb
  and is occluded by the planet's depth, sized in art pixels (4.5) rather than
  metres so it is a locator at every altitude, and lifted 0.1% of R — the
  160-segment lattice chords 1.2km under the true surface, so a pin ON the
  radius sinks into its own planet. Hidden below the hand-over, where it would
  sit at the frame's centre saying what the whole chart already says.
- **A DOUBLE TAP LANDS ON THE SPHERE** (`globeHit`, `globeTapAt`).
  `chartToWorld` unprojects onto the tangent plane and marches the
  heightfield, which past the plane's honest reach solves to a point tens of
  thousands of kilometres out in a projection that stopped describing the
  Earth around 1,500km — so above the hand-over the same ray is intersected
  with the sphere and converted back through `toLocal`, the same
  equirectangular convention every other layer on the chart is placed by. The
  mark, its record and its RELOCATE therefore agree with each other. **The
  NEAR root, always** — the far one is the back of the planet, so a tap on
  Africa would answer with the Pacific, correctly and uselessly — and a ray
  that misses returns null rather than being clamped to the limb, because a
  tap on space is not a place.
- **THE FINE PIN LAYER STANDS DOWN IN TWO STAGES, and they are different
  claims.** Scenery is drawn from a 3km catchment, which is a fact about the
  fine world; two pins inside it can only be told apart while that catchment
  spans more than a label, so unpinned pins stop at `POI_SPREAD_PX` (16 art
  pixels, 187 m/px, about a 60km frame). Pinned entries — a destination, the
  rig, a downed drone, a dropped fix — survive that, because being far away is
  the whole point of them. At PLANET zoom the entire table is inside one art
  pixel of the frame's centre and the layer goes, checkpoints with it; the
  globe's own pin is the only marker that means anything out there. Both lists
  are CLEARED rather than skipped — a list merely not rebuilt stays painted
  and stays tappable, which is the trap `poiVis === 0` already carries a note
  about.

**A TEST'S HORIZON IS NOT A ROUND NUMBER.** The tap round-trip filtered out
places over the horizon with a hand-picked `y/R > 0.2` and failed by 2.9° on
the one place that landed in the sliver it let through: from height h the
visible cap reaches exactly `R/(R+h)`, which at 20,000km is 0.2416 — 76° — so
0.2 is 78.5° and BEYOND it. The ray toward a point behind the limb hits the
near limb instead, correctly, and the round trip had nothing to round trip to.

**Measured on the disposable-spin build** (`devtools/globe-spin.test.mjs`,
Letsemeng, no page errors): at z40,000 the frame is 8,030km against a 5,424km
ring, so the shell is off and `free` is 1; a 120px rightward drag turned the
view 10.76° WEST and moved the latitude 0.000°; a 120px downward drag turned it
9.32° NORTH; the flat pan did not move at all in either. At z8 the same drag
panned 180m and turned the planet 0.000°, a spin banked at 40/80 decayed to
0.02/0.05 in three seconds, and the pin was put away. The centre of an unspun
planet tapped to the truck's own point; the corner tapped to nothing. **The
degrees and the hand-over carried to the retained-focus build unchanged; the
decay and the flat-pan numbers did not, because that is the half that was
replaced.**

**THE PIN'S BAND IS A GEOMETRY.** The sphere's radius on screen is R/mpp — 280
art pixels at z40,000 against a 148×320 frame — so at that zoom the disc is far
wider than the glass and a spin past about fifteen degrees carries the truck's
point off it. At the ceiling (z110,000) the radius is 102 pixels and the whole
disc fits, so the pin is on screen wherever it is on the near face. That is
where a shot of it is worth taking (`SHOT=1`, and `SPIN=`/`SHOT_Z=` for the
rest), and it is why there is no rim chip: the zoom that would need one is the
zoom you would have left anyway.

### A 90° chart tilt loses the map rotation, and it is a rounding bug

The retained-focus pass took `chartTilt`'s wide end from 89° to 90° for a
"truly vertical globe view", and the comment beside it — which said 89 and not
90, because looking down the world's own up-axis is degenerate — was left
standing. The comment was right and the reason was better than it knew.

**The camera's sideways stand-off is `dist * cos(tilt)`.** At 90° that is
4e−10 metres, and the target it is added to is millions of metres from the
origin, so the offset lands below the ULP of a Float64 at that magnitude and
is rounded away. What goes with it is the MAP ROTATION, which is carried
entirely by which way that offset points. `lookAt` then falls into three's own
degenerate guard, a fixed 0.0001 nudge that knows nothing about `mapRot`.

**Measured, eight bearings, two magnitudes** — and that the answer depends on
the magnitude is the tell that this is arithmetic and not geometry. Target at
(1.2e6, −3.4e6), where the two coordinates' ULPs are a factor of two apart, so
the bearing is quantised: 45° drew 27°, 135° drew 153°, 225° drew 207°, 315°
drew 333°, exact only on the four axes. Browsed out to (1.1e7, −7.8e6) it is
worse and simpler: the x component rounds away entirely and 45° draws 0°, the
rotation gone. **89.9° is exact at every bearing at both**, and stands the
camera 12km to one side at planet zoom — 0.15% of an 8,000km frame, under an
art pixel, a tenth of a degree from face-on.

**AND THE REGRESSION CHECK PASSED ON THE BROKEN VALUE TWICE BEFORE IT WORKED.**
First because it swept with the chart focused on its own origin, where the
coordinates are small enough that 4e−10 still resolves; then because it ran
after a block that had left `camMode` on `'chase'`, where `globeOn` is 0, the
tilt is a flat 70 and the offset is kilometres. A test that does not fail on
the bug it names is decoration — so it now asserts its own preconditions
(`hypot(panX, panZ) > 1e6` and `chartTilt() > 85`) before it measures anything.

**TWO TRAPS FOR THE NEXT TOOL THAT DRIVES THIS**, both of which cost checks in
`globe-spin.test.mjs` the day the retained focus landed:

- **`setCam` CLEARS THE PAN EVEN WHEN THE MODE IS ALREADY THE ONE ASKED FOR.**
  "Pan is a glance, not a state to carry over" is right for LEAVING the chart —
  it is what makes leaving return you to the rig — and a same-mode call still
  runs it. A helper that politely re-asserted `top` before each zoom step wiped
  the browsed focus before every reading and reported the retained-place
  regression as unfixed. Ask for the mode only when it is not the mode you are
  in.
- **`__globespin` IS AN OFFSET FROM THE FOCUS, NOT FROM THE RIG.** `stepGlobe`
  consumes it into wherever the chart is already looking, so a delta measured
  from the truck lands on the sum: asked for 40N/140E from a chart parked at
  the south pole and got 15S/130E, correctly.

And a fact about the sphere rather than the code: **a horizontal drag is not a
parallel.** The grabbed point is carried along the great circle through it, so
off the equator the latitude drifts — measured 0.57° of latitude for 10.23° of
longitude, a twentieth. Assert that a drag is DOMINANTLY longitudinal, never
that it is purely so.

**Still open:** `NE_MIN_Z` could drop to serve trunk roads and capitals on the
globe — the asset already holds them — and the globe has no place names of its
own, so between the shell's hand-over and the limb the chart is silent.

## The chart states its scale, as a map would

Asked from the seat with five frames from the Afsluitdijk: the chart should
carry a scale bar, the representative fraction, and the zoom. It does now,
under the clock's row at top-left (below the tile-debug lines when those are
up): `500 KM · 1:16M · Z5.0` over the continent, `2 KM · 1:81K · Z12.6` over a
district, `20 M · 1:816 · Z19.3` over a junction, with a bar of that round
length under it. `chartScale()` is the arithmetic and `__scale()` reports it.

- **All three are the scale AT THE FRAME'S CENTRE**, which is the honest
  statement for a tilted perspective: the near edge is larger and the far
  edge smaller, and at 89.9 degrees the difference is under a pixel.
- **The fraction is ground metres per metre of GLASS**, and the glass is the
  CSS reference pixel — 1/96 of an inch, what a phone reports whatever its
  panel's density — so 1:15M here means what 1:15M means on paper at reading
  distance. `chartMpp` is metres per ART pixel; the art is magnified
  `innerHeight / pixSize.y` onto the glass, which is why the PIXEL dial moves
  the art's scale and not the map's.
- **The zoom is the fractional slippy zoom at the centre latitude** — the z at
  which a 256px tile's texel is one CSS pixel here — and it is what `MAP z13`
  and `FAR Z5` in the tile-debug line are measured against. A view at Z9.4
  drawing a z8 overview ring is one rung coarser than the glass could show:
  the ladder's own margin, now a number on the glass.
- **The bar is a round length** — 1, 2, 5 × 10^k metres — chosen from the top
  so it is as long as it may be under two fifths of the HUD's width.

`devtools/scale-bar.test.mjs` checks the three against the camera at three
zooms. Its first cut failed on its own tolerances: `__cam().dist` is rounded
to the metre (a third of a percent at a junction zoom) and `__globe().focus`
to a thousandth of a degree (two millionths in the cosine), so the camera is
checked at what the probes can say and the scale's own numbers against each
other exactly.

## The chart's ink ladder: the base map recedes as the frame widens, the plan does not

Asked from the seat with the same five frames: the roads and motorways are
far too bold at the wide zooms, and the approach should be principled — what
draws at which zoom, at what weight, and how it sits with the pins and the
plan. The ribbons had ONE rule for weight ("a chart line is a pixel wide, not
a hundred metres wide" — see the note at `ovWU`), written against the
opposite complaint, and it was right as far as it went: a line's weight is a
statement about importance and importance does not change when you pinch.
What the frames show is where that stops: the same two and a half pixels of
saturated gold that annotate a district out-ink a continent, because at the
wide rungs the frame is about the landform and the player's plan and a road
network at the district's weight is the loudest thing on it.

**The principle.** Weight is RELATIVE to the frame. What stays constant down
the ladder is the hierarchy — motorway 1.3 × primary 1.0 × the rest 0.72 —
not the absolute weight; the base width recedes and the ink mutes as the
rungs coarsen; and the things that are the player's — the route line, the
mission's via, the pins, the truck's marker — are drawn on the HUD and take
none of it. Labels keep their own rank gate (`maxRank` by `viewRadius`).

**The ladder** (`OV_PX_BY_Z`, `OV_INK_BY_Z`; the class set per rung is the
cell's and the bake's, unchanged):

| rung | classes | base width (art px) | ink |
|---|---|---|---|
| z13 · z12 · z11 (street, district) | everything the tile carries | 2.0 | 1.0 |
| z10 | motorway/trunk/primary, coast, rivers, places | 1.7 | 0.9 |
| z9 | NE scalerank ≤ 8 | 1.4 | 0.8 |
| z8 | NE scalerank ≤ 6 | 1.2 | 0.7 |
| z7 | NE scalerank ≤ 4 (motorway/trunk) | 1.0 | 0.6 |
| z6 · z5 | NE scalerank ≤ 3 · ≤ 2, capitals | 1.0 | 0.5 |

Every class is floored at one pixel (the vertex shader pushes each side by
`max(hw × base, 0.5)` pixels of ground) — a sub-pixel ribbon is the dotted
ghost the one-rule design replaced. The ink is an alpha the composite dithers
toward the ground; the route line and the pins are HUD ink and keep theirs.

**Measured** (`devtools/chart-ink.mjs`, the Afsluitdijk, control against fix,
each rung's ring home). The instrument is a hide-diff: each rung photographed
with the overview and with `__hide('ov')`, so the pixels that differ ARE the
ribbons — a colour test cannot see muted ink, which is the point. Footprint
is the share of the terrain pane the ribbons change; contrast the luma they
add:

| rung | control | ladder |
|---|---|---|
| Z13.8 street (level 13) | 15.1% / +35 | 15.7% / +31 — unchanged by design, within streaming noise |
| Z10.5 district (level 10) | 13.1% / +24 | 12.1% / +19 |
| **Z7.8 country (level 7)** | **12.4% / +33** | **4.1% / +12** |
| **Z4.9 continent (level 5, shell on)** | **41.5% / +51** | **13.8% / +24** |
| Z4.5 (past the hand-over at 53N) | 1.3% / −13 | identical: no overview is drawn there in either build |

**Two things the measurement found that the ladder does not fix.** Past the
hand-over the overview leaves with the shell and the globe draws no roads at
all — the standing note about `NE_MIN_Z` — so between the last rung and the
limb the chart is landform and labels; and at 53N that hand-over comes
sooner than the seat's own z5 frame (smaller tiles, the ring narrower than
the frame sooner), which is why a z19300 rung here photographs the globe.
And OSM's dual carriageways are two `motorway` ways twenty metres apart, so
at z13–z11 a motorway is two ribbons where a map would draw one; the cell's
trimmer is the place to collapse them, and it is not done here.

The values are a first setting, judged on these frames; the seat's report
against them is the verification.

## The far layers are on the sphere, and the paraboloid is gone

Asked from the seat: could the distinction between sphere and plane be
resolved — what would it take to always be on the sphere? The answer has a
short half and a long half, and the short half is that **the fine world already
is**: a 5km tangent patch differs from the sphere by 2m of sag at its edge and
a fifth of a millimetre of foreshortening, which is what every planet renderer
does, and this one rebases on a hop. What there was to resolve is that the far
layers were placed on a PARABOLOID in the rig's equirectangular frame, and the
globe was a second, separate sphere they were asked to agree with. Three
approximations of one surface: `curveDrop` (d²/2R, baked from the origin into
every far vertex), `chartShellMatrix` (the chart's shear of that paraboloid
under the browsed focus) and `alignFarShell` (the seat's first-order tilt by
|c|/R, which the old note records as 70m low thirty kilometres down the road).

How far apart they get, measured before anything moved: the paraboloid is
3km off the sphere at 1,500km (which is why `SIGHT_MAX` stopped there), 44km
at 3,000, 461km at 5,000 and half a radius at a quarter turn — it has no limb,
no horizon and no far side, and those are the planet. And `toLocal` draws
every parallel at the RIG's, so with the truck at 37.75N Europe came out 1.23×
too wide at 50N, 1.58× at 60N, 2.31× at 70N.

**Now there is one node, `planetGroup`, and everything past the fine ring is
a child of it**: the globe mesh, its pin, the far shell, the overview vectors.
`stepGlobe` places it every frame in every camera — one radius under the
chart's FOCUS on the chart, under the POV from the seat, turned so that point
is its top (`globeOrientation`). The far tiles and the ribbons are built in
the planet's own frame, `latLonToUnit` times R + elev − baseElev − FAR_DROP,
**relative to each tile's centre point** (`sphereRTC`): Float32 holds three
centimetres across a 990km tile and half a millimetre across a 5km one, the
mesh's position is the centre in a JS double, and three composes matrixWorld
and modelViewMatrix in doubles before anything is uploaded, so nothing at a
planet's magnitude ever meets a Float32. The globe MESH keeps its own
visibility rule and carries its own sink beneath the frame, so the shell still
wins where both exist — **along the focus's own radial, set every frame.** The
first cut wrote it as `position.y = -GLOBE_SINK` on the mesh, and the mesh's
position is in the PLANET'S frame, whose y is the pole axis: that sank the
globe toward the south pole, 584m down at Romoos and 400m UP at Letsemeng,
where every lattice vertex of the sphere then stood through the Karoo shell
as a small diamond every 2.25 degrees. A sink that is right in one hemisphere
and wrong in the other is exactly the kind of thing the 47N frame could never
have caught; the Letsemeng day frame at zoom 11,000 did, and the same frame
on the build that sinks along the radial has none — the shell corner to
corner over the Karoo with nothing standing through it.

**Measured** (`__far().sphere`, 25 z7 tiles at Letsemeng, 4,300 sampled
vertices): every vertex within **6mm** of R + height over the datum, the
lat/lon round trip included. `devtools/globe-navigation.test.cjs` holds the
contract in pure node — `sphereRTC` inverts through `sphereLatLon` at five
centres from the equator to 84N, and the planet is placed under the focus on
the chart and under the POV from the seat, up landing on +y to 1e-9 — and the
map-rotation sweep beside it is intact. The 47N frame `far-circles` takes is
indistinguishable from the flat one, which is the point: the roads sit on
their coasts, the tiles have no seam, and what changed is that they now
stand where the Earth is.

Three things inside it that were real work, and two that were not:

- **The far material's normal map was written with +y up.** It is
  object-space — the kernel's x east, y up, z south — and three reads it
  straight through `normalMatrix`. Across a 990km z5 tile the radial swings
  8.9 degrees, so read as-is every tile is lit with a vignette, the sun's
  cosine drifting ±4.5 degrees edge to edge. `sphereNormal` rebuilds each
  fragment's own east/up/north from its position (east from the radial's own
  x/z, north as up × east — which the mirrored frame in `globe.ts` makes a
  rotation) and reads the map in that. **Under its own program cache key**:
  `farClip` set one shared with the fallback `farMat`, whose map is
  tangent-space and has no `vObjP`, and three would have handed one the
  other's program.
- **The overview ribbon's push is a vec3 now.** The ribbon is a centreline
  with `aOff` pushing it apart in the vertex shader; in the flat frame that
  was a vec2 in xz. It is a vector in the tile's tangent plane, written in the
  tile centre's east/north — at z7 the frame turns 2.8 degrees edge to edge,
  and what it turns is a two-pixel ribbon's width.
- **A place label's point is kept in the planet's frame** and composed
  through the planet's position and quaternion at draw time, not read off a
  `matrixWorld` that is a render old. The three probes that read a ribbon
  vertex as a flat point (`__ovfloat`, `__ovinside`) go back through
  `sphereLatLon`; `coverDirtiedFar` tests overlap on the raster's own flat
  box, kept beside the mesh, rather than on bounds that are on the sphere now.
- **`curveDrop` stays for the peaks' sight lines**, where d²/2R is the right
  second-order answer to "how far below the tangent plane is that summit" and
  is 0.03% off at 300km. Only its PLACEMENT uses are gone.
- **Every raster reader is untouched.** `farRasters`, `farRasterAt`,
  `chartGround`, `__farat` and the peak march index the RASTERS by flat metres;
  the raster is still a lat/lon grid and only the MESH moved. The streamers are
  keyed on `panX/panZ`; the retained-focus gestures are as they were; the fine
  box clip is an x/z test within 5km of the rig, where the sphere's
  foreshortening is 0.2mm.

**What is deliberately NOT done, and why.** Reparenting the fine world under
the planet as a tangent patch (identity whenever the chart is home) would put
the fine ring on the sphere's side while you browse elsewhere. Its visual
value is nil — the chart is at 89.9° of tilt, a vertical offset has no
parallax straight down, and the fine ring is a 5km speck three hundred
kilometres from the frame's centre — and its cost is every shader that reads
`vWorldP` in flat metres (the cloud lattice, `sunMarch`, the wet debug, hydro's
scene shade). Physics on the sphere is a rewrite of a 42,000-line coordinate
assumption for two metres of sag the rebase already handles.

**What is still true after this.** Mercator tiles stop at ±85°, so the shell
never draws the poles and the globe does. The ring is a finite cost and the
globe backs it; that distinction — streamed versus baked — is level of
detail, the fine/far distinction one rung further out, and it is right that
it stays. The hand-over (`globeFree`) survives as a LOOK rule, not a geometry
rule: the shell's Lambert-over-DEM and the globe's bake differ in character,
so the ring's edge is still a visible boundary — and because both are one
surface now, a Bayer dissolve over the outer ring is possible for the first
time. `devtools/globe-view.mjs` waits for the ring before it photographs a
zoom, because a frame of one tile standing on the planet with its neighbours
missing is exactly what a broken placement would look like.

## Globe navigation: retain the place, not a disposable spin

The seat reported that spinning the planet then zooming in returned to the
truck, and that wide drags made the camera lurch. The earlier gesture notes
above describe the old contract, not the current one: **zooming in is NOT a
request to return to the rig**. Globe drags now update the chart's geographic
focus through panX/panZ. The rig and its fine-world streamer are untouched;
the existing far/overview streamer follows the retained chart focus. Explicitly
leaving the chart still returns to the rig. Spin probe offsets are consumed
into the focus on the next visible globe frame rather than decayed away.

The camera used to lerp its position while aiming immediately at the new pan
target. That changes its angle throughout a drag. TOP now sets position and
aim together; zoom has one frame-independent logarithmic spring, with direct
response during a two-finger pinch. Zoom is advanced before globe/shell
ownership, removing their one-frame disagreement. Tilt uses altitude rather
than art-pixel resolution, with a smoothstep into a truly vertical globe view.
The hand-over uses the final shell's capacity, not a changing in-flight LOD.
The invisible steering zone only accepts a near-rig, close-zoom first finger.

Both far terrain and overview geometry now share an exact paraboloid shear
centred under the browsed focus. The old rotation was a small-angle correction
under the truck and could put distant browsed ground millions of metres below
the chart. Remote chart height comes from the retained coarse raster. This is
still **coarse remote browsing**, not a second fine-world simulation: street
meshes remain around the rig, and the inherited origin-scaled equirectangular
projection still distorts widths at latitudes far from the origin. A future
full independent chart projection should address that separately, not move
the truck as a side effect of looking somewhere else.

Pinches include midpoint translation and a zoom-ratio anchor; globe drags use
sphere intersections with bounded limb fallback. Longitude wraps and latitude
is bounded to the map's +/-85 degrees. Large remote pans no longer spring
back just because the rig or drone is moving.

Checked with devtools/globe-navigation.test.cjs against the actual main.ts
function bodies: retained 40N/140E through zoom 110000 to 1, stationary rig,
dateline and polar clamps, rotated drags, hand-over independent of pixel/LOD,
shared shell/road matrices, 30/60/120fps zoom agreement, and repeated pinches
through the hand-over (return error 0.0252 degrees longitude at regional scale).
Run with node devtools/globe-navigation.test.cjs; uses installed esbuild/three.
Main syntax and the helper's types checked. This environment cannot create a
WebGL context, so these are geometry/input regression checks, not a claim of
on-device visual or touch-feel verification.

## A devtools panel for the phone

Every fault this file records from the seat was found on a device with no
console — which is why the telemetry paste, the probe-module route in
`index.ts` and the status lines in SETTINGS exist. `?eruda=1`, or SETTINGS →
STORAGE → DEV CONSOLE, loads the eruda console onto the page: console,
network, elements, storage and resources in a panel, for READING what the
game did on that phone. Loaded only when asked, never at boot (half a
megabyte nobody driving should pay for), from a pinned jsdelivr build by a
script tag; `__eruda()` reports `state` (off / loading / on / failed).

- **The CSP carries the host, and the harness cannot see it.** `script-src`
  in `index.ts` gained `https://cdn.jsdelivr.net`. The harness relays through
  curl and never sees a CSP, so a green harness run proves the LOADER and
  nothing about the header; the check is `curl -s -D - -o /dev/null <cell>/ |
  grep -i content-security` after the deploy (a HEAD request comes back
  without it — use GET), and then the button on a phone. A script the CSP
  refuses fires `error`, not `load`, exactly as a dead network does, so the
  status line names both.
- **Its prompt runs code ONLY on a load that asked for the console.** The
  first build loaded eruda under the locked policy and the seat reported it
  exactly: `Refused to evaluate a string as JavaScript because 'unsafe-eval'
  … is not an allowed source`. The page forbids eval for the reasons at
  `index.ts:1654`, and it still does — for every ordinary load. A load with
  `?eruda=1` is served with `CSP_EVAL` (the same policy plus `'unsafe-eval'`)
  and `cache-control: no-store`, so its prompt works; three things make that
  a boundary rather than a wish: the header is per REQUEST and the query
  reaches the handler; the service worker hands such a navigation to the
  network rather than the cached shell (a cached response keeps the headers
  it was stored with — the locked ones) and does not store it; and the edge
  never holds it. SETTINGS → STORAGE → RELOAD WITH CONSOLE is the button for
  it, and DEV CONSOLE on an ordinary page loads a read-only one and says so.
  `__eruda().evalOn` reports which kind of load this is.
  `devtools/eruda-csp.test.mjs` holds both halves under the browser's own
  enforcement: the harness serves the page with each policy in turn (the
  `csp:` option), `new Function` throws under `CSP` and runs under
  `CSP_EVAL`, and eruda itself loads under both.

## The switch table

Fifty-three query-string switches had grown up one at a time, each read where
it was needed with its own `new URLSearchParams(location.search).get(…)`.
Nothing listed them, so nothing could: ten appeared in no note, no test and no
devtool — alive, shipped and forgotten. **A switch nobody remembers is worse
than no switch, because the legacy branch it guards is kept alive by a flag
that will never be turned on again.**

`client/switches.ts` is the table, and the reader is TYPED: `qs` takes a
`SwitchId` derived from the table, so a switch cannot be read without being
declared. SETTINGS renders the table itself (`switchRows`), so the list on the
glass cannot drift from the list in the code, and `devtools/switches.test.mjs`
closes the other direction — a switch declared and no longer read fails.

- **BUILDING THE TABLE FOUND TWO MORE.** `?reelidle` and `?reeldwell` are read
  through a variable rather than a literal, so the survey's own grep for
  `.get('…')` never saw them. Fifty-one became fifty-three by writing them
  down, which is the argument for writing them down.
- **`URL_OWNED` IS DERIVED FROM IT NOW.** That set — the keys the drive
  rewrites as the truck moves — was itself added after a bug where rebuilding
  the query from scratch deleted every art-direction and instrumentation flag
  about a second after boot (found while measuring species mixes with a world
  pinned to ARID that reported temperate ten seconds later). It was a second
  hand-maintained list of the same thing; now it is the `owned` rows.
- **SEVENTEEN ARE MARKED `legacy`** — the non-default value keeps a superseded
  implementation alive, so each one is a retirement candidate and the question
  "what can we retire" is a filter rather than an archaeology expedition:
  `ez ezstand guild refine tworker sward lumasync hydroskip vegseed relief
  shfade shsnap shrub treewind ezbark ezedge imu`.
  **Not all of them are retirable, and the mark does not claim they are.**
  `refine=0` and `guild=0` both restore paths that are still LIVE for another
  reason — the plain lattice is what builds past `REFINE_R`, and the climate
  path is what runs wherever `guildAt` returns null (the sea, a fixture, a tile
  in flight). Retiring one of these means proving the other branch is
  unreachable, not just unfashionable.

## Stationary rig shadow: diagnose rotation, not only translation

A parked vehicle's daylight shadow can crawl even with SHADOW_SNAP enabled.
stepSun recomputes the solar direction every frame (CYCLE is 24x); snapping
uses a basis which rotates with that direction. Translation snapping does
not stabilise that rotation. The previous shadowPhase probe tests its own
snapped centre, so it can report zero while stationary geometry changes
fractional texel alignment. BasicShadowMap then exposes changing hard coverage.

A CPU test of the actual solarAngles/snapShadowCentre functions at Yosemite,
2026-09-09 15:00 UTC, held the point and receiver centre fixed for 60 seconds.
At 60fps/CYCLE, maximum fractional grid movement per frame was 0.0040 texels
at x=z=0 and 0.4030 at x=z=10000m (height 100m, MED 220m/1024 grid).
Both frozen-sun runs measured zero. Snap residual remained below 1.5e-11.
Whole-texel changes were removed before measuring: an integer translation is
not evidence of shimmer. This reproduces a mechanism, not a GPU screenshot
or proof that all user-observed movement has that cause. Headlight shadows,
rig suspension settling and streaming ground changes remain separate cases.
No shadow rendering, sun clock, filtering or vehicle physics changed here.

Telemetry now samples the actual rendered sun shadow matrix at >=100ms
intervals while both adjacent samples have speed below 0.05m/s. It reports
fractional grid movement, solar angular movement and actual rig root pose
movement separately. Long gaps >=1s and inactive sun casting reset the pair.
__shadowmotion(true) returns the measurements and resets the observation.
The report includes clock mode, active caster, map resolution, span and snap.

Visibility changes reset profiler interval attribution, and hidden ticks/tasks
are excluded from the additive ledger; hidden duration/resumes are separate.
Bitmap lifecycle metrics measure overlapping async elapsed time (NOT CPU/GPU
work). Terrain/cover bitmap consumers now close temporary bitmaps in finally,
on success and consumer failure. Pending/peak/completed/failed/closed are
reported, making decode pressure visible without adding async waits to CPU.

Checks: devtools/telemetry-check.cjs tests background/resume accounting and
bitmap cleanup/failure balance; devtools/shadow-diagnosis.cjs reproduces the
fixed-point experiment using main.ts functions. Both take an optional main.ts
path. Syntax and helper types checked. No on-device/WebGL validation here.

## Shadow grid transport: the stationary-crawl fix

The seat confirmed the shadow wiggles during a time transition but settles
at fixed time. snapShadowCentre now quantises the requested centre's delta
relative to the PREVIOUS snapped centre, rather than projecting absolute
world coordinates into a rotating light basis. That transports the lattice
along the drive. With fixed light, lateral moves remain exact whole texels;
with moving light, rotation is local instead of amplified by distance from
world zero. The light-axis component follows freely. The sun direction and
clock remain continuous; no angle quantisation, shadow freeze, filtering,
resolution increase, additional render pass or physics change.

shadowPhase now measures the local step residual, not a global-origin
residual. The independently sampled rendered-matrix phase in __shadowmotion
remains the check for unwanted movement. SHADOW_SNAP's existing bypass still
works. Teleports, map resolution changes and a zenith basis stay finite.

Verification: devtools/shadow-stability.test.cjs executes the actual main.ts
solver/snap functions and three's LightShadow matrices. On the same 60-second
Yosemite/CYCLE test, max fractional texel movement per frame is 0.00039289
both at the spawn and 10km/1000km away, down from 0.4030 at 10km. Fixed sun
and parked rig remain exactly stable. Fixed-sun driving, including variable
height, preserves integer lateral steps at LOW/MED/HIGH. A four-hour sun
change eased over four seconds has identical grid movement near/far (0.09792
texels/frame); the real shadow may still move as illumination changes.
Telemetry regression tests and main syntax checks also pass. These are
geometry/matrix tests, not on-device GPU visual validation.

## Big shapes worth knowing

- **`client/main.ts` is ~36k lines** and holds the world's module state. Do not
  refactor it casually, especially while another agent is editing the cell.
  Extraction is right when the code is **pure** (flora, grain, facade,
  graffiti, culture, climate); it is wrong for anything wired into module state
  (`ribbon()` is ~1,800 lines and stays put).
- **Culture seeds** (`culture.ts`) are a hierarchy keyed on lat/lon, so they
  survive a world rebase: region 96km / district 6km / settlement 320m /
  stand 32m, as jittered Voronoi cells.
- **Buildings batch per tile**, so anything per-building must travel as a
  vertex attribute (`aBase`, `aMark`).
- **`__census()`** reports meshes by name — so name your meshes, or they arrive
  as `unnamed` and no audit can be written as an assertion.
- **Probes** are `window.__*` functions; `__hydro`, `__census`, `__fixworld`,
  `__demsrc`, `__built`, `__site` and dozens more. Add one when a question took
  more than one round to answer.
- **Dial records** live in `localStorage` under `drive.dials` with a `v` stamp.
  `saveDials` persists the WHOLE rack on any change, so a stored `0` does not
  mean anyone chose it — changing a default needs a version bump and a
  migration in `loadDials`, exactly like the TIME remap (v2), the PALETTE shift
  (v3) and the WATER default (v4).

---

## House style

- Comments explain **why**, in prose, often at length, and frequently record
  the failure that motivated the code. Match that density; it is the point.
- British spelling in prose and identifiers (`colour`, `metre`).
- Never put a model identifier in a commit message, code comment, or anything
  else pushed to the repository.
- Report outcomes faithfully. If a test fails, say so with the output; if a
  check was skipped or interrupted, say that rather than implying green.
