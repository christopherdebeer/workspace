# Shoreline review — 2026-09-08

Reviewed the deployed remote source after Claude continued the interrupted pass.
Base deployment: 1788878839369. All edits are exact replacements against the read
source; main.ts and the hydro shaders were not restored from an older snapshot.

Preserved: scene-light/cloud coupling, local sward colour sampling and ground gain,
wet-ground palette, channel trough/bed detail, eddies, retained rig wake, ford and
wetness diagnostics, and the shore=0 switch.

## Corrections

- Hydro CPU sampling now uses the shader's texel-centred grid (span/resolution),
  bilinear geometry/dynamics and nearest material/flags. Previous code used
  nearest sampling on span/(resolution-1), so the same cutoff did not align the
  truck and visible shore. The pure sampler is in hydro/field-sample.ts.
- The bank hash now uses integer intermediates below float32's exact-integer
  limit. The previous fractional hash's CPU/float32 results differed substantially
  at kilometre-scale coordinates. Tested lattice results agree within 1e-7.
- The resting coastal body again shares the surf mesh's 0.5 cutoff. Inland
  irregularity is preserved; class-zero fragments are rejected consistently.
- River edge blending uses metres/depth rather than a fixed fraction of width.
  Claude's palette, lighting and visual-depth treatment remain.
- Sward now uses the existing field's spare B/A lanes for reed/mineral suitability.
  The existing nine-vertex tuft becomes upright reeds or a three-face cobble;
  stones do not sway, and neither form inflates into a large distant object.
- The cached hydro field is consulted beside lakes as well as channels. Nearby
  dry bank context is separate from actual wetness; deep water cannot become
  ordinary grass. The existing road mask is still mandatory.
- Habitat slope considers both axes, with the additional ground read confined
  to bank/wetland texels. The pre-lush reed rate is lower to account for stalk size.
- A sward sweep records its START revision. A hydro update during a sweep now
  triggers a follow-up instead of falsely marking early rows as current.

## Validation

Strict TypeScript compilation passed against current remote hydro and switches.
client/shoreline-review-check.mjs covers CPU/float32 hash parity, independently
specified interpolated field values, gutter/tile-boundary continuity, dry versus
wet bank samples, habitat exclusions, actual sward field production and shore=0
reset, Three Lambert shader injection, and the existing hydro regression suite.

No GPU shader compilation, subjective shoreline appearance or iPhone FPS claim
is made from these checks. Use the existing Senqu fixtures and shore=0 comparison
for the next on-device review. Geometry/instance counts and draw-pass counts are
unchanged; shader work in bank slots and the budgeted field sweep is increased.
