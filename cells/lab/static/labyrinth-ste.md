# Labyrinth: specification and critique (ASD-STE100)

## 0. About this document

### 0.1 Purpose

This document gives the specification of the Labyrinth experiment. It also gives a critique of the experiment in its current condition. Use the specification to examine, change, or make the experiment again. Use the critique to find the work that is necessary next.

### 0.2 Language

This document uses ASD-STE100 Simplified Technical English (STE), Issue 9:
- Descriptive sentences have a maximum of 25 words.
- Instructions have a maximum of 20 words.
- The verbs are in the active voice.
- Each requirement has an identifier (for example, REQ-IN-3).
- "Must" shows a requirement. "Can" shows a possibility.

Words that are not in the STE dictionary are technical names (TN) or technical verbs (TV). Section 0.3 lists the TN and TV that this document uses. A person did not do a check of this document with an STE checker tool.

### 0.3 Technical names and technical verbs

| Term | Type | Meaning in this document |
|---|---|---|
| app | TN | The Labyrinth web page and its program |
| brush | TN | A tool in the bottom bar that sets what a touch does |
| cell | TN | One square of the grid, in plan |
| column | TN | All the levels of one cell, from the ground up |
| level | TN | One unit of height. One storey is one level |
| op (operation) | TN | One recorded change to the world |
| reading | TN | One interpretation of a gesture or of a built part |
| alternative | TN | A reading that the app shows but does not build |
| liberty | TN | A difference between the stroke and what the app builds |
| top | TN | The upper surface of built stone |
| way | TN | A route that a person can walk: paving, a stair, a walkway, a bridge |
| mass | TN | Built stone: a block, a wall, a tower |
| land | TN | The seeded terrain under the built parts |
| dial | TN | A numeric setting of the drawing, in the address or on a slider |
| reach | TN | The distance from built parts to which a drawing layer goes |
| print mode | TN | The mode in which the bottom bar shows the drawing layers |
| harness | TN | A program that operates the app in a headless browser for a test |
| tap | TV | To touch the screen and lift the finger without movement |
| drag | TV | To move a finger on the screen while it touches the screen |
| trace | TV | To drag a finger along a path to make a stroke |
| pinch | TV | To move two fingers together or apart on the screen |
| draw | TV | To make the picture of a thing on the screen |
| render | TV | To calculate the picture with the GPU |
| deploy | TV | To send the cell to its server so that users can open it |

## 1. Description

### 1.1 What the app is

Labyrinth is an architecture game for a phone. The user touches a piece of land. The app interprets the gesture and builds stone, ways, and gardens. The app then makes the structure stable: it adds arches, piers, stairs, courts, and roofs.

The design aim is this: "Townscaper interprets where you place blocks. Labyrinth must interpret what you try to construct."

### 1.2 Where the app is

| Item | Location |
|---|---|
| Live page | https://c15r-lab.on.parc.land/labyrinth |
| Source | `cells/lab/client/labyrinth/` (26 TypeScript files, approximately 12,200 lines) |
| Page | `cells/lab/static/labyrinth.html` |
| User guide | `cells/lab/static/labyrinth.md` |
| Drawing guide | `cells/lab/static/labyrinth-look.md` |
| Harnesses and tests | `cells/lab/devtools/labyrinth-*.mjs` |
| Intent reviews | `cells/lab/devtools/intent-reviews/` |

### 1.3 Main parts

| Part | File | Function |
|---|---|---|
| World model | `model.ts` | Holds the grid, the ops, the undo history, and the rules that make a structure stable |
| Land | `land.ts`, `terrain.ts` | Makes the seeded terrain and its surface |
| Gestures | `gesture.ts` | Reads taps and strokes and gives readings |
| Pieces | `palette.ts` | Puts one exact piece or dressing |
| Encounters | `encounters.ts` | Resolves where two built parts meet |
| Mesh | `mesh.ts`, `strokes.ts` | Makes the geometry and the ink marks |
| Renderer | `render.ts` | Renders the picture with WebGL2 in passes |
| Print layers | `layers.ts` | Holds the dials and the print-mode palette |
| Cats | `cats.ts`, `perches.ts`, `catbody.ts` | Simulates and draws the resident cats |
| Page | `main.ts` | Connects input, camera, the world, and the renderer |

