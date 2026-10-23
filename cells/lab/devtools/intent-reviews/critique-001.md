# Labyrinth intent rounds: analysis and critique

This document draws on three sources:
- **Primary reviews:** 50 blind-reviewed gestures on 14 unseen lands, in [land-001](land-001.md) and [land-002](land-002.md).
- **Second reviews:** 17 of those gestures re-judged by fresh, independent blind reviewers.
- **Measurements:** made against the sealed data and the source after every review was locked.

It critiques three things: the toy, the method, and my own two earlier write-ups. Where a claim rests on the source rather than on reviewers, it says so.

**Files:**
- `features-001.json`: one row per gesture: start surface, column height change, length, water, run position, reviewer confidence, verdict, diagnostics.
- `second-reviews-001.tar.gz`: the second reviews (JSON only).

## 1. How far the data can be trusted

**Reviewers agree with each other** on the 17 doubly-reviewed gestures:
- Exact verdict 14/17; success vs failure 14/17; location honoured 14/17.
- The preferred intent was the same in substance in 16/17.
- Coherence matched exactly in 10/17 (mean difference 0.41, the second reviewers about a step kinder on taps). The hand's likely next move matched in 10/17, which makes it the weakest axis. Don't lean on it.

The three verdict disagreements each have a nameable cause:
- **land10-3:** how harshly to judge a walkway left mid-air ("misread" or "acceptable alternative").
- **land14-1:** how much a buried pool counts against a correctly placed block.
- **land27-1:** a camera reframe made a correctly placed block look 45 px off the tap. The view moving after a build confounds judgments of location.

**But agreement between two models isn't validity.**
- **Shared prior:** the reviewers share one. For 31 of 33 strokes the preferred reading was a route (a path, way, stair, bridge or causeway). So a stroke the toy builds as a wall is almost always a "miss", whatever a person meant.
- **No human ground truth.** Nothing here calibrates either reviewer against a person.

**The gestures are weakly intentional.** They come from a random generator: a kind is drawn by weight, and control points are scattered between two random cells.
- **Low confidence:** the reviewers' confidence in their own preferred reading has a median of 0.45 (range 0.35–0.65).
- **Ambiguity:** in 21 of 33 strokes the best reading led the next by less than 0.25.
- **What is measured:** whether the toy's reading matches the most plausible reading of a semi-random line. That's a fair test of legibility, but "intent" here is imputed, not authored.

**"Acceptable alternative" absorbs mismatches.** In 16 of 50 gestures the result matched a hypothesis other than the reviewer's preferred one. Strokes whose intent the reviewer judged clear succeeded less often (5/12) than ambiguous ones (12/21). When the line is clearly meant, the toy's liberties show; when it's vague, almost anything passes.

**The solver's own success flag isn't the user's.** For strokes with a `reached` diagnostic:
- it agreed with the reviewers' endpoint judgement in only 8 of 25;
- it said `reached: true` in 21, of which the reviewers judged the endpoints only partly honoured (13) or not at all (1).

`reached` must not be used as a proxy for "it went where the finger went".

**Coherence saturates:** 35 of 50 gestures scored 2. It separates the few disasters from the rest and little else.

## 2. What the data says about the toy, by confidence

### Verified defects (high confidence: in the source, and reproduced in the data)

- **The hint under the finger is a stale refusal.** It contradicted the result in 18 of 33 strokes. While drawing, `main.ts` puts only refusals on the hint line. A stroke's first moves are always refused, and nothing replaces that text when the reading becomes valid. Both second reviewers found it independently.
- **A walkway that stops short says nothing.** Three walkways stopped after 1–3 cells (`reached: false`); the toy said "a walkway". The stop message is gated on the stroke ending on a top (`connect.to`).
- **Already fixed** after land-001: the stream buried beside a bench, and the screen-direction lower. Neither recurred in set 4 or in the replay of set 3.

### Structural: the drawn hill and the model's columns disagree (high confidence; new)

**My stage-21 hill is the cause.** It blends each column's level with its neighbours' through a Gaussian, adds noise, and adds rough patches. At a column's centre, the drawn ground departs from the column's level by:
- more than **half a level** on about 8% of open cells;
- more than a quarter on about 35%;
- up to about **1.1 levels**.

These figures come from four lands, all cells interior to the land. This is not an edge effect; I checked.

**The interpreter reasons on integer column levels; the reviewer, like a player, reads the drawn slope.**
- **land27-4:** every column along the stroke is level 4, but the drawing climbs from 3.13 to 4.33. The reviewer read a climb; the toy, seeing level ground, built a wall. Misread.
- **land29-1:** every column is level 3; the drawing falls from 3.28 to 2.54. The reviewer expected steps down and got flat paving.

This contradicts the stage-21 requirement that every query agree with the drawn surface: the gesture's reading doesn't. It also means some failures I attributed to the interpreter are partly the terrain's.

