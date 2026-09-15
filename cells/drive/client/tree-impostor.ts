/**
 * ── A TREE'S CHEAP REPRESENTATION, DERIVED FROM THE SAME DESCRIPTOR ──
 *
 * The seat's reframing, and the sentence this module exists to serve: *a tree
 * should be a persistent fact about the world; only its representation should
 * become cheaper with distance.* The manifest made the fact reach further than
 * the geometry; this is what stands where the geometry does not.
 *
 * WHAT IT IS NOT is a photograph of the skeleton. At eight art pixels tall the
 * baked tree's twigs and leaf gaps are temporal aliasing — subpixel features
 * that dither differently every frame — so an impostor rendered from the real
 * tree at full fidelity would be WORSE than the tree, not merely cheaper. What
 * survives at that size is the outer silhouette, the crown's major lobes, the
 * trunk mass and two or three broad light regions, and that is exactly what
 * this draws. The same rule the terrain's own detail cascade follows: far
 * detail is a FILTERED version of near detail, not the same signal sampled too
 * coarsely.
 *
 * TWO CARDS, NOT ONE, because this game has two camera regimes that a single
 * sprite cannot serve. A vertical card is right from the chase seat and
 * collapses toward a line looking down; a horizontal canopy card is right from
 * the chart and useless at a grazing angle. Both are drawn, and their weights
 * are redistributed CONTINUOUSLY by the camera's elevation rather than
 * switched — a switch is the artefact this whole programme is removing.
 *
 * THE CARD DOES NOT ROTATE WITH THE TREE, AND THE INSTANCE MATRIX IS WHY. It
 * carries translation and scale only: no yaw. With no rotation and the same
 * scale on x and z, a horizontal world direction survives the instance
 * transform unchanged, so the billboard is one line in the vertex shader
 * rather than a basis change. The tree's own yaw rides as an attribute and
 * phases the SILHOUETTE instead, so two trees of one form differ from the same
 * angle without either of them swivelling as you drive past.
 *
 * KNOWN AND NOT FIXED: the side card faces the camera about Y, so orbiting a
 * near impostor turns its crown with you. A directional atlas (four azimuths
 * plus the top) is the answer and is not built here — at the distances this
 * tier currently draws, a tree is a handful of pixels and the swivel is under
 * the quantiser. It stops being true if the handoff ever moves close.
 */
import * as THREE from 'three';
import { FOLIAGE_WIND_UNIFORMS, foliageWind } from './flora-ez';

/** The vocabulary the bake already measures its skeletons against, so an
 *  impostor and the tree it stands in for are asking for the same shape. */
export const IMPOSTOR_FORMS = ['round', 'conic', 'columnar', 'umbrella', 'palm', 'bare'] as const;
export type ImpostorForm = typeof IMPOSTOR_FORMS[number];
export const impostorFormIndex = (form: string): number => {
  const i = (IMPOSTOR_FORMS as readonly string[]).indexOf(form);
  return i < 0 ? 0 : i;
};

/**
 * THE CROWN'S WIDTH AS A FRACTION OF THE TREE'S HEIGHT, per form — the card's
 * own aspect, and it lives here BESIDE the silhouette it has to agree with.
 * The bake measures each variant's width off the geometry it just produced
 * (the vocabulary's own check), and the ranges it reports are what these are
 * set from: a round broadleaf about as wide as it is tall, a columnar one
 * under half that, an umbrella crown wider than its height.
 *
 * It is a per-FORM number rather than a per-variant one, which is the first
 * pass being a first pass: two round oaks of different spread wear the same
 * card aspect and differ only by their instance scale.
 */
export const IMPOSTOR_WIDTH: Record<ImpostorForm, number> = {
  round: 0.90, conic: 0.50, columnar: 0.40, umbrella: 1.20, palm: 0.50, bare: 0.35,
};

/**
 * Two unit quads: a side card standing on y=0 with its top at y=1, and a top
 * card lying flat. `aCard` tells them apart and `uv` is the card's own frame,
 * which is what the silhouette is written in.
 *
 * FOUR TRIANGLES A TREE, against about a thousand for a baked skeleton.
 */
