/**
 * Two passes, WebGL2.
 *
 * 1. The world behind everything, one fragment shader: a ray from the eye per
 *    pixel. Above the horizon, the sky — haze low down, a glow of light ahead
 *    over the water, crags standing in it, leaves overhead with sky between.
 *    Below, the ground plane: grass in pools of sun or shade, the stream as
 *    broken puddles along its line that join into open water far ahead, each
 *    mirroring the sky. Fog by distance.
 * 2. The trees and tufts, back to front, as billboards from the painted atlas,
 *    fogged by distance and thicker near the ground (so trunks stand in mist).
 */
import type { Palette } from './world';

const QUAD = `#version 300 es
in vec2 aP;
void main() { gl_Position = vec4(aP, 0., 1.); }`;

const NOISE = `
uniform uint uSeed;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float h2(ivec2 p) { return float(pcg(uint(p.x) * 1973u ^ pcg(uint(p.y) + uSeed))) / 4294967295.; }
float vnoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); vec2 u = f * f * (3. - 2. * f);
  float a = h2(i), b = h2(i + ivec2(1, 0)), c = h2(i + ivec2(0, 1)), d = h2(i + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }
`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform vec2 uRes;
uniform float uF, uHz, uT;
uniform vec4 uCam; // x, z, eye height, yaw
uniform vec3 uPathA, uPathB; // amplitude, wavenumber, phase (two sines)
uniform vec3 uFog, uZen, uGrass, uGrassSun, uGrassShade, uCanopy;
uniform float uDensity, uSun;
uniform vec3 uCragA, uCragB; // azimuth, half-width, height (radians)
${NOISE}
float pathX(float z) { return uPathA.x * sin(z * uPathA.y + uPathA.z) + uPathB.x * sin(z * uPathB.y + uPathB.z); }

float crag1(float az, float el, vec3 C) {
  // a tall mass of clipped green (the painting's crags): a column that swells and narrows in
  // lumps as it rises, its top rounded and uneven. Returns >0 inside.
  float k = el / C.z;
  if (k > 1.25 || el < 0.) return -1.;
  float lumps = .62 + .5 * vnoise(vec2(k * 5.5, C.x * 40.)) + .22 * vnoise(vec2(k * 14., C.z * 90.));
  float w = C.y * lumps * (1. - .35 * k) * (1. + .15 * (vnoise(vec2(el * 60., C.x * 30.)) - .5));
  float top = 1. + .12 * (vnoise(vec2(az * 45., C.z * 20.)) - .5);
  return min(w - abs(az - C.x), (top - k) * C.z);
}

