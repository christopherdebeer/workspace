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
  mark covers — it reads 0 now) and `gap (gpu/vsync/gc)` (time the main
  thread never ran: the GPU's wait, vsync, GC). Off-tick tasks are wrapped
  too (terrainApply, hydroRefeed, tileDecode, coverDecode, osmParse) and
  counted against the frame that paid for them. The "main thread" line is
  the CPU-or-GPU verdict: a gap that dwarfs the tick is the GPU or vsync.
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

## The labs

`/lab` lists them; each is `/lab/<slug>`, registered in `client/labs.ts`.

| slug | what it isolates |
|---|---|
| `hydro` | water fields, coastlines, river profiles |
| `marks` | the production façade shader and its graffiti |
| `roads` | the bench-search profile solver, as a section |
| `flora` | the climate ladder **and** a real stand of the shipping plants |
| `weather` | the 48×48 weather lattice, with time on a dial |
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
  no vertices or draw calls. The next high-leverage bake is more
  recipe × seed silhouettes selected coherently per stand (rather than random
  species confetti), with runtime generation still kept out of the game.
  Change a recipe → re-bake (`npm i --no-save @dgreenheck/ez-tree@1.1.0`,
  run the devtool); the bake prints the drawn triangles per variant.

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

**Not yet wired into the world.** `SiteEnv` needs a `coastAt` — nearest
coastline in metres — and the game has coastline vectors but no distance
sampler. That is the next increment, and until it exists nothing in the game
calls `siteAt`.

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
