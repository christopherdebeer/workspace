import * as THREE from 'three';
import { MARK_COLS, MARK_PALETTE, drawMarkAtlas } from './graffiti';
import { mulberry32 } from './rng';
import { FACADE_DEFAULTS, type FacadeGrammar } from './facade-grammar';
import { TRADITION_LIST, gramTable } from './traditions';

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

/**
 * ── THE OPENING GRAMMAR, NAMED AND LIVE ──
 *
 * The bay grid, the window and door boxes, the shares, the glass and the ivy
 * were literals in the shader below: one 2.75 x 3.1 m grid for the planet,
 * windows from 0.2 to 0.8 of a bay, a door in a third of the ground-floor
 * bays, and no way to ask whether a Provençal terrace and a timber farmhouse
 * should share any of it without an edit, a build and a hunt for a wall. The
 * building review named "one bay grid for the planet" as its open item and
 * the façade lab is what answers it — so, like the mark tuning above, the
 * grammar is a named set carried as four vec4s, the lab drives it live, and
 * COPY there writes exactly this literal.
 *
 * THE DEFAULTS ARE TODAY'S LITERALS TO THE DIGIT. Shipping this changes no
 * pixel; it changes where the numbers live. A per-tradition grammar is the
 * next unit, and it will arrive as a vertex attribute the way aMark did,
 * because buildings batch per tile and a uniform is per draw.
 */
export type { FacadeGrammar } from './facade-grammar';
export { FACADE_DEFAULTS } from './facade-grammar';
export const FACADE_GRAMMAR: FacadeGrammar = { ...FACADE_DEFAULTS };

/**
 * ── EVERY TRADITION'S GRAMMAR, AS A TEXTURE ──
 *
 * The same route as the mark tins, for the same GLSL ES 1.00 reason: a
 * building's tradition rides in as ONE float attribute (aGram, its row plus
 * one) and the shader reads that row — four RGBA8 texels — with texture2D.
 * Row 0 does not exist: aGram 0 means "the uniforms", which are
 * FACADE_DEFAULTS in the game and the dials in the lab. Built once from the
 * atlas at load; facade-grammar.ts owns the byte layout and the test decodes
 * it back.
 */
