/**
 * Volley's picture: boxes and one ball, in WebGL 2, with nothing else in it.
 *
 * Everything but the ball is an axis-aligned box, drawn instanced (a centre, a size, a colour, a kind). The tunnel's
 * walls are panelled on the bricks' own grid, with a strip of lamp every ten units; the bricks are glazed. There are
 * three lights: the lamps, a lamp at the eye, and the ball, which lights the four walls round it (a ring of light at
 * its depth, which is most of how its place is read). Where the ball is behind something it is drawn again, faintly.
 *
 * The eye looks straight down the tunnel from behind the glass, far enough back that the glass (the tunnel's whole
 * section) exactly fills the screen's height: a point on the glass and a point on the screen are the same point.
 * Beyond the glass the picture (never the game) is bent, more with distance, so the tunnel winds.
 */
import { H, CELL, R } from './sim';

export const KIND = { plain: 0, tunnel: 1, brick: 3 } as const;
/** floats per box: centre, size, colour, kind, glow */
export const STRIDE = 11;
/** how far behind the glass the eye is */
export const EYE_BACK = 7;
const FOVY = 2 * Math.atan(H / 2 / EYE_BACK);

export interface Frame {
  /** where the glass is, and how far the eye is knocked off the axis */
  z: number; shake: [number, number];
  bend: [number, number];
  tint: [number, number, number];
  ball: [number, number, number];
  ballOn: boolean;
  boxes: Float32Array; count: number;
}

const VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 i_pos; layout(location=3) in vec3 i_size; layout(location=4) in vec3 i_col; layout(location=5) in vec2 i_fx;
uniform mat4 u_vp; uniform vec2 u_bend; uniform float u_z;
out vec3 v_w, v_n, v_col; out vec2 v_fx;
void main(){
  vec3 w=i_pos+a_pos*i_size; v_w=w; v_n=a_nrm; v_col=i_col; v_fx=i_fx;
  float d=max(0.,w.z-u_z); w.xy+=u_bend*d*d;
  gl_Position=u_vp*vec4(w,1.);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_w, v_n, v_col; in vec2 v_fx; out vec4 o;
uniform vec3 u_eye, u_ball, u_fog, u_tint; uniform float u_alpha, u_ballOn, u_isBall;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float edge(float a){ return 1.-smoothstep(0.,fwidth(a)*1.5,.5-abs(fract(a)-.5)); }
void main(){
  vec3 n=normalize(v_n), col=v_col, toEye=u_eye-v_w; float de=length(toEye); vec3 view=toEye/de;
  if(u_isBall>.5){
    float rim=pow(1.-max(dot(n,view),0.),2.);
    o=vec4(col*(.85+.25*max(n.y,0.))+vec3(1.,.85,.6)*(.5*rim+.25),u_alpha); return;
  }
  float kind=v_fx.x;
  // the lamps: a strip round the tunnel every ten units, and what it lights
  float dl=abs(fract(v_w.z/10.)-.5)*10.;
  vec3 lamps=u_tint*(.08+.42*exp(-dl*.5));
  vec3 glow=vec3(0.);
  if(kind>.5&&kind<1.5){
    float a=(abs(n.x)>.5?v_w.y:v_w.x)/${CELL.toFixed(4)}, b=v_w.z/${(2 * CELL).toFixed(4)};
    col*=.8+.3*hash(floor(vec2(a,b))+(abs(n.x)>.5?7.:0.));
    col*=1.-.4*max(edge(a),edge(b));
    glow=u_tint*u_tint*.85*smoothstep(.16,.07,dl);
  }
  float head=(.2+.8*max(dot(n,view),0.))*.62/(1.+de*de*.0028);
  vec3 lit=col*(vec3(.05,.06,.08)+lamps+vec3(1.,.96,.9)*head);
  vec3 lb=u_ball-v_w; float db=length(lb);
  lit+=col*vec3(1.,.5,.26)*u_ballOn*max(dot(n,lb/db),0.)*3.2/(1.+db*db*.28);
  if(kind>2.5) lit+=vec3(1.,.97,.9)*.35*pow(max(dot(n,view),0.),40.)/(1.+de*de*.004)+col*.14;
  lit+=glow+v_col*v_fx.y;
  float f=1.-exp(-pow(de*.0135,2.));
  lit=mix(lit,u_fog,f);
  // (a shoulder, so the lamps and the ball's light don't burn out)
  o=vec4(lit/(1.+max(lit-.6,0.)*.9),u_alpha);
}`;

function cube(): Float32Array {
  const out: number[] = [];
  const faces: [number[], number[], number[]][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, u, v] of faces) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
    for (let k = 0; k < 3; k++) out.push((n[k] + u[k] * a + v[k] * b) / 2);
    out.push(...n);
  }
  return new Float32Array(out);
}
function sphere(seg = 24, rings = 16): Float32Array {
  const out: number[] = [];
  const p = (i: number, j: number) => { const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) for (const [a, b] of [[0, 0], [1, 1], [1, 0], [0, 0], [0, 1], [1, 1]]) { const v = p(i + a, j + b); out.push(...v, ...v); }
  return new Float32Array(out);
}

/** The eye's matrix (column-major): at (ex, ey, ez) looking down +z, the world's +x the screen's right, +y up. */
function eyeMatrix(aspect: number, ex: number, ey: number, ez: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(FOVY / 2), m = new Float32Array(16);
  const A = (far + near) / (far - near), B = (-2 * far * near) / (far - near);
  m[0] = f / aspect; m[12] = (-ex * f) / aspect;
  m[5] = f; m[13] = -ey * f;
  m[10] = A; m[14] = -ez * A + B;
  m[11] = 1; m[15] = -ez;
  return m;
}

export function createRenderer(canvas: HTMLCanvasElement, fog: [number, number, number]) {
  const g = canvas.getContext('webgl2', { alpha: false, antialias: true });
  if (!g) return null;
  const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s) ?? 'shader'); return s; };
  const prog = g.createProgram()!;
  g.attachShader(prog, sh(g.VERTEX_SHADER, VERT)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(prog) ?? 'link');
  const U = Object.fromEntries(['u_vp', 'u_eye', 'u_ball', 'u_fog', 'u_tint', 'u_bend', 'u_z', 'u_alpha', 'u_ballOn', 'u_isBall'].map((k) => [k, g.getUniformLocation(prog, k)]));
  const inst = g.createBuffer()!;
  const mesh = (data: Float32Array) => {
    const vao = g.createVertexArray()!; g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 3, g.FLOAT, false, 24, 12);
    g.bindBuffer(g.ARRAY_BUFFER, inst);
    [[2, 3, 0], [3, 3, 12], [4, 3, 24], [5, 2, 36]].forEach(([loc, n, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, n, g.FLOAT, false, STRIDE * 4, off); g.vertexAttribDivisor(loc, 1); });
    return { vao, n: data.length / 6 };
  };
  const box = mesh(cube()), ball = mesh(sphere());
  const one = new Float32Array(STRIDE);

  return {
    gl: g,
    render(f: Frame) {
      const w = canvas.width, h = canvas.height;
      g.viewport(0, 0, w, h); g.clearColor(fog[0], fog[1], fog[2], 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      g.enable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.depthFunc(g.LESS); g.depthMask(true); g.disable(g.BLEND);
      g.useProgram(prog);
      const eye = [f.shake[0], f.shake[1], f.z - EYE_BACK];
      g.uniformMatrix4fv(U.u_vp, false, eyeMatrix(w / h, eye[0], eye[1], eye[2], 1, 260));
      g.uniform3fv(U.u_eye, eye); g.uniform3fv(U.u_ball, f.ball); g.uniform3fv(U.u_fog, fog); g.uniform3fv(U.u_tint, f.tint);
      g.uniform2fv(U.u_bend, f.bend); g.uniform1f(U.u_z, f.z);
      g.uniform1f(U.u_ballOn, f.ballOn ? 1 : 0); g.uniform1f(U.u_alpha, 1); g.uniform1f(U.u_isBall, 0);
      g.bindVertexArray(box.vao); g.bindBuffer(g.ARRAY_BUFFER, inst);
      g.bufferData(g.ARRAY_BUFFER, f.boxes.subarray(0, f.count * STRIDE), g.DYNAMIC_DRAW);
      g.drawArraysInstanced(g.TRIANGLES, 0, box.n, f.count);
      if (!f.ballOn) return;
      one.set([f.ball[0], f.ball[1], f.ball[2], R, R, R, 1, 0.42, 0.2, 0, 0]);
      g.bindVertexArray(ball.vao); g.bindBuffer(g.ARRAY_BUFFER, inst); g.bufferData(g.ARRAY_BUFFER, one, g.DYNAMIC_DRAW);
      g.uniform1f(U.u_isBall, 1);
      g.drawArraysInstanced(g.TRIANGLES, 0, ball.n, 1);
      // (and again where it's hidden, faint)
      g.depthFunc(g.GREATER); g.depthMask(false); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.uniform1f(U.u_alpha, 0.4);
      g.drawArraysInstanced(g.TRIANGLES, 0, ball.n, 1);
    },
  };
}
