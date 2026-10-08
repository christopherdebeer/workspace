/**
 * The air about an anomaly: motes in its light, drifting — about a crystal, glints turning slowly
 * round its heart and twinkling; about a fungus, spores rising from the gills and wandering up
 * into the fog. Points of light (added, nothing solid), each from its index alone (no buffers),
 * fogged as everything is, drawn in their place among the trees.
 */
import { WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import { PROJECT, program } from './mesh';
import type { V3 } from './mesh';

const N = 1400;
const VS = `#version 300 es
uniform vec3 uAnchor;
uniform float uR, uH, uKind, uT;
${PROJECT}
out vec3 vWorld;
out float vDist;
out float vTw;
float hs(float i, float k) { return fract(sin(i * 12.9898 + k * 78.233) * 43758.5453); }
void main() {
  float i = float(gl_VertexID);
  float a = hs(i, 1.) * 6.2832, rr = sqrt(hs(i, 2.)) * uR, h = hs(i, 3.);
  vec3 p;
  if (uKind < 1.5) {
    // glints: turning slowly round the heart, a little up and down
    float w = a + uT * (.02 + .03 * hs(i, 4.)) * (hs(i, 5.) < .5 ? 1. : -1.);
    p = vec3(cos(w) * rr, pow(h, 1.6) * uH + sin(uT * .3 + i) * .4, sin(w) * rr);
  } else {
    // spores: rising, wandering, gone into the fog and coming again from below
    float y = mod(h * uH + uT * (.15 + .25 * hs(i, 6.)), uH);
    p = vec3(cos(a) * rr + sin(uT * .11 + i) * 1.2, y, sin(a) * rr + cos(uT * .09 + i * 1.7) * 1.2);
  }
  vWorld = uAnchor + p;
  vDist = project(vWorld);
  float d = length(vWorld - vec3(uCam.x, uCam.z, uCam.y));
  // (a few centimetres across, never less than a point)
  gl_PointSize = clamp(.06 * uF / max(d, .3), 1.2, 9.);
  vTw = hs(i, 7.);
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in float vDist;
in float vTw;
out vec4 o;
uniform float uDensity, uKind;
${WOOD_GLSL()}
uniform vec3 uLight;
void main() {
  vec2 c = gl_PointCoord * 2. - 1.;
  float a = exp(-dot(c, c) * 3.);
  // glints twinkle; spores breathe
  float tw = uKind < 1.5 ? pow(.5 + .5 * sin(uT * (1.5 + 3. * vTw) + vTw * 40.), 6.) : .5 + .5 * sin(uT * .7 + vTw * 30.);
  float fog = 1. - (1. - fogAt(vDist, vWorld.y - uBase, uDensity)) * (1. - mistTo(vWorld));
  float near = smoothstep(.5, 2.5, length(vWorld - vec3(uCam.x, uCam.z, uCam.y)));
  float k = a * (.25 + 1.6 * tw) * (1. - fog) * near;
  if (k < .003) discard;
  o = vec4((uLight * 2.2 + vec3(.15)) * k, 0.);
}`;

const progs = new WeakMap<WebGL2RenderingContext, { p: WebGLProgram; vao: WebGLVertexArrayObject }>();
/** an anomaly's motes (a CustomDraw at its heart): within `r` of it, up to `h` metres */
export function drawMotes(env: WoodEnv, at: { x: number; z: number }, kind: 'crystal' | 'fungus', light: V3, r: number, h: number) {
  const { gl } = env;
  let g = progs.get(gl);
  if (!g) { g = { p: program(gl, VS, FS()), vao: gl.createVertexArray()! }; progs.set(gl, g); }
  gl.useProgram(g.p);
  env.common(g.p);
  const u = (n: string) => gl.getUniformLocation(g!.p, n);
  gl.uniform3f(u('uAnchor'), at.x, env.base, at.z);
  gl.uniform1f(u('uR'), r);
  gl.uniform1f(u('uH'), h);
  gl.uniform1f(u('uKind'), kind === 'crystal' ? 1 : 2);
  gl.uniform1f(u('uBase'), env.base);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform3fv(u('uLight'), light);
  gl.bindVertexArray(g.vao);
  gl.drawArrays(gl.POINTS, 0, N);
}
