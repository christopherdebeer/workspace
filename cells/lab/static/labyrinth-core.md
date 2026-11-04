# Labyrinth core: the engine and the rules for gestures (ASD-STE100)

## 0. About this document

### 0.1 Purpose

This document specifies the core of Labyrinth from first principles. The core is the world, the gesture reading, and the rules that make built forms. The author wrote this document without the current source code. A later document will compare this specification with the implementation.

The aim of the core is this: a small set of rules gives a large set of forms. Expression comes from the user. Diversity comes from composition: each rule is simple, and the rules multiply.

### 0.2 Language

This document uses ASD-STE100 Simplified Technical English, Issue 9. "Must" shows a requirement. "Can" shows a possibility. Each requirement has an identifier. Section 0.3 lists the technical names (TN) and technical verbs (TV).

### 0.3 Technical names and technical verbs

| Term | Type | Meaning |
|---|---|---|
| cell | TN | One square in plan, 1 × 1 unit |
| level | TN | One unit of height (one storey). Integer |
| voxel | TN | One cell at one level: (i, j, k) |
| chunk | TN | A square of C × C cells. The unit of storage and calculation |
| halo | TN | The cells around a chunk that a local rule can examine |
| land | TN | The terrain. A function of the seed and the position |
| atom | TN | One authored claim about space (section 5) |
| part | TN | One derived form: an arch, a pier, a stair, a door, a court |
| stratum | TN | One step in the sequence of rule calculation |
| signal | TN | One measured property of a gesture (section 6) |
| reading | TN | The interpretation of a gesture: one value for each dimension (section 7) |
| dimension | TN | One independent axis of a reading: kind, path, height, weight, link |
| alternative | TN | A reading that is different from the default in one dimension |
| ladder | TN | The sequence of forms that repetition gives (section 9) |
| meeting | TN | Two atoms that touch or cross (section 11) |
| op | TN | One recorded change: a gesture, its reading, and its atoms |
| tap | TV | To touch and lift without movement |
| trace | TV | To drag a finger along a path |
| hold | TV | To keep the finger still on the screen for a time |

## 1. Principles

These principles control all other requirements. If a requirement disagrees with a principle, the principle is correct.

- **P-1. Few rules, many forms.** The core has a small number of atoms and rules. Forms come from their combinations. The core must not have a special rule for a named form if a combination can make that form.
- **P-2. The user owns where and what shape.** The plan path of a gesture, its ends, and the heights at its ends belong to the user. The rules must keep them.
- **P-3. The rules own how.** Support, openings, materials, and details belong to the rules.
- **P-4. One gesture, one reading, separate dimensions.** A reading has independent dimensions. Each dimension comes from its own signals.
- **P-5. No mode for purpose.** The user does not tell the app what a gesture is for. The place and the shape of the gesture tell it.
- **P-6. Repetition develops.** The same gesture on the same place makes the result stronger, by one step on a ladder.
- **P-7. Determinism.** The same seed and the same ops must always give the same world, in each part of the world, in each sequence of calculation.
- **P-8. Locality.** Each rule examines a bounded neighbourhood only. Thus the world can have no limit.
- **P-9. No surprise.** The app must not build an alternative that the user did not select. The app must not remove a user atom to satisfy a rule.

## 2. Space

### 2.1 The lattice

- **SP-1:** The world is an infinite integer lattice of voxels (i, j, k). There is no grid limit in i or j.
- **SP-2:** Level k is an integer. There is no upper limit. The land can go below level 0.
- **SP-3:** The storage must be sparse. The app must store only chunks that have land data that it calculated, or atoms.
- **SP-4:** A chunk has C × C cells (recommended C = 16) and all levels. The chunk key is (floor(i / C), floor(j / C)).
- **SP-5:** Coordinates must be 32-bit signed integers. The range (±2.1 × 10⁹ cells) is infinite for a user.

### 2.2 Locality budget

- **SP-6:** Each rule has a radius R_rule. The maximum radius R (recommended R = 8 cells) must be less than C.
- **SP-7:** To calculate the parts of a chunk, the app needs only the chunk and its halo of R cells.
- **SP-8:** A change in one chunk can change parts only within R cells of the changed atoms. The app must calculate only these chunks again.
- **SP-9:** A form that is longer than R must be a chain of local forms. Example: a bridge longer than the maximum span gets intermediate piers.
- **SP-10:** A rule can read two things only: the voxels within its radius, and the full data of each atom that touches those voxels. An atom keeps its own extent (its path or its cells). Thus a rule can know the inside of a long BOUND without a search of the space.
- **SP-11:** A rule must not search the space without a limit. A search for an area (for example, a fill) must stop at a radius of R.

