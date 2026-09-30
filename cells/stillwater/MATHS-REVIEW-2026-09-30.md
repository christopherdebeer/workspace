# Stillwater: from collecting totals to mathematical relationships

30 September 2026. Implemented directly in the cell; research-informed design,
not a validated educational intervention or a complete syllabus.

## Vocabulary

A **challenge** is one prompt and its response. A **skill** is the mathematical
relationship being practised (missing part, inverse, equivalence, factor pair).
A **representation** is how that relationship is made visible (equation,
part-whole diagram, equal groups, physical dew). A **range** is a starting
point and practice band, not an age label, achievement level or exam grade.

## Audit of the previous implementation

- `numeracy.ts` had two rules: sum selected drops, or sum identical leaves.
  The five stages changed number ranges and scaffolds, not this underlying task.
- `ui.ts` showed a total, even for `times`. The multiplication operands and
  equal-group constraint were invisible after the short hint faded.
- `chooseActivity` tried whichever stages the visible inventory could support.
  Sparse or skewed dew could silently substitute an easier task. A larger
  printed total did not imply a harder mathematical relationship.
- A global scalar and overlapping stage weights retained simple gathering
  indefinitely. Session warm-up and two relief steps biased it further downward.
- Missing addends, subtraction, division equations, equivalence with expressions
  on both sides, and derived facts were absent. Dew capped facts at six per leaf.
- `quality` penalised elapsed time although it included visual search, motor
  work, watching fish and exploring. `scaffold` exposed solution leaves after
  7/14/22 seconds, even if no help was wanted.
- “Another way” and two-leaf language were stronger than their enforcement:
  old consolidation did not reject the previous partition, and an exact
  one-leaf sum could bypass the bond constraint. These are not used by the new
  normal relationship loop; legacy stage URLs remain diagnostic only.
- Existing memory measured collections of counts. It cannot establish that a
  learner understands subtraction, equality, inverse operations or factorisation.
  Its old “by heart” page must not be read as a curriculum assessment.

## Research and the decisions it informs

Education Scotland's Numeracy and Mathematics Benchmarks describe relationships
and symbols at First Level and unknown values at Second Level (MTH 1-15a/b,
MTH 2-15a). These support teaching missing numbers explicitly; they do not imply
that all eight-year-olds should receive the same question range.
https://education.gov.scot/media/s5edgtvx/numeracyandmathematicsbenchmarks.pdf

NCETM's multiplicative-thinking guidance separates number of equal groups,
size of each group and total, and links these to the multiplication expression.
That is a better bridge than silently asking the learner to collect a product.
https://ncetm.org.uk/features/introducing-multiplicative-thinking/
https://www.ncetm.org.uk/classroom-resources/lv-algebra/

EEF's Improving Mathematics in Key Stages 2 and 3 recommends assessment of
existing understanding, purposeful representations, strategies, and connections
between facts, procedures and concepts. Its recommendations support the design
principles here, not the particular scheduling thresholds chosen for this app.
https://educationendowmentfoundation.org.uk/education-evidence/guidance-reports/maths-ks-2-3

## Implemented

`client/challenges.ts` owns pure expression trees, generation, validation,
feedback and a separate per-profile curriculum store. The river inventory no
longer restricts the question. No string evaluation or answer-choice guessing.

| Starting range | Content |
|---|---|
| Dew & counting | 2–5, existing physical collection; after three clean collections introduces relationships |
| Parts to 20 | Missing addends, subtrahends and minuends; equality in both orientations |
| Relationships to 100 | Larger missing parts, subtraction, expressions on both sides |
| Equal groups | 2/5/10 facts, missing factors, related division |
| Products to 144 | All tables 2–12, factor pairs and inverse questions |
| Connections | Equivalence, factor pairs, inverses and distributive derived facts |

The maths button supplies immediate self-placement. Existing profiles get a
conservative initial range from their previous scalar, but no invented evidence
of mastery in the new skills. `curriculum.v1` is separate from old fact memory.