export function impostorGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], card: number[] = [], idx: number[] = [];
  // The side card: x across, y up, in the instance's unit frame.
  pos.push(-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0);
  uv.push(0, 0, 1, 0, 1, 1, 0, 1);
  card.push(0, 0, 0, 0);
  idx.push(0, 1, 2, 0, 2, 3);
  // The top card: flat, at the crown's own centre height, which the vertex
  // shader lifts — here it is simply y=0 and gets moved.
  pos.push(-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5);
  uv.push(0, 0, 1, 0, 1, 1, 0, 1);
  card.push(1, 1, 1, 1);
  idx.push(4, 5, 6, 4, 6, 7);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 1));
  // A normal is required by the Lambert material's own chunks even though the
  // fragment replaces it outright; a flat +y costs nothing and keeps three's
  // vertex path happy.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(
    new Array(8).fill(0).flatMap(() => [0, 1, 0]), 3));
  g.setIndex(idx);
  return g;
}

/** The silhouette and its lighting, written once so a lab can drive the same
 *  string the world does. No backticks in here: this is a TS template literal
 *  and one would end it. */
const IMPOSTOR_GLSL = [
  'float impHash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 21943.7); }',
  // ── THE CROWN'S HALF-WIDTH UP THE CARD ──
  // t runs 0 at the crown base to 1 at its top. Every form is a broad profile
  // plus two low-frequency lobes: enough to stop a row of trees reading as a
  // row of one tree, and far too coarse to alias.
  'float impWidth(float form, float t, float ph) {',
  '  float w;',
  '  if (form < 0.5) { w = sqrt(max(0.0, 1.0 - pow(2.0 * t - 1.0, 2.0))); }',      // round
  '  else if (form < 1.5) { w = 1.0 - 0.92 * t; }',                                // conic
  '  else if (form < 2.5) { w = 0.46 * (1.0 - 0.25 * t); }',                       // columnar
  '  else if (form < 3.5) { w = smoothstep(0.0, 0.42, t) * (1.05 - 0.28 * t); }',  // umbrella
  '  else if (form < 4.5) { w = smoothstep(0.0, 0.18, t) * (1.0 - 0.55 * t); }',   // palm
  '  else { w = 0.30 * (1.0 - 0.5 * t); }',                                        // bare
  '  w += 0.11 * sin(t * 7.1 + ph) + 0.06 * sin(t * 13.3 - ph * 1.7);',
  '  return clamp(w, 0.0, 1.15);',
  '}',
  // Where the crown starts up the card, by form: a palm is nearly all trunk,
  // an umbrella has its canopy high, a conifer carries branches almost down.
  'float impClear(float form) {',
  '  if (form < 0.5) return 0.26;',
  '  if (form < 1.5) return 0.11;',
  '  if (form < 2.5) return 0.15;',
  '  if (form < 3.5) return 0.46;',
  '  if (form < 4.5) return 0.70;',
  '  return 0.02;',
  '}',
].join('\n');

export interface ImpostorTuning {
  wind?: { uTime: { value: number }; uGust: { value: THREE.Vector2 }; uWindK: { value: number } };
  /** How much of the top card shows: 0 from the seat, 1 looking straight down.
   *  Set once a frame from the camera, never per instance. */
  top?: { value: number };
  /** Where the dissolve toward the ground starts and ends, in metres. */
  fade?: { value: THREE.Vector2 };
  /** What it dissolves TOWARD: the local ground's own colour. */
  ground?: { value: THREE.Color };
}

/**
 * A Lambert material, deliberately — so the impostor takes the scene's sun,
 * its hemisphere fill and every hook the trees already chain (the cloud shadow
 * above all). An unlit quad beside a lit skeleton is a visible handoff however
 * well its silhouette agrees, which is the fault this file's own doctrine
 * records for the baked globe and for the water, twice.
 */
