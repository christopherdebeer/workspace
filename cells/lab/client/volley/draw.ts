/**
 * Volley's picture: fractured sheets hanging in haze, in WebGL 2, with nothing else in it.
 *
 * Every solid is a prism: a shard of a sheet (its outline, a thickness, a face tilted a little off the sheet's plane
 * so no two catch the light alike), or a piece of one, tumbling. Faces are flat; nothing is smoothed. What a face is
 * made of is worked out where it's drawn, from where it is in the sheet: plaster with its pores, fired red, a
 * crazed glaze; the broken edges are the bare body. One light, low and warm, from behind your shoulder, and it
 * casts: each sheet's holes fall on the sheet behind, and so does the ball, which is most of how its depth is read.
 * The rest is haze, thickening with distance into the sky's own gradient.
 *
 * The eye looks straight along the way from behind the pane, far enough back that the pane (the way's whole
 * section) exactly fills the screen: a point on the pane and a point on the screen are the same point. Beyond the
 * pane the picture (never the game) is bent, more with distance, so the sheets drift off the axis as they recede.
 */
import { H, R, SHEET_T, GLAZED, type Sheet } from './sim';
import { hash } from '../kit/rng';

/** floats per vertex of a solid: place, normal, tone, what it's made of, how far in from the face's rim (-1: a side) */
export const STRIDE = 9;
/** floats per vertex of a sprite (the ball's wake, dust): place, a coordinate across it, colour and alpha */
export const SPRITE = 9;
/** how far behind the pane the eye is */
export const EYE_BACK = 7;
export const MAT = { plain: 0, red: 1, glazed: 2, crazed: 3, ball: 4 } as const;

export interface Frame {
  z: number; W: number; shake: [number, number];
  bend: [number, number];
  /** the sky at the top and the bottom of the screen, and the light's colour */
  skyTop: number[]; skyLow: number[]; sun: number[];
  ball: [number, number, number]; ballOn: boolean;
  sheets: Sheet[];
  /** pieces in the air: solid vertices, as many as `fragVerts` */
  frags: Float32Array; fragVerts: number;
  sprites: Float32Array; spriteVerts: number;
}

const BEND = `float d=max(0.,w.z-u_z); w.xy+=u_bend*d*d;`;
const VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec3 a_fx;
uniform mat4 u_vp, u_light; uniform vec2 u_bend; uniform float u_z; uniform vec4 u_model;
out vec3 v_w, v_o, v_n, v_fx; out vec4 v_l;
void main(){
  vec3 w=u_model.xyz+a_pos*u_model.w; v_o=w; v_n=a_nrm; v_fx=a_fx;
  ${BEND}
  v_w=w; v_l=u_light*vec4(w+a_nrm*.07,1.);
  gl_Position=u_vp*vec4(w,1.);
}`;
const DEPTH_VERT = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_light; uniform vec2 u_bend; uniform float u_z; uniform vec4 u_model;
void main(){ vec3 w=u_model.xyz+a_pos*u_model.w; ${BEND} gl_Position=u_light*vec4(w,1.); }`;
const DEPTH_FRAG = `#version 300 es
precision mediump float; void main(){}`;

