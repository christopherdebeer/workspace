# Splats

Gaussian splatting, from scratch, on a phone. A first viewer written to learn from and to build on: no library, about
600 lines in four files, each doing one part of the job.

## What a splat is

3D Gaussian Splatting (Kerbl et al., SIGGRAPH 2023) represents a scene as a large number of fuzzy, coloured ellipsoids,
each a 3D Gaussian, rather than as triangles. A scene typically has a few hundred thousand to a few million of them. Each
splat has:

- a **centre** (x, y, z);
- a **shape**: three scales along its own axes, turned by a **rotation** (a quaternion). Together they make a 3×3
  covariance matrix, Σ = R S Sᵀ Rᵀ;
- an **opacity**;
- a **colour**. In a trained scene this is a set of spherical-harmonic coefficients, so the colour can change with
  viewing direction (sheen, reflections). This viewer uses only the first band, the colour seen from every side.

The splats are found by optimisation. Training starts from a sparse point cloud from photogrammetry (COLMAP). It
renders the splats, compares the result with the photographs, and adjusts every parameter by gradient descent, splitting
splats where detail is missing and pruning those that contribute nothing. This viewer only *renders* splats; it doesn't
train them.

## How they're drawn (the four files)

1. **`format.ts`**: the data. It reads `.splat`, the antimatter15 format: 32 bytes a splat, already decoded. It reads
   `.ply`, which the trainer writes: scales stored as logs, opacity before its sigmoid, colour as SH coefficients. It
   also generates a scene, *garden*, from shapes. The garden shows how surfaces are made: the ground and the stone are
   flat discs, each a splat squashed along its normal, and the grass is needles, each a splat stretched along one axis.
2. **`sort.ts`**: the order. Splats are translucent and blended, so they must be drawn back to front, and the order
   changes as the view turns. The sort is a counting sort on a 16-bit depth along the view direction: linear time, about
   12 ms for half a million splats on a laptop. It runs in a worker, so the page keeps drawing with the previous order. Only the
   view's direction matters, so it re-sorts only when the view turns.
3. **`render.ts`**: the projection. All the splats live in one integer texture, 32 bytes each. Each is drawn as an
   instanced quad, in the sorted order. The vertex shader projects the 3D covariance to a 2D one on the screen,
   Σ' = J W Σ Wᵀ Jᵀ. W is the camera's rotation and J is the Jacobian of the perspective at the splat's centre, the
   local linear approximation that makes the projection affine. The shader adds 0.3 px² so no splat is thinner than a
   pixel, takes the eigenvectors of Σ' as the ellipse's axes, and spreads the quad to 3σ along them. The fragment shader
   is the Gaussian itself: opacity × exp(−r²/2), blended premultiplied.
4. **`main.ts`**: the page: the orbit camera, the scenes, the controls.

The **see** buttons show the stages: *ellipses* draws each splat's 1σ and 2σ contours; *footprints* fills each quad
solid, which shows the overdraw that costs most on a phone; *centres* shows the point cloud alone.

## The research, briefly (late 2026)

- **Mobile web renderers.** Most still sort on the CPU in a worker and draw instanced quads in WebGL2, the approach
  antimatter15's viewer made popular. GPU sorting (bitonic or radix) is the next step. WebGL2 viewers such as
  Portality do it with bitonic sort.
- **WebGPU is where the frontier is.** WebSplatter (2026) does a wait-free GPU radix sort and reports that other WebGPU
  viewers crash or stall on mobile GPUs. Mobile-GS uses WebGPU where available and falls back to WebGL2 on
  Safari-class browsers. The order of work here is WebGL2 first, then WebGPU.
- **Compression matters more than anything for delivery.** PLY is about 250 bytes a splat with full SH. `.splat` is
  32 bytes, with no view-dependent colour. **SPZ** (Niantic) is quantised and gzip-compressed, about 10× smaller than PLY.
  **SOG** (PlayCanvas) stores attributes in WebP images, 15–20× smaller. These two are the formats to learn next.
