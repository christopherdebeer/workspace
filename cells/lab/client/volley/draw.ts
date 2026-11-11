/**
 * Volley's picture: boxes and one ball, in WebGL 2, with nothing else in it.
 *
 * Everything but the ball is an axis-aligned box, drawn instanced (a centre, a size, a colour, a kind). The kind picks
 * what the surface does besides being lit: the floor is boards, takes the ball's shadow and the soft dark round the
 * feet of the bricks (a tiny texture of which bricks stand, sampled smooth); the walls darken to the floor and carry
 * depth marks; the bricks are glazed. The ball lights what is near it, which is most of how its place is read.
 * Where the ball is behind something it is drawn again, faintly, so it is never lost.
 */
import { W, COLS, ROWS, BRICK_W, BRICK_D, BRICK_Z0, R } from './sim';

export const KIND = { plain: 0, floor: 1, wall: 2, brick: 3 } as const;
/** floats per box: centre, size, colour, kind, glow */
export const STRIDE = 11;

export interface Frame {
  eye: [number, number, number];
  yaw: number; pitch: number; roll: number;
  ball: [number, number, number];
  ballOn: boolean;
  boxes: Float32Array; count: number;
  /** which bricks stand, with a ring of empty cells round them: (COLS+2) x (ROWS+2) */
  occ: Uint8Array;
}

const VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 i_pos; layout(location=3) in vec3 i_size; layout(location=4) in vec3 i_col; layout(location=5) in vec2 i_fx;
uniform mat4 u_vp;
out vec3 v_w, v_n, v_col; out vec2 v_fx;
void main(){ vec3 w=i_pos+a_pos*i_size; v_w=w; v_n=a_nrm; v_col=i_col; v_fx=i_fx; gl_Position=u_vp*vec4(w,1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_w, v_n, v_col; in vec2 v_fx; out vec4 o;
uniform vec3 u_eye, u_ball, u_fog; uniform sampler2D u_occ; uniform float u_alpha, u_ballOn, u_isBall;
float hash(float n){ return fract(sin(n*127.1)*43758.5453); }
void main(){
  vec3 n=normalize(v_n), col=v_col, view=normalize(u_eye-v_w);
  vec3 sun=normalize(vec3(-.4,.8,-.5));
  float kind=v_fx.x, shade=1.;
  if(u_isBall>.5){
    float lam=max(dot(n,sun),0.), rim=pow(1.-max(dot(n,view),0.),2.5);
    o=vec4(col*(.62+.5*lam)+vec3(1.,.8,.6)*(.35*rim+.5*pow(max(dot(reflect(-sun,n),view),0.),30.)),u_alpha); return;
  }
  if(kind>.5&&kind<1.5&&n.y>.5){
    // boards, running away from you
    float px=v_w.x*2.2, id=floor(px), pz=v_w.z*.42+hash(id+7.)*5.;
    col*=.93+.12*hash(id)-.05*hash(floor(pz)+id*3.);
    float lx=1.-smoothstep(0.,fwidth(px)*1.5,.5-abs(fract(px)-.5));
    float lz=1.-smoothstep(0.,fwidth(pz)*1.5,.5-abs(fract(pz)-.5));
    col*=1.-.2*max(lx,lz);
    vec2 uv=vec2((v_w.x+${(W / 2).toFixed(3)})/${BRICK_W.toFixed(4)}+1.,(v_w.z-${BRICK_Z0.toFixed(3)})/${BRICK_D.toFixed(4)}+1.)/vec2(${COLS + 2}.,${ROWS + 2}.);
    shade*=1.-.42*smoothstep(0.,.9,texture(u_occ,uv).r);
    float d=length(v_w.xz-u_ball.xz);
    shade*=1.-.55*u_ballOn*smoothstep(${(R * 2.1).toFixed(3)},${(R * 0.5).toFixed(3)},d);
  }
  if(kind>1.5&&kind<2.5){
    shade*=mix(.78,1.,smoothstep(0.,1.1,v_w.y));
    // a mark on the wall every two paces, and a line along it
    float t=v_w.z*.5, m=1.-smoothstep(0.,fwidth(t)*1.5,.5-abs(fract(t)-.5));
    float y=v_w.y, band=smoothstep(.02,0.,abs(y-1.05)-.02);
    col=mix(col,vec3(.80,.27,.17),.85*max(band, m*step(y,1.05)*step(.8,y))*abs(n.x));
  }
  float lam=max(dot(n,sun),0.);
  vec3 hemi=mix(vec3(.47,.44,.43),vec3(.80,.84,.90),n.y*.5+.5);
  vec3 lit=col*(hemi*.78+vec3(1.,.95,.86)*lam*.5)*shade;
  vec3 lb=u_ball-v_w; float dl=length(lb);
  lit+=col*vec3(1.,.42,.22)*u_ballOn*max(dot(n,lb/dl),0.)*1.5/(1.+dl*dl*2.2);
  if(kind>2.5) lit+=vec3(1.,.97,.9)*(.3*pow(max(dot(reflect(-sun,n),view),0.),28.)+.1*pow(1.-max(dot(n,view),0.),3.));
  lit+=v_col*v_fx.y;
  float f=1.-exp(-pow(length(u_eye-v_w)*.03,2.));
  o=vec4(mix(lit,u_fog,f),u_alpha);
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

// (column-major 4x4s)
function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
function view(eye: number[], yaw: number, pitch: number, roll: number): Float32Array {
  // forward is +z at yaw 0; yaw turns toward +x
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [sy * cp, sp, cy * cp];
  let r = [cy, 0, -sy]; // (the world's +x is the screen's right, looking down +z: a left-handed eye, so nothing is culled by winding)
  let u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const cr = Math.cos(roll), sr = Math.sin(roll);
  [r, u] = [r.map((v, k) => v * cr + u[k] * sr), u.map((v, k) => v * cr - r[k] * sr)];
  const m = new Float32Array(16), dot = (a: number[]) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = dot(r);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = dot(u);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = -dot(f);
  m[15] = 1;
  return m;
}
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; m[c * 4 + r] = s; }
  return m;
}

/** the field of view for a screen this shape: wide enough across on a phone held upright, without the top going fisheye */
export function fovFor(aspect: number): number {
  const across = (58 * Math.PI) / 180;
  return Math.max((52 * Math.PI) / 180, Math.min((92 * Math.PI) / 180, 2 * Math.atan(Math.tan(across / 2) / aspect)));
}

export function createRenderer(canvas: HTMLCanvasElement, fog: [number, number, number]) {
  const g = canvas.getContext('webgl2', { alpha: false, antialias: true });
  if (!g) return null;
  const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s) ?? 'shader'); return s; };
  const prog = g.createProgram()!;
  g.attachShader(prog, sh(g.VERTEX_SHADER, VERT)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(prog) ?? 'link');
  const U = Object.fromEntries(['u_vp', 'u_eye', 'u_ball', 'u_fog', 'u_occ', 'u_alpha', 'u_ballOn', 'u_isBall'].map((k) => [k, g.getUniformLocation(prog, k)]));
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
  const occ = g.createTexture()!;
  g.bindTexture(g.TEXTURE_2D, occ); g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v);
  const one = new Float32Array(STRIDE);
  let vp: Float32Array = new Float32Array(16);

  return {
    gl: g,
    render(f: Frame) {
      const w = canvas.width, h = canvas.height;
      g.viewport(0, 0, w, h); g.clearColor(fog[0], fog[1], fog[2], 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      g.enable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.depthFunc(g.LESS); g.depthMask(true); g.disable(g.BLEND);
      g.useProgram(prog);
      vp = mul(perspective(fovFor(w / h), w / h, 0.05, 80), view(f.eye, f.yaw, f.pitch, f.roll));
      g.uniformMatrix4fv(U.u_vp, false, vp);
      g.uniform3fv(U.u_eye, f.eye); g.uniform3fv(U.u_ball, f.ball); g.uniform3fv(U.u_fog, fog);
      g.uniform1f(U.u_ballOn, f.ballOn ? 1 : 0); g.uniform1f(U.u_alpha, 1); g.uniform1f(U.u_isBall, 0);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, occ);
      g.texImage2D(g.TEXTURE_2D, 0, g.R8, COLS + 2, ROWS + 2, 0, g.RED, g.UNSIGNED_BYTE, f.occ);
      g.uniform1i(U.u_occ, 0);
      g.bindVertexArray(box.vao); g.bindBuffer(g.ARRAY_BUFFER, inst);
      g.bufferData(g.ARRAY_BUFFER, f.boxes.subarray(0, f.count * STRIDE), g.DYNAMIC_DRAW);
      g.drawArraysInstanced(g.TRIANGLES, 0, box.n, f.count);
      if (!f.ballOn) return;
      one.set([f.ball[0], f.ball[1], f.ball[2], R, R, R, 0.93, 0.30, 0.17, 0, 0]);
      g.bindVertexArray(ball.vao); g.bindBuffer(g.ARRAY_BUFFER, inst); g.bufferData(g.ARRAY_BUFFER, one, g.DYNAMIC_DRAW);
      g.uniform1f(U.u_isBall, 1);
      g.drawArraysInstanced(g.TRIANGLES, 0, ball.n, 1);
      // (and again where it's hidden, faint)
      g.depthFunc(g.GREATER); g.depthMask(false); g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.uniform1f(U.u_alpha, 0.34);
      g.drawArraysInstanced(g.TRIANGLES, 0, ball.n, 1);
    },
    /** a point in the world to the screen: x, y in -1..1 (y up), and whether it's in front of the eye */
    project(p: [number, number, number]) {
      const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      return { x: x / Math.abs(w || 1e-6), y: y / Math.abs(w || 1e-6), front: w > 0 };
    },
  };
}
