# Tactile · pebble in the hand

A hardware simulation of the [Tactile](https://github.com/christopherdebeer/tactile) pebble, an
M5Stack AtomS3R held in one hand, made for working out how it should be used without a bench, a
cable or the device. The 3D device on the screen runs the firmware's own reader: the C that ships
on the pebble (`firmware/main/afterword.c`), compiled unchanged to WebAssembly. Everything it
decides (pace, pause, focus, enter, exit, the first-use tutorial) is the firmware deciding it.
The simulation supplies only what the device would feel: a hand, and the IMU in it.

## Holding it

- **hand**: drag sideways to turn the device like a dial (clockwise is faster), and up or down
  to tip its top edge away from you or toward you. Let go and the hand relaxes back to neutral
  (or, in Settings, stays where you left it). Arrow keys do the same.
- **phone**: the phone becomes the pebble. Its accelerometer and gyroscope are fed to the
  firmware as the BMI270 (same axes: x right, y up the screen, z out of it). Hold it upright,
  screen facing you, and read.
- **replay**: a capture from the real device (`tools/capture.py`) plays through the same core.

The reader, in the firmware's words: turn clockwise and keep it turned to speed up; return
upright to keep the new pace; turn counter-clockwise through a pause into reverse; stay paused
for 400 ms to focus the word; tip the top edge away for 300 ms to enter a linked word; tip it
toward you to come back out to the exact word you left. First use teaches all of this, one
capability at a time.

## What it shows

- **The device**: 24 × 24 × 12.9 mm, its 128 × 128 screen drawn as `display.cpp` draws it (the
  same colours, rows, text sizes and 6 × 8 character cells, the red recognition letter and its
  fixation ticks), the firmware's backlight dimming after 30 s without a change.
- **Gauges**: roll against the firmware's dead zone (±4.6°) and full scale (±29.8°), with your
  intent (dashed) beside what the device measured; pitch against the enter/exit threshold
  (±18.3°) and the neutral re-arm (±6.9°); the retained signed rate (−2× to +4×). Thresholds come
  from the firmware source, not from this page.
- **Flags**: ready, armed, turning, focused, latched: the recognisers' state, tick by tick.
- **Events**: passages entered and left, focus, tutorial stages, and every intention the
  firmware refuses ("slow to focus", "already here", "nothing beneath", "finish pace first").
  Refusals are the interesting ones: each is a moment the device and the person disagreed.
- **Measure**: time per tutorial stage, words shown, entries and exits, refusals, reversals,
  rate range, time paused.
- **Trace**: record a session in the firmware's telemetry schema (`protocol/telemetry.md`,
  with `"provenance":"lab-sim"`) and download it as JSONL for `tools/replay.py`; or load a
  device capture, replay it through this core, and see how often the recorded reader state agrees
  with the simulated one.

## Realism

The hand is a critically damped spring toward your intent. To it you can add physiological
tremor (8–12 Hz), a walking gait (1.8 Hz: vertical bob, fore-aft surge and wrist sway, which
the accelerometer reads as tilt), BMI270-like sensor noise and a gyro bias. The IMU is sampled
at 100 Hz and the reader runs every 20 ms on the latest every-other sample, as on the device.

A **haptic preview** pulses the phone on focus, enter, exit and refusal: a sketch of P4's LRA,
for asking which moments deserve a touch before there is a motor to give one (Android only:
iOS has no vibration API).

## What it is not

- The glyphs are the browser's monospace, not the GLCD bitmap font; layout is exact, shapes
  are close.
- A phone is not a 24 mm cube. Its mass, size and grip change how a wrist turns. Phone mode
  is for the feel of the control law, not the ergonomics of the pebble.
- The firmware's tuning is `#define`d, so it is fixed per build here as on the device. To try
  other thresholds, change them in the firmware and rebuild the core (below); every experiment is
  then a firmware build that can be flashed as it is.

## Findings so far

From the headless checks (`devtools/tactile.test.mjs`), with a scripted operator that does only
what the screen and hint line ask:

- An operator who follows the hints perfectly completes the tutorial in about 10 s (hold 0.4,
  faster 1.2, reverse 2.4, forward 1.9, pause 1.5, focus 0.4, enter 1.0, exit 1.0, return 0.3).
  Reverse is the longest lesson: the rate has to slew through pause at 1.6×/s.
- A held, still hand with normal tremor and noise causes no enters, exits or pace change in two
  minutes. A steady walk caused none either: the 300 ms tilt dwell and roll's axis-dominance
  gate absorb the gait.
- The orientation capture waits for angular speed below 0.25 rad/s. Tremor of about 0.3° at
  9–11 Hz is already 0.3 rad/s, so a hand with pronounced tremor never gets past `hold`.
  Worth a look before anyone with essential tremor picks it up.
- Roll controls the *change* of pace, not the pace: displacement sets how fast the rate slews.
  That is second-order control, which people find harder than position or rate control, but it
  is what makes "return upright to keep this pace" possible. The gauges show the lag between a
  turn and the pace it produces; phone mode is the place to feel it.

## Updating the device

The core is generated from a tactile checkout:

    TACTILE=../tactile node cells/lab/devtools/tactile-core.mjs

That compiles `afterword.c` with a small freestanding libc (`devtools/tactile/libc`), runs the
firmware's own regression (`tests/afterword.c`) against the same WebAssembly, drives a native
gcc build and the WebAssembly through one scripted session and requires them to agree on every
tick, then writes `client/tactile/core.gen.ts` with the firmware version, commit and the
reader's constants. Then `node cells/lab/devtools/tactile.test.mjs` (the operator, axes and
realism checks) and `node cells/lab/devtools/tactile-shot.mjs` (screenshots at phone size).
