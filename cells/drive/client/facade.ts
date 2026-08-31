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

export function facade(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    // Shared by reference: one atlas and one palette for the whole world, so
    // a material per paint costs nothing extra.
    sh.uniforms.uMarks = { value: markAtlas };
    sh.uniforms.uMarkTins = { value: markTins };
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
          // Glass: mostly dark voids, a few catching the low sun.
          vec3 glass = mix(vec3(0.05, 0.055, 0.07), vec3(0.13, 0.15, 0.17), fah(idc + vec2(2.7)));
          glass = mix(glass, vec3(0.62, 0.44, 0.2), step(0.94, fah(idc + vec2(11.3, 5.7))) * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, open * 0.9);
          // A one-pixel lintel/sill so the opening has an edge, not just a hole.
          float lint = step(0.86, f.y) * step(0.2, f.x) * step(f.x, 0.8) * (1.0 - ground);
          diffuseColor.rgb *= 1.0 - lint * 0.25;
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
          if (mdens > 0.004 && vFacH > 0.4 && vFacH < 3.0) {
            // A patch grid on the wall — 5m across, the height of the
            // reachable band. Marks are placed per PATCH, not per building:
            // one gable can carry two and the next wall none.
            vec2 mcell = vec2(u / 5.0, (vFacH - 0.4) / 2.6);
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
              float mw = 1.5 + 0.85 * fah(mid + vec2(4.4, 1.9));
              vec2 jit = vec2(fah(mid + vec2(3.1, 7.7)), fah(mid + vec2(8.7, 2.3))) - 0.5;
              vec2 centre = vec2(0.5 + jit.x * 0.55, 0.5 + jit.y * 0.35);
              // Offsets from that centre IN METRES, which is what makes the
              // two axes comparable at all.
              vec2 dm = vec2((mfr.x - centre.x) * 5.0, (mfr.y - centre.y) * 2.6);
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
                  float fade = 0.55 + 0.35 * fah(mid + vec2(13.3, 6.1));
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
