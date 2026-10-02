/**
 * The hand (?style=sketch): one pencil, shared by the bake (cards) and the live trees, so a branch
 * is drawn the same however near it is, and as one gesture. Each segment knows its stroke (a whole
 * branch, a root, a blade), how far along it is, and its class (tree.ts SEG); the pressure, the
 * drift off the true line and the occasional faint second pass are functions of the distance along
 * the stroke, so they change slowly and run on unbroken from one segment into the next.
 *
 * GLSL, self-contained (its own hash: it does not depend on the wood's seed uniform).
 */
export const PENCIL = `
float pH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// smooth noise along a stroke (x), each stroke its own (id)
float pN(float x, float id) {
  float i = floor(x), f = fract(x), u = f * f * (3. - 2. * f);
  return mix(pH(vec2(i, id * .7311)), pH(vec2(i + 1., id * .7311)), u);
}
// how hard the hand presses, s metres along the stroke: rising and easing slowly
float strokePress(float s, float id) { return .45 + .55 * pN(s * 1.2, id); }
// how far off its true line the hand has drifted (-.5 … .5 of a line's width, about a pixel)
float strokeDrift(float s, float id) { return pN(s * 2. + 31., id) - .5; }
// here and there, a faint second pass along the stroke, a little off the first
float strokeAgain(float s, float id) { return smoothstep(.7, .8, pN(s * .6 + 57., id)); }
// how firmly each class is drawn: a trunk's contours firm, limbs less, twigs hairlines, roots only
// indicated, leaves light, grass lighter still (tree.ts STROKE)
float strokeWeight(float c) {
  if (c < .5) return .85;
  if (c < 1.5) return .65;
  if (c < 2.5) return .55;
  if (c < 3.5) return .45;
  if (c < 8.5) return .3;
  if (c < 9.5) return .45;
  return .32;
}
// a pencil line: across (px) from where it runs, its half-width (px); soft at its edges, never
// finer than the point
float strokeLine(float across, float hw) { float h = max(hw, .3); return 1. - smoothstep(h, h + .8, abs(across)); }
`;
