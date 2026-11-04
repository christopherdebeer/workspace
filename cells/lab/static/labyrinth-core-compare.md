# Labyrinth core: the specification compared with the implementation (ASD-STE100)

## 0. About this document

### 0.1 Purpose

This document compares the core specification (`labyrinth-core.md`) with the implementation in `client/labyrinth/`. The specification came first, without the source code. This document finds the differences. It then tells which side must change, and gives a sequence of work.

### 0.2 Method

- Three readers examined the source code in parallel. Each reader took a group of sections: space, land, state, and ops; gesture reading; and atoms, rules, and meetings.
- Each reader gave a status and a file and line reference for each requirement.
- The author then examined the most important claims again in the source code. These claims are the grid size, the court fill, and the meeting rounds. They are also the adopt function, the timings, the first wall kind, and the kind decision.
- A status can be wrong if a reader did not find a function. Each status has its evidence, so a person can do a check of it.

The statuses are:

| Status | Meaning |
|---|---|
| SAME | The implementation does the requirement |
| PARTLY | The implementation does a part of it |
| DIFFERENT | The implementation does a different thing on purpose |
| MISSING | The implementation does not have it |

File names are short: G = `gesture.ts`, M = `main.ts`, Mo = `model.ts`, E = `encounters.ts`, L = `land.ts`.

### 0.3 Language

This document uses ASD-STE100 Simplified Technical English, Issue 9. It uses the technical names of `labyrinth-core.md`, section 0.3.

## 1. Summary

| Section | SAME | PARTLY | DIFFERENT | MISSING |
|---|---|---|---|---|
| Principles (9) | 1 | 5 | 2 | 1 |
| Space (11) | 1 | 3 | 2 | 5 |
| Land (7) | 1 | 3 | 1 | 2 |
| State and strata (13) | 4 | 6 | 3 | 0 |
| Atoms (6) | 3 | 1 | 0 | 2 |
| Gesture signals (16) | 3 | 7 | 3 | 3 |
| Reading (22) | 4 | 12 | 5 | 1 |
| Alternatives (6) | 1 | 1 | 1 | 3 |
| Ladders (7) | 0 | 4 | 2 | 1 |
| Rules (17) | 4 | 10 | 3 | 0 |
| Meetings (14) | 4 | 5 | 3 | 2 |
| Diversity (4) | 2 | 1 | 0 | 1 |
| Ops (5) | 0 | 3 | 0 | 2 |
| **Total (137)** | **28** | **61** | **25** | **23** |

The implementation agrees fully with 20% of the specification. The largest agreement is in support: arches, piers, corbels, arcades, and the growth of plants. The largest differences are in space, in the reading of gestures, and in the sequence of resolution.

## 2. The six main differences

### D-1. The world is a bounded grid, and the rules are global

- **Specification:** an infinite lattice in chunks. Each rule has a radius. A change calculates again only the chunks near it (SP-1 to SP-11, P-8).
- **Implementation:** a fixed grid of 48 × 48 cells (`N = 48, LO = -18`, Mo:41). Each op rebuilds the whole world (Mo:393). Courts come from a fill from the grid border (Mo:1028–1046). Basins and buildings also use fills. Meetings make up to 3 more full rebuilds (`MEET_ROUNDS = 3`, Mo:199, 412).
- **Land:** one composed scene with one ravine, one outcrop, and one shelf (L:76–79). The land beyond the first square is an extrapolation. It has no region lattice and no character field (LA-3, LA-7).
- **Effect:** the world cannot be infinite without a new core. The global fills are the main obstacle.

### D-2. A reading has no dimensions, and there is no weight

- **Specification:** a reading has five independent dimensions: kind, path, height, weight, and link. Each alternative changes one dimension by one step (P-4, AL-1 to AL-3).
- **Implementation:** a reading is one finished op with a label (Mo:53–98). Kind is mass or way only (G:289–296). Bound comes from closure inside mass. Grow is an alternative only. Water is not in the auto brush.
- **Alternatives:** they are other kinds or other forms: plantings, wall kinds, a tower, a ladder, a route (G:270–281, 988–998). There is no limit and no sequence (M:501–560). The app does not keep the reading, so a later change to one dimension is not possible (Mo:87–89).
- **Weight:** there is none. The first wall is random: 25% arcaded, 35% gated, 40% plain (`wallKind`, G:185–188). A ring makes a court. A way is paved, with flights. A bridge is a great arch by hash (G:607). Repetition develops only when the new reading adds nothing (`again()`, G:376–409).
- **Effect:** this explains the intent data. Results are heavy, and the alternatives do not move along the dimension that failed.

