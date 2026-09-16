/**
 * ── THE IMPOSTOR'S ATLAS: THE FAR TREE IS THE NEAR TREE, PHOTOGRAPHED ──
 *
 * The first impostor drew its silhouette ANALYTICALLY — a width profile per
 * form, two lobes of low-frequency wobble — and the seat's verdict on it was
 * exact: a placeholder. A card that invents a shape can only ever agree with
 * the skeleton beside it by coincidence, so the handoff is a change of species
 * however carefully the colours are matched.
 *
 * This bakes the ACTUAL variant — the same `EzVariant.geometry` the skeleton
 * tier draws, with its own wood, its own crown cards and its own faceTone —
 * from a grid of directions into one texture, and the card samples it. The far
 * tree is then the near tree seen from further away, which is the only
 * definition of an impostor that survives a player driving toward one.
 *
 * ── IT IS BAKED ON THE DEVICE, AT RUNTIME, AND THAT IS A DECISION ──
 *
 * The obvious alternative is a devtool that renders the atlas offline and
 * writes it into the bundle beside `flora-ez-baked.ts`. Three things against
 * it, and each is recorded elsewhere in this repo as a fault already paid for:
 * the deploy transpile already runs at seven tenths of the deployer's memory
 * ceiling and 27% of the bundle is baked data, so another megabyte is a stuck
 * deploy waiting to happen; a baked asset goes STALE the moment anybody edits
 * a recipe, and the bake it must agree with is itself generated; and the
 * atlas depends on which variants the district's own palette picked, which is
 * a fact about where the truck is standing and cannot be known offline.
 *
 * The cost is a few hundred draws of a few hundred triangles into one render
 * target, once per variant, sliced one variant per refresh — and a variant
 * that has not baked yet simply does not stand an impostor up that sweep.
 *
 * ── EIGHT AZIMUTHS, THREE ELEVATIONS, AND A PLAN ──
 *
 * The card geometry is unchanged: an upright card that turns about Y toward
 * the camera, and a flat card for looking down, weighted continuously by the
 * camera's elevation. A full octahedral impostor — one view-aligned quad over
 * a hemisphere of directions — was designed and rejected, because the frame of
 * a view-aligned quad is undefined when the camera looks straight down and the
 * chart camera looks 89.9 degrees down: the roll would have to come from
 * somewhere, and every candidate for that somewhere either spins with the map
 * or snaps at a tile boundary. An upright card has world up for its up at
 * every azimuth, which is exactly the frame the bake uses, so there is no
 * ambiguity to resolve; and the plan view is a separate tile whose rotation is
 * the TREE'S own yaw, which is a fact about the tree rather than the camera.
 *
 * The azimuth is read in the tree's LOCAL frame (the view azimuth less the
 * tree's yaw), so two trees of one variant standing together show different
 * faces from the same seat — which is what the old analytic phase bought, kept
 * for the same reason.
 */
import * as THREE from 'three';

/** One slot's tile grid: azimuths across, elevations down, then the plan view
 *  alone on the last row. Sized against what a tree is actually DRAWN at: the
 *  art frame is about 148x320 and a 20 m tree at the tier's near edge (260 m)
 *  subtends about 25 rows, so a 40 px tile is already over its drawn size. */
export const IMP_ATLAS = {
  /**
   * ── THIRTY-TWO, AND THE ATLAS PACKS TILES RATHER THAN RECTANGLES ──
   *
   * It was 40, in a 8x4 rectangular block a variant — 32 tile cells reserved
   * to hold 25 views, the last row reading `TOP . . . . . . .` with seven
   * cells wasted. Three by six of those blocks is EIGHTEEN slots, and a slot
   * is never reclaimed, so a nineteenth variant met anywhere in a session was
   * locked out for the rest of it: the tree had no card, drew nothing at all,
   * and popped into existence when it later crossed into the geometry tier.
   *
   * THE CAPACITY HAS TO BE THE WHOLE VARIANT SPACE, not a district's demand.
   * With an append-only allocator the working set is the union of everywhere
   * the truck has been, so sizing against one district's worst case (24) is
   * sizing against the wrong quantity — `devtools/imp-atlas.test.mjs` asserts
   * against the total instead, and today that is 37.
   *
   * 1024 / 32 = 32 tiles a side = 1,024 cells; packed COMPACTLY at 25 views a
   * variant that is **40 slots**, with three spare over the whole atlas. The
   * same 1024 RGBA8 target, no eviction, no indirection, and slot indices stay
   * permanent — which is what lets an instance carry one. A 2048 atlas would
   * have given 72 and cost four times the texture memory for a tier whose
   * whole argument is that it is cheap.
   *
   * WHAT IT COSTS is a fifth of every card's resolution, and this record's own
   * note already argued that is affordable: a 20 m tree at the tier's near
   * edge subtends about 25 rows, so 32 is still over its drawn size where 40
   * was well over it.
   */
  tile: 32,
  /** Azimuths round the tree. Eight is 45 degrees a step, and the fragment
   *  blends the two nearest, so what a driver sees turning past a tree is a
   *  cross-fade rather than a snap. */
  az: 8,
  /** Elevation rows, in degrees above the horizon: what a chase seat sees,
   *  what a low drone sees, and what a high drone sees. Past the last one the
   *  plan card takes over, which is what `uImpTop` already weights. */
  el: [8, 32, 58] as const,
  /** How many TILES a variant occupies: every azimuth at every elevation, plus
   *  the plan. Twenty-five — and the old rectangular block reserved 32. */
  get views(): number { return this.az * this.el.length + 1; },
  /** The plan view's own index in that run, which is the last one. */
  get planView(): number { return this.az * this.el.length; },
  /** Tiles across and down the whole atlas. */
  get grid(): number { return Math.floor(this.size / this.tile); },
  size: 1024,
} as const;

