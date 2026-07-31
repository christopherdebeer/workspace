# Labels in the home graph

An inventory of every kind of text the graph renders, where each is
implemented, and a re-evaluation now that the orrery is a solid terrain
globe, the curl is continuous, and edge arcs lift off the surface.
Research doc — no changes shipped with it.

## The systems

Five distinct label systems, plus shared furniture:

| # | What | Mechanism | Where |
|---|------|-----------|-------|
| 1 | Fact names (node labels) | troika SDF text, in-scene | `graph.tsx` `labelObjs`, `makeLabel` ~1047, `syncBeamLabels` ~2220, `updateLabels` ~2422 |
| 2 | Edge relation labels | CSS2DObject DOM divs | `syncEdgeLabels` ~1722, `positionEdgeLabels` ~1812 |
| 3 | Place captions (constellations) | troika SDF text, in-scene | `addConstellation` ~1920, `updateConstellations` ~2076 |
| 4 | Breadcrumb | one DOM div, top-centre | `crumb` ~2157, `showCrumb` ~2201 |
| 5 | Hover preview | role inside system 1 + a ring sprite | `hoverLabelKey`, dwell timer ~1401, `showHover` ~731 |
| — | Clip pill (occluder) | depth-only ShaderMaterial quad | `mkPillMat` ~1013, shared by 1 and 3 |
| — | Typography vocabulary | fonts, palettes, `placeworthy`, `shortLabel` | `graph/style.ts` |

Out of scope but adjacent: the wordmark, sign-in button, palette and
selection card are DOM chrome in `app.tsx`. The graph knows them only as
`screenReserved` rectangles (~1709) that label admission avoids.

## 1. Fact names

The main system. Each label is a billboarded three.js group:

```
grp (at the node, faces camera)
├─ leader (hairline line, shown when displaced)
└─ inner (collision displacement + fixed-screen-size scale)
   ├─ pill (depth-only clip quad, renderOrder −1)
   └─ text (troika SDF, renderOrder 9)
```

- One font for every fact name: IBM Plex Sans 500 (`LABEL_FONT`,
  self-hosted). Type is carried by the star's hue, not the letterform.
  `LABEL_FONT_ITALIC` is exported for the suggestion whisper but never
  used — see re-evaluation.
- Fixed screen size: each frame `updateLabels` scales `inner` so the
  glyphs land at exactly `labelPx × roleMult` px (fov-aware, via
  `pxPerWorld`). Size never animates; only opacity fades
  (`labelFade`, ~150ms).
- Long titles wrap (`maxWidth = fontSize × 10`, centred, `shortLabel`
  caps at 44 chars).
- Roles, with size mult / colour / opacity at defaults:

| role | meaning | mult | colour | opacity target |
|------|---------|------|--------|----------------|
| `sel` | the selection | 0.8 | accent gold | 1 |
| `hover` | dwell preview | 1.17 | accent gold | 0.72 |
| `hit` | search result | min(0.55, 1.17) | cyan `answer` | 1 |
| `nbr` | selection neighbour | 0.6 | cream text | `nbrOpFar→nbrOpNear` by node px |
| `anchor` | landmark | 0.56 | dim warm-grey | 0.52 |
| `beam` | suggestion | 0.52 | cream text | 0.28 × torch slope |

- Role is a birth-time property for size/offset (an incumbent only
  re-targets colour/opacity on role change — deliberate, so standing
  labels never resize or slide on selection).
- Admission (`syncBeamLabels`, every 5th frame) spends one name budget
  (`focusBand`) across three registers:
  - Focus: `sel` + `hover` force-admitted; `hit` capped 6/9
    (mobile/desktop); `nbr` capped 3/5, with a 9-position displacement
    search and leader line.
  - Landmarks: `anchorCap`-capped, `placeworthy` names only, one per
    3×3 screen cell, persistent (incumbents re-admitted first).
  - Suggestions: the remainder of the budget; admitted by the label
    torch cone (`labelConeIn/Out`) with hysteresis (`beamOn`/`beamOff`),
    a 2-sync streak requirement, and territory fairness (≤ `beamPerCell`
    per 4×3 cell).
