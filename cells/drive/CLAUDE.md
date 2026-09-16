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
> **AND A NEEDLE WITH A NON-ASCII CHARACTER IN IT READS 0.** The deploy
> transpile emits ASCII, so a middle dot in a string literal — which every
> telemetry row in this game is built from — arrives as `\xB7` and a grep for
> the UTF-8 character finds nothing at all. Measured on the redrape
> instrument's own check: `calls · walk ` 0, ` normals ` 5, `redrapeProf` 3, in
> a bundle that plainly carries the row. That is a false negative shaped
> exactly like a symbol that did not ship, and it is the second reason the
> PARSE is the gate and the grep is a secondary.
>
> **AND `app.js` IS EDGE-CACHED FOR SIXTY SECONDS, so the verification fetch
> straight after a deploy can read the BUILD BEFORE IT.** Measured: a fetch
> immediately after `✓ deployed` came back with `x-cache: Hit from cloudfront`
> and no trace of a symbol that was plainly in the local source and in the
> bundle a minute later. That reads exactly like a deploy that did not take.
> Add a cache-buster (`?cb=$RANDOM`) or read `x-cache` in the headers before
> believing a zero — a needle that is absent from a CACHED bundle is a
> measurement of the cache.
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

> **THE DEPLOYER IS 1024 MB NOW, AND IT NEEDS 714 — WHICH WAS 687 THIS
> MORNING.** Measured 2026-09-15, twice, by tailing `platform.logs {service:
> "cells"}` THROUGH a push rather than after it, which is the only way to catch
> the line — the tail is a short live window, not a searchable history, so a
> deploy's own REPORT is gone within the minute:
>
> ```
> 10:39:02  cell deployed  version 1789468740806  files 191  static 22
> 10:39:02  REPORT  Duration: 28332.01 ms  Memory Size: 1024 MB  Max Memory Used: 687 MB
> 16:41:04  cell deployed  version 1789490463265  files 196  static 22
> 16:41:04  REPORT  Duration: 32720.97 ms  Memory Size: 1024 MB  Max Memory Used: 714 MB
> 18:06:03  cell deployed  version 1789495562377  files 196  static 22
> 18:06:03  REPORT  Duration: 30987.79 ms  Memory Size: 1024 MB  Max Memory Used: 705 MB
> ```
>
> **About 700 MB of the 1024 MB ceiling and half a minute of the 120 s
> timeout** — seven tenths of the memory, a quarter of the clock. Everything
> below was written against a 512 MB function, and at 512 this cell's deploy
> would now fail EVERY time rather than intermittently: 700 is not a near miss.
>
> **AND THERE IS NO SLOPE — THE THIRD MEASUREMENT SAYS SO, AND THE SECOND ONE
> RAISED A FALSE ALARM.** Reading 687 then 714 the same day, this note said
> "+27 MB and five files over ONE DAY of ordinary work" and called it a number
> to watch. The next deploy added no files at all and came back at **705, nine
> megabytes DOWN.** So the spread is run-to-run variance of at least that much
> and the three points are 687 / 714 / 705 with no direction in them. The
> original note said out loud that two points are not a trend; it then reasoned
> from them anyway. **A difference smaller than the variance is not a
> measurement, and the only way to know the variance is to repeat the
> reading** — which costs a deploy here, so the honest habit is to take the
> REPORT every time and compare against a RANGE rather than the last one.
>
> The per-file writes during a push sit at 249 MB and 85–420 ms each, so the
> 714 is the BUNDLE step alone — one request (`26b1a0e0` on the first
> measurement, `900dd031` on the second) that reads every file, transpiles
> `client/main.ts` and zips `static/`.
>
> **CATCHING IT NEEDS THE TAIL TAKEN AT THE RIGHT MOMENT, AND THE MOMENT IS
> AFTER.** The bundle request STARTs when the deploy is requested and its
> REPORT is written ~33 s later, so a read taken while the push is still
> writing files — or in the first half minute of the deploy — shows the START
> and no REPORT, which is what happened here on the first attempt. Watch the
> log for `deploying` to know the request went in, then read once the `✓
> deployed` line lands: the REPORT is the last thing before cell-sync's own
> polling.

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
  `Status: timeout` beside a `Max Memory Used` at the ceiling. **Tail it
  DURING the push**: the window is seconds long, so a tail taken after the
  deploy has finished shows only your own polling and can say nothing about
  what the deploy used — which is how the 687 MB above went unmeasured for
  as long as it did.
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

**AND A PULL RESURRECTS `devtools/` THAT A PUSH WILL NEVER CORRECT.** `cell-sync`'s
`SKIP` set is `node_modules`, `devtools`, `native` — and it is applied to the
PUSH's directory walk only. The cell still holds whatever was in `devtools/`
before that rule existed, so every pull writes those stale copies over the
working tree and the next push does not fix them: measured twice in one
session, `devtools/globe-navigation.test.cjs` came back pre-sphere-pass and
`devtools/refine-flora.mjs` came back without the conifer habit/state fields,
both times, with a push in between. The remedy in the ritual is
`git checkout -- cells/drive/devtools/` after every pull; the remedy in the cell
is `cells.deleteFile` on those paths, which also takes dead weight out of a
deployer already running at seven tenths of its memory ceiling. **Not done here
— deleting files from a shared cell is not a thing to do unasked** — but it is
the fix, and until someone does it this reversion happens on every deploy cycle.

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
| `node devtools/switches.test.mjs` | the table cannot rot in either direction | instant |
| `node devtools/hud-bake.test.mjs` | whether a baked HUD element draws the pixels the per-frame one did — exact over nothing, within one rounding over a ground; no world, no WebGL, a canvas and two loops | ~5s |
| `node devtools/hud-split.mjs` | where `drawHud`'s milliseconds go, by its own section headers, in BOTH cameras (drawing ON — `nodraw` skips the HUD entirely) | ~12min |
| `node devtools/redrape-ga.mjs` | what a redrape's walk is made of: `groundAt` priced by calling it twice, split into its LOCATE and SOLVE halves, with the same-setting floor beside it (`FAST=0` is the rollback, `AUDIT=1` compares both samplers per vertex) | ~4min |
| `node devtools/tree-edge.mjs` | how far out a tree actually appears, by family, with the caps beside the edges — `?treedemand=0` is the old all-families divisor and the A/B (`FIX=`, `SECS=`) | ~4min |
| `node devtools/tree-spend.mjs` | where the tree triangle budget went: cap against placed, and what the allocator CHARGED against what the GPU was handed, per family — `?treeprice=0` charges the atlas mean again (`FIX=`, `SECS=`) | ~6min |
| `node client/perf-check.mjs` | the tree refresh still refills byte-for-byte what the pre-slice one did, over a deterministic mock world — a SANDBOXED check, so it breaks on a new free variable and says nothing until it is run: it was red for three commits and two deploys before anyone noticed | ~5s |
| `node devtools/tree-manifest.mjs` | KNOWN against DRAWN: whether a tree exists further out than it is built, with the placed counts and edges beside them as the live witness that nothing on screen moved — `?treemanifest=<m>` equal to the draw range is the single ring (`FIX=`, `SECS=`) | ~8min |
| `node devtools/tree-impostor.mjs` | what the impostor tier stands up and what it changes on screen — ONE boot, off/on/off through `__impostor()`, so the repeat is the floor; read whole AND over the canopy band, because a chase frame is mostly sward and sky (`TRIS=` raw triangles, `BAND=`) | ~6min |
| `node devtools/glsl-reserved.test.mjs` | no shader names a variable with a word GLSL ES 3.00 reserves — the harness DOES reproduce this (it is WebGL2), but only once a tool draws the material, and this costs no GL and no minute | instant |
| `node devtools/render-focus.test.mjs` | where the RENDERER is looking, and whether anything reads it — the authority's three cameras and the drone's own lead geometry driven for real, then each consumer and the sward's fast/slow ORDER as a source check; two controls in its header | instant |
| `node devtools/sward-profile.mjs` | the sward's radial density LAW against its carriers' CAPACITY at the same range: target, envelope, per-band keep, delivered, and COVERAGE — the number that decides whether a handover steps. One boot, nodraw, seconds (`ARGS='swardcap=0&swardsites=14'` is the rule as it shipped) | ~40s |
| `node devtools/roof-wind.test.mjs` | no roof piece is lit from inside | instant |
| `node devtools/railway.test.mjs` | the gauge, the formation, the draw filter and the ruling grade | instant |
| `node devtools/rail-grade.mjs` | a railway is cut and embanked, not draped (`GRADE=0` is the control) | ~4min |
| `node devtools/terrain-detail.mjs` | what an art pixel covers on the ground along the view, and whether the mottle's band limit fires (`TD=px` paints it, `AB=1` flips the ruler live with an interleaved noise floor) | ~6min |
| `node devtools/bedding.mjs` | the autocorrelation of the substrate's own contribution above its background, at a solved scale so two runs compare — READ THE LAG, not just the peak: the band holds the bedding comb AND the scree lobes and cannot tell them apart (`REV=` for a control, `ANALYSE=1` to re-read frames already on disk) | ~9min |
| `node devtools/bridge-water.mjs` | every tagged bridge at a crossing ran its chord (`2d-chord` in its own stage log) and stands over its water — the witness is the STAGE, the metre is the symptom (`FIX=`, `CROSSINGS=`) | ~1min |
| `node devtools/substrate-morph.test.mjs` | the geomorphic field says what it claims, on authored terrain: a face shows bedrock, nothing is shed above it, the apron is below and thins with distance, hollows hold water and soil, and the builder survives being shipped to the worker as text | ~10s |
| `node devtools/substrate-views.mjs` | each channel of that field photographed over real ground, with the same-frame-twice floor and the share of the pane each view moves — a channel that paints a flat wash is the failure worth catching (`FIX=`, `CAM=`, `Z=`, `CH=`) | ~6min |
| `node devtools/chart-bands.mjs` | which layer owns each band of the chart — a hide-diff of the fine world, the coarse shell and the globe over one settled frame, with the same-frame-twice floor beside it, the far/fine seam in luma, and the planet-sun ramp (`SPOT=`, `Z=`, `CLIP=0`) | ~8min |
| `node devtools/bridge-landmarks.mjs` | who CLAIMED each bridge assembly — an entry's id, OSM's own `bridge:structure`, or the recipe — beside what the painter actually built; fails on a spec that names a form and paints nothing, and on a long span nobody claimed (`FIX=`, `LONG_M=`) | ~2min |
| `node devtools/hydro-phases.mjs` | where a hydro build's milliseconds go, by phase and by ns/texel, with the wet/waterless build split, the wet share of the grid, and what a bound on the full-grid passes would leave to run — READ `BOUND=0` FOR THE MILLISECONDS, since the sizing probe is the same order of work as the passes it sizes and lands in `other` (`DRY=0` is the short-circuit's control, `FIX=`/`SPOT=` the place) | ~1min |
| `node devtools/hydro-dry.test.mjs` | a waterless tile's short-circuit is the path it replaced, byte for byte, against the revision's own build-tile (`REV=`) | ~10s |
| `node devtools/substrate-field.test.mjs` | the substrate's shader half and CPU half agree: every constant reaches the GLSL, the kernel's inlined material table matches the source of record, and the domain has the statistics the weights read | instant |
| `node devtools/sward-sub.mjs` | whether the sward's density and the flora's habitat follow the geomorphic field, as the correlation and the habitat counts, with `swardsub=0` as the control (`FIX=` a fixture or `SPOT=` a live place; CPU numbers rather than pixels — see the note) | ~3min |
| `node devtools/ground-view.mjs` | a ground view is a uniform, not a sheet: the chip sets the channel in every camera, the legend is tallied off the attribute the fragment reads, and the chase frame moves (`FIX=` for an offline world) | ~6min |
| `node devtools/sward-edges.mjs` | whether the sward's hard rectilinear edges are the cover raster's — the density field's own gradient DIRECTIONS as \|cos 2θ\|, which is 1 on an axis and 0 on a diagonal, with `__swardev(0\|1)` re-sweeping the field on ONE settled world (`SPOT=`, `FIX=`, `SHOTS=0` for numbers only) | ~6min |
| `node devtools/sward-cover.test.mjs` | the same claim in pure node: a transect across an authored grass/bare boundary, its transition width and level count, and that the edge wanders along its own length rather than being a blurred straight line | instant |
| `node devtools/band-d.mjs` | the half-metre: whether the material draws it better than the cover class did, measured at the top camera's MINIMUM zoom where the whole pane is inside the band (a chase seat sees the ground at a grazing angle and the band is a strip a few metres deep at the bottom of it) — plus the sward's per-blade half and the generic cascade octave by octave against the substrate (`PHASE=band\|sward\|cascade`, one a process; `SPOT=`) | ~9min a phase |
| `node devtools/normal-ab.mjs` | whether the DEM normal map is a residual on the mesh or a replacement of it: the MATERIAL count at both ends of the dial — the claim a pixel diff cannot witness — then the residual's own strength interleaved on one settled world (`SPOT=`, `FIX=`, `CAMS=`) | ~9min |
| `node devtools/substrate-ab.mjs` | whether the substrate draws a landscape or more noise: the field and the three layer shares at six points, an interleaved one-boot A/B cropped to the near field, and the domain and amount dials swept (`TD=dom` paints the shares, `SPOT=` for a cliff) | ~9min |
| `node devtools/settings-switches.test.mjs` | the switches are on the glass and a tap stages one | ~1min |
| `node devtools/menu-survey.mjs` | every menu screen photographed, SETTINGS scrolled through | ~2min |
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

**`substrate-structure-render.test.mjs`'s causeway check is a RACE, on both
sides.** "the causeway terrain retains solid fill to the authored road" reads
`meshSurfaceAt` at the crossing through `__substrate().crossingEarthworks`, at
a fixed settle, and that sample can land inside a rebuild: measured 2 of 3
failures on the pre-substrate-migration control as well as on the tree that
followed it. **One control run is not an attribution** — the first control run
here passed and the failure was written up as a regression before the other
two came back. What the underlying quantity actually does, traced at the point
every 500 ms for 40 s: 7 transient nulls after the migration against the
control's 10, first at ~5 s, last at ~18 s, **and none at all once `dirty`
reaches 0** in either. `__tileholes()` reads 0 throughout, so no tile is
missing its mesh — it is the cell-triangle lookup answering null mid-swap. The
honest fix is a settle gate on that assertion rather than a fixed wait; until
then, read it against three runs of a control, not one.

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
- **THE HARNESS'S OWN CELL BUNDLE IS ESM, SO IT HAS NO `__dirname`.** Every
  route that reads a baked asset off disk (`~/cover/w1`, `~/osm/ov1`'s wide
  rungs) threw on its first call and answered 503 for as long as those routes
  have existed — see "…and the harness had never served the baked routes at
  all" below for the measurement and the fix. And `cellRoute` gunzips now: a
  route that answers `content-encoding: gzip` reached the page as bytes it
  could not parse.
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

All three come through the cell's `~/` routes now, where CloudFront reads S3
first and the Lambda banks what it computed. The DEM was the last one in: it
went straight to tiles.mapterhorn.com from every player's device until
2026-09-11, and it was 37% of the game's data bytes in a dense city and 94–96%
everywhere else. `~/dem/v1/` is a byte proxy, not a compute route (no Lambda
can decode lossless WebP without shipping a decoder), and its one piece of
cleverness is that an ABSENT tile is answered with a stored `text/plain`
sentinel naming the ancestor to climb to — a 404 cannot be banked, and most of
the planet is an absent tile. The publishers stay in the client as the
bad-deploy fallback, exactly as `proxyTile` keeps the Overpass mirrors.

TERRARIUM IS THE ENCODING, MAPTERHORN IS A PUBLISHER, and the route is named
for neither: `~/dem/v1/` promises terrarium bytes for a tile and the cell
decides who answered. The full reasoning is by `serveDem` in `index.ts`.

The climb floor was z6 on a guess and is 0 on a measurement: Mapterhorn
publishes every tile at z0 (one 512px tile, 239KB), z1 and z2. The old floor
meant `FAR_LEVELS`' widest level, z5, ran an EMPTY climb loop and took every
z5 shell tile from the corrupt legacy AWS mosaic without ever asking.

`API-AUDIT-2026-09-11.md` has all of it.

## AND THE LADDER STOPS FIVE RUNGS ABOVE THE DATA

Said in that same audit that the globe could not be live tiles. That was
wrong, and `LADDER-BELOW-Z5-2026-09-11.md` is the measurement that says so.
The short version, because it is the kind of thing that costs a session:

- **From the equator the shell never leaves z6.** `farLevelFor` is fed a
  radius capped at SIGHT_MAX (1,500km) and a z6 5x5 ring reaches 1,565km
  there, so **z5, the last rung of FAR_LEVELS, is unreachable at that
  latitude** and a 375x zoom-out moves nothing. The shell covers a 1,565km
  disc of a 12,742km planet — 12% of the face — and the rest is the bake.
  `devtools/ladder-audit.mjs` prints that table.
- **`globe-base.png` is 39 km A PIXEL.** It is downsampled from a 4096²
  mosaic, so the bake's INPUTS are not its output and comparing tiles against
  the inputs (which is what the audit did) overstates the cost by 4x.
  Mapterhorn z2 is 19.6 km/px: twice the bake's delivered resolution, 16 tiles.
- **Geometry is not the constraint.** The whole planet at z2, at the geometric
  budget `globeGeometry(160, 80)` already spends, is ~51k triangles and 16
  draws — cheaper than the 25-draw, 200k-triangle ring drawn today. What is
  wrong is that `farSeg` is metres-per-VERTEX, which is the right dial only
  while a tile is bigger than the screen.
- **Cover is the one real blocker, and it is 90KB.** `~/cover/v1/` range-reads
  3-degree COGs and a coarse tile lands on many — z5 on 20, z4 on 64, z2 on
  690 (`devtools/cover-reach.mjs`), which is why COVER_WIDE_LEVELS ends at 4.
  There is no global overview in the ESA bucket. So bake it, exactly as
  `ne-wide.ts` bakes the roads for exactly the same reason — measured at 0.044
  bytes a texel, the whole planet at z2 resolution is ~90KB.

The principle worth keeping out of all of it: **bake the INPUTS, not the
output.** A baked picture freezes the palette, the weather and the biome rules
into an image; a baked class raster is the cover layer arriving by a different
road, and `climCompute` carries on.

### …and it is all built now. Four things to know before touching it

- **The shell's reach is not the plane's.** `viewRadius` caps at SIGHT_MAX
  because the equirectangular tangent plane stops being honest there;
  `backdropRadius` is the same expression WITHOUT the cap, and it exists
  because the shell is built on the sphere and does not live in that plane.
  Feeding the capped radius to `farLevelFor` is what pinned the ladder at z6.
- **`shellOn` no longer hides the shell.** It used to carry
  `&& globeFree() === 0`, which switched twenty-five BUILT tiles off past the
  hand-over. `globeFree` still owns the GESTURE and is untouched; the two were
  tied so they could not drift, and they are untied because the thing that
  needed protecting — a spun globe under a static shell — cannot happen: a
  "spin" is `setChartFocus`, and `planetGroup` is placed from that one focus.
- **Finer sits higher, by level.** `farLift` is a radial offset derived from
  FAR_LEVELS' own span, so the ordering between levels is total and does not
  depend on which was retired. It replaced a sink applied to the outgoing ring,
  which is right for a curtain and backwards for a pyramid. The span is derived
  rather than fixed BECAUSE a fixed 1.5m a rung was 15m over ten rungs and
  would have lifted z13 through the fine world it hides under (FAR_DROP is 12).
- **The coarse rings wrap in x and clip in y.** `loadFarTile` takes raw
  indices; harmless at z9, not at z3, where a 12,500km ring asks for negative x
  past ~70 degrees from the prime meridian and 404s a silent quarter of the
  backdrop. There is no tile above the mercator cut at 85 degrees — that seam
  is the baked sphere's one remaining job, along with the first frame.

`node devtools/api-audit.mjs [--spot=] [--drive=] [--nodraw] [--json=]` is the
instrument: it boots the real bundle and reports every request by host, split
into what goes through the cache and what does not. A host it has not been told
about prints as UNCLASSIFIED, so a new upstream shows up as a line nobody
wrote. It cannot speak to REACHABILITY — the relay bypasses CSP, see the
harness notes above.

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
Also open: one bay grid for the planet (2.75m × 3.1m — `FACADE_GRAMMAR` in
`facade.ts` now, on uniforms and on the façade lab's dials, but still one set
for every building on earth), and no chimneys, parapets, cornices or balconies
anywhere.

**AND THE MARK TINS ARE STILL ABSOLUTE, which is the glass fault one surface
over.** A tin is mixed in at `fadeMin + fadeVar` of its own colour regardless of
the paint underneath, so on the oxide-red Camps Bay wall a tag reads as a bright
tan blob rather than as paint on a wall. `graffiti.test.mjs` asserts no tin is
bright enough to BLOOM and passes — that is an absolute test, and this is a
CONTRAST problem, so the suite cannot see it. The fix is the same shape as the
glass one: carry the tin toward the wall's own value rather than mixing a fixed
colour over it.

### Phase 0 of the building work: instruments before opinions

Asked from the seat: buildings are generic blocks with procedural repeating
windows — how do we get real local and cultural diversity? The answer agreed
was a HAND-AUTHORED tradition atlas keyed on geography (the way `LANDMARKS`
and `conventionFor` already are), intact stock before ruins, and, before any
of that, three instruments — because every earlier building change in this
file was judged off a frame that happened to be facing a wall, and the
review's own open items ("one bay grid for the planet", "no ground floor")
were claims nobody could put a number on.

**THE CENSUS: the footprints say what the tags cannot.** `client/morphology.ts`
is pure — rings in, rows and a summary out — and it runs in three places
that cannot disagree because there is one of it: `devtools/building-census.mjs`
over the nine `static/fixtures/world-*.json` captures, `__bldcensus(r?)` in
the world, and `devtools/morphology.test.mjs` on authored rings.

| capture | n | attached | runs · median · max | plot m² p25 / p50 / p75 / p95 | grid |
|---|---|---|---|---|---|
| paris-west | 3,794 | **74%** | 692 · 3 · **38** | 19 / 61 / 102 / 335 | 63% |
| paris-south | 1,302 | **73%** | 245 · 3 · 19 | 20 / 66 / 97 / 651 | 57% |
| campsbay | 627 | 7% | 21 · 2 · 3 | 153 / 216 / 284 / 483 | 38% |
| simonstown | 660 | 7% | 20 · 2 · 5 | 87 / 153 / 223 / 812 | 55% |
| carmel-a | 656 | 10% | 19 · 3 · 6 | 110 / 162 / 225 / 340 | 32% |
| carmel-b | 66 | 8% | 2 · 3 · 3 | 202 / 265 / 337 / 886 | 44% |

7,114 footprints: `building=yes` 75%, `house` 14.5%, `apartments` 4%;
`building:levels` 5.1%, `roof:shape` 1.7%, `height` 0.0%, material 0.3%,
colour 0.4%. A Haussmann perimeter block and a hillside of villas are
different PLACES in the rings alone — three quarters attached against a
tenth, 60 m² plots against 200, runs of thirty-eight against three — which
is what the atlas and the morphology phases will read. Three rules in the
module, each of which the first cut got wrong:

- **A footprint must not attach to itself.** Every closed ring in a capture
  repeats its first vertex last; keyed naively, every building in Camps Bay
  was "attached" and the suburb read 100% terraces.
- **Two shared vertices is a wall; one is a corner touch** that a mapper's
  snapping produces between buildings that never meet.
- **Within 0.2 m is a DISTANCE, not a cell.** The first rule keyed vertices
  by their 0.2 m cell, and the test's fifteen-centimetre gap fell either
  side of a boundary — 10.0 in cell 50, 10.15 in cell 51 — so a wall the
  rule meant to join read as an alley. The route solver's lesson ("match
  endpoints, do not quantise them") and the border's (`mmNear`), a third
  time: the hash finds candidates over the 3×3 of cells and the distance
  decides.

**AND THE IN-WORLD PROBE READS `bldRings`, NOT `plotGrid`.** `claimSolid`
files no plot for a ruin by design (a ruin is a place you may be, and the
plot exists to shove the truck out of a room), so a census over the plots
was a census of whichever 58% the ruin roll left standing: Camps Bay read
350 rings, 3.4% attached, six runs. `building()` now records every footprint
it sees by OSM id, and the probe reads 559 rings, **7.5% attached, 20 runs
of 2–3** — against the devtool's 627 / 7% / 21 on the same capture. The 68
missing are rings that never reach `building()` at all (not yet attributed;
the two numbers are close enough to say the probe measures the rule the
world runs).

**THE FAÇADE LAB (`/lab/facade`, `client/facade-lab.ts`)** is the marks lab
widened to the whole façade: one footprint extruded exactly as `polygon()`
does it, sunk by the same plinth, wearing the culture's own canvases, roofed
by `roofGeo`, at the building survey's 26 m stand-off with the eye at the
cab's 1.3 m. Forty-odd dials — the culture and its paints, width, depth,
storeys, the plinth, the roof and its ridge, a terrace count, every grammar
number, the sun, night with its lit share, the eye, and a PIXEL dial that
renders at a fraction of the glass and magnifies nearest — and COPY writes
`export const FACADE_GRAMMAR`. `__facade()` reports what the grammar makes of
the massing, which is how `lab.test.mjs` holds it. Three extractions made it
possible, each pure, each verbatim: `client/rng.ts` (one `mulberry32`, where
there were two and about to be three — a canvas seeded from a drifted copy
would be a different canvas in the lab and the game), `client/wall-tex.ts`
(`makeCanvasTex(aniso)` and `wallTextures()`, so the lab bakes the same
canvases under its own renderer's anisotropy), `client/roof.ts` (`roofGeo`).
And `FACADE_GRAMMAR` itself: the shader's sixteen literals on four vec4s,
defaults equal to the literals to the digit — no pixel changes; the numbers
moved house. A per-tradition grammar will arrive as a vertex attribute the
way `aMark` did, because buildings batch per tile and a uniform is per draw.

**WHAT THE LAB SHOWED BEFORE A DIAL WAS TURNED**, read off `__facade()` and
then seen in the frames:

- **EVERY GROUND FLOOR IS 1.4 m UNDERGROUND.** `polygon()` sinks an intact
  building by a plinth — `clamp(maxG − minG + 1.4, 1.4, 14)` — and `aBase`
  is the sunk bottom, so the shader's rows count from below the grass. On
  flat ground the ground row is 1.7 m tall, a door's head stands **0.46 m**
  above the pavement, and the first upper sill is at 2.75 m; on a slope the
  uphill wall has no ground row at all. Plinth 0 in the lab: row 3.10 m,
  door head 1.86, sill 4.15 — the façade the shader was written for. The
  control frames agree: the doors in Suresnes are dark stubs at the grass
  line, where the grass does not hide them entirely. The fix is one number
  in the batch (aBase as the ground line, not the plinth bottom) and it is
  NOT made here, because phase 0 is the instruments and the fix belongs with
  the grammar it will be judged against.
- **THE ROWS DO NOT FOLLOW THE STOREYS.** `BuildCulture.storeyM` sets a
  building's height (timber 2.7, adobe 3.3) and the shader's row is 3.1 for
  everyone, so a two-storey timber house is 5.4 m of wall carrying 1.74 rows
  of windows. ROWS = STOREYS on the lab ties them; the atlas will.
- **CAMPS BAY BUILDS IN BRICK UNDER SLATE.** `__culture` on that capture:
  `brick`, pitch 0.59, because the cultures are picked by CLIMATE weights and
  a temperate coast is temperate; Suresnes is `limewash`. The atlas is the
  answer and this is the frame to hold it to.

**THE CONTROL FRAMES** (`devtools/building-survey.mjs`, `REV=8e11b60`, the
six captures, in `/tmp/drive-tools/bldg-control/`): four buildings a capture,
high sun, low sun and a chase frame each, and the planform. **Six captures
in one process is fifty-five minutes and the harness fuse is twenty**
(`HARNESS_FUSE_MIN`): the first run was killed after Camps Bay's first
building with `exit 9` and the log's own FUSE BLOWN line, having finished
Paris west and south cleanly. One process per capture from then on. And a
lab suite started beside a survey drew the same random harness port
(8800–8889) once in ninety and died on `EADDRINUSE` before its first lab —
the log said so plainly; re-run, not a fault.

**Not done here, deliberately:** the plinth fix, the atlas (`traditionFor`),
party walls and runs from the morphology, roofs, ruins per material, the
landmarks, stations and covers — phases 1 to 6, in that order.

### Phase 1: the ground line, and the atlas

Two units, in the order the lab made them safe to do.

**THE FAÇADE'S BASE IS THE GROUND LINE.** `polygon()` hands the batch the
MEAN of the ground it sampled under the footprint as the building's `aBase`,
where it used to hand the sunk bottom of the box. The plinth is unchanged —
it still keeps daylight out from under the downhill wall — only the number
the shader measures its rows, its ivy and its marks band from moved. Ruins
take `minH` for the same reason (their foot is 0.6 m under it). Measured,
`__facade()` in the lab with the BASE = GROUND toggle as the only difference:

| | base at the plinth bottom | base at the ground line |
|---|---|---|
| ground row above the grass | 1.70 m | 3.10 m |
| door head above the pavement | 0.46 m | 1.86 m |
| first upper sill | 2.75 m | 4.15 m |

`lab.test.mjs` asserts both rows — the shipped rule and, with the toggle off,
the rule it replaced — so the A/B cannot rot into a test of one number. In
the game (`devtools/building-survey.mjs` on the working tree against the
`8e11b60` control, Suresnes, same four spots because the spots come from the
fixture): on the red-roofed house at b2 the upper windows moved from mid-wall
to under the eave and the ground row's openings appeared at the grass line
behind the hedge. On a slope the mean puts the ground row half a basement
into the uphill side, which is what a house on a hill does; a per-wall base
is the next refinement if a frame ever asks for it.

**THE TRADITION ATLAS** (`client/traditions.ts`, `traditionFor(lat, lon)`).
Twenty-three hand-authored entries — Paris inside the périphérique and its
suburbs, the Cape, Lesotho, the platteland, East Africa, the Sahel, North
Africa, the Mediterranean rim, the Alps, the Swiss plateau, the Low
Countries, Britain, Scandinavia, temperate Europe, coastal California, the
Sierra, the Southwest, the rest of the US, the Altiplano, Amazonia, the
Ganges delta, Australia — each a base culture, the paints, the wall and roof
canvases, the pitch and the storey that make the place, and an OPENING
GRAMMAR as overrides of `FACADE_DEFAULTS`. Each carries a note saying what it
is modelled on, because the palettes are judgements and the lab is where they
get argued with. Regions are lat/lon boxes, first match wins, specific
before broad; `devtools/traditions.test.mjs` names forty-two driven places
and the tradition each must answer, so a box that drifts fails a case that
says which town it lost. Three rules:

- **The atlas first, the climate second** — `buildLook` asks `traditionFor`
  and hands `buildLookAt` the tradition's culture as `forced`; everywhere the
  atlas is silent (Reykjavik, Irkutsk, the sea) the climate pick answers
  exactly as before. `BuildLook.tradition` and `__culture().tradition` say
  which happened.
- **An atlas pitch is stated, not steepened.** `snowLoad` steepens a
  climate-picked pitch by half at full load and vetoes pantiles under snow;
  for a forced culture only the district scatter applies, because the alpine
  entry already says what a chalet's roof does about snow, and a person
  authored it knowing whether it snows there.
- **The stone override stands down where the atlas states the stone.** A
  stone village is still built of the hill behind it (the bedrock palette),
  unless the entry carries its own `wall`.

**THE GRAMMAR IN FORCE WAS THE TRADITION UNDER THE TRUCK, for one commit.**
`FACADE_GRAMMAR` is a uniform — one grammar per draw, and the walls batch per
tile — so phase 1 read the truck's `buildLook` once a second and set the
uniforms to its tradition's grammar, and said so as an interim. Phase 3
below replaced it the same day with the per-building attribute; the
paragraph stays because the interim is the shape the next "one uniform for
the world" will want to take, and should not.

**Measured in the world** (`scratchpad/atlas-world.mjs`, the fixtures, nodraw,
no page errors): Camps Bay `cape` — render under corrugated, palette
`#f3f0e8 #cfd3cf #e9e5d9`, pitch 0.20, grammar bay 3.3 m / open 0.88 in
force; Suresnes `ile-de-france` — render under pantile, creams, pitch 0.48,
bay 3.0 m in force. Before: `brick` under slate and `limewash`. **The Camps Bay survey pair**
(`/tmp/drive-tools/bldg-control` against `bldg-fix`, same four spots): the
b1 block at low sun is a dark oxide-red brick wall with a scatter of small
windows on the control and a white rendered wall with the Cape's wide glass
in a regular grid on the working tree — the same building, the same frame,
and the first frame in this file where a building says where it is. The
lab's CULTURE dial lists every entry as `t:<key>`; choosing one sets the grammar
dials to what it states, once, and the dials are the record from then on.
Five traditions photographed on the same wall with no page errors
(`facade-trad.mjs`): the Haussmann block's floor-to-ceiling windows, the
Dutch terrace's tall sashes under its gables, the Altiplano's slits.

**What the atlas did not reach in phase 1, by design:** roof FORMS (Camps Bay
was `cape` with pitch 0.20 and still gabled 132 of its 351 intact buildings,
because `building()`'s flat gate was `pitch < 0.2` and the district scatter
straddled it), storeys per tradition, party walls and runs, and how each
material ruins. The first two arrived as phase 4 below; the `Tradition`
interface carries a field only once something consumes it.

**AND THE HARNESS RE-DRAWS A COLLIDING PORT.** Unless the caller pinned one,
`openDrive` picks a port in 8800–8889; two harness processes side by side
drew the same one and the lab suite died on `EADDRINUSE` before its first
lab. It retries another draw a dozen times now, so a survey and a suite can
run together.

### Phase 3: the grammar rides per building, as a row of a texture

`FACADE_GRAMMAR` is a uniform and buildings batch per tile, so a per-building
grammar cannot be a uniform and sixteen floats cannot ride on every vertex.
The route is the one the marks took for their tins, for the same GLSL ES 1.00
reason (no dynamically indexed uniform arrays in a fragment shader, and a
one-column lookup texture costs one sample): **one float attribute, `aGram`,
the building's tradition row plus one, and a 4×N RGBA8 texture of every
tradition's full grammar** — four texels a row under the scales in
`GRAM_FIELDS`, a bay stored as eighths of a metre, ivy as halves, the rest as
shares. `aGram` 0 is "the uniforms", which the game keeps at
`FACADE_DEFAULTS` and the lab drives; the shader picks per fragment
(`vGram > 0.5`). The tile batch packs `aGram` from `BldPiece.gram` beside
`aBase` and `aMark`; ruins carry their tradition's row too (a Paris shell has
Paris bays), rubble carries 0.

- **`client/facade-grammar.ts` is pure, and that is why it exists.** The
  interface, the frozen defaults and the byte encode/decode moved out of
  facade.ts (which needs THREE and a document) so the atlas can encode its
  rows and the node test can decode them back. facade.ts re-exports the
  names it always exported; nothing that imported them changed.
- **The bytes are held to half a step.** `traditions.test.mjs` decodes every
  row and asserts every field within 3 cm (bay, storey), 0.4% (a share) and
  1/255 (ivy) of the authored number. That is precision under a composite
  that quantises to fourteen levels, and it is the reason the two roads
  below agree.
- **The two roads agree, and the lab proves it on one wall.** VIA ATTRIBUTE
  in `/lab/facade` parks the uniforms at the defaults and hands the wall its
  tradition's row through `aGram`, exactly as a building in the world gets
  it; off, the dials drive the uniforms and `aGram` is 0. Photographed both
  ways for the Dutch terrace and the Haussmann block (`facade-roads.mjs`),
  the wall pane diffed with `imgdiff.mjs`: **mean 1.7–1.9/255, 4% of pixels
  moved by more than 3, the same frame against itself 0** — the moved pixels
  are the edges of windows whose bay rounded from 3.0 to 3.012 m, one pixel
  here and there, and nothing else. `lab.test.mjs` holds the report
  (`gramIndex`, `viaAttribute`, the uniforms parked) rather than the pixels.
- **`__tradition()` reports what a wall READS, not what was authored:** `row`
  (its aGram), `grammar` decoded from the bytes, `uniforms`, and `batches`
  with the set of rows seen across the building meshes. Camps Bay reads
  `rows: [0, 3]` — the rubble at 0, every wall on `cape`'s row — with the
  row's bay at 3.294 for an authored 3.3.
- **`TRADITION_LIST` order is a wire format.** Row i is entry i of the table
  in insertion order; an entry MOVED re-dresses every building on the next
  deploy. Append.

### Phase 4: the atlas states the storeys and the roof forms

Two more fields on a `Tradition`, both read by `building()`, both authored
for all twenty-three entries and held by `traditions.test.mjs`:

- **`storeys: [lo, hi]`** — the untyped dwelling's range. `massHeight` runs
  it on the stand norm (a terrace agrees with itself) and moves it half a
  storey on the building's own draw: Haussmann five to seven whatever the
  plan, the Cape one or two. Blocks keep their plan-and-density rule, and so
  does a big untyped footprint in a dense place (over 300 m² with
  `builtUpAt` past a half), because that is a block by another name — the
  atlas describes the dwelling, not the flats. Halls, sheds and canopies
  keep their typology.
- **`roofs: {form: weight}`** — a weighted draw (`roofFormFor`, the weights
  laid end to end) replaces the culture's `pitch < 0.2` gate. A flat draw is
  the cap for ANY kind — a shed in a flat-roofed town is flat too — and a
  pitched draw then meets the typologies: a lean-to is still what a shed
  wears, a barn is still a long gable, a true block is still capped, a small
  block takes the drawn form. The test draws ten thousand for the Cape and
  holds each form to its stated share within 0.2%.

**Measured**, the two fixtures, nodraw, no page errors, same code either side
but the two fields (`scratchpad/mass-world.mjs`; `__built().roofs` and the
3 m `hist`):

| | Camps Bay before | after | Suresnes before | after |
|---|---|---|---|---|
| gabled / hipped / skillion / flat | 131 / 69 / 10 / 141 | **57 / 96 / 25 / 173** | 907 / 178 / 530 / 566 | 574 / **367** / 463 / 777 |
| intact by height, 0–3 / 3–6 / 6–9 m | 12 / 118 / 124 | 12 / **173** / 138 | 557 / 1049 / 321 | 416 / 1083 / **564** |
| 9–12 / 12–15 / 15–18 m | 46 / 37 / 12 | **6 / 13 / 7** | 114 / 105 / 23 | **42 / 42** / 22 |

The Cape lost its four-storey suburban guesses (46 → 6 in the 9–12 m bucket)
and gables in favour of flat and hipped; Suresnes gained its third storeys
(321 → 564) and its hips, and the flat count rose by the 15% the entry states
for a dwelling. Both are what the entries say, and neither was measurable
before the survey and the probe existed.

### Phase 2: a terrace is one height, and one roof

The 32 m stand norm made neighbours agree; it could not make a RUN agree,
because a run of thirty-eight in Paris spans five stands and a stand boundary
falls through the middle of a terrace. `renderWays` now runs `morphology()`
— the census module, the same rule the probe and the devtool run — over each
batch's footprints before any building stands, and files every attached
footprint with its run's size and the run's seed (its lowest OSM id, the
same whichever order the batch builds in). `massHeight` takes the run's norm
for an attached building and the stand's for a detached one; the roof form
draw is the run's too, so a terrace wears one roof.

- **A member takes the run's storey outright, and is the odd one out on a
  twelve-percent draw.** The first cut kept a half-storey jitter on the
  shared norm, and whenever the norm landed near a half the run came out a
  coin toss between two storeys — measured as a 3.7 m mean spread against
  4.05 with no rule at all. `?bldruns=0` is the stand norm alone, declared
  in the switch table as the A/B.
- **`__runs()` reads the spread twice**: over every member, and over the
  dwelling-sized members alone (55 m² and up), because the shed on the end
  of a terrace is a shed and its height is right to differ.

**Measured** on Suresnes (`scratchpad/runs-world.mjs`, nodraw, no page
errors; 704 runs of two or more, the longest 38):

| | stand norm alone | the run rule |
|---|---|---|
| every member: mean spread / seated within 0.3 m | 4.07 m / 16% | 3.70 m / 21% |
| dwellings only: mean spread / seated | 2.51 m / 39% | **1.69 m / 63%** |

What is left is the data and the typologies: a level-tagged or surveyed
member, an `apartments` block in a run of houses (its plan-and-density
rule), a big untyped footprint in a dense place, and the sheds. **A run cut
by a tile edge is two runs**, one either side, and may seat two heights —
real, and the next thing to measure if a frame ever shows it.

### Phase 5: a ruin is the material it was built of

The ruin path stood every building on earth down the same way — half to 85%
of its height, one bay in eight gone, 55 to 67 cm walls, one grey
(`0x9a8f7c`) — and the review had it down as culture-blind. `RUIN_BY_MATERIAL`
(traditions.ts) keys a profile on the wall material the tradition, or the
climate-picked culture, built with: the standing share and its floor in
metres, the bay loss, the bay width, the thickness, how ragged the skyline
is, and how far the paint has gone to grey. The colour is the building's own
paint — the tradition's palette through `paintFor`, or the typology's oxide
for a barn — pulled that far toward the old grey, so a brick shell is red, a
limewash one grey, a stone one the hill's colour, a timber one a few silvered
stubs. The fallen slabs carry a third of the wall's paint.

- **THE FLOOR IS THE MATERIAL'S TOO, and the first cut forgot it.** A single
  2.4 m minimum standing height, right for masonry, put timber at a mean
  share of **0.60** against a stated 0.15–0.45: two storeys of 2.9 m is
  5.8 m, and 2.4 is already 0.41 of it. `floorM` per material (1.1 m for a
  burnt frame, 1.6 for earth, 2.4 for masonry) took Carmel's timber ruins to
  **0.34**. A profile with a clamp under it is the clamp.
- **`__built().ruinBy`** counts ruins by material with their mean standing
  share — Suresnes `render` 1,582 at 0.73, Carmel `timber` 163 at 0.34 — so
  a material whose ruins do not read as stated is a number before it is a
  frame. `RUIN_SKYLIT`, the skylight lift's stand-in for the mean vertex
  colour, is still one mid tone; a brick ruin's lift is a little cool and a
  limewash one a little warm for it, under one palette step.
- **What this is not:** a ruin still carries no map, because the batch draws
  every ruin in one material and a material per wall texture would be five
  more draws a tile for a texture that is sub-pixel past thirty metres. The
  material shows in the massing and the colour, which at 12 px/m is what
  can show.
- **Photographed** (`scratchpad/ruin-shots.mjs`: the three ruins nearest the
  origin, 18 m off, cab, the sun at 30°, control `6fe14dd` against the
  working tree, in `/tmp/drive-tools/ruins/`): at Carmel the control's
  warm-grey shell at chest height is a few low silvered stubs in the grass on
  the fix — which is the profile, and also the finding: **a burnt timber
  house reads as nothing from the seat once the sward is a metre tall.** The
  thing a burnt frame leaves standing in life is its chimney; one bay kept at
  the building's full height for the timber profile is the next cut, and it
  is not made here. At Suresnes the render shell keeps its height and takes
  the tradition's cream, a step warmer than the grey it was.

### The wall has depth, and the roof has courses

The phases above gave the buildings a place — a palette, a grammar, a roof
form, a storey count per tradition — and the critique from the seat was exact:
"I was expecting the shader to approach far greater realism, not just making
the limited palette and blocky texture diverse." True. Every wall was still a
flat quad with darker rectangles on it, and a roof was a plane wearing a
canvas mapped in world plan. What follows is the fidelity unit, judged in the
lab at the survey's stand-off and then in the two captures.

**THE OPENINGS ARE DRAWN AS THEIR SHADOWS.** What makes a wall read as a
building in a frame twelve pixels to the metre is not the colour of the glass
but that the glass is set BACK: the reveal's jamb throws the sun across the
top and the sun side of every pane, the sill projects and casts under itself,
the eave and the balcony slab lay a band down the wall, and all of it moves
with the sun. `uFacSun` is a world-space unit vector toward the sun (main.ts
copies `SUN_DIR` each frame; the lab its light), and in the fragment the
wall's own frame — `u` along the face, `nOut` outward (the geometric normal
flipped for a back face, so a soffit does not read the sun through the wall),
`sn`/`su`/`sy` the sun's components — makes every shadow one line: the
caster's depth times the tangential over the normal component. Sixteen more
grammar fields carry the articulation (`revealM sillM frame mullion glassSky
stringCourse cornice plinthM shutters balcony streaks dampM trim shutterCol
shopfront eaveM`), so the row is 32 bytes, the texture eight texels wide, and
uniforms E–H beside A–D; the trim and shutter paints are indices into eight
colours in the shader (`trimCol`), because GLSL ES 1.00 cannot index an array
by a float. The wall top rides in as `aTop` beside `aBase` for the cornice and
the eave; every piece the batch packs carries it.

- **THE SHADOW WENT ON THE VOID FIRST, AND VANISHED.** The first cut shadowed
  the glass as it was — a fifth of the wall — and a 55% darkening of a thing
  already dark was under the quantiser at every stand-off: the low-sun lab
  frame was pixel-identical to the high-sun one. A real window shows the
  band because the pane REFLECTS THE SKY, and the jamb's shadow takes the
  sky away. So the glass is two things now: the void (a fraction of the wall,
  the curtain in a share of them) and the sky in the pane (absolute, because
  it is the sky's brightness, stronger toward the head), and the reveal
  shadows the second. A share of the reflection goes to EMISSIVE: on a face
  turned from the sun the glass is the lightest thing on it, and a reflection
  is not diffuse — the same lesson as the lit windows at night, one
  surface earlier. `glassSky` per tradition is the lever.
- **`cast` IS A RESERVED WORD IN GLSL ES 1.00.** Every lab frame of the first
  run came back with `'cast' : Illegal use of reserved word` and
  `useProgram: program not valid` in `d.errors` — the wall drew as flat
  Lambert and looked plausible. Read the errors before the frames.
- **What is on the wall now, per fragment and per tradition:** the reveal's
  cast and ambient, the painted frame with a mullion on a wide window and a
  transom on a tall one, the sill and its shadow, shutters open (a leaf each
  side, slatted) and a fifth of them closed, the balcony (rail, lit slab
  edge, slab shadow, the door behind), the shopfront under its fascia, the
  door in the shutter paint with a fanlight and a threshold, the string
  course, the plinth's dado with a lit top, the cornice band, the eave's
  shadow, rain streaks from the sill corners, the damp band from the ground,
  and a downpipe on a share of the bay lines. The old staining is at three
  fifths, a texture over the weather rather than the weather.

**THE ROOF IS COURSES, AND THE COURSES RUN WITH THE SLOPE** (`client/roof-fx.ts`,
`roofFx(mat, kind)` on every roof material in main.ts and the lab's). The
roof canvas was mapped by world plan (`roofGeo`'s uv is x, z), so the pantile
rows ran along world z whatever way the ridge ran, its row was 0.78 m against
a real course of 0.3, and at twelve pixels to the metre it mip-filtered to a
tone with a grid in it. Per fragment now: down-slope is gravity projected
into the plane, across is the eave, and (across, down) is a coordinate in
metres on the surface in which a course is a row, a unit a cell and the
broken bond half a cell on alternate rows — pantile barrels, slate's wide
thin units, shingle's small ones, corrugated ribs DOWN the slope with sheet
laps across (the one roof whose units run the other way), and the flat cap
keeps its felt in plan. The canvas is sampled in the same frame, so the moss
sits on the courses, and it carries TONE ONLY now — the recipes in
`wall-tex.ts` lost their rows, because a canvas still drawing them lays a
second, coarser, wrongly-turned set under the shader's. The last course sits
in the gutter's shadow off `aTop`. **The gate on "pitched" is three degrees,
not fourteen**: a cap is exactly level, and the first cut's 0.97 drew a Cape
skillion at eight degrees as felt. No ridge line yet — a fragment cannot
know where its plane ends, and the ridge would be a fifth attribute.

**THE ROOFLINE: A RIDGE COURSE AND A CHIMNEY.** A ridge was two planes
meeting on a line, and from the street that line was whatever the two
slopes' shading did; `roofGeo` lays a course of ridge tiles along it now — a
narrow flat top, lit square to a high sun so it reads lighter than either
slope, with skirts steeper than the roof — on every gable and hip, none on a
pyramid. And a stack: `chimneyGeo` (roof.ts, on `roofBox`, the oriented box
`roofGeo` itself is built on, so it refuses where the roof refused) stands
one on the ridge a metre in from the gable end, two on a plan over 160 m²,
buried to half the ridge so it meets the slope at any pitch. `Tradition.chimneys`
is the share of pitched roofs that carry one — the Alps and Britain nine in
ten, the Sahel none — drawn off the id by a constant nothing else uses.
**The stack is its own piece with `aGram` −1, the shader's BLANK wall**: a
chimney is 0.64 m wide, the bay grid falls across it however it falls, and
the first thought — put it in the roof piece — would have drawn a door on it
somewhere in every town. Blank keeps the cornice band at its top, which on a
stack is its cap. The lab has a CHIMNEY toggle.

**Photographed** (`scratchpad/facade-fid.mjs` and `roof-fid.mjs`, the lab,
`/tmp/drive-tools/facade-fid/`; `building-survey.mjs` on the two captures
against `/tmp/drive-tools/bldg-fix2/`): the Camps Bay block at b1 went from
dark rectangles on a white slab to sky-reflecting panes with frames, sills,
balcony rails and the reveal's band at noon; the Mediterranean wall in the
lab wears blue shutters, the Dutch terrace its white sashes under the gables,
the Haussmann block its balconies and shopfronts; the pantile roof at 12 m is
barrels in courses. Judgement, not anchors: the seat's report is the
verification, and every number above is a dial.

### The far bake, from the seat's dump: a climate field at the shell's scale, and slices

The seat's telemetry on the wide chart (z4, 14.7 km a pixel, 98 s):
`far:bake` 216 ms a tile, 137 tiles, 30% of the session, top of 123 of 575
slow frames and 36% of their time; the frame at 11 fps with half of them
over 50 ms. Two causes, both in the bake's vertex loop, and neither was the
loop's own arithmetic:

- **EVERY VERTEX MISSED THE CLIMATE MEMO FOUR TIMES.** `terrainPalette` asks
  `climateAt` per vertex, and the fine field's corner lattice is `CLIM_G`,
  2 km. At z4 the vertices are 2.4 km apart, so each one needed four fresh
  corners — four `climCompute`s — and a 1,200 km tile has 360,000 corners
  against `CLIM_CACHE_MAX` of 20,000: the cache was cleared several times
  per bake and nothing was ever reused. Right for the fine world (8 m
  vertices under 2 km cells), exactly wrong for the shell. `ClimateField`
  takes a cell size now and `farClimField` keeps one per size: a
  twenty-fourth of the tile, never finer than the fine field's, its corners
  shared across the ring, its cover read through `sampleCoverShell` so a
  corner over the wide raster counts as evidenced and is not recomputed on
  every cover arrival. The fine field never sees the shell.
- **AND THE LOOP RAN OFF THE TICK, WHOLE.** Inside the fetch's continuation,
  where nothing paced it — the same shape the route solver had. It is a job
  now (`farBakeJobs`, `stepFarBakes` beside the hydro drain): `FAR_BAKE_MS`
  of a frame, standing down in a frame that already carried a heavy build,
  and dropping a tile whose level or ring moved on while it was sliced.

**Measured** (`scratchpad/farbake-ab.mjs`: the seat's own spot and zoom,
`0115fe6` against the working tree, 180 s each, the harness's software
renderer at 0.6 fps so only the main-thread rows carry):

| | control | fix |
|---|---|---|
| `far:bake` per call, mean / max | 608 / 767 ms (a call is a tile) | **4.0 / 9 ms** (a call is a slice) |
| main thread per tile baked | 608 ms | **17 ms** (261 ms over 15 tiles) |
| tiles home in the window | 25 | 15 |

The per-tile cut is the memo — thirty-five times in the harness, where
`climCompute` is dearer than on the phone; on the phone the loop's own nine
microseconds a vertex remain, sliced. **The fewer tiles are the harness's
frame rate**: a slice is a frame, a z4 tile is three of them, and at 0.6 fps
that is five seconds a tile where a phone at 30 fps takes a tenth. Any
devtool that waits for the ring (`globe-view.mjs`, `globe-spin.test.mjs`,
`park-ab.mjs`) now waits on frames rather than fetches; the budget scales
with the smoothed frame so a slow harness bakes a tile a frame and a phone
keeps its six milliseconds. `far:geo` and `far:nrm` are unchanged. The
worker remains the honest next cut for the nine microseconds.

### The tree refresh is resumable work

The next dump from the seat (Honfleur, chase, 27 fps): the far bake gone
from the slow frames (1.8 ms a slice, 10 max), and `treeRefresh` at 33 ms a
call, 240 calls in a hundred seconds, top of 185 of the 488 slow frames —
more frames than anything else. Its split was honest and unhelpful: 14 ms
gathering candidates over a 27x27 ring of cells, 3.5 admitting the nearest,
14 placing nine hundred trees (a ground read, a matrix and a colour each).
No one phase to cut, and all of it in one synchronous call every 900 ms, or
every 120 while a hop's seeding was catching up.

`refreshVeg` is a generator now (`vegRefreshSteps`): it yields after every
ring cell of the gather, after the admit, and after every cell of the place,
and the tick runs it in slices of a sixth of the smoothed frame, five
milliseconds at the floor, until it is done. Two rules make that safe:

- **THE PLACE WRITES INTO STAGING, NOT INTO THE INSTANCES.** A frame drawn
  between two slices of a refresh that wrote the instance buffers directly
  would show the first k slots re-assigned and the rest still last refresh's
  — a tree twice where the order shifted, none where it had not yet. Every
  matrix and colour goes into a staging array per mesh, sized to its
  capacity and kept across refreshes, and the whole set is committed in one
  slice at the end with the counts. A mesh that has never been coloured has
  no colour attribute until its first `setColorAt`; the commit makes one.
- **ONE JOB AT A TIME, AND A WHOLE CALL CANCELS IT.** The tick starts a job
  only when none is running, so a cadence that fell behind coalesces rather
  than stacks; `refreshVeg()` — the debug toggle, the hop — drops any job in
  flight and runs the same generator to completion in one call. That is also
  what `perf-check.mjs` holds against its baseline (it extracts both halves
  now), so the sliced and the whole refresh cannot drift apart: **20 of 20
  production refills byte-identical** to the pre-slice function.

The seed budget is per slice, so seeding cannot spend more than the slice;
the deferral count accumulates over the job and sets the next cadence as
before. `?vegstep=N` forces a slice of exactly N ms (0 is the whole refresh
in one call, the A/B), because the harness's two-second frames run a refresh
whole under the frame-scaled rule and could not otherwise show a slice.

**Measured** (`scratchpad/vegjob-ab.mjs`, the Camps Bay fixture, a minute
settled then forty seconds driving, `vegstep=0` against `vegstep=5`; the
harness's frames are seconds so the whole refresh is cheaper there than on
the phone, and the ratio is the number):

| | whole (`vegstep=0`) | sliced (`vegstep=5`) |
|---|---|---|
| `treeRefresh` per call, mean / max | 13.5 / 55 ms (a call is a refresh) | **5.7 / 11 ms** (a call is a slice) |
| stand forms within 300 m | bare 5 · columnar 3 · round 8 | the same |

Two things the first sliced run taught: **the tiers' counts are the job's
until the commit** — `__ez().tris` read 0 mid-refresh because it sums
`t.n × tris` and the generator had zeroed them at its start; the slots and
the counts are the job's own now and land with the meshes — and **the phase
marks measure from the last mark**, so across a frame gap they billed the
gap to whichever phase was running (ezGather read 4.5 s a call); a slice
re-arms the clock at its start.

### The water rebuilt for a millimetre of ground

The Pont de Normandie dump, at 27 fps with the far bake and the tree refresh
already cut: `hydroBuild` 67 ms a build, 234 builds in 112 s, 14% of the
session and **49% of every slow frame**, top of 170 of them. And beside it
`feeds 199 skipped 36` — the skip built for five feeds in six.

**THE FIRST GUESS WAS WRONG AND THE MEASUREMENT SAID SO.** The skip compares
the elevation raster, and `sampleHeight` carries every road carve, so the
obvious story was that terrain churn a kilometre inland was rebuilding the
estuary. That is real, and it is not what dominates: masking the comparison
to a band round the water (`?hydroground`, the features' own boxes and the
ocean mask's non-dry texels, dilated) saved **nothing at all** at Simon's
Town — a fixture that is mostly sea, so the band is the tile. Guessing a
second time was the temptation; counting was the fix.

**SO THE FEED SAYS WHY IT BUILT**, in four words the ledger line carries —
`dirty` (a body changed elsewhere and the tile was marked stale, which
bypasses the raster entirely), `sig` (a feature or the ocean mask moved),
`ground` (the raster moved where the water reads it), `first`. Measured:

| | Senqu ford | Simon's Town |
|---|---|---|
| feeds | 27 | 49 |
| built by `first` | 20 | 20 |
| built by `sig` | 0 | 4 |
| built by `ground` | **6** | **24** |
| built by `dirty` | 0 | 0 |

The body cascade never fires on a settled fixture; one build a tile is the
floor; everything else is the ground. **And the ground comparison was EXACT
FLOAT EQUALITY.** The water reads the raster as a bed depth and a waterline,
in metres; `sampleHeight` jitters below a centimetre as roads seat, weld and
re-drape. A texel must move by `?hydroeps` metres — two centimetres, under
the field's own vertical resolution — before it counts. Measured, the same
two fixtures, the tolerance the only change:

| | exact | 2 cm |
|---|---|---|
| Simon's Town: built by ground / skipped | 24 / 1 | **0 / 30** |
| Senqu ford: built by ground / skipped | 6 / 1 | **0 / 7** |
| Senqu ford: ms a build, mean / max | 30.0 / 165 | 20.0 / 149 |

Every ground-driven rebuild at both places was a sub-centimetre wobble.

**THE TOLERANCE IS SAFE BECAUSE THE STORED RASTER IS THE ONE THAT LAST
BUILT**, not the one last fed: drift is measured from the field's own input,
so a bank creeping a centimetre a rebuild is caught on the rebuild that
takes it past two, rather than never. And a ground change cannot create
water on its own — inland water is a FEATURE and the sea is the ocean mask,
both already in the signature — so the band may drop a texel without
dropping a body. An unknown mask texel counts as wet-relevant (the build
keeps the previous field's answer there) and a tile whose mask never arrived
keeps the exact comparison.

`?hydroground=0` and `?hydroeps=0` restore the old rule, separately.

### The bridge in the elevation data: sixteen estuary spans

The Pont de Normandie, reported from the seat as footpaths in the air and
water in the sky, is the primary DEM publisher serving the deck and its pylons
as TERRAIN. Measured there: 137.5 m of "ground" standing over an estuary the
land cover calls water, and everything downstream believing it — `baseElev`
62.1 m mid-river (the origin's own texel), a river body resting at 37.61 m, the
carriageway solved to −1.3 m absolute, 63 m under the ridge it belongs to, and
the rig drowned with all 961 sampled points wet.

Before fixing that by letting the ROADS tell the terrain, the question is how
general it is. `devtools/dem-structures.mjs` asks sixteen major estuary spans,
both publishers through ONE sampler in the browser, on the same world grid:
over the texels the land cover calls water, how far does the elevation stand
above the sea, how narrow is the highest thing it finds, how much of the box is
water, and what does OSM say. The controls are five inland waters.

| span | mth peak | >10 m | deck | aws peak | aws spread | water | span | osm |
|---|---|---|---|---|---|---|---|---|
| **Pont de Normandie** | **137.5 m** | **1.3%** | **30 m** | 0.8 m | 0.5 m | 67% | 1,185 m | 4/4 L1 |
| Øresund | 0.6 | 0 | 15 | −6.4 | 0.6 | 84% | 1,980 | 1/1 L4 |
| Golden Gate | 0.0 | 0 | 15 | −24.4 | **66.5** | 96% | 2,565 | 4/4 L1 |
| Bay Bridge west | 0.0 | 0 | 15 | 1.8 | 14.8 | 95% | 885 | 2/2 L1,2 |
| Humber | −2.1 | 0 | 15 | −1.7 | 0.2 | 96% | 1,770 | 5/5 L1 |
| Queensferry Crossing | −0.5 | 0 | 15 | 15.5 | 13.1 | 95% | 1,425 | 4/4 L1,2 |
| Vasco da Gama | 0.0 | 0 | 15 | 0.0 | 0 | 60% | 1,830 | 2/2 L1 |
| Storebælt East | 6.5 | 0 | 15 | 2.0 | 8.4 | 89% | 1,830 | — |
| Akashi Kaikyō | 0.0 | 0 | 15 | 0.0 | 0 | 95% | 1,905 | 2/2 L2 |
| Hangzhou Bay | 0.0 | 0 | 15 | 0.0 | 0 | 98% | 2,160 | — |
| Sydney Harbour | 14.9 | 0.2% | 75 | 26.1 | 10.1 | 75% | 45 | 6/28 L1 |
| Chesapeake Bay | 0.0 | 0 | 15 | 0.0 | 0 | 78% | 2,490 | 2/2 L1 |
| Rio–Niterói | 0.0 | 0 | 15 | −1.0 | 1.1 | 99% | 3,630 | 2/2 L2 |
| Prince of Wales | −0.5 | 0 | 15 | −0.6 | 4.7 | 93% | 1,020 | 503 |
| Tsing Ma | 0.0 | 0 | 15 | 1.2 | 1.0 | 68% | 1,575 | 4/4 L2,3 |
| Confederation | 0.3 | 0 | 15 | 0.0 | 0 | 100% | 2,475 | 1/1 L1 |
| *(control)* Loch Ness | 16.0 | **100%** | 2,415 | 16.0 | 0 | 100% | 3,075 | — |
| *(control)* Senqu · Rhône · Merced · Breede | *no cover-water within 200 m at any of the four* ||||||||

**ONE SPAN IN SIXTEEN CARRIES ITS BRIDGE.** Everywhere else the estuary is
flat in both publishers: Mapterhorn is a LAND model and answers a nodata 0 over
open water (and at Hangzhou, Tsing Ma and Rio has no z14 tile at all, so the
game climbs to z12), while AWS terrarium is either the same 0 or real
bathymetry — the Golden Gate's channel at −92.9 m, the Bay Bridge's at −24.1.
Neither carries the Humber, the Forth, the Great Belt, Akashi, Chesapeake or
Confederation decks, all of which stand 30–60 m over the water in life. The
Normandie is a DSM's surface where a national source filled the gap, and 1.3%
of the water texels in its box — the deck, 30 m wide — is the whole fault.

**And the two inputs option 1 needs are both there.** The cover calls the peak
texel water at all sixteen, water is 60–100% of every box, and the cell's own
z16 tile answers `bridge` on 13 of the 16 with a `layer` on every one of them.
So the trigger and the gate are present, and they are present at the ONE place
the trigger is needed.

Three traps, each of which cost a run and each of which is the general lesson:

- **A DEM READ WITHOUT `RAW_BITMAP` IS A READING OF CHROMIUM'S COLOUR
  MANAGEMENT.** The first cut decoded the WebP with the default
  `createImageBitmap` options and the ridge came back as 5.2 m: a terrarium R
  channel moved by one unit is 256 m of elevation, so a colour-managed tile is
  not a noisy measurement, it is a different planet. main.ts asks for
  `colorSpaceConversion: 'none'`; anything reading these tiles must too.
- **THE SPOT IS NOT THE MEASUREMENT.** A hand-typed coordinate lands anywhere
  along a three-kilometre bridge: the first run sampled 640 m north of the
  pylon the game had measured at 146 m, read 1.9 m, and would have reported the
  fault as ABSENT at the one place it is worst. The measure is the peak over a
  box, which is publisher-symmetric and does not depend on aim.
- **AND THE DATUM MUST BE THE WATER, NOT THE BOX.** Taking the box's tenth
  percentile as "the water" is right over an estuary and wrong the moment a
  publisher carries bathymetry: at the Golden Gate the tenth percentile was the
  100 m channel bed, so the narrowest run above it marched the whole box and
  reported a 1,575 m deck. Over the texels the cover calls water, against the
  sea, there is no such tail.

**WHAT THE CONTROLS SAY ABOUT THE CHEAP FIX.** The obvious rule needs no roads
at all — over cover-water, ground standing more than ten metres above the water
is not ground — and the controls say exactly which form of it is safe:

- against the SEA it deletes Loch Ness, whose surface is 16 m up and 100% of
  whose texels are "over 10 m" in both publishers;
- against the LOCAL WATER MEDIAN it fires on 1.48% of the Normandie's water
  texels, 0.00% at the other fifteen spans AND at Loch Ness on the publisher
  the game reads — but on 28.9% of the Golden Gate's under the FALLBACK, where
  the median is the deep channel and the shallows stand 60 m over it;
- and at four inland river points — the Senqu, the Rhône at Obergoms, the
  Merced and the Breede — there is no cover-water within 200 m at all, so no
  cover-gated rule of any form fires at a small river bridge. WorldCover at
  37 m a pixel does not see a channel; the same fact is already recorded
  against hydro's own inland water.

So the honest statement is that a local-median veto is clean on the primary
publisher at every one of the seventeen places measured and unsafe on the
fallback at one of them, and that the cover gate is blind inland. That is the
argument FOR option 1 rather than against it: the roads say which high texel is
a structure without needing a water surface that is itself derived from the DEM.

### …and what option 1 would cost, read off the code

Not built — this is the survey's other half, and each item is a place the rule
would have to touch.

- **THE REPAIR BELONGS IN THE RASTER, NOT IN THE MESH.** `sampleHeight` is the
  one height of the world (97 call sites) and the mesh is built from the same
  rasters in a worker. Patch only the mesh and the picture and the physics
  disagree about the floor, which is the fault `sampleHeight`'s own comment
  exists to record.
- **AND `mirrorHeight` IS SEND-ONCE, AND TRANSFERS THE BUFFER.** The worker
  keeps the first copy of every tile it is given (`mirrored.has('h'+key)`), so a
  raster patched after the mirror never reaches the build. A patched tile needs
  a revision and a re-send, or the ridge stays in the mesh for ever while the
  wheels stop believing it.
- **`demrepair.ts` IS THE CONCEPTUAL HOME AND CANNOT BE THE ACTUAL ONE.** It is
  pure per-tile, and it must stay that way: `capture-world.mjs` runs it so a
  fixture is conditioned exactly as the game conditions it. A structure repair
  reads the ways and the cover, which a per-tile function does not have — so it
  is a second pass, and the capture needs the same pass or a captured estuary
  reproduces a defect the game has repaired. That is the fabricated-witness
  trap this file already records twice.
- **THE ORDER IS WRONG BY CONSTRUCTION.** A z14 DEM tile is ~2.4 km and lands
  long before the z16 vector tiles that carry the bridge, so the repair is
  necessarily retroactive: patch on the ways' arrival, dirty the terrain tile,
  re-mirror, re-feed hydro. The way-dirty path and `WAY_HOLD_MS` already bound
  that churn, and the patch moves the raster by tens of metres, so the hydro
  skip's 2 cm tolerance correctly lets exactly one rebuild through.
- **IT CANNOT FIX THE ORIGIN, AND THE ORIGIN IS HALF THE DAMAGE.** `baseElev`
  is ONE texel of the anchor tile, read at boot before any way exists
  (`baseElev = anchor[v * 256 + u]`), and the whole world's metres are relative
  to it — there is no rebase short of a hop. At the Normandie that one texel
  was 62.1 m. A robust statistic over a small box would have read about zero,
  and it is a cheaper, independent fix that needs no roads.
- **THE CROSSING REGISTRY ALREADY RESOLVES THE TAGS — AND ITS FOOTPRINT IS THE
  WRONG SHAPE.** `resolveProductionCrossingIntent` already answers
  bridge/culvert/ford/causeway from explicit tags, the kernel already consumes
  `TerrainCrossingMask[]` per build job, and `corridorH` already reads
  `crossingAt` beside `coverWater`. But a footprint is a POINT with
  `halfLength = waterHalfWidth + 4`, sized by the water feature at the crossing
  — built for a road over a river, not for a 2 km span — and `at()` and
  `earthworkAt()` are linear scans over every record, which is the exact shape
  of the substrate contact sampler that cost 17% of a phone's CPU. Option 1
  wants the bridge WAY's own polyline between its portals, in a cell index.
- **THE BED MUST NOT BE RAMPED FROM THE BANKS.** "Interpolate from the banks"
  is 1,185 m at the Normandie and 2,565 m at the Golden Gate, and the banks are
  a 20 m cliff at plenty of estuaries. The water's own surface — the sea datum,
  or the body's resting level — is the honest fill, and the veto must only ever
  LOWER ground standing above it, never raise a bed the fallback publisher
  actually sounded.
- **THE GAME ALREADY KNOWS THOSE TEXELS ARE NOT WATER.** `coverWater` vetoes a
  water class whose ground tilts more than 9% or stands 1.2 m proud of its
  neighbours — a 137 m deck fails both — so the deck's texels are already
  classified as LAND. The cover is not wrong about the estuary; the DEM is
  wrong about the deck, and only a rule that can say so will move it.
- **WHAT IT WOULD NOT REACH:** a viaduct over dry land, where a DSM carries the
  same structure with no water to gate on; a ship, a crane or a pier in a port,
  which no road tags; and every small river bridge, where the cover has no
  water (above). A hydro-field gate rather than a cover gate would reach the
  last of those.

### …and the bridge comes out of the elevation

Built, measured at the Pont de Normandie, and gated by `?bridgedem=0`.

**THE SHAPE REPAIR TAKES THE PYLONS AND LEAVES THE DECK, and the numbers say
why in its own terms** (`devtools/dem-ridges.mjs`, which decodes the real tile
exactly as `decodeTerrarium` does and hands it to the SHIPPED module): the
tallest blob is 161.8 m over a ground of −3.2 with the tile's relief at the
30 m floor, its equivalent radius 0.51 of what the slope allows, and
`repairDem` diffuses its 1,085 px away. What is left standing is 76.6 m of
carriageway — **under the 80 m rise the blob walk even considers**, and under
the `3 × relief` a blob must dwarf. The anchor texel under the seat's own
spawn reads 61.6 m after the repair, which is the 62.1 the game booted with.

**AND NO WIDENING OF THAT RULE COULD REACH IT.** Twenty-one tiles, the
hardest narrow landforms on earth among them, measured with the same tool:

| | peak | width by erosion | of the width its height allows |
|---|---|---|---|
| Pont de Normandie, the deck | 79 m | 37 m | **0.40** |
| Old Man of Hoy, the stack | 77 m | 30 m | **0.33** |

At six metres a pixel a sea stack and a carriageway are the same object, and
the sea stack survives today only because the dwarf test spares it. The one
thing that separates them is that somebody mapped a `bridge` over one of them
— which is the survey's conclusion arrived at from the other side, and the
reason this is `client/dem-spans.ts` and not a looser `demrepair.ts`.

**THE RULE, AND THE FOUR THINGS THAT KEEP IT HONEST.** A way tagged `bridge`
(and not `tunnel`) registers its densified centreline with `roadHalf + 10 m`;
every texel inside that mask walks SQUARE to the deck, both ways, and:

- **it only ever LOWERS.** A span with no structure under it is a no-op, which
  is fifteen of the sixteen surveyed estuary spans;
- **it interpolates ACROSS the deck, never along it**, so the ground it reads
  is twenty metres away and the bed under a 1,185 m span is never guessed from
  its banks;
- **both sides must find ground**, or the texel is refused — one side is not
  evidence, and at the edge of a mis-tagged embankment the outward walk finds
  ground while the inward one never leaves the structure;
- **and the COVER'S WATER beats a smear.** A surface model does not stop at
  the carriageway: 23 m of deck leaves 37 m of "ground", with the pylons wider
  still, so the first texel off the mask is more bridge. Measured, with the
  first cut standing on it: **62.55 m came down to 32.45 and stopped.** A side
  that reaches cover-water takes the water's level, and where any side is water
  the water is the bed — the higher-of-two rule is right for a deck along a
  shoreline and wrong for one whose other flank is its own pylon. The
  prominence guard (`riseM`, 12 m — the slope times the half mask on a 45%
  hillside is nine) is what keeps an abutment and every hill safe.

**THE WIRING HAS TWO CALLERS AND ONE RE-MIRROR, all three from the survey's
own list of what this would cost:** a z14 height tile lands long before the
z16 vectors that carry the bridge, so a span repairs whatever is loaded when
it arrives and every tile repairs whatever it has when IT arrives (the repair
only lowers, so the second pass over a cleared span moves nothing); and
`TerrainWorkerClient.remirrorHeight` exists because the height mirror is
send-once by design — without it the wheels would read the repaired ground
while the MESH kept the ridge, which is the picture and the physics
disagreeing about the floor. `bridgeSpans` clears on a hop: they are in local
metres under the origin that built them.

**AND THE WORLD'S DATUM IS NO LONGER ONE TEXEL.** `baseElev` was
`anchor[v * 256 + u]`, read at boot and on every hop before any way exists, and
at the Normandie that texel is the deck. `anchorElevation` (demrepair.ts, pure,
so the capture tool can run it) keeps the texel unless it stands more than 25 m
over the median of its own fifty metres, and the landform tiles set that
threshold with room to spare: the Normandie's anchor is **55.2 m** over its own
median, Half Dome's rim 14.2 and El Capitan's — the default spawn — **4.5**.

**MEASURED**, the seat's own spawn, `?bridgedem=0` against the fix, one build,
180 s settled, no page errors (the second column is the first cut; the third
is the rule as it stands after the seat's photograph, below):

| at the Pont de Normandie | repair off | first cut | now |
|---|---|---|---|
| `baseElev` (the world's datum) | 62.1 m¹ | **6.5 m** (`raw 62.08, median 6.48`) | 6.5 m |
| DEM 120 m north of the spawn | 57.77 m | **3.30 m** | −2.23 m |
| DEM at the spawn | 62.55 m | **7.71 m** | 7.71 m |
| the river's resting level there | **37.76 m** | **4.27 m** | 0.17 m |
| texels lowered / of them flank / worst / refused | — | 361 / — / 69.6 m / 0 | **1,618 / 1,159 / 78.9 m / 0** |
| the north pylon's crown, 720 m north, 53 m off the axis | 44.2 m | 44.2 m | **−1.75 m** |
| the logistics shed 640 m south-south-west, 236 m off any span | 12.23 m | 12.23 m | 12.23 m — untouched |

¹ Measured before the anchor rule landed; `bridgedem` gates the span repair
and not the anchor, so `?bridgedem=0` reads 6.5 m today as well.

The first cut's write-up called the 44.2 m row its control — "a structure
nobody tagged as a bridge, left exactly where it is". It was the north pylon's
own flank, and the seat photographed it. The shed is the control: a 200 m
block the surface model carries at twelve to twenty metres, land to the cover,
far off any span, and nothing here may touch it.

### …and the seat's photograph: two white towers and two green mounds

Sent with no words, from the top camera at `49.4261 0.2773`, beside the real
bridge: the deck now runs over the water — and two tall pale cylinders stand
where the pylons are, and two dark-green wedges stand on the far bank either
side of the deck. Both are attributed, one is fixed, one is proposed.

**THE TOWERS ARE OSM BUILDINGS.** The cell's banked z16 tiles carry the
pylons as footprints: ways `1085528281` and `1085528282` at the south pylon's
two legs (`building=yes`, `height=214`, nine points each, 46 m apart) and
`1085528283` at the north pylon (`building=service`, `height=214`). `building()`
reads the surveyed height, clamps it to **90 m** (`lineOn ? 26 : 90`), takes a
flat roof and the region's tradition paint — a near-white cream — and hands
the nine-point ring to the batch, which at phone scale is a pale cylinder
ninety metres tall. `mmThing()` is not involved (`__built().mm` is 0: no
`man_made` here), and the cable family builds no towers of its own —
`supportSpacingM` is 0 for `cable` in infrastructure.ts, so a cable-stayed
bridge gets a rail and nothing under it. **What stands at the pylons is the
data drawn as the wrong thing**, in the right place at half the height. The
proposal, not built: a `building` footprint whose surveyed height is far over
any storey count, with no `building:levels`, whose centroid lies within a
bridge span's corridor, is a pylon — a tapered concrete column of the
footprint's radius at the surveyed height, concrete grey, the way `mmThing`
builds a `tower`. The corridor test is the guard: a slender skyscraper mapped
with `height` alone would otherwise become a pylon. The order in which a
tile's ways build means the bridge way may not have registered its span when
the footprint builds, so the test has to read the tile's own bridge-tagged
highways as well as the registry.

**THE MOUNDS WERE THE NORTH PYLON, AND THEY WERE THE RULE'S OWN FAULT.** Read
from a spawn at `49.4395 0.2725` (still in the estuary — the Seine is a
kilometre wide here, and the north bank is further than it looks), the relief
map ±750 m showed a mound 230 m across and 76 m high straddling the span at
the north pylon, with the deck strip through its middle **still at 63–76 m**:
`__respan` — a probe that runs the repair again on the tile under a point with
every span known and the cover loaded — moved nothing there (`cover 80,
touching 14, before 74.24, after 74.24`). So it was not the order things
arrived in; the rule refused the place. Two reasons, both in the walk:

1. **The walk asked the cover before the mask.** WorldCover calls every texel
   of an estuary span water — the survey found this at all sixteen — so the
   first step off a deck texel landed on its neighbour, which was water to the
   cover and deck to the field, and the "water" the deck was lowered to was
   its own height. Nothing moved wherever the cover calls the deck water,
   which is the whole channel; the south side worked only because the cover
   there is trees, built and bare (rows 49–52 of the cover tile), so the walk
   had to step over the mask to find its reference. The self-test never saw
   it because every water case authored `wet` OUTSIDE the smear. Now a masked
   texel is never the reference, whatever the cover says of it, and the
   `all water` case (`() => true`) fails on the old module — `cleared to 60,
   wanted the water + 1` — and passes on this one.
2. **The first water is not the bed.** Off a pylon the first unmasked water
   is the blob's own flank at sixty metres; with the reach at 14 texels there
   is nothing else within it. The walk now carries on to its reach and keeps
   the LOWEST water it saw, and a deck the cover itself calls water walks
   **40 texels** (~190 m) for it — `waterReachPx` — while a deck the cover
   calls land keeps the short reach and so a bluff road keeps its bank.

That cut the slot: the strip at −1 to −2.3 across all three sections. **And
left the two wedges standing either side of it** — 72.5 m and 76.2 m at the
blob's widest row — because the mask is the deck's width and the blob is two
hundred metres wide. Which is the photograph. So the structure's own flank
comes down with the deck: from every lowered deck texel, a fill grows through
texels the cover calls water that stand more than `blobM` (4 m) over that
texel's target, on a leash of `waterReachPx` hops, and gives them the same
target. The cover is the fence — a hill, an island under a span and the wall
of a dam are land to it and stop the fill at their first texel, and the lake
behind a dam is never reached because the dam is in the way (both held by
the self-test). Measured, the north pylon's three cross-sections read −0.8 to
−2.3 m across the full ±150 m; the tile's ledger went from 222 texels moved
to 1,181, of them 832 flank; `__respan` afterwards moves nothing.

**WHAT IT STILL DOES NOT REACH:** a viaduct over dry land (no water to take
the reference from, so only the smear-free case moves — the south approach's
`embankment=yes` ways run on a real 20 m earthwork the DSM shows and the road
drapes over, which is right); a ship, a crane or a pier, which no road tags; a
small river bridge, where the cover has no water at all; and the pylons
themselves, standing as 90 m cream buildings until the proposal above is
built. A cover tile that arrives AFTER a span is patched still does not
re-run the repair; `__respan(x, z)` is the seat's way to ask.

Held by `devtools/dem-spans.test.mjs` (pure: the deck cleared, a hill and a
steep hill kept, an embankment refused, a cutting left alone, the water rule
both ways, the water-called deck, the pylon blob with the cover calling the
deck water and calling it land, the hill by a lake, the lake behind a dam)
and `devtools/dem-ridges.mjs` for the tile arithmetic. `boot.mjs` and
`through-node.test.mjs` are green (Camps Bay 8 / 0 / 0.19 m, unchanged);
**`fixture-world.test.mjs` fails three checks — crossroads and tee "built sward
meshes", village "built ribbon meshes" — and the control worktree at `b3efe88`
fails the same three with the same mesh lists**, so they are not this work's.

### Bridges are landmarks

The seat's verdict on the deck repair: we were going down the wrong path.
Large bridges are landmarks — their architecture and materials distinct and
well known — and while the substrate and the hydro field should handle any
crossing, a famous bridge needs its profile to be recognisable. The question
was whether there are general bridge morphologies to paint even the famous
ones from. There are, and they are few.

**WHERE THE CODE STOOD.** `infrastructure.ts` named six bridge families and
a silhouette per family, and nothing in main.ts read the silhouette. A bridge
was a deck ribbon, a rail, and round piers at a spacing for four families;
the cable family had `supportSpacingM` 0 and got nothing under it at all. The
Pont de Normandie's pylons existed only because OSM happens to map them as
buildings (`building=yes height=214`, clamped to 90 m and painted cream). The
landmarks store — "the world the data cannot draw", authored by hand, in git,
wire-format ready — had pyramids, an obelisk, a spire and a ring.

**THE MORPHOLOGIES, AND WHAT IDENTIFIES AN INSTANCE.** Structural
engineering's own taxonomy, read for what a driver recognises from a
kilometre off at this pixel scale:

| family | what identifies an instance | famous instances |
|---|---|---|
| girder / viaduct | pier rhythm, deck depth | Øresund's approach, Confederation |
| arch | through, deck or tied; rise over span; open or filled spandrels; hangers | Sydney Harbour (through, 0.27, granite end pylons), Hell Gate, Pont du Gard (three tiers), Charles Bridge (16 stone arches) |
| truss / cantilever | web pattern, through or deck, balanced cantilever | the Forth (three tubular cantilevers, red oxide) |
| suspension | **tower style**, cable sag, side spans, truss or box deck, colour | Golden Gate (deco portal, International Orange), Brooklyn (gothic stone), Humber (plain portal), Akashi (braced), Tsing Ma and Verrazzano (double deck) |
| cable-stayed | **pylon form**: A, inverted Y, H, mast, diamond; fan, semi-fan or harp; pylon count | Normandie (inverted Y, white), Millau (seven A-frames on 245 m piers), Øresund (H, harp, double deck), Rion–Antirrio (four A-frames), Erasmus and Alamillo (one mast) |
| movable | bascule with towers, swing, lift, transporter | Tower Bridge (gothic pair, high walkway) |

The dozen parameters per entry: family; span stations; tower style; cable
pattern; arch placement and rise; deck section; rail; material and colour;
end features. **Nine tower styles cover the famous bridges** — `portal`,
`deco-portal`, `braced-portal`, `gothic`, `a-frame`, `inverted-y`, `h-frame`,
`mast`, `cantilever` — with four cable patterns (`fan`, `semi-fan`, `harp`,
`suspension`) and two arch placements. That is the vocabulary
`substrate/bridge-forms.ts` paints from.

**THE TABLE, as authored in `landmarks.ts` (kind `bridge`):**

| bridge | form | tower | cables | tower over deck | stations | colour |
|---|---|---|---|---|---|---|
| Pont de Normandie | cable-stayed | inverted-y | semi-fan | 160 m | the two OSM pylon footprints | white concrete |
| Golden Gate | suspension | deco-portal | suspension, sag 0.11 | 152 m | two, 1,280 m apart | International Orange `f04a00` |
| Sydney Harbour | arch, through, rise 0.27 | — | hangers | — | the arch's two ends; granite pylon pairs | grey steel, sandstone |
| Tower Bridge | bascule | gothic | — | 55 m | the two towers | Portland stone, blue steel |
| Brooklyn | suspension | gothic | suspension, sag 0.08 | 48 m | two, 486 m apart | granite, grey cable |
| Forth | truss, through | cantilever | — | 100 m | three | red oxide `9b3b2c` |
| Millau | cable-stayed | a-frame | fan | 87 m | seven, as fractions | white |
| Øresund | cable-stayed | h-frame | harp | 145 m | two | grey, double deck |
| Akashi Kaikyō | suspension | braced-portal | suspension | 200 m | two, 1,991 m apart | grey-green |
| Humber | suspension | portal | suspension | 125 m | two | concrete |
| Tsing Ma | suspension | portal | suspension | 144 m | two | grey, double deck |
| Rion–Antirrio | cable-stayed | a-frame | fan | 113 m | four, as fractions | white |
| Erasmus | cable-stayed | mast | harp | 127 m | one | pale blue |
| Verrazzano-Narrows | suspension | portal | suspension | 141 m | two | grey, double deck |
| 25 de Abril | suspension | portal | suspension | 120 m | two | red `c4472f`, double deck |
| Bosphorus | suspension | portal | suspension | 101 m | two | grey |
| Hell Gate | arch, through, rise 0.2 | — | hangers | — | stone end pylons | red-brown steel |
| Alamillo | cable-stayed | mast | harp | 142 m | one | white |
| Severn | suspension | portal | suspension | 100 m | two, 988 m apart | pale grey |

Charles Bridge and the Pont du Gard need no entry: a stone multi-arch at
16–35 m spans is what the recipe's `arch` family already paints between its
piers (the spandrel walls, `gap` 8–45 m). What the entries cannot say yet:
Alamillo's mast leans and Erasmus's is bent, Brooklyn's stays are diagonal
as well as vertical, and the Forth's truss deepens at the towers. Those are
the next four parameters, each a small addition to a style that exists.

**THE PAINTER** (`client/substrate/bridge-forms.ts`, pure). A bridge is an ASSEMBLY of
deck fragments — OSM splits a long bridge into several ways, one per
carriageway and again at the pylons, each rendered as its own ribbon in its
own tile — gathered by the bridge's name (`bridge:name` or `name`; unnamed
bridges are assemblies of one) and rebuilt from every fragment known each
time one arrives. The principal axis is the line between the assembly's two
most distant ends; stations are authored points, mapped `bridge:support`
nodes, or fractions of the axis; a station stands BETWEEN the fragments it
finds (a twin carriageway gets one tower, not two beside it) and only an
authored point's position along the axis is used, so a coordinate a few tens
of metres wide of the deck still puts the tower on the bridge. Towers are
boxes from the ground (the DEM under the station — after the deck repair,
the bed) to the deck as a foundation and legs above by style; stays are
crossed thin quads from the tower to every deck edge within half the
distance to the next tower; the suspension cable is a parabola between tower
tops with the textbook sag and hangers to the deck edge every step; a
through arch is a pair of ribs outside the kerbs with hangers down and cross
bracing on top, a deck arch the same rib below on footings with columns up;
a truss is chords, verticals and Warren diagonals on both sides. One mesh per
bridge with vertex colours, in the world group like a landmark and not in a
tile's road batch, so the north pylon does not vanish when the tile that
carried the south carriageway is evicted. `?bridgeforms=0` is the A/B.

**THE PAINTER NEVER GUESSES A FORM ON A LONG BRIDGE.** Measured at the
untagged Severn Bridge: the recipe's family is a weighted roll made per way,
and it came up `cable` on one boot (two A-frames and 210 stays on a
suspension bridge) and `truss` on the next (a 6,428-quad lattice along two
kilometres). Above 150 m only a `bridge:structure` tag or a landmark entry
names a form; an untagged long bridge stays what it was, a deck on piers,
and the assembly takes the majority family across its fragments for the
short ones. The Severn got an entry.

**THE LANDMARK KIND.** A `bridge` entry claims an assembly by name within
`reach` metres of its position and overrides the generic spec's fields; its
stations become the towers; `pad` metres round each station an OSM building
stands down, which is how the Normandie's 214 m "buildings" leave. A bridge
entry flattens no pad and stands no group up of its own — `liveLandmarks`
filters it out — its geometry is the assembly's.

**THE MAP'S OWN PYLONS.** The cell's query and the client's fallback now
fetch `nwr["bridge:support"]`; `renderWays` notes each one in local metres
before any ribbon asks, and an assembly with no authored stations takes the
pylons and piers within 40 m of its fragments as its stations. Banked tiles
predate the query change and carry none until they are refetched.

**MEASURED at the Pont de Normandie**, from the deck at the south pylon,
150 s settled, no page errors: the assembly `bridge:pont de normandie:1`
gathered **16 fragments** (both carriageways, split at the pylons and at the
tile edges), matched the entry, and stood up **2 towers, 268 stays, 576
quads** in 16 rebuilds; `__built()` reports no intact building — the two
214 m pylon "buildings" stood down inside the entry's pads. From mid-span
looking north the frame is the bridge: the inverted-Y pylon with its legs
meeting into a mast, the semi-fan of stays converging on it from both deck
edges, the estuary either side. From the south approach the pylon rises out
of the frame with the fan hanging off it. `boot.mjs` and
`through-node.test.mjs` green, Camps Bay 8 / 0 / 0.19 m unchanged.

Held by `devtools/bridge-forms.test.mjs`: the tags name the family, a girder
paints nothing, two towers at the default stations with the right height and
a foundation to the ground, one tower between twin decks, authored stations
fix only the position along, the suspension tower height, the through arch's
crown and the deck arch's footing, the truss's depth, the bascule's pair, the
end pylons, and the attribute arrays agree.

### …and the deck stands clear of the water

The seat found the Pont de Normandie's deck at water level at
`49.42481 0.27555` and asked whether the substrate needed finishing, and
whether known bridges needed landmark hints. Measured there, in
`substrate=render` and in the default alike: the drivable surface equalled
the terrain at every sample along the axis — 7 m over the marsh, then −1.6 to
−3.2 m over the Seine with the water resting at −1 to −2.7 — and `__decks`
reported the bridge's segments with 0.2 m of daylight. `substrate=render`
was not the variable.

**ROOT CAUSE.** A bridge-mode way takes a whole-way run and the run's
profile is the portal-to-portal chord: a line between the terrain heights at
the fragment's ends. Nothing else supplies a deck height over water — the
layer lift raises a deck only over a lower-layer ROAD ("bridges over
nothing find no deck and keep their chord"), the crossing registry records
`deckY` as an input read from the road, and the hydro field was never asked.
Before the deck repair the surface model's smear carried the deck at 60–76 m
and the chord stood on it: right by accident. The repair lowered the terrain
under the deck to the bed and the chord followed it down, towers and all.
The regression was this work's, not an old one.

**THE FIX rides the flyover's own cone.** In the lift block, before the
lower-deck scan, every station is asked for a water want, and the two-pass
ramp then descends from any raised station at the ruling grade exactly as
it does for a flyover:

- **A landmark entry's deck profile** where one claims the way (`deckM`,
  the deck's height over the water at the towers, and `grade`): level
  between the outer towers, falling at the grade beyond them until the chord
  takes over. It is a function of position, so every fragment — the
  approach viaduct included, whichever tile built first — reads the same
  height at the shared node and the ends agree without a weld. That is what
  makes the hint the right tool: the ordering that defeats the weld on a
  flyover cannot arise.
- **The water plus a clearance by class** (10 m motorway and trunk, 7 m
  primary and secondary, 4.5 m otherwise) with no entry, and ONLY at a
  station whose chord would otherwise lie in the water. An ordinary river
  bridge whose chord already spans bank to bank keeps it, so its approaches
  keep their welds; the generic rule is confined to the failure the repair
  created.

`waterUnder` is the hydro field's resting level, or — where the field has
not built yet — the cover's word with the bed as the level, capped two
metres over the sea so an unrepaired smear cannot pose as the water. The
eighteen entries over water carry their deck heights (Normandie 52 m at
6 %, Golden Gate 67, Verrazzano 69.5, Akashi 65, Bosphorus 64, Tsing Ma 62,
Øresund 57, Rion–Antirrio 52, Sydney 49, Forth 46, Brooklyn and Hell Gate
41, Severn 37, Humber 30, Erasmus 12.5, Alamillo 10, Tower Bridge 8.6).
`__lifts()` now says which rule lifted a way: `hint`, `water` or `deck`.

**THE HINT'S DATUM IS AUTHORED, NOT SAMPLED.** The first cut read the water
at the towers from the live field, which makes the hint a function of what
has streamed as well as of position: each fragment built its own idea of the
deck from whatever the hydro or the cover said at that moment, and the
fragments disagreed. Measured at the Normandie across two runs of the same
build, the assembly's deck spread **15.6-54 m** on one and **15.6-86.2 m**
on the next. The datum is now the entry's own — `deckM` over `waterEleM`,
the water's elevation above sea level, zero for a tidal crossing, which is
every entry so far — so the hint is the same number before and after any
tile lands.

**MEASURED** at the seat's spot, 150 s settled, no page errors: `__lifts`
lists the Normandie's fragments lifted by `hint` — 33 to 39 m over their
chords — and `__decks` puts the fragment under the rig at **18.7–25.1 m**
with 24.8 m of daylight where it had 0.2; the assembly's deck runs
**15.6 m at the approach to 54 m over the water**, and the towers rise from
it. From mid-span the deck now soars over the estuary with the pylon's foot
in the water below it. `boot.mjs` and `through-node.test.mjs` green, Camps
Bay 8 / 0 / 0.19 m unchanged — the generic rule moved nothing there, which
is the confinement working.

**A SPAWN BESIDE A VIADUCT LANDS BESIDE IT, and that is left as it is.**
The seat's URL is 43 m east of the carriageway, on the marsh; the truck
spawns on the terrain, the road arrives afterwards, and a wheel takes a
deck only within four metres of where it already is (`tyreHeight`). Before
this work the deck was at marsh level and the truck stood beside it; now it
stands beside a 25 m deck. A seat rule was tried in this round — wait for
the nearest deck standing over four metres above the truck within sixty
metres and put the truck on it — and not shipped: the first such deck to
arrive was the embankment track at 4.6 m, then a side road at 6.3 m, never
the bridge, because the fragments arrive in tile order and the rule cannot
know a taller one is coming; and a teleport onto a track's centreline did
not seat the truck on it either. The honest version waits for the tile to
finish and then takes the tallest deck, and needs the tyre gate opened for
it; measured with `__seatwhy` over four runs and left for its own round.
Spawn on the deck itself (`49.4283 0.2745`, the seat's earlier spawn, is
on it) or use `__toroad()`.

**AND THE FIELD IS ASKED ONLY WHERE THE ANSWER TURNS ON IT.** The first cut
of the decision loop asked `sampleRestingSurface` at every station of every
bridge, where the rule it replaced asked only at the non-portal stations of
a bridge with no hint. That is real work inside the six-millisecond build
budget, and it showed as a TIMING fault a long way from the bridge: on the
structures fixture the causeway's terrain mesh was absent at the probe's
instant in **two runs of five, against none in four of the control**. A
hint over the chord decides on its own and a portal is the approach's
business either way, so neither asks; the call count is the old one exactly
and the authority still makes the decision.

**AND THE AUTHORITY DECIDES IT.** The three station rules live in
`substrate/crossing-authority.ts` as `resolveProductionDeck`, and the complete
run solve now lives beside them as `resolveProductionBridgeProfile`: it owns
the portal chord around held junctions, lazy water reads, contiguous wet-span
measurement, between-station lower-deck scan and two-pass ruling-grade cone.
Both are pure and tested in `substrate.test.ts`; the ribbon supplies the aligned
bench plus streamed water/deck callbacks and consumes the returned chord and
profile without reinterpreting the evidence. Who decided each way's deck is
kept by way key, handed to the registry when it records the crossing, carried
on the record as `deckAuthority` with `deck by landmark-hint` in its evidence,
and counted in the snapshot as `deckByHint` and `deckByWater`. What the
substrate still owes after this is the aligned bench solve and GEOMETRY — the
registry still learns of a crossing after the road is built, from the built
road, even though its crossing profile is now decided before geometry.

### The empty tile bank: a wrong diagnosis, and what it taught

The seat drove the Forth and the Golden Gate and found both bridges in the
water. Beside the Golden Gate sat a column of tiles banked with an empty way
list — `10472/25319..25322`, 44 bytes each — next to a tile carrying 48 ways
including the bridge's own sidewalk. Written up as a poisoned bank, fixed
with a keyspace bump, deployed.

**IT WAS THE TILE ARITHMETIC.** Tile 10472 begins at lon −122.4756 and the
bridge stands at −122.4783, so that column is the open water EAST of the
bridge: genuinely empty, correctly banked. The bridge's own column is 10471
and always had its ways. Checked against the new keyspace afterwards, the
tiles that hold the bridge answer with identical bytes on both — 1,678 at
the deck, 13,891 at the north tower, 907 at the Forth Road Bridge. Nothing
was ever poisoned. `TILE_V` went back to 4; a bump costs the world a
re-fetch and there was nothing to heal.

**WHAT SURVIVES IT.** Two things worth keeping. `askMirror` refuses ANY
Overpass `remark` now rather than three by name: a bank with no expiry
cannot afford a guess about which remarks are benign, and the cost of
heeding all of them is one 503 and a retry. And the mechanism the panic
uncovered is real and worth writing down: a banked tile is an S3 object
whose key IS the request path, CloudFront serves it without the cell's code
running, and `serveTile` runs on a cache MISS and nothing else. There is no
expiry, no re-check, and no request that could trigger one. If a tile is
ever wrong, the version constant is the only remedy there is.

**AND THE REAL FAULTS AT THOSE TWO SPOTS**, found while disproving the
first: the Golden Gate's carriageway is named `Presidio Parkway` and carries
`bridge:name=Golden Gate Bridge`, which the entry lookup reads first, so the
hint reaches it. The Forth Road Bridge is named exactly that, and the store's
`forth-bridge` entry matches `forth bridge` and `forth rail` — neither is a
substring of "Forth Road Bridge" — so it has no entry at all, and its ways
carry no `bridge:structure`, which means the recipe rolls a beam and plants
a support every 24 metres across the firth.

### …and the clearance is proportional to the crossing

The seat's next question answered itself: *surely the clearance from water
is at minimum proportional to waterway width?* The first generic rule was a
flat 4.5 to 10 m by road class, fired only where the chord lay IN the water.
Both halves were wrong. Ten metres over a two-kilometre estuary still reads
as a bridge lying in it, and a deck a metre ABOVE the water is as wrong as
one a metre under.

`navigableClearance` takes a twentieth of the wet span, floored at the class
minimum and capped at 65 m. The ratio is read off the store's own bridges,
deck height over main span:

| bridge | span | deck | ratio |
|---|---|---|---|
| Golden Gate | 1,280 m | 67 m | 0.052 |
| Pont de Normandie | 856 m | 52 m | 0.061 |
| Brooklyn | 486 m | 41 m | 0.084 |
| Severn | 988 m | 37 m | 0.037 |
| Akashi Kaikyō | 1,991 m | 65 m | 0.033 |
| Humber | 1,410 m | 30 m | 0.021 |
| Tower Bridge | 61 m | 8.6 m | 0.14 |

A twentieth sits in the middle and lands within a few metres of the real
thing on the big ones: 64 m against 67 at the Golden Gate, 43 against 52 at
the Normandie. The cap is about the tallest air draught built anywhere, so a
mis-measured estuary cannot raise a road into the stratosphere; the floor
keeps a ditch from lowering one into the water; an entry overrides both with
the surveyed number.

**THE WET SPAN IS MEASURED ALONG THE DECK** — the longest CONTIGUOUS run of
stations with water under them, so a causeway hopping islands is measured by
its channel rather than by its total length — and only for a deck already
known to be low, which is the one case that needs a number. A bridge with a
landmark entry costs no water samples at all. What it cannot see is a
crossing OSM split into several ways: each fragment measures its own wet
run, so a bridge cut into thirds asks for a third of the clearance. The
entries cover the famous ones; the assembly already gathers the fragments,
and teaching the measurement to read it is the next step.

### Every bridge in the world was draped on the terrain, and the gate was one word

Probed from the seat at the uMngeni mouth in Durban
(`?lat=-29.81016&lon=31.03845&h=7&cam=top&z=7.3`): two tagged bridges 580 m
apart, the M4's **Ellis Brown Viaduct** (two 471 m carriageways) and the
**Athlone Bridge** upriver (412 m on TWO POINTS), both running ALONG THE RIVER
BED. Live, the M4's deck descended 4.31 → 0.145 m across the estuary while the
water rested at 0.4 m, and `__lifts` reported nothing lifted within 300 m.

**THE STAGE LOG NAMED IT IN ONE LINE.** `__fragwhy` at the crossing:
`1-branch` = `2-ruled` = `2e-lift` = `3-seated` = the chain's own hint at every
station, and **`2d-chord` absent from the log entirely** — the portal-to-portal
chord never ran. Read back to its gate:

```ts
const runs: Array<[number, number]> = [];
if (mode !== 'none' && n > 4 && (!canopy || mode === 'bridge')) {
  if (mode !== 'bridge') { …resolveProductionRoadStructureProfile…
                           runs.push(...structure.runs…); }
  …
  if (mode === 'bridge' && runs.length) {   // ← can never be true
```

`runs` is filled in exactly one place, and it is the branch a bridge by
definition does not take. **So the whole bridge block — the chord, the flyover
cone, the landmark deck hint and the water clearance — was unreachable for
every tagged bridge on earth.** The pre-substrate-migration code pushed the
whole-way run right there (`if (mode === 'tunnel' || mode === 'bridge')
runs.push([0, n - 1])`); the migration moved that into
`resolveProductionRoadStructureProfile`, which the bridge path calls FOR
ITSELF from inside `resolveProductionBridgeProfile` — so the run list stopped
being the gate's business and nobody re-derived the gate. It reads the MODE
now. **The general lesson: a condition that survives a refactor by reading a
variable whose PRODUCER moved is a condition nobody has re-derived.**

**Measured** on the `at-umgeni` capture, the same tool and the same crossings,
against the revision before the migration (`devtools/bridge-water.mjs`):

| fragment | control deck / clearance | broken | fixed |
|---|---|---|---|
| Ellis Brown, carriageway A | 5.82 m / 9.10 m | −0.56 / 2.72 | **5.82 / 9.10** |
| Ellis Brown, carriageway B | 6.17 / 9.45 | −1.17 / 2.11 | **6.17 / 9.45** |
| Ellis Brown, the footbridge | 5.04 / 8.32 | −0.40 / 2.88 | **5.04 / 8.32** |
| Athlone Bridge | 12.51 / 12.43 | 5.54 / 5.46 | **12.42 / 12.34** |

Every deck 6–7 m lower, and the fix restores the control to the centimetre —
which is what says it is a restoration and not a new behaviour. Camps Bay's
junctions are untouched (8 / 0 / 0.19 m), because nothing there is a bridge
over water.

**THE WITNESS IS THE STAGE LOG, NOT THE HEIGHT.** `devtools/bridge-water.mjs`
reports both and fails on either, and the ordering is the point: a bridge whose
deck happens to sit above its water proves nothing — a chord along flat banks
does that by accident — so what says the machinery RAN is `2d-chord` in the
fragment's own stages. A deck under the water with no `2d-chord` is the chord
never running; a deck under the water WITH one is the lift deciding wrongly,
which is a different fault in a different module. Neither number alone can tell
them apart. **On this fixture the heights alone would have passed the broken
build** (the capture's own sea datum puts the water at −3.28 m, so the drowned
decks still cleared it) — the regression was caught by the stage log and would
have been missed by the metre.

### …and `bridge:name` was thrown away by the cache, so a bridge worked once

Found while reading the same two bridges. `bridge:name` is read in exactly two
places — the assembly key (`bridge:name ?? name`, which is how OSM says "these
deck fragments are one structure") and the landmark lookup, which reads it
FIRST — and it was in **no** `KEEP_TAGS`: not the client's, not the capture's.
`writeTileCache` applies that list before a tile reaches IndexedDB, so the tag
survived the first visit and not the second:

- on a reload the Ellis Brown Viaduct's two carriageways re-key from
  `bridge:ellis brown viaduct` to `bridge:ruth first highway` and merge with
  four approach fragments that are not the same structure;
- and **the Golden Gate loses its entry entirely** — its carriageway is named
  `Presidio Parkway`, and this file already records that the entry reaches it
  only through `bridge:name`. Deck hint, towers and cables, gone on the second
  visit.

The same shape as `railway` one tag over: **a tag the renderer reads and the
cache drops is a feature that works once.** Both lists carry it now. A tile
already in a player's IndexedDB still lacks it until it is re-fetched, which
degrades to exactly today's behaviour.

### What the uMngeni says that is NOT broken, and what is still open

Established offline from the cell's own banked tiles and the estuary survey
before any browser ran, which is what separates "absent" from "did not stream":

- **Neither publisher carries these decks.** Mapterhorn and terrarium both read
  0–1.2 m median over the water, peak 4–13 m, **0% over 30 m** — the ordinary
  case (15 of the 16 surveyed estuary spans), so the DEM span repair correctly
  does nothing here (`__respan`: `moved: false`) and the chord is the only
  thing that can hold these decks up. That is why losing it drowned them.
- **Both bridges are over 150 m and neither carries `bridge:structure`**, so
  the recipe correctly refuses to roll a form and both stay `girder` — a deck
  on piers. Right by the rule, and it costs the **Athlone Bridge**, which is a
  concrete arch in life. That is the landmark-entry gap, not a defect.
- **Zero `bridge:support` nodes reach the client.** The cell's query fetches
  them (`index.ts`), but these tiles were banked before that change and a bank
  has no expiry — so both bridges take the recipe's default pier spacing and
  there is no way to get the map's piers short of a `TILE_V` bump. The two
  `man_made=pier` areas in the block are jetties, not bridge supports.
- **The Ellis Brown Viaduct is TWO assemblies.** Its river spans carry
  `bridge:name`; its four approach viaducts carry only `name=Ruth First
  Highway`, so they form `bridge:ruth first highway` separately. One structure,
  two assemblies, and each measures its own wet run for the clearance rule —
  the limitation task #128 already names, seen in the wild.
- **The river's centreline crosses the M4 only 72 m from its south end** of a
  471 m deck, and the Athlone 155 m along its 412 m. Most of both bridges is
  over flood plain and interchange, not channel.

`devtools/bridge-water.mjs` is the instrument (`FIX=`, `CROSSINGS=` as JSON),
and `at-umgeni` the capture it runs on — the first fixture in this repo that
holds a named, tagged bridge over tidal water.

### A hydro build was priced by the tile, not by the water in it

The seat's dump from Yosemite (409 s, chase): `hydroBuild` **94.6 ms a
build, 240 max, 248 builds, 30% of all slow-frame time and top-of-frame in
222 frames** — the largest identified cost in the session. The dump could
not say which phase, because `HYDRO_BUILD_PROF` lives on `__hydro().buildProf`
and a phone has no console. **The instrument first**, then the number.

**THE DUMP CARRIES TWO NEW ROWS.** `look` states the switches this build was
run with (`tdetail`, the substrate's amount and domain, the ground view,
`swardsub`, `tilt`, `substrate`) so two dumps of the same drive can be
compared at all — which is the only honest way to cost a fragment shader, and
the answer to the question the Yosemite dump was pasted to ask. **Nothing in a
telemetry report can attribute per-fragment work**: the substrate runs in the
terrain's fragment and the only rows it could ever reach are `render` (the
main thread ISSUING draws) and `gap`, which is a residual containing vsync,
GC, layout and the GPU's work on 2.24M triangles. Reading the gap as "the
shader" is the claim this file already withdrew once. `hydro phases` carries
the build profile by phase. `search` is timed INSIDE the per-texel loop, so it
is printed as a subset of `texels` rather than added twice, and `other` is the
residual no lap covers, so the row sums to the mean and nothing can hide in it.

**`rest` WAS TWO THIRDS OF A BUILD, WHICH IS A PHASE NAME MEANING "THE REST OF
IT".** Split into `fill`, `majority`, `occlude`, `extent`, `shore`, `ground`
and `pack` — and every one of those is a FULL-GRID pass, which is the finding.
Measured on the Yosemite capture (`devtools/hydro-phases.mjs`, `at-yosemite`,
settled, nodraw):

| | mean | of a build |
|---|---|---|
| texels (the per-item paint loop) | 6.7 ms | 15% |
| fill (extend body parameters past the mask) | 8.4 | 19% |
| sources (the nearest-source map) | 6.1 | 14% |
| majority (the 3x3 pinhole close) | 4.5 | 10% |
| pack (geometry/dynamics/material) | 4.5 | 10% |
| shore (two distance transforms) | 4.1 | 9% |
| ground (sampleElevation per texel) | 3.7 | 9% |
| ocean (the mask and the retention) | 3.3 | 8% |
| extent, coast, analyse, raster, other | 2.0 | 5% |

**AND 296 OF 38,309 TEXELS WERE WET — 0.77% — WITH FIFTEEN OF TWENTY-TWO
BUILDS HOLDING NO WATER AT ALL.** A tile is charged for its AREA and not for
the river in it. That is the whole story at Yosemite, and it is why the
Breede's cut (candidates once per area, the search once per 2x2 block) could
not help here: those were about the water, and this is about the tile.

**A WATERLESS TILE NOW WRITES ITS FIELD'S CONSTANTS.** Every one of those
passes provably produces a constant when the coverage array is empty — the
source map answers -1 everywhere so the fill writes nothing, the majority pass
tests a `kind` only a paint sets, an occluder's loop `continue`s on every
texel, `waterLevels` is empty so the datum is the ocean level and the mesh
bounds are undefined, `wet` is all zero so the signed shore distance clamps to
exactly `-shoreDistanceLimitM`, and level, depth, flow, fetch, scale, kind,
seed, turbidity and flags are all still zero-initialised. Two strided writes
replace eleven passes. **The ground channel is NOT skipped**: it is the terrain
under the tile, true whether or not there is water on it, and `shore-contour`
reads `field.ground`.

- **THE RETENTION IS UPSTREAM OF THE FLAG, WHICH IS WHAT MAKES IT SAFE.**
  `anyCoverage` is set by `paint` AND by the last-known-good retention, so
  "dry" means dry after the previous field has been consulted and not merely
  "nothing arrived this time". A short-circuit reading only the paints would
  take away the straight-edged rectangle of sea that retention exists to keep.
- **IT IS A FLAG, NOT A SCAN**, because the scan it would replace is itself
  one of the full-grid passes it exists to skip. Set before the rank guard in
  `paint` on purpose: a paint this one loses to is a paint that has already
  put coverage over the threshold on that texel.
- **`waterless` AND `dry` ARE DIFFERENT THINGS.** The first is the tile, the
  second is what this build did about it. Kept apart so `?hydrodry=0`
  classifies the SAME population — otherwise the control's "mean over all
  builds" would be compared against the fix's "mean over seven".

**Measured**, `at-yosemite`, the switch the only difference:

| | `?hydrodry=0` | short-circuit |
|---|---|---|
| a build with NO water (15 of 22) | **18.5 ms** over 19,600 texels | **4.0 ms** |
| a build WITH water (7 of 22) | 120.8 ms over 78,400 texels | 127.6 — run noise, untouched |

Held by `devtools/hydro-dry.test.mjs`, which drives the SHIPPED function
beside the one it replaced (extracted with `git show REV:`, default HEAD) and
requires every channel of every field to be identical — geometry, dynamics,
material, ground, the scalars, structure, waterfalls and coast — on three
fixtures: a waterless tile, a river tile that must take the untouched path,
and a featureless rebuild handed a previous field, which is the retention case
that could delete a sea. **The old code is the test's control**, the rule
`clip.test.mjs` set; the negative control was run (a millimetre on the dry
shore constant fails it).

**WHAT IS LEFT, AND IT IS THE BIGGER HALF.** A build WITH water is 121-128 ms
over 78,400 texels for 296 wet ones — 0.4% — and every pass above still walks
all of it. The field is CONSTANT outside the shore-distance band
(`shoreDistanceLimitM` 180 m, about 19 texels at a flowing tile's 9.4 m), so
the honest next cut is to run `fill`, `majority`, `shore`, `ground` and `pack`
over the covered texels' rect padded by that reach and fill the outside with
the same constants the dry path already writes. It is not made here because
`fill` deliberately extends a body's level BEYOND the visible mask and the CPU
readers (`sampleRestingSurface`, `sampleBankField`, `drawnHydroAt`) sample the
field anywhere in the tile — so the bound has to be shown not to move those
answers, which is a measurement and not a reading.

**AND `flowingFieldResolution` IS A 4x GRID, NOT THE 1.27x ITS COMMENT
CLAIMS.** `hydro-resolution.test` reads 22.1 ms at 128 against 41.7 at 256 on
its own fixture — 1.9x, fair, because the water fills that tile. At Yosemite a
flowing tile is 78,400 texels against a waterless one's 19,600 and the river
covers four texels in a thousand, so the same choice costs four times the
grid to place a bank the player is a kilometre from. The dial is right where
the water IS the tile and wrong where it is a thread through one; a resolution
chosen from the covered SHARE rather than from "any flowing observation" is
the other half of the cut above.

`devtools/hydro-phases.mjs` is the instrument: the phase split, the ns/texel
(which is what tells an expensive pass from a big grid), the wet share, and
the wet/waterless build split, on a fixture or at a live `SPOT=`. **`nodraw`
is safe here** — the measurement is CPU milliseconds inside a synchronous
function, not pixels and not throughput, so the software renderer can only
change how often the frame loop asks for a build, not what one costs.

**AND THE BENCH THE DOCTRINE NAMED DID NOT EXIST.** `node_modules/.cache/hydrobench.ts`
reproduced the Breede's 292 ms to the millisecond and is GONE — that directory
is not in git — so this file named a tool nobody had. A capture answers the
same question through the ACTUAL feed path (`hydroFeed` gathers the features,
builds the ocean mask, traces the cover's inland water), needs no
reconstruction to go stale, and is checked in beside the number it explains:
`at-yosemite` (37.73606,-119.63732, r=1400 m, cover classes 10/30/60/80, the
Merced and 1,202-2,417 m of granite) is the first fixture in the repo that
holds the river the dump was about.

### The Forth: three bridges, three claim paths, and one of them reached its entry

Asked for from the seat as the landmark test case — *"see forth bridges as a
test case/fixture as well, especially as named/well known landmark cases"* —
and it is the best one on earth: three famous bridges in a row over one firth,
each reaching the painter by a DIFFERENT route. Captured as `at-forth`
(56.00636,-3.39091, r=1200 m; the first capture attempt timed out at 900 s on
64 cold tiles and was re-run in the background).

**A BRIDGE IS CLAIMED THREE WAYS, AND ONLY ONE OF THEM IS A NAME.**

| path | what decides | at the Forth |
|---|---|---|
| a landmark entry, by NAME | `bridge:name ?? name` contains one of the entry's `match` strings, within `reach` (1.6–2.4 km) | the Queensferry Crossing and the Forth Road Bridge, once they had entries |
| a landmark entry, by POSITION | the name says nothing either way, and the assembly's centroid is within `BRIDGE_ON_R` (420 m) of the entry | the 1890 Forth Bridge — its four ways are named `East Coast (Northern) Line` and carry no `bridge:name` at all |
| OSM's own `bridge:structure` | the recipe reads the tag | the Queensferry Crossing, before it had an entry |
| the recipe | nothing said anything; a family is rolled, and REFUSED past 150 m | the Forth Road Bridge, before it had one — a 1,006 m suspension bridge drawn as a deck on piers |

**AND NOTHING COULD SAY WHICH HAD HAPPENED.** `__bridges()` reported the form
and not the authority, and a `truss` that came out of a roll is
indistinguishable from a `truss` an entry asked for — so "is the Forth Bridge
claimed?" could only be answered by inferring it from the output. That is the
same fault this file records for the terrain's cell table one layer down: **a
probe that reports the OUTPUT and not the AUTHORITY cannot witness a claim.**
`BridgeAssembly.claim` is the entry's id, `tags`, or `recipe`, and `spanM` —
the LONGEST FRAGMENT, not the total, because a bridge split into eight deck
pieces would otherwise read as eight times its own length — is beside it.

**THE GUARD THE GEOMETRY FORCED, AND IT HAD TO GO IN FIRST.** The Forth Road
Bridge and the Queensferry Crossing stand about 250 m apart at their nearest,
which is INSIDE the 420 m positional radius — a radius sized against a firth
with two bridges in it, and this is a firth with three. So the moment the road
bridge had an entry, any Queensferry fragment not carrying the crossing's own
name (an approach, a slip, a ramp) became a positional candidate for a
SUSPENSION bridge it is not, and would have worn portal towers and a catenary.
`bridgeEntryFor` takes a `tagged` flag now: **a positional claim stands down to
OSM's own `bridge:structure`, and a NAME match still beats it** — an entry
saying "this is the Humber Bridge" is more specific than a tag saying "this is
cable-stayed", and a positional GUESS is weaker evidence than a surveyor's tag.
It was written BEFORE the two entries, from reading the geometry; it is the one
hazard in this unit that a frame would have shown as a plausible-looking wrong
bridge rather than as an absence.

**Measured**, `at-forth`, settled, the two entries the only difference:

| bridge | before | after |
|---|---|---|
| Forth Bridge (rail) | `forth-bridge` **by position** · truss / cantilever · 3 towers, 1,568 panels | unchanged |
| Queensferry Crossing | **`tags`** · cable-stayed / a-frame · 1 tower, 94 stays | **`queensferry-crossing`** · mast / fan · 2 towers, 120 stays, deck to 50 m |
| Forth Road Bridge | **`recipe`** · girder · **built nothing** | **`forth-road-bridge`** · suspension / portal · 2 towers, 588 hangers, 1,800 quads, deck to 44 m |

One of three reached its entry before; three of three do now, and the rail
bridge — the one that never had a name to match on — is the one that already
worked, because its entry's coordinate was doing the job all along. The other
three assemblies in the box (Fife Circle Line, Hopetoun Road, and one unnamed
way) are 16–23 m and correctly stay `recipe` · girder, building nothing.

**AND `spanM` IS A FRAGMENT, WHICH AT THE FORTH IS MOST OF THE PROBLEM.** The
longest fragment of the Forth Road Bridge measures **342 m** and the crossing's
**363 m**, against bridges of 1,006 m and 2,700 m — OSM splits a long bridge at
its towers, at its carriageways and at every tile edge, and each piece is a way
of its own. So the tool's "a long span nobody claimed" check is a check on
FRAGMENTS, and so is the clearance rule's wet-span measurement, and so is the
recipe's own 150 m refusal. That is the limitation this file already records
from the uMngeni (one structure, two assemblies), met again at a bridge whose
assembly is right and whose longest way is a third of it: **the assembly
already gathers the fragments, and teaching the measurements to read IT rather
than the way is the open work.**

**THE QUEENSFERRY CROSSING GOT TWO TOWERS AND ITS ENTRY AUTHORS THREE, and
that is reported as observed rather than claimed.** A station stands BETWEEN
the fragments it finds (a twin carriageway gets one tower, not two beside it),
so a station with no fragment on one side of it stands nothing up; the capture
holds ten fragments and they do not span the whole crossing. Whether the centre
tower appears on the live world with the full set streamed is untested — the
fixture is what was measured, and the fixture is 1.2 km of a 2.7 km bridge.
Its real stay cables also overlap at that centre tower, which is the one thing
in its silhouette the painter cannot draw at all.

`devtools/bridge-landmarks.mjs` is the instrument and it REPORTS rather than
asserting a form per bridge: what a famous bridge should look like is a
judgement in `landmarks.ts`, and a test restating it here would be the same
table twice. What it FAILS on is structural — an assembly whose spec names a
non-girder form and whose painter built nothing, and a span over `LONG_M`
(150 m) that nobody claimed, which is the landmark-entry gap rather than a
defect and is printed as one.

## The labs

`/lab` lists them; each is `/lab/<slug>`, registered in `client/labs.ts`.

| slug | what it isolates |
|---|---|
| `hydro` | water fields, coastlines, river profiles |
| `marks` | the production façade shader and its graffiti |
| `facade` | one building at the survey's stand-off: the production façade shader and roof, the culture's own wall and roof canvases, and the massing, the plinth and the whole opening grammar on dials |
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

### The tree budget was divided among families the place does not grow

Reported from the seat, on the Yosemite build: *"I did see trees popping into
view, I would expect them to come into view a lot further out."* The DRAW RANGE
dial was 700 m and the dump read `edge b466/c223` — so the dial was not the
distance, and the thing that set the distance was the triangle budget.

`ezCapScale` divided `treeTriBudget` by the cost of EVERY family at its FULL
nominal cap — five families, including the two the guild plants none of. At
Yosemite the place grows no acacia and no palm, their 321 and 275 slots were in
the divisor anyway, and the trees that are there sat pinned against a fraction
of their caps with the budget a third unspent.

**AND THE FIRST FIX FOR IT MOVED THE SEAT'S OWN COMPLAINT THE WRONG WAY.**
Cutting each family PROPORTIONALLY to what it wants is the obvious rule and it
punishes an under-supplied family: broadleaf has about 600 candidates against a
nominal 1600, so the old over-allocation (1600 x 0.46 = 735 slots for 600 trees)
let every one of them stand, while a proportional share (600 x 0.748 = 449) cut
a quarter of them and brought the edge **IN from 700 m to 671**. Half a
regression, and the half that regressed was the number the report was about.

**SO THE BUDGET IS FILLED RATHER THAN DIVIDED.** Water-filling: a family that
wants less than its share takes what it wants and hands the rest back, the round
repeats until nobody is over-served, and what is left is split among the
families that can still use it. Two properties the proportional rule lacks —
nobody is capped below what they would have drawn anyway, and the total cannot
exceed the budget. `?treedemand=0` is the old all-families divisor and the A/B.

**Measured**, `devtools/tree-edge.mjs` on `at-yosemite`, settled, no page
errors, two boots with the switch the only difference (sound here for the same
reason the sward correlation is: the quantity is a CPU allocation over a fixture
and the counters come out identical run to run):

| | all-families divisor | water-filled |
|---|---|---|
| broadleaf cap · edge | 735 · **700** | 601 · **700** |
| conifer cap · edge | 643 · 480 | **953 · 583** |
| snag cap · edge | 206 · 553 | **306 · 629** |
| acacia cap · palm cap | 321 · 275 | **0 · 0** — the place grows neither |
| triangles drawn | 987,367 | 1,191,677 |

**READ `edge` AGAINST THE RANGE, AND KNOW WHAT IT MEANS WHEN THEY ARE EQUAL.**
`ezEdge` is initialised to `treeRange` and is only assigned where a family is
actually cut (`list.length > cap`), so **edge == range means NOT CAPPED** — and
that covers the degenerate case too: acacia and palm read 700 in both columns
because they have no candidates at all, which is "no trees and therefore no
edge" rather than "trees all the way out". A column of 700s is not a result
until the cap beside it is read.

So the water-filled column says three things and only the first is a win in the
usual sense: conifer and snag gain a hundred metres apiece; broadleaf STOPS
being cut, which is the regression removed; and acacia and palm take no budget,
which is what the whole unit was about.

### …and then a tree was charged its family's mean, not this place's tree

The budget was filled and the frame still drew half of it. Water-filled, settled
at Yosemite, the allocator priced its caps at **2,399,673 triangles — the budget,
to the last three hundred — while the GPU was handed 1,191,677.** Conifer and
snag were still cut, so the budget was binding, and it was binding on arithmetic
that was wrong by a factor of two.

**PLACEMENT IS NOT THE LEAK, and that is the measurement that decides which fix
this is.** 588 of 601 admitted broadleaf stood, 946 of 953 conifer, 304 of 306
snag: admission IS placement, so the error is the PRICE of a tree and not the
fate of one. Per family, charged against drawn:

| | atlas mean | drawn per tree | |
|---|---|---|---|
| broadleaf | 1107 | 1068 | ×1.04 |
| **conifer** | **1713** | **543** | **×3.15 — and this is the binding one** |
| snag | 333 | 188 | ×1.77 |

`meanDrawn` is the mean over a family's WHOLE ATLAS and a place grows two of its
six silhouettes — the two-scale palette's own doing, and the thing that makes a
wood one wood rather than confetti. So the family whose cap actually binds is
priced by variants that are not standing here: **conifer was charged 68% of the
budget for 21% of the frame.**

The refresh knows what a tree really cost, because it has just placed them all
and every tier carries its own triangle count. The price is the LAST refresh's
realised cost per placed tree, with the family mean as the first sweep's guess;
it converges in one sweep and stays converged, since the palette is stable per
district and does not reroll as you drive. The clamp — a quarter to four times
the mean — is INSURANCE against a sample taken mid-sweep and not the rule: a
place may honestly grow a family's dearest silhouette, so the price must be free
to exceed the mean. `?treeprice=0` charges the atlas mean again.

**Measured**, `devtools/tree-spend.mjs` on `at-yosemite`, both legs settled, no
page errors:

| | atlas mean | as drawn |
|---|---|---|
| conifer price · cap · placed · edge | 1713 · 961 · 953 · **583** | **575 · 1400 · 1385 · 652** |
| snag price · cap · placed · edge | 333 · 308 · 306 · **629** | **192 · 439 · 437 · 700** |
| broadleaf price · cap · placed · edge | 1107 · 588 · 576 · 700 | 1068 · 600 · 576 · 700 |
| charged | 2,399,673 | **1,530,088** |
| drawn | 1,191,677 — **50% of what it was charged** | 1,495,767 — **98%** |

**THE ESTIMATOR IS THE FIX AND THE ESTIMATOR IS NOW HONEST**: 98% against 50%,
so the number the allocator reasons with is the number the GPU is handed. Forty
per cent more conifer and snag stand, the bill rises 1.19M → 1.50M, and it is
still well under the 2.4M budget that was previously reported as fully spent.

**AND WHAT BRINGS CONIFER IN AT 652 m IS NO LONGER THE BUDGET.** Its cap is 1400
— `VEG_CAP.conifer` times the rack's POPULATION CAP — so at Yosemite the
triangle budget binds nothing at all now and the remaining edge is the
population stop, which is a dial a player owns (0.25×–16×) and is meant to bind.
That is the honest end of this thread: the pop-in the seat reported was three
faults deep — a divisor counting absent families, a proportional cut that
punished a thin wood, and a price three times the tree — and past them the
levers are the rack's own.

**THE DUMP COULD NOT HAVE SEEN ANY OF IT.** It reported the caps and never their
price, and a cap is a CONSEQUENCE of a price — the same fault this file records
for the terrain's cell table and for `BridgeAssembly.claim`, met again: a probe
that reports the output of a rule cannot witness the rule. The trees row carries
`price b1068/c543/s188` now and `__ez().price` sits beside the mean it replaced.

### A tree should exist before it becomes geometry

Asked from the seat, as the reframing after the budget work: *the tree cap is
the wrong abstraction. A tree should be a persistent fact about the world; only
its representation should become cheaper with distance.* Right, and the
distinction it turns on is that "trees pop in" is two different transitions —
**population pop** (the tree does not exist in the renderer until it enters a
radius or a budget) and **representation pop** (it exists and changes
abruptly). An impostor answers the second. It answers the first only if the
cheap descriptor is known considerably further out than the geometry is built.

**WHAT THE READ FOUND, and it is one function.** `vegRefreshSteps` walked ONE
ring and did all three jobs on it:

```
reach = ceil(max(VEG_RANGE 700, treeRange) / VEG_CELL 220)
pass 1  seedCell(cell)                  ← the MANIFEST was created here
        cand[fam].push(site, d²)          if d² < treeR²
pass 2  cap  = ezCapFor(fam)
        list = nearestStable(list, cap)  ← MEMBERSHIP
        ezEdge[fam] = √(list[cap-1].d²)  ← and the VISIBLE EDGE
pass 3  seedCell(cell) again; admitted sites become matrices
```

So `ezCapFor` was doing three jobs at once — the triangle allocation, the
population rule, and the horizon — and `seedCell` ran only inside the ring the
geometry is drawn in. **Past `treeRange` there was no tree at all**: not a
cheap one, not a mark, nothing to render.

**THE DESCRIPTOR ALREADY EXISTED.** `PlacedVegSite` carries x, z, kind, scale,
yaw, height, colour, non-uniform width and lean; the form comes from
`ezVariantAt`, deterministic from the district and stand seeds in `culture.ts`
and therefore stable under a world rebase; the wind phase is derived in-shader
from world position, so anything drawn at that position leans with its
neighbours for free. What was missing was not the record — it was the record's
REACH.

**AND THREE OF THE FOUR LAYERS ALREADY WORK THIS WAY**: the substrate is a
persistent field, the sward is a persistent density field drawn as blades near
and as terrain colour far, and `refreshShrubs` picks its membership by a STABLE
PER-SLOT HASH against that field, thinned outward — which is the
`rank = hash(id)` rule, already shipped, one layer down. Trees were the layer
that conflated existence with geometry.

#### The manifest is its own radius

Sites seed out to `manifestRange` (twice the draw range, capped at 2.8 km,
`?treemanifest=` in metres); candidates are gathered, admitted and drawn inside
`treeRange` exactly as before. Four things make that safe, and each was a
decision rather than a default:

- **IT IS A SECOND WALK, NOT A WIDER `reach`.** The gather pass iterates every
  site of every cell, and widening its ring pays that over four times the area
  to throw the results away on a `d² < treeR²` test — a device dump already put
  gathering at 14 ms over a 27×27 ring. `squareRings` takes a `from` now, so
  the manifest pass covers only its own ANNULUS.
- **IT RUNS LAST, after the commit.** `vegSeedLeft` is spent in walk order and
  both walks are centre-out, so the near cells are always served first: a wider
  manifest can only delay the far country, never the ground under the wheels.
- **THE EVIDENCE IS ALREADY THERE at that radius**, which is what makes it
  affordable at all. `seedCell` waits on the cover raster (z12, a 7×7 ring,
  ~28 km) and the ecoregion (z5, ~1250 km tiles). Both reach far past any
  plausible manifest, so this needs no new streaming — the failure a wider ring
  would have had is simply not present. The same is true of height: `groundAt`
  is read at PLACE time on every refresh rather than baked into the descriptor,
  so a tree's Y follows the DEM as it refines and cannot pop when a finer tile
  lands.
- **THE CELL PRUNE FOLLOWS `mReach`.** It drops cells beyond `reach + 3`, and
  left alone it would have deleted what the pass had just seeded.

`vegManifestTally` reports KNOWN against DRAWN — two numbers that were one
until now — on `__ez().manifest` and as its own telemetry row. It is walked on
demand and never from the frame loop: it is the O(cells × sites) cost the
gather pass is kept narrow to avoid, and a probe may be expensive where a
refresh may not.

#### …and the witness is in node, not in a frame

The claim is that NOTHING ON SCREEN CHANGES, and `client/perf-check.mjs`
asserts exactly that: it runs the shipped refresh against the pre-slice
baseline over a deterministic mock world, with `manifestRange` stubbed at
**twice** the draw range so the new pass actually executes rather than being
skipped as a no-op. **20 of 20 production refills byte-identical** — the same
matrices, colours and counts. A pair of browser boots could not have said this
as strongly, and would have taken six minutes rather than one second.

**THAT CHECK HAD BEEN RED FOR THREE COMMITS AND NOBODY NOTICED — including
through two deploys.** Bisected: green at `7e45e50`, red from `8acecfe` (the
demand allocator) onward, because the VM sandbox had no `EZ_DEMAND`,
`ezCapNominal`, `ezTriPrice` or `treeTriBudget` and the refresh threw on its
first call. The file's own doctrine already warns that its baseline goes stale
on any change to the refresh; what it did not say, and now does, is that **a
sandboxed check breaks on a new free variable, silently, and the only way to
know is to run it.** It is in the ladder for that reason.

**And the cap rule stays stubbed on both sides of it, deliberately.** The claim
is that the refill is identical GIVEN THE SAME CAPS; the rule that sets the
caps changed three times in one day and has its own A/Bs (`tree-edge`,
`tree-spend`). Wiring `ezCapFor` to the allocator would make a baseline that
predates the allocator differ for a reason that is not a regression, and the
check would then be loosened until it meant nothing.

**AND THE FIRST DEPLOY'S CAP WAS IN THE WRONG UNIT, which a device dump caught
in one row.** `MANIFEST_MAX_M` was 2,800 m — a generous-looking ceiling that is
EXACTLY the tree rack's own widest DRAW stop. The seat drives at `range 2800m ·
pop 2x`, so the manifest equalled the draw ring, the annulus was **zero cells**
and the pass walked nothing — while the telemetry printed `manifest 2800m ·
cells 729/729` as though it were filling. **A ceiling expressed in the wrong
unit is a ceiling that can silently coincide with the floor**, and a row that
cannot report its own no-op is a row that misleads: it says `annulus NONE` now,
beside the draw range it is being compared against.

The bound is in CELLS (`MANIFEST_MAX_CELLS`), because cells are what costs —
the seed time is per cell and so, far more pressingly, is the MEMORY, since
`vegGrid` holds every cell's site list inside `mReach + 3`. The same dump sizes
that: **57,112 trees across 729 cells, about 78 a cell** before the non-tree
kinds are counted. So: 225 cells at the 700 m default against the ring's 81,
and 1,089 at the 2.8 km stop against 729 — an annulus of 360 rather than none.

**WHAT THAT DUMP DID ESTABLISH**, on an iPhone at the widest rack stop, and it
is the more useful half: the 729-cell ring is **fully seeded with nothing
deferred**, so the 8 ms budget keeps up with a ring nine times the default's
area; the manifest pass itself costs **0.0 ms**; and the world knows **57,112
trees while drawing 2,297 — four per cent.** The other ninety-six are the
headroom, and they are not where the previous section assumed: `cap 24%` with
`tris 2.40M` exactly at budget puts **conifer's edge at 318 m inside a 2,800 m
range**. At this rack setting the pop the seat sees is the CAP, well inside the
ring, not the ring's own edge — so the first thing an impostor tier owes is the
cap-cut trees, which are already gathered and need no manifest at all.

**AND THE ADMISSION IS THE TREE COST NOW.** `ezAdmit 9.0 ms a call, max 22`
against `ezGather 2.3` and `place 2.2`: a heap selection of 2,297 from ~57,000
candidates, once a refresh, and `treeRefresh` is 4.5% of the session and the
top non-gap phase in most of the slow frames. Whatever membership rule the
impostor tier uses, **it must not be another nearest-N over that population** —
the stable per-slot hash `refreshShrubs` already uses is the shape that scales.

**AND THE TREES ARE 2.40M OF THE FRAME'S 3.51M TRIANGLES.** Sixty-nine per
cent, at 185 draw calls and 22.9 fps with 73% of wall time in the unattributed
gap. That is the performance case for an impostor stated in the only numbers
that can make it: the triangle bill and the share of it vegetation owns.

**Measured live** (`devtools/tree-manifest.mjs`, `at-yosemite`, `?treemanifest=700`
— the single ring — against the default 1400 m, no page errors either leg):

| | one ring | manifest |
|---|---|---|
| cells seeded | 81/81 | **225/225** |
| broadleaf known · placed · edge | 601 · 589 · 700 | **2,412** · 589 · 700 |
| conifer known · placed · edge | 1,801 · 1,385 · 652 | **8,487** · 1,385 · 652 |
| snag known · placed · edge | 439 · 437 · 700 | **1,644** · 437 · 700 |
| **KNOWN total** | 2,841 | **12,543** |
| **DRAWN total** | 2,411 | **2,411** |
| of known, drawn | 85% | **19%** |

**Every placed count and every edge is identical to the tree**, which is the
second witness to `perf-check`'s byte-identity; the manifest fills COMPLETELY
(225 of 225 cells) under the existing seed budget; and **four in five trees the
world now knows about have no representation at all.** That last number is the
headroom the impostor tier draws into, and it did not exist as a quantity
before this unit — the renderer's reach and the world's reach were one number.

**READ THE `settled` LINE: the second leg is flagged provisional.** Its gate
wants the drawn triangles AND the seeded-cell count quiet for four consecutive
polls, and over 327 s it never saw four in a row — the cells reached 225/225
and held, so it is the triangle count moving by a tree or two on the harness's
two-second frames. The identity claim does not rest on the gate: the placed
counts and edges match the SETTLED first leg exactly, which is the comparison
that matters. A gate that demands two signals be simultaneously still is
stricter than either claim needs, and is worth loosening before the next run
rather than being read as a failure.

### A first-pass impostor: a tree acquires detail, not existence

The seat's reframing after the budget work: *the tree cap is the wrong
abstraction. A tree should be a persistent fact about the world; only its
representation should become cheaper with distance.* The manifest made the fact
reach past the geometry; this is what stands where the geometry does not.

**IT DRAWS WHAT ADMISSION TURNED DOWN, not what is past the ring**, and the
device dump is why: at the seat's rack the budget is spent to the last triangle
and conifer's edge is 318 m inside a 2,800 m range. The population the player
watches appear is cut by the CAP, well within the ring — and those trees are
already gathered, so the tier costs no new walking at all.

**MEMBERSHIP IS A STABLE HASH, NEVER A SECOND NEAREST-N.** `ezAdmit` spends
9 ms selecting 2,297 of ~57,000; another selection of that shape over the
remaining fifty-four thousand is neither affordable nor correct, because a rank
that moves with the truck is the reshuffle this programme is removing. The hash
is keyed on the tree's own position — decided once, the same from every vantage
— and thins as the inverse square, which is constant density on the GLASS.

**AND FULL DENSITY STARTS AT THE FAMILY'S OWN ADMITTED EDGE.** The first cut
thinned from a fixed 260 m while the geometry stopped at 428, so every tree the
tier could draw was already deep in the thinned region and ONE IN FIVE stood up
(321 of 1,614). A tree a metre past the edge must be drawn with near-certainty
or the handoff is a thinning, which is the pop wearing a gentler name. Anchored
to `ezEdge[fam]`: 932 of 1,614, and the rule is adaptive in the right direction
— a family the budget cuts hard starts thinning early, one it barely cuts thins
late.

Four more decisions, each with its reason in the code: the form is the TREE'S
own, cached per site (a cone at 400 m that is a round crown at 200 has changed
species in front of the player) at 400 new ones a refresh; the instance matrix
is translation and scale only, so the billboard is one line and the tree's yaw
phases the SILHOUETTE rather than turning the card; two cards weighted
continuously by the camera's elevation, set in `aimSky` because the dock's POV
is 1.3 m up while the chart's may be kilometres; and the ground is the raster,
not `groundAt`, because nothing here is nearer than the cap edge and the mesh
read is the refresh's dearest call.

**Measured**, `devtools/tree-impostor.mjs` on `at-yosemite` at a 900,000
triangle budget, ONE boot, interleaved off / on / off:

| | |
|---|---|
| skeletons | 0.88M triangles, edges b689 / c428 / s482 |
| impostors | **932 of 1,614 offered · 3.7k triangles · 0.42% of the vegetation bill** |
| the off leg | drew 0 |
| census (independent) | `veg-impostor` 3,728 triangles in the scene — 932 × 4, exactly |
| whole frame: floor / signal | 0.904 / **2.248** /255 |
| the canopy band: floor / signal | 0.325 / **10.673** /255 · 0.85% / 10.77% of pixels |

**THE WHOLE-FRAME NUMBER UNDERSTATES IT BY AN ORDER OF MAGNITUDE, and the band
is why.** A chase frame is mostly sward and sky; this tier draws in a strip at
the treeline. Read whole it clears its floor by 2.5x, read over a band that
still caught the grass by 3, and read over the canopy alone by **33**. The
signal never moved — what changed is how much of the measurement was of
something else. *A mean over pixels the term cannot reach is not a weaker
measurement, it is a different one.*

And the frames say what the numbers cannot: the wood's canopy had HOLES in it
where the cap had cut trees, and the impostors fill them — dark green masses in
the same tone as the skeletons beside them, not sprites standing out of a
treeline. **That is the tier's real job stated as a picture**: the cap was not
merely bringing the edge in, it was leaving gaps in the middle of a wood.

**NOT DONE, DELIBERATELY:** the manifest's annulus is not drawn (it needs its
own gather, and the cap is the louder fault); there is no geometry-impostor
dissolve, because a dissolve between representations that do not yet agree
hides the disagreement rather than fixing it; and the side card faces the
camera about Y, so orbiting a NEAR impostor would turn its crown — a
directional atlas is the answer, and the distances this tier draws at keep the
swivel under the quantiser for now.

**THE TOOL'S OWN FOUR FAULTS**, because every one of them reported a working
tier as a broken one. `?treetris=` is in RAW TRIANGLES and was passed
megatriangles, so the budget was one triangle and no skeleton was admitted at
all — an A/B between nothing and impostors, which cannot show a handoff.
`__census()` returns `byTris`/`byCount`, not `kind`/`tris`, so the independent
witness read undefined and printed zero while 971 impostors were staged; and
`byTris` is the TOP TWELVE, so absence there is not zero and must be printed as
a different statement. `ez.placed` is an array of records (`[object Object]`,
for the second time this session). And `imgdiff`'s last line is the output
PATH, so the diff numbers were replaced by a filename.

### …and then the seat photographed it: the crown was lit in the wrong space

Five frames and a device dump, sent together with no words. The frames show
distant treelines as dark flat bands and very large dark masses in the drone
shots; the dump names a cost regression. Two separate faults, and the first is
one line.

**`normal` AT `normal_fragment_begin` IS VIEW SPACE, AND THE CARD WROTE WORLD
SPACE INTO IT.** three fills that variable from `normalMatrix * objectNormal` —
the inverse-transpose of the MODEL-VIEW matrix, so view space — and it is the
frame every lighting chunk downstream reads, and the frame the sun direction
arrives in. The first cut built the crown's analytic ellipsoid normal out of
`vImpRight` and `vImpOut`, which are WORLD directions built in the vertex
shader, and assigned it straight across. So the Lambert dot product was between
two different frames. Two consequences, and the second is the one the frames
show: the stands read flat and dark, and **their shading TURNED WITH THE CAMERA
rather than with the sun** — orbit the truck and a wood changes brightness. One
matrix multiply at the handover (`normal = normalize((viewMatrix * vec4(n, 0.0))
.xyz)`; three declares `viewMatrix` in every fragment shader it builds).

**AND THE DISSOLVE MOVED TO THE FRAGMENT, which is cheaper AND better.** It was
a per-instance colour mixed on the CPU — a `terrainPalette` and a `sampleCover`
for every faded tree in every refresh — and it STEPPED, because a refresh is a
few times a second while the distance to a tree changes every frame. It rides
the camera's own distance as a varying now (the vertex shader already had
`impFl`), continuous, and costs the membership pass nothing at all.

**IT GOES AFTER `color_fragment`, NOT BEFORE IT.** three's Lambert chain runs
`map_fragment` and THEN `color_fragment`, so at the block where the silhouette
is cut `diffuseColor` is still the material's white and the tree's own instance
colour has not arrived. A mix toward the ground written there is multiplied by
the tree afterwards — a DARKENING, darkest where the fade is strongest, which is
the opposite of a dissolve. The shade term beside it (`*= 0.78 + 0.30 * impLo`)
is a multiply and commutes; this one does not. **The general rule: a chunk
injection's correctness depends on where in the chain it lands, and a multiply
and a mix do not have the same answer to that.**

### The two dials, and why REACH has to report three numbers

Asked from the seat: *is there a dial I can experiment with more or less
aggressive imposters (range near and far? Beyond 2.8km?) — the dial should have
wide extremes either side of 'stock'.* Two dials, because the seat was asking
two different questions and one number cannot answer both:

- **IMPOSTOR REACH** — `OFF · 0.5X · 1X · 2X · 4X · 8X` of the DRAW RANGE, so
  the pair compose: a rack already at 2.8 km asks for 5.6 or 11.2 km and the
  answer is a horizon rather than a wall. OFF stands the whole tier down, which
  is also the A/B `__impostor()` drives.
- **IMPOSTOR DENSITY** — `0.25X · 0.5X · 1X · 2X · 4X · ALL`, scaling the
  inverse-square keep probability, which is the same thing as scaling the
  full-density radius squared. So 4X thickens a far wood without moving its
  edge and 0.25X thins it without bringing the edge in.

**Move either and the other holds**, which is the property that makes them two
dials rather than one aggressiveness slider. `?impreach=` is in METRES (the unit
the rack reads) and `?impdensity=` a bare multiplier, both exact and unsaved.

**REACH IS A REQUEST, NOT A SETTING, and that is why the readout carries three
numbers instead of one.** A tree can only be drawn if it is KNOWN, and what is
known is the manifest, which is bounded by cells, which is bounded by memory. So
the dial ASKS, the manifest GRANTS, and the row says which of the two bound it:
`reach 5600m of 11200m asked (MANIFEST)`. Reporting the grant alone would repeat
`MANIFEST_MAX_M` exactly — a ceiling silently coinciding with a floor, and a row
that reads plausibly while the dial above it does nothing.

**AND THE MANIFEST'S CEILING LIFTS WHEN SOMETHING ASKS.** `MANIFEST_MAX_CELLS`
(1,100, about 3.5 km) is sized for the manifest's OWN purpose — knowing a little
further than the geometry draws, so the far edge is a handoff rather than a
frontier. The REACH dial is a different purpose: it asks the manifest to BE the
population it draws. Clamping that to the stock ceiling would make the dial's
upper stops lie, so `MANIFEST_MAX_CELLS_WIDE` is 6,241 — 38 rings at 220 m,
about 8.4 km, and on the order of a third of a million sites held in `vegGrid`.
Deliberately unsafe at the top, exactly as the rack's other tree stops are: it
exists to find the wall rather than to promise there is not one.

**THE FAR CANDIDATES ARE A SEPARATE LIST, AND THE SEPARATION IS LOAD-BEARING.**
`cand[fam].length` is the DEMAND the water-filling allocator divides the
triangle budget by, so a tree six kilometres out joining that list would take
slots from a tree at four hundred metres and move the admitted edge IN — the
proportional-cut regression, arrived at by a different road. `candFar` is
gathered in its own annulus in the `ezGather` phase (which already walks cells
with a `yield` between them, and where the manifest's cells are), and nothing
beyond the draw range may vote on the geometry budget. It may only ask for a
card.

### And the membership pass had become the largest tree phase

The same dump: `impostor 12.6 ms/call (max 34)` in `tree phases`, above
`ezAdmit 8.6` — because the pass walks all 54,997 offered candidates. Three
cuts, each against something the dump named, and none of them cleverness:

- **THE MATRIX IS WRITTEN, NOT COMPOSED.** `vegDummy.updateMatrix()` builds a
  full TRS from a quaternion, and this instance has no rotation BY CONTRACT —
  the vertex shader's billboard is one line precisely because the instance
  matrix carries translation and scale only. Writing the six live elements
  states that contract in the one place that could break it and drops a
  quaternion-to-matrix per impostor per refresh.
- **THE ADMITTED-SET LOOKUP IS SKIPPED WHERE IT CANNOT HIT.** Every tree the
  geometry took is within `ezEdge[fam]`, and the full-density radius is at least
  that, so beyond it the membership test cannot collide with admission and the
  `Set.has` is pure cost — an object-identity hash on the overwhelming majority
  of steps. And the density test is written as `hash * d2 > full2` rather than
  `hash > full2 / d2`: same predicate, no divide, and it is the hottest line in
  the pass.
- **THE LOOP IS INDEXED.** A `for (const [d2, v] of list)` over tuples pays the
  iterator protocol and a destructure per step, and at 55,000 candidates — more
  with REACH up — that is a measurable share on its own.

Not verified on a device: the harness's frames are seconds apart and cannot
price a per-refresh CPU cost the way a phone can. The next telemetry paste is
the verification, and the row to read is `impostor` in `tree phases`.

**Measured after all of it** (`tree-impostor.mjs`, `at-yosemite`, one boot,
interleaved off/on/off, at the stock dials so the comparison is against the
recorded numbers): 933 of 1,617 offered, census `veg-impostor` **3,732 = 933 x
4 exactly**, the canopy band's signal **10.416/255 against a floor of 0.252 —
41x** — so the tier draws exactly what it drew before the fixes, with the
lighting in the right frame.

### …and it was STILL solid black, because an undeclared attribute reads as zero

The seat again, with three frames, range high and population low to force the
tier: *impostors are still just solid black.* They were, and the view-space
normal above — a real bug, correctly fixed — was never the cause of it.

**`vertexColors: true` DEFINES `USE_COLOR`, AND `color_vertex` THEN MULTIPLIES
BY THE GEOMETRY'S `color` ATTRIBUTE.** three 0.160:

```glsl
#ifdef USE_COLOR
	vColor *= color;            // the GEOMETRY attribute
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
```

`impostorGeometry()` sets position, uv, `aCard`, a normal and an index, and no
`color`. **An undeclared vertex attribute reads as (0, 0, 0, 1) in WebGL**, so
`vColor` is zero and `color_fragment`'s `diffuseColor.rgb *= vColor` takes the
whole tier to black — silhouette perfect, alpha correct, lighting irrelevant.
`flora-ez.ts` sets one on every baked skeleton (its `decode` writes `col`),
which is exactly why the trees standing beside these were lit and these were
not; every other `vertexColors: true` material in this client draws geometry
that carries one, and the impostor is the only mesh whose geometry was written
fresh.

**TURNING `vertexColors` OFF IS THE WRONG REPAIR.** `USE_INSTANCING_COLOR` still
computes `vColor`, and this three's `color_fragment` applies it only under
`USE_COLOR` or `USE_COLOR_ALPHA` — so the tier would come out WHITE instead of
black. The fix is a `color` of ones: `vColor = 1 x 1 x instanceColor`.

**AND THE FRAMES CARRIED THE PROOF, which is worth knowing as a signature.** The
near impostor was pure black and the distant treeline a dark grey-green — that
second colour is the distance dissolve's own `mix(0, ground, 0.7)` running on
top of the zero. A thing that is black close up and tinted far away has been
multiplied by nothing, not lit wrongly.

### THE DIFF SCORED THE BROKEN BUILD HIGHER, AND THAT IS THE LESSON

`tree-impostor.mjs` measures how many pixels MOVED and by how much, against a
same-frame floor. **A tier drawing solid black holes in a green hillside moves
more luma than one drawing trees**, so the metric did not merely fail to catch
this — it rewarded it. Measured at `at-yosemite`, the same fixture and crop, the
broken build (`REV=42448df`) against the fix:

| | broken | fixed |
|---|---|---|
| band SIGNAL (the metric this tool was built on) | **10.524/255** | **7.83** |
| ink ON, over the pixels the tier changed | **18.3/255** — one palette step | **44.1** — two and a half |
| the hillside it replaced | 110.1 | 115.1 |
| changed pixels under 9/255 (half a step of black) | **27.3%** | **2.2%** |

So the tool now reports the INK: the mean luma of the changed pixels in the ON
frame beside what the OFF frame had there, and the share of them sitting at the
bottom of the ramp. That is a statement about the COLOUR where every other
number here is a statement about the CHANGE, and it is the fourth time this file
has recorded the same shape — the terrain's cell table, `BridgeAssembly.claim`,
`__tdetail().mat`, and now this: **a probe that reports that something happened
cannot witness what happened.**

**THE BAR IS IN PALETTE STEPS AND THE CONTROL IS ITS PROVENANCE.** One step is
about 18/255, so the gate is two steps of ink (36) and a tenth of the pixels at
the floor — and `REV=` was added to the tool for exactly this, because the first
cut of the gate (`on < 18`, `dark > 50%`) did NOT fire on the broken build and
was therefore decoration. A check that has not been shown to fail on the fault
it names is not a check. The broken build clears both new bounds by a wide
margin and the fix misses both by one.

**AND THE TIER HAS NO NEAR LIMIT, BY DESIGN — which is what the seat's forced
dials exposed.** Full density runs from the family's own admitted edge INWARD
with `keep` capped at 1, so with POPULATION CAP low the geometry's edge collapses
and a tree ten metres away is turned down by the cap and wears a card. That is
the tier doing its job (it draws what admission refused, wherever that is) and
it is also the module's own recorded caveat — *a directional atlas is the answer
and the distances this tier draws at keep the swivel under the quantiser* — met
at a setting where those distances are not the shipped ones. At stock dials the
nearest impostor is past the skeletons' edge; forced, it is in your lap, and a
two-card billboard at ten metres is a two-card billboard.

### …and the device priced the membership pass: a list you allocate to throw away

The verification the section above asked for arrived as a dump, at the seat's
own forced dials (REACH 8X, DENSITY 4X, Yosemite, 462 s, chase): `impostor
39.7 ms/call (max 85)` in `tree phases` — **five times `ezAdmit`**, the largest
tree phase, and the one phase in a deliberately resumable refresh that never
yielded. Beside it the row that explains it: `drawn 17709/450174 offered
(384669 past the draw ring)`.

**A LIST IS A THING YOU ALLOCATE AND THEN WALK TWICE.** Three hundred and
eighty-four thousand tuples built every refresh — several megabytes of
short-lived allocation — and then walked in full to throw away 96% of it on a
hash the gather could have run where the site was already in hand. The density
test needs the tree's position and its family's full-density radius and nothing
else, so it moved into the `ezGather` far annulus and `candFar` now holds only
survivors. **Reject at gather time, not in the pass** — the same shape as
`onCarriageway` being asked only of sites that survived admission, one layer up.

**THE RADIUS IT TESTS AGAINST IS LAST REFRESH'S EDGE, and that is the
`ezTriPrice` construction again**: the number this refresh needs is decided by
an admission that has not run yet, and the previous sweep's answer converges in
one and then stays converged, because the palette and the budget are stable per
district. So the far set is NOT byte-identical to the one the pass used to
build — it is one sweep behind after a hop and right from the second — and that
is the trade, stated rather than hidden.

**AND THE PASS YIELDS NOW, LIKE EVERY OTHER PHASE OF THE REFRESH.** One line,
every `IMPOSTOR_STEP` (4,096) candidates. What makes it free is the property the
sliced refresh already rests on: **staging is separate from the instances and
the commit is one slice at the end**, so a frame drawn between two slices shows
the previous sweep whole. A phase that writes into the instance buffers directly
could not have taken this line at any step size.

**THE READOUT PRINTS A PAIR NOW, BECAUSE ONE OF THE NUMBERS NARROWED.**
`offered` is what the PASS considered — every near candidate, and the far ones
that already survived the gather — so it is no longer the population the tier
was offered, and quoting it alone would understate the manifest by twenty-five
times. `impFarSeen` counts what the gather LOOKED at past the draw ring, and the
row reads `drawn A/B offered (C kept of D seen past the draw ring)`. A counter
whose meaning changes under a cut has to be renamed or paired; leaving it to be
read the old way is how a measurement quietly becomes a fiction.

**Verified, not measured.** `perf-check.mjs` is 20 of 20 production refills
byte-identical (its sandbox learned `IMPOSTOR_STEP` — at **64** there rather than
the game's 4,096, because at the game's step this fixture's lists never reach one
and a yield that never fires cannot witness that the commit is unaffected);
`tree-impostor.mjs` at stock dials draws **931 of 1611 offered, census
`veg-impostor` 3,724 = 931 × 4 exactly**, edges b689/c428/s482 unchanged, ink
**44/255 against the hillside's 111.2 with 2.3% at the floor** — the same
numbers as the run before the cut. **The cost itself is not verified here**: the
harness's frames are seconds apart and cannot price a per-refresh CPU cost, and
stock dials never run the far gather at all (`impR > treeRange` is false), so
what this proves is that the near path and the commit are untouched. The next
dump at REACH 8X is the measurement, and the row is still `impostor` in `tree
phases`.

### The atlas: the far tree is the near tree, photographed — and it is see-through

The seat's verdict on the first impostor was that it is a placeholder, and on
the skeletons beside it that they are *a little too skeleton like in general*,
with the ask stated plainly: get the impostors good enough and the ranges can
be tuned to make headroom for fuller trees. The headroom arithmetic is not in
doubt — an impostor is **4 triangles** against a drawn broadleaf's **1,068**
and a conifer's **543**, so anything the cards take over is returned to the
near field at about 130 to 1.

**IT IS BAKED ON THE DEVICE, AT RUNTIME, AND THAT WAS A DECISION.** The obvious
alternative is a devtool writing an atlas into the bundle beside
`flora-ez-baked.ts`. Three things against it, each a fault this file already
carries: the deploy transpile runs at seven tenths of the deployer's memory
ceiling and 27% of the bundle is already baked data; a baked asset goes STALE
the moment a recipe changes, and the thing it must agree with is itself
generated; and WHICH variants matter is the district palette's answer, which is
a fact about where the truck is standing and cannot be known offline. The cost
is thirty-three renders of a few hundred triangles per variant, one variant a
refresh, and a site whose variant has no slot yet simply waits a sweep.

**EIGHT AZIMUTHS, THREE ELEVATIONS AND A PLAN VIEW, ON THE CARDS THAT WERE
ALREADY THERE.** A full octahedral impostor — one view-aligned quad over a
hemisphere — was designed and REJECTED: the frame of a view-aligned quad is
undefined when the camera looks straight down, the chart camera looks 89.9
degrees down, and every candidate for that missing roll either spins with the
map or snaps at a tile boundary. An upright card has world up for its up at
every azimuth, which is exactly the frame the bake uses, so there is nothing to
resolve; the plan view is its own tile and its rotation is the TREE'S yaw,
which is a fact about the tree rather than the camera. The azimuth is read in
the tree's own frame and the two nearest tiles are MIXED, so turning past a
tree cross-fades rather than snapping forty-five degrees.

**`renderer.setViewport` IS READ BY NOTHING WHILE A RENDER TARGET IS BOUND, and
it cost a whole measurement.** three's `setRenderTarget` copies the live
viewport and scissor from `renderTarget.viewport` / `.scissor`, so a per-tile
`renderer.setViewport(...)` sets the CANVAS viewport and is then overwritten.
Every tile was rendered over the whole 1024-square atlas at full size, each
variant erasing the last, and the tier came back drawing a tenth of its pixels
with its ink under the black gate. The fix is two lines; what found it is that
the tool reports the tier's INK rather than only that pixels moved.

**AND THE PROBE READS THE ATLAS BACK, because the diff cannot.** A card
sampling an empty tile draws something and a card sampling a tree draws
something. `__impatlas()` returns, per baked slot, the share of every tile
carrying any coverage at all — so a bake that rendered into the wrong viewport,
or framed the tree outside its own box, is a number before it is a frame. The
fifth time this file has needed the same rule: **a probe that reports the
output of a rule cannot witness the rule.**

**THE INK GATE HAD NAMED A SCENE, NOT A FAULT.** Its first form was two palette
steps of absolute ink (36) and a tenth of the changed pixels at the floor, set
against a band whose hillside read 111/255. On a band whose hillside reads 38 —
the same fixture, a different treeline — a healthy tier reads 26% at the floor
and the gate fires. What separates a multiply-by-zero from a dark tree is the
RATIO to the ground it replaced, and the three builds this has run on space out
cleanly: the broken build **0.17**, the analytic fix **0.38**, the atlas
**0.43**. The bar is a quarter, a factor of one and a half from the broken
build on one side and the nearest good one on the other; the absolute ink and
the dark share are still printed as evidence and no longer decide.

**MEASURED**, `at-yosemite`, one boot, off/on/off, the seed density pinned to
the old rate (`vegstems=0`) so the scene is the one the analytic numbers were
taken in:

| | analytic | atlas |
|---|---|---|
| drawn / offered | 931 / 1611 | **932 / 1614** |
| census `veg-impostor` | 3,724 = 931 x 4 | **3,728 = 932 x 4** |
| edges b / c / s | 689 / 428 / 482 | **689 / 428 / 482 — identical** |
| ink, ON against the ground it replaced | 44.1 vs 115.1 (0.38x) | **41 vs 94.7 (0.43x)** |
| band pixels the tier changed | **1,420** | **171** |
| tiles carrying no coverage | — | **0 of 312** |
| slots photographed | — | 13 of 18, in **71 ms** |

**THE PLACEMENT IS IDENTICAL AND THE COVERAGE IS AN EIGHTH, AND THAT IS THE
FINDING.** The same trees stand in the same places wearing the same budget;
what changed is that the card now draws the tree instead of a width profile,
and the tree is mostly gaps. The atlas measures it directly: **a conifer's own
silhouette fills 7 to 10 per cent of its bounding box and a broadleaf's 13 to
24.** The analytic card filled most of its own card, so the far wood used to be
denser than the near wood and nobody could see that the near wood was thin.

So the seat's second sentence — *our real trees are a little too skeleton like*
— is now a number rather than an impression, and it is the blocker rather than
the impostor. **The bake has a check for the opposite fault and none for this
one**: `sil.card` flags a leaf card wider than a quarter of its crown, which is
the stack-of-plates failure, and nothing measures how much of the crown the
cards FILL. `__impatlas().tiles[].sideMean` is that number now, and the next
unit is a re-bake judged against it.

### …and a forest covers its own ground: the ceiling could not buy that, and the candidate budget is why

The other half of the same ask: *especially where cover says forest, tree
density needs to go way way up.* The obvious lever is `COVER_VEG`, the per-cover
clump ceiling, and it is **already spent**. Worked through the shipped rule at a
tree-cover cell of mean density: demand is 18 x 0.775 = 13.95 against a
candidate budget of 25 x 0.6, so acceptance is 0.93 and **twenty-three of
twenty-five candidates already stand up**. Raising the ceiling to 30 takes it to
25 of 25 and raising it to 60 takes it nowhere at all — a proposal set is a hard
ceiling on population, and a forest has been sitting against it.

| ceiling | density 0.3 | 0.5 | 0.7 |
|---|---|---|---|
| 18 (shipped) | 18.7 / ha | 34.6 | 54.9 |
| 30 | 25.8 | 37.2 | 56.5 |
| 60 | **25.8 — identical** | **37.2** | **56.5** |

**WHAT IS THIN IS COVERAGE, NOT THE NUMBER OF THICKETS.** A clump's radius is 6
to 22 m, so its mean area at mid density is about 600 m2 and twenty-three of
them cover 14,000 m2 of a 48,400 m2 cell — **twenty-nine per cent**. That is a
wooded hillside with three quarters of it showing through, which is what the
seat's frames show. `COVER_CANOPY` grows the clump's AREA and its membership
together — the radius by the square root and the count in full — so the density
INSIDE a thicket is exactly what it was (no trunks start overlapping) and the
cover goes from 29% to about 100%. **3.4 is not a taste: it is 48,400 / 14,000**,
the multiplier at which a forest cell's own thickets tile it, which is what the
words "closed canopy" mean. `?vegstems=` scales the excess over 1 and 0 is the
exact A/B; it is read at SEED time, once per cell, so it needs a reload rather
than a dial.

**Measured** (`devtools/canopy-ab.mjs`, `at-yosemite`, two boots — legitimate
because the quantity is counts over a fixture rather than pixels):

| | `vegstems=0` | shipped |
|---|---|---|
| trees KNOWN (broadleaf / conifer / snag) | 2,389 / 8,350 / 1,630 | **4,932 / 18,902 / 2,768** |
| per seeded cell | 71 | **200** |
| plants placed within 300 m | 612 (21.6/ha) | 673 (23.8/ha) |
| drawn triangles | 1.51M | 1.81M |
| edges, conifer / snag | 651 / 700 | **573 / 647** |
| `ezAdmit` | 8.7 ms | 10.1 |
| seeding, total | 217 ms | 518 |

**THE WORLD KNOWS 2.2x MORE TREES AND DRAWS ABOUT THE SAME, WITH ITS EDGES
PULLED IN — which is the whole point and must not be read as a failure.** The
triangle budget is 2.4M and only 1.81M is spent, so what binds is `VEG_CAP`
times the rack's POPULATION CAP: the population stop, a dial the player owns.
What the density buys is a POPULATION for the cheap tier to draw — measured on
the same build, the impostors went from 932 to **1,382** — and the lever that
turns it into trees on screen is the rack's, now that there is something for it
to spend on. Raising the seed density while the caps bind cannot put a tree on
screen by itself, and saying otherwise would be the fabricated witness this
file keeps warning about.

The costs are honest and are the next thing to watch on a device: the seed is
2.4x (spread over the 8 ms a refresh may spend), `ezAdmit` is a heap selection
over every candidate and grew 16% here, and `vegGrid` holds every known site
whether or not it is drawn — 200 a cell against 71, on a manifest bounded in
cells.

### The New Forest bench: 38.7M triangles, and the cheap tier rationed to nothing

The seat's dump from a deliberately hard bench — POPULATION CAP 16X, DRAW
RANGE 2.8 km, EZ TRI CAP 40M, FORM SPREAD 3X, top camera at the New Forest,
656 s. It says three things, and only one of them is a bug.

**THE FRAME IS THE GPU'S.** `world pass: triangles mean 11.81M max 38.74M · p95
38.65M · 666 draw calls`, against a game that normally draws 3.5M. The tick is
**14.4 ms of a 78 ms p50 frame** and off-tick work is 0.9; the other 36.8 ms a
frame is the gap. This file's own rule stands — **the gap is a residual and
cannot establish a GPU bottleneck** — but the triangle count is not a residual,
it is a measurement, and 38.7M on an A-series phone at 19 fps is about
740 Mtri/s of submitted geometry. The dials were turned up to find the wall and
they found it.

**`ezAdmit` IS 69.0 ms A CALL, MAX 211** — the largest identified CPU cost in
the session and the whole of the one 336 ms frame in the log
(`treeRefresh:182`). It is `nearestStable` over 129,205 candidates with a cap
near fifty thousand, and it does not yield. Not fixed here, and the shape of
the fix is known and worth writing down rather than rediscovering: **histogram
d2 into a few hundred buckets, prefix-sum to the bucket where the cumulative
count first reaches the cap, and keep everything up to that bucket's upper
edge.** That prefix provably contains the cap-th nearest, so the selection
afterwards is EXACT rather than approximate — two O(n) passes to cut the list
by three or four times before the heap runs, with `nearestStable`'s own
contract (and its tie rule, which `perf-check` holds) untouched.

**AND THE IMPOSTOR TIER WAS RATIONED TO NOTHING, WHICH IS THE BUG.** The row:

```
drawn 3376/129205 offered · 13.5k tris · 400 formed
```

against `placed 51280 · tris 37.74M`. **The cheap tier carried four hundredths
of one per cent of the vegetation bill on a frame that was drowning in
geometry.** `400 formed` is `IMPOSTOR_FORM_BUDGET` exactly — pinned, every
refresh, for six hundred and fifty-six seconds — and a site that cannot be
given a form is skipped for that sweep. The budget was written when deciding a
form meant one hash for a tier drawing a thousand cards; on the atlas path it
is a Map lookup, and the thing that genuinely needs rationing is the BAKE,
which has had its own budget since the atlas shipped. 24,000 now.

**A COUNT THAT EQUALS ITS OWN BUDGET IS NOT A COUNT, AND THE ROW DID NOT SAY
SO.** `400 formed` reads as a fact about the world; `400/400 formed (PINNED)`
reads as a ration. That is the same fault as `edge == range` meaning NOT CAPPED
rather than "trees all the way out", recorded two sections up, and as
`__cam` reporting the zoom and not the stand-off. **Print a budgeted quantity
against its budget, or it will be read as a measurement.**

What the dump also confirms, quietly: the atlas cost **7 slots in 16 ms on the
device** — about 2.3 ms a variant, once — so the bake-per-refresh went from one
to two and a district's palette now lands in the first few refreshes rather
than the first few seconds.

### Does a refresh re-place a tree it already drew? Yes, and that is not the flicker

Asked from the seat: if a tree is still admitted, should the refresh not leave
it alone? It does re-place it — every admitted tree is written into staging
from scratch on every sweep — and **that costs nothing visually**, because the
same tree produces the same matrix and the same colour whatever SLOT it lands
in. The instance order changes; the frame does not.

Three things in the place loop DO step at the refresh cadence, and they are
worth knowing apart:

- **THE DISTANCE FADE READS THIS REFRESH'S ADMITTED EDGE.** `tt = sqrt(d2) /
  max(120, ezEdge[fam])` and `ezEdge` moves every sweep as the water-filling
  allocator re-divides the triangle budget, so a tree in the outer third of the
  ring can be mixed a different amount toward the ground colour a few times a
  second. This is the fault the IMPOSTOR's own fade was moved to the fragment
  to end — *a refresh is a few times a second while the distance to a tree
  changes every frame* — and the skeletons were never given the same treatment.
  The fix is the same one: a varying off the camera's own distance with the
  edge as a uniform. It is not made here because it changes what the refill
  writes, and `perf-check`'s baseline is a byte-for-byte record of exactly
  that — re-snapshot it in the same commit or the check becomes a comparison
  against a version two steps back.
- **`casts` IS A HARD BOOLEAN AT `shadowSpan`.** A tree either goes in the
  shadow-casting mesh or its twin, decided per refresh, so one sitting on that
  radius can have its shadow blink on and off as the truck moves a metre.
- **AND THE SET ITSELF CHANGES AT THE EDGE**, which is the pop the fade exists
  to soften and is the tier's whole reason for being.

What a refresh CANNOT move is the tree's identity: its variant, its height, its
lean and its yaw are hashes on its own position. The ground under it is re-read
(`groundAt`) and so follows the DEM as it refines, which is deliberate.

### The silhouette ink: an instrument, not a look

TREES -> **IMPOSTOR INK: STOCK | BLACK**, live, and `?impink=1`. Black takes
every card's DIFFUSE to zero — not an emissive and not a post term — so a
Lambert material multiplies every light by nothing and the tier is a true flat
cut-out at any hour under any cloud.

It exists because of an accident: the tier drew solid black for a week on a
missing `color` attribute, and those frames were the clearest picture anyone
has had of where the cards actually are. A silhouette answers by eye the three
questions no pixel metric in this repo answers — **where is this tier drawing,
how large is it there, and does its outline agree with the skeleton beside
it** — and the last of those is the whole test of an impostor.

### The control set: twenty-nine variants, one framing, one number

The seat's instruction, verbatim: *first to get a control set across forms and
varieties and then look to improve dramatically against that baseline.*
`devtools/tree-forms.mjs` is that control — every EZ variant rendered through
the SHIPPED material, framed by its own bounding box so two trees of different
size are comparable, with **closure** beside it: the share of that box the
silhouette fills. No world, no streaming, no arrival order, so the sheet is the
same every run, which is what makes it a baseline rather than a snapshot.

| form | n | min | mean | max |
|---|---|---|---|---|
| round | 6 | 17.0% | 23.7% | 28.0% |
| columnar | 2 | 25.9% | 27.6% | 29.4% |
| **conic** | **12** | **5.1%** | **13.0%** | **24.9%** |
| umbrella | 3 | 19.2% | 20.5% | 22.5% |
| palm | 2 | 13.0% | 14.1% | 15.2% |
| bare | 4 | 2.1% | 2.6% | 3.3% |

**THE CONIFER FAMILY IS TWO DIFFERENT BAKES AND THE NUMBERS SAY SO.** Its first
four variants — `conic 1-4`, the frond recipe the lab measured and approved —
read 22.0 to 24.9% at **1,261-1,302 triangles**, and the frames show a whorled
spruce that is unmistakable at a glance. The other EIGHT are the growth forms
(`open whorled`, `high crown`, `wind shaped`, `broken leader`) at **5.1 to
9.6%** and 469-651 triangles, and the frames show a bare pole with a dozen
one-pixel dashes on it. They are not thin trees; they are not trees.

**AND THE DISTRICT PALETTE PICKS TWO OF THE TWELVE.** At Yosemite the atlas
reported the live slots as `conifer:4, 6, 8, 9` — open whorled, high crown and
both wind-shaped — **four of the eight poles and none of the four good ones**.
So the seat's Yosemite frames were not bad luck about lighting or distance:
that district genuinely grows the thinnest silhouettes in the atlas.

**AND THIS IS THE SAME FACT THIS FILE ALREADY RECORDED AS A PRICING BUG.** The
tree-spend unit measured conifer charged at its atlas mean of 1,713 triangles
while DRAWING 543, called the gap an estimator fault, and fixed the estimator.
It was also a QUALITY fault and nobody could see it: the realised 543 is the
mean of the cheap growth forms, and they are cheap because they are empty. A
per-tree price three times under the family mean was evidence about the
silhouette all along, and there was no instrument that could say so.

What the rest of the sheet says, in the order worth fixing:

- **The palm is a cone.** Both variants are a leaning trunk with a solid green
  cone on top and no fronds at all — 13-15% closure, and what closure it has is
  a filled shape rather than a crown. The lab's own note says `branch.force` is
  what makes a palm a palm; the bake is not using it.
- **A broadleaf is six to twelve large flat cards on a bare stick.** No branch
  structure survives the reduction (`children x0.3` is what sets the number of
  crown anchors, so the crown is thin at the root), and at 17-28% the canopy
  never closes. `round 4` is 391 triangles and 17.0%.
- **The columnar broadleaf is not columnar** — both variants are a leaning
  sapling with its leaves at the top, which is a different tree from the one
  the vocabulary names.
- **The snags are right at 2-3%**, by definition, and are the control that says
  the metric is measuring what it claims.

`ELEV=` takes a sheet per elevation (8 and 35 degrees by default); closure moves
by under two points between them, so the number is a property of the tree
rather than of the framing. `PX=`, `MAG=` and `COLS=` size the cells.

`BG=` is the sheet's background — `white` by default, since the seat asked for
one and a dark sheet flatters a thin crown by lending it a silhouette it has
not earned — plus `sky` and `dark`. `TAG=` names the files, so successive
passes sit beside each other on disk.

### …and filling that crown: clustering was the wrong lever, and the numbers said so

Two passes at the eight growth-form conifers — the family the control set
found at 5.1-9.6% against the base recipe's 22.0-24.9% — with the sheet shown
to the seat at each. `?ezfill=` is the dial and 0 is an exact control: gain 1
and one pad an anchor is the k = 0 path with no jitter and no rescale, which
decodes byte for byte as the shipped crown does.

**PASS 1 CLUSTERED, ON AN ARGUMENT THAT WAS PLAUSIBLE AND WRONG.** A real
branch carries a cluster, and scaling the pad instead was expected to read as a
bead on a stick — the shape the lab had already rejected for the columnar
broadleaf. So three pads an anchor, jittered within 0.9 of the pad radius.

**PASS 2 GREW THE PAD, which is the thing pass 1 argued against**, on the
physical reading of the same recipe: an open-whorled or high-crown conifer HAS
fewer branches, so a branch that is one of thirty carries a larger tuft than
one of a hundred and twenty. Gain 1.75 on EVERY pad (the k = 0 one included),
the cluster down to two, the spread measured in GAINED radii so the pair reads
as a lobed tuft rather than one blob.

| the eight growth forms, mean | closure | triangles |
|---|---|---|
| the bake, as it shipped | **7.6%** | 540 |
| pass 1, three clustered pads | 10.1% (+33%) | 1,072 (+98%) |
| **pass 2, the gain** | **15.2% (+100%)** | **806 (+49%)** |

**READ THE COST COLUMN, NOT THE CLOSURE COLUMN.** Pass 1 bought a third more
silhouette for twice the triangles — worse per triangle than the bake it was
improving (0.0094 closure a triangle against 0.0141). Pass 2 is **0.0189**,
which is better than the base recipe's own 0.0187: the growth forms have
stopped being the cheap-because-empty variants that `ezTriPrice` was reading,
and that is the same fact the tree-spend unit measured as a pricing bug
arriving from the other side.

**THE LIMIT WAS WHERE THE ANCHORS ARE, AND CLUSTERING CANNOT REACH IT.** Pads
jittered inside 0.9r of one anchor OVERLAP, so their projected area barely
adds; the growth forms carry 28-41 anchors against the base recipe's 108-126
over the same crown, so what is empty is the gaps BETWEEN the whorls. Pad area
goes as the SQUARE of the gain, which is why one lever moved twice what the
other did at half the cost.

What the frames say that the table does not: broken leader and open whorled 6
read as recognisable young conifers at 19%; **wind shaped is still last at
10.6-11.7% and partly should be** (w/h 0.86-0.99, so the box is wide and a
windswept tree is genuinely sparse); and on all eight the pads are still
individually legible as diamonds where `conic 1-4` is a mass — which is the
anchor count again, and that lever is `children x0.3` in the reduction and
needs a re-bake rather than a client dial.

### …and then the control set itself was found to be measuring the wrong picture

The seat revoked the premise the two passes above were aimed at — *the frond
recipe the lab approved* — and asked for a critique from first principles.
`TREE-FORM-2026-09-16.md` is that, and its finding invalidates every number in
the section above as a TARGET (they are still true as measurements):

**THE SHEET WAS FOUR TO TEN TIMES THE SIZE THE GAME DRAWS A TREE, WITH MSAA THE
RENDERER DOES NOT HAVE, AND NO POST CHAIN.** 224 px cells at `samples: 4`, read
straight off the render target. The frame is 148 x 320 art pixels, `rtScene`
has no MSAA at all, and the composite quantises to fourteen levels and
Bayer-dithers; a metre at distance d is 307/d art pixels, so a 16 m conifer is
49 px at 100 m and 25 px at 200 m, its pads 7.4 and 3.7 px, and its trunk 1.1
and 0.54 px. Re-rendered honestly, `conic 1-4` — the recipe everything was
being tuned toward — are the LEAST legible cells on the sheet.

**`__ezsheet` IS FRAMED BY A DISTANCE NOW.** Every variant renders at the
art-pixel size the game would draw it at from `DIST` metres, computed from its
own metric height (`EZ_M_PER_SCALE` times the rack's mid size draw) through the
chase lens into 320 rows, at `samples: 0`, then through the composite's own
quantiser and bayer4 in JS. One sheet pixel is the same art pixel in every
cell, so a snag at 200 m is visibly fourteen pixels where a conifer is
twenty-nine. `DIST=`, `INK=1` for black silhouettes, `POST=0` for before the
quantiser, `QS=` to A/B a boot-time switch, and `PX=` is still there as a
close-up and prints "NOT a control" when used.

**AND CLOSURE IS ONE COLUMN OF SIX.** It cannot tell a mass from confetti,
which at 25 px is the whole difference. Beside it: `parts` (connected
components — a tree is ONE thing), `big` (the share in the largest), `sky` (the
crown's contrast against the sky in palette steps), `form` (the tenth-to-
ninetieth percentile of the FOLIAGE's own luma, in steps), `mass` (the largest
connected region of one quantised colour, as a share of the foliage) and
`stipple` (lit pixels touching at most one neighbour — the ones that flicker as
the truck moves).

**Twelve of twenty-nine variants read at 200 m**, on a bar of at most three
parts, 70% in the largest, a step and a half of sky contrast, a step and a half
of the crown's own light and dark, and at most 12% stipple. **The whole conifer
family fails — all twelve** — on fragmentation (4 to 13 parts) and stipple (7 to
34%). **All four snags fail at 100% stipple**: at 200 m a snag is two to four
isolated black pixels, drawn with 135 to 224 triangles.

Two faults in the instrument, both caught by numbers that did not move:

- **`form` read 3.7 for twenty-five variants in a row** on its first cut. A
  number that does not move is measuring something else, and it was the dark
  BARK against the green crown rather than the crown's own light. Restricted to
  the foliage (the instance colour is 0.30/0.42/0.20 and the bark 0x4a3826, so
  `g > r` separates them with nothing to tune).
- **`Math.max(1, mag) || 0` is never 0**, so the auto-magnification never fired
  and the first sheet came out at 1x — twenty-nine trees at 23 pixels each, on a
  sheet 310 pixels wide.

### The crown's own light: the occlusion was neutral and the envelope was the win

Phase 2 of that document — the cheapest item on the list, a material change
touching no bake — and it took two attempts, of which the first is the more
useful.

**A MEASURED SKY EXPOSURE, AT DECODE.** The crown's shading was
`smoothstep(length(vEzLocal.xz))` against `smoothstep(vEzLocal.y)`: a RADIAL
approximation that assumes a crown centred on the trunk and knows nothing about
where this tree's foliage is — right for a round oak, wrong for an umbrella
acacia, a wind-flagged conifer, a high crown or a palm. `anchorSky` replaces it
with nine rays over the upper hemisphere per foliage cluster, blocked by the
tree's own other clusters, run once per variant at decode and carried as
`aSky`. Zero runtime cost. **It is also, on its own, WORTH NOTHING at 200 m**:

| by form, at 200 m | `mass`, radial | + measured occlusion | + envelope normal |
|---|---|---|---|
| round | 5% | 6% | **11%** |
| conic | 4% | 4% | **7%** |
| umbrella | 11% | 11% | **19%** |
| columnar | 7% | 6% | **9%** |
| palm | 32% | 11% | 9% |

The reason is scale: occlusion varies between CLUSTERS, a cluster is three to
five art pixels, so it produces variation at the same frequency the per-face
hash did — a different noise, not a form. **An ambient term is interior-versus-
exterior; what makes a tree read as a solid object is a LIT SIDE, which is
directional and which no amount of AO supplies.**

**SO THE CROWN LIGHTS AS ONE ENVELOPE.** Every crown vertex carries `aEnv`, the
direction from the crown's own centre normalised by the crown's own extent (an
ellipsoid, not a sphere), and the surface pass turns the shading normal 78% of
the way toward it. A pad heap presents facets pointing every way, so Lambert
answers a different number on each and the crown gets a random tone per facet;
against the envelope the whole crown has one sunlit flank and one shaded flank,
coherent across every cluster in it. That is the only kind of light fourteen
levels can carry, and it is what both reviews meant by "the crowns have no
light". Three floats a crown vertex at decode, nothing at runtime, and it is
the attribute the bough merge will want anyway.

**AND THE VARIATION UNIT MOVED UP.** `faceTone`'s per-TRIANGLE hash is
high-frequency tonal noise at exactly the dither's own frequency; the hash is on
the ANCHOR now, so a whole foliage cluster shares a tone. Measured: it left the
crown's luma spread unchanged (3.1 steps for round, either way) — so it removed
noise without removing light, which is what it was for.

`?ezsky=0` restores the radial term AND the facet normal exactly, so the pair is
one build with one uniform. **The palm goes the wrong way** (32% → 9%) and that
is honest: its crown is a solid cone whose facets were already coherent, and it
is the one form the design document has down for a bespoke rebuild.

**What phase 2 did NOT move, and could not:** `parts`, `big` and `stipple` are
identical in both legs to the digit. Shading cannot join a crown that is thirteen
separate pieces of foliage — that is phase 3, the cluster crown and the distance
merge.

### Phase 3: the crown closes as the tree shrinks, and 12 of 29 becomes 24

The fault phase 2 could not touch. At 200 m a conifer is four to thirteen
separate pieces of foliage with up to a third of its lit pixels touching at most
one neighbour, and with no MSAA and a nearest magnify a pad near a pixel does
not get smaller as the tree recedes — it gets INTERMITTENT, covering a pixel or
not by sub-pixel phase, changing every frame the truck moves, with the ordered
dither amplifying it.

**BOTH TARGETS ARE SATISFIABLE ONLY BY A CROWN THAT IS OPEN NEAR AND CLOSED
FAR.** The botanical review wants crown porosity — real holes between foliage
masses — which is right at thirty to a hundred metres. Its own headline target
is that a biome be unmistakable AS A BLACK SILHOUETTE at 150-300 m, which is a
solid shape. A hole at 200 m is one pixel. Neither target is wrong; they are
statements about different scales, and the mechanism that serves both is an LOD
on the crown's OPENNESS.

**EACH CLUSTER CARRIES WHERE IT WOULD SIT ON THE CROWN'S OWN SILHOUETTE HULL**
— a surface of revolution measured off the crown's radius at each height, so a
conifer's hull is a cone, a round tree's a dome, an umbrella's a plate and a
column's a column; nothing is authored and nothing is a sphere. The vertex
shader slides the cluster onto that hull and grows it over a band read from the
INSTANCE's projected height in art pixels: untouched above 58 px (about 110 m
for a 20 m conifer), one closed mass below 26 px (about 250 m). The scale comes
from `projectionMatrix`, so it is right in the chase lens, right through the
speed kick and right on the chart.

No second geometry, no popping (the blend is continuous in the instance's own
distance), no re-upload, and **nothing for the refresh to do** — `refreshVeg`
writes exactly the matrices it wrote before, which is why `perf-check` is still
20 of 20 production refills byte-identical with the merge shipped.

**Measured**, at 200 m, the switch the only difference:

| by form | parts | | big | | stipple | | `form` | |
|---|---|---|---|---|---|---|---|---|
| | off | **on** | off | **on** | off | **on** | off | **on** |
| conic (12) | 7.5 | **1.6** | 68% | **97%** | 19% | **3%** | 2.5 | **2.9** |
| round (6) | 2.0 | **1.0** | 82% | **100%** | 5% | **2%** | 2.6 | 2.8 |
| umbrella (3) | 2.0 | **1.0** | 88% | **100%** | 8% | **3%** | 3.0 | 3.0 |
| columnar (2) | 1.5 | **1.0** | 83% | **100%** | 4% | **1%** | 2.0 | 2.0 |
| palm (2) | 1.5 | **1.0** | 93% | **100%** | 7% | **1%** | 3.0 | 3.0 |

**12 of 29 variants read at 200 m becomes 24**, and the five that still fail are
the four snags (which have no crown, so the merge correctly does nothing) and
one columnar broadleaf on its crown's own light. The conifer family goes from
0 of 12 to 12 of 12.

**AND THE NEAR FIELD IS UNTOUCHED, WHICH IS THE CONTROL THAT MATTERS.** At 60 m
every form above the 58 px bound reads identically with the merge on and off, to
the digit. The one difference is the acacia (3.3 parts against 3.7), and that is
the rule working rather than leaking: an umbrella thorn is a 10 m tree, so at
60 m it is 49 art pixels and genuinely inside the band.

**THE HULL IS INSET BY EXACTLY WHAT THE GROWTH WILL ADD BACK, and the first cut
was not.** Putting the clusters ON the silhouette and THEN growing them stood a
merged crown about twice as wide as the tree it was baked as — **a tree that
GROWS as you drive away from it**, which is a worse fault than the stipple it
fixes, and the control sheet showed it at once because every round broadleaf
clipped its own cell. Two profiles are measured now, the silhouette's (every
vertex) and the clusters' (their centres); the difference between them at a
height IS the pad's radius there, and the hull is set where a pad grown by
`EZ_MERGE_GROW` lands on the original silhouette, in the vertical as well as the
radial. **One constant, exported, interpolated into the GLSL** — two copies of
that number is the growing tree again, arrived at by a different road.

`?ezmerge=0` draws the crown exactly as baked at every distance; 2 overshoots,
which is a way to see the mechanism rather than a setting.

**WHAT THE 60 m COLUMN IS NOT.** The legibility bar (at most three parts, 70% in
the largest, and so on) is a 200 m bar: at 60 m a crown SHOULD show its
structure and `parts` of 10 is a conifer you can see between the branches of.
Seven of twenty-nine "read" there and that is not a finding.

### …and three of the eight broadleaf variants were NOT unreachable — the test was

**THE SECTION THAT STOOD HERE WAS WRONG, AND IT WAS BLOCKING REAL WORK.** It
read `tree-stand.test.mjs`'s failing `…and the world uses ALL of them across
districts` — `saw [0,2,3,4,6]` — as a coverage fault, and concluded that three
of eight baked broadleaf silhouettes "exist in the bundle, cost their bytes, and
are drawn nowhere on Earth", with the rider that **adding habits is worth
nothing while a third of the ones already baked are unreachable.** On that basis
the atlas expansion the botanical review asked for was deferred. Nothing about
it was true.

**COVERAGE IS A PROPERTY OF THE CHAIN, AND THE ASSERTION ONLY LOOKED AT ITS
FIRST LINK.** `ezPalette` draws over HABITS (`ezHabitOf`), not over variants:
`Oak Medium #387`, `#91` and `#12` are one recipe under three seeds, and a
district that spent its two-species vocabulary on two seeds of the same oak
would read as a monoculture while believing itself diverse. So the palette
covers 5 of 8 **by construction and on purpose**, and `ezPickVariant` — which
main.ts calls with the family and a hash of the tree's own lat/lon — then picks
among that habit's siblings per INDIVIDUAL. The assertion predates the habit
dedupe and could never pass again.

**Measured over 40,000 districts × 4 stands × 6 individuals**, which is the same
three scopes the world walks:

| family | palette reaches | the chain reaches | thinnest variant's share |
|---|---|---|---|
| broadleaf | 5 of 8 `[0,2,3,4,6]` | **8 of 8** | 6.6% |
| conifer | 6 of 12 | **12 of 12** | 5.5% |
| acacia | 1 of 3 | **3 of 3** | 33.1% |
| palm | 1 of 2 | **2 of 2** | 50.0% |
| snag | 3 of 4 | **4 of 4** | 16.7% |

And the same file's own FIXTURE half had been saying so all along, in the line
directly under the failure: the shipping per-stand census at Camps Bay draws
`Aspen Small #11` — index 7, one of the three this section called unreachable —
**twenty-four times**.

**THE ONE CONSEQUENCE THAT IS REAL, and it is the thing to know before adding to
the bake: a habit's share of the ground is split among its seeds.** `Oak Small`
is one seed and takes 20% of the broadleaf ground; `Oak Medium` is three seeds
taking 6.7% each for the same 20%. **Baking a fourth seed of a recipe does not
widen a landscape — it subdivides one of its species.** A new HABIT does, which
is exactly what the review's fifteen-to-twenty-five architectural habits are,
and there is nothing standing in their way.

The assertion is now the two claims the chain actually makes — the palette
covers every habit, and district → stand → individual reaches every variant of
every family — **and both are needed or neither means anything**: a palette
covering every habit with a pick that ignored the siblings would still bury a
third of the atlas, and a chain reaching every variant through a palette missing
a habit would be drawing them as accidents rather than as species. Checked
against a negative control, which is what the old assertion never had on the
design it was failing: with the peer pick disabled in the built bundle the chain
reads **5 of 8 broadleaf and 6 of 12 conifer** and both new claims fail.

**THE GENERAL FAULT IS THE ONE THIS FILE KEEPS RECORDING FROM THE OTHER SIDE.**
A probe that reports the output of a rule cannot witness the rule — and here a
TEST asserting a rule that had been deliberately replaced reported the
replacement as a defect, in a file whose own comment three lines above it
explains why the replacement is right. A failing check nobody can attribute gets
written into the doctrine as a fault, and the doctrine then defers the work.
**When a long-failing assertion and a documented design contradict each other,
one of them is stale, and which one is a question with an answer.**

### The palm was a leaning pole with an ice-cream cone on it, and three numbers say why

The control set's judgement on the palm — *both variants are a leaning trunk
with a solid green cone on top and no fronds at all* — was right about the
picture and wrong about the cause, and the note recorded here said
`branch.force` was unused in the bake. It is used. What was wrong is arithmetic,
and it took a new ruler to see any of it.

**THE RULER: `width` IS MEASURED FROM THE TRUNK'S BASE, SO ON A LEANING TREE IT
IS THE LEAN.** Every radius in `silhouette()` is `hypot(x, z)` about x = z = 0,
which is the crown's own axis only for a tree that stands up straight. The palm
is the atlas's leaniest recipe, and measured against its own crown's centroid:

| | `width` (what the column said) | `crownR` | `lean` |
|---|---|---|---|
| Pine Small #44 | 0.238 | **0.045** | **0.209** |
| Pine Small #17 | 0.288 | **0.049** | **0.255** |

**The palm's whole crown was 0.09 of the tree across, and the decode was drawing
an element of 0.2 at every one of its seventy anchors** — four times the crown's
own radius, seventy times over. That is the solid cone, and it is the same fault
this file already records one element-type over: *a leaf sized against the TREE
and judged against the crown*, which made the columnar broadleaf a stack of
plates. `crownR` and `lean` are columns in the bake's table now. `width` is left
exactly as it was — the form thresholds were set against it and a vocabulary
that moves under its own tests is worth less than a ruler that is honest about
what it measures.

**AND BOTH DIALS HAD BEEN TUNED AGAINST THAT NUMBER, so both readings were
inverted.** The recipe's own note recorded `force` "taking the crown from 0.10
of the tree across to 0.22" and `length[1]` moving it "from 0.060 to 0.070 and
no further". Measured again against `crownR`:

| | crownR | clear | lean |
|---|---|---|---|
| shipped: length 30 · start 0.90 · force 0.05 | 0.045 | 0.83 | 0.209 |
| length 90 | 0.077 | 0.75 | 0.210 |
| length 200 | 0.134 | 0.52 | 0.209 |
| **length 200 · start 0.92 · force 0.02** | **0.147** | **0.67** | **0.076** |
| length 200 · start 0.90 · force 0.02 | 0.207 | 0.64 | 0.069 |

**`force` IS NOT THE DROOP, IT IS THE LEAN.** It acts on the trunk as well as on
the fronds, so at 0.05 it was bending the whole tree over — lean 0.209 against
0.076 at 0.02 — and the crown it was credited with widening barely moved.
`length[1]`, recorded as dead, is the frond dial after all: 30 → 90 → 200 takes
the crown 0.045 → 0.077 → 0.147. A dial measured through a confounded number
reads as the other dial's effect.

**The shipped recipe is 200 / 0.92 / 0.02, which is a coconut palm to two
decimals** — crownR 0.147 against a real ~0.15, clear 0.67 against a real ~0.7.
The trade is real and is why `clear` fell from 0.83: fronds long enough to make
a crown hang below the top of the trunk. 0.83 was a palm with almost no crown.

**AND A FROND IS A BLADE FROM THE CROWN'S HEART TO ITS OWN ANCHOR**, in
`crownOf` rather than in the bake, because the bake cannot see what the decode
draws. The anchors are frond TIPS on a shell, so the segment from the shell's
centre to each of them IS that frond — no authored direction, no new attribute,
and the crown's architecture comes from the geometry the bake already produced
and nobody was reading. Tapered rather than pointed (a cone's tip is zero-width
exactly where the fronds have separated and there is something to draw), three
sides because a blade's far face is behind its near one: **420 triangles for
seventy fronds against the ball's 280**, and the variant lands at 618 and 558
drawn against 758 and 684 — **the palm gets its fronds and gets cheaper.**
`?ezpalm=0` draws the balls again and is the exact A/B.

**TWO WRONG CUTS FIRST, AND THE SHEET CAUGHT BOTH IN ONE FRAME EACH.** Blades of
a fixed 0.55 of the element radius straddling their anchors drew a small dark
smudge on a bare pole (coverage 8.1% against the ball's 15.2%) — a different
wrong tree. Then blades from the heart to the anchor on the OLD bake drew an
even smaller one, because on that bake the heart-to-anchor distance is 0.03 of
the tree. **A shape rule and the geometry it reads have to be fixed in the same
breath**, and the order to do it in is the geometry first: the decode can only
draw what the anchors describe.

**Measured**, `tree-forms.mjs` at 60 m, the shipped build against `?ezpalm=0` on
the shipped bake, and against the atlas as it was:

| | was (old bake · ball) | now (new bake · fronds) |
|---|---|---|
| coverage | 15.2% · 12.9% | **16.0% · 16.4%** |
| parts | 1 · 1 | **6 · 6** |
| triangles | 758 · 684 | **618 · 558** |
| lum | 45 · 47 | 37 · 29 |
| sky contrast, steps | 8.8 · 8.7 | 9.2 · 9.3 |

**READ `parts` THE RIGHT WAY ROUND HERE.** 1 part is the ball: one closed blob,
which is what a palm must not be. Six is six fronds resolving separately at 60 m,
and the 200 m sheet is where the merge is supposed to close them again — the
legibility bar in this tool is a 200 m bar and reading it at 60 m calls a
visible crown structure a failure, which this file already says about conifers.

**WHAT IS HONESTLY WORSE: the crown is darker** — lum 33 against the ball's 46,
the darkest non-snag in the atlas. Thin blades present far more edge-on and
away-facing area than a ball does, and `uEzEdge` darkens an edge-on face by
design. It is the seat's own "black silhouettes" complaint in miniature and it
is not fixed here; the lever is the same one that fixed it before — open the top
of the shading window rather than lift everything — and it wants its own frame
from the seat before it is turned.

### The vegetation was anchored to the spawn, and the spawn is a zero of its own field

Reported from the seat with two screenshots of the same geography — one driven
to, one loaded at — and a reading of the code. Both halves check out, and the
second is the one nobody would have found from a frame.

**`sin(0)` IS EXACTLY ZERO, AND SO IS THE FIELD AT EVERY SPAWN.**
`vegetationDensity` is `fract(sin(px * 12.9898 + pz * 78.233) * 43758.5453)`
bilinearly interpolated on a 909 m lattice, sampled in LOCAL metres — and every
load and every hop puts the requested place at local (0, 0). So the density at
the truck, on arrival, anywhere on Earth, was **0**. Measured radially, against
a world mean of **0.4998**:

| m from the spawn | 0 | 25 | 50 | 100 | 200 | 400 | 700 | 909 | 1200+ |
|---|---|---|---|---|---|---|---|---|---|
| mean density | 0.000 | 0.001 | 0.004 | 0.017 | 0.062 | 0.205 | 0.420 | 0.492 | 0.500 |

**AND THE CONSEQUENCE IS NOT "THINNER", IT IS "NO THICKETS".** At density 0
`vegetationClumpChance` returns exactly 0 and `vegetationClumpRole` returns
null, so every GROUP is refused — while `vegetationLivingChance` has its `open`
term at full strength, so the stray floor is untouched. Replaying `seedCell`'s
own accept logic with the cover ceiling held constant:

| ring from the spawn | 0 m | 220 | 440 | 1100 | 4400 |
|---|---|---|---|---|---|
| groups (thickets) per cell | **0.00** | 0.38 | 0.94 | 1.18 | 1.15 |
| strays per cell | 1.00 | 1.25 | 0.50 | 0.38 | 0.60 |

You spawn among scattered single plants with no thickets at all, and the group
rate recovers over about a kilometre. That is "almost always very little trees
in my immediate vicinity" and "trees become abundant as I drive away", and it
is upstream of every impostor and streaming mechanism this file has chased.

**THE LATTICE WAS LOCAL TOO, WHICH IS THE ARCHITECTURAL HALF.** `VEG_CELL`
buckets, `vegetationCandidate`'s stratification and accept rolls, the anchor
promotion and the impostor tier's density thinning all hashed LOCAL
coordinates, so the same geography seeded different trees depending on where
the session started. `culture.ts` has solved exactly this since bedrock —
`seedAt` works in `absMetres`' frame so a district's palette survives a rebase
— and the vegetation simply never used it.

**SO THE WHOLE STOCHASTIC DOMAIN MOVED INTO THAT FRAME.** `vegAbsOf` goes
local → lat/lon → absolute, `vegLocalOf` comes back (northing carries latitude,
so the inverse is direct), `vegCellOf` is the one authority for which cell a
point is in, and `vegCellPos` puts a cell's (u, v) back into local metres. A
candidate is generated in the absolute frame and converted back before any
cover or ground query. The degenerate zero still exists — it is now at 0°N 0°E,
in the Gulf of Guinea, one permanently thin patch of open ocean.

**EVERY CONSUMER, NOT JUST THE GENERATOR.** The seat's report named this as the
implementation trap and it is the right warning: `vegGrid`'s key, the refresh's
ring walk, the manifest tally, the collision bucket, the ambience sample, the
debug probes, the far-impostor hash and `rapidRocks` — which shares the lattice
with `vegGrid` and is read with the same index in the ambience tick — all take
`vegCellOf`. A generator that moved while a consumer did not would be stable and
unreadable, which is worse than the bug. `PlacedVegSite` carries `ax`/`az`, its
place on Earth, taken once when it is filed, so no geographic hash downstream
pays a cosine per site.

**Measured**, `devtools/veg-anchor.test.mjs`, pure node, with the rule it
replaced as its control at every claim:

| | shipped | the old rule (control) |
|---|---|---|
| a place falls in one cell under every origin | yes | **fails at 5 of 5 places** |
| a cell's candidates land at the same lat/lon | yes, to under a millimetre | — |
| density at a place under every origin | identical to float round-trip | **spread > 0.1** |
| density at the truck on arrival | an ordinary sample, mean 0.50 | **exactly 0, everywhere** |
| thickets per cell at the spawn | **1.13**, against 1.13 five km out | **0.00**, against 1.13 |

…and in a world (`tree-stand.test.mjs`, the Camps Bay fixture, whose origin is
the capture's own centre and therefore sits in the trough): **159 skeletons in
53 stands became 3,730 in 492** — 2.0 sites a cell, which is strays and ground
events alone, becoming 46, which is strays plus full thicket membership.

**WHAT THAT NUMBER IS NOT is a 23× denser world.** Past about 900 m the old
field was already at its mean, so only the spawn's own neighbourhood changes
count; everywhere else what changed is WHICH trees, not how many. The near
field around a spawn now carries the load every other part of the map already
carried.

**AND `perf-check` NEEDED BOTH A STUB AND AN HONEST NOTE.** It broke exactly as
this file predicts a sandboxed check breaks — `ReferenceError: vegCellOf is not
defined` — and the fix is not to hand it the real transform: its mock world is
a flat unprojected plane whose grid is keyed on local indices, so the real rule
would look up absolute keys, find nothing, place no trees and compare two empty
worlds as equal. **A check that passes by drawing nothing is worse than no
check.** It stubs the lattice as the identity on local metres, says so, and
keeps the claim it was written for — that the sliced refresh refills what the
pre-slice one did GIVEN THE SAME CELL WALK. The walk's own frame is a different
claim and `veg-anchor.test.mjs` is where it lives. Its mock sites gained
`ax`/`az` for the same reason: without them the far tier's thinning hashes NaN,
which is never greater than its threshold, so it culls nothing — and the
snapshot does not cover the impostor mesh, so that would have passed silently.

**Two traps in writing the test**, both the same shape as faults already in
here: stripping TypeScript annotations with a regex produced a `toLocal` that
was not a function (esbuild transpiles it now), and a `const` inside a `vm`
script lives in that script's lexical scope and never becomes a property of the
context — only a `function` declaration does, which is why the sibling globe
test never met it. The helpers are published onto the context by hand.

**What is NOT done here, deliberately:** nothing about population, LOD or
impostor parameters, because the seat's own instruction was to fix this first
and every one of those dials was tuned against a field with a hole in it. The
antimeridian and the poles are discontinuities of the absolute frame — `lon`
±180 lands in cells 19.9M apart and `cos(lat)` is floored at 0.02 — which
`culture.ts` has always had and which nothing has yet driven across.

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

**AND A GLSL IDENTIFIER IS CHECKED AGAINST ES 3.00, NOT ES 1.00 — BY A TEST.**
three compiles `#version 300 es` on a WebGL2 context and ES 1.00 on WebGL1,
and the two reserve different words, so an identifier legal on one profile can
be a link failure on the other. It is not hypothetical: the sward's structural
expression shipped with a parameter called `patch` and the device dump came
back with `ERROR: 0:224: 'patch' : Illegal use of reserved word` on TWO
programs, with the world looking perfectly normal — because a program that
fails to link logs to the console and throws nothing. `cast` in the façade
shader was the same fault, sessions earlier.

**THE HARNESS IS NOT BLIND TO THIS, AND A FIRST WRITE-UP HERE SAID IT WAS.**
Measured rather than assumed, which is what the claim needed in the first
place: `openDrive` gets

```
WebGL 2.0 (OpenGL ES 3.0 Chromium) · WebGL GLSL ES 3.00
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
```

and compiling the exact construct on it answers `ERROR: 0:4: 'patch' : Illegal
use of reserved word` under ES 3.00 and `compiles` under ES 1.00. So the
harness reproduces the device's compiler, its console sniffer folds a GLSL
error into `d.errors`, and any tool that DRAWS the material would have caught
this. What is true is narrower and worth keeping: **a program compiles on its
first render**, so a `nodraw=1` tool never triggers one, and the fault shipped
because the agent that wrote it had no WebGL context at all in its own
environment — its report says so outright, `GL_RENDERER Disabled` — and
deployed with no browser validation.

`devtools/glsl-reserved.test.mjs` earns its place for exactly that case rather
than for a blindness the harness does not have: it is pure node, so it works
where there is no GL, and it is instant against a boot's minute. It scans every
GLSL template literal in `client/` against the ES 3.00 reserved-for-future
list, with comments and three's own `#include <common>` chunk names stripped,
and it carries the shipped form as its negative control. Run it with `tsc`.

**A backtick inside a GLSL comment breaks the enclosing TS template literal.**
This has now cost FIVE separate rounds — two of them in one session, both in
comments explaining a helper's own parameters, which is where the urge to quote
an identifier is strongest. Do not write `\`f\`` in shader comments. The tell is
a `TS1005` at a line number inside the shader string; `npx tsc --noEmit` finds
it in thirty seconds and nothing else will.

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

> **THE BAKE IS RETIRED** — the surface is a graticule drawn in the fragment
> shader, and the asset, its route and its baker are deleted (see "The globe is
> a graticule…" below). Everything about the SPHERE in this section still
> stands; what it says about the texture is history, and git has the baker if
> the bake is ever wanted back.

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

## A WebGL blit answers to no overlay

Reported from the seat: open the hub from the chart and the cab/chase dock
stays floating over the menu while the whole rest of the HUD has correctly
gone. Every other instrument stands down through one of two mechanisms — the
HUD canvas (`drawHud` returns on `menu.tab() !== null`) or the DOM overlay's
own display rules — and the dock is in NEITHER. It is a scissored render of
the live scene through `miniCam`, taken after the composite, straight onto the
canvas. Nothing above it can hide it; the gate has to be written on it.

**AND ITS RECT GOES STALE RATHER THAN EMPTY, which is why it is intermittent.**
`dockRect` is assigned inside `drawHud`, so once the HUD stands down the rect
keeps whatever it last held. A page booted straight into the hub has a rect of
zeroes and blits nothing — the fault is invisible there. Chart first, so the
HUD lays the dock out, THEN open the menu, and the blit runs on a live rect
behind a shut HUD. Measured both ways: `{x:4, y:334, w:58, h:58}` with the menu
shut and the identical rect with it open.

Verified in pixels, because a WebGL blit is not in the DOM and no probe reports
it: the dock is in the frame with the menu shut and absent with it open
(`scratchpad/dock.mjs` in the session). The control matters — a test that opens
the menu first passes without the fix.

## The chart states its scale, as a map would

Asked from the seat with five frames from the Afsluitdijk: the chart should
carry a scale bar, the representative fraction, and the zoom. It does now,
under the clock's row at top-left (below the tile-debug lines when those are
up): `500 KM · 1:16M · z5.0` over the continent, `2 KM · 1:81K · z12.6` over a
district, `20 M · 1:816 · z19.3` over a junction, with a bar of that round
length under it. Lowercase z, as the tile-debug line writes `MAP z13`: the
small font draws a capital Z and a 2 alike, and the seat read `24.9` for
`Z4.9` on every one of five frames. `chartScale()` is the arithmetic and `__scale()` reports it.

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
visibility rule, and the shell wins where both exist BY DRAW ORDER — the
backdrop writes no depth — not by geometry. It was a sink first, and the sink
was wrong twice, which is the next section. The first cut wrote it as
`position.y = -GLOBE_SINK` on the mesh, and the mesh's position is in the
PLANET'S frame, whose y is the pole axis: that sank the globe toward the
south pole, 584m down at Romoos and 400m UP at Letsemeng, where every lattice
vertex of the sphere then stood through the Karoo shell as a small diamond
every 2.25 degrees. A sink that is right in one hemisphere and wrong in the
other is exactly the kind of thing the 47N frame could never have caught; the
Letsemeng day frame at zoom 11,000 did. The second cut sank it along the
focus's radial, which fixed that hemisphere and left the same lattice
standing through every country lower than the rig — see below.

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

## The globe stood through the shell in circles, and the far side's names came through the planet

Reported from the seat with the rig at Mariposa and the chart turned to India:
dark circles on a lattice with four-pointed stars between them across the
whole subcontinent, bands along the parallels over Alberta on the way out,
and Edmonton, Denver, San Francisco, Havana and Guadalajara written over the
Deccan — with west to the RIGHT. Two faults, one measurement each, and the
second turned out to be the first seen from another side.

**The circles are the globe's own lattice.** Autocorrelation of the seat's
frames (`scratchpad/lattice.mjs`, the 16-bit phone PNG decoded with zlib
alone, luma detrended by a 90px box) put the period at **126px across and
128px down** over India and 118/128 over the Arabian Sea coast; at the bar's
own scale (500km over 267 file pixels) 126px is 235km, which is 2.25° of
longitude at 20°N — and `globeGeometry(160, 80)` is a 2.25° lattice. A z7
shell tile, the other candidate, would have been 157px. Over Alberta the
frame carries a y-period of 128px and no x-period, because at 55°N the
longitude chord is short and only the latitude one sags: bands, not discs.

**Why it stood through.** The far shell is built on the sphere at
`R + elev − baseElev − FAR_DROP`: the RIG'S OWN ELEVATION is in every far
vertex's radius, and the rig stood at **2,299m** (terrarium at the spot;
`__origin().baseElev` reads it now). So over India's plains the shell sits
2.2km inside the sphere, over the Deccan 1.8km, over the sea floor 6km. The
globe mesh sank a fixed 800m under the focus, and a 2.25° lattice chords
1.23km below the true sphere at mid-edge and 2.46km at a cell centre: at every
vertex the globe stood 1.4km ABOVE the shell, at mid-edge 180m above it, at
the cell centres 1km below — a disc around each vertex, a star of shell at
each centre. A sink of any fixed size is right at exactly one elevation
difference and this one was chosen with the shell at the rig's own height.
**The fix is not a bigger sink: the backdrop writes no depth** (`depthWrite:
false` in `globeMaterial`), so the shell wins wherever it is drawn, by order,
whatever its radius. Nothing behind the planet is ever drawn — back faces are
culled — so the depth buffer was never doing anything a sphere needs, except
one thing, which is the second fault.

**The names came through the planet.** The place labels were culled by "in
front of the camera" (`view.z > −1`) and by the screen rectangle. A point on
the FAR side of the sphere is still in front of the camera, and the
perspective projection of the far hemisphere lands INSIDE the disc, mirrored
— Mariposa is 163° of longitude from the Deccan, near enough antipodal that
the whole US fell on the near face with east and west swapped, which is what
the frame shows (Denver left of San Francisco, Atlanta left of Dallas). With
the globe's depth gone the pin would have done the same. Both use the exact
cap test now: a surface point P is visible from eye E about centre C iff
`(P−C)·(E−C) ≥ R²` (`onNearCap`, with the eye taken into the planet's frame
once per pass). `__ov().labels` reports what the HUD actually DREW, because
"is San Francisco written over India" is a question about the frame and no
probe could answer it.

**Reproduced and measured** (`devtools/globe-poke.mjs`: the rig at Mariposa,
`__globespin` to 20N 78E, the z5 ring and the overview ring home, frames with
everything, with the shell hidden and with the globe hidden, the clock pinned
to NOON). The lattice number is the autocorrelation at the globe lattice's
own period in the frame, from the chart's stated scale; `shell%` is the share
of the pane that changes when the shell is hidden — what the shell was
drawing; `globe%` the share that changes when the globe is hidden with the
shell on:

| zoom 11,000, India from Mariposa | control (1e7617d) | fix |
|---|---|---|
| lattice at 2.25° (x / y) | **0.424 / 0.449** | **0.130 / 0.064** |
| shell% of the pane | 78.4 | **99.1** |
| globe% with the shell on | (no switch) | **0.00** |
| labels drawn | US cities, mirrored | Delhi, Jaipur, Hyderabad, Pune, Bengaluru, Kanpur, Nagpur, Chennai |
| **zoom 22,000 — the seat's own `500 KM · 1:18M`** | | |
| lattice at 2.25° (x / y) | **0.371 / 0.403** | **0.081 / 0.009** |
| shell% of the pane | 66.1 | **96.1** |
| globe% with the shell on | (no switch) | **0.00** |
| labels drawn | US cities, mirrored | Kabul, Lahore, Delhi … Chennai, fourteen, none American |

The control's frame IS the seat's frame — lighter discs of globe on the
lattice, darker stars of shell, the US names across it — and the shell-hidden
frame beside it is the bare planet with the same names, which is the label
fault on its own.

**Two traps in the measuring, both of which cost a run:**

- **`time=DAY` is not a mode.** `TIME_MODES` is CYCLE, LIVE, DAWN, MORNING,
  NOON, AFTERNOON, DUSK, NIGHT; an unknown value leaves the 24× cycle running,
  the two hide frames were five sim minutes apart, and the "globe%" read 2.8%
  of dither re-weaving under a moved sun. Pin with `time=NOON`.
- **At dawn the control read the lattice at 0.021 — lower than the fix.** The
  globe's day side and the shell under a sun on the horizon were the same
  tone, so the discs were there and invisible in luma, and a "control that
  shows nothing" would have said the harness could not reproduce the fault.
  The same run at NOON read 0.424. A negative control is a claim about the
  lighting as much as the geometry; look at the frame before believing the
  number, and pin the clock.

**And the scale line's zoom is `z5.0` now, lowercase with a real glyph.** The
seat read `24.9` on all five frames for what the HUD drew as `Z4.9`: in the
5×7 face, Z (`v1248gv`) and 2 (`eh1248v`) are the same diagonal with one
pixel of difference at the top. The table had no lowercase at all —
`GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()]` — so the tile-debug line's `MAP z13`
had been drawing a capital Z all along too. `z: '00v248v'` is five rows at
x-height and cannot be read as a digit.

## The dump can see the planet, a retired ring is one ring, and the globe has mass

Asked from the seat: is the FPS-tap telemetry enough to diagnose the globe's
frame rate, and can the spin have momentum. The first answer was no, and the
reason is in the phone's own status line on the India frames: `FAR Z5 83/87`
at 3 fps — 83 shell meshes on a ring of 25 — and not one row of the dump
could have named it. Every phase in the report is CPU time; the profiler's
`render` row is the main thread ISSUING draws, and `gap (unmeasured)`
"cannot establish a GPU bottleneck" by its own note. A chart that is slow
because it draws three retired rings of 128² lattice under the live one is
slow somewhere the dump did not look.

**What the dump carries now** (`__telemetry()`, the double tap on the FPS
readout; `devtools/globe-poke.mjs` prints these rows at the end of a run):

- `chart …` — camera mode, zoom, m/px, home or browsed with the focus, globe
  on/off and `free`, fling on/off, the far ring as `z5 25/25 retired 0
  inflight 0 queued 0`, the overview the same with its places and the labels
  actually DRAWN.
- `world pass: draw calls … triangles …` — off `renderer.info` right after
  `renderer.render(scene, camera)`, every frame: session mean and max, the
  recent window's p50 and p95, the last pass. A frame rate that falls with
  every CPU phase flat is fill or triangles, and this row says which count
  moved. (`renderer.info` autoResets at the next render() and the last
  render of a frame is the composite's two triangles — `__gpu` draws its own
  frame to read it; the sample here is taken between the two.)
- Each slow frame in the log carries its own `M tris / calls` beside its top
  three phases, so a 400 ms frame reads `render:12 hud+misc:9 … · 2.7M tris
  91 calls` and the blame is on the line.
- `farBuild`, `ovBuild` and `stepGlobe` are phases. A z5 tile's 128² bake
  with its normal map and a Natural Earth tile's ribbon build used to fall
  into `world:stream`; the planet's placement into `camera`.

**And the 83 meshes were a bug, not a budget.** `setFarLevel` pushed the
whole previous ring into `farRetired` on every level change, and
`dropRetiredFar` waited for the NEW ring to land completely (`farInFlight
=== 0 && farQueue.length === 0`) — which one tile on a retry backoff defers
for as long as it retries. A browse from the seat's zoom to the planet swaps
the level three times in a few seconds, so three rings stacked, each drawn
every frame under the live one, and the four tiles that never landed kept
all of them. The overview had the same shape (`ovRetired`). Now the previous
level is the ONLY ring held — the globe backs whatever it does not cover,
which it could not while it wrote depth — and `cullRetiredFar` drops each
retired tile on its own evidence: coarser now, when its one ancestor at the
new level has landed; finer now, when every descendant the ring asked for
has landed; and at `FAR_RETIRED_MS` (20 s) whatever happened. The material
cache grew from 30 to 56 with it, two rings' worth, or the eviction handed
LIVE tiles the tangent-space fallback and lit them with a vignette beside
neighbours lit by the sphere.

**AND THE RING LEAVES TILES BEHIND, which is the other half of the 83.** With
the retired stack gone the reproduction still read `far 45/45` at the ring
line — forty-five CURRENT-level tiles on a ring of twenty-five — and `ov
28/50`. The stream pass asks a 5×5 around the chart's focus every ~1.2 s,
and a focus turning from California to India asks a fresh ring at every step
of the way; nothing ever took the old ones down, because the only eviction
the shell had was the cover-dirtied REBUILD. So the pass records the ring it
asked (`farRingAt`, `ovRingAt`), drops every landed tile more than one ring's
margin outside it (all six maps a far tile lives in, its material included,
the dateline wrapped), and a fetch that comes home outside the ring is not
built at all. Measured on the reproduction (India from Mariposa, the ring
home): the far ring line went from `far 45/45` to
**`25/25 retired 0`**, the world pass from **116 draw calls and 2.05M
triangles to 76 and 1.38M** at the seat's own zoom, the lattice and the
labels unchanged (0.081 / 0.009, fourteen South Asian names). The overview
then read `15/25` with nothing in flight, nothing failed and nothing
demless — `__ov().missing` names the ten — and the ten are open ocean: an
EMPTY tile keeps its key and makes no mesh, and `ovMeshes.size` was the
"have", so the status line would have said `MAP z5 · 15/25` over the Indian
Ocean for as long as the chart stayed. Empty landings count as home now
(`ovEmpty`, `ovHave`), and the stragglers that used to pad the count are
gone from the asked sets as well as the meshes.

**What the new rows said on their first run, and what is next.** In the
harness the far build read 618 ms a tile on the main thread (50 tiles, 35%
of all slow-frame time); then the seat's first dump with the rows in it
(iPhone, 96 s, a browse from Mono Lake to Newfoundland at z11) put the
number where it counts: **146 ms a tile, 259 tiles, 37.8 s of a 96 s
session, 87% of every slow frame and top of 148 of the 162** — the whole of
the 12.3 ms/frame "off-tick tasks" row, with `render` at 1.2 ms and the tick
at 4 ms p50. A z11 ring is twenty-kilometre tiles and a pan across an
ocean re-centres it every stream pass, so the browse asks and BUILDS rings
all the way. The build runs by phase now — `far:bake` (the lattice and the
vertex loop: a cover sample, the palette and the sphere per vertex),
`far:geo` (attributes and normals), `far:nrm` (the normal map) — as the
only wrappers, so the off-tick total counts it once. **In the harness the
split is 614 / 5 / 7 ms: the vertex loop is 98% of the build**, the normal
map and the geometry are noise, and the loop is one function over a raster,
a cover raster and the palette — the shape the terrain kernel already runs
in a worker. That is the next unit, and `far:bake` is the row that will
measure it. The same dump also read `places 800 · labels 0`: the place table
is keyed by name and capped, and the browse had filled it with every town
it passed over, so nothing at Newfoundland could register; places leave
with the ring now, by its own box in degrees. And `ov z11 0/30` with
nothing in flight is a question the row can answer since it carries
`failing` and `demless` — z11 is live Overpass, and a refused ring waits out
`OV_RETRY_MS` between asks.

(This paragraph was written once before, uncommitted, and eaten by the
deploy ritual's own pull — the trap the top of this file describes, walked
into by the author of the section above it. Commit before you pull.)

**The fling.** A drag on the planet stopped dead under the lifted finger,
which at 20,000 km reads as a map stuck to the glass. `dragGlobe` keeps a
running velocity — an EMA over about 50 ms of moves, in degrees a second,
the drag's own units — and a lift within `GLOBE_FLING_HOLD_MS` (90) of the
last move releases it; `stepGlobe` feeds it into the retained focus a frame
at a time and decays it with `GLOBE_FLING_TAU` (0.45 s: a flick at 135°/s
coasts about 60°), capped at 180°/s, at rest under 0.05°/s, dead at the
pole's clamp. A finger that rested before lifting throws nothing (a rest is
a place); a touch stops a spinning planet; a second finger is a pinch and
never throws; leaving the chart drops it. It is a change of focus like the
drag it continues, so the rig, the streamers and the hand-over know nothing
new. `?fling=0` and `__fling(false)` turn the release off; `__globe().fling`
and `__fling().vel` report it. Measured (`devtools/globe-spin.test.mjs`, its
throw block): released at 6.18°/s westward off an eight-move
harness drag, the planet coasted 2.85° further, the spin read zero after
1.6 s and the focus moved 0.000° in the 300 ms after; the same drag with the
finger resting 250 ms before the lift threw 0.000°. (The first cut clamped
`dt` at 100 ms and decayed per FRAME, so on the harness's slow frames the
coast ran in frame-time and the planet was still turning 0.5° per 300 ms
long after it should have rested; the closed form `v·τ·(1−e^(−T/τ))` is
exact for any frame length and needs no clamp.).

**AND THE DOUBLE TAP DROPPED A FIX UNDER THE READOUT.** Reported the
moment the rows shipped: the telemetry copied, and a fix appeared where the
FPS figure is, its record written to the clipboard over the telemetry.
`fpsDown` swallowed the pointerdown; the pointerup still reached `endStick`,
whose chart tap logic is "any up without a stick", and the readout's two
taps were the chart's double tap. Every instrument that takes a down now
puts the pointer's id in `hudPtrs`, and `endStick` ends on that id before
the chart is asked anything — for a cancel too, and for the window's copy
of the same up (`lastUp`). `devtools/fps-tap.test.mjs` double-taps the
readout by its own rectangle (`__fpsTap()`) and asserts one copy and no
fix, then double-taps open chart and asserts a fix — the control that keeps
the first assertion from being vacuous.

**Two traps, one round each:**

- **Moves under 4 ms apart update no velocity.** A synthetic drag dispatched
  in one task — the navigation test calling `dragGlobe` directly, a
  `page.evaluate` — has no clock in it; without the floor every such drag
  would have thrown, and every gesture test would have measured the coast on
  top of the rate. The harness's real pointer stream at 12–30 ms a move
  throws exactly as a thumb does, so the spin test's rate checks run with
  `fling=0` and its throw has its own block with `__fling(true)`.
- **A test that asserts SOURCE ORDER by literal text breaks when the text
  changes.** `globe-navigation.test.cjs` proves the zoom is advanced before
  `stepGlobe();` by comparing two `indexOf`s; wrapping the call for the
  profiler turned the needle into −1 and the assertion into a falsehood
  about ordering. The needle follows the wrapped call now.

## The globe is a graticule, the shell has a terminator, and a baked tile survives eviction

Four reports from one test drive over the wide chart, and three of them are one
unit: drop the baked globe for a lat/lon wireframe; why are loaded tiles dropped
("what a waste?"), at what threshold, and do the `~/` routes allow client
caching; and the world has no sun on it. (The fourth was the dock over the
menus — "A WebGL blit answers to no overlay", above.)

### The surface is drawn now, not fetched

`static/globe-base.png` was a 1024x512 equirect bake — 317KB, 39km a pixel —
fetched on the first wide chart, and `globeFree` stayed 0 until it landed, so
the first browse of a session waited on an asset before a drag meant anything.
`globeMaterial` computes a graticule instead: 15 degree minor lines at 0.55 of
the ink, 90 degree majors and the tropics at |lat| - 23.44 at full weight, over
a nearly-black ocean-blue fill that the shell is meant to paint over.

- **A SCREEN-CONSTANT LINE NEEDS DERIVATIVES.** The widths come from
  `fwidth(lon) * 0.75` in degrees, which is what keeps a meridian the same
  weight at 2,000km and at 20,000 instead of aliasing into a smear as the disc
  shrinks. `extensions: { derivatives: true }` on the material, because this is
  a WebGL1-compatible ShaderMaterial and the extension is not free.
- **MERIDIANS FADE AT THE POLES**, where any fixed spacing converges into a
  solid cap of ink: `poleFade = smoothstep(0.02, 0.30, cos(radians(lat)))`.
- **LAT/LON COME FROM `vUv`, NOT FROM THE NORMAL.** The lattice is 2.25 degrees
  a quad and uv is linear across each one, so the error is a fraction of a
  quad's width on a line — invisible — and it costs no trig. The frame is
  mirrored (see the sphere section), so a normal would have to unmirror first.
- `GlobeUniforms` is `{uSun, uNight}`; `uBase` and `globeTexture()` are gone,
  and with them the fetch, the retry and the "asked / failed" state the probe
  used to carry. `__globe()` reports `wire` where it reported `tex`, and
  `globe-spin.test.mjs` lost the thirty-second poll that waited for the asset.
- **A BACKTICK IN A GLSL COMMENT ENDS THE TS TEMPLATE LITERAL**, and it cost
  another round here — in a comment describing a helper's own parameters, of
  all places. The rule is absolute: no backticks in shader comments, ever.
- **AND THEN REMOVED, IN FIVE PLACES**, because an asset nobody fetches is
  324KB of payload on a deployer that already runs at its memory ceiling every
  time — and a baker still pointed at it is a resurrection waiting to happen.
  The file, its route in `index.ts`, the harness's local serve of it, the
  `ON_DEMAND` exemption in `appshell.test.mjs` (kept as an empty set: the next
  asset of that shape needs the exemption to exist) and `devtools/bake-globe.mjs`
  itself. **`cells.deleteFile` is what takes it off the cell** — a push sends
  what is local and does not delete what is not, so a file removed only from
  the working tree comes back on the next pull. And the deployed BUNDLE keeps
  its copy until the next deploy re-zips `static/`, so the cleanup is a deploy
  as much as a delete.
- **THE CLEANUP UNCOVERED A CHECK THAT HAD BEEN FAILING SINCE `cover-wide.b64`
  ARRIVED.** `appshell.test.mjs` asserts no static asset is read through a
  UTF-8 decode — the fault that once served inflated mojibake PNGs behind a 200
  — and its needle matched `join(__dirname, 'static', <anything>), 'utf8'`,
  which is `cover-wide.b64`: a base64 TEXT file the handler reads by name and
  decodes itself, correctly. The needle is the asset-serving call now
  (`'static', file`), which is the only one that can carry a binary. It fails
  at HEAD and at the commit before it; a check that fires on the right code
  doing the right thing is a check nobody reads.

### The terminator was on the globe, and the globe is not what you are looking at

Measured before changing anything: the globe's own day/night term is real, and
at DUSK it puts the night side at 0.6 of the day side — about one step of a
fourteen-level palette, which is why it reads as no terminator at all. And the
far shell, which is what actually covers the frame at every zoom where the
planet is up, had NONE: it is Lambert ground under the SCENE's sun, and the
scene's sun is the rig's local sun, so the whole visible face of the Earth was
lit as though it were the truck's hour everywhere.

- **ONE COPY OF THE TERM, SHARED.** `PLANET_SUN_GLSL` in globe.ts is
  `planetLit` / `planetLam` / `planetDusk` / `planetSun`; the globe material
  includes it, and `planetSunFx(mat)` chains it onto every far tile's material
  (and onto the fallback `farMat`). Chained, never assigned: `terrainFx` owns
  `worldpos_vertex`, `lights_fragment_begin` and `dithering_fragment`, `grain`
  owns `color_fragment`, `sphereNormal` owns `normal_fragment_maps`, so this
  one hangs its varying off `begin_vertex` and captures the previous
  `onBeforeCompile`.
- **THE SUN ARRIVES TWICE, IN TWO FRAMES.** `uSun` is in the GLOBE's frame,
  because the mesh is a child of `planetGroup` and the rotation is in its model
  matrix; `uPlanetSun` is the same direction in WORLD space, because the
  shell's fragment reconstructs its own radial in world space. One vector for
  both is the fresnel fault from the globe's first day, one section up.
- **IT IS A CHART TERM.** `uPlanetMix` ramps over `uMpp` 15 to 60 — the same
  ramp the cloud shadows and the mottle already stand down over — and is 0 in
  any camera but `top`, so from the seat the shell keeps the scene's own sun
  exactly and nothing a driver sees changes.
- The globe's rim took its night share from 0.25 to 0.10 with it: a limb
  brighter than the ground it wraps is the blue veil again, in miniature.

**Measured**, Letsemeng, zoom 110,000, one scanline through the middle of the
frame, `?wx=clear` and the clock pinned:

| clock | before | after |
|---|---|---|
| NOON | 88-107, flat | 88-107, flat (unchanged, correctly) |
| DUSK | 107 to 88 | **107 in the west, 27-28 in the east** |
| NIGHT | ~88 | 28-29, flat |

The night side is a quarter of the day side where it was three fifths, and the
ramp between them crosses the frame where the terminator is.

### The tiles were not evicted for memory, and what was thrown away was the bake

The seat's question was three questions, and they have three separate answers:

- **The eviction is GEOMETRIC.** `evictFarOutside` drops every far tile more
  than one ring's margin outside the 5x5 the stream pass last asked for. There
  is no byte budget and no LRU; that rule is the fix that took a browse from 45
  tiles on a 25-tile ring (116 draw calls, 2.05M triangles) down to 25.
- **The routes DO allow client caching, and always did.** `~/dem/v1/`,
  `~/cover/v1/` and the OSM routes answer `public, max-age=604800, immutable`
  (a month for summits), the S3-served copies carry an ETag, and the client
  keeps DEM bytes in its own IndexedDB raster store on top of that. A
  re-entered tile costs no download at any of the three levels.
- **What it costs to come back is the BAKE**, and that is a device number: 146ms
  a tile on the phone (259 tiles in a 96s browse, 87% of every slow frame), of
  which 98% is the vertex loop — a cover sample, the palette and `sphereRTC`
  per vertex — plus the tile's own normal map. The bytes were never the cost.

So a tile leaving the ring is PARKED rather than destroyed: the GPU buffers go
(`geometry.dispose()`), the arrays the bake wrote stay, and re-entering the
ring is `farGroup.add(mesh)` and a re-upload. **Draw calls and triangles are
exactly what they were** — the ring still decides what is in the scene, which
is the fault the ring was added to fix, and nothing here touches it.

- **BOUNDED IN BYTES, NOT TILES**, because a tile is not one size: the lattice
  is `farSeg(z)` a side and the levels do not agree. Least-recently-seen goes
  first. Per tile, by level, **as the park first shipped** — attrs is position,
  colour and normal as vec3 Float32 plus uv as vec2 Float32; the index is Uint16
  under 65,536 vertices; the map is the tile's own 256x256 **RGBA** object-space
  normal map. (The next section took every row of this to about a third; the
  table is kept because the cut is only legible against it, and
  `devtools/park-bytes.mjs` prints both columns.)

| seg | levels | vertices | attrs | index | map | tile | ring of 25 |
|---|---|---|---|---|---|---|---|
| 32 | z13 | 1,089 | 0.05 | 0.01 | 0.25 | **0.31MB** | 7.7MB |
| 64 | z11 | 4,225 | 0.18 | 0.05 | 0.25 | **0.47MB** | 11.9MB |
| 128 | z9, z7 | 16,641 | 0.70 | 0.19 | 0.25 | **1.14MB** | 28.4MB |
| 112 | z6 and coarser | 12,769 | 0.54 | 0.14 | 0.25 | **0.93MB** | 23.2MB |

  The 23.2MB the park reported at planet zoom is the last row exactly, which is
  what says the arithmetic and the measurement agree. `devtools/park-bytes.mjs`
  re-derives the table in pure node (it re-runs `farSeg`'s own rule), so a
  change to the lattice can be costed without booting anything. **The earlier note here
  quoted a 128-lattice breakdown beside the 112-lattice total and had the
  normal map at RGB**: the map is RGBA and 0.25MB, and at the coarse end it is
  the largest single item in the tile — 27% of it, for a texture 2.3x finer
  than the lattice it is on.
- **A CAP THAT HOLDS ONE RING IS A CAP THAT NEVER PAYS.** The first cut was
  24MB, which is 25 tiles — exactly one ring — so a spin out and back always
  evicted what it was meant to keep: the outgoing ring parked at 23.2MB and the
  trim had dropped it to make room for the ring in between, `hits 0`. 48MB is
  two rings and a bit. `?farpark=<MB>` moves it and 0 parks nothing, which is
  the exact A/B, because the right number is a property of the device and this
  one is a desktop's guess.
- **A TILE OWED A RE-BAKE IS NOT PARKED** (its colours are stale by
  definition), and neither is one whose material the normal-map cache has
  already taken — it would come back wearing the tangent-space fallback, lit by
  a vignette beside neighbours lit by the sphere. For the same reason a parked
  tile's material comes OUT of `farMats`: that cache is capped at two rings and
  DISPOSES what it drops, and a park outlives it by design.

**Measured**, the same browse out and back, the only difference the park:

| | tiles parked | MB | hits | tiles fetched |
|---|---|---|---|---|
| spun away | 25 | 23.2 | 0 | 50 |
| came back | 25 | 23.2 | **25** | **50** |

Before the park the same pair read **75 fetched**: the return cost a whole ring
of bakes, and now it costs nothing. `__far().park` and the telemetry's `chart`
row report tiles, MB, cap and hits.

**THE HONEST NEXT CUT IS THE PER-TILE COST, NOT THE CAP** — this is what was
proposed from the 0.93MB row, and the section after it is what was actually
done, which differs in its first line for a reason worth reading:

| cut | saves | why it is safe, and what it costs |
|---|---|---|
| the normal map at 128² for coarse levels | 0.19MB | at z5 a 256² map over a 1,085km tile is 4.2km a texel against 9.7km a vertex — it is already finer than the mesh it shades, and the chart is 22,000 m/px there |
| uv + index owned by the LEVEL, not the tile | 0.24MB | both depend only on `farSeg(z)` and are byte-identical across a ring; needs the lattice built by hand instead of from PlaneGeometry, and an owner, because `geometry.dispose()` frees the GPU buffer of every attribute it references and the next tile to go would take the level's uv with it |
| colours as normalized Uint8 | 0.11MB | the palette answers 0..1 and the composite quantises to 14 levels — 8 bits is four times the precision that survives the dither |

0.93MB becomes about **0.39**, and the same 48MB then holds a hundred and
twenty tiles rather than fifty. A fourth is worth measuring before it is
believed: the vertex NORMAL attribute (0.15MB) may be dead weight, since the
shell wears an OBJECT-SPACE normal map and `sphereNormal` rebuilds the frame
from the fragment's own position — but three wants a normal on a Lambert
material, so that is a claim to test, not to assume.

*(What landed: the first row's argument was wrong and was replaced by a
two-channel map at full resolution, the other two landed as written, and the
fourth turned out to be needed by the fallback material. 0.93 → 0.340,
measured live. See below.)*

### …and the next cut was taken: 0.93 MB a tile becomes 0.34

Three of the four items above landed, one was replaced by something better, and
the fourth was answered by reading the code rather than measuring it.

- **THE NORMAL MAP KEEPS ITS RESOLUTION AND LOSES A CHANNEL.** Halving it to
  128² was the proposal and the argument for it was wrong: "already finer than
  the mesh it shades" is what a normal map is FOR. The honest comparison is
  against the SCREEN, and at the BAND FLOOR of every coarse level — the closest
  zoom at which that level is ever drawn, which is what `farSeg` already
  computes — a 256 map is about **1.5 texels a pixel**. Halving would be
  visibly soft at the near end of every band. What is actually redundant is the
  third channel: `normalMapBytes` writes east, up, south, 255, and a
  heightfield's UP is always positive, so `sqrt(1 - x² - z²)` recovers it
  exactly. `farNormalTex` packs the pair into RG8 and `sphereNormal` — which
  already replaces three's whole `normal_fragment_maps` chunk and decodes the
  texel itself — reconstructs the third. **0.25 MB → 0.125, at the same
  resolution and the same precision in what is stored.** RG8 is WebGL2; on a
  WebGL1 context the same pair goes into RGBA, so the shader's `.xy` means one
  thing everywhere and there is one decode, not two.
- **THE uv AND THE INDEX BELONG TO THE LEVEL.** Both depend only on `farSeg(z)`
  and were byte-identical across a ring — twenty-five copies of 0.31 MB at the
  128 lattice. `farLattice(seg)` holds one of each per segment count (the clamp
  gives four across the whole ladder, 0.655 MB for all of them together), and
  the bake builds its own lattice rather than taking `PlaneGeometry` — which is
  the cost: the layout has to reproduce
  `PlaneGeometry(w, h, seg, seg).rotateX(-π/2)` EXACTLY, rows north to south,
  uv `(ix/seg, 1 - iz/seg)`, triangles wound a-b-d / b-c-d, because the normal
  map's rows are stored reversed against that mapping and a lattice that
  disagreed would light every shell tile upside down. (`plainLattice` in the
  kernel is the same construction for the fine tiles and is the thing to read
  beside it.) The index is Uint16 while the lattice is under 65,536 vertices,
  which `farSeg`'s 128 clamp guarantees; PlaneGeometry hands out Uint32 at that
  size, so the sharing pays twice.
- **COLOURS AS NORMALIZED Uint8, NORMALS AS NORMALIZED Int8.** `terrainPalette`
  answers 0..1 and the composite quantises to fourteen levels, so eight bits is
  several times the precision that can reach the glass; a normal is a unit
  vector and a byte a component is about half a degree. **`Uint8Array` WRAPS
  rather than clamping**, so a palette that ever answered over 1 would come
  back as a dark vertex instead of a bright one — one wrong pixel in a ring of
  twenty-five tiles, which is the kind of thing nobody finds. Clamped
  explicitly.
- **AND THE VERTEX NORMAL IS NOT DEAD WEIGHT, which is why it is still there.**
  It looked droppable: `sphereNormal` replaces `normal` outright from the map,
  so on a tile wearing its own material nothing reads it. But the shared
  fallback `farMat` — what a tile wears when `NRM_SCALE` is 0 or the material
  cache has taken its own away — carries the fine terrain's TANGENT-space map
  and shades through three's standard path, which builds its frame from the
  geometry normal. Code reading, not an A/B: the claim was testable and turned
  out not to need a test.

**Measured in a live page** (`devtools/park-ab.mjs`, Letsemeng, `wx=clear`,
`time=NOON`, the same spin out and back the park was built against, run once on
the working tree and once on a control worktree at HEAD):

| | control | fix |
|---|---|---|
| z5 ring (seg 112) | **0.930 MB a tile** | **0.340** |
| z7 ring (seg 128) | 1.14 (derived) | **0.420** |
| parked / hits on the return | 10 / 10 | 10 / 10 |
| page errors | 0 | 0 |

`devtools/park-bytes.mjs` derives the same table in pure node and agrees to the
millibyte. The 48 MB budget now holds about a hundred and forty z5 tiles rather
than fifty — five rings and a half, so a browse across a continent and back is
free where a spin out and back was.

**AND THE PICTURE IS THE SAME PICTURE, with a control that says how much
"same" is worth.** Two runs of the SAME build, frame against frame over the
terrain band: **mean 0/255, worst 1.9, nothing moved by more than 3** — the
clock is pinned and the tiles are the same tiles, so the renderer is
deterministic there and any difference is attributable. Control against fix
over that band: **mean 0.211/255, worst 12.6, 2.47% of pixels moved by more
than 3** — under one palette step (0.07 sRGB is 18/255) everywhere, which is
the quantiser flipping pixels that were already sitting on a level boundary.
**The full frame's worst is 112.9 and it is NOT the terrain**: the same 112.9
appears control-against-control, and the diff panel puts it on the status line
(`MAP z5 · 18/25 · 7 RETRY` against `· 16/25 · 2 ON THE WIRE` — the overview
ring's streaming state, which is the relay's timing) and on the cab dock's live
preview. A worst-pixel number over a frame that contains a HUD is a
measurement of the HUD.

### `qsNum` answered 0 for every switch that was not there

`qs` answers `null` for an absent switch, `Number(null)` is **0**, and 0 is
finite — so `qsNum` returned 0 rather than the default for every numeric switch
that was not in the URL. It had been that way since the typed reader shipped,
and nothing noticed because until `farpark` no caller had a default whose
absence was visible: a 0MB park budget parks nothing and reports `hits 0`,
which looks exactly like a park that does not work.

`switches.test.mjs` gained the case it was missing — absent, empty, and a
garbage value all fall back — and it is the case the table's whole contract is
about. **A typed reader is only as good as the test that reads what it answers
when asked for nothing.**

### Three stale assertions, and the control that said which were mine

The far-ladder merge and the sphere pass each retired something a globe test
still asserted, and running the suites at HEAD before touching them is what
separated the three:

- `globe-navigation.test.cjs` called `chartShellMatrix`, which the sphere pass
  deleted with the paraboloid. Replaced by the contract that succeeded it: the
  `sphereRTC` / `sphereLatLon` round trip is exact at four tile centres from
  the equator to 84N, and a parked tile's vertices stay within 2e6 metres of
  their own centre (which is what keeps the Float32 upload honest). Checked
  against a control with the sign flipped in `sphereLatLon`, where it fails on
  the first non-zero longitude.
- The same file proved the zoom is advanced before `stepGlobe` by comparing two
  `indexOf`s, and the needle `'  stepGlobe();'` stopped matching when the call
  was wrapped for the profiler — so the assertion became a true statement about
  -1. **Both needles are required to exist now**, and the needle is
  `profAdd('stepGlobe'`, which only the call site carries. This is the second
  time this exact check has gone vacuous.
- `globe-spin.test.mjs` required the shell to be OFF at planet zoom. `shellOn`
  carried `&& globeFree() === 0` when that was written; both backdrops are
  children of `planetGroup` now and are placed from one focus, so they cannot
  disagree and hiding the ring would open an edge rather than close one. It
  asserts the pair instead — both drawn, the GESTURE handed over — which fails
  if anyone re-ties them.

And one that was neither stale nor mine: the fling block asked for zoom 40,000
with a bare `__zoom` and a fixed 600ms wait. `__zoom` sets a TARGET the frame
loop eases toward, the harness runs at two to four frames a second, and the
block before it left the chart at z900 — so the drag happened below the
hand-over, where it is a flat pan that records no spin, and the throw reported
`released at 0°/s`. It polls with `zoomTo` now, and the same drag then throws
at **-26.43°/s and coasts 11.88 degrees** — the fling was never broken, the
test was measuring a chart that had not finished arriving. **The zoom and
everything else live on different clocks** — the same trap `chart-dist.mjs`
carries a note about, met from the other side.


## The substrate's contact sampler was a linear scan, and it was on every URL

The substrate migration (`SUBSTRATE-MIGRATION.md`, pulled from the branch on
2026-09-10 and deployed the same hour) routes `surfaceAt`, `waterInfoAt`,
`splashWet` and `tyreHeight` through `productionContactAt` on ORDINARY URLs —
canonical contact is the default, `?substrate=legacy` the rollback,
`?substrate=render` the guarded water renderer on top. The seat's first dump
on it, under `render`: 14.6 fps, 59% of frames slow, the tick at 48.5 ms a
frame — `stepWildlife` **14.5 ms every frame** (0.3 on the build before),
`sim:suspension` 4.1 (0.1), `treeRefresh` 62 ms a call with `shrubs` at 31
(12 and 4), `hydroBuild` 111 ms a build (5). The fixture A/B
(`scratchpad/substrate-ab.mjs`: at-campsbay, chase, nodraw, 60 s a mode)
put it on the DEFAULT path, not the flag: stepWildlife 0.8 → 4.9 ms a
frame, sim:suspension 0.2 → 1.4, treeRefresh 12 → 40 with shrubs 3.6 → 30,
and `render` the same plus a little.

**The cause is two loops, not the design.** `tileAt` scanned every tile in
the store for every query, and the sampler walked every drive segment of
the tile for every query — validating each with an eight-element array
allocated per segment per query — on a 2 km tile carrying thousands of
them. The ground mesh beside it already had a cell index. Now each tile
files its segments once, at its first sample, into 32 m cells by their
reach (halfWidth + shoulder: the sampler keeps a segment only within that
distance, and a box grown by it contains every such point), a query reads
its own cell's list, validation happens at the filing, and `tileAt` keeps
the last tile answered under the store revision it answered under — a
wheel, an animal, a lattice point asks thousands of times inside one tile.
The substrate's self-test is unchanged. Measured after, same A/B:
default stepWildlife **4.9 → 0.6 ms a frame**, sim:suspension **1.4 →
0.1**, treeRefresh **40 → 12 ms** with shrubs **30 → 2.4**; `render` the
same (5.2 → 0.6, 1.4 → 0.1, 40 → 11.5) with its tick 11.0 → 3.8 ms a frame;
every mode at 56 fps, indistinguishable from `legacy`, no page errors.

**Two things to know from it:**

- **A switch read round `qs` is on no list.** `?substrate=` was read with
  `new URLSearchParams(location.search).get('substrate')`, so it was
  declared nowhere, absent from SETTINGS and invisible to `switches.test`
  — which is exactly what the typed reader was built to make impossible,
  and it was walked round in one line. It is a `choice` switch now.
- **A per-query cost is a device number.** The migration's own gates
  ("frame time … within the existing production budgets") were green on a
  harness build-budget run that measured the tile BUILD; nothing measured a
  contact query, and a query that is cheap once is a frame when it is
  called ten thousand times. The dump's phase rows are what caught it, on
  the phone, in one paste; `stepWildlife` is the canary because it is the
  caller with the most queries a frame. What is still unexplained: the
  phone's `hydroBuild` at 111 ms a build under `render` (26 ms on the
  fixture; the migration's 23.3 ms is a harness number too) and the terrain
  worker at 334 ms a build (70 before) — both under the flag only, both
  awaiting a device dump on the fixed build.

## The tile that popped out: invalidation forgets the commit, not the picture

The Senqu report, chart z11.9 with tile debug on, `?substrate=render` (the
switch persists — it is not `owned` — so a phone that tried it once is still
on it): the z14 boxes "keep rendering and then popping out and rendering
again". Status line `REBUILD 31 · COV Z10 25`, several 2 km squares filled
navy. Read from the code, then measured.

**The mechanism.** `markTerrainDirty` → `invalidateProductionSubstrateTile`,
and in render mode that pulled every admitted mesh of the tile out of the
world — terrain, carriageways, structures, rapid detail — and unrendered its
water, the moment the tile was dirtied. The tile was then a hole until its
rebuild landed (one heavy job a frame, a 100–400 ms `workerGap` between
builds, thirty-one deep), the substrate re-assembled it (a microtask, or a
retry ladder of 40 ms → 12 s when the commit was refused — 48 refusals in
75 s here, most of them the hydro field not yet renderable), and the atomic
commit put a whole new revision back. A cover raster landing over the fine
ring dirties every tile under it at once, so this was a wave of holes, one
per cover arrival. The legacy path never showed it: `applyTileBuild` swaps
the mesh in the same call. **The navy is the globe.** The far shell would
have shown through a fine hole (it sits 12 m under), but `coverDirtiedFar`
removed the shell tile under the rig at the same cover arrival and forgot
the ask, so both layers were gone together and the frame was the planet's
own tint — the harness frame at 26 s is one flat dithered field edge to
edge, with `far z11 25/25` back a moment later.

**The rule now: the authority goes at once, the picture stays until the next
one is admitted.** Invalidation forgets the four commits (and stands the
rapid-rock colliders down — a rock the next revision moves must not still
be hit); `productionSubstrate.remove` still drops contact to the legacy
sampler, which reads the new build the moment it exists. Every commit
function already kept its `previous` binding and, on a different revision,
removed and disposed the old meshes in the call that added the new — that
swap was always there, it was just never reached with anything to swap. The
hydro system does the same in deferred mode: `installField` keeps the old
field's parts, `renderField` swaps them on admission (`renderedField` is
what the parts were built from — `parts.length` used to mean "rendered",
and would have made the new field a no-op behind the old picture). The build
slots leave a substrate-owned old mesh where it is (`retireTerrainSource`);
the binding disposes it at the swap. The far shell: `coverDirtiedFar` marks
a tile `farStale` and keeps its mesh and bake records, `loadFarTile` asks a
stale key again, and the landing swaps the mesh in the same breath the new
one is built; `farAsking` stops a second cover arrival during the fetch
asking a third time.

**Measured** (`scratchpad/holes.mjs`: the Senqu spot, top cam, render mode,
NOON, 75 s at 200 ms, a hole = a built fine tile with no mesh in the world):

| | samples with a hole | mean holes | max | invalidations | refusals |
|---|---|---|---|---|---|
| before (f57f15c) | **40%** (76/192) | 1.17 | 6 | 53 | 48 |
| after | **0%** (0/187) | 0 | 0 | 52 | 39 |

Same invalidations, same refusals: nothing about the churn changed, only
what the churn takes off the screen. The `hydro-render-cutover`,
`substrate-render`, `globe-navigation` and `fps-tap` tests pass; the
`substrate-render` assertion `uncommittedVisibleTerrain === 0` still holds at
its settled state — mid-rebuild that counter is now the stale-but-shown
count, by design.

**The instruments.** `auditGroundHoles` runs every frame over `terrainMeshes`
(a ring is under a hundred keys): `holes` now, `unshown` (built, never yet
admitted — first-admission latency, not a pop), `pops` (a tile that WAS
shown going dark), hidden time and the longest stretch. `__tileholes()`
carries them with the open holes and the far `asked/stale/inflight`; the
dump has them as the `ground:` row under `chart`. A settled render mode reads
`holes 0 · pop-outs 0`. **The tile-debug overlay has a key now** — see
"The layer ladder, and the key that names it" below for what it says and
where it sits.

**What to take from it:** a remove-then-wait is a hole for as long as the
wait, and the wait is the whole rebuild queue. Anything that replaces a
visible thing asynchronously keeps the old one up until the new one is
ready — the route solver learned this ("old route live until the new one
lands"), the far level swap learned it (the retired ring), and the substrate
commit had the swap written and was bypassed by its own invalidation.

## …and then it still read flat, because the sea was not STEEP

The seat again, after the soundings fix: "I am still convinced we're not
seeing any vertex shader height to waves — relocated offshore, drone, near
sunset, pixel quantisation and dither off, and the ocean is totally flat.
Do we need to set height to something arbitrarily large to confirm?" The
answer to the last question is no, and doing it is what settled the first.

**THE VERTEX PATH WAS PROVED SOUND BEFORE ANYTHING WAS TUNED**, and the
proof is the part worth keeping. At the seat's own coordinates, hiding the
hydro mesh, the legacy sea plane and the far shell in turn showed the
visible water IS the hydro mesh. Then the amplitude dial: ×1, ×4 and ×8 —
the last of them **23.6 m of wave height** — all photographed as a flat
plate. The same ×8 with the wavelength quartered visibly heaves. So the
displacement works, height was never the lever, and "make it bigger" would
have gone on failing at any size.

**WHAT THE EYE READS IS H/L.** At the 240 m dominant this sea stood at
**0.012** — a gradient of one in eighty, which is a level floor with a slow
tilt in it and no face anywhere for a low sun to catch.

**AND THE HONEST WAVE FOR THIS WIND IS SHORTER THAN THE MESH.** Fetch-
limited at the 12.6 m/s and 50 km the sea state stands for: Hs **1.44 m**,
Tp 5.35 s, wavelength **44.7 m**, slope **0.032**. Production's coastal
lattice is 21.1 m between vertices, so Nyquist is 42 m: the wavelength this
wind actually makes is precisely the one the mesh cannot carry, and no
tuning reaches it. Going shorter without a denser mesh buys a crest that
pulses as it travels through the sample points, which reads worse than the
plate did.

**So the wave is drawn long and the SLOPE is kept.** Dominant 240 → **140 m**
(6.6 samples a wave, a crest drawn at 89% of its height wherever the phase
falls); the amplitude ceiling 1.05 → **1.45 m** of peak rise, which is not
chosen but SOLVED — at a full sea state the vertical envelope is
1 + windWaveWeight = 1.54, so 1.45 reads as 4.46 m of wave on 140 m, H/L
**0.0319** against the real sea's 0.0322. The wind-wave layer, the only one
between the dominant and the fragment skin that carries real faces, is
leant on harder (0.20 + windSea·0.22 → **0.26 + windSea·0.30**) and its
length floor goes 64 → **72 m**, which is 3.4 samples and the same floor the
shore wave already sits on. **The stated cost is that the sea is about three
times too TALL for its wind** — a right slope on a wrong length has to be —
and that trade is the whole change.

**AND THE COAST FIELD'S SWELL MOVED WITH IT.** `swellWavelengthM` in
`coast-field.ts` is a second copy of the shader's ramp, and it has to be:
the field is the travel time of the wave the vertex draws, so solved for a
longer swell than the one being phased on it the refraction bends the wrong
crests and the shoaling starts in water that swell would not yet feel. A
shorter swell feels the bottom later, so the crawl now begins closer in.

**Measured**, Kommetjie, one sky (`wx=clear`), one sun (14°), the same three
stations, the build the only difference:

| station | control L / H | control H/L | fix L / H | fix H/L |
|---|---|---|---|---|
| beach | 184 m / 2.70 m | 0.0147 | 113 m / 3.85 m | **0.0341** |
| shallows | 217 m / 2.65 m | 0.0122 | 129 m / 3.82 m | **0.0297** |
| surf | 236 m / 2.56 m | 0.0109 | 138 m / 3.72 m | **0.0270** |

…and in the frame itself, over the sea band of the beach station's own
photograph: luma spread **17.2 → 20.3**, vertical gradient 4.16 → 4.38,
tones 40 → 41. **A real change and a modest one** — the numbers are the
stronger evidence, and the seat's report against the deploy is the rest.

**THREE TRAPS, ALL THREE PAID FOR IN RUNS:**

- **A/B THE WEATHER OR YOU ARE COMPARING TWO SKIES.** Weather is rolled per
  boot. The first photographic comparison came back with the control under
  crisp cloud and the fix under an overcast — two sea colours, two suns, two
  haze depths — and was offered as a comparison of a wave constant. `wx=` is
  the pin, and `wave-shots.mjs` now passes `WX` (default `clear`) always.
  The same run's `windMps` moves with it, so the absolute peaks in the table
  above are lower than the live-weather run's and only the PAIR means
  anything.
- **`__place` SETS A POSITION; THE RIG HAS TO LAND.** The tool shot 2.6 s
  after placing, which at the harness's two to four frames a second is a
  handful of frames — so one run photographed a truck still falling from a
  camera still flying, and the next the same station settled. Six seconds,
  and the body's height is printed beside the wave's numbers.
- **A FRAME IS EVIDENCE OF WHAT IS IN IT, NOT OF WHY.** The surf station's
  photographs come back from inside the water column, and that read as a
  crest tall enough to swallow the camera — an argument that nearly set the
  amplitude by it. It is not: the rig stands on a seabed **5.8 m** below the
  resting surface at that station, and the control's camera is under water
  there too. `body -7.41 over sea -1.60` in the tool's own line is what said
  so.

**WHAT THIS DOES NOT FIX.** The honest wave is still three times shorter
than the lattice can draw, so the only real cure is a denser coastal tier —
at 10 m between vertices a 45 m wave is 4.5 samples and the height could
come back down to its true 1.4 m. That is a mesh change with a cost, and it
is the next thing to measure if the sea still reads wrong from the seat.

## The sea had no soundings, so the waves had no height

From the seat: "did we lose vertical height/volume on ocean waves at some
point?" Yes, twice, and neither was a change to the amplitude constants —
those have not moved since the original hydro shading commits. What changed
is what multiplies them. `__wave(x, z)` is the instrument the question
needed: the vertex's displacement chain cannot be read back off the GPU, so
it replays the chain on the CPU from the same field — sea state, depth,
shoal, the post-break collapse, the shelter — and reports the peak rise in
metres. Peak rise is half the wave's height.

**The big one, and it was old. Terrarium encodes open water as ZERO, not as
bathymetry.** A sea texel's depth is therefore the resting datum minus that
zero: 0.40 m at Camps Bay, at every sample out to a kilometre and a half.
Every gate in the wave's chain reads metres, so the whole Atlantic sat
permanently in the post-break collapse — `postBreak` 0.32, `vShoal` pinned
at 1, `vBreaker` 0.045 so no breaker could ever form, anywhere, at any
distance. The sea was a flat 0.3 m sheet from the waterline to the horizon.
The gates are right; the number they were reading was fill.

So the wave terms read an ordinary beach profile instead: zero at the
waterline, **one in seventeen** seaward, the deeper of profile and datum
always winning so a tile that does carry soundings keeps them. The slope is
a rendering proxy chosen so the whole profile fits inside the 180 m the
shore-distance field can actually measure (it clamps there). The coast
field's solver reads the same shelf — fed the fill it had no depth gradient
at all, so its dispersion was uniformly at the 3× cap and there was **no
refraction**, only a threefold phase stretch; the test now holds it to a
gradient (112.5 → 90.6 m of travel per two texels on a fill-flat sea).

Measured on the live Camps Bay beach, the same spot before and after:

| offshore | peak rise before | after | breaker after |
|---|---|---|---|
| 0 m (the wash) | 0.20 m | 0.30 m | 0.10 |
| 25 m | 0.30 m | **1.11 m** | **0.75** |
| 50 m | 0.30 m | 1.08 m | 0.31 |
| 100 m | 0.32 m | 0.90 m | 0 |
| 200 m and out | 0.29–0.35 m | 0.68 m | 0 |

A profile where there was a sheet: deep-water swell at 0.68, rising through
the shoaling band, breaking at twenty-five to fifty metres, collapsing into
the wash. Mean over seventeen sea samples, 0.322 → 0.947 m.

**The small one was a day old and mine.** The coast field's exposure
multiplied the wave ENVELOPE — the swell by mix(0.35, 1, exposure), the
shore wave by mix(0.45, 1, exposure) — which took a third of the height
where the fan read sheltered and, because crest whitening is a steep
smoothstep on that same envelope, took the whitecaps almost entirely
(crest 1.00 → 0.31 on the at-simonstown fixture). Shelter now damps only
what shelter stops: the breakers, their foam and the spill. **A quiet
harbour is quiet because nothing breaks in it, not because its swell is
shorter.**

And the fan itself was wrong twice over, both from the demo's assumptions
about an authored seabed. It walled off water of another KIND, so the
land-cover polygon lying over False Bay — 62,578 pixels — killed five of
seven rays on open water; and it attenuated 0.87 a step over anything under
two metres, which on fill-flat depth fired on every step of every ray
(0.9^28 = 0.05) and drove whole coastlines to the floor. Only LAND stops a
swell now. The solve's medium is any STANDING water, whatever body owns it:
foreign water was also outside the medium, which made it a SOURCE at travel
zero — a false waterline emitting crests from its own rim, the very defect
the travel field exists to remove.

## A coastal spawn set the sea ten metres up, and the ocean stopped existing

The live coast at Simon's Town had no ocean AT ALL: `__hydrotile` showed
two `lake` bodies and the mask refusing all 62,578 pixels of the False Bay
tile with a datum of 10.4 m. The sea was drawn as the land-cover polygons
over it — sea state 0.34 instead of 0.72, short fetch, and because lake is
not a coastal kind, no surf strip, no run-up, no breakers and no coast
field. Camps Bay, ten kilometres away, was healthy at 85–100% ocean.

The cause is one line in `measureSeaDatum`, and the mask had already
learned the same lesson for its own pixels. The radial scan pushes
`sampleHeight(x, z) + baseElev` for every cover-water sample, and
`sampleHeight` answers 0 — the spawn's own level — anywhere it has no tile.
Cover arrives well ahead of terrain, so the first scan of a coastal session
is mostly such samples and the datum it sets is the SPAWN ELEVATION: ten
metres at Simon's Town, which is where the town sits. Everything downstream
then failed honestly against a false number. A sample with no terrain does
not vote now, and `__sea().scan` reports what the last accepted scan
actually saw (wet and dry counts, the water median, the dry twentieth
percentile it had to stay under) so the next occurrence is one call to
diagnose.

Measured live at Simon's Town, before and after: datum **10.4 → 0.4 m**;
the False Bay tile's mask **0% ocean and 62,578 refused → 95.5% and 6**;
the tile's bodies **lake, lake → ocean**; ocean texels in a three-kilometre
scan **0 → 1,365**. The bay is sea again, with everything that follows from
being sea.

**What to take from both:** a fill value is not a measurement, and the
difference is invisible at the call site. `sampleHeight` returning 0 and
terrarium's ocean returning 0 are the same trap at two scales — one flattened
every wave in the world, the other deleted an ocean — and in both cases the
code downstream was correct and reading a number that meant "I do not know".

## The coast field: the sea's crests ride travel time, and a harbour is quiet

Gleaned from the ocean demo the seat was shown (its eikonal coast was the
one piece worth taking — see the comparison in the session). The nearshore
wave phased on the signed shore distance because a distance is continuous
and its isolines are crest lines "to a first approximation" (the sea
shader's own words). The approximation drew a crest the same sixty metres
off a steep rock shore and off a shelving beach and wrapped a headland in
contour lines. A real crest slows where the water shallows.

**What was built** (`hydro/coast-field.ts`, wired in `build-tile`): per
tile with sea or lagoon in it, the TRAVEL TIME from the waterline over the
bathymetry — the eikonal |∇T| = 1/c(h) by monotone Godunov sweeps, c from
the finite-depth dispersion for the shader's own swell wavelength (300 m on
the open sea) — stored as T·c₀ in deep-water metres, so it IS the shore
distance where the water is deep and grows faster over a shoal. The shader
phases the nearshore crests on it in place of the distance; the dry side
keeps signed shore distance, and the two meet at zero on the waterline, so
the phase stays continuous and direction is still never inside it. The
fourth channel is EXPOSURE: seven rays over ±72° about the open-sea
direction, marched about a kilometre over the wet mask; land ends a ray,
a shallow thins it, leaving the grid counts as open. It damps the shore
wave, the offshore swell, the breakers, the spill and the standing-water
chop. `?coast=0` builds none; `__hydroview('coast')` paints exposure red to
green with a travel isoline every 30 m; `__coast(x, z)` reads a texel; the
dump's hydro `buildProf.coast` carries the cost.

**Four things the first cut got wrong, each caught by a number:**

- **The crawl is capped at three times deep.** Half a metre of water
  carries a 300 m swell at two metres a second against twenty-two, so the
  last wet texel was worth ten texels of deep-water metres — a wavelength
  and a half of phase inside the 18.75 m the field can resolve. Aliasing,
  not shoaling. At three times the crests bunch to a third of their
  offshore spacing, two texels apart at the tightest; the refraction needs
  only the relative speeds across a section and keeps its shape.
- **The sweep is a band; the far field is grown from it.** The whole grid
  swept was 7 ms a tile warm at 140²; the shader phases on the travel only
  inside its 120 m crossfade. Sixteen texels are swept and the sea beyond
  is filled by a two-pass chamfer seeded with the band's values at the
  deep step (the eikonal at constant speed, to the chamfer's four per
  cent) — and the band texels are its seeds, never lowered by it, or a
  deep step through a band texel erases the slowing the sweep put there
  (the test caught that: "travel outruns distance, 131 vs 131"). Warm:
  about 6 ms a mostly-sea tile on the desktop; the Cape fixtures' builds
  read `coast` 2–4 ms a build averaged over every tile.
- **A sea texel no shore reaches carries the plain distance.** A tile
  wholly at sea has no source, and a zero there reads as the waterline —
  a full, phase-flat shore wave over the whole open tile. It carries the
  distance transform's own clamp instead, well past the crossfade, which
  is what the phase read before.
- **The exposure fan faces the open sea, not the travel's gradient.** From
  between a beach and a rock the gradient points at the beach, and Camps
  Bay's surf zone read a fifth as exposed as the water beyond it. The fan
  now faces down the distance to the mask's interior.

**And one thing the field found about the data.** Camps Bay's beach carries
an OSM `natural=water` polygon three texels wide between the sand and the
sea, and Simon's Town's harbour is one. Painted as LAKE (their tag) they
kept the surf strip and the run-up off that shore — those compile for
coastal kinds only — and gave the coast field a band with no sea in it:
travel started 60 m out and measured from the polygon's rim. A standing-
water area whose interior samples mostly read confirmed ocean is observed
as a **lagoon** now (`seaTouching`, sampled the way `areaEvidence` samples a
level); a lake behind a beach has no sample under the mask. And the
registry took a body's kind from its FIRST observation across tiles, so the
bay polygon stayed a lake because one tile — analysed before its coverage
arrived, or holding only the polygon's landward clip — said so first; the
top-down field frame over the harbour showed the basin's own texels
solved and the open bay beside them green and empty. A polygon any tile
has seen under the mask is coastal everywhere: the sea-touching kind wins
the merge. What stays a lake on the at-simonstown FIXTURE is the WorldCover
water polygon over False Bay itself (4,382 pixels): `__hydrotile` shows the
mask answering confirmed DRY at every one of its 110 samples, because the
fixture carries no OSM coastline for the bay and the terrain under it reads
at the datum — a fixture limit, not the rule's. The mask's unknowns do not
vote, so a polygon the mask has only partly judged is decided by the part
it has. `__hydrotile(x, z)` is the instrument: the tile's features, each
one's sea-touching arithmetic, the coverage state and the bodies' settled
kinds, in one call.

**Measured at Simon's Town** (`scratchpad/coast-shots2.mjs`: the rig placed
on the shore the field itself found): the harbour shore reads exposure
**0.12**, the beach by the town **0.67**, the open False Bay shore
**0.85**; with `coast=0` every wet texel reads 1. Travel at the harbour's
waterline runs 47 → 62 → 88 m over the first 40 m of shore distance (the
shelf's crawl), 33 → 46 at the town beach. Camps Bay's beach is not a
visual case: the fixture's DEM there stands above the water, so the sea is
under the sand until well offshore, and a shore frame shows grass. What
this does NOT do: a directional swell (the wind turns the offshore swell;
the coast field's refraction is from the shore outward), and shadowing of
one bay by a headland in the next tile — each tile's field ends at its
gutter. The demo's swash history, Jacobian whitecaps and footprint
roughness are still to glean.

## The layer ladder, and the key that names it

The first key sat on the scale bar's label — exactly the rows it was meant
to read beside — and named the MARKS, when what was asked for was a legend
for the BOXES: which dashed square is which layer, at what zoom, how wide.
So the ladder, in the words the code and this file already use, from the
truck outward:

| name | zoom | one tile here | what it is | drawn as |
|---|---|---|---|---|
| FINE · vectors | z16 | ~600 m (× cos lat) | the OSM ring: roads, water, buildings streamed round the truck | the grid of small cells, a pip per cell |
| FINE · terrain | z14 | ~2.4 km | the height tiles the world is built on, `terrainMeshes` | the medium dashed boxes |
| SHELL | z11 (the level moves with the zoom) | ~19 km | the far ground on the sphere, baked from the coarse DEM and painted by COVER | the large boxes, only past the fold |
| COVER | z10 / z12 | ~40 km / ~10 km | the WorldCover raster that tints the shell and the fine tiles; no boxes | the header's `COV` count |
| OVERVIEW | z13 down to z5 with the zoom | ~5 km to ~1,200 km | the chart's coarse road and place vectors; no boxes | the dump's `ov` figures |
| GLOBE | — | — | the planet under everything | the sphere |

"FINE" is the streamed world you can drive on; "SHELL" is what fills the
horizon and the wide chart; "beyond" is the globe. A ring FOLDS when its
cells fall under eight HUD pixels: it is then drawn as one box round the
whole ring, and the key says so.

The key itself sits UNDER the scale bar (its label is at `pad + 56` with
tile debug on; the key starts twenty below), one row per layer that draws
boxes: `Z16 526M VECTORS` then the pip vocabulary in its inks — WIRE
(pulsing gold, on the wire), QUEUE (soft pip and its serving rank), FAIL
(red X in its 30 s backoff), DONE (green), ASKED (dim dot, requested and
unsettled); `Z14 2.1KM TERRAIN` then MESH (teal box), WAIT (gold, DEM
asked), REBUILD (orange, dirty); `Z11 19KM SHELL` then MESH and ASKED while
the shell boxes draw; and `ONE BOX: THE WHOLE RING, FOLDED` while a ring is
folded. The metres are computed from the latitude, not quoted. A row wraps
under its name on a narrow HUD. The header's words are the key's words.

**Every marker answers a tap the same way now.** `poiUnder` searched only
the pins, so a finger on a summit's triangle dropped a fresh fix beside it
and opened THAT — a mark on nothing, next to the thing reached for. It
searches the summits and the wide chart's places too: the same site card
opens, its record reads the ground there, GOAL points the truck at it, and
GO stays withheld as it is for any pin that is not a survey mark.
`__poimarks()` lists what is on the glass and everything tappable in world
coordinates; `__tapat(x, z)` makes the chart's choice without the pointer,
which is how the harness proves a summit opens its own card.

### The chart's pale outer ground is the SHELL, and the clip had left it a ring to paint

Two questions from the seat, over Zagor Town in Xizang
(`?lat=28.5108&lon=87.0714&cam=top`, the chart at `2 KM · 1:53K · z13.3`, tile
debug on): why is the outer chart far lighter and flatter than the middle, and
what is the outer strip that looks as though it only PARTLY paints, letting the
lighter layer through? Both were read as the globe showing through. Neither is
the globe — it is a near-black graticule and at that zoom the streamed world
covers it completely — and the two are one mechanism seen twice.

**THE INSTRUMENT IS A HIDE-DIFF WITH ITS OWN FLOOR** (`devtools/chart-bands.mjs`).
Three layers can be under any pixel out there and from a still frame they are a
matter of opinion about a grey shape, so: one settled world, the same frame
photographed with everything, with `__hide('far')` and with `__hide('terrain')`
— the pixels that CHANGE when a layer goes are that layer's — and, first of
all, **the same frame twice with nothing changed**, which is the only thing
that makes the rest readable. Measured floor: **0.0% over the top two thirds of
the frame and 9.7% in one band around the truck**, which is the dither
re-weaving over the sward. That band was 9.7% "shell" in the attribution too,
and is therefore not shell at all; the first reading of this frame counted it
as one.

**WHAT THE OUTER GROUND IS.** The coarse shell — z11, 19 km tiles at ~150 m a
vertex — drawn where the fine world is not protected by the clip. Hiding the
far group turns those pixels back into the fine world's own darker relief;
hiding the fine terrain leaves a flat blue-grey where the clip's hole is (the
sky, at luma 133 ± 7 with no structure in it), not a planet.

**WHY IT IS LIGHTER, AND TWO THIRDS OF IT IS ONE UNIFORM.** Over the 1,792 art
pixels the shell actually painted, at 36 m an art pixel:

| | luma |
|---|---|
| the shell, as drawn | **160.0** |
| the fine world underneath it | **133.7** |
| the shell with `__planetmix(0)` — the scene's sun, as the fine world has it | **142.4** |

A **26-luma seam, a palette step and a half**, of which **17.6 is the planet's
own sun** (`uPlanetMix`, 0.45 at that zoom). At full strength that term
REPLACES the shell's Lambert shading — of the tile's own DEM normal map — with
`planetSun(albedo, radial·sun)`, which has no slope in it at all: flat albedo
under a sphere's cosine. That is why the outer ground reads not merely brighter
but FLATTER, and it is the fault the section above it ("THE FAR/FINE DIFFERENCE
SHOULD BE MESH DETAIL AND NOTHING ELSE") was written to end, reintroduced at
chart zooms by a ramp. The remaining 8.7 luma is the honest difference: a
150 m lattice, the coarse cover, no substrate.

**THE RAMP WAS THE CLOUD SHADOWS', AND THOSE TWO ANSWER DIFFERENT QUESTIONS.**
`uPlanetMix` faded in over `uMpp` 15→60 to match the cloud fade and the mottle,
"so the chart changes its rules in one place" — but 15 m an art pixel is a
2.2 km frame and 60 is a 9 km one. A noise field going sub-pixel is a question
about RESOLUTION; whether the shell is a planet or the horizon of a tangent
world is a question about REACH. It is 400→2,000 m an art pixel now — a 60 km
frame to a 300 km one — and every wide-chart number in this file was taken at
6,000 m an art pixel or more, where the mix is 1 either way.

**AND THE "PARTLY PAINTED" STRIP IS TWO LAYERS FIGHTING OVER ONE BAND.** Where
the shell is not clipped away it does not replace the fine world, it competes
with it: both are drawn, and the shell wins only where its 150 m chords stand
above the fine surface. `__far().seam` reads **−61.1 to +11.7 m** here against a
`FAR_DROP` of 12 — so across a Himalayan valley the coarse triangle is within a
whisker of the drop everywhere and over it in patches. That interleaving IS the
partial paint, and it is why the band reads as a wash with the ground showing
through rather than as a clean edge.

**THE CLIP HAD LEFT IT A WHOLE RING, BY ARITHMETIC.** `stepFineRing` walked
complete rings to `TERRAIN_RING` (2) while the streamer asks `tRing` — up to
`TERRAIN_RING_MAX` (3) — whenever the view is wide, which on the chart it
always is. Measured at Zagor Town: **49 height tiles loaded (7×7, 15.0 km)
against a clip box of 10.7 km**. One full ring of fine ground, built and drawn,
outside the rectangle the shell is discarded inside, at every chart zoom there
has ever been.

**AND ONE LATE TILE COLLAPSED THE WHOLE BLOCK.** The box was the complete
RINGS, which is all-or-nothing: a single tile of ring 1 still on the wire — or
one the DEM refused, which never arrives — took a 7×7 block down to the truck's
own tile and handed the shell everything else. The seat's own frame is what
that looks like, and the screenshot can be measured: its scale bar is 369 px
for 2 km, its two strongest grid lines stand 396 px apart — 2.15 km, the z14
tile at that latitude — and **the frame's luminance steps sit on them**, at
x 360 and x 756 with the truck at 603. The pale ground begins at the edges of
the truck's OWN tile, which is a `CLIP 1x1`. That is a reading of a photograph
rather than a probe, so it is offered as consistent-with rather than proven;
the header above now answers it outright. It is the largest RECTANGLE of loaded
tiles around the truck's own now, grown a whole row or column at a time, so it
still cannot contain a tile the fine world has not built and a missing corner
costs one row rather than everything.

**Measured**, same spot, same zoom, same settled world, the two changes the
only difference (`devtools/chart-bands.mjs`; the rows are art rows of a 320-row
frame, the floor is the same-frame-twice control):

| | before | after | floor |
|---|---|---|---|
| clip block | 5×5 tiles · 10.7 km | **7×7 · 15.0 km** | — |
| planet-sun mix at this zoom | 0.45 | **0.00** | — |
| rows 0–19, the horizon past the loaded world | 80.0% shell · seam **+26.3 luma** | 49.2% · **+10.9** | 0.0% |
| rows 20–59, the partly-painted band | **19.6% shell** · +32.7 | **3.5%** · +17.0 | 0.0% |
| rows 62–139 | 0.0% | 0.1% | 0.1% |
| rows 140–199 | 9.7% | 9.7% | **9.7% — all of it the floor** |

The horizon is still the shell's and must be — that is what the layer is for.
What changed is that it is no longer a palette step and a half brighter than the
ground it continues, and that it stops at the edge of the world the fine
terrain has actually built rather than a ring inside it. The ramp, checked at
six zooms on the build that ships it: **0.000 at 36, 113 and 396 m an art pixel
· 0.443 at 1,139 · 1.000 at 3,416 and 11,197** — the wide chart's terminator
measurements were all taken at 6,263 m an art pixel and up.

**AND THE FRAME SAYS IT NOW.** The tile-debug header carries `CLIP w×h`, the
block in tiles, beside MESH and REBUILD; `__far().fineBlock` is the same number.
A chart whose outer ground looks pale and flat with `CLIP 1x1` on the line is
this, and needs no investigation at all — which is the whole reason the number
is on the glass rather than in a probe.

**`__planetmix(v)` is the override the measurement needed**, and it is there for
the reason this file has recorded twice: the term is written every frame from
`uMpp`, so a console write survives until the next animation frame and no
longer. `__farclip(true)` lifts the clip; `__faralign`, which a comment beside
it has pointed at for months, **does not exist** — the same class of fault as
the hydro bench this file once named.

## The Senqu river stands on the hillside: its line runs 30–60 m off the DEM's floor

Reported from the cab at `lat=-30.94647&lon=27.46395&h=153&cam=chase`
(`substrate=render`, but the field is the same in every mode — the default
run gives the same numbers): "the river seems raised from the terrain".
Measured with `__ground` (DEM, drawn mesh and standing ground at a point,
with the water's resting level beside them — `scratchpad/river3.mjs`,
`river4.mjs`), west–east sections through the river at the rig's row and
100 m either side, every 5 m:

| section | DEM floor | drawn river (east of rig) | DEM under it | resting level | river above the floor | west edge above its ground |
|---|---|---|---|---|---|---|
| at the rig | 1530.1 m at +5 m | 35–45 m | 1532.9–1534.7 | 1534.3 | **2.6–4.2 m**, 35 m west | +1.4 m |
| 100 m south | 1529.5 m at +35 m | 80–95 m | 1535.5–1541.4 | 1538.1–1539.3 | **8.6–9.8 m**, 50 m west | +2.5 m |
| 100 m north | 1530.0 m at −30 m | −5…+5 m | 1532.6–1534.5 | 1534.0 | **4.0 m**, 30 m west | +1.4 m |

The ground rises east at 18–25 m per 100 m; the valley floor the DEM has
runs 30–60 m WEST of where the OSM waterway line runs, up the eastern slope.
The profile's station level is the DEM sampled ON the line (`buildProfile`:
carved invert + nominal depth where there is a carve, else
`sampleElevation` at the station, smoothed, then the monotone descending
fit), and the per-texel ceiling is that same foot plus 0.6 m — so the water
is exactly right for the ground under the line and 3–10 m above the valley
floor next to it. The sheet is flat across its drawn width, so its western
edge floats 1.4–2.5 m over the ground (the wet overlay's `E`/`W` there) and
its eastern edge is buried in the rising bank (`U`). From the floor, where
the truck sits, that is a river standing on the hillside 40 m away; 70 m
south-east, inside the drawn width, the truck is under 2.5 m of water and
the HUD says WATER. Nothing in render mode or the substrate caused it — the
same field draws in `legacy` — and the mesh follows the DEM to 0.2 m at the
rig, so "which terrain" is answered: the DEM's, and the DEM's floor is not
under the line. Which of the two is wrong on the ground is not decidable
here (OSM traces the river from imagery to ~5–10 m; the terrarium z14 pixel
is 9.5 m but its source in Lesotho is a 30 m product, which does not resolve
a channel in a gorge and smears the floor sideways) — but the mesh IS the
DEM, so the river has to sit in the valley the mesh has.

**Not fixed; the shape of the fix:** seat each station on the DEM's floor —
at profile build, scan the DEM across ±60–80 m perpendicular to the line
(the DEM's own spacing, a dozen samples a station, cheap against the
raster loop) and move the station onto the lowest point, with continuity
along the line so a meander does not hop valleys; then the level, the
carve and the drawn ribbon all follow the terrain's valley. Lowering the
level alone would sink the river under the hillside where it is drawn.
The carve (`channelsNear` in the kernel) and the field must move together
or the carve cuts a trench up the slope and the water sits in the floor
beside it.

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
- **TWENTY ARE MARKED `legacy`** — the non-default value keeps a superseded
  implementation alive, so each one is a retirement candidate and the question
  "what can we retire" is a filter rather than an archaeology expedition:
  `ez ezstand guild refine tworker sward lumasync hydroskip vegseed relief
  shfade shsnap shrub treewind ezbark ezedge imu substrate wetdebug shore`.
  **Not all of them are retirable, and the mark does not claim they are.**
  `refine=0` and `guild=0` both restore paths that are still LIVE for another
  reason — the plain lattice is what builds past `REFINE_R`, and the climate
  path is what runs wherever `guildAt` returns null (the sea, a fixture, a tile
  in flight). Retiring one of these means proving the other branch is
  unreachable, not just unfashionable. **Do not quote a count from this file:**
  it was seventeen here and twenty in the table for as long as it took to read
  one and not the other. `switches.test.mjs` prints both numbers on every run
  and that is the copy to trust.

### …AND SEVEN MORE WERE READ BY REGEX, WHICH THE TEST COULD NOT SEE

The lesson above — a switch read round `qs` is declared nowhere, listed nowhere
in SETTINGS and invisible to `switches.test` — was written into `main.ts` when
`?substrate=` was caught. Nineteen lines ABOVE that comment, `HYDRO_ON` was
reading `/[?&]hydro=([01])/.exec(location.search)`. Six others were doing the
same: `dem`, `cprobe`, `nodraw`, `noweld`, `nopins`, `nofill` — among them the
flag the harness itself depends on to measure without drawing.

**The test's guard matched one spelling.** It counted
`new URLSearchParams(location.search)` and required no more than two; a regex
against `location.search` is not that string, so it cost nothing to add and the
table never saw it. `?substrate=` was fixed one switch at a time and seven of
the same kind stayed live.

All seven are declared now and read through `qs`, and the assertion is on the
SHAPE rather than on a count: **no client module may match the query string with
a regex**, over the whole directory, because the next one will not be in
main.ts. The guard was checked by putting the old form back — it fails, which is
the only thing that makes a regression test worth having. Two readers widened
slightly in the conversion: `?cprobe=2` and `?hydro=anything` now read as on,
where the regexes demanded `=1` exactly. That is `qsOn`'s rule for every other
toggle in the table, which is the point of the table.

### AND SETTINGS CAN SET THEM

The panel rendered all sixty-seven rows through `kvTable`, which has no click
handler — so the one thing SETTINGS could not do was set a setting, and the
documented way to change a switch was to edit the query string by hand, which a
phone cannot do at all. Three changes, and the third is what makes the other two
honest:

- **Filter by mark.** Sixty-seven rows in one scroll is a list nobody reads. The
  marks were carried on every row and rendered on none but `legacy`, so a bench
  probe and the spawn latitude looked alike. They are chips with counts now
  (`ALL 67 · SET 6 · WORLD 13 · LOOK 17 · BENCH 28 · LEGACY 20`), and the
  LEGACY chip is the retirement list as a filter, which is what the mark was
  for.
- **A tap STAGES; it does not apply.** Every switch is read once into a `const`
  while the module initialises — that is not a defect to fix, it is what makes
  the world buildable before there is a frame — so a control that flipped one
  live would lie about when it takes effect. A toggle cycles the three states
  the reader actually distinguishes (on, off, absent — "unset" is not "set to
  the default"); anything with a value is typed. The foot shows the diff and
  one RELOAD spends the lot, which is also what an A/B usually wants.
- **`urlWithSwitches` preserves every key it is not changing**, the same rule
  and the same reason as `URL_OWNED`'s: the art-direction and instrumentation
  flags are not ours to drop. Asserted in `switches.test.mjs`, without a
  browser.

**`RELOAD · n STAGED`, not `RELOAD WITH n`** — STORAGE offers RELOAD WITH
CONSOLE one section further down, and two buttons on one page opening with the
same two words is a misread waiting to happen. Found by a test that matched the
wrong one.

**AND THE TAP TARGETS.** The panel sizes its back, close, carousel and chip
controls to 44px and then laid out the bulk of its own surface — every dial row,
every list row — at 3px of padding. `.m-row.hit` and `.m-dial` are 44 now;
`.m-row` flat is NOT, because a credit, a spec line and a dimensions row are not
tappable and giving them a thumb's height adds a screen of scrolling to pages
nobody taps.

### AND IT COST THE PAGE ITS LENGTH, WHICH NOTHING WAS MEASURING

`devtools/menu-survey.mjs` scrolls SETTINGS a screenful at a time and
photographs each, because one screenshot of a scroll region is the first
screenful and an assumption about the rest. Measured on the same spot and
window, the change above against its parent:

| | before | after |
|---|---|---|
| SETTINGS scroll height | 3,238 px | **6,139 px** |
| screenfuls of a 678 px window | 4.8 | **9.1** |
| switch rows | 60, as kv text | 67, tappable, with notes |
| dial row height | 24 px | 44 px |

Two thirds of the growth is the switch list and one third the dial tap
targets, and the list sits FIRST — so sign-in, RESET THE LINE, STORAGE, the
dev console, the tape recorder and all forty-six dials are now behind five
screenfuls of reference material. The filter chips only half answer it,
because the default is ALL 67 and the panel's own doctrine is that the list
renders whole ("a list that hides the ones nobody set hides exactly the ones
nobody remembers"). **Reference before action is the fault**; the ordering, or
a screen of its own for the switches, is the fix, and neither is made here.

### TWO SCREENS, SPLIT BY WHO THE ROW IS FOR

The owner's call, and it is the fix for the length above rather than a
reordering: **SETTINGS keeps what a player tunes; ADVANCED takes the developer
levers and the buttons that delete.** Splash treatment, sign-in and the
RENDER/WORLD/TREES rack stay; the switch table, the tape recorder, the eruda
console, RESET THE LINE and STORAGE go one deliberate tap deeper, ordered from
harmless to final so the last thing on the page is the one that hands the
device back. Measured, same spot, same window:

| | before | after |
|---|---|---|
| SETTINGS | 6,139 px · 9.1 screens | **2,299 px · 3.1 screens** |
| ADVANCED | — | 3,816 px |

The content did not shrink; it stopped being one scroll. `T_ADVANCED = 8` is
the probe index, and three suites that drove SETTINGS by number were moved with
it — `storage-reset`, `line-boot` and `settings-switches`, which now also
asserts the switch table renders on ADVANCED and **not** on SETTINGS, because a
table on both pages is the old scroll with a second door.

**AND CAMERA WENT TO THE RIG.** `dialGroups` split the rack by excluding
VEHICLE and SETUP, which put CHASE HEIGHT, CAB FOV and the splash orbit at the
bottom of the longest scroll in the menu — on the page whose siblings are
RENDER and TREES, not on the page whose subtitle is TUNE AND DRESS THE TRUCK.
The rig set is named rather than derived by exclusion now, so a group added
later lands in SETTINGS by default: an unclassified dial shows in the wrong
place rather than in neither.

### THE FOOT IS A PER-SCREEN ACTION BAR, AND SOUND WAS NEVER AN ACTION

`menu-survey.mjs` printed the foot per tab and settled what it is: DRIVES
stacks four page actions in it, THE LINE puts one full-width CTA there, the hub
and rig-live hide it in CSS, and SURVEYS, ABOUT and PROGRESS leave it empty —
so it is a per-screen slot, not a persistent bar, and the two global toggles
sitting in SETTINGS' foot were teaching the wrong thing about the slot.

SOUND and HIDE HUD now bracket the splash's utilities strip — `SOUND · SETTINGS
· ABOUT · [SIGN IN|PROGRESS] · HIDE HUD` — on the screen every BACK returns to.
Left and right rather than inline, because a toggle is not a destination.
**HIDE HUD was deliberately NOT put in the header beside the X**: it is an exit
as much as a toggle, and two exits a thumb's width apart with different side
effects is worse than the scroll it replaced.

**SIGN IN and PROGRESS are one slot.** Both were on the splash at once — the
redundancy was visible in the first screenshot anyone took of it — and at most
one ever meant anything: signed out, PROGRESS was the only tile in the row with
no icon and no subtitle, whose whole job was to hop to a page; signed in, SIGN
IN hid itself and left that orphan behind.

**And `worldRows` and `systemRows` are gone.** The first was fully implemented,
carried real data and was called by NOTHING — the same class of fault as the
forgotten switches, one layer up. The second reported whether the sound was on,
and the control that changes it now says so itself on the splash. An empty foot
no longer spends its padding either (`.m-foot:empty`).

**AND A STAGED SET IS INVISIBLE THE MOMENT YOU LEAVE.** `swStaged` is closure
state so it survives a tab change and a close, while `RELOAD · n STAGED` is
built only inside `renderSettings`. Measured: stage one, go to RIG — nothing on
the screen says anything is pending — close the menu, reopen SETTINGS, and it
is still staged. A pending commitment nothing announces is the same shape of
fault as a switch nobody remembers. The count rides in the header now — the one
element every screen has — as a gold `⚑ n` chip that taps through to ADVANCED.

### TWO CHECKS IN line-boot AND about WERE ALREADY RED, AND ONE STILL IS

`THE LINE leads the hub stack` asserted `shown[0] === 'THE LINE'` while THE LINE
is appended to the nav LAST, and `RIG-MENU-2026-09-08.md` states the intended
order outright — "Primary navigation is Rig, Drives, Surveys, The Line". It
contradicted the shipped design rather than catching a regression in it, and
**the parent commit fails it identically**, which is how that was established
rather than assumed. Both copies now assert the whole documented order, which
is stricter than the line they replace: `[0]` could not have caught a reshuffle
of the other three.

`line-boot`'s `…and the docket is handed back` still times out, **and also fails
identically on the parent** — the wipe is polled for 20 s against a harness
whose init script re-seeds localStorage on every navigation, and the reboot then
never arrives. Not this work's, not fixed here, and recorded rather than left
for the next session to attribute.

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

## The chart's tiles: the level rule, the ladder to z0, and no empty frames

Reported from the seat: *"zooming out provides inconsistent and laggy
(sometimes empty) chart."* Three different faults share that one symptom and
nothing could tell them apart — the RULE picking a level its ring cannot
cover, the WIRE not having landed the tiles yet, and the PICTURE being thrown
away mid-gesture — so the first thing built was the instrument that separates
them. `devtools/ov-sweep.mjs` walks the ladder rung by rung (the level, the
frame's own half-diagonal in ground metres, the ground the ring reaches,
whether it covers, and how long the ring took) and then sweeps the whole zoom
range in one continuous pull-out, sampling four times a second and counting
the samples where **nothing of this layer is drawn at all**. That last number
is the seat's "sometimes empty", and it is not `have < want`: an incomplete
map is a map.

**THE COVERAGE TEST BELONGS TO THE TOOL, NOT TO THE BUILD.** The first cut
read `__ov().covers`, which is part of the change under test and does not
exist on an older revision — so the control reported the rule as failing on
every sample and said nothing. Both halves are derived in the tool now, from
numbers every build has carried since the scale bar shipped.

Four faults, and the first two are arithmetic:

- **THE LEVEL RULE ASKED FOR HALF A TILE MORE THAN THE RING REACHES.**
  `ovLevelFor` took the finest level with `radius <= tileMetres(z) * (R + 0.5)`
  where R is `OV_RING_MAX`. A ring of R tiles about the tile holding the view
  centre guarantees R tiles of reach and **no more** — the centre can sit
  anywhere inside its own tile, and in the worst case it is against the far
  edge. So at the wide end of every band the chart's own corners had no data
  and could not get any until the zoom crossed into the next band. Reach
  exactly what the ring reaches.
- **AND THE LADDER STOPPED FIVE RUNGS SHORT OF THE VIEW.** `OV_LEVELS` ended at
  z5 — about 2,000km of ring at mid latitude — while the cover ladder reaches
  z2 and the far shell z3. Measured at the Golden Gate: at zoom 30,000 the
  frame is 3,011km across and the ring reached 1,979km; at 110,000 it is
  10,970km against the same 1,979km. The vector map was the one layer that ran
  out before the view did, and most of a globe-wide chart had no roads and no
  names on it. z4 through z0 cost nothing to serve — they are arithmetic over
  the baked Natural Earth array, never an upstream — and **one z0 tile is the
  whole planet: 4,293 features, 82.8KB gzipped, 51ms through the handler (6ms
  of that is the slice).** `NE_MIN_Z` is 0, the
  rank rows run down to it, and `ovLevelFor`'s ring reaches the ceiling.
- **THE RETIRED RING WAS DROPPED BEFORE THE NEW ONE HAD ANYTHING.**
  `setOvLevel` called `dropRetiredOv()` at the top, and three build paths
  called it again whenever the queue happened to empty. A zoom-out crossing
  three bands in a second therefore threw away everything the previous swap
  had retained and was left holding only the newest band, which had nothing
  landed in it. `cullRetiredOv` already drops a mesh the moment the new level
  covers it, or after twenty seconds; all the swap needs is a CAP, so a long
  sweep cannot accumulate for ever. `OV_RETIRED_GENS` is three.
- **…AND HOLDING THREE BROKE THE ORDERING, which is `farLift`'s lesson one
  layer over.** `ovMat` has `depthTest: false`, so the depth buffer decides
  nothing and draw order is the only law; the retirement used to sink the
  outgoing ring fifteen metres, which works through the transparent sort and
  works only while exactly ONE ring is retired. Three rings at one sunk radius
  is a tie, and the winner is whichever three ordered last. The order is a
  function of the LEVEL now and of nothing else — `ovOrderFor`, finest last
  hence on top, `renderOrder` 40 upward, nothing else in the scene above 40 —
  so a retained z13 patch stays over a new z5 ring, which is the better data in
  the few kilometres it covers. The note by `farLift` says the same thing about
  the same mistake: a sink on the outgoing ring is right for a curtain and
  backwards for a pyramid.

Two smaller things went with them. The ring is asked **centre-out** and its
indices are wrapped in x and clipped in y, because at the widest rungs the ring
is wider than the grid and an index off the end is a 400 the loader would hold
against that tile for the whole retry window (`ovWant` is the deduplicated ask,
so z0 asks for one tile and z1 for four). And a tile the chart is **looking at**
is re-asked after `OV_RETRY_NEAR_MS` (6s) rather than the full 45: the long
window is right for a tile the view has left behind and is forty-five seconds
of hole in the middle of the map for one inside the current ring.

**MEASURED at the Golden Gate**, control against the working tree, same spot,
same harness, `nodraw`:

| zoom | frame | control level / reach | covers | fix level / reach | covers |
|---|---|---|---|---|---|
| 120 | 12.0 km | z12 / 15.5 km | yes | z11 / 30.9 km | yes |
| 500 | 50.2 km | z10 / 61.8 km | yes | z9 / 123.7 km | yes |
| 2,000 | 200.7 km | z8 / 247.3 km | yes | z7 / 494.6 km | yes |
| 8,000 | 802.8 km | z6 / 989.3 km | yes | z5 / 1,978.6 km | yes |
| **30,000** | **3,010.6 km** | **z5 / 1,978.6 km** | **NO** | **z4 / 3,957.1 km** | yes |
| **110,000** | **10,970 km** | **z5 / 1,978.6 km** | **NO** | **z2 / 15,828.5 km** | yes |

and the gesture itself — one continuous pull-out from zoom 4 to 110,000 over
90 seconds, sampled every 250ms:

| | control | fix |
|---|---|---|
| samples with NOTHING drawn | **22 of 328 (7%)** | **0 of 325** |
| longest blank run | **5.5 s** | **0** |
| rungs that land | 25/25 to z5, then nothing wider exists | 25/25 at every rung, 16/16 at z0–z2 |
| ring home, z2,000 / z8,000 / z30,000 | 8 s / 6 s / 3 s | 3 s / 3 s / 2 s |

The level rule picking one rung COARSER at the same zoom is not a loss of
detail, it is the ring finally covering the frame — and at the wide end it
lands the chart on the bake sooner, which is why the rings come home faster.
What the pair cannot separate is how much of the blank-frame fix is the
retirement and how much is the ladder; the retirement is the only mechanism
that can blank a frame the control could otherwise draw, and the ladder only
adds rungs past where the control had z5 permanently drawn, but that is
reasoning and not a measurement.

### …and the harness had never served the baked routes at all

Found while making the wide rungs measurable, and it invalidates more than this
change. The harness runs `~/dem/v1/`, `~/cover/v1/` and `~/cover/w1/` through
the cell's own handler, bundled with esbuild as **ESM** — and **`__dirname`
does not exist in an ESM bundle**. Every route that reads a baked asset off
disk threw on its first call. Measured on the bundle the harness produces:

```
/~/cover/w1/4/8/6    503 {"error":"no coarse cover baked"}
/~/osm/ov1/7/19/48   503 … 43s … {"bakeMissing":"__dirname is not defined"}
```

The comment beside the symlink in `cellRoute` says it was added to fix the
coarse cover and could not have. **Every harness run since `cover-wide.b64`
shipped has been measuring the fallback** — the shell's wide cover has been
absent in this rig throughout, and any harness reading of `__cover().wide` from
that period is a reading of nothing. `--define:__dirname=<dir>` is the fix (and
note the quoting: through `execSync` it needs a doubled `JSON.stringify`,
because the shell eats one layer — through `execFile`'s argument array it needs
one, which is the trap `ov-wide-size.mjs` already recorded from the other side).
The handler's own error strings are what said so, which is exactly why
`serveOverview` reports `bakeMissing`.

Two more, both in the same route:

- **THE OVERVIEW IS TWO ROUTES WEARING ONE PATH.** The fine rungs (z10 and in)
  are Overpass queries and must be read from the BANK — re-earning them locally
  is minutes of a public service per run — and the wide rungs are arithmetic
  over a file in this repo. The harness splits on the zoom now: z9 and out
  through the handler, z10 and in proxied to the deploy. Without the split a
  rung ADDED to the bake is a 400 here until a deploy, which reads exactly like
  a broken client, and the ladder above could not have been measured before it
  shipped.
- **AND `cellRoute` DROPPED `content-encoding`.** `serveOverview` answers
  gzipped; `serveDem` and the cover routes do not, which is why nobody had met
  it. The harness wrote a bare `content-type`, so the page got gzip bytes and
  tried to parse them as JSON: every coarse chart tile threw, every one was
  filed in `ovFailedAt`, and the chart read `0/25 · 25 RETRY` against a route
  answering 200 in fourteen milliseconds. It is gunzipped in `cellRoute` now,
  once, so the disk cache stays plain and every consumer route is unchanged.

`__ov()` carries `sightM`, `reachM`, `covers`, `ring` and `levels` for the same
reason: the rule is arithmetic between two numbers and neither was reported, so
"the chart's corners are empty" could not be told from "the tiles have not
landed". Held by `devtools/ne-wide.test.mjs` (every rung z4 out to z0 answers, is
a skeleton rather than a wall, draws motorways only, and slices in single-digit
milliseconds; z0 names 68 capitals) and measured by `devtools/ov-sweep.mjs`.
`boot.mjs`, `switches.test.mjs` and `through-node.test.mjs` green — Camps Bay
8 / 0 / 0.19 m unchanged.

**What is NOT done here**, and is the next unit the seat asked for: the chart
is still ONE layer. Splitting it so cities draw at the wide views, roads closer
in, and cover and eco polygons can be toggled with a key and a legend is the
work this was the prerequisite for.

## The chart is several maps now, and the key is the switch

The second half of the same ask: *"I wonder if it's possible to have overview
separate into layers (not just OSM) so that I can easily toggle say cover or
eco polygons with a key/legend"*, and then — *"cities only at wide views, roads
closer in, and togglable cover/eco regions"*.

The chart had exactly ONE layer and no surface on which to say so. Its roads
and its place names arrive in the same tile and were drawn by the same pass,
gated on the same `ovGroup.visible`. The land cover existed as a raster only
the terrain painter read; the ecoregions existed as polygons only the guild
read. **Neither had ever been drawn on the map it describes**, and nothing on
the glass told a player they existed.

**`client/chart-layers.ts` is the table and the palettes, and it is pure** — no
THREE, no DOM, no world state — so `devtools/chart-layers.test.mjs` drives the
shipping functions in node in a second, and the colour in the sheet's texture
and the colour in the key's swatch are the same call. A legend whose ink is a
second copy of the layer's ink goes wrong silently; that is the whole reason
for a module rather than a record literal in main.ts.

**TWO KINDS OF LAYER, AND THEY COST NOTHING ALIKE.** A VECTOR layer (`roads`,
`places`) is already drawn and switching it is a boolean on a pass that was
running anyway. A THEMATIC layer (`cover`, `eco`) is a class per texel, sampled
per far-shell tile over that tile's own world-metre box and uploaded as a
texture the shell's own geometry wears — so it has a BAKE, and a bake is what
this file has twice measured at the top of a phone's slow frames.

- **The sheet rides the shell's geometry and builds none of its own.** One
  extra `Mesh` per far tile sharing that tile's `BufferGeometry`, positioned
  where the far mesh is, which buys the sphere placement, the RTC centre and
  the lift for nothing. `refreshTheme` reconciles against `farMeshes` once a
  stream pass: a tile that left the ring (or was PARKED, which releases its
  geometry's GPU buffers) loses its sheet in the same breath, and a tile
  without one gets a bake queued.
- **A decal, not a lift.** The sheet is coplanar with what it lies on, and a
  radial offset cannot fix that at chart distances where the depth buffer spans
  thousands of kilometres and two metres is nothing. `polygonOffset` −4/−4,
  `depthWrite: false`, `renderOrder` 35 — under the chart's ink at 40, over the
  shell. `depthTest` stays ON so the fine world still occludes it; turning it
  off would paint a class map over the streets.
- **ONE THEMATIC LAYER AT A TIME**, and not as a budget dodge: two class sheets
  over each other is neither map, and the legend — which is the point of a
  thematic layer — can only name the classes of one. `setChartLayer` makes the
  thematic chips a radio group.
- **It stands down at street scale**, above `THEME_MPP_MIN` (15 m/px) only.
  WorldCover is 10 m data and RESOLVE is simplified to five kilometres; both are
  statements about REGIONS, and a class sheet over a junction is a flat wash
  over the one scale that can already show what is there. 15 m/px is the same
  boundary the cloud shadows and the ground mottle already stand down at, so
  the chart changes its rules in one place rather than three.
- **The eco layer streams its own tiles.** `ecoAt` asks for ONE z5 tile because
  the guild's question is about the ground under the wheels; a sheet over a
  chart is a question about the frame. One tile a pass, centre-out from the
  CHART's focus, bounded by the store's own 24-tile cap.

**THE KEY IS THE SWITCH**, under the scale bar: a chip a layer, filled swatch
and bright text for a layer that is drawing, hollow and dim for one that is
not, tappable (`layerDown` swallows the DOWN through `hudPtrs`, or the same
press would also drop a chart fix). A chip that is off still shows, because a
key that hides what you do not have cannot teach. Under it, the LEGEND — built
from the tallies the bake kept, so it names the classes actually on screen,
commonest first, capped at six. `__chartlayers(id?, on?)` reports the lot and
makes the same choice a finger does; the telemetry dump carries a `chart
layers` row, because a seat report about a chart that does not say which layers
were on is a report about a map nobody can reproduce.

**THE PALETTE SITS ON A LATTICE OF 42, AND THE TEST IS WHY.** The composite
quantises to fourteen levels, so one palette step is about 18/255 and two
classes one step apart are one colour. Every class is snapped to
14/56/98/140/182/224 in each channel with no two in a layer sharing a point,
which puts any pair at least two and a third steps apart in at least one
channel. **The first cut was hand-picked and the test measured its tropical
conifer against its mangrove at EIGHT of 255** — half a palette step, two
greens that were one green on the glass — and its bare ground against its
lichen at 34. Neither is findable by looking at a legend.

**CITIES ONLY AT WIDE VIEWS** is one rung added to a ladder that was one short:
`maxRank` was `r > 26000 ? 1 : r > 12000 ? 2 : 4`, so a two-hundred-kilometre
frame and a twenty-seven-kilometre one drew the same class of settlement. Past
200 km it is rank 0 — cities — because a town's name there is a claim about a
place the frame cannot show the shape of, and sixteen of them is the whole
label budget spent before a capital is drawn. The radius is `backdropRadius()`,
not `viewRadius()`, for the reason the chart's own ring now uses it: the capped
one saturates and every wide band reads the same.

**AND THE PLACES PASS NO LONGER RIDES ON THE ROADS' SWITCH.** It read
`ovGroup.visible`, which was the only record that the coarse map was allowed to
draw — fine while roads and names were one layer and wrong the moment they were
two, since switching ROADS off would have taken every name with it. `ovBandOn`
is the ZOOM claim; the layers are the PLAYER's.

**Measured** (`devtools/chart-layers.mjs`, Cape Town, chart at 4,555 m/px, the
far ring home):

| | result |
|---|---|
| COVER on | 25/25 shell tiles carry a sheet, **1.6 ms a tile** |
| its legend | GRASS 41% · SCRUB 29% · BARE 13% · FOREST 6% · WATER 6% · CROPS 5% |
| ECO on | 25/25 sheets, **1.8 ms a tile** |
| its legend | MEDITERRANEAN 58% · DESERT 42% |
| ROADS off | roads gone, the place labels still drawn |
| PLACES off | labels 0, roads still drawn |
| at 2 m/px | `theme cover`, `drawing false` — the sheet stands down |

The eco sheet at the Cape is the Fynbos against the Succulent Karoo, which is
the right answer and the one the guild has been reading for months without
anybody being able to see it. The frames are `layers-*.png` in `$DRIVE_WORK`.

**THE FIRST BAKE MEASUREMENT WAS 209 MS A TILE AND WAS A READING OF THE FRAME
RATE.** It timed from the start of the job to its last slice — which in a
harness at two frames a second is sixty-four slices spread over wall time, not
work. **A sliced job's price is the sum of its slices and nothing else.** The
row timer sums inside the slice now and reports 1.6; `theme:bake` is the same
number on a device's own telemetry. This is the third time in this file a wall
measurement has been offered for a CPU one, and it is always the same shape.

Two smaller things worth keeping:

- **DATA ROW 0 IS THE SOUTH EDGE.** The shell's lattice runs north to south
  with uv `(ix/seg, 1 - iz/seg)`, so v = 0 is the south row and a `DataTexture`'s
  first row is v = 0. Backwards, every sheet is mirrored about its own parallel
  — which on a class map of a coastline looks like bad data rather than like a
  flipped texture.
- **0 IS NOT A CLASS.** An unknown texel is written fully transparent, so a
  sheet never paints over ground nothing has measured. An overlay that fills
  its gaps with a colour is lying about its coverage, and saying where the data
  IS is most of what these layers are for — at the Cape the eco sheet visibly
  stops where its z5 tile does.

**What is NOT done here.** The sheets are per far tile, so at a zoom where the
shell has handed over to the globe there is no sheet either; a globe-wide cover
map wants the coarse bake, not this path. There is no way to see a class's name
by tapping the map (the legend names them; the site card already answers for a
point). And `COVER_NAME` in main.ts is still a second list of the same eleven
class names — harmless, and the next thing to collapse into the table.

### …and then the seat photographed it loading badly

Five frames and an exact report: *"only some of the viewport loading eco and
then not proceeding, and then loading and then throwing away on zoom in when
its replacement isn't yet built. Do we prioritise focus area? Why discard on
zoom in/out — surely just replace when finer detail available."* Three separate
faults with one look, and the answers are the three rules the far shell and the
chart ink already live by, which the sheet had been written without.

- **A SHEET BELONGS TO A SHELL TILE, NOT TO A TILE KEY.** `refreshTheme`
  reconciled against `farMeshes`, which is the CURRENT ring and is not what is
  on the screen: `setFarLevel` moves the outgoing ring into `farRetired`, where
  those meshes go on being DRAWN until the new level covers them — that
  retention is the whole reason a zoom does not blink, and it is three sections
  up in this file. Keyed by the key, every sheet was dropped at the instant its
  tile was retired, so the RELIEF stayed and the class map vanished and came
  back a tile at a time. It is keyed by the far MESH now, so a sheet lives
  exactly as long as the thing it is drawn on — current, retired, whatever —
  and dies when that mesh leaves the group (evicted, or parked, which releases
  the very geometry the sheet is drawn with). `far.parent` is the whole test.
  **This is the third time in this file that a second lifetime kept beside a
  first has drifted from it**, and the fix is the same every time: do not keep
  two, derive one.
- **NEAREST THE FOCUS FIRST.** Asked directly, and the answer was no — the
  tiles were baked in `farMeshes` insertion order, which is the order the shell
  happened to land them, which at the widest zooms is most of a hemisphere away
  from what the player is looking at. Sorted by distance from the chart's own
  focus (`viewX() + panX`), in the tangent plane, which is exact enough to
  order twenty-five tiles by and needs no sphere.
- **A SHEET BAKED OVER A HALF-ARRIVED SOURCE IS A HOLE NOTHING WOULD FILL.**
  One shot, from whatever had streamed at that moment — and the cover rasters
  and the ecoregion tiles arrive over seconds. That is the "not proceeding"
  half exactly. `themeSrcRev` is bumped wherever a cover or eco tile lands, a
  sheet records the revision and the count of texels that came out with NO
  class, and a sheet with unknowns is baked again when the revision has moved:
  **one a pass, nearest first**, because a cover ring landing bumps the
  revision twenty-five times and re-baking every incomplete sheet on each would
  be the ring's work several times over for a map that is already drawn.

**AND THE FINE WORLD WAS PUNCHING A HOLE IN THE MIDDLE OF IT.** The first cut
kept `depthTest` on with a polygonOffset, reasoning that turning it off would
paint a class map over the streets. What it actually did was let the fine ring
occlude the sheet: at the seat's own ten-kilometre frame the fine ring is a
quarter of the glass, and the photograph is a class map with a block of bare
terrain in the middle of it. A thematic sheet is a statement about the whole
frame or it is noise. `depthTest: false` now, and **`THEME_MPP_MIN` is what
makes that honest** — past 15 m/px a street is one pixel and there is nothing
under the sheet that the sheet is hiding. With depth off, draw order is the
only law, so the sheet takes the same total-order-by-level the chart ink and
the shell's lift already use (`themeOrderFor`, 20 + z): a retained finer sheet
stays over a new coarse one, and the whole band sits between the shell at 0 and
the ink at 40, so a class map is always a GROUND.

**AND A SILENT SHEET NOW SAYS WHY.** The first cut had four states and covered
three: on-and-below-the-zoom-gate said "zoom out", on-and-drawing-with-a-legend
drew the legend, and **on, past the gate, with nothing baked yet fell through
every branch and printed nothing at all** — which is the state the seat
photographed with `FAR 25 0/25` on the status line and a COVER chip that looked
broken. Four branches now: ZOOM OUT FOR THE SHEET · SHEET NEEDS THE SHELL ·
SHEET LOADING · the legend. And the legend carries a dim `+` while any sheet
still has unknown texels, because "is that everything or is it still coming" is
the question the report asked three different ways and nothing answered.

**AND "STILL LOADING" IS WORK OUTSTANDING, NOT TEXELS MISSING.** The first
version of the re-bake rule tested `unknown > 0`, which is wrong twice over.
Over OCEAN it is permanent and correct — measured on a wide Cape zoom,
**84,353 of 102,400 texels unknown with the ring fully home**, which is the sea,
that WorldCover does not map and the ecoregions do not claim — so the legend's
`+` would have been on for ever and the re-bake would have fired on every cover
tile that landed anywhere. And a sheet with unknowns whose SOURCE has not moved
since it baked has nothing to wait for. So a sheet settles the moment a re-bake
fails to LOWER its unknown count (or after `THEME_REBAKE_MAX` tries), and
`themeWork()` — tiles in the ring with no sheet, bakes in flight, unsettled
sheets a newly-landed source has left behind — is what the `+` and the probe's
`filling` report. Zero means the map is as complete as the data allows.

**Measured** (`devtools/chart-layers.mjs PHASE=sweep SHOTS=0`, Cape Town,
primed at zoom 300 then jumped to 20,000, sampled ~500ms for a minute), the
working tree against `f4f046c`:

| | control | fix |
|---|---|---|
| sheets held on RETIRED shell tiles (the mechanism) | **0**, structurally | **39** |
| samples with the shell drawing and the sheet empty | 3 of 128 (2%), longest 0.8s | **0 of 101** |
| shell levels crossed during the sample | (the control's probe cannot say) | 11 → 6 → 5 |
| sheets at the end, for a 25-tile ring | 25 | 50 (25 current + a retained ring) |

**The first number is the one to read.** A sheet keyed by its tile KEY cannot
be on a retired tile — it is dropped the instant the key leaves the current
ring — so the control's zero is structural rather than lucky, and the fix's 39
is the class map surviving two level swaps. The blank count is the SYMPTOM, and
a harness can barely sample it: a bake is 1.6 ms and a tile here lands off a
warm relay, so the window the seat sees over a real network is a frame or two
here. `scratchpad/sheettrace.mjs`-style tracing showed it directly — level 7
with 4 sheets all current, then the swap to 5 with `retiredSheets 4` holding
for the rest of the trace while the new ring streamed.

`__chartlayers()` carries `sheets`, `retiredSheets`, `unknown`, `filling`,
`rebaked` and `asking`; the telemetry's `chart layers` row carries the same, so
a seat report says whether a sheet was still filling.

**AND ONE PHASE A PROCESS.** All three sections of `chart-layers.mjs` in one
run blew the twenty-minute harness fuse, which kills the run rather than
waiting — so the last number printed was from a process that was killed, and no
number from such a run should be quoted. `PHASE=basic|sweep|near`, and
`SHOTS=0` for a phase whose answer is numbers: with drawing on, one probe round
trip is five seconds and a sixty-second sweep is TWELVE samples, which is not a
sample of anything.

**Still not done, and now with a reason rather than a shrug:** a sheet is per
far tile, so where the shell has handed over to the globe there is none — the
globe is a graticule, not a tiled surface, and a planet-wide class map is a
BAKE (the same argument as `globe-base.png`'s, one layer over). And the sheet
is a `MeshBasicMaterial` and takes no day/night term, so on the night side it
would draw at full brightness; it matches the chart's other unlit furniture
(the road ink does the same), and whether a thematic overlay should be lit at
all is a judgement nobody has made yet.

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

## The flat roofs were black, and the reason was the winding

Reported from the seat: *"we recently iterated on buildings (facades and roofs)
but I'm seeing that flat roofs still render black. They should not be dead
black, they should be proper flat roofs, often with small protrusions and
miscellaneous structures on top? With an edge/small wall?"*

Two separate faults with one look, and **"dead black" was not a figure of
speech**. Measured at Suresnes on a 663 m² flat-roofed block, noon, clear sky,
four sample points each verified by raycast to be on the building's own mesh:
**sRGB [0,1,0], luminance 0.0001**, with the grass beside it at 0.0500. Two of
the four samples read exactly zero.

### A mirror is not a rotation

`polygon` builds its extrusion as `ExtrudeGeometry` → `rotateX(90°)` →
`scale(1, −1, 1)`, and that last step is a MIRROR. `BufferGeometry.scale`
transforms the NORMAL attribute through the normal matrix, correctly — and it
does not touch the index, so the triangle WINDING reverses and the two stop
agreeing. Measured on the shipped construction, a plain 12 × 8 box:

```
cap triangles: attr-up 2, attr-down 2
winding vs attribute: agree 0, DISAGREE 4
wall triangles:       agree 0, DISAGREE 8
```

Every triangle, caps and walls alike. The material is `DoubleSide`, and three's
`normal_fragment_begin` does `normal *= faceDirection` there — so from OUTSIDE
the building every face is back-facing, the shading normal flips to point
INWARD, and Lambert's `dot(N, L)` clamps to zero. The buildings have been lit
from the wrong side since the day the extrusion was written.

**WHY THE WALLS SURVIVED IT AND THE ROOFS DID NOT.** A wall has three other
sources of value — `bldSkylit`'s emissive lift, the façade shader's sky
reflection in the glass, and its own drawn detail — so an unlit wall reads as a
flat wall rather than as a hole. A flat roof has ONE: `bldRoofSkylit`'s lift at
HALF the wall's (`lift * 0.5`, about 0.026 of its own colour at noon), and the
hemisphere light then hands a downward-facing normal its GROUND colour, which
is what those samples are. That is the "dead black", and it is not that the
roof was dark: it was receiving no sunlight at all.

**AND `roofGeo` AND `chimneyGeo` WERE INSIDE OUT TOO**, by a different
mechanism: they emit their own triangles and `computeVertexNormals` derives the
attribute FROM the winding, so the two agree and both point the wrong way —
which DoubleSide hides completely, because a consistently inverted surface is
lit toward the viewer from either side. Same 12 × 8 plan:

```
roofGeo gabled    roof 0 outward, 10 INWARD   wall 1 outward, 1 INWARD
roofGeo hipped    roof 0 outward, 12 INWARD
roofGeo pyramidal roof 0 outward,  4 INWARD
chimneyGeo        cap  0 outward,  2 INWARD   wall 2 outward, 6 INWARD
```

The gable ends are the tell: the two triangles are written in the same (u, v)
order at opposite ends of the ridge, so one faces out and one faces in — which
**no blanket reversal can fix** (the first attempt was exactly that, and left
them 1/1 the other way round). So the rule is stated once and enforced in
`faceOut`, in terms of what these generators actually emit: every face is either
EXACTLY VERTICAL (a gable end, a skillion's eave wall, a stack's side) or an
upward-facing surface (a plane, a hip, a cap, a ridge tile), so a vertical face
points away from the piece's own axis and everything else points up.

- **THE FIRST CUT PUT THE WALL TEST AT 0.55** — the façade shader's own — and
  the ridge cap's skirts measure |ny| **0.537**: steeper than the shader calls
  a roof, and sitting ON the ridge, where "away from the plan's centre" means
  nothing. One skirt of every gable and hip in the world came out pointing
  down. A threshold that has to separate a 57° tile from a wall is the wrong
  threshold; a wall is vertical, and 0.05 is float noise.
- **A CHIMNEY IS NOT AT THE PLAN'S CENTRE.** It stands a metre in from the
  gable end, so the shared reference calls three of its four sides outward and
  the fourth one in. Each stack is oriented about its own axis, over its own
  slice of the arrays.
- **AND THE CLOSING VERTEX DOES NOT VOTE.** An OSM way repeats its first node,
  so on a four-corner rectangle the repeat drags the centroid a metre off its
  own middle — enough, measured, to call a correct gable end inward.

`?bldface=0` restores the inside-out world exactly, and
`devtools/roof-wind.test.mjs` holds all of it in pure node in under a second,
with the mirrored extrusion as a CONTROL that must fail both halves.

### A flat roof is not a lid

The other half of the report, and it needed no fix because there was nothing to
fix: **`roofGeo` returns null for 'flat'**, so the roof of a third of the
stock (439 of 1,204 intact at Suresnes, measured) was the extrusion's own cap — one horizontal quad, flush with the
wall, with nothing on it and no edge to it. Even lit correctly that is a lid,
and from the chart a town of them is a sheet of paper.

`flatRoofGeo` (roof.ts, pure) builds the three things a real flat roof has:

- **A PARAPET.** The wall runs on past the roof as a low upstand with a coping,
  which is what stops the covering peeling and what stops people falling off —
  and from the street it is the building's top EDGE. An inset ring mitred on
  the angle bisector (clamped at about three times the thickness, so a sharp
  spike in an OSM footprint cannot throw its inner corner across the roof),
  with an outer face, a coping and an inner face per edge. Height
  `0.26 + 0.035 × height` capped at 1.15 m: a course or two of brick on a house,
  waist high on a block.
- **PLANT.** One lift overrun or tank housing and then the miscellany — vents,
  ducts, condensers — square to the footprint's own oriented box, one to four by
  the plan's area, each placed only where all four of its corners plus the
  parapet's clearance lie inside the ring.
- **NOTHING WHERE THERE IS NO ROOM.** Under 20 m² a lean-to keeps its lid; the
  parapet wants 40 m² or a 6 m height; the plant wants 120 m². **And a plan
  narrower than two parapets is refused outright** — OSM tags walls, platforms
  and lean-tos as buildings, a 40 m × 0.5 m ring clears 20 m² comfortably, and
  its inset ring would cross itself and turn every inner face inside out along
  its length.

**IT IS ONE PIECE AT `aGram` −1 — the façade shader's BLANK wall — for the
chimney's reason**: the bay grid falls across a parapet however it falls, and a
door on one is the kind of thing that gets photographed. Blank still wears the
cornice band at its own `aTop`, which on a parapet IS its coping, so the street
reads wall, cornice at the eave line, parapet, coping. Deterministic off the
OSM id by a constant nothing else uses, so an A/B of the massing, the ruin roll,
the roof form or this is a comparison of that one thing.

**AND `roofShape` SAYS 'flat' OUTRIGHT NOW.** It answered `undefined` in six
places and `undefined` is what `intactSink` reads as "no roof". The one case
that genuinely has no roof is a CANOPY — a sheet on posts with no attic — and
`__built().roofs` counts it separately, where it used to be filed under flat.

### Measured

`devtools/flat-roof-ab.mjs`, at-paris-west, `time=NOON&wx=clear&sunalt=62`, the
same building and the same sample points in all three runs, one variant per
process:

| | flat roof, median luminance | buildings, triangles |
|---|---|---|
| `bldface=0 bldpara=0` — as shipped | **0.0001** (samples 0, 0, 0.0002, 0.0006) | 135,588 |
| `bldface=1 bldpara=0` — the winding | **0.0330** (0.0322 … 0.0340) | 135,588 |
| `bldface=1 bldpara=1` — and the roof | **0.0392** (0.0323 … 0.0480) | 161,166 |

with the grass beside the building at 0.0500 in all three. Over the terrain
pane: the winding moved **35.9%** of it (mean 18.7/255), the parapet and plant
another **6.1%** (mean 4.4), and the pane's own luma went 0.0413 → 0.0624. The
frames are the argument: in the control the block is a solid black wedge in a
lit street; in the fix it is slate felt with a cream coping running the whole
perimeter. **+18.9% on the building triangle bill** for parapets and plant on
115 flat roofs — the same order as the pitched roofs' +3.5%, on a stock that is
cheap (10 draw calls at Suresnes, 11% of the scene's triangles).

### …and from the street, in the lab

A parapet is a thing you see from the pavement, and the chart cannot judge it.
`devtools/flat-roof-lab.mjs` drives the façade lab with ROOF = FLAT at three
traditions, two suns each — which is what the lab is for and why its flat entry
now draws something instead of nothing. Twenty seconds, no world, no HUD, no
page errors. The frames: on the Île-de-France block the parapet is a band of
wall above the last row of windows with the cornice's lit line at its head and
a plant box standing over it at the corner; on the Sahel's adobe block, two.

Two things the first run of that tool taught, both about the lab and not about
the roof. **The dials panel is most of the glass at 390 px** — the first frames
were photographs of the dials; `H` is the lab's own fold key and gives the
gutter back. And **the lab's lens is horizontal** (`camera.lookAt(0, eye, 0)`),
so the survey's 26 m stand-off at a 1.3 m cab eye puts a four-storey building's
top edge off the top of a portrait frame — the one part of it this tool exists
to photograph. There is no number in that tool, deliberately: the lab's light
rig is not the game's (no `bldSkylit`), so a luminance read there would not be
the world's.

### Three instruments, because the first three attempts measured something else

Every one of these cost a run, and all three are the same shape of fault — a
sample that could not be shown to be on the surface it named.

- **THE TRUCK IS ALWAYS AT THE CENTRE OF A TOP VIEW.** Standing the rig on a
  footprint so its roof lands under the middle of the frame puts the RIG under
  the middle of the frame. Measured: the control and the fix returned sRGB
  [78,48,37] and [78,48,37] — the same bonnet, twice. That is also what made
  `roof-light.mjs` inconclusive when it was written; its three sample boxes
  "all read the same green" because they were on the truck.
  `__hide('rig')` is new and hides the model — **and `attractStop` put it back
  about sixteen milliseconds later**, because `stepAttract` runs every frame
  and calls it on every frame the hub is not open. Anything that asserts a
  visibility every frame outranks anything that assigns one once; the rig's
  visibility is derived from `hideSet` now.
- **AND THE HUD DRAWS ITS OWN VEHICLE MARKER THERE**, on a canvas no scene
  switch reaches. `__hud(false)` clears the instruments off the frame — not the
  player's HIDE HUD, which is `setClean` and hides the DOM controls only — and
  takes the camera-dock rects with it, or the dock goes on blitting the live
  scene into a stale rectangle (the fault this file already records).
- **A BOX AT A FRACTION OF THE FRAME IS A BOX OF UNKNOWN SIZE.** It is sized
  from `__scale().mppCss` and stated in metres now, the zoom is POLLED until it
  settles (`__zoom` sets a target the frame loop eases toward: two runs
  photographed after a fixed wait came back at a 45 m frame and a 32 m frame,
  which is not an A/B), and **every sample asks `__pick` what it is standing
  on** and is dropped unless the answer is `building`. The sample sets are not
  identical between variants by construction — a parapet stands a metre higher
  than the lid it replaced, so a ray that used to pass over the roof and hit
  the rig behind it now hits the parapet — so the comparison is the median over
  the samples that hit a building in EVERY run.

Two probes came out of it and are worth knowing: `__bldroofs(r, form?)` lists
every footprint `building()` gave a roof to with its centroid, area, short side,
height, form and ring (`__built().roofs` is a histogram: it can say a town is
half flat and not WHICH half, which is why a tool had to guess and guessed
wrong), and `__pick` now names the mesh it hits.

**Not done here:** the parapet is one height round a whole building, where a
real one steps with the roof's own levels; nothing drains, so there are no
outlets or upstands at a gutter; the plant is boxes, not plant; and `roof:shape`
values this game does not model (dome, onion, gambrel — a tenth of a percent of
the stock) take the flat treatment, which is what they already wore.

## A railway is engineered, and `drivable` was the one flag saying so

Reported from the seat after the ballast and sleepers shipped: *"I've taken a
look at rails live (minor: sleeper gaps can be 4x) and it seems like railways
are not participating in the road ribbon's solved grading — a special case for
rail, far more straight, and thereby likely to be cutting or raised on bridges
etc."* Both halves are right, and the second is one flag.

### `drivable` was five jobs, and the split was WRONG about one of them

Every railway in the world was drawn as
`ribbon(pts, w, mat, lift, /* drivable */ false, /* mode */ 'none', …)`, which
drapes a way over the heightfield exactly as a footpath is draped. It was not
an oversight about railways: `drivable` gates FIVE separate things and there
was no way to ask for some of them.

| job | what reads it | a railway wants it? |
|---|---|---|
| the solved longitudinal profile | `hintEl`, `flat`, `solveChainLocal`, `ruleGrade` | yes |
| `roadGrid` | the physics surface, `surfaceAt`, `wayAhead`, `juncNodeGrid`, the router, `__toroad` | **yes — see below** |
| `segsOf` → `rasterizeCut` | the corridor carve and the kernel's break lines | yes |
| `dirtyTerrainAround` | the tiles rebuild so the corridor shows | yes |
| (with `!track`) the apron — batter, fascia, soffit, piers, parapet, `daylight` | the earthworks and the structure | **yes** |
| (with `!track`) cat's eyes, chevrons, hazard boards | the carriageway's furniture | no |

**THE FIRST CUT PUT `roadGrid` IN THE "NEVER" COLUMN, AND THAT WAS THE NEXT
BUG.** It kept railways in a `railGrid` of their own on the reasoning that
nothing in the physics, `surfaceAt`, `wayAhead`, the junction registry or the
router should ever find a track under the wheels. The seat's report on that
build was exact: *"Still not seeing bridges and batter apply to railways. And I
think for the purposes of this game they should be fully driveable (any
concrete reason not to?)"* — and the two halves are the same half.

**`apronOn` is `drivable && !track`.** It gates the batter, the fascia, the deck
soffit, the piers, the parapet and `daylight` — and `daylight` is what
`maxDaylight` is computed from, which is what decides whether a way is a
STRUCTURE at all. So a railway that is not drivable **cannot have earthworks or
a bridge by construction**, however carefully its profile is solved. The first
cut moved `noteBridgeForm`'s gate off `drivable` and thought that was enough; it
was not, because `maxDaylight` was still 0 and the whole apron was still off.
One flag, five jobs, and withholding it withheld four.

**And there is no concrete reason to withhold it.** This is a game about driving
anywhere; a ballasted formation is a perfectly good surface to put a truck on;
and a rail alignment through a mountain is exactly the sort of shortcut a player
should be allowed to find.

**The router needed no special pleading, and the arithmetic says why.** An edge
costs `len × (1 + (GOAL_NARROW − 1) × clamp((5 − hw) / 4, 0, 1))`, so a metre of
Cape-gauge formation (hw 1.66) costs **2.00**, a metre of residential street (hw
3.75) **1.38**, and a metre of motorway **1.00** — the track is half as dear
again as the street beside it and twice a trunk road, so a plan takes it only
where it genuinely is the way. And `wayAhead` will not turn onto one by
accident: `chainScore` docks a candidate the full 0.3 its width step allows for
a road-to-rail change, and a level crossing is near enough perpendicular to fail
`AHEAD_MIN_DOT` (0.12, about 83°) outright.

So a graded railway is drivable in full, `railGrid` is gone, and what survives
of the split is **the dressing**: `railway` gates off the road furniture — cat's
eyes down the middle of a main line, chevrons and hazard boards along a cutting
— because those are captions for a carriageway rather than facts about a
surface. It keeps the parapet and the reflector posts, which are about an edge
you can fall off and the truck can now be on this one. The paint needs no gate
at all: markings live in the road TEXTURE and a railway wears `railMat`.

**BALLAST IS NOT TARMAC, AND `sq` IS WHERE THAT IS SAID.** `Seg.sq` is the
surface quality the wheels read (`Q_ROAD` 1, `Q_TRACK` 0.55, `Q_GROUND` 0.2); a
formation is handed `Q_TRACK` and a siding 0.4, so driving a main line feels
like a graded gravel road with something hard every two thirds of a metre.
`Seg.rw` marks a formation inside a grid that is otherwise all roads — it is
what `__railgrade` finds them by, now that they are not in a store of their own.

**The one thing still NOT derived from `drivable` is the hint lookup.** The
chain planner chains ways by NAME and solves them as one profile; a railway
asking `hintAt` would find a road's profile within two and a half metres and
take a carriageway's deck at every level crossing there is. `hintEl` stays on
the planner's own ways, and a rail fragment solves locally (`solveChainLocal`).

### The ruling grade is the whole difference, and so is the deviation budget

Steel on steel has about a tenth of the adhesion of rubber on tarmac, so where
a road climbs at ten or fifteen per cent a main line will not exceed two —
which is *why* a railway cuts through what a road goes over. `RailSpec` states
it per kind (`gradeMax`): a funicular 0.5 (a cable, not adhesion), narrow gauge
and miniature 0.05, light rail and heritage 0.04, a siding or an industrial
branch 0.035, **a main line 0.022**. And `graded` says which kinds get a
formation at all — every kind but `tram`, whose rails are laid in a carriageway
that already has a profile and whose corridor would be a cutting down a city
street.

**AND FIVE METRES IS A ROAD'S DEVIATION BUDGET.** `DEV` in the grade clamp is
the number that decides who wins when the ruling grade and the ground disagree,
and its own note says why it is small: so that a San Francisco street at 20%
stays a street instead of becoming a viaduct through the neighbourhood. That is
right for a road, which mostly follows the ground. A railway is the opposite
object — straying from the ground is what it IS — and under a five-metre budget
the 2.2% clamp simply loses every argument and the track goes back to being
draped. `DEV` is **24 m for rail**. The grade line's smoothing window goes with
it (±16 stations, about ±200 m, against a road's ±8): a road's gradient
genuinely changes over a couple of hundred metres and a main line's does not.

### Measured at Glencairn

`devtools/rail-grade.mjs`, `at-glencairn` (four ways of the PRASA Southern Line,
no network at all so the answer is the same every run), three-signal settle gate
including the terrain build count. **The A/B is the SWITCH** (`?railgrade=0`),
not a pinned revision — both columns come from the same bundle and the only
difference is the rule, which a `rev` cannot promise once a change lives in
three files.

| | `railgrade=0` (draped) | engineered |
|---|---|---|
| rail segments with a solved deck | **0** | **190** |
| of them cutting / embankment | — | **80 / 46** |
| mean \|deck − natural ground\| | 0 by construction | **2.05 m** |
| worst cutting / embankment | — | 24.2 m / 3.52 m |
| drawn mesh against the deck, mean | — | **0.51 m** |
| corridor strips in the carve | 4,776 | 5,248 |
| terrain triangles | 569,260 | 575,177 |
| roadCells (the control within the frame) | 1,074 | **1,074** |

…and the gradient, which is the actual argument. A draped railway carries the
ground's gradient exactly, because it IS the ground plus a lift — so the ground
column is also the control's answer and needs no second run:

| fragment | length | deck grade p95 / max | the ground it crosses, p95 / max |
|---|---|---|---|
| 10 | **1,229 m** | **1.8% / 2.6%** | **66.4% / 144.3%** |
| 9 | 258 m | 0.0% / 0.0% | 5.9% / 6.0% |
| 30 | 212 m | 2.6% / 2.6% | 6.3% / 6.3% |

2.6% is `gLim` exactly (0.022 × 1.2), so the longest fragment is running at its
ruling grade and nowhere near it otherwise. Read the profile in order rather
than the worst rows — `__railgrade().profiles` chains each fragment by its own
endpoints — and the shape is the point: over the last three hundred metres the
DEM swings **−26.0 → −12.2 → −13.9 → −29.1** between samples thirty metres
apart, and the deck holds −25.9 through all of it. Draped, the track rode that.

**The 24.2 m "cutting" is that same DEM noise, not a hill**: its station reads
−2.39 with neighbours at −12 to −26. The honest summary is the mean (2.05 m)
and the gradient table; a worst-case over a coastal z14 tile is a measurement of
the raster.

### Three things that follow, and one that is left under the hill

- **A DEEP CUTTING BECOMES HIDDEN TRACK, by the road rule.** `elevMin[i] −
  prof[i] > TUNNEL_H + 0.6` sets `tn` — no carve, the way left under intact
  ground — and it exists so our own arithmetic cannot dig a crater through a
  town. With a 2.2% ruling it fires far more often on rail than on road: 8 of
  190 segments here. That is the right silent failure and it is visible in
  `__railgrade().tn`, not dressed up as a feature.
- **A RAIL TUNNEL TAKES THE EXEMPTION AND NO BORE.** `tunnelTube` builds a road
  tunnel — a `TUNNEL_H` shell sized for a carriageway — and a 3.3 m formation
  inside a 5 m road bore is neither thing. A `railway=* tunnel=yes` way now
  takes `mode: 'tunnel'`, runs on its portal-to-portal chord under the hill and
  is simply not seen. **Before this it was drawn on the surface, over the top of
  the mountain it is tunnelling through** — the subway filter was the only
  tunnel gate in `railSpec`, so every main-line bore in the world was painted on
  the hillside above itself.
- **AND THE FORTH BRIDGE CAN FINALLY FIRE.** `noteBridgeForm` — what registers a
  deck fragment with the bridge ASSEMBLY, so a landmark entry can stand its
  towers, cantilevers or truss up — hangs off `infraRecipe`, `infraRecipe` hangs
  off `apronOn`, and `apronOn` is `drivable && !track`. So while a railway was
  not drivable the `forth-bridge` entry could never once fire: the Forth Bridge
  carries no road. **Every famous truss and cantilever on earth is a railway
  bridge**, so that gate was excluding the family it was written for.
- **What a 3.3 m formation costs the plain lattice is unmeasured.** Past
  `REFINE_R` the corridor is the old grid carve, whose lattice unit is the
  terrain cell (~21 m), and `rasterizeCut`'s own note records a 3 m footpath
  excavating a 40 m shelf. A Cape-gauge formation is 3.32 m against the
  narrowest road that carves at all — `ROAD_W`'s `service` at 4.5 m — and,
  unlike a footpath, it has a solved deck rather than contaminated drape
  heights, so it is in the same class as a back lane rather than the class the
  track exclusion was written for. Said here rather than asserted: nothing has
  been photographed at that range.

### …and a bridge way's name is the ROUTE's, which is why the Forth still missed

With the apron on, the Forth Bridge's assembly formed and was still a flat
ribbon, and the reason had nothing to do with railways. Read straight out of the
cell's own banked z16 tiles (`16/32150/20404-20406`, by hand, before anything
was changed):

```
4074164    railway=rail bridge=yes layer=1  name="East Coast (Northern) Line"
312411250  railway=rail bridge=yes layer=1  name="East Coast (Northern) Line"
4337906    railway=rail bridge=yes layer=1  name="East Coast (Northern) Line"
312411253  railway=rail bridge=yes layer=1  name="East Coast (Northern) Line"
```

**Four ways, no `bridge:name`, and the `name` is the LINE.** The store's entry
matches `forth bridge` and `forth rail`, and neither is a substring of "East
Coast (Northern) Line", so `bridgeEntryFor` returned null and the assembly fell
through to the generic recipe.

This file already records the same fault twice without generalising it — "the
Forth Road Bridge is named exactly that, and neither match is a substring", and
`noteBridgeForm`'s own comment that "a road's name is often the only name a
bridge way carries — A29 on every bridge the A29 crosses". **It is the rule, not
the exception**: a bridge way carries the route's identity, because that is what
a router needs, and the bridge's own name is an optional extra key that most
mappers never add. A landmark store that claims by name alone will keep missing
the bridges it was authored for, one famous structure at a time.

So an entry claims an assembly **two** ways now, and the second is what the
entry's coordinate was always for:

- **by NAME within `reach`** — unchanged, 1.6–2.4 km, because a name is strong
  evidence and a bridge's fragments spread;
- **by POSITION within `BRIDGE_ON_R` (420 m)** when the name says nothing
  either way. A fifth of a reach, deliberately: the assembly has to be
  essentially ON the entry rather than merely in the same estuary. A positive
  name match for another entry still wins, so this can only fill a silence.

**The Forth is the case that sets that radius, because three bridges cross the
same firth.** Measured on the fix, live, one settle:

| assembly | fragments | form | claimed by |
|---|---|---|---|
| East Coast (Northern) Line | 8 | **truss · cantilever · 3 towers · 1,788 panels** | the `forth-bridge` entry, **by position** |
| Queensferry Crossing | 10 | cable-stayed · a-frame · semi-fan · 166 stays | its own OSM `bridge:structure`, no entry |
| Forth Road Bridge | 12 | girder | nothing — it has no entry, and 420 m keeps the Forth's off it |
| Ferrytoll Viaduct · Fife Circle Line · Station Road | 4 · 2 · 1 | girder | nothing |

A 1.6 km positional radius would have put the Forth's cantilevers on the road
bridge a kilometre west, which is a suspension bridge. 420 m claims the rail
bridge and nothing else. `__bridges()` is the readout.

And the deck goes up with it: `__lifts` reports the two 2.4 km fragments raised
**40.89 m and 33.88 m** with `src: "hint"` — the entry's own `deckM` 46 at
`grade` 0.02 — against a firth at sea level, and `__decks` at the seat's spot
reads the deck at **38.4–41.2 m over terrain at −5.8 to 4.1**.

The earthworks on the same run, over 39 railway ways and 823 formation segments
in a 2.5 km radius — with the spans separated out, which is the whole reason
they now are:

| | at the Forth |
|---|---|
| span (standing clear of the drawn ground) / worst | **527** / 52.4 m |
| cutting / embankment | 100 / 105 |
| worst cutting / embankment | 12.6 m / 4.8 m |
| mean \|deck − natural ground\| over the earthworks | **2.31 m** |
| drawn mesh against the deck, mean | **0.63 m** |
| deck gradient, the two 2.4 km fragments | p95 **1.7%** |
| the ground they cross | p95 **36.6%** and **30.0%** |

### The instrument

`__railgrade(r)` is the probe the question needed, and it needs three numbers at
a station that nothing else reported together: the solved DECK (`railGrid`'s own
`ya`), the NATURAL ground (the height raster — the corridor lives in the terrain
MESH, so the raster is still the untouched hillside) and the DRAWN ground
(`meshSurfaceAt`). Deck minus natural is the cutting or the bank; drawn minus
deck says whether the carve actually reached the mesh rather than merely being
asked for. It also chains each fragment into an ORDERED profile with its
gradient statistics, because sorted by depth a cutting and an embankment two
kilometres apart sit next to each other and the SHAPE is invisible.

**AND A DECK IS NOT AN EMBANKMENT.** The first cut of this probe read, at the
Forth: *620 embankments, worst 46.89 m, mean 22.16*. Every one of those numbers
was the BRIDGE — 2.4 km of deck forty metres over an estuary with the natural
ground at sea level under it. "Deck minus ground" says *this way is high above
the land*, which is equally true of a bank and of a span, and a mean that mixes
them describes neither. The DRAWN MESH tells them apart and was already being
read: an embankment is ground the carve RAISED to meet the deck, so the mesh
comes up with it; a structure stands clear and the mesh stays where the ground
is. A station standing more than three metres (`ribbon`'s own `DECK_GAP`) over
its drawn ground is counted as `span`, and the earthwork statistics — including
`meshOff`, the number that says the carve reached the terrain — are taken over
the rest.

`?railgrade=0` is the exact A/B. `devtools/rail-grade.mjs` runs it on the
Glencairn fixture and `devtools/forth-rail.mjs` at the Forth, one variant per
process. The Forth tool is a LIVE run and says so: the tiles were read by hand
first, so a run that finds no railway there reports a streaming failure rather
than an absent bridge.

### And the sleeper gaps really were 4×

The other half of the report, and it was one line of the canvas. The first cut
drew a 0.34 m sleeper with a 0.17 m shadow, so 0.51 m of a 0.65 m pitch was dark
and the pale ballast between was 3.4 of 16 canvas pixels — **twenty-two per
cent**. A feature that thin on that pitch beats against the screen's own grid
under minification and what survives is every second or every fourth gap, which
the eye reads as sleepers laid four times too far apart. A real sleeper is
0.25 m on a 0.65 m pitch: **the gap is about sixty per cent of a railway**, and
drawing the bars fat inverts the thing that makes track read as track. 0.24 m
with a 0.05 m hairline shadow leaves 55% pale and an 8.9-pixel gap with room to
survive a mip level.

## Atmosphere is contrast; focus is sharpness — and a plane of focus has a scale

Two reports arrived together: one asking for a tilt-shift miniature, one
finding that the aerial perspective's `deep` term was already doubling as a
defocus. They are the same subject from opposite ends, and the second is the
reason the first was worth doing carefully.

**The air's blur is now off by default, behind `?airblur=1`.** `deep` mixed the
far field toward `softTex` as well as toward the haze colour, so a road's
vanishing point went soft because it was far — which is atmosphere doing
optics' job. Haze is a CONTRAST effect: distant things lose contrast against
the sky, they do not lose focus. Split, each can be judged.

### A plane of focus perpendicular to a near-nadir camera does nothing at all

The first cut made the plane fronto-parallel — normal = the camera's forward,
which is what a lens without tilt gives you. On the chart that measured

```
167m:0.00 168m:0.00 170m:0.00 176m:0.00 189m:0.00 209m:0.00 253m:0.00 ... 3000m:0.00
```

an exact zero at every station out to three kilometres, and **no amount of
retuning would have moved it**. A plane perpendicular to a near-nadir view is a
horizontal slab; flat ground lies inside it; a depth of field over ground that
is all at one depth has nothing to blur. Only relief could ever have registered,
and the transect was not crossing any.

Which is precisely why the photographs the look is named after are taken with
the lens TILTED. **The normal is the camera's forward flattened to the
horizontal**, so the plane stands vertical and the band lies across the view.
It costs nothing at the seat — a camera looking 7° down has a forward and a
ground direction a few art pixels apart over a hundred metres, and the chase
band moved from 0.18 to 0.20 at 130 m — and it is the entire effect on the
chart. `__tilt({angle})` now leans the plane BACK from vertical, which is the
Scheimpflug direction proper: at 90° minus the camera's pitch the plane lies
along the ground and level land comes back into focus. Swept and confirmed at
0/30/55/70/80/88°.

### The band is a fraction of the frame, and getting that scale wrong is silent

On ground receding from the eye, with the plane at distance `D`,

```
px = |fd| / mpp = K · |1 − D/d|,      K = uPix.y / (2·tan(fov/2))
```

so **the circle of confusion SATURATES at K** — about 307 at a 55° lens over
320 art rows. Nothing past the plane, at any distance, blurs more. A band asked
for near or above K never resolves; a small one is absurdly tight. The first
presets were bare pixel counts written against nothing: `mini` asked for sharp
under 30 px, i.e. `|1 − D/d| < 0.098`, a **ten-metre** sharp slab at a 53 m
focus, and 84 px for full blur meant everything past ~73 m sat at one value.
The measurement came back a flat 0.306 at every station out to five kilometres
and was right to. **The band was real and almost nothing was in it.**

K is the natural scale for a receding view and a hopeless one for the chart. At
a near-nadir camera the ground offset along the view ray maps all but
one-for-one onto art rows, so the whole visible frame spans about `uPix.y / 2`
— **half of K**. Stated against K, `mini` put its sharp edge two thirds of the
way to the frame edge and its full-blur edge outside the frame entirely: the
chart A/B moved 7.3% of pixels, nearly all of it dither, one softened road at
the top edge and nothing else. Stated against **half the frame** the same words
mean the middle third sharp and the edges gone — 20.3% moved, foreground and
horizon band both plainly soft — and the seat keeps a real far field anyway
because K is nearly twice the frame and the far field saturates past it.

`__tilt` reports BOTH (`halfPx`, `satPx`) with the band as a fraction of each,
because a band read against the wrong scale is how this went wrong twice.

### An instrument that the frame loop overwrites is not a dial

`__tilt({amount, sharp, blur})` promised to set the look live at 3 fps without
a reload. It did not: `aimFocus` rewrites all three uniforms EVERY FRAME from
the preset, so a console write survived until the next animation frame and no
longer. **Every A/B ever taken through those three dials was an A/B of
nothing** — and that is exactly why the air term, the one dial `aimFocus` does
not touch, was the only one that had ever shown a difference. Writes go to an
override the frame loop lays the preset under; `null` clears a field back.

The same class of fault, twice in one unit: an early return in `aimFocus` had
the probe reporting a stale focal point whenever tilt was off. **An instrument
that lies when the feature is off is worse than the operations it saves.**

### And the transect must run along the CAMERA's ray

It walked out along `state.heading` from the truck, which on the chart is the
one ray guaranteed to say nothing: the top camera looks down a line of its own,
the band lies across THAT line, and the truck's nose can cross it at any angle
including ninety degrees. It now runs along the camera's forward flattened to
the ground, from the point under the EYE — so `t ≈ d` and a row reads directly
against `focusDistM` — with the heading kept only for the straight-down limit,
where there is no ground direction to use. The ray and its origin are reported.

**A two-boot image diff is not a control.** The first air A/B diffed frames
from separate boots: mean 0.85/255, 5.09% moved, worst 133.9 — and the 133.9
was wildlife, not blur. Wildlife, sward phase and streaming order all differ
between boots. `devtools/focus-ab.mjs` with `AB=1` flips the uniform live on
one settled world, which is the only honest form of this measurement.

| preset | amount | sharp | blur | what it means |
|---|---|---|---|---|
| `off` | 0 | — | — | the default |
| `subtle` | 0.5 | 0.55 | 1.30 | fore and far background only |
| `mini` | 0.9 | 0.36 | 0.75 | the model-railway band |
| `hard` | 1.0 | 0.20 | 0.50 | a macro slab |

`sharp`/`blur` are fractions of half the art frame. A per-camera scale sits on
top: the chart takes the preset in full, chase a third of it, **the cab none** —
a narrow depth of field while you are the one steering is a tax on exactly the
information you are steering by.

## The terrain mottle's fade has never once fired, and the ruler was the reason

A report arrived proposing a procedural surface-detail system: per-fragment
art-pixel band-limiting for terrain, material-aware functions, a shared
generated-coordinate chunk, façade materials, normal perturbation. Before any
of it, two of its premises had to be checked against this build.

**The report describes code that is not here.** `terrainHash`, `uTerrainRough`,
`tdAppear`, `vTerrainMpp` — `grep -c` returns **0** for every one. The actual
term is two crossed sines at ±0.045, six lines, in `terrainFx(mat, {detail})`.

**And its fade is dead.** `1 - smoothstep(15, 60, uMpp)`, where `uMpp` is
`chartMpp()`, which returns **0 unless `camMode === 'top'`**. Measured by
`__tdetail()` at every station on all three cameras:

```
keep(mpp) = 1.000 everywhere — chase, cab AND chart
```

Not approximate. Not "mostly right from the seat". It has never removed any of
this term anywhere, and on the chart it only begins to at a 3 km view.

### The defence was true across the view and wrong along it by 10³

`uMpp`'s own comment argues the fade is unnecessary from the seat: "from the
seat nothing is ever wider than a pixel at the range the shell begins". That is
true of the **across-ray** footprint and irrelevant, because **ground is seen at
a grazing angle** and along the ray the footprint is the across-ray one divided
by the sine of that angle:

| from the chase seat | across | **along** |
|---|---|---|
| 50 m | 0.16 m | 4.1 m |
| 100 m | 0.33 m | **10.3 m** |
| 800 m | 2.61 m | **29.2 m** |
| 3.2 km | 10.41 m | **424.7 m** |
| 8 km | 26.03 m | **34.8 km** |

Against which: **the mottle's shortest wavelength is 15.3 m, not the 30–80 m
its comment claims.** 30–80 m is the BLOB size. The sines are phase-modulated
with index 2, which spreads sidebands, and their product carries the sum
frequency, so the top of the band is

```
|∇A|max + |∇B|max = hypot(0.131, 2·0.093) + hypot(2·0.071, 0.117)
                  = 0.2275 + 0.1841 = 0.4116 rad/m  →  λ = 15.3 m
```

So from 100 m outward the term has been drawing a moiré against the palette
dither, and at 8 km it is being point-sampled at a hundredth of a pixel.

`fwidth` measures that anisotropy per fragment for one derivative instruction
and no uniform. `?tdetail=px` paints it as a heat ramp and the picture agrees
with the table exactly: blue foreground, cyan to about 50 m, green on the far
hillside, yellow at the ridge.

### Both rulers are compiled in and chosen by a uniform, because otherwise the A/B is two boots

Baking the mode into the shader source makes the comparison two processes, and
two boots of this world differ by wildlife, sward phase and streaming order
before they differ by the term. One smoothstep and a mix per fragment buys a
`__tdetail({rule})` that flips it live. Per-fragment is where this renderer has
room; per-boot is where its measurements go to die.

### And the pixel consequence is honestly small — measured against a floor

The pass is **interleaved** — mpp, px, mpp, px — so the two same-setting frames
give the noise floor at the same temporal separation as the cross pairs. The
first cut skipped that and read a worst pixel of 126; the 126 was a deer.

| | floor (same setting) | signal (ruler change) |
|---|---|---|
| chase | 0.13–0.22 /255 | 0.28–0.49 |
| cab | 0.21–0.40 | 0.32–0.47 |
| chart | 0.83–1.19 | 0.88–1.16 |

Chase clears the floor by about 2×; **cab and chart are inside it.** The whole
term, on versus off, is 0.68–1.02 against those same floors. So the ruler is
right for reasons that are geometric and not in doubt — the correction is
simply quiet, because the thing being corrected is quiet.

**What is NOT established**: an amplitude ladder to ×4 grew the mean delta only
2.2×, which looks like quantisation (±0.045 is 0.64 of a palette step, so most
of the term only decides which side of the dither threshold a pixel falls). But
the band limit also shrinks the affected AREA, and a frame-wide mean cannot
separate the two. A region-restricted measurement is owed before the report's
larger programme is designed against an amplitude floor.

### The same fade is on the cloud shadow, an order of magnitude louder

`terrainFx`'s cloud-shadow term uses the identical `1 - smoothstep(15, 60,
uMpp)`. Its field is `clfbm` at `CLOUD_SCALE` 0.0016 — 625 m per noise unit, 4
octaves at ×2.07, so a finest feature near **70 m**, sharpened further by
`clCov` — and its amplitude is up to **0.5 darkening, about seven palette
steps** against the mottle's 0.64. Same fault, ten times as loud. Not measured
here: the fixture runs `wx=clear`, so `covL` was ~0 and the term never drew.

## The substrate: the ground is a material now, not a wash with noise on it

The seat's verdict on the detail cascade, after driving it: over exposed ground
the world is one undifferentiated surface with some texture on it, and what it
wants is *less "terrain texture" and more a procedural substrate renderer* —
three strongly differentiated components for ground no land-cover class
describes, with the priority stated outright: **5–50 m coherent substrate
domains + 0.5–5 m material structure. Not micro-detail first.**

The cascade could never have got there, and the arithmetic says why in one
line. Every term in it is a BRIGHTNESS, one palette step is 0.07 sRGB, and its
loudest octave is 0.085 — so the whole four-octave cascade lives inside a step
and a half and can only say "a bit lighter, a bit darker". It cannot say
OUTCROP, SCREE or TURF, at any amplitude, because those are not brightnesses.

So `client/substrate-field.ts` is the layer under the texture: a first-order
CLASSIFICATION into rock, regolith and turf, coherent over the ten to fifty
metres a driver reads a landscape at, moving CHROMA where the cascade moves
luminance.

- **THE MATERIALS ARE TRANSFORMS OF THE PLACE'S OWN COLOUR, NOT THREE
  COLOURS.** The palette has already decided what country this is — the climate
  ramps, the bedrock family, the cover tint, the guild standing on it — and a
  substrate that painted a fixed granite grey over all of that would undo the
  whole site model to gain a texture. Rock is the ground's colour with its
  chroma pulled out and a cool cast on it (weathered stone is grey whatever the
  soil around it is), regolith is that colour oxidised warm, turf is it pulled
  green. **And every transform holds luminance to within a few per cent**,
  deliberately: fourteen levels and a dither turn a brightness difference into
  a different TONE and a hue difference into a different MATERIAL, and it is
  materials this draws. The differentials are one to two and a half palette
  steps in the chroma channels and under one in luminance.
- **THE EVIDENCE IS THE ATTRIBUTE AND THE VERTEX COLOUR, AND BOTH ARE NEEDED.**
  `aTd` is three floats now — rough, grain and the bed's own slope — which say
  how mineral and how steep this is; the colour says whether anything grows
  here (`veg`) and whether the ground is oxidised (`warm`), both normalised by
  luminance so a shaded face and a sunlit one classify alike. Neither half is
  enough on its own, and the case that proves it is snow.
- **SLOPE RIDES SEPARATELY EVEN THOUGH ROUGH ALREADY CARRIES IT.** The kernel
  adds slope into rough because a steep face rightly draws louder detail; the
  substrate needs to know how much of what it sees is STEEP, because a slope is
  where soil has left. Reading that back out of rough means inverting the cover
  table in the shader — the kind of cleverness that breaks the first time a row
  moves. And the slope it carries is the BED's, captured before the corridor's
  cut and bank faces force it, or every road's earthworks would paint as
  outcrop.
- **BEDDING IS PHASED ON THE WORLD Y, AND THAT IS THE WHOLE TRICK.** A
  sedimentary bed is a near-horizontal layer, so the line where it meets the
  hillside is a contour of `y + dip·xz`: the bands then wrap round a spur,
  climb a gully and close up where the ground steepens, exactly as real strata
  do, for one dot product. A purely horizontal noise, however well tuned, lies
  flat across the slope and reads as paint on a hill rather than as the hill's
  own structure. The dip itself comes from two very low-frequency reads, so a
  hillside's beds all dip the same way and the direction turns over about a
  kilometre — which is the scale a fold belt actually varies at, and it needs
  no district table and no upload.
- **THE DOMAIN COLLAPSES TO ITS MEAN RATHER THAN ALIASING, AND IS NOT
  EVALUATED PAST THAT.** Beyond the range where a patch is narrower than an art
  pixel the field is replaced by its own mean and the classification falls back
  on the vertex material, which is smooth and is exactly what the far field
  should read. Switching the substrate off out there would be worse: this band
  is the one the brief singles out BECAUSE it survives into the middle
  distance, and at 18 m it is still drawing at nine metres a pixel — most of a
  kilometre from the chase seat.

### What it draws, and the three things the measurement overturned

`devtools/substrate-ab.mjs` is the instrument: the classification's inputs at
six points around the truck, an **interleaved one-boot A/B** (sub0, sub1,
sub0-b, sub1-b — the repeats are the same setting at the same separation as the
cross pairs, so their diff is the floor), **cropped to the near field** because
the domain band-limits away and a full-frame mean of a near-field term divides
the signal by the sky. `?tdetail=dom` paints the shader's own answer — red
outcrop, green turf, blue regolith — which is the only honest witness for a
weight computed in a fragment.

**Measured at the seat's own Yosemite spot** (`lat=37.73606&lon=-119.63732`,
NOON, clear, one settled boot, the lower half and middle three quarters of the
pane):

| | chase | top |
|---|---|---|
| floor, substrate off / on | 1.57 / 1.05 (7.0% / 5.1% of pixels) | 1.34 / 0.40 (4.6% / 1.5%) |
| **SIGNAL, off vs on** | **5.07 /255, 53.9% moved** | **4.96 /255, 44.1% moved** |
| domain 18 m vs 8 m | 1.02, 8.8% | 0.93, 9.9% |
| domain 18 m vs 40 m | 1.92, 10.1% | 1.58, 15.2% |
| amount 1 vs 2 | 4.67, 52.4% | 4.69, 48.5% |

Three to five times the floor in the mean and eight to thirty times in pixels
moved, on a term that is meant to change the ground and nothing else. For
contrast, the ruler change one section up sat INSIDE its own floor on two
cameras of three — that is what a real effect and a true-but-quiet one look
like on the same instrument.

And three things this found that reasoning had got wrong:

- **THE REGOLITH GATE WAS BLIND AT EXACTLY THE SPOT THE BRIEF WAS ABOUT.** It
  gated on the palette's warmth alone — soil is oxidised, snow is not — which
  is true and insufficient. Yosemite's exposed granite reads (0.711, 0.727,
  0.746): pale and very slightly BLUE, so `warm` is −0.049, one gate short of a
  snowfield's, and the surface the seat photographed classified as 49% outcrop
  and **51% leave-it-alone**. The pale sheet stayed a pale sheet, and the whole
  unit would have shipped doing very little where it was wanted most. What
  separates granite grus from a glacier is the cover class, already in hand:
  bare ground carries grain 0.85 and snow 0.00. Either piece of evidence opens
  the gate now and snow still has neither. **The signal went 2.11 → 5.07 and
  13.2% → 53.9% of the pane on that one change.**
- **A STRUCTURE'S AMPLITUDE IS ATTENUATED BY ITS OWN MATERIAL'S WEIGHT.** A
  tone reaches the frame as tone × weight × the material's colour, so at
  Yosemite — rock 0.46 on ground at 0.72 — the bedding's 0.13 arrived as 0.043,
  six tenths of a palette step, and was invisible in the frame while the
  classification under it was correct. **That is the cascade's own fault one
  layer down**: an amplitude chosen against the palette step is under it by the
  time it draws. The bedding, joints, tonal regions and clasts are loud by the
  standards of a texture now (a coincident bedding line is about two and a half
  steps) and can afford to be, because every one is band-limited.
- **THE AMOUNT DIAL WAS A BRIGHTNESS, NOT A MATERIAL.** Scaling the WEIGHTS by
  it is wrong in both directions: at Yosemite they already sum to one, so
  asking for two doubled the absolute colour — 45/255 of mean luma and 94% of
  the pane, a blowout rather than a stronger substrate. It interpolates the
  finished colour now (`mix(palette, substrate, amt)`), so 0 is the palette
  exactly, 1 the classification, and above 1 it extrapolates along the same
  direction: monotone, and 4.7/255 at amt 2 rather than 45.

**And the turf pulls half as hard as the other two, from the Camps Bay run.**
Nearly every texel of that fixture classifies as turf, and at the full pull the
whole meadow came out a step greener than the place's own palette — the site
model overruled by a texture. The palette already handles vegetated ground
well; the brief's complaint was about exposed ground, and that is where the
chroma belongs.

### What it does NOT do yet, stated

- **THE SWARD DOES NOT SHARE THE FIELD**, which is the brief's own next ask:
  *if the shader says this location is 70% grassy and 30% exposed soil, the
  sward seeder should read essentially the same field.* It does not — blades
  take their colour from `swardColData` and their density from the sward's own
  habitat rule, so grass still stands on a rock domain as though it were
  meadow. That is the next unit and it is the one that stops sward reading as
  tufts pasted onto blank ground.
- **THE BATTER STRIP WEARS NO SUBSTRATE.** `MAT.batter` does not wear
  `terrainFx` at all (so it takes no cloud shadow either — pre-existing), and
  it carries no `aTd`. On a refined tile it draws nothing, so this can only
  show beyond `REFINE_R`, where the domain has band-limited away and the
  classification is the vertex material's — but the mean colour still moves
  there, so a distant cut face can differ from the ground it is cut into. Not
  measured; recorded.
- **THE FAR SHELL IS EXEMPT AND SHOULD BE.** Its geometry carries no `aTd`, so
  `vTd` is the zero vector, `rough` is 0 and the gate closes. At 63 m a pixel
  the domain is band-limited away in any case.
- **THE PER-FRAGMENT COST IS UNMEASURED ON A DEVICE.** Worst case is the domain
  (three value-noise reads, twelve hashes) plus a material's own structure; the
  domain is not evaluated past its band and the dip is read only inside the
  rock branch, so the far field pays a compare. The harness renders through
  SwiftShader at three frames a second and cannot say what a phone pays — the
  next telemetry paste is the verification, and `?tdetail=flat` is the A/B that
  takes both the fine octaves and the substrate out.

## A ground view is a channel in the renderer, not a layer over it

The seat, on `?tdetail=dom`: *I really like the data exposure of that and can't
help but feel that is how we should be showing the overview layers — instead of
rendering a new layer in top-down it should apply more generally, into the
actual renderer, and consider showing the substrate debug the same way when
tile debug is on.* Right, and the investigation says so in three numbers.

**WHAT THE SHEETS ACTUALLY WERE.** `bakeThemeTile` reads `farRasters` — the FAR
SHELL's own height raster — so a thematic layer was never a map of the world,
it was a decal on the shell, in the top camera, past 15 m a pixel. Three
consequences, none of them chosen:

- it cannot answer the question from the SEAT, which is where every fault in
  this file was found;
- it reads the SHELL's cover — a 19 km tile at 64 texels, about 300 m a texel —
  and draws it over a fine world holding the z12 raster at 38 m, so the layer
  was four times coarser than the ground it was describing;
- and it carries a bake, a re-bake ladder, a settle rule, a lifetime keyed to a
  mesh and a draw-order band: 341 lines of main.ts, every one of which exists
  because the sheet is a second object with a second lifetime.

A fragment term has none of that. `uGView` is one uniform on the terrain
material, so the view applies in every camera, on the fine ring and the shell
alike, with no bake, no reach limit, no cadence and no waiting states — which
is why the key's four legend states are three for a channel view: it can only
ever be short of ground that has streamed.

- **THE PALETTE IS A 256-WIDE LOOKUP INDEXED BY THE CLASS BYTE ITSELF.** GLSL
  ES 1.00 forbids dynamically indexing a uniform array in a fragment shader
  (markTins is the worked example), so a palette must be a texture; making it
  256 wide and indexing it by the RAW byte — 10, 20, … 95, 100 for WorldCover,
  1..14 for RESOLVE — means there is no ordinal mapping in the kernel, in the
  shader or in `ground-view.ts`. The cover classes are not contiguous, so that
  mapping would have been a real one, and a table in two places is a table that
  will disagree. A kilobyte of texture buys its absence.
- **ALPHA IS THE COVERAGE CLAIM**, as it was for the sheets and for the same
  reason: a class the dataset does not define is alpha 0 and the ground keeps
  its own colour, so the view says where the data IS rather than filling its
  gaps. On the shell that means the class it paints is `cv`, the raster's own
  answer — NOT `cvv`, which carries the country's modal class and the sea
  inferred from bathymetry. Those are inferences the PAINTER is entitled to
  make and a data view is not.
- **AND THE CLASS VIEW SITS OUTSIDE THE SUBSTRATE'S GATE**, which is not
  tidiness. Water is cover class 80 and carries rough 0, so anything inside
  that gate could never paint the sea — and on a cover view the sea is the one
  class a reader is most certain of.
- **THE FALSE COLOUR IS STILL LIT.** It is assigned to `diffuseColor` and takes
  the sun, the cloud shadow and the sun march like any other ground, so the
  landform reads THROUGH the classification. A flat unlit wash would be a truer
  map and a worse instrument.

**COVER RIDES THE GEOMETRY; ECO CANNOT YET, AND THE REASON IS THE DATA PATH.**
The kernel already samples the class per vertex and the shell's bake already
reads it, so `aTd.w` costs one extra `sampleCover` and the view is then exact
at the raster's own resolution with no reach limit and no repaint. (It is the
UNDITHERED read: the colour wants `coverPaint`'s dither so a 38 m block edge
dissolves, and a data view wants the class.) An ecoregion is a point-in-polygon
over a z5 tile, which the terrain kernel cannot do at all — it runs in a worker
that has never heard of the eco store — and which costs about 7 ms a tile to
fill in on the main thread at apply time. Affordable ON DEMAND, when the view
is asked for, and its own unit. **Until then the eco chip keeps its sheet**,
and `themeLayer()` is now "a thematic layer that the channel does not serve".

**MEASURED**, at the seat's Yosemite spot, one settled boot, the near field
cropped, the chip flipped live:

| | chase | top |
|---|---|---|
| floor (view off, twice) | 1.49 /255, 6.8% moved | 1.66, 8.0% |
| **COVER** | **7.73, 75.5% moved** | **15.31, 88.2%** |
| **MATERIAL** (the substrate) | 88.4, 95.5% | 79.2, 99.6% |
| sheets baked | **0** | **0** |
| legend, tallied off the attribute | FOREST · GRASS · BARE | the same |

The chase column is the finding: the old mechanism could not draw in that
camera at all, and the legend under it names classes read from the very
attribute the fragment paints.

**Three rules that came out of building it:**

- **THE LEGEND IS TALLIED OFF THE GEOMETRY, AND IT IS NOT A TALLY OF THE
  FRAME.** The sheets counted classes as they wrote texels; a fragment view
  writes none, so `gvTally` reads every sixteenth vertex of every built terrain
  tile and every shell tile in the scene, on the stream pass's cadence. That is
  the honest source — it is literally what the fragment will read — and it
  over-reports whatever is behind you, exactly as the sheets did. Named here
  rather than implying a frustum test nobody wrote.
- **A DEBUG CHIP IS NEVER RESTORED FROM STORAGE.** MATERIAL's chip is drawn
  only while the tile overlay is up, so a stored `substrate: true` would come
  back as a false-coloured world with no control on the glass to turn it off.
  The settings panel's own lesson about a staged change nothing announces, one
  surface over.
- **AND A VIEW THAT IS ON SAYS SO WHEREVER YOU ARE.** The channel applies in
  every camera and its switch is a chip on the chart's key, which is in exactly
  one of them. Off the chart the active view keeps one chip under the clock,
  pushed into the same `layerRects` the key uses so the tap cannot take a
  different code path. This is the route banner's rule and the third time this
  file has recorded it.

**MATERIAL, not SUBSTRATE, on the chip** — the key's eight-character budget
forced the question and the shorter word is the better one. Beside COVER and
ECO the three read as one vocabulary: what grows here, what biome this is, what
the ground is made of. The id stays `substrate`; a chip's label is a word on
glass and an id is a wire format.

**What is left:** eco on the channel (above), and then the 341 lines of sheet
machinery can go with it. `devtools/ground-view.mjs` is the instrument — it
asserts the chip sets the CHANNEL and bakes no sheet, that the legend names
what is under the camera, and that the chase frame moves.

## The sward reads the substrate's field, and the debug views join the key

Two halves of the seat's ask: *finish the sward cover work, and expose the
water/hydro/road substrate debug rendering in the same way as MATERIAL.*

### One field seen twice, not two fields that agree

The brief's own next step, verbatim: *if the shader says this location is 70%
grassy and 30% exposed soil, the sward seeder should read essentially the same
field. Then sward doesn't appear as arbitrary tufts pasted onto blank ground.*

`swardRows` already held every input the classification reads — the true cover
class, the slope, and the palette colour it had just computed for that texel —
so the work was not gathering evidence, it was making the two computations the
SAME computation.

- **THE CONSTANTS ARE SHARED OUTRIGHT.** `SUB_K` in substrate-field.ts holds
  the sixteen numbers of the weights and the three material transforms, and the
  GLSL source interpolates them. Two hand-written copies would be two copies
  that drift, and the drift would show as grass standing thick on a patch of
  painted rock — which is the complaint this whole programme started from,
  arrived at from the other side.
- **THE NOISE IS WRITTEN TWICE AND THAT IS STATED.** There is no way to call a
  fragment from the main thread, so `subDomainAt` is a port of `subDomain`:
  the same construction at float64 instead of float32. The lattice wrap at 2048
  that keeps the hash argument under 3e5 is what makes the difference
  irrelevant — the two agree to about a part in 10^5, five orders below the
  eighteen metres a patch spans.
- **AND `SUB_MAT` IS THE SOURCE OF RECORD FOR THE KERNEL'S OWN TABLE.** The
  kernel inlines its copy because its closure is stringified into a worker and
  may not touch a module binding; that is a real constraint and not a
  preference, so the duplicate is held honest by a check that parses the
  kernel's source — the trick `perf-check.mjs` uses for `refreshVeg`.
- **AND THE CHECK THAT NEARLY SHIPPED UNSOUND.** Its first cut asserted the
  EMITTED GLSL does not contain `clamp(grain * 0.8`, meaning to catch a number
  typed into the shader instead of the table. It cannot: a template literal
  produces byte-identical text either way, which is the whole point of
  interpolation. The sound check is on the SOURCE — the weight lines must read
  through `K` — with 0.5 exempt because it is the domain's own midpoint in
  `(dom - 0.5)`, the definition of "shift either way about the mean" rather
  than a number anyone would tune.
- **THE GRASS THINS ON THE MINERAL SHARE, NOT THE TURF WEIGHT.** Turf is "how
  sward-like is this ground", which is most of what `GRASS_M2` already says
  from the cover class; multiplying the two would thin every meadow in the
  world by a third for nothing. The outcrop and the scree are what the cover
  class cannot see and the domain draws. Regolith counts for less than half of
  rock, because grass grows in dirt and not on stone.
- **And a blade fades two thirds of the way toward the material it stands in**,
  not all of it: the sward's own colour rules — the bank mineral, the reeds,
  the altitude — are about the PLANT and this is about the ground under it.

**Measured** (`devtools/sward-sub.mjs`, the Camps Bay fixture, `swardsub=0`
against the default). **Two boots, and that is legitimate here only because the
measurement is not pixels**: the switch is read once into a const at module
init like every world switch, so there is no live A/B, and what makes the
comparison honest is a fixture (no network, no arrival order) plus a CPU field
that is deterministic. A frame diff across two boots would carry the wildlife,
the sward phase and the cloud deck.

| Camps Bay, 8,971 sward texels | `swardsub=0` | on |
|---|---|---|
| correlation, density against the substrate's grass factor | **0.099** | **0.31** |
| mean density | 0.360 | 0.302 (−16.1%) |
| share the substrate calls mineral enough to thin | 1.8% | 1.8% |

**THE CONTROL IS NOT ZERO, AND THAT IS THE INTERESTING PART.** The two fields
already shared ONE input — the cover class, which `GRASS_M2` and `TD_MAT` both
key off — so 0.099 is what "two fields that happen to be near each other" looks
like. What the shared DOMAIN is worth is the gap to 0.31.

**AND THE SIGN IN THE PROBE'S OWN COMMENT WAS WRONG UNTIL THE NUMBER CAME
BACK.** It said the correlation should be *strongly negative*; a high grass
factor means the substrate ALLOWS grass, so it is positive. The measurement
caught a false claim in the instrument before the instrument shipped, which is
the argument for writing the expectation down where it can fail.

Camps Bay is a mild case by construction — fynbos classifies as turf almost
everywhere, so only 1.8% of the field is mineral enough to thin. The loud case
is bare ground, which no fixture in the set carries; the live Yosemite spot is
where it shows and where a two-boot comparison would not be deterministic.

### WATER and SURFACE: the same key, a different mechanism, and why

MATERIAL and COVER ride the geometry, so the fragment paints them everywhere.
WATER and SURFACE cannot: their verdicts are `surfaceAt`,
`sampleRestingSurface`, `channelAt`, `oceanAt` and the road grid — CPU walks
over live state that no attribute can carry and no shader can call. So they are
a classified raster painted around the truck and sampled in the same fragment:
the mechanism `?wetdebug` has shipped for months, generalised to take a
classifier.

What they share with the channel is everything the reader touches — the same
key, the same chips, the same radio group, the same legend, the same rule that
a debug chip is offered only while the tile overlay is up and is never restored
from storage. **The mechanism differs because the DATA differs**, and that is
the honest reason rather than an inconsistency.

- **ONE PAINTER, TWO CLASSIFIERS.** A second canvas, uniform and cadence would
  be two mechanisms falling out of step about their box, their resolution and
  their repaint, for no gain: the chips are a radio group so they cannot both
  be on, and they sample the same world through the same 768 m window.
- **SURFACE ANSWERS THE STRUCTURE QUESTION TOO.** A carriageway whose deck
  stands more than `DECK_GAP` over the drawn ground is a STRUCTURE rather than
  an earthwork — the same three metres `__railgrade` counts spans by, so the
  overlay and that audit cannot disagree about what a bridge is.
- **GROUND IS THE FAINTEST CLASS.** At 0.45 alpha it washed 87% of a chase
  frame green and the classes worth looking at had to compete with it. A debug
  overlay's contrast budget belongs to its rare classes.

**Measured** at Yosemite, same boot, near field cropped, against a floor of
1.48/255 and 6.4% of the pane:

| chase | mean | moved | repaint |
|---|---|---|---|
| COVER | 7.33 | 73.9% | — |
| MATERIAL | 88.3 | 95.0% | — |
| SURFACE | 13.96 | 87.2% | 26 ms |
| WATER | 0.55 | 2.6% | 60 ms |

WATER moving almost nothing at Yosemite is the correct answer and worth
knowing before it is read as a failure: the classifier returns "." for dry
ground and paints nothing, and there is essentially no water at that spot. The
Senqu fixtures are where it has something to say.

## The bedding was corduroy, and the first fix for it did nothing

Four frames from the seat at the Stelvio (46.5302, 10.4547, the chart at
`20 M · 1:910 · z18.8`). Two findings, and the second one is about this file's
own method rather than about rock.

**THE CLASSIFICATION IS RIGHT THERE AND THE LOOK IS NOT.** The MATERIAL view
paints the whole pass red and magenta — outcrop, and outcrop over regolith —
with no turf anywhere, which for a 2,800 m alpine pass of rock and scree is the
correct answer. The ordinary render underneath it is the problem: long parallel
diagonal ribs, evenly spaced, running edge to edge across the entire hillside
in one direction. Strata drawn as a weave.

It has to be, and the arithmetic says why in one line: `fract(u)` at one
thickness is a perfectly regular comb. Real bedding does two things that comb
does not — its spacing wanders, and an outcrop is not continuous, it shows in
patches between the scree and soil that bury it.

**AND THE FIRST FIX FOR IT MOVED NOTHING, WHICH IS THE PART WORTH KEEPING.**
A phase warp read at ninety metres and a per-bed strength keyed on the bed
index. Measured at the seat's own scale, the comb's autocorrelation above its
own background went **0.166 → 0.157**: a twentieth, inside the noise. Both
terms were reasonable and both were beside the point —

- a drift of one bed over ninety metres is under a bed across the whole frame,
  so the spacing did not visibly wander;
- and a strength keyed on the bed index randomises each bed's AMPLITUDE while
  leaving every bed's POSITION exactly where the comb put it, which is what an
  autocorrelation reads. It made the ink prettier and the period identical.

What worked was a warp fast enough to be seen (two octaves at forty and
thirteen metres, so the spacing wanders by a couple of beds inside one
hillside — the scale a fold actually bends strata at) and an exposure mask at
about fourteen metres, so the bedding shows in patches and stops between them.
**0.166 → 0.109**, same zoom, same settled world.

| the Stelvio chart, 0.242 m a CSS pixel | peak | background | above |
|---|---|---|---|
| as deployed (`a9774a6`) | 0.191 | 0.025 | **0.166** |
| warp at 90 m + per-bed strength | 0.190 | 0.032 | **0.157** |
| warp at 40/13 m + an exposure mask | 0.132 | 0.023 | **0.109** |

The frames are the argument the number supports: the control is unbroken ribs
from one edge to the other, and the fix is traces that group, wander and stop.

### Two things about measuring it, both of which cost a run

- **THE FIRST METRIC NAMED THE WRONG PERIOD.** It set `__zoom` to a number,
  photographed whatever frame that gave, and reported the strongest
  autocorrelation over lags from five pixels out — which came back at SIX
  PIXELS in every run. At that zoom six pixels is not a four-metre bed; it is
  the Bayer dither. A number that measures the wrong thing is not a weaker
  measurement, it is a different one, and it would have made any change look
  like an improvement or a regression at random. `devtools/bedding.mjs` now
  SOLVES the zoom for a target metres-per-CSS-pixel — the seat's own 0.241, so
  the frame is the frame that was reported — and the lag window is 12–40 px,
  which at that scale can only be the coarse bedding.
- **A PEAK ALONE CANNOT SAY "COMB".** A noisier frame has a larger variance and
  therefore a smaller correlation at every lag, so a peak that fell might mean
  only that the term got broader. What says comb is how far the peak stands
  above the BACKGROUND of its own lag window, and that is the column to read.

### …and the cost, which the seat's own frames raised

The Stelvio frames read **22 fps with MATERIAL on and 17 with it off**, and the
only difference between those two is that the classification view skips every
structure term. That is the first device evidence about what the substrate
costs per fragment, and it is confounded (both frames say `RETRYING WORLD DATA`,
so the streaming differed) — but it points at a real omission: `tdBand` is
exactly zero once an art pixel spans half a wavelength, and a term past that
was still being EVALUATED, four to eight hashes for a result multiplied by
nothing. Every structure term now carries its own footprint guard at exactly
the threshold `tdBand` uses, so nothing that was drawing stops drawing and a
fragment stops paying for what it could not have shown. **Not verified on a
device**: the harness renders through SwiftShader at three frames a second and
cannot say what a phone pays. The next telemetry paste is the verification.

## Phase C: the ground is LAYERS now, and turf was never a substrate

The seat's verdict on the material classifier was sharper than the one about
the detail cascade, and it is the sentence this whole phase is built on:
*turf is not a substrate. Grass is a layer on top of rock/regolith/soil;
rockiness persists under and through it.* A classifier can only ever say "this
patch is the grass one", so what it drew was procedural motifs stamped on a
wash — three mutually exclusive materials, each with its own texture, none of
them standing in any physical relation to the ones beside it.

What replaced it is four LAYERS composited in the order they were deposited,
off the ONE shared geomorphic field phases A and B built:

| layer | what it is | how much of it you see |
|---|---|---|
| A · bedrock | the place's colour, chroma pulled out, cool cast | `exposure × (1 − cover)` |
| B · mantle | regolith and debris, fines warm and scree pale | `soilDepth·0.85 + debris·0.75`, stretched |
| C · grassy complement | the hue pulled toward turf, mineral tone softened | `grassPot` stretched, gated on the palette's own green |
| D · sward instances | *(phase D — the seeder still runs the old classifier)* | — |

```
col = mix(base,  mantle, e.mantle);
col = mix(col,   rock,   e.rock);
col = mix(col,   grass,  e.grass);
```

**THE THREE SHARES ARE NOT A PARTITION, and that is the whole of phase C.**
They are shares of what can be SEEN, not weights over a set of materials: the
substrate exists everywhere, including under dense sward, and vegetation
decides how much of it is visually EXPRESSED rather than whether it is there.
So `rockVisible = exposure × (1 − coverSoftMask)` never reaches zero where
there is any exposure at all — a meadow reads as grass with stones and bedrock
through it, which is the thing a winner-take-all classifier cannot say at any
amplitude. `subExpress` is that arithmetic, `subExpressOf` is the same thing on
the CPU, and `devtools/substrate-field.test.mjs` asserts the claim directly:
a meadow at exposure 0.15 still expresses **0.0225** of rock, a face at 0.92
expresses **0.916** and sheds its mantle to 0.010.

**THE MANTLE FILLS WHAT THE BEDROCK DOES NOT.** The first cut multiplied the
supply by `(1 − exposure·k)` as well, which double-counts — rock visibility
already takes the mantle off a face, and the field's own `soilDepth` already
subtracts exposure. Worked through the field's OWN reading at the Stelvio
(exposure 0.52, mantle 0.378, rock 0.447) that left **34% of a scree slope
drawn as the untouched palette**: `(1 − mantle)(1 − rock)`, the arithmetic
leftover of two independent mixes, standing in for a material nobody had
named. That is a calculation from the probe rather than a pixel count, and it
is the reason the correction was made before the frames were taken. The supply is stretched instead (`smoothstep(0.05, 0.55, …)`), so
ground with any real loose material on it is fully mantled and the bedrock
then cuts back through it by its own exposure.

**AND THE ONE VETO THE FIELD CANNOT SUPPLY IS THE COVER CLASS'S.** Every
channel is derived from the LANDFORM, which is blind to what is lying on it: a
flat glacier in a cirque has soil depth and debris by every topographic
argument there is, and the fines' oxidised warmth would turn it beige. `grain`
is 0.00 for snow and open water and at least 0.05 for everything else on
earth, so `smoothstep(0.005, 0.045, grain)` is a veto on two classes rather
than a classifier — and the test holds both halves: the same ground reads
mantle 0.000 under snow and 1.000 under bare. **The first cut of that veto
asked the palette's own warmth, as the retired classifier did, and vetoed the
Stelvio's scree** — a grey lichen pass reads warm 0.009 and grain 0.25, which
is one gate short of a snowfield's on BOTH of the old routes. The same trap
this file already records as "pale granite reads cool", one layer up.

**THE FIELD IS BAND A AND THE DOMAIN IS BAND B.** The geomorphic lattice is
about thirty-three metres — the brief's 30–150 m band, where the LANDFORM is —
so on its own a hillside the field calls half-exposed would come out a uniform
half. `subDomain` at eighteen metres shifts exposure and debris either way
inside one cell, which is what makes outcrop stand OUT OF fill rather than
average with it, and it is the only noise left in the model that decides
anything. Everything below it is structure, not classification.

### The structure: phase-aware, anisotropic, and chosen by family

- **A LINE KNOWS ITS OWN PHASE NOW.** `subLine(u, w)` takes `fwidth(u)` — how
  much of a period THIS fragment spans — widens the line to its own footprint
  and fades it out before that footprint can alias it. Phase-aware rather than
  band-limited in metres, and the difference is not cosmetic: a bedding phase
  is warped, read along a dip and measured up the world Y, so the period it
  presents to the screen is not the period it has in the ground. `tdBand` would
  cut a line that is perfectly resolvable where the strata run across the view
  and keep one that is not where they run into it. The derivative is the only
  thing that knows which.
- **WHICH FORCED A RULE ABOUT GATES.** A derivative is undefined for the helper
  lanes of a quad that did not take the branch, so every gate above a call to
  `subLine` has to be a quantity that is SMOOTH across the screen: the field's
  own channels (bilinear over a 33 m lattice) or the art-pixel footprint. It
  may not be the domain noise or anything built on it — which is exactly what
  the classifier's weights were, and is why they could never have carried this.
  The isotropic terms keep `tdBand`, which is the right filter for them.
- **THE FAMILY IS THE FIELD'S, NOT A ROLL.** `rockFamily` is chosen by context
  when the field is built — a steep high-exposure face is massive or jointed, a
  hillside with contour expression is bedded, a debris zone is broken — and
  `subFam` turns it into four tent weights that sum to one, interpolated across
  the lattice, so a hillside changes character over thirty metres rather than
  at a line. Bedded gets the bedding shadow, fractured two joint sets (square
  to the dip and along it, which breaks a bed into blocks rather than slats),
  massive a faint mottle and a few long fractures, loose no coherent line at
  all and clasts instead. A random family per patch is the motif-stamping fault
  the rewrite exists to end.
- **SCREE IS A TONGUE, NOT A BLOB.** `subAniso` reads the fall line's own frame
  off the field's flow channels — nearly four times longer downhill than across
  for the apron's lobes, and a much narrower frame for the rills between them —
  so a patch elongates the way scree actually lies. That is the anisotropy the
  brief asked for, and it is the reason the debris channel walks the fall line
  in the first place.
- **AND THE MANTLE IS TWO SURFACES.** `debris / (debris + soilDepth)` decides
  between a tongue of angular blocks and a wash of fines with stones in it.
  Coarse scree is a third colour the classifier could not express at all: it is
  broken ROCK, not dirt, so it is paler and cooler than the fines it rests on.

### What was removed, and what deliberately was not

`subWeights` and the turf material are gone from `SUB_GLSL` outright; the
fragment no longer classifies anything. The CPU half — `subWeightsOf`,
`subGrassFactor`, `subTintOf` — is kept WHOLE, on its own constants
(`SUB_CLS_K`), because the sward seeder still reads it and phase D is where
that moves. Changing the grass in the same unit as the ground it stands on
would make the next frame impossible to attribute. The material TRANSFORMS are
still shared (`SUB_K`), so a blade fading toward an outcrop fades toward the
colour the fragment painted that outcrop.

**AND THE PROBE WAS REPORTING A RULE THE RENDERER NO LONGER RUNS.**
`__tdetail().mat` carried a hand-written THIRD copy of the classifier, at
dom = 0.5, with its constants typed in as literals. It reads the tile's field
and runs `subExpressOf` now. The same fault this file records for the terrain's
cell table and for `BridgeAssembly.claim`, met a third time: a probe that
reports the output of a rule nothing runs cannot witness anything.

The MATERIAL view and its legend moved with it — OUTCROP · GRASS · MANTLE,
red, green, blue, the shares in the shader's own channel order. It needs a
field, so a tile without one paints nothing rather than guessing, which is the
coverage claim every other ground view here makes.

### Measured

`devtools/substrate-ab.mjs`, one settled world per place, the substrate's
strength flipped live, cropped to the near field, against the same-frame-twice
floor at the same temporal separation:

| | floor | SIGNAL (substrate off against on) |
|---|---|---|
| Yosemite chase | 1.39 /255 · 6.4% of the pane | **4.03 · 28.1%** |
| Yosemite top | 0.98 · 3.7% | **3.35 · 25.6%** |
| **Stelvio chase** | **0.00 · 0.0%** | **1.70 · 13.9%** |
| Stelvio top | 1.33 · 6.5% | **3.78 · 26.4%** |

**THE STELVIO CHASE FLOOR IS EXACTLY ZERO**, which is the cleanest attribution
in this file: a bare alpine pass has no wildlife, no sward and no streaming
left to do, so the two same-setting frames are identical pixel for pixel and
every one of those 13.9% is the term under test.

And the field at the Stelvio is the finding the numbers are only evidence for —
six points, all different, all geologically legible:

| offset | exposure | debris | soil | family | rock visible | mantle |
|---|---|---|---|---|---|---|
| 0,0 | 0.52 | 0.55 | 0.18 | **loose** | 0.32 | 1.00 |
| 0,60 | 0.51 | 0.32 | 0.02 | **massive** | 0.44 | 0.38 |
| −90,40 | 0.47 | 0.26 | 0.05 | **bedded** | 0.41 | 0.31 |
| 150,150 | 0.80 | 0.47 | 0.00 | **fractured** | 0.60 | 0.64 |

The pass floor is loose scree, fully mantled, with a third of its bedrock
showing through; the walls are massive and bedded with almost no mantle; the
face at exposure 0.80 shows 0.60 of rock. **That is four different surfaces
within a hundred and fifty metres, chosen by the landform and not by a roll** —
and the frames say the same thing: the control is a smooth tan slope with no
structure in it at all, and the fix is the same slope in grey, broken by
downslope-running tongues and channels.

**AND IT MOVES LESS OF YOSEMITE THAN THE CLASSIFIER DID — 28% of the pane
against 54%.** That is not a regression to be tuned away, it is the point: the
classifier read the valley floor's cover class as BARE and painted it 46%
outcrop and 54% regolith with the weights summing to one, so the whole surface
was replaced. The field says the same ground is exposure 0.46, debris 0.44,
soil 0.07 — an apron of its own debris, `fractured` — which is what it is, and
which leaves rather less to repaint. **A quieter measurement of a truer claim.**

Two more things the numbers say and the frames confirm:

- **The domain still earns its place.** Yosemite chase: 18 m against 40 m moves
  1.92/255 and 9.2% of the pane, 18 against 8 moves 0.54 and 4.6% — so the band
  the seat asked for is the one that matters, and going finer buys little.
- **A grey palette has little chroma to take away.** The Stelvio's chase signal
  is the smallest of the four because `subRockC` DESATURATES, and a lichen pass
  already reads (0.31, 0.32, 0.307). What draws there is the structure, not the
  hue — which is why the frame changes visibly while the mean does not move
  far, and why a mean alone could not have judged this.

### What phase C does NOT do

- **The sward still runs the retired classifier.** That is phase D, and it is
  the reason `subWeightsOf` is kept whole rather than rewritten here.
- **No normal perturbation.** The layers move colour only; a scree apron has no
  relief of its own beyond what the tile's normal map already carries.
- **The per-fragment cost is unmeasured on a device.** The harness renders
  through SwiftShader at three frames a second and cannot say what a phone
  pays. Every line term is gated on the field (smooth) and on the footprint,
  and every isotropic term on `tdBand` at exactly its own threshold, so a
  fragment pays only for what it could show — but the next telemetry paste is
  the verification, and `?tdetail=flat` takes the cascade and the substrate out
  together.

### The corduroy is gone, and the bedding metric says the opposite

`devtools/bedding.mjs` at the Stelvio, the same spot and the same solved scale
(0.242 m a CSS pixel) the seat photographed, working tree against `REV=a9774a6`
— the deployed build, which is the one the seat reported the ribs on:

| | peak | at lag | background | above | rms |
|---|---|---|---|---|---|
| a9774a6, as deployed | 0.167 | **[0, −12] px = 2.9 m** | 0.024 | **0.143** | 6.02/255 |
| working tree | 0.218 | **[0, −32] px = 7.7 m** | 0.036 | **0.181** | 5.85/255 |

**The number went UP and the corduroy is gone.** The control's frame is an
unmistakable cross-hatch of parallel ribs over the whole slope; the tree's has
none at all — soft broad shading with faint downslope streaking in the
upper left. Read the lag and the two rows stop contradicting each other: the
control's peak is at **2.9 m**, which is the 1.2 m bed and the 3.2 m joint, and
the tree's is at **7.7 m**, which is nothing the bedding draws and is the scree
apron's own lobes (9 m across the fall line). The band the tool measures over,
12–40 px, holds both.

**SO THE METRIC HAS STOPPED ANSWERING THE QUESTION IT WAS BUILT FOR**, and that
is worth more than the number. It was written to ask "is this bedding geology
or corduroy", and it works by finding periodicity above background in a band —
which cannot distinguish a comb from a scree tongue, because both are
directional structure at the same scale. The file already records that a peak
alone cannot say "comb"; the correction is that peak-above-background cannot
either, once the term under test has legitimate directional structure of its
own. **The lag is the discriminator and must be quoted with the peak.**

**AND THE REASON THE COMB WENT IS THE FAMILY.** The field at that exact spot
reads exposure 0.52, debris 0.55, soil 0.18 — `loose` — so `fam.y`, the bedded
weight, is near zero and the bedding term barely draws at all. The old build
drew bedding on every rock fragment in the world regardless of what the ground
was. A scree slope showing no strata is not the filter working; it is the
CLASSIFICATION working, which is the layer below the filter and the one the
brief was actually about.

## Phase D: the sward and the flora read the field, and the classifier is gone

The brief's own next ask, verbatim: *if the shader says this location is 70%
grassy and 30% exposed soil, the sward seeder should read essentially the same
field. Then sward doesn't appear as arbitrary tufts pasted onto blank ground.*

It nearly did already. Phase C's own note recorded the sward running the
three-material classifier a SECOND time on the CPU — the same constants, the
same arithmetic, the noise ported from GLSL to float64, and a long paragraph
explaining why the port was honest. It was honest, and it was still a second
computation of the same thing, which is a thing that can drift. The seeder
reads the tile's own geomorphic field now — the same two textures the fragment
samples, as arrays — and runs `subExpressOf`, which is the fragment's own
`subExpress` on the shared constants.

Four things came off that, and the fourth cost nothing at all:

- **DENSITY THINS ON THE MINERAL SHARE, NOT ON THE GRASSY ONE.** The first cut
  multiplied density by `e.grass`, the same number the fragment tints with, on
  the reasoning that one field should give one answer. Measured at Camps Bay
  that took the mean density down **43%** — because `e.grass` is a share of the
  SURFACE and `GRASS_M2` is already a density per square metre, so multiplying
  them applies the cover class twice and halves every meadow in the world,
  which is the fault `SWARD_LUSH` exists to have fixed. `subGrassAllow` stays
  near 1 on soft ground and thins on the stone the cover class cannot see: the
  bedrock the fragment draws through the cover, and the coarse debris under it.
- **A BLADE FADES TOWARD THE GROUND IT STANDS IN**, through `subLayerTint` —
  `subCompose` term for term on the shared transforms, at the domain's own
  mean. A blade is a centimetre object standing on a tuft; what it needs is the
  material, not the material's own eighteen-metre speckle.
- **AND THE FLORA READS THE SAME FIELD.** `swardCtxAt` had one route to Cliff,
  the local slope — one number off one DEM pixel pair. The field's exposure is
  a landform read (slope over a third of a hectare, convexity at two scales,
  relief over two hundred metres, the cover's own word), and a bench halfway up
  a crag reads flat to the first and exposed to the second, and it is scree.
  Above `SUB_CLIFF_EX` the habitat is Cliff, which is what puts rocks and
  spires in the flora's draw and the scree palette on the flowers. Ruin and
  Water still outrank it: both are statements about a THING that is there.
- **THE BARE INTERRUPTIONS COST NOTHING, because the channel already meant
  this.** The sward field's fourth float is the BANK's mineral share and the
  vertex shader already reads it to turn a share of blades into stones
  (`sIsStone`), damped in the wind and never scaled up by range. "This ground
  is stony" is the same claim whether a river made it or a cliff did, so the
  substrate's own visible rock takes the MAXIMUM with it — not the sum, or a
  stony bank below a cliff would be twice as stony as either fact warrants —
  and a scree apron grows stones through its grass with no shader change.

**AND WHERE THERE IS NO FIELD THERE IS NO MODULATION**, exactly as the fragment
draws no substrate on a tile with none. `__swardsub().noField` counts those
texels: a sweep taken while that number is large is a sweep of ground the
substrate had no say over, and a correlation read off one is a reading of the
cover class alone. It was 0 on every run below.

### Measured

`devtools/sward-sub.mjs`, two boots with `swardsub` the only difference —
legitimate here only because the measurement is a CPU field over a fixture and
not pixels (`SPOT=` is a live pair, so read its build counts beside it):

| place | correlation off → on | mean density | thinned | mean rock | habitat cliff off → on |
|---|---|---|---|---|---|
| Camps Bay, fynbos | 0.119 → **0.278** | −13.5% | 1.0% | 0.059 | *(not sampled)* |
| Simon's Town | 0.669 → **0.713** | −12.9% | 3.2% | 0.077 | 0 → 0 |
| **Yosemite valley floor** | −0.102 → **−0.046** | **−0.8%** | **0.0%** | **0.003** | *(not sampled)* |
| **Stelvio, live** | **0.046 → 0.321** | **−39.9%** | **57.5%** | **0.291** | **597 → 818** of 1,444 |

**THE STELVIO IS THE ROW THE UNIT IS FOR** and the only one where the control
is near zero: the pass is uniform lichen and bare to the cover class, so the
one input the two fields already shared says nothing there, and 0.046 → 0.321
is the geomorphic field's contribution with nothing else in it. The sward thins
by 40% on a scree pass, which is what a scree pass should do to a meadow, and
**221 of 1,444 sampled points that the local slope called open ground are
called scree by the landform** — those get rocks, spires and the scree flower
palette.

**AND YOSEMITE IS THE CONTROL THAT MATTERS AS MUCH.** Its valley floor thins by
0.8% and the substrate calls 0.0% of the field mineral: the rule does not fire
on soft ground, which is the half of "it works" that a single strong result
cannot show. Note what the probe can and cannot see there — it walks texels
with density above zero, so on ground the cover class already calls bare there
is no grass to thin and nothing to correlate. The instrument samples where
grass grows, by construction.

### What went with it

`subWeightsOf`, `subGrassFactor`, `subTintOf`, `subMatOf`, `SUB_CLS_K`, `SubMat`
and `SubW` are deleted: the sward was their last reader. `SUB_MAT` stays,
because the terrain kernel inlines a copy of it and this is the source of record
that copy is held against. **`subDomainAt` stays and is now TEST API** — nothing
in the game calls it, and it exists because nothing here can run GLSL, so the
only way to assert the domain's mean, range and decorrelation is to run the same
construction in node. Its docstring says so, which is what stops the next
dead-code sweep deleting the only check the shader's noise has.

`devtools/substrate-field.test.mjs` lost the classifier's block and gained the
transforms': bedrock pulls the chroma out and cools, fines oxidise warm, grass
greens, **none of the three moves luminance by more than a fifth of a palette
step**, a zero share leaves the palette exactly alone, and `subGrainOf` answers
0 for snow and water and nothing else.

## Band D: the half-metre had two owners, and the cover class was one of them

The brief put this band last and was right to — *5-50 m coherent domains +
0.5-5 m material structure, not micro-detail first* — but the band was never
EMPTY. The detail cascade's third octave has drawn at 0.25 m since long before
any of this, keyed on the COVER class through `rough` and `grain`, so a metre
from the wheel a granite face and a ploughed field wore the same speckle. A
cover class is the one thing that cannot tell them apart.

**EACH LAYER HAS ITS OWN NOW.** `subRockMicro` is crystal speckle (a sharpened
noise, so it reads as flecks rather than a damp wash), hairline cracks square
to the dip and along it, and pitting where the family is broken; `subMantleMicro`
is crumb on fines and sparse thresholded chips on scree, so the two read as
different SURFACES and not as one noise at two gains.

- **THEY SIT INSIDE `subRockTone` AND `subMantleTone`, NOT BESIDE THEM**, and
  that is what makes the relief free: `subRelief` differentiates those two
  numbers and nothing else, so a crack recesses and a crystal stands proud with
  no second field, no second uniform and no second decision about where the
  light is. Measured: of the band's whole effect, **just over half is colour
  and just under half is the relief it buys** (0.767 of 1.642).
- **AND THE CASCADE'S THIRD OCTAVE STANDS DOWN WHERE THEY DRAW.** The
  stand-down is the MINERAL share, `(e.x + e.y) × uSubAmt`, because that is
  exactly how much of band D reaches the frame — the micro terms are weighted
  by those shares in the composite. So a scree apron hands the band over
  entirely and a meadow, where band D says almost nothing, keeps its octave
  exactly where it was. The 1 m and 4 m octaves are untouched: the substrate
  says nothing at those scales through a micro term.
- **WHICH FORCED THE FIELD TO BE READ ONCE, ABOVE BOTH CONSUMERS.** The shares
  used to be expressed inside the substrate block, below the cascade, because
  nothing above them needed to know. A second read would have been a second
  opinion about the same ground. `veg` moved up with it and is exactly
  unchanged by the move — a chroma ratio over its own luminance is invariant
  under the cascade's scalar multiply.
- **`uSubMic` (`__tdetail({micro})`, 0..2) IS THE DIAL**, scaling the micro
  terms and the stand-down together, so `micro 0` is the exact world before
  band D and the comparison is one settled boot. Every other measurement in
  this programme is held to that and this one had no way to meet it otherwise.

**Measured**, the Stelvio (`46.5302, 10.4547`), one settled world, NOON, clear.
**Quote the SEAT row and not the chart row**, for the reason under the table:
from the chase camera, scanned by rows, the near ground reads **2.587/255 over
20.13% of its band** against a floor of exactly 0.000 — the Stelvio chase floor
has been exactly zero since phase C, which is what makes that attribution
clean.

| near chart, 0.07 m an art pixel | mean /255 | pixels moved >3 |
|---|---|---|
| floor (the same setting, twice) | 0.002 / 0.000 | 0.02% / 0% |
| SIGNAL, micro 0 against 1 | 1.642 | 12.77% |
| …of which colour alone (relief 0) | 0.767 | 7.62% |
| micro 1 against 2 | 1.520 | 10.95% |

**AND THAT CHART ROW DID NOT REPRODUCE, which is the more useful finding.** The
same station on the tree after the producer rewrite read **0.077/255 over 0.6%**
— twenty times less — and scanned by rows the frame moves in its top three
hundred and NOWHERE below that. The top camera at ZOOM_MIN stands 22 m over a
truck that is parked on a mountain PASS, so most of that pane is carriageway and
shadow, and how much of it is ground depends on where the rig happened to stop.
A station whose reading depends on the parking is not a station. The chase band
is the honest one and is also the one a driver sees; the chart row is kept here
because a number that moved by twenty times between two trees is worth being
able to find again.

**THE HAIRLINES ARE NEARLY INVISIBLE AND THAT IS CORRECT.** They are 3 cm wide
on a 0.45 m spacing, and `subLine`'s own phase filter fades them out by about
0.13 m an art pixel — so at the near chart's 0.07 they are half a pixel and
already half gone. What actually carries band D is the isotropic grain, crumb
and chips at 0.11-0.28 m, which are one and a half to four pixels there. They
are right and quiet; widening them past what a crack is would be the opposite
of the band limit.

**AND THE TOOL'S CROP GOT IT WRONG TWICE, THE SAME WAY BOTH TIMES.** An exactly
**0.000** reading on all six pairs INCLUDING THE FLOOR is never a quiet term; it
is a crop of a region the renderer does not draw into, and a real floor has
dither in it. First it was the bottom fifth of the WINDOW — the world ends about
seventeen per cent above the window's foot here. Then it was
`document.querySelector('canvas')`, which returns whichever canvas is FIRST in
the DOM, and that is the HUD's rather than the renderer's: same symptom, second
cause, one more run spent. The band is SCANNED now — diff the two extreme legs
by forty-row strips and keep the rows that moved — which needs no knowledge of
the layout and reports a station where nothing moved as such.

## The producer, rebuilt: a cliff survives the downsample and the tile edge is gone

The review that prompted this said the renderer and the sward had moved on and
`buildSubstrateCells` had not, and it was exactly right. Five things, in the
order they were sequenced.

### 1. THE MEAN DESTROYED THE ONE FEATURE THE MODEL IS MOST WANTED FOR

The lattice is a 4x4 mean of the 256² raster — a 33 m cell — and that is right
for the SHAPE of a hill and fatal for a cliff. A narrow rib, an outcrop edge or
a natural escarpment has a very high NATIVE gradient and a moderate mean-to-mean
gradient across two cells, so the normal map drew the feature while the
substrate simultaneously decided it was not exposed rock, and the 18 m domain
noise was left to invent outcrops somewhere else entirely.

Two more numbers a cell fix it and **they cost no extra reads at all**: the
block's height RANGE and the steepest ADJACENT-PIXEL step inside it, both
accumulated in the pass that was already computing the mean. The window is
(step+1)² rather than step² so a cliff lying exactly on a block boundary is seen
from both sides of it.

Exposure is five geomorphic terms now — landform slope 0.34, peak native step
0.26, cell ruggedness 0.18, convexity 0.10, relief 0.12 — and the first three
are the correction.

**Measured**, a 25 m step over ONE raster pixel on otherwise flat ground:
**peak exposure 0.50 against the plain's 0.00.** (Point-sampled exactly on the
step it reads 0.33: `sampleSubstrate` is bilinear over a 33 m lattice, so a
reading taken on a one-pixel feature is the escarpment's cell averaged with the
plain's. That is the right answer for a point and the wrong instrument for
"does the model see this at all", which is why the check scans.)

### 2. THE MORPHOLOGY STOPPED AT THE TILE EDGE, AND THE WORKER ALREADY HAD THE FIX

Slope over 33 m, curvature over 100, a relief window over 200 and a debris walk
over 200 are all processes at a scale where a terrain tile's boundary is an
arbitrary line — and the field saw a PLATEAU past it: `at` clamped, and the
walk `break`ed.

The lattice is built **G = 6 cells wider on every side** and the central N² is
emitted. Six because the debris walk is the deepest reader. The gutter is
sampled through `S.sampleHeight`, which the worker has always had and the
builder never asked for; no halo is transported. **The raster's 256 samples
span the tile edge to edge on a w/255 pitch**, so extending pixel indices past
the range and mapping them through that same pitch is what makes the gutter
continuous with the interior by construction rather than by a fudge.

- **THE GUTTER IS SAMPLED COARSER, AND THAT IS A BUDGET DECISION SAID OUT
  LOUD.** A full (step+1)² window over the whole gutter is ~42,000 sampler calls
  a tile against ~15,000 for a 3x3, and what the gutter is FOR is the landform
  the interior's windows reach into, not its own micro-relief, which is emitted
  for no cell. Its 3x3 steps are half a cell apart, so the rise is scaled back
  to the pixel pitch the interior reports in — otherwise every tile edge would
  grow a false soft band.
- **The cover is read for the INTERIOR ONLY**, which is also why the guttered
  lattice costs no extra cover reads: after item 3 the gutter needs no cover at
  all.

**Measured**, the same synthetic world as two tiles, a cliff standing 40 m
inside the eastern neighbour: debris at tile A's eastern edge **0.00 blind,
0.52 with the neighbour**, and the seam itself agrees 0.04 against 0.06 where
the blind pair read 0.00 against 0.06. The blind column is the control and it
is the half that makes that a measurement.

**AND IT COST NOTHING.** The field-plus-colour phase at the Stelvio:
**113.51 ms a tile on the control, 111.13 and 115.24 on two runs of the fix** —
inside the run-to-run spread, on a pass the colour loop dominates.

### 3. VEGETATION WAS DECIDING WHETHER BEDROCK EXISTED

`exposure` carried `+ bare*0.20 - veg*0.25` and `debris` carried
`+ bare*0.20 - veg*0.12`, so WorldCover decided whether rock and scree existed
at all and a grass-covered cliff stopped being a cliff. The shader's own
comments already described the better model — the field derives from the
landform, vegetation decides what is VISIBLE — and the producer did not.

Both are gone. The cover class speaks downstream instead, where it always
partly did: soil, grassPot, and the expression.

**AND THE MOMENT IT LEFT, THE MISSING TERM SHOWED.** A 25 degree wooded
hillside came out expressing **0.264 of rock against bare ground's 0.306** — a
fourteen per cent difference where a canopy should hide most of the stone —
because the only vegetative concealment `subExpress` had was GRASS, through
`grassPot`, and a wood is not grass. `grassPot` on that hillside is 0.10,
under the 0.28 the grass layer starts at, so the wood expressed no cover at all.

`canopy` is the fix and it needed no new channel: both its inputs are already
arguments. `veg` is the palette's own greenness (a wood is green, a scree is
not) and `sd` says whether there is anything for that green to be rooted in, so
a green wash over a bare face — which is what the raster gives a lichen slope —
conceals nothing. **Measured: 0.306 bare against 0.158 wooded**, and never zero,
because a wood on rock is still on rock.

### 4. AND NOTHING RESTS ON A FACE

Caught by the Stelvio the moment exposure rose to match the landform: the
debris walk's own answer — *there is a face above me* — is loudest exactly ON
the face, so debris on a wall went 0.26 to 0.55, every cell on the pass crossed
the family rule's `loose` threshold, and **four rock families within a hundred
and fifty metres collapsed to rubble everywhere**. The bedding, the joint sets
and the massive mottle were written for precisely the surfaces that lost them.

Scree stands at its angle of repose, about 35 to 38 degrees; above that the
material is in transit and not in residence. `1 - smoothstep(0.75, 1.15, slope)`
is the whole fix.

**Measured**, the same six points at the Stelvio, control against fix:

| | control | fix |
|---|---|---|
| exposure at six points | 0.52 · 0.40 · 0.51 · 0.47 · 0.55 · 0.80 | **0.80 · 0.72 · 0.76 · 0.83 · 0.65 · 0.89** |
| families | loose, loose, massive, bedded, loose, fractured | loose, loose, loose, **fractured**, loose, **bedded** |
| expressed rock on the two walls | 0.41 · 0.60 | **0.61 · 0.70** |

…and on the authored cliff, **debris 0.00 on the face with 0.77 ten metres
below it**: a cliff is a source, the apron is the store.

### 5. AN ENGINEERED CUT FACE IS FRESH SUBSTRATE

`buildSubstrateCells` runs BEFORE `carveCorridors`, so the field describes the
hillside that was there and a road cut is a genuinely steep new face in the mesh
that the field goes on calling a grassy slope. These are close, screen-large
surfaces in chase view — the one place an anthropogenic term is worth more than
anything the original landform can say.

It rides the **SIGN of the bed slope**, not a fifth float. Nothing in the
fragment read that channel at all (only the probe), and a sign survives
interpolation gracefully: between a cut vertex and the natural ground at its toe
the value crosses zero, which is exactly the blend a toe wants, where an extra
attribute would have cost four bytes a vertex on every terrain tile in the world
for one of them. The fragment LIFTS what is latent (`x += k(1-x)`: rock 0.62,
mantle 0.34) and takes the turf with it (0.85), so a cut through a hillside
exposes that hillside's own rock and regolith rather than a generic scar.

**What it does not reach: the SWARD.** The seeder reads the field, and the field
knows nothing of the corridor, so grass still grows on a cut bank at the density
the cover class asked for. That wants the corridor in the field, not another
attribute.

### AND THE CASCADE'S PEDESTAL WAS NOT A CONTROL

`diffuseColor.rgb *= 0.955 + d * uTdAmt` — so `amount 0`, the control every
cascade-versus-substrate comparison is taken against, still multiplied the world
by 0.955 and carried a **4.5% luminance step** that no screenshot could separate
from the thing under test. `mix(1.0, 0.955 + d, uTdAmt)` fixes it: at 1 it is
identical, at 0 it is exactly the palette, at 4 it is a quadrupled amplitude
under a quadrupled pedestal. The fixed-pedestal reasoning is about the live
octave SUM and is untouched — a pedestal that shrank as octaves faded would lift
the far field by the whole cascade amplitude.

### The sward's mineral share was a RATIO, not an amount

`subGrassAllow` read `debris / (debris + soilDepth)` and thinned on it directly.
A ratio answers "is what mantle there is coarse or fine", and on ground with
almost no mantle at all — debris 0.05 over soil 0.01 — it answers 0.83. Measured
at Camps Bay, a fixture the substrate expresses **six per cent** of rock on was
losing **23.6%** of its sward to stones that are not there. Multiplying the ratio
by the debris itself asks the question this wants — how MUCH coarse material is
lying here — and leaves the ratio telling a scree apron from a silt flat.

### …and the sward now sees the 18 m expression, through the port

The field's lattice is 33 m; the fragment then shifts exposure and the mantle by
an 18 m domain noise, and THAT is what makes outcrop stand out of fill. So the
shader's rock islands are an 18 m pattern and the sward was reading the 33 m
field underneath them: the two agreed about the landform and could disagree
entirely about which patch of it is stone — which is the scale a tuft stands at,
and the comment claiming they cannot hold different opinions was not quite true.

`subCellAt` applies the same shift through `subDomainAt`, the float64 port that
already existed for the tests. **THIS IS THE INTERIM AND IS LABELLED AS ONE.**
The better answer is a shared intermediate expression field — roughly 30 m for
morphology, 8-15 m for surface fragmentation, true microstructure left
procedural in the fragment — so every consumer reads one answer at ecologically
meaningful scales rather than two implementations of one noise. That costs a
finer lattice and its upload and is its own unit; this closes the disagreement
that actually reaches the frame in the meantime.

### AND THE SWARD CORRELATION IS NOT A SCORE — READ IT AT THE RIGHT PLACE

`__swardsub`'s correlation is between the sward's density and
`subGrassAllow`, and at Camps Bay it reads NEGATIVE — −0.581 with the rule off
and −0.367 with it on. That is not a regression and it is not a win either;
it is the metric being asked a question the place cannot answer.

Camps Bay is 580 wood of 1,444 sampled habitats, the substrate expresses **six
per cent** of rock over the whole fixture and calls **2.3%** of it mineral
enough to thin — so `allow` is nearly constant near 0.91 while the density
varies by a factor of several between a meadow and a wood floor. A correlation
between a nearly-constant field and a strongly-varying one is a reading of the
residual and of the habitat mix, not of the rule. What it does say is the
DIRECTION: turning the rule on moves it toward zero, which is the thinning
partly cancelling an anti-correlation the cover class had put there.

The Stelvio is where the substrate has something to say, and there it reads
**−0.059 → +0.319**. Quote that one, with its `meanRock` beside it; a
correlation from a fixture whose `thinnedShare` is two per cent is a
measurement of nothing, exactly as `noField` being large would be.

**The whole sward picture after the producer rewrite**, both places, the
`swardsub` switch the only difference (two boots, which is legitimate because
this is a CPU field over deterministic ground and not pixels):

| | Stelvio, live | Camps Bay fixture |
|---|---|---|
| correlation off → on | **−0.059 → +0.319** | −0.577 → −0.367 |
| mean density | −44.5% | −12.9% |
| the substrate calls mineral enough to thin | **67.2%** | 2.3% |
| mean expressed rock | **0.470** | 0.058 |
| habitat cliff, off → on | 588 → **954** of 1,444 | 1 → 24 |

The Stelvio's expressed rock went 0.291 to 0.470 over the producer rewrite —
the high-resolution cliff evidence and the latent exposure, on a pass that
genuinely is rock — and with it 588 of its 1,444 sampled habitats became 954.
A 2,800 m alpine pass losing 44.5% of the sward the cover class asked for is
what an alpine pass should do to a meadow; whether it is too much is the seat's
call, and `swardsub=0` is the exact A/B for it.

### What is NOT done, with the reason

- **`moisture` IS AN ACCUMULATION POTENTIAL, NOT A WETNESS.** It is pure
  topography, so an arid depression in the Karoo and a Scottish hollow score the
  same, and everything downstream that reads it as dampness — the damp tone
  above all — inherits that. Multiplying it by the climate's own water is the
  honest correction and the builder closes over nothing and takes no climate, so
  it needs a new input threaded through the kernel and the worker. Named in the
  one place that writes it so the next reader argues with the claim.
- **Rock family is still procedural morphology standing in for lithology.** Not
  worth tuning hard until a regional geology seed exists to key it on.
- **The 4 m and 1 m octaves of the cascade are untouched** — and the
  measurement that was owed here has now been taken, so what follows is a
  finding rather than a plan.

### THE LOUD PART OF THE CASCADE IS THE 15 m MOTTLE, NOT THE 4 m OCTAVE

The review's objection was that a generic luminance hierarchy is still laid
under an increasingly specific material model, and that **at 4 m especially**
it occupies the same perceptual territory. Measured at the Stelvio, chase, over
the drawn ground, each octave turned off in turn on one settled world
(`band-d.mjs PHASE=cascade`):

| | mean /255 | pixels moved >3 |
|---|---|---|
| floor (the same setting, twice) | 0.237 | 0.39% |
| the 0.25 m octave alone | 0.417 | 0.57% |
| the 1 m octave alone | 0.715 | 4.98% |
| the 4 m octave alone | 0.557 | 4.67% |
| **the 15 m mottle alone** | **2.345** | **17.71%** |
| the whole cascade | 2.644 | 17.51% |
| **the whole substrate** | **4.092** | **31.03%** |

**The mottle is nine tenths of the cascade** (2.345 of 2.644) and the two
octaves the objection named are each about half a palette step, barely twice
the floor. So the thing competing with the material model is not the 4 m
octave: it is the two crossed sines at ±0.045 that this renderer has drawn
since before any of it existed, and which have no band limit worth the name
because their own fade reads `uMpp` — zero from the seat, the dead term this
file already records.

**Read the floor before the rows.** At 0.237 the 0.25 m octave's 0.417 is under
twice it and is not a measurement of anything; the mottle's 2.345 is ten times
it and is. And this is ONE PLACE — a bare alpine pass where the substrate has a
great deal to say (it moves 31% of the ground here). On vegetated ground the
balance will differ and the same tool answers it.

## The cover raster was drawing rectangles in the grass

Reported from the seat with a frame: hard rectilinear boundaries in the sward,
at a scale and a geometry that matched nothing in the blade lattice. The
diagnosis was read straight off the code and is exact.

```
density = (cv === null ? 0.35 : GRASS_M2[cv] ?? 0.3) * lift;
```

`cv` is `sampleCover(wx, wz)` — a NEAREST-NEIGHBOUR read of a z12 raster, about
30 m a pixel at mid latitude — and `GRASS_M2` has categorical jumps in it, grass
0.85 beside bare 0. So the density field said *this 30 m square is meadow, the
one next to it is nothing*, and the 8 m sward lattice, the field texture's
`LinearFilter` and every distance-band fade downstream could only turn that into
an 8–16 m ramp about a **geometrically straight** edge. The plateaus were
square because the raster is square.

**AND THE TERRAIN ALREADY KNEW BETTER.** `coverPaint` exists in main.ts for
precisely this reason — do not let raster pixels appear literally in the world —
and jitters its lookup so the ground COLOUR gets an organic boundary. The sward
bypassed it and read the raw class. So the colour transition under the grass was
irregular and the density transition was a rectangle laid over the top of it,
which is the discrepancy the frame shows.

**AND THE SUBSTRATE COULD NOT HAVE FIXED IT.** Phase D multiplies by
`subGrassAllow`, which ranges from 1 down toward 0.2 — a modifier on an already
categorical base. `0.85 × organic` is organic; `0 × organic` is still exactly
zero. No amount of smooth geology softens a zero, which is the same shape of
fault as the producer's: **categorical cover making a stronger statement than it
should**, met one layer over.

### The class becomes evidence, and the evidence is continuous

`client/sward-cover.ts` is pure and is the one place both readers now call — the
8 m density sweep and the shrub lattice were each doing their own `GRASS_M2`
lookup off their own `sampleCover`, which is two chances to disagree about where
the vegetation stops.

- **NINE TAPS OVER ONE COVER TEXEL'S FOOTPRINT**, weighted 2 at the centre and 1
  at each of eight ring points on two radii, so a boundary arrives as a ramp
  instead of a step.
- **TEN WEIGHT UNITS IS NOT AN ARBITRARY COUNT.** Over a binary boundary the
  evidence can only take as many values as there are weight units, so the step
  between adjacent levels is the class range over that count. Five taps gave six
  levels and a **0.13** jump between them — a staircase, not a ramp. Ten gives a
  worst step of 0.078.
- **EVERY TAP IS WARPED, THE CENTRE INCLUDED, AND THAT IS THE WHOLE POINT.** The
  first cut warped only the ring. Measured: the profile across a boundary DID
  vary with z and the half-way crossing **did not move a metre in ninety** —
  because the centre carries two weight units of eight, so its own flip is the
  largest jump in the ramp and it happens exactly on the raster's straight line.
  A soft ramp hung on a hard edge is still a hard edge. Warping the centre means
  the class at a point is not always the class the raster holds there, which is
  exactly what `coverPaint` has done for the ground colour for years.
- **THE WARP IS ON THE SAMPLE, NOT ON THE RESULT.** Displacing where each tap
  LOOKS bends the boundary; smoothing the answer afterwards only blurs a
  straight line into a straight gradient. This is also why it is not simply a
  blur of WorldCover: a blur costs the mapped boundaries — a field, a wood, a
  lake margin — that are genuinely sharp and genuinely there.
- **TWO CLASSES ARE SURFACES AND ARE NOT SOFTENED.** Water and snow are not
  points on a vegetation continuum with a classifier's threshold drawn through
  them; they are things lying on the ground whose edge the bank and shore rules
  own. A kernel that averaged across them grows grass out over a lake — in the
  arithmetic, a water texel with four grassy neighbours comes out at 0.57 of full
  meadow. The centre's own class vetoes first, and only then does the
  neighbourhood speak.
- **AND BARE IS NO LONGER MATHEMATICALLY IMPOSSIBLE GRASS.** WorldCover's
  "bare / sparse vegetation" is a categorical observation at raster scale and can
  hold isolated tufts, weeds, dry grass between rocks and anything under its own
  classification threshold. `bare` is 0.07 and `built` 0.08 — priors with floors
  — and the continuous fields downstream do the rest. Water and snow stay the
  two real zeroes.

**Measured in pure node** (`devtools/sward-cover.test.mjs`), a transect across an
authored grass/bare boundary in a 30 m raster:

| | old (one texel) | new (the neighbourhood) |
|---|---|---|
| transition width | **0.0 m** — it changes between two adjacent pixels | **29.0 m** |
| distinct levels across the transect | 2 | **8** |
| where the ramp crosses its half-way point, along 180 m of the SAME edge | the same x throughout | **spread 16.0 m, sd 4.5 m** |
| the meadow well inside it | 0.85 | 0.85 |
| the bare ground well past it | 0.07 | 0.07 |

The third row is the one that separates this from a blur: the boundary wanders
along its own length. And `strength 0` reproduces the old nearest-neighbour
table **to the bit**, which is what makes `?swardev=0` a control rather than an
opinion.

### …and it is a ONE-BOOT A/B, which nothing else about the sward has been

`__swardev(0|1)` re-sweeps the field synchronously. Every other sward switch is
read once at boot and has had to be measured across two boots under two skies —
and a claim about a hard EDGE is exactly the claim two boots blur, because they
differ in where every tile landed. This one does not.

**THE LIVE METRIC IS NOT PIXELS EITHER.** A categorical raster boundary is
**axis-aligned by construction**: WorldCover is a lat/lon grid and the sward
field is in local metres off the same projection, so a step inherited from the
raster runs exactly north-south or east-west while an ecological gradient points
wherever the ground does. `__swardedge` reports the density field's own gradient
directions as |cos 2θ| — 1 on an axis, 0 on a diagonal. **The baseline is not a
half:** a uniformly random direction averages 2/π ≈ 0.637, and that is the
number a field with no preference scores.

## An object-space normal map REPLACES the mesh's normal — for years, it did

The seat's verdict on the normal stack, and it is a composition fault rather
than a tuning one: *the raw DEM object-space normal REPLACES the final geometry
normal.* It does. three's `normal_fragment_maps` under
`USE_NORMALMAP_OBJECTSPACE` is one line —

```glsl
normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;  // overrides
```

— and `terrainMatFor` had declared every fine terrain tile object-space since
the hill's own normals shipped. So the hierarchy in force was:

```
the final carved, refined, channel-cut, hydro-banked mesh normal
    -> THROWN AWAY
-> the raw DEM's normal, flattened toward up by nscale (0.35)
-> the substrate's material relief on top
```

**Every bit of geometry work this file records was invisible to the LIGHTING.**
The corridor refinement, the cut faces and fill toes, the carved channels, the
bank fields: the raster those normals were generated from knows about none of
them, so the shading reverted to what the unmodified elevation data thought the
ground looked like, precisely where the most care had been taken. And
flattening a whole normal rather than a residual lit a real slope as though it
were a third as steep, which is most of the soft "normal-mapped sheet" quality
the terrain had close up. The comment that flattening replaced is its own
evidence: it recorded that taken RAW a sea cliff's normal went near-horizontal
and Chapman's rock faces turned black under a high sun, and eased the gradient
to stop it — a residual has nothing to go black, because the mesh already
carries the cliff and what is added is only what the mesh could not hold.

**THE MAP IS A RESIDUAL NOW**: `normalMapBytes` stores the fine gradient LESS
the gradient at the mesh's own cell size (`nrmCoarsePx`, the lattice unit in
raster pixels), clamped to ±`NRM_RES` in R and G with B at the encoding's own
zero. That difference is the ~8 m detail a 20-40 m lattice cannot express and
nothing else. `terrainFx` composes it by Mikkelsen's surface gradient —
`n' = normalize(N - (g - N·dot(N, g)))`, the projection of a world height
gradient into the tangent plane — which is the form that is correct on an
ALREADY TILTED surface; adding the raw vector over-rotates a steep face and
under-rotates a flat one.

Four things about the wiring, each of which is a compile or a regression:

- **THE CHUNK IS REPLACED, AND ONLY FOR THE MATERIAL THAT WANTS IT.**
  `terrainFx` takes a `dem` option and `terrainMatFor` is its only caller,
  for two reasons that each cost a link. Most callers of `terrainFx` have no
  normal map at all (the leaves, the stones, the grass, the baked skeletons)
  and the chunk's `#include` line is in every Lambert shader whether or not the
  material uses it — so an unconditional replace injects a read of an
  undeclared `normalMap` into four materials, which then fail to link SILENTLY
  and draw as a flat-shaded world. And `sphereNormal` replaces the same chunk
  for the far shell's two-channel decode: it runs AFTER `terrainFx` in the
  `onBeforeCompile` chain, so a replace here consumes its needle and leaves the
  whole shell unlit by its own map, with the ring still drawing.
- **IT IS SAMPLED AT `vNormalMapUv`, NOT AT A WORLD BOX.** three sampled it
  there, the bake's reversed rows were chosen to agree with it, and both
  lattices emit it (the plain one as `ix/SEG, 1 - iz/SEG`; the refined one from
  the position within the tile, which is the same mapping). The first cut
  derived it from `uSubBox` and would have tied the DEM detail to the SUBSTRATE
  field's arrival — a tile whose field is not yet committed has a zero box, and
  every one of them would have been lit by its lattice alone until it was.
- **`normalMapType` IS VESTIGIAL AND IS KEPT FOR THE CHEAPER PATH.** Neither
  branch of the chunk runs any more, so what the flag selects is no longer how
  the map is read; what it still decides is what the rest of the shader
  compiles. Object-space declares `vNormalMapUv` and nothing else, where
  tangent-space ALSO builds a TBN frame in `normal_fragment_begin` — three
  screen derivatives and a Gram-Schmidt per fragment — for a `tbn` this
  material never reads. The far material has carried the same vestigial
  declaration, for the same reason, since `sphereNormal` shipped.
- **AND `nrmScale` LEFT THE STORE WITH ITS LAST READER.** The strength is a
  uniform now, so the kernel's copy was a constant nobody reads — the exact
  thing this file keeps warning about — and it is gone from `TerrainStore`, the
  worker job and all four construction sites.

### `?nscale=0` WAS NEVER "NORMALS OFF", AND ANYTHING TUNED ON IT WAS TUNED WRONG

The seat named this outright and it is the more important half. Both mesh sites
read `NRM_SCALE > 0 ? terrainMatFor(t, key) : terrainMat` — so at zero the tile
was swapped onto the SHARED material, and `terrainMat` carries
`normalTex(256, 9001, 4, 9, 70)` at scale 0.32: a generic procedural normal map
tiled every seventy metres. The A/B everyone reached for was therefore
**repeating procedural normal against DEM normal**, not flat against
normal-mapped terrain, and it moved a great deal of the frame for reasons that
had nothing to do with the dial's name.

Both sites take `terrainMatFor` unconditionally now and `uNrmK` is the
strength, live on the dial rack (`__tdetail({nrm})`, `?nscale=`), so the
comparison is one settled world with one uniform flipped — the standard every
other measurement in this programme is held to.

**THE FAR SHELL STILL SWAPS, AND IT IS THE SAME TRAP ONE LAYER OUT.**
`NRM_SCALE > 0 ? farMatFor(...) : farMat` survives, so at `nscale=0` a shell
tile falls onto `farMat` — which carries the FINE terrain's tangent-space
procedural map, this file having already recorded that a tile wearing it is
lit by a vignette beside neighbours lit by the sphere. That is out of this
unit's scope (the shell's map is a genuine object-space normal decoded by
`sphereNormal`, not a residual) and it means **a reading of the SHELL taken at
`nscale=0` is still a comparison of two normal maps.** Do not quote one.

**AND THE PROBE REPORTS THE AUTHORITY, NOT THE NUMBER.** `__tdetail().nrm`
carries `k` beside `tiles` and `own` — how many drawn terrain tiles wear their
OWN per-tile material against how many there are — because the claim this rests
on is not about a strength, it is that the MATERIAL no longer changes with the
dial, and a pixel measurement cannot witness that: a swap and a strength change
both move pixels. Same fault as `__cam` reporting the zoom and not the
stand-off, and `__tdetail().mat` running a rule nothing ran.

### Colour and relief are separate returns now, and one of them has no shape

The relief pass differentiates a scalar and bends the normal by its screen
gradient, and `subRockTone` / `subMantleTone` each returned ONE number — so
every term they carried claimed to be a height. Most are not:

- the rock's **70 m and 26 m broad massing** is the tonal difference between
  one face of an outcrop and the next, colour at a scale the mesh already
  carries as actual geometry; summed into the relief it lit a hillside as
  though it were corrugated at seventy metres, on top of the hillside the mesh
  had just drawn;
- a **massive face's metre-scale mottle** is a weathering stain, not a form;
- the mantle's **fines' tonal regions** are damp and dry, fine and coarse;
- and **DAMP GROUND IS NOT A SHAPE** — `- mo * dampTone` darkens a hollow, and
  in the relief it bent the normal along the wetness gradient, lighting a damp
  patch as a dent in ground that is perfectly flat.

Both builders take an `out float relief` and accumulate it separately: the
bedding traces, the joint sets, the clasts, the apron lobes, the rills and band
D, and nothing tonal. The colour is unchanged — every term still reaches the
return value — and only the normal stops reading the ones that have no height.
`substrate-field.test.mjs` holds it with a needle that no tonal variable may
appear in the `subRelief` expression, checked against the form it replaces.

### The normal gets a more conservative ruler than the albedo

`tdPx` is the equal-area footprint — the geometric mean of `fwidth` — and its
own note records why: the max confines every fine octave to a few metres around
the camera and the cascade does visibly nothing, while the geometric mean keeps
detail an order of magnitude further out at the cost of mild along-ray
aliasing, *which this palette's dither hides better than a smooth renderer
would*. That trade is right for COLOUR and wrong for a lighting normal: **an
aliased albedo stipples the dither, an aliased normal FLICKERS**, because the
shading it drives is a nonlinear function of it and the sun moves.

`tdPxN` is `mix(sqrt(dx*dy), max(dx, dy), 0.5)` — half way to the worst
direction, not at it, for exactly the reason `tdPx` is not the max — and
`subNKeep(px, pxN, λ)` is `tdBand(pxN, λ)` written as a factor on the relief's
share of a term whose band limit is already stated once. So a trace that has
stopped catching the light is still a trace, and one that catches it at random
is gone first. The bedding and joints are exempt: `subLine` already filters on
its own phase's `fwidth`, which is direction-aware by construction.

### …and the 1 m octave thins where the material has its own metre

Band D's handover is total (`subMicro`, the mineral share): the material's
crystal grain, crumb and chips describe the half-metre better than a cover
class can. The metre is a weaker case and takes a weaker rule — `SUB_OCT_M`,
0.55 — because the substrate DOES speak there (clasts at 0.9-1.4 m, rills at
1.8) but only where there is debris or scree to carry them, where band D draws
on every mineral surface there is. A named constant, so the next argument is
with a number.

### Measured

`devtools/normal-ab.mjs`, the Stelvio, one settled world, the dial flipped
live, cropped to the near field, interleaved so the repeats give the floor at
the same temporal separation as the cross pairs. **The first line is the
measurement; the rest are numbers.**

```
materials: k=1 own 25/25 · k=0 own 25/25 · k=1 own 25/25
```

| | floor | the residual (0 against 1) | the old 0.35 | twice it |
|---|---|---|---|---|
| chase, item 1 only | 0.30-0.55 /255 · 1.7-3.0% | **1.214 · 9.74%** | 0.956 · 6.94% | 3.686 · 20.47% |
| top, item 1 only | 0.66-1.74 · 2-11% | **2.205 · 16.75%** | 0.966 · 5.47% | 3.148 · 21.95% |
| chase, all four | 0.18-0.27 · 0.9-1.3% | **0.419 · 3.19%** | 0.307 · 1.97% | 0.939 · 6.69% |
| top, all four | 0.18-1.19 · 1.1-8.4% | **1.888 · 15.73%** | 0.492 · 4.67% | 2.25 · 18.89% |

**THE TWO PAIRS ARE DIFFERENT PARKINGS AND MUST NOT BE SUBTRACTED.** The
Stelvio is a live spot, the rig rolls to a stop wherever it stops, and the
chase pane is mostly carriageway or mostly ground depending on where that was —
the same fault the band D near-chart station was retired for. The tell is that
in the second pair EVERYTHING fell by about the same factor, the floor
included; a real change in the term would have moved the signal and left the
floor alone. What the second run establishes is that the shader still LINKS
(0 page errors, 0 harness errors, and the harness sniffs GLSL into the same
list) and that the material claim still holds, not a before-and-after.

**AND THE RELIEF SPLIT CANNOT BE A/B'd BY A UNIFORM AT ALL**, which is why no
number is offered for it: it is a code path, not a dial, and a two-boot
comparison at a live spot is what the paragraph above is about. A fixture would
be the deterministic way to ask, and none of the fixtures is bare ground —
which is the standing gap in the set that the whole substrate programme keeps
meeting.

**WHAT THESE NUMBERS ARE NOT.** They are the residual's own contribution at a
spot, and they say nothing about the composition fault this unit is about,
because the old behaviour cannot be reached by a uniform — it is a different
shader, and a tool that flips `uNrmK` on the old revision flips a uniform that
does not exist there. That the mesh's geometry now reaches the lighting is
CODE READING, and it is the kind this file already accepts as sufficient: the
interpolated `normal` is the base of the composition where it used to be the
left-hand side of an assignment, and the chunk that overwrote it is gone from
this material's shader. The measurement's job was the other claim — that the
dial no longer swaps the material — and that is the line above the table.

**The Stelvio chase floor is no longer exactly zero** (phase C measured 0.000
there) and it is not the same number twice. It is the substrate's own relief
re-weaving the dither as the lighting normal moves between legs, so it scales
with however much ground the pane happens to hold — which is the parking
caveat above, seen from the other side. The signal clears it by two to four
times in the mean and by two to six in pixels on both runs. Quote the floor
beside the signal, always: a near-field term measured without one is a number
with no scale, and one measured against a floor from a different boot is worse
than no number at all.

## The HUD's dial was drawn a pixel at a time, and the frame diff could not see the fix

`drawHud` reached **11.0% of a device session at 6.7 ms a call**, drawing on
1,383 of 1,566 frames — third after the gap and `terrainApply`. Its own note
records 1.9 ms when the half-rate gate was written and 4.5 when the gate was
widened to 40 ms, so **the gate is doing what it was designed to do and the
design's assumption — a cheap HUD — is what failed.**

**THE SPLIT IS AT THE FUNCTION'S OWN SECTION HEADERS**, matched by their
comment text so a moved line cannot shift a lap onto its neighbour, with
`other` as the residual so the rows sum to the whole. Thirteen laps, a
subtraction and a property write each — under the noise of what they measure.
`devtools/hud-split.mjs` reads them in both cameras, and keeps drawing **ON**,
unlike every other CPU measurement in this file: `nodraw` skips the HUD
entirely and would report one that never ran.

| at-paris-west | chase 3.11 ms/call | top 4.58 |
|---|---|---|
| `riggauge` | **1.238 (40%)** | **1.325 (29%)** |
| `where` | **1.046 (34%)** | **1.100 (24%)** |
| `poi` | 0.077 | 0.675 |
| `scale` | 0.015 | 0.662 |
| `dockview` · `compass` · `clock` | 0.346 · 0.262 · 0.108 | 0.313 · 0.287 · 0.138 |

**READ THE STREAMING-DEPENDENT ROWS AS A FLOOR, NOT A FIGURE.** With drawing
on, the harness paints at three frames a second and the world build is paced
by the frame loop, so `at-paris-west` reached 2,344 ways of 5,663 in ten
minutes and never settled. `poi`, `places`, `way` and `tiledbg` all scale with
what has arrived and are therefore under-read. `riggauge` and `where` scale
with neither, which is why those two are quotable here — and they are 74% of
the chase HUD between them.

**AND THE FIRST RUN SETTLED ON 269 ROAD CELLS.** Two quiet polls passed at
39 s on a fixture that settles at 3,138, and the four streaming rows duly read
about zero. Four quiet polls, `seenWays` in the signal, a six-minute budget
and the counts printed beside the verdict — because "settled" is a word and
the counts are the evidence. Third time this file has recorded that mistake.

### …and inside `riggauge`, 41 string-parsed colours and fifty 1x1 rects

The dial's open-arc bezel is 41 ticks. Each assigns `fillStyle` from a STRING
— parsed on every assignment — and each fills one or two **1x1 rects**: about
fifty draw calls and forty-one colour parses a frame, for a ring whose
geometry depends on `DR`, `cx` and `cy` and therefore changes only when the
HUD is laid out. Beside it the rev arc recomputed **54 sines and cosines** a
frame for 54 positions that never move.

Baked once into an offscreen canvas and blitted; the rev offsets cached on the
same key. `?hudbake=0` is the rollback and the A/B.

**THE ROUNDING IS WHY THE GEOMETRY IS EXACT.** The original computes
`round(cx + cos(a) * r)`; the bake computes `round(o + cos(a) * r)` at its own
centre and blits at `cx - o`. Those agree exactly for an INTEGER offset —
`round(c + d) === c + round(d)` — and `cx = (HW - pad) - DR`, `cy`, `o` are all
integers, being HUD pixels. Baked at `hudDpr` and blitted at HUD-pixel size
under the same transform with smoothing already off: 1:1, not a resample.

### THE FRAME DIFF WAS THE WRONG INSTRUMENT, TWICE OVER

A draw-call cut that changes the picture is a regression with a good excuse,
so the bake was checked against the per-frame bezel — and the check was wrong
before the bake was.

- **It had no floor.** It reported mean 1.229/255 with a worst of 150.5 over
  the dial's corner and that read as "the bake changes the picture". A worst
  of 150 is a GLYPH FLIPPING: the rig cluster carries the odometer, two boots
  have driven different distances, and the crop differs before the bezel is
  considered. **A diff with no same-setting control is a number with no
  scale** — this file states that for milliseconds and it is just as true of
  pixels.
- **And with a floor it still could not resolve the question.** Same build
  booted twice: mean **0.408**, worst 145.1, 1.51% moved. Baked against
  per-frame: mean **1.192**, worst 150.5, 4.89%. Three times the floor — but
  the floor is ONE PAIR of a quantity dominated by whether two boots' odometers
  happen to agree, and the thing being looked for turns out to be sixteen
  channels at one unit. **A frame diff cannot see a 1/255 difference under an
  odometer that differs between boots**, and no number of re-runs would have
  changed that.

**SO THE RULE WAS TESTED INSTEAD OF THE FRAME** (`devtools/hud-bake.test.mjs`:
no world, no WebGL, a canvas and the two loops, five seconds):

| the ring, drawn straight against baked-and-blitted | channels differing | worst |
|---|---|---|
| over **nothing** | **0** | 0/255 |
| over an **opaque ground** | **16** of 50,176 | **1/255** |

Exact where there is no second blend — which is what says the geometry is
right — and within a single rounding where there is. **DOUBLE-QUANTISED
ALPHA** is the mechanism and it is not avoidable: a 0.16 tick blended once
onto the HUD against the same tick blended into an 8-bit buffer and blended
again. *Source-over is associative in the reals and is not in a byte.* One
unit against a palette step of ~18 is the last bit of an 8-bit buffer, so the
bake ships — and the test carries the bar (exact over nothing, at most one
unit and a couple of hundred channels over a ground) rather than a bare
"zero", because a bare zero is unachievable and a test that demands it would
be turned off.

**The general lesson, and it is the session's third of this shape:** when a
claim is about a RULE, test the rule. A frame is where the rule's consequences
land, and it carries everything else that moved.

### …and the device's own split, which says a mean can hide the whole fault

First dump with the split shipped (Yosemite, 238 s, TOP camera, build
da8434771d35):

```
hud 4991 draws · 2.86 ms/call · tiledbg 0.96 · where 0.71 · riggauge 0.69
    · dockview 0.21 · compass 0.16 · clock 0.07 · other 0.00
```

**AND THE SLOW-FRAME LOG SAYS drawHud IS 13 TO 17 ms** — the second line of
twenty-three of the last twenty-four slow frames, against that 2.86 mean and a
53 ms max. Both numbers are true and they describe different frames: the
section is cheap in a settled frame and five times that in one that drops, and
**a session mean cannot show it.** Every lap keeps its own max now and the row
prints `mean/max` a section, because the rule the top-level profiler already
states for its own rows — a small total with a large slow-frame share is the
thing causing drops — applies inside a phase exactly as it does between them.

**`tiledbg` topping that list is the tile-debug OVERLAY**, which this session
had switched on. It is a debug surface and its cost is the player's choice; it
is named here so the next reader does not take it for a HUD the game always
draws.

**Still open on the HUD:** `where` at 1.05 ms — 99 lines calling
`worldStatus()`, `wayAt()` and `surveyHere()` every frame, plus six
`textEdgeS` draws, for text that changes about once a second. Lookups against
drawing, and the substitution trick prices it the same way it priced
`groundAt`.

## TWO DUMPS AT DIFFERENT PLACES ARE NOT AN A/B

The dump after the redrape cut shipped reads, on its face, like a triumph:

```
redrape 136 calls · walk 0.1 normals 0.0 ms/call · max 1 · groundAt 552/call
  · bound 136/136 · near 1 inBox 1 touched 0 · verts 771 moved 110
post split ms/build  reseat 0.0 redrape 0.1 hydro 1.2 batter 0.1 · post max 8
terrainApply  547 ms total · 136 calls · 4.0 mean · 0.2% of session
```

against the previous dump's `redrape 45.6` and `terrainApply 68.6`. **It says
nothing of the kind.** That dump was Paris in chase with 31,403 ways and
28,902 vertices walked a call; this one is Yosemite in the top camera with 149
ways and **771** — one thirty-seventh of the work. A redrape that costs 0.1 ms
where there is nothing to redrape is not a cut, it is an empty scene.

What the dump DOES establish, and it is worth having: **`bound 136/136`** —
the tile bind never once refused on a real device, so the `heightTiles.get(key)
!== t` guard is not silently sending every redrape down the fallback. And
`groundAt 552/call` gives the next dense dump a per-call cost to divide by.

**The general rule this file needs and did not have: a device dump is a
measurement of a PLACE.** The telemetry carries the spot in its first line and
the switches in its `look` row precisely so two dumps can be compared — and
neither is enough on its own, because the scene is the other half. Compare a
dump against a dump of the SAME place, camera and switches, or against nothing.
A cut measured in the harness on `at-paris-west` and then "confirmed" by a
dump from a granite valley is a fabricated witness with a real number in it.

## The wet hydro build cannot be bounded to the shore band — the band IS the tile

A device dump from Yosemite (255 s, 20.4 fps, 29.7% of frames slow) put
`hydroBuild` at **75.7 ms a build, 145 builds, 10% of all slow-frame time and
top-of-frame in 112 frames** — the largest IDENTIFIED cost in the session, and
the one this file already had a plan for: run the full-grid passes only where
the water can reach and write the outside the constants the dry path writes.
That plan was never taken because "the bound has to be shown not to move those
answers, which is a measurement and not a reading". This is the measurement,
and **it says not to write it.**

**THE QUESTION IS THE SHAPE OF THE WET SET, NOT ITS SIZE**, and the two are
not the same question at all. 296 of 38,309 texels wet is 0.77%, which sounds
like a build that is 99% overhead — and if those texels are a river crossing
the tile corner to corner, its BOUNDING BOX is the tile and a rect bound
collects nothing. So all three candidate bounds are counted before any is
written (`__hydrobound(true)`, `HYDRO_BUILD_PROF`'s `boundRect/Rows/Band`,
printed by `hydro-phases.mjs`), as the share of the grid each would leave
still to run:

| bound | leaves | what it is |
|---|---|---|
| **rect** | **0.789** | the wet bbox grown by the shore band |
| **rows** | **0.475** | per-row spans grown by the same — a diagonal defeats the rect and not this |
| **band** | **0.443** | the floor: the texels actually within the band, which only a distance transform finds |

**EVEN A PERFECT BOUND LEAVES 44% OF THE GRID**, and the reason is a constant
nobody was looking at: `shoreDistanceLimitM` is **180 m**, a flowing tile's
texel is ~9.4 m, so the reach is **19 texels in every direction** — a band 39
texels wide around a river that crosses a 280² grid. The bound is not defeated
by the river being thin; it is defeated by the band being thick.

**What the cut is actually worth**, from the device's own split (the phases
run only on the 121 wet builds of 145, so they scale by 145/121 for a wet one):
fill 15.6 + majority 7.6 + shore 11.4 + pack 9.0 = **43.6 ms of an 88.2 ms wet
build, 49%** — and 56% of that is **24 ms, a wet build from 88 to 64**. A 26%
cut on the worst frames, bought by bounding `fill`, which extends a body's
level BEYOND the visible mask on purpose and which `sampleRestingSurface`,
`sampleBankField` and `drawnHydroAt` read anywhere in the tile. That is a poor
trade, and the doctrine's own framing of this cut — which implied most of the
build — was wrong by about half.

**THE RESOLUTION IS THE BIGGER LEVER AND ALWAYS WAS.** A wet build is 78,400
texels against a dry one's 19,600: `flowingFieldResolution` is a **4× grid**,
chosen by "any flowing observation" rather than by the covered share, and this
file already records that ("the dial is right where the water IS the tile and
wrong where it is a thread through one"). Every full-grid pass scales with it,
so halving it quarters all of them — 88 ms toward 25-30 — where the bound
reaches 64, and it moves no sampler's contract: a coarser field is a question
about accuracy, not about whether a reader's answer is still defined. That is
where this task points now.

**Two things about the instrument, both of which matter more than the number.**

- **IT IS OFF IN THE GAME, AND MEASURED PROVING IT.** The counting is three
  passes over the grid — the same order as the passes it sizes — so a build
  measured with it on inflates the very total the saving is quoted against.
  Its time is excluded from the laps (`tMark` is re-armed) but NOT from the
  build's wall total, so it lands in `other`, and the control is the pair:
  with the probe on, `other` is **22.9 ms and the largest row in the table**,
  and a wet build reads 233.4 ms; with `BOUND=0`, `other` is **0.1 ms** and
  the wet build 151.9. A residual that large is the instrument, and an
  instrument that could not be switched off would have been reported as a
  mystery phase.
- **THE SHARES ARE THE MERCED'S, NOT A LAW.** A tile whose water is a compact
  body — a pond, a lake corner, a reservoir head — bounds beautifully and the
  rect would collect most of it. What Yosemite has is a river crossing the
  tile, which is the common case for the layer and the case a bound must
  survive. Run the probe at the place before believing either answer.


## A redrape's cost is `groundAt`, not the scan — and indexing the scan is slower

The Paris dump (403 s wall, but **83.7 s active and 318 hidden** — read the
visibility line before any per-frame number) puts `terrainApply` at **24.3 ms a
build, 518 ms worst, 22% of all slow-frame time**, and the post split names
`redrape` as 14.9 of those 24. A phase split that stops there cannot say which
of the two quite different things inside is expensive, so `redrapeProf` splits
it into the vertex WALK and the normals RECOMPUTE, with counts for how much was
scanned to move how little. Measured on `at-paris-west` (5,663 ways):

```
redrape 50 calls · walk 17.7 normals 1.3 ms/call · max 171
  · near 10 inBox 7 touched 4 · verts 15575 moved 3490
```

**THE RECOMPUTE IS 7% OF IT.** The note by `redrape` guessed the cost was
re-reading every vertex to recompute normals over a whole ribbon for the metre
of it inside one tile; `computeVertexNormals` and `computeBoundingSphere`
together are **1.3 ms against the walk's 17.7**. That guess is now measured
wrong and the comment says so.

**AND INDEXING THE WALK MADE IT SLOWER.** The obvious cut — bucket each drape's
seated vertices by the same cell grid the drape index already uses, so a
rebuild walks only the vertices standing in that tile — was written, audited
and reverted. Same fixture, same build, the index the only difference:

| | the plain walk | indexed |
|---|---|---|
| vertices walked a call | 15,575 | **7,629** |
| walk ms a call | **17.7** | **21.2** |
| vertices moved a call | 3,490 | 3,537 |

**It halves the scan and costs 20% more.** The reason is in the third row: the
vertices the index removes are the CHEAP ones — two attribute reads and a box
test that fails — while the count that does not move is the in-tile vertices,
each of which pays a `groundAt`. So the walk is ~5 µs a MOVED vertex and the
index adds a Map lookup a cell, an Int32Array indirection a vertex, and a
closure call the tight loop did not have. **A scan is not a cost; the work
inside it is.**

The correctness half did pass, for what it is worth to whoever tries this
again: an audit that ran the full walk beside the indexed one over 328 drapes
found **0 vertices missed**, so the index was right and simply not worth
having.

**AND THE DEVICE SAID IT HARDER.** The dump on the deployed instrument
(Paris, 84 s active, build 294eb1437bbd): `terrainApply` **68.6 ms a build over
160 builds — 11.0 s of an 83.6 s session**, post split `reseat 6.8 · redrape
45.6 · batter 13.7`, and within the redrape **walk 44.7 ms against normals
0.8** — the recompute is **1.8%** there against 7% here. 28,902 vertices
scanned to move 5,816, and one build's walk alone hit **431 ms**. The device is
not simply slower: it walks 1.9x the vertices at 1.4x the cost each.

### …and `groundAt` splits almost exactly in half, which decides the cut

`performance.now()` cannot price a call of a microsecond or two — the clock is
coarsened on iOS and half a million reads would cost more than the thing being
read — so the measurement is a SUBSTITUTION with its own control
(`devtools/redrape-ga.mjs`, `__gaprobe`): every vertex that reaches `groundAt`
calls it a SECOND time and throws the answer away. Same vertices walked, same
ones moved, counters identical on every leg — so the difference between legs IS
the cost of those calls. Interleaved off·whole·off·locate, four off legs giving
the floor. On `at-paris-west`, settled, 2,492 calls a redrape:

| | ms a call | ns a call | of the walk |
|---|---|---|---|
| the walk itself | 2.09 | — | — |
| **floor** (off against off) | **0.32** | — | — |
| a whole `groundAt` | **1.63** | 654 | **78%** |
| …its LOCATE half | **0.80** | 322 | **38%** |
| …its SOLVE half | **0.83** | 332 | **40%** |

Both halves clear the floor by two and a half and five times. **`locate` is the
`tileAt` arithmetic, the `${tx}/${ty}`, the dirty Set and the two Maps; `solve`
is the barycentric walk over the cell's triangles** at nine-plus
`BufferAttribute` reads apiece. `meshSurfaceAt` takes a `locateOnly` parameter
for exactly this and nothing in the game passes it — the point is to price the
halves against the SHIPPED function rather than against a copy that drifts.

**SO A TILE-AWARE `groundAt` IS WORTH 38% OF THE WALK AND NOT A PERCENT MORE.**
`redrape` already holds `t`, and has already proved the vertex is inside its
box, so the whole locate chain is redundant — and it can be resolved ONCE per
redrape rather than per vertex, because the walk is synchronous and neither
`terrainDirty` nor `terrainMeshes` can change inside it. On the device's own
numbers that is ~17 ms of a 45.6 ms redrape and ~3% of the session. The solve
half is untouchable this way: the triangle is the answer.

**A NULL RESULT THAT MISLED ME, RECORDED BECAUSE THE INFERENCE WAS WRONG.**
Before the split was measured, the key was memoised on the tile indices — a
redrape's 2,492 string builds become one — and it moved the walk 2.01 to 2.16
ms against a floor of 0.49: nothing, in the direction of worse. Reverted. From
that null I concluded "the lookup is not the cost, it must be the solve", and
that was FALSE: the memo removes one line of the locate chain (the allocation,
and the hash the Map lookups then recompute) and leaves `tileAt`, the dirty
Set, both Maps, `segOf` and `cellTrisOf` running. The direct measurement says
the chain it left standing is 322 ns. **A null from removing part of a thing is
not evidence about the whole of it** — and the general form is one this file
already states about probes: measure the thing you mean to cut, not a
neighbour of it.

Failing all of that, `reseat` (6.8 ms a build on the device, never suspected)
and `batter` (13.7) are the rest of a 68 ms post, and spreading all three
across frames remains the standing alternative to making any one of them
cleverer.

`redrapeProf` and the telemetry's `redrape` row are what is kept. The index is
not, and this section is here so it is not rediscovered as an idea.

### The renderer was centred on a vehicle nobody could see

Reported from the seat, with the sequencing stated: introduce one canonical
`renderFocusXZ()` and use it consistently in tree and EZ selection, impostor
selection, GPU sward, CPU sward, shrubs and shadow centring; THEN make streaming
cover the union of rig and render focus; and only after that evolve tree
admission from a focus-centred circle into frustum and projected-size admission.
Every claim in the report was checked against the source before anything moved,
and every one was right.

**THREE INTERESTS, AND THEY ARE NOT THE SAME POINT.** SIMULATION follows the
RIG — collision, traction, the local physics, the vehicle's own audio — and must
not move because a drone took off. RENDER follows THE GROUND THE CAMERA IS
LOOKING AT. DATA is the union. Before this the renderer had no name for the
second of those, so every expensive witness to what is on screen read `state`:
fly the drone two kilometres out and the 2.4M-triangle tree budget stayed spent
around a truck nobody can see while the drone flew into ground the renderer had
decided was empty; pan the chart and the same thing happened sideways.

**AND IT IS NOT `camera.position`.** The top camera stands hundreds of metres
back at its 70° tilt and the drone's trailing lens sits 13 m behind the
aircraft, so the camera's own x/z is the wrong point in both. What the player is
looking AT is the authority, and the top camera already computes exactly that.

**THE CLEAREST BUG IT CLOSES was a two-word difference.** The top camera targets
`viewX() + panX` and the GPU sward read `state.x + panX` — the same point only
while the drone is on the ground. With the drone up and the chart open the
camera followed the aircraft and the grass grew round the truck, hundreds of
metres apart, with nothing on the glass to say so.

**THE DRONE'S FOCUS IS SOLVED, NOT PICKED.** Both its cameras aim at a FIXED
DEPRESSION, measured out of the source: the nose view sits on the aircraft and
aims 30 m ahead and 13 down (23.4°); the trailing view sits 13 back and 6.5 up
and aims 26 ahead and 7 down, which is 39 ahead and 13.5 down from the lens
(19.1°). So the ground the screen's centre lands on leads the aircraft by its
height above ground times the cotangent of that angle — **2.31× from the nose,
2.89× from the trailing view** — and it keeps working as the altitude changes,
which a fixed lead would not. Capped at 45% of the draw range, or at three
hundred metres up the geometry asks for eight hundred metres of lead and carries
the ring off the ground under the aircraft entirely.

**CHASE AND CAB STAY ON THE RIG, deliberately.** The camera's offsets there are
metres against a tree range of hundreds, so chasing the suspension's own
movement would rebuild fields for nothing.

#### The sward had a fast half and a slow half sharing one return

`swardFrame`'s early return for a sweep already in flight sat ABOVE everything —
so `uSwardEye`, the flower palette and every band's lattice base were frozen for
as long as a rebuild took. A rapid chart pan or a drone flight therefore stopped
the grass following the camera while the thing it was waiting for was a field
for ground the player had already left. The uniform writes are FAST and exact at
whatever the focus is this frame; the field is SLOW and buffered, which is what
it always was. The uniforms go first now and the field's branch is last.

**AND A SWEEP CAN BE ABANDONED.** `SWARD_ABANDON` (160 m) is a JUMP, not a
drive, and the numbers are the argument: an ordinary drive rebuilds at
`SWARD_REBUILD` (48 m) once a sweep has LANDED, and a sweep costs a fifth of a
second at 60 fps and at worst a second or two under `SWARD_LAG_MS` — fifty
metres of driving at speed, comfortably inside it. So a truck never abandons a
sweep and a focus that has genuinely gone somewhere else restarts one. It cannot
thrash either: a restart re-centres the pending field on the focus, so the next
abandon needs another 160 m. `swardLedger.abandoned` counts them.

#### What moved, and the one thing that did not

| consumer | was | is |
|---|---|---|
| GPU sward focus, bases, flowers | `state + pan` on the chart, rig otherwise | `renderFocusXZ()` |
| CPU sward lattice (`?sward=cpu`) | the rig, outright | the focus |
| shrub lattice | the rig | the focus (the chart hides shrubs, so this is the DRONE's case) |
| the tree ring's centre and all three admission distances | the rig | the focus |
| the impostor far gather, and the ground a card dissolves toward | the rig | the focus |
| `vegManifestTally` | the rig | the focus — or it counts the ring round a place nothing is seeding |
| the sun's shadow centre | `viewX()/viewZ()`, with no pan at all | the focus |
| **the `vegGrid` prune** | the rig | **the UNION** |

**THE PRUNE IS THE ONE THAT MUST NOT FOLLOW THE FOCUS**, and it is the honest
half of "don't move the world away from the vehicle": `vegGrid` is also where
the collision pass finds its boulders, and that pass reads the cells around the
RIG. Pruning to the focus alone deletes the rocks under the wheels the moment
the drone takes off. Trees are a render interest; a rock you can hit is not.

#### Streaming: the union, without a second wedge

`streamWorld` is handed the RIG and everything in it is built around the rig —
the wedge, the corridor, the speed the ask set leans on — and that stays. What
it gained is a SMALL RING for the focus: a 3×3 of z14 terrain (±3.5 km), a 3×3
of z12 cover, and an OSM ring **sized to the sward's own field** (`SWARD_FW / 2`
over `tileMetres(OSM_Z)`, clamped 1–2), because the mask that keeps grass off a
carriageway is drawn over that field and the trees read the same roads through
`onCarriageway`. A ring for what is DRAWN there, not a second world.

- **IT IS NOT GATED ON A DISTANCE.** Where the focus IS the rig — chase and cab,
  which is most of the time — every tile it names has already been asked and the
  block costs a handful of Set lookups. A threshold would be one more number to
  be wrong about.
- **AND THE FOCUS'S OSM TILES ARE PINNED.** They are outside the rig's wedge BY
  CONSTRUCTION, so `osmRelease` would drop every one of them the moment it
  looked: asked each pass, dropped each pass, landed never. `osmFocusPin` is
  rebuilt from scratch on every stream pass so it cannot leak — a focus that has
  come home simply stops pinning. (`osmPinned` is the other exemption and is a
  different thing: one-shot, for a tile a person asked for by hand, deleted when
  that tile answers.) Ranked below the core disc and the corridor and above the
  plain wedge: the ground under the wheels and the road ahead still go first.
- The far shell and the overview vectors already streamed to the chart's centre
  and are untouched — that rule predates this and is the same rule.

#### Verified

`npx tsc --noEmit` exit 0; `client/perf-check.mjs` **20 of 20 production refills
byte-identical** (its sandbox gained a `renderFocusXZ` stub that returns the rig,
which is not a simplification — it has no camera, no drone and no pan, so the rig
IS the answer, and it is also what the baseline function reads inline);
`switches`, `glsl-reserved`, `veg-anchor` and `boot` green (0 page errors);
`tree-stand` all ok, 3,688 skeletons in 485 stands, 1.78 silhouettes a stand.

**NOT VERIFIED BY EYE.** No frame has been taken of a drone flying away from its
own trees, and the harness cannot easily take one: the thing to look at is a
tree ring that follows the aircraft, which needs a flight rather than a settle.
The seat's report against the deploy is the verification, and `?ez=0`,
`?sward=cpu` and `?shrub=0` are the switches to take it apart with.

**AND THE COST IS UNMEASURED ON A DEVICE.** `renderFocusXZ` is a compare and at
worst one `groundAt` per call, and it is called a handful of times a frame — but
the veg refresh's ring now moves with the camera, so a chart pan or a drone
flight re-centres the ring and re-seeds cells exactly as driving does. The seed
budget (`VEG_SEED_MS`, 8 ms less whatever the frame has already spent) is what
bounds that, and it is the same bound a hop already lives under; the row to read
on the next dump is `treeRefresh` with its `seedMsNow` beside it.

**WHAT IS EXPLICITLY NOT DONE**, because the seat's own sequencing puts it after
these two: tree admission is still a focus-centred CIRCLE. Frustum and
projected-size admission with a guard band is the next step, and it is the one
that would stop the ring spending its budget on ground behind the camera.

### The partition summed to one and the carriers could not carry it

The seat's third report on the sward, and the sharpest: *the partition-of-unity
logic is mathematically continuous, but the individual density bands cannot
actually carry the density being handed to them. That capacity clamp recreates
rings.* Every number in it was reproduced from the source before anything moved,
and it is right — and **understated**, for a reason the report could not have
known.

**THE ARITHMETIC, AND IT IS EXACT.** A lattice of step s places at most ONE tuft
per cell, so it cannot exceed 1/s² per square metre whatever its keep says:
**4.94/m² at 0.45 m, 0.444 at 1.5, 0.047 at 4.6.** The shared target is
`uDens · (22/d)^2.2` and every band's keep is `target · step² · weight`, so a
band handed a keep above one delivers its ceiling **and reports nothing at all.**
A probability clamped at 1 fails silently — which this file already said, in the
comment above the band table, while shipping the fault it describes.

**AND THE GRASS DIAL DEFAULTS TO 3.2x.** The report worked at `SWARD_LUSH = 14`;
`uDens` is `vegScale · grassScale · SWARD_LUSH`, and the GRASS dial's default
stop is MEDIUM. **The shipped default request is 44.8 sites/m²** — nine times the
near band's ceiling and nine hundred and fifty times the far band's — so the
whole field was capacity-limited nearly everywhere and the falloff had almost
stopped existing. Measured on the shipped rule at the shipped default
(`devtools/sward-profile.mjs`, `at-campsbay`): **149 of 179 radii short of their
own target, worst 11%.**

| d | delivered, as shipped | of target | delivered, now | of target | tuft |
|---|---|---|---|---|---|
| 2–24 m | 3.83 | **11%** | 3.83 | 100% | ×1.80 |
| 40 | 3.83 | 41% | 3.33 | 100% | ×1.00 |
| 56 | 3.83 | 86% | 1.59 | 100% | ×1.00 |
| **72** | **0.344** | **14%** | 0.344 | 100% | ×1.63 |
| 96 | 0.344 | 25% | 0.344 | 100% | ×1.19 |
| 160 | 0.344 | 78% | 0.158 | 100% | ×1.00 |
| 168 | 0.380 | 96% | 0.142 | 100% | ×1.00 |
| **192** | **0.0374** | **14%** | 0.0374 | 100% | ×1.68 |
| 240 | 0.0366 | 15% | 0.0366 | 100% | ×1.33 |

Read the left column down and the rings are not an inference, they are the
shape: **flat at 3.83 to 56 m, a cliff to 0.344 by 72, flat to 168 with a small
spike where both bands contribute before the far one saturates, a cliff to
0.0366 by 192, flat again.** Three plateaus and two cliffs. That is the
photograph.

#### Sites per square metre is not lushness, and conflating them made the rings

`SWARD_LUSH = 14` existed for a good reason — GRASS_M2's values are the density
the CPU sward could AFFORD, not the density a meadow has — and it is a number
two of the three carriers cannot represent. The two quantities are separated now:

- **`SWARD_SITES` (5/m², `?swardsites=`)** is a count the carriers can carry. It
  is not a taste: it is the largest nominal for which the target curve stays
  under the capacity envelope at both handovers, and the seat derived the same
  five independently from the crossover distances (66 m and 184 m against the
  existing 56–72 and 160–195 windows).
- **everything above it is TUFT FULLNESS** — the same ground covered by fewer,
  wider plants, which is what "lush" means to an eye and costs no slot at all.

**THE CLAMP IS ON THE TARGET, NOT ON THE KEEP, and that is the whole fix.**
`swardCap(d)` is `min over bands of 1/(w_b(d) · step_b²)` — the exact bound that
keeps every band's keep at or under one — GENERATED FROM THE BAND TABLE rather
than typed, so a second copy cannot drift and the profile probe measures against
the same function the shader runs. A band clamping its OWN keep at one delivers
less than the shared target and the other bands never hear about it; **one
shared target that no band will saturate means every band delivers its exact
share and the total is the target at any dial setting, by construction.**

**AND THE DEFICIT IS NOT THROWN AWAY.** Where the clamp binds, the tuft widens
by `sqrt(want/got)` — LATERALLY only, because grass does not grow taller because
there is more of it — so **coverage, which is sites × tuft area, equals the
perceptual curve at every radius.** Measured: coverage 100% of the law's request
from 2 m to 300 m, against 11–86% before. The count follows the law where the
carriers can hold it and the coverage follows it everywhere, which is the
honest statement of what an eye is judging. `?swardfull=1` turns the
compensation off for an A/B; the cap (2.1) exists because at the top of the
grass dial the ratio is thirty-six and a tuft six times its width is a bush.

**WHAT CHANGES ON SCREEN, said plainly rather than buried.** The near field
(0–24 m) delivers exactly what it did — both builds ride the near ceiling —
but its tufts are now **1.8× wider**, because the dial is asking for 16/m² and
the lattice holds 4.94. The 45–70 m and 110–190 m bands get **about 2× thinner**,
because those are precisely where the old build was riding a ceiling instead of
following its own curve. Everything else is unchanged to the digit. Whether the
fatter near tufts read as lush or as cabbages is the seat's call and
`?swardfull=1` is the switch for it.

#### The evidence field ran out from under the far edge

Also from the report, and independently true: the field is 768 m wide — **384 m
from the centre to an edge against a 359 m reach, so 25 m of margin** — while
`SWARD_REBUILD` is 48, so the drawn edge could stand 23 m OUTSIDE the committed
texture before a rebuild was even considered, and further while the replacement
swept. `sUv` past [0,1] is refused by `sLive`, so what it draws out there is
nothing: a thinning crescent travelling with the camera, which is one more wave
to mistake for a ring.

`SWARD_F` 96 → **112**: 896 m across, **89.2 m of margin against a 48 m
trigger**. The alternative — rebuilding three times as often — costs three times
the sweep for the same coverage where this costs 36% more per sweep at the same
rate, and the resolution per metre does not move, so nothing the field says
about the ground changes. `SWARD_MASKN` went 512 → 600 with it, because a mask
stretched over a wider field at a fixed texel count coarsens the kerb by the
same 17% — 1.49 m a texel, which is the number its own comment was written
about.

#### The instrument, and why `__sward()` could not have caught this

`__swardprofile()` reports, per radius: the target the law asks for, the
envelope the carriers can hold, each band's weight and keep, what is delivered,
the coverage and the ratio. `__sward()` had every INPUT to this — it reported
each band's ceiling and each band's blend window — and could not see it, because
it never put the ceiling and the requested density **at the same range**. The
fifth time this file has recorded the same shape: a probe that reports the
output of a rule cannot witness the rule.

`devtools/sward-profile.mjs` runs it on a fixture in about forty seconds, one
boot, `nodraw` (the quantity is arithmetic over the live uniforms, not pixels),
and fails on a coverage shortfall inside the outer fade or on a field margin
under the rebuild trigger. `ARGS='swardcap=0&swardsites=14'` is the exact
control and fails 149 of 179 radii — which is what makes the check a check.

**AND `nodraw` COULD NOT HAVE VALIDATED THE SHADER.** A program compiles on its
first RENDER, so the profile run says nothing about whether the new `swardCap`
links. The frame was taken separately, with drawing on: 0 page errors, and the
harness folds a GLSL error into that list.

#### What is NOT done, and the arithmetic to start from

**THE THREE CARRIERS ARE STILL THREE UNRELATED POINT PROCESSES.** The seat's
fourth invariant, and the one they expect to make it *feel* like one field: the
steps are 0.45 / 1.5 / 4.6, which are not integer multiples, so at a crossfade
one random population fades out and a completely different one fades in at
unrelated positions. Their proposal is exact 3× nesting — **0.45 / 1.35 /
4.05** — with each coarse site a deterministic 1-of-9 child of the finer
lattice, so the coarse tuft stands where a fine tuft stood, at the same size,
colour and yaw, and the handover is a THINNING of one population rather than a
swap of two. Sides resize to hold the reaches (320 / 292 / 180 → 220,064 slots,
+13%) and both coarse ceilings improve (0.549 and 0.061).

It is deliberately NOT done in this commit, for two reasons and one piece of
arithmetic:

- **ATTRIBUTION.** The measurable defect is fixed and measured. Nesting's
  benefit is a look claim about spatial-frequency identity that no instrument
  here can measure — it needs the seat's eye — and landing both at once makes
  the next frame unattributable.
- **IT HAS A COST NOBODY HAS PRICED, and here it is.** With nesting the two
  bands SHARE their children, so the delivered density is the UNION and not the
  sum. Per m²: non-children contribute `0.8889·D·w_near` and children
  `D·max(0.1111·w_near, w_mid)`, so the total is
  `D·(0.8889·w_near + max(0.1111·w_near, w_mid))` — exactly D at either end of a
  handover and **5.6% short at its midpoint**, where both weights are a half.
  Well inside the ten per cent bar and far better than the 57% it replaces, but
  it is real, and `__swardprofile` currently sums the bands and would report
  100% where the truth is 94%. **Teach the probe the union rule in the same
  commit as the nesting**, or the instrument will certify the thing it was built
  to catch.
- A child alive in the near band is also alive in the mid band (its keep is
  nine times larger over the same hash), so it is drawn TWICE in the crossfade
  annulus — identical geometry at an identical place, so no artefact, but some
  overdraw. Worth knowing before it is read as a bug.
