# Squishy · Level Lab

A renderer-free sibling of [Squishy](/squishy). It uses exactly the same generated level, collision shapes, approximate trajectory physics and real soft-body simulator: `client/squishy/course.ts`, `level.ts`, `jelly.ts`, `body.ts`. No separate simulation rules, WebGL or shaders.

## Using it

1. Choose a level number, seed and the character's material; **Build level** deterministically reuses the current Squishy `buildLevel(n,seed)`.
2. **Discover routes** examines nearby forward pairs of stops with the existing `hop()` / `aim()` solvers and a multi-angle sweep. Results are ballistic witnesses (ochre). Grey dotted segments are the generator's own checked `lv.ways` graph, including fork/merge topology and have *not* been verified.
3. Tap a connection. **Verify** performs three trials with the *actual* `Dumpling.step()` physics, from a fresh settled start at the source, including small yaw/power perturbations. Successful observed landings are green; unsuccessful validations red. Rails and wall climbs currently require a composite-action validator and stay predictions.
4. **Verify all witnesses** runs soft-body trials for every discovered simple transition, leaving multi-action rail/climb cases as predictions.
5. **Replay** moves a dot along the path captured by the simulation or ballistic solver. Choose plan, elevation or topological graph, and export SVG or JSON.

## Design and limitations

This is an initial *analysis* laboratory, not yet an automatically repairing multi-path builder. The geometry and movement models are shared with Squishy; the generator is unchanged. The translucent outlines show actual playable stop/support colliders (including sheets as dotted bounding regions), while solid footprints depict logical landing areas. A generated layout may still be linear, even if the Lab discovers accidental alternatives.

**Predicted is not confirmed.** The fast trajectory uses Squishy's simplified centre/ball model. Physically confirmed means at least one of three discrete full soft-body trials settled at the requested destination. This is not proof of human playability. A failed validation is evidence against the sampled controls, **not** that the edge is impossible.

Search currently considers forward pairs up to five stops apart and within 125 cm horizontally, with limited sampled yaw and power. It does not enumerate backwards, indirect recovery, arbitrary launch locations, chained multi-action movements or every surface of decorative furniture. Dynamic timings are only partly sampled. `hop()` can witness wall/rail sequences, but composite real-body verification is future work. Edge counts and path counts are therefore **lower bounds on discovered routes**, not statements about the full reachable state space. Geometry plan axes are stretched independently to keep the diagram legible.

## Next experiments

- Discover stable contact states on every physically usable surface, not just `lv.towers`.
- Measure entire connected control-space regions and actual landing distributions.
- Support multi-step agents (rail shimmies, cling/climb, bounce chains, timed lids).
- Connect failed launches to alternate landing, recoveries and terminal falls.
- Produce an annotated directed state graph with verified checkpoint viability.
- Add bounded deterministic repair of layouts until route/difficulty/recovery constraints are met.
- Headless batch seed sweeps in a Node-compatible worker, pass-level timing and seed/version regression corpus.

Lab entries: `client/squishy-lab/engine.ts` and `client/squishy-lab/main.ts`. The source game is deliberately not forked.

## Spatial composition case study — Level 7, seed 2

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