New/unpractised forms are sampled first, then less secure/due forms. Every sixth
challenge reviews a previous range. Each current skill requires three consecutive
unassisted correct responses before advancing the range. Assistance, a mistaken
submission or “another” cannot count as clean evidence. This is an intentionally
transparent heuristic, not a psychometric model; it records practice, not a claim
that the entire concept has been mastered. Review spacing is by challenges, not
calendar time; long-term retention assessment is still future work.

`client/challenge-ui.ts` displays the equation and selectable quantity slots.
The player taps or traces real dewy pads to fill the active slot; tapping a chosen
pad releases it. For two blanks, touch a slot to switch which collection is being
built. A leaf cannot supply both slots. Correct relationships resolve through pad
selection and those exact drops lift into the boat. There are no numeric fields
or keypad. The optional check action gives feedback; let go clears the active
collection. Existing arrow/Enter pad navigation remains an accessibility option.
Factor pairs accept any two whole numbers 2–12 that satisfy the equation. A
mismatch reports the amounts on each side and retains the entry for revision.

Help is opt-in: strategy, then a part-whole/equal-group model, then a worked
example. Models deliberately avoid using proportional bar lengths to encode a
missing answer. Examples are instructional, and assisted work remains excluded
from clean evidence. No idle-time hint or latency penalty. No score or countdown.

Correct relationships warm the lantern, carry the boat onward and can open a
nearby flower. Numerical size and answering speed do not increase the reward.
The ordinary river, residents, plants and fish remain interactive. Visits and the
notebook hide the equation temporarily without losing it. Basket taps cannot
replace an equation with a sharing prompt.

## Scope and next research questions

This materially broadens arithmetic and early algebra, but is not the complete
Scottish numeracy curriculum. Fractions, decimals, place-value instruction,
measurement, money, richer contextual problems, and explanations of a learner's
strategy are not yet assessed. Correct entry alone cannot demonstrate conceptual
understanding. Next playtests should examine interpretation of the equals sign,
transfer to unfamiliar forms, deliberate strategy use and retention across days.

The equation is a description of the relationship being made with dew; it is
not an independent answer-entry interface. The keypad introduced in the first
30 September deployment broke this core interaction and has been removed. Future destination
stories should give these same relationships a meaningful reason (partitioning
supplies, equal shares, restoring quantities), without disguising the question or
turning every encounter into a word problem.

## Verification

Strict ES2020 client type check and bundle build. Pure test suite generates
6,800 questions, checks intended answers and invalid input, exhaustively checks
alternative factor pairs, and covers the requested examples, range progression,
assistance, profile serialization and legacy starting points. Run with:

```
esbuild client/challenges.ts --bundle --platform=node --format=cjs --outfile=/tmp/stillwater-challenges.cjs
node tests/challenges.test.cjs
```

Browser checks passed for 402×714 and 320×568 layouts: explicit submissions,
unequal-side feedback, support, exclusion of assisted work from clean evidence,
boat/light rewards, notebook/resident suspension, basket isolation, saved range
and evidence restoration, and touch-keypad entry of 7 × 6 = 42. No page errors.
Software WebGL validates shader/runtime compatibility, not iPhone Safari performance.

## Pad-input correction, 30 September

All generated unknown quantities are bounded to 20 drops (factor slots to 12).
Large totals remain in the equations: for example `6 × □ = 42` or
`6 × 7 = 40 + □`. This avoids asking for 144 individually counted droplets.
Large products use a missing part beyond a multiple of ten; large dividend
questions instead ask for the quotient. The relationship retains the arithmetic
without demanding impractical physical collections.

A polynomial-time disjoint-subset planner checks the physical supply. New dew
condenses in varied small groups on frontmost, afloat dry leaves as needed,
keeping spare choices. Selected leaves are protected and never repurposed.
Physics/viewport changes trigger supply checks without replacing the challenge.
A mathematically overfull selection must be revised, not repaired into validity.

Verification extends the generator tests with bounded answers, disjoint pad
plans, alternate-factor completion and no reuse of a leaf for both blanks.
Browser checks use actual touchscreen taps on pads for a missing addend and both
factor slots, verify exact dew consumption and rewards, absence of numeric entry,
and supply at 320px width. Real-device Safari remains a separate performance check.

## Revision, 30 September (later): the right question, clearly, at the right time