### D-3. The user does not own the shape of the stroke

- **Specification:** the user owns the plan path, the ends, and the end heights. The app keeps each turn of 0.5 cells or more (P-2, RD-9, RD-11).
- **Implementation:**
  - `unjog` removes jogs of 1 cell (G:194). Climbs are straightened in windows of 4, 6, and 8 cells (Mo:232).
  - The ends move: "arrives-first-reach", "begun-beside", and "from-foot" (G:484, 72).
  - "Walkway-instead" drops the end height (G:600–603).
  - The `took` list records each of these liberties (G:418–432).
- **Effect:** "as drawn" is only an alternative, and only when the stroke was smoothed (G:411).

### D-4. The app builds a substitute when the drawn form cannot stand

- **Specification:** the app must not build a form that the user did not select. If no rule can satisfy the gesture, the app must refuse and offer alternatives (P-9, AT-3, RU-1).
- **Implementation:** the design rule is "build the nearest that can" (G:16–19). The app builds a stair tower, a switchback, a ladder, or a walkway-instead without a question (G:584–603, 1010, 1056, 1092). A far route is built when the stroke aims at a top (G:598).
- **Rules that change user atoms:**
  - A way cuts the user's stone to fit its stairs (Mo:769–775).
  - `cutBack`, `alongside`, and `landingIn` cut or move user stone and flights (`outline.ts`:46–105).
  - Stone on a tree cell is dropped without a message (Mo:541).

### D-5. Resolution is not in strata, and the sequence of ops changes the result

- **Specification:** strata S0 to S7. A stratum never changes a lower stratum. Two ops that meet give the same result in each sequence (ST-4, section 11).
- **Implementation:**
  - Meetings run after courts and water, add ops, and rebuild from occupancy, up to 3 times (Mo:404–421).
  - `colonnades()` runs after `courtyards()` and changes spans (Mo:1016–1022).
  - `adopt()` writes derived stone into the user's op (Mo:429–439). Thus the authored layer changes without an op.
  - Op replay is "last writer wins": an arch removes a stair, and a stair removes mass (Mo:482–493).
  - The meeting rules have a fixed sequence, and "a later one never lays where an earlier one has" (E:563).
  - Ties go to the first entry in Map iteration (Mo:837, 873–882).
- **Effect:** the result can depend on the sequence of ops. Determinism holds only for the same ops in the same sequence.

### D-6. The atoms do not agree, and replay uses the current rules

- **Atoms:**
  - MASS, WAY, and GROW have counterparts.
  - WATER is in two stores: pools and basins.
  - BOUND and KEEP are missing. A ring compiles directly to walls of kind "court" (G:926–945). The reserved void (`passages`) comes only from ways and paving (Mo:262–268).
  - Many forms that the specification derives are authored directly: stairs, arches, a bridge flag, ladders, and rule overrides (Mo:53–101).
- **Replay:** a way keeps its path and ends, but its stairs and stone come from the current rules on each load (Mo:72–73, 575). Thus a change to the rules changes saved worlds (OP-2). The op format has no id, no version, no signals, and no rule version (Mo:1149–1186).

## 3. Where the implementation is better than the specification

The specification must take these items from the implementation.

| Item | Where | Change to the specification |
|---|---|---|
| Liberties, recorded and counted (`took`) | G:418–432 | Add to OP-1. Each op keeps its liberties |
| The meeting ladder 0/1/2 and insistence | E:5–8, 588, 726 | Weight and insistence are the same idea. Use one mechanism: repetition near a meeting raises its rung |
| Identity from the first op (`firstOp`) | Mo:275, 459 | Better than a hash of the minimum cell (DV-1). The hash key of a form is its first atom, so a later neighbour does not change it |
| A cut (subtractive op) | Mo:474–481 | The specification has no subtraction. A carve is a KEEP atom. A take removes an atom |
| Flight carriage: hung, rampant, solid, on piers | Mo:104–141, 904–957 | Add as a rule in S2 |
| Readings of built parts (an arch as a lintel, a colonnade, two bays) | `select.ts`, Mo:101 | This is AL-5 for derived parts. Keep it |
| Refusals with alternatives, and "never lay nothing" | G:47, 246 | Matches AL-6 and AT-3. Keep it |
| Target hysteresis: 3 moves, or 0.18 inside a top | M:567–569, 651–657 | Add to section 6. It stops the target from flicker |
| Measured timings: pause 450 ms, hold 650 ms | M:486, 564 | The specification values (300, 500) were estimates. Use the measured values |
| Brush, then lift | M:600–606 | Add to section 7.6 |
| A way bows around tree crowns | G:680–688 | It is a meeting: WAY + GROW |
| Wall continuity: a wall keeps the kind and rhythm of the wall that it starts from | G:884 | Add to section 11 |