## 2. Specification

### 2.1 Platform

- **REQ-PL-1:** The app must operate in a mobile browser with WebGL2.
- **REQ-PL-2:** The app must operate with one finger. Two fingers must turn, tilt, and zoom the view.
- **REQ-PL-3:** The server must give the page and its files only. The world must stay on the device (local storage).
- **REQ-PL-4:** The address must be able to open a fixed world (`?story=`, `?ops=`, `?land=`). A fixed world must not write to local storage.

### 2.2 World model

- **REQ-WM-1:** The grid has 48 × 48 cells. The height has no limit.
- **REQ-WM-2:** Each change to the world must be one op. The app must be able to undo, record, and replay each op.
- **REQ-WM-3:** The rules must calculate all derived parts again after each op. Derived parts are arches, piers, courts, doors, roofs, retaining walls, bowls, and parapets.
- **REQ-WM-4:** A reading that the user selects is an op. After that, the rules must not change that part again.
- **REQ-WM-5:** Each op must record its liberties (`Op.took`). The harnesses count these liberties.

### 2.3 Land

- **REQ-LA-1:** A seed must make the land. The same seed must always make the same land.
- **REQ-LA-2:** The land must give reasons to build: a rise, a ravine with a stream, an outcrop, and flat benches.
- **REQ-LA-3:** The land holds one integer level for each column. The drawn surface must agree with these levels: at the centre of a cell, the difference must be a maximum of a quarter level.
- **REQ-LA-4:** When the user builds within two cells of the edge, the land must extend by four cells in that direction. Undo must remove the extension.
- **REQ-LA-5:** The stream must stay open. Fill must not cover the channel.
- **REQ-LA-6:** "Start again" must remove all built parts. On bare land, "start again" must make a new land.

### 2.4 Brushes

| Brush | Tap | Trace |
|---|---|---|
| hand (default at start) | Takes up the touched part. A second tap takes up a larger part. A tap on nothing puts the part down. On bare land, the app tells what is there. | Turns the view |
| auto | Raises stone | Builds a wall, a way, a walkway, or a stair. Section 2.5 gives the rules. |
| piece | Puts one piece or one dressing | Puts a row of pieces, or dresses each stone on the path |
| take | Removes the outermost part | Cuts through. An arch holds what is above the cut. |
| select | Takes up a part. A second tap takes up a larger part. | Turns the view |

- **REQ-BR-1:** The app must start with the hand brush.
- **REQ-BR-2:** A selection must stay when the card is closed. Only a building brush, the × button, or a tap on nothing can put the selection down.
- **REQ-BR-3:** The card must show the name of the selection. A chevron must open the details: scope, readings, dressing, and "take it away".

### 2.5 Interpretation of gestures

- **REQ-IN-1:** The app must not ask what a stroke is for. The app must read the purpose from the place of the stroke.
- **REQ-IN-2:** A stroke that goes to a different height, follows paving, or starts at an entrance is a way. A stroke along a top or out from a top is mass.
- **REQ-IN-3:** The location of the gesture belongs to the user. The form of the result belongs to the rules. A route around an obstacle must stay within one cell of the stroke.
- **REQ-IN-4:** A way must not go into the land, into built parts, or into water. An arch must hold a way over water.
- **REQ-IN-5:** While the finger moves, the app must show the current reading. The app must show the start point, the route, the target top, and a label.
- **REQ-IN-6:** When a way stops before its end, the app must say so.
- **REQ-IN-7:** When the user holds the finger still at the end of a stroke, the app must show the alternatives. The app must not build an alternative that the user did not select.
- **REQ-IN-8:** The app must not show a reading that adds nothing.
- **REQ-IN-9:** A gesture done again on the same place must develop the result. A way becomes wider, then covered. A wall becomes one course higher.
- **REQ-IN-10:** A way that the user makes must stay open. Stone added later must make an arch or a gate over the way.
- **REQ-IN-11:** A drag that goes straight up or down the screen from a top lifts or lowers that stone. During the drag, the app must say "lift" or "lower".