A review of the above against how it presents on a phone and against the year
expectations it serves. The intent stands: relationships, not just totals;
missing numbers, inverses and equality read both ways; answers the dew can
hold; no timers. What changed, and why:

**Placement is a grown-up's, not a child's.** The six-level menu at the foot of
the screen ("Products to 144 · factors and inverses") was a menu of modes a
six-year-old would choose from by excitement. It is gone. Press and hold the
title for a small panel "for grown-ups": the child's school year, which sets a
starting level and a floor (`?year=N` does the same; `?maths=N` sets a level).

**Levels follow England's national curriculum and the DfE ready-to-progress
criteria (2020), in order.** The earlier bands jumped from collecting 2–5 to
written `□ − 7 = 5` after three answers, skipped facts within 10, and went from
the 2/5/10 tables straight to all tables to 12 (Year 4) with factor pairs and
derived facts (Years 4–6) beyond that.

| level | content | year | starts here |
|---|---|---|---|
| Counting | gather 2–5 (numeral and dots) | Reception | Reception |
| Facts within 10 | bonds, subtraction, doubles | Year 1 | Year 1 |
| Facts within 20 | bonds, subtraction, bridging ten | Year 1–2 | Year 2 |
| Twos, fives and tens | equal groups, missing factor, division | Year 2 | |
| Tens and ones | 2-digit ± a part, difference, partitioning | Year 2–3 | Year 3 |
| Threes, fours and eights | the same, 3/4/8 tables | Year 3 | Year 4 |
| Tables to 12 | all tables, factor pairs | Year 4 | Year 5 + |
| Connections | the same product two ways, one group more | Year 4–5 | |

**Moving on needs evidence from more than one day; a level can step back.**
Every skill in a level needs three clean answers running and clean answers on
two different days. Six or more questions at a level with two or fewer clean
steps back one level (never more than one below the placement). Review questions
(every sixth, and the stretch's relief) never move the level.

**Complexity grows with the child inside a level.** A new skill asks its
simplest form (the unknown where it is easiest: `3 + ? = 7`); after two clean
answers the unknown can be anywhere; after five the equation can be turned round
(`7 = ? + 3`); the numbers widen as clean answers come.

**The dew still means the maths for × and ÷.** Times questions are equal groups
gathered as leaves that match — `3 × 5 = ?` is three leaves of five (or five of
three), the blank counting 5, 10, 15 — never a large product turned into a
remainder (`60 + □ = 9 × 7` asked for three drops that meant nothing). A leaf
that does not match is not taken (it bobs, a low note). Larger facts are asked
as a group size (`8 × ? = 56`, `48 ÷ 6 = ?`), which the dew can be. Factor pairs
are equal groups too. Dew for a groups question condenses as enough matching
leaves and one or two that do not.

**The question is the one clear line at the top.** The equation is set as large
as the counting numeral, its blank filling with the dew gathered. No instruction
line, no toolbar of words, no error sentences. Under it, while a skill is new, a
picture in dots (a whole in fives with the known part filled; an array for equal
groups; rings that each hold the gathered group size for ÷) lights as the dew is
gathered, fading as the skill is learned. Too much shakes the blank and the
river lets the last leaf go.

**Help is heard, then seen worked through.** Two small marks, no words: a
speaker (the question read aloud, the picture shown; again, and the answer is
worked through with these numbers — the unknown's dots count themselves in and
the fact is said: "three lots of five make fifteen") and another question.
Examples are no longer fixed sentences unrelated to the question.

**One learning system.** Relationship answers now go into the same fact memory
and stretch as the counting: each answer is a fact (`s:3+4`, `g:3x5`) with its
own spaced review; due facts are asked back in warm-ups and reaches; the
stretch's relief reviews the level before; its finale comes round as before; a
product made the other way round opens a second flower. Quality is help and
corrections only — no time.

Verification: `tests/stillwater-challenges.test.ts` (jest, workspace) and
`tests/challenges.test.cjs` (6,900 generated questions true with their own dew,
bounded, year order, forms by proficiency, promotion across days, step back,
migration); headless frames of `3 + 3 = ?`, `20 ÷ 5 = ?` with rings, and
`3 × 5 = ?` answered with three matching leaves.