## 4. Decisions

For each difference, this table gives the side that must change. "Owner" means that the owner of the project must decide.

| Item | Change | Reason |
|---|---|---|
| Infinite lattice, chunks, local rules (D-1) | Implementation | It is a principle. It needs a new core |
| Land as a pure function of the position, with regions (D-1) | Implementation | An infinite world needs it |
| Reading dimensions and one-axis alternatives (D-2) | Implementation | The intent data shows that the current alternatives do not help |
| Weight 1 for the first gesture (D-2) | Implementation | Remove the random gated and arcaded first walls. Make the wall kinds the rungs of a ladder |
| Shape tolerance (D-3) | Implementation, to 0.5 cells | The intent data: winding paths failed 0 of 4 |
| Substitutes (tower, switchback, ladder) (D-4) | Owner | Build them (implementation), or offer them (specification)? Recommendation: offer them, except when the stroke ends on a top |
| Rules that cut user stone (D-4) | Implementation | P-9. A rule can mark a conflict, but it must not change an atom |
| Strata and confluence (D-5) | Implementation | Remove `adopt`. Make meetings a stratum without a rebuild loop. Break ties by position, not by the sequence of a Map |
| BOUND and KEEP atoms (D-6) | Implementation | A ring must keep its enclosure. A carve is KEEP |
| One WATER atom (D-6) | Implementation | Pools and basins are the same atom at different levels |
| Replay from stored atoms, with a version (D-6) | Implementation | A rule change must not change a saved world |
| Maximum arch span: 3 cells (7 for a bridge) or 6 | Specification | Make the span a function of the weight: weight 2, 3 cells; weight 3, 7 cells. This removes the special bridge flag |
| Courts that add pools, trees, and pots | Specification | These are derived details (S7), not atoms. Allow them in S7. They must not block a later user atom |
| The piece brush (one exact form) | Specification | Keep it as a way to set the reading directly. It is not a mode for purpose. Write it into P-5 |

## 5. Sequence of work

Each phase has a test from section 14 of the specification. A phase starts only when the test of the phase before it passes.

| Phase | Work | Test |
|---|---|---|
| 1. Reading | Keep the reading in each op as five dimensions. Make alternatives one-axis. Make the first gesture weight 1. Set the shape tolerance to 0.5 cells. Offer substitutes, do not build them (if the owner agrees) | A new intent-first battery: path, ends, and closure honoured. One alternative for each failed dimension |
| 2. Strata | Remove `adopt`. Make meetings a stratum. Remove the rebuild rounds. Break ties by position | Permutation test: apply ops in all sequences; the worlds must be identical |
| 3. Atoms | Add BOUND and KEEP. Make one WATER atom. Remove the rules that cut user atoms. Store resolved atoms and a version in each op | Invariant tests (section 14). Replay a saved world with changed rules: no change |
| 4. Infinite core | Store the world in chunks. Make the land a function of the position, with regions. Give each rule a radius. Replace the fills with atom extents | Locality test (one chunk equals the whole world). Infinity test (build at 10⁶ cells) |

Phases 1 to 3 change the current core and do not change the grid. Phase 4 is a new core. The renderer, the cats, and the drawing can stay, because they read the derived parts.

## 6. Verification that exists now

| Specification test (section 14) | Existing harness | Condition |
|---|---|---|
| Determinism | `labyrinth.test.mjs` (replays) | PARTLY: same sequence only |
| Locality | none | MISSING |
| Confluence | `labyrinth-connectors.mjs` (both edit orders, for connectors) | PARTLY: connectors only |
| Path honoured | `labyrinth-explore.mjs` (laid within 1 cell of the stroke) | PARTLY: 1 cell, not 0.5 |
| Ends honoured | `labyrinth-connectors.mjs`, `labyrinth-stairs.mjs` | PARTLY |
| Closure honoured | none | MISSING |
| Alternatives on each dimension | none | MISSING |
| Invariants (walkable, supported, falls land) | `labyrinth-stairs.mjs`, `labyrinth-plants.mjs`, `labyrinth.test.mjs` | PARTLY |
| Infinity | none | MISSING |
| Stability of readings | `labyrinth-stability.mjs` | Exists. The specification does not have this test. Add it |