## 3. Land

- **LA-1:** The land is a pure function: land(seed, i, j) gives a ground level and a surface type. It must not depend on the sequence of calculation.
- **LA-2:** The land function must examine a bounded neighbourhood only (radius ≤ R), as SP-6 says.
- **LA-3:** Large features (rivers, ridges) come from a coarse lattice of regions (recommended 64 × 64 cells). Each region calculates its features from its own seed and from the seeds of its neighbour regions only. Thus a river is continuous across region borders.
- **LA-4:** Water flows down only. A river level must not increase downstream.
- **LA-5:** Each cell has one integer ground level. The drawn surface must pass through the ground level at the centre of each cell. The drawn surface between cells is a presentation only. The rules use the integer levels.
- **LA-6:** The land must give reasons to build at each scale: slopes to climb, water to cross, flat benches to occupy, and obstacles to go around. The density of these features must be approximately constant over distance.
- **LA-7:** A character field gives each region a slowly changing character (for example: dry or green, steep or gentle, stone or brick). Section 12 uses this field.

## 4. State

### 4.1 Two layers

- **ST-1:** The state has two layers. The authored layer is the list of ops and their atoms. The derived layer is the set of parts.
- **ST-2:** The derived layer is a pure function of the land and the authored layer. The app can delete the derived layer and calculate it again at any time.
- **ST-3:** Only an op can change the authored layer. Undo removes the last op. Nothing else changes the authored layer.

### 4.2 Strata

The rules calculate the parts in strata. Each stratum reads the land, the atoms, and the lower strata only. Thus the result is the same in each sequence of calculation.

| Stratum | Calculates | Reads |
|---|---|---|
| S0 | Land: ground levels, water | Seed |
| S1 | Occupancy: solid, void, reserved, walkable | Atoms, S0 |
| S2 | Support: piers, arches, spans, foundations | S0–S1 |
| S3 | Passage: openings, doors, gates, stairs, landings | S0–S2 |
| S4 | Meetings: the forms where atoms touch or cross | S0–S3 |
| S5 | Enclosure: courts, rooms, roofs | S0–S4 |
| S6 | Water: basins, spouts, falls, bowls | S0–S5 |
| S7 | Detail: copings, parapets, dressing, plants | S0–S6 |

- **ST-4:** A rule in stratum Sn must not change a result of a stratum lower than Sn.
- **ST-5:** Each rule must terminate. Each rule must give the same result for the same input, in each sequence of cells.

## 5. Atoms

An atom is one authored claim about space. There are six kinds. All visible forms come from atoms and rules.

| Atom | Claim | Data | Hard rule |
|---|---|---|---|
| MASS | "This volume is solid." | A set of voxels | The rules must support it (S2) |
| WAY | "A person can walk along this path, and it stays open." | A polyline of voxels, start and end anchors | Continuous, with headroom of 1 level, no step greater than 1 level without a stair (S3) |
| BOUND | "This line divides inside from outside." | A closed or open polyline of cells, a height | It must have a passage where a WAY crosses it (S4) |
| WATER | "Water is here." | A set of cells at a level | It must stay in a container or flow down (S6) |
| GROW | "A plant grows here." | A cell, a size | It must not be on a WAY or in WATER (S7) |
| KEEP | "This space stays empty." | A set of voxels | No rule can put a part into it |

- **AT-1:** Each op makes one or more atoms. Each atom remembers its op.
- **AT-2:** WAY contains KEEP for its walk volume. Thus a later MASS on a WAY makes a passage (an arch, a gate), not a block on the path.
- **AT-3:** If two atoms make a conflict that no rule can resolve, the op that came later must not be applied. The app must tell the user why, and give alternatives (section 8).

### 5.1 Forms from atoms

These examples show forms that need no special rule. Each is a combination.

