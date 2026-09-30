# Stillwater — when a question may be asked, and where its answer comes from

*30 September 2026. A review of how questions are planned, shown and supplied,
prompted by a playtest screenshot: `36 = ? × 6` at the top, and nothing on any
leaf in view that could answer it. Companion to `INTERACTION.md` (how a question
is answered) and `MATHS-REVIEW-2026-09-30.md` (what is asked). Sections 1–5
are the analysis as written before any change; section 6 is what was decided
and built.*

## 1. What the screenshot shows, and why

The question is on screen, and the river in view is empty: no drops, no numerals,
only bare leaves. Three things in the current design combine to make that screen:

1. **The question is shown first; its answers are made afterwards, in view.**
   `setTarget` shows the equation and only then asks `ensureRelationshipPads` to
   find leaves for it. For a choose question the candidate numerals are assigned
   to *dry* leaves, which must first bead (3.2 s) and then gather into a numeral
   (2.8 s): about **six seconds** from question to a legible answer.
2. **Choosing quiets all other dew at once.** While a choose question is up,
   every other leaf's drops settle to fine dew, immediately, whether or not the
   options have formed. For those six seconds nothing on the river is a number.
3. **Nothing checks that a question can be answered, and nothing withdraws it.**
   The counting loop (level 0) drops an untouched ask that has become unsolvable
   within half a second (`keepSolvable`). Relationship questions have no such
   check: a question stays up however long its answer is missing.

Two more paths lead to the same screen:

- **An option leaf that leaves the view is replaced by a bare leaf.** The value
  is re-assigned to a new leaf, which again takes about six seconds to show it.
  If that value is the answer, the question is unanswerable for that time.
- **Not every choice is always placed.** Options go on dry leaves that are big
  enough (`r ≥ 26`), frontmost and within a band of the screen. The loop places
  the choices in shuffled order and stops when it runs out of leaves, so on a
  narrow reach **the answer itself can be one of the choices never placed**. This
  is a plain bug, independent of the design questions below.

## 2. How a question was planned (before this review)

```
solve → boat surges (propel 190) → 1.7 s + phase pause
      → setTarget: curriculum.next() → mathUI.show()   ← the question is visible
      → ensureRelationshipPads()                         ← supply, in view
      → every 0.35 s for the question's life: ensureRelationshipPads()
          gather: lay drops on dry leaves until `completable` (+ spares)
          choose: re-assign options whose leaf left the view or sank
```

The counting loop at level 0 is similar. `setTarget` repairs an unsolvable
target by condensing exactly the missing amount (`N.repair`) at the moment it is
shown. `keepSolvable` does the same for a child who is midway through an answer.

So **repair is the planning**. Nothing is planned before the question is shown.
The river is made to fit the question after it is asked, while the child
watches, and it is refitted every third of a second as the view moves.

## 3. Evidence

A headless probe played levels 2, 4 and 6 at phone size, with the boat still and
while rowing (a tap on the hull every 1.5 s), and read the game's own log of what
it laid and when (54 questions; 21 of them with the supply log). The gather
supply loop was also simulated offline.

**Supply is laid in view, at the moment the question appears.** Of the 21
logged questions, 18 needed supply. All 18 laid it in view: 16 at 0.0 s after
the question was shown, and two later as the boat moved. Examples, as seconds after shown : value laid:

| question | supplied | note |
|---|---|---|
| `12 − 8 = ?` | 0:**4** | the only new leaf is the answer |
| `11 − 9 = ?` | 0:5 0:**2** | the last new leaf is the answer |
| `5 × 2 = ?` | 0:2 ×6, 0:1, 0:3 | six matching leaves appear with the question |
| `6 + ? = 11` (rowing) | 0:6 0:4 0:1, **2.9:6 2.9:3** | re-laid as the boat moves |
| `? × ? = 27` (rowing) | 0:10 0:3 0:8 0:9 0:4 0:2, **2.1:10 2.1:3 2.1:4** | three numerals re-form, one of them an answer |
| `6 × ? = 36` (rowing) | 0:7 0:8 0:5 0:6 0:30, 0.5:7, 1.6:30 | options re-form one at a time |

