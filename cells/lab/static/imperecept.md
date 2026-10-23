# Imperecept — a listening skin

The unseen ground between percept and precept. The sound collection inhabits the same continuous substrate as the interaction.

## Explore

Enter & listen. Five stable, overlapping places contain rain/glass, bronze/air, pulse/breath, steps/stone and water/hollow. These are deterministic procedural sound compositions generated locally, with no archive fetch or external audio dependency.

Move across the material to blend sources. Hold still to gather temporal coherence. Fast movement introduces tension; holding leaves a slowly decaying memory that makes a place easier to gather again. Lift your hand and the current mixture continues. Two simultaneous touches combine their respective places. Their separation changes the mixture through the same spatial weighting; this version does not implement independent time stretching between fingers.

Reveal separates the drawn layers, names the sources and displays current grain duration, coherence and audio-clock-driven reversed read-head marks. The interaction remains live. Close layers returns to the surface.

Bring sound opens a local audio file; touch the surface to place it, or cancel placement. Files are decoded on the device and never uploaded. The first 30 seconds, up to two channels, are retained for this session. Maximum input size is 25 MB. Up to three imported places coexist; a fourth replaces the oldest imported place. Reloading clears imported sounds and touch memory.

## Temporal material

Continuous audio transport schedules Hann-windowed grains with three-way overlap. Coherence shortens reversed grains and blends in forward grains. Parameter changes affect upcoming grains without restarting the source. Spatial mixture weights are smoothed; source positions supply stereo placement. A master fade and compressor control transitions and peaks. This is an expressive reconstruction instrument, not a controlled reversed-speech perception test.

The drawn fibres respond to source coherence, actual output amplitude, touch deformation and decaying traces. Source memory is regional; the visible trail is spatial. The surface uses bounded Canvas 2D geometry at capped pixel density. Audio scheduling is separate from animation, with bounded lookahead and node cleanup. Hidden pages fade and suspend audio; returning requires Listen.

## Keyboard and motion

Focus the surface. Arrow keys explore, Space gathers (or places a pending import), R reveals. All controls are keyboard accessible. Reduced-motion preference removes autonomous fibre drift while retaining direct manipulation feedback. Preview mode is silent and does not construct an audio context.

## Validation

Strict standalone TypeScript checking and local Chromium checks cover startup, holding/coherence, two-touch mixing, stopping/node cleanup and local WAV placement. Phone-sized surface and revealed-layer layouts inspected at 402 × 874. iPhone Safari listening and tactile evaluation remain device checks.