| Form | Combination |
|---|---|
| Arch | MASS above a void, with support at the two sides within the maximum span (S2) |
| Arcade | A row of arches, with an even rhythm (S2, S7) |
| Pier | Support under MASS where no side support is in the span (S2) |
| Bridge | WAY above a void or WATER, between two supports (S2, S3) |
| Stair | WAY with a level change of more than 0 between two adjacent voxels (S3) |
| Door | WAY that meets the side of MASS that has an interior (S3, S5) |
| Gate | WAY that crosses BOUND (S4) |
| Passage | MASS added above a WAY (AT-2, S3) |
| Court | A closed BOUND with ground inside (S5) |
| Room, house | MASS around an interior void with a roof (S5) |
| Terrace | WAY or MASS top at a level above the land, with a retaining face where the land is lower (S2, S5) |
| Quay | WAY along WATER at the water edge (S4) |
| Fountain | WATER above the ground in MASS, with a spout (S6) |

## 6. Gesture signals

The app measures each gesture. The signals do not depend on the brush.

| Signal | Measure |
|---|---|
| Start anchor | The surface below the first touch: ground, top, side, water, way, plant, nothing |
| End anchor | The surface below the last touch |
| Path | The touched points projected on the surfaces, as a polyline in world cells |
| Plan length | The length of the path in cells |
| Closure | The distance from the end to the start, divided by the plan length |
| Turns | The number of direction changes larger than 30° |
| Amplitude | The maximum distance of the path from its straight chord, in cells |
| Height profile | The level of the surface under each point of the path |
| End height change | End level minus start level |
| Pauses | Each place where the finger stayed still for more than 300 ms |
| Speed | The mean speed, in cells per second |
| Hold at end | True if the finger stayed still at the end for more than 500 ms |
| Overlap | The fraction of the path on the path of an earlier op |
| Screen direction | The angle of the path on the screen (for lift gestures only) |

- **GS-1:** The app must calculate the signals while the finger moves. The reading must update while the finger moves.
- **GS-2:** A tap has plan length 0. A tap is a gesture with one point. It uses the same reading rules.

## 7. Reading

A reading has five dimensions. Each dimension has a small set of values. The reading is the product of the dimensions.

| Dimension | Values | Main signals |
|---|---|---|
| Kind | mass, way, bound, water, grow | Start anchor, end anchor, closure, context |
| Path | as drawn, simplified | Turns, amplitude |
| Height | level, climb, descend, raise | End height change, height profile, start anchor |
| Weight | 1 (lightest) to 4 (heaviest) | Overlap with earlier ops (repetition). Speed is a decision for the owner (section 15) |
| Link | free, to end, to both ends | End anchor, start anchor |

Example product: 5 × 2 × 4 × 4 × 3 = 480 readings from 18 values. The meetings (section 11) multiply these again.

### 7.1 Kind

- **RD-1:** Closure less than 0.15 on open ground: kind is bound (an enclosure).
- **RD-2:** Start or end on water, or the path crosses water and ends on the other bank: kind is way (a crossing).
- **RD-3:** End height change different from 0, or start or end on a way, a door, or a stair: kind is way.
- **RD-4:** Start and end on the same top, path along the top or out from it, end height change 0: kind is mass (extend).
- **RD-5:** A tap on ground or on a top: kind is mass (raise one course).
- **RD-6:** A tap on a plant: kind is grow (one size larger).
- **RD-7:** If no rule above applies, kind is way on land, and mass on a built top.
- **RD-8:** The rules above are tests in sequence. The first true test sets the kind. All other kinds become alternatives.

### 7.2 Path

- **RD-9:** The default path is as drawn, simplified to cells. The app must keep each turn whose amplitude is 0.5 cells or more.
- **RD-10:** A route around an obstacle must stay within 1 cell of the drawn path. If no such route exists, the app must not build the route. The app must offer the alternatives (section 8).

### 7.3 Height

- **RD-11:** The path must start at the start anchor level and end at the end anchor level. The app must not ignore the end height.
- **RD-12:** "Climb" and "descend" distribute the level change along the straight parts of the path, as stairs with landings.
- **RD-13:** "Level" keeps the start level. Where the land is lower, the rules make a terrace or a bridge. Where the land is higher, the rules make a cut.
- **RD-14:** "Raise" is the height of mass. A tap raises 1 level. A lift (RD-21) raises or lowers 1 level for each step of screen distance.

### 7.4 Weight

- **RD-15:** The first gesture on a place has weight 1: the lightest form of its kind (section 9).
- **RD-16:** Each repetition on the same path (overlap 0.7 or more) adds 1 to the weight, to a maximum of 4.
- **RD-17:** Weight must not change kind, path, height, or link.

### 7.5 Link