vec3 sky(vec3 d, bool mirror) {
  float az = atan(d.x, d.z);
  float el = max(d.y, 0.);
  vec3 c = mix(uFog, uZen, smoothstep(0., .45, el));
  // the light ahead: low over the far water, stronger in the light
  float glow = exp(-az * az * 14.) * exp(-el * 7.);
  c += glow * vec3(1., .97, .88) * (.12 + .3 * uSun);
  // crags standing in the water, dark and mossy, lit on the sun side (lost in the mist)
  float vis = smoothstep(.35, .75, uSun);
  float inA = crag1(az, el, uCragA), inB = crag1(az, el, uCragB);
  float h = max(uCragA.z, uCragB.z);
  if (vis > 0. && max(inA, inB) > 0.) {
    float edge = el / max(h, .001);
    vec3 C = inA > inB ? uCragA : uCragB;
    float lit = smoothstep(-.4, .6, (C.x - az) / C.y) * .6 + .4 * vnoise(vec2(az * 70., el * 70.));
    vec3 moss = mix(vec3(.13, .21, .11), vec3(.4, .5, .27), lit);
    moss *= .85 + .3 * vnoise(vec2(az * 200., el * 200.));
    // atmosphere: far, so hazed, most at the foot
    moss = mix(moss, uFog, .3 + .25 * (1. - edge));
    c = mix(c, moss, vis);
  }
  // leaves overhead framing the view (a wood in leaf closes over; the mist is open)
  if (!mirror && uSun > .3) {
    float cn = fbm(vec2(az * 9., el * 12.) + 3.1) * .6 + vnoise(vec2(az * 60., el * 70.)) * .4;
    float cover = smoothstep(.32, .9, el + .12 * abs(az)) * smoothstep(.4, .52, cn) * smoothstep(.3, .8, uSun);
    c = mix(c, uCanopy * (.7 + .6 * vnoise(vec2(az * 140., el * 150.))), cover);
  }
  return c;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 dc = normalize(vec3((px.x - .5 * uRes.x) / uF, (px.y - uHz) / uF, 1.));
  float cy = cos(uCam.w), sy = sin(uCam.w);
  vec3 d = vec3(dc.x * cy + dc.z * sy, dc.y, -dc.x * sy + dc.z * cy);
  vec3 col;
  if (d.y >= 0.) {
    col = sky(d, false);
  } else {
    float t = uCam.z / -d.y;
    vec3 p = vec3(uCam.x, 0., uCam.y) + d * t;
    float far = smoothstep(30., 80., t);
    // grass: shade and sun in pools, a fine grain (not streaks)
    float n = fbm(p.xz * .32);
    float grain = vnoise(p.xz * 3.1) * .6 + vnoise(p.xz * 9.7) * .4;
    float pool = smoothstep(.52, .64, fbm(p.xz * .06 + 7.)) * uSun;
    vec3 g = mix(uGrassShade, uGrass, smoothstep(.2, .75, n));
    g = mix(g, uGrassSun, pool * .85);
    g *= .84 + .3 * grain;
    // the stream: broken puddles along its line (few in the mist), joining into open water far off
    float dx = abs(p.x - pathX(p.z));
    float wid = mix(mix(.9, 1.5, uSun), 9., far) + .7 * vnoise(vec2(p.z * .15, 2.));
    float wet = 1. - smoothstep(wid * .5, wid, dx);
    float pud = vnoise(p.xz * vec2(1.2, .6)) * .62 + vnoise(p.xz * 3.1) * .28 + vnoise(p.xz * 9.) * .1;
    float th = mix(mix(.66, .58, uSun), .12, far);
    float water = wet * smoothstep(th, th + .035, pud);
    float rim = wet * smoothstep(th - .09, th, pud) * (1. - water);
    water = max(water, smoothstep(58., 85., t) * mix(.55, 1., uSun));
    // a puddle mirrors the sky (and the crags), a little darkened, a little rippled
    vec3 dr = vec3(d.x + .004 * (vnoise(p.xz * 3. + uT * .3) - .5), -d.y, d.z);
    vec3 refl = sky(normalize(dr), true) * .84;
    vec3 bank = mix(g, uGrassShade * .75, wet * .35);
    bank = mix(bank, uGrassShade * .45, rim * .8);
    col = mix(bank, refl, water);
    // fog: by distance
    col = mix(col, uFog, 1. - exp(-t * uDensity));
  }
  // a breath of drifting mist, and dither against banding
  float drift = vnoise(vec2(px.x / uRes.y * 2. + uT * .02, px.y / uRes.y * 3.)) - .5;
  col = mix(col, uFog, clamp(drift * (1. - uSun) * .25, 0., 1.));
  col += (h2(ivec2(px) + ivec2(int(uT * 60.) & 255)) - .5) / 255.;
  o = vec4(col, 1.);
}`;

const SPRITE_VS = `#version 300 es
in vec2 aCorner;
in vec4 aPos;  // x, z, w (negative: mirrored), h
in vec4 aUV;   // u0, v0, u1, v1
in vec2 aMisc; // phase, sway
uniform vec2 uRes;
uniform float uF, uHz, uT, uWind;
uniform vec4 uCam;
out vec2 vUV;
out float vDist;
out float vY;
void main() {
  float s = aCorner.y;
  float wx = aPos.x + (aCorner.x - .5) * abs(aPos.z) + sin(uT * .8 + aMisc.x) * uWind * aMisc.y * s * s * aPos.w * .018;
  float wy = s * aPos.w;
  vec3 rel = vec3(wx - uCam.x, wy - uCam.z, aPos.y - uCam.y);
  float c = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * c - rel.z * sn;
  float cz = max(rel.x * sn + rel.z * c, .05);
  vec2 scr = vec2(cx / cz * uF + .5 * uRes.x, rel.y / cz * uF + uHz);
  gl_Position = vec4(scr / uRes * 2. - 1., 0., 1.);
  float u = aPos.z < 0. ? 1. - aCorner.x : aCorner.x;
  vUV = vec2(mix(aUV.x, aUV.z, u), mix(aUV.w, aUV.y, s));
  vDist = length(rel.xz);
  vY = wy;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vDist;
in float vY;
out vec4 o;
uniform sampler2D uTex;
uniform vec3 uFog;
uniform float uDensity, uSun;
void main() {
  vec4 c = texture(uTex, vUV); // premultiplied
  if (c.a < .004) discard;
  // mist flattens and cools; light warms
  vec3 col = c.rgb * mix(vec3(.74, .8, .76), vec3(1.04, 1.02, .93), uSun);
  // fog by distance, thicker near the ground: trunks stand in it
  float fog = 1. - exp(-vDist * uDensity * (1. + 1.1 * exp(-vY * .3)));
  o = vec4(mix(col, uFog * c.a, fog), c.a);
}`;

/** Per instance: x, z, w, h, u0, v0, u1, v1, phase, sway. */
export const STRIDE = 10;

export interface View {
  x: number;
  z: number;
  eye: number;
  yaw: number;
  /** focal length (px), horizon (px from the bottom) */
  f: number;
  horizon: number;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private world: WebGLProgram;
  private sprite: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private spriteVao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private tex: WebGLTexture | null = null;
  private capacity = 0;
  private u = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is needed to walk here');
    this.gl = gl;
    this.world = this.program(QUAD, WORLD_FS);
    this.sprite = this.program(SPRITE_VS, SPRITE_FS);
    // full-screen triangle
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const ap = gl.getAttribLocation(this.world, 'aP');
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    // sprites: a unit quad, instanced
    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const ac = gl.getAttribLocation(this.sprite, 'aCorner');
    gl.enableVertexAttribArray(ac);
    gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.sprite, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr('aPos', 4, 0);
    attr('aUV', 4, 4);
    attr('aMisc', 2, 8);
    gl.bindVertexArray(null);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private loc(p: WebGLProgram, name: string) {
    const key = (p === this.world ? 'w:' : 's:') + name;
    if (!this.u.has(key)) this.u.set(key, this.gl.getUniformLocation(p, name));
    return this.u.get(key)!;
  }

  /** The painted atlas, premultiplied, with mipmaps (the far trees are small). */
  setAtlas(canvas: HTMLCanvasElement) {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(
    v: View,
    pal: Palette,
    t: number,
    seed: number,
    path: readonly number[],
    crags: readonly number[],
    instances: Float32Array,
    count: number,
    wind: number,
  ) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    // the world
    gl.disable(gl.BLEND);
    gl.useProgram(this.world);
    const w = this.world;
    gl.uniform2f(this.loc(w, 'uRes'), W, H);
    gl.uniform1f(this.loc(w, 'uF'), v.f);
    gl.uniform1f(this.loc(w, 'uHz'), v.horizon);
    gl.uniform1f(this.loc(w, 'uT'), t);
    gl.uniform4f(this.loc(w, 'uCam'), v.x, v.z, v.eye, v.yaw);
    gl.uniform3f(this.loc(w, 'uPathA'), path[0], path[1], path[2]);
    gl.uniform3f(this.loc(w, 'uPathB'), path[3], path[4], path[5]);
    gl.uniform3fv(this.loc(w, 'uFog'), pal.fog);
    gl.uniform3fv(this.loc(w, 'uZen'), pal.zenith);
    gl.uniform3fv(this.loc(w, 'uGrass'), pal.grass);
    gl.uniform3fv(this.loc(w, 'uGrassSun'), pal.grassSun);
    gl.uniform3fv(this.loc(w, 'uGrassShade'), pal.grassShade);
    gl.uniform3fv(this.loc(w, 'uCanopy'), pal.canopy);
    gl.uniform1f(this.loc(w, 'uDensity'), pal.density);
    gl.uniform1f(this.loc(w, 'uSun'), pal.sun);
    gl.uniform3f(this.loc(w, 'uCragA'), crags[0], crags[1], crags[2]);
    gl.uniform3f(this.loc(w, 'uCragB'), crags[3], crags[4], crags[5]);
    gl.uniform1ui(this.loc(w, 'uSeed'), seed >>> 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // the trees, back to front
    if (!count || !this.tex) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.sprite);
    const s = this.sprite;
    gl.uniform2f(this.loc(s, 'uRes'), W, H);
    gl.uniform1f(this.loc(s, 'uF'), v.f);
    gl.uniform1f(this.loc(s, 'uHz'), v.horizon);
    gl.uniform1f(this.loc(s, 'uT'), t);
    gl.uniform1f(this.loc(s, 'uWind'), wind);
    gl.uniform4f(this.loc(s, 'uCam'), v.x, v.z, v.eye, v.yaw);
    gl.uniform3fv(this.loc(s, 'uFog'), pal.fog);
    gl.uniform1f(this.loc(s, 'uDensity'), pal.density);
    gl.uniform1f(this.loc(s, 'uSun'), pal.sun);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.loc(s, 'uTex'), 0);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (instances.byteLength > this.capacity) {
      this.capacity = instances.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, count * STRIDE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}