**Supply points at the answer.** Offline, over 1,080 gather questions from
levels 1–7, the supply loop lays leaves in a fixed cycle (3, 5, 2, 6, 4, 1, 6)
until the question becomes completable:

- **25%**: the last leaf laid holds exactly the answer;
- **67%**: the last leaf laid is the one that makes the question answerable, so
  it is part of every answer.

A child only has to notice which leaf formed last. The counting loop's
`N.repair` is the extreme case: it condenses exactly the missing remainder.

**When nothing moves, questions are answerable.** With the boat still, every
question in the probe was answerable from the leaves in view, and every choose
question had all its options placed. The failures come from timing (formation)
and movement (re-supply), not from a shortage of leaves in general.

*Caveats.* The probe runs in software rendering, much slower than real time, so
it cannot time formation; the six seconds is from the constants (`BEAD` 3.2 s,
`GATHER` 2.8 s). 54 questions did not reproduce the empty screen exactly; the
cause in §1 is inferred from the code and the screenshot (no dew anywhere is the
choose-quiet state), not observed.

## 4. Critique

1. **Show-before-supply is the root.** Every other symptom follows from asking
   first and making the answer second: the empty wait, visible condensation of
   the answer, and repair as the normal path rather than the exception.
2. **Change in view is information.** A child learns fast that "the leaf that
   just appeared" matters. Any in-view change that happens *because of* the
   question and *depends on* its answer is a hint, whatever its intent. The
   `6` forming under `? × 6 = 36` reads as the answer arriving.
3. **Repair is continuous, not exceptional.** At 0.35 s intervals the supply
   refits the river to the question for as long as it is up. Rowing, which is
   the game, becomes the thing that breaks questions and causes re-forming.
4. **The two loops disagree.** The counting loop withdraws a question it can no
   longer support; the relationship loop never does. The relationship loop is
   the one that asks harder questions.
5. **The question is tied to the screen, not to a place.** Candidate leaves
   are "whatever is in the band now". The boat surges forward on every solve,
   and the next question is often chosen while the view is still sliding, onto
   leaves that are about to leave it.
6. **Quieting is unconditional.** Removing competing numbers is right. Removing
   them before the answer is readable leaves an empty river under a question.
7. **Coincidences read as hints.** `36 = ? × 6` has the answer equal to the
   factor on show. It is a fair question, but on a river where a new `6` has
   just formed, it reads as "match the number you can see". The option
   generator also offers the question's own factor (`c.a`), which INTERACTION.md
   says it should not.

## 5. Proposal: a question arrives with its leaves

**Invariant.** *A question is shown only when it can be answered from water that
has already settled in view, and while it is up, no water that bears on its
answer changes in view.*

The planning that follows from it:

1. **Plan before showing.** Choose the question, then choose its *bed*: a set of
   leaves that will be in clear view for the question's likely life. Tethered
   leaves do not move much; only the camera does, so the bed is easy to predict.
   With the boat still, it is the leaves in view. While rowing, it is the leaves
   ahead of the boat, one question-length of travel away. Assign the answer and
   distractors to the bed all at once.
2. **Stage it answer-blind.** Lay the bed's water out of sight where possible:
   ahead of the view, where the river already grows dew (`world.dewFor`). When it
   has to happen in view (the boat is still), do it *before* the question and
   across the whole bed at once, answer and distractors alike, so that no leaf
   stands out. This is the ambient condensation already built (fine dew gathering
   into drops or numerals). What changes is that it is no longer a response to a
   visible question.
3. **Show when settled.** The question appears once the bed is in view and its
   water has finished forming. Nothing is shown before there is something to
   touch. The pause after a solve covers most of the six seconds; the rest is the
   river being ready.
4. **Freeze, don't repair.** While a question is up, its bed's water does not
   change. If the plan breaks:
   - **nothing chosen yet** (the child rowed on, or a leaf sank): the question
     fades with its leaves, and the next one comes with the next bed. Nothing is
     recorded; rowing away is not a wrong answer.
   - **midway**: what is chosen stays chosen. The question stays while an answer
     can still be completed from what remains; otherwise it lets go gently, as a
     wrong answer does, without recording a slip.
   - never: condensing the missing piece.
5. **Quiet after, not before.** For a choose question, other dew settles to
   fine dew as the options finish forming, or during staging, never before.