- **RD-18:** If the end anchor is a top, a way, or a door, the link is "to end". The way must reach that anchor.
- **RD-19:** If the start and the end anchors are both of these types, the link is "to both ends".
- **RD-20:** A linked end has priority over the drawn path at that end, within 1 cell.

### 7.6 Lift

- **RD-21:** A lift changes the level of a selection or of the column below the finger. A lift starts only when the finger holds on a top for 300 ms and then moves straight up or down the screen.
- **RD-22:** A drag without the hold is a trace. Thus a lift and a way down from a top have different gestures.

## 8. Alternatives

- **AL-1:** An alternative is the default reading with one dimension changed by one step.
- **AL-2:** For each dimension that has a valid value other than the default, the app must offer one alternative.
- **AL-3:** The app must show a maximum of 5 alternatives. The sequence is: kind, path, height, weight, link.
- **AL-4:** A selected alternative replaces the op. It does not add an op.
- **AL-5:** The app must keep the reading in the op. Later, the user can select the part and change one dimension. This is the same as AL-4.
- **AL-6:** An alternative that adds nothing must not be shown.

## 9. Ladders

Repetition moves a result one step up its ladder. Each kind has one ladder.

| Weight | Way | Mass | Bound | Water | Grow |
|---|---|---|---|---|---|
| 1 | Footpath on the ground, steps cut in the slope | One course of stone | A hedge or a low wall | A rill | Shrub |
| 2 | Paved way, stairs, a light bridge | A wall, two courses | A wall with a gate | A channel with a stone edge | Small tree |
| 3 | Wide way, terraces, an arched bridge | A building: room and roof | A court with paving | A basin with a spout | Tree |
| 4 | Covered way: pergola or arcade | A tower, or one more storey | A cloister: a court with an arcade | A cascade of basins | Large tree |

- **LD-1:** The first gesture must give weight 1. Heavy forms come only from repetition or from an alternative.
- **LD-2:** Each step must keep all the parts of the step below it.

## 10. Rules

Each rule is local. The table gives the stratum and the radius.

| Rule | Stratum | Radius | Rule |
|---|---|---|---|
| R-1 Occupy | S1 | 0 | MASS voxels are solid. KEEP voxels are reserved. A WAY voxel and the voxel above it are reserved. All others are void or land |
| R-2 Floor | S1 | 0 | A voxel is walkable if it is void, and the voxel below it is solid or land, and the voxel above it is not solid |
| R-3 Support | S2 | span | A solid voxel is supported if the voxel below it is supported. Land is supported |
| R-4 Span | S2 | max span (6) | An unsupported row of solid voxels between two supported voxels, of length ≤ max span, becomes an arch |
| R-5 Pier | S2 | 2 | An unsupported solid voxel with no span becomes the top of a pier down to support, if the pier does not enter a reserved voxel |
| R-6 Cantilever | S2 | 1 | An unsupported solid voxel next to a supported one, with a length of 1, becomes a corbel |
| R-7 Step | S3 | 1 | Adjacent WAY voxels with a level change of 1 make a stair. A level change of more than 1 needs more cells or a landing |
| R-8 Opening | S3 | 1 | A WAY that enters solid makes an opening. In a BOUND, a gate. In a building, a door |
| R-9 Headroom | S3 | 1 | Solid above a WAY at the next level makes a passage: an arch over the way |
| R-10 Enclose | S5 | atom, or R | A closed BOUND makes a court: its inside comes from the BOUND path (SP-10). A closed ring of MASS makes a court only if its inside is within R |
| R-11 Roof | S5 | R | MASS around a void with no solid above it gets a roof. A building longer than R gets a roof in segments. The roof type comes from the character field and the hash of the segment |
| R-12 Retain | S5 | 1 | Where a walkable area meets land that is lower by 1 level or more, a retaining face holds the edge |
| R-13 Flow | S6 | atom, or R | Water in a container stays at one level. A WATER atom keeps its cells (SP-10). Water at an open edge falls to the next lower surface. A fall lands in water or in a bowl |
| R-14 Finish | S7 | 1 | Open edges of walkable tops get a coping or a parapet. Heights of 2 levels or more get a parapet |
| R-15 Grow | S7 | 2 | GROW atoms get a plant. The plant leans away from solid that is higher than the plant |

- **RU-1:** No rule may remove or move an atom (P-9). If a rule cannot satisfy an atom, the rule must mark the conflict. AT-3 then applies.
- **RU-2:** A new rule is necessary only if no combination of these rules gives the form (P-1).

