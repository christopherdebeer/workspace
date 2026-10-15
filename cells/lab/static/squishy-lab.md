# Squishy · Level Lab

A renderer-free sibling of [Squishy](/squishy). It uses exactly the same generated level, collision shapes, approximate trajectory physics and real soft-body simulator: `client/squishy/course.ts`, `level.ts`, `jelly.ts`, `body.ts`. No separate simulation rules, WebGL or shaders.

## What it measures

General purpose: any level, any seed, either dumpling. The specimen is whatever a session is looking at; the link pins it — `fp=` is the level's fingerprint (its solids and tops, hashed), and the page warns when the generator has since changed what that level and seed lay.

A move is measured in the player's own units: **pixels of drag** on a 402×714 phone, where the game's flick is power = (L − 14) / (0.3 · min(w, h)), so 3 px ≈ 0.025 power. Not every level shows the aim ring, so the measure is what a thumb can do without it:

1. **Discover routes** finds moves between tops: the generator's own `hop()` for the moves it laid (the only solver for rails, climbs and jars), else a ballistic sweep taking the *middle* of the widest run of landing powers (not its end: a witness should have room either side).
2. Tap a move, **Map in drag px**: every flick within ±24 px of the witness, across and along the drag, run through the real `Dumpling.step` at the game's fixed 1/60 — a coarse 8 px grid, then every 4 px wherever neighbours disagree. Each cell is what happened: lands, onto another top, falls (the game puts you back where you were), stops off any top, or still going.
3. From the map, under **σ px of drag error** (the toolbar; a stated guess until play measures it): the best aim and its chance, the chance at the witness, the **tolerance** (the radius round the best aim that all lands), where the misses go, and, for levels that show it, how often the aim ring on the target means a landing.
4. **Trials**: twelve flicks as a player makes them, the best aim off by σ, each through the real body, with a Wilson 95% interval — *confirmed* when its low end is at least a half, *marginal* below, *failed* when nothing landed; and the same aim after resting longer, because a learnt drag has to work whenever it's made.
5. **Measure level** maps every single-flick move and prices the way home: a Markov chain over the tops, each move at its best aim, value-iterated for the **expected flicks home** (and falls), with each fork's options side by side. A fall costs the flick and puts you back; stopping off any top is counted as one more flick to get back on — an assumption, marked as one.
6. **Play this level** opens the game on the same level and seed. The game keeps each flick made on this device (where from, the drag, what the ring showed, where it ended); back here, those on the same fingerprint are drawn over the maps — the evidence that comes from use.

Headless, the same engine: `node devtools/squishy-map.mjs --level 7 --seed 2 [--sigma 4] [--edges 3-4,3-6]` prints each move's chance, tolerance, outcomes and trials, the expected flicks home, and writes `devtools/out/map-<level>-<seed>.json`.

## Limits

Moves of more than one action (rail shimmies, climbs, letting go of a jar) are discovered but not mapped. The noise is a stated σ until enough logged flicks fit one. Stopping off any top is priced, not yet followed. Search is forward pairs up to five apart; a missing move is not an impossible one. The lab's simulation is the game's own physics and step; that it matches the game *as played* (the real loop, input and timing) is checked by replaying flicks in a browser — not yet done.

## Spatial composition case study — Level 7, seed 2

*Measured on the generator as it was at the time (fingerprints were not yet recorded); the same level and seed now lay differently.*

[Open the controlled composition study](/squishy-lab?study&level=7&seed=2). This is intentionally one generated encounter, not a gallery. It uses the existing `buildKitchen` generator, its real collision geometry, and an optional fork-composition parameter. The playable game defaults to its unchanged original `parallel` layout.

### Raw measurements from the headless generator

For composition `parallel`, the generator places a fork at stop **3** and rejoin at **7**, with two paths: **3→4→5→7** (steamer → tray → tray → rack) and **3→6→7** (steamer → tin → rack). Their horizontal lengths are **153.54 cm** and **151.46 cm**. The latter saves one flick, but not much physical distance. The first destinations are **34.90 cm** apart horizontally, with a **32.47°** 3D opening angle at the fork.

Using an approximation of the game's settled third-person mobile camera and five sampled points per target, the first safe-route landing has **2/5** visibly framed sample points and the alternative **5/5**. The merge is outside this approximate camera frustum. This is a *geometric visibility hypothesis*, not observed human attention or a replayed camera.

