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

Other harness facts learned the hard way:

- Synthetic double-taps must dispatch **both** PointerEvents inside ONE
  `page.evaluate` — two separate calls exceed the 450ms window.
- `navigator.clipboard.readText()` **hangs** without permission in headless
  rather than failing. The dials panel mirrors COPY output to
  `root.dataset.lastCopy` for exactly this reason. A test that read the
  clipboard once stalled for ten minutes.
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

`devtools/through-node.test.mjs` holds the bars at the pre-fix numbers.

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
