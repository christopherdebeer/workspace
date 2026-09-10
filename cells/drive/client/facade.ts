import * as THREE from 'three';
import { MARK_COLS, MARK_PALETTE, drawMarkAtlas } from './graffiti';

/** The same small PRNG main.ts seeds its textures with, so an atlas drawn
 *  here and one drawn there are the same atlas. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ── THE FAÇADE: A BUILDING IS NOT A TILING BITMAP ──
 *
 * Openings have to land on floors, doors have to be at street level, ivy has
 * to climb from the ground and marks have to be within reach of a person —
 * none of which a repeating texture knows. So all of it is generated in the
 * fragment shader from the world position, with each building's own base
 * height arriving as a vertex attribute.
 *
 * LIVES IN ITS OWN MODULE SO A LAB CAN DRIVE IT. This was inline in main.ts,
 * which meant the only way to look at a façade was to find a town in the real
 * world, wait for OSM to serve it, and hope the camera landed on a wall — and
 * when the marks did not appear there was no way to tell a placement bug from
 * a streaming failure. A lab that imports THIS function is looking at the
 * production shader; a lab that reimplements it proves nothing.
 */

/**
 * ── THE MARK ATLAS ──
 *
 * Sixteen marks, white on TRANSPARENT, tinted per settlement by the facade
 * shader. Not a RepeatWrapping texture like the wall families: it is an atlas
 * and a repeat would wrap one mark into the next, so it clamps — and the
 * marks are drawn with a margin inside their cells because mipmapping (which
 * stays on, or distant walls shimmer) bleeds across cell boundaries.
 */
export const markAtlas = (() => {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  drawMarkAtlas(cv.getContext('2d')!, size, mulberry32(0x9a17));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  return t;
})();
/**
 * ── THE TINS AS A TEXTURE, NOT AN ARRAY ──
 *
 * The obvious shape for eight colours is `uniform vec3 uMarkPal[8]` indexed
 * by the building's tin — and it is illegal: GLSL ES 1.00 forbids indexing a
 * uniform array with a non-constant expression in a FRAGMENT shader, so the
 * whole facade program fails to compile on WebGL1 and every building in the
 * world loses its windows along with its marks. Found exactly that way: the
 * attribute arrived on the GPU, the marks did not draw, and nothing threw.
 *
 * A one-row lookup texture has no such restriction, costs one sample, and is
 * the same route the mark atlas itself already takes.
 */