## 7. Detail tables

These tables give the status of each requirement. Section 2 gives the evidence for the main items.

### 7.1 Principles

| ID | Status | Note |
|---|---|---|
| P-1 | PARTLY | Many rules for named forms: court, colonnade, bridge, cypress, pool (Mo:101, 1015, 1028) |
| P-2 | PARTLY | Path and ends change. `took` records it (G:418–432) |
| P-3 | SAME | Support and dressing come from the rules (Mo:799, `character.ts`:54) |
| P-4 | DIFFERENT | No dimensions (D-2) |
| P-5 | PARTLY | Auto reads the place. The piece brushes are forms (`palette.ts`:27) |
| P-6 | PARTLY | Repetition only when the reading adds nothing (G:376) |
| P-7 | PARTLY | Same ops in the same sequence only (D-5) |
| P-8 | MISSING | Bounded grid, global fills (D-1) |
| P-9 | DIFFERENT | Substitutes and cuts (D-4) |

### 7.2 Space and land

| ID | Status | Note |
|---|---|---|
| SP-1 | DIFFERENT | 48 × 48 grid (Mo:41) |
| SP-2 | PARTLY | Height guard 512 (Mo:43). Land 0 to 5 only (L:70) |
| SP-3 | PARTLY | Atoms in sparse maps. Land in a dense array (L:136) |
| SP-4, SP-6, SP-7, SP-8, SP-11 | MISSING | No chunks, no radius, full rebuild, unbounded fills |
| SP-5 | DIFFERENT | Packed keys for −18 to 29 only (Mo:245) |
| SP-9 | SAME | Long runs get intermediate piers (Mo:205, 862) |
| SP-10 | PARTLY | Ways keep their path. Other rules scan the voxel maps |
| LA-1 | PARTLY | From the seed, but composed for the whole domain |
| LA-2 | DIFFERENT | Global features |
| LA-3, LA-7 | MISSING | No regions, no character field |
| LA-4 | SAME | Water never climbs (L:91, 103) |
| LA-5 | PARTLY | Within a quarter level. Exact on benches (`terrain.ts`:79, 159) |
| LA-6 | PARTLY | All features, but only once, in the first square |

### 7.3 State, strata, and ops

| ID | Status | Note |
|---|---|---|
| ST-1 | SAME | Ops and derived parts. Meeting ops are a third layer, not kept |
| ST-2 | PARTLY | Pure, except the times of first appearance (Mo:308) |
| ST-3 | PARTLY | `adopt` changes user ops (Mo:429) |
| ST-4 | DIFFERENT | Colonnades after courts. Meetings rebuild |
| ST-5 | PARTLY | Loops stop by guards. Ties by Map sequence |
| S0, S1, S2 | PARTLY | Land is precomputed. Occupancy depends on op sequence. Flights and support are mixed |
| S3, S4 | DIFFERENT | Passage in three files. Meetings feed back into S1 |
| S5, S6, S7 | SAME | Courts, water, and detail are later readers |
| OP-1 | PARTLY | No id, no signals, no rule version |
| OP-2 | PARTLY | Ways are calculated again with current rules |
| OP-3, OP-4 | MISSING | No stored gesture. No spatial index |
| OP-5 | PARTLY | Old arrays are read. No version field |
| DV-1 | PARTLY | Hash key is the minimum cell or the first op |
| DV-2 | MISSING | No character field |
| DV-3, DV-4 | SAME | No random values in the world. User choices are fixed |

### 7.4 Signals, reading, alternatives, ladders