/**
 * ── THE SLOTS ARE A LINEAR RUN OF TILES, NOT A GRID OF BLOCKS ──
 *
 * Slot s owns tile cells `[s*views, s*views + views)`, which WRAP across rows
 * — a variant's twenty-five tiles are contiguous in the linear index and are
 * not a rectangle in the atlas. Nothing needs them to be: the bake renders
 * each tile into its own viewport and the shader derives a tile's position
 * arithmetically, so the only thing a rectangle ever bought was the seven
 * wasted cells it padded to.
 */
export const IMP_ATLAS_SLOTS = Math.floor(
  (IMP_ATLAS.grid * IMP_ATLAS.grid) / IMP_ATLAS.views);

/**
 * What the world needs to know about a baked slot to place its card: the
 * horizontal and vertical half-extents of the ortho box the tiles were
 * rendered with, and the height of that box's centre — all as fractions of
 * the skeleton's own unit height, so they scale with the tree for free.
 *
 * THE BOX IS NOT SQUARE, and that is resolution rather than pedantry: a
 * columnar aspen is a fifth as wide as it is tall, so a square box would spend
 * four fifths of every tile on empty sky and draw the tree at a fifth of the
 * tile's resolution. The card in the world is the same rectangle, so the two
 * cannot disagree.
 */
export interface ImpAtlasSlot {
  /** Which of the atlas's slots this is. */
  slot: number;
  /** Horizontal half-extent, in unit-height units. */
  hx: number;
  /** Vertical half-extent. */
  hy: number;
  /** The box centre's height above the tree's base. */
  cy: number;
}

/** A hair of margin round the ortho box so a tile's content can never touch
 *  its own edge and bleed into the neighbour under bilinear minification. */
const FIT = 1.06;

/** A view's own tile cell, in tiles across and down the whole atlas. The one
 *  place the packing is written on the CPU; the shader's is `impTileRect`,
 *  and `devtools/imp-atlas.test.mjs` holds the two to the same answer. */
export function viewOrigin(slot: number, view: number): [number, number] {
  const t = slot * IMP_ATLAS.views + view;
  return [t % IMP_ATLAS.grid, Math.floor(t / IMP_ATLAS.grid)];
}

/** A side view's index within a slot's run: elevation rows of azimuths. */
export function sideView(ax: number, row: number): number {
  return row * IMP_ATLAS.az + ax;
}

/**
 * The direction the bake's camera stands in for one tile, in the tree's own
 * frame. Azimuth is measured so that (sin, cos) is the horizontal direction
 * FROM the tree TO the camera, which is the same convention the card's own
 * `impDir` uses — see the note in `IMP_ATLAS_GLSL`, where the two have to
 * agree or every tree faces the wrong way.
 */
export function tileDirection(ax: number, row: number): THREE.Vector3 {
  if (row >= IMP_ATLAS.el.length) return new THREE.Vector3(0, 1, 0);
  const th = (ax / IMP_ATLAS.az) * Math.PI * 2;
  const ph = (IMP_ATLAS.el[row] * Math.PI) / 180;
  const c = Math.cos(ph);
  return new THREE.Vector3(Math.sin(th) * c, Math.sin(ph), Math.cos(th) * c);
}

