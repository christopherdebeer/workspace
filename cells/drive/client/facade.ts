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
  const t = new THREE.DataTexture(data, 8, Math.max(1, rows), THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();
const uGramU = { value: gramTex };
const uGramN = { value: Math.max(1, TRADITION_LIST.length) };

/**
 * ── THE SUN, FOR THE REVEALS ──
 *
 * The articulation below (reveals, sills, balconies, eaves) is drawn as the
 * SHADOWS those things cast on the wall, and a shadow has a direction. Three's
 * own lighting cannot supply it: the wall is flat geometry, so the lit side of
 * a reveal and the shadow under a sill are not in any normal the fragment
 * carries. A world-space unit vector toward the sun, copied from the scene's
 * sun each frame (main.ts) or the lab's light (facade-lab.ts). Shared by
 * reference like the rest.
 */
export const uFacSun = { value: new THREE.Vector3(0.3, 0.8, 0.5) };

// Shared by reference, like the mark tuning: one write reaches every wall.
const uFacA = { value: new THREE.Vector4() };
const uFacB = { value: new THREE.Vector4() };
const uFacC = { value: new THREE.Vector4() };
const uFacD = { value: new THREE.Vector4() };
const uFacE = { value: new THREE.Vector4() };
const uFacF = { value: new THREE.Vector4() };
const uFacG = { value: new THREE.Vector4() };
const uFacH = { value: new THREE.Vector4() };
function pushGrammar(): void {
  const g = FACADE_GRAMMAR;
  uFacA.value.set(g.bayM, g.storeyM, g.winX0, g.winX1);
  uFacB.value.set(g.winY0, g.winY1, g.doorX0, g.doorX1);
  uFacC.value.set(g.doorY1, g.doorShare, g.openShare, g.glassShade);
  uFacD.value.set(g.glassVar, g.lintel, g.ivy, g.stain);
  uFacE.value.set(g.revealM, g.sillM, g.frame, g.mullion);
  uFacF.value.set(g.glassSky, g.stringCourse, g.cornice, g.plinthM);
  uFacG.value.set(g.shutters, g.balcony, g.streaks, g.dampM);
  uFacH.value.set(g.trim, g.shutterCol, g.shopfront, g.eaveM);
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
    sh.uniforms.uFacE = uFacE;
    sh.uniforms.uFacF = uFacF;
    sh.uniforms.uFacG = uFacG;
    sh.uniforms.uFacH = uFacH;
    sh.uniforms.uFacSun = uFacSun;
    sh.uniforms.uGram = uGramU;
    sh.uniforms.uGramN = uGramN;
    // THE BASE RIDES IN AS A VERTEX ATTRIBUTE, not off the model matrix.
    // Buildings batch per tile now (see flushBuildings), so one mesh carries
    // hundreds of them and modelMatrix[3][1] — the old source of "this
    // building's ground line" — is meaningless. Every batched vertex carries
    // its own building's base in aBase instead, and re-seating shifts the
    // attribute alongside the positions.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase;\nattribute float aMark;\nattribute float aGram;\nattribute float aTop;\nvarying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark; varying float vGram; varying float vFacTop;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 facW = modelMatrix * vec4(transformed, 1.0);
        vFacW = facW.xyz;
        vFacN = mat3(modelMatrix) * objectNormal;
        vFacH = facW.y - aBase;
        vMark = aMark;
        vGram = aGram;
        vFacTop = aTop - aBase;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFacW; varying vec3 vFacN; varying float vFacH; varying float vMark; varying float vGram; varying float vFacTop;
        uniform sampler2D uMarks; uniform sampler2D uMarkTins;
        uniform vec4 uMarkA; uniform vec4 uMarkB; uniform vec2 uFacNight;
        uniform vec4 uFacA; uniform vec4 uFacB; uniform vec4 uFacC; uniform vec4 uFacD;
        uniform vec4 uFacE; uniform vec4 uFacF; uniform vec4 uFacG; uniform vec4 uFacH;
        uniform vec3 uFacSun;
        uniform sampler2D uGram; uniform float uGramN;
        float fah(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 41.31); return fract(p.x * p.y); }
        // The eight trim paints, by index (facade-grammar.ts names them):
        // white, cream, green, blue, grey, brown, oxide, black. A chain of
        // steps because GLSL ES 1.00 cannot index a constant array by a float.
        vec3 trimCol(float i) {
          vec3 c = vec3(0.92, 0.90, 0.86);
          c = mix(c, vec3(0.88, 0.82, 0.66), step(0.5, i));
          c = mix(c, vec3(0.18, 0.36, 0.24), step(1.5, i));
          c = mix(c, vec3(0.20, 0.32, 0.52), step(2.5, i));
          c = mix(c, vec3(0.50, 0.52, 0.54), step(3.5, i));
          c = mix(c, vec3(0.38, 0.26, 0.16), step(4.5, i));
          c = mix(c, vec3(0.50, 0.20, 0.14), step(5.5, i));
          c = mix(c, vec3(0.10, 0.10, 0.11), step(6.5, i));
          return c;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 fn = normalize(vFacN);
        // ── WHOSE GRAMMAR: THE BUILDING'S TRADITION, OR THE UNIFORMS ──
        // aGram > 0 names a row of the atlas texture (see gramTex); 0 is the
        // uniforms, which the game keeps at FACADE_DEFAULTS and the lab drives.
        // The scales are facade-grammar.ts's GRAM_FIELDS, to the digit.
        vec4 gA = uFacA, gB = uFacB, gC = uFacC, gD = uFacD;
        vec4 gE = uFacE, gF = uFacF, gG = uFacG, gH = uFacH;
        if (vGram > 0.5) {
          float gy = (floor(vGram + 0.5) - 0.5) / uGramN;
          gA = texture2D(uGram, vec2(0.0625, gy)); gA.xy *= 8.0;
          gB = texture2D(uGram, vec2(0.1875, gy));
          gC = texture2D(uGram, vec2(0.3125, gy));
          gD = texture2D(uGram, vec2(0.4375, gy)); gD.z *= 2.0;
          gE = texture2D(uGram, vec2(0.5625, gy));
          gF = texture2D(uGram, vec2(0.6875, gy)); gF.w *= 2.0;
          gG = texture2D(uGram, vec2(0.8125, gy)); gG.w *= 2.0;
          gH = texture2D(uGram, vec2(0.9375, gy)); gH.xy = floor(gH.xy * 8.0 + 0.5);
        }
        // Roofs and floor slabs get grime and nothing else — a window in the
        // ceiling is the giveaway that this is a texture and not a building.
        if (abs(fn.y) < 0.55) {
          // ── THE WALL HAS DEPTH, AND THE DEPTH IS DRAWN AS ITS SHADOWS ──
          //
          // The first cut of this shader drew a window as a darker rectangle
          // on a flat wall, and the critique was exact: whatever the palette
          // and the bay grid did per place, the result was still a texture.
          // What makes a wall read as a BUILDING in a frame twelve pixels to
          // the metre is not the colour of the glass but the fact that the
          // glass is set BACK into the wall: the reveal's jamb throws the
          // sun's shadow across the top and the sun side of every pane, the
          // sill projects and casts under itself, the eave and the balcony
          // slab lay a band of shadow down the wall, and all of it moves with
          // the sun. Everything below is that geometry, computed per fragment
          // from the sun's direction against the wall's own frame — the wall
          // is still one quad; per-fragment work is the cheap resource here.
          //
          // THE WALL'S FRAME. u runs along the wall (whichever world axis the
          // face is nearer to), tu is that direction, nOut the outward normal
          // (the material is DoubleSide, so the geometric normal is flipped for
          // a back face, and a soffit seen from below must not read the sun
          // through the wall). sn is the sun's component along the normal —
          // positive is a lit face — su its component along the wall, sy its
          // height. A shadow's length on the wall is the depth of the thing
          // that casts it times the tangential over the normal component,
          // which is why every shadow below divides by snc.
          float u = abs(fn.x) > abs(fn.z) ? vFacW.z : vFacW.x;
          vec3 tu = abs(fn.x) > abs(fn.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
          vec3 nOut = gl_FrontFacing ? fn : -fn;
          float sn = dot(uFacSun, nOut), su = dot(uFacSun, tu), sy = uFacSun.y;
          // lit: the face is toward the sun and it is day. The shadows fade
          // in over the first few degrees so a face grazed by the sun does not
          // flip between striped and plain as the truck turns a corner.
          float lit = smoothstep(0.02, 0.14, sn) * (1.0 - uFacNight.x);
          float snc = max(sn, 0.08);
          // ── THE BAY GRID ──
          // Every number in it is FACADE_GRAMMAR, carried in gA..gH (the
          // uniforms, or the building's tradition row). Rows count from the
          // ground line (aBase), so row 0 is the ground floor.
          vec2 cell = vec2(u / gA.x, vFacH / gA.y);
          vec2 idc = floor(cell), f = fract(cell);
          float r = fah(idc + vec2(7.13, 3.31));
          float ground = step(vFacH, gA.y);
          // topD: metres below the wall top, for the eave and the cornice.
          float topD = vFacTop - vFacH;
          vec3 trim = trimCol(gH.x), shutC = trimCol(gH.y);
          // What this bay is. The draws are per bay from the bay's own hash so
          // a building is the same building from every side and every frame;
          // the shares are the tradition's.
          float hasOpen = step(r, gC.z);
          float isDoor = ground * step(r, gC.y);
          float isShop = ground * (1.0 - isDoor) * step(fah(idc + vec2(5.9, 12.1)), gH.z);
          float hasBalc = (1.0 - ground) * step(fah(idc + vec2(9.3, 14.7)), gG.y);
          float hasShut = step(fah(idc + vec2(15.1, 2.9)), gG.x) * (1.0 - isDoor) * (1.0 - isShop);
          float shutClosed = hasShut * step(0.8, fah(idc + vec2(4.2, 8.8)));
          // The opening's box in bay shares: the window by default, the door
          // box for a door, floor to head for a balcony door, and a shopfront
          // is glass across the bay under a fascia.
          float x0 = gA.z, x1 = gA.w, y0 = gB.x, y1 = gB.y;
          if (hasBalc > 0.5) y0 = 0.05;
          if (isShop > 0.5) { x0 = 0.08; x1 = 0.92; y0 = 0.08; y1 = 0.74; }
          float inWin = step(x0, f.x) * step(f.x, x1) * step(y0, f.y) * step(f.y, y1);
          float inDoor = step(gB.z, f.x) * step(f.x, gB.w) * step(0.03, f.y) * step(f.y, gC.x);
          float open = mix(inWin, inDoor, isDoor) * hasOpen;
          if (isDoor > 0.5) { x0 = gB.z; x1 = gB.w; y0 = 0.03; y1 = gC.x; }
          // Distances to the opening's four edges, in METRES, because the
          // reveal is a depth in metres and a bay is not a fixed size.
          float wxm = (x1 - x0) * gA.x, wym = (y1 - y0) * gA.y;
          float dTop = (y1 - f.y) * gA.y, dBot = (f.y - y0) * gA.y;
          float dL = (f.x - x0) * gA.x, dR = (x1 - f.x) * gA.x;
          // ── THE REVEAL ──
          // The jamb on the sun's side and the head cast onto the glass: a
          // band of shadow of the reveal's depth times tan(sun angle) along
          // the top and down one side. Which side is the sign of su. Capped
          // at 0.7 m so a grazing sun does not blacken the whole pane.
          float dSun = su > 0.0 ? dR : dL;
          float shTop = clamp(gE.x * sy / snc, 0.0, 0.7) * lit;
          float shSide = clamp(gE.x * abs(su) / snc, 0.0, 0.7) * lit;
          float revSh = max(step(dTop, shTop), step(dSun, shSide)) * step(0.02, gE.x);
          // And a little ambient dark all round the inside of the reveal,
          // sun or no sun — the sky cannot reach into a recess either.
          float edge = min(min(dL, dR), min(dTop, dBot));
          float ao = 1.0 - 0.32 * step(0.02, gE.x) * (1.0 - smoothstep(0.0, 0.5 * gE.x + 0.04, edge));
          // ── THE GLASS ──
          // Two things, and the reveal's shadow tells them apart. The VOID is
          // a darkening of the wall, never an absolute colour (a pale panel on
          // a dark wall is the fault this replaced) — the room behind the
          // pane, with a curtain in a share of them. The SKY IN THE PANE is
          // absolute, because it is the sky's brightness and not the wall's:
          // stronger toward the head, and it is what the jamb's shadow takes
          // away. The first cut shadowed the void, and a shadow on a thing
          // already a fifth of the wall was invisible after the quantiser;
          // a shadow on the sky's reflection is the band a real window shows.
          // A share of the reflection goes to EMISSIVE, so a shaded face's
          // windows still shine a little — a reflection is not diffuse, and
          // on a face turned from the sun the glass IS the lightest thing.
          float shade = gC.w + gD.x * fah(idc + vec2(2.7));
          vec3 void_ = diffuseColor.rgb * shade + vec3(0.012, 0.014, 0.020);
          float curtain = step(0.72, fah(idc + vec2(17.7, 3.3))) * (1.0 - isShop) * (1.0 - isDoor);
          void_ = mix(void_, diffuseColor.rgb * 0.62 + vec3(0.03), curtain * 0.7);
          float ty = clamp((f.y - y0) / max(y1 - y0, 0.01), 0.0, 1.0);
          float skyW = gF.x * (0.35 + 0.65 * ty) * (1.0 - uFacNight.x) * (1.0 - 0.85 * revSh) * ao;
          vec3 skyRef = vec3(0.30, 0.36, 0.44) * skyW;
          vec3 glass = void_ * (1.0 - 0.3 * revSh) * ao + skyRef;
          totalEmissiveRadiance += skyRef * 0.22 * open * (1.0 - isDoor) * (1.0 - shutClosed);
          glass = mix(glass, vec3(0.62, 0.44, 0.2), step(0.94, fah(idc + vec2(11.3, 5.7))) * 0.75 * lit);
          // A door is the shutter paint, not glass; a closed shutter is its
          // paint with slats.
          // A door is the shutter paint with a fanlight over it, not glass.
          vec3 doorC = shutC * (0.55 + 0.25 * fah(idc + vec2(1.9, 6.6)));
          doorC = mix(doorC, void_ + skyRef * 0.6, step(0.86, ty) * step(0.5, fah(idc + vec2(12.4, 0.7))));
          glass = mix(glass, doorC, isDoor);
          float slat = step(0.7, fract(vFacH / 0.2)) * 0.25;
          glass = mix(glass, shutC * (1.0 - slat), shutClosed);
          // ── FRAME, MULLION, TRANSOM ──
          // A painted frame in the trim colour round the inside of the
          // opening; a centre mullion on any window over 1.1 m wide and a
          // transom on any over 1.5 m tall, on the share the tradition states.
          // At the survey's stand-off these are a pixel and dither to a lighter
          // edge, which is what a frame looks like from the street.
          float fw = 0.08;
          float rim = step(edge, fw) * gE.z;
          float divv = step(fah(idc + vec2(6.1, 19.3)), gE.w);
          float mull = step(1.1, wxm) * divv * step(abs(f.x - 0.5 * (x0 + x1)) * gA.x, 0.5 * fw);
          float trans = step(1.5, wym) * divv * step(abs(f.y - (y0 + 0.58 * (y1 - y0))) * gA.y, 0.5 * fw);
          float bar = clamp(rim + max(mull, trans) * gE.z, 0.0, 1.0) * (1.0 - isDoor) * (1.0 - shutClosed);
          glass = mix(glass, trim * (0.72 + 0.28 * lit), bar);
          // The shopfront's fascia: a band of the shutter paint over the glass.
          float fascia = isShop * step(0.76, f.y) * step(f.y, 0.9) * step(0.06, f.x) * step(f.x, 0.94);
          diffuseColor.rgb = mix(diffuseColor.rgb, shutC * 0.7, fascia * hasOpen);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, open * 0.92);
          // ── THE SILL ──
          // A ledge under every window: its front face in the trim, lit a
          // little more when the sun is high, and the shadow it casts on the
          // wall below it, of the sill's projection times tan(sun angle).
          float belowSill = (y0 - f.y) * gA.y;
          float winBay = hasOpen * (1.0 - isDoor) * (1.0 - isShop) * (1.0 - hasBalc);
          float sillHere = step(0.02, gE.y) * winBay * step(-0.04, dL) * step(-0.04, dR);
          float sillLine = sillHere * step(0.0, belowSill) * step(belowSill, 0.08);
          float sillSh = clamp(gE.y * sy / snc, 0.0, 0.4) * lit;
          float underSill = sillHere * step(0.0, dL) * step(0.0, dR) * step(0.08, belowSill) * step(belowSill, 0.08 + sillSh);
          diffuseColor.rgb = mix(diffuseColor.rgb, trim * (0.8 + 0.35 * sy * lit), sillLine * 0.9);
          diffuseColor.rgb *= 1.0 - 0.4 * underSill;
          // ── SHUTTERS, OPEN ──
          // A leaf either side of the window, half its width, no wider than
          // the wall left beside it, in the shutter paint with its slats.
          float sw = clamp(0.5 * (x1 - x0), 0.0, max(x0 - 0.02, 0.0));
          float inShut = max(step(x0 - sw, f.x) * step(f.x, x0), step(x1, f.x) * step(f.x, x1 + sw))
            * step(y0, f.y) * step(f.y, y1) * hasShut * (1.0 - shutClosed) * hasOpen;
          diffuseColor.rgb = mix(diffuseColor.rgb, shutC * (1.0 - slat) * (0.75 + 0.25 * lit), inShut);
          // ── THE BALCONY ──
          // A railing across the bay, 0.95 m tall, dark with a trim rail on
          // top, over the door behind it; and the slab's shadow on the wall
          // below, of the slab's projection (0.45 m) times tan(sun angle).
          float railH = 0.95 / gA.y;
          float rail = hasBalc * hasOpen * step(x0 - 0.12, f.x) * step(f.x, x1 + 0.12) * step(y0 - 0.02, f.y) * step(f.y, y0 + railH);
          float railTop = rail * step(y0 + railH - 0.06 / gA.y, f.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, trimCol(7.0) * 0.9, rail * 0.62);
          diffuseColor.rgb = mix(diffuseColor.rgb, trim * 0.8, railTop);
          // The slab's front edge, 0.14 m of the trim lit from above, is what
          // makes the railing stand OFF the wall rather than lie on it.
          float slabEdge = hasBalc * hasOpen * step(x0 - 0.15, f.x) * step(f.x, x1 + 0.15)
            * step(y0 - 0.16 / gA.y, f.y) * step(f.y, y0 - 0.02);
          diffuseColor.rgb = mix(diffuseColor.rgb, trim * (0.72 + 0.3 * sy * lit), slabEdge * 0.9);
          float slabSh = hasBalc * hasOpen * step(x0 - 0.15, f.x) * step(f.x, x1 + 0.15)
            * step(f.y, y0 - 0.16 / gA.y) * step(y0 - 0.16 / gA.y - clamp(0.45 * sy / snc, 0.0, 0.6) / gA.y, f.y) * lit;
          diffuseColor.rgb *= 1.0 - 0.45 * slabSh;
          // The lintel band over the head, as before, per tradition.
          float lint = step(y1, f.y) * step(x0, f.x) * step(f.x, x1) * (1.0 - ground) * hasOpen * (1.0 - isDoor);
          diffuseColor.rgb *= 1.0 - lint * gD.y;
          // ── THE HORIZONTALS: STRING COURSE, PLINTH, CORNICE, EAVE ──
          // A light line at each upper floor level where the tradition has
          // one; a darker dado up to plinthM with a lit edge at its top; the
          // cornice band under the wall top in the trim; and the eave's
          // shadow down the wall from the top, of the overhang times
          // tan(sun angle), with the soffit's own dark line under it always.
          float course = (1.0 - ground) * step(f.y * gA.y, 0.08) * gF.y;
          diffuseColor.rgb = mix(diffuseColor.rgb, trim * 0.92, course);
          float plinth = step(0.05, gF.w) * step(vFacH, gF.w);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.70, 0.68) + vec3(0.03), plinth * 0.9);
          diffuseColor.rgb *= 1.0 + 0.12 * step(0.05, gF.w) * step(abs(vFacH - gF.w), 0.04);
          if (topD > 0.0) {
            float cornice = step(topD, 0.22) * gF.z;
            diffuseColor.rgb = mix(diffuseColor.rgb, trim * (0.85 + 0.15 * lit), cornice * 0.85);
            float eave = clamp(gH.w * sy / snc, 0.0, 1.4) * lit;
            diffuseColor.rgb *= 1.0 - 0.42 * step(topD, eave) * step(0.05, gH.w);
            diffuseColor.rgb *= 1.0 - 0.15 * step(topD, 0.12);
          }
          // ── WEATHER: RAIN STREAKS AND THE DAMP BAND ──
          // Rain runs off the sill's corners and streaks the wall under them,
          // fading over a metre; and the wall is darker where the ground
          // splashes it, to dampM, with the band's edge broken per few metres.
          float streak = winBay * step(0.0, belowSill)
            * max(step(abs(f.x - x0) * gA.x, 0.05), step(abs(f.x - x1) * gA.x, 0.05))
            * exp(-belowSill / 0.9) * gG.z * (0.4 + 0.6 * fah(idc + vec2(8.1, 1.1)));
          diffuseColor.rgb *= 1.0 - 0.32 * streak;
          float damp = (1.0 - smoothstep(0.0, max(gG.w, 0.01), vFacH + 0.25 * fah(vec2(floor(u * 1.5), 3.0)))) * step(0.05, gG.w);
          diffuseColor.rgb *= 1.0 - 0.26 * damp;
          // A downpipe on a share of the bay lines, the wall's whole height:
          // a dark vertical a hand wide, which at the survey's stand-off is
          // the one-pixel line a real one is. Not a grammar field — every
          // tradition has gutters — and the streaks share says how stained.
          float pipe = step(0.82, fah(vec2(idc.x, 27.1))) * step(f.x * gA.x, 0.09) * step(0.3, vFacH);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.02), pipe * 0.85);
          diffuseColor.rgb *= 1.0 - 0.18 * gG.z * step(0.82, fah(vec2(idc.x, 27.1))) * step(f.x * gA.x, 0.2) * step(0.09, f.x * gA.x);
          // The door's threshold: a step in the trim under it.
          float thresh = isDoor * hasOpen * step(gB.z - 0.04, f.x) * step(f.x, gB.w + 0.04) * step(f.y * gA.y, 0.14) * step(0.02, f.y * gA.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, trim * 0.8, thresh * 0.8);
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
            * open * litBay * uFacNight.x * (1.0 - shutClosed);
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
        // Water staining below every horizontal break, on every face — at
        // three fifths of what it was, now the wall carries its own streaks
        // and damp band and the staining is a texture over them, not the
        // weather itself.
        diffuseColor.rgb *= 1.0 - 0.6 * gD.w * fah(floor(vFacW.xz * 1.7) + floor(vFacH * 2.3));
      }`);
  };
}
