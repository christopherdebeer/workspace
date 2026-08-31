import * as THREE from 'three';

/**
 * ── GRAIN: THE SURFACE TEXTURE EVERYTHING SOLID WEARS ──
 *
 * Extracted from main so a lab can put the SAME shader on the same geometry.
 * A flora lab that lit its trees with a plain Lambert would be showing you a
 * different tree from the one the game draws — and the grain is a large part
 * of what "tree detail" means here, since nothing in this world is textured
 * and this is the only thing standing between a crown and a flat facet.
 */

/**
 * …AND GRAIN, IN THE FRAGMENT SHADER, WHICH IS ALSO NEARLY FREE HERE.
 *
 * The world renders at 148x320 — forty-seven thousand pixels, fewer than a
 * thumbnail — and is magnified with nearest-neighbour afterwards. That inverts
 * the usual advice: per-fragment work is the cheap resource in this engine and
 * per-vertex, per-draw work is the scarce one. So mottle is procedural and
 * per-pixel rather than a texture: no atlas, no memory, no bandwidth, no UVs,
 * and it scales with the object instead of aliasing like a bitmap.
 *
 * COARSE ON PURPOSE. The composite quantises to 14 levels, so one palette step
 * is about 0.07 in sRGB and anything subtler than that is eaten by the
 * quantiser or smeared into the dither — measured in the shutter round, where
 * a six-tap average of flat-banded colour moved the picture by 0.23/255. Blobs
 * a metre or two across at a tenth of the base tone survive; fine grain does
 * not, and would shimmer at range besides. Which is why it fades with
 * distance: at 200m a bush is three pixels tall and its texture is noise.
 */
export const GRAIN_GLSL = `
  float grHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float grNoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(grHash(i), grHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(grHash(i + vec3(0.0, 1.0, 0.0)), grHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(grHash(i + vec3(0.0, 0.0, 1.0)), grHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(grHash(i + vec3(0.0, 1.0, 1.0)), grHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }`;
/** Live handles, so the grain can be turned off for an A/B without a rebuild —
 *  each carrying the amplitude it was authored with, so the dial scales the
 *  set without having to know which material is which. */
export const grainU: Array<{ tag: string; base: number; u: { uGrainAmp: { value: number } } }> = [];
export function grainFx(mat: THREE.Material, tag: string, amp: number, scale: number): void {
  const prev = mat.onBeforeCompile;
  const u = { uGrainAmp: { value: amp }, uGrainScale: { value: scale },
    uGrainNear: { value: 70 }, uGrainFar: { value: 240 } };
  grainU.push({ tag, base: amp, u });
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrainP; varying float vGrainFade;
        uniform float uGrainNear; uniform float uGrainFar;`)
      // AFTER project_vertex, where mvPosition exists and the instance matrix
      // has been applied — the world position this needs is the INSTANCE's,
      // or every rock on the continent wears the same blotches.
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 gWP = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            gWP = instanceMatrix * gWP;
          #endif
          vGrainP = (modelMatrix * gWP).xyz;
          vGrainFade = 1.0 - smoothstep(uGrainNear, uGrainFar, -mvPosition.z);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrainP; varying float vGrainFade;
        uniform float uGrainAmp; uniform float uGrainScale;
        ${GRAIN_GLSL}`)
      // On diffuseColor, BEFORE the lighting: grain that is lit is a property
      // of the surface; grain added afterwards is a property of the screen.
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uGrainAmp > 0.001 && vGrainFade > 0.001) {
          // THREE OCTAVES. The coarse one is the patch (lichen, a clump of
          // canopy), the middle breaks the patch, and the fine one is what
          // actually fights the flat facet — without it the shading is smooth
          // across a face and the eye still reads a plane.
          // WEIGHTED TOWARD THE FINE END. The first cut put half its energy in
          // the coarsest octave, which tints a whole rock and does nothing to
          // the flat facet it is standing on. The finest octave is held at
          // roughly one art pixel at conversational range — past that it is
          // shimmer, not texture, and this world magnifies every pixel it has.
          float gN = grNoise(vGrainP * uGrainScale) * 0.40
                   + grNoise(vGrainP * uGrainScale * 2.9) * 0.34
                   + grNoise(vGrainP * uGrainScale * 6.7) * 0.26;
          // CONTRAST IS NOT AMPLITUDE. Value noise piles up near its middle, so
          // most of a surface sat within one palette step of flat however hard
          // the amplitude was pushed. A gamma under one drags the mid values
          // out toward the ends — the same total swing, far more of it landing
          // on the far side of the quantiser, which is the only place texture
          // can be seen at fourteen levels.
          float gD = gN - 0.5;
          gD = sign(gD) * pow(abs(gD) * 2.0, 0.72) * 0.5;
          diffuseColor.rgb *= 1.0 + gD * uGrainAmp * vGrainFade;
        }`);
  };
  // Materials that inject different source MUST NOT share a compiled program;
  // three's cache keys on parameters, not on onBeforeCompile.
  mat.customProgramCacheKey = () => tag;
}