## 11. Meetings

A meeting is two atoms that touch or cross. A table gives the form for each pair and relation. The table must be symmetric: the sequence of the two ops must not change the result.

| Meeting | Relation | Form |
|---|---|---|
| WAY + WAY | Cross at the same level | A junction: paving at the crossing |
| WAY + WAY | Cross at different levels | One goes over the other on an arch (R-4, R-9) |
| WAY + WAY | Ends meet at different levels | A stair, or a landing with a stair |
| WAY + MASS | WAY through MASS | A passage (AT-2, R-9) |
| WAY + MASS | WAY to the side of a building | A door (R-8) |
| WAY + BOUND | Cross | A gate (R-8) |
| WAY + WATER | Cross | Weight 1: stepping stones. Weight 2: a light bridge. Weight 3: an arched bridge |
| WAY + WATER | Along the edge | A quay |
| WAY + GROW | Pass next to a tree | The way passes the tree. Weight 2 or more: a ring of paving around the tree |
| MASS + WATER | MASS at the water edge | A wall with its foot in the water |
| MASS + GROW | Tree next to MASS | The crown leans away (R-15) |
| BOUND + WATER | Water inside a court | A pool in the court |
| BOUND + GROW | Tree inside a court | A tree in the court, in a corner if the court is small |

- **MT-1:** The meeting rules must be local (radius ≤ R).
- **MT-2:** If no row of the table applies, the atoms stay as they are.

## 12. Diversity

- **DV-1:** Where two or more forms are valid, the app selects with a hash of (seed, cell, rule). The hash must not change when other cells change.
- **DV-2:** The character field (LA-7) changes the probability of each valid form. Thus a region has a coherent style, and far regions have different styles.
- **DV-3:** The diversity must come from the hash and the character field only. It must not come from time or from the sequence of calculation.
- **DV-4:** A selected alternative or a user change is fixed. The hash does not change it again.

## 13. Ops and persistence

- **OP-1:** An op contains: an id, the gesture signals, the reading, the atoms, and the version of the reading rules.
- **OP-2:** To replay an op, the app uses the stored atoms. It does not read the gesture again. Thus a change to the reading rules does not change a saved world.
- **OP-3:** The app can read the stored gesture again with new rules for a test, and compare the result.
- **OP-4:** The op list is spatially indexed by chunk. Thus the app loads only the ops near the view.
- **OP-5:** The op format must have a version. A new version of the app must read all earlier versions.

## 14. Verification

| Property | Test |
|---|---|
| Determinism (P-7) | Calculate a world in two random chunk sequences. The results must be identical |
| Locality (P-8) | Calculate one chunk with its halo only. The result must be identical to the calculation of the whole world |
| Confluence (section 11) | Apply two ops that meet, in the two sequences. The results must be identical |
| Path honoured (P-2) | The mean distance between the drawn path and the built path must be 0.5 cells or less |
| Ends honoured (RD-11, RD-18) | The built path must start and end at the anchor levels. A linked end must be reached |
| Closure honoured (RD-1) | A closed gesture on open ground must give an enclosure by default |
| Alternatives (AL-2) | For each dimension with a valid other value, one alternative must exist |
| Invariants (section 5) | Each WAY is walkable from end to end. Each solid voxel is supported. Each fall lands in water or a bowl |
| Infinity (SP-1) | Build at (10⁶, −10⁶). The result must be the same as the same ops at (0, 0) on the same land |

## 15. Decisions for the owner

These values and choices need a decision. The values above are recommendations.

| Item | Recommendation | Question |
|---|---|---|
| Chunk size C | 16 cells | Is 16 correct for the memory and the frame time of a phone? |
| Rule radius R | 8 cells | Is a maximum arch span of 6 cells enough? |
| Region size for rivers | 64 cells | How often must a river cross a view? |
| Weight from speed | Not used | Must a fast stroke give a lighter form, or only repetition? |
| Shape tolerance | Keep turns of 0.5 cells or more | Is this the correct boundary between a wobble and a meant turn? |
| BOUND as an atom | Yes | Or must an enclosure be a closed MASS ring only? |
| Lift with a hold | Yes (RD-21) | Or a lift only from a selection? |

## 16. Next step: comparison

The comparison is in [labyrinth-core-compare.md](labyrinth-core-compare.md). For each section, it will record: the same, different, missing in the implementation, or missing in this specification. It will then propose the changes in the sequence of the most important differences.