- Departure is graceful: `LABEL_GRACE` = 8 losing syncs (~0.7s) before a
  label starts dying, then it fades out and is disposed below 0.03.
  Hover labels skip the grace.
- Vantage behaviour: `farFadeAt` multiplies every target (far side of
  the orrery recedes); when far-occlusion clip is engaged
  (`uFarClip`), non-focus roles are hard-culled past the rim.
- Paper mode: targets gain ×2.5 toward full ink (additive-glow alphas
  read as muddy grey on cream otherwise).
- Tappable: `labelAt` reconstructs each visible label's rect from
  troika's own `blockBounds` (tight tier, then a finger-slop tier) —
  labels above `cur` 0.12 catch taps.

Current promoted tune worth knowing when reasoning about this system:
`focusBand` 60, `anchorCap` 32, `landmarkFrac` 0.8, `labelPx` 17,
`pillClip` 0 (the clip pill is off), `labelOutline` 0.21.

## 2. Edge relation labels

The only DOM labels left in the scene. Selection-only: the fan around
the selected fact gets its relations named at edge midpoints.

- `CSS2DObject` divs, mono 8.5px, `PAL.rel` dim colour, `rel →` /
  `← rel` oriented to the selection. Tappable — a relation is a door;
  clicking travels to the far node.
- Admission: salience order, `edgeLabelCap` (13), and the edge must span
  ≥120 screen px. No dedup (three `inDoc` edges show three labels), no
  overlap rejection at admission.
- Placement runs every frame: the label rides the visible screen span
  of its edge (Liang–Barsky clip against viewport margins), ideally the
  span midpoint, walking outward along the line if that slot is taken.
  Screen fraction maps back to world t perspective-correctly through
  endpoint depths.
- The whole set rebuilds on selection change (a reused label would keep
  pointing at the node you just left).

## 3. Place captions

Constellation names — the map's toponyms. Computed places (salience
hubs) plus authored places (registered views, boards, docs; evaluated
async, cached 6h in localStorage).

- troika text, uppercase serif (`FONT_BY_GROUP.kb`, Source Serif),
  letter-spacing 0.12 — the cartographic voice. Authored places get
  `capAuth` (a whisper of accent), computed get `capComp`.
- Sit on the outward shoulder of their region (shift ≈ 0.38·r), stored
  as canonical dir+radius, morphed by `curlPos` like everything else.
- Fixed screen size `labelPx × 0.82`; opacity carries distance: the
  approach fade keys on camera distance × telescope magnification
  against region radius (`constNear`/`constFar`) — zooming into a
  region fades its caption and hands over to fact names.
- Budget `min(constCap, 4 mobile / 8 desktop)`, authored first;
  declutter in screen space against other captions and against fact
  labels. Far-fade and far-clip like fact labels.
- Tappable (`constellationAt`): a caption is a door — an authored place
  selects its container fact, a computed one looks at the region.
- Outline: 4% hairline in dusk, 14% real knockout on paper.

## 4. Breadcrumb

One absolutely-positioned div at the top of the scene: selecting a fact
shows its containing region's name for 3.5s (serif, uppercase, tracked,
CSS-transition fade). Membership test is canonical-space distance
< 1.6·r. Styled by `PAL` on mode switch.

## 5. Hover

Pointer scans move `hoverKey` (geometry responds immediately: a ring
sprite via `showHover`); text enters the pool only after the dwell timer
promotes `hoverLabelKey`, as a `hover`-role label. On retirement the key
is suppressed from re-admission for 550ms so beam labels don't
immediately pop where a tooltip just was.

## Shared furniture

- The pill is not a background: it writes depth only
  (`colorWrite: false`, renderOrder −1), knocking the additive cloud,
  edges and other labels out of a rounded box behind the glyphs so the
  calm sky shows through. Sized to troika's real layout bounds. Off by
  default right now (`pillClip` 0); suggestions additionally need
  `beamPill`.