/**
 * The GLSL both cards read. Two declarations and one lookup, written once so
 * the plan view and the upright view cannot drift apart about where a tile is.
 *
 * NO BACKTICKS ANYWHERE IN HERE: this is a TS template literal by the time it
 * reaches the shader and one would end it. The file's own doctrine records
 * five separate rounds lost to exactly that.
 */
export const IMP_ATLAS_GLSL = [
  'uniform sampler2D uImpAtlas;',
  'uniform vec4 uImpAtlasK;',   // tile px, tiles a side, views a slot, atlas px
  // ── A VIEW IS A TILE IN A LINEAR RUN, NOT A CELL IN A BLOCK ──
  //
  // Slot s owns tiles [s*V, s*V+V) and they wrap across rows, so a variant is
  // contiguous in the index and is not a rectangle in the texture. That is
  // what turns 1024 tile cells into 40 slots instead of 32: the rectangular
  // form padded 25 views up to a 8x4 block and wasted seven cells a variant.
  //
  // The half-texel inset is what stops a bilinear read at the very edge of a
  // tile reaching into its neighbour — and it matters MORE now, because a
  // tile's neighbour is no longer guaranteed to be another view of the same
  // tree: the last tile of one slot sits beside the first of the next.
  'vec4 impTileRect(float slot, float view) {',
  '  float T = uImpAtlasK.x, G = uImpAtlasK.y, V = uImpAtlasK.z, A = uImpAtlasK.w;',
  '  float t = slot * V + view;',
  '  vec2 o = vec2(mod(t, G), floor(t / G)) * T;',
  '  return vec4((o + 0.5) / A, (o + T - 0.5) / A);',
  '}',
  'vec4 impAtlasAt(float slot, float view, vec2 uv) {',
  '  vec4 r = impTileRect(slot, view);',
  '  return texture2D(uImpAtlas, mix(r.xy, r.zw, clamp(uv, 0.0, 1.0)));',
  '}',
  // ── UN-PREMULTIPLY, BECAUSE THE BAKE IS MULTISAMPLED ──
  // The render target resolves colour by coverage against a cleared
  // (0,0,0,0), so a silhouette texel carries its shade scaled by its own
  // alpha. Dividing it back out is what keeps a leaf edge the tone of a leaf
  // rather than a tone fading to black, and it is safe because nothing under
  // the alpha test is ever read.
  'vec3 impUnpre(vec4 t) { return t.rgb / max(t.a, 0.02); }',
].join('\n');

/**
 * The bake's own material: it writes what the card needs and nothing else.
 *
 * R is the SHADE — the skeleton's own faceTone, lifted toward the crown's top
 * so a stand reads as bodies rather than as flat cut-outs. G is the WOOD flag,
 * so the card can tint the crown with the tree's own colour and the timber
 * with bark, which is exactly what `ezMaterial` does one tier in. A is
 * coverage. B is spare and is written zero rather than left undefined.
 *
 * THERE IS NO DIRECTIONAL LIGHT IN HERE, deliberately. The card is a Lambert
 * material with an analytic crown normal, so the sun is applied at draw time
 * and moves with the day; baking a sun into the atlas would freeze the world's
 * light into the far half of every wood.
 */
function bakeMaterial(topY: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    uniforms: { uTopY: { value: Math.max(1e-3, topY) } },
    vertexShader: [
      'attribute float aWood;',
      'uniform float uTopY;',
      'varying float vW; varying vec3 vC; varying float vH;',
      'void main() {',
      '  vW = aWood; vC = color; vH = clamp(position.y / uTopY, 0.0, 1.0);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying float vW; varying vec3 vC; varying float vH;',
      'void main() {',
      '  float tone = dot(vC, vec3(0.299, 0.587, 0.114));',
      '  gl_FragColor = vec4(clamp(tone * (0.70 + 0.40 * vH), 0.0, 1.0), vW, 0.0, 1.0);',
      '}',
    ].join('\n'),
  });
}

/** The render target the whole atlas lives in. One texture, so the tier stays
 *  one draw call however many variants a district grows. */
