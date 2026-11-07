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

**The stone** is a cut stone on warm paper: broad slab faces, a wedge silhouette (tall at one end, tapering to the
other), a ledge whose overhang has a flat underside (the soffit), and a seam in a fracture plane. It's exact. The mesh is
each plane's polygon cut by the others, rays meet the planes, faces are sampled as their own polygons, and edges are
the true arrises where planes meet. So the marks describe geological structure the surface really has.

**The marks come in strokes.** Every mark belongs to a stroke (the seam, its branch, the ledge's lip, a face's wash, a
tuft of moss, the contact shadow). The stroke has one survival rank, and each mark's rank is the stroke's minus how
peripheral it is. So as the detail falls, a stroke *shortens*: the seam withdraws from its far end and keeps its hook,
the lip shortens from both ends, a face's wash withdraws toward its darkest pool, and moss loses its outliers. Nothing
crumbles into scattered pieces.

| mark | what it describes | in motion |
|---|---|---|
| **fracture** | the seam: tapered, broken twice; a branch | stays on the rock and goes behind it |
| **lip** | the ledge's edge, a straight line | the ledge comes into view from behind |
| **wash** | one tone for each face by how it's turned from the light: lit faces none, half-lit one, shadowed two, the recess and the soffit under the ledge darkest | goes first; the ledge's weight goes last of the wash |
| **stipple** | moss on the seam's damp side and at the foot | the outliers go first |
| **shadow** | the ground at the foot, reaching away from the light, and a dark found edge where stone meets ground | kept long |
| **contour** | marks along every arris, each knowing both its faces' normals | drawn only where one face turns toward you and the other away: the profile from this view, eased in as a face turns, broken into accents |

The fracture belongs to the rock and the contour belongs to this view of the rock.

**The two looks.** Same shape, camera and roughly the same number of marks (about 4,500 each).
- *Dry* tests how little it takes: broken seams, chips, parallel hatching (each face its own direction, closer the
  darker), clean paper.
- *Wash* tests whether the Gaussian's softness earns its place. Each face gets broad soft discs laid exactly on its
  plane, shrinking toward its arrises so the tone stays soft inside but holds at the edge. A darker rim gathers along
  the face's lower edges, where a wash's water runs and dries. A little granulation settles in the darkest washes, and
  the seam bleeds into the shadow side only. The result is tonal planes, which hatching can only suggest.

Two renderer details make the wash possible. Each corner of a mark's quad takes the depth of the surface the mark lies
on, so a broad disc on a face turned away isn't cut by the face's own depth. And the stone's exact mesh is the depth
occluder, so a blank face still hides the far side (toggle *occluder* in the reverse and grazing views to see it).

**Detail.** The wash goes first (half-lit, then shadow), then chips and loose stipple, then moss cores and contour
accents. The branch, shadow, the wash under the ledge, the lip and the hooked seam go last. *Evenly* thins the same
number of marks at random, for comparison.

**Brush.** With *brush* on, a finger on the stone brings the detail back where it touches. Patches merge, up to 48
are kept, and each is bound to the face it was laid on, so it doesn't reach through a thin ledge. A patch stays on the
surface as you turn.

`?only=wash|fracture|contour|stipple|shadow|lip|chip` shows one kind of mark alone.

Boards: `node cells/lab/devtools/splats-stone.mjs [views|pairs [dry|wash]|detail|occluder|brush]`. *pairs* is the
board for judging against a reference: within one look, the three cameras crossed with resolved and sparse detail, the
camera and marks fixed.

Next: the Bamboo connection. A cliff face could give up its wash while a ledge keeps its lip and a fissure its line.
A culm could keep its silhouette and nodes while its shaded body drops away.

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

`?scene=stone|garden|plush|nike|train` · `?look=dry|wash` · `?detail=0..1` · `?thin=even` · `?only=wash` · `?view=hero|grazing|reverse` · `?orbit` · `?brush` · `?occluder=0` · `?clean` (no controls) · `?url=…` (any `.splat` or `.ply` CORS lets it read) · `?up=1` (for a file that's
y-up) · `?mode=0..3` · `?size=` · `?res=` · `?count=` (garden size) · `?noworkers` · `?preview`

Checks: `node cells/lab/devtools/splats.test.mjs` (formats, covariance, sort) and
`node cells/lab/devtools/splats-shot.mjs [garden plush nike train]` (renders a board of each).