`offset` has the **same ordered stop types, inventory and generator-checked route graph** for this seed; it alters the second safe-route placement band, testing what happens **after** the fork. Do not attribute changes in initial-route selection to this intervention. `convergent` fails to retain the fork and substitutes a different inventory; that is an instructive generator constraint failure, not a controlled A/B comparison.

### Critique and design hypotheses

- Having two graph paths does not necessarily create a visually balanced choice. Here the **risky alternative appears more fully inside the modelled decision camera**.
- The apparently shorter route is shorter mainly by **one action**, not travel distance. Risk/reward needs movement tolerance and recovery measurements, not just geometric distance.
- Front/back lane segregation creates a fork in the topology, but limited vertical layering or discovery. Negative space, staged visibility and under-platform catchments remain largely accidental.
- The merge is not visually legible from the fork in the approximate camera. Whether that produces curiosity or confusion cannot be inferred from physics.
- Crucially, bringing routes closer together caused the generator to **remove the fork**. A compositional change must preserve topology, or explicitly be classified as confounded.

### Independent observational validation — not yet conducted

Test the unchanged parallel and valid offset specimens with **6–8 first-time players**, in counterbalanced order, after the same basic flick tutorial. Preserve screen recordings, camera movements, input traces and physical outcomes. Before the first flick, ask players which destinations look achievable and why, without identifying a safe route. Record decision latency, attempted route, misses, continued exploration, alternate destinations, reattempts, recovery cost and whether players can explain unsuccessful outcomes.

Pre-register three hypotheses: (H1) the original arrangement favours noticing the risky branch; (H2) offset affects later navigation, not the initial choice; (H3) hidden merges produce either productive discovery or unproductive confusion. Do not claim these are true without independent observations.

### Reusable principles requiring validation

1. Every consequential fork should expose at least one forgiving, distinguishable affordance in the *actual playable camera*.
2. Arrange forgiving catchments beneath risky jumps so imperfect controls can yield interesting continuation.
3. Use occlusion to stage optional discovery, not conceal information essential to an irreversible commitment.
4. Hold topology and the object inventory invariant when comparing spatial compositions; otherwise report a generator failure.
5. Include view-dependent salience and failure destinations in procedural fitness, rather than maximising raw route counts.

**Limits:** the study currently uses generator ballistic feasibility and approximate camera geometry. No actual human trial has been conducted, and it does not establish soft-body robustness of every transition or recoverability of every miss. These remain explicit subsequent tests.

### Actual full-body witness results (not success probabilities)

The isolated headless checker reran the generated fork's first two exits with the actual `Dumpling.step()` solver and the current `hop()`/ `aim()` candidate controls:

| Composition | Transition | Yaw (radians) | Power | Full-body result |
|---|---|---:|---:|---|
| parallel | 3 → 4, safe | 1.9584 | 0.606 | settled on 4 |
| parallel | 3 → 6, alternative | 1.4026 | 0.754 | settled on 6 |
| offset | 3 → 4, safe | 1.9584 | 0.606 | settled on 4 |
| offset | 3 → 6, alternative | 1.4026 | 0.754 | settled on 6 |

Each row is **one successful physical trajectory** from a fresh settled state, not a percentage. These witnesses establish that both first jumps are achievable by the current simulated physics in both compared compositions. They do **not** prove that either route's later jumps are robust, that mistakes are recoverable, or that people can read or execute these controls comfortably. The alternative requires greater nominal launch power, but difficulty additionally depends on the width and continuity of its successful input region.

The evidence endpoint can be reproduced for one edge at a time via `/_squishy-physical/7/2/parallel/0` (safe), `/_squishy-physical/7/2/parallel/1` (alternative), and the corresponding `offset` paths. These deliberately limit each invocation to one full-body trace to avoid the cell's short execution timeout.

### Comparison outcome: added turning is not added discovery

The opt-in `offset` treatment preserved the route graph and object inventory but increased the **safe branch's accumulated 3D turning** from **38.28°** to **57.23°** (approximately **+18.95°**). Its path grew only from **153.54 cm** to **153.96 cm**. From the approximate camera at the first safe landing, the following stop remained **5/5** visible samples and the merge **0/5**, unchanged. The initial fork's 2/5 versus 5/5 choice visibility was unchanged as well.

This is a negative/neutral compositional result: extra directional change did **not** demonstrate additional discovery or improved legibility. It may even add unproductive camera work, which only player observations can establish. Do not promote this particular offset as a default procedural preference. A better next experiment would manipulate a meaningful visibility/recovery relationship while keeping both route geometry and validated outcomes controlled.