### 2.6 Rules that make a structure stable

- **REQ-RU-1:** Stone with nothing below it must get an arch, an arcade, or a pier.
- **REQ-RU-2:** Walls that close around ground must make a court.
- **REQ-RU-3:** A stair must climb only where the stroke goes straight. A stair must turn only after a landing.
- **REQ-RU-4:** A way that goes to the foot of a building must make a door.
- **REQ-RU-5:** A bank next to a used area must get a retaining wall.
- **REQ-RU-6:** Water in a basin must flow out at one spout. Water that falls must land in water or in a bowl.

### 2.7 Plants

- **REQ-PN-1:** Planting is an alternative of the same gestures. Planting does not have its own mode.
- **REQ-PN-2:** A plant that the user touches again must grow to the next size.
- **REQ-PN-3:** Plants must not grow on a way, on a stair, or in water.

### 2.8 Cats

- **REQ-CA-1:** The number of cats must follow from the habitable places, not from the quantity of stone.
- **REQ-CA-2:** Each cat must keep its name, coat, character, and favourite places for each land.
- **REQ-CA-3:** A cat must not fall. A cat must not stop the user from building.
- **REQ-CA-4:** When the user follows a cat, the view must stay on the cat. The zoom must stay with the user.

### 2.9 Drawing

The picture is three layers on paper, in multiply: colour × light × ink. Each layer has a strength and a reach.

| Layer | Dials | House setting |
|---|---|---|
| Colour | `built`, `terrain`, `water`, `colourreach` | 0.8, 0.3, 0.8, ×1 |
| Light | `shade`, `cast`, `hollow`, `landlight`, `lightreach` | 1.15, 0.75, 1.15, 0.45, ×1 |
| Ink | `lines`, `edges`, `inkreach`, `inkfade` | 1, 1, ×1, 0 |
| Drawing under the picture | `under` | 0.7 |
| All to the page | `toward` | 0 |

- **REQ-DR-1:** Without dials, the app must draw the house setting. `?look=picture` must draw the lit picture with all layers at full value.
- **REQ-DR-2:** Each reach must apply to the land only. Built parts must keep their colour and light at all reaches.
- **REQ-DR-3:** Trees and climbers within two cells of built parts must use the values of the built parts.
- **REQ-DR-4:** Light that goes past the colour must show in sepia, not in grey.
- **REQ-DR-5:** A cast shadow must have one strength on all surfaces.
- **REQ-DR-6:** The `lines` dial must control all ink marks: the marks, the contours, and the hatching.
- **REQ-DR-7:** The outlines on the land must follow `inkreach` and `inkfade`.
- **REQ-DR-8:** `?land=` is the land seed. The land colour dial must use the name `terrain`.

### 2.10 Print mode

- **REQ-PR-1:** In print mode, the bottom bar must show five layers in this sequence: page, under, colour, light, ink.
- **REQ-PR-2:** A tap on a layer must open its sliders below the layer row. The picture must change while the slider moves.
- **REQ-PR-3:** Each slider must show a mark at the house value. A double tap on the slider name must put the house value back.
- **REQ-PR-4:** The address must keep `?print` and each dial that is different from the house setting.
- **REQ-PR-5:** In print mode, the touch on the land must only turn the view and take up parts. When the user leaves print mode, the previous brush must come back.

### 2.11 Verification

| Check | Command | Condition at the date of this document |
|---|---|---|
| Model and land tests | `node --test devtools/labyrinth.test.mjs` | Pass |
| Shaders compile | `node devtools/labyrinth-shaders.mjs` | Pass |
| Browser smoke test | `node devtools/labyrinth-smoke.mjs` | 2 checks fail (cat follow: a tap on a place, and the walk to that place). These checks failed before the current work. |
| Drawing | `node devtools/labyrinth-look.mjs --tag=NAME` | Five fixed views for comparison |
| Interpretation | `labyrinth-intent.mjs`, `-review.mjs`, `-replay.mjs` | Blind reviews by model reviewers (section 3.1) |

