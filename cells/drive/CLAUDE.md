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
runs the client, not the deployed handler. **Anything the cell serves has to be
in the module graph**: `web/` is the source of truth (the native shells copy it
verbatim), and `scripts/build-web-assets.mjs` renders it into the generated
`web-assets.ts` that `index.ts` imports. `devtools/appshell.test.mjs`
regenerates and compares, so the two cannot drift.

`static/` would not have saved the icons either: that read is
`Buffer.toString('utf-8')` and a PNG does not survive being a string.
`getObjectRaw` sits beside it in `services/cells/provisioner.ts`, so making
`static/` binary-safe is a real platform fix that nobody has made yet.

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
| `node devtools/appshell.test.mjs` | the worker precaches only what the cell serves | instant |
| `node devtools/offline-shell.test.mjs` | the browser starts with the network off | ~20s |
| `node devtools/storage-reset.test.mjs` | settings can hand the whole device back | ~20s |
| `node devtools/offline-ground.test.mjs` | and finds ground when it does | ~3min |
| `node devtools/<name>.test.mjs` | 66 of them; pick what you touched | varies |

Run them from `/home/user/workspace`, not from the cell directory.

**`tsc` failure is silent if you pipe it.** `npx tsc --noEmit 2>&1 | head && echo OK`
prints OK on failure, because `head` succeeds. Use `;` not `&&`, and read the
output.

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

**Measuring any of this costs minutes.** A coarse ring is 25 DEM fetches at 4
concurrent, and every one goes through the harness's curl relay. Budget three
to five minutes per zoom step, and read `__far()` (meshes, asked, inFlight,
queued, cover) rather than watching the picture.

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