6. **One rule for both loops.** Level 0 counting follows the same invariant.
   `N.repair` goes, and so does in-view supply in `keepSolvable`.
7. **Check it continuously, and test it.** The answerability check runs as now
   (every 0.35 s), but it can only *withdraw* a question, never supply one.
   The headless probe becomes a regression test asserting:
   - no question is ever shown unanswerable;
   - no answer-bearing water changes in view while a question is up;
   - the answer is never the only leaf that changed.

### What this changes in the code

- `setTarget` splits into **plan** (question and bed, water staged) and **ask**
  (`mathUI.show`, once the bed is settled). The time between them is the existing
  pause after a solve.
- `ensureRelationshipPads` and `keepSolvable` lose their supply role and become
  `stillAnswerable` (which can withdraw a question).
- Supply moves to the planner, and is limited to leaves ahead or to a
  whole-bed condensation before the ask.
- The pick branch places all choices or none (fixes the missing-answer bug).
- Missing-factor questions avoid the answer equalling the shown factor while
  the skill is new, and the option list drops the question's own numbers.

## 6. Decided, and built

The decisions: **fade** (a question left behind fades with its leaves), **settled**
(asked only once its water has formed), **both** (water laid ahead out of sight,
or in view before the question while the boat rests), and **no skip button**
(rowing on is how a question is left).

What was built (`client/main.ts`, "planning"):

- **Plan, then ask.** `setTarget` makes a plan, not a question. `stepPlan` lays
  the bed in one batch (`stageRelationship`):
  - **choose:** every candidate at once, or none, trimming near misses but never
    an answer. Numerals prefer leaves that already hold fine dew, so they gather
    at once rather than beading first.
  - **gather:** drops until the question can be answered, always with a spare
    that is not the answer.

  The bed is the leaves in view when the boat rests, or leaves ahead by its
  coming glide (`glideAhead`) when it moves. The question is asked when every
  option (or enough settled dew) is in clear view and at rest, and nothing in
  view is still forming.
- **Planned during the pause.** After a solve the next plan starts at once, and
  its water gathers while the lantern rises. It is asked no sooner than the
  pause allowed before (`askNotBefore`).
- **Rowed past, laid again.** A bed that falls behind the view is laid again
  ahead at once. One that never arrives is re-laid after 14 s, and after three
  tries another question is planned (unasked, so nothing is lost).
- **Freeze, then fade.** While a question is up nothing is supplied.
  `keepAnswerable` checks every 0.35 s that it can still be finished from what
  is in view. If it cannot for 0.8 s, the question fades, letting go of anything
  chosen, and nothing is recorded. It comes back once with new water. Faded a
  second time, the river moves on to another question.
- **Counting (level 0) too.** Nothing is asked while dew in view is still
  forming. When no ask fits the dew, the missing dew condenses first, with a
  spare, and the ask comes once it has settled. Midway and no longer finishable,
  the ask lets go; the missing piece is never condensed.
- **Questions.** Choices never show the question's own numbers (other than an
  answer). While a skill is new, a missing factor or quotient is not the factor
  on show (no `? × 6 = 36`). The "Another question" button is gone.

**Regression probe** (headless, answering as a child would, and rowing):

| run | asked | shown unanswerable | supplied after shown |
|---|---|---|---|
| choose, level 6 | 5 | 0 | 0 |
| gather, level 2 | 6 | 0 | 0 |
| gather, level 4 | 6 | 0 | 0 |
| rowing, gather, level 2 | 4 (fading and returning) | 0 | 0 |
| rowing, choose, level 6 | 1 before the re-lay fix | 0 | 0 |

__PROBE2__

## 7. The decisions as asked

- **If the child rows away mid-question:** should the question fade with its
  leaves (proposed: it belonged to that place), or follow the boat and wait for
  new leaves ahead?
- **A beat of anticipation:** should the question appear as its water is still
  gathering (question and answer forming together, answer-blind), or only once
  everything has settled (proposed)?
- **Where staging happens:** always out of sight ahead (the river brings the
  question to the child), or also in view while the boat rests (proposed: both,
  answer-blind)?
- **"Another question":** keep it as is, or let rowing on be the natural skip?