## 3. Critique

Each finding has a condition, an effect, the evidence, and a severity. The severities are: 1 (high), 2 (medium), 3 (low).

### 3.1 Interpretation

**F-1. Strokes do not do what the user intends. Severity 1.**
- Condition: the app reads taps well but reads strokes badly.
- Evidence: in the intent-first battery (land-003), 11 of 12 taps were good. Only 4 of 20 strokes were good against the written intent.
- Effect: for strokes, the app does not do its main aim ("interpret what you try to construct").

**F-2. The app removes the shape of a stroke. Severity 1.**
- Condition: the app makes a winding stroke straight (the `smoothed` liberty).
- Evidence: every winding path and most climbs in land-003 had this liberty, also when the zigzag was 1.3 cells wide.
- Effect: the user must find "as drawn" in the alternatives. A reviewer said: "the thing I actually drew is buried in the hold-at-the-end alternatives."

**F-3. A closed loop does not make an enclosure. Severity 2.**
- Condition: a loop on open ground makes a raised ring way ("a walk all the way round").
- Effect: the court, which is the probable intent, is only an alternative.

**F-4. A climb looks flat. Severity 2.**
- Condition: a way to higher ground becomes a level terrace with a short stair.
- Evidence: reviewers said "height changes come out as flat terraces." From a top, 0 of 3 strokes that went up were good (critique-001).

**F-5. Water stops a way. Severity 2.**
- Condition: two of four crossings stopped at the bank or became a landing stage.
- Effect: when a crossing has a span, it is heavy ("a grand fortified causeway"). A light bridge occurred once.

**F-6. Results are too heavy. Severity 2.**
- Condition: short strokes make parapets, crenellations, and wide decks.
- Evidence: reviewers in every round said "everything turns into crenellated fortress."
- Effect: heavy results hide the land and the next targets. In land39, a castle from one gesture hid the stream from the next gesture.

**F-7. The alternatives do not answer the failure. Severity 2.**
- Condition: most alternatives give a different kind of thing (plantings: 40 of 100, wall variants: 35 of 100).
- Effect: the failures are about height, shape, distance, or weight. The alternatives do not change these. Undo is the only real recovery.
- Note: "as drawn" now shows in 9 of 20 strokes. Before, it showed in 3 of 33.

**F-8. One gesture has two meanings. Severity 2.**
- Condition: a short drag straight down the screen from a top lowers the stone. The same drag can be "a way down to the water in front".
- Evidence: land37-2 removed the block that the user wanted to start from.
- Effect: the app now says "lower" during the drag. The conflict in the gesture vocabulary stays.

### 3.2 Terrain and feedback

**F-9. The drawn hill and the column levels can disagree. Severity 2.**
- Condition: before the fix, the drawn ground was more than half a level from the column level on 8% of cells.
- Effect: a user saw a slope, and the app read level ground (land27-4, land29-1).
- Condition now: REQ-LA-3 holds the centre within a quarter level. The cell edges can still show a slope that the columns do not have. Examine this again with a new battery.

**F-10. Labels tell about parts that the app does not build. Severity 3.**
- Evidence: "a gated wall" with no gate. A pause that the label calls a gate or a landing, but the app builds neither.

**F-11. The view moves after a build. Severity 3.**
- Condition: the camera frames the build again. Only `?held` stops this.
- Effect: the user loses the place of the last gesture. One reviewer disagreement came from this movement.

### 3.3 Drawing

**F-12. The drawing has too many dials for a first use. Severity 2.**
- Condition: print mode has 15 dials in 5 layers and 5 start points.
- Evidence: the user said that the earlier model was "hard to reason about." The reach model and the layer views made it clearer.
- Effect: the dials are good for study. They are too many for a person who only wants a print.

**F-13. The house setting and the preferred setting are different. Severity 2.**
- Condition: the house setting has land colour 0.3, full ink, and drawing under the picture at 0.7.
- Evidence: the user moved to full built colour and a land colour of 0.2 or less. The user also set a short colour reach, a long light reach, softer ink, and almost no drawing under the picture.
- Effect: the default does not show the look that the user prefers.

