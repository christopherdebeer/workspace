/** ── `patch` IS A RESERVED WORD, AND THIS FUNCTION'S PARAMETER WAS CALLED IT ──
 *
 * The parameter below is `clumpN`, which is also what the caller calls it
 * (`sClumpN`), and it is not a style preference. `patch` is reserved in GLSL
 * ES 3.00 — three compiles `#version 300 es` on a WebGL2 context, which is
 * every current phone — so the sward's vertex program did not compile at all
 * on the device:
 *
 *   THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
 *   ERROR: 0:224: 'patch' : Illegal use of reserved word
 *
 * TWO PROGRAMS, AND THE WORLD LOOKED FINE, because a program that fails to
 * link logs to the console and throws nothing. The harness would have caught
 * it — measured, not assumed: `openDrive` gets WebGL 2.0 / GLSL ES 3.00 over
 * ANGLE and SwiftShader, and rejects this exact construct — but only once a
 * tool DRAWS the material, a program being compiled on its first render. It
 * shipped from an environment that could make no WebGL context at all. This
 * repo already records the same fault for `cast` in the façade shader;
 * `devtools/glsl-reserved.test.mjs` is what checks it now, in pure node.
 *
 * Structural expression of the EXISTING sward population. No additional
 * samples, instances, vertices or species-density rules. Mineral and emergent
 * suitability come from the same substrate/hydro field the terrain uses.
 * Flowers and stones keep their established geometry; their slots are excluded.
 * The ordinary nine-vertex tuft can also describe a low fan, broad leaves or
 * an upright culm with two side leaves. This is an intermediate herb layer,
 * not a claim that the three triangles can describe a woody shrub. */
export const SWARD_STRUCTURE_GLSL = `
  vec3 swStructure(vec3 p, float blade, float habitat, float mineral,
    float reeds, float sizeRoll, float clumpN, out float tall, out float stiffness) {
    vec3 g = p;
    float tip = step(0.01, p.y);
    float angle = blade * 2.0943951;
    vec2 axis = vec2(cos(angle), sin(angle));
    tall = 0.0; stiffness = 1.0;
    if (reeds > 0.5) {
      // A sheltered margin alternates upright culms and low sedge fans.
      // Suitability, not the broad Water habitat label, permits emergents.
      if (sizeRoll > 0.48) {
        if (blade < 0.5) { g.xz *= 0.28; g.y *= 2.8; }
        else { g.xz = p.xz * 0.8 + axis * tip * 0.15;
          g.y = 0.22 + p.y * (blade < 1.5 ? 1.55 : 1.15); }
        tall = 1.0; stiffness = 0.38;
      } else {
        g.xz = p.xz * 1.5 + axis * tip * 0.24;
        g.y *= 1.15 + blade * 0.12;
        stiffness = 0.6;
      }
    } else if (mineral > 0.25 && sizeRoll < mineral * 0.82) {
      // Low, spreading crevice tufts survive where bedrock interrupts soil.
      g.xz = p.xz * 1.35 + axis * tip * 0.12;
      g.y *= 0.43 + blade * 0.09;
      stiffness = 0.55;
    } else if (habitat > 0.5 && habitat < 1.5 && sizeRoll > 0.42) {
      // Broad, low understorey leaves; retain gaps and the shared foot.
      g.xz = p.xz * 2.5 + axis * tip * 0.20;
      g.y *= 0.72 + blade * 0.08;
      stiffness = 0.65;
    } else if (mineral < 0.35 && sizeRoll > 0.86
      && clumpN > 0.38 && (habitat < 0.5 || habitat > 3.5)) {
      // Occasional meadow/ruin culms bridge the height to low shrubs.
      // Their far-band height is capped outside this function.
      if (blade < 0.5) { g.xz *= 0.45; g.y *= 2.25; }
      else { g.xz = p.xz * 1.45 + axis * tip * 0.13;
        g.y = 0.12 + p.y * (blade < 1.5 ? 1.25 : 0.95); }
      tall = 1.0; stiffness = 0.72;
    } else {
      // A coherent patch varies between upright blades and splayed tussocks.
      float spread = smoothstep(0.25, 0.70, clumpN);
      g.xz += axis * tip * spread * 0.11;
      g.y *= 0.85 + spread * 0.35 + blade * 0.07;
    }
    return g;
  }
`;
