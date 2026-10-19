# Labyrinth: blind intent review

The question is what a hand might reasonably mean in the visible scene, before knowing what the implementation makes. A technically valid construction is not necessarily a successful interpretation.

Capture and judgment are separate. Capture uses the existing Playwright/software-GL harness. Judgment needs only Node, the saved JPEGs and JSON; an image-capable reviewer can inspect them without running WebGL. There is no automatic model call or presumed human ground truth.

## Capture on the rendering machine

From the repo root:

```sh
node cells/lab/devtools/labyrinth-intent.mjs --out=intent-review-001 --cases=land3,land11,stone,story12 --n=3
```

Use a fresh output directory. Capture writes an incomplete manifest first, checkpoints each gesture, and marks the batch complete only when finished. Outcomes and logs are not printed. Failures waiting for frames or camera settlement abort rather than silently labelling an unsettled frame as settled.

The new output layout replaces the old mixed before/after images and log.json. Do not make contact sheets of the entire batch for a blind reviewer: later before frames contain earlier outcomes. Copy the complete output directory to the machine running the offline commands if needed, keeping `sealed/` out of the reviewer's browsing context.

## Judge one gesture at a time

```sh
node cells/lab/devtools/labyrinth-intent-review.mjs next intent-review-001
```

This returns paths for ONLY the current before image, visible context and expectation template. Open those files, not `sealed/`. The before image includes the controls/mode, white start ring, end arrow, tap dot and dotted pause rings. The JSON records screen points and planned dwell timing; it does not disclose the solver, result, hidden picks or generator target coordinates.

Fill the returned `expectation.json`:

- Describe the scene as seen, not inferred from implementation rules.
- Give one or more plausible intentions, with visible evidence and 0..1 plausibility (independent judgments, not necessarily summing to one).
- Name a preferred hypothesis, but retain credible alternatives and ambiguities.
- Give observable success criteria for EACH hypothesis.
- Say what must remain unchanged, which surprises would be unacceptable, and what feedback should appear while drawing.
- Set reviewer identity and `blind: true` only if the result has not been inspected.

Commit before exposing the result:

```sh
node cells/lab/devtools/labyrinth-intent-review.mjs expect intent-review-001
node cells/lab/devtools/labyrinth-intent-review.mjs reveal intent-review-001
```

`expect` creates an exclusive lock containing the expectation and a SHA-256 binding to the before JSON and image. `reveal` refuses without it and returns the after image, diagnostics, locked expectation and critique template. Repeating reveal is safe; rewriting the expectation is refused. These are workflow guards against accidental hindsight, not protection from a reviewer deliberately reading or modifying files.

Fill `critique.json` against the original criteria, without revising them. For every criterion record met/missed/uncertain and evidence. Distinguish:

- what the after image actually shows;
- what diagnostics establish;
- possible implementation causes, which remain hypotheses.

Use verdict fulfilled, acceptable-alternative, partial, misread, no-effect or unjudgeable. Match a precommitted hypothesis or null. Assess preservation, feedback, recovery and the next experiment. Say unknown/not exercised when evidence is missing; the event log is not a video or a user study.

```sh
node cells/lab/devtools/labyrinth-intent-review.mjs critique intent-review-001
node cells/lab/devtools/labyrinth-intent-review.mjs next intent-review-001
node cells/lab/devtools/labyrinth-intent-review.mjs status intent-review-001
```

The next cumulative scene is exposed only after the previous critique is committed. `expect` and `critique` accept an optional third argument specifying an external JSON answer file. Review locks include hashes and timestamps; no model-generated judgments are manufactured by the tool.

## Captured evidence

Under `sealed/<id>/` (read through the staged commands):

- `before.jpg`, `before.json`: blind visual prompt and visible interaction context.
- `replay.json`: pre-gesture encoded world, camera, mode, generator seed/query, exact screen points, planned delays, and actual picked surfaces. This is diagnostic replay data, not an automatic replay command; timing varies with the renderer.
- `after.jpg`, `result.json`: settled output, appended operations, per-operation `reached` where available, new declines only, offered alternatives, before/after geometry changes, post-world/camera and browser errors.
- Delivered pointer events include relative times, sampled hints, fan state and solver result. Observation uses event listeners rather than adding screenshot delays inside the gesture.

