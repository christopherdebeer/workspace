# Probe modules

Hot-loaded into a running tab over the probe channel — **no deploy, no reload**.
The page forbids eval, so these are ES modules: the cell holds one, the tab
imports it (`script-src 'self'`), and `window.__ctx` hands it the live
renderer, scene, camera and vehicle state.

    POST /probe/<key>/mod   {js}        # post the module
    <ask the tab> __load()              # it imports and runs the default export

A module's default export is CALLED and its return value is the answer, so one
round trip does the whole job. Anything it hangs on `window` stays reachable as
an ordinary probe path afterwards.

Open the game with `?probe=<key>` to arm the channel. Give each DEVICE its own
key: two tabs on one key both poll, whichever reaches `/next` first takes the
question, and a series of readings will silently interleave two machines. Every
answer now carries the tab tag that produced it; `__who()` reports it in full.

## What is here

| module | question it answers |
|---|---|
| `steady.js` | Where does a TYPICAL frame go — render vs game logic vs neither. |
| `vsync.js` | Is 60Hz even on offer, or is the browser capping us? |
| `calls.js` | Do draw calls and distant geometry cost anything? (Hides them and measures.) |
| `speedbucket.js` | Frame cost bucketed by rig speed — separates a baseline floor from streaming spikes. |
| `stall-kit.js` | Long-frame log with deltas, plus main-thread accounting of the usual built-in suspects. |

## What they established (iPhone, iOS 18.7 Safari, Aug 2026)

Two separate problems, which had been read as one:

- **A 30fps floor that is there even PARKED** (33.3ms/frame, 414 frames). Not
  streaming, not geometry — `calls.js` hid 82% of draw calls and 85% of
  triangles and the median frame did not move by 1ms — not fill rate, since the
  world renders at `PIX_H = 320`. Unexplained. 60Hz is available: 16% of frames
  land on a single refresh.
- **Streaming spikes on top of it.** Mean frame time barely moves with speed
  (33.3 → 44ms) but the WORST frame goes 51ms → 349ms. This is the "lag when
  turning at speed": the tile wedge is drawn about the instantaneous heading at
  19.5:1 forward:lateral, so turning inverts the queue and promotes a fresh cone
  of tiles all at once.

The control that separated them came from the driver, not the instruments:
flying the drone over the same ground is smooth, and `streamWorld` is called
with `state.x/state.z` — a parked rig streams nothing.

## Writing one

Keep the per-frame path O(1). An early cut of `stall-kit` traversed 1279 meshes
every frame to count them, which is itself a stall — an instrument that causes
the fault it measures is worse than none. Make wrappers reversible and hang the
undo on `window`, for the same reason.