**F-14. The roofs are the strongest colour. Severity 3.**
- Condition: at built colour 1, the terracotta roofs are the only strong colour.
- Effect: the `built` dial controls the roofs more than the walls. The cream walls change very little.

**F-15. The cost of each pixel increased. Severity 2.**
- Condition: the light by kind adds three display transforms for each fragment. The outline pass reads five samples more.
- Evidence: the study view has approximately 317,000 vertices and 134,000 mark vertices.
- Effect: there is no measurement on a phone after these changes. The frame time on a phone is not known.

### 3.4 Engineering

**F-16. Three files are too large. Severity 2.**
- Condition: `mesh.ts` has 2,118 lines. `render.ts` has 1,261 lines, with GLSL in template strings. `main.ts` has 1,203 lines.
- Effect: a change to one function needs a change to code in many parts of one file. Shader errors show only when the shaders compile.

**F-17. The user guide does not agree with the app. Severity 3.**
- Condition: the "Land" section of `labyrinth.md` tells about shelves, cliffs with a grey wash, and hatched banks.
- Evidence: stages 21 to 23 changed the land to a continuous hill with benches, outcrops, and crags.

**F-18. Two smoke checks fail. Severity 2.**
- Condition: the cat-follow checks fail on each run. No person is responsible for them.
- Effect: a failed run is normal now. Thus a person can easily not see a new failure.

**F-19. The intent data has no human calibration. Severity 2.**
- Condition: model reviewers do all reviews. For 31 of 33 random strokes, the reviewers preferred a route.
- Effect: the rates can show the prior of the reviewers, not the intent of a person.

**F-20. The app does not follow two tenets of the workspace. Severity 3.**
- Condition: the workspace tenets are "mobile first React", "AWS native", "TypeScript", and "MCP native". The app is TypeScript and mobile first, and the server is AWS. But the app does not use React, and it has no MCP interface.
- Effect: an agent cannot read, make, or share a labyrinth through MCP. A world stays on one device, or in a long `?ops=` address.

### 3.5 What works

- Taps are correct: 16 of 17 in the random rounds and 11 of 12 in the authored round.
- The app builds well onto parts that are already there: a stair down from a block, a gate on a walkway.
- The rules make good structure: arches, courts, retaining walls, and water that falls into bowls.
- The cats show how a person can live in the places. Their routes use the structure correctly.
- The layer model of the drawing is clear. Each layer is a strength and a reach, and the user can examine each layer alone.

## 4. Recommended actions

Do these actions in this sequence. The first actions remove the most serious failures.

| Step | Action | Findings |
|---|---|---|
| 1 | Keep the shape of a stroke by default. Make the straight version the alternative. | F-2 |
| 2 | Use the height at the end of a stroke from a top. Make a way up or down, not a level walkway. | F-4 |
| 3 | Make a loop on open ground into a court by default. | F-3 |
| 4 | Make the default result lighter: a footpath before a terrace, a span before a causeway. | F-5, F-6 |
| 5 | Give alternatives for height, shape, distance, and weight, not more plantings. | F-7 |
| 6 | Make the lift gesture start only after a hold, or only from a selection. | F-8 |
| 7 | Run a new intent-first battery: a new land for each intent, strokes longer than 40 px. | F-1, F-9 |
| 8 | Add a small calibration set that a person reviews. | F-19 |
| 9 | Measure the frame time on a phone. Compare the house setting with the user's setting. | F-15 |
| 10 | Make the user's preferred look the house setting, or add it as a start point. | F-13 |
| 11 | Show three or four simple sliders first in print mode. Keep the full dials in an "all" view. | F-12 |
| 12 | Fix the cat-follow checks, or remove them and record why. | F-18 |
| 13 | Divide `main.ts`, `render.ts`, and `mesh.ts` into modules. Put the GLSL in its own files. | F-16 |
| 14 | Write the "Land" section of `labyrinth.md` again for the current hill. | F-17 |
| 15 | Add an MCP interface: read a world, apply an op, and save a world as a workspace fact. | F-20 |