| ID | Status | Note |
|---|---|---|
| Start and end anchors | PARTLY | Ground, top, side only. Water and ways found later (G:33, 58) |
| Path | PARTLY | Projected on the plane of the start height (M:220) |
| Closure | DIFFERENT | A gap in cells (≥ 8 or ≥ 10 cells long, gap ≤ 2 or 3), not a ratio (G:214, 444) |
| Turns, amplitude, speed | MISSING | Not measured |
| End height change, screen direction | SAME | G:290, M:608 |
| Pauses, hold | PARTLY | 450 ms and 650 ms (M:564, 486) |
| Overlap | DIFFERENT | Measured against the world, not against earlier ops (G:380, 397) |
| GS-1 | SAME | The reading updates while the finger moves (M:661, 678) |
| GS-2 | DIFFERENT | Taps have their own rules (G:49, 332) |
| RD-1 | PARTLY | On land, a ring is a walk around. The court is an alternative (G:790) |
| RD-2 | PARTLY | The kind test does not examine water |
| RD-3, RD-4, RD-7, RD-8 | PARTLY | Two kinds only, tests in sequence (G:289–296) |
| RD-5, RD-6, RD-12, RD-14 | SAME | Tap raise, plant growth, stairs on straight parts, lift steps |
| RD-9 | DIFFERENT | Tolerance 1 cell. Climbs straightened (G:194, Mo:232) |
| RD-10 | PARTLY | A route within 1 cell is built. Within 4 cells, offered. A far route is built for a top (G:569, 598, 739) |
| RD-11 | PARTLY | Walkway-instead drops the end height (G:600) |
| RD-13 | DIFFERENT | The way follows the cheapest height. No cuts into the land |
| RD-15 | DIFFERENT | First forms are heavy (D-2) |
| RD-16, RD-17 | PARTLY | Repetition against the world. No limit for mass |
| RD-18, RD-20 | PARTLY | A link to a top only. Ends trimmed up to 2 cells |
| RD-19 | MISSING | No link to both ends |
| RD-21, RD-22 | DIFFERENT | Lift by screen direction, with no hold (M:608–619) |
| AL-1 | DIFFERENT | Other kinds and forms |
| AL-2, AL-3, AL-5 | MISSING | No dimensions, no limit, no kept reading |
| AL-4 | SAME | `replaceLast` (M:474) |
| AL-6 | PARTLY | `adds()` filter for some alternatives (G:362) |
| Way ladder | PARTLY | Starts at paved. Then wider, then pergola |
| Mass ladder | PARTLY | A course for each repetition, no limit |
| Bound ladder | DIFFERENT | Random first wall. No hedge, gate, court, cloister sequence |
| Water ladder | MISSING | Not in the auto brush |
| Grow ladder | PARTLY | Shrub, olive, pine. The first plant is not a shrub |
| LD-1 | DIFFERENT | Heavy forms first |
| LD-2 | PARTLY | Plant growth replaces the kind |

### 7.5 Rules, forms, and meetings

| ID | Status | Note |
|---|---|---|
| R-1, R-2 | PARTLY | The voxel above a way is not reserved. Floor does not examine headroom |
| R-3 | SAME | Support from below, level by level (Mo:803) |
| R-4 | PARTLY | Maximum span 3, or 7 with the bridge flag (Mo:836) |
| R-5 | PARTLY | A pier can enter a passage if no other cell is possible (Mo:890) |
| R-6 | SAME | Corbels of length 1 (Mo:839) |
| R-7 | PARTLY | Stairs from ways or authored. Not a general rule |
| R-8 | PARTLY | Openings through walls up to 3 cells. Doors partly by hash |
| R-9 | SAME | Stone in a passage becomes an archway (Mo:543) |
| R-10 | DIFFERENT | Global fill from the grid border (Mo:1028) |
| R-11 | PARTLY | Roofs on solid masses. No interior void. Type by hash |
| R-12 | PARTLY | Drops of 1 to 3 levels, next to a used cell (`context.ts`:31) |
| R-13 | PARTLY | One spout for each basin. Falls land on water, a bowl, or stone (Mo:1087) |
| R-14 | PARTLY | Parapets by chance (35%), not by height (`character.ts`:89) |
| R-15 | SAME | Crowns lean and are pruned (`plants.ts`:79) |
| RU-1, RU-2 | DIFFERENT | Rules cut user atoms. New forms are new named rules (E:18) |
| Arch, arcade, pier, passage | SAME | Combinations |
| Bridge, stair, door, gate, terrace, fountain | PARTLY | Special flags or authored parts |
| Court, house, quay | DIFFERENT | Global fill. Solid mass, no interior. A landing stage at the end of a way only |
| WAY + MASS (through, side), WAY + GROW, MASS + GROW | SAME | Passages, doors and porches, the tree ring, leaning crowns |
| WAY + WAY (3 relations), WAY + BOUND, WAY + WATER (cross) | PARTLY | Over and under from support. No stepping stones. No weight ladder for crossings |
| WAY + WATER (along), MASS + WATER | MISSING | No quay along an edge. No wall with its foot in water |
| BOUND + WATER, BOUND + GROW | DIFFERENT | Courts add pools and trees by size, without a user atom |
| Confluence | DIFFERENT | Fixed rule sequence, first rule wins (E:563) |
| MT-1 | PARTLY | Local forms, but each rule examines all ops |
| MT-2 | SAME | Rung 0 leaves the atoms as they are |