### Patterns in the reading (medium confidence: consistent across both sets and both reviewer pairs, small n)

**The start surface and the mode decide the reading, not the end or the shape.** Fraction of strokes judged fulfilled or acceptable:

| Stroke | Good |
|---|---|
| starts on the ground | 12/20 |
| starts on a built top | 4/11 |
| from a top, ending higher | 0/3 |
| from a top, level | 2/5 |
| from a top, ending lower | 3/5 |

From a top the reading is a level walkway, a wall or a tower, whatever height the stroke ends at.

**By height change** (from the columns' levels, so read it with the structural finding above in mind):
- **Level strokes are the worst class** (3/12). With no height cue, the reading falls back on mode defaults: Mass gives walls, a top gives a walkway.
- **Strokes down to something** do best (7/10). The way down to water or a landmark fits the vocabulary.

**Water isn't worse than dry ground** in verdicts (9/15 against 8/18). Crossings are accepted as alternatives, but they're heavy: decks, causeways, quays. A light bridge appeared once.

**Later gestures in a run aren't harder:** n1 9/14, n2 10/14, n3 9/14, n4 5/8.

**Strokes come out heavier and straighter than drawn.** Both primary and second reviewers say so in their own words: "a winding trail became a wide straight quay", "a light stroke up the slope became a heavy fort", "heavy straight terraces that ate the boulder".

### Recovery is effectively absent (high confidence)

**One of 16 failed strokes** offered the reading the reviewer wanted among its alternatives: land25-3, with "… a bridge of 1".

**What the 100 alternative labels on strokes were:**

| Kind | Count |
|---|---|
| Plantings (olives, hedge, cypresses) | 40 |
| Wall variants | 35 |
| End or meeting details | 10 |
| Other routes | 9 |
| "As drawn" | 3 |

The fan answers "what kind of thing", not the questions that failed: how high, which shape, how far, how heavy, over or down. For the hand, undo is the only real recovery.

### Legibility (medium confidence)

- **The view reframes after most builds,** and the coloured region follows the build. One verdict disagreement is directly due to it.
- **Labels promise what the picture doesn't show:** a gated wall with no gate, "a walk all the way round" that reads as a forecourt, a pause acknowledged as a gate or landing and then neither built.
- **Taps are never named;** after a tap on a top the hint goes blank.
- **Rocks near new building vanish or swallow the block's foot.** Reviewers in both pairs noticed it. It's likely my stage 22–23 scatter, which clears and re-places rocks by bench and steepness. Not verified.

### What works (high confidence)

- **Taps:** 16/17 good, every one at the finger.
- **Building onto what's there:** a stair down off a block, a gate on a walkway. Most of the coherence-3 results are these.

## 3. Corrections to my earlier write-ups

- **land-001** guessed that the stale hint was "context loss" (the open task #129). It was wrong: it's the refusal-only hint logic.
- **"Crossings never read as bridges, and the stream disappears"** blended a rendering defect with an interpretation preference. With the stream fixed, wet strokes do no worse than dry ones in verdicts. The finding is about weight, not failure.
- **"Strokes from a top: 0 of 7"** was set 3 alone. Across both sets it's 4 of 11. The real pattern is that the end's height is ignored: 0 of 3 going up.
- **I under-weighted level strokes and over-weighted water.**
- **I didn't consider that my own terrain change could produce interpretation failures.** It does, at least twice.
- **Set 4's better headline was mostly the generator drawing more taps.** I said so, but the numbers were still presented as rates.

## 4. What to do next

**First, defects and confounds, so the next measurement means something:**
1. **The stale hint:** say the current reading under the finger, not only refusals.
2. **The silent short stop:** say when any way stops short.
3. **Make the drawn hill honour the levels the interpreter uses.** Either hold each column's centre within a quarter level of its level, or read strokes against the drawn surface. Until then, every slope-related judgment is confounded.
4. **Hold the camera after a build in captures,** or record it, so location is judged on the land and not on pixels.

**Then the interpretation questions, which need design decisions:**

5. **The end's height should shape a stroke from a top:** a way down or up, not a level walkway.
6. **Alternatives along the dimension that failed:** as drawn, down to it, reach the end, lighter. These would replace a second planting or the fourth wall variant.
7. **Weight:** decide what a short line on open ground should become by default: a footpath, a paved way, or a terrace.

**And the method:**

8. **An intent-first battery.** Write the intent ("bridge the stream here", "stair down from this block to the water"), draw the gesture a person would, then run two blind questions:
   - **Gesture legibility:** does a reviewer recover the authored intent from the gesture?
   - **Toy interpretation:** does the result match the authored intent?

   Random lines conflate the two, and leave "intent" to a reviewer's prior.
9. **A small human-reviewed calibration subset**, to check the model reviewers' route-reading prior.
10. **Keep two reviewers per gesture** on a sample. Report agreement next to every rate, and drop the hand's-next-move axis or define it more tightly.