const gramTex = (() => {
  const { data, rows } = gramTable();
  const t = new THREE.DataTexture(data, 4, Math.max(1, rows), THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();
const uGramU = { value: gramTex };
const uGramN = { value: Math.max(1, TRADITION_LIST.length) };

// Shared by reference, like the mark tuning: one write reaches every wall.
const uFacA = { value: new THREE.Vector4() };
const uFacB = { value: new THREE.Vector4() };
const uFacC = { value: new THREE.Vector4() };
const uFacD = { value: new THREE.Vector4() };
function pushGrammar(): void {
  const g = FACADE_GRAMMAR;
  uFacA.value.set(g.bayM, g.storeyM, g.winX0, g.winX1);
  uFacB.value.set(g.winY0, g.winY1, g.doorX0, g.doorX1);
  uFacC.value.set(g.doorY1, g.doorShare, g.openShare, g.glassShade);
  uFacD.value.set(g.glassVar, g.lintel, g.ivy, g.stain);
}
pushGrammar();

/** Change the grammar everywhere at once. The façade lab's dials call this;
 *  nothing in the game does yet, which is the point — the game runs the
 *  defaults above until a tradition atlas says otherwise. */
export function setFacadeGrammar(patch: Partial<FacadeGrammar>): FacadeGrammar {
  Object.assign(FACADE_GRAMMAR, patch);
  pushGrammar();
  return FACADE_GRAMMAR;
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
    sh.uniforms.uFacA = uFacA;
    sh.uniforms.uFacB = uFacB;
    sh.uniforms.uFacC = uFacC;
    sh.uniforms.uFacD = uFacD;
    sh.uniforms.uGram = uGramU;
    sh.uniforms.uGramN = uGramN;
    // THE BASE RIDES IN AS A VERTEX ATTRIBUTE, not off the model matrix.
    // Buildings batch per tile now (see flushBuildings), so one mesh carries
    // hundreds of them and modelMatrix[3][1] — the old source of "this
    // building's ground line" — is meaningless. Every batched vertex carries
    // its own building's base in aBase instead, and re-seating shifts the
    // attribute alongside the positions.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase;\nattribute float aMark;\nattribute float aGram;\nvarying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark; varying float vGram;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 facW = modelMatrix * vec4(transformed, 1.0);
        vFacW = facW.xyz;
        vFacN = mat3(modelMatrix) * objectNormal;
        vFacH = facW.y - aBase;
        vMark = aMark;
        vGram = aGram;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark; varying float vGram;
        uniform sampler2D uMarks; uniform sampler2D uMarkTins;
        uniform vec4 uMarkA; uniform vec4 uMarkB; uniform vec2 uFacNight;
        uniform vec4 uFacA; uniform vec4 uFacB; uniform vec4 uFacC; uniform vec4 uFacD;
        uniform sampler2D uGram; uniform float uGramN;
        float fah(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 41.31); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 fn = normalize(vFacN);
        // ── WHOSE GRAMMAR: THE BUILDING'S TRADITION, OR THE UNIFORMS ──
        // aGram > 0 names a row of the atlas texture (see gramTex); 0 is the
        // uniforms, which the game keeps at FACADE_DEFAULTS and the lab drives.
        // The scales are facade-grammar.ts's GRAM_FIELDS, to the digit.
        vec4 gA = uFacA, gB = uFacB, gC = uFacC, gD = uFacD;
        if (vGram > 0.5) {
          float gy = (floor(vGram + 0.5) - 0.5) / uGramN;
          gA = texture2D(uGram, vec2(0.125, gy)); gA.xy *= 8.0;
          gB = texture2D(uGram, vec2(0.375, gy));
          gC = texture2D(uGram, vec2(0.625, gy));
          gD = texture2D(uGram, vec2(0.875, gy)); gD.z *= 2.0;
        }
        // Roofs and floor slabs get grime and nothing else — a window in the
        // ceiling is the giveaway that this is a texture and not a building.
        if (abs(fn.y) < 0.55) {
          // Run the bay grid along whichever horizontal axis this wall faces.
          // Every number in the grid is FACADE_GRAMMAR (above), carried in
          // gA..uFacD; the defaults are the literals that used to be here.
          float u = abs(fn.x) > abs(fn.z) ? vFacW.z : vFacW.x;
          vec2 cell = vec2(u / gA.x, vFacH / gA.y);
          vec2 idc = floor(cell), f = fract(cell);
          float r = fah(idc + vec2(7.13, 3.31));
          float win = step(gA.z, f.x) * step(f.x, gA.w) * step(gB.x, f.y) * step(f.y, gB.y);
          float door = step(gB.z, f.x) * step(f.x, gB.w) * step(0.03, f.y) * step(f.y, gC.x);
          // Street level is doorways and shopfronts; above it, windows.
          float ground = step(vFacH, gA.y);
          float open = mix(win, mix(win * step(0.52, f.y), door, step(r, gC.y)), ground);
          open *= step(r, gC.z);                 // the rest are bricked up
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
          float shade = gC.w + gD.x * fah(idc + vec2(2.7));
          vec3 glass = diffuseColor.rgb * shade + vec3(0.012, 0.014, 0.020);
          // A few catch the low sun. Still absolute, and rightly so — a
          // reflection is the SKY's brightness, not the wall's.
          glass = mix(glass, vec3(0.62, 0.44, 0.2), step(0.94, fah(idc + vec2(11.3, 5.7))) * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, open * 0.9);
          // A one-pixel lintel/sill so the opening has an edge, not just a hole.
          float lint = step(gB.y, f.y) * step(gA.z, f.x) * step(f.x, gA.w) * (1.0 - ground);
          diffuseColor.rgb *= 1.0 - lint * gD.y;
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
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.21, 0.09), clamp(vine * gD.z, 0.0, 0.8));
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
        diffuseColor.rgb *= 1.0 - gD.w * fah(floor(vFacW.xz * 1.7) + floor(vFacH * 2.3));
      }`);
  };
}