const markTins = (() => {
  const data = new Uint8Array(MARK_PALETTE.length * 4);
  MARK_PALETTE.forEach((hex, i) => {
    data[i * 4] = (hex >> 16) & 255;
    data[i * 4 + 1] = (hex >> 8) & 255;
    data[i * 4 + 2] = hex & 255;
    data[i * 4 + 3] = 255;
  });
  const t = new THREE.DataTexture(data, MARK_PALETTE.length, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

/**
 * ── THE MARK TUNING, NAMED AND LIVE ──
 *
 * These were literals scattered through the shader, which meant every one of
 * them cost an edit, a build and a hunt for a wall to judge it against. They
 * are a named set now, carried as two vec4s, and the marks lab drives them
 * live — COPY there writes exactly this literal, so tuning found on a wall
 * arrives in the engine as a paste rather than as a memory of a slider.
 */
export interface MarkTuning {
  /** Metres of wall each placement patch spans. */
  patchM: number;
  /** The reachable band, in metres above the building's own base. */
  bandLo: number;
  bandHi: number;
  /** Mark box, metres square: the smallest, and how much larger it may get. */
  sizeMin: number;
  sizeVar: number;
  /** How much of the wall the paint covers, at its weakest and its strongest. */
  fadeMin: number;
  fadeVar: number;
  /** How far a mark may wander from its patch centre, as a share of it. */
  jitter: number;
}

export const MARK_TUNING: MarkTuning = {
  patchM: 5,
  bandLo: 0.4,
  bandHi: 3,
  sizeMin: 1.5,
  sizeVar: 0.85,
  fadeMin: 0.55,
  fadeVar: 0.35,
  jitter: 0.55,
};

// Shared BY REFERENCE across every façade material, so one write here reaches
// every wall in the world — a per-material copy would tune one building.
const uMarkA = { value: new THREE.Vector4() };
const uMarkB = { value: new THREE.Vector4() };
/**
 * ── NIGHT, AND WHAT A BUILDING IS AFTER DARK ──
 *
 * x = how much night (1 − dayF), y = what share of the openings are lit.
 *
 * Measured before this existed: at `?time=NIGHT` a Suresnes wall renders at
 * sRGB 13 and a linear luminance of 0.0052, against ground beside it at 0.13.
 * A building was a PURE BLACK SILHOUETTE — a hole in the frame with no wall,
 * no edge and not one lit window anywhere in the world, because the only thing
 * standing in for the missing bounce is `bldSkylit`'s emissive lift and that is
 * scaled by daylight, correctly, to nothing.
 *
 * A lit window is the cheapest realism in the game: per-fragment work is the
 * abundant resource here (the frame is ~148x320) and this is a hash, a step and
 * an add. It is also the one thing that makes a town read as INHABITED, which
 * no amount of daytime surface detail does.
 *
 * Written by main.ts beside the skylight lift, where dayF already lives.
 */
export const uFacNight = { value: new THREE.Vector2(0, 0.34) };
const uMarksU = { value: markAtlas };
const uMarkTinsU = { value: markTins };
function pushTuning(): void {
  const t = MARK_TUNING;
  uMarkA.value.set(t.patchM, t.bandLo, t.bandHi, t.sizeMin);
  uMarkB.value.set(t.sizeVar, t.fadeMin, t.fadeVar, t.jitter);
}
pushTuning();

/** Change the tuning everywhere at once. The lab's dials call this; nothing
 *  in the game does, which is the point — the game runs the defaults above. */
export function setMarkTuning(patch: Partial<MarkTuning>): MarkTuning {
  Object.assign(MARK_TUNING, patch);
  pushTuning();
  return MARK_TUNING;
}

export function facade(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    // Shared by reference: one atlas and one palette for the whole world, so
    // a material per paint costs nothing extra.
    sh.uniforms.uMarks = uMarksU;
    sh.uniforms.uMarkTins = uMarkTinsU;
    sh.uniforms.uMarkA = uMarkA;
    sh.uniforms.uMarkB = uMarkB;
    sh.uniforms.uFacNight = uFacNight;
    // THE BASE RIDES IN AS A VERTEX ATTRIBUTE, not off the model matrix.
    // Buildings batch per tile now (see flushBuildings), so one mesh carries
    // hundreds of them and modelMatrix[3][1] — the old source of "this
    // building's ground line" — is meaningless. Every batched vertex carries
    // its own building's base in aBase instead, and re-seating shifts the
    // attribute alongside the positions.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase;\nattribute float aMark;\nvarying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 facW = modelMatrix * vec4(transformed, 1.0);
        vFacW = facW.xyz;
        vFacN = mat3(modelMatrix) * objectNormal;
        vFacH = facW.y - aBase;
        vMark = aMark;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark;
        uniform sampler2D uMarks; uniform sampler2D uMarkTins;
        uniform vec4 uMarkA; uniform vec4 uMarkB; uniform vec2 uFacNight;
        float fah(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 41.31); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 fn = normalize(vFacN);
        // Roofs and floor slabs get grime and nothing else — a window in the
        // ceiling is the giveaway that this is a texture and not a building.
        if (abs(fn.y) < 0.55) {
          // Run the bay grid along whichever horizontal axis this wall faces.
          float u = abs(fn.x) > abs(fn.z) ? vFacW.z : vFacW.x;
          vec2 cell = vec2(u / 2.75, vFacH / 3.1);
          vec2 idc = floor(cell), f = fract(cell);
          float r = fah(idc + vec2(7.13, 3.31));
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.34, f.y) * step(f.y, 0.86);
          float door = step(0.33, f.x) * step(f.x, 0.67) * step(0.03, f.y) * step(f.y, 0.6);
          // Street level is doorways and shopfronts; above it, windows.
          float ground = step(vFacH, 3.1);
          float open = mix(win, mix(win * step(0.52, f.y), door, step(r, 0.36)), ground);
          open *= step(r, 0.76);                    // the rest are bricked up
          // ── GLASS IS A DARKENING OF THE WALL, NOT AN ABSOLUTE COLOUR ──
          //
          // These were fixed values — 0.05 to 0.17 — on the assumption that the
          // paint around them is pale limewash. Measured against the walls the
          // world actually builds, that assumption fails in two common cases and
          // INVERTS the façade when it does: on a face turned away from the sun,
          // and on any dark paint (oxide-red barns, brick, stained timber), the
          // wall renders below the glass and every window reads as a pale PANEL
          // stuck on the building rather than as an opening. Photographed at
          // Camps Bay as three beige rectangles on a red wall, and at Suresnes
          // as the brightest thing on a shaded gable.
          //
          // A window is a hole: whatever the wall is doing, the opening is
          // darker. So the void is a fraction OF the wall, with a small absolute
          // term so pure-black paint still shows an opening at all. That is one
          // multiply and it cannot invert.
          float shade = 0.20 + 0.16 * fah(idc + vec2(2.7));
          vec3 glass = diffuseColor.rgb * shade + vec3(0.012, 0.014, 0.020);
          // A few catch the low sun. Still absolute, and rightly so — a
          // reflection is the SKY's brightness, not the wall's.
          glass = mix(glass, vec3(0.62, 0.44, 0.2), step(0.94, fah(idc + vec2(11.3, 5.7))) * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, open * 0.9);
          // A one-pixel lintel/sill so the opening has an edge, not just a hole.
          float lint = step(0.86, f.y) * step(0.2, f.x) * step(f.x, 0.8) * (1.0 - ground);
          diffuseColor.rgb *= 1.0 - lint * 0.25;
          // ── SOMEBODY IS IN ──
          //
          // A share of the openings carry a light after dark. Per BAY, from the
          // bay's own hash, so a building lights up in a scatter rather than all
          // at once and the pattern is stable — a window that flickered as the
          // truck drove past would be worse than a dark town.
          //
          // BINARY, like every other hard-edged thing here: the composite
          // quantises to fourteen levels and dithers, so a soft falloff inside
          // the pane becomes noise rather than a softer light. It goes to
          // EMISSIVE and not to the diffuse colour, because at night the diffuse
          // is multiplied by almost no light — tinting it would change nothing,
          // which is the trap that makes this look like it is not working.
          //
          // Deliberately above the 0.62 bright-pass cut: a lit window at night
          // SHOULD bloom, the way the cat's eyes and the retroreflective signs
          // already do. Scaled by uFacNight.x so it is absent by day.
          float litBay = step(fah(idc + vec2(23.1, 6.7)), uFacNight.y);
          totalEmissiveRadiance += vec3(1.0, 0.74, 0.38) * 0.72
            * open * litBay * uFacNight.x;
          // IVY. Whole columns of wall get claimed, thickest at the base and
          // thinning as it climbs — which is what makes a ruin read as reclaimed
          // rather than merely dirty.
          float colv = floor(u * 0.8);
          float vine = smoothstep(0.6, 0.95, fah(vec2(colv, 17.3)))
            * exp(-vFacH * 0.13)
            * (0.5 + 0.5 * fah(vec2(colv, floor(vFacH * 0.75))));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.21, 0.09), clamp(vine, 0.0, 0.8));
          // ── MARKS ──
          //
          // Where someone stood. Everything about the placement is a rule
          // about a person with a can: REACHABLE (a tag at the fourth floor
          // is the giveaway that nobody put it there), on BLANK wall rather
          // than across a window, and SPARSE — a hash per patch against the
          // settlement's own density, so a street has a few and not a mural.
          //
          // The look rides in on aMark: sigil*8+tin in the integer part, the
          // density in the fraction. Packed because a building batch already
          // pays for aBase, and one more float is free where one more
          // attribute is not.
          float mdens = fract(vMark);
          if (mdens > 0.004 && vFacH > uMarkA.y && vFacH < uMarkA.z) {
            // A patch grid on the wall — 5m across, the height of the
            // reachable band. Marks are placed per PATCH, not per building:
            // one gable can carry two and the next wall none.
            vec2 mcell = vec2(u / uMarkA.x, (vFacH - uMarkA.y) / max(0.2, uMarkA.z - uMarkA.y));
            vec2 mid = floor(mcell), mfr = fract(mcell);
            float mrand = fah(mid + vec2(19.7, 4.3));
            if (mrand < mdens) {
              // ── THE MARK HAS A SIZE IN METRES, NOT A SHARE OF ITS PATCH ──
              //
              // Mapping the patch straight onto the atlas cell stretched every
              // mark by the patch's own aspect — 5m across against a 2.6m
              // band, so a tag came out twice as wide as it was tall: flat
              // smears, which is how the marks lab found this in about ten
              // seconds after the game could not answer it in an hour. The
              // mark now gets a SQUARE box a metre and a half or so on a side,
              // centred on a jittered point, and both axes are divided by the
              // same number — so it is the shape it was drawn as.
              float mw = uMarkA.w + uMarkB.x * fah(mid + vec2(4.4, 1.9));
              vec2 jit = vec2(fah(mid + vec2(3.1, 7.7)), fah(mid + vec2(8.7, 2.3))) - 0.5;
              vec2 centre = vec2(0.5 + jit.x * uMarkB.w, 0.5 + jit.y * uMarkB.w * 0.64);
              // Offsets from that centre IN METRES, which is what makes the
              // two axes comparable at all.
              vec2 dm = vec2((mfr.x - centre.x) * uMarkA.x,
                (mfr.y - centre.y) * max(0.2, uMarkA.z - uMarkA.y));
              vec2 q = dm / mw + 0.5;
              if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && open < 0.02) {
                // The settlement's own sigil most of the time, a neighbouring
                // cell of the atlas the rest: one hand dominates a place, but
                // it is not the only hand in it.
                // ── FLOOR BEFORE UNPACKING, OR THE DENSITY PICKS THE TIN ──
                // aMark is sigil*8 + tin + density. mod(vMark, 8.0) therefore
                // carries the FRACTION too: at density 0.999 a tin of 1 reads
                // as 1.999 and samples the next colour along. Found in the
                // marks lab in one glance — the wall was painting sign-blue
                // from a settlement whose tin is oxide red.
                float mi = floor(vMark);
                float sig = floor(mi / 8.0);
                float vary = step(0.62, fah(mid + vec2(5.5, 11.9)));
                float pick = mod(sig + vary * (1.0 + floor(fah(mid + vec2(2.2, 9.1)) * 2.0)), 12.0);
                vec2 acell = vec2(mod(pick, ${MARK_COLS}.0), floor(pick / ${MARK_COLS}.0));
                // The atlas row runs DOWN in canvas space and UP on the wall.
                vec2 auv = (acell + vec2(q.x, 1.0 - q.y)) / ${MARK_COLS}.0;
                float ink = texture2D(uMarks, auv).a;
                // Binary, like every other hard-edged thing in this world:
                // the composite quantises and dithers, so a soft edge here
                // becomes noise rather than a softer edge.
                if (ink > 0.5) {
                  vec3 tin = texture2D(uMarkTins, vec2((mod(mi, 8.0) + 0.5) / 8.0, 0.5)).rgb;
                  // Weathered per patch, and it never fully covers: old paint
                  // on a rough wall is a stain, not a sticker.
                  float fade = uMarkB.y + uMarkB.z * fah(mid + vec2(13.3, 6.1));
                  diffuseColor.rgb = mix(diffuseColor.rgb, tin, fade);
                }
              }
            }
          }
        }
        // Water staining below every horizontal break, on every face.
        diffuseColor.rgb *= 1.0 - 0.16 * fah(floor(vFacW.xz * 1.7) + floor(vFacH * 2.3));
      }`);
  };
}