export function impostorMaterial(tuning: ImpostorTuning = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
    transparent: false, alphaTest: 0.5,
  });
  const wind = tuning.wind ?? { uTime: { value: 0 }, uGust: { value: new THREE.Vector2() }, uWindK: { value: 0 } };
  const uTop = tuning.top ?? { value: 0 };
  const uFade = tuning.fade ?? { value: new THREE.Vector2(1e6, 2e6) };
  const uGround = tuning.ground ?? { value: new THREE.Color(0.5, 0.5, 0.5) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uGust = wind.uGust;
    sh.uniforms.uWindK = wind.uWindK;
    sh.uniforms.uImpTop = uTop;
    sh.uniforms.uImpFade = uFade;
    sh.uniforms.uImpGround = uGround;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'attribute float aCard; attribute float aForm; attribute float aYaw;',
        'uniform float uImpTop;',
        'varying float vImpCard; varying float vImpForm; varying float vImpYaw;',
        'varying vec3 vImpRight; varying vec3 vImpOut; varying vec2 vImpUv;',
        'varying float vImpFade;',
        'uniform vec2 uImpFade;',
        FOLIAGE_WIND_UNIFORMS,
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'vImpFade = 0.0;',
        '#ifdef USE_INSTANCING',
        // THE INSTANCE MATRIX IS TRANSLATION AND SCALE ONLY, which is what
        // makes this one line: a horizontal unit vector survives a scale that
        // is equal on x and z, so the card is built in world DIRECTIONS and
        // the instance transform sizes it afterwards.
        'vec3 impP = instanceMatrix[3].xyz;',
        'vec3 impToCam = cameraPosition - impP;',
        'vec2 impFlat = impToCam.xz;',
        'float impFl = length(impFlat);',
        'vec2 impDir = impFl > 1e-4 ? impFlat / impFl : vec2(0.0, 1.0);',
        'vec3 impRight = vec3(impDir.y, 0.0, -impDir.x);',
        'vImpRight = impRight;',
        'vImpOut = vec3(impDir.x, 0.0, impDir.y);',
        // ── THE DISSOLVE IS THE SHADER'S, NOT THE REFRESH'S ──
        // It was a per-instance colour mixed on the CPU, which cost a terrain
        // palette and a cover sample for every faded tree in every refresh —
        // and STEPPED, because a refresh is a few times a second while the
        // distance changes every frame. Here it is the camera's own distance,
        // continuous, and it costs the pass nothing at all.
        'vImpFade = clamp((impFl - uImpFade.x) / max(1.0, uImpFade.y - uImpFade.x), 0.0, 1.0);',
        'if (aCard < 0.5) {',
        '  transformed = impRight * position.x + vec3(0.0, position.y, 0.0);',
        '} else {',
        // The top card lies at the crown's own middle so it reads as the
        // canopy rather than as a lid on the ground.
        '  transformed = vec3(position.x, 0.72, position.z);',
        '}',
        '#endif',
        'vImpCard = aCard; vImpForm = aForm; vImpYaw = aYaw;',
        // ── THE CARD'S OWN COORDINATE COMES FROM `position`, NOT FROM `uv` ──
        // A Lambert material declares `vUv` only when something sets USE_UV —
        // a map, an alpha map, a normal map — and this material has none, so
        // reading it cost a link failure and a tier that drew nothing while
        // logging to a console no phone has. `position` is always declared,
        // and this geometry's positions ARE the card's frame: the side card
        // spans x in [-0.5, 0.5] and y in [0, 1], the top card x and z.
        'vImpUv = aCard < 0.5 ? vec2(position.x + 0.5, position.y)',
        '                     : vec2(position.x + 0.5, position.z + 0.5);',
        // The rise is the card's own height, which is already normalised.
        foliageWind('max(0.0, transformed.y)', '1.0'),
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uImpTop; uniform vec3 uImpGround;',
        'varying float vImpCard; varying float vImpForm; varying float vImpYaw;',
        'varying vec3 vImpRight; varying vec3 vImpOut; varying vec2 vImpUv;',
        'varying float vImpFade;',
        IMPOSTOR_GLSL,
      ].join('\n'))
      // THE SILHOUETTE IS THE ALPHA, and the alpha is BINARY — the composite
      // quantises to fourteen levels and dithers, so a soft edge is a smear of
      // threshold noise rather than a soft edge.
      .replace('#include <map_fragment>', [
        '#include <map_fragment>',
        'float impX = (vImpUv.x - 0.5) * 2.0;',
        'float impCov;',
        'float impLo;',           // 0 at the crown base, 1 at its top
        'if (vImpCard < 0.5) {',
        '  float impCl = impClear(vImpForm);',
        '  impLo = clamp((vImpUv.y - impCl) / max(0.05, 1.0 - impCl), 0.0, 1.0);',
        '  float impW = impWidth(vImpForm, impLo, vImpYaw);',
        '  float impTrunk = 0.10 + 0.05 * step(4.5, vImpForm);',
        '  bool impInCrown = vImpUv.y >= impCl && abs(impX) <= impW;',
        '  bool impInWood = vImpUv.y < impCl + 0.04 && abs(impX) <= impTrunk;',
        '  impCov = (impInCrown || impInWood) ? 1.0 : 0.0;',
        '  impCov *= 1.0 - uImpTop;',
        '} else {',
        '  vec2 impD = (vImpUv - 0.5) * 2.0;',
        '  float impR = length(impD);',
        '  float impA = atan(impD.y, impD.x);',
        '  float impW = 0.88 + 0.12 * sin(impA * 3.0 + vImpYaw) + 0.07 * sin(impA * 5.0 - vImpYaw);',
        '  if (vImpForm > 3.5 && vImpForm < 4.5) impW *= 0.62 + 0.38 * abs(sin(impA * 4.0 + vImpYaw));',
        '  impLo = 1.0 - impR;',
        '  impCov = impR <= impW ? 1.0 : 0.0;',
        '  impCov *= uImpTop;',
        '}',
        'diffuseColor.a *= impCov;',
        // ── TWO BROAD TONE REGIONS AND NO MORE ──
        // A lit crown top and a shaded underside is most of what reads at this
        // size; anything finer is the twig detail this tier exists to discard.
        'diffuseColor.rgb *= 0.78 + 0.30 * impLo;',
      ].join('\n'))
      // ── AND THE DISSOLVE GOES AFTER THE INSTANCE COLOUR, NOT BEFORE IT ──
      // three's Lambert chain runs map_fragment and THEN color_fragment, so at
      // the block above `diffuseColor` is still the material's white and the
      // tree's own colour has not arrived. A mix toward the ground written
      // there would be multiplied by the tree afterwards — a darkening rather
      // than a tint, and darkest where the fade is strongest, which is the
      // opposite of a dissolve. The shade term above is a multiply and
      // commutes; this one does not.
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        // The same dissolve toward the ground the skeletons take at their own
        // edge, over this tier's own reach — or the tier would trade the cap's
        // hard edge for a hard edge of its own, one ring further out.
        'diffuseColor.rgb = mix(diffuseColor.rgb, uImpGround, vImpFade * 0.7);',
      ].join('\n'))
      // ── THE CROWN IS LIT AS AN ELLIPSOID ──
      // The card is flat and a flat normal would make a stand of impostors
      // flash as one surface when the sun moves. Treating the crown as a
      // rounded body gives the broad light and shade that the skeleton beside
      // it has, which is what has to agree across the handoff — not the leaves.
      .replace('#include <normal_fragment_begin>', [
        '#include <normal_fragment_begin>',
        // ── AND IT IS HANDED OVER IN VIEW SPACE, WHICH IS WHAT THE CHUNK MEANS ──
        // The first cut built the crown normal out of vImpRight/vImpOut and
        // assigned it straight to `normal`, which is WORLD space written into
        // a variable three fills from `normalMatrix * objectNormal` — i.e. the
        // view-space normal every lighting chunk downstream reads. The sun
        // direction is view-space too, so the dot product was between two
        // different frames: the stands read flat and dark, and their shading
        // TURNED WITH THE CAMERA rather than with the sun. The rotation is one
        // matrix multiply and it belongs here, at the handover.
        'vec3 impWN;',
        'if (vImpCard < 0.5) {',
        '  float impNx = (vImpUv.x - 0.5) * 2.0;',
        '  float impNy = (impLo - 0.5) * 1.2;',
        '  float impNz = sqrt(max(0.06, 1.0 - min(0.94, impNx * impNx + impNy * impNy)));',
        '  impWN = vImpRight * impNx + vec3(0.0, impNy, 0.0) + vImpOut * impNz;',
        '} else {',
        '  vec2 impD = (vImpUv - 0.5) * 2.0;',
        '  impWN = vec3(impD.x * 0.7, 1.3, impD.y * 0.7);',
        '}',
        'normal = normalize((viewMatrix * vec4(normalize(impWN), 0.0)).xyz);',
      ].join('\n'));
  };
  return mat;
}
