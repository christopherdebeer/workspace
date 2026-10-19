# Labyrinth — local headless intent review 001

Six targeted cases executed locally using the production gesture interpreter and world solver, with no WebGL, browser or renderer. For each, Codex inspected a before schematic, committed hypotheses and observable criteria, then executed, revealed and critiqued the result. Reviewer was source-aware but blind to that case's computed outcome. The paired Mass case followed the Way case and discloses this familiarity.

| Case | Preferred expectation | Observed result | Judgment |
|---|---|---|---|
| bridge | Level connection between height-2 tops | Five deck cells at level 1; two arch bays; independent navigation connects | Fulfilled |
| paused-climb | Reach height 3 with a landing at (6,5) | Reaches, but (6,5) is a level-1 stair even though connect.rest records it | Partial; the hesitation alternative fits, preferred landing does not |
| court | Enclose an open court with entrance | Perimeter walls, arched gate at (4,3), nine open interior cells, central pool | Fulfilled; plausible filled-platform alternative absent |
| short-climb | Connect ground to height 4, preferably exterior stair | Substitutes a four-level internal stair tower | Acceptable precommitted alternative; internal-inclusive navigation verified |
| obstacle-way | Connect equal tops with a small lateral detour | Climbs over central tower, leaves a height-4 ledge beyond, cannot descend to destination | Partial; explicit incomplete fallback only |
| obstacle-mass | Same scene and connection, now Mass | Height-2 bridge detours one row; both endpoints connect | Fulfilled |

## New concrete findings

1. The missing pause constraint is observable, not merely suspected: rest=[3] coexists with a stair at the paused cell. Endpoint-reaching alone would incorrectly mark the preferred interpretation successful.
2. Way/Mass changes obstacle accommodation policy, not just construction intent. On identical geometry, the less explicitly connective mode provides the connection.
3. After Mass repairs the route, its offered `a bridge on one great arch` alternative still uses the original blocked path. A separate post-reveal execution of that alternative stops at the middle obstruction; both its reached result and interior-inclusive endpoint connectivity are false. The offered label conceals a functional regression, not merely a change of arch style.
4. The stair tower is not a failed connection: initial exterior-only navigation said false, but the production building graph confirms a valid internal route. The evaluator must include semantic interiors or it will wrongly penalise legitimate solutions. The final headless backend now reports both kinds of connectivity.
5. The closed-loop readings cover wall variants but omit the plausible area-fill reading. This is a vocabulary/choice gap even when the preferred enclosure succeeds.

## Scope and limitations

The diagrams represent model-space cells, levels and explicit semantic gesture inputs. These runs do not test screen-space picking, fixed-plane projection, pause detection, event-frequency sensitivity, preview stability, touch ergonomics, rendering or visual aesthetics. No production behaviour was fixed in this pass. These six deliberately selected cases establish concrete behaviours, not prevalence or a general success rate.

The review directory contains immutable expectation and critique records, before/after SVGs and JSON, source fingerprints, exact initial worlds and gesture inputs. Short-climb interior verification and obstacle-mass alternative verification are separate supplemental records, preserving the original reveal evidence.