const FRAG = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 v_w, v_o, v_n, v_fx; in vec4 v_l; out vec4 o;
uniform vec3 u_eye, u_toLight, u_skyTop, u_skyLow, u_sun; uniform vec2 u_res; uniform float u_z, u_alpha;
uniform sampler2DShadow u_shadow;
float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return .45*vn(p)+.28*vn(p*2.1+7.)+.17*vn(p*4.3+3.)+.1*vn(p*8.9+11.); }
// (crazing: the distance to the nearest of a scatter of points, against the next nearest: lines where they're equal)
float craze(vec2 p){
  vec2 i=floor(p),f=fract(p); float a=9.,b=9.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y),q=g+vec2(h2(i+g),h2(i+g+17.))-f; float d=dot(q,q); if(d<a){b=a;a=d;}else if(d<b)b=d; }
  return 1.-smoothstep(0.,.06,sqrt(b)-sqrt(a));
}
float lit(){
  vec3 p=v_l.xyz/v_l.w*.5+.5;
  if(p.x<0.||p.x>1.||p.y<0.||p.y>1.||p.z>1.)return 1.;
  float s=0.,t=1./2048.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(u_shadow,vec3(p.xy+vec2(x,y)*t*1.4,p.z-.0009));
  return s/9.;
}
void main(){
  vec3 n=normalize(v_n), view=normalize(u_eye-v_w), L=u_toLight;
  float mat=v_fx.y, tone=v_fx.x, edge=v_fx.z; bool side=edge<-.5;
  vec2 uv=gl_FragCoord.xy/u_res;
  vec3 sky=mix(u_skyLow,u_skyTop,uv.y);
  if(mat>3.5){
    // the ball: glazed, the sky in it
    float ndl=max(dot(n,L),0.), fres=pow(1.-max(dot(n,view),0.),3.);
    vec3 c=vec3(.07,.12,.46)*(.35+.9*ndl)+sky*(.12+.55*fres)+u_sun*1.3*pow(max(dot(n,normalize(L+view)),0.),70.);
    o=vec4(c,u_alpha); return;
  }
  vec3 base; float gloss=0.;
  // (the surface's own coordinates: across whichever way the face mostly looks, so a turned piece isn't streaked)
  vec3 an=abs(n); vec2 q=an.z>.6?v_o.xy:an.x>an.y?v_o.yz:v_o.xz;
  float grain=fbm(q*1.7), pores=smoothstep(.55,.9,fbm(q*9.))*.6+.4*h2(floor(q*90.));
  if(side){
    // a broken edge: the bare body, whatever the face was
    base=mix(vec3(.90,.78,.62),vec3(.78,.50,.36),step(.5,mat)*step(mat,1.5)*.7)*(.9+.14*fbm(q*5.));
  } else if(mat<.5){
    base=mix(vec3(.90,.82,.70),vec3(.97,.92,.83),grain)*(1.-.07*pores);
  } else if(mat<1.5){
    base=mix(vec3(.70,.36,.24),vec3(.84,.50,.33),grain)*(1.-.08*pores);
  } else {
    float c=craze(q*(mat>2.5?3.2:6.5));
    base=mix(vec3(.08,.14,.50),vec3(.16,.27,.66),grain);
    base=mix(base,mat>2.5?vec3(.86,.84,.80):base*.35,c*(mat>2.5?.9:.55));
    gloss=1.-c*.6;
  }
  base*=tone;
  // (the face's rim: worn pale, and a dark line where it meets the joint)
  if(!side){ base=mix(base,base*1.1+.03,smoothstep(.2,.05,edge)*.6); base*=.72+.28*smoothstep(0.,.035,edge); }
  float ndl=max(dot(n,L),0.), sh=lit();
  vec3 amb=mix(u_skyLow,u_skyTop,n.y*.5+.5)*.66+u_skyTop*.22*max(n.z,0.);
  vec3 c=base*(u_sun*.98*ndl*sh+amb);
  c+=gloss*(u_sun*.9*pow(max(dot(n,normalize(L+view)),0.),90.)*sh+sky*.3*pow(1.-max(dot(n,view),0.),4.));
  float far=max(0.,v_w.z-u_z-1.5), f=1.-exp(-far*.021);
  c=mix(c,sky,f);
  o=vec4(c/(1.+max(c-.85,0.)*.7),u_alpha);
}`;

const SKY_VERT = `#version 300 es
out vec2 v_uv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); v_uv=p; gl_Position=vec4(p*2.-1.,1.,1.); }`;
const SKY_FRAG = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform vec3 u_skyTop,u_skyLow,u_sun; uniform float u_aspect;
void main(){
  vec3 c=mix(u_skyLow,u_skyTop,v_uv.y);
  // (the light's own glow, up and to the left, where it comes from)
  vec2 d=(v_uv-vec2(.12,.9))*vec2(u_aspect,1.);
  c+=u_sun*.1*exp(-dot(d,d)*2.2);
  o=vec4(c,1.);
}`;
const SPRITE_VERT = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec4 a_col;
uniform mat4 u_vp; uniform vec2 u_bend; uniform float u_z;
out vec2 v_uv; out vec4 v_col;
void main(){ vec3 w=a_pos; ${BEND} v_uv=a_uv; v_col=a_col; gl_Position=u_vp*vec4(w,1.); }`;
const SPRITE_FRAG = `#version 300 es
precision highp float; in vec2 v_uv; in vec4 v_col; out vec4 o;
void main(){ float m=v_uv.y>1.5?1.-abs(v_uv.x):1.-length(v_uv); o=vec4(v_col.rgb,v_col.a*smoothstep(0.,.7,m)); }`;

/**
 * A prism into `out` at float offset `o`: a front face (a fan from its middle), sides, and a back if given. `front`
 * and `back` are x, y, z triples round the outline, counter-clockwise seen from the front. Returns the new offset.
 */
export function prism(out: Float32Array, o: number, front: number[], back: number[], cf: number[], nf: number[], cb: number[] | null, tone: number, mat: number): number {
  const n = front.length / 3;
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, edge: number) => { out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = nx; out[o + 4] = ny; out[o + 5] = nz; out[o + 6] = tone; out[o + 7] = mat; out[o + 8] = edge; o += STRIDE; };
  for (let k = 0; k < n; k++) {
    const a = k * 3, b = ((k + 1) % n) * 3;
    put(cf[0], cf[1], cf[2], nf[0], nf[1], nf[2], 1); put(front[a], front[a + 1], front[a + 2], nf[0], nf[1], nf[2], 0); put(front[b], front[b + 1], front[b + 2], nf[0], nf[1], nf[2], 0);
    // the side under this edge
    const ex = front[b] - front[a], ey = front[b + 1] - front[a + 1], ez = front[b + 2] - front[a + 2], dx = back[a] - front[a], dy = back[a + 1] - front[a + 1], dz = back[a + 2] - front[a + 2];
    let nx = ey * dz - ez * dy, ny = ez * dx - ex * dz, nz = ex * dy - ey * dx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    put(front[a], front[a + 1], front[a + 2], nx, ny, nz, -1); put(back[a], back[a + 1], back[a + 2], nx, ny, nz, -1); put(front[b], front[b + 1], front[b + 2], nx, ny, nz, -1);
    put(front[b], front[b + 1], front[b + 2], nx, ny, nz, -1); put(back[a], back[a + 1], back[a + 2], nx, ny, nz, -1); put(back[b], back[b + 1], back[b + 2], nx, ny, nz, -1);
    if (cb) { put(cb[0], cb[1], cb[2], -nf[0], -nf[1], -nf[2], 1); put(back[b], back[b + 1], back[b + 2], -nf[0], -nf[1], -nf[2], 0); put(back[a], back[a + 1], back[a + 2], -nf[0], -nf[1], -nf[2], 0); }
  }
  return o;
}
/** how a shard of a sheet sits: its face tilted a little, set a little proud or shy, a tone of its own */
export function seat(sheet: number, k: number) {
  const u = (j: number) => hash(sheet, k, j) / 4294967296;
  return { tx: (u(1) - 0.5) * 0.16, ty: (u(2) - 0.5) * 0.16, dz: (u(3) - 0.5) * 0.1, tone: 0.9 + u(4) * 0.2 };
}
export const matOf = (kind: number, hp: number) => (kind === GLAZED ? (hp > 1 ? MAT.glazed : MAT.crazed) : kind);

function meshOf(sh: Sheet): Float32Array {
  let verts = 0;
  for (const d of sh.shards) if (d.hp) verts += (d.poly.length / 2) * 9;
  const out = new Float32Array(verts * STRIDE), front: number[] = [], back: number[] = [];
  let o = 0;
  sh.shards.forEach((d, k) => {
    if (!d.hp) return;
    const { tx, ty, dz, tone } = seat(sh.i, k), zf = sh.z - SHEET_T / 2 + dz, l = Math.hypot(tx, ty, 1);
    front.length = back.length = 0;
    for (let j = 0; j < d.poly.length; j += 2) { const x = d.poly[j], y = d.poly[j + 1]; front.push(x, y, zf + tx * (x - d.cx) + ty * (y - d.cy)); back.push(x, y, sh.z + SHEET_T / 2); }
    o = prism(out, o, front, back, [d.cx, d.cy, zf], [tx / l, ty / l, -1 / l], null, tone, matOf(d.kind, d.hp));
  });
  return out;
}
function sphere(seg = 20, rings = 12): Float32Array {
  // (faceted, like everything else: each face its own normal)
  const out: number[] = [];
  const p = (i: number, j: number) => { const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const q = [p(i, j), p(i + 1, j + 1), p(i + 1, j), p(i, j), p(i, j + 1), p(i + 1, j + 1)];
    for (const v of q) out.push(...v, ...v, 1, MAT.ball, 1);
  }
  return new Float32Array(out);
}

// (column-major 4x4s)
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; m[c * 4 + r] = s; }
  return m;
}
/** The eye's matrix: at (ex, ey, ez) looking down +z, the world's +x the screen's right, +y up; the pane, EYE_BACK
 * ahead, exactly filling the screen (W across, H up). */
function eyeMatrix(W: number, ex: number, ey: number, ez: number, near: number, far: number): Float32Array {
  const fx = EYE_BACK / (W / 2), fy = EYE_BACK / (H / 2), m = new Float32Array(16);
  const A = (far + near) / (far - near), B = (-2 * far * near) / (far - near);
  m[0] = fx; m[12] = -ex * fx; m[5] = fy; m[13] = -ey * fy; m[10] = A; m[14] = -ez * A + B; m[11] = 1; m[15] = -ez;
  return m;
}
/** The light's matrix: looking along the way the light goes, at a box round `c` (half-sizes `r` across, `deep` along). */
function lightMatrix(dir: number[], c: number[], r: number, deep: number): Float32Array {
  const f = dir, rl = Math.hypot(f[2], f[0]), right = [f[2] / rl, 0, -f[0] / rl];
  const up = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  const m = new Float32Array(16), row = (k: number, a: number[], s: number) => { m[k] = a[0] * s; m[4 + k] = a[1] * s; m[8 + k] = a[2] * s; m[12 + k] = -(a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) * s; };
  row(0, right, 1 / r); row(1, up, 1 / r); row(2, f, 1 / deep); m[15] = 1;
  return m;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('webgl2', { alpha: false, antialias: true });
  if (!g) return null;
  const program = (vs: string, fs: string, names: string[]) => {
    const sh = (type: number, src: string) => { const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = g.createProgram()!;
    g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(p) ?? 'link');
    return { p, u: Object.fromEntries(names.map((k) => [k, g.getUniformLocation(p, k)])) };
  };
  const main = program(VERT, FRAG, ['u_vp', 'u_light', 'u_bend', 'u_z', 'u_model', 'u_eye', 'u_toLight', 'u_skyTop', 'u_skyLow', 'u_sun', 'u_res', 'u_alpha', 'u_shadow']);
  const depth = program(DEPTH_VERT, DEPTH_FRAG, ['u_light', 'u_bend', 'u_z', 'u_model']);
  const sky = program(SKY_VERT, SKY_FRAG, ['u_skyTop', 'u_skyLow', 'u_sun', 'u_aspect']);
  const sprite = program(SPRITE_VERT, SPRITE_FRAG, ['u_vp', 'u_bend', 'u_z']);

  const solid = (usage: number) => {
    const vao = g.createVertexArray()!, buf = g.createBuffer()!;
    g.bindVertexArray(vao); g.bindBuffer(g.ARRAY_BUFFER, buf);
    [[0, 0], [1, 12], [2, 24]].forEach(([loc, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 3, g.FLOAT, false, STRIDE * 4, off); });
    return { vao, buf, n: 0, ver: -1, usage };
  };
  const fill = (m: ReturnType<typeof solid>, data: Float32Array, floats = data.length) => { g.bindBuffer(g.ARRAY_BUFFER, m.buf); g.bufferData(g.ARRAY_BUFFER, data.subarray(0, floats), m.usage); m.n = floats / STRIDE; };
  const ball = solid(g.STATIC_DRAW); fill(ball, sphere());
  const frags = solid(g.DYNAMIC_DRAW);
  const sheets = new Map<number, ReturnType<typeof solid>>();
  const spriteVao = g.createVertexArray()!, spriteBuf = g.createBuffer()!;
  g.bindVertexArray(spriteVao); g.bindBuffer(g.ARRAY_BUFFER, spriteBuf);
  [[0, 3, 0], [1, 2, 12], [2, 4, 20]].forEach(([loc, n, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, n, g.FLOAT, false, SPRITE * 4, off); });
  const skyVao = g.createVertexArray()!;

  // the light's own view of things, for what it can't reach
  const SHADOW = 2048, shadowTex = g.createTexture()!, shadowFbo = g.createFramebuffer()!;
  g.bindTexture(g.TEXTURE_2D, shadowTex);
  g.texImage2D(g.TEXTURE_2D, 0, g.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, g.DEPTH_COMPONENT, g.UNSIGNED_INT, null);
  for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_COMPARE_MODE, g.COMPARE_REF_TO_TEXTURE], [g.TEXTURE_COMPARE_FUNC, g.LEQUAL]]) g.texParameteri(g.TEXTURE_2D, k, v);
  g.bindFramebuffer(g.FRAMEBUFFER, shadowFbo);
  g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, shadowTex, 0);
  g.drawBuffers([g.NONE]); g.readBuffer(g.NONE);
  g.bindFramebuffer(g.FRAMEBUFFER, null);

  // (the light goes this way: from behind your left shoulder, and above)
  const dl = Math.hypot(0.34, -0.42, 1), going = [0.34 / dl, -0.42 / dl, 1 / dl], toLight = going.map((v) => -v);

  return {
    gl: g,
    render(f: Frame) {
      const w = canvas.width, h = canvas.height;
      // the sheets as they stand: a mesh each, made again when a shard of it changes, dropped when it's behind
      const here = new Set<number>();
      for (const sh of f.sheets) {
        here.add(sh.i);
        let m = sheets.get(sh.i);
        if (!m) { m = solid(g.DYNAMIC_DRAW); sheets.set(sh.i, m); }
        if (m.ver !== sh.ver) { fill(m, meshOf(sh)); m.ver = sh.ver; }
      }
      for (const [i, m] of sheets) if (!here.has(i)) { g.deleteBuffer(m.buf); g.deleteVertexArray(m.vao); sheets.delete(i); }
      fill(frags, f.frags, f.fragVerts * STRIDE);
      const eye = [f.shake[0], f.shake[1], f.z - EYE_BACK];
      const vp = eyeMatrix(f.W, eye[0], eye[1], eye[2], 1, 300);
      const reach = Math.max(f.W, H) * 0.85 + 26, light = lightMatrix(going, [0, 0, f.z + 28], reach, 70);
      const solids = (p: typeof main | typeof depth) => {
        g.uniform4f(p.u.u_model, 0, 0, 0, 1);
        for (const m of sheets.values()) if (m.n) { g.bindVertexArray(m.vao); g.drawArrays(g.TRIANGLES, 0, m.n); }
        if (frags.n) { g.bindVertexArray(frags.vao); g.drawArrays(g.TRIANGLES, 0, frags.n); }
        if (f.ballOn) { g.uniform4f(p.u.u_model, f.ball[0], f.ball[1], f.ball[2], R); g.bindVertexArray(ball.vao); g.drawArrays(g.TRIANGLES, 0, ball.n); }
      };
      g.enable(g.DEPTH_TEST); g.disable(g.CULL_FACE); g.depthFunc(g.LESS); g.depthMask(true); g.disable(g.BLEND);
      // what the light sees
      g.bindFramebuffer(g.FRAMEBUFFER, shadowFbo); g.viewport(0, 0, SHADOW, SHADOW); g.clear(g.DEPTH_BUFFER_BIT);
      g.useProgram(depth.p);
      g.uniformMatrix4fv(depth.u.u_light, false, light); g.uniform2fv(depth.u.u_bend, f.bend); g.uniform1f(depth.u.u_z, f.z);
      g.enable(g.POLYGON_OFFSET_FILL); g.polygonOffset(2, 4);
      solids(depth);
      g.disable(g.POLYGON_OFFSET_FILL);
      // what you see: the sky, then the solids
      g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, w, h); g.clear(g.DEPTH_BUFFER_BIT);
      g.useProgram(sky.p); g.depthMask(false); g.disable(g.DEPTH_TEST);
      g.uniform3fv(sky.u.u_skyTop, f.skyTop); g.uniform3fv(sky.u.u_skyLow, f.skyLow); g.uniform3fv(sky.u.u_sun, f.sun); g.uniform1f(sky.u.u_aspect, w / h);
      g.bindVertexArray(skyVao); g.drawArrays(g.TRIANGLES, 0, 3);
      g.enable(g.DEPTH_TEST); g.depthMask(true);
      g.useProgram(main.p);
      g.uniformMatrix4fv(main.u.u_vp, false, vp); g.uniformMatrix4fv(main.u.u_light, false, light);
      g.uniform2fv(main.u.u_bend, f.bend); g.uniform1f(main.u.u_z, f.z); g.uniform3fv(main.u.u_eye, eye); g.uniform3fv(main.u.u_toLight, toLight);
      g.uniform3fv(main.u.u_skyTop, f.skyTop); g.uniform3fv(main.u.u_skyLow, f.skyLow); g.uniform3fv(main.u.u_sun, f.sun);
      g.uniform2f(main.u.u_res, w, h); g.uniform1f(main.u.u_alpha, 1);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, shadowTex); g.uniform1i(main.u.u_shadow, 0);
      solids(main);
      g.enable(g.BLEND); g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA); g.depthMask(false);
      if (f.ballOn) {
        // (the ball again where it's hidden, faint)
        g.depthFunc(g.GREATER); g.uniform1f(main.u.u_alpha, 0.38);
        g.uniform4f(main.u.u_model, f.ball[0], f.ball[1], f.ball[2], R); g.bindVertexArray(ball.vao); g.drawArrays(g.TRIANGLES, 0, ball.n);
        g.depthFunc(g.LESS);
      }
      if (f.spriteVerts) {
        g.useProgram(sprite.p);
        g.uniformMatrix4fv(sprite.u.u_vp, false, vp); g.uniform2fv(sprite.u.u_bend, f.bend); g.uniform1f(sprite.u.u_z, f.z);
        g.bindVertexArray(spriteVao); g.bindBuffer(g.ARRAY_BUFFER, spriteBuf); g.bufferData(g.ARRAY_BUFFER, f.sprites.subarray(0, f.spriteVerts * SPRITE), g.DYNAMIC_DRAW);
        g.drawArrays(g.TRIANGLES, 0, f.spriteVerts);
      }
      g.depthMask(true); g.disable(g.BLEND);
    },
    stats: () => ({ sheets: sheets.size, verts: [...sheets.values()].reduce((n, m) => n + m.n, 0) + frags.n }),
  };
}
export { mul };
