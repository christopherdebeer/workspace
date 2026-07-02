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