export function makeImpAtlasTarget(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(IMP_ATLAS.size, IMP_ATLAS.size, {
    minFilter: THREE.LinearFilter,
    // NEAREST magnification is the house rule — the composite magnifies with
    // nearest neighbour and a smoothly filtered impostor beside a hard-edged
    // skeleton reads as a different renderer.
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    generateMipmaps: false,
    samples: 4,
  });
  rt.texture.generateMipmaps = false;
  rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

/**
 * Render one variant into one slot: every azimuth at every elevation, then the
 * plan view. Returns the slot's own metrics, which the world needs to size the
 * card — measured off the geometry rather than declared, the same rule the
 * skeleton bake's silhouette vocabulary already follows.
 */
export function bakeImpAtlasSlot(
  renderer: THREE.WebGLRenderer,
  rt: THREE.WebGLRenderTarget,
  geometry: THREE.BufferGeometry,
  slot: number,
): ImpAtlasSlot {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox as THREE.Box3;
  const topY = bb.max.y;
  // The horizontal half-extent is the larger of the two axes, because the card
  // turns and must cover the tree from every azimuth.
  const hx = Math.max(1e-3, Math.max(
    Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
    Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)),
  ) * FIT);
  const cy = (bb.min.y + bb.max.y) * 0.5;
  const hy = Math.max(1e-3, (bb.max.y - bb.min.y) * 0.5 * FIT);

  const scene = new THREE.Scene();
  const mat = bakeMaterial(topY);
  const mesh = new THREE.Mesh(geometry, mat);
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-hx, hx, hy, -hy, 0.01, 20);
  const centre = new THREE.Vector3(0, cy, 0);

  const T = IMP_ATLAS.tile;
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  // ── THE VIEWPORT OF A BOUND RENDER TARGET IS THE TARGET'S OWN ──
  //
  // `renderer.setViewport` writes the CANVAS viewport, and three's
  // `setRenderTarget` overwrites the live one from `renderTarget.viewport`
  // whenever a target is bound — so a per-tile `setViewport` is read by
  // nothing at all while this runs. It cost a whole measurement: every tile
  // was rendered over the WHOLE atlas at full size, each variant erasing the
  // last, and the tier came back drawing a tenth of the pixels it should with
  // its ink under the black gate. The tool said so in one line and the frames
  // would never have explained it.
  const prevRtView = rt.viewport.clone();
  const prevRtScissor = rt.scissor.clone();
  const prevRtTest = rt.scissorTest;
  rt.scissorTest = true;
  const draw = (view: number, dir: THREE.Vector3, up: THREE.Vector3, sq: boolean): void => {
    cam.left = -hx; cam.right = hx;
    cam.top = sq ? hx : hy; cam.bottom = sq ? -hx : -hy;
    cam.up.copy(up);
    cam.position.copy(centre).addScaledVector(dir, 6);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    const [tx, ty] = viewOrigin(slot, view);
    const px = tx * T, py = ty * T;
    // THE Y AXIS IS THE TEXTURE'S, NOT THE BLOCK'S. A render target's rows run
    // from the bottom, and the tile grid above is written top-down, so a
    // viewport placed at the block's own y would put row 0 at the bottom and
    // every lookup would read the wrong elevation.
    const vy = IMP_ATLAS.size - py - T;
    rt.viewport.set(px, vy, T, T);
    rt.scissor.set(px, vy, T, T);
    renderer.setRenderTarget(rt);
    renderer.clearDepth();
    renderer.render(scene, cam);
  };
  for (let row = 0; row < IMP_ATLAS.el.length; row++) {
    for (let ax = 0; ax < IMP_ATLAS.az; ax++) {
      draw(sideView(ax, row), tileDirection(ax, row), new THREE.Vector3(0, 1, 0), false);
    }
  }
  // ── THE PLAN VIEW'S UP IS -Z, AND THE CARD'S UV DEPENDS ON IT ──
  // three builds a camera basis as x = normalize(cross(up, eye - target)); at
  // (0, d, 0) looking down with up = (0, 0, -1) that is world +x, and screen
  // up is world -z. So the tile's u runs along world +x and its v along -z,
  // which is the mapping the flat card writes.
  draw(IMP_ATLAS.planView, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), true);

  rt.viewport.copy(prevRtView);
  rt.scissor.copy(prevRtScissor);
  rt.scissorTest = prevRtTest;
  renderer.autoClear = prevAuto;
  renderer.setRenderTarget(prevTarget);
  mat.dispose();
  return { slot, hx, hy, cy };
}

/** Clear the whole atlas to nothing once, so an unbaked slot is transparent
 *  rather than whatever the driver left in the buffer. */
export function clearImpAtlas(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget): void {
  const prev = renderer.getRenderTarget();
  const c = new THREE.Color();
  const a = renderer.getClearAlpha();
  renderer.getClearColor(c);
  rt.scissorTest = false;
  rt.viewport.set(0, 0, rt.width, rt.height);
  rt.scissor.set(0, 0, rt.width, rt.height);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.setClearColor(c, a);
  renderer.setRenderTarget(prev);
}