- `CSS2DRenderer` overlays the WebGL canvas (`pointer-events: none`;
  individual edge-label divs opt back in). Only system 2 uses it now.
- Everything troika passes through ACES tone mapping and bloom — a
  selected label glows with its node. DOM labels don't.

## Re-evaluation

The dramatic changes (solid terrain globe, continuous curl, lifted edge
arcs) land unevenly on these systems. In rough priority:

1. Edge relation labels detached from their arcs. `positionEdgeLabels`
   lerps along the straight chord between endpoints, but in the orrery
   the drawn edge is a great-circle arc with radial flight-path lift
   (`arcLift`). The label no longer sits on its edge — at the midpoint,
   exactly where the lift is greatest. The chord assumption also breaks
   the "screen-space interpolation is exact" reasoning the placement is
   built on (a projected arc is not a line).

2. Edge relation labels ignore the solid world. As DOM overlay they
   don't depth-test, far-fade, or far-clip: a relation on a far-side
   edge renders over the terrain globe, exactly the see-through reading
   the terrain's `depthWrite` fix removed for geometry. They also skip
   tone mapping, bloom, and the paper-mode ink compensation that every
   other label gets. This is the argument for migrating system 2 to
   troika in-scene: evaluate the same curl+lift the vertex shader
   applies (the GLSL mirrors a JS-computable form), seat the label at
   the arc's t, and inherit far-fade/clip/occlusion for free. The
   tap-to-travel affordance ports the same way fact-label taps already
   work (`labelAt` reconstructs rects from troika bounds).

3. Budget slots are spent on invisible labels in the orrery. Landmark
   and beam admission check `sz > 1` (behind camera) but not
   `farFadeAt` — in the orrery the far side is in front of the camera,
   so a far-side node can win a 3×3 grid cell or a beam slot and then
   render at ~0 opacity (or be hard-culled by `uFarClip`). The near
   hemisphere gets fewer names than the budget says. Admission should
   skip candidates below a `farFadeAt` threshold, the same way
   `labelAt` already deprioritises them for taps.

4. Legibility over terrain is untested by the current grade. The label
   contract was tuned against a dark dusk sky; the orrery floor is now
   lit land. The tools already exist — `labelOutline` (0.21) and the
   depth-only pill (`pillClip`, currently 0) — but there's no
   per-vantage grade. If names swim over bright terrain, the cheap fix
   is engaging the pill (or a higher outline) as `inOrrery` rises,
   rather than a new mechanism.

5. The name budget's premise has drifted. The three-register design
   says "a couple dozen legible names"; the promoted tune runs
   `focusBand` 60 with `anchorCap` 32. That's a legitimate owner
   choice, but the orrery shows the whole graph at once — a single
   budget across vantages means the globe wears planetarium-density
   naming. Worth considering: scale the effective band by vantage
   (fewer, steadier names on the held globe; the current density in
   dome/chart).

6. Caption behaviour in the orrery is accidental. The approach fade
   keys on camera distance, which is nearly constant across regions on
   the held ball — so whether captions show there is a side effect of
   `constNear/Far` against region radii, not a decision. On a globe the
   natural rule is projected region size, which the fixed-screen-size
   machinery already computes most of. Small, but it's the layer that
   would make the orrery read as an atlas.

7. Dead declarations. `LABEL_FONT_ITALIC` (the "different voice for
   suggestions" in `style.ts`) is never applied — suggestions
   differentiate by opacity/size only. Either wire it in `makeLabel`
   for `beam` or drop the export and the comment; as it stands the doc
   in the code promises a voice that doesn't exist. `FONT_BY_GROUP`'s
   act/doc/mono faces are similarly unused by labels now (only `kb`
   survives, for captions) — they're still fetched into the vendor
   mirror.

Consistency across systems is otherwise good: one sans voice for facts,
serif caps for places, mono for relations — three registers, three
letterforms, all self-hosted. The re-evaluation is less "restyle" and
more "finish the migration": system 2 is the last label still living in
the DOM, and most of the orrery-era problems trace to exactly that.
