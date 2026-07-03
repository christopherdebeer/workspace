# canvas headless gesture repro

A hermetic harness that runs the **real canvas client** (bundled from
`cells/canvas/client/main.ts`, with the remote kernel stubbed) in headless
Chromium and drives it with CDP **touch events** — built to chase the
intermittent mobile-Safari tab-kill.

## What it found

The FSM's reachable two-finger path on a selected element is
`pressPendingDirect → moveGroup → pinchGroup` (`applyGroupPinch`). Its scale
factor was `newDist / startDist` with **no clamp** and **no floor on
startDist**:

- fingers landing 8px apart, spread to ~300px → `el.scale = 37`
  (a 240px element painted **8,896px** wide)
- fingers landing ~coincident (0.5px) → `el.scale = 481`
  (**115,456 × 9,253 px** — ~10⁹ painted pixels from one gesture)

Desktop GPUs absorb that; iOS Safari's compositor memory limit kills the tab.
Worse, the gesture's `commitElementMutation` **persisted** the exploded scale
as a fact, so the poisoned board then crashed "randomly" on later loads.

The fix lives in `cells/canvas/client/lib/geometry.ts` (scale clamps, pinch
denominator floor, load-time geometry healing) plus phantom-pointer guards in
`pointerAdapter.ts`.

## Run it

```sh
npm install                 # esbuild, xstate, d3-force, playwright-core
npm run build               # bundle the live client source → public/app.js
npm run serve &             # http://127.0.0.1:8787
npm run drive               # canvas pinch + group pinch + coincident-start pinch
npm run poison              # a fact persisted with scale 481 / width 1e7 renders healed
```

`drive.mjs`/`poison.mjs` use the Playwright-managed Chromium; point `CHROME`
at a binary to override (e.g. `CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).

Expected (fixed) output: group-pinch scale stays ≤ `maxScaleFor(el)`
(paint side ≤ 16,384px), the coincident-start pinch lands ~10× not ~480×, and
the poisoned element renders at `scale: 1, width: 16384`.

## Round 2: the navigate-mode PAN crash

The crash the pinch clamps didn't cover: one-finger pans on the live board.
Profiling the REAL `parcland` scene (127 elements, 346 edges — capture it with
`read("@c15r/canvas.scene", {board:"parcland"})` into
`public/parcland-scene.json`, then `node gen-pan.mjs`) found two stacked loads:

1. **Per-pointermove main-thread saturation.** `updateCanvasTransform` ran its
   DOM writes + a forced layout synchronously per pointermove (iOS fires up to
   120/s): ~4 forced layouts and ~17 style recalcs per move, ~33ms each. The
   worst single item: two CSS custom properties (`--translateX/--translateY`)
   written per move that NOTHING consumes — each write recalcs style for the
   whole subtree.
2. **A permanent 60Hz load under the pan.** A legacy on-board minimap widget
   runs a `requestAnimationFrame(drawMiniMap)` loop — a forced layout + a
   full-board canvas redraw every frame, forever — and infinite CSS animations
   (one animating `top`, a layout property) kept the board at 60 layouts +
   300 style recalcs **per second while idle**. A pan re-rasterises tiles on
   top of exactly that.

Fixes: camera DOM writes rAF-coalesced (`applyCanvasTransformNow`), the unused
CSS vars dropped, `--zoom` written only when scale changes, the edge layer
culled with the elements (and `similarTo`/`relates` edges carry no `<text>`
caption — the live board had 333 of them), the cull pass early-exits until the
camera moves half a screen, element-script rAF loops are capped at ~30fps and
parked (with all CSS animations) while `body.gesturing`.

In-stroke A/B on the real board, one continuous 8s pan (`node stroke.mjs`):
layout time −68%, style-recalc time −92%, script −59%, total main-thread task
time −54% (≈50% → ≈23% duty cycle).

## Round 3: the ZOOM path + edge interaction

The pan fixes above didn't cover a sustained zoom, which has its own per-frame
costs: `--zoom` consumed by `calc()` padding/border re-lays-out every element
on every frame the scale moves; the cull early-exit compared `W === last.W`,
which never matches mid-zoom, so the full cull pass ran per frame; and
`applyCanvasPinch → screenToCanvas` read `offsetLeft` per pointermove (a
forced layout at 120Hz). Fixes: `--zoom` writes quantized to ~5% steps with a
trailing exact settle, a containment-based cull window that holds under zoom,
guarded cull style writes, and the canvas offset cached.

Interaction fixes verified by `verify-edge-fixes.mjs` (needs `npm run build`
+ `npm run serve` first): inferred `similarTo` edges draw as the faint
constellation (1px, translucent, no arrowhead, narrower hit band) instead of
swamping the board; the edge inspector names both endpoints (tappable to
focus); and a navigate-mode drag that starts on an edge's hit line pans the
canvas instead of dying in `moveGroup`.

Tools: `gen-pan.mjs` (build the pan page from the captured scene),
`pan.mjs` (multi-stroke pan cost), `stroke.mjs` (single held stroke, the
honest in-gesture profile), `idle.mjs` (the no-input floor), `prof.mjs`
(sampling profile naming hot functions), `raf-census.mjs` (who registers rAF,
per second).