`operationAppended` deliberately does not mean success. A ground-paved Way can change geometry without adding mass, so deltas include paving, stairs and courts as well as mass. `reached: null` means not applicable/not reported, not success. A stair tower can be a valid alternate construction while failing a preferred request for a visible stair.

Current limitations remain explicit: mouse input at DPR 1; instant construction with cats disabled; random cases do not guarantee gesture coverage; no during-stroke video; generated targets may be occluded. The committed expectation is a reviewer's reasonable interpretation, not proof of the original person's mental intention.

## Checks without WebGL

```sh
node --check cells/lab/devtools/labyrinth-intent.mjs
node --test cells/lab/devtools/labyrinth-intent-review.test.mjs
```

Tests cover reveal gating, exclusive expectations, before/result integrity, sequential scene exposure, criterion completeness and incomplete-capture rejection. Browser capture must additionally be exercised on a machine with the harness's renderer and dependencies.

## Run locally without WebGL (preferred for semantic intent evaluation)

The headless backend imports the actual production `gesture.ts`, `model.ts`, `nav.ts`, `buildings.ts`, `land.ts` and RNG. It needs Node >=22.15 with `registerHooks`/`stripTypeScriptTypes` (verified on Node 24.19). It does not load Playwright, esbuild, a browser, the rendering code or the DOM. SVG plan diagrams and machine-readable scene descriptions replace screenshots.

```sh
node cells/lab/devtools/labyrinth-intent.mjs --headless=prepare --out=intent-headless-001
node cells/lab/devtools/labyrinth-intent-review.mjs next intent-headless-001
# Inspect before.svg / before.json, write expectations.
node cells/lab/devtools/labyrinth-intent-review.mjs expect intent-headless-001
node cells/lab/devtools/labyrinth-intent.mjs --headless=execute --out=intent-headless-001
node cells/lab/devtools/labyrinth-intent-review.mjs reveal intent-headless-001
# Inspect after.svg / result.json, write critique.
node cells/lab/devtools/labyrinth-intent-review.mjs critique intent-headless-001
# next -> expect -> execute -> reveal -> critique, for each remaining case.
```

Unlike browser capture, headless preparation does not even execute the proposed gestures. Execution is gated on an expectation lock and verifies both the before packet and the production-source fingerprint. Execution cannot overwrite an existing result. The six default independent scenarios cover a bridge, paused climb, closed court, short steep climb, and paired obstructed Way/Mass strokes. These deliberately targeted cases are not a statistical usability sample.

`--spec=cases.json` accepts an array of custom cases: `id`, `seed`, optional `landSeed` or encoded `world`, `blocks` as `[i,j,topHeight]`, `mode`, ordered `path` as `[i,j]`, `rests`, optional explicit `start`/`end` Pick objects, and `box` as `[i0,i1,j0,j1]`. The world is constructed, then endpoints default to the column's ground or contiguous top. Use one path point for a tap. Explicit picks allow side contacts and `end:null` allows extending into space. The same case can be varied in length, shape, endpoints and pauses without graphics dependencies.

This backend tests the interpretation and construction AFTER picking/projection/dwell detection. It does not pretend to exercise those UI stages. Diagram heights, stairs, gates and route cells are a schematic of model state, not visual proof of the rendered result. Exterior and building-interior-inclusive connectivity are separate diagnostics. Existing source knowledge should be disclosed in the reviewer identity; outcome-blind is not the same as a naive user study.

```sh
node --test cells/lab/devtools/labyrinth-intent-review.test.mjs cells/lab/devtools/labyrinth-intent-headless.test.mjs
```

The added integration test actually runs the production model in headless mode, verifies no outcome exists during preparation, rejects premature execution, commits an expectation and checks the executed bridge and SVG reveal.