- **Quality on phones.** Most of the cost is fill (overdraw from large translucent quads) and the sort, not vertex
  work. A lower resolution (the slider), dropping SH bands, and culling tiny or transparent splats are the usual levers.

Sources: [kishimisu/Gaussian-Splatting-WebGL](https://github.com/kishimisu/Gaussian-Splatting-WebGL),
[catid/Mobile-GS](https://github.com/catid/Mobile-GS),
[WebSplatter (2026)](https://www.emergentmind.com/papers/2602.03207),
[Portality](https://radiancefields.com/portality-webgl2-gaussian-splat-viewer),
[PlayCanvas splat formats](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/),
[SOG open-sourced](https://blog.playcanvas.com/playcanvas-open-sources-sog-format-for-gaussian-splatting/).
Captured scenes are the examples from antimatter15's viewer, hosted on Hugging Face.

## One Stone: splats as a drawing

`?scene=stone` (`stone.ts`). The idea is procedural drawing as a way to author a 3D world: each feature gets a way
of drawing itself, and the Gaussian is what the marks are made of. The interesting decisions are where a mark belongs,
what it describes, and when the drawing can do without it.

**The stone** is a cut stone of unequal geological planes on warm paper:
- a crown of two planes meeting off-centre (high toward the tall end, falling away to the tapering one: a wedge);
- bevels and slabs of different sizes, and one broken corner;
- on its back-left, a substantial projecting slab, whose face overhangs a deep recess with a flat soffit and a narrow
  crevice where they meet;
- a seam in a fracture plane, hooking over the crown.

Its mesh, rays, faces and edges are all exact, from the planes.

**Composed, not catalogued.** An earlier version simplified by category ("the wash goes first"). Thinning evenly
turned out to keep more of the planes than that did, and the sparse drawing became perimeter plus crack. So every mark
now belongs to a stroke, every stroke to a feature (the seam, the ledge, the foot, the crown, a face), and each
feature reduces within itself before it goes. Three states are composed deliberately (*state* buttons):

- **Sparse** (¼): a core of about eight groups, each kept small:
  - the seam with its hook, and a short wedge of shade in the fracture by the hook;
  - the lip, with a firm tone under it, and the dark crevice;
  - one turn of the crown, and the broken corner's accent;
  - one moss cluster on the seam;
  - two or three dark contact points at the foot;
  - a short wedge of tone at the heart of each shadowed plane.
- **Intermediate** (½): those grown, plus:
  - the planes' tonal shapes near their anchors;
  - the seam's branch and a second tuft;
  - a cast shadow with a direction;
  - profile accents from this view.
- **Resolved**: the tonal shapes in full, granulation, chips, loose stipple, every hatch.

**Tonal shapes.** A face in shadow takes a shape anchored on an edge: the arris it shares with a lighter face (its
terminator), or under the ledge, the lip. It's firm at the anchor (a dense band laid along it), softens away, and
its far boundary is uneven (a slow noise along the anchor sets how far it reaches). The darkest ink is kept to narrow
places: the crevice, the contact points.
- **Wash:** small dense discs at the anchor that never cross it, growing broad and faint toward the boundary.
- **Dry:** hatching in directional families (along the strike of a shelf face, down the dip of a steep one), in rows
  with deliberate gaps; the strokes are long and close at the anchor and shorter and sparser toward the boundary.

**The shadow** is cast: the stone's outline is pushed along the light onto the ground, firm at the foot on the far
side and fading along the light. The lit side of the base is only lightly and brokenly touched, and the darkest contact
is at two or three points.

**Contour** marks sit along every arris, each knowing both its faces' normals. One is drawn only where one face turns
toward you and the other away: the profile from this view, eased in as a face turns, broken into accents. The
fracture belongs to the rock and the contour belongs to this view of the rock.

**The brush develops a feature.** Touch the seam and its branch, chips and moss come. Touch under the ledge and its
underside develops. Touch a face and its tonal shape grows. Each feature comes back in its own order, heart first, so
what appears has the feature's shape, not the brush's. Keep brushing to develop it further. It's on the stone, so it
stays as you turn.

Renderer details that make it work: each corner of a mark's quad takes the depth of the surface it lies on, so broad
marks aren't cut by their own face. The stone's exact mesh is the depth-only occluder. `?only=wash` (or fracture,
contour, stipple, shadow, lip, chip) shows one kind of mark alone.

Boards: `node cells/lab/devtools/splats-stone.mjs [states|pairs|views|detail|occluder|brush] [wash|dry]`. *states* is
the main one: the three composed states from the reverse view (the projecting lip, the line-overhang-shadow
relationship it's built around), then the hero and grazing views by the same rules.

Next: the Bamboo connection. A cliff face could give up its wash while a ledge keeps its lip and a fissure its line.
A culm could keep its silhouette and nodes while its shaded body drops away.

## Brushes: a shared medium

`?scene=brushes` (`brush.ts`, `subjects.ts`). One Stone showed the ideas; this generalises them into a medium that
Taohua's lines and washes, Labyrinth's architecture, Bamboo's moving landscape and Autograph's gesture could all
share:

    scene structure → drawing instructions → strokes and washes → splats → image

A **stroke** and a **wash** are objects that keep their identity: a path, a gesture, a material, a place in a group.
They become splats only when deposited, so a stroke can be shortened, re-pressured, regenerated at another density, or
withdrawn with its group, and its gesture is kept. There are three operations:

1. **Stroke along a path.** *Support*: on a surface (it lies flat and wraps over it) or in open space (round in
   section). *Gesture*: width, pressure along it, taper, breaks, tremor. *Material*: ink, dry (fragmenting where the
   pressure's light), wash-line.
2. **Wash within a region.** Any patch of a surface that can sample itself, test a point and project onto itself
   (a plane polygon, a cylinder, a strip beside a curve). It's firm along an anchor edge, softens away, has an uneven
   reach, and leaves places open. *Material*: wash (discs) or dry (hatching along a direction).
3. **Group.** A principal, its supports and its accents simplify together. The principal goes last, the wash withdraws
   toward its anchor, and the accents drop to the one that matters.

Each stroke names its heart (where its meaning lives), and reduces toward it.

The test is whether the same brushes, given only different paths, regions and anchors, can draw unlike subjects:
- **A stone:** the seam with its wedge, the lip with the underside and crevice, the faces' tones, and the profile.
- **A bamboo culm:** silhouette strokes up its facets, node strokes round it, and a shaded body that goes first,
  so it keeps silhouette and nodes as it simplifies.
- **An architectural corner:** the cornice's lip with the shade under it (the same relationship as the stone's
  ledge), a niche with its shadow, and the shadowed wall on the corner.
- **A written gesture:** one curve with a hand's pressure, drawn by the same stroke in open space and wrapped over
  the corner's wall.

`subjects.ts` makes no marks itself. Board: `node cells/lab/devtools/splats-brushes.mjs [wash|dry]`.

## Composed: one small scene

`?scene=composed` (`subjects.ts` `composedScene`, `edit.ts`). A stone, three culms and an architectural corner, with a
bank passing between them, drawn with the same brushes throughout:
- the corner behind the stone and to its left;
- two culms behind it to the right, the far one standing in the back one's shadow;
- one culm in front, crossing the stone's right side.

`?compose=0` (or the *relate* row) draws each object as if alone.

**Three decisions, made separately.** The first version scaled rank, width, opacity and wash depth together by one
"importance", which weakened a secondary object every way at once and didn't protect the subject's identity. Now:

| decision | controls | how |
|---|---|---|
| structure | which marks must survive, together, to explain shape, contact and overlap | each object's minimum description: its structural members, ranked to survive the sparse state at full strength |
| emphasis | where the strongest contrasts belong | only the contrast of material marks: lighter washes, thinner lines on lesser objects |
| material detail | what can go freely | everything else, ranked below all structure, lesser objects' first |

The minimum descriptions are authored:
- **stone:** the seam's hook with its wedge of tone, its crown, its contacts, and an interrupted outline. The outline
  includes the crown ridge and the broken face's edges, which carry most of its silhouette and had been left out.
- **culm:** one continuous silhouette and two nodes.
- **corner:** its arrises and cornice lips.
- **ground:** the bank.

**Groups are kept as objects** (`group()` returns members that point to their group, with its principal, supports,
accents and minimum). Structural washes fall gently from their anchor, so a group's minimum appears and goes together.

**Views** (main.ts, each frame, eased so nothing pops). Values computed from the view open and close gates (render.ts:
a feature with its top bit set is a gate), choosing among anchored alternatives without rebuilding marks:
- **The stone's lit-side alternative:** a little tone low on each lit side face. It opens as the stone's shadowed faces
  turn away; around 270° the stone was an empty outline.
- **A tone cap:** no other object's wash may carry more than 30% of the stone's tone as seen from here. Each wash is
  judged by its apparent weight: area × darkness × facing ÷ distance². At 180° the corner's shaded wall measured 62% of
  the stone's; it's now capped to about half its strength.

**Fixes from the review:**
- **One ground, order-independent:** every cast shadow is merged into one wash. Its region is the union of the shadows
  less every footprint; its anchor is every shadow's far side in pieces, each with its own reach.
- **Semantic keys** for every authored element (`stone/seam`, `culm-back/node/3`, `corner/wall/2-3`), so inserting one
  doesn't shift the rest.
- **The halo** now applies only to lines (ink strokes and profiles), never washes or contact accents, with one ring of
  eight reads instead of two.

**Material gestures:**
- **culms:** long loaded pulls, full at the foot and lifting toward the top; compressed nodes.
- **stone:** interrupted, slightly angular outline strokes.
- **corner:** measured, even edges, heavier only where a lit wall turns into a shaded one.

**Editing in the scene** (the Bench's editor, generalised, `edit.ts`):
- the stone's **seam** (its wedge follows), its **lip** (its soffit's shade follows), and the **bank** (its slope
  follows);
- bend them by handles that displace the authored path smoothly, so the seam keeps its jaggedness;
- change pressure (presets, or *as made*), weight and material, and widen or narrow the anchored wash;
- undo.

An edit deposits again only the stroke and its washes (2 of 168 elements).

**Checked** (`splats.test.mjs`):
- shadow marks under another object: 0 (8 with each alone);
- the same drawing, element for element, when the objects are made in reverse order (163 elements compared);
- no element keyed by its position in its scope;
- every object's minimum survives the sparse state;
- each group's minimum goes together (within the 0.04 fade band);
- the same element on the three culms goes earlier the less it's emphasised, and all material detail ranks below all
  structure (0.79 < 0.88);
- the seam, bent and re-pressured in the scene, undone exactly.

**Motion** (`node cells/lab/devtools/splats-motion.mjs`): an orbit stepped 10° at a time, with frames rendered at each
step so the eased gates move as they would.

| configuration | change per 10° step (median) | largest | largest / median |
|---|---|---|---|
| sparse | 3.4 | 4.0 | 1.16 |
| resolved | 13.5 | 15.9 | 1.17 |
| resolved, no halo | 13.7 | 16.1 | 1.17 |
| sparse, no halo | 3.7 | 4.7 | 1.25 |

No step stands out, so nothing pops at this resolution. A 10° step is coarse, though: a small mark appearing could hide
inside the camera's own motion. Finer steps across the gates' transitions would be a stricter test.

**Edit latency** (headless Chrome, software GL; upper bounds for the CPU side, not phone timings):

| edit | deposit | assemble and upload |
|---|---|---|
| seam | 4 ms | 21 ms |
| bank (its slope is a large region) | 100–200 ms | about 15 ms |

Boards: `node cells/lab/devtools/splats-composed.mjs [wash|dry]`:
- states with and without composition;
- the orbit at sparse and resolved, with the stone's visible tone per view;
- close inspection;
- editing in the scene.

**Still open:**
- **Shadows on objects:** the back culm stands in the stone's shadow but is drawn lit.
- **The tone cap only dims.** It can't choose a different, lighter description of the corner; from behind, its dry
  hatching is still heavy.
- **The bank is a line on flat ground,** with no rise in the geometry.
- **Washes are still smoky patches more than connected tonal shapes.**
- **The phone is unmeasured.**

## A drawing policy: learning which marks to keep

`policy.ts`, `?scene=composed&policy=ranks|rules|learned`, `?judge`. The idea comes from the Mist experiment,
generalised: use an expensive process offline to teach a compact model a useful decision. Here the decision is which
marks best describe the scene at a given detail and view, decided at the level of groups, above deposition.

**What a policy controls.** For each group (a seam with its wedge, a cornice with its underside, a culm's sides), a
treatment:
- **extent:** how much of the group survives, heart first by its marks' ranks;
- **strength:** a multiple of its marks' opacity.

The brushes still make every mark, so identities, anchors and editability are untouched. The renderer reads each mark's
group (a 24-bit index in the third texel) and the group's control (a texture of thresholds and strengths).

**Its inputs**, per group per view:
- role (line, edge, contact, tone or ground), and whether it's structural or an alternative;
- its object's emphasis;
- projected size, how far it faces the eye, and how much of it a nearer object hides (tested against stand-ins for each
  object's shape);
- how many other objects' groups crowd it on the screen;
- the detail asked, and the previous decision.

**Policies, always compared at the same mark budget** (the number of marks the ranks would keep at that detail):

| policy | how it decides |
|---|---|
| ranks | the scene's own ranks against the global detail: no control |
| rules | hand-written rules over the inputs (structure keeps a floor; tone only as far as it faces you; hidden or tiny detail keeps less; lesser objects give way where they crowd; contacts stay strong), scaled to the budget |
| learned | a small model (the group's features plus the treatment, 2 × 12 hidden units) scores each group's possible treatments; each group gets the best score less a price per mark, the price found to meet the budget, the rest filled greedily |

All three draw through the same controls. Treatments are eased between frames, and the target is worked out every third
frame.

**The teacher is you.** A good sparse drawing is an artistic judgement; training on the rank rules would only reproduce
their limits.
- `?judge` (or the *judge* button) shows two treatments of a random view at the same budget, unlabelled and in random
  order: the rules against a variation of them, the rules against the ranks, or (once there is one) the model against
  the rules.
- Tap the better one, or *about the same*. Choices are kept in the browser, rejected treatments included. *Export*
  downloads them as JSON.
- Put the JSON in `devtools/judgements/` and run `node cells/lab/devtools/splats-policy-train.mjs`. It fits the model by
  pairwise logistic loss (a drawing's score is the sum of its groups') and writes `policynet.ts`. It needs at least 20
  decided pairs.

**What's checked so far:**
- Budgets: rules keep 12,841 of 12,840 marks, a model 12,831 (`splats.test.mjs`).
- Extent 0 keeps none of a group and 1 all of it.
- **The machinery, on synthetic preferences only** (`--synthetic`): pairs labelled by a hidden utility written in the
  trainer. The fitted model agrees with it on 100% of held-out pairs, and its policy beats the rules by that utility in
  20 of 30 fresh views. That shows the pipeline can learn a preference and act on it at a fixed budget. **It says nothing
  about drawing quality.**
- Motion (`splats-motion.mjs`): the rules policy over a stepped orbit at sparse has its largest step at 1.21× the median
  (ranks: 1.16). Its median change is higher (4.7 against 3.4) because it spends marks on larger elements such as the
  bank.
- Cost (Node on a desktop): the inputs plus rules take about 1.5 ms a frame; a model about 4.5 ms, which is why the
  target is recomputed every third frame. Unmeasured on a phone.
- `node cells/lab/devtools/splats-policy.mjs [wash|dry]`: ranks against rules at the sparse state from six views (same
  budget), and the judging page.

**Not yet:**
- **No real judgements, so no trained model.** `policynet.ts` is empty, and *learned* falls back to the rules.
- **Whether the rules beat the ranks is undecided.** They visibly move marks to the bank and to tone that faces you, away
  from scattered detail on lesser objects. Judging will tell.
- **Unseen arrangements:** a policy trained on this layout should be tested on others.
- **Groups are judged one at a time.** The competition input summarises their neighbours, but a whole-composition
  judgement (balance across the picture) isn't modelled.
- **Reference fitting** (adjusting the instructions to match target images, as DiffVG does for vector shapes) is a
  separate, optimisation-only path, not started.

## The Bench: one brush made dependable, one stroke made editable

`?scene=bench` (`bench.ts`; brush.ts). This answers a source review of the brush. Its five findings, all confirmed in the
code, and what changed:

| finding | why it mattered | now |
|---|---|---|
| element ids from a global counter; wash variation from that counter | rebuilding a subject after visiting another scene could change it | ids hash a **key**: given, or the subject's `scope` and the element's place in it (`stone/w3`), or the element's content. Each element deposits from **its own random stream**, seeded by its id |
| wash reach and firm edge indexed by anchor sample | resampling a curve changed the wash | measured by **arc length** in scene units. Points are placed by true distance from the anchor polyline; the firm edge is laid every 12 mm |
| density added overlapping marks with no opacity compensation | a quality setting darkened the drawing | marks scattered at d× the number are each 1/d as opaque, or wider where that can't be (`faint`). Strokes size marks to their spacing |
| feature ids in 4 bits, 16 uniforms | a few objects exhaust it | a **32-bit feature id** per mark, its development read from a feature texture. Brushes gives each object its own range |
| contours carried their second normal in their colour, then forced to ink | a brush's contour colour was lost | a **third texel** per splat: support, second normal, feature, element. Contours keep their colour (Mist's stems are now light, as they asked to be) |

Two renderer issues were fixed too:
- **Support is explicit** on every splat: *surface*, *edge* or *free*. Only surface marks take the surface-plane depth under
  each corner. Mist's splats are free, so they no longer go through the surface-depth branch with a made-up upward normal.
- Region sampling in `subjects.ts` had used a shared random stream; it now uses each element's own.

**Checked** (`devtools/splats.test.mjs`, on a CPU rasterisation of the marks):

| check | result |
|---|---|
| a subject rebuilt after building other scenes | identical, mark for mark |
| a wash's tone at density 0.5 / 1 / 2 | 0.116 / 0.115 / 0.116 |
| dry hatching's tone at density 0.5 / 1 / 2 | 0.021 / 0.023 / 0.023 |
| a stroke's tone at density 0.5 / 1 / 2 | 0.0119 / 0.0116 / 0.0115 |
| a straight anchor in 2 points vs 40 | same tone; layout correlation 1.000 |
| an arc in 12 points vs 120 | tone 0.131 vs 0.128; layout correlation 0.997 |
| a re-pressured stroke | same id, its marks in the same places |

**The Bench** shows the same stroke and wash on a plane (a board), a cylinder (a culm) and in open space (a volume wash
round a free stroke). Each stroke is authored as control points; its wash is anchored to it.
- **Tap** a stroke to select it. Its control points appear as handles.
- **Drag** a handle to bend the stroke. On a surface, the point is taken onto the surface, so the stroke stays on the
  culm or the board.
- Change its **pressure** (even, swell, press in, lift off), its **weight** and its **material** (ink, dry, wash-line).
- **Undo** steps back through edits.
- **Density** re-deposits everything at 0.5, 1 or 2×.

An edit deposits again only the stroke and the wash anchored to it: 2 of 29 elements, about 400 of 4,600 marks, in 10–25 ms
in headless Chrome. The rest come from the cache. The whole buffer is still re-uploaded and re-sorted; incremental upload is
not done yet. Four edits undone restore the drawing exactly (the board checks this).

What it doesn't do yet:
- add or delete strokes, or edit washes directly (only through their anchor stroke);
- edit anything in the composed subjects (only the Bench's three strokes);
- handles are screen-space, so dragging a point to the far side of the culm needs an orbit first.

Board: `node cells/lab/devtools/splats-bench.mjs` (`bench-deposit.png`: density and sides; `bench-edit.png`: a real tap
and drag, dry, swell, undo).

## Mist: a learned lighting function on splats

`?scene=mist` (`mist.ts`, `mistnet.ts`, `devtools/splats-mist-train.mjs`). After Charles Grassi's *Neural Shaders,
Explained With Clouds*: a tiny network estimating the light a cloud scatters toward the camera from nearby density at
several scales, density toward the sun and the view angle, while the renderer still does visibility and accumulation.
(The article: <https://charlesgrassi.dev/blog/neural-volumetric-clouds/>.)
The question here is whether a compact spatial asset (splats) plus a compact learned lighting function keeps more of
an expensive scene's behaviour, within a phone's budget.

**The scene** is a procedural bank of mist between bamboo stems (the stems opaque in its density, so they shadow it),
drawn with the brushes, under a moving sun.

**The reference** is an expensive light model, about 200 density evaluations per point:
- the sun's transmittance marched through the density;
- single scattering with a forward phase;
- multiple scattering approximated by octaves;
- sky light marched from six directions.

**The same splats** (positions, sizes, opacity), seen from the same camera at the same resolution, are lit four ways:

| method | where its light comes from | cost per splat |
|---|---|---|
| reference | the expensive model, on the CPU | ~200 density evaluations; seconds to update |
| baked | the reference under one sun and view, frozen | nothing |
| analytic | Beer–Lambert toward the sun from the six sun reads, with the phase, plus an ambient term; two weights fitted to the reference | 7 pyramid reads |
| neural | 13 → 16 → 16 → 2, 556 numbers, trained offline against the reference | 12 pyramid reads and ~500 multiply-adds |

**Following Grassi's method.** The second version follows the capture of his article closely:
- **Features:** one coarse 48×24×32 density grid and its six-level mip pyramid in a 3D texture. The inputs are:
  - the mean density round the splat at six scales (one read per level);
  - the mean density toward the sun at the same six scales (each level read at its own texel's distance, so the reads
    tile the way out like a cone);
  - the view–sun cosine.

  That makes 13 inputs from 12 reads, and the CPU and the shader sample the pyramid identically.
- **Network:** squared ReLU in the hidden layers and squared outputs. There are two outputs, the sun's light and the
  sky's, sharing the hidden layers. (He has a third for ground bounce; this scene has no ground light.)
- **Training:** fitted to the light itself, untransformed. Training points are where a camera's rays first meet the
  mist, rather than spread through it.

**Trained** on five banks × ten suns × three views (240,000 visible points). **Measured** where it wasn't trained,
under suns in a held-out band of azimuth and elevation:

| | baked | analytic | neural |
|---|---|---|---|
| training banks, visible points: mean abs. error (mean light 0.59) | 0.376 | 0.134 | **0.084** |
| unseen bank, visible points: mean abs. error (mean light 0.69) | 0.398 | 0.118 | **0.087** |
| unseen bank, visible points: correlation | 0.33 | 0.91 | **0.93** |
| unseen bank, the mist's splats: mean abs. error (mean light 0.59) | 0.372 | 0.128 | **0.086** |

**Ablation.** Each of the recipe's choices was undone in turn on the same features. Error is on visible points of the
unseen bank:

| recipe | mean abs. error | correlation |
|---|---|---|
| Grassi's (as above) | 0.087 | 0.927 |
| plain ReLU hidden | 0.088 | 0.928 |
| log1p target | 0.088 | 0.928 |
| one output (total light) | 0.086 | 0.930 |
| trained on splats, not visible points | 0.087 | 0.923 |
| all four undone (this experiment's first recipe) | 0.089 | 0.928 |

**What that says:**
- Baked splats can't follow a moving sun at all, worst when back-lit.
- A well-fitted analytic model does most of the work. The network removes about a quarter to a third of its remaining
  error, on a shape and suns it never saw.
- **Here, the recipe barely matters.** Each of his lessons was a fix for a failure this scene doesn't have:
  - *Creases from ReLU:* the target is smooth and the inputs are coarse.
  - *Brightness lost to a cube-root target:* log1p cost nothing here (the light ratio stays within 2% of 1).
  - *Noisy targets:* the reference here is marched, not path traced, so it has no noise.
  - *Wasted interior samples:* the bank is thin, so splats and first hits are nearly the same population.

  The choices are kept because they are cheap and are the ones that matter at his scale.
- **The features matter more than the recipe.** The first version's hand-picked features (three blurs at the point,
  four close sun taps, the sun's height) scored 0.074 against 0.086 now, on a comparable (not identical) set of
  splats. The pyramid's sun reads get coarse with distance, and the near ones carry most of the shadow in a bank this
  small.
- Both cheap methods miss where the mist is finer than the coarse grid (the *error* view shows where). A finer base
  level would matter more there than a bigger network.

**Performance, as the article reports it** (laptop RTX 4080, cloud pass only):
- His neural shading costs about **20% more** GPU time than the conventional approximation it replaces: 4K 1.88 →
  2.32 ms, 5K 3.34 → 4.24 ms, 8K 7.83 → 9.21 ms.
- It uses fewer texture reads per step (12 against 14), but adds 512 multiply-adds.
- What it buys is accuracy across sun angles: within 0.90–1.01 of the path-traced reference at twelve of thirteen sun
  positions, where the approximation ranges from 0.21 to 2.17.

Caveats:
- The comparison is per splat, against the chosen lighting model, which is itself an approximation. It is not against a
  full volumetric image, so it shows the network approximates that model well; it doesn't show neural rendering is
  better.
- **The cost per splat is understated** by "12 reads and ~500 multiply-adds":
  - the lighting runs in the vertex shader, once for each of a splat's four corners;
  - each pyramid read is a hand-made trilinear lookup of eight texels;
  - so a splat costs four times (12 × 8 texel fetches + ~500 multiply-adds).

  Lighting once per splat (a pass into a texture, read by the quad) is the obvious fix. It should be measured on a phone
  first.
- Phone timing is unmeasured: headless Chrome renders in software.
- The network adds shading work and doesn't remove sorting or overdraw.

`?light=reference|baked|analytic|neural` · `?az= ?el=` (the sun) · `?bank=1|9` · `?diff` (the error view). Board:
`node cells/lab/devtools/splats-mist.mjs`; retrain: `node cells/lab/devtools/splats-mist-train.mjs`.

## Where it could go

Roughly in order of what each teaches:

- **View-dependent colour**: read the higher SH bands from `.ply` and evaluate them in the shader. Compare the same
  scene with and without.
- **SPZ / SOG loading**: real compression, and scenes from phone capture apps (Scaniverse, Polycam) and SuperSplat.
- **GPU sorting**: a bitonic sort in WebGL2, or a radix sort in WebGPU. Measure it against the worker sort.
- **Editing**: select splats by region and delete, recolour or move them. Splats are just data, so editing is easy.
- **Splats with other things**: depth-composite splats with ordinary meshes (Labyrinth's stone, Taohua's paths), or
  make splats procedurally from the lab's own worlds, the way the garden is made.
- **Training in the browser**: a tiny optimiser fitting a few thousand 2D Gaussians to a photo (WebGPU). It's the
  clearest way to understand how the 3D version learns.

## Flags

`?scene=stone|brushes|composed|bench|mist|garden|plush|nike|train` · `?compose=0` · `?halo=0` · `?halopx=` · `?policy=ranks|rules|learned` · `?judge` · `?look=dry|wash` · `?detail=0..1` · `?thin=even` · `?only=wash` · `?view=hero|grazing|reverse` · `?orbit` · `?detail=0.25|0.55|1` (sparse, intermediate, resolved) · `?brush` · `?occluder=0` · `?clean` (no controls) · `?url=…` (any `.splat` or `.ply` CORS lets it read) · `?up=1` (for a file that's
y-up) · `?mode=0..3` · `?size=` · `?res=` · `?count=` (garden size) · `?noworkers` · `?preview`

Checks: `node cells/lab/devtools/splats.test.mjs` (formats, covariance, sort) and
`node cells/lab/devtools/splats-shot.mjs [garden plush nike train]` (renders a board of each).
